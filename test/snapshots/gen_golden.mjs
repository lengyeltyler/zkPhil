import { renderPhil, buildMixedSlotOrder, buildPackedPaletteBytes, encodeDslV2, decodeDslV2, buildOnchainRendererAssets } from '../../shared/phil-renderer/renderPhil.mjs';
import { createHash } from 'node:crypto';
import { buildMerkleTree } from '../../shared/proof/merkle.mjs';
import { computeClaimHash, computeFactHash } from '../../shared/proof/localStarkProver.mjs';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const VECTORS = [
  { philId: 0, paletteVariant: 0, mixMode: 0, mixSeed: 0 },
  { philId: 0, paletteVariant: 4, mixMode: 1, mixSeed: 123456789 },
  { philId: 1, paletteVariant: 0, mixMode: 0, mixSeed: 0 },
  { philId: 2, paletteVariant: 7, mixMode: 2, mixSeed: 2654435769 },
  { philId: 3, paletteVariant: 8, mixMode: 0, mixSeed: 0 },
  { philId: 4, paletteVariant: 1, mixMode: 2, mixSeed: 654321 },
  { philId: 5, paletteVariant: 5, mixMode: 1, mixSeed: 999999 },
];

const svgSnapshots = {};
for (const v of VECTORS) {
  const key = `${v.philId}-${v.paletteVariant}-${v.mixMode}-${v.mixSeed}`;
  const svg = renderPhil(v.philId, v.paletteVariant, v.mixSeed, v.mixMode);
  svgSnapshots[key] = {
    ...v,
    svgHash: createHash('sha256').update(svg).digest('hex'),
    svgLength: svg.length,
    svgPrefix: svg.slice(0, 80),
  };
}

const slotOrderSnapshots = {};
for (const philId of [0, 1, 2, 3, 4, 5]) {
  for (const mixMode of [1, 2]) {
    for (const seed of [111, 999, 2654435769, 42, 12345, 987654321]) {
      const key = `phil${philId}-mode${mixMode}-seed${seed}`;
      slotOrderSnapshots[key] = buildMixedSlotOrder(11, seed, mixMode);
    }
  }
}

const ADDRESSES = [
  '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266',
  '0x70997970C51812dc3A010C7d01b50e0d17dc79C8',
  '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC',
  '0x90F79bf6EB2c4f870365E785982E1f101E93b906',
  '0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65',
];
const tree = buildMerkleTree(ADDRESSES);
const merkleSnapshots = {
  root: tree.root,
  leaves: tree.leaves,
  proofFor0: tree.getProofByAddress(ADDRESSES[0]).proof,
  proofFor2: tree.getProofByAddress(ADDRESSES[2]).proof,
};

const paletteSnapshots = {};
for (const philId of [0, 1, 2, 3, 4, 5]) {
  const bytes = buildPackedPaletteBytes(philId);
  paletteSnapshots[String(philId)] = createHash('sha256').update(bytes).digest('hex');
}

const PROGRAM_HASH = '0x4444444444444444444444444444444444444444444444444444444444444444';
const DROP_ID = 13n;
const CHAIN_ID = 31337n;
const PROOF_GATE = '0x1000000000000000000000000000000000000013';
const proofSnapshots = {};
for (const addr of ADDRESSES.slice(0, 3)) {
  const key = addr.toLowerCase();
  const claimHash = computeClaimHash({
    programHash: PROGRAM_HASH,
    dropId: DROP_ID,
    chainId: CHAIN_ID,
    proofGateAddress: PROOF_GATE,
    recipient: addr, mintTo: addr, philId: 0, paletteVariant: 0,
    mixMode: 0, mixSeed: 0, expiry: 0,
  });
  const factHash = computeFactHash({ claimHash });
  proofSnapshots[key] = { claimHash, factHash };
}

writeFileSync(path.join(__dirname, 'golden.json'), JSON.stringify({
  _note: 'DO NOT EDIT. Re-generate with: node test/snapshots/gen_golden.mjs',
  svgSnapshots, slotOrderSnapshots, merkleSnapshots, paletteSnapshots, proofSnapshots,
}, null, 2));
console.log('Golden snapshots written.');
