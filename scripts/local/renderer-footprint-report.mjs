#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildOnchainRendererAssets } from '../../shared/phil-renderer/renderPhil.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, '..', '..');
const OUT_FILE = path.join(ROOT_DIR, 'artifacts', 'renderer-footprint-report.json');
const CHUNK_SIZE = 24_000;

function chunkCountForBytes(byteLength, chunkSize = CHUNK_SIZE) {
  if (byteLength <= 0) return 0;
  return Math.ceil(byteLength / chunkSize);
}

async function main() {
  const assets = buildOnchainRendererAssets();

  const fragmentRows = assets.fragments.map((fragment) => ({
    philId: fragment.philId,
    slotIndex: fragment.slotIndex,
    slotKey: fragment.slotKey,
    isDsl: fragment.isDsl,
    rawBytes: fragment.rawBytes,
    encodedBytes: fragment.encodedBytes,
    chunkWrites: chunkCountForBytes(fragment.encodedBytes),
  }));

  const perPhil = Array.from({ length: 6 }, (_, philId) => {
    const rows = fragmentRows.filter((row) => row.philId === philId);
    return {
      philId,
      fragmentCount: rows.length,
      rawBytes: rows.reduce((sum, row) => sum + row.rawBytes, 0),
      encodedBytes: rows.reduce((sum, row) => sum + row.encodedBytes, 0),
      chunkWrites: rows.reduce((sum, row) => sum + row.chunkWrites, 0),
    };
  });

  const totalFragmentChunkWrites = fragmentRows.reduce((sum, row) => sum + row.chunkWrites, 0);
  const paletteWrites = assets.palettePackedByPhil.length;

  const hotspots = fragmentRows
    .slice()
    .sort((a, b) => b.encodedBytes - a.encodedBytes)
    .slice(0, 10);

  const report = {
    generatedAt: new Date().toISOString(),
    method: 'static fragment + palette asset analysis',
    chunkSize: CHUNK_SIZE,
    fragmentBytes: {
      totalRaw: assets.stats.totalRawFragmentBytes,
      totalEncoded: assets.stats.totalEncodedFragmentBytes,
      perPhil,
      perFragment: fragmentRows,
      dslFragmentCount: assets.stats.dslFragmentCount,
    },
    paletteBytes: {
      total: assets.stats.paletteBytes,
      perPhil: assets.palettePackedByPhil.map((bytes, philId) => ({
        philId,
        bytes: bytes.length,
        slotCount: assets.paletteSlotCounts[philId],
      })),
      paletteWrites,
    },
    deploymentStorageWrites: {
      fragmentChunkWrites: totalFragmentChunkWrites,
      paletteWrites,
      total: totalFragmentChunkWrites + paletteWrites,
    },
    mintStorageWritesEstimate: {
      proofGateNullifier: 1,
      totalSupply: 1,
      tokenParamSlots: 4,
      erc721Ownership: 1,
      erc721Balance: 1,
      estimatedTotal: 8,
      note: 'Assumes one mint writes nullifier + 4 token params + ERC721 owner/balance + totalSupply',
    },
    gasHotspots: {
      largestFragmentsByEncodedBytes: hotspots,
      note: 'Largest fragment payloads dominate render memory and string concat work.',
    },
  };

  fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });
  fs.writeFileSync(OUT_FILE, JSON.stringify(report, null, 2));

  console.log('Renderer footprint report generated.');
  console.log(`  file: ${OUT_FILE}`);
  console.log(`  fragment raw bytes total: ${report.fragmentBytes.totalRaw}`);
  console.log(`  fragment encoded bytes total: ${report.fragmentBytes.totalEncoded}`);
  console.log(`  palette bytes total: ${report.paletteBytes.total}`);
  console.log(`  deploy writes total: ${report.deploymentStorageWrites.total}`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
