import dotenv from 'dotenv';
import { ethers } from 'ethers';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { Account, Contract, RpcProvider } from 'starknet';

import {
  readStarknetAppBindings,
  writeStarknetAppBindings,
} from '../../shared/deploy/starknetAppBindings.mjs';
import { normalizeStarknetFelt } from '../../shared/deploy/starknetFelt.mjs';
import { readUnlockSenderArtifacts } from '../../shared/deploy/unlockSenderArtifacts.mjs';
import {
  MUTABLE_STACK_ACCOUNT_ABSTRACTION,
  readMutableStackManifest,
} from '../../shared/deploy/mutableStackManifest.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, '..', '..');
const SEPOLIA_CHAIN_ID = 11155111;

function usableValue(value) {
  const raw = String(value || '').trim();
  if (!raw) {
    return '';
  }
  const lowered = raw.toLowerCase();
  if (lowered.includes('your_') || lowered.includes('placeholder') || lowered.includes('example')) {
    return '';
  }
  return raw;
}

function requireEnv(label, value) {
  const raw = usableValue(value);
  if (!raw) {
    throw new Error(`${label} must be set explicitly.`);
  }
  return raw;
}

function resolveRpcUrl(env) {
  return usableValue(env.STARKNET_RPC_URL) || usableValue(env.STARKNET_RPC_URL_SEPOLIA);
}

async function main() {
  dotenv.config();

  const rpcUrl = requireEnv('STARKNET_RPC_URL or STARKNET_RPC_URL_SEPOLIA', resolveRpcUrl(process.env));
  const accountAddress = requireEnv('STARKNET_ACCOUNT_ADDRESS', process.env.STARKNET_ACCOUNT_ADDRESS);
  const privateKey = requireEnv('STARKNET_PRIVATE_KEY', process.env.STARKNET_PRIVATE_KEY);

  const bindings = readStarknetAppBindings({ l1ChainId: SEPOLIA_CHAIN_ID, rootDir: ROOT_DIR });
  if (!bindings.exists || !bindings.contracts.unlockSender) {
    throw new Error(
      `Starknet unlock sender binding is missing. Run \`npm run starknet:deploy-unlock-sender\` first.`
    );
  }

  const aaDeployment = readMutableStackManifest({
    stack: MUTABLE_STACK_ACCOUNT_ABSTRACTION,
    chainId: SEPOLIA_CHAIN_ID,
    rootDir: ROOT_DIR,
  });
  const recipient = usableValue(process.env.L1_UNLOCK_RECIPIENT) ||
    aaDeployment.components.PhilUnlockInbox ||
    aaDeployment.raw?.PhilUnlockInbox ||
    '';
  if (!recipient) {
    throw new Error(
      'L1_UNLOCK_RECIPIENT is unset and deployments/4337_11155111.json does not yet track PhilUnlockInbox.'
    );
  }
  const normalizedRecipient = ethers.getAddress(recipient);

  const provider = new RpcProvider({ nodeUrl: rpcUrl });
  const account = new Account({
    provider,
    address: accountAddress,
    signer: privateKey,
  });
  const artifacts = readUnlockSenderArtifacts(ROOT_DIR);
  const contract = new Contract({
    abi: artifacts.abi,
    address: bindings.contracts.unlockSender,
    providerOrAccount: account,
  });

  const response = await contract.invoke(
    'set_l1_recipient',
    {
      new_l1_recipient: `0x${BigInt(normalizedRecipient).toString(16)}`,
    },
    { waitForTransaction: true }
  );

  const manifestWrite = writeStarknetAppBindings({
    l1ChainId: SEPOLIA_CHAIN_ID,
    rootDir: ROOT_DIR,
    sourceScript: 'scripts/starknet/set_unlock_sender_recipient.mjs',
    unlockSender: bindings.contracts.unlockSender,
    owner: bindings.contracts.owner || normalizeStarknetFelt(accountAddress, { allowZero: false }),
    l1Recipient: normalizedRecipient,
    notes: bindings.raw?.notes || [],
  });

  console.log('Updated Starknet unlock sender recipient:');
  console.log(`  unlock sender:     ${bindings.contracts.unlockSender}`);
  console.log(`  l1 recipient:      ${normalizedRecipient}`);
  console.log(`  transaction hash:  ${response.transaction_hash || response.transactionHash || '(unknown)'}`);
  console.log(`  bindings manifest: ${manifestWrite.manifestPath}`);
}

main().catch((error) => {
  console.error(`ERROR: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
