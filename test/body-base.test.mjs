import assert from "node:assert/strict";
import test from "node:test";

import { createTestContext, deploy, svgDoc, assertIncludesInOrder } from "./test-helpers.mjs";

function encodedSvg(svg) {
  return Buffer.from(svg).toString("base64");
}

test("PhilNFT keeps BodyBase behind Body while strongly biasing away from the Body color", async () => {
  const { owner, user } = await createTestContext();
  const ownerAddress = await owner.getAddress();
  const storage = await deploy("PhilSVGStorage", owner, [ownerAddress]);
  const registry = await deploy("PhilLayerRegistry", owner, [await storage.getAddress(), ownerAddress]);

  await (
    await registry.registerLayers([
      { name: "Top", minSelections: 1, maxSelections: 1 },
      { name: "Eyes", minSelections: 0, maxSelections: 0 },
      { name: "JawNose", minSelections: 0, maxSelections: 0 },
      { name: "Teeth", minSelections: 0, maxSelections: 0 },
      { name: "Spikes", minSelections: 0, maxSelections: 0 },
      { name: "Body", minSelections: 1, maxSelections: 1 },
      { name: "BodyBase", minSelections: 1, maxSelections: 1 },
      { name: "BgOverlay", minSelections: 0, maxSelections: 0 },
      { name: "BgDust", minSelections: 0, maxSelections: 0 },
      { name: "BgSpiral", minSelections: 0, maxSelections: 0 },
      { name: "BgStars", minSelections: 0, maxSelections: 0 },
      { name: "BgNebula", minSelections: 0, maxSelections: 0 },
      { name: "BgColor", minSelections: 1, maxSelections: 1 }
    ])
  ).wait();

  const bgSvg = svgDoc('<rect width="420" height="420" fill="#111827"/>');
  const bodyGreenSvg = svgDoc('<circle cx="210" cy="220" r="118" fill="#059669"/>');
  const bodyPurpleSvg = svgDoc('<rect x="96" y="112" width="228" height="228" rx="92" fill="#7c3aed"/>');
  const bodyBaseGreenSvg = svgDoc('<circle cx="210" cy="240" r="132" fill="#99f6e4"/>');
  const bodyBasePurpleSvg = svgDoc('<rect x="80" y="96" width="260" height="260" rx="108" fill="#ddd6fe"/>');
  const topSvg = svgDoc('<rect x="110" y="56" width="200" height="74" fill="#f59e0b"/>');

  const svgEntries = [
    Buffer.from(bgSvg),
    Buffer.from(bodyGreenSvg),
    Buffer.from(bodyPurpleSvg),
    Buffer.from(bodyBaseGreenSvg),
    Buffer.from(bodyBasePurpleSvg),
    Buffer.from(topSvg)
  ];

  const svgIds = [];
  for (const svgBytes of svgEntries) {
    const svgId = Number(await storage.storeSvg.staticCall(svgBytes));
    await (await storage.storeSvg(svgBytes)).wait();
    svgIds.push(svgId);
  }

  await (
    await registry.registerAssets([
      { layerId: 12, storageId: svgIds[0], sublayer: "BgColor", fileName: "BgColorMidnight.svg" },
      { layerId: 5, storageId: svgIds[1], sublayer: "Body1", fileName: "Body1Green.svg" },
      { layerId: 5, storageId: svgIds[2], sublayer: "Body2", fileName: "Body2Purple.svg" },
      { layerId: 6, storageId: svgIds[3], sublayer: "BodyBase1", fileName: "BodyBase1Green.svg" },
      { layerId: 6, storageId: svgIds[4], sublayer: "BodyBase2", fileName: "BodyBase2Purple.svg" },
      { layerId: 0, storageId: svgIds[5], sublayer: "Top1", fileName: "Top1Gold.svg" }
    ])
  ).wait();

  await (
    await registry.registerVariants([
      {
        layerId: 12,
        label: "BgColor Midnight",
        style: "BgColor",
        color: "Midnight",
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
        layerId: 5,
        label: "Body2 Purple",
        style: "Body2",
        color: "Purple",
        assetIds: [3]
      },
      {
        layerId: 6,
        label: "BodyBase1 Green",
        style: "Body1",
        color: "Green",
        assetIds: [4]
      },
      {
        layerId: 6,
        label: "BodyBase2 Purple",
        style: "Body2",
        color: "Purple",
        assetIds: [5]
      },
      {
        layerId: 0,
        label: "Top1 Gold",
        style: "Top1",
        color: "Gold",
        assetIds: [6]
      }
    ])
  ).wait();

  const nft = await deploy("PhilNFT", owner, [
    await registry.getAddress(),
    await storage.getAddress(),
    ownerAddress
  ]);

  const userNft = nft.connect(user);
  const baseSvgByColor = {
    Green: encodedSvg(bodyBaseGreenSvg),
    Purple: encodedSvg(bodyBasePurpleSvg)
  };
  const bodySvgByColor = {
    Green: encodedSvg(bodyGreenSvg),
    Purple: encodedSvg(bodyPurpleSvg)
  };

  let sameColorCount = 0;

  for (let tokenId = 1; tokenId <= 12; tokenId++) {
    await (await userNft.mint({ gasLimit: 3_000_000n })).wait();

    const [bodyVariantId] = await nft.getLayerSelections(tokenId, 5);
    const [bodyBaseVariantId] = await nft.getLayerSelections(tokenId, 6);
    assert.ok(bodyVariantId > 0n);
    assert.ok(bodyBaseVariantId > 0n);

    const bodyVariant = await registry.getVariant(bodyVariantId);
    const bodyBaseVariant = await registry.getVariant(bodyBaseVariantId);

    if (bodyBaseVariant[3] === bodyVariant[3]) {
      sameColorCount += 1;
    }

    const rendered = await nft.renderSVG(tokenId);
    assertIncludesInOrder(rendered, [
      encodedSvg(bgSvg),
      baseSvgByColor[bodyBaseVariant[3]],
      bodySvgByColor[bodyVariant[3]],
      encodedSvg(topSvg)
    ]);
  }

  assert.ok(sameColorCount <= 2, `expected BodyBase to rarely match Body color, saw ${sameColorCount}/12`);
});
