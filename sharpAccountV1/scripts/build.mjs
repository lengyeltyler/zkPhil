import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { ethers } from 'ethers';

import { PROGRAM_JSON, SHARP_ROOT, ensureDir } from './common.mjs';

const CAIRO_DIR = path.join(SHARP_ROOT, 'cairo');
const CAIRO_SOURCE = path.join(CAIRO_DIR, 'account_intent.cairo');
const CAIRO_SRC_DIR = path.join(CAIRO_DIR, 'src');
const CAIRO_MIRROR_SOURCE = path.join(CAIRO_SRC_DIR, 'account_intent.cairo');
const CAIRO_LIB_SOURCE = path.join(CAIRO_SRC_DIR, 'lib.cairo');
const CONTRACT_PATH = path.join(SHARP_ROOT, 'contracts', 'SharpAccount.sol');

function commandExists(command) {
  const probe = spawnSync('sh', ['-lc', `command -v ${command}`], { encoding: 'utf8' });
  return probe.status === 0;
}

function findFirstSierraFile(targetDir) {
  if (!fs.existsSync(targetDir)) return null;
  const queue = [targetDir];
  while (queue.length > 0) {
    const next = queue.pop();
    const items = fs.readdirSync(next, { withFileTypes: true });
    for (const item of items) {
      const full = path.join(next, item.name);
      if (item.isDirectory()) {
        queue.push(full);
      } else if (item.isFile() && item.name.endsWith('.sierra.json')) {
        return full;
      }
    }
  }
  return null;
}

function updateProgramHashInContract(programHash) {
  const source = fs.readFileSync(CONTRACT_PATH, 'utf8');
  const pattern = /(bytes32\s+public\s+constant\s+PROGRAM_HASH\s*=\s*)(0x[a-fA-F0-9]{64})/;
  const match = source.match(pattern);
  if (!match) {
    throw new Error(`Unable to update PROGRAM_HASH in ${CONTRACT_PATH}`);
  }
  if (match[2].toLowerCase() === programHash.toLowerCase()) {
    return;
  }
  const updated = source.replace(pattern, `$1${programHash}`);
  fs.writeFileSync(CONTRACT_PATH, updated);
}

function ensureCairoMirror() {
  ensureDir(CAIRO_SRC_DIR);
  const source = fs.readFileSync(CAIRO_SOURCE, 'utf8');
  fs.writeFileSync(CAIRO_MIRROR_SOURCE, source);
  if (!fs.existsSync(CAIRO_LIB_SOURCE)) {
    fs.writeFileSync(CAIRO_LIB_SOURCE, 'mod account_intent;\n');
  }
}

export function buildSharpProgram() {
  ensureDir(path.join(SHARP_ROOT, 'artifacts'));
  ensureCairoMirror();

  const sourceBytes = fs.readFileSync(CAIRO_SOURCE);
  const sourceHash = ethers.keccak256(sourceBytes);
  let programHash = sourceHash;
  let compiled = false;
  let compiler = 'source-hash-fallback';
  let sierraPath = null;

  if (commandExists('scarb')) {
    const build = spawnSync(
      'scarb',
      ['build', '--manifest-path', path.join(CAIRO_DIR, 'Scarb.toml')],
      { encoding: 'utf8' }
    );
    if (build.status !== 0) {
      const message = `${build.stdout || ''}\n${build.stderr || ''}`.trim();
      throw new Error(`scarb build failed:\n${message}`);
    }

    sierraPath = findFirstSierraFile(path.join(CAIRO_DIR, 'target', 'dev'));
    if (!sierraPath) {
      throw new Error('scarb build completed but no .sierra.json output was found');
    }
    programHash = ethers.keccak256(fs.readFileSync(sierraPath));
    compiled = true;
    compiler = 'scarb';
  }

  updateProgramHashInContract(programHash);

  const metadata = {
    generatedAt: new Date().toISOString(),
    compiler,
    compiled,
    cairoSource: path.relative(SHARP_ROOT, CAIRO_SOURCE),
    sierraPath: sierraPath ? path.relative(SHARP_ROOT, sierraPath) : null,
    sourceHash,
    programHash,
  };
  fs.writeFileSync(PROGRAM_JSON, JSON.stringify(metadata, null, 2));
  return metadata;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = buildSharpProgram();
  console.log(`Sharp program hash: ${result.programHash}`);
  console.log(`Compiler mode: ${result.compiler}`);
  if (!result.compiled) {
    console.log('WARNING: scarb not found; using deterministic source-hash fallback for PROGRAM_HASH.');
  }
}
