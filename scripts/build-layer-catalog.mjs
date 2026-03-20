import { buildLayerCatalog } from "../src/layer-catalog.mjs";
import { LAYER_CATALOG_PATH, writeJson } from "../src/workspace.mjs";

const catalog = buildLayerCatalog();
writeJson(LAYER_CATALOG_PATH, catalog);

console.log(
  JSON.stringify(
    {
      output: LAYER_CATALOG_PATH,
      totals: catalog.totals
    },
    null,
    2
  )
);
