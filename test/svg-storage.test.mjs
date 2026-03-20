import assert from "node:assert/strict";
import test from "node:test";

import { ethers } from "ethers";

import { createTestContext, deploy, svgDoc } from "./test-helpers.mjs";

const STORAGE_CHUNK_LIMIT = 24_575;

test("PhilSVGStorage stores single and chunked SVG uploads without mutation", async () => {
  const { owner } = await createTestContext();
  const ownerAddress = await owner.getAddress();
  const storage = await deploy("PhilSVGStorage", owner, [ownerAddress]);

  const smallSvg = Buffer.from(svgDoc('<rect width="420" height="420" fill="#111111"/>'));
  const smallSvgId = Number(await storage.storeSvg.staticCall(smallSvg));
  await (await storage.storeSvg(smallSvg)).wait();
  assert.equal(await storage.readSvg(smallSvgId), smallSvg.toString("utf8"));

  const largeSvg = Buffer.from(
    svgDoc(`<text x="12" y="24">${"chunk".repeat(7000)}</text>`)
  );
  const contentHash = ethers.keccak256(largeSvg);
  const chunks = [];
  for (let offset = 0; offset < largeSvg.length; offset += STORAGE_CHUNK_LIMIT) {
    chunks.push(largeSvg.subarray(offset, offset + STORAGE_CHUNK_LIMIT));
  }
  const uploadId = Number(
    await storage.initializeChunkedSvg.staticCall(largeSvg.length, contentHash, chunks.length)
  );

  await (await storage.initializeChunkedSvg(largeSvg.length, contentHash, chunks.length)).wait();
  for (const chunk of chunks) {
    await (await storage.appendChunk(uploadId, chunk)).wait();
  }
  await (await storage.finalizeChunkedSvg(uploadId)).wait();

  const storedLargeSvg = Buffer.from(
    ethers.getBytes(await storage.readSvgBytes(uploadId))
  ).toString("utf8");
  assert.equal(storedLargeSvg, largeSvg.toString("utf8"));

  const record = await storage.getRecord(uploadId);
  assert.equal(Number(record[0]), largeSvg.length);
  assert.equal(record[4], true);
});
