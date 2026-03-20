import fs from "node:fs";
import path from "node:path";

import dotenv from "dotenv";
import { ethers } from "ethers";
import { waitForReceiptWithTimeout } from "../scripts/sepolia/txutil.mjs";
import { mergeRecommendedTxOverrides } from "../shared/deploy/feeOverrides.mjs";

import {
  ARTIFACTS_DIR,
  FRONTEND_ABI_DIR,
  FRONTEND_DIR,
  REPO_ROOT,
  ensureDir,
  writeJson
} from "./workspace.mjs";

dotenv.config();

export const CONTRACT_NAMES = ["PhilSVGStorage", "PhilLayerRegistry", "PhilNFT"];

export function artifactPath(contractName) {
  const manualArtifact = path.join(ARTIFACTS_DIR, "manual-compile", `${contractName}.json`);
  if (fs.existsSync(manualArtifact)) {
    return manualArtifact;
  }

  const hardhatArtifact = path.join(
    ARTIFACTS_DIR,
    "contracts",
    `${contractName}.sol`,
    `${contractName}.json`
  );
  if (fs.existsSync(hardhatArtifact)) {
    return hardhatArtifact;
  }

  return manualArtifact;
}

export function loadArtifact(contractName) {
  return JSON.parse(fs.readFileSync(artifactPath(contractName), "utf8"));
}

export function getSepoliaProvider() {
  const rpcUrl = process.env.RPC_URL_SEPOLIA || process.env.RPC_URL;
  if (!rpcUrl) {
    throw new Error("Missing RPC_URL_SEPOLIA or RPC_URL in the environment");
  }
  if (/your_project_id|your_api_key|your_rpc|placeholder/i.test(rpcUrl)) {
    throw new Error("RPC_URL_SEPOLIA/RPC_URL still contains a placeholder value");
  }

  return new ethers.JsonRpcProvider(rpcUrl);
}

export function getSepoliaWallet(provider = getSepoliaProvider()) {
  if (!process.env.PRIVATE_KEY) {
    throw new Error("Missing PRIVATE_KEY in the environment");
  }
  if (/your_private_key|placeholder/i.test(process.env.PRIVATE_KEY)) {
    throw new Error("PRIVATE_KEY still contains a placeholder value");
  }

  return new ethers.Wallet(process.env.PRIVATE_KEY, provider);
}

export async function deployContract(contractName, signer, constructorArgs = []) {
  const artifact = loadArtifact(contractName);
  const factory = new ethers.ContractFactory(artifact.abi, artifact.bytecode, signer);
  const overrides = await mergeRecommendedTxOverrides(signer.provider);
  const contract = await factory.deploy(...constructorArgs, overrides);
  const deploymentTx = contract.deploymentTransaction();
  if (!deploymentTx) {
    throw new Error(`Missing deployment transaction for ${contractName}`);
  }
  await waitForReceiptWithTimeout(signer.provider, deploymentTx.hash);
  return contract;
}

export function exportAbis(outputDir = FRONTEND_ABI_DIR) {
  ensureDir(outputDir);

  const index = {};
  for (const contractName of CONTRACT_NAMES) {
    const artifact = loadArtifact(contractName);
    const targetPath = path.join(outputDir, `${contractName}.json`);
    writeJson(targetPath, artifact.abi);
    index[contractName] = path.relative(REPO_ROOT, targetPath);
  }

  return index;
}

export function writeFrontendContractsConfig(addresses) {
  const payload = {
    network: addresses.network,
    chainId: addresses.chainId,
    contracts: {
      svgStorage: {
        address: addresses.contracts.svgStorage,
        abi: loadArtifact("PhilSVGStorage").abi
      },
      layerRegistry: {
        address: addresses.contracts.layerRegistry,
        abi: loadArtifact("PhilLayerRegistry").abi
      },
      philNft: {
        address: addresses.contracts.philNft,
        abi: loadArtifact("PhilNFT").abi
      }
    }
  };

  writeJson(path.join(FRONTEND_DIR, "public", "contracts.json"), payload);
  return payload;
}
