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
  const owner = normalizeStarknetFelt(
    usableValue(process.env.STARKNET_UNLOCK_OWNER_ADDRESS) || accountAddress,
    { allowZero: false }
  );
  const l1Recipient = usableValue(process.env.L1_UNLOCK_RECIPIENT);
  const normalizedRecipient = l1Recipient ? ethers.getAddress(l1Recipient) : '';
  const l1RecipientFelt = normalizedRecipient ? `0x${BigInt(normalizedRecipient).toString(16)}` : '0x0';

  const provider = new RpcProvider({ nodeUrl: rpcUrl });
  const account = new Account({
    provider,
    address: accountAddress,
    signer: privateKey,
  });

  const artifacts = readUnlockSenderArtifacts(ROOT_DIR);
  const existing = readStarknetAppBindings({ l1ChainId: SEPOLIA_CHAIN_ID, rootDir: ROOT_DIR });
  if (existing.exists && existing.contracts.unlockSender) {
    console.log(`Existing Starknet app binding already tracks unlock sender ${existing.contracts.unlockSender}.`);
  }

  const declaration = await account.declareIfNot({
    contract: artifacts.sierra,
    casm: artifacts.casm,
  });
  const classHash = declaration.class_hash || declaration.classHash;
  if (!classHash) {
    throw new Error('Starknet declaration returned no class hash.');
  }

  const contract = await Contract.factory({
    classHash,
    abi: artifacts.abi,
    account,
    constructorCalldata: {
      owner,
      l1_recipient: l1RecipientFelt,
    },
  });

  const manifestWrite = writeStarknetAppBindings({
    l1ChainId: SEPOLIA_CHAIN_ID,
    rootDir: ROOT_DIR,
    sourceScript: 'scripts/starknet/deploy_unlock_sender.mjs',
    unlockSender: contract.address,
    owner,
    l1Recipient: normalizedRecipient,
    notes: [
      'PhilUnlockSender is the app-specific Starknet contract that emits unlock ticket messages toward PhilUnlockInbox.',
      'Its payload format is zkphil-unlock-ticket-v1 with bytes32-hi-lo-128 constraints hash encoding.',
    ],
  });

  console.log('Starknet unlock sender deployed:');
  console.log(`  class hash:        ${classHash}`);
  console.log(`  contract address:  ${contract.address}`);
  console.log(`  owner:             ${owner}`);
  console.log(`  l1 recipient:      ${normalizedRecipient || '(unset)'}`);
  console.log(`  bindings manifest: ${manifestWrite.manifestPath}`);
}

main().catch((error) => {
  console.error(`ERROR: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
