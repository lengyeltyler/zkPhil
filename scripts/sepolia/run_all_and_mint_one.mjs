import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';

import dotenv from 'dotenv';
import { ethers } from 'ethers';

import { buildMintUserOp, getUserOpHash, signUserOp } from '../../frontend/userop.js';
import {
  getAddressUrl,
  getTxUrl,
  logTx,
  waitForReceiptWithTimeout,
} from './txutil.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..');

const ENTRY_POINT_V07 = '0x0000000071727De22E5E9d8BAf0edAc6f37da032';
const SEPOLIA_CHAIN_ID = 11155111;
const BACKEND_START_TIMEOUT_MS = 30_000;
const HTTP_TIMEOUT_MS = 15_000;
const COMMAND_TIMEOUT_MS = Number(process.env.COMMAND_TIMEOUT_MS || String(30 * 60 * 1000));
const DEFAULT_MIN_PAYMASTER_DEPOSIT = '0.02';

function loadEnv() {
  const configuredPath = String(process.env.DOTENV_CONFIG_PATH || '').trim();
  const envPath = configuredPath
    ? path.resolve(process.cwd(), configuredPath)
    : path.join(REPO_ROOT, '.env');
  dotenv.config({ path: envPath });
}

function readEnv(name) {
  return String(process.env[name] || '').trim();
}

function requireEnv(name) {
  const value = readEnv(name);
  if (!value) {
    throw new Error(`${name} must be set explicitly in environment.`);
  }
  return value;
}

function isTruthy(value) {
  return ['1', 'true', 'yes', 'on'].includes(String(value || '').trim().toLowerCase());
}

function frontendTestStarkPubKeyX(chainId, owner) {
  const normalizedOwner = ethers.getAddress(owner);
  const hashed = ethers.solidityPackedKeccak256(
    ['string', 'uint256', 'address'],
    ['phil-test-mode-stark-pubkey', BigInt(chainId), normalizedOwner]
  );
  return ethers.toBeHex(BigInt(hashed), 32);
}

function getSepoliaDeploymentPath(prefix) {
  return path.join(REPO_ROOT, 'deployments', `${prefix}_${SEPOLIA_CHAIN_ID}.json`);
}

function shouldReuseDeployments() {
  return !isTruthy(process.env.FORCE_REDEPLOY);
}

function getDeployStarkEnv() {
  const env = {};
  if (shouldReuseDeployments() && fs.existsSync(getSepoliaDeploymentPath('stark'))) {
    env.REUSE_STARK_DEPLOYMENTS = '1';
  }
  return env;
}

function getDeploy4337Env() {
  const env = {
    PAYMASTER_DEPOSIT: getEffectivePaymasterDepositEth(),
  };
  if (shouldReuseDeployments() && fs.existsSync(getSepoliaDeploymentPath('4337'))) {
    env.REUSE_4337_DEPLOYMENTS = '1';
  }
  return env;
}

function getMarketplaceDeployEnv() {
  const env = {
    MARKETPLACE_ROYALTY_BPS: '369',
  };
  const configuredRecipient = readEnv('MARKETPLACE_ROYALTY_RECIPIENT');
  if (configuredRecipient) {
    env.MARKETPLACE_ROYALTY_RECIPIENT = configuredRecipient;
  }
  return env;
}

function getEffectivePaymasterDepositEth() {
  const configured = readEnv('PAYMASTER_DEPOSIT');
  if (!configured) {
    return DEFAULT_MIN_PAYMASTER_DEPOSIT;
  }

  const configuredWei = ethers.parseEther(configured);
  const minimumWei = ethers.parseEther(DEFAULT_MIN_PAYMASTER_DEPOSIT);
  return configuredWei >= minimumWei ? configured : DEFAULT_MIN_PAYMASTER_DEPOSIT;
}

function createCommandList() {
  return [
    { label: 'hardhat compile', command: 'npx', args: ['hardhat', 'compile'] },
    { label: 'hardhat test', command: 'npx', args: ['hardhat', 'test'] },
    { label: 'npm test', command: 'npm', args: ['test'] },
    {
      label: 'deploy stark',
      command: 'node',
      args: ['scripts/deploy_stark.mjs'],
      env: getDeployStarkEnv(),
    },
    {
      label: 'deploy 4337',
      command: 'node',
      args: ['scripts/deploy_4337.mjs'],
      env: getDeploy4337Env(),
    },
    {
      label: 'deploy marketplace',
      command: 'node',
      args: ['scripts/deploy_marketplace.mjs'],
      env: getMarketplaceDeployEnv(),
    },
    {
      label: 'verify bindings',
      command: 'npm',
      args: ['run', 'verify:sepolia'],
    },
  ];
}

async function runCommand(step, extraEnv = {}) {
  const env = {
    ...process.env,
    ...extraEnv,
    ...(step.env || {}),
  };

  return new Promise((resolve, reject) => {
    const child = spawn(step.command, step.args, {
      cwd: REPO_ROOT,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
      setTimeout(() => child.kill('SIGKILL'), 5_000).unref();
    }, step.timeoutMs || COMMAND_TIMEOUT_MS);

    const prefix = `[${step.label}] `;
    child.stdout.on('data', (chunk) => {
      process.stdout.write(prefix + chunk.toString().replace(/\n/g, `\n${prefix}`).replace(new RegExp(`${prefix}$`), ''));
    });
    child.stderr.on('data', (chunk) => {
      process.stderr.write(prefix + chunk.toString().replace(/\n/g, `\n${prefix}`).replace(new RegExp(`${prefix}$`), ''));
    });

    child.on('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });

    child.on('close', (code, signal) => {
      clearTimeout(timeout);
      if (timedOut) {
        reject(new Error(`${step.label} timed out after ${(step.timeoutMs || COMMAND_TIMEOUT_MS)}ms.`));
        return;
      }
      if (code !== 0) {
        reject(
          new Error(
            `${step.label} failed with exit code ${code}${signal ? ` (signal ${signal})` : ''}.`
          )
        );
        return;
      }
      resolve();
    });
  });
}

async function fetchJson(url, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs || HTTP_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
      headers: {
        'content-type': 'application/json',
        ...(options.headers || {}),
      },
    });
    const text = await response.text();
    let body = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = text;
    }
    return { response, body };
  } finally {
    clearTimeout(timeout);
  }
}

async function waitForBackendReady(baseUrl, child) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < BACKEND_START_TIMEOUT_MS) {
    if (child.exitCode != null) {
      throw new Error(`Backend exited early with code ${child.exitCode}.`);
    }
    try {
      const { response } = await fetchJson(`${baseUrl}/status`, {
        method: 'GET',
        headers: {},
      });
      if (response.ok) {
        return;
      }
    } catch {
      // Keep polling until timeout.
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error(`Timed out waiting for backend /status after ${BACKEND_START_TIMEOUT_MS}ms.`);
}

async function startBackend(runtimeEnv) {
  const child = spawn('node', ['dist/index.js'], {
    cwd: path.join(REPO_ROOT, 'server-ts'),
    env: runtimeEnv,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  child.stdout.on('data', (chunk) => {
    process.stdout.write(`[backend] ${chunk.toString().replace(/\n/g, '\n[backend] ').replace(/\[backend\] $/, '')}`);
  });
  child.stderr.on('data', (chunk) => {
    process.stderr.write(`[backend] ${chunk.toString().replace(/\n/g, '\n[backend] ').replace(/\[backend\] $/, '')}`);
  });

  const host = runtimeEnv.HOST || '127.0.0.1';
  const port = runtimeEnv.PORT || '8788';
  const baseUrl = `http://${host}:${port}`;
  await waitForBackendReady(baseUrl, child);
  return { child, baseUrl };
}

async function stopChild(child) {
  if (!child || child.exitCode != null) {
    return;
  }
  child.kill('SIGTERM');
  await new Promise((resolve) => {
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      resolve();
    }, 5_000);
    child.once('close', () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

function readJson(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Required file not found: ${filePath}`);
  }
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

async function requestAuthToken(baseUrl, recipient, wallet) {
  const challenge = await fetchJson(`${baseUrl}/auth/challenge`, {
    method: 'POST',
    body: JSON.stringify({ recipient }),
  });
  if (!challenge.response.ok || !challenge.body?.message || !challenge.body?.nonce) {
    throw new Error(`auth/challenge failed: ${JSON.stringify(challenge.body)}`);
  }

  const signature = await wallet.signMessage(challenge.body.message);
  const verify = await fetchJson(`${baseUrl}/auth/verify`, {
    method: 'POST',
    body: JSON.stringify({
      recipient,
      nonce: challenge.body.nonce,
      signature,
    }),
  });
  if (!verify.response.ok || !verify.body?.token) {
    throw new Error(`auth/verify failed: ${JSON.stringify(verify.body)}`);
  }

  return verify.body.token;
}

async function requestMintProof(baseUrl, token, body) {
  const result = await fetchJson(`${baseUrl}/request-mint`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });
  if (!result.response.ok || !result.body?.success) {
    throw new Error(`request-mint failed: ${JSON.stringify(result.body)}`);
  }
  return result.body;
}

async function requestPaymaster(baseUrl, token, proofId, userOp) {
  const result = await fetchJson(`${baseUrl}/sign-paymaster`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ proofId, userOp }),
  });
  if (!result.response.ok || !result.body?.success || !result.body?.paymasterAndData) {
    throw new Error(`sign-paymaster failed: ${JSON.stringify(result.body)}`);
  }
  return result.body;
}

function extractMintEvent(receipt, mintInterface) {
  for (const log of receipt.logs || []) {
    try {
      const parsed = mintInterface.parseLog(log);
      if (parsed && parsed.name === 'PhilMinted') {
        return parsed;
      }
    } catch {
      // Ignore non-matching logs.
    }
  }
  return null;
}

async function mintOneToken({
  provider,
  wallet,
  baseUrl,
  starkDeployment,
  aaDeployment,
}) {
  const recipient = await wallet.getAddress();
  const token = await requestAuthToken(baseUrl, recipient, wallet);

  const factoryAddress = ethers.getAddress(aaDeployment.PhilAccountFactory);
  const mintAddress = ethers.getAddress(starkDeployment.PhilTestMint);
  const paymasterAddress = ethers.getAddress(aaDeployment.PhilPaymaster);
  const starkPubKeyX = frontendTestStarkPubKeyX(SEPOLIA_CHAIN_ID, recipient);

  const factory = new ethers.Contract(
    factoryAddress,
    [
      'function getPhilAddress(address owner, uint256 starkPubKeyX) view returns (address)',
      'function computeCreateActionHash(address owner, uint256 starkPubKeyX) view returns (bytes32)',
    ],
    provider
  );

  const smartAccount = ethers.getAddress(
    String(await factory.getPhilAddress(recipient, starkPubKeyX))
  );
  const smartAccountCode = await provider.getCode(smartAccount);
  const isDeployed = smartAccountCode !== '0x';

  let createProof = null;
  if (!isDeployed) {
    const actionHash = String(await factory.computeCreateActionHash(recipient, starkPubKeyX));
    const actionResponse = await requestMintProof(baseUrl, token, {
      kind: 'action',
      recipient,
      expiry: Math.floor(Date.now() / 1000) + 900,
      actionType: 2,
      actionHash,
    });
    createProof = actionResponse.proof;
  }

  const mintResponse = await requestMintProof(baseUrl, token, {
    recipient,
    philId: 0,
    paletteVariant: 0,
    mixMode: 0,
    mixSeed: 0,
  });

  const unsignedUserOp = await buildMintUserOp({
    ethers,
    smartAccount,
    factoryAddress,
    isDeployed,
    eoa: recipient,
    starkPubKeyX,
    philTestMint: mintAddress,
    createProof,
    mintParams: {
      recipient,
      philId: 0,
      paletteVariant: 0,
      mixMode: 0,
      mixSeed: 0,
      proof: mintResponse.proof,
    },
    paymasterAndData: '0x',
    provider,
  });

  const paymasterResponse = await requestPaymaster(
    baseUrl,
    token,
    mintResponse.proofId,
    unsignedUserOp
  );

  const sponsoredUserOp = {
    ...unsignedUserOp,
    paymasterAndData: paymasterResponse.paymasterAndData,
  };
  const userOpHash = getUserOpHash(ethers, sponsoredUserOp, BigInt(SEPOLIA_CHAIN_ID));
  const signature = await signUserOp({
    ethers,
    userOpHash,
    eoaSigner: wallet,
  });
  const signedUserOp = {
    ...sponsoredUserOp,
    signature,
  };

  const entryPoint = new ethers.Contract(
    ENTRY_POINT_V07,
    [
      'function handleOps((address sender,uint256 nonce,bytes initCode,bytes callData,bytes32 accountGasLimits,uint256 preVerificationGas,bytes32 gasFees,bytes paymasterAndData,bytes signature)[] ops, address payable beneficiary) external',
    ],
    wallet
  );

  const tx = await entryPoint.handleOps([signedUserOp], recipient, {
    gasLimit: 5_000_000n,
  });
  logTx('Mint via EntryPoint.handleOps', tx.hash, SEPOLIA_CHAIN_ID);
  const receipt = await waitForReceiptWithTimeout(provider, tx.hash);

  const mintInterface = new ethers.Interface([
    'event PhilMinted(uint256 indexed tokenId, address indexed recipient, uint8 philId, uint8 paletteVariant, uint8 mixMode, uint32 mixSeed)',
    'function tokenURI(uint256 tokenId) view returns (string)',
  ]);
  const mintEvent = extractMintEvent(receipt, mintInterface);
  if (!mintEvent) {
    throw new Error(`Mint transaction mined but PhilMinted event was not found in ${tx.hash}`);
  }

  const tokenId = mintEvent.args.tokenId;
  const mintContract = new ethers.Contract(mintAddress, mintInterface, provider);
  const tokenURI = await mintContract.tokenURI.staticCall(tokenId, { gasLimit: 30_000_000n });
  if (tokenURI.includes('web3://')) {
    throw new Error('tokenURI unexpectedly contains web3:// after mint.');
  }

  return {
    txHash: tx.hash,
    tokenId: tokenId.toString(),
    tokenURI,
    smartAccount,
    paymasterAddress,
  };
}

async function ensurePaymasterDeposit({ provider, wallet, paymasterAddress }) {
  const minDeposit = ethers.parseEther(getEffectivePaymasterDepositEth());
  const entryPoint = new ethers.Contract(
    ENTRY_POINT_V07,
    ['function balanceOf(address account) view returns (uint256)'],
    provider
  );
  const currentBalance = await entryPoint.balanceOf(paymasterAddress);
  console.log(
    `Current paymaster deposit: ${ethers.formatEther(currentBalance)} ETH (minimum ${ethers.formatEther(minDeposit)} ETH)`
  );

  if (currentBalance >= minDeposit) {
    return currentBalance;
  }

  const topUpAmount = minDeposit - currentBalance;
  console.log(`Topping up paymaster by ${ethers.formatEther(topUpAmount)} ETH...`);
  const paymaster = new ethers.Contract(
    paymasterAddress,
    ['function deposit() payable'],
    wallet
  );
  const tx = await paymaster.deposit({ value: topUpAmount });
  logTx('Top up paymaster deposit', tx.hash, SEPOLIA_CHAIN_ID);
  await waitForReceiptWithTimeout(provider, tx.hash);

  const updatedBalance = await entryPoint.balanceOf(paymasterAddress);
  console.log(`Updated paymaster deposit: ${ethers.formatEther(updatedBalance)} ETH`);
  return updatedBalance;
}

function ensureFileExists(filePath, label) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`${label} manifest is missing: ${filePath}`);
  }
}

async function main() {
  loadEnv();

  const requiredEnv = [
    'RPC_URL',
    'CHAIN_ID',
    'PRIVATE_KEY',
    'ALLOWLIST_SIGNER_KEY',
    'PAYMASTER_SIGNER_KEY',
    'ALLOWLIST_MODE',
    'ALLOWLIST_SINGLE_ADDRESS',
    'PROGRAM_HASH',
    'DROP_ID',
    'STARKNET_CORE',
    'L2_UNLOCK_VERIFIER',
  ];
  for (const name of requiredEnv) {
    requireEnv(name);
  }

  const configuredChainId = Number(requireEnv('CHAIN_ID'));
  if (!Number.isInteger(configuredChainId) || configuredChainId !== SEPOLIA_CHAIN_ID) {
    throw new Error(`CHAIN_ID must be ${SEPOLIA_CHAIN_ID} for this orchestrator.`);
  }

  if (readEnv('ALLOWLIST_MODE').toLowerCase() !== 'single_address') {
    throw new Error('This orchestrator requires ALLOWLIST_MODE=single_address.');
  }

  const provider = new ethers.JsonRpcProvider(readEnv('RPC_URL'));
  const wallet = new ethers.Wallet(requireEnv('PRIVATE_KEY'), provider);
  const deployerAddress = await wallet.getAddress();
  const allowlistSignerAddress = new ethers.Wallet(requireEnv('ALLOWLIST_SIGNER_KEY')).address;
  const paymasterSignerAddress = new ethers.Wallet(requireEnv('PAYMASTER_SIGNER_KEY')).address;
  const allowlistSingleAddress = ethers.getAddress(requireEnv('ALLOWLIST_SINGLE_ADDRESS'));

  console.log('Sepolia Orchestrator Preflight');
  console.log(`  Deployer: ${deployerAddress}`);
  console.log(`  Allowlist Signer: ${allowlistSignerAddress}`);
  console.log(`  Paymaster Signer: ${paymasterSignerAddress}`);
  console.log(`  Allowlist Single Address: ${allowlistSingleAddress}`);

  if (allowlistSingleAddress.toLowerCase() !== deployerAddress.toLowerCase()) {
    throw new Error(
      'ALLOWLIST_SINGLE_ADDRESS must match the PRIVATE_KEY deployer address for the end-to-end mint step.'
    );
  }

  const network = await provider.getNetwork();
  const connectedChainId = Number(network.chainId);
  if (connectedChainId !== SEPOLIA_CHAIN_ID) {
    throw new Error(
      `RPC chain mismatch. Connected chainId=${connectedChainId}, expected ${SEPOLIA_CHAIN_ID}.`
    );
  }
  const balance = await provider.getBalance(deployerAddress);
  console.log(`  RPC Chain ID: ${connectedChainId}`);
  console.log(`  Deployer Balance: ${ethers.formatEther(balance)} ETH`);

  const commandList = createCommandList();

  if (isTruthy(process.env.DRY_RUN)) {
    console.log('DRY_RUN=1 set. No transactions will be broadcast.');
    console.log('Planned commands:');
    for (const step of commandList) {
      console.log(`  ${step.command} ${step.args.join(' ')}`);
    }
    console.log('Planned backend step: npm --prefix server-ts run build && node server-ts/dist/index.js');
    console.log('Planned mint step: auth -> request-mint -> sign-paymaster -> EntryPoint.handleOps');
    return;
  }

  for (const step of commandList) {
    console.log(`\n==> ${step.label}`);
    await runCommand(step);
  }

  const deploymentsDir = path.join(REPO_ROOT, 'deployments');
  const starkPath = path.join(deploymentsDir, 'stark_11155111.json');
  const aaPath = path.join(deploymentsDir, '4337_11155111.json');
  const marketplacePath = path.join(deploymentsDir, 'marketplace_11155111.json');
  ensureFileExists(starkPath, 'stark');
  ensureFileExists(aaPath, '4337');
  ensureFileExists(marketplacePath, 'marketplace');

  const starkDeployment = readJson(starkPath);
  const aaDeployment = readJson(aaPath);
  const marketplaceDeployment = readJson(marketplacePath);

  console.log('\n==> paymaster preflight');
  await ensurePaymasterDeposit({
    provider,
    wallet,
    paymasterAddress: ethers.getAddress(aaDeployment.PhilPaymaster),
  });

  console.log('\n==> backend build');
  await runCommand({
    label: 'backend build',
    command: 'npm',
    args: ['--prefix', 'server-ts', 'run', 'build'],
  });

  const tempDbPath = path.join(os.tmpdir(), `phil-test13-sepolia-${Date.now()}.db`);
  const backendEnv = {
    ...process.env,
    HOST: '127.0.0.1',
    PORT: '8788',
    NODE_ENV: 'production',
    DATABASE_PATH: tempDbPath,
    PROOF_GATE: String(starkDeployment.ProofGateTest13 || starkDeployment.ProofGate),
    PHIL_TEST_MINT: String(starkDeployment.PhilTestMint),
    PHIL_ACCOUNT_FACTORY: String(aaDeployment.PhilAccountFactory),
    PHIL_PAYMASTER: String(aaDeployment.PhilPaymaster),
  };

  let backend = null;
  try {
    console.log('\n==> backend start');
    backend = await startBackend(backendEnv);

    console.log('\n==> mint one');
    const mintResult = await mintOneToken({
      provider,
      wallet,
      baseUrl: backend.baseUrl,
      starkDeployment,
      aaDeployment,
    });

    const mintUrl = getTxUrl(SEPOLIA_CHAIN_ID, mintResult.txHash);
    const marketplaceUrl = getAddressUrl(SEPOLIA_CHAIN_ID, marketplaceDeployment.PhilMarketplace);
    const philTestMintUrl = getAddressUrl(SEPOLIA_CHAIN_ID, starkDeployment.PhilTestMint);

    console.log('\nFINAL SUMMARY');
    console.log('Stark Stack:');
    console.log(`  PhilSVGStorage: ${starkDeployment.PhilSVGStorage}`);
    console.log(`  PhilLayerRegistry: ${starkDeployment.PhilLayerRegistry}`);
    if (starkDeployment.PhilNFT) {
      console.log(`  PhilNFT: ${starkDeployment.PhilNFT}`);
    }
    console.log(`  PhilRenderer: ${starkDeployment.PhilRenderer}`);
    console.log(`  PhilWeb3: ${starkDeployment.PhilWeb3}`);
    console.log(`  ProofGateTest13: ${starkDeployment.ProofGateTest13 || starkDeployment.ProofGate}`);
    console.log(`  PhilTestMint: ${starkDeployment.PhilTestMint}`);
    console.log('4337 Stack:');
    console.log(`  EntryPoint: ${aaDeployment.EntryPoint}`);
    console.log(`  PhilAccountImpl: ${aaDeployment.PhilAccountImpl}`);
    console.log(`  PhilUnlockInbox: ${aaDeployment.PhilUnlockInbox}`);
    console.log(`  PhilAccountFactory: ${aaDeployment.PhilAccountFactory}`);
    console.log(`  PhilPaymaster: ${aaDeployment.PhilPaymaster}`);
    console.log('Marketplace:');
    console.log(`  PhilMarketplace: ${marketplaceDeployment.PhilMarketplace}`);
    console.log(`  Royalty Recipient: ${marketplaceDeployment.royaltyRecipient}`);
    console.log(`  Royalty BPS: ${marketplaceDeployment.royaltyBps}`);
    console.log('Mint:');
    console.log(`  tx hash: ${mintResult.txHash}`);
    if (mintUrl) {
      console.log(`  Etherscan: ${mintUrl}`);
    }
    console.log(`  tokenId: ${mintResult.tokenId}`);
    console.log(`  smartAccount: ${mintResult.smartAccount}`);
    console.log(`  tokenURI snippet: ${mintResult.tokenURI.slice(0, 160)}...`);
    console.log('Explorer Links:');
    if (mintUrl) {
      console.log(`  Mint TX: ${mintUrl}`);
    }
    if (marketplaceUrl) {
      console.log(`  Marketplace: ${marketplaceUrl}`);
    }
    if (philTestMintUrl) {
      console.log(`  PhilTestMint: ${philTestMintUrl}`);
    }
    console.log('Artifacts:');
    console.log(`  ${starkPath}`);
    console.log(`  ${aaPath}`);
    console.log(`  ${marketplacePath}`);
    console.log(`Backend URL: ${backend.baseUrl}`);
  } finally {
    await stopChild(backend?.child);
  }
}

main().catch((error) => {
  console.error(`ERROR: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
