import fs from 'node:fs';
import path from 'node:path';
import { ethers } from 'ethers';

function normalizeAddress(value) {
  return ethers.getAddress(value).toLowerCase();
}

function normalizeDropId(value) {
  return BigInt(value).toString(10);
}

function normalizeCount(value, fallback = 0) {
  if (value == null) return fallback;
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < 0) {
    throw new Error(`Invalid allowlist count: ${value}`);
  }
  return Math.trunc(numeric);
}

function normalizeRawDrop(rawDrop) {
  if (!rawDrop) return {};

  if (Array.isArray(rawDrop)) {
    return Object.fromEntries(
      rawDrop
        .map((entry) => normalizeAddress(String(entry)))
        .sort()
        .map((address) => [address, { remaining: 1, consumed: 0 }])
    );
  }

  const entries = new Map();
  for (const [rawAddress, rawValue] of Object.entries(rawDrop)) {
    const address = normalizeAddress(rawAddress);
    if (typeof rawValue === 'number') {
      entries.set(address, { remaining: normalizeCount(rawValue), consumed: 0 });
      continue;
    }
    entries.set(address, {
      remaining: normalizeCount(rawValue?.remaining, 0),
      consumed: normalizeCount(rawValue?.consumed, 0),
    });
  }

  return Object.fromEntries([...entries.entries()].sort(([a], [b]) => a.localeCompare(b)));
}

function normalizeStore(raw, dropId) {
  if (Array.isArray(raw)) {
    return {
      version: 1,
      format: 'flat',
      drops: {
        [dropId]: normalizeRawDrop(raw),
      },
    };
  }

  if (raw && typeof raw === 'object' && !('drops' in raw)) {
    return {
      version: 1,
      format: 'flat',
      drops: {
        [dropId]: normalizeRawDrop(raw),
      },
    };
  }

  const rawDrops = raw?.drops && typeof raw.drops === 'object' ? raw.drops : {};
  const drops = Object.fromEntries(
    Object.entries(rawDrops).map(([rawDropId, rawDrop]) => [
      normalizeDropId(rawDropId),
      normalizeRawDrop(rawDrop),
    ])
  );

  if (!drops[dropId]) {
    drops[dropId] = {};
  }

  return {
    version: 1,
    format: 'drops',
    drops,
  };
}

export function requireAllowlistPath() {
  const filePath = (process.env.ALLOWLIST_PATH || '').trim();
  if (!filePath) {
    throw new Error('Set ALLOWLIST_PATH before running this script.');
  }
  return path.resolve(filePath);
}

export function loadAllowlistStore(filePath, dropId) {
  const normalizedDropId = normalizeDropId(dropId);
  if (!fs.existsSync(filePath)) {
    return normalizeStore({}, normalizedDropId);
  }

  const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  return normalizeStore(parsed, normalizedDropId);
}

export function writeAllowlistStore(filePath, store) {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  const tempPath = path.join(dir, `${path.basename(filePath)}.${process.pid}.${Date.now()}.tmp`);
  const serializedBody = store.format === 'flat'
    ? store.drops[Object.keys(store.drops)[0]] || {}
    : {
        version: 1,
        drops: store.drops,
      };
  const serialized = `${JSON.stringify(serializedBody, null, 2)}\n`;
  fs.writeFileSync(tempPath, serialized, 'utf8');
  fs.renameSync(tempPath, filePath);
}

export function getDropEntries(store, dropId) {
  const normalizedDropId = normalizeDropId(dropId);
  if (!store.drops[normalizedDropId]) {
    store.drops[normalizedDropId] = {};
  }
  return store.drops[normalizedDropId];
}

export function normalizeInputAddress(value) {
  return normalizeAddress(value);
}

export function normalizeInputDropId(value) {
  return normalizeDropId(value);
}
