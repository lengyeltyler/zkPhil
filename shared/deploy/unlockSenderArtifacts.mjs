import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, '..', '..');

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

export function getUnlockSenderArtifactPaths(rootDir = ROOT_DIR) {
  const artifactsFile = path.join(
    rootDir,
    'starknet',
    'target',
    'dev',
    'phil_unlock_sender.starknet_artifacts.json'
  );
  if (!fs.existsSync(artifactsFile)) {
    throw new Error(
      `Unlock sender artifacts are missing at ${artifactsFile}. Run \`npm run starknet:build-unlock-sender\` first.`
    );
  }

  const manifest = readJson(artifactsFile);
  const contract = manifest.contracts?.find((entry) => entry.contract_name === 'PhilUnlockSender');
  if (!contract?.artifacts?.sierra || !contract?.artifacts?.casm) {
    throw new Error(`PhilUnlockSender artifact entries are incomplete in ${artifactsFile}.`);
  }

  const baseDir = path.dirname(artifactsFile);
  return {
    artifactsFile,
    sierraPath: path.join(baseDir, contract.artifacts.sierra),
    casmPath: path.join(baseDir, contract.artifacts.casm),
  };
}

export function readUnlockSenderArtifacts(rootDir = ROOT_DIR) {
  const paths = getUnlockSenderArtifactPaths(rootDir);
  const sierra = readJson(paths.sierraPath);
  const casm = readJson(paths.casmPath);
  return {
    ...paths,
    sierra,
    casm,
    abi: sierra.abi || [],
  };
}
