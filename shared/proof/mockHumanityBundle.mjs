import { ethers } from 'ethers';
import { hash } from 'starknet';

import {
  HUMANITY_PROVIDER_MOCK,
  computeCredentialCommitment,
} from './localStarkProver.mjs';

function pedersen(a, b) {
  return BigInt(hash.computePedersenHash(a.toString(), b.toString()));
}

export function normalizeMockHumanId(mockHumanId) {
  const normalized = String(mockHumanId || '').trim().toLowerCase();
  if (!normalized) {
    throw new Error('mockHumanId is required');
  }
  return normalized;
}

export function hashMockHumanId(mockHumanId) {
  const normalized = normalizeMockHumanId(mockHumanId);
  const digest = ethers.keccak256(
    ethers.AbiCoder.defaultAbiCoder().encode(['string'], [normalized])
  );
  return BigInt(digest) >> 8n;
}

export function deriveHumanitySecret({
  seed = 'zkphil-mock-humanity',
  mockHumanId,
}) {
  const normalized = normalizeMockHumanId(mockHumanId);
  const digest = ethers.keccak256(
    ethers.AbiCoder.defaultAbiCoder().encode(['string', 'string'], [seed, normalized])
  );
  return BigInt(digest) >> 8n;
}

function buildPedersenMerkleTree(entries) {
  if (!Array.isArray(entries) || entries.length === 0) {
    throw new Error('entries must be a non-empty array');
  }

  const normalizedEntries = entries.map((entry, index) => {
    const mockHumanId = normalizeMockHumanId(entry.mockHumanId || entry.id || entry.label || `human-${index}`);
    const mockHumanIdHash = entry.mockHumanIdHash != null
      ? BigInt(entry.mockHumanIdHash)
      : hashMockHumanId(mockHumanId);
    const secret = entry.secret != null
      ? BigInt(entry.secret)
      : deriveHumanitySecret({ seed: entry.seed, mockHumanId });
    const humanityCommitment = computeCredentialCommitment({
      secret,
      subject: mockHumanIdHash,
      providerMode: HUMANITY_PROVIDER_MOCK,
    });
    return {
      mockHumanId,
      label: String(entry.label || mockHumanId),
      mockHumanIdHash,
      secret,
      humanityCommitment,
    };
  });

  const layers = [normalizedEntries.map((entry) => entry.humanityCommitment)];
  while (layers[layers.length - 1].length > 1) {
    const prev = layers[layers.length - 1];
    const next = [];
    for (let i = 0; i < prev.length; i += 2) {
      const left = prev[i];
      const right = prev[i + 1] ?? prev[i];
      next.push(pedersen(left, right));
    }
    layers.push(next);
  }

  const root = layers[layers.length - 1][0];

  function getProof(index) {
    const siblings = [];
    const pathIndices = [];
    let cursor = index;
    for (let level = 0; level < layers.length - 1; level += 1) {
      const layer = layers[level];
      const siblingIndex = cursor ^ 1;
      siblings.push(layer[siblingIndex] ?? layer[cursor]);
      pathIndices.push(cursor % 2);
      cursor = Math.floor(cursor / 2);
    }
    return { siblings, pathIndices };
  }

  return {
    root,
    entries: normalizedEntries.map((entry, index) => ({
      ...entry,
      index,
      proof: getProof(index),
    })),
  };
}

export function buildMockHumanityBundle({
  proofContext,
  contextId,
  humans,
  seed,
}) {
  const resolvedProofContext = proofContext ?? contextId;
  if (resolvedProofContext == null) {
    throw new Error('proofContext is required when building a mock-humanity bundle');
  }

  const ordered = [...humans]
    .map((entry, index) => ({
      mockHumanId: normalizeMockHumanId(entry.mockHumanId || entry.id || `human-${index}`),
      label: String(entry.label || entry.mockHumanId || entry.id || `Human ${index + 1}`),
      secret: entry.secret != null ? BigInt(entry.secret) : undefined,
      seed: entry.seed || seed,
    }))
    .sort((a, b) => a.mockHumanId.localeCompare(b.mockHumanId));

  const tree = buildPedersenMerkleTree(ordered);
  const mockHumansById = {};
  for (const entry of tree.entries) {
    mockHumansById[entry.mockHumanId] = {
      mockHumanId: entry.mockHumanId,
      label: entry.label,
      mockHumanIdHash: entry.mockHumanIdHash.toString(),
      humanitySecret: entry.secret.toString(),
      humanityCommitment: entry.humanityCommitment.toString(),
      index: entry.index,
      siblings: entry.proof.siblings.map((value) => value.toString()),
      pathIndices: entry.proof.pathIndices,
    };
  }

  return {
    schema: 'zkphil-mock-humanity-bundle-v1',
    provider: HUMANITY_PROVIDER_MOCK,
    generatedAt: new Date().toISOString(),
    proofContext: BigInt(resolvedProofContext).toString(),
    verifierConfigHash: tree.root.toString(),
    mockHumansById,
    mockHumanIds: Object.keys(mockHumansById),
  };
}

export function getMockHumanIds(bundle) {
  return Array.isArray(bundle?.mockHumanIds)
    ? bundle.mockHumanIds.map((value) => normalizeMockHumanId(value))
    : Object.keys(bundle?.mockHumansById || {}).map((value) => normalizeMockHumanId(value));
}

export function getMockHuman(bundle, mockHumanId) {
  const normalized = normalizeMockHumanId(mockHumanId);
  return bundle?.mockHumansById?.[normalized] || null;
}
