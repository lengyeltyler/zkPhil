#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ACTIVE_PATHS = [
  'contracts',
  'server-ts/src',
  'frontend',
  'shared',
  'scripts/deploy_4337.mjs',
  'scripts/deploy_stark.mjs',
  'scripts/simulate_userop.mjs',
  'scripts/check_no_legacy_rails.mjs',
  'package.json',
  'server-ts/package.json',
  'hardhat.config.cjs',
];

const DISALLOWED_PATTERNS = [
  { label: 'legacy Merkle witness field', regex: /\bmerkleProof\b/ },
  { label: 'legacy Merkle root constant', regex: /\bMERKLE_ROOT\b/ },
  { label: 'obsolete proof mode', regex: /\bBACKEND_SIGNER_MINT_HYBRID\b/ },
  {
    label: 'legacy no-proof factory signature',
    regex: /createPhilAccount\(address owner,\s*uint256 starkPubKeyX\)(?!,)/,
  },
  { label: 'legacy frontend proof API', regex: /\/api\/proof\b/ },
];

function listFiles(targetPath) {
  const fullPath = path.join(ROOT_DIR, targetPath);
  if (!fs.existsSync(fullPath)) {
    return [];
  }

  const stat = fs.statSync(fullPath);
  if (stat.isFile()) {
    return [fullPath];
  }

  const out = [];
  const stack = [fullPath];
  while (stack.length > 0) {
    const current = stack.pop();
    const entries = fs.readdirSync(current, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === 'archive' || entry.name === 'deprecated') {
        continue;
      }
      const entryPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(entryPath);
      } else {
        out.push(entryPath);
      }
    }
  }
  return out;
}

const violations = [];
for (const targetPath of ACTIVE_PATHS) {
  for (const filePath of listFiles(targetPath)) {
    const content = fs.readFileSync(filePath, 'utf8');
    for (const pattern of DISALLOWED_PATTERNS) {
      if (pattern.regex.test(content)) {
        violations.push({
          filePath: path.relative(ROOT_DIR, filePath),
          label: pattern.label,
        });
      }
    }
  }
}

if (violations.length > 0) {
  console.error('Legacy rails detected in active paths:');
  for (const violation of violations) {
    console.error(`- ${violation.filePath}: ${violation.label}`);
  }
  process.exit(1);
}

console.log('No legacy Merkle/no-proof rails detected in active paths.');
