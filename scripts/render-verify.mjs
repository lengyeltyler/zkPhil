#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  getBaseSvg,
  normalizeSvgForComparison,
  renderPhil,
} from '../shared/phil-renderer/renderPhil.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, '..');
const OUT_DIR = path.join(ROOT_DIR, 'artifacts', 'fragments');
const OUT_FILE = path.join(OUT_DIR, 'render-verify.json');

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

function verify() {
  const results = [];
  for (let philId = 0; philId < 6; philId += 1) {
    const canonical = getBaseSvg(philId);
    const assembled = renderPhil(philId, 0, 0, 0);

    const normalizedCanonical = normalizeSvgForComparison(canonical);
    const normalizedAssembled = normalizeSvgForComparison(assembled);
    const coverage = tokenCoverage(tokenSet(normalizedCanonical), tokenSet(normalizedAssembled));

    results.push({
      philId,
      pass: coverage >= 0.93,
      coverage,
      canonicalLength: canonical.length,
      assembledLength: assembled.length,
      canonicalNormalizedLength: normalizedCanonical.length,
      assembledNormalizedLength: normalizedAssembled.length,
    });
  }

  return results;
}

async function main() {
  const results = verify();
  const failed = results.filter((result) => !result.pass);

  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(OUT_FILE, JSON.stringify({
    generatedAt: new Date().toISOString(),
    results,
    pass: failed.length === 0,
  }, null, 2));

  console.log('Render verification complete.');
  console.log(`  report: ${OUT_FILE}`);
  console.log(`  passed: ${results.length - failed.length}/${results.length}`);

  if (failed.length > 0) {
    console.error('  failed phil IDs:', failed.map((x) => x.philId).join(', '));
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
