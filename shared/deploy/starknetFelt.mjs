const STARKNET_FIELD_PRIME_HEX =
  '0x800000000000011000000000000000000000000000000000000000000000001';

export const STARKNET_FIELD_PRIME = BigInt(STARKNET_FIELD_PRIME_HEX);

function looksLikePlaceholder(value) {
  const normalized = String(value || '').trim().toLowerCase();
  return (
    !normalized ||
    normalized.includes('your_') ||
    normalized.includes('placeholder') ||
    normalized.includes('example')
  );
}

export function parseStarknetFelt(value, { allowZero = true } = {}) {
  const raw = String(value || '').trim();
  if (!raw || looksLikePlaceholder(raw)) {
    return null;
  }

  let parsed;
  try {
    parsed = BigInt(raw);
  } catch {
    throw new Error(`Invalid Starknet felt: ${raw}`);
  }

  if (parsed < 0n) {
    throw new Error(`Starknet felt must be non-negative: ${raw}`);
  }
  if (!allowZero && parsed === 0n) {
    throw new Error(`Starknet felt must be non-zero: ${raw}`);
  }
  if (parsed >= STARKNET_FIELD_PRIME) {
    throw new Error(`Starknet felt exceeds the Starknet field prime: ${raw}`);
  }

  return parsed;
}

export function requireStarknetFelt(label, value, options = {}) {
  const parsed = parseStarknetFelt(value, options);
  if (parsed == null) {
    throw new Error(`${label} must be set to a Starknet felt.`);
  }
  return parsed;
}

export function isValidStarknetFelt(value, options = {}) {
  try {
    return parseStarknetFelt(value, options) != null;
  } catch {
    return false;
  }
}

export function normalizeStarknetFelt(value, options = {}) {
  const parsed = parseStarknetFelt(value, options);
  if (parsed == null) {
    return '';
  }
  return `0x${parsed.toString(16)}`;
}
