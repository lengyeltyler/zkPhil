const FRAG_BASE = "../Fragments";

const BG_STARS = { key: "bgStars", file: "BgStars1.frag.svg" };
const BG_DUST = { key: "bgDust", file: "BgDust1.frag.svg" };

const BG_NEBULAS = Array.from({ length: 7 }, (_, i) => ({
  key: `bgNebula${i + 1}`,
  file: `BgNebula${i + 1}.frag.svg`,
  label: `Nebula ${i + 1}`,
}));

const BG_SPIRALS = Array.from({ length: 7 }, (_, i) => ({
  key: `bgSpiral${i + 1}`,
  file: `BgSpiral${i + 1}.frag.svg`,
  label: `Spiral ${i + 1}`,
}));

const BODY_OUTLINE = { key: "bodyOutline", file: "Body1.frag.svg" };
const BODY_SHAPES = Array.from({ length: 7 }, (_, i) => ({
  key: `bodyShape${i + 1}`,
  file: `BodyShapes${i + 1}.frag.svg`,
  label: `Body Shapes ${i + 1}`,
}));

const JAWLINES = [
  { key: "jawLine1", file: "JawLine1.frag.svg", label: "JawLine 1" },
  { key: "jawLine2", file: "JawLine2.frag.svg", label: "JawLine 2" },
];

const NOSES = [
  { key: "nose1", file: "Nose1.frag.svg", label: "Nose 1" },
  { key: "nose2", file: "Nose2.frag.svg", label: "Nose 2" },
  { key: "nose3", file: "Nose3.frag.svg", label: "Nose 3" },
];

const FRAMES = [
  { key: "frame1", file: "Frame1.frag.svg", label: "Frame 1" },
  { key: "frame2", file: "Frame2.frag.svg", label: "Frame 2" },
];

const LENS_SHAPES = [
  { key: "lensShape1_1", file: "LensShapes1_1.frag.svg", label: "Lens 1-1" },
  { key: "lensShape1_2", file: "LensShapes1_2.frag.svg", label: "Lens 1-2" },
  { key: "lensShape1_3", file: "LensShapes1_3.frag.svg", label: "Lens 1-3" },
  { key: "lensShape1_4", file: "LensShapes1_4.frag.svg", label: "Lens 1-4" },
  { key: "lensShape2_1", file: "LensShapes2_1.frag.svg", label: "Lens 2-1" },
  { key: "lensShape2_2", file: "LensShapes2_2.frag.svg", label: "Lens 2-2" },
  { key: "lensShape2_3", file: "LensShapes2_3.frag.svg", label: "Lens 2-3" },
];

function getLensFamily(lensShape) {
  if (!lensShape?.key) return 0;
  return lensShape.key.startsWith("lensShape2_") ? 1 : 0;
}

function getFrameForLens(lensShape) {
  return FRAMES[getLensFamily(lensShape)] || FRAMES[0];
}

const SPIKES = [
  {
    key: "spikes1",
    file: "Spikes1.frag.svg",
    label: "Spikes 1",
    shapes: [
      { key: "spikeShapes1_1", file: "SpikeShapes1_1.frag.svg", label: "Spike Shapes 1-1" },
      { key: "spikeShapes1_2", file: "SpikeShapes1_2.frag.svg", label: "Spike Shapes 1-2" },
    ],
  },
  {
    key: "spikes2",
    file: "Spikes2.frag.svg",
    label: "Spikes 2",
    shapes: [
      { key: "spikeShapes2_1", file: "SpikeShapes2_1.frag.svg", label: "Spike Shapes 2-1" },
    ],
  },
  { key: "spikes3", file: "Spikes3.frag.svg", label: "Spikes 3", shapes: [] },
  { key: "spikes4", file: "Spikes4.frag.svg", label: "Spikes 4", shapes: [] },
];

const TEETH = [
  {
    key: "teeth1",
    file: "Teeth1.frag.svg",
    label: "Teeth 1",
    shapes: [
      { key: "teethShapes1_1", file: "TeethShapes1_1.frag.svg", label: "Teeth Shapes 1-1" },
      { key: "teethShapes1_2", file: "TeethShapes1_2.frag.svg", label: "Teeth Shapes 1-2" },
      { key: "teethShapes1_3", file: "TeethShapes1_3.frag.svg", label: "Teeth Shapes 1-3" },
    ],
  },
  {
    key: "teeth2",
    file: "Teeth2.frag.svg",
    label: "Teeth 2",
    shapes: [
      { key: "teethShapes2_1", file: "TeethShapes2_1.frag.svg", label: "Teeth Shapes 2-1" },
    ],
  },
];

// 13 unique decals
const DECALS = Array.from({ length: 13 }, (_, i) => ({
  key: `decal${i + 1}`,
  file: "Decal1.frag.svg",
  label: `Decal ${i + 1}`,
}));

const LANE_PALETTES = [
  {
    lane: 1,
    label: "Lane 1",
    colors: {
      decalFill: "F7941F",
      decalStroke: "5499C7",
      topFill: "D6E6F1",
      topStroke: "A9CCE2",
      jawFill: "EBF2F8",
      teethShapeStroke: "F8991D",
      teethFill: "D6E6F1",
      lensShapeStroke: "F8991D",
      frameFill: "D6E6F1",
      bodyShapeFill: "EBF2F8",
      bodyFill: "80B3D5",
      spikeShapeStroke: "F8991D",
      spikesFill: "D6E6F1",
      bgDustFill: "F8991D",
      bgDustStroke: "F8991D",
      bgStarsFill: "FFFFFF",
      bgStarsStroke: "36936A",
      bgNebula: [
        { color: "00ABED", opacity: 0.03 },
        { color: "D6E6F1", opacity: 0.06 },
        { color: "A9CCE2", opacity: 0.09 },
        { color: "5499C7", opacity: 0.13 },
      ],
      bgSpiralStroke: "F8991D",
      bgColor: "212121",
    },
  },
  {
    lane: 2,
    label: "Lane 2",
    colors: {
      decalFill: "FF4D4D",
      decalStroke: "8F1D1D",
      topFill: "FFD6D6",
      topStroke: "F4B7B7",
      jawFill: "FFEAEA",
      teethShapeStroke: "FF6B57",
      teethFill: "FFD6D6",
      lensShapeStroke: "FF6B57",
      frameFill: "FFD6D6",
      bodyShapeFill: "FFEAEA",
      bodyFill: "C94A4A",
      spikeShapeStroke: "FF6B57",
      spikesFill: "FFD6D6",
      bgDustFill: "FF6B57",
      bgDustStroke: "FF6B57",
      bgStarsFill: "FFFFFF",
      bgStarsStroke: "5A1A1A",
      bgNebula: [
        { color: "FF4D4D", opacity: 0.03 },
        { color: "FFD6D6", opacity: 0.06 },
        { color: "F4B7B7", opacity: 0.09 },
        { color: "8F1D1D", opacity: 0.13 },
      ],
      bgSpiralStroke: "FF6B57",
      bgColor: "424242",
    },
  },
  {
    lane: 3,
    label: "Lane 3",
    colors: {
      decalFill: "F2B705",
      decalStroke: "2D1457",
      topFill: "EFE6FF",
      topStroke: "D6C7F5",
      jawFill: "F5F1FF",
      teethShapeStroke: "FFCC33",
      teethFill: "EFE6FF",
      lensShapeStroke: "FFCC33",
      frameFill: "EFE6FF",
      bodyShapeFill: "F5F1FF",
      bodyFill: "6B46C1",
      spikeShapeStroke: "FFCC33",
      spikesFill: "EFE6FF",
      bgDustFill: "FFCC33",
      bgDustStroke: "FFCC33",
      bgStarsFill: "FFFFFF",
      bgStarsStroke: "2D1457",
      bgNebula: [
        { color: "FF7AB6", opacity: 0.03 },
        { color: "FFFFFF", opacity: 0.06 },
        { color: "7FC8A9", opacity: 0.09 },
        { color: "2F6F5E", opacity: 0.13 },
      ],
      bgSpiralStroke: "FFCC33",
      bgColor: "A0A0A0",
    },
  },
  {
    lane: 4,
    label: "Lane 4",
    colors: {
      decalFill: "FF7AB6",
      decalStroke: "2F6F5E",
      topFill: "FFFFFF",
      topStroke: "F3F3F3",
      jawFill: "F7FFF9",
      teethShapeStroke: "FF9CCC",
      teethFill: "FFFFFF",
      lensShapeStroke: "FF9CCC",
      frameFill: "FFFFFF",
      bodyShapeFill: "F7FFF9",
      bodyFill: "7FC8A9",
      spikeShapeStroke: "FF9CCC",
      spikesFill: "FFFFFF",
      bgDustFill: "FF9CCC",
      bgDustStroke: "FF9CCC",
      bgStarsFill: "FFFFFF",
      bgStarsStroke: "2F6F5E",
      bgNebula: [
        { color: "FF7AB6", opacity: 0.03 },
        { color: "FFFFFF", opacity: 0.06 },
        { color: "7FC8A9", opacity: 0.09 },
        { color: "2F6F5E", opacity: 0.13 },
      ],
      bgSpiralStroke: "FF9CCC",
      bgColor: "777777",
    },
  },
  {
    lane: 5,
    label: "Lane 5",
    colors: {
      decalFill: "FFCB05",
      decalStroke: "1F2A44",
      topFill: "FFFFFF",
      topStroke: "F2F2F2",
      jawFill: "F6FBFF",
      teethShapeStroke: "FFD84D",
      teethFill: "FFFFFF",
      lensShapeStroke: "FF0000",
      frameFill: "FFFFFF",
      bodyShapeFill: "FF0000",
      bodyFill: "3B82F6",
      spikeShapeStroke: "FFCB05",
      spikesFill: "FFFFFF",
      bgDustFill: "FFCB05",
      bgDustStroke: "FFCB05",
      bgStarsFill: "FFFFFF",
      bgStarsStroke: "FF0000",
      bgNebula: [
        { color: "FFCB05", opacity: 0.03 },
        { color: "3B82F6", opacity: 0.06 },
        { color: "FFFFFF", opacity: 0.09 },
        { color: "1F2A44", opacity: 0.13 },
      ],
      bgSpiralStroke: "FFCB05",
      bgColor: "303030",
    },
  },
  {
    lane: 6,
    label: "Lane 6",
    colors: {
      decalFill: "EAEAEA",
      decalStroke: "0B0B0B",
      topFill: "3A3A3A",
      topStroke: "222222",
      jawFill: "3A3A3A",
      teethShapeStroke: "8A8A8A",
      teethFill: "EAEAEA",
      lensShapeStroke: "161616",
      frameFill: "3A3A3A",
      bodyShapeFill: "161616",
      bodyFill: "222222",
      spikeShapeStroke: "5A5A5A",
      spikesFill: "EAEAEA",
      bgDustFill: "5A5A5A",
      bgDustStroke: "5A5A5A",
      bgStarsFill: "EAEAEA",
      bgStarsStroke: "161616",
      bgNebula: [
        { color: "3A3A3A", opacity: 0.03 },
        { color: "5A5A5A", opacity: 0.06 },
        { color: "8A8A8A", opacity: 0.09 },
        { color: "0B0B0B", opacity: 0.13 },
      ],
      bgSpiralStroke: "5A5A5A",
      bgColor: "202020",
    },
  },
];

const PALETTES = [
  LANE_PALETTES[0],
  LANE_PALETTES[1],
  LANE_PALETTES[2],
  LANE_PALETTES[3],
  LANE_PALETTES[4],
  LANE_PALETTES[5],
  LANE_PALETTES[0],
  LANE_PALETTES[1],
  LANE_PALETTES[2],
  LANE_PALETTES[3],
  LANE_PALETTES[4],
  LANE_PALETTES[5],
  LANE_PALETTES[0],
].map((palette, id) => ({ ...palette, id }));

// Fragment data cache
const fragments = {};
let mintIndex = 0;
let rowIndex = 0;
let awakened = false;

const gallery = document.getElementById("gallery");
const statusEl = document.getElementById("status");
const sentinel = document.getElementById("sentinel");
const mintedCount = document.getElementById("minted-count");
const supplyCount = document.getElementById("supply-count");
const bodyEl = document.body;

function markAwake() {
  if (awakened) return;
  awakened = true;
  bodyEl.classList.add("awakened");
}

// Deterministic mint queue: ensures all 13 decals appear.
const MINT_QUEUE = [];

function configForIndex(index) {
  const rng = mulberry32(index * 7919 + 12345);
  const pick = (arr) => Math.floor(rng() * arr.length);
  const bgMode = rng() < 0.5 ? "nebulaStars" : "spiralDust";

  const spikesIdx = pick(SPIKES);
  const spikesShapes = SPIKES[spikesIdx].shapes || [];

  const teethIdx = pick(TEETH);
  const teethShapes = TEETH[teethIdx].shapes || [];
  const lensIdx = pick(LENS_SHAPES);
  const lensShape = LENS_SHAPES[lensIdx];
  const lensFamily = getLensFamily(lensShape);

  return {
    paletteId: index % PALETTES.length,
    decalIdx: index % DECALS.length,
    outlineIdx: lensFamily,
    bgMode,
    nebulaIdx: pick(BG_NEBULAS),
    spiralIdx: pick(BG_SPIRALS),
    bodyShapeIdx: pick(BODY_SHAPES),
    spikesIdx,
    spikesShapeIdx: spikesShapes.length ? pick(spikesShapes) : 0,
    teethIdx,
    teethShapeIdx: teethShapes.length ? pick(teethShapes) : 0,
    lensIdx,
    jawIdx: pick(JAWLINES),
    noseIdx: pick(NOSES),
  };
}

function getConfig(index) {
  while (MINT_QUEUE.length <= index) {
    MINT_QUEUE.push(configForIndex(MINT_QUEUE.length));
  }
  return MINT_QUEUE[index];
}

function mulberry32(seed) {
  let t = seed >>> 0;
  return function () {
    t += 0x6D2B79F5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

function resolvePalette(paletteId, seed) {
  const base = PALETTES[paletteId] || PALETTES[0];
  const rng = mulberry32(seed);
  const remix = rng() < 0.23;
  if (!remix) {
    return { colors: base.colors, label: base.label };
  }

  const fields = [
    "decalFill",
    "decalStroke",
    "jawFill",
    "teethShapeStroke",
    "teethFill",
    "lensShapeStroke",
    "frameFill",
    "bodyShapeFill",
    "bodyFill",
    "spikeShapeStroke",
    "spikesFill",
    "bgDustFill",
    "bgDustStroke",
    "bgStarsFill",
    "bgStarsStroke",
    "bgSpiralStroke",
    "bgColor",
  ];
  const mixed = {};
  const lanes = new Set();

  for (const field of fields) {
    const pick = LANE_PALETTES[Math.floor(rng() * LANE_PALETTES.length)];
    lanes.add(pick.lane);
    mixed[field] = pick.colors[field];
  }
  mixed.bgNebula = LANE_PALETTES[Math.floor(rng() * LANE_PALETTES.length)].colors.bgNebula;
  // Keep spike/lens/teeth shape colors anchored to the base palette lane.
  mixed.spikeShapeStroke = base.colors.spikeShapeStroke;
  mixed.teethShapeStroke = base.colors.teethShapeStroke;
  mixed.lensShapeStroke = base.colors.lensShapeStroke;

  const laneList = Array.from(lanes).sort((a, b) => a - b).join("+");
  return { colors: mixed, label: `Remix ${laneList}` };
}

function buildSvg({
  palette,
  nebulaKey,
  spiralKey,
  spikesKey,
  spikesShapeKey,
  bodyShapeKey,
  teethKey,
  teethShapeKey,
  jawKey,
  noseKey,
  frameKey,
  lensKey,
  decalKey,
  uid,
  includeNebulaStars,
  includeSpiralDust,
}) {
  const gradBodyId = `gradBodyShapes-${uid}`;
  const gradSpikeId = `gradSpikeShapes-${uid}`;
  const gradTeethId = `gradTeethShapes-${uid}`;
  const gradLensId = `gradLensShapes-${uid}`;
  const defs = `
    <defs>
      <linearGradient id="${gradBodyId}" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="0" y2="420">
        <stop offset="0%" stop-color="#${palette.bodyShapeFill}" stop-opacity="0.75"/>
        <stop offset="100%" stop-color="#${palette.bodyShapeFill}" stop-opacity="0.15"/>
      </linearGradient>
      <linearGradient id="${gradSpikeId}" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="0" y2="420">
        <stop offset="0%" stop-color="#${palette.spikeShapeStroke}" stop-opacity="0.75"/>
        <stop offset="100%" stop-color="#${palette.spikeShapeStroke}" stop-opacity="0.15"/>
      </linearGradient>
      <linearGradient id="${gradTeethId}" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="0" y2="420">
        <stop offset="0%" stop-color="#${palette.teethShapeStroke}" stop-opacity="0.75"/>
        <stop offset="100%" stop-color="#${palette.teethShapeStroke}" stop-opacity="0.15"/>
      </linearGradient>
      <linearGradient id="${gradLensId}" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="0" y2="420">
        <stop offset="0%" stop-color="#${palette.lensShapeStroke}" stop-opacity="0.75"/>
        <stop offset="100%" stop-color="#${palette.lensShapeStroke}" stop-opacity="0.15"/>
      </linearGradient>
    </defs>
  `;

  const nebulaSvg = fragments[nebulaKey] || "";
  const spikesShapeSvg = spikesShapeKey ? (fragments[spikesShapeKey] || "") : "";
  const teethShapeSvg = teethShapeKey ? (fragments[teethShapeKey] || "") : "";
  const lensSvg = lensKey ? (fragments[lensKey] || "") : "";

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 420 420" shape-rendering="geometricPrecision">
    ${defs}
    <rect width="420" height="420" fill="#${palette.bgColor}"/>
    ${includeNebulaStars && nebulaSvg ? `<g>${nebulaSvg}</g>` : ""}
    ${includeNebulaStars ? `<g fill="#${palette.bgStarsFill}" stroke="#${palette.bgStarsStroke}" opacity="0.69">${fragments[BG_STARS.key] || ""}</g>` : ""}
    ${includeSpiralDust ? `<g fill="none" stroke="#${palette.bgSpiralStroke}" stroke-opacity="0.69">${fragments[spiralKey] || ""}</g>` : ""}
    ${includeSpiralDust ? `<g fill="#${palette.bgDustFill}" stroke="#${palette.bgDustStroke}" opacity="0.69">${fragments[BG_DUST.key] || ""}</g>` : ""}
    <g fill="#${palette.spikesFill}" stroke="none">${fragments[spikesKey] || ""}</g>
    ${spikesShapeSvg ? `<g fill="url(#${gradSpikeId})" stroke="none">${spikesShapeSvg}</g>` : ""}
    <g fill="#${palette.bodyFill}" stroke="none">${fragments[BODY_OUTLINE.key] || ""}</g>
    <g fill="url(#${gradBodyId})" stroke="none">${fragments[bodyShapeKey] || ""}</g>
    <g fill="#${palette.teethFill}" stroke="none">${fragments[teethKey] || ""}</g>
    ${teethShapeSvg ? `<g fill="url(#${gradTeethId})" stroke="none">${teethShapeSvg}</g>` : ""}
    <g fill="#${palette.jawFill}" stroke="none">${fragments[jawKey] || ""}</g>
    <g fill="#${palette.jawFill}" stroke="none">${fragments[noseKey] || ""}</g>
    <g fill="#${palette.frameFill}" stroke="none">${fragments[frameKey] || ""}</g>
    ${lensSvg ? `<g fill="url(#${gradLensId})" stroke="none">${lensSvg}</g>` : ""}
    <g fill="#${palette.decalFill}" stroke="#${palette.decalStroke}" stroke-opacity="0.13">${fragments[decalKey] || ""}</g>
  </svg>`;
}

function createPhilCard(config, index) {
  const paletteInfo = resolvePalette(
    config.paletteId,
    index * 7919 + config.decalIdx * 131 + config.outlineIdx * 17
  );
  const palette = paletteInfo.colors;
  const decal = DECALS[config.decalIdx];
  const nebula = BG_NEBULAS[config.nebulaIdx];
  const spiral = BG_SPIRALS[config.spiralIdx];
  const spikes = SPIKES[config.spikesIdx];
  const spikesShape = spikes.shapes[config.spikesShapeIdx] || null;
  const bodyShape = BODY_SHAPES[config.bodyShapeIdx];
  const teeth = TEETH[config.teethIdx];
  const teethShape = teeth.shapes[config.teethShapeIdx] || null;
  const jawLine = JAWLINES[config.jawIdx];
  const nose = NOSES[config.noseIdx];
  const lensShape = LENS_SHAPES[config.lensIdx] || null;
  const frame = getFrameForLens(lensShape);

  const card = document.createElement("div");
  card.className = "phil-card";

  const svg = buildSvg({
    palette,
    nebulaKey: nebula.key,
    spiralKey: spiral.key,
    spikesKey: spikes.key,
    spikesShapeKey: spikesShape ? spikesShape.key : null,
    bodyShapeKey: bodyShape.key,
    teethKey: teeth.key,
    teethShapeKey: teethShape ? teethShape.key : null,
    jawKey: jawLine.key,
    noseKey: nose.key,
    frameKey: frame.key,
    lensKey: lensShape ? lensShape.key : null,
    decalKey: decal.key,
    uid: `card-${index}`,
    includeNebulaStars: config.bgMode === "nebulaStars",
    includeSpiralDust: config.bgMode === "spiralDust",
  });

  card.innerHTML = `
    <div class="phil-art">${svg}</div>
  `;

  return card;
}

function appendRow() {
  const row = document.createElement("div");
  row.className = "phil-row";
  row.style.setProperty("--row-index", rowIndex);
  rowIndex += 1;

  // Generate 5 per row (infinite scroll)
  const count = 5;
  for (let i = 0; i < count; i++) {
    const config = getConfig(mintIndex);
    const card = createPhilCard(config, mintIndex);
    row.appendChild(card);
    mintIndex++;
  }

  gallery.appendChild(row);
  updateCounter();

  return true;
}

function updateCounter() {
  if (mintedCount) mintedCount.textContent = "0";
  if (supplyCount) supplyCount.textContent = "∞";
}

async function loadAllFragments() {
  const allFrags = [
    BG_STARS,
    BG_DUST,
    ...BG_NEBULAS,
    ...BG_SPIRALS,
    BODY_OUTLINE,
    ...BODY_SHAPES,
    ...JAWLINES,
    ...NOSES,
    ...FRAMES,
    ...LENS_SHAPES,
    ...SPIKES.map((s) => ({ key: s.key, file: s.file })),
    ...SPIKES.flatMap((s) => s.shapes),
    ...TEETH.map((t) => ({ key: t.key, file: t.file })),
    ...TEETH.flatMap((t) => t.shapes),
    ...DECALS,
  ];

  const requests = allFrags.map(async (frag) => {
    const res = await fetch(`${FRAG_BASE}/${frag.file}`);
    if (!res.ok) throw new Error(`Failed to load ${frag.file}`);
    fragments[frag.key] = await res.text();
  });

  await Promise.all(requests);
}

function wireInfiniteScroll() {
  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          // Append multiple rows to ensure sentinel gets pushed below viewport
          let added = true;
          while (added) {
            added = appendRow();
            // Check if sentinel is still in viewport; if not, stop
            const rect = sentinel.getBoundingClientRect();
            if (rect.top > window.innerHeight + 400) break;
          }
        }
      });
    },
    { rootMargin: "400px" }
  );

  observer.observe(sentinel);
}

async function init() {
  try {
    statusEl.textContent = "Booting fragments...";
    await loadAllFragments();
    statusEl.textContent = "Scroll to generate Phils.";
    updateCounter();

    // Load first row (3 phils)
    appendRow();

    wireInfiniteScroll();

    window.addEventListener(
      "scroll",
      () => {
        if (window.scrollY > 30) markAwake();
      },
      { passive: true }
    );
    setTimeout(markAwake, 1200);

    const connectBtn = document.getElementById("connectBtn");
    const mintBtn = document.getElementById("mintBtn");
    if (connectBtn) {
      connectBtn.addEventListener("click", () => {
        statusEl.textContent = "Wallet link pending (offline preview).";
      });
    }
    if (mintBtn) {
      mintBtn.addEventListener("click", () => {
        statusEl.textContent = "Mint queue offline. Backend coming soon.";
      });
    }
  } catch (err) {
    statusEl.textContent = "Failed to load fragments. Run a local server from repo root.";
    console.error(err);
  }
}

init();
