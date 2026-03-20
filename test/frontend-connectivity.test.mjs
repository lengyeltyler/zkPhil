import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";

import "dotenv/config";
import { ethers } from "ethers";

import { DEPLOYMENTS_DIR, FRONTEND_DIR, readJson } from "../src/workspace.mjs";

const deployment = readJson(path.join(DEPLOYMENTS_DIR, "sepolia-addresses.json"));
const frontendContracts = readJson(path.join(FRONTEND_DIR, "public", "contracts.json"));

const rpcUrl = process.env.RPC_URL_SEPOLIA || process.env.RPC_URL;
const enableLiveRpcTests = process.env.ENABLE_LIVE_RPC_TESTS === "true";
const hasLiveRpcUrl = Boolean(
  enableLiveRpcTests
    && rpcUrl
    && !rpcUrl.includes("your_project_id")
    && !rpcUrl.includes("your_api_key")
    && !rpcUrl.includes("your_rpc")
    && !rpcUrl.includes("placeholder")
);

test(
  "frontend runtime config points at the live Sepolia contracts",
  { skip: !deployment || !hasLiveRpcUrl || !deployment.contracts?.philNft },
  async () => {
    assert.equal(frontendContracts.contracts.philNft.address, deployment.contracts.philNft);
    assert.equal(frontendContracts.contracts.layerRegistry.address, deployment.contracts.layerRegistry);
    assert.equal(frontendContracts.contracts.svgStorage.address, deployment.contracts.svgStorage);

    const provider = new ethers.JsonRpcProvider(rpcUrl);
    const philNft = new ethers.Contract(
      deployment.contracts.philNft,
      frontendContracts.contracts.philNft.abi,
      provider
    );
    const layerRegistry = new ethers.Contract(
      deployment.contracts.layerRegistry,
      frontendContracts.contracts.layerRegistry.abi,
      provider
    );

    assert.equal(await philNft.name(), "Phil");
    assert.equal(Number(await layerRegistry.layerCount()), 13);
  }
);
