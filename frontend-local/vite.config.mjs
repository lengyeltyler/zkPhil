import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { getStableArtBackendManifestPath } from '../shared/deploy/artBackendManifest.mjs';

const ROOT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(ROOT_DIR, '..');

function readJson(relativePath) {
  const filePath = path.join(REPO_ROOT, relativePath);
  if (!fs.existsSync(filePath)) {
    return null;
  }

  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

const starkDeployment = readJson('deployments/stark_11155111.json');
const stableArtPath = path.relative(REPO_ROOT, getStableArtBackendManifestPath(11155111));
const sepoliaArtDeployment = readJson(stableArtPath);
const previewConfig = {
  chainId: 11155111,
  philIdentityMintAddress: starkDeployment?.PhilIdentityMint || starkDeployment?.PhilTestMint || '',
  rendererAddress: starkDeployment?.PhilRenderer || '',
  web3Address: starkDeployment?.PhilWeb3 || '',
  layerRegistryAddress: sepoliaArtDeployment?.contracts?.layerRegistry || starkDeployment?.PhilLayerRegistry || '',
  svgStorageAddress: sepoliaArtDeployment?.contracts?.svgStorage || starkDeployment?.PhilSVGStorage || '',
};

export default defineConfig({
  root: ROOT_DIR,
  define: {
    __SEPOLIA_PREVIEW_CONFIG__: JSON.stringify(previewConfig),
    __SEPOLIA_RPC_URL__: JSON.stringify(
      process.env.RPC_URL_SEPOLIA || process.env.RPC_URL || ''
    ),
  },
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': 'http://127.0.0.1:8787',
    },
  },
});
