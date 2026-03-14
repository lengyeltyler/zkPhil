// Verify a fact hash in an on-chain registry implementing isValid(bytes32).
// Backward-compatible wrapper around scripts/proofs/verify_fact_registered.mjs.

import dotenv from 'dotenv';
import { ethers } from 'ethers';

dotenv.config();

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i += 1) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const k = a.slice(2);
      const v = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true;
      args[k] = v;
    }
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv);
  const factHash = args.fact || process.env.FACT_HASH;
  const rpcUrl = process.env.RPC_URL || args.rpc || 'http://127.0.0.1:8545';
  const registryAddress =
    args.registry ||
    process.env.FACT_REGISTRY ||
    process.env.SHARP_FACT_REGISTRY;

  if (!factHash) {
    console.error('Missing fact hash. Pass --fact 0x... or set FACT_HASH.');
    process.exit(1);
  }
  if (!registryAddress) {
    console.error('Missing registry address. Pass --registry 0x... or set FACT_REGISTRY.');
    process.exit(1);
  }

  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const registry = new ethers.Contract(
    ethers.getAddress(registryAddress),
    ['function isValid(bytes32 fact) view returns (bool)'],
    provider
  );

  const valid = await registry.isValid(ethers.zeroPadValue(factHash, 32));
  console.log(valid ? 'FACT_VALID' : 'FACT_INVALID');
  process.exitCode = valid ? 0 : 1;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
