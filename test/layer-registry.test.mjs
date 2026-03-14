import assert from "node:assert/strict";
import test from "node:test";

import { PHIL_LAYER_ORDER } from "../src/layer-catalog.mjs";
import { createTestContext, deploy } from "./test-helpers.mjs";

test("PhilLayerRegistry registers and exposes the full 13-layer stack", async () => {
  const { owner } = await createTestContext();
  const ownerAddress = await owner.getAddress();
  const storage = await deploy("PhilSVGStorage", owner, [ownerAddress]);
  const registry = await deploy("PhilLayerRegistry", owner, [await storage.getAddress(), ownerAddress]);

  await (
    await registry.registerLayers(
      PHIL_LAYER_ORDER.map((layer) => ({
        name: layer.name,
        minSelections: layer.minSelections,
        maxSelections: layer.maxSelections
      }))
    )
  ).wait();

  assert.equal(Number(await registry.layerCount()), 13);

  for (let layerId = 0; layerId < PHIL_LAYER_ORDER.length; layerId++) {
    const layer = await registry.getLayer(layerId);
    assert.equal(layer[0], PHIL_LAYER_ORDER[layerId].name);
    assert.equal(Number(layer[1]), layerId);
    assert.equal(Number(layer[2]), PHIL_LAYER_ORDER[layerId].minSelections);
    assert.equal(Number(layer[3]), PHIL_LAYER_ORDER[layerId].maxSelections);
  }
});
