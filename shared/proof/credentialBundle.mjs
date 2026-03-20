import { ethers } from 'ethers';
import { hash } from 'starknet';

import {
  ACTION_MINT,
  computeCredentialCommitment,
  computeIdentityNullifier,
} from './localStarkProver.mjs';

function pedersen(a, b) {
  return BigInt(hash.computePedersenHash(a.toString(), b.toString()));
}

export function normalizeAddress(address) {
  return ethers.getAddress(address).toLowerCase();
}

export function deriveCredentialSecret({
  seed = 'zkphil-local-credential',
  recipient,
  credentialNonce = 0,
}) {
  const digest = ethers.keccak256(
    ethers.AbiCoder.defaultAbiCoder().encode(
      ['string', 'address', 'uint256'],
      [seed, ethers.getAddress(recipient), BigInt(credentialNonce)]
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
    const credentialNonce = BigInt(entry.credentialNonce ?? index);
    const secret = entry.secret != null
      ? BigInt(entry.secret)
      : deriveCredentialSecret({ recipient, credentialNonce });
    const credentialCommitment = computeCredentialCommitment({
      secret,
      recipient: BigInt(recipient),
    });
    return {
      recipient,
      credentialNonce,
      secret,
      credentialCommitment,
    };
  });

  const layers = [normalizedEntries.map((entry) => entry.credentialCommitment)];
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

export function buildCredentialBundle({
  proofContext,
  contextId,
  entries,
  seed,
}) {
  const resolvedProofContext = proofContext ?? contextId;
  if (resolvedProofContext == null) {
    throw new Error('proofContext is required when building a credential bundle');
  }

  const ordered = [...entries]
    .map((entry, index) => ({
      recipient: normalizeAddress(entry.recipient),
      credentialNonce: BigInt(entry.credentialNonce ?? index),
      secret: entry.secret != null ? BigInt(entry.secret) : undefined,
    }))
    .sort((a, b) => (
      a.recipient === b.recipient
        ? Number(a.credentialNonce - b.credentialNonce)
        : a.recipient.localeCompare(b.recipient)
    ))
    .map((entry) => ({
      ...entry,
      secret:
        entry.secret ??
        deriveCredentialSecret({ seed, recipient: entry.recipient, credentialNonce: entry.credentialNonce }),
    }));

  const tree = buildPedersenMerkleTree(ordered);
  const credentialsByRecipient = {};
  for (const entry of tree.entries) {
    const bucket = credentialsByRecipient[entry.recipient] || [];
    bucket.push({
      credentialNonce: entry.credentialNonce.toString(),
      secret: entry.secret.toString(),
      credentialCommitment: entry.credentialCommitment.toString(),
      index: entry.index,
      siblings: entry.proof.siblings.map((value) => value.toString()),
      pathIndices: entry.proof.pathIndices,
    });
    credentialsByRecipient[entry.recipient] = bucket;
  }

  return {
    schema: 'zkphil-credential-bundle-v2',
    provider: 'local-credential-commitment',
    generatedAt: new Date().toISOString(),
    proofContext: BigInt(resolvedProofContext).toString(),
    verifierConfigHash: tree.root.toString(),
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
    const identityNullifier = computeIdentityNullifier({
      secret: entry.secret,
      proofContext: bundle.proofContext,
      recipient: BigInt(normalizedRecipient),
      claimKind: ACTION_MINT,
    });
    return !usedNullifiers.has(identityNullifier.toString());
  });
  return {
    eligible: available.length > 0,
    remaining: available.length,
  };
}
