#!/usr/bin/env node
import {
  getDropEntries,
  loadAllowlistStore,
  normalizeInputDropId,
  requireAllowlistPath,
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
  const dropId = normalizeInputDropId(readArg('--drop') || '13');
  const store = loadAllowlistStore(filePath, dropId);
  const entries = getDropEntries(store, dropId);

  const addresses = Object.keys(entries).sort();
  const summary = {
    ok: true,
    file: filePath,
    dropId,
    totalAddresses: addresses.length,
    totalRemaining: addresses.reduce((sum, address) => sum + entries[address].remaining, 0),
    totalConsumed: addresses.reduce((sum, address) => sum + entries[address].consumed, 0),
    entries: addresses.map((address) => ({
      address,
      remaining: entries[address].remaining,
      consumed: entries[address].consumed,
    })),
  };

  console.log(JSON.stringify(summary, null, 2));
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
