/**
 * Deployment Script for the Phil Marketplace
 *
 * Deploys:
 * 1. PhilMarketplace
 *
 * Requires an existing deployment of PhilTestMint (from deploy_stark.mjs).
 *
 * Environment variables:
 *   PRIVATE_KEY               - Deployer private key (required for live deployment)
 *   RPC_URL                   - JSON-RPC endpoint
 *   CHAIN_ID                  - Expected chain id (supported: 1, 11155111, 17000, 31337)
 *   PHIL_TEST_MINT            - Deployed PhilTestMint address (or reads from deployments/)
 *   MARKETPLACE_ROYALTY_BPS       - Royalty in basis points (default: 369)
 *   MARKETPLACE_ROYALTY_RECIPIENT - Royalty recipient address or ENS name
 *                                   (e.g. tyler_lengyel.eth; default: deployer)
 */

import dotenv from 'dotenv';
import { ethers } from 'ethers';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { logTx, waitForReceiptWithTimeout } from './sepolia/txutil.mjs';
import { mergeRecommendedTxOverrides } from '../shared/deploy/feeOverrides.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, '..');

const LOCAL_CHAIN_ID = 31337;
const SEPOLIA_CHAIN_ID = 11155111;
const SUPPORTED_CHAIN_IDS = new Set([1, SEPOLIA_CHAIN_ID, 17000, LOCAL_CHAIN_ID]);

function looksLikePlaceholder(value) {
  return String(value || '').toUpperCase().includes('YOUR_');
}

function loadExistingStark(chainId) {
  const deploymentsDir = path.join(ROOT_DIR, 'deployments');
  const starkPath = path.join(deploymentsDir, `stark_${chainId}.json`);
  if (!fs.existsSync(starkPath)) {
    return null;
  }

  return JSON.parse(fs.readFileSync(starkPath, 'utf8'));
}

async function loadArtifact(name) {
  const artifactPath = path.join(__dirname, `../artifacts/contracts/${name}.sol/${name}.json`);
  if (!fs.existsSync(artifactPath)) {
    throw new Error(`Artifact not found for ${name}. Run npx hardhat compile first.`);
  }

  return JSON.parse(fs.readFileSync(artifactPath, 'utf8'));
}

async function resolveRecipientAddress(provider, rawValue, fallbackAddress, label) {
  const trimmed = String(rawValue || '').trim();
  if (!trimmed) {
    return ethers.getAddress(fallbackAddress);
  }

  if (ethers.isAddress(trimmed)) {
    return ethers.getAddress(trimmed);
  }

  const resolved = await provider.resolveName(trimmed);
  if (!resolved) {
    throw new Error(`${label} could not be resolved: ${trimmed}`);
  }

  return ethers.getAddress(resolved);
}

export function readDeployMarketplaceConfig(env = process.env) {
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
  if (!privateKey) {
    throw new Error('PRIVATE_KEY must be set explicitly in environment.');
  }
  if (looksLikePlaceholder(privateKey)) {
    throw new Error('PRIVATE_KEY still contains a placeholder.');
  }

  const existingStark = loadExistingStark(configuredChainId) || {};
  const philTestMint = String(env.PHIL_TEST_MINT || existingStark.PhilTestMint || '').trim();
  if (!philTestMint) {
    throw new Error(
      'PHIL_TEST_MINT address not found. Set PHIL_TEST_MINT env var or deploy via deploy_stark.mjs first.'
    );
  }

  const royaltyBpsRaw = String(env.MARKETPLACE_ROYALTY_BPS || '369').trim();
  const royaltyBps = Number(royaltyBpsRaw);
  if (!Number.isInteger(royaltyBps) || royaltyBps < 0 || royaltyBps > 1_000) {
    throw new Error(
      `MARKETPLACE_ROYALTY_BPS must be an integer between 0 and 1000 (received ${royaltyBpsRaw}).`
    );
  }

  const royaltyRecipient = String(env.MARKETPLACE_ROYALTY_RECIPIENT || '').trim();

  return {
    rpcUrl,
    configuredChainId,
    privateKey,
    philTestMint,
    royaltyBps,
    royaltyRecipient,
  };
}

export async function runDeployMarketplace(
  config = readDeployMarketplaceConfig(process.env)
) {
  const provider = new ethers.JsonRpcProvider(config.rpcUrl);
  const network = await provider.getNetwork();
  const connectedChainId = Number(network.chainId);
  if (connectedChainId !== config.configuredChainId) {
    throw new Error(
      `RPC chain mismatch. Connected chainId=${connectedChainId}, expected ${config.configuredChainId}.`
    );
  }

  const wallet = new ethers.Wallet(config.privateKey, provider);
  const deployerAddress = await wallet.getAddress();
  const royaltyRecipient = await resolveRecipientAddress(
    provider,
    config.royaltyRecipient,
    deployerAddress,
    'MARKETPLACE_ROYALTY_RECIPIENT'
  );
  const artifact = await loadArtifact('PhilMarketplace');

  console.log('\n' + '='.repeat(60));
  console.log('PHIL MARKETPLACE DEPLOYMENT');
  console.log('='.repeat(60));
  console.log(`RPC URL:        ${config.rpcUrl}`);
  console.log(`Chain ID:       ${connectedChainId}`);
  console.log(`Deployer:       ${deployerAddress}`);
  console.log(`PhilTestMint:   ${config.philTestMint}`);
  console.log(`Royalty BPS:    ${config.royaltyBps}`);
  console.log(`Royalty Rcpt:   ${royaltyRecipient}`);
  console.log('='.repeat(60) + '\n');

  const factory = new ethers.ContractFactory(artifact.abi, artifact.bytecode, wallet);
  const contract = await factory.deploy(
    config.philTestMint,
    royaltyRecipient,
    config.royaltyBps,
    await mergeRecommendedTxOverrides(provider)
  );
  const deploymentTx = contract.deploymentTransaction();
  if (!deploymentTx) {
    throw new Error('Missing deployment transaction for PhilMarketplace');
  }
  logTx('Deploy PhilMarketplace', deploymentTx.hash, connectedChainId);
  await waitForReceiptWithTimeout(provider, deploymentTx.hash);

  const marketplaceAddress = await contract.getAddress();
  const deployments = {
    chainId: connectedChainId,
    PhilMarketplace: marketplaceAddress,
    PhilTestMint: ethers.getAddress(config.philTestMint),
    protocolFeeBps: 0,
    royaltyBps: config.royaltyBps,
    royaltyRecipient,
    owner: deployerAddress,
    paused: false,
  };

  const deploymentsDir = path.join(ROOT_DIR, 'deployments');
  const outPath = path.join(deploymentsDir, `marketplace_${connectedChainId}.json`);
  fs.mkdirSync(deploymentsDir, { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(deployments, null, 2));

  console.log(`PhilMarketplace: ${marketplaceAddress}`);
  console.log(`Deployment manifest written: ${outPath}`);
  console.log('\n' + '='.repeat(60));
  console.log(JSON.stringify(deployments, null, 2));
  console.log('='.repeat(60) + '\n');

  return deployments;
}

async function main() {
  dotenv.config();
  const config = readDeployMarketplaceConfig(process.env);
  await runDeployMarketplace(config);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`ERROR: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  });
}
