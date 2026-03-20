#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { renderPhil } from '../shared/phil-renderer/renderPhil.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, '..');
const outDir = path.join(ROOT_DIR, 'artifacts', 'rendered-phils');

fs.mkdirSync(outDir, { recursive: true });

for (let philId = 0; philId < 6; philId += 1) {
  for (let variant = 0; variant < 9; variant += 1) {
    const svg = renderPhil(philId, variant);
    const filename = `phil-${philId}-palette-${variant}.svg`;
    const filePath = path.join(outDir, filename);
    fs.writeFileSync(filePath, svg);
    process.stdout.write(`wrote ${filePath}\n`);
  }
}

process.stdout.write(`\nRendered 54 SVGs to ${outDir}\n`);
