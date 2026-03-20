// Compute Cairo program hash locally using Pedersen hash chain.
// Mirrors the algorithm from cairo-lang's hash_program.py:
//   data_chain = [bootloader_version, main, len(builtins), ...builtins_as_felts, ...bytecode]
//   program_hash = hash_chain([len(data_chain)] + data_chain)
//   where hash_chain([a,b,c,...,n]) = h(a, h(b, h(c, ... h(m, n))))
//
// Usage:
//   node scripts/compute_program_hash.mjs [--file path/to/executable.json]

import fs from 'node:fs';
import path from 'node:path';
import { hash } from 'starknet';

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const k = a.slice(2);
      const v = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true;
      args[k] = v;
    }
  }
  return args;
}

// Convert an ASCII string to a felt (big-endian integer), matching Python's from_bytes.
const STARK_PRIME = 2n ** 251n + 17n * 2n ** 192n + 1n;

// Convert an ASCII string to a felt (big-endian integer), matching Python's from_bytes.
function asciiToFelt(s) {
  let result = 0n;
  for (let i = 0; i < s.length; i++) {
    result = (result << 8n) | BigInt(s.charCodeAt(i));
  }
  return result;
}

// Pedersen hash chain: h(data[0], h(data[1], h(..., h(data[n-2], data[n-1]))))
function computeHashChain(data) {
  if (data.length < 2) {
    throw new Error('hash chain requires at least 2 elements');
  }
  let acc = data[data.length - 1];
  for (let i = data.length - 2; i >= 0; i--) {
    acc = BigInt(hash.computePedersenHash(data[i].toString(), acc.toString()));
  }
  return acc;
}

function main() {
  const args = parseArgs(process.argv);
  const filePath = args.file || 'cairo/target/dev/phil_eligibility.executable.json';
  const absPath = path.resolve(filePath);

  if (!fs.existsSync(absPath)) {
    console.error(`File not found: ${absPath}`);
    process.exit(1);
  }

  const raw = JSON.parse(fs.readFileSync(absPath, 'utf8'));
  const bytecode = raw.program.bytecode;

  // Use the Standalone entrypoint (kind: "Standalone")
  const standalone = raw.entrypoints?.find(e => e.kind === 'Standalone');
  if (!standalone) {
    console.error('No Standalone entrypoint found in executable.');
    process.exit(1);
  }

  const mainOffset = BigInt(standalone.offset);
  const builtins = standalone.builtins || [];
  const builtinFelts = builtins.map(b => asciiToFelt(b));
  const bootloaderVersion = 0n;

  // Build data chain: [bootloader_version, main, len(builtins), ...builtins, ...bytecode]
  const dataChain = [
    bootloaderVersion,
    mainOffset,
    BigInt(builtins.length),
    ...builtinFelts,
    ...bytecode.map(b => {
      // Handle negative hex values (relative jump offsets like "-0x18")
      if (b.startsWith('-')) {
        return STARK_PRIME - BigInt(b.slice(1));
      }
      return BigInt(b);
    }),
  ];

  // Pedersen hash chain over [len(dataChain), ...dataChain]
  const fullChain = [BigInt(dataChain.length), ...dataChain];
  const programHash = computeHashChain(fullChain);

  const hexHash = '0x' + programHash.toString(16).padStart(64, '0');
  console.log(hexHash);
}

main();
