const PHIL_IDS = [0, 1, 2, 3, 4, 5];
const PALETTE_VARIANTS = [0, 1, 2, 3, 4, 5, 6, 7, 8];
const MIX_MODES = [0, 1, 2];
const DEFAULT_FEED_LENGTH = 240;
const DEFAULT_MIX_PERCENT = 20;
const GOLDEN_FEED_SEED = 0x7f4a7c15;

function xorshift32(state) {
  let x = state >>> 0;
  x ^= (x << 13) >>> 0;
  x ^= x >>> 17;
  x ^= (x << 5) >>> 0;
  return x >>> 0;
}

export function normalizeSeed(seed) {
  const asBigInt = BigInt(seed ?? 0);
  const normalized = Number(asBigInt & 0xffffffffn) >>> 0;
  return normalized === 0 ? GOLDEN_FEED_SEED : normalized;
}

function buildBaseCombos(lockPhilId, lockPaletteVariant) {
  const phils = Number.isInteger(lockPhilId) ? [lockPhilId] : PHIL_IDS;
  const palettes = Number.isInteger(lockPaletteVariant) ? [lockPaletteVariant] : PALETTE_VARIANTS;
  const out = [];
  for (const philId of phils) {
    for (const paletteVariant of palettes) {
      out.push({ philId, paletteVariant });
    }
  }
  return out;
}

function shuffleDeterministic(items, startSeed) {
  const out = items.slice();
  let state = startSeed >>> 0;
  for (let i = out.length - 1; i > 0; i -= 1) {
    state = xorshift32(state);
    const j = state % (i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return { shuffled: out, state };
}

function nextMix(state, mixPercent) {
  let next = xorshift32(state);
  const shouldMix = (next % 100) < mixPercent;
  if (!shouldMix) {
    return { state: next, mixMode: 0, mixSeed: 0 };
  }
  next = xorshift32(next);
  const mixMode = (next % 2) + 1;
  next = xorshift32(next);
  const mixSeed = next >>> 0;
  return { state: next, mixMode, mixSeed };
}

function mixLabel(mixMode, mixSeed) {
  if (mixMode === 0) return 'none';
  if (mixMode === 1) return `swap:${mixSeed}`;
  return `permute:${mixSeed}`;
}

/**
 * Deterministic Avastars-style feed generator.
 * Same inputs always return the same sequence.
 */
export function buildFeedSequence({
  feedSeed,
  lockPhilId = null,
  lockPaletteVariant = null,
  length = DEFAULT_FEED_LENGTH,
  mixPercent = DEFAULT_MIX_PERCENT,
}) {
  if (!Number.isInteger(length) || length < 1) {
    throw new Error(`length must be >= 1, got ${length}`);
  }
  if (!Number.isInteger(mixPercent) || mixPercent < 0 || mixPercent > 100) {
    throw new Error(`mixPercent must be in [0,100], got ${mixPercent}`);
  }
  if (lockPhilId != null && (!Number.isInteger(lockPhilId) || lockPhilId < 0 || lockPhilId > 5)) {
    throw new Error(`lockPhilId must be null or 0..5, got ${lockPhilId}`);
  }
  if (
    lockPaletteVariant != null
    && (!Number.isInteger(lockPaletteVariant) || lockPaletteVariant < 0 || lockPaletteVariant > 8)
  ) {
    throw new Error(`lockPaletteVariant must be null or 0..8, got ${lockPaletteVariant}`);
  }

  const seed = normalizeSeed(feedSeed);
  const baseCombos = buildBaseCombos(lockPhilId, lockPaletteVariant);
  const { shuffled, state: shuffledState } = shuffleDeterministic(baseCombos, seed);

  let state = shuffledState;
  const items = [];
  for (let i = 0; i < length; i += 1) {
    const base = shuffled[i % shuffled.length];
    const mix = nextMix(state, mixPercent);
    state = mix.state;
    items.push({
      index: i,
      key: `${seed}:${i}`,
      philId: base.philId,
      paletteVariant: base.paletteVariant,
      mixMode: mix.mixMode,
      mixSeed: mix.mixSeed,
      label: `Phil ${base.philId} · Palette ${base.paletteVariant} · Mix ${mixLabel(mix.mixMode, mix.mixSeed)}`,
    });
  }

  return {
    seed,
    length,
    mixPercent,
    baseComboCount: baseCombos.length,
    items,
  };
}

function lcg32(seed) {
  return (Math.imul(seed >>> 0, 1664525) + 1013904223) >>> 0;
}

function deterministicPreviewSeed(index) {
  const seeded = lcg32(normalizeSeed(GOLDEN_FEED_SEED ^ Number(index)));
  return seeded === 0 ? GOLDEN_FEED_SEED : seeded;
}

export function buildScrollPreviewFeed({ startIndex = 0, length = DEFAULT_FEED_LENGTH }) {
  if (!Number.isInteger(startIndex) || startIndex < 0) {
    throw new Error(`startIndex must be >= 0, got ${startIndex}`);
  }
  if (!Number.isInteger(length) || length < 1) {
    throw new Error(`length must be >= 1, got ${length}`);
  }

  const perCycle = PHIL_IDS.length * PALETTE_VARIANTS.length * MIX_MODES.length;
  const items = [];

  for (let i = 0; i < length; i += 1) {
    const absoluteIndex = startIndex + i;
    const cycleIndex = absoluteIndex % perCycle;
    const philId = PHIL_IDS[Math.floor(cycleIndex / (PALETTE_VARIANTS.length * MIX_MODES.length))];
    const paletteVariant = PALETTE_VARIANTS[
      Math.floor(cycleIndex / MIX_MODES.length) % PALETTE_VARIANTS.length
    ];
    const mixMode = MIX_MODES[cycleIndex % MIX_MODES.length];
    const mixSeed = deterministicPreviewSeed(absoluteIndex + 1);

    items.push({
      index: absoluteIndex,
      key: `scroll-preview:${absoluteIndex}`,
      philId,
      paletteVariant,
      mixMode,
      mixSeed,
      label: `Phil ${philId} · Palette ${paletteVariant} · Mix ${mixMode} · Seed ${mixSeed}`,
    });
  }

  return {
    startIndex,
    length,
    items,
  };
}

export const FEED_DEFAULTS = {
  length: DEFAULT_FEED_LENGTH,
  mixPercent: DEFAULT_MIX_PERCENT,
};
