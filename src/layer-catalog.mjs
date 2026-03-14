import fs from "node:fs";
import path from "node:path";

import {
  LAYER_CATALOG_PATH,
  ZK_PHIL_LAYERS_DIR,
  normalizePath,
  writeJson
} from "./workspace.mjs";

export const PHIL_COLORS = [
  "Brown",
  "Bubblegum",
  "Coral",
  "Espresso",
  "Grape",
  "Green",
  "Midnight",
  "Onyx",
  "Purple",
  "Saphire",
  "SkyBlue",
  "Teal",
  "Turquoise"
];

export const SVG_SINGLE_UPLOAD_LIMIT = 24_576;
export const SVG_STORAGE_CHUNK_LIMIT = 24_575;

export const PHIL_CANVAS = {
  width: 420,
  height: 420,
  viewBox: "0 0 420 420"
};

const BODY_BASE_DIR_NAME = "BodyBase";

export function hasBodyBaseAssets(rootDir = ZK_PHIL_LAYERS_DIR) {
  return fs.existsSync(path.join(rootDir, BODY_BASE_DIR_NAME));
}

export function getPhilLayerOrder(rootDir = ZK_PHIL_LAYERS_DIR) {
  return [
    { name: "Top", minSelections: 1, maxSelections: 1 },
    { name: "Eyes", minSelections: 1, maxSelections: 1 },
    { name: "JawNose", minSelections: 1, maxSelections: 1 },
    { name: "Teeth", minSelections: 1, maxSelections: 1 },
    { name: "Spikes", minSelections: 1, maxSelections: 1 },
    { name: "Body", minSelections: 1, maxSelections: 1 },
    hasBodyBaseAssets(rootDir)
      ? { name: "BodyBase", minSelections: 1, maxSelections: 1 }
      : { name: "Special", minSelections: 0, maxSelections: 0 },
    { name: "BgOverlay", minSelections: 1, maxSelections: 3 },
    { name: "BgDust", minSelections: 1, maxSelections: 1 },
    { name: "BgSpiral", minSelections: 1, maxSelections: 1 },
    { name: "BgStars", minSelections: 1, maxSelections: 1 },
    { name: "BgNebula", minSelections: 1, maxSelections: 1 },
    { name: "BgColor", minSelections: 1, maxSelections: 1 }
  ];
}

export const PHIL_LAYER_ORDER = getPhilLayerOrder();

const EXPECTED_COUNTS = {
  Top: { assets: 13, variants: 13 },
  Eyes: { assets: 65, variants: 39 },
  JawNose: { assets: 26, variants: 26 },
  Teeth: { assets: 26, variants: 26 },
  Spikes: { assets: 65, variants: 65 },
  Body: { assets: 52, variants: 52 },
  BodyBase: { dynamic: true, minAssets: 1, minVariants: 1 },
  Special: { assets: 0, variants: 0 },
  BgOverlay: { assets: 39, variants: 39 },
  BgDust: { assets: 13, variants: 13 },
  BgSpiral: { assets: 39, variants: 39 },
  BgStars: { assets: 13, variants: 13 },
  BgNebula: { assets: 117, variants: 117 },
  BgColor: { assets: 13, variants: 13 }
};

const COLOR_SET = new Set(PHIL_COLORS);

function listSvgFiles(directory) {
  if (!fs.existsSync(directory)) {
    throw new Error(`Missing expected directory: ${directory}`);
  }

  return fs
    .readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".svg"))
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right));
}

function fileSize(rootDir, relativePath) {
  return fs.statSync(path.join(rootDir, relativePath)).size;
}

function parseSimpleColor(fileName, prefix) {
  if (!fileName.startsWith(prefix) || !fileName.endsWith(".svg")) {
    throw new Error(`Unexpected file name ${fileName}; expected prefix ${prefix}`);
  }

  const color = fileName.slice(prefix.length, -4);
  if (!COLOR_SET.has(color)) {
    throw new Error(`Unexpected color "${color}" in ${fileName}`);
  }

  return color;
}

function parseWrappedColor(fileName, prefix, suffix) {
  if (!fileName.startsWith(prefix) || !fileName.endsWith(`${suffix}.svg`)) {
    throw new Error(
      `Unexpected file name ${fileName}; expected prefix ${prefix} and suffix ${suffix}.svg`
    );
  }

  const color = fileName.slice(prefix.length, -(suffix.length + 4));
  if (!COLOR_SET.has(color)) {
    throw new Error(`Unexpected color "${color}" in ${fileName}`);
  }

  return color;
}

function ensureColorCoverage(actualColors, label) {
  const actualSet = new Set(actualColors);
  for (const color of PHIL_COLORS) {
    if (!actualSet.has(color)) {
      throw new Error(`Missing ${label} color variant: ${color}`);
    }
  }
}

function createAsset({
  rootDir,
  layerId,
  layerName,
  relativePath,
  sublayer,
  style,
  color
}) {
  const normalized = normalizePath(relativePath);

  return {
    key: normalized,
    layerId,
    layerName,
    relativePath: normalized,
    fileName: path.basename(relativePath),
    sublayer,
    style,
    color,
    sizeBytes: fileSize(rootDir, relativePath)
  };
}

function createVariant({ layerId, layerName, style, color, assetKeys, label = null }) {
  return {
    key: `${layerName}:${style}:${color}:${assetKeys.join("|")}`,
    layerId,
    layerName,
    label: label || `${style} ${color}`,
    style,
    color,
    assetKeys
  };
}

function buildSingleAssetGroupLayer(rootDir, layerId, layerName, groups) {
  const assets = [];
  const variants = [];

  for (const group of groups) {
    const absoluteDir = path.join(rootDir, group.relativeDir);
    const files = listSvgFiles(absoluteDir);
    const colors = [];

    for (const fileName of files) {
      const color = group.parseColor(fileName);
      const relativePath = path.join(group.relativeDir, fileName);
      const asset = createAsset({
        rootDir,
        layerId,
        layerName,
        relativePath,
        sublayer: group.sublayer,
        style: group.style,
        color
      });

      assets.push(asset);
      variants.push(
        createVariant({
          layerId,
          layerName,
          style: group.variantStyle || group.style,
          color,
          label: group.label ? group.label(color, fileName) : null,
          assetKeys: [asset.key]
        })
      );
      colors.push(color);
    }

    ensureColorCoverage(colors, `${layerName}/${group.sublayer}`);
  }

  return { assets, variants };
}

function buildEyesLayer(rootDir, layerId) {
  const layerName = "Eyes";
  const simple = buildSingleAssetGroupLayer(rootDir, layerId, layerName, [
    {
      relativeDir: path.join("Eyes", "Eyes1"),
      sublayer: "Eyes1",
      style: "Eyes1",
      parseColor: (fileName) => parseSimpleColor(fileName, "Eyes1")
    }
  ]);

  const assets = [...simple.assets];
  const variants = [...simple.variants];

  for (const styleId of [2, 3]) {
    const frameDir = path.join("Eyes", `Eyes${styleId}`, `Eyes${styleId}Frame`);
    const lensDir = path.join("Eyes", `Eyes${styleId}`, `Eyes${styleId}Lens`);
    const frameFiles = listSvgFiles(path.join(rootDir, frameDir));
    const lensFiles = listSvgFiles(path.join(rootDir, lensDir));

    const frameByColor = new Map();
    const lensByColor = new Map();

    for (const fileName of frameFiles) {
      const color = parseSimpleColor(fileName, `Frame${styleId}`);
      const asset = createAsset({
        rootDir,
        layerId,
        layerName,
        relativePath: path.join(frameDir, fileName),
        sublayer: `Eyes${styleId}Frame`,
        style: `Eyes${styleId}`,
        color
      });

      assets.push(asset);
      frameByColor.set(color, asset);
    }

    for (const fileName of lensFiles) {
      const color = parseSimpleColor(fileName, `Lens${styleId}`);
      const asset = createAsset({
        rootDir,
        layerId,
        layerName,
        relativePath: path.join(lensDir, fileName),
        sublayer: `Eyes${styleId}Lens`,
        style: `Eyes${styleId}`,
        color
      });

      assets.push(asset);
      lensByColor.set(color, asset);
    }

    ensureColorCoverage([...frameByColor.keys()], `Eyes${styleId} frame`);
    ensureColorCoverage([...lensByColor.keys()], `Eyes${styleId} lens`);

    for (const color of PHIL_COLORS) {
      const frameAsset = frameByColor.get(color);
      const lensAsset = lensByColor.get(color);

      if (!frameAsset || !lensAsset) {
        throw new Error(`Missing Eyes${styleId} pair for color ${color}`);
      }

      variants.push(
        createVariant({
          layerId,
          layerName,
          style: `Eyes${styleId}`,
          color,
          assetKeys: [frameAsset.key, lensAsset.key]
        })
      );
    }
  }

  return { assets, variants };
}

function buildSpikesLayer(rootDir, layerId) {
  const layerName = "Spikes";
  const groups = [
    {
      relativeDir: path.join("Spikes", "Spikes1"),
      sublayer: "Spikes1",
      style: "Spikes1",
      parseColor: (fileName) => parseSimpleColor(fileName, "Spikes1")
    },
    {
      relativeDir: path.join("Spikes", "Spikes2"),
      sublayer: "Spikes2",
      style: "Spikes2",
      parseColor: (fileName) => parseSimpleColor(fileName, "Spikes2")
    },
    {
      relativeDir: path.join("Spikes", "Spikes4"),
      sublayer: "Spikes4",
      style: "Spikes4",
      parseColor: (fileName) => parseSimpleColor(fileName, "Spikes4")
    }
  ];

  const base = buildSingleAssetGroupLayer(rootDir, layerId, layerName, groups);
  const assets = [...base.assets];
  const variants = [...base.variants];
  const spikes3Dir = path.join("Spikes", "Spikes3");
  const spikes3Files = listSvgFiles(path.join(rootDir, spikes3Dir));

  const seenColors = new Map();

  for (const fileName of spikes3Files) {
    if (!fileName.startsWith("Spikes3") || !fileName.endsWith(".svg")) {
      throw new Error(`Unexpected Spikes3 file name: ${fileName}`);
    }

    const raw = fileName.slice("Spikes3".length, -4);
    const alternate = raw.endsWith("2");
    const color = alternate ? raw.slice(0, -1) : raw;

    if (!COLOR_SET.has(color)) {
      throw new Error(`Unexpected Spikes3 color "${color}" in ${fileName}`);
    }

    const asset = createAsset({
      rootDir,
      layerId,
      layerName,
      relativePath: path.join(spikes3Dir, fileName),
      sublayer: "Spikes3",
      style: alternate ? "Spikes3Alt" : "Spikes3",
      color
    });

    assets.push(asset);
    variants.push(
      createVariant({
        layerId,
        layerName,
        style: asset.style,
        color,
        label: alternate ? `Spikes3 ${color} Alt` : `Spikes3 ${color}`,
        assetKeys: [asset.key]
      })
    );

    const entry = seenColors.get(color) || { primary: false, alternate: false };
    entry[alternate ? "alternate" : "primary"] = true;
    seenColors.set(color, entry);
  }

  for (const color of PHIL_COLORS) {
    const entry = seenColors.get(color);
    if (!entry || !entry.primary || !entry.alternate) {
      throw new Error(`Spikes3 must include primary and alternate assets for ${color}`);
    }
  }

  return { assets, variants };
}

function buildSpecialLayer() {
  return { assets: [], variants: [] };
}

function parseBodyBaseColor(fileName) {
  if (fileName.startsWith("BodyBase")) {
    return parseSimpleColor(fileName, "BodyBase");
  }

  return parseSimpleColor(fileName, "Body");
}

function buildBodyBaseLayer(rootDir, layerId) {
  const layerName = "BodyBase";
  const structuredDir = path.join(rootDir, "BodyBase", "BodyBase1");
  if (fs.existsSync(structuredDir)) {
    const groups = Array.from({ length: 4 }, (_, index) => {
      const styleNumber = index + 1;
      return {
        relativeDir: path.join("BodyBase", `BodyBase${styleNumber}`),
        sublayer: `BodyBase${styleNumber}`,
        style: `Body${styleNumber}`,
        parseColor: (fileName) => parseSimpleColor(fileName, `BodyBase${styleNumber}`),
        label: (color) => `BodyBase${styleNumber} ${color}`
      };
    });

    return buildSingleAssetGroupLayer(rootDir, layerId, layerName, groups);
  }

  const relativeDir = "BodyBase";
  const files = listSvgFiles(path.join(rootDir, relativeDir));
  const assets = [];
  const variants = [];

  for (const fileName of files) {
    const color = parseBodyBaseColor(fileName);
    const asset = createAsset({
      rootDir,
      layerId,
      layerName,
      relativePath: path.join(relativeDir, fileName),
      sublayer: "BodyBase",
      style: "BodyBase",
      color
    });

    assets.push(asset);
    variants.push(
      createVariant({
        layerId,
        layerName,
        style: "BodyBase",
        color,
        label: `BodyBase ${color}`,
        assetKeys: [asset.key]
      })
    );
  }

  return { assets, variants };
}

function buildLayer(rootDir, layer) {
  const { id, name } = layer;

  switch (name) {
    case "Top":
      return buildSingleAssetGroupLayer(rootDir, id, name, [
        {
          relativeDir: path.join("Top", "Top1"),
          sublayer: "Top1",
          style: "Top1",
          parseColor: (fileName) => parseSimpleColor(fileName, "Top1")
        }
      ]);
    case "Eyes":
      return buildEyesLayer(rootDir, id);
    case "JawNose":
      return buildSingleAssetGroupLayer(rootDir, id, name, [
        {
          relativeDir: path.join("JawNose", "JawNose1"),
          sublayer: "JawNose1",
          style: "JawNose1",
          parseColor: (fileName) => parseSimpleColor(fileName, "JawNose1")
        },
        {
          relativeDir: path.join("JawNose", "JawNose2"),
          sublayer: "JawNose2",
          style: "JawNose2",
          parseColor: (fileName) => parseSimpleColor(fileName, "JawNose2")
        }
      ]);
    case "Teeth":
      return buildSingleAssetGroupLayer(rootDir, id, name, [
        {
          relativeDir: path.join("Teeth", "Teeth1"),
          sublayer: "Teeth1",
          style: "Teeth1",
          parseColor: (fileName) => parseSimpleColor(fileName, "Teeth1")
        },
        {
          relativeDir: path.join("Teeth", "Teeth2"),
          sublayer: "Teeth2",
          style: "Teeth2",
          parseColor: (fileName) => parseSimpleColor(fileName, "Teeth2")
        }
      ]);
    case "Spikes":
      return buildSpikesLayer(rootDir, id);
    case "Body":
      return buildSingleAssetGroupLayer(rootDir, id, name, [
        {
          relativeDir: path.join("Body", "Body1"),
          sublayer: "Body1",
          style: "Body1",
          parseColor: (fileName) => parseSimpleColor(fileName, "Body1")
        },
        {
          relativeDir: path.join("Body", "Body2"),
          sublayer: "Body2",
          style: "Body2",
          parseColor: (fileName) => parseSimpleColor(fileName, "Body2")
        },
        {
          relativeDir: path.join("Body", "Body3"),
          sublayer: "Body3",
          style: "Body3",
          parseColor: (fileName) => parseSimpleColor(fileName, "Body3")
        },
        {
          relativeDir: path.join("Body", "Body4"),
          sublayer: "Body4",
          style: "Body4",
          parseColor: (fileName) => parseSimpleColor(fileName, "Body4")
        }
      ]);
    case "BodyBase":
      return buildBodyBaseLayer(rootDir, id);
    case "Special":
      return buildSpecialLayer();
    case "BgOverlay":
      return buildSingleAssetGroupLayer(rootDir, id, name, [
        {
          relativeDir: path.join("BgOverlay", "Overlay33"),
          sublayer: "Overlay33",
          style: "Overlay33",
          parseColor: (fileName) => parseWrappedColor(fileName, "Overlay", "33")
        },
        {
          relativeDir: path.join("BgOverlay", "Overlay42"),
          sublayer: "Overlay42",
          style: "Overlay42",
          parseColor: (fileName) => parseWrappedColor(fileName, "Overlay", "42")
        },
        {
          relativeDir: path.join("BgOverlay", "Overlay69"),
          sublayer: "Overlay69",
          style: "Overlay69",
          parseColor: (fileName) => parseWrappedColor(fileName, "Overlay", "69")
        }
      ]);
    case "BgDust":
      return buildSingleAssetGroupLayer(rootDir, id, name, [
        {
          relativeDir: "BgDust",
          sublayer: "BgDust",
          style: "Dust",
          parseColor: (fileName) => parseSimpleColor(fileName, "Dust")
        }
      ]);
    case "BgSpiral":
      return buildSingleAssetGroupLayer(rootDir, id, name, [
        {
          relativeDir: path.join("BgSpiral", "Spiral1"),
          sublayer: "Spiral1",
          style: "Spiral1",
          parseColor: (fileName) => parseSimpleColor(fileName, "Spiral1")
        },
        {
          relativeDir: path.join("BgSpiral", "Spiral2"),
          sublayer: "Spiral2",
          style: "Spiral2",
          parseColor: (fileName) => parseSimpleColor(fileName, "Spiral2")
        },
        {
          relativeDir: path.join("BgSpiral", "Spiral3"),
          sublayer: "Spiral3",
          style: "Spiral3",
          parseColor: (fileName) => parseSimpleColor(fileName, "Spiral3")
        }
      ]);
    case "BgStars":
      return buildSingleAssetGroupLayer(rootDir, id, name, [
        {
          relativeDir: "BgStars",
          sublayer: "BgStars",
          style: "Stars",
          parseColor: (fileName) => parseSimpleColor(fileName, "Stars")
        }
      ]);
    case "BgNebula":
      return buildSingleAssetGroupLayer(rootDir, id, name, Array.from({ length: 9 }, (_, index) => {
        const styleNumber = index + 1;
        return {
          relativeDir: path.join("BgNebula", `BgNebula${styleNumber}`),
          sublayer: `BgNebula${styleNumber}`,
          style: `BgNebula${styleNumber}`,
          parseColor: (fileName) => parseSimpleColor(fileName, `Nebula${styleNumber}`)
        };
      }));
    case "BgColor":
      return buildSingleAssetGroupLayer(rootDir, id, name, [
        {
          relativeDir: "BgColor",
          sublayer: "BgColor",
          style: "BgColor",
          parseColor: (fileName) => parseSimpleColor(fileName, "Bg")
        }
      ]);
    default:
      throw new Error(`Unsupported layer ${name}`);
  }
}

function validateLayerCounts(layer) {
  const expected = EXPECTED_COUNTS[layer.name];
  if (!expected) {
    throw new Error(`Missing expected count config for ${layer.name}`);
  }

  if (expected.dynamic) {
    if (layer.assets.length < (expected.minAssets || 0)) {
      throw new Error(
        `Layer ${layer.name} expected at least ${expected.minAssets} assets, found ${layer.assets.length}`
      );
    }

    if (layer.variants.length < (expected.minVariants || 0)) {
      throw new Error(
        `Layer ${layer.name} expected at least ${expected.minVariants} variants, found ${layer.variants.length}`
      );
    }

    return;
  }

  if (layer.assets.length !== expected.assets) {
    throw new Error(
      `Layer ${layer.name} expected ${expected.assets} assets, found ${layer.assets.length}`
    );
  }

  if (layer.variants.length !== expected.variants) {
    throw new Error(
      `Layer ${layer.name} expected ${expected.variants} variants, found ${layer.variants.length}`
    );
  }
}

export function buildLayerCatalog(rootDir = ZK_PHIL_LAYERS_DIR) {
  const layerOrder = getPhilLayerOrder(rootDir);
  const layers = layerOrder.map((definition, index) => {
    const layer = {
      id: index,
      name: definition.name,
      stackIndex: index,
      minSelections: definition.minSelections,
      maxSelections: definition.maxSelections,
      ...buildLayer(rootDir, { id: index, name: definition.name })
    };

    validateLayerCounts(layer);
    return layer;
  });

  const assets = layers.flatMap((layer) => layer.assets);
  const variants = layers.flatMap((layer) => layer.variants);
  const bodyBaseLayer = layers.find((layer) => layer.name === "BodyBase");
  const expectedAssetCount = 481 + (bodyBaseLayer ? bodyBaseLayer.assets.length : 0);
  const expectedVariantCount = 455 + (bodyBaseLayer ? bodyBaseLayer.variants.length : 0);

  if (assets.length !== expectedAssetCount) {
    throw new Error(`Expected ${expectedAssetCount} SVG assets, found ${assets.length}`);
  }

  if (variants.length !== expectedVariantCount) {
    throw new Error(`Expected ${expectedVariantCount} variants, found ${variants.length}`);
  }

  return {
    generatedAt: new Date().toISOString(),
    rootDir: normalizePath(rootDir),
    colors: PHIL_COLORS,
    singleUploadLimitBytes: SVG_SINGLE_UPLOAD_LIMIT,
    canvas: PHIL_CANVAS,
    layers,
    assets,
    variants,
    totals: {
      layers: layers.length,
      assets: assets.length,
      variants: variants.length,
      chunkedAssets: assets.filter((asset) => asset.sizeBytes > SVG_SINGLE_UPLOAD_LIMIT).length,
      totalSvgBytes: assets.reduce((sum, asset) => sum + asset.sizeBytes, 0)
    }
  };
}

export function writeLayerCatalog(outputPath = LAYER_CATALOG_PATH) {
  const catalog = buildLayerCatalog();
  writeJson(outputPath, catalog);
  return catalog;
}
