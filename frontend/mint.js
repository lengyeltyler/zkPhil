/**
 * Phil Test13 Mint Page (STARK Allowlist + EIP-4337)
 */

import {
  getOrCreateStarkKeyPair,
} from "./starkKey.js";

import {
  buildMintUserOp,
  getUserOpHash,
  signUserOp,
  sendUserOp,
  waitForUserOpReceipt,
  ENTRY_POINT_V07,
} from "./userop.js";
import {
  buildBackendCompatibilityMessage,
  evaluateBackendCompatibility,
} from "../shared/config/backendCompatibility.mjs";

// ── Configuration ──────────────────────────────────────────────

const urlParams = new URLSearchParams(window.location.search);
const testModeOverride = (urlParams.get("testMode") || "").toLowerCase();

function chainIdToHex(chainId) {
  return `0x${BigInt(chainId).toString(16)}`;
}

function defaultNetworkMeta(chainId) {
  if (chainId === 1) {
    return {
      key: "mainnet",
      name: "Ethereum Mainnet",
      explorerBase: "https://etherscan.io",
    };
  }
  if (chainId === 17000) {
    return {
      key: "holesky",
      name: "Holesky",
      explorerBase: "https://holesky.etherscan.io",
    };
  }
  if (chainId === 11155111) {
    return {
      key: "sepolia",
      name: "Sepolia",
      explorerBase: "https://sepolia.etherscan.io",
    };
  }
  return {
    key: "local",
    name: "Local",
    explorerBase: "",
  };
}

const requestedChainId = Number(urlParams.get("chainId") || "31337");
const resolvedChainId = Number.isInteger(requestedChainId) && requestedChainId > 0
  ? requestedChainId
  : 31337;
const requestedDeploymentsChainId = Number(
  urlParams.get("deploymentsChainId") || String(resolvedChainId)
);
const resolvedDeploymentsChainId =
  Number.isInteger(requestedDeploymentsChainId) && requestedDeploymentsChainId > 0
    ? requestedDeploymentsChainId
    : resolvedChainId;
const defaults = defaultNetworkMeta(resolvedChainId);

const NETWORK = Object.freeze({
  key: defaults.key,
  chainId: resolvedChainId,
  chainIdHex: chainIdToHex(resolvedChainId),
  name: urlParams.get("chainName") || defaults.name,
  rpcUrl: urlParams.get("rpc") || "http://127.0.0.1:8545",
  proofServer: urlParams.get("server") || "http://localhost:8787",
  explorerBase: urlParams.get("explorer") || defaults.explorerBase,
  deploymentsChainId: resolvedDeploymentsChainId,
  bundlerRpc: urlParams.get("bundler") || "",
});
const ACTIVE_NETWORK = NETWORK;
const DEPLOYMENTS_STARK_FILE = `stark_${ACTIVE_NETWORK.deploymentsChainId}.json`;
const DEPLOYMENTS_4337_FILE = `4337_${ACTIVE_NETWORK.deploymentsChainId}.json`;
const TARGET_CHAIN_ID = BigInt(ACTIVE_NETWORK.chainId);
const TARGET_CHAIN_ID_HEX = ACTIVE_NETWORK.chainIdHex;
const TEST_MODE_FORCED_ON = ["1", "true", "on", "force"].includes(testModeOverride);
const TEST_MODE_FORCED_OFF = ["0", "off", "false", "no"].includes(testModeOverride);
const FORCE_DIRECT_LOCAL_AA = ["1", "true", "on", "force"].includes((urlParams.get("directAa") || "").toLowerCase());
const TEST_MODE_ENABLED = !TEST_MODE_FORCED_OFF || TEST_MODE_FORCED_ON;

const PROOF_SERVER = ACTIVE_NETWORK.proofServer;
const ETHERSCAN_BASE = ACTIVE_NETWORK.explorerBase;

// Bundler RPC (optional)
const BUNDLER_RPC = ACTIVE_NETWORK.bundlerRpc;
const WALLET_DEBUG = urlParams.get("debugWallet") === "1";

// Deployed contract addresses (loaded from deployments/)
let PHIL_TEST_MINT = "";
let PHIL_ACCOUNT_FACTORY = "";
let PHIL_ACCOUNT_IMPL = "";
let PHIL_PAYMASTER = "";
let PHIL_UNLOCK_INBOX = "";
let PROOF_GATE_ADDRESS = "";
let ENTRY_POINT_ADDRESS = ENTRY_POINT_V07;
let LOADED_STARK_DEPLOYMENT = "";
let LOADED_4337_DEPLOYMENT = "";

// Optional: URL to a Starknet unlock UI (leave blank if none)
const STARKNET_UNLOCK_URL = "";

async function loadDeployments() {
  // Always reset first so we never carry stale addresses across network/context switches.
  PHIL_TEST_MINT = "";
  PHIL_ACCOUNT_FACTORY = "";
  PHIL_ACCOUNT_IMPL = "";
  PHIL_PAYMASTER = "";
  PHIL_UNLOCK_INBOX = "";
  PROOF_GATE_ADDRESS = "";
  ENTRY_POINT_ADDRESS = ENTRY_POINT_V07;
  LOADED_STARK_DEPLOYMENT = "";
  LOADED_4337_DEPLOYMENT = "";

  try {
    const res = await fetch(`../deployments/${DEPLOYMENTS_STARK_FILE}`, { cache: "no-store" });
    if (res.ok) {
      const data = await res.json();
      if (data.PhilTestMint) {
        PHIL_TEST_MINT = data.PhilTestMint;
        LOADED_STARK_DEPLOYMENT = DEPLOYMENTS_STARK_FILE;
      }
      if (data.ProofGateTest13 || data.ProofGate) {
        PROOF_GATE_ADDRESS = data.ProofGateTest13 || data.ProofGate;
      }
    }
  } catch { /* ignore */ }

  try {
    const res = await fetch(`../deployments/${DEPLOYMENTS_4337_FILE}`, { cache: "no-store" });
    if (res.ok) {
      const data = await res.json();
      if (data.PhilAccountFactory) PHIL_ACCOUNT_FACTORY = data.PhilAccountFactory;
      if (data.PhilAccountImpl) PHIL_ACCOUNT_IMPL = data.PhilAccountImpl;
      if (data.PhilPaymaster) PHIL_PAYMASTER = data.PhilPaymaster;
      if (data.PhilUnlockInbox) PHIL_UNLOCK_INBOX = data.PhilUnlockInbox;
      if (!PROOF_GATE_ADDRESS && (data.ProofGateTest13 || data.ProofGate)) {
        PROOF_GATE_ADDRESS = data.ProofGateTest13 || data.ProofGate;
      }
      if (data.EntryPoint) ENTRY_POINT_ADDRESS = data.EntryPoint;
      if (data.PhilAccountFactory || data.EntryPoint) {
        LOADED_4337_DEPLOYMENT = DEPLOYMENTS_4337_FILE;
      }
    }
  } catch { /* ignore */ }
}

const MINT_ABI = [
  "function mint(address recipient, address mintTo, uint8 philId, uint8 paletteVariant, uint8 mixMode, uint32 mixSeed, (uint256 expiry, bytes32 factHash, bytes signature) proof) external",
  "function decalUsed(uint8) view returns (bool)",
  "function totalSupply() view returns (uint256)",
];

// ── Fragment paths ───────────────────────────────────────────

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

const DECALS = Array.from({ length: 13 }, (_, i) => ({
  key: `decal${i + 1}`,
  file: "Decal1.frag.svg",
  label: `Decal ${i + 1}`,
}));

// ── Palettes ─────────────────────────────────────────────────

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
    // Keep on-chain frame/lens pairing deterministic via outline parity.
    outlineIdx: lensFamily,
    bgMode,
    nebulaIdx: pick(BG_NEBULAS),
    spiralIdx: pick(BG_SPIRALS),
    bodyShapeIdx: 0,
    spikesIdx,
    // On-chain currently supports only shapeId=0 for spikes/body/teeth.
    spikesShapeIdx: 0,
    teethIdx,
    teethShapeIdx: 0,
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

// ── STARK Scope Bits (match PhilAccount) ───────────────────────
const SCOPE_BITS = {
  TRANSFER_PHIL: 1 << 0,
  LIST_PHIL: 1 << 1,
  ACCEPT_BID: 1 << 2,
  SET_APPROVAL_FOR_ALL: 1 << 3,
  LARGE_SPEND: 1 << 4,
  OWNER_CHANGE: 1 << 5,
  UPGRADE_WALLET: 1 << 6,
  ROTATE_2FA_ROOT: 1 << 7,
};

// ── State ──────────────────────────────────────────────────────

const state = {
  provider: null,
  readProvider: null,
  signer: null,
  ethers: null,
  eip1193: null,
  address: null,
  smartAccount: null,
  starkKeyPair: null,
  isSmartAccountDeployed: false,
  unlockInbox: null,
  ownerCount: 0,
  scopeMask: 0,
  paletteId: null,
  decalId: null,
  outlineId: null,
  spikesShape: 0,
  bodyShape: 0,
  teethShape: 0,
  selectedIndex: null,
  fragments: {},
  decalsUsed: new Set(),
  totalSupply: 0,
  minting: false,
  use4337: false,
  usePaymaster: false,
  hasCorrectNetwork: false,
  backendCompatible: false,
  backendStatus: null,
  backendAuthRecipient: null,
  backendAuthToken: null,
  backendAuthExpiresAt: 0,
  allowlistChecked: false,
  allowlistEligible: false,
  allowlistRemaining: 0,
  mintReady: false,
  selectionLocked: false,
  lockedIndex: null,
};

// ── DOM references ─────────────────────────────────────────────

const appRoot = document.body;
const heroSection = document.getElementById("heroSection");
const connectBtn = document.getElementById("connectBtn");
const walletStatus = document.getElementById("walletStatus");
const walletPill = document.getElementById("walletPill");
const smartAccountPill = document.getElementById("smartAccountPill");
const networkPill = document.getElementById("networkPill");
const testModePill = document.getElementById("testModePill");
const switchNetworkBtn = document.getElementById("switchNetworkBtn");
const installWalletLink = document.getElementById("installWalletLink");
const errorBanner = document.getElementById("errorBanner");
const errorMessage = document.getElementById("errorMessage");
const retryMintBtn = document.getElementById("retryMintBtn");
const gallery = document.getElementById("gallery");
const sentinel = document.getElementById("sentinel");
const selectionStatus = document.getElementById("selectionStatus");
const selectedTraits = document.getElementById("selectedTraits");
const mintBtn = document.getElementById("mintBtn");
const previewArt = document.getElementById("previewArt");
const previewMeta = document.getElementById("previewMeta");
const mintStatus = document.getElementById("mintStatus");
const mintSteps = document.getElementById("mintSteps");
const supplyCount = document.getElementById("supplyCount");
const smartAccountStatus = document.getElementById("smartAccountStatus");
const ownerCountEl = document.getElementById("ownerCount");
const unlockInboxStatus = document.getElementById("unlockInboxStatus");
const applyScopesBtn = document.getElementById("applyScopesBtn");
const usePaymasterToggle = document.getElementById("usePaymasterToggle");
const addOwnerBtn = document.getElementById("addOwnerBtn");
const newOwnerInput = document.getElementById("newOwnerInput");
const validMinutesInput = document.getElementById("validMinutesInput");
const constraintsHashInput = document.getElementById("constraintsHashInput");
const buildUnlockBtn = document.getElementById("buildUnlockBtn");
const refreshTicketBtn = document.getElementById("refreshTicketBtn");
const unlockPayload = document.getElementById("unlockPayload");
const ticketStatus = document.getElementById("ticketStatus");
const flowStepper = document.getElementById("flowStepper");
const configBanner = document.getElementById("configBanner");

if (supplyCount) supplyCount.textContent = "0 / 13 minted";

const FLOW_STEPS = ["connect", "proof", "build", "submit", "confirmed"];
let ethersPromise = null;
let lastViewState = "disconnected";
let walletListenerProvider = null;
let onWalletAccountsChanged = null;
let onWalletChainChanged = null;
const INITIAL_GALLERY_ROWS = 3;
const APPEND_GALLERY_ROWS = 2;
const MAX_GALLERY_ROWS = 30;
let renderedGalleryRows = 0;

function getReadProvider() {
  return state.readProvider || state.provider;
}

function modeLabel() {
  return `net=${ACTIVE_NETWORK.key}`;
}

function buildBackendMismatchMessage(status, expectedAllowlistSigner = "") {
  return buildBackendCompatibilityMessage(
    evaluateBackendCompatibility({
      backendStatus: status,
      expectedChainId: ACTIVE_NETWORK.chainId,
      expectedFactory: PHIL_ACCOUNT_FACTORY,
      expectedProofGate: PROOF_GATE_ADDRESS,
      expectedPaymaster: PHIL_PAYMASTER,
      expectedAllowlistSigner,
    })
  );
}

function updateConfigBanner() {
  if (!configBanner) return;

  const backendChain = Number(state.backendStatus?.backendChainId);
  const backendFactory = state.backendStatus?.backendFactory || "unknown";
  const backendState = state.backendStatus
    ? `${backendChain || "unknown"} / ${shortAddr(backendFactory)}`
    : "unreachable";
  const lines = [
    `mode: ${modeLabel()}`,
    `targetChain: ${ACTIVE_NETWORK.chainId}`,
    `rpc: ${ACTIVE_NETWORK.rpcUrl}`,
    `deployments: ${LOADED_STARK_DEPLOYMENT || DEPLOYMENTS_STARK_FILE}, ${LOADED_4337_DEPLOYMENT || DEPLOYMENTS_4337_FILE}`,
    `factory: ${PHIL_ACCOUNT_FACTORY || "missing"}`,
    `backend: ${backendState}`,
  ];
  configBanner.textContent = lines.join(" | ");
  configBanner.classList.toggle("is-bad", state.backendStatus && !state.backendCompatible);
}

async function fetchBackendStatus({ force = false } = {}) {
  if (!force && state.backendStatus) return state.backendStatus;
  let response;
  try {
    response = await fetch(`${PROOF_SERVER}/status`, { cache: "no-store" });
  } catch {
    state.backendStatus = null;
    state.backendCompatible = false;
    updateConfigBanner();
    return null;
  }

  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload?.status) {
    state.backendStatus = null;
    state.backendCompatible = false;
    updateConfigBanner();
    return null;
  }

  const backendChainId = Number(payload.backendChainId);
  let expectedAllowlistSigner = "";
  const readProvider = getReadProvider();
  if (state.ethers && readProvider && PROOF_GATE_ADDRESS) {
    try {
      const gate = new state.ethers.Contract(
        PROOF_GATE_ADDRESS,
        ["function allowlistSigner() view returns (address)"],
        readProvider
      );
      expectedAllowlistSigner = String(await gate.allowlistSigner());
    } catch {
      expectedAllowlistSigner = "";
    }
  }

  const compatibility = evaluateBackendCompatibility({
    backendStatus: payload,
    expectedChainId: ACTIVE_NETWORK.chainId,
    expectedFactory: PHIL_ACCOUNT_FACTORY,
    expectedProofGate: PROOF_GATE_ADDRESS,
    expectedPaymaster: PHIL_PAYMASTER,
    expectedAllowlistSigner,
  });

  state.backendStatus = payload;
  state.backendCompatible = compatibility.ok && backendChainId === ACTIVE_NETWORK.chainId;
  updateConfigBanner();
  return payload;
}

async function ensureBackendCompatibility(actionLabel = "/compute-account") {
  const status = await fetchBackendStatus({ force: true });
  if (!status) {
    throw new Error(`Backend ${actionLabel} unavailable at ${PROOF_SERVER}.`);
  }
  if (!state.backendCompatible) {
    let expectedAllowlistSigner = "";
    const readProvider = getReadProvider();
    if (state.ethers && readProvider && PROOF_GATE_ADDRESS) {
      try {
        const gate = new state.ethers.Contract(
          PROOF_GATE_ADDRESS,
          ["function allowlistSigner() view returns (address)"],
          readProvider
        );
        expectedAllowlistSigner = String(await gate.allowlistSigner());
      } catch {
        expectedAllowlistSigner = "";
      }
    }
    throw new Error(buildBackendMismatchMessage(status, expectedAllowlistSigner));
  }
}

async function ensureBackendAuthToken() {
  if (!state.signer || !state.address) {
    throw new Error("Wallet is not ready for backend authentication.");
  }

  const now = Math.floor(Date.now() / 1000);
  const currentRecipient = state.address.toLowerCase();
  if (
    state.backendAuthToken &&
    state.backendAuthRecipient === currentRecipient &&
    Number(state.backendAuthExpiresAt || 0) > now + 30
  ) {
    return state.backendAuthToken;
  }

  const challengeRes = await fetch(`${PROOF_SERVER}/auth/challenge`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      recipient: state.address,
    }),
  });
  const challengePayload = await challengeRes.json().catch(() => null);
  if (!challengeRes.ok || !challengePayload?.message || !challengePayload?.nonce) {
    state.backendAuthRecipient = null;
    state.backendAuthToken = null;
    state.backendAuthExpiresAt = 0;
    const reason = challengePayload?.error || `HTTP ${challengeRes.status}`;
    throw new Error(`Backend auth challenge failed: ${reason}`);
  }

  const signature = await state.signer.signMessage(challengePayload.message);
  const verifyRes = await fetch(`${PROOF_SERVER}/auth/verify`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      recipient: state.address,
      nonce: challengePayload.nonce,
      signature,
    }),
  });
  const verifyPayload = await verifyRes.json().catch(() => null);
  if (!verifyRes.ok || !verifyPayload?.token) {
    state.backendAuthRecipient = null;
    state.backendAuthToken = null;
    state.backendAuthExpiresAt = 0;
    const reason = verifyPayload?.error || verifyPayload?.code || `HTTP ${verifyRes.status}`;
    throw new Error(`Backend auth verify failed: ${reason}`);
  }

  state.backendAuthRecipient = currentRecipient;
  state.backendAuthToken = verifyPayload.token;
  state.backendAuthExpiresAt = Number(verifyPayload.expiresAt || 0);
  return state.backendAuthToken;
}

function walletDebug(label, data) {
  if (!WALLET_DEBUG) return;
  console.info(`[wallet-debug] ${label}`, data);
}

function setError(message, { showRetry = false } = {}) {
  if (!errorBanner || !errorMessage) return;
  errorMessage.textContent = message;
  if (retryMintBtn) retryMintBtn.classList.toggle("hidden", !showRetry);
  errorBanner.classList.remove("hidden");
}

function clearError() {
  if (!errorBanner || !errorMessage) return;
  errorMessage.textContent = "";
  if (retryMintBtn) retryMintBtn.classList.add("hidden");
  errorBanner.classList.add("hidden");
}

function getEligibilityMessage() {
  if (!state.address || !state.hasCorrectNetwork) return "";
  if (!state.allowlistChecked) return "Checking Test13 eligibility...";
  if (state.allowlistEligible) return "";
  return "Not eligible for Test13 mint";
}

async function refreshEligibility({ suppressErrors = false } = {}) {
  if (!state.address) {
    state.allowlistChecked = false;
    state.allowlistEligible = false;
    state.allowlistRemaining = 0;
    updateSelectionMeta();
    updateUiState();
    return;
  }

  try {
    const res = await fetch(
      `${PROOF_SERVER}/eligibility?address=${encodeURIComponent(state.address)}`,
      { cache: "no-store" }
    );
    const payload = await res.json().catch(() => null);
    if (!res.ok || !payload) {
      throw new Error(payload?.error || `HTTP ${res.status}`);
    }

    state.allowlistChecked = true;
    state.allowlistEligible = Boolean(payload.eligible);
    state.allowlistRemaining = Number(payload.remaining || 0);
  } catch (err) {
    state.allowlistChecked = false;
    state.allowlistEligible = false;
    state.allowlistRemaining = 0;
    if (!suppressErrors) {
      setError(`Failed to check allowlist eligibility: ${err?.message || "Unknown error"}`);
    }
  }

  updateSelectionMeta();
  updateUiState();
}

function setFlowStage(stage, { errored = false } = {}) {
  if (!flowStepper) return;
  const idx = FLOW_STEPS.indexOf(stage);
  flowStepper.querySelectorAll("[data-step]").forEach((el, elIdx) => {
    el.classList.remove("is-done", "is-active", "is-error");
    if (idx === -1) return;
    if (errored && elIdx === idx) {
      el.classList.add("is-error");
      return;
    }
    if (elIdx < idx) el.classList.add("is-done");
    if (elIdx === idx) el.classList.add("is-active");
  });
}

function shortAddr(addr) {
  if (!addr || addr.length < 10) return addr || "-";
  return addr.slice(0, 6) + "..." + addr.slice(-4);
}

function getViewState() {
  const connected = Boolean(state.address);
  if (!connected) return "disconnected";
  if (
    connected &&
    state.hasCorrectNetwork &&
    state.allowlistChecked &&
    state.allowlistEligible &&
    state.mintReady &&
    state.selectedIndex != null
  ) {
    return "mint-ready";
  }
  return "connected";
}

function updateWalletPills() {
  if (walletPill) walletPill.textContent = state.address ? `EOA ${shortAddr(state.address)}` : "EOA -";
  if (smartAccountPill) {
    smartAccountPill.textContent = state.smartAccount
      ? `Smart ${shortAddr(state.smartAccount)}${state.isSmartAccountDeployed ? "" : " (undeployed)"}`
      : "Smart -";
  }
  if (networkPill) {
    networkPill.textContent = state.hasCorrectNetwork
      ? ACTIVE_NETWORK.name
      : `Wrong Network (${ACTIVE_NETWORK.name} required)`;
  }
  if (testModePill) {
    testModePill.classList.toggle("hidden", !TEST_MODE_ENABLED);
  }
}

function updateUiState() {
  const viewState = getViewState();
  if (appRoot) appRoot.dataset.viewState = viewState;
  if (heroSection) heroSection.classList.toggle("hero-compact", viewState !== "disconnected");
  if (connectBtn) connectBtn.classList.toggle("hidden", viewState !== "disconnected");
  if (mintBtn) mintBtn.classList.toggle("hidden", viewState !== "mint-ready");
  if (switchNetworkBtn) {
    switchNetworkBtn.textContent = `Switch to ${ACTIVE_NETWORK.name}`;
    switchNetworkBtn.classList.toggle("hidden", !state.address || state.hasCorrectNetwork);
  }
  if (installWalletLink) installWalletLink.classList.toggle("hidden", Boolean(window.ethereum));
  updateWalletPills();
  updateConfigBanner();
  updateMintButton();

  if (viewState !== lastViewState && viewState !== "disconnected" && gallery) {
    renderGallery(false);
  }
  lastViewState = viewState;
}

async function getEthersLib() {
  if (!ethersPromise) {
    ethersPromise = import("https://cdn.jsdelivr.net/npm/ethers@6.13.4/dist/ethers.min.js")
      .then((mod) => mod.ethers)
      .catch((err) => {
        ethersPromise = null;
        throw err;
      });
  }
  return ethersPromise;
}

function isCorrectNetwork(chainId) {
  try {
    return BigInt(chainId) === TARGET_CHAIN_ID;
  } catch {
    return false;
  }
}

function getInjectedProviderCandidates() {
  if (!window.ethereum) return [];

  const providers = [];
  if (Array.isArray(window.ethereum.providers)) {
    providers.push(...window.ethereum.providers);
  }
  providers.push(window.ethereum);

  const unique = [];
  const seen = new Set();
  for (const provider of providers) {
    if (!provider || typeof provider.request !== "function") continue;
    if (seen.has(provider)) continue;
    seen.add(provider);
    unique.push(provider);
  }
  return unique;
}

function pickInjectedProvider() {
  const providers = getInjectedProviderCandidates();
  walletDebug("detected-providers", providers.map((p) => ({
    isMetaMask: Boolean(p.isMetaMask),
    isCoinbaseWallet: Boolean(p.isCoinbaseWallet),
    isRabby: Boolean(p.isRabby),
    isBraveWallet: Boolean(p.isBraveWallet),
    hasRequest: typeof p.request === "function",
  })));

  const metaMask = providers.find((p) => p.isMetaMask);
  return metaMask || providers[0] || null;
}

function listProvidersByPriority() {
  const providers = getInjectedProviderCandidates();
  return providers.sort((a, b) => {
    if (a.isMetaMask && !b.isMetaMask) return -1;
    if (!a.isMetaMask && b.isMetaMask) return 1;
    return 0;
  });
}

async function requestEip1193(provider, method, params = []) {
  walletDebug("request", { method, params });
  try {
    const result = await provider.request({ method, params });
    walletDebug("response", { method, result });
    return result;
  } catch (err) {
    walletDebug("error", {
      method,
      code: err?.code,
      message: err?.message,
      stack: err?.stack,
      name: err?.name,
    });
    throw err;
  }
}

async function requestAccountsWithFallback({ silent = false } = {}) {
  const method = silent ? "eth_accounts" : "eth_requestAccounts";
  const providers = listProvidersByPriority();
  if (providers.length === 0) return { provider: null, accounts: [] };

  let lastError = null;
  for (const provider of providers) {
    try {
      const accounts = await requestEip1193(provider, method);
      if (Array.isArray(accounts) && accounts.length > 0) {
        return { provider, accounts };
      }
      if (silent) {
        return { provider, accounts: [] };
      }
    } catch (err) {
      lastError = err;
      walletDebug("provider-attempt-failed", {
        isMetaMask: Boolean(provider?.isMetaMask),
        isCoinbaseWallet: Boolean(provider?.isCoinbaseWallet),
        code: err?.code,
        message: err?.message,
      });
    }
  }

  if (lastError) throw lastError;
  return { provider: providers[0], accounts: [] };
}

function detachWalletListeners() {
  if (!walletListenerProvider) return;
  if (typeof walletListenerProvider.removeListener === "function") {
    if (onWalletAccountsChanged) {
      walletListenerProvider.removeListener("accountsChanged", onWalletAccountsChanged);
    }
    if (onWalletChainChanged) {
      walletListenerProvider.removeListener("chainChanged", onWalletChainChanged);
    }
  }
  walletListenerProvider = null;
  onWalletAccountsChanged = null;
  onWalletChainChanged = null;
}

function clearWalletState() {
  detachWalletListeners();
  state.provider = null;
  state.readProvider = null;
  state.signer = null;
  state.ethers = null;
  state.eip1193 = null;
  state.address = null;
  state.smartAccount = null;
  state.starkKeyPair = null;
  state.isSmartAccountDeployed = false;
  state.unlockInbox = null;
  state.ownerCount = 0;
  state.scopeMask = 0;
  state.hasCorrectNetwork = false;
  state.backendAuthRecipient = null;
  state.backendAuthToken = null;
  state.backendAuthExpiresAt = 0;
  state.allowlistChecked = false;
  state.allowlistEligible = false;
  state.allowlistRemaining = 0;
  state.mintReady = false;
  state.selectionLocked = false;
  state.lockedIndex = null;
  state.use4337 = false;
  if (walletStatus) walletStatus.textContent = "Wallet disconnected";
  if (smartAccountStatus) smartAccountStatus.textContent = "Not ready";
  if (ownerCountEl) ownerCountEl.textContent = "-";
  if (unlockInboxStatus) unlockInboxStatus.textContent = "-";
}

function getDeterministicTestStarkKeyPair(ethers, eoa) {
  const pubKey = ethers.solidityPackedKeccak256(
    ["string", "uint256", "address"],
    ["phil-test-mode-stark-pubkey", BigInt(ACTIVE_NETWORK.chainId), eoa]
  );
  return {
    privateKey: "0x",
    publicKey: ethers.toBeHex(BigInt(pubKey), 32),
    fullPublicKey: "0x",
  };
}

async function switchToTargetNetwork() {
  const provider = state.eip1193 || pickInjectedProvider();
  if (!provider) return;
  try {
    await requestEip1193(provider, "wallet_switchEthereumChain", [{ chainId: TARGET_CHAIN_ID_HEX }]);
    clearError();
  } catch (err) {
    if (err?.code === 4902) {
      const addChainParams = {
        chainId: TARGET_CHAIN_ID_HEX,
        chainName: ACTIVE_NETWORK.name,
        nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 },
        rpcUrls: [ACTIVE_NETWORK.rpcUrl],
      };
      await requestEip1193(provider, "wallet_addEthereumChain", [{
        ...addChainParams,
      }]);
      clearError();
      return;
    }
    throw err;
  }
}

async function computeSmartAccountAddress() {
  if (!state.starkKeyPair || !state.address) return;
  const readProvider = getReadProvider();
  if (!PHIL_ACCOUNT_FACTORY || !state.ethers || !readProvider || !state.provider) {
    throw new Error("PhilAccountFactory is not configured for the active network.");
  }
  await ensureBackendCompatibility("/compute-account");
  let acctRes;
  try {
    acctRes = await fetch(`${PROOF_SERVER}/compute-account`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        eoa: state.address,
        starkPubKeyX: state.starkKeyPair.publicKey,
      }),
    });
  } catch {
    throw new Error(
      `Failed to reach ${PROOF_SERVER}/compute-account. Check backend is running and CORS allows ${window.location.origin}.`
    );
  }

  const acctData = await acctRes.json().catch(() => null);
  if (!acctRes.ok || !acctData?.success || !acctData.smartAccount) {
    throw new Error(acctData?.error || `Failed to compute Smart Account (HTTP ${acctRes.status})`);
  }

  const factory = new state.ethers.Contract(
    PHIL_ACCOUNT_FACTORY,
    ["function getPhilAddress(address owner, uint256 starkPubKeyX) view returns (address)"],
    readProvider
  );
  const localSmartAccount = await factory.getPhilAddress(state.address, state.starkKeyPair.publicKey);
  const backendSmartAccount = acctData.smartAccount;
  if (localSmartAccount.toLowerCase() !== backendSmartAccount.toLowerCase()) {
    const walletNetwork = await state.provider.getNetwork();
    const readNetwork = await readProvider.getNetwork();
    throw new Error(
      `Backend /compute-account mismatch. backend=${backendSmartAccount}, local=${localSmartAccount}. ` +
      `backendFactory=${acctData.factoryAddress || "unknown"}, localFactory=${PHIL_ACCOUNT_FACTORY}, ` +
      `backendChain=${acctData.chainId ?? "unknown"}, walletChain=${walletNetwork.chainId}, readChain=${readNetwork.chainId}. ` +
      "Check backend deployment/RPC alignment."
    );
  }

  state.smartAccount = localSmartAccount;
  const code = await readProvider.getCode(state.smartAccount);
  state.isSmartAccountDeployed = code !== "0x";
}

// ── Wallet ─────────────────────────────────────────────────────

async function connectWallet({ silent = false } = {}) {
  clearError();

  const injectedProvider = pickInjectedProvider();
  if (!injectedProvider) {
    setError("No EIP-1193 wallet detected. Install MetaMask to continue.");
    if (walletStatus) walletStatus.textContent = "No wallet detected";
    updateUiState();
    return false;
  }

  try {
    const ethers = await getEthersLib();
    const { provider: selectedEip1193, accounts } = await requestAccountsWithFallback({ silent });
    if (!selectedEip1193) {
      setError("No wallet provider responded to account request.");
      if (walletStatus) walletStatus.textContent = "No wallet detected";
      updateUiState();
      return false;
    }

    const provider = new ethers.BrowserProvider(selectedEip1193);
    state.eip1193 = selectedEip1193;
    walletDebug("selected-provider", {
      isMetaMask: Boolean(selectedEip1193.isMetaMask),
      isCoinbaseWallet: Boolean(selectedEip1193.isCoinbaseWallet),
      isRabby: Boolean(selectedEip1193.isRabby),
      isBraveWallet: Boolean(selectedEip1193.isBraveWallet),
      silent,
    });

    if (!Array.isArray(accounts) || accounts.length === 0) {
      clearWalletState();
      updateUiState();
      return false;
    }

    state.provider = provider;
    state.readProvider = new ethers.JsonRpcProvider(ACTIVE_NETWORK.rpcUrl);
    state.signer = await provider.getSigner(accounts[0]);
    state.ethers = ethers;
    state.address = accounts[0];
    const readNetwork = await state.readProvider.getNetwork();
    if (!isCorrectNetwork(readNetwork.chainId)) {
      throw new Error(
        `Fatal network guard: RPC_URL must resolve to chain ${ACTIVE_NETWORK.chainId}, got ${readNetwork.chainId}`
      );
    }

    const network = await provider.getNetwork();
    state.hasCorrectNetwork = isCorrectNetwork(network.chainId);

    await loadDeployments();
    state.use4337 = !!(PHIL_ACCOUNT_FACTORY && PHIL_ACCOUNT_IMPL);
    await fetchBackendStatus({ force: true });

    if (!state.hasCorrectNetwork) {
      try {
        await switchToTargetNetwork();
        const switched = await provider.getNetwork();
        state.hasCorrectNetwork = isCorrectNetwork(switched.chainId);
      } catch (switchErr) {
        state.smartAccount = null;
        state.isSmartAccountDeployed = false;
        if (walletStatus) walletStatus.textContent = "Wrong network selected";
        setError(
          `Switch MetaMask to ${ACTIVE_NETWORK.name} (${ACTIVE_NETWORK.chainId}) to continue. ${switchErr?.message || ""}`.trim()
        );
        setFlowStage("connect");
        updateUiState();
        return true;
      }

      if (!state.hasCorrectNetwork) {
        state.smartAccount = null;
        state.isSmartAccountDeployed = false;
        if (walletStatus) walletStatus.textContent = "Wrong network selected";
        setError(`Switch MetaMask to ${ACTIVE_NETWORK.name} (${ACTIVE_NETWORK.chainId}) to continue.`);
        setFlowStage("connect");
        updateUiState();
        return true;
      }
    }

    if (!PHIL_TEST_MINT) {
      throw new Error(`Missing deployment for chain ${ACTIVE_NETWORK.deploymentsChainId}`);
    }

    if (walletStatus) walletStatus.textContent = "Connected. Preparing account...";

    if (state.use4337) {
      if (TEST_MODE_ENABLED) {
        state.starkKeyPair = getDeterministicTestStarkKeyPair(ethers, state.address);
        walletDebug("test-mode-stark-key", {
          eoa: state.address,
          starkPubKeyX: state.starkKeyPair.publicKey,
        });
      } else {
        state.starkKeyPair = await getOrCreateStarkKeyPair();
      }
      await ensureBackendCompatibility("/compute-account");
      await computeSmartAccountAddress();
      await loadVaultState();
    } else {
      state.smartAccount = null;
      state.isSmartAccountDeployed = false;
      if (smartAccountStatus) smartAccountStatus.textContent = "Legacy mode";
    }

    await loadContractState();
    await refreshEligibility();
    if (walletStatus) {
      walletStatus.textContent = TEST_MODE_ENABLED
        ? `Connected on ${ACTIVE_NETWORK.name} (TEST MODE)`
        : `Connected on ${ACTIVE_NETWORK.name}`;
    }
    setFlowStage("connect");
    setupAccountListeners(selectedEip1193);
    updateUiState();
    return true;
  } catch (err) {
    console.error("Wallet connection failed:", err);
    const message = err?.message || err?.reason || "Wallet connection failed";
    walletDebug("connect-failed", {
      name: err?.name,
      code: err?.code,
      message: err?.message,
      stack: err?.stack,
    });
    setError(message);
    if (walletStatus) walletStatus.textContent = "Connection failed";
    updateUiState();
    return false;
  }
}

function getScopeCheckboxes() {
  return Array.from(document.querySelectorAll(".scope-grid input[type='checkbox']"));
}

function getSelectedScopeMask() {
  return getScopeCheckboxes().reduce((mask, el) => {
    const key = el.dataset.scope;
    if (el.checked && key && SCOPE_BITS[key] !== undefined) {
      return mask | SCOPE_BITS[key];
    }
    return mask;
  }, 0);
}

function setScopeCheckboxes(mask) {
  getScopeCheckboxes().forEach((el) => {
    const key = el.dataset.scope;
    if (!key || SCOPE_BITS[key] === undefined) return;
    el.checked = (mask & SCOPE_BITS[key]) !== 0;
  });
}

async function loadVaultState() {
  if (!state.use4337 || !state.smartAccount) return;
  const readProvider = getReadProvider();
  if (!readProvider) return;

  if (smartAccountStatus) {
    smartAccountStatus.textContent = state.isSmartAccountDeployed
      ? shortAddr(state.smartAccount)
      : "Not deployed yet";
  }

  if (!state.isSmartAccountDeployed) {
    if (ownerCountEl) ownerCountEl.textContent = "-";
    if (unlockInboxStatus) unlockInboxStatus.textContent = "-";
    updateWalletPills();
    return;
  }

  try {
    const accountAbi = [
      "function ownerCount() view returns (uint32)",
      "function starkScopeMask() view returns (uint32)",
      "function unlockInbox() view returns (address)",
    ];
    const account = new state.ethers.Contract(state.smartAccount, accountAbi, readProvider);
    const [ownerCount, mask, inbox] = await Promise.all([
      account.ownerCount(),
      account.starkScopeMask(),
      account.unlockInbox(),
    ]);

    state.ownerCount = Number(ownerCount);
    state.scopeMask = Number(mask);
    state.unlockInbox = inbox && inbox !== "0x0000000000000000000000000000000000000000" ? inbox : PHIL_UNLOCK_INBOX;

    if (ownerCountEl) ownerCountEl.textContent = String(state.ownerCount);
    if (unlockInboxStatus) {
      unlockInboxStatus.textContent = state.unlockInbox
        ? shortAddr(state.unlockInbox)
        : "Not set";
    }
    setScopeCheckboxes(state.scopeMask);
    updateWalletPills();

    await refreshUnlockTicket();
  } catch (e) {
    console.warn("Failed to load vault state:", e);
  }
}

async function refreshUnlockTicket() {
  if (!state.unlockInbox || !state.smartAccount) {
    ticketStatus.textContent = "No unlock inbox configured";
    return;
  }
  const readProvider = getReadProvider();
  if (!readProvider) {
    ticketStatus.textContent = "No provider";
    return;
  }

  try {
    const inboxAbi = [
      "function getTicket(address vault) view returns (tuple(uint64 nonce, uint32 validAfter, uint32 validUntil, uint32 scope, bytes32 constraintsHash))",
    ];
    const inbox = new state.ethers.Contract(state.unlockInbox, inboxAbi, readProvider);
    const ticket = await inbox.getTicket(state.smartAccount);

    if (!ticket || ticket.nonce === 0n) {
      ticketStatus.textContent = "No ticket";
      return;
    }

    const validAfter = Number(ticket.validAfter);
    const validUntil = Number(ticket.validUntil);
    const now = Math.floor(Date.now() / 1000);
    const active = (!validAfter || now >= validAfter) && (!validUntil || now <= validUntil);

    ticketStatus.textContent =
      `Ticket #${ticket.nonce} scope=0x${ticket.scope.toString(16)} ` +
      `active=${active} ` +
      `validUntil=${validUntil ? new Date(validUntil * 1000).toLocaleTimeString() : "∞"}`;
  } catch (e) {
    console.warn("Failed to load ticket:", e);
    ticketStatus.textContent = "Ticket load failed";
  }
}

function buildUnlockPayload() {
  const minutes = parseInt(validMinutesInput.value || "10", 10);
  const now = Math.floor(Date.now() / 1000);
  const validAfter = now;
  const validUntil = now + Math.max(1, minutes) * 60;

  const scope = getSelectedScopeMask();
  const constraintsHash = (constraintsHashInput.value || "").trim() ||
    "0x0000000000000000000000000000000000000000000000000000000000000000";

  const payload = {
    vault: state.smartAccount,
    scope,
    validAfter,
    validUntil,
    constraintsHash,
  };

  unlockPayload.textContent = JSON.stringify(payload, null, 2);
  unlockPayload.classList.remove("hidden");

  if (STARKNET_UNLOCK_URL) {
    const url = new URL(STARKNET_UNLOCK_URL);
    url.searchParams.set("vault", payload.vault || "");
    url.searchParams.set("scope", String(scope));
    url.searchParams.set("validAfter", String(validAfter));
    url.searchParams.set("validUntil", String(validUntil));
    url.searchParams.set("constraintsHash", constraintsHash);
    unlockPayload.textContent += `\n\nOpen unlock UI:\n${url.toString()}`;
  }
}

// ── Contract State ─────────────────────────────────────────────

async function loadContractState() {
  const readProvider = getReadProvider();
  if (!readProvider || !state.ethers || !PHIL_TEST_MINT) return;

  const contract = new state.ethers.Contract(PHIL_TEST_MINT, MINT_ABI, readProvider);

  try {
    state.totalSupply = Number(await contract.totalSupply());
    supplyCount.textContent = `${state.totalSupply} / 13 minted`;
  } catch (e) {
    console.error("Failed to read totalSupply:", e);
  }

  state.decalsUsed.clear();
  for (let i = 0; i < 13; i++) {
    try {
      const used = await contract.decalUsed(i);
      if (used) state.decalsUsed.add(i);
    } catch (e) {
      // ignore
    }
  }

  refreshGalleryState();
  autoSelectNext();
  updateUiState();
}

// ── Gallery + Selection ─────────────────────────────────────────

let mintIndex = 0;
const cardByIndex = new Map();

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

  const nebulaSvg = state.fragments[nebulaKey] || "";
  const spikesShapeSvg = spikesShapeKey ? (state.fragments[spikesShapeKey] || "") : "";
  const teethShapeSvg = teethShapeKey ? (state.fragments[teethShapeKey] || "") : "";
  const lensSvg = lensKey ? (state.fragments[lensKey] || "") : "";

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 420 420" shape-rendering="geometricPrecision">
    ${defs}
    <rect width="420" height="420" fill="#${palette.bgColor}"/>
    ${includeNebulaStars && nebulaSvg ? `<g>${nebulaSvg}</g>` : ""}
    ${includeNebulaStars ? `<g fill="#${palette.bgStarsFill}" stroke="#${palette.bgStarsStroke}" opacity="0.69">${state.fragments[BG_STARS.key] || ""}</g>` : ""}
    ${includeSpiralDust ? `<g fill="none" stroke="#${palette.bgSpiralStroke}" stroke-opacity="0.69">${state.fragments[spiralKey] || ""}</g>` : ""}
    ${includeSpiralDust ? `<g fill="#${palette.bgDustFill}" stroke="#${palette.bgDustStroke}" opacity="0.69">${state.fragments[BG_DUST.key] || ""}</g>` : ""}
    <g fill="#${palette.spikesFill}" stroke="none">${state.fragments[spikesKey] || ""}</g>
    ${spikesShapeSvg ? `<g fill="url(#${gradSpikeId})" stroke="none">${spikesShapeSvg}</g>` : ""}
    <g fill="#${palette.bodyFill}" stroke="none">${state.fragments[BODY_OUTLINE.key] || ""}</g>
    <g fill="url(#${gradBodyId})" stroke="none">${state.fragments[bodyShapeKey] || ""}</g>
    <g fill="#${palette.teethFill}" stroke="none">${state.fragments[teethKey] || ""}</g>
    ${teethShapeSvg ? `<g fill="url(#${gradTeethId})" stroke="none">${teethShapeSvg}</g>` : ""}
    <g fill="#${palette.jawFill}" stroke="none">${state.fragments[jawKey] || ""}</g>
    <g fill="#${palette.jawFill}" stroke="none">${state.fragments[noseKey] || ""}</g>
    <g fill="#${palette.frameFill}" stroke="none">${state.fragments[frameKey] || ""}</g>
    ${lensSvg ? `<g fill="url(#${gradLensId})" stroke="none">${lensSvg}</g>` : ""}
    <g fill="#${palette.decalFill}" stroke="#${palette.decalStroke}" stroke-opacity="0.13">${state.fragments[decalKey] || ""}</g>
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
  card.dataset.index = String(index);
  card.dataset.decal = String(config.decalIdx);

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

  card.addEventListener("click", () => selectConfig(index));
  cardByIndex.set(index, card);

  return card;
}

function appendRow() {
  if (renderedGalleryRows >= MAX_GALLERY_ROWS) {
    if (sentinel) sentinel.textContent = "Preview limit reached";
    return false;
  }

  const row = document.createElement("div");
  row.className = "phil-row";

  const count = 5;
  for (let i = 0; i < count; i++) {
    const config = getConfig(mintIndex);
    const card = createPhilCard(config, mintIndex);
    row.appendChild(card);
    mintIndex++;
  }

  gallery.appendChild(row);
  renderedGalleryRows += 1;
  refreshGalleryState();

  return true;
}

function sentinelVisibleForLayout() {
  return Boolean(sentinel && sentinel.offsetParent !== null);
}

function renderGallery(reset = false) {
  if (!gallery) return;
  if (reset) {
    gallery.innerHTML = "";
    cardByIndex.clear();
    mintIndex = 0;
    renderedGalleryRows = 0;
    if (sentinel) sentinel.textContent = "Scroll for more generations...";
  }

  const maxRows = INITIAL_GALLERY_ROWS;
  for (let i = 0; i < maxRows; i++) {
    if (!appendRow()) break;
    if (!sentinelVisibleForLayout()) break;
    const rect = sentinel.getBoundingClientRect();
    if (rect.top > window.innerHeight + 400) break;
  }
}

function wireInfiniteScroll() {
  if (!sentinel) return;
  const observer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        const maxRows = APPEND_GALLERY_ROWS;
        for (let i = 0; i < maxRows; i++) {
          if (!appendRow()) break;
          if (!sentinelVisibleForLayout()) break;
          const rect = sentinel.getBoundingClientRect();
          if (rect.top > window.innerHeight + 400) break;
        }
      }
    });
  });
  observer.observe(sentinel);
}

function lockSelectionIfNeeded() {
  if (!state.mintReady || state.selectionLocked) return;
  if (state.selectedIndex == null) {
    autoSelectNext();
  }
  if (state.selectedIndex != null) {
    state.selectionLocked = true;
    state.lockedIndex = state.selectedIndex;
    if (selectionStatus) {
      selectionStatus.textContent = `Selection locked at Phil #${state.selectedIndex + 1}.`;
    }
  }
}

function updateMintReadiness() {
  const threshold = Math.max(280, Math.floor(window.innerHeight * 0.5));
  const ready = window.scrollY >= threshold;
  if (ready && !state.mintReady) {
    state.mintReady = true;
    lockSelectionIfNeeded();
  }
  updateUiState();
}

function refreshGalleryState() {
  for (const [index, card] of cardByIndex.entries()) {
    const config = getConfig(index);
    const minted = state.decalsUsed.has(config.decalIdx);
    card.classList.toggle("minted", minted);
    card.classList.toggle("selected", state.selectedIndex === index);
  }
}

function selectConfig(index) {
  const config = getConfig(index);
  if (!config) return;

  if (state.selectionLocked && state.lockedIndex != null && index !== state.lockedIndex) {
    if (selectionStatus) selectionStatus.textContent = "Selection locked. Mint this Phil or refresh to generate a new one.";
    return;
  }

  if (state.decalsUsed.has(config.decalIdx)) {
    if (selectionStatus) selectionStatus.textContent = "That decal is already minted.";
    return;
  }

  state.selectedIndex = index;
  state.paletteId = config.paletteId;
  state.decalId = config.decalIdx;
  state.outlineId = config.outlineIdx;
  state.spikesShape = config.spikesShapeIdx;
  state.bodyShape = config.bodyShapeIdx;
  state.teethShape = config.teethShapeIdx;

  updateSelectionMeta();
  updatePreview();
  refreshGalleryState();
  updateMintButton();
  updateUiState();
}

function updateSelectionMeta() {
  if (!selectionStatus || !selectedTraits) return;
  const eligibilityMessage = getEligibilityMessage();
  if (state.selectedIndex == null) {
    selectionStatus.textContent = eligibilityMessage || "Scroll to generate. Click a Phil to select it.";
    selectedTraits.innerHTML = "";
    return;
  }

  const config = getConfig(state.selectedIndex);
  const palette = PALETTES[config.paletteId];
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

  selectionStatus.textContent = eligibilityMessage || (
    state.selectionLocked
      ? `Locked Phil #${state.selectedIndex + 1} ready to mint`
      : `Selected Phil #${state.selectedIndex + 1}`
  );
  const backgroundLabel = config.bgMode === "nebulaStars"
    ? `${nebula.label} + Stars`
    : `${spiral.label} + Dust`;

  selectedTraits.innerHTML = `
    <span class="trait">Palette ${palette.id + 1}</span>
    <span class="trait">${decal.label}</span>
    <span class="trait">${frame.label}</span>
    <span class="trait">${lensShape ? lensShape.label : "Lens"}</span>
    <span class="trait">${jawLine.label}</span>
    <span class="trait">${nose.label}</span>
    <span class="trait">${spikes.label}${spikesShape ? ` · ${spikesShape.label}` : ""}</span>
    <span class="trait">${bodyShape.label}</span>
    <span class="trait">${teeth.label}${teethShape ? ` · ${teethShape.label}` : ""}</span>
    <span class="trait">${backgroundLabel}</span>
  `;
}

function autoSelectNext() {
  if (state.selectedIndex != null && !state.decalsUsed.has(state.decalId ?? -1)) {
    return;
  }
  getConfig(Math.max(mintIndex + 10, 20));
  let nextIdx = -1;
  for (let i = 0; i < MINT_QUEUE.length; i++) {
    if (!state.decalsUsed.has(MINT_QUEUE[i].decalIdx)) {
      nextIdx = i;
      break;
    }
  }
  if (nextIdx === -1) {
    state.selectedIndex = null;
    updateSelectionMeta();
    updatePreview();
    updateMintButton();
    return;
  }
  selectConfig(nextIdx);
}

function updatePreview() {
  if (state.selectedIndex == null) {
    previewArt.innerHTML = '<div class="preview-placeholder">Scroll to generate and select a Phil</div>';
    previewMeta.textContent = "";
    return;
  }

  const config = getConfig(state.selectedIndex);
  const palette = PALETTES[config.paletteId];
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
    uid: `preview-${state.selectedIndex}`,
    includeNebulaStars: config.bgMode === "nebulaStars",
    includeSpiralDust: config.bgMode === "spiralDust",
  });
  previewArt.innerHTML = svg;
  previewMeta.textContent = `Palette ${config.paletteId + 1} · Decal ${config.decalIdx + 1}`;
}

function updateMintButton() {
  const canMint =
    state.address &&
    state.hasCorrectNetwork &&
    state.allowlistChecked &&
    state.allowlistEligible &&
    (!state.use4337 || state.backendCompatible) &&
    state.mintReady &&
    state.selectedIndex != null &&
    !state.decalsUsed.has(state.decalId ?? -1);
  mintBtn.disabled = !canMint || state.minting;
}

// ── Mint Flow ─────────────────────────────────────────────────

function renderMintSuccess(title, txHash) {
  if (!mintStatus || !mintSteps) return;
  mintStatus.classList.remove("hidden");
  const link = ETHERSCAN_BASE
    ? `<a class="tx-link" href="${ETHERSCAN_BASE}/tx/${txHash}" target="_blank" rel="noopener">View on Etherscan →</a>`
    : `<span class="tx-link">tx: ${txHash}</span>`;
  mintSteps.innerHTML = `
    <div class="mint-success">
      <div class="token-id">${title}</div>
      ${link}
    </div>
  `;
}

async function requestProof(options = {}) {
  setFlowStage("proof");
  if (!state.ethers || !state.signer || !state.address) {
    throw new Error("Wallet is not ready for proof generation.");
  }

  const kind = options.kind === "action" ? "action" : "mint";
  const opts = options;
  if (!PROOF_GATE_ADDRESS) {
    throw new Error("ProofGate address is missing from deployments.");
  }

  let payloadBody;
  if (kind === "action") {
    if (!opts.actionHash || opts.actionType == null) {
      throw new Error("Action proof requires actionType and actionHash.");
    }
    if (Number(opts.actionType) !== 2) {
      throw new Error(
        "Only ACTION_ACCOUNT_CREATE (2) is supported. Execution approvals are unlock-ticket-only."
      );
    }
    payloadBody = {
      kind: "action",
      recipient: state.address,
      actionType: Number(opts.actionType),
      actionHash: opts.actionHash,
      ...(opts.expiry != null ? { expiry: opts.expiry } : {}),
    };
  } else {
    const philId = Number(state.selectedIndex ?? 0) % 6;
    const paletteVariant = Number(state.paletteId ?? 0);
    const mixMode = 0;
    const mixSeed = 0;
    const mintTo = opts.mintTo || state.address;
    payloadBody = {
      kind: "mint",
      recipient: state.address,
      mintTo,
      philId,
      paletteVariant,
      mixMode,
      mixSeed,
    };
  }

  await ensureBackendCompatibility("/request-mint");
  const authToken = await ensureBackendAuthToken();
  const proofRes = await fetch(`${PROOF_SERVER}/request-mint`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      authorization: `Bearer ${authToken}`,
    },
    body: JSON.stringify(payloadBody),
  });

  const payload = await proofRes.json().catch(() => null);
  if (!proofRes.ok || !payload?.success) {
    const reason = payload?.error || payload?.code || `HTTP ${proofRes.status}`;
    const err = new Error(`Proof unavailable: ${reason}`);
    err.flowStep = "proof";
    throw err;
  }

  return payload;
}

async function doMint() {
  if (state.minting) return;
  clearError();

  if (!state.address) {
    setError("Connect your wallet to mint.");
    return;
  }
  if (!state.hasCorrectNetwork) {
    setError(`Switch to ${ACTIVE_NETWORK.name} before minting.`);
    return;
  }
  if (!state.mintReady || state.selectedIndex == null) {
    setError("Scroll to the mint threshold and select a Phil first.");
    return;
  }
  if (!state.allowlistChecked) {
    await refreshEligibility();
  }
  if (!state.allowlistEligible) {
    setError("Not eligible for Test13 mint.");
    return;
  }

  state.minting = true;
  mintBtn.classList.add("minting");
  if (mintStatus) mintStatus.classList.add("hidden");
  if (mintSteps) mintSteps.innerHTML = "";

  try {
    if (state.use4337) {
      await ensureBackendCompatibility("/compute-account");
    }
    let txHash;
    if (state.use4337) {
      txHash = await doMint4337();
      renderMintSuccess("Minted to Smart Account!", txHash);
    } else {
      txHash = await doMintLegacy();
      renderMintSuccess("Minted Successfully!", txHash);
    }

    state.selectionLocked = false;
    state.lockedIndex = null;
    state.mintReady = false;
    setFlowStage("confirmed");
    await loadContractState();
    await refreshEligibility({ suppressErrors: true });
    autoSelectNext();
  } catch (err) {
    console.error("Mint failed:", err);
    setFlowStage(err?.flowStep || "submit", { errored: true });
    const msg = err?.message || "Unknown error";
    const proofFailure = msg.toLowerCase().includes("proof unavailable");
    setError(`Mint failed: ${msg}`, { showRetry: proofFailure });
  } finally {
    state.minting = false;
    mintBtn.classList.remove("minting");
    updateUiState();
  }
}

async function doMint4337() {
  const ethers = state.ethers;
  const recipient = state.smartAccount;
  const readProvider = getReadProvider();

  if (!recipient) throw new Error("Smart Account not computed");
  if (!readProvider) throw new Error("Read provider not configured");
  if (!state.starkKeyPair) throw new Error("STARK key pair not set");

  const code = await readProvider.getCode(recipient);
  state.isSmartAccountDeployed = code !== "0x";

  const mintProofResponse = await requestProof({ mintTo: recipient });
  const mintProof = mintProofResponse.proof || mintProofResponse;
  let createProof = null;
  const mintTraits = {
    philId: Number(state.selectedIndex ?? 0) % 6,
    paletteVariant: Number(state.paletteId ?? 0),
    mixMode: 0,
    mixSeed: 0,
  };

  if (!state.isSmartAccountDeployed) {
    const factory = new ethers.Contract(
      PHIL_ACCOUNT_FACTORY,
      ["function computeCreateActionHash(address owner, uint256 starkPubKeyX) view returns (bytes32)"],
      readProvider
    );
    const createActionHash = await factory.computeCreateActionHash(
      state.address,
      state.starkKeyPair.publicKey
    );
    const createExpiry = Math.floor(Date.now() / 1000) + 900;
    const createProofResponse = await requestProof({
      kind: "action",
      actionType: 2,
      actionHash: createActionHash,
      expiry: String(createExpiry),
    });
    createProof = createProofResponse.proof || createProofResponse;
  }

  const localEntryPointCode = await readProvider.getCode(ENTRY_POINT_ADDRESS);
  // If local EntryPoint is unavailable, use direct owner-execution fallback.
  if (FORCE_DIRECT_LOCAL_AA || localEntryPointCode === "0x") {
    const txHash = await doMint4337LocalFallback(mintProof, createProof, recipient, mintTraits);
    await loadVaultState();
    return txHash;
  }

  setFlowStage("build");
  let userOp;
  try {
    userOp = await buildMintUserOp({
      ethers,
      smartAccount: recipient,
      factoryAddress: PHIL_ACCOUNT_FACTORY,
      isDeployed: state.isSmartAccountDeployed,
      eoa: state.address,
      starkPubKeyX: state.starkKeyPair.publicKey,
      philTestMint: PHIL_TEST_MINT,
      createProof,
      mintParams: {
        recipient: state.address,
        mintTo: recipient,
        philId: mintTraits.philId,
        paletteVariant: mintTraits.paletteVariant,
        mixMode: mintTraits.mixMode,
        mixSeed: mintTraits.mixSeed,
        proof: mintProof,
      },
      provider: readProvider,
      entryPointAddress: ENTRY_POINT_ADDRESS,
    });
  } catch (err) {
    err.flowStep = "build";
    throw err;
  }

  if (PHIL_PAYMASTER && state.usePaymaster && mintProofResponse.proofId) {
    try {
      const authToken = await ensureBackendAuthToken();
      const pmRes = await fetch(`${PROOF_SERVER}/sign-paymaster`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          authorization: `Bearer ${authToken}`,
        },
        body: JSON.stringify({
          proofId: mintProofResponse.proofId,
          userOp: {
            sender: userOp.sender,
            nonce: userOp.nonce,
            initCode: userOp.initCode,
            callData: userOp.callData,
            accountGasLimits: userOp.accountGasLimits,
            preVerificationGas: userOp.preVerificationGas,
            gasFees: userOp.gasFees,
          },
        }),
      });

      if (pmRes.ok) {
        const pmData = await pmRes.json().catch(() => null);
        if (pmData?.success && pmData.paymasterAndData) {
          userOp.paymasterAndData = pmData.paymasterAndData;
        }
      } else {
        const pmErr = await pmRes.json().catch(() => null);
        const reason = pmErr?.error || pmErr?.code || `HTTP ${pmRes.status}`;
        console.warn(`Paymaster sponsorship rejected (${reason}); continuing with self-pay.`);
      }
    } catch (err) {
      console.warn(`Paymaster sponsorship skipped (${err?.message || err}); continuing with self-pay.`);
    }
  } else if (PHIL_PAYMASTER && state.usePaymaster) {
    console.warn("Paymaster sponsorship unavailable because request-mint did not return proofId.");
  }

  const userOpHash = getUserOpHash(ethers, userOp, ACTIVE_NETWORK.chainId, ENTRY_POINT_ADDRESS);
  userOp.signature = await signUserOp({
    ethers,
    userOpHash,
    eoaSigner: state.signer,
  });

  setFlowStage("submit");
  let txHash;
  try {
    if (BUNDLER_RPC) {
      const opHash = await sendUserOp(BUNDLER_RPC, userOp);
      const receipt = await waitForUserOpReceipt(BUNDLER_RPC, opHash);
      txHash = receipt.receipt?.transactionHash || receipt.transactionHash;
    } else {
      const epAbi = [
        "function handleOps(tuple(address sender, uint256 nonce, bytes initCode, bytes callData, bytes32 accountGasLimits, uint256 preVerificationGas, bytes32 gasFees, bytes paymasterAndData, bytes signature)[] ops, address payable beneficiary) external",
      ];
      const ep = new ethers.Contract(ENTRY_POINT_ADDRESS, epAbi, state.signer);
      const tx = await ep.handleOps([userOp], state.address);
      const receipt = await tx.wait();
      txHash = receipt.hash;
    }
  } catch (err) {
    err.flowStep = "submit";
    throw err;
  }

  await loadVaultState();
  return txHash;
}

async function doMint4337LocalFallback(mintProof, createProof, smartAccount, mintTraits) {
  const ethers = state.ethers;
  const readProvider = getReadProvider();
  setFlowStage("build");

  if (!state.isSmartAccountDeployed) {
    const factory = new ethers.Contract(
      PHIL_ACCOUNT_FACTORY,
      ["function createPhilAccount(address owner, uint256 starkPubKeyX, (uint256 expiry, bytes32 factHash, bytes signature) proof) returns (address)"],
      state.signer
    );
    const createTx = await factory.createPhilAccount(
      state.address,
      state.starkKeyPair.publicKey,
      createProof
    );
    await createTx.wait();
    const code = await readProvider.getCode(smartAccount);
    state.isSmartAccountDeployed = code !== "0x";
  }

  setFlowStage("submit");
  const contract = new ethers.Contract(
    PHIL_TEST_MINT,
    MINT_ABI,
    state.signer
  );
  const tx = await contract.mint(
    state.address,
    smartAccount,
    mintTraits.philId,
    mintTraits.paletteVariant,
    mintTraits.mixMode,
    mintTraits.mixSeed,
    mintProof
  );
  const receipt = await tx.wait();
  return receipt.hash;
}

async function doMintLegacy() {
  const proofResponse = await requestProof({ mintTo: state.address });
  const proof = proofResponse.proof || proofResponse;
  const philId = Number(state.selectedIndex ?? 0) % 6;
  const paletteVariant = Number(state.paletteId ?? 0);
  const mixMode = 0;
  const mixSeed = 0;
  setFlowStage("submit");

  try {
    const contract = new state.ethers.Contract(PHIL_TEST_MINT, MINT_ABI, state.signer);
    const tx = await contract.mint(
      state.address,
      state.address,
      philId,
      paletteVariant,
      mixMode,
      mixSeed,
      proof
    );
    const receipt = await tx.wait();
    return receipt.hash;
  } catch (err) {
    err.flowStep = "submit";
    throw err;
  }
}

// ── Fragment Loading ───────────────────────────────────────────

async function loadFragments() {
  const requests = [
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
  ].map(async (frag) => {
    const res = await fetch(`${FRAG_BASE}/${frag.file}`);
    if (res.ok) state.fragments[frag.key] = await res.text();
  });

  await Promise.all(requests);
}

// ── Account change handling ────────────────────────────────────

function setupAccountListeners(provider = state.eip1193 || pickInjectedProvider()) {
  if (!provider || typeof provider.on !== "function") return;

  if (walletListenerProvider && walletListenerProvider !== provider) {
    detachWalletListeners();
  }
  if (walletListenerProvider === provider) return;

  onWalletAccountsChanged = async (accounts) => {
    walletDebug("accountsChanged", accounts);
    if (!Array.isArray(accounts) || accounts.length === 0) {
      clearWalletState();
      setFlowStage("connect");
      updateUiState();
      return;
    }
    await connectWallet({ silent: true });
  };

  onWalletChainChanged = async (chainId) => {
    walletDebug("chainChanged", { chainId });
    await connectWallet({ silent: true });
  };

  provider.on("accountsChanged", onWalletAccountsChanged);
  provider.on("chainChanged", onWalletChainChanged);
  walletListenerProvider = provider;
}

// ── Init ───────────────────────────────────────────────────────

async function init() {
  setFlowStage("connect");
  let backendLocal = false;
  try {
    await loadDeployments();
    const status = await fetchBackendStatus({ force: true });
    backendLocal = Boolean(status) && Number(status.backendChainId) === ACTIVE_NETWORK.chainId;
  } catch {
    // non-fatal, banner/error handles connectivity state
  }
  if (!backendLocal) {
    setError(`Backend is not on chain ${ACTIVE_NETWORK.chainId}. Start the chain-matched RPC/tunnel.`);
  }
  updateUiState();

  if (connectBtn) {
    connectBtn.addEventListener("click", async () => {
      await connectWallet({ silent: false });
    });
  }
  if (switchNetworkBtn) {
    switchNetworkBtn.addEventListener("click", async () => {
      try {
        await switchToTargetNetwork();
        await connectWallet({ silent: true });
      } catch (err) {
        console.error("Network switch failed:", err);
        setError(`Failed to switch network: ${err?.message || "Unknown error"}`);
      }
    });
  }
  if (mintBtn) mintBtn.addEventListener("click", doMint);
  if (retryMintBtn) retryMintBtn.addEventListener("click", doMint);
  if (usePaymasterToggle) {
    usePaymasterToggle.checked = state.usePaymaster;
    usePaymasterToggle.addEventListener("change", () => {
      state.usePaymaster = Boolean(usePaymasterToggle.checked);
    });
  }

  window.addEventListener("scroll", updateMintReadiness, { passive: true });
  setupAccountListeners();

  try {
    await loadFragments();
    renderGallery(true);
    wireInfiniteScroll();
    autoSelectNext();
    updateSelectionMeta();
    updatePreview();
    updateMintReadiness();
  } catch (err) {
    console.error("Failed to load fragments:", err);
    setError("Failed to load art fragments. Refresh and try again.");
  }

  if (applyScopesBtn) applyScopesBtn.addEventListener("click", async () => {
    if (!state.smartAccount || !state.isSmartAccountDeployed) {
      ticketStatus.textContent = "Smart Account not deployed yet";
      return;
    }
    try {
      const accountAbi = ["function setStarkScopeMask(uint32)"];
      const account = new state.ethers.Contract(state.smartAccount, accountAbi, state.signer);
      const mask = getSelectedScopeMask();
      await (await account.setStarkScopeMask(mask)).wait();
      ticketStatus.textContent = "Scope mask updated";
      await loadVaultState();
    } catch (e) {
      console.error(e);
      ticketStatus.textContent = "Failed to update scope mask";
    }
  });

  if (addOwnerBtn) addOwnerBtn.addEventListener("click", async () => {
    if (!state.smartAccount || !state.isSmartAccountDeployed) {
      ticketStatus.textContent = "Smart Account not deployed yet";
      return;
    }
    const newOwner = (newOwnerInput.value || "").trim();
    if (!newOwner || !newOwner.startsWith("0x") || newOwner.length !== 42) {
      ticketStatus.textContent = "Invalid owner address";
      return;
    }
    try {
      const accountAbi = ["function addOwner(address)"];
      const account = new state.ethers.Contract(state.smartAccount, accountAbi, state.signer);
      await (await account.addOwner(newOwner)).wait();
      newOwnerInput.value = "";
      ticketStatus.textContent = "Owner added";
      await loadVaultState();
    } catch (e) {
      console.error(e);
      ticketStatus.textContent = "Failed to add owner";
    }
  });

  if (buildUnlockBtn) buildUnlockBtn.addEventListener("click", () => {
    buildUnlockPayload();
  });

  if (refreshTicketBtn) refreshTicketBtn.addEventListener("click", async () => {
    await refreshUnlockTicket();
  });

  if (window.ethereum) {
    try {
      await connectWallet({ silent: true });
    } catch (err) {
      console.warn("Auto reconnect failed:", err);
    }
  } else {
    updateUiState();
  }
}

init();
