/**
 * Deployment Script for Phil Identity SHARP-Gated Architecture
 *
 * Deploys (using deployPhilSystem from scripts/local/deployPhilSystem.mjs):
 * 1. PhilRenderer (legacy interface, backed by PhilLayerRegistry + PhilSVGStorage)
 * 2. PhilWeb3 (standalone ERC-4804 endpoint; tokenURI remains fully inline)
 * 3. PhilIdentityGate
 * 4. PhilIdentityMint
 *
 * PhilIdentityGate consumes fact-registry-backed local Cairo/S-two proofs.
 *
 * Environment variables:
 *   PRIVATE_KEY               - Deployer private key (default: hardhat account 0)
 *   RPC_URL                   - JSON-RPC endpoint (e.g. http://127.0.0.1:8545 over an SSH tunnel)
 *   CHAIN_ID                  - Expected chain id (supported: 1, 11155111, 17000, 31337)
 *   PROGRAM_HASH              - Cairo program hash (bytes32 hex, 0x-prefixed)
 *   PROOF_CONTEXT             - proof context identifier (default: 13)
 *   FACT_REGISTRY             - Optional external fact registry (required off local chain)
 *   HUMANITY_PROVIDER         - local-credential (default) or mock (DEV/TEST ONLY on 31337)
 *   VERIFIER_CONFIG_HASH      - Humanity verifier config hash (or set CREDENTIAL_BUNDLE_PATH)
 *   CREDENTIAL_BUNDLE_PATH    - Path to a generated credential bundle; deploy uses its verifier config hash
 *   MOCK_HUMANITY_BUNDLE_PATH - Path to a generated mock-humanity bundle for HUMANITY_PROVIDER=mock
 *   ART_BACKEND_MODE          - auto (default), reuse-existing-data, reuse-stable, deploy-local, explicit
 *   ART_BACKEND_MANIFEST_PATH - Optional art backend manifest path for reuse/deploy bookkeeping
 *   PHIL_SVG_STORAGE          - Optional existing PhilSVGStorage address
 *   PHIL_LAYER_REGISTRY       - Optional existing PhilLayerRegistry address
 *   REUSE_STARK_DEPLOYMENTS   - Reuse deployments/stark_<chainId>.json instead of redeploying
 *   DRY_RUN                   - Print the full deployment plan without broadcasting
 */

import dotenv from 'dotenv';
import { ethers } from 'ethers';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import { deployPhilSystem } from './local/deployPhilSystem.mjs';
import { DEFAULT_DRY_RUN_PRIVATE_KEY, isDryRunEnabled, isTruthy } from '../shared/deploy/dryRun.mjs';
import { withRpcRetry } from '../shared/deploy/rpcRetry.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, '..');

const LOCAL_CHAIN_ID = 31337;
const MAINNET_CHAIN_ID = 1;
const SEPOLIA_CHAIN_ID = 11155111;
const SUPPORTED_CHAIN_IDS = new Set([1, SEPOLIA_CHAIN_ID, 17000, LOCAL_CHAIN_ID]);

function looksLikePlaceholder(value) {
  return String(value || '').toUpperCase().includes('YOUR_');
}

function loadExistingStark(chainId) {
  const deploymentsDir = path.join(ROOT_DIR, 'deployments');
  const starkPath = path.join(deploymentsDir, `stark_${chainId}.json`);
  if (fs.existsSync(starkPath)) {
    return {
      path: starkPath,
      data: JSON.parse(fs.readFileSync(starkPath, 'utf8')),
    };
  }
  return null;
}

export function readDeployStarkConfig(env = process.env) {
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
    throw new Error('PRIVATE_KEY still contains a placeholder.');
  }

  const dryRun = isDryRunEnabled(env);
  if (configuredChainId === MAINNET_CHAIN_ID && !dryRun && !privateKey) {
    throw new Error('PRIVATE_KEY must be set explicitly for live mainnet deployment.');
  }

  const programHash = String(env.PROGRAM_HASH || '').trim();
  if (configuredChainId === MAINNET_CHAIN_ID && !dryRun && !programHash) {
    throw new Error('PROGRAM_HASH must be set explicitly for live mainnet deployment.');
  }

  return {
    rpcUrl,
    configuredChainId,
    privateKey,
    programHash: programHash ||
      '0x4444444444444444444444444444444444444444444444444444444444444444',
    proofContext: BigInt(env.PROOF_CONTEXT || env.CONTEXT_ID || '13'),
    factRegistryAddress: String(env.FACT_REGISTRY || '').trim(),
    humanityProvider: String(env.HUMANITY_PROVIDER || 'local-credential').trim(),
    verifierConfigHash: String(env.VERIFIER_CONFIG_HASH || env.ELIGIBILITY_ROOT || '').trim(),
    credentialBundlePath: String(env.CREDENTIAL_BUNDLE_PATH || env.ELIGIBILITY_BUNDLE_PATH || '').trim(),
    mockHumanityBundlePath: String(env.MOCK_HUMANITY_BUNDLE_PATH || env.HUMANITY_BUNDLE_PATH || '').trim(),
    artBackendMode: String(env.ART_BACKEND_MODE || '').trim(),
    artBackendManifestPath: String(env.ART_BACKEND_MANIFEST_PATH || '').trim(),
    dryRun,
    reuseStark:
      !isTruthy(env.FORCE_REDEPLOY) &&
      isTruthy(env.REUSE_STARK_DEPLOYMENTS || env.REUSE_DEPLOYMENTS),
    svgStorageAddress: String(env.PHIL_SVG_STORAGE || '').trim(),
    layerRegistryAddress: String(env.PHIL_LAYER_REGISTRY || '').trim(),
    dryRunPlanner: env.__dryRunPlanner || null,
  };
}

export async function runDeployStark(config = readDeployStarkConfig(process.env)) {
  const provider = new ethers.JsonRpcProvider(
    config.rpcUrl,
    config.configuredChainId,
    { batchMaxCount: 1, staticNetwork: true }
  );
  const connectedChainId = Number(
    BigInt(await withRpcRetry('ping deployment rpc', () => provider.send('eth_chainId', [])))
  );
  if (connectedChainId !== config.configuredChainId) {
    throw new Error(
      `RPC chain mismatch. Connected chainId=${connectedChainId}, expected ${config.configuredChainId}.`
    );
  }

  if (!config.dryRun && connectedChainId !== LOCAL_CHAIN_ID) {
    const normalizedPrivateKey = String(config.privateKey || '').toLowerCase();
    if (!normalizedPrivateKey || normalizedPrivateKey === DEFAULT_DRY_RUN_PRIVATE_KEY) {
      throw new Error('Live non-local deployment refuses the default Hardhat private key. Set PRIVATE_KEY explicitly.');
    }
  }

  if (config.reuseStark) {
    const existing = loadExistingStark(connectedChainId);
    if (!existing) {
      throw new Error('REUSE_STARK_DEPLOYMENTS set, but no existing stark deployment found.');
    }

    console.log('\nREUSE_STARK_DEPLOYMENTS enabled. Using existing deployment:');
    console.log(JSON.stringify(existing.data, null, 2));
    return {
      ...existing.data,
      chainId: connectedChainId,
      reused: true,
    };
  }

  console.log('\n' + '='.repeat(60));
  console.log('PHIL HUMANITY-READY IDENTITY DEPLOYMENT');
  console.log('='.repeat(60));
  console.log(`Mode:         ${config.dryRun ? 'DRY_RUN (no broadcast)' : 'LIVE (broadcast)'}`);
  console.log(`RPC URL:      ${config.rpcUrl}`);
  console.log(`Chain ID:     ${connectedChainId}`);
  console.log(`Program Hash: ${config.programHash}`);
  console.log(`Proof Context: ${config.proofContext}`);
  console.log(`Humanity Provider: ${config.humanityProvider}`);
  if (config.factRegistryAddress) {
    console.log(`Fact Registry: ${config.factRegistryAddress}`);
  }
  if (config.verifierConfigHash) {
    console.log(`Verifier Config: ${config.verifierConfigHash}`);
  }
  if (config.credentialBundlePath) {
    console.log(`Credential Bundle: ${config.credentialBundlePath}`);
  }
  if (config.mockHumanityBundlePath) {
    console.log(`Mock Humanity Bundle: ${config.mockHumanityBundlePath}`);
  }
  if (config.artBackendMode) {
    console.log(`Art Backend Mode: ${config.artBackendMode}`);
  }
  if (config.artBackendManifestPath) {
    console.log(`Art Backend Manifest: ${config.artBackendManifestPath}`);
  }
  console.log('Proof Mode:   Local Cairo + S-two proof facts');
  console.log('Fact Bridge:  DevProofVerifier (31337) / external FACT_REGISTRY (public chains)');
  console.log('='.repeat(60) + '\n');

  const deployments = await deployPhilSystem({
    rpcUrl: config.rpcUrl,
    privateKey: config.privateKey || undefined,
    programHash: config.programHash,
    proofContext: config.proofContext,
    factRegistryAddress: config.factRegistryAddress,
    humanityProvider: config.humanityProvider,
    verifierConfigHash: config.verifierConfigHash,
    credentialBundlePath: config.credentialBundlePath,
    mockHumanityBundlePath: config.mockHumanityBundlePath,
    artBackendMode: config.artBackendMode,
    artBackendManifestPath: config.artBackendManifestPath,
    svgStorageAddress: config.svgStorageAddress,
    layerRegistryAddress: config.layerRegistryAddress,
    chainIdHint: config.configuredChainId,
    writeDeployments: !config.dryRun,
    dryRun: config.dryRun,
    dryRunPlanner: config.dryRunPlanner,
  });

  const starkDeployments = {
    chainId: deployments.chainId,
    ProofGate: deployments.PhilIdentityGate,
    PhilIdentityGate: deployments.PhilIdentityGate,
    PhilIdentityMint: deployments.PhilIdentityMint,
    PhilRenderer: deployments.PhilRenderer,
    PhilSVGStorage: deployments.PhilSVGStorage,
    PhilLayerRegistry: deployments.PhilLayerRegistry,
    PhilNFT: deployments.PhilNFT,
    PhilWeb3: deployments.PhilWeb3,
    FactRegistryHumanityVerifier: deployments.FactRegistryHumanityVerifier,
    MockHumanityVerifier: deployments.MockHumanityVerifier || '',
    humanityVerifier: deployments.humanityVerifier,
    humanityProvider: deployments.humanityProvider,
    programHash: config.programHash,
    proofContext: config.proofContext.toString(),
    factRegistry: deployments.factRegistry,
    verifierConfigHash: deployments.verifierConfigHash,
    artBackendReused: deployments.artBackendReused,
    artBackendMode: deployments.artBackendMode,
    artBackendManifest: deployments.artBackendManifest,
    artBackendSource: deployments.artBackendSource,
    ProofMode: 'LOCAL_STWO_FACTS',
  };

  const deploymentsDir = path.join(ROOT_DIR, 'deployments');
  const starkFile = path.join(deploymentsDir, `stark_${deployments.chainId}.json`);
  if (!config.dryRun) {
    fs.mkdirSync(deploymentsDir, { recursive: true });
    fs.writeFileSync(starkFile, JSON.stringify(starkDeployments, null, 2));
    console.log(`Saved stark deployment manifest: ${starkFile}`);
  } else {
    console.log(`DRY_RUN: skipping stark deployment manifest write (${starkFile}).`);
  }

  console.log('\n' + '='.repeat(60));
  console.log(config.dryRun ? 'DRY RUN COMPLETE' : 'DEPLOYMENT COMPLETE');
  console.log('='.repeat(60));
  for (const [key, value] of Object.entries(starkDeployments)) {
    console.log(`  ${key}: ${value}`);
  }
  if (!config.dryRun) {
    console.log('\nNext: node scripts/deploy_4337.mjs');
  }
  console.log('='.repeat(60) + '\n');

  return {
    ...starkDeployments,
    reused: false,
  };
}

async function main() {
  dotenv.config();
  const config = readDeployStarkConfig(process.env);
  await runDeployStark(config);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(err instanceof Error ? `ERROR: ${err.message}` : err);
    process.exit(1);
  });
}
