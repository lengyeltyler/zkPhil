import assert from "node:assert/strict";
import test from "node:test";

import { createTestContext, decodeJsonDataUri, deploy, svgDoc, assertIncludesInOrder } from "./test-helpers.mjs";

test("PhilNFT mints, renders tokenURI metadata, and preserves stack order", async () => {
  const { owner, user } = await createTestContext();
  const ownerAddress = await owner.getAddress();
  const storage = await deploy("PhilSVGStorage", owner, [ownerAddress]);
  const registry = await deploy("PhilLayerRegistry", owner, [await storage.getAddress(), ownerAddress]);

  await (
    await registry.registerLayers([
      { name: "Top", minSelections: 1, maxSelections: 1 },
      { name: "Eyes", minSelections: 1, maxSelections: 1 },
      { name: "JawNose", minSelections: 1, maxSelections: 1 },
      { name: "Teeth", minSelections: 1, maxSelections: 1 },
      { name: "Spikes", minSelections: 1, maxSelections: 1 },
      { name: "Body", minSelections: 1, maxSelections: 1 },
      { name: "Special", minSelections: 0, maxSelections: 0 },
      { name: "BgOverlay", minSelections: 1, maxSelections: 1 },
      { name: "BgDust", minSelections: 0, maxSelections: 0 },
      { name: "BgSpiral", minSelections: 0, maxSelections: 0 },
      { name: "BgStars", minSelections: 0, maxSelections: 0 },
      { name: "BgNebula", minSelections: 0, maxSelections: 0 },
      { name: "BgColor", minSelections: 1, maxSelections: 1 }
    ])
  ).wait();

  const bgSvg = Buffer.from(svgDoc('<rect width="420" height="420" fill="#ffdd55"/>'));
  const bodySvg = Buffer.from(svgDoc('<circle cx="210" cy="210" r="110" fill="#229977"/>'));
  const topSvg = Buffer.from(svgDoc('<rect x="110" y="60" width="200" height="70" fill="#1122cc"/>'));

  const bgId = Number(await storage.storeSvg.staticCall(bgSvg));
  await (await storage.storeSvg(bgSvg)).wait();
  const bodyId = Number(await storage.storeSvg.staticCall(bodySvg));
  await (await storage.storeSvg(bodySvg)).wait();
  const topId = Number(await storage.storeSvg.staticCall(topSvg));
  await (await storage.storeSvg(topSvg)).wait();

  await (
    await registry.registerAssets([
      { layerId: 12, storageId: bgId, sublayer: "BgColor", fileName: "BgGold.svg" },
      { layerId: 5, storageId: bodyId, sublayer: "Body1", fileName: "Body1Green.svg" },
      { layerId: 0, storageId: topId, sublayer: "Top1", fileName: "Top1Blue.svg" }
    ])
  ).wait();

  await (
    await registry.registerVariants([
      {
        layerId: 12,
        label: "BgColor Gold",
        style: "BgColor",
        color: "Gold",
        assetIds: [1]
      },
      {
        layerId: 5,
        label: "Body1 Green",
        style: "Body1",
        color: "Green",
        assetIds: [2]
      },
      {
        layerId: 0,
        label: "Top1 Blue",
        style: "Top1",
        color: "Blue",
        assetIds: [3]
      }
    ])
  ).wait();

  const nft = await deploy("PhilNFT", owner, [
    await registry.getAddress(),
    await storage.getAddress(),
    ownerAddress
  ]);

  const userNft = nft.connect(user);
  await (await userNft.mint()).wait();

  assert.equal(Number(await nft.totalSupply()), 1);

  const rendered = await nft.renderSVG(1);
  const orderedNeedles = [
    Buffer.from(bgSvg).toString("base64"),
    Buffer.from(bodySvg).toString("base64"),
    Buffer.from(topSvg).toString("base64")
  ];
  assertIncludesInOrder(rendered, orderedNeedles);

  const metadata = decodeJsonDataUri(await nft.tokenURI(1));
  assert.equal(metadata.name, "Phil #1");
  assert.equal(metadata.attributes.length, 13);
  assert.match(metadata.image, /^data:image\/svg\+xml;base64,/);
});
