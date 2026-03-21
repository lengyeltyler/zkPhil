import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { ethers } from 'ethers';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, '..', '..');
const STABLE_ART_BACKEND_DIR = path.join(ROOT_DIR, 'config', 'stable-art-backends');

export const LOCAL_CHAIN_ID = 31337;
export const SEPOLIA_CHAIN_ID = 11155111;

export const ART_BACKEND_MODE_AUTO = 'auto';
export const ART_BACKEND_MODE_DEPLOY_LOCAL = 'deploy-local';
export const ART_BACKEND_MODE_REUSE_EXISTING = 'reuse-existing-data';
export const ART_BACKEND_MODE_REUSE_STABLE = 'reuse-stable';
export const ART_BACKEND_MODE_EXPLICIT = 'explicit';

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

export function getDefaultArtBackendManifestPath(chainId) {
  return path.join(ROOT_DIR, 'deployments', `art_${chainId}.json`);
}

export function getStableArtBackendManifestPath(chainId) {
  if (Number(chainId) === SEPOLIA_CHAIN_ID) {
    return path.join(STABLE_ART_BACKEND_DIR, 'sepolia.json');
  }
  return getDefaultArtBackendManifestPath(chainId);
}

export function normalizeArtBackendMode(
  rawValue,
  chainId,
  { hasExplicitAddresses = false } = {}
) {
  const normalized = String(rawValue || ART_BACKEND_MODE_AUTO).trim().toLowerCase();

  if (!normalized || normalized === ART_BACKEND_MODE_AUTO || normalized === 'auto') {
    if (hasExplicitAddresses) {
      return ART_BACKEND_MODE_EXPLICIT;
    }
    if (Number(chainId) === SEPOLIA_CHAIN_ID) {
      return ART_BACKEND_MODE_REUSE_STABLE;
    }
    if (Number(chainId) === LOCAL_CHAIN_ID) {
      return ART_BACKEND_MODE_REUSE_EXISTING;
    }
    return ART_BACKEND_MODE_DEPLOY_LOCAL;
  }

  if (
    normalized === ART_BACKEND_MODE_REUSE_EXISTING ||
    normalized === 'reuse-existing' ||
    normalized === 'reuse-data' ||
    normalized === 'deploy-core-only' ||
    normalized === 'core-only'
  ) {
    return ART_BACKEND_MODE_REUSE_EXISTING;
  }

  if (
    normalized === ART_BACKEND_MODE_REUSE_STABLE ||
    normalized === 'stable' ||
    normalized === 'reuse-stable-data'
  ) {
    return ART_BACKEND_MODE_REUSE_STABLE;
  }

  if (
    normalized === ART_BACKEND_MODE_DEPLOY_LOCAL ||
    normalized === 'full-local' ||
    normalized === 'bootstrap-local'
  ) {
    return ART_BACKEND_MODE_DEPLOY_LOCAL;
  }

  if (normalized === ART_BACKEND_MODE_EXPLICIT || normalized === 'manual') {
    return ART_BACKEND_MODE_EXPLICIT;
  }

  throw new Error(`Unsupported ART_BACKEND_MODE=${rawValue}`);
}

function coerceManifest(rawManifest, filePath) {
  if (!rawManifest || typeof rawManifest !== 'object') {
    return null;
  }

  const svgStorageAddress = normalizeAddress(
    rawManifest.contracts?.svgStorage ||
    rawManifest.svgStorage ||
    rawManifest.PhilSVGStorage
  );
  const layerRegistryAddress = normalizeAddress(
    rawManifest.contracts?.layerRegistry ||
    rawManifest.layerRegistry ||
    rawManifest.PhilLayerRegistry
  );
  if (!svgStorageAddress || !layerRegistryAddress) {
    return null;
  }

  return {
    filePath,
    chainId: Number(
      rawManifest.chainId ||
      rawManifest.networkChainId ||
      0
    ) || null,
    generatedAt: rawManifest.generatedAt || '',
    stable: Boolean(rawManifest.stable || rawManifest.storageReused),
    source: String(rawManifest.source || filePath),
    svgStorageAddress,
    layerRegistryAddress,
    philNftAddress: normalizeAddress(
      rawManifest.contracts?.philNft ||
      rawManifest.philNft ||
      rawManifest.PhilNFT
    ),
    manifests: rawManifest.manifests || null,
    bootstrap: rawManifest.bootstrap || null,
    raw: rawManifest,
  };
}

export function readArtBackendManifest({ chainId, manifestPath = '', stablePreferred = false } = {}) {
  const candidatePaths = manifestPath
    ? [path.resolve(manifestPath)]
    : stablePreferred
      ? [
        getStableArtBackendManifestPath(chainId),
        path.join(ROOT_DIR, 'deployments', 'sepolia-addresses.json'),
      ]
      : [getDefaultArtBackendManifestPath(chainId)];

  for (const targetPath of candidatePaths) {
    const rawManifest = readJson(targetPath);
    if (!rawManifest) {
      continue;
    }

    const manifest = coerceManifest(rawManifest, targetPath);
    if (manifest) {
      return manifest;
    }
  }

  return null;
}

export function writeArtBackendManifest({
  chainId,
  manifestPath = '',
  svgStorageAddress,
  layerRegistryAddress,
  philNftAddress = '',
  stable = false,
  source = '',
  bootstrap = null,
}) {
  const targetPath = manifestPath
    ? path.resolve(manifestPath)
    : getDefaultArtBackendManifestPath(chainId);
  const payload = {
    schema: 'zkphil-art-backend-v1',
    generatedAt: new Date().toISOString(),
    chainId: Number(chainId),
    stable,
    source: source || (stable ? 'stable art backend' : 'bootstrapped zkPhilLayers'),
    contracts: {
      svgStorage: normalizeAddress(svgStorageAddress),
      layerRegistry: normalizeAddress(layerRegistryAddress),
      ...(philNftAddress ? { philNft: normalizeAddress(philNftAddress) } : {}),
    },
    ...(bootstrap ? { bootstrap } : {}),
  };

  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.writeFileSync(targetPath, JSON.stringify(payload, null, 2));
  return targetPath;
}

export async function inspectArtBackendDeployment(provider, manifest) {
  if (!manifest) {
    return {
      ok: false,
      missing: ['manifest'],
    };
  }

  const checks = [
    ['PhilSVGStorage', manifest.svgStorageAddress],
    ['PhilLayerRegistry', manifest.layerRegistryAddress],
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
