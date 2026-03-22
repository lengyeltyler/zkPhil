import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { getUnlockSenderArtifactPaths } from '../../shared/deploy/unlockSenderArtifacts.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, '..', '..');

function runBuild() {
  const scarbBin = String(process.env.SCARB_BIN || 'scarb').trim();
  const command = spawnSync(
    scarbBin,
    ['--manifest-path', path.join(ROOT_DIR, 'starknet', 'Scarb.toml'), 'build'],
    {
      cwd: ROOT_DIR,
      stdio: 'inherit',
      env: process.env,
    }
  );

  if (command.status !== 0) {
    process.exit(command.status ?? 1);
  }
}

function main() {
  runBuild();
  const artifacts = getUnlockSenderArtifactPaths(ROOT_DIR);
  console.log('Built Starknet unlock sender artifacts:');
  console.log(`  Sierra: ${artifacts.sierraPath}`);
  console.log(`  CASM:   ${artifacts.casmPath}`);
}

main();
