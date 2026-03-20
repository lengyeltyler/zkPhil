import { ethers } from 'ethers';
import { hash } from 'starknet';

import {
  ACTION_MINT,
  computeLeaf,
  computeNullifier,
} from './localStarkProver.mjs';

function pedersen(a, b) {
  return BigInt(hash.computePedersenHash(a.toString(), b.toString()));
}

export function normalizeAddress(address) {
  return ethers.getAddress(address).toLowerCase();
}

export function deriveSecret({
  seed = 'zkphil-local-eligibility',
  recipient,
  credentialSlot,
}) {
  const digest = ethers.keccak256(
    ethers.AbiCoder.defaultAbiCoder().encode(
      ['string', 'address', 'uint256'],
      [seed, ethers.getAddress(recipient), BigInt(credentialSlot)]
    )
  );
  return BigInt(digest) >> 8n;
}

export function buildPedersenMerkleTree(entries) {
  if (!Array.isArray(entries) || entries.length === 0) {
    throw new Error('entries must be a non-empty array');
  }

  const normalizedEntries = entries.map((entry, index) => {
    const recipient = normalizeAddress(entry.recipient);
    const credentialSlot = BigInt(entry.credentialSlot ?? index);
    const secret = entry.secret != null
      ? BigInt(entry.secret)
      : deriveSecret({ recipient, credentialSlot });
    const credentialLeaf = computeLeaf({
      secret,
      recipient: BigInt(recipient),
      credentialSlot,
    });
    return {
      recipient,
      credentialSlot,
      secret,
      credentialLeaf,
    };
  });

  const layers = [normalizedEntries.map((entry) => entry.credentialLeaf)];
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

export function buildEligibilityBundle({
  contextId,
  entries,
  seed,
}) {
  if (contextId == null) {
    throw new Error('contextId is required when building an eligibility bundle');
  }
  const ordered = [...entries]
    .map((entry) => ({
      recipient: normalizeAddress(entry.recipient),
      credentialSlot: BigInt(entry.credentialSlot ?? 0),
      secret: entry.secret != null ? BigInt(entry.secret) : undefined,
    }))
    .sort((a, b) => (
      a.recipient === b.recipient
        ? Number(a.credentialSlot - b.credentialSlot)
        : a.recipient.localeCompare(b.recipient)
    ))
    .map((entry) => ({
      ...entry,
      secret:
        entry.secret ??
        deriveSecret({ seed, recipient: entry.recipient, credentialSlot: entry.credentialSlot }),
    }));

  const tree = buildPedersenMerkleTree(ordered);
  const credentialsByRecipient = {};
  for (const entry of tree.entries) {
    const bucket = credentialsByRecipient[entry.recipient] || [];
    bucket.push({
      credentialSlot: entry.credentialSlot.toString(),
      secret: entry.secret.toString(),
      credentialLeaf: entry.credentialLeaf.toString(),
      index: entry.index,
      siblings: entry.proof.siblings.map((value) => value.toString()),
      pathIndices: entry.proof.pathIndices,
    });
    credentialsByRecipient[entry.recipient] = bucket;
  }

  return {
    schema: 'zkphil-eligibility-bundle-v1',
    generatedAt: new Date().toISOString(),
    contextId: BigInt(contextId).toString(),
    eligibilityRoot: tree.root.toString(),
    defaultClaimKind: ACTION_MINT,
    credentialsByRecipient,
  };
}

export function getRecipientCredentials(bundle, recipient) {
  return bundle.credentialsByRecipient[normalizeAddress(recipient)] || [];
}

export function getMintEligibility(bundle, recipient, usedNullifiers = new Set()) {
  const normalizedRecipient = normalizeAddress(recipient);
  const credentials = getRecipientCredentials(bundle, normalizedRecipient);
  const available = credentials.filter((entry) => {
    const nullifier = computeNullifier({
      secret: entry.secret,
      credentialSlot: entry.credentialSlot,
      contextId: bundle.contextId,
      recipient: BigInt(normalizedRecipient),
      claimKind: ACTION_MINT,
    });
    return !usedNullifiers.has(nullifier.toString());
  });
  return {
    eligible: available.length > 0,
    remaining: available.length,
  };
}
