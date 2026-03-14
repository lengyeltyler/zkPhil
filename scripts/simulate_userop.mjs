#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { ethers } from 'ethers';
import {
  buildMintUserOp,
  encodeExecuteCalldata,
  encodeMintCalldata,
  getUserOpHash,
  signUserOp,
} from '../frontend/userop.js';
import {
  ACTION_ACCOUNT_CREATE,
} from '../shared/proof/localStarkProver.mjs';

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_CHAIN_ID = 31337;
const DEFAULT_RPC_URL = 'http://127.0.0.1:18545';
const DEFAULT_SERVER_URL = 'http://127.0.0.1:18787';
const LOCAL_MNEMONIC = 'test test test test test test test test test test test junk';
const PROGRAM_HASH = process.env.PROGRAM_HASH ||
  '0x4444444444444444444444444444444444444444444444444444444444444444';
const DROP_ID = process.env.DROP_ID || '13';
const ADMIN_KEY = process.env.ADMIN_KEY || 'local-admin-key';

const RPC_URL = (process.env.RPC_URL || DEFAULT_RPC_URL).trim();
const SERVER_URL = (process.env.SERVER_URL || DEFAULT_SERVER_URL).replace(/\/+$/, '');
const CHAIN_ID = Number(process.env.CHAIN_ID || String(DEFAULT_CHAIN_ID));

const PHIL_ACCOUNT_ABI = [
  'function entryPoint() view returns (address)',
  'function isOwner(address owner) view returns (bool)',
];

const FACTORY_ABI = [
  'function createPhilAccount(address owner, uint256 starkPubKeyX, (uint256 expiry, bytes32 factHash, bytes signature) proof) returns (address)',
  'function getPhilAddress(address owner, uint256 starkPubKeyX) view returns (address)',
  'function computeCreateActionHash(address owner, uint256 starkPubKeyX) view returns (bytes32)',
];

const MINT_ABI = [
  'function mint(address recipient, address mintTo, uint8 philId, uint8 paletteVariant, uint8 mixMode, uint32 mixSeed, (uint256 expiry, bytes32 factHash, bytes signature) proof)',
  'function totalSupply() view returns (uint256)',
  'function ownerOf(uint256 tokenId) view returns (address)',
];

const ENTRY_POINT_ABI = [
  'function simulateValidation(tuple(address sender, uint256 nonce, bytes initCode, bytes callData, bytes32 accountGasLimits, uint256 preVerificationGas, bytes32 gasFees, bytes paymasterAndData, bytes signature) userOp) returns (uint256 accountValidationData, uint256 paymasterValidationData)',
  'function handleOps(tuple(address sender, uint256 nonce, bytes initCode, bytes callData, bytes32 accountGasLimits, uint256 preVerificationGas, bytes32 gasFees, bytes paymasterAndData, bytes signature)[] ops, address payable beneficiary) external',
];

function parsePort(url) {
  return Number(new URL(url).port);
}

function loadJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function deterministicStarkPubKeyX(chainId, eoa) {
  const hash = ethers.solidityPackedKeccak256(
    ['string', 'uint256', 'address'],
    ['phil-test-mode-stark-pubkey', BigInt(chainId), ethers.getAddress(eoa)]
  );
  return ethers.toBeHex(BigInt(hash), 32);
}

function deriveWallet(index, provider) {
  const wallet = ethers.HDNodeWallet.fromPhrase(
    LOCAL_MNEMONIC,
    undefined,
    `m/44'/60'/0'/0/${index}`
  );
  return provider ? wallet.connect(provider) : wallet;
}

async function fetchJson(url, options) {
  const res = await fetch(url, options);
  const data = await res.json().catch(() => null);
  return { ok: res.ok, status: res.status, data };
}

async function waitForRpc(url, expectedChainId, retries = 90) {
  const provider = new ethers.JsonRpcProvider(url);
  for (let attempt = 0; attempt < retries; attempt += 1) {
    try {
      const network = await provider.getNetwork();
      const actualChainId = Number(network.chainId);
      if (actualChainId !== expectedChainId) {
        throw new Error(`expected chainId ${expectedChainId}, got ${actualChainId}`);
      }
      return;
    } catch {
      // retry
    }
    await sleep(1000);
  }
  throw new Error(`RPC did not come up at ${url}`);
}

async function waitForServer(url, retries = 90) {
  for (let attempt = 0; attempt < retries; attempt += 1) {
    try {
      const res = await fetch(`${url}/health`);
      if (res.ok) {
        return;
      }
    } catch {
      // retry
    }
    await sleep(1000);
  }
  throw new Error(`Server did not come up at ${url}`);
}

function spawnManaged(command, args, options) {
  const proc = spawn(command, args, {
    cwd: options.cwd,
    env: options.env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const stdout = [];
  const stderr = [];
  proc.stdout.on('data', (chunk) => stdout.push(chunk.toString('utf8')));
  proc.stderr.on('data', (chunk) => stderr.push(chunk.toString('utf8')));

  return {
    proc,
    getOutput() {
      return `${stdout.join('')}${stderr.join('')}`;
    },
    async stop() {
      if (proc.exitCode != null || proc.killed) {
        return;
      }
      proc.kill('SIGTERM');
      await sleep(300);
      if (proc.exitCode == null && !proc.killed) {
        proc.kill('SIGKILL');
      }
    },
  };
}

async function runCommand(command, args, options) {
  const child = spawnManaged(command, args, options);
  const exitCode = await new Promise((resolve, reject) => {
    child.proc.on('error', reject);
    child.proc.on('close', resolve);
  });

  if (exitCode !== 0) {
    const output = child.getOutput().trim();
    throw new Error(
      `${options.label} failed with exit code ${exitCode}\n${output || '(no output)'}`
    );
  }

  return child.getOutput();
}

function backupFile(filePath) {
  if (!fs.existsSync(filePath)) {
    return { filePath, existed: false, contents: null };
  }

  return {
    filePath,
    existed: true,
    contents: fs.readFileSync(filePath),
  };
}

function restoreFile(backup) {
  if (backup.existed) {
    fs.writeFileSync(backup.filePath, backup.contents);
    return;
  }

  if (fs.existsSync(backup.filePath)) {
    fs.rmSync(backup.filePath);
  }
}

async function startHardhatNode(tempDir) {
  const hardhatBin = path.join(ROOT_DIR, 'node_modules', '.bin', 'hardhat');
  if (!fs.existsSync(hardhatBin)) {
    throw new Error('Hardhat binary not found at node_modules/.bin/hardhat');
  }

  const node = spawnManaged(
    hardhatBin,
    [
      'node',
      '--hostname',
      '127.0.0.1',
      '--port',
      String(parsePort(RPC_URL)),
    ],
    {
      cwd: ROOT_DIR,
      env: process.env,
      logFile: path.join(tempDir, 'hardhat-node.log'),
    }
  );

  try {
    await waitForRpc(RPC_URL, CHAIN_ID, 120);
    return node;
  } catch (error) {
    await node.stop();
    throw new Error(
      `Failed to start Hardhat node: ${error instanceof Error ? error.message : String(error)}\n${node.getOutput()}`
    );
  }
}

async function startServer(tempDir, env) {
  const distEntry = path.join(ROOT_DIR, 'server-ts', 'dist', 'index.js');
  if (!fs.existsSync(distEntry)) {
    throw new Error(
      'Missing server-ts/dist/index.js. Run `cd server-ts && npm run build` before simulate_userop.'
    );
  }

  const server = spawnManaged(
    process.execPath,
    ['dist/index.js'],
    {
      cwd: path.join(ROOT_DIR, 'server-ts'),
      env,
      logFile: path.join(tempDir, 'server.log'),
    }
  );

  try {
    await waitForServer(SERVER_URL, 120);
    return server;
  } catch (error) {
    await server.stop();
    throw new Error(
      `Failed to start server: ${error instanceof Error ? error.message : String(error)}\n${server.getOutput()}`
    );
  }
}

async function createAuthToken(recipientWallet) {
  const challengeRes = await fetchJson(`${SERVER_URL}/auth/challenge`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      recipient: recipientWallet.address,
    }),
  });

  if (!challengeRes.ok || !challengeRes.data?.message || !challengeRes.data?.nonce) {
    throw new Error(
      `/auth/challenge failed: ${challengeRes.data?.error || `HTTP ${challengeRes.status}`}`
    );
  }

  const verifyRes = await fetchJson(`${SERVER_URL}/auth/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      recipient: recipientWallet.address,
      nonce: challengeRes.data.nonce,
      signature: await recipientWallet.signMessage(challengeRes.data.message),
    }),
  });

  if (!verifyRes.ok || !verifyRes.data?.token) {
    throw new Error(
      `/auth/verify failed: ${verifyRes.data?.error || `HTTP ${verifyRes.status}`}`
    );
  }

  return verifyRes.data.token;
}

async function requestProof(token, recipient, body) {
  if (body.kind === 'action' && Number(body.actionType) !== ACTION_ACCOUNT_CREATE) {
    throw new Error(
      'Only ACTION_ACCOUNT_CREATE (2) is supported. Execution approvals are unlock-ticket-only.'
    );
  }

  const res = await fetchJson(`${SERVER_URL}/request-mint`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      recipient,
      ...body,
    }),
  });

  if (!res.ok || !res.data?.success) {
    throw new Error(
      `/request-mint failed: ${res.data?.code || res.status} ${res.data?.error || 'unknown'}`
    );
  }

  return res.data;
}

async function requestPaymaster(token, proofId, userOp) {
  const res = await fetchJson(`${SERVER_URL}/sign-paymaster`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      proofId,
      userOp: {
        sender: userOp.sender,
        nonce: userOp.nonce,
        initCode: userOp.initCode,
        callData: userOp.callData,
        accountGasLimits: userOp.accountGasLimits,
        preVerificationGas: userOp.preVerificationGas,
        gasFees: userOp.gasFees,
      },
    }),
  });

  return res;
}

function assertApiFailure(response, expectedCode, label) {
  assert(!response.ok, `${label} unexpectedly succeeded`);
  assert(
    response.data?.code === expectedCode,
    `${label} expected code ${expectedCode}, got ${response.data?.code || response.status}`
  );
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function main() {
  if (!Number.isInteger(CHAIN_ID) || CHAIN_ID !== DEFAULT_CHAIN_ID) {
    throw new Error(`simulate_userop is local-only. Expected CHAIN_ID=${DEFAULT_CHAIN_ID}.`);
  }

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'phil-simulate-userop-'));
  const deploymentsDir = path.join(ROOT_DIR, 'deployments');
  const starkDeploymentPath = path.join(deploymentsDir, `stark_${CHAIN_ID}.json`);
  const aaDeploymentPath = path.join(deploymentsDir, `4337_${CHAIN_ID}.json`);
  const backups = [backupFile(starkDeploymentPath), backupFile(aaDeploymentPath)];

  const deployerWallet = deriveWallet(0);
  const recipientWallet = deriveWallet(1);
  const allowlistSignerWallet = deployerWallet;
  const paymasterSignerWallet = deriveWallet(3);

  const databasePath = path.join(tempDir, 'phil_test13.db');

  const hardhatNode = await startHardhatNode(tempDir);
  let server = null;

  try {
    await runCommand(process.execPath, ['scripts/deploy_stark.mjs'], {
      cwd: ROOT_DIR,
      env: {
        ...process.env,
        RPC_URL,
        CHAIN_ID: String(CHAIN_ID),
        PRIVATE_KEY: deployerWallet.privateKey,
        PROGRAM_HASH,
        DROP_ID,
        ALLOWLIST_SIGNER: allowlistSignerWallet.address,
        MOCK_SATELLITE: 'true',
        SKIP_FRAGMENT_BUILD: 'true',
      },
      label: 'deploy_stark.mjs',
    });

    await runCommand(process.execPath, ['scripts/deploy_4337.mjs'], {
      cwd: ROOT_DIR,
      env: {
        ...process.env,
        RPC_URL,
        CHAIN_ID: String(CHAIN_ID),
        PRIVATE_KEY: deployerWallet.privateKey,
        PAYMASTER_SIGNER_KEY: paymasterSignerWallet.privateKey,
        MOCK_UNLOCK_INBOX: 'true',
        PAYMASTER_DEPOSIT: '0.001',
      },
      label: 'deploy_4337.mjs',
    });

    const starkDeployment = loadJson(starkDeploymentPath);
    const aaDeployment = loadJson(aaDeploymentPath);
    const provider = new ethers.JsonRpcProvider(RPC_URL);
    const recipientSigner = recipientWallet.connect(provider);
    const eoa = ethers.getAddress(await recipientSigner.getAddress());

    server = await startServer(tempDir, {
      ...process.env,
      PORT: String(parsePort(SERVER_URL)),
      HOST: '127.0.0.1',
      RPC_URL,
      CHAIN_ID: String(CHAIN_ID),
      DROP_ID,
      PROGRAM_HASH,
      ADMIN_KEY,
      DATABASE_PATH: databasePath,
      ALLOWLIST_SIGNER_KEY: allowlistSignerWallet.privateKey,
      PAYMASTER_SIGNER_KEY: paymasterSignerWallet.privateKey,
      PHIL_TEST_MINT: starkDeployment.PhilTestMint,
      PHIL_ACCOUNT_FACTORY: aaDeployment.PhilAccountFactory,
      PHIL_PAYMASTER: aaDeployment.PhilPaymaster,
      PROOF_GATE: starkDeployment.ProofGateTest13 || starkDeployment.ProofGate,
      ALLOWLIST_MODE: 'single_address',
      ALLOWLIST_SINGLE_ADDRESS: eoa,
      ALLOWLIST_SLOTS_PER_DROP: '2',
      UNSAFE_DEV_ALLOWLIST: 'false',
      UNSAFE_NONLOOPBACK_OK: 'false',
      ALLOW_LOOPBACK_ORIGINS: 'true',
    });

    const starkPubKeyX = deterministicStarkPubKeyX(CHAIN_ID, eoa);
    const factory = new ethers.Contract(aaDeployment.PhilAccountFactory, FACTORY_ABI, provider);
    const mint = new ethers.Contract(starkDeployment.PhilTestMint, MINT_ABI, provider);
    const entryPoint = new ethers.Contract(aaDeployment.EntryPoint, ENTRY_POINT_ABI, recipientSigner);
    const deployerSigner = new ethers.NonceManager(deployerWallet.connect(provider));

    const accountRes = await fetchJson(`${SERVER_URL}/compute-account`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        eoa,
        starkPubKeyX,
      }),
    });
    if (!accountRes.ok || !accountRes.data?.success || !accountRes.data.smartAccount) {
      throw new Error(
        `/compute-account failed: ${accountRes.data?.error || `HTTP ${accountRes.status}`}`
      );
    }

    const smartAccount = ethers.getAddress(accountRes.data.smartAccount);
    const expectedSender = await factory.getPhilAddress(eoa, starkPubKeyX);
    assert(
      smartAccount.toLowerCase() === expectedSender.toLowerCase(),
      `compute-account mismatch: backend=${smartAccount} local=${expectedSender}`
    );
    await (await deployerSigner.sendTransaction({
      to: smartAccount,
      value: ethers.parseEther('0.05'),
    })).wait();

    const token = await createAuthToken(recipientWallet);

    const eligibilityRes = await fetchJson(
      `${SERVER_URL}/eligibility?address=${encodeURIComponent(eoa)}`
    );
    if (!eligibilityRes.ok || !eligibilityRes.data?.eligible) {
      throw new Error(`Selected signer ${eoa} is not currently eligible to mint`);
    }

    const preSupply = await mint.totalSupply();
    const philId = Number(preSupply % 6n);
    const paletteVariant = Number(preSupply % 9n);
    const mixMode = 0;
    const mixSeed = 0;

    const mintProofResponse = await requestProof(token, eoa, {
      kind: 'mint',
      philId,
      paletteVariant,
      mixMode,
      mixSeed,
    });
    assert(
      mintProofResponse.mintToComputed &&
        ethers.getAddress(mintProofResponse.mintToComputed).toLowerCase() === smartAccount.toLowerCase(),
      `request-mint returned unexpected mintToComputed: ${mintProofResponse.mintToComputed}`
    );
    assert(
      typeof mintProofResponse.proofId === 'string' && mintProofResponse.proofId.length > 0,
      'request-mint did not return proofId'
    );

    const preCode = await provider.getCode(smartAccount);
    const isDeployed = preCode !== '0x';

    let createProof = null;
    if (!isDeployed) {
      const createActionHash =
        accountRes.data.createActionHash ||
        await factory.computeCreateActionHash(eoa, starkPubKeyX);
      const createExpiry = BigInt(Math.floor(Date.now() / 1000) + 900);
      const createProofResponse = await requestProof(token, eoa, {
        kind: 'action',
        actionType: ACTION_ACCOUNT_CREATE,
        actionHash: createActionHash,
        expiry: createExpiry.toString(),
      });
      createProof = createProofResponse.proof;
    }

    await mint.mint.staticCall(
      eoa,
      smartAccount,
      philId,
      paletteVariant,
      mixMode,
      mixSeed,
      mintProofResponse.proof
    );

    const userOp = await buildMintUserOp({
      ethers,
      smartAccount,
      factoryAddress: aaDeployment.PhilAccountFactory,
      isDeployed,
      eoa,
      starkPubKeyX,
      philTestMint: starkDeployment.PhilTestMint,
      createProof,
      mintParams: {
        recipient: eoa,
        mintTo: mintProofResponse.mintToComputed,
        philId,
        paletteVariant,
        mixMode,
        mixSeed,
        proof: mintProofResponse.proof,
      },
      paymasterAndData: '0x',
      provider,
      entryPointAddress: aaDeployment.EntryPoint,
    });

    if (!isDeployed) {
      assert(
        typeof userOp.initCode === 'string' && userOp.initCode !== '0x',
        'Expected initCode for first UserOp deployment'
      );
      const initCodeFactory = ethers.getAddress(ethers.dataSlice(userOp.initCode, 0, 20));
      assert(
        initCodeFactory === ethers.getAddress(aaDeployment.PhilAccountFactory),
        `initCode factory mismatch: ${initCodeFactory} != ${aaDeployment.PhilAccountFactory}`
      );
      const initCodeCallData = ethers.hexlify(ethers.dataSlice(userOp.initCode, 20));
      const decodedInit = factory.interface.decodeFunctionData('createPhilAccount', initCodeCallData);
      const initOwner = ethers.getAddress(String(decodedInit[0]));
      const initStarkPubKeyX = ethers.toBeHex(BigInt(decodedInit[1].toString()), 32);
      assert(initOwner === eoa, `initCode owner mismatch: ${initOwner} != ${eoa}`);
      assert(
        initStarkPubKeyX.toLowerCase() === starkPubKeyX.toLowerCase(),
        `initCode starkPubKeyX mismatch: ${initStarkPubKeyX} != ${starkPubKeyX}`
      );
      const initCodeSender = ethers.getAddress(
        await factory.getPhilAddress(initOwner, initStarkPubKeyX)
      );
      assert(
        initCodeSender === ethers.getAddress(userOp.sender),
        `initCode-derived sender mismatch: ${initCodeSender} != ${userOp.sender}`
      );
    } else {
      assert(userOp.initCode === '0x', 'Expected empty initCode for an already-deployed account');
    }

    assert(createProof, 'Expected createProof for first local E2E userOp');

    const badCreateProofUserOp = {
      ...userOp,
      initCode: userOp.initCode.replace(
        createProof.factHash.slice(2),
        `ff${createProof.factHash.slice(4)}`
      ),
    };
    const badCreateProofRes = await requestPaymaster(
      token,
      mintProofResponse.proofId,
      badCreateProofUserOp
    );
    assertApiFailure(
      badCreateProofRes,
      'CREATE_PROOF_FACTHASH_INVALID',
      'invalid createProof sponsorship'
    );

    const gate = new ethers.Contract(
      starkDeployment.ProofGateTest13 || starkDeployment.ProofGate,
      ['function setAllowlistSigner(address newSigner)'],
      deployerSigner
    );
    const rotatedSigner = deriveWallet(9).address;
    await (await gate.setAllowlistSigner(rotatedSigner)).wait();
    const signerMismatchRes = await requestPaymaster(
      token,
      mintProofResponse.proofId,
      userOp
    );
    assertApiFailure(
      signerMismatchRes,
      'ALLOWLIST_SIGNER_MISMATCH',
      'allowlist signer mismatch sponsorship'
    );
    await (await gate.setAllowlistSigner(allowlistSignerWallet.address)).wait();

    const paymasterRes = await requestPaymaster(
      token,
      mintProofResponse.proofId,
      userOp
    );
    assert(paymasterRes.ok, `/sign-paymaster failed: ${paymasterRes.data?.error || paymasterRes.status}`);
    assert(
      typeof paymasterRes.data?.paymasterAndData === 'string' &&
        paymasterRes.data.paymasterAndData !== '0x',
      'Expected non-empty paymasterAndData'
    );
    userOp.paymasterAndData = paymasterRes.data.paymasterAndData;

    const userOpHash = getUserOpHash(
      ethers,
      userOp,
      CHAIN_ID,
      aaDeployment.EntryPoint
    );
    userOp.signature = await signUserOp({
      ethers,
      userOpHash,
      eoaSigner: recipientSigner,
    });

    const tx = await entryPoint.handleOps([userOp], eoa, {
      gasLimit: 4_000_000n,
    });
    const receipt = await tx.wait();
    assert(receipt.status === 1, `handleOps reverted (tx=${receipt.hash})`);

    const postSupply = await mint.totalSupply();
    assert(
      postSupply === preSupply + 1n,
      `Supply mismatch: before=${preSupply} after=${postSupply}`
    );

    const mintedTokenId = preSupply;
    const owner = await mint.ownerOf(mintedTokenId);
    assert(
      owner.toLowerCase() === smartAccount.toLowerCase(),
      `ownerOf(${mintedTokenId}) mismatch: ${owner} != ${smartAccount}`
    );

    const predictedByFactory = ethers.getAddress(
      await factory.getPhilAddress(eoa, starkPubKeyX)
    );
    const mintToComputed = ethers.getAddress(mintProofResponse.mintToComputed);
    const userOpSender = ethers.getAddress(userOp.sender);
    assert(
      predictedByFactory === mintToComputed,
      `Address mismatch: predictedByFactory=${predictedByFactory} mintToComputed=${mintToComputed}`
    );
    assert(
      predictedByFactory === userOpSender,
      `Address mismatch: predictedByFactory=${predictedByFactory} userOp.sender=${userOpSender}`
    );

    const postCode = await provider.send('eth_getCode', [mintToComputed, 'latest']);
    assert(
      typeof postCode === 'string' && postCode !== '0x',
      `Smart account code missing at ${mintToComputed}: eth_getCode=${postCode}`
    );

    const smartAccountContract = new ethers.Contract(
      smartAccount,
      PHIL_ACCOUNT_ABI,
      provider
    );
    const isOwner = await smartAccountContract.isOwner(eoa);
    assert(isOwner, `Expected ${eoa} to be an owner of ${smartAccount}`);
    const accountEntryPoint = ethers.getAddress(await smartAccountContract.entryPoint());

    let replayRejected = false;
    try {
      const replayUserOp = await buildMintUserOp({
        ethers,
        smartAccount,
        factoryAddress: aaDeployment.PhilAccountFactory,
        isDeployed: true,
        eoa,
        starkPubKeyX,
        philTestMint: starkDeployment.PhilTestMint,
        mintParams: {
          recipient: eoa,
          mintTo: mintProofResponse.mintToComputed,
          philId,
          paletteVariant,
          mixMode,
          mixSeed,
          proof: mintProofResponse.proof,
        },
        provider,
        entryPointAddress: aaDeployment.EntryPoint,
      });
      const replayHash = getUserOpHash(
        ethers,
        replayUserOp,
        CHAIN_ID,
        aaDeployment.EntryPoint
      );
      replayUserOp.signature = await signUserOp({
        ethers,
        userOpHash: replayHash,
        eoaSigner: recipientSigner,
      });
      await entryPoint.handleOps([replayUserOp], eoa);
    } catch {
      replayRejected = true;
    }
    assert(replayRejected, 'Replay protection failed: reused proof unexpectedly succeeded');

    const secondPhilId = Number(postSupply % 6n);
    const secondPaletteVariant = Number(postSupply % 9n);
    const secondMintProofResponse = await requestProof(token, eoa, {
      kind: 'mint',
      philId: secondPhilId,
      paletteVariant: secondPaletteVariant,
      mixMode,
      mixSeed,
    });
    await (
      await mint.connect(recipientSigner).mint(
        eoa,
        smartAccount,
        secondPhilId,
        secondPaletteVariant,
        mixMode,
        mixSeed,
        secondMintProofResponse.proof
      )
    ).wait();

    const spentMintUserOp = await buildMintUserOp({
      ethers,
      smartAccount,
      factoryAddress: aaDeployment.PhilAccountFactory,
      isDeployed: true,
      eoa,
      starkPubKeyX,
      philTestMint: starkDeployment.PhilTestMint,
      mintParams: {
        recipient: eoa,
        mintTo: secondMintProofResponse.mintToComputed,
        philId: secondPhilId,
        paletteVariant: secondPaletteVariant,
        mixMode,
        mixSeed,
        proof: secondMintProofResponse.proof,
      },
      paymasterAndData: '0x',
      provider,
      entryPointAddress: aaDeployment.EntryPoint,
    });
    const spentMintRes = await requestPaymaster(
      token,
      secondMintProofResponse.proofId,
      spentMintUserOp
    );
    assertApiFailure(
      spentMintRes,
      'MINT_PROOF_ALREADY_USED',
      'spent mint proof sponsorship'
    );

    console.log('simulate_userop: OK');
    console.log(`  txHash:                  ${receipt.hash}`);
    console.log(`  predictedByFactory:      ${predictedByFactory}`);
    console.log(`  mintToComputed:          ${mintToComputed}`);
    console.log(`  userOp.sender:           ${userOpSender}`);
    console.log(`  initCodeFactory:         ${isDeployed ? '0x' : ethers.getAddress(ethers.dataSlice(userOp.initCode, 0, 20))}`);
    console.log(`  accountEntryPoint:       ${accountEntryPoint}`);
    console.log(`  handleOpsEntryPoint:     ${aaDeployment.EntryPoint}`);
    console.log(`  localEntryPointMock:     0x1000000000000000000000000000000000000001`);
    console.log(`  smartAccount:            ${smartAccount}`);
    console.log(`  ownerSigner:             ${eoa}`);
    console.log(`  deployedViaInitCode:     ${!isDeployed}`);
    console.log(`  tokenId:                 ${mintedTokenId.toString()}`);
    console.log(`  ownerOf(token):          ${owner}`);
    console.log(`  runtimeCodeBytes:        ${(postCode.length - 2) / 2}`);
    console.log(`  preFundEth:              0.05`);
    console.log(`  invalidCreateProofRejected: true`);
    console.log(`  signerMismatchRejected:  true`);
    console.log(`  spentMintRejected:       true`);
    console.log(`  paymasterSponsored:      true`);
    console.log(`  replayOnChainRejected:   ${replayRejected}`);
  } finally {
    if (server) {
      await server.stop();
    }
    await hardhatNode.stop();
    for (const backup of backups) {
      restoreFile(backup);
    }
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error('simulate_userop: FAILED');
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
