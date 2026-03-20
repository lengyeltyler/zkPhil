import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ethers } from 'ethers';

import {
  buildLayerCatalog,
  SVG_SINGLE_UPLOAD_LIMIT,
  SVG_STORAGE_CHUNK_LIMIT,
} from '../../src/layer-catalog.mjs';
import {
  HUMANITY_PROVIDER_LOCAL_CREDENTIAL,
  HUMANITY_PROVIDER_LOCAL_CREDENTIAL_COMMITMENT,
  HUMANITY_PROVIDER_MOCK,
} from '../../shared/proof/localStarkProver.mjs';
import { logTx, waitForReceiptWithTimeout } from '../sepolia/txutil.mjs';
import {
  DryRunPlanner,
  installDryRunGuards,
  planContractCall,
  planDeploy,
} from '../../shared/deploy/dryRun.mjs';
import { mergeRecommendedTxOverrides } from '../../shared/deploy/feeOverrides.mjs';
import { compilePhilContracts } from './compileContracts.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, '..', '..');

const DEFAULT_PRIVATE_KEY =
  '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
const LOCAL_CHAIN_ID = 31337;
const SEPOLIA_CHAIN_ID = 11155111;
const SMALL_BATCH_MAX_ITEMS = 20;
const SMALL_BATCH_MAX_BYTES = 120_000;
const REGISTER_ASSET_BATCH_SIZE = 40;
const REGISTER_VARIANT_BATCH_SIZE = 20;
const SEPOLIA_ADDRESSES_PATH = path.join(ROOT_DIR, 'deployments', 'sepolia-addresses.json');
const ZK_PHIL_LAYERS_DIR = path.join(ROOT_DIR, 'zkPhilLayers');

function normalizeHumanityProviderMode(rawValue) {
  const normalized = String(rawValue || HUMANITY_PROVIDER_LOCAL_CREDENTIAL).trim().toLowerCase();
  if (
    normalized === HUMANITY_PROVIDER_LOCAL_CREDENTIAL ||
    normalized === HUMANITY_PROVIDER_LOCAL_CREDENTIAL_COMMITMENT ||
    normalized === 'credential' ||
    normalized === 'local'
  ) {
    return HUMANITY_PROVIDER_LOCAL_CREDENTIAL;
  }
  if (normalized === HUMANITY_PROVIDER_MOCK || normalized === 'mock') {
    return HUMANITY_PROVIDER_MOCK;
  }
  throw new Error(`Unsupported HUMANITY_PROVIDER=${rawValue}`);
}

function getArtifact(artifacts, name) {
  const artifact = artifacts[name];
  if (!artifact) {
    throw new Error(`Missing compiled artifact: ${name}`);
  }
  return artifact;
}

function readJson(filePath) {
  if (!fs.existsSync(filePath)) {
    return null;
  }
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function readSvgBytes(relativePath) {
  return fs.readFileSync(path.join(ZK_PHIL_LAYERS_DIR, relativePath));
}

function chunkBuffer(buffer, chunkSize = SVG_STORAGE_CHUNK_LIMIT) {
  const out = [];
  for (let start = 0; start < buffer.length; start += chunkSize) {
    out.push(buffer.subarray(start, Math.min(start + chunkSize, buffer.length)));
  }
  return out;
}

function chunkArray(items, chunkSize) {
  const chunks = [];
  for (let index = 0; index < items.length; index += chunkSize) {
    chunks.push(items.slice(index, index + chunkSize));
  }
  return chunks;
}

async function deployContract({
  wallet,
  provider,
  artifact,
  args = [],
  contractName,
  dryRun,
  dryRunPlanner,
  from,
}) {
  if (dryRun) {
    const planned = await planDeploy({
      provider,
      planner: dryRunPlanner,
      from,
      artifact,
      contractName,
      args,
    });
    return {
      address: planned.address,
      dryRun: true,
    };
  }

  const factory = new ethers.ContractFactory(artifact.abi, artifact.bytecode, wallet);
  const contract = await factory.deploy(...args, await mergeRecommendedTxOverrides(provider));
  const deploymentTx = contract.deploymentTransaction();
  if (!deploymentTx) {
    throw new Error(`Missing deployment transaction for ${contractName}`);
  }
  logTx(`Deploy ${contractName}`, deploymentTx.hash);
  await waitForReceiptWithTimeout(provider, deploymentTx.hash);

  return {
    address: await contract.getAddress(),
    contract,
    dryRun: false,
  };
}

async function callContract({
  wallet,
  provider,
  contractName,
  contractAddress,
  abi,
  method,
  args = [],
  overrides = {},
  dryRun,
  dryRunPlanner,
  from,
  note = '',
  predictedResult = '',
  canEstimate = true,
}) {
  if (dryRun) {
    return planContractCall({
      provider,
      planner: dryRunPlanner,
      from,
      contractName,
      contractAddress,
      abi,
      method,
      args,
      value: overrides.value ?? 0n,
      note,
      predictedResult,
      canEstimate,
    });
  }

  const contract = new ethers.Contract(contractAddress, abi, wallet);
  const overrideKeys = Object.keys(overrides).filter((key) => overrides[key] != null);
  const effectiveOverrides = await mergeRecommendedTxOverrides(provider, overrides);
  const effectiveOverrideKeys = Object.keys(effectiveOverrides).filter(
    (key) => effectiveOverrides[key] != null
  );
  const txArgs = effectiveOverrideKeys.length > 0 ? [...args, effectiveOverrides] : args;
  const tx = await contract[method](...txArgs);
  logTx(`${contractName}.${method}`, tx.hash);
  await waitForReceiptWithTimeout(provider, tx.hash);
  return tx;
}

function loadSepoliaArtBackend() {
  const manifest = readJson(SEPOLIA_ADDRESSES_PATH);
  if (!manifest?.contracts?.svgStorage || !manifest?.contracts?.layerRegistry) {
    return null;
  }

  return {
    svgStorage: ethers.getAddress(manifest.contracts.svgStorage),
    layerRegistry: ethers.getAddress(manifest.contracts.layerRegistry),
    philNft: manifest.contracts.philNft
      ? ethers.getAddress(manifest.contracts.philNft)
      : '',
    manifest,
  };
}

async function bootstrapArtBackend({
  wallet,
  provider,
  svgStorageAddress,
  layerRegistryAddress,
  storageArtifact,
  registryArtifact,
  dryRun,
  dryRunPlanner,
  from,
}) {
  const catalog = buildLayerCatalog();
  const manifest = {
    generatedAt: new Date().toISOString(),
    network: dryRun ? 'dry-run' : 'local',
    chainId: Number((await provider.getNetwork()).chainId),
    svgStorage: svgStorageAddress,
    layerRegistry: layerRegistryAddress,
    totalFiles: catalog.assets.length,
    totalSvgBytes: catalog.totals.totalSvgBytes,
    files: {},
  };

  let nextSvgId = 1;
  const pendingSmallBatch = [];
  let pendingSmallBatchBytes = 0;

  async function flushSmallBatch() {
    if (pendingSmallBatch.length === 0) {
      return;
    }

    const batch = [...pendingSmallBatch];
    const startingSvgId = nextSvgId;
    nextSvgId += batch.length;

    await callContract({
      wallet,
      provider,
      contractName: 'PhilSVGStorage',
      contractAddress: svgStorageAddress,
      abi: storageArtifact.abi,
      method: 'storeSvgBatch',
      args: [batch.map((entry) => entry.fileBytes)],
      dryRun,
      dryRunPlanner,
      from,
      predictedResult: `svgIds ${startingSvgId}-${nextSvgId - 1}`,
      canEstimate: false,
      note: dryRun
        ? 'Gas estimate is unavailable until PhilSVGStorage is actually deployed.'
        : '',
    });

    for (let index = 0; index < batch.length; index++) {
      const svgId = startingSvgId + index;
      const entry = batch[index];
      manifest.files[entry.asset.relativePath] = {
        fileName: entry.asset.fileName,
        relativePath: entry.asset.relativePath,
        sizeBytes: entry.asset.sizeBytes,
        svgId,
        storageRef: svgId,
        chunked: false,
        chunkCount: 1,
      };
    }

    pendingSmallBatch.length = 0;
    pendingSmallBatchBytes = 0;
  }

  for (const asset of catalog.assets) {
    const fileBytes = readSvgBytes(asset.relativePath);

    if (asset.sizeBytes <= SVG_SINGLE_UPLOAD_LIMIT) {
      pendingSmallBatch.push({ asset, fileBytes });
      pendingSmallBatchBytes += asset.sizeBytes;

      if (
        pendingSmallBatch.length >= SMALL_BATCH_MAX_ITEMS ||
        pendingSmallBatchBytes >= SMALL_BATCH_MAX_BYTES
      ) {
        await flushSmallBatch();
      }

      continue;
    }

    await flushSmallBatch();

    const svgId = nextSvgId;
    nextSvgId += 1;
    const chunks = chunkBuffer(fileBytes);
    const contentHash = ethers.keccak256(fileBytes);

    await callContract({
      wallet,
      provider,
      contractName: 'PhilSVGStorage',
      contractAddress: svgStorageAddress,
      abi: storageArtifact.abi,
      method: 'initializeChunkedSvg',
      args: [asset.sizeBytes, contentHash, chunks.length],
      dryRun,
      dryRunPlanner,
      from,
      predictedResult: `svgId ${svgId}`,
      canEstimate: false,
      note: dryRun
        ? 'Gas estimate is unavailable until PhilSVGStorage is actually deployed.'
        : '',
    });

    await callContract({
      wallet,
      provider,
      contractName: 'PhilSVGStorage',
      contractAddress: svgStorageAddress,
      abi: storageArtifact.abi,
      method: 'appendChunks',
      args: [svgId, chunks],
      dryRun,
      dryRunPlanner,
      from,
      canEstimate: false,
      note: dryRun
        ? 'Gas estimate is unavailable until PhilSVGStorage is actually deployed.'
        : '',
    });

    await callContract({
      wallet,
      provider,
      contractName: 'PhilSVGStorage',
      contractAddress: svgStorageAddress,
      abi: storageArtifact.abi,
      method: 'finalizeChunkedSvg',
      args: [svgId],
      dryRun,
      dryRunPlanner,
      from,
      canEstimate: false,
      note: dryRun
        ? 'Gas estimate is unavailable until PhilSVGStorage is actually deployed.'
        : '',
    });

    manifest.files[asset.relativePath] = {
      fileName: asset.fileName,
      relativePath: asset.relativePath,
      sizeBytes: asset.sizeBytes,
      svgId,
      storageRef: svgId,
      chunked: true,
      chunkCount: chunks.length,
    };
  }

  await flushSmallBatch();

  await callContract({
    wallet,
    provider,
    contractName: 'PhilLayerRegistry',
    contractAddress: layerRegistryAddress,
    abi: registryArtifact.abi,
    method: 'registerLayers',
    args: [
      catalog.layers.map((layer) => ({
        name: layer.name,
        minSelections: layer.minSelections,
        maxSelections: layer.maxSelections,
      })),
    ],
    dryRun,
    dryRunPlanner,
    from,
    canEstimate: false,
    note: dryRun
      ? 'Gas estimate is unavailable until PhilLayerRegistry is actually deployed.'
      : '',
  });

  const assetIdByKey = {};
  let nextAssetId = 1;

  for (const layer of catalog.layers) {
    const assetChunks = chunkArray(
      layer.assets.map((asset) => ({
        layerId: layer.id,
        storageId: manifest.files[asset.relativePath].svgId,
        sublayer: asset.sublayer,
        fileName: asset.fileName,
        _assetKey: asset.key,
      })),
      REGISTER_ASSET_BATCH_SIZE
    );

    for (const assetChunk of assetChunks) {
      if (assetChunk.length === 0) {
        continue;
      }

      await callContract({
        wallet,
        provider,
        contractName: 'PhilLayerRegistry',
        contractAddress: layerRegistryAddress,
        abi: registryArtifact.abi,
        method: 'registerAssets',
        args: [
          assetChunk.map(({ layerId, storageId, sublayer, fileName }) => ({
            layerId,
            storageId,
            sublayer,
            fileName,
          })),
        ],
        dryRun,
        dryRunPlanner,
        from,
        predictedResult: `assetIds ${nextAssetId}-${nextAssetId + assetChunk.length - 1}`,
        canEstimate: false,
        note: dryRun
          ? 'Gas estimate is unavailable until PhilLayerRegistry is actually deployed.'
          : '',
      });

      for (const asset of assetChunk) {
        assetIdByKey[asset._assetKey] = nextAssetId;
        nextAssetId += 1;
      }
    }
  }

  const variantIdByKey = {};
  let nextVariantId = 1;

  for (const layer of catalog.layers) {
    const variantChunks = chunkArray(
      layer.variants.map((variant) => ({
        layerId: layer.id,
        label: variant.label,
        style: variant.style,
        color: variant.color,
        assetIds: variant.assetKeys.map((assetKey) => assetIdByKey[assetKey]),
        _variantKey: variant.key,
      })),
      REGISTER_VARIANT_BATCH_SIZE
    );

    for (const variantChunk of variantChunks) {
      if (variantChunk.length === 0) {
        continue;
      }

      await callContract({
        wallet,
        provider,
        contractName: 'PhilLayerRegistry',
        contractAddress: layerRegistryAddress,
        abi: registryArtifact.abi,
        method: 'registerVariants',
        args: [
          variantChunk.map(({ layerId, label, style, color, assetIds }) => ({
            layerId,
            label,
            style,
            color,
            assetIds,
          })),
        ],
        dryRun,
        dryRunPlanner,
        from,
        predictedResult: `variantIds ${nextVariantId}-${nextVariantId + variantChunk.length - 1}`,
        canEstimate: false,
        note: dryRun
          ? 'Gas estimate is unavailable until PhilLayerRegistry is actually deployed.'
          : '',
      });

      for (const variant of variantChunk) {
        variantIdByKey[variant._variantKey] = nextVariantId;
        nextVariantId += 1;
      }
    }
  }

  return {
    catalog,
    manifest,
    assetIdByKey,
    variantIdByKey,
  };
}

async function resolveArtBackend({
  chainId,
  wallet,
  provider,
  artifacts,
  svgStorageAddress,
  layerRegistryAddress,
  dryRun,
  dryRunPlanner,
  from,
}) {
  if (svgStorageAddress || layerRegistryAddress) {
    if (!svgStorageAddress || !layerRegistryAddress) {
      throw new Error('Both svgStorageAddress and layerRegistryAddress must be supplied together.');
    }

    return {
      svgStorageAddress: ethers.getAddress(svgStorageAddress),
      layerRegistryAddress: ethers.getAddress(layerRegistryAddress),
      philNftAddress: '',
      reused: true,
      source: 'explicit',
      bootstrap: null,
    };
  }

  if (chainId === SEPOLIA_CHAIN_ID) {
    const sepoliaArtBackend = loadSepoliaArtBackend();
    if (!sepoliaArtBackend) {
      throw new Error(
        'Missing deployments/sepolia-addresses.json. Sepolia hybrid deploy expects an existing art backend.'
      );
    }

    return {
      svgStorageAddress: sepoliaArtBackend.svgStorage,
      layerRegistryAddress: sepoliaArtBackend.layerRegistry,
      philNftAddress: sepoliaArtBackend.philNft,
      reused: true,
      source: 'deployments/sepolia-addresses.json',
      bootstrap: null,
    };
  }

  const storageArtifact = getArtifact(artifacts, 'PhilSVGStorage');
  const registryArtifact = getArtifact(artifacts, 'PhilLayerRegistry');

  const svgStorage = await deployContract({
    wallet,
    provider,
    artifact: storageArtifact,
    args: [from],
    contractName: 'PhilSVGStorage',
    dryRun,
    dryRunPlanner,
    from,
  });

  const layerRegistry = await deployContract({
    wallet,
    provider,
    artifact: registryArtifact,
    args: [svgStorage.address, from],
    contractName: 'PhilLayerRegistry',
    dryRun,
    dryRunPlanner,
    from,
  });

  const bootstrap = await bootstrapArtBackend({
    wallet,
    provider,
    svgStorageAddress: svgStorage.address,
    layerRegistryAddress: layerRegistry.address,
    storageArtifact,
    registryArtifact,
    dryRun,
    dryRunPlanner,
    from,
  });

  return {
    svgStorageAddress: svgStorage.address,
    layerRegistryAddress: layerRegistry.address,
    philNftAddress: '',
    reused: false,
    source: 'bootstrapped zkPhilLayers',
    bootstrap,
  };
}

export async function deployPhilSystem({
  rpcUrl = 'http://127.0.0.1:8545',
  privateKey = process.env.PRIVATE_KEY || DEFAULT_PRIVATE_KEY,
  programHash = process.env.PROGRAM_HASH ||
    '0x4444444444444444444444444444444444444444444444444444444444444444',
  proofContext = BigInt(process.env.PROOF_CONTEXT || process.env.CONTEXT_ID || '13'),
  factRegistryAddress = process.env.FACT_REGISTRY || '',
  verifierConfigHash = process.env.VERIFIER_CONFIG_HASH || process.env.ELIGIBILITY_ROOT || '',
  humanityProvider = process.env.HUMANITY_PROVIDER || HUMANITY_PROVIDER_LOCAL_CREDENTIAL,
  credentialBundlePath = process.env.CREDENTIAL_BUNDLE_PATH || process.env.ELIGIBILITY_BUNDLE_PATH || '',
  mockHumanityBundlePath = process.env.MOCK_HUMANITY_BUNDLE_PATH || process.env.HUMANITY_BUNDLE_PATH || '',
  svgStorageAddress = process.env.PHIL_SVG_STORAGE || '',
  layerRegistryAddress = process.env.PHIL_LAYER_REGISTRY || '',
  writeDeployments = true,
  dryRun = false,
  dryRunPlanner = null,
}) {
  const provider = new ethers.JsonRpcProvider(rpcUrl, undefined, { batchMaxCount: 1 });
  const rawWallet = new ethers.Wallet(privateKey, provider);
  const wallet = new ethers.NonceManager(rawWallet);
  const deployer = await rawWallet.getAddress();

  if (dryRun) {
    installDryRunGuards(rawWallet, wallet);
  }

  const planner = dryRun
    ? (dryRunPlanner || await DryRunPlanner.create({ provider, from: deployer }))
    : null;

  const chain = await provider.getNetwork();
  const chainId = Number(chain.chainId);
  if (!dryRun && chainId === 1) {
    const normalizedPrivateKey = String(privateKey || '').toLowerCase();
    if (!normalizedPrivateKey || normalizedPrivateKey === DEFAULT_PRIVATE_KEY) {
      throw new Error('Live mainnet deployment requires an explicit non-default private key.');
    }
  }

  const artifacts = compilePhilContracts();
  const rendererArtifact = getArtifact(artifacts, 'PhilRenderer');
  const devProofVerifierArtifact = getArtifact(artifacts, 'DevProofVerifier');
  const humanityVerifierArtifact = getArtifact(artifacts, 'FactRegistryHumanityVerifier');
  const mockHumanityVerifierArtifact = getArtifact(artifacts, 'MockHumanityVerifier');
  const proofGateArtifact = getArtifact(artifacts, 'PhilIdentityGate');
  const mintArtifact = getArtifact(artifacts, 'PhilIdentityMint');
  const web3Artifact = getArtifact(artifacts, 'PhilWeb3');
  const resolvedHumanityProvider = normalizeHumanityProviderMode(humanityProvider);

  const artBackend = await resolveArtBackend({
    chainId,
    wallet,
    provider,
    artifacts,
    svgStorageAddress,
    layerRegistryAddress,
    dryRun,
    dryRunPlanner: planner,
    from: deployer,
  });

  const renderer = await deployContract({
    wallet,
    provider,
    artifact: rendererArtifact,
    args: [
      artBackend.layerRegistryAddress,
      artBackend.svgStorageAddress,
      ethers.ZeroAddress,
    ],
    contractName: 'PhilRenderer',
    dryRun,
    dryRunPlanner: planner,
    from: deployer,
  });

  const resolvedVerifierConfigHash = (() => {
    if (verifierConfigHash) return BigInt(verifierConfigHash);
    if (resolvedHumanityProvider === HUMANITY_PROVIDER_MOCK && mockHumanityBundlePath) {
      const bundle = JSON.parse(fs.readFileSync(path.resolve(mockHumanityBundlePath), 'utf8'));
      return BigInt(bundle.verifierConfigHash);
    }
    if (credentialBundlePath) {
      const bundle = JSON.parse(fs.readFileSync(path.resolve(credentialBundlePath), 'utf8'));
      return BigInt(bundle.verifierConfigHash);
    }
    throw new Error(
      resolvedHumanityProvider === HUMANITY_PROVIDER_MOCK
        ? 'VERIFIER_CONFIG_HASH or MOCK_HUMANITY_BUNDLE_PATH must be set for mock-humanity verifier deployment.'
        : 'VERIFIER_CONFIG_HASH or CREDENTIAL_BUNDLE_PATH must be set for humanity verifier deployment.'
    );
  })();

  const nextEoaNonce = dryRun ? planner.nextNonce : Number(await wallet.getNonce());
  const needsDevRegistryDeploy = !factRegistryAddress;
  const futureMintAddress = ethers.getCreateAddress({
    from: deployer,
    nonce: nextEoaNonce + (needsDevRegistryDeploy ? 3 : 2),
  });

  let resolvedFactRegistryAddress = factRegistryAddress
    ? ethers.getAddress(factRegistryAddress)
    : '';
  if (!resolvedFactRegistryAddress) {
    if (chainId !== LOCAL_CHAIN_ID) {
      throw new Error('FACT_REGISTRY must be set explicitly outside the local chain.');
    }
    const registry = await deployContract({
      wallet,
      provider,
      artifact: devProofVerifierArtifact,
      args: [deployer],
      contractName: 'DevProofVerifier',
      dryRun,
      dryRunPlanner: planner,
      from: deployer,
    });
    resolvedFactRegistryAddress = registry.address;
  }

  if (resolvedHumanityProvider === HUMANITY_PROVIDER_MOCK && chainId !== LOCAL_CHAIN_ID) {
    throw new Error('HUMANITY_PROVIDER=mock is DEV/TEST ONLY and may only be deployed on chainId 31337.');
  }

  const verifierArtifact =
    resolvedHumanityProvider === HUMANITY_PROVIDER_MOCK
      ? mockHumanityVerifierArtifact
      : humanityVerifierArtifact;
  const verifierContractName =
    resolvedHumanityProvider === HUMANITY_PROVIDER_MOCK
      ? 'MockHumanityVerifier'
      : 'FactRegistryHumanityVerifier';
  const verifier = await deployContract({
    wallet,
    provider,
    artifact: verifierArtifact,
    args: [
      programHash,
      proofContext,
      resolvedFactRegistryAddress,
      resolvedVerifierConfigHash,
    ],
    contractName: verifierContractName,
    dryRun,
    dryRunPlanner: planner,
    from: deployer,
  });

  const gate = await deployContract({
    wallet,
    provider,
    artifact: proofGateArtifact,
    args: [
      verifier.address,
      futureMintAddress,
    ],
    contractName: 'PhilIdentityGate',
    dryRun,
    dryRunPlanner: planner,
    from: deployer,
  });

  const mint = await deployContract({
    wallet,
    provider,
    artifact: mintArtifact,
    args: [
      renderer.address,
      gate.address,
      deployer,
    ],
    contractName: 'PhilIdentityMint',
    dryRun,
    dryRunPlanner: planner,
    from: deployer,
  });

  const web3 = await deployContract({
    wallet,
    provider,
    artifact: web3Artifact,
    args: [renderer.address],
    contractName: 'PhilWeb3',
    dryRun,
    dryRunPlanner: planner,
    from: deployer,
  });

  const deployments = {
    chainId,
    rpcUrl,
    deployer,
    factRegistry: resolvedFactRegistryAddress,
    humanityVerifier: verifier.address,
    humanityProvider: resolvedHumanityProvider,
    verifierConfigHash: resolvedVerifierConfigHash.toString(),
    programHash,
    proofContext: proofContext.toString(),
    PhilSVGStorage: artBackend.svgStorageAddress,
    PhilLayerRegistry: artBackend.layerRegistryAddress,
    PhilNFT: artBackend.philNftAddress,
    PhilRenderer: renderer.address,
    FactRegistryHumanityVerifier:
      resolvedHumanityProvider === HUMANITY_PROVIDER_MOCK ? '' : verifier.address,
    MockHumanityVerifier:
      resolvedHumanityProvider === HUMANITY_PROVIDER_MOCK ? verifier.address : '',
    PhilIdentityGate: gate.address,
    PhilIdentityMint: mint.address,
    PhilWeb3: web3.address,
    artBackendReused: artBackend.reused,
    artBackendSource: artBackend.source,
    catalogTotals: artBackend.bootstrap
      ? artBackend.bootstrap.catalog.totals
      : null,
  };

  if (writeDeployments && !dryRun && chainId === LOCAL_CHAIN_ID) {
    const outDir = path.join(ROOT_DIR, 'deployments');
    fs.mkdirSync(outDir, { recursive: true });
    const outFile = path.join(outDir, `local_${chainId}.json`);
    fs.writeFileSync(outFile, JSON.stringify(deployments, null, 2));
  } else if (writeDeployments && dryRun) {
    console.log(`DRY_RUN: skipping deployments/local_${chainId}.json write.`);
  }

  return deployments;
}
