import { ethers } from 'ethers';

import { PHIL_LAYER_ORDER } from '../src/layer-catalog.mjs';

function svgDoc(innerMarkup) {
  return `<?xml version="1.0" encoding="UTF-8"?><svg xmlns="http://www.w3.org/2000/svg" width="420" height="420" viewBox="0 0 420 420">${innerMarkup}</svg>`;
}

function rect(fill, extra = '') {
  return svgDoc(`<rect width="420" height="420" fill="${fill}"/>${extra}`);
}

export const FIXTURE_VARIANTS = [
  { layerId: 0, sublayer: 'Top1', fileName: 'Top1Blue.svg', label: 'Top1 Blue', style: 'Top1', color: 'Blue', svg: rect('#1d4ed8', '<rect x="110" y="42" width="200" height="80" fill="#60a5fa"/>') },
  { layerId: 1, sublayer: 'Eyes1', fileName: 'Eyes1Green.svg', label: 'Eyes1 Green', style: 'Eyes1', color: 'Green', svg: rect('none', '<circle cx="150" cy="190" r="24" fill="#16a34a"/><circle cx="270" cy="190" r="24" fill="#16a34a"/>') },
  { layerId: 2, sublayer: 'JawNose1', fileName: 'JawNose1Coral.svg', label: 'JawNose1 Coral', style: 'JawNose1', color: 'Coral', svg: rect('none', '<path d="M150 240 L210 300 L270 240" fill="#fb7185"/>') },
  { layerId: 3, sublayer: 'Teeth1', fileName: 'Teeth1Ivory.svg', label: 'Teeth1 Ivory', style: 'Teeth1', color: 'Ivory', svg: rect('none', '<rect x="150" y="280" width="120" height="40" fill="#f8fafc"/>') },
  { layerId: 4, sublayer: 'Spikes1', fileName: 'Spikes1Purple.svg', label: 'Spikes1 Purple', style: 'Spikes1', color: 'Purple', svg: rect('none', '<polygon points="120,80 150,20 180,80" fill="#7c3aed"/><polygon points="210,80 240,10 270,80" fill="#8b5cf6"/><polygon points="300,80 330,25 360,80" fill="#7c3aed"/>') },
  { layerId: 5, sublayer: 'Body1', fileName: 'Body1Teal.svg', label: 'Body1 Teal', style: 'Body1', color: 'Teal', svg: rect('none', '<circle cx="210" cy="230" r="120" fill="#0f766e"/>') },
  { layerId: 7, sublayer: 'Overlay33', fileName: 'Overlay33Orange.svg', label: 'Overlay33 Orange', style: 'Overlay33', color: 'Orange', svg: rect('none', '<circle cx="210" cy="210" r="155" fill="#fb923c" opacity="0.15"/>') },
  { layerId: 7, sublayer: 'Overlay42', fileName: 'Overlay42Pink.svg', label: 'Overlay42 Pink', style: 'Overlay42', color: 'Pink', svg: rect('none', '<rect x="40" y="40" width="340" height="340" fill="#f472b6" opacity="0.08"/>') },
  { layerId: 7, sublayer: 'Overlay69', fileName: 'Overlay69Sky.svg', label: 'Overlay69 Sky', style: 'Overlay69', color: 'Sky', svg: rect('none', '<path d="M40 320 C130 240 290 400 380 150" stroke="#38bdf8" stroke-width="24" opacity="0.18" fill="none"/>') },
  { layerId: 8, sublayer: 'BgDust', fileName: 'BgDustGold.svg', label: 'BgDust Gold', style: 'BgDust', color: 'Gold', svg: rect('none', '<circle cx="100" cy="90" r="6" fill="#fbbf24"/><circle cx="330" cy="70" r="5" fill="#fbbf24"/><circle cx="70" cy="330" r="7" fill="#fde68a"/>') },
  { layerId: 9, sublayer: 'Spiral1', fileName: 'Spiral1Red.svg', label: 'Spiral1 Red', style: 'Spiral1', color: 'Red', svg: rect('none', '<path d="M210 210 m-140 0 a140 140 0 1 1 280 0 a100 100 0 1 0 -200 0 a60 60 0 1 1 120 0" stroke="#ef4444" stroke-width="10" fill="none" opacity="0.35"/>') },
  { layerId: 10, sublayer: 'BgStars', fileName: 'BgStarsWhite.svg', label: 'BgStars White', style: 'BgStars', color: 'White', svg: rect('none', '<circle cx="80" cy="120" r="4" fill="#ffffff"/><circle cx="310" cy="110" r="3" fill="#ffffff"/><circle cx="250" cy="330" r="5" fill="#e2e8f0"/>') },
  { layerId: 11, sublayer: 'BgNebula1', fileName: 'BgNebula1Violet.svg', label: 'BgNebula1 Violet', style: 'BgNebula1', color: 'Violet', svg: rect('none', '<ellipse cx="210" cy="210" rx="180" ry="130" fill="#a855f7" opacity="0.12"/>') },
  { layerId: 12, sublayer: 'BgColor', fileName: 'BgColorMidnight.svg', label: 'BgColor Midnight', style: 'BgColor', color: 'Midnight', svg: rect('#0f172a') },
];

export function getArtifact(artifacts, name) {
  const artifact = artifacts[name];
  if (!artifact) {
    throw new Error(`missing artifact ${name}`);
  }
  return artifact;
}

export async function deployContract(signer, artifact, args = []) {
  const factory = new ethers.ContractFactory(artifact.abi, artifact.bytecode, signer);
  const contract = await factory.deploy(...args);
  await contract.waitForDeployment();
  return contract;
}

export async function deployHybridRendererSystem(deployer, artifacts) {
  const ownerAddress = await deployer.getAddress();
  const storage = await deployContract(deployer, getArtifact(artifacts, 'PhilSVGStorage'), [ownerAddress]);
  const registry = await deployContract(
    deployer,
    getArtifact(artifacts, 'PhilLayerRegistry'),
    [await storage.getAddress(), ownerAddress]
  );

  await (
    await registry.registerLayers(
      PHIL_LAYER_ORDER.map((layer) => ({
        name: layer.name,
        minSelections: layer.minSelections,
        maxSelections: layer.maxSelections,
      }))
    )
  ).wait();

  const assetInputs = [];
  const variantInputs = [];
  let nextAssetId = 1;

  for (const variant of FIXTURE_VARIANTS) {
    const svgBytes = Buffer.from(variant.svg);
    const svgId = Number(await storage.storeSvg.staticCall(svgBytes));
    await (await storage.storeSvg(svgBytes)).wait();

    assetInputs.push({
      layerId: variant.layerId,
      storageId: svgId,
      sublayer: variant.sublayer,
      fileName: variant.fileName,
    });

    variantInputs.push({
      layerId: variant.layerId,
      label: variant.label,
      style: variant.style,
      color: variant.color,
      assetIds: [nextAssetId],
    });

    nextAssetId += 1;
  }

  await (await registry.registerAssets(assetInputs)).wait();
  await (await registry.registerVariants(variantInputs)).wait();

  const renderer = await deployContract(deployer, getArtifact(artifacts, 'PhilRenderer'), [
    await registry.getAddress(),
    await storage.getAddress(),
    ethers.ZeroAddress,
  ]);

  return {
    renderer,
    storage,
    registry,
  };
}
