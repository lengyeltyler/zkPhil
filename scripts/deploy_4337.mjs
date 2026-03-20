/**
 * Deployment Script for Phil EIP-4337 Account Abstraction
 *
 * Deploys (additive — existing contracts are NOT redeployed):
 * 1. PhilAccount (implementation)
 * 2. PhilUnlockInbox
 * 3. PhilAccountFactory
 * 4. PhilPaymaster
 * 5. Funds the paymaster deposit at EntryPoint
 *
 * Requires existing deployment of PhilIdentityMint (from deploy_stark.mjs).
 *
 * Environment variables:
 *   PRIVATE_KEY              - Deployer private key
 *   RPC_URL                  - JSON-RPC endpoint (e.g. http://127.0.0.1:8545 over an SSH tunnel)
 *   CHAIN_ID                 - Expected chain id (supported: 1, 11155111, 17000, 31337)
 *   PHIL_IDENTITY_MINT           - Deployed PhilIdentityMint address (or reads from deployments/)
 *   PROOF_GATE               - Deployed PhilIdentityGate address (or reads from deployments/)
 *   PAYMASTER_SIGNER_KEY     - Private key for paymaster sponsorship signing
 *                              (required for live non-local deployment)
 *   STARKNET_CORE            - Starknet L1 core contract address
 *   L2_UNLOCK_VERIFIER       - Starknet L2 verifier contract address (felt)
 *   PAYMASTER_DEPOSIT        - ETH to deposit for gas sponsorship (default: "0.5")
 *   REUSE_4337_DEPLOYMENTS   - Reuse deployments/4337_<chainId>.json instead of redeploying
 *   DRY_RUN                  - Print the full deployment plan without broadcasting
 */

import dotenv from 'dotenv';
import { ethers } from 'ethers';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import {
  DEFAULT_DRY_RUN_PRIVATE_KEY,
  DryRunPlanner,
  installDryRunGuards,
  isDryRunEnabled,
  isTruthy,
  planContractCall,
  planDeploy,
} from '../shared/deploy/dryRun.mjs';
import { logTx, waitForReceiptWithTimeout } from './sepolia/txutil.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const ENTRY_POINT_V07 = '0x0000000071727De22E5E9d8BAf0edAc6f37da032';
const LOCAL_ENTRY_POINT_V07 = '0x1000000000000000000000000000000000000001';
const LOCAL_CHAIN_ID = 31337;
const MAINNET_CHAIN_ID = 1;
const SEPOLIA_CHAIN_ID = 11155111;
const SUPPORTED_CHAIN_IDS = new Set([1, SEPOLIA_CHAIN_ID, 17000, LOCAL_CHAIN_ID]);

function looksLikePlaceholder(value) {
  return String(value || '').toUpperCase().includes('YOUR_');
}

async function loadArtifact(name) {
  const candidates = [
    path.join(__dirname, `../artifacts/contracts/${name}.sol/${name}.json`),
    path.join(__dirname, `../artifacts/contracts/mocks/${name}.sol/${name}.json`),
  ];

  for (const artifactPath of candidates) {
    if (fs.existsSync(artifactPath)) {
      return JSON.parse(fs.readFileSync(artifactPath, 'utf8'));
    }
  }

  throw new Error(`Artifact not found for ${name}`);
}

async function deployContract({
  wallet,
  provider,
  artifact,
  args = [],
  contractName,
  dryRun,
  dryRunPlanner,
  from,
}) {
  if (dryRun) {
    const planned = await planDeploy({
      provider,
      planner: dryRunPlanner,
      from,
      artifact,
      contractName,
      args,
    });
    return {
      address: planned.address,
      dryRun: true,
    };
  }

  const factory = new ethers.ContractFactory(artifact.abi, artifact.bytecode, wallet);
  const contract = await factory.deploy(...args);
  const deploymentTx = contract.deploymentTransaction();
  if (!deploymentTx) {
    throw new Error(`Missing deployment transaction for ${contractName}`);
  }
  logTx(`Deploy ${contractName}`, deploymentTx.hash);
  await waitForReceiptWithTimeout(provider, deploymentTx.hash);

  return {
    address: await contract.getAddress(),
    contract,
    dryRun: false,
  };
}

async function callContract({
  wallet,
  provider,
  contractName,
  contractAddress,
  abi,
  method,
  args = [],
  overrides = {},
  dryRun,
  dryRunPlanner,
  from,
  note = '',
  canEstimate = true,
}) {
  if (dryRun) {
    return planContractCall({
      provider,
      planner: dryRunPlanner,
      from,
      contractName,
      contractAddress,
      abi,
      method,
      args,
      value: overrides.value ?? 0n,
      note,
      canEstimate,
    });
  }

  const contract = new ethers.Contract(contractAddress, abi, wallet);
  const overrideKeys = Object.keys(overrides).filter((key) => overrides[key] != null);
  const txArgs = overrideKeys.length > 0 ? [...args, overrides] : args;
  const tx = await contract[method](...txArgs);
  logTx(`${contractName}.${method}`, tx.hash);
  await waitForReceiptWithTimeout(provider, tx.hash);
  return tx;
}

function weiToEth(wei) {
  try {
    return ethers.formatEther(wei);
  } catch {
    return String(wei);
  }
}

function loadExistingDeployments(chainId) {
  const deploymentsDir = path.join(__dirname, '../deployments');
  const starkPath = path.join(deploymentsDir, `stark_${chainId}.json`);
  if (fs.existsSync(starkPath)) {
    return JSON.parse(fs.readFileSync(starkPath, 'utf8'));
  }
  return {};
}

function loadExisting4337(chainId) {
  const deploymentsDir = path.join(__dirname, '../deployments');
  const path4337 = path.join(deploymentsDir, `4337_${chainId}.json`);
  if (fs.existsSync(path4337)) {
    return {
      path: path4337,
      data: JSON.parse(fs.readFileSync(path4337, 'utf8')),
    };
  }
  return null;
}

export function readDeploy4337Config(env = process.env) {
  const rpcUrl = String(env.RPC_URL || '').trim();
  if (!rpcUrl) {
    throw new Error('RPC_URL must be set explicitly in environment.');
  }

  const configuredChainId = Number(env.CHAIN_ID || '');
  if (!Number.isInteger(configuredChainId)) {
    throw new Error(`CHAIN_ID must be set to one of: ${[...SUPPORTED_CHAIN_IDS].join(', ')}`);
  }
  if (!SUPPORTED_CHAIN_IDS.has(configuredChainId)) {
    throw new Error(
      `Unsupported CHAIN_ID=${configuredChainId}. Supported values: ${[...SUPPORTED_CHAIN_IDS].join(', ')}`
    );
  }

  const privateKey = String(env.PRIVATE_KEY || '').trim();
  if (privateKey && looksLikePlaceholder(privateKey)) {
    throw new Error('PRIVATE_KEY still contains a placeholder (e.g. 0xYOUR_...).');
  }

  const paymasterSignerKey = String(env.PAYMASTER_SIGNER_KEY || '').trim();
  if (paymasterSignerKey && looksLikePlaceholder(paymasterSignerKey)) {
    throw new Error('PAYMASTER_SIGNER_KEY still contains a placeholder (e.g. 0xYOUR_...).');
  }

  const dryRun = isDryRunEnabled(env);

  if (configuredChainId === MAINNET_CHAIN_ID && !dryRun && !privateKey) {
    throw new Error('PRIVATE_KEY must be set explicitly for live mainnet deployment.');
  }
  if (configuredChainId !== LOCAL_CHAIN_ID && !dryRun && !paymasterSignerKey) {
    throw new Error(
      'PAYMASTER_SIGNER_KEY must be set explicitly for live non-local deployment.'
    );
  }

  return {
    rpcUrl,
    configuredChainId,
    privateKey,
    paymasterSignerKey,
    philIdentityMint: String(env.PHIL_IDENTITY_MINT || '').trim(),
    proofGate: String(env.PROOF_GATE || '').trim(),
    starknetCore: String(env.STARKNET_CORE || '').trim(),
    l2UnlockVerifier: String(env.L2_UNLOCK_VERIFIER || '').trim(),
    useMockInbox: isTruthy(env.MOCK_UNLOCK_INBOX || env.SKIP_STARKNET),
    paymasterDeposit: String(env.PAYMASTER_DEPOSIT || '0.001').trim(),
    dryRun,
    reuse4337:
      !isTruthy(env.FORCE_REDEPLOY) &&
      isTruthy(env.REUSE_4337_DEPLOYMENTS || env.REUSE_DEPLOYMENTS),
    dryRunPlanner: env.__dryRunPlanner || null,
  };
}

export async function runDeploy4337(config = readDeploy4337Config(process.env)) {
  const provider = new ethers.JsonRpcProvider(config.rpcUrl);
  const rawWallet = new ethers.Wallet(
    config.privateKey ||
      '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80',
    provider
  );
  const wallet = new ethers.NonceManager(rawWallet);
  const deployerAddress = await rawWallet.getAddress();

  if (config.dryRun) {
    installDryRunGuards(rawWallet, wallet);
  }

  const network = await provider.getNetwork();
  const chainId = Number(network.chainId);
  if (chainId !== config.configuredChainId) {
    throw new Error(`RPC chain mismatch. Connected chainId=${chainId}, expected ${config.configuredChainId}.`);
  }

  const dryRunPlanner = config.dryRun
    ? (config.dryRunPlanner || await DryRunPlanner.create({ provider, from: deployerAddress }))
    : null;

  const isLocalChain = chainId === LOCAL_CHAIN_ID;
  if (!config.dryRun && !isLocalChain && rawWallet.privateKey.toLowerCase() === DEFAULT_DRY_RUN_PRIVATE_KEY) {
    throw new Error('Live non-local deployment refuses the default Hardhat private key. Set PRIVATE_KEY explicitly.');
  }
  const entryPointAddress = isLocalChain ? LOCAL_ENTRY_POINT_V07 : ENTRY_POINT_V07;

  if (isLocalChain) {
    const existingEntryPointCode = await provider.getCode(entryPointAddress);
    if (existingEntryPointCode === '0x') {
      if (config.dryRun) {
        console.log(
          `DRY_RUN: skipping EntryPointLocalMock install at ${entryPointAddress} because it would mutate local chain state.`
        );
      } else {
        console.log(`Installing EntryPointLocalMock at ${entryPointAddress} for local testing...`);
        const entryPointMockArtifact = await loadArtifact('EntryPointLocalMock');
        const entryPointMockImpl = await deployContract({
          wallet,
          provider,
          artifact: entryPointMockArtifact,
          contractName: 'EntryPointLocalMock',
          dryRun: false,
          dryRunPlanner: null,
          from: deployerAddress,
        });
        const runtimeCode = await provider.getCode(entryPointMockImpl.address);
        let installedCode = '0x';
        for (let attempt = 1; attempt <= 5; attempt += 1) {
          await provider.send('hardhat_setCode', [entryPointAddress, runtimeCode]);
          await provider.send('evm_mine', []);
          installedCode = await provider.getCode(entryPointAddress);
          if (installedCode !== '0x') break;
        }
        if (installedCode === '0x') {
          throw new Error(`Failed to install EntryPointLocalMock code at ${entryPointAddress}`);
        }
        console.log(`  EntryPointLocalMock installed at ${entryPointAddress}`);
        console.log(`  EntryPointLocalMock impl: ${entryPointMockImpl.address}`);
      }
    }
  }

  const existingStark = loadExistingDeployments(chainId);
  const philIdentityMintAddr = config.philIdentityMint || existingStark.PhilIdentityMint || '';
  if (!philIdentityMintAddr) {
    throw new Error(
      'PhilIdentityMint address not found. Set PHIL_IDENTITY_MINT env var or deploy via deploy_stark.mjs first.'
    );
  }

  const proofGateAddr = config.proofGate || existingStark.PhilIdentityGate || existingStark.ProofGate || '';
  if (!proofGateAddr) {
    throw new Error(
      'Proof gate address not found. Set PROOF_GATE env var or deploy via deploy_stark.mjs first.'
    );
  }

  if (config.reuse4337) {
    const existing = loadExisting4337(chainId);
    if (!existing) {
      throw new Error('REUSE_4337_DEPLOYMENTS set, but no existing 4337 deployment found.');
    }

    if (
      existing.data.PhilIdentityMint &&
      philIdentityMintAddr &&
      existing.data.PhilIdentityMint.toLowerCase() !== philIdentityMintAddr.toLowerCase()
    ) {
      throw new Error(
        `Existing 4337 deployment is pinned to a different PhilIdentityMint address.\n` +
        `  Existing PhilIdentityMint: ${existing.data.PhilIdentityMint}\n` +
        `  Current  PhilIdentityMint: ${philIdentityMintAddr}\n` +
        '  Set FORCE_REDEPLOY=true to intentionally redeploy 4337 for the new mint contract.'
      );
    }

    console.log('\nREUSE_4337_DEPLOYMENTS enabled. Using existing deployment:');
    console.log(JSON.stringify(existing.data, null, 2));
    return {
      ...existing.data,
      reused: true,
    };
  }

  const effectivePaymasterSignerKey =
    config.paymasterSignerKey || config.privateKey || rawWallet.privateKey;
  const paymasterSignerAddr = new ethers.Wallet(effectivePaymasterSignerKey).address;

  let useMockInbox = config.useMockInbox;
  let starknetCore = config.starknetCore;
  let l2UnlockVerifier = config.l2UnlockVerifier;
  if (useMockInbox && !l2UnlockVerifier) {
    l2UnlockVerifier = '0';
  }
  if (!useMockInbox && (!starknetCore || !l2UnlockVerifier)) {
    if (!config.dryRun) {
      throw new Error('STARKNET_CORE and L2_UNLOCK_VERIFIER must be set.');
    }
    useMockInbox = true;
    l2UnlockVerifier = '0';
    console.log(
      'DRY_RUN: STARKNET_CORE and L2_UNLOCK_VERIFIER are not set. Planning with a functional MockStarknetCore.'
    );
  }

  let depositAmount;
  try {
    depositAmount = ethers.parseEther(config.paymasterDeposit);
  } catch {
    throw new Error(`PAYMASTER_DEPOSIT is invalid: ${config.paymasterDeposit}`);
  }

  try {
    const balance = await provider.getBalance(deployerAddress);
    const feeData = await provider.getFeeData();
    const maxFeePerGas = feeData.maxFeePerGas || feeData.gasPrice || ethers.parseUnits('15', 'gwei');

    const previewAccountArtifact = await loadArtifact('PhilAccount');
    const previewFactory = new ethers.ContractFactory(
      previewAccountArtifact.abi,
      previewAccountArtifact.bytecode,
      rawWallet
    );
    const previewDeployTx = await previewFactory.getDeployTransaction();
    const firstDeployGas = await provider.estimateGas({
      from: deployerAddress,
      data: previewDeployTx.data,
    });
    const firstDeployCost = firstDeployGas * maxFeePerGas;

    if (balance < firstDeployCost) {
      const lines = [
        'Insufficient ETH for first 4337 deployment transaction.',
        `  Deployer:        ${deployerAddress}`,
        `  Balance:         ${weiToEth(balance)} ETH`,
        `  Est. gas (tx1):  ${firstDeployGas.toString()}`,
        `  Max fee / gas:   ${ethers.formatUnits(maxFeePerGas, 'gwei')} gwei`,
        `  Est. tx1 cost:   ${weiToEth(firstDeployCost)} ETH`,
      ];
      if (config.dryRun) {
        console.warn(`DRY_RUN WARNING: ${lines.join('\n')}`);
      } else {
        throw new Error(lines.join('\n'));
      }
    }
  } catch (preflightErr) {
    if (config.dryRun) {
      console.warn('DRY_RUN WARNING: Could not run strict 4337 balance preflight; continuing.');
      console.warn(preflightErr instanceof Error ? preflightErr.message : String(preflightErr));
    } else {
      throw preflightErr;
    }
  }

  console.log('\n' + '='.repeat(60));
  console.log('PHIL EIP-4337 ACCOUNT ABSTRACTION DEPLOYMENT');
  console.log('='.repeat(60));
  console.log(`Mode:              ${config.dryRun ? 'DRY_RUN (no broadcast)' : 'LIVE (broadcast)'}`);
  console.log(`Deployer:          ${deployerAddress}`);
  console.log(`Chain ID:          ${chainId}`);
  console.log(`EntryPoint v0.7:   ${entryPointAddress}${isLocalChain ? ' (local mock)' : ''}`);
  console.log(`PhilIdentityMint:      ${philIdentityMintAddr}`);
  console.log(`PhilIdentityGate:   ${proofGateAddr}`);
  console.log(`Paymaster Signer:  ${paymasterSignerAddr}`);
  console.log(`Starknet Core:     ${starknetCore}${useMockInbox ? ' (mock)' : ''}`);
  console.log(`L2 Verifier:       ${l2UnlockVerifier}${useMockInbox ? ' (mock)' : ''}`);
  console.log(`Paymaster Deposit: ${config.paymasterDeposit} ETH`);
  console.log('='.repeat(60) + '\n');

  const deployments = {
    EntryPoint: entryPointAddress,
    PhilIdentityMint: philIdentityMintAddr,
    PhilIdentityGate: proofGateAddr,
  };

  if (useMockInbox) {
    console.log('1. Deploying MockStarknetCore for mock inbox mode...');
    const MockStarknetCore = await loadArtifact('MockStarknetCore');
    const mockStarknetCore = await deployContract({
      wallet,
      provider,
      artifact: MockStarknetCore,
      contractName: 'MockStarknetCore',
      dryRun: config.dryRun,
      dryRunPlanner,
      from: deployerAddress,
    });
    deployments.MockStarknetCore = mockStarknetCore.address;
    starknetCore = mockStarknetCore.address;
    console.log(`   MockStarknetCore: ${deployments.MockStarknetCore}`);
  }

  console.log(`${useMockInbox ? '2' : '1'}. Deploying PhilAccount implementation...`);
  const PhilAccount = await loadArtifact('PhilAccount');
  const accountImpl = await deployContract({
    wallet,
    provider,
    artifact: PhilAccount,
    contractName: 'PhilAccount',
    dryRun: config.dryRun,
    dryRunPlanner,
    from: deployerAddress,
  });
  deployments.PhilAccountImpl = accountImpl.address;
  console.log(`   PhilAccount impl: ${deployments.PhilAccountImpl}`);

  console.log(`${useMockInbox ? '3' : '2'}. Deploying PhilUnlockInbox...`);
  const PhilUnlockInbox = await loadArtifact('PhilUnlockInbox');
  const unlockInbox = await deployContract({
    wallet,
    provider,
    artifact: PhilUnlockInbox,
    args: [
      starknetCore,
      l2UnlockVerifier,
    ],
    contractName: 'PhilUnlockInbox',
    dryRun: config.dryRun,
    dryRunPlanner,
    from: deployerAddress,
  });
  deployments.PhilUnlockInbox = unlockInbox.address;
  console.log(`   PhilUnlockInbox: ${deployments.PhilUnlockInbox}`);

  console.log(`${useMockInbox ? '4' : '3'}. Deploying PhilAccountFactory...`);
  const PhilAccountFactory = await loadArtifact('PhilAccountFactory');
  const factory = await deployContract({
    wallet,
    provider,
    artifact: PhilAccountFactory,
    args: [
      deployments.PhilAccountImpl,
      deployments.PhilUnlockInbox,
      philIdentityMintAddr,
      proofGateAddr,
    ],
    contractName: 'PhilAccountFactory',
    dryRun: config.dryRun,
    dryRunPlanner,
    from: deployerAddress,
  });
  deployments.PhilAccountFactory = factory.address;
  console.log(`   PhilAccountFactory: ${deployments.PhilAccountFactory}`);

  await callContract({
    wallet,
    provider,
    contractName: 'PhilIdentityGate',
    contractAddress: proofGateAddr,
    abi: [
      'function setAuthorizedCaller(address caller, bool allowed)',
    ],
    method: 'setAuthorizedCaller',
    args: [deployments.PhilAccountFactory, true],
    dryRun: config.dryRun,
    dryRunPlanner,
    from: deployerAddress,
    canEstimate: true,
  });
  console.log('   ProofGate authorization: enabled for PhilAccountFactory');

  console.log(`${useMockInbox ? '5' : '4'}. Deploying PhilPaymaster...`);
  const PhilPaymaster = await loadArtifact('PhilPaymaster');
  const paymaster = await deployContract({
    wallet,
    provider,
    artifact: PhilPaymaster,
    args: [
      entryPointAddress,
      paymasterSignerAddr,
      philIdentityMintAddr,
    ],
    contractName: 'PhilPaymaster',
    dryRun: config.dryRun,
    dryRunPlanner,
    from: deployerAddress,
  });
  deployments.PhilPaymaster = paymaster.address;
  console.log(`   PhilPaymaster: ${deployments.PhilPaymaster}`);

  if (depositAmount === 0n) {
    console.log('Skipping paymaster deposit because PAYMASTER_DEPOSIT=0');
  } else {
    console.log(`${useMockInbox ? '6' : '5'}. Depositing ${config.paymasterDeposit} ETH to paymaster...`);
    const epCode = await provider.getCode(entryPointAddress);
    if (epCode === '0x') {
      console.log('   WARNING: EntryPoint has no code at this address (local Hardhat).');
      console.log('   Skipping deposit. For production, fund via paymaster.deposit().');
    } else {
      await callContract({
        wallet,
        provider,
        contractName: 'PhilPaymaster',
        contractAddress: deployments.PhilPaymaster,
        abi: [
          'function deposit() payable',
        ],
        method: 'deposit',
        overrides: { value: depositAmount },
        dryRun: config.dryRun,
        dryRunPlanner,
        from: deployerAddress,
        canEstimate: !config.dryRun,
        note: config.dryRun
          ? 'Gas estimate is unavailable until PhilPaymaster is actually deployed.'
          : '',
      });

      if (!config.dryRun) {
        const paymasterContract = new ethers.Contract(
          deployments.PhilPaymaster,
          ['function getDeposit() view returns (uint256)'],
          provider
        );
        const balance = await paymasterContract.getDeposit();
        console.log(`   Paymaster EntryPoint deposit: ${ethers.formatEther(balance)} ETH`);
      }
    }
  }

  const deploymentsDir = path.join(__dirname, '../deployments');
  const outPath = path.join(deploymentsDir, `4337_${chainId}.json`);
  if (!config.dryRun) {
    if (!fs.existsSync(deploymentsDir)) {
      fs.mkdirSync(deploymentsDir, { recursive: true });
    }

    const existing4337 = loadExisting4337(chainId)?.data || {};
    Object.assign(existing4337, deployments);
    fs.writeFileSync(outPath, JSON.stringify(existing4337, null, 2));
    console.log(`\nDeployments saved to: ${outPath}`);
  } else {
    console.log(`DRY_RUN: skipping 4337 deployment manifest write (${outPath}).`);
  }

  console.log('\n' + '='.repeat(60));
  console.log(config.dryRun ? 'DRY RUN COMPLETE' : 'DEPLOYMENT COMPLETE');
  console.log('='.repeat(60));
  console.log(JSON.stringify(deployments, null, 2));
  console.log('='.repeat(60) + '\n');

  return {
    ...deployments,
    reused: false,
  };
}

async function main() {
  dotenv.config();
  const config = readDeploy4337Config(process.env);
  await runDeploy4337(config);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(err instanceof Error ? `ERROR: ${err.message}` : err);
    process.exit(1);
  });
}
