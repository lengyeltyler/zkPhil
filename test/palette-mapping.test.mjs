import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import assert from 'node:assert/strict';

import { getPaletteSpec } from '../shared/phil-renderer/renderPhil.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, '..');

const spec = getPaletteSpec();

function sourceSvg(philId) {
  const philDir = path.join(ROOT_DIR, 'Layers', `Phil${philId}`);
  const layeredSource = fs.existsSync(philDir)
    ? fs.readdirSync(philDir)
        .filter((name) => name.endsWith('.svg'))
        .sort()
        .map((name) => fs.readFileSync(path.join(philDir, name), 'utf8'))
        .join('\n')
    : '';
  const rootSource = fs.readFileSync(path.join(ROOT_DIR, 'Layers', `Phil${philId}.svg`), 'utf8');
  return `${rootSource}\n${layeredSource}`.toLowerCase();
}

test('palette spec has 6 phils and 9 variants each with full slot coverage', () => {
  assert.equal(spec.variantCount, 9);
  assert.equal(Object.keys(spec.phils).length, 6);

  for (let philId = 0; philId < 6; philId += 1) {
    const phil = spec.phils[String(philId)];
    assert.ok(phil, `missing phil ${philId}`);
    assert.ok(Array.isArray(phil.lockedColors), `lockedColors missing for phil ${philId}`);
    assert.ok(Array.isArray(phil.mutableColors), `mutableColors missing for phil ${philId}`);

    const source = sourceSvg(philId);
    assert.ok(phil.mutableColors.length > 0, `no mutable slots for phil ${philId}`);
    assert.ok(source.length > 0, `missing source svg data for phil ${philId}`);

    for (const color of phil.mutableColors) {
      assert.ok(/^#[0-9a-f]{6}$/.test(color), `mutable color not normalized: ${color}`);
      assert.equal(phil.lockedColors.includes(color), false, `color cannot be both mutable and locked: ${color}`);
    }

    for (const color of phil.lockedColors) {
      assert.ok(/^#[0-9a-f]{6}$/.test(color), `locked color not normalized: ${color}`);
    }

    for (let variant = 0; variant < 9; variant += 1) {
      const colors = phil.variants[String(variant)];
      assert.ok(Array.isArray(colors), `missing variant ${variant} for phil ${philId}`);
      assert.equal(colors.length, phil.mutableColors.length, `variant ${variant} coverage mismatch for phil ${philId}`);
      for (const color of colors) {
        assert.ok(/^#[0-9a-f]{6}$/.test(color), `invalid color ${color} in phil ${philId} variant ${variant}`);
      }
    }

    assert.deepEqual(
      phil.variants['0'],
      phil.mutableColors,
      `variant 0 must exactly match canonical mutable slots for phil ${philId}`
    );
  }
});

test('variants 1..8 remain phil-specific (no universal palette reuse)', () => {
  for (let variant = 1; variant < 9; variant += 1) {
    const serialized = [];
    for (let philId = 0; philId < 6; philId += 1) {
      serialized.push(JSON.stringify(spec.phils[String(philId)].variants[String(variant)]));
    }
    assert.equal(new Set(serialized).size, 6, `variant ${variant} unexpectedly reused between phils`);
  }
});
