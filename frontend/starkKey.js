/**
 * STARK Key Management for Phil 2FA
 *
 * Generates, stores, and uses STARK key pairs for the 2-of-2
 * multi-sig Smart Account. The STARK key is the second signer
 * (2FA) alongside the EOA wallet.
 *
 * Uses starknet.js ec.starkCurve for key generation and signing.
 */

const STORAGE_KEY = "phil_stark_keypair";

// STARK field prime
const STARK_PRIME =
  0x800000000000011000000000000000000000000000000000000000000000001n;

/**
 * Dynamically load starknet.js
 * Supports both CDN and local import
 */
let _starkCurve = null;
async function getStarkCurve() {
  if (_starkCurve) return _starkCurve;

  try {
    // Try local import first (Node.js / bundler)
    const starknet = await import("starknet");
    _starkCurve = starknet.ec.starkCurve;
    return _starkCurve;
  } catch {
    // Fallback: CDN import
    try {
      const starknet = await import(
        "https://cdn.jsdelivr.net/npm/starknet@6.0.0/dist/index.mjs"
      );
      _starkCurve = starknet.ec.starkCurve;
      return _starkCurve;
    } catch (e) {
      throw new Error(
        "Failed to load starknet.js. Ensure it is available as a dependency."
      );
    }
  }
}

function bytesLikeToHex(value) {
  if (typeof value === "string") {
    return value.startsWith("0x") ? value : `0x${value}`;
  }
  if (value instanceof Uint8Array || Array.isArray(value)) {
    return "0x" + Array.from(value, (b) => Number(b).toString(16).padStart(2, "0")).join("");
  }
  throw new Error("Unsupported bytes-like value");
}

/**
 * Generate a new STARK key pair
 * @returns {{ privateKey: string, publicKey: string, fullPublicKey: string }} Hex-encoded key pair
 */
export async function generateStarkKeyPair() {
  const curve = await getStarkCurve();
  const privateKey = curve.utils.randomPrivateKey();
  const privateKeyHex = bytesLikeToHex(privateKey);
  const publicKey = curve.getStarkKey(privateKeyHex);       // X-coordinate only (for on-chain storage)
  const fullPublicKey = curve.getPublicKey(privateKeyHex);   // Full 65-byte uncompressed key (for verification)
  const fullPublicKeyHex = bytesLikeToHex(fullPublicKey);
  return {
    privateKey: privateKeyHex,
    publicKey: publicKey,              // X-coordinate (starkPubKeyX)
    fullPublicKey: fullPublicKeyHex,   // Full public key for STARK sig verification
  };
}

/**
 * Get or create a STARK key pair, persisting in localStorage
 * @returns {{ privateKey: string, publicKey: string }}
 */
export async function getOrCreateStarkKeyPair() {
  // Check localStorage
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored) {
    try {
      const parsed = JSON.parse(stored);
      if (parsed.privateKey && parsed.publicKey) {
        return parsed;
      }
    } catch {
      // Invalid stored data, regenerate
    }
  }

  // Generate new key pair
  const keyPair = await generateStarkKeyPair();

  // Persist
  localStorage.setItem(STORAGE_KEY, JSON.stringify(keyPair));

  return keyPair;
}

/**
 * Get the stored STARK key pair (without creating)
 * @returns {{ privateKey: string, publicKey: string } | null}
 */
export function getStoredStarkKeyPair() {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (!stored) return null;
  try {
    const parsed = JSON.parse(stored);
    if (parsed.privateKey && parsed.publicKey) return parsed;
    return null;
  } catch {
    return null;
  }
}

/**
 * Sign a message hash with the STARK private key
 * @param {string} privateKey - Hex-encoded STARK private key
 * @param {string} messageHash - bytes32 hex hash to sign
 * @returns {Promise<{ r: string, s: string }>} Hex-encoded signature components
 */
export async function signWithStarkKey(privateKey, messageHash) {
  const curve = await getStarkCurve();

  // Reduce to STARK field
  const msgHashBn = BigInt(messageHash) % STARK_PRIME;
  const msgHashHex = "0x" + msgHashBn.toString(16);

  // Sign
  const sig = curve.sign(msgHashHex, privateKey);

  return {
    r: "0x" + sig.r.toString(16).padStart(64, "0"),
    s: "0x" + sig.s.toString(16).padStart(64, "0"),
  };
}

/**
 * Clear the stored STARK key pair
 */
export function clearStarkKeyPair() {
  localStorage.removeItem(STORAGE_KEY);
}

/**
 * Check if a STARK key pair exists in storage
 * @returns {boolean}
 */
export function hasStarkKeyPair() {
  return getStoredStarkKeyPair() !== null;
}

/**
 * Export the STARK key pair for backup (user should save this securely)
 * @returns {string} JSON string of the key pair
 */
export function exportStarkKeyPair() {
  const keyPair = getStoredStarkKeyPair();
  if (!keyPair) throw new Error("No STARK key pair found");
  return JSON.stringify(keyPair, null, 2);
}

/**
 * Import a STARK key pair from backup
 * @param {string} json - JSON string of the key pair
 */
export function importStarkKeyPair(json) {
  const parsed = JSON.parse(json);
  if (!parsed.privateKey || !parsed.publicKey) {
    throw new Error("Invalid key pair format");
  }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(parsed));
}
