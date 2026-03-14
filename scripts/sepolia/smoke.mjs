import fs from 'fs';
import dotenv from 'dotenv';
import { ethers } from 'ethers';
import path from 'path';
import { fileURLToPath } from 'url';

const SEPOLIA_CHAIN_ID = 11155111;
const MIN_BALANCE_WEI = ethers.parseEther('0.02');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, '..', '..');

function loadEnv() {
  const configuredPath = String(process.env.DOTENV_CONFIG_PATH || '').trim();
  const envPath = configuredPath
    ? path.resolve(process.cwd(), configuredPath)
    : path.join(process.cwd(), '.env');
  dotenv.config({ path: envPath });
}

function requireEnv(name) {
  const value = String(process.env[name] || '').trim();
  if (!value) {
    throw new Error(`${name} must be set explicitly in environment.`);
  }
  return value;
}

function formatStatus(filePath, label, optional = false) {
  const exists = fs.existsSync(filePath);
  const state = exists ? 'present' : optional ? 'missing (optional until deployed)' : 'missing';
  return `${label}: ${state}`;
}

async function main() {
  loadEnv();

  const rpcUrl = requireEnv('RPC_URL');
  const chainIdRaw = requireEnv('CHAIN_ID');
  const privateKey = requireEnv('PRIVATE_KEY');
  const allowlistSignerKey = requireEnv('ALLOWLIST_SIGNER_KEY');
  const paymasterSignerKey = requireEnv('PAYMASTER_SIGNER_KEY');

  const expectedChainId = Number(chainIdRaw);
  if (!Number.isInteger(expectedChainId) || expectedChainId !== SEPOLIA_CHAIN_ID) {
    throw new Error(`CHAIN_ID must be ${SEPOLIA_CHAIN_ID} for Sepolia smoke checks.`);
  }

  const deployer = new ethers.Wallet(privateKey);
  const allowlistSigner = new ethers.Wallet(allowlistSignerKey);
  const paymasterSigner = new ethers.Wallet(paymasterSignerKey);

  console.log(`Expected Chain ID: ${expectedChainId}`);
  console.log(`Deployer: ${deployer.address}`);
  console.log(`Allowlist Signer: ${allowlistSigner.address}`);
  console.log(`Paymaster Signer: ${paymasterSigner.address}`);

  const provider = new ethers.JsonRpcProvider(rpcUrl);

  let network;
  try {
    network = await provider.getNetwork();
  } catch (error) {
    throw new Error(
      `RPC connectivity failed: ${error instanceof Error ? error.message : String(error)}`
    );
  }

  const connectedChainId = Number(network.chainId);
  console.log(`RPC Chain ID: ${connectedChainId}`);
  if (connectedChainId !== expectedChainId) {
    console.warn(
      `WARNING: RPC chain mismatch. Connected chainId=${connectedChainId}, expected ${expectedChainId}.`
    );
  }

  const balance = await provider.getBalance(deployer.address);
  console.log(`Deployer Balance: ${ethers.formatEther(balance)} ETH`);
  if (balance === 0n) {
    console.error('ERROR: Deployer balance is 0 ETH.');
    process.exit(1);
  }
  if (balance < MIN_BALANCE_WEI) {
    console.warn(
      `WARNING: Deployer balance is below 0.02 ETH (${ethers.formatEther(balance)} ETH).`
    );
  }

  const chainSuffix = String(expectedChainId);
  console.log('Deployment Files:');
  console.log(
    `  ${formatStatus(path.join(ROOT_DIR, 'deployments', `stark_${chainSuffix}.json`), 'stark')}`
  );
  console.log(
    `  ${formatStatus(path.join(ROOT_DIR, 'deployments', `4337_${chainSuffix}.json`), '4337', true)}`
  );
  console.log(
    `  ${formatStatus(
      path.join(ROOT_DIR, 'deployments', `marketplace_${chainSuffix}.json`),
      'marketplace',
      true
    )}`
  );
}

main().catch((error) => {
  console.error(`ERROR: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
