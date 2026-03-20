import assert from "node:assert/strict";

import { ethers } from "ethers";

import { loadArtifact } from "../src/contracts.mjs";

export async function createTestContext() {
  const provider = new ethers.JsonRpcProvider(process.env.TEST_RPC_URL || "http://127.0.0.1:8545");
  const signers = await Promise.all(
    Array.from({ length: 3 }, (_, index) => provider.getSigner(index))
  );

  return {
    provider,
    signers,
    owner: signers[0],
    user: signers[1]
  };
}

export async function deploy(contractName, signer, args = []) {
  const artifact = loadArtifact(contractName);
  const factory = new ethers.ContractFactory(artifact.abi, artifact.bytecode, signer);
  const contract = await factory.deploy(...args);
  await contract.waitForDeployment();
  return contract;
}

export function bytesToHex(bytes) {
  return `0x${Buffer.from(bytes).toString("hex")}`;
}

export function svgDoc(innerMarkup) {
  return `<?xml version="1.0" encoding="UTF-8"?><svg xmlns="http://www.w3.org/2000/svg" width="420" height="420" viewBox="0 0 420 420">${innerMarkup}</svg>`;
}

export function decodeJsonDataUri(dataUri) {
  const encoded = dataUri.split(",")[1] || "";
  return JSON.parse(Buffer.from(encoded, "base64").toString("utf8"));
}

export function assertIncludesInOrder(haystack, needles) {
  let cursor = -1;
  for (const needle of needles) {
    const nextCursor = haystack.indexOf(needle, cursor + 1);
    assert.notEqual(nextCursor, -1, `Missing substring: ${needle}`);
    cursor = nextCursor;
  }
}
