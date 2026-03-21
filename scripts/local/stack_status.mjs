import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { ethers } from 'ethers';

import {
  getStableArtBackendManifestPath,
  LOCAL_CHAIN_ID,
  SEPOLIA_CHAIN_ID,
  readArtBackendManifest,
} from '../../shared/deploy/artBackendManifest.mjs';
import { formatRpcError, withRpcRetry } from '../../shared/deploy/rpcRetry.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, '..', '..');

function parseArgs(argv) {
  const args = {};
  for (let index = 2; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith('--')) {
      args[key] = true;
    } else {
      args[key] = next;
      index += 1;
    }
  }
  return args;
}

function readJson(filePath) {
  if (!fs.existsSync(filePath)) {
    return null;
  }
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

async function fetchHealth(url) {
  try {
    const response = await fetch(url);
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      return {
        healthy: false,
        error: payload?.error || `HTTP ${response.status}`,
      };
    }
    return {
      healthy: true,
      payload,
    };
  } catch (error) {
    return {
      healthy: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function inspectContracts(provider, contracts) {
  const missing = [];
  for (const [label, address] of Object.entries(contracts)) {
    if (!address) {
      missing.push(`${label}:missing-address`);
      continue;
    }
    const code = await withRpcRetry(
      `getCode(${label})`,
      () => provider.getCode(address)
    );
    if (code === '0x') {
      missing.push(`${label}@${address}`);
    }
  }
  return missing;
}

async function inspectDeployment(provider, manifestPath, contracts) {
  if (!manifestPath || !fs.existsSync(manifestPath)) {
    return {
      manifestPath,
      exists: false,
      ready: false,
      missing: ['manifest'],
      contracts: {},
    };
  }

  const manifest = readJson(manifestPath) || {};
  const resolvedContracts = {};
  for (const [label, keys] of Object.entries(contracts)) {
    for (const key of keys) {
      const candidate = manifest[key];
      if (candidate) {
        resolvedContracts[label] = ethers.getAddress(candidate);
        break;
      }
    }
  }

  const missing = await inspectContracts(provider, resolvedContracts);
  return {
    manifestPath,
    exists: true,
    ready: missing.length === 0,
    missing,
    contracts: resolvedContracts,
  };
}

async function main() {
  const args = parseArgs(process.argv);
  const chainId = Number(args.chainId || process.env.CHAIN_ID || LOCAL_CHAIN_ID);
  const rpcUrl = String(args.rpc || process.env.RPC_URL || 'http://127.0.0.1:8545').trim();
  const serverUrl = String(args.server || process.env.SERVER_URL || 'http://127.0.0.1:8787').trim();
  const proverUrl = String(args.prover || process.env.PROVER_URL || 'http://127.0.0.1:8747').trim();
  const artBackendManifestPath = String(
    args.artManifest ||
    process.env.ART_BACKEND_MANIFEST_PATH ||
    ''
  ).trim();

  let provider = null;
  let rpcStatus = {
    healthy: false,
    url: rpcUrl,
    expectedChainId: chainId,
    chainId: null,
    error: 'unreachable',
  };

  try {
    provider = new ethers.JsonRpcProvider(rpcUrl, chainId, { batchMaxCount: 1, staticNetwork: true });
    const rawChainId = await withRpcRetry(
      'ping stack status rpc',
      () => provider.send('eth_chainId', [])
    );
    rpcStatus = {
      healthy: true,
      url: rpcUrl,
      expectedChainId: chainId,
      chainId: Number(BigInt(rawChainId)),
      error: '',
    };
  } catch (error) {
    rpcStatus.error = formatRpcError(error);
  }

  let artBackend = {
    manifestPath: '',
    exists: false,
    ready: false,
    missing: ['rpc-unavailable'],
    contracts: {},
    source: '',
  };
  let starkCore = {
    manifestPath: path.join(ROOT_DIR, 'deployments', `stark_${chainId}.json`),
    exists: false,
    ready: false,
    missing: ['rpc-unavailable'],
    contracts: {},
  };
  let aa4337 = {
    manifestPath: path.join(ROOT_DIR, 'deployments', `4337_${chainId}.json`),
    exists: false,
    ready: false,
    missing: ['rpc-unavailable'],
    contracts: {},
  };

  if (provider && rpcStatus.healthy) {
    const stablePreferred = chainId === SEPOLIA_CHAIN_ID;
    const artManifest = readArtBackendManifest({
      chainId,
      manifestPath: artBackendManifestPath,
      stablePreferred,
    });
    if (artManifest) {
      const missing = await inspectContracts(provider, {
        PhilSVGStorage: artManifest.svgStorageAddress,
        PhilLayerRegistry: artManifest.layerRegistryAddress,
      });
      artBackend = {
        manifestPath: artManifest.filePath,
        exists: true,
        ready: missing.length === 0,
        missing,
        contracts: {
          PhilSVGStorage: artManifest.svgStorageAddress,
          PhilLayerRegistry: artManifest.layerRegistryAddress,
          ...(artManifest.philNftAddress ? { PhilNFT: artManifest.philNftAddress } : {}),
        },
        source: artManifest.source,
      };
    } else {
      artBackend = {
        manifestPath: artBackendManifestPath || (
          chainId === SEPOLIA_CHAIN_ID
            ? getStableArtBackendManifestPath(chainId)
            : path.join(ROOT_DIR, 'deployments', `art_${chainId}.json`)
        ),
        exists: false,
        ready: false,
        missing: ['manifest'],
        contracts: {},
        source: '',
      };
    }

    starkCore = await inspectDeployment(
      provider,
      path.join(ROOT_DIR, 'deployments', `stark_${chainId}.json`),
      {
        PhilIdentityGate: ['PhilIdentityGate', 'ProofGate'],
        PhilIdentityMint: ['PhilIdentityMint', 'PhilTestMint'],
        PhilRenderer: ['PhilRenderer'],
        humanityVerifier: ['humanityVerifier', 'FactRegistryHumanityVerifier', 'MockHumanityVerifier'],
      }
    );

    aa4337 = await inspectDeployment(
      provider,
      path.join(ROOT_DIR, 'deployments', `4337_${chainId}.json`),
      {
        PhilUnlockInbox: ['PhilUnlockInbox'],
        PhilAccountFactory: ['PhilAccountFactory'],
        PhilPaymaster: ['PhilPaymaster'],
        PhilAccountImpl: ['PhilAccountImpl'],
      }
    );
  }

  const backend = await fetchHealth(`${serverUrl}/health`);
  const prover = await fetchHealth(`${proverUrl}/health`);

  const status = {
    generatedAt: new Date().toISOString(),
    rpc: rpcStatus,
    artBackend,
    starkCore,
    aa4337,
    services: {
      backend: {
        url: `${serverUrl}/health`,
        ...backend,
      },
      prover: {
        url: `${proverUrl}/health`,
        ...prover,
      },
    },
  };

  if (args.field) {
    const value = String(args.field)
      .split('.')
      .reduce((current, key) => (current == null ? undefined : current[key]), status);
    if (typeof value === 'object') {
      process.stdout.write(`${JSON.stringify(value)}\n`);
    } else if (value == null) {
      process.stdout.write('\n');
    } else {
      process.stdout.write(`${String(value)}\n`);
    }
    return;
  }

  if (args.json) {
    process.stdout.write(`${JSON.stringify(status, null, 2)}\n`);
    return;
  }

  console.log(`RPC: ${status.rpc.healthy ? 'ok' : 'down'} (${status.rpc.url})`);
  if (status.rpc.chainId != null) {
    console.log(`  Chain ID: ${status.rpc.chainId}`);
  } else {
    console.log(`  Error: ${status.rpc.error}`);
  }
  console.log(`Art backend: ${status.artBackend.ready ? 'ready' : 'missing'} (${status.artBackend.manifestPath})`);
  console.log(`Stark core: ${status.starkCore.ready ? 'ready' : 'missing'} (${status.starkCore.manifestPath})`);
  console.log(`4337: ${status.aa4337.ready ? 'ready' : 'missing'} (${status.aa4337.manifestPath})`);
  console.log(`Backend service: ${status.services.backend.healthy ? 'ready' : 'down'} (${status.services.backend.url})`);
  console.log(`Prover service: ${status.services.prover.healthy ? 'ready' : 'down'} (${status.services.prover.url})`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`ERROR: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  });
}
