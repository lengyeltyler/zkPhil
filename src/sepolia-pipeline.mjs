import fs from "node:fs";
import path from "node:path";

import { ethers } from "ethers";
import { mergeRecommendedTxOverrides } from "../shared/deploy/feeOverrides.mjs";
import { getStableArtBackendManifestPath } from "../shared/deploy/artBackendManifest.mjs";
import { waitForReceiptWithTimeout } from "../scripts/sepolia/txutil.mjs";

import {
  buildLayerCatalog,
  SVG_SINGLE_UPLOAD_LIMIT,
  SVG_STORAGE_CHUNK_LIMIT
} from "./layer-catalog.mjs";
import { loadArtifact } from "./contracts.mjs";
import {
  DEPLOYMENTS_DIR,
  GENERATED_DIR,
  LAYER_CATALOG_PATH,
  UPLOAD_MANIFEST_PATH,
  ZK_PHIL_LAYERS_DIR,
  ensureDir,
  normalizePath,
  readJson,
  writeJson
} from "./workspace.mjs";

const NETWORK_NAME = "sepolia";
const UPLOAD_STATE_PATH = path.join(DEPLOYMENTS_DIR, "upload-state.sepolia.json");
const REGISTRY_MANIFEST_PATH = path.join(GENERATED_DIR, "registry-manifest.json");
const SMALL_BATCH_MAX_ITEMS = 20;
const SMALL_BATCH_MAX_BYTES = 120_000;
const REGISTER_LAYER_GAS_LIMIT = 800_000n;
const REGISTER_ASSET_BATCH_SIZE = 20;
const REGISTER_ASSET_GAS_LIMIT = 3_500_000n;
const REGISTER_VARIANT_BATCH_SIZE = 20;
const REGISTER_VARIANT_GAS_LIMIT = 5_000_000n;

function splitBuffer(buffer, size) {
  const chunks = [];
  for (let offset = 0; offset < buffer.length; offset += size) {
    chunks.push(buffer.subarray(offset, offset + size));
  }
  return chunks;
}

function bigintToNumber(value) {
  return Number(value);
}

function getRecordShape(record) {
  return {
    totalSize: bigintToNumber(record[0]),
    storedSize: bigintToNumber(record[1]),
    expectedChunks: bigintToNumber(record[2]),
    chunkCount: bigintToNumber(record[3]),
    finalized: record[4],
    contentHash: record[5]
  };
}

function createDefaultUploadState(chainId, svgStorageAddress) {
  return {
    network: NETWORK_NAME,
    chainId,
    svgStorage: svgStorageAddress,
    updatedAt: new Date().toISOString(),
    files: {}
  };
}

function readSvgBytes(relativePath) {
  return fs.readFileSync(path.join(ZK_PHIL_LAYERS_DIR, relativePath));
}

function loadCatalog() {
  const existingCatalog = readJson(LAYER_CATALOG_PATH);
  if (existingCatalog) {
    return existingCatalog;
  }

  const catalog = buildLayerCatalog();
  writeJson(LAYER_CATALOG_PATH, catalog);
  return catalog;
}

function normalizeUploadEntry(asset, svgId, hash, chunked, chunkCount) {
  return {
    fileName: asset.fileName,
    relativePath: asset.relativePath,
    sizeBytes: asset.sizeBytes,
    contentHash: hash,
    svgId,
    storageRef: svgId,
    chunked,
    chunkCount
  };
}

async function ensureExistingRecord(storageContract, svgId, expectedHash) {
  try {
    const record = getRecordShape(await storageContract.getRecord(svgId));
    if (record.finalized && record.contentHash === expectedHash) {
      return record;
    }
  } catch (error) {
    return null;
  }

  return null;
}

export async function uploadCatalogToStorage({
  signer,
  storageAddress,
  manifestPath = UPLOAD_MANIFEST_PATH,
  statePath = UPLOAD_STATE_PATH
}) {
  const catalog = loadCatalog();
  const provider = signer.provider;
  const network = await provider.getNetwork();
  const chainId = Number(network.chainId);
  const storageArtifact = loadArtifact("PhilSVGStorage");
  const storageContract = new ethers.Contract(storageAddress, storageArtifact.abi, signer);

  const existingState = readJson(statePath);
  const state =
    existingState && existingState.svgStorage?.toLowerCase() === storageAddress.toLowerCase()
      ? existingState
      : createDefaultUploadState(chainId, storageAddress);

  const manifest = {
    generatedAt: new Date().toISOString(),
    network: NETWORK_NAME,
    chainId,
    svgStorage: storageAddress,
    singleUploadLimitBytes: SVG_SINGLE_UPLOAD_LIMIT,
    totalFiles: catalog.assets.length,
    totalSvgBytes: catalog.totals.totalSvgBytes,
    files: {},
    chunkedFiles: []
  };

  const pendingSmallBatch = [];
  let pendingSmallBatchBytes = 0;

  async function processSmallBatch(batchEntries) {
    if (batchEntries.length === 0) {
      return;
    }

    try {
      const predictedIds = await storageContract.storeSvgBatch.staticCall(
        batchEntries.map((entry) => entry.fileBytes)
      );
      const tx = await storageContract.storeSvgBatch(
        batchEntries.map((entry) => entry.fileBytes),
        await mergeRecommendedTxOverrides(provider)
      );
      await waitForReceiptWithTimeout(provider, tx.hash);

      for (let batchIndex = 0; batchIndex < batchEntries.length; batchIndex++) {
        const item = batchEntries[batchIndex];
        const svgId = bigintToNumber(predictedIds[batchIndex]);
        const record = getRecordShape(await storageContract.getRecord(svgId));
        const entry = {
          ...normalizeUploadEntry(item.asset, svgId, item.contentHash, false, record.chunkCount),
          finalized: record.finalized
        };

        state.files[item.asset.relativePath] = entry;
        state.updatedAt = new Date().toISOString();
        manifest.files[item.asset.relativePath] = entry;

        console.log(
          `[upload ${item.index + 1}/${catalog.assets.length}] ${item.asset.relativePath} ${item.asset.sizeBytes}b chunked=false svgId=${svgId}`
        );
      }

      writeJson(statePath, state);
    } catch (error) {
      if (batchEntries.length === 1) {
        throw error;
      }

      const midpoint = Math.ceil(batchEntries.length / 2);
      await processSmallBatch(batchEntries.slice(0, midpoint));
      await processSmallBatch(batchEntries.slice(midpoint));
    }
  }

  async function flushSmallBatch() {
    if (pendingSmallBatch.length === 0) {
      return;
    }

    await processSmallBatch([...pendingSmallBatch]);
    pendingSmallBatch.length = 0;
    pendingSmallBatchBytes = 0;
  }

  for (let index = 0; index < catalog.assets.length; index++) {
    const asset = catalog.assets[index];
    const fileBytes = readSvgBytes(asset.relativePath);
    const contentHash = ethers.keccak256(fileBytes);
    const chunked = asset.sizeBytes > SVG_SINGLE_UPLOAD_LIMIT;
    const storedState = state.files[asset.relativePath];

    let svgId = null;
    let record = null;

    if (storedState?.svgId) {
      record = await ensureExistingRecord(storageContract, storedState.svgId, contentHash);
      if (record) {
        svgId = storedState.svgId;
      }
    }

    if (!svgId) {
      const existingSvgId = bigintToNumber(await storageContract.svgIdForHash(contentHash));
      if (existingSvgId !== 0) {
        record = await ensureExistingRecord(storageContract, existingSvgId, contentHash);
        if (record) {
          svgId = existingSvgId;
        }
      }
    }

    if (!svgId && !chunked) {
      pendingSmallBatch.push({
        index,
        asset,
        fileBytes,
        contentHash
      });
      pendingSmallBatchBytes += asset.sizeBytes;

      if (
        pendingSmallBatch.length >= SMALL_BATCH_MAX_ITEMS ||
        pendingSmallBatchBytes >= SMALL_BATCH_MAX_BYTES
      ) {
        await flushSmallBatch();
      }

      continue;
    }

    if (!svgId && chunked) {
      await flushSmallBatch();
      const chunks = splitBuffer(fileBytes, SVG_STORAGE_CHUNK_LIMIT);
      svgId = storedState?.svgId || null;

      if (!svgId) {
        svgId = bigintToNumber(
          await storageContract.initializeChunkedSvg.staticCall(
            asset.sizeBytes,
            contentHash,
            chunks.length
          )
        );
        const tx = await storageContract.initializeChunkedSvg(
          asset.sizeBytes,
          contentHash,
          chunks.length,
          await mergeRecommendedTxOverrides(provider)
        );
        await waitForReceiptWithTimeout(provider, tx.hash);
      }

      record = getRecordShape(await storageContract.getRecord(svgId));
      if (record.chunkCount < chunks.length) {
        const chunkTx = await storageContract.appendChunks(
          svgId,
          chunks.slice(record.chunkCount),
          await mergeRecommendedTxOverrides(provider)
        );
        await waitForReceiptWithTimeout(provider, chunkTx.hash);
        record = getRecordShape(await storageContract.getRecord(svgId));
      }

      if (!record.finalized) {
        const finalizeTx = await storageContract.finalizeChunkedSvg(
          svgId,
          await mergeRecommendedTxOverrides(provider)
        );
        await waitForReceiptWithTimeout(provider, finalizeTx.hash);
        record = getRecordShape(await storageContract.getRecord(svgId));
      }
    }

    if (!record) {
      record = getRecordShape(await storageContract.getRecord(svgId));
    }

    const entry = {
      ...normalizeUploadEntry(asset, svgId, contentHash, chunked, record.chunkCount),
      finalized: record.finalized
    };

    state.files[asset.relativePath] = entry;
    state.updatedAt = new Date().toISOString();
    manifest.files[asset.relativePath] = entry;

    if (chunked) {
      manifest.chunkedFiles.push(asset.relativePath);
    }

    writeJson(statePath, state);
    console.log(
      `[upload ${index + 1}/${catalog.assets.length}] ${asset.relativePath} ${asset.sizeBytes}b chunked=${chunked} svgId=${svgId}`
    );
  }

  await flushSmallBatch();
  writeJson(manifestPath, manifest);
  return { manifest, state, catalog };
}

function chunkArray(items, chunkSize) {
  const chunks = [];
  for (let index = 0; index < items.length; index += chunkSize) {
    chunks.push(items.slice(index, index + chunkSize));
  }
  return chunks;
}

export async function registerCatalogToRegistry({ signer, registryAddress, manifest, catalog }) {
  const registryArtifact = loadArtifact("PhilLayerRegistry");
  const registry = new ethers.Contract(registryAddress, registryArtifact.abi, signer);

  const layerCount = bigintToNumber(await registry.layerCount());
  if (layerCount !== 0 && layerCount !== catalog.layers.length) {
    throw new Error(
      `Registry layer count mismatch. Expected 0 or ${catalog.layers.length}, found ${layerCount}`
    );
  }

  if (layerCount === 0) {
    const layerInputs = catalog.layers.map((layer) => ({
      name: layer.name,
      minSelections: layer.minSelections,
      maxSelections: layer.maxSelections
    }));
    const layerTx = await registry.registerLayers(layerInputs, {
      ...(await mergeRecommendedTxOverrides(signer.provider)),
      gasLimit: REGISTER_LAYER_GAS_LIMIT
    });
    await waitForReceiptWithTimeout(signer.provider, layerTx.hash);
  }

  const assetIdByKey = {};
  const variantIdByKey = {};
  const currentNextAssetId = bigintToNumber(await registry.nextAssetId());
  const currentNextVariantId = bigintToNumber(await registry.nextVariantId());

  let deterministicAssetId = 1;
  let deterministicVariantId = 1;
  for (const layer of catalog.layers) {
    for (const asset of layer.assets) {
      assetIdByKey[asset.key] = deterministicAssetId;
      deterministicAssetId += 1;
    }

    for (const variant of layer.variants) {
      variantIdByKey[variant.key] = deterministicVariantId;
      deterministicVariantId += 1;
    }
  }

  for (const layer of catalog.layers) {
    const assetChunks = chunkArray(
      layer.assets.map((asset) => ({
        layerId: layer.id,
        storageId: manifest.files[asset.relativePath].svgId,
        sublayer: asset.sublayer,
        fileName: asset.fileName,
        _assetKey: asset.key
      })),
      REGISTER_ASSET_BATCH_SIZE
    );

      for (const assetChunk of assetChunks) {
        if (assetChunk.length === 0) {
          continue;
        }

      const registerableAssets = assetChunk.filter(
        ({ _assetKey }) => assetIdByKey[_assetKey] >= currentNextAssetId
      );
      if (registerableAssets.length === 0) {
        continue;
      }

      const tx = await registry.registerAssets(
        registerableAssets.map(({ layerId, storageId, sublayer, fileName }) => ({
          layerId,
          storageId,
          sublayer,
          fileName
        })),
        {
          ...(await mergeRecommendedTxOverrides(signer.provider)),
          gasLimit: REGISTER_ASSET_GAS_LIMIT
        }
      );
      await waitForReceiptWithTimeout(signer.provider, tx.hash);
    }

    const variantChunks = chunkArray(
      layer.variants.map((variant) => ({
        layerId: layer.id,
        label: variant.label,
        style: variant.style,
        color: variant.color,
        assetIds: variant.assetKeys.map((assetKey) => assetIdByKey[assetKey]),
        _variantKey: variant.key
      })),
      REGISTER_VARIANT_BATCH_SIZE
    );

      for (const variantChunk of variantChunks) {
        if (variantChunk.length === 0) {
          continue;
        }

      const registerableVariants = variantChunk.filter(
        ({ _variantKey }) => variantIdByKey[_variantKey] >= currentNextVariantId
      );
      if (registerableVariants.length === 0) {
        continue;
      }

      const tx = await registry.registerVariants(
        registerableVariants.map(({ layerId, label, style, color, assetIds }) => ({
          layerId,
          label,
          style,
          color,
          assetIds
        })),
        {
          ...(await mergeRecommendedTxOverrides(signer.provider)),
          gasLimit: REGISTER_VARIANT_GAS_LIMIT
        }
      );
      await waitForReceiptWithTimeout(signer.provider, tx.hash);
    }
  }

  const registryManifest = {
    generatedAt: new Date().toISOString(),
    registry: registryAddress,
    layerIds: Object.fromEntries(catalog.layers.map((layer) => [layer.name, layer.id])),
    assetIds: assetIdByKey,
    variantIds: variantIdByKey
  };

  writeJson(REGISTRY_MANIFEST_PATH, registryManifest);
  return registryManifest;
}

export function loadDeploymentAddresses() {
  return readJson(getStableArtBackendManifestPath(11155111), null);
}

export function uploadStatePath() {
  ensureDir(DEPLOYMENTS_DIR);
  return UPLOAD_STATE_PATH;
}

export function registryManifestPath() {
  ensureDir(GENERATED_DIR);
  return REGISTRY_MANIFEST_PATH;
}
