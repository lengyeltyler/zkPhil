import path from "node:path";
import { ethers } from "ethers";
import {
  deployContract,
  exportAbis,
  getSepoliaWallet,
  writeFrontendContractsConfig
} from "../src/contracts.mjs";
import { buildLayerCatalog } from "../src/layer-catalog.mjs";
import { registerCatalogToRegistry, uploadCatalogToStorage } from "../src/sepolia-pipeline.mjs";
import { getStableArtBackendManifestPath } from "../shared/deploy/artBackendManifest.mjs";
import {
  DEPLOYMENTS_DIR,
  LAYER_CATALOG_PATH,
  REPO_ROOT,
  UPLOAD_MANIFEST_PATH,
  readJson,
  writeJson
} from "../src/workspace.mjs";

const wallet = getSepoliaWallet();
const provider = wallet.provider;
const network = await provider.getNetwork();

if (Number(network.chainId) !== 11155111) {
  throw new Error(`Expected Sepolia (11155111), received chainId ${network.chainId}`);
}

const catalog = buildLayerCatalog();
writeJson(LAYER_CATALOG_PATH, catalog);

const stableArtManifestPath = getStableArtBackendManifestPath(network.chainId);
const existingAddresses = readJson(stableArtManifestPath, null)
  || readJson(path.join(DEPLOYMENTS_DIR, "sepolia-addresses.json"), null);
const requestedSvgStorage = String(
  process.env.PHIL_SVG_STORAGE || existingAddresses?.contracts?.svgStorage || ""
).trim();

let svgStorageAddress = "";
let reusedSvgStorage = false;

if (requestedSvgStorage) {
  svgStorageAddress = ethers.getAddress(requestedSvgStorage);
  reusedSvgStorage = true;
  console.log(`Reusing PhilSVGStorage: ${svgStorageAddress}`);
} else {
  const svgStorage = await deployContract("PhilSVGStorage", wallet, [wallet.address]);
  svgStorageAddress = await svgStorage.getAddress();
  console.log(`Deployed PhilSVGStorage: ${svgStorageAddress}`);
}

const { manifest } = await uploadCatalogToStorage({
  signer: wallet,
  storageAddress: svgStorageAddress
});

const layerRegistry = await deployContract("PhilLayerRegistry", wallet, [svgStorageAddress, wallet.address]);
const layerRegistryAddress = await layerRegistry.getAddress();
console.log(`Deployed PhilLayerRegistry: ${layerRegistryAddress}`);

const registryManifest = await registerCatalogToRegistry({
  signer: wallet,
  registryAddress: layerRegistryAddress,
  manifest,
  catalog
});

const philNft = await deployContract("PhilNFT", wallet, [
  layerRegistryAddress,
  svgStorageAddress,
  wallet.address
]);
const philNftAddress = await philNft.getAddress();
console.log(`Deployed PhilNFT: ${philNftAddress}`);

const abiPaths = exportAbis();

const addresses = {
  generatedAt: new Date().toISOString(),
  network: "sepolia",
  chainId: Number(network.chainId),
  deployer: wallet.address,
  contracts: {
    svgStorage: svgStorageAddress,
    layerRegistry: layerRegistryAddress,
    philNft: philNftAddress
  },
  storageReused: reusedSvgStorage,
  manifests: {
    layerCatalog: path.relative(REPO_ROOT, LAYER_CATALOG_PATH),
    uploadManifest: path.relative(REPO_ROOT, UPLOAD_MANIFEST_PATH),
    registryManifest: path.relative(REPO_ROOT, path.join("generated", "registry-manifest.json"))
  },
  frontendAbis: abiPaths,
  verification: {
    attempted: false,
    verified: false,
    reason: process.env.ETHERSCAN_API_KEY
      ? "ETHERSCAN_API_KEY is set, but automated verification tooling is not configured in this repo."
      : "ETHERSCAN_API_KEY is not configured."
  }
};

writeJson(stableArtManifestPath, {
  ...addresses,
  stable: true,
  source: "Stable Sepolia trait/data infrastructure reused by mutable zkPhil identity deployments."
});
writeFrontendContractsConfig(addresses);

console.log(JSON.stringify(addresses, null, 2));
