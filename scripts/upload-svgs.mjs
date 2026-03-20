import { ethers } from "ethers";

import { getSepoliaWallet, loadArtifact } from "../src/contracts.mjs";
import { loadDeploymentAddresses } from "../src/sepolia-pipeline.mjs";
import { uploadCatalogToStorage } from "../src/sepolia-pipeline.mjs";

const deploymentAddresses = loadDeploymentAddresses();
const svgStorageAddress =
  process.env.SVG_STORAGE_ADDRESS || deploymentAddresses?.contracts?.svgStorage;

if (!svgStorageAddress) {
  throw new Error(
    "Missing SVG storage address. Set SVG_STORAGE_ADDRESS or deploy the contracts first."
  );
}

const wallet = getSepoliaWallet();
const provider = wallet.provider;
const network = await provider.getNetwork();

if (Number(network.chainId) !== 11155111) {
  throw new Error(`Expected Sepolia (11155111), received chainId ${network.chainId}`);
}

const result = await uploadCatalogToStorage({
  signer: wallet,
  storageAddress: svgStorageAddress
});

console.log(
  JSON.stringify(
    {
      network: "sepolia",
      svgStorage: svgStorageAddress,
      uploadedFiles: Object.keys(result.manifest.files).length,
      chunkedFiles: result.manifest.chunkedFiles.length
    },
    null,
    2
  )
);
