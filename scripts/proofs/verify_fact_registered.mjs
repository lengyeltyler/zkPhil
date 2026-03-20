#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { ethers } from 'ethers';

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) {
      args[key] = true;
    } else {
      args[key] = next;
      i += 1;
    }
  }
  return args;
}

function loadFactsFromPackage(pkgPath) {
  const fullPath = path.resolve(pkgPath);
  if (!fs.existsSync(fullPath)) {
    throw new Error(`proof package not found: ${fullPath}`);
  }
  const payload = JSON.parse(fs.readFileSync(fullPath, 'utf8'));

  if (Array.isArray(payload.proofs)) {
    return payload.proofs.map((entry) => entry.factHash).filter(Boolean);
  }

  if (Array.isArray(payload.entries)) {
    return payload.entries.map((entry) => entry.factHash).filter(Boolean);
  }

  throw new Error('unsupported proof package schema: expected proofs[] or entries[] with factHash fields');
}

async function main() {
  const args = parseArgs(process.argv);

  const rpcUrl = args.rpc || process.env.RPC_URL || 'http://127.0.0.1:8545';
  const registryAddress = args.registry || process.env.FACT_REGISTRY || process.env.SHARP_FACT_REGISTRY;

  if (!registryAddress) {
    throw new Error('missing fact registry address (use --registry or FACT_REGISTRY)');
  }

  const facts = new Set();
  if (args.fact || process.env.FACT_HASH) {
    facts.add(args.fact || process.env.FACT_HASH);
  }

  if (args.package || process.env.PROOF_PACKAGE) {
    for (const fact of loadFactsFromPackage(args.package || process.env.PROOF_PACKAGE)) {
      facts.add(fact);
    }
  }

  if (facts.size === 0) {
    throw new Error('no facts provided (use --fact and/or --package)');
  }

  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const registry = new ethers.Contract(
    ethers.getAddress(registryAddress),
    ['function isValid(bytes32 fact) view returns (bool)'],
    provider
  );

  let ok = true;
  for (const fact of facts) {
    const normalized = ethers.zeroPadValue(fact, 32);
    const valid = await registry.isValid(normalized);
    console.log(`${valid ? 'FOUND' : 'MISSING'} ${normalized}`);
    if (!valid) ok = false;
  }

  if (!ok) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error.stack || error.message || String(error));
  process.exit(1);
});
