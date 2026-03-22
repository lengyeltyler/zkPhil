import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { ethers } from 'ethers';

import { normalizeStarknetFelt, parseStarknetFelt } from './starknetFelt.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, '..', '..');
const DEFAULT_NETWORK = 'sepolia';

export const STARKNET_APP_BINDINGS_SCHEMA = 'zkphil-starknet-app-bindings-v1';
export const STARKNET_UNLOCK_PAYLOAD_VERSION = 'zkphil-unlock-ticket-v1';
export const STARKNET_UNLOCK_HASH_ENCODING = 'bytes32-hi-lo-128';

function readJson(filePath) {
  if (!fs.existsSync(filePath)) {
    return null;
  }
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function normalizeAddress(value) {
  const trimmed = String(value || '').trim();
  if (!trimmed) {
    return '';
  }
  try {
    return ethers.getAddress(trimmed);
  } catch {
    return trimmed;
  }
}

function normalizeOptionalString(value) {
  return String(value || '').trim();
}

function analyzeBindings(rawManifest, manifestPath) {
  if (!rawManifest || typeof rawManifest !== 'object') {
    return {
      exists: false,
      manifestPath,
      schema: '',
      starknetNetwork: DEFAULT_NETWORK,
      l1ChainId: 11155111,
      generatedAt: '',
      sourceScript: '',
      contracts: {
        unlockSender: '',
        owner: '',
      },
      bindings: {
        l1Recipient: '',
        payloadVersion: STARKNET_UNLOCK_PAYLOAD_VERSION,
        constraintsHashEncoding: STARKNET_UNLOCK_HASH_ENCODING,
      },
      classification: 'missing',
      blockers: [`Manifest is missing at ${manifestPath}.`],
      raw: null,
    };
  }

  const unlockSender = normalizeStarknetFelt(
    rawManifest.contracts?.unlockSender ||
    rawManifest.contracts?.l2UnlockSender ||
    rawManifest.unlockSender ||
    rawManifest.l2UnlockSender,
    { allowZero: false }
  );
  const owner = normalizeStarknetFelt(
    rawManifest.contracts?.owner ||
    rawManifest.owner,
    { allowZero: false }
  );
  const l1Recipient = normalizeAddress(
    rawManifest.bindings?.l1Recipient ||
    rawManifest.l1Recipient
  );
  const payloadVersion = normalizeOptionalString(
    rawManifest.bindings?.payloadVersion ||
    rawManifest.payloadVersion ||
    STARKNET_UNLOCK_PAYLOAD_VERSION
  );
  const constraintsHashEncoding = normalizeOptionalString(
    rawManifest.bindings?.constraintsHashEncoding ||
    rawManifest.constraintsHashEncoding ||
    STARKNET_UNLOCK_HASH_ENCODING
  );

  const blockers = [];
  if (!unlockSender) {
    blockers.push('Missing Starknet unlock sender felt.');
  }
  if (!l1Recipient) {
    blockers.push('Missing L1 unlock inbox recipient binding.');
  } else {
    try {
      ethers.getAddress(l1Recipient);
    } catch {
      blockers.push('L1 unlock inbox recipient is not a valid Ethereum address.');
    }
  }
  if (payloadVersion !== STARKNET_UNLOCK_PAYLOAD_VERSION) {
    blockers.push(
      `Unexpected payloadVersion ${payloadVersion || '(empty)'}. Expected ${STARKNET_UNLOCK_PAYLOAD_VERSION}.`
    );
  }
  if (constraintsHashEncoding !== STARKNET_UNLOCK_HASH_ENCODING) {
    blockers.push(
      `Unexpected constraintsHashEncoding ${constraintsHashEncoding || '(empty)'}. Expected ${STARKNET_UNLOCK_HASH_ENCODING}.`
    );
  }

  return {
    exists: true,
    manifestPath,
    schema: String(rawManifest.schema || ''),
    starknetNetwork: String(rawManifest.starknetNetwork || rawManifest.network || DEFAULT_NETWORK),
    l1ChainId: Number(rawManifest.l1ChainId || 11155111),
    generatedAt: String(rawManifest.generatedAt || ''),
    sourceScript: String(rawManifest.sourceScript || ''),
    contracts: {
      unlockSender,
      owner,
    },
    bindings: {
      l1Recipient,
      payloadVersion,
      constraintsHashEncoding,
    },
    classification: blockers.length === 0 ? 'complete' : 'partial',
    blockers,
    raw: rawManifest,
  };
}

export function getStarknetAppBindingsManifestPath(
  l1ChainId = 11155111,
  rootDir = ROOT_DIR
) {
  if (Number(l1ChainId) !== 11155111) {
    return '';
  }
  return path.join(rootDir, 'config', 'starknet-app-bindings', 'sepolia.json');
}

export function readStarknetAppBindings({ l1ChainId = 11155111, rootDir = ROOT_DIR } = {}) {
  const manifestPath = getStarknetAppBindingsManifestPath(l1ChainId, rootDir);
  if (!manifestPath) {
    return analyzeBindings(null, manifestPath);
  }
  return analyzeBindings(readJson(manifestPath), manifestPath);
}

export async function inspectStarknetAppBindings(provider, bindings) {
  if (!bindings?.exists || !bindings.contracts.unlockSender) {
    return {
      ok: false,
      missing: ['unlockSender'],
    };
  }

  try {
    const classHash = await provider.getClassHashAt(bindings.contracts.unlockSender);
    return {
      ok: Boolean(classHash),
      classHash,
      missing: classHash ? [] : ['classHash'],
    };
  } catch (error) {
    return {
      ok: false,
      classHash: '',
      missing: [
        error instanceof Error ? error.message : String(error),
      ],
    };
  }
}

export function writeStarknetAppBindings({
  l1ChainId = 11155111,
  rootDir = ROOT_DIR,
  starknetNetwork = DEFAULT_NETWORK,
  generatedAt = new Date().toISOString(),
  sourceScript = '',
  unlockSender = '',
  owner = '',
  l1Recipient = '',
  notes = [],
} = {}) {
  const manifestPath = getStarknetAppBindingsManifestPath(l1ChainId, rootDir);
  if (!manifestPath) {
    throw new Error(`Unsupported L1 chain for Starknet app bindings: ${l1ChainId}`);
  }

  const payload = {
    schema: STARKNET_APP_BINDINGS_SCHEMA,
    deploymentType: 'starknet-app-binding',
    starknetNetwork,
    l1ChainId: Number(l1ChainId),
    generatedAt,
    sourceScript,
    contracts: {
      unlockSender: normalizeStarknetFelt(unlockSender, { allowZero: false }),
      owner: normalizeStarknetFelt(owner, { allowZero: false }),
    },
    bindings: {
      l1Recipient: normalizeAddress(l1Recipient),
      payloadVersion: STARKNET_UNLOCK_PAYLOAD_VERSION,
      constraintsHashEncoding: STARKNET_UNLOCK_HASH_ENCODING,
    },
    notes: Array.isArray(notes) ? notes : [],
  };

  const analyzed = analyzeBindings(payload, manifestPath);
  payload.status = {
    classification: analyzed.classification,
    blockers: analyzed.blockers,
  };

  fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
  fs.writeFileSync(manifestPath, JSON.stringify(payload, null, 2));

  return {
    manifestPath,
    payload,
  };
}

export function resolveUnlockSenderSource({
  envSender = '',
  envLegacyAlias = '',
  aaManifestSender = '',
  starknetAppSender = '',
  aaManifestPath = '',
  starknetAppManifestPath = '',
} = {}) {
  function tryResolve(value, source, label) {
    try {
      const parsed = parseStarknetFelt(value, { allowZero: false });
      if (parsed == null) {
        return null;
      }
      return {
        value: `0x${parsed.toString(16)}`,
        source,
        error: '',
      };
    } catch (error) {
      return {
        value: '',
        source,
        error: `${label}: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  const explicitSender = tryResolve(envSender, 'env:L2_UNLOCK_SENDER', 'L2_UNLOCK_SENDER');
  if (explicitSender != null) {
    return explicitSender;
  }

  const legacySender = tryResolve(
    envLegacyAlias,
    'env:L2_UNLOCK_VERIFIER',
    'L2_UNLOCK_VERIFIER'
  );
  if (legacySender != null) {
    return legacySender;
  }

  const manifestSender = tryResolve(
    aaManifestSender,
    `manifest:${aaManifestPath}#config.l2UnlockSender`,
    'config.l2UnlockSender'
  );
  if (manifestSender != null) {
    return manifestSender;
  }

  const bindingSender = tryResolve(
    starknetAppSender,
    `manifest:${starknetAppManifestPath}#contracts.unlockSender`,
    'contracts.unlockSender'
  );
  if (bindingSender != null) {
    return bindingSender;
  }

  return {
    value: '',
    source: 'missing',
    error: '',
  };
}
