import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { ethers } from 'ethers';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, '..', '..');
const STABLE_PROTOCOL_BINDINGS_DIR = path.join(ROOT_DIR, 'config', 'stable-protocol-bindings');

export const ENTRY_POINT_V07 = '0x0000000071727De22E5E9d8BAf0edAc6f37da032';
export const LOCAL_ENTRY_POINT_V07 = '0x1000000000000000000000000000000000000001';

function normalizeAddress(value) {
  const trimmed = String(value || '').trim();
  return trimmed ? ethers.getAddress(trimmed) : '';
}

function readJson(filePath) {
  if (!fs.existsSync(filePath)) {
    return null;
  }
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function coerceStableProtocolBindings(rawManifest, filePath) {
  if (!rawManifest || typeof rawManifest !== 'object') {
    return null;
  }

  const entryPointV07Address = normalizeAddress(
    rawManifest.contracts?.entryPointV07 ||
    rawManifest.entryPointV07 ||
    ENTRY_POINT_V07
  );
  const starknetCoreAddress = normalizeAddress(
    rawManifest.contracts?.starknetCore ||
    rawManifest.starknetCore
  );
  if (!entryPointV07Address || !starknetCoreAddress) {
    return null;
  }

  return {
    filePath,
    chainId: Number(rawManifest.chainId || 0) || null,
    stable: Boolean(rawManifest.stable),
    source: String(rawManifest.source || filePath),
    entryPointV07Address,
    starknetCoreAddress,
    notes: rawManifest.notes || {},
    references: Array.isArray(rawManifest.references) ? rawManifest.references : [],
    raw: rawManifest,
  };
}

export function getStableProtocolBindingsManifestPath(chainId, rootDir = ROOT_DIR) {
  if (Number(chainId) !== 11155111) {
    return '';
  }
  return path.join(rootDir, 'config', 'stable-protocol-bindings', 'sepolia.json');
}

export function readStableProtocolBindings({
  chainId,
  manifestPath = '',
  rootDir = ROOT_DIR,
} = {}) {
  const targetPath = manifestPath
    ? (path.isAbsolute(manifestPath) ? manifestPath : path.join(rootDir, manifestPath))
    : getStableProtocolBindingsManifestPath(chainId, rootDir);
  if (!targetPath) {
    return null;
  }
  return coerceStableProtocolBindings(readJson(targetPath), targetPath);
}

export async function inspectStableProtocolBindings(provider, bindings) {
  if (!bindings) {
    return {
      ok: false,
      missing: ['manifest'],
    };
  }

  const checks = [
    ['EntryPointV07', bindings.entryPointV07Address],
    ['StarknetCore', bindings.starknetCoreAddress],
  ];
  const missing = [];
  for (const [label, address] of checks) {
    const code = await provider.getCode(address);
    if (code === '0x') {
      missing.push(`${label}@${address}`);
    }
  }

  return {
    ok: missing.length === 0,
    missing,
  };
}
