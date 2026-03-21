import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  ART_BACKEND_MODE_DEPLOY_LOCAL,
  ART_BACKEND_MODE_EXPLICIT,
  ART_BACKEND_MODE_REUSE_EXISTING,
  ART_BACKEND_MODE_REUSE_STABLE,
  normalizeArtBackendMode,
  readArtBackendManifest,
  writeArtBackendManifest,
} from '../shared/deploy/artBackendManifest.mjs';

test('normalizeArtBackendMode picks sensible auto defaults', () => {
  assert.equal(normalizeArtBackendMode('', 31337), ART_BACKEND_MODE_REUSE_EXISTING);
  assert.equal(normalizeArtBackendMode('', 11155111), ART_BACKEND_MODE_REUSE_STABLE);
  assert.equal(
    normalizeArtBackendMode('', 31337, { hasExplicitAddresses: true }),
    ART_BACKEND_MODE_EXPLICIT
  );
  assert.equal(normalizeArtBackendMode('full-local', 31337), ART_BACKEND_MODE_DEPLOY_LOCAL);
  assert.equal(normalizeArtBackendMode('deploy-core-only', 31337), ART_BACKEND_MODE_REUSE_EXISTING);
});

test('readArtBackendManifest understands the local manifest format', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'art-manifest-'));
  const manifestPath = path.join(tempDir, 'art.json');

  writeArtBackendManifest({
    chainId: 31337,
    manifestPath,
    svgStorageAddress: '0x1000000000000000000000000000000000000001',
    layerRegistryAddress: '0x2000000000000000000000000000000000000002',
    source: 'bootstrapped zkPhilLayers',
    bootstrap: {
      totalFiles: 10,
    },
  });

  const manifest = readArtBackendManifest({
    chainId: 31337,
    manifestPath,
  });

  assert.ok(manifest);
  assert.equal(manifest.svgStorageAddress, '0x1000000000000000000000000000000000000001');
  assert.equal(manifest.layerRegistryAddress, '0x2000000000000000000000000000000000000002');
  assert.equal(manifest.source, 'bootstrapped zkPhilLayers');
});

test('readArtBackendManifest understands the stable sepolia-style manifest format', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'art-manifest-'));
  const manifestPath = path.join(tempDir, 'sepolia-addresses.json');
  fs.writeFileSync(
    manifestPath,
    JSON.stringify({
      chainId: 11155111,
      storageReused: true,
      contracts: {
        svgStorage: '0x3000000000000000000000000000000000000003',
        layerRegistry: '0x4000000000000000000000000000000000000004',
        philNft: '0x5000000000000000000000000000000000000005',
      },
    })
  );

  const manifest = readArtBackendManifest({
    chainId: 11155111,
    manifestPath,
  });

  assert.ok(manifest);
  assert.equal(manifest.svgStorageAddress, '0x3000000000000000000000000000000000000003');
  assert.equal(manifest.layerRegistryAddress, '0x4000000000000000000000000000000000000004');
  assert.equal(manifest.philNftAddress, '0x5000000000000000000000000000000000000005');
});
