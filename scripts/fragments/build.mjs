#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  buildOnchainRendererAssets,
  getBaseSvg,
  normalizeSvgForComparison,
  renderPhil,
} from '../../shared/phil-renderer/renderPhil.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, '..', '..');
const OUT_DIR = path.join(ROOT_DIR, 'artifacts', 'fragments');
const OUT_FILE = path.join(OUT_DIR, 'build-manifest.json');

function hexFromBytes(bytesLike) {
  return `0x${Buffer.from(bytesLike).toString('hex')}`;
}

function tokenSet(normalizedSvg) {
  return new Set(
    normalizedSvg
      .split(/></g)
      .map((item) => item.trim())
      .filter(Boolean)
  );
}

function tokenCoverage(reference, candidate) {
  let common = 0;
  for (const token of reference) {
    if (candidate.has(token)) {
      common += 1;
    }
  }
  return reference.size === 0 ? 1 : common / reference.size;
}

function buildGoldenChecks() {
  const checks = [];
  for (let philId = 0; philId < 6; philId += 1) {
    const canonical = getBaseSvg(philId);
    const assembled = renderPhil(philId, 0, 0, 0);
    const normalizedCanonical = normalizeSvgForComparison(canonical);
    const normalizedAssembled = normalizeSvgForComparison(assembled);
    const coverage = tokenCoverage(tokenSet(normalizedCanonical), tokenSet(normalizedAssembled));

    checks.push({
      philId,
      normalizedMatch: coverage >= 0.93,
      coverage,
      canonicalLength: canonical.length,
      assembledLength: assembled.length,
      canonicalNormalizedLength: normalizedCanonical.length,
      assembledNormalizedLength: normalizedAssembled.length,
    });
  }
  return checks;
}

async function main() {
  const assets = buildOnchainRendererAssets();
  const goldenChecks = buildGoldenChecks();

  const manifest = {
    generatedAt: new Date().toISOString(),
    sourceLayersRoot: 'Layers/',
    philCount: assets.philCount,
    slotCount: assets.slotCount,
    paletteVariantCount: assets.paletteVariantCount,
    slotLayout: assets.slotLayout,
    stats: assets.stats,
    fragments: assets.fragments.map((fragment) => ({
      philId: fragment.philId,
      slotIndex: fragment.slotIndex,
      slotKey: fragment.slotKey,
      sourceFile: fragment.file,
      isDsl: fragment.isDsl,
      rawBytes: fragment.rawBytes,
      encodedBytes: fragment.encodedBytes,
      payloadHex: hexFromBytes(fragment.bytes),
    })),
    palettePacked: assets.palettePackedByPhil.map((paletteBytes, philId) => ({
      philId,
      slotCount: assets.paletteSlotCounts[philId],
      bytes: paletteBytes.length,
      payloadHex: hexFromBytes(paletteBytes),
    })),
    goldenChecks,
  };

  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(OUT_FILE, JSON.stringify(manifest, null, 2));

  const failed = goldenChecks.filter((check) => !check.normalizedMatch);

  console.log('Fragments build completed.');
  console.log(`  manifest: ${OUT_FILE}`);
  console.log(`  fragments: ${manifest.fragments.length}`);
  console.log(`  dsl fragments: ${assets.stats.dslFragmentCount}`);
  console.log(`  raw bytes: ${assets.stats.totalRawFragmentBytes}`);
  console.log(`  encoded bytes: ${assets.stats.totalEncodedFragmentBytes}`);
  console.log(`  palettes bytes: ${assets.stats.paletteBytes}`);
  console.log(`  golden checks: ${goldenChecks.length - failed.length}/${goldenChecks.length} passed`);

  if (failed.length > 0) {
    console.error('  golden mismatches:', failed.map((x) => x.philId).join(', '));
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
