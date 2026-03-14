import dotenv from 'dotenv';
import { ethers } from 'ethers';
import path from 'path';

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

async function main() {
  loadEnv();

  const rpcUrl = requireEnv('RPC_URL');
  const privateKey = requireEnv('PRIVATE_KEY');

  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const wallet = new ethers.Wallet(privateKey, provider);
  const [network, nonce, balance] = await Promise.all([
    provider.getNetwork(),
    provider.getTransactionCount(wallet.address),
    provider.getBalance(wallet.address),
  ]);

  console.log(`Chain ID: ${network.chainId.toString()}`);
  console.log(`Deployer: ${wallet.address}`);
  console.log(`Nonce: ${nonce}`);
  console.log(`Balance: ${ethers.formatEther(balance)} ETH`);
}

main().catch((error) => {
  console.error(`ERROR: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
