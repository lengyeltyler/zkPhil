import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import paletteSpec from './phil-palettes-v2.json' with { type: 'json' };

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, '..', '..');
const LAYERS_DIR = path.join(ROOT_DIR, 'Layers');

const PHIL_COUNT = 6;
const PALETTE_VARIANT_COUNT = 9;
const MIX_MODE_NONE = 0;
const MIX_MODE_SWAP = 1;
const MIX_MODE_PERMUTE = 2;
const GOLDEN_MIX_SEED = 0x9e3779b9;
const SLOT_COUNT = 11;

const SVG_OPEN = '<svg xmlns="http://www.w3.org/2000/svg" width="420" height="420" viewBox="0 0 420 420">';
const SVG_CLOSE = '</svg>';

const HEX_LOOKUP = new Set(['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', 'a', 'b', 'c', 'd', 'e', 'f']);

const SLOT_LAYOUT = [
  { index: 0, key: 'BgColor' },
  { index: 1, key: 'BgNebula' },
  { index: 2, key: 'BgStars' },
  { index: 3, key: 'BgDust' },
  { index: 4, key: 'Body' },
  { index: 5, key: 'BodyShapes' },
  { index: 6, key: 'Eyes' },
  { index: 7, key: 'JawLine' },
  { index: 8, key: 'Spikes' },
  { index: 9, key: 'Teeth' },
  { index: 10, key: 'Top' },
];

const DSL_V2_VERSION = 0x02;
const DSL_V2_OP_LITERAL = 0x10;
const DSL_V2_OP_DICT = 0x11;

const DSL_V2_DICTIONARY = [
  ' isolation="isolate"',
  ' stop-opacity="',
  ' gradientUnits="userSpaceOnUse"',
  ' gradientTransform="',
  ' transform="translate(',
  ' fill="#ffffff"',
  ' fill="#000000"',
  '<radialGradient ',
  '<linearGradient ',
  '<pattern ',
  '<ellipse cx="',
  '<circle cx="',
  '<path d="',
  '<rect ',
  '<stop offset="',
  ' opacity="',
  ' stroke="#',
  ' fill="url(#',
  ' stop-color="#',
  ' stroke-width="',
  ' xlink:href="#',
  ' href="#',
  ' fill="#',
  ' cx="',
  ' cy="',
  ' rx="',
  ' ry="',
  ' r="',
  ' x="',
  ' y="',
  ' width="',
  ' height="',
  ' id="',
  ' url(#',
  '"/>',
  '" />',
  '"',
  '</g>',
  '<g ',
  '<defs>',
  '</defs>',
  '<g>',
  '/>',
];

const DSL_V2_INDEX = DSL_V2_DICTIONARY
  .map((value, index) => ({ index, value }))
  .sort((a, b) => b.value.length - a.value.length);

const CANONICAL_SVGS = Array.from({ length: PHIL_COUNT }, (_, philId) =>
  fs.readFileSync(path.join(LAYERS_DIR, `Phil${philId}.svg`), 'utf8')
);

function assertPhilId(philId) {
  if (!Number.isInteger(philId) || philId < 0 || philId >= PHIL_COUNT) {
    throw new Error(`Invalid philId \`${philId}\`. Expected integer in [0, ${PHIL_COUNT - 1}].`);
  }
}

function assertPaletteVariant(paletteVariant) {
  if (!Number.isInteger(paletteVariant) || paletteVariant < 0 || paletteVariant >= PALETTE_VARIANT_COUNT) {
    throw new Error(`Invalid paletteVariant \`${paletteVariant}\`. Expected integer in [0, ${PALETTE_VARIANT_COUNT - 1}].`);
  }
}

function assertMixMode(mixMode) {
  if (!Number.isInteger(mixMode) || mixMode < 0 || mixMode > MIX_MODE_PERMUTE) {
    throw new Error(`Invalid mixMode \`${mixMode}\`. Expected integer in [0, ${MIX_MODE_PERMUTE}].`);
  }
}

function normalizeMixSeed(mixSeed) {
  const value = Number(BigInt(mixSeed ?? 0) & 0xffffffffn);
  return value === 0 ? GOLDEN_MIX_SEED : value >>> 0;
}

function xorshift32(state) {
  let x = state >>> 0;
  x ^= (x << 13) >>> 0;
  x ^= x >>> 17;
  x ^= (x << 5) >>> 0;
  return x >>> 0;
}

function normalizeHexToken(token) {
  if (!token.startsWith('#')) {
    return null;
  }
  const raw = token.slice(1).toLowerCase();
  if (raw.length === 3) {
    if (![...raw].every((ch) => HEX_LOOKUP.has(ch))) {
      return null;
    }
    return `#${raw[0]}${raw[0]}${raw[1]}${raw[1]}${raw[2]}${raw[2]}`;
  }
  if (raw.length === 6) {
    if (![...raw].every((ch) => HEX_LOOKUP.has(ch))) {
      return null;
    }
    return `#${raw}`;
  }
  return null;
}

function replaceHexColors(input, replacementMap) {
  if (Object.keys(replacementMap).length === 0) {
    return input;
  }

  let out = '';
  let i = 0;
  while (i < input.length) {
    const current = input[i];
    if (current !== '#') {
      out += current;
      i += 1;
      continue;
    }

    let j = i + 1;
    while (j < input.length && j - i <= 7) {
      const ch = input[j].toLowerCase();
      if (!HEX_LOOKUP.has(ch)) {
        break;
      }
      j += 1;
    }

    const token = input.slice(i, j);
    const normalized = normalizeHexToken(token);
    if (normalized && replacementMap[normalized]) {
      out += replacementMap[normalized];
      i = j;
      continue;
    }

    out += current;
    i += 1;
  }

  return out;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function stripSvgWrapper(svg) {
  if (!svg) return '';
  const withoutBom = svg.replace(/^\uFEFF/, '').trim();
  const withoutXml = withoutBom.replace(/^<\?xml[^>]*>\s*/i, '');
  const openMatch = withoutXml.match(/<svg\b[^>]*>/i);
  if (!openMatch) {
    return withoutXml.replace(/>\s+</g, '><').trim();
  }
  const openEnd = openMatch.index + openMatch[0].length;
  const closeIndex = withoutXml.toLowerCase().lastIndexOf('</svg>');
  if (closeIndex < 0 || closeIndex < openEnd) {
    return withoutXml.slice(openEnd).replace(/>\s+</g, '><').trim();
  }
  return withoutXml.slice(openEnd, closeIndex).replace(/>\s+</g, '><').trim();
}

function prefixSvgIds(svgInner, prefix) {
  if (!svgInner) return svgInner;

  const idRegex = /\bid="([^"]+)"/g;
  const ids = [];
  for (const match of svgInner.matchAll(idRegex)) {
    ids.push(match[1]);
  }
  if (ids.length === 0) {
    return svgInner;
  }

  let out = svgInner;
  for (const oldId of ids) {
    const newId = `${prefix}${oldId}`;
    const safeOld = escapeRegExp(oldId);
    out = out.replace(new RegExp(`\\bid="${safeOld}"`, 'g'), `id="${newId}"`);
    out = out.replace(new RegExp(`url\\(#${safeOld}\\)`, 'g'), `url(#${newId})`);
    out = out.replace(new RegExp(`xlink:href="#${safeOld}"`, 'g'), `xlink:href="#${newId}"`);
    out = out.replace(new RegExp(`href="#${safeOld}"`, 'g'), `href="#${newId}"`);
  }

  return out;
}

function tokenForSlot(slotIndex) {
  return `@${slotIndex.toString(16).toUpperCase().padStart(2, '0')}`;
}

function isHexChar(char) {
  return HEX_LOOKUP.has(char.toLowerCase());
}

function fromHexChar(char) {
  const value = char.toLowerCase();
  if (value >= '0' && value <= '9') return value.charCodeAt(0) - 48;
  return value.charCodeAt(0) - 87;
}

function applySlotColors(input, colorsBySlot) {
  let out = '';
  let i = 0;
  while (i < input.length) {
    if (input[i] !== '@' || i + 2 >= input.length) {
      out += input[i];
      i += 1;
      continue;
    }

    const c1 = input[i + 1];
    const c2 = input[i + 2];
    if (!isHexChar(c1) || !isHexChar(c2)) {
      out += input[i];
      i += 1;
      continue;
    }

    const slot = (fromHexChar(c1) << 4) | fromHexChar(c2);
    const color = colorsBySlot[slot];
    if (!color) {
      out += input[i];
      i += 1;
      continue;
    }

    out += color;
    i += 3;
  }

  return out;
}

function slotColorReplacementMap(philId) {
  const phil = paletteSpec.phils[String(philId)];
  if (!phil) {
    throw new Error(`Missing palette definition for philId=${philId}`);
  }
  const replacement = {};
  for (let i = 0; i < phil.mutableColors.length; i += 1) {
    replacement[phil.mutableColors[i]] = tokenForSlot(i);
  }
  return replacement;
}

function listFragmentFiles(philId) {
  const dir = path.join(LAYERS_DIR, `Phil${philId}`);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((name) => name.toLowerCase().endsWith('.svg'));
}

function resolveFragmentFilename(files, philId, slotKey) {
  const exact = `${slotKey}${philId}.svg`;
  if (files.includes(exact)) {
    return exact;
  }

  if (slotKey === 'BodyShapes') {
    const alt = `BodyShape${philId}.svg`;
    if (files.includes(alt)) {
      return alt;
    }
  }

  if (slotKey === 'BgNebula') {
    const prefix = `BgNebula${philId}`.toLowerCase();
    const candidates = files
      .filter((name) => name.toLowerCase().startsWith(prefix))
      .sort((a, b) => a.localeCompare(b));
    if (candidates.length > 0) {
      return candidates[0];
    }
  }

  return null;
}

function buildFragmentDataset() {
  const dataset = [];

  for (let philId = 0; philId < PHIL_COUNT; philId += 1) {
    const files = listFragmentFiles(philId);
    const colorMap = slotColorReplacementMap(philId);
    const entries = [];

    for (const slot of SLOT_LAYOUT) {
      const filename = resolveFragmentFilename(files, philId, slot.key);
      if (!filename) {
        entries.push({
          philId,
          slotIndex: slot.index,
          slotKey: slot.key,
          file: null,
          content: '',
        });
        continue;
      }

      const filePath = path.join(LAYERS_DIR, `Phil${philId}`, filename);
      const raw = fs.readFileSync(filePath, 'utf8');
      const inner = stripSvgWrapper(raw);
      const tokenized = replaceHexColors(inner, colorMap);

      entries.push({
        philId,
        slotIndex: slot.index,
        slotKey: slot.key,
        file: path.relative(ROOT_DIR, filePath),
        content: tokenized,
      });
    }

    dataset.push(entries);
  }

  return dataset;
}

const FRAGMENT_DATASET = buildFragmentDataset();

function buildPhilTemplate(philId) {
  const entries = FRAGMENT_DATASET[philId];
  let out = SVG_OPEN;
  for (const entry of entries) {
    out += entry.content;
  }
  out += SVG_CLOSE;
  return out;
}

const PHIL_TEMPLATES = Array.from({ length: PHIL_COUNT }, (_, philId) => buildPhilTemplate(philId));

export function buildMixedSlotOrder(slotCount, mixSeed, mixMode) {
  if (!Number.isInteger(slotCount) || slotCount < 0) {
    throw new Error(`Invalid slotCount \`${slotCount}\``);
  }
  assertMixMode(mixMode);

  const order = Array.from({ length: slotCount }, (_, i) => i);
  if (slotCount < 2 || mixMode === MIX_MODE_NONE) {
    return order;
  }

  let state = normalizeMixSeed(mixSeed);

  if (mixMode === MIX_MODE_SWAP) {
    state = xorshift32(state);
    const swaps = 1 + (state % 3);
    for (let i = 0; i < swaps; i += 1) {
      state = xorshift32(state);
      const a = state % slotCount;
      state = xorshift32(state);
      let b = state % slotCount;
      if (a === b) {
        b = (b + 1) % slotCount;
      }
      [order[a], order[b]] = [order[b], order[a]];
    }
    return order;
  }

  for (let i = slotCount - 1; i > 0; i -= 1) {
    state = xorshift32(state);
    const j = state % (i + 1);
    [order[i], order[j]] = [order[j], order[i]];
  }

  return order;
}

export function getPaletteMap(philId, paletteVariant, mixSeed = 0, mixMode = MIX_MODE_NONE) {
  assertPhilId(philId);
  assertPaletteVariant(paletteVariant);
  assertMixMode(mixMode);

  const phil = paletteSpec.phils[String(philId)];
  if (!phil) {
    throw new Error(`Missing palette definition for philId=${philId}`);
  }

  const mutableColors = phil.mutableColors;
  const variantColors = phil.variants[String(paletteVariant)];
  if (!Array.isArray(variantColors) || variantColors.length !== mutableColors.length) {
    throw new Error(`Missing palette variant ${paletteVariant} for philId=${philId}`);
  }

  const order = buildMixedSlotOrder(mutableColors.length, mixSeed, mixMode);
  const out = {};
  for (let i = 0; i < mutableColors.length; i += 1) {
    out[mutableColors[i]] = variantColors[order[i]];
  }
  return out;
}

function colorsBySlot(philId, paletteVariant, mixSeed, mixMode) {
  const phil = paletteSpec.phils[String(philId)];
  if (!phil) {
    throw new Error(`Missing palette definition for philId=${philId}`);
  }
  const variant = phil.variants[String(paletteVariant)];
  if (!Array.isArray(variant) || variant.length !== phil.mutableColors.length) {
    throw new Error(`Invalid variant palette for phil=${philId}, variant=${paletteVariant}`);
  }
  const order = buildMixedSlotOrder(phil.mutableColors.length, mixSeed, mixMode);
  const out = [];
  for (let i = 0; i < phil.mutableColors.length; i += 1) {
    out[i] = variant[order[i]];
  }
  return out;
}

export function renderPhil(philId, paletteVariant, mixSeed = 0, mixMode = MIX_MODE_NONE) {
  assertPhilId(philId);
  assertPaletteVariant(paletteVariant);
  assertMixMode(mixMode);

  const template = PHIL_TEMPLATES[philId];
  const colors = colorsBySlot(philId, paletteVariant, mixSeed, mixMode);
  return applySlotColors(template, colors);
}

export function getPaletteSpec() {
  return paletteSpec;
}

export function getBaseSvg(philId) {
  assertPhilId(philId);
  return CANONICAL_SVGS[philId];
}

export function getFragmentDataset() {
  return FRAGMENT_DATASET.map((entries) => entries.map((entry) => ({ ...entry })));
}

export function getPhilTemplate(philId) {
  assertPhilId(philId);
  return PHIL_TEMPLATES[philId];
}

function canonicalizeIds(svg) {
  return svg
    .replace(/\bid="[^"]*"/g, 'id="id"')
    .replace(/url\(#([^)]+)\)/g, 'url(#id)')
    .replace(/xlink:href="#[^"]+"/g, 'xlink:href="#id"')
    .replace(/href="#[^"]+"/g, 'href="#id"');
}

function normalizeHexColorsInSvg(svg) {
  let out = '';
  let i = 0;
  while (i < svg.length) {
    if (svg[i] !== '#') {
      out += svg[i];
      i += 1;
      continue;
    }

    let j = i + 1;
    while (j < svg.length && j - i <= 7) {
      if (!isHexChar(svg[j])) {
        break;
      }
      j += 1;
    }

    const token = svg.slice(i, j);
    const normalized = normalizeHexToken(token);
    if (normalized) {
      out += normalized;
      i = j;
      continue;
    }

    out += svg[i];
    i += 1;
  }

  return out;
}

export function normalizeSvgForComparison(svg) {
  const withoutXml = svg
    .replace(/^\uFEFF/, '')
    .replace(/^<\?xml[^>]*>\s*/i, '')
    .replace(/\r?\n/g, '')
    .replace(/>\s+</g, '><')
    .replace(/<svg\b[^>]*>/i, '<svg>')
    .trim();

  const normalized = normalizeHexColorsInSvg(canonicalizeIds(withoutXml))
    .replace(/^<svg>/i, '')
    .replace(/<\/svg>$/i, '')
    .replace(/<defs>/gi, '')
    .replace(/<\/defs>/gi, '')
    .replace(/<g\b[^>]*>/gi, '')
    .replace(/<\/g>/gi, '');

  const tokens = normalized
    .split(/></g)
    .map((token, index, arr) => {
      let out = token;
      if (index > 0) {
        out = `<${out}`;
      }
      if (index < arr.length - 1) {
        out = `${out}>`;
      }
      return out.trim();
    })
    .filter(Boolean)
    .sort();

  const uniqueTokens = [...new Set(tokens)].sort();
  return uniqueTokens.join('').toLowerCase();
}

export function buildTokenTemplate(philId) {
  assertPhilId(philId);
  return PHIL_TEMPLATES[philId];
}

function hexColorToBytes3(hexColor) {
  const normalized = normalizeHexToken(hexColor);
  if (!normalized) {
    throw new Error(`Invalid color token: ${hexColor}`);
  }
  const out = new Uint8Array(3);
  out[0] = Number.parseInt(normalized.slice(1, 3), 16);
  out[1] = Number.parseInt(normalized.slice(3, 5), 16);
  out[2] = Number.parseInt(normalized.slice(5, 7), 16);
  return out;
}

export function buildPackedPaletteBytes(philId) {
  assertPhilId(philId);
  const phil = paletteSpec.phils[String(philId)];
  if (!phil) {
    throw new Error(`Missing palette definition for philId=${philId}`);
  }
  const slotCount = phil.mutableColors.length;
  const out = new Uint8Array(slotCount * PALETTE_VARIANT_COUNT * 3);
  let offset = 0;

  for (let variant = 0; variant < PALETTE_VARIANT_COUNT; variant += 1) {
    const colors = phil.variants[String(variant)];
    if (!Array.isArray(colors) || colors.length !== slotCount) {
      throw new Error(`Invalid colors for phil=${philId}, variant=${variant}`);
    }
    for (const color of colors) {
      const b = hexColorToBytes3(color);
      out[offset++] = b[0];
      out[offset++] = b[1];
      out[offset++] = b[2];
    }
  }

  return out;
}

function pushLiteral(opcodes, literalParts) {
  if (literalParts.length === 0) {
    return;
  }
  const text = literalParts.join('');
  const bytes = Buffer.from(text, 'utf8');
  let offset = 0;
  while (offset < bytes.length) {
    const len = Math.min(0xffff, bytes.length - offset);
    opcodes.push({ op: DSL_V2_OP_LITERAL, data: bytes.subarray(offset, offset + len) });
    offset += len;
  }
  literalParts.length = 0;
}

function longestDictionaryMatch(input, index) {
  for (const entry of DSL_V2_INDEX) {
    if (entry.value.length < 4) {
      continue;
    }
    if (input.startsWith(entry.value, index)) {
      return entry;
    }
  }
  return null;
}

export function encodeDslV2(input) {
  const opcodes = [];
  const literalParts = [];

  let i = 0;
  while (i < input.length) {
    const match = longestDictionaryMatch(input, i);
    if (match) {
      pushLiteral(opcodes, literalParts);
      opcodes.push({ op: DSL_V2_OP_DICT, id: match.index });
      i += match.value.length;
      continue;
    }
    literalParts.push(input[i]);
    i += 1;
  }

  pushLiteral(opcodes, literalParts);

  const buffers = [];
  const header = Buffer.alloc(3);
  header.writeUInt8(DSL_V2_VERSION, 0);
  header.writeUInt16LE(opcodes.length, 1);
  buffers.push(header);

  for (const opcode of opcodes) {
    if (opcode.op === DSL_V2_OP_LITERAL) {
      const chunkHeader = Buffer.alloc(3);
      chunkHeader.writeUInt8(DSL_V2_OP_LITERAL, 0);
      chunkHeader.writeUInt16LE(opcode.data.length, 1);
      buffers.push(chunkHeader, Buffer.from(opcode.data));
      continue;
    }
    const token = Buffer.alloc(2);
    token.writeUInt8(DSL_V2_OP_DICT, 0);
    token.writeUInt8(opcode.id, 1);
    buffers.push(token);
  }

  return Buffer.concat(buffers);
}

export function decodeDslV2(bytesLike) {
  const bytes = Buffer.isBuffer(bytesLike) ? bytesLike : Buffer.from(bytesLike);
  if (bytes.length < 3) {
    throw new Error('DSL v2 payload too short');
  }
  const version = bytes.readUInt8(0);
  if (version !== DSL_V2_VERSION) {
    throw new Error(`Unsupported DSL version: ${version}`);
  }
  const opCount = bytes.readUInt16LE(1);
  let pos = 3;
  const parts = [];

  for (let i = 0; i < opCount; i += 1) {
    if (pos >= bytes.length) {
      throw new Error('Malformed DSL stream (unexpected EOF)');
    }
    const op = bytes.readUInt8(pos);
    pos += 1;

    if (op === DSL_V2_OP_LITERAL) {
      if (pos + 2 > bytes.length) {
        throw new Error('Malformed DSL stream (literal length out of bounds)');
      }
      const len = bytes.readUInt16LE(pos);
      pos += 2;
      if (pos + len > bytes.length) {
        throw new Error('Malformed DSL stream (literal payload out of bounds)');
      }
      parts.push(bytes.subarray(pos, pos + len).toString('utf8'));
      pos += len;
      continue;
    }

    if (op === DSL_V2_OP_DICT) {
      if (pos >= bytes.length) {
        throw new Error('Malformed DSL stream (dict id missing)');
      }
      const id = bytes.readUInt8(pos);
      pos += 1;
      const token = DSL_V2_DICTIONARY[id];
      if (token == null) {
        throw new Error(`Malformed DSL stream (unknown dictionary id ${id})`);
      }
      parts.push(token);
      continue;
    }

    throw new Error(`Unsupported DSL opcode: ${op}`);
  }

  return parts.join('');
}

export function buildOnchainRendererAssets() {
  const fragments = [];
  for (let philId = 0; philId < PHIL_COUNT; philId += 1) {
    for (const slot of SLOT_LAYOUT) {
      const entry = FRAGMENT_DATASET[philId][slot.index];
      const rawBytes = Buffer.from(entry.content, 'utf8');
      let encodedBytes = rawBytes;
      let isDsl = false;

      if (rawBytes.length > 0) {
        const dslBytes = encodeDslV2(entry.content);
        if (dslBytes.length + 3 < rawBytes.length) {
          encodedBytes = dslBytes;
          isDsl = true;
        }
      }

      fragments.push({
        ...entry,
        rawBytes: rawBytes.length,
        encodedBytes: encodedBytes.length,
        bytes: encodedBytes,
        isDsl,
      });
    }
  }

  const palettePackedByPhil = [];
  const paletteSlotCounts = [];
  for (let philId = 0; philId < PHIL_COUNT; philId += 1) {
    const phil = paletteSpec.phils[String(philId)];
    palettePackedByPhil.push(buildPackedPaletteBytes(philId));
    paletteSlotCounts.push(phil.mutableColors.length);
  }

  const totalRawFragmentBytes = fragments.reduce((sum, fragment) => sum + fragment.rawBytes, 0);
  const totalEncodedFragmentBytes = fragments.reduce((sum, fragment) => sum + fragment.encodedBytes, 0);

  return {
    philCount: PHIL_COUNT,
    slotLayout: SLOT_LAYOUT,
    slotCount: SLOT_COUNT,
    paletteVariantCount: PALETTE_VARIANT_COUNT,
    fragments,
    flattenedFragmentPayloads: fragments.map((fragment) => fragment.bytes),
    flattenedDslFlags: fragments.map((fragment) => (fragment.isDsl ? 1 : 0)),
    palettePackedByPhil,
    paletteSlotCounts,
    stats: {
      totalRawFragmentBytes,
      totalEncodedFragmentBytes,
      dslFragmentCount: fragments.filter((fragment) => fragment.isDsl).length,
      paletteBytes: palettePackedByPhil.reduce((sum, item) => sum + item.length, 0),
    },
  };
}

export const RENDERER_CONSTANTS = {
  PHIL_COUNT,
  SLOT_COUNT,
  PALETTE_VARIANT_COUNT,
  MIX_MODE_NONE,
  MIX_MODE_SWAP,
  MIX_MODE_PERMUTE,
};
