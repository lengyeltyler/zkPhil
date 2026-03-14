#!/usr/bin/env node
import {
  getDropEntries,
  loadAllowlistStore,
  normalizeInputAddress,
  normalizeInputDropId,
  requireAllowlistPath,
  writeAllowlistStore,
} from './allowlist_lib.mjs';

function readArg(flag) {
  const index = process.argv.indexOf(flag);
  if (index === -1 || index + 1 >= process.argv.length) {
    return '';
  }
  return process.argv[index + 1];
}

function main() {
  const filePath = requireAllowlistPath();
  const rawDropId = readArg('--drop') || '13';
  const rawAddress = readArg('--address');
  const rawMints = readArg('--mints') || '1';

  if (!rawAddress) {
    throw new Error('Usage: node scripts/allowlist_add.mjs --drop 13 --address 0x... --mints 1');
  }

  const dropId = normalizeInputDropId(rawDropId);
  const address = normalizeInputAddress(rawAddress);
  const mints = Number(rawMints);
  if (!Number.isInteger(mints) || mints < 1) {
    throw new Error(`--mints must be a positive integer. Received: ${rawMints}`);
  }

  const store = loadAllowlistStore(filePath, dropId);
  const entries = getDropEntries(store, dropId);
  const current = entries[address] || { remaining: 0, consumed: 0 };

  entries[address] = {
    remaining: current.remaining + mints,
    consumed: current.consumed,
  };

  writeAllowlistStore(filePath, store);

  console.log(
    JSON.stringify(
      {
        ok: true,
        file: filePath,
        dropId,
        address,
        remaining: entries[address].remaining,
        consumed: entries[address].consumed,
      },
      null,
      2
    )
  );
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
