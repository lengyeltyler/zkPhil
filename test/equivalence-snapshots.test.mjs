/**
 * Equivalence snapshot tests.
 *
 * These tests verify that the replica produces byte-for-byte identical outputs
 * to the original repo for a fixed set of test vectors.
 *
 * Golden snapshots were generated from the original repo and committed to:
 *   test/snapshots/golden.json
 *
 * To regenerate the golden file after intentional changes:
 *   node test/snapshots/gen_golden.mjs
 *
 * Any change to SVG output, slot ordering, palette bytes, or proof hashes
 * that causes these tests to fail MUST be treated as a high-risk regression
 * and investigated before merging.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import {
  renderPhil,
  buildMixedSlotOrder,
  buildPackedPaletteBytes,
} from '../shared/phil-renderer/renderPhil.mjs';
import { buildMerkleTree } from '../shared/proof/merkle.mjs';
import { computeClaimHash, computeFactHash } from '../shared/proof/localStarkProver.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const GOLDEN = JSON.parse(
  readFileSync(path.join(__dirname, 'snapshots', 'golden.json'), 'utf8')
);

// ─── SVG render equivalence ──────────────────────────────────────────────────

test('SVG renders match golden snapshots for all fixed test vectors', () => {
  const { svgSnapshots } = GOLDEN;

  for (const [key, snap] of Object.entries(svgSnapshots)) {
    const { philId, paletteVariant, mixMode, mixSeed } = snap;
    const svg = renderPhil(philId, paletteVariant, mixSeed, mixMode);
    const hash = createHash('sha256').update(svg).digest('hex');

    assert.equal(
      hash,
      snap.svgHash,
      `SVG hash mismatch for vector ${key}: philId=${philId} paletteVariant=${paletteVariant} mixMode=${mixMode} mixSeed=${mixSeed}`
    );
    assert.equal(
      svg.length,
      snap.svgLength,
      `SVG length mismatch for vector ${key}`
    );
    assert.ok(
      svg.startsWith(snap.svgPrefix),
      `SVG prefix mismatch for vector ${key}`
    );
  }
});

// ─── Slot order (mixing) equivalence ─────────────────────────────────────────

test('buildMixedSlotOrder matches golden snapshots for all fixed seeds and modes', () => {
  const { slotOrderSnapshots } = GOLDEN;
  const SLOT_COUNT = 11;

  for (const [key, expectedOrder] of Object.entries(slotOrderSnapshots)) {
    // Parse key: e.g. "phil0-mode1-seed111"
    const match = key.match(/^phil(\d+)-mode(\d+)-seed(\d+)$/);
    assert.ok(match, `Unexpected snapshot key format: ${key}`);
    const mixMode = Number(match[2]);
    const seed = Number(match[3]);

    const actualOrder = buildMixedSlotOrder(SLOT_COUNT, seed, mixMode);
    assert.deepEqual(
      actualOrder,
      expectedOrder,
      `Slot order mismatch for ${key}`
    );
  }
});

// ─── Palette bytes equivalence ───────────────────────────────────────────────

test('buildPackedPaletteBytes matches golden hashes for all 6 phils', () => {
  const { paletteSnapshots } = GOLDEN;

  for (const [philIdStr, expectedHash] of Object.entries(paletteSnapshots)) {
    const philId = Number(philIdStr);
    const bytes = buildPackedPaletteBytes(philId);
    const actualHash = createHash('sha256').update(bytes).digest('hex');
    assert.equal(
      actualHash,
      expectedHash,
      `Palette bytes hash mismatch for philId=${philId}`
    );
  }
});

// ─── Merkle tree equivalence ─────────────────────────────────────────────────

test('buildMerkleTree produces identical root and proofs for fixed address set', () => {
  const { merkleSnapshots } = GOLDEN;

  const ADDRESSES = [
    '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266',
    '0x70997970C51812dc3A010C7d01b50e0d17dc79C8',
    '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC',
    '0x90F79bf6EB2c4f870365E785982E1f101E93b906',
    '0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65',
  ];
  const tree = buildMerkleTree(ADDRESSES);

  assert.equal(tree.root, merkleSnapshots.root, 'Merkle root mismatch');
  assert.deepEqual(tree.leaves, merkleSnapshots.leaves, 'Merkle leaves mismatch');
  assert.deepEqual(
    tree.getProofByAddress(ADDRESSES[0]).proof,
    merkleSnapshots.proofFor0,
    'Merkle proof for address[0] mismatch'
  );
  assert.deepEqual(
    tree.getProofByAddress(ADDRESSES[2]).proof,
    merkleSnapshots.proofFor2,
    'Merkle proof for address[2] mismatch'
  );
});

// ─── Proof hash equivalence ───────────────────────────────────────────────────

test('computeClaimHash and computeFactHash match golden vectors', () => {
  const { proofSnapshots } = GOLDEN;

  const ADDRESSES = [
    '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266',
    '0x70997970C51812dc3A010C7d01b50e0d17dc79C8',
    '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC',
    '0x90F79bf6EB2c4f870365E785982E1f101E93b906',
    '0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65',
  ];
  const PROGRAM_HASH = '0x4444444444444444444444444444444444444444444444444444444444444444';
  const DROP_ID = 13n;
  const CHAIN_ID = 31337n;
  const PROOF_GATE = '0x1000000000000000000000000000000000000013';

  for (const addr of ADDRESSES.slice(0, 3)) {
    const key = addr.toLowerCase();
    const snap = proofSnapshots[key];
    assert.ok(snap, `No golden snapshot for address ${addr}`);

    const claimHash = computeClaimHash({
      programHash: PROGRAM_HASH,
      dropId: DROP_ID,
      chainId: CHAIN_ID,
      proofGateAddress: PROOF_GATE,
      recipient: addr, mintTo: addr, philId: 0, paletteVariant: 0,
      mixMode: 0, mixSeed: 0, expiry: 0,
    });
    const factHash = computeFactHash({ claimHash });

    assert.equal(claimHash, snap.claimHash, `claimHash mismatch for ${addr}`);
    assert.equal(factHash, snap.factHash, `factHash mismatch for ${addr}`);
  }
});

// ─── DSL encode/decode roundtrip stability ────────────────────────────────────

test('DSL encode/decode is stable across all fragment assets', async () => {
  // Dynamically import to avoid issues with top-level await
  const { buildOnchainRendererAssets, decodeDslV2, encodeDslV2 } = await import(
    '../shared/phil-renderer/renderPhil.mjs'
  );
  const assets = buildOnchainRendererAssets();

  for (const fragment of assets.fragments.filter((f) => f.isDsl)) {
    const decoded = decodeDslV2(fragment.bytes);
    assert.equal(
      decoded,
      fragment.content,
      `DSL round-trip failed for phil=${fragment.philId} slot=${fragment.slotIndex}`
    );

    // Re-encode and verify the result is identical bytes to original
    const reEncoded = encodeDslV2(decoded);
    assert.deepEqual(
      Buffer.from(reEncoded),
      Buffer.from(fragment.bytes),
      `Re-encoded DSL differs for phil=${fragment.philId} slot=${fragment.slotIndex}`
    );
  }
});
