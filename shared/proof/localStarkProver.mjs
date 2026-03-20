import { ethers } from 'ethers';
import { hash } from 'starknet';

export const ACTION_MINT = 1;
export const ACTION_ACCOUNT_CREATE = 2;
export const ACTION_CADENCE_MINT = 4;
export const ACTION_CADENCE_RESERVE = 5;
export const DOMAIN_COMMITMENT = 1n;
export const DOMAIN_NULLIFIER = 2n;

function pedersen(a, b) {
  return BigInt(hash.computePedersenHash(a.toString(), b.toString()));
}

function resolveProofContext(params) {
  if (params.proofContext != null) {
    return params.proofContext;
  }
  if (params.contextId != null) {
    return params.contextId;
  }
  throw new Error('proofContext is required');
}

function resolveVerifierConfigHash(params) {
  if (params.verifierConfigHash != null) {
    return params.verifierConfigHash;
  }
  if (params.eligibilityRoot != null) {
    return params.eligibilityRoot;
  }
  throw new Error('verifierConfigHash is required');
}

function resolveProofDomain({ chainId, proofGateAddress, proofGate }) {
  if (chainId == null) {
    throw new Error('chainId is required for domain-separated proof claims');
  }

  const resolvedProofGate = proofGateAddress || proofGate;
  if (!resolvedProofGate) {
    throw new Error('proofGateAddress is required for domain-separated proof claims');
  }

  return {
    chainId: BigInt(chainId),
    proofGateAddress: ethers.getAddress(resolvedProofGate),
  };
}

export function computeClaimHash({
  proofContext,
  contextId,
  programHash,
  chainId,
  proofGateAddress,
  proofGate,
  recipient,
  mintTo,
  philId,
  paletteVariant,
  mixMode = 0,
  mixSeed = 0,
  expiry,
}) {
  const resolvedProofContext = resolveProofContext({ proofContext, contextId });
  const domain = resolveProofDomain({ chainId, proofGateAddress, proofGate });
  return ethers.keccak256(
    ethers.AbiCoder.defaultAbiCoder().encode(
      ['bytes32', 'uint256', 'uint256', 'address', 'address', 'address', 'uint8', 'uint8', 'uint8', 'uint32', 'uint256'],
      [
        ethers.zeroPadValue(programHash, 32),
        BigInt(resolvedProofContext),
        domain.chainId,
        domain.proofGateAddress,
        ethers.getAddress(recipient),
        ethers.getAddress(mintTo),
        philId,
        paletteVariant,
        Number(mixMode) >>> 0,
        Number(mixSeed) >>> 0,
        BigInt(expiry),
      ]
    )
  );
}

export function computeActionClaimHash({
  proofContext,
  contextId,
  programHash,
  chainId,
  proofGateAddress,
  proofGate,
  recipient,
  actionType,
  actionHash,
  expiry,
}) {
  const resolvedProofContext = resolveProofContext({ proofContext, contextId });
  const domain = resolveProofDomain({ chainId, proofGateAddress, proofGate });
  return ethers.keccak256(
    ethers.AbiCoder.defaultAbiCoder().encode(
      ['bytes32', 'uint256', 'uint256', 'address', 'address', 'uint8', 'bytes32', 'uint256'],
      [
        ethers.zeroPadValue(programHash, 32),
        BigInt(resolvedProofContext),
        domain.chainId,
        domain.proofGateAddress,
        ethers.getAddress(recipient),
        Number(actionType) >>> 0,
        ethers.zeroPadValue(actionHash, 32),
        BigInt(expiry),
      ]
    )
  );
}

export function splitClaimHash(claimHash) {
  const value = BigInt(claimHash);
  return {
    hi: value >> 128n,
    lo: value & ((1n << 128n) - 1n),
  };
}

export function computeCredentialCommitment({
  secret,
  recipient,
}) {
  return pedersen(
    DOMAIN_COMMITMENT,
    pedersen(BigInt(secret), BigInt(recipient))
  );
}

export function computeIdentityNullifier({
  secret,
  proofContext,
  recipient,
  claimKind,
}) {
  return pedersen(
    DOMAIN_NULLIFIER,
    pedersen(
      BigInt(secret),
      pedersen(
        BigInt(claimKind),
        pedersen(BigInt(proofContext), BigInt(recipient))
      )
    )
  );
}

export function encodeProofMetadata({
  identityNullifier,
  credentialCommitment,
}) {
  return ethers.AbiCoder.defaultAbiCoder().encode(
    ['uint256', 'uint256'],
    [BigInt(identityNullifier), BigInt(credentialCommitment)]
  );
}

export function decodeProofMetadata(encoded) {
  const [identityNullifier, credentialCommitment] = ethers.AbiCoder.defaultAbiCoder().decode(
    ['uint256', 'uint256'],
    encoded
  );
  return {
    identityNullifier: BigInt(identityNullifier),
    credentialCommitment: BigInt(credentialCommitment),
  };
}

export function buildFactOutputs({
  verifierConfigHash,
  proofContext,
  recipient,
  claimHash,
  identityNullifier,
  credentialCommitment,
  claimKind,
}) {
  const split = splitClaimHash(claimHash);
  return [
    BigInt(verifierConfigHash),
    BigInt(proofContext),
    BigInt(recipient),
    split.hi,
    split.lo,
    BigInt(identityNullifier),
    BigInt(credentialCommitment),
    BigInt(claimKind),
  ];
}

export function computeFactHash({
  programHash,
  outputs,
}) {
  const packedOutputs = ethers.solidityPacked(
    new Array(outputs.length).fill('uint256'),
    outputs.map((value) => BigInt(value).toString())
  );
  const outputsHash = ethers.keccak256(packedOutputs);
  return ethers.keccak256(
    ethers.AbiCoder.defaultAbiCoder().encode(
      ['bytes32', 'bytes32'],
      [ethers.zeroPadValue(programHash, 32), outputsHash]
    )
  ).toLowerCase();
}

export function computeMintActionHash({
  mintTo,
  philId,
  paletteVariant,
  mixMode = 0,
  mixSeed = 0,
}) {
  return ethers.keccak256(
    ethers.AbiCoder.defaultAbiCoder().encode(
      ['address', 'uint8', 'uint8', 'uint8', 'uint32'],
      [
        ethers.getAddress(mintTo),
        philId,
        paletteVariant,
        Number(mixMode) >>> 0,
        Number(mixSeed) >>> 0,
      ]
    )
  );
}

export function buildProofPayload({
  programHash,
  proofContext,
  contextId,
  recipient,
  claimHash,
  claimKind,
  verifierConfigHash,
  eligibilityRoot,
  secret,
  expiry,
}) {
  const resolvedProofContext = resolveProofContext({ proofContext, contextId });
  const resolvedVerifierConfigHash = resolveVerifierConfigHash({ verifierConfigHash, eligibilityRoot });
  const normalizedRecipient = BigInt(ethers.getAddress(recipient));
  const credentialCommitment = computeCredentialCommitment({
    secret,
    recipient: normalizedRecipient,
  });
  const identityNullifier = computeIdentityNullifier({
    secret,
    proofContext: resolvedProofContext,
    recipient: normalizedRecipient,
    claimKind,
  });
  const outputs = buildFactOutputs({
    verifierConfigHash: resolvedVerifierConfigHash,
    proofContext: resolvedProofContext,
    recipient: normalizedRecipient,
    claimHash,
    identityNullifier,
    credentialCommitment,
    claimKind,
  });
  const factHash = computeFactHash({
    programHash,
    outputs,
  });

  return {
    expiry: BigInt(expiry),
    factHash,
    signature: encodeProofMetadata({ identityNullifier, credentialCommitment }),
    claimHash,
    claimKind,
    outputs,
    publicOutputs: {
      verifierConfigHash: BigInt(resolvedVerifierConfigHash),
      proofContext: BigInt(resolvedProofContext),
      recipient: normalizedRecipient,
      claimHashHi: outputs[3],
      claimHashLo: outputs[4],
      identityNullifier,
      credentialCommitment,
      claimKind: BigInt(claimKind),
    },
  };
}

export async function generateLocalMintProof({
  programHash,
  proofContext,
  contextId,
  chainId,
  proofGateAddress,
  proofGate,
  recipient,
  mintTo,
  philId,
  paletteVariant,
  mixMode = 0,
  mixSeed = 0,
  expiry,
  verifierConfigHash,
  eligibilityRoot,
  secret,
}) {
  const resolvedProofContext = resolveProofContext({ proofContext, contextId });
  const resolvedVerifierConfigHash = resolveVerifierConfigHash({ verifierConfigHash, eligibilityRoot });
  const claimHash = computeClaimHash({
    programHash,
    proofContext: resolvedProofContext,
    chainId,
    proofGateAddress,
    proofGate,
    recipient,
    mintTo,
    philId,
    paletteVariant,
    mixMode,
    mixSeed,
    expiry,
  });

  return buildProofPayload({
    programHash,
    proofContext: resolvedProofContext,
    recipient,
    claimHash,
    claimKind: ACTION_MINT,
    verifierConfigHash: resolvedVerifierConfigHash,
    secret,
    expiry,
  });
}

export async function generateLocalActionProof({
  programHash,
  proofContext,
  contextId,
  chainId,
  proofGateAddress,
  proofGate,
  recipient,
  actionType,
  actionHash,
  expiry,
  verifierConfigHash,
  eligibilityRoot,
  secret,
}) {
  const resolvedProofContext = resolveProofContext({ proofContext, contextId });
  const resolvedVerifierConfigHash = resolveVerifierConfigHash({ verifierConfigHash, eligibilityRoot });
  const claimHash = computeActionClaimHash({
    programHash,
    proofContext: resolvedProofContext,
    chainId,
    proofGateAddress,
    proofGate,
    recipient,
    actionType,
    actionHash,
    expiry,
  });

  return buildProofPayload({
    programHash,
    proofContext: resolvedProofContext,
    recipient,
    claimHash,
    claimKind: actionType,
    verifierConfigHash: resolvedVerifierConfigHash,
    secret,
    expiry,
  });
}

export function prepareScarbInput({
  secret,
  siblings,
  pathIndices,
  commitmentRoot,
  eligibilityRoot,
  proofContext,
  contextId,
  recipient,
  claimHash,
  claimKind,
}) {
  const resolvedCommitmentRoot = resolveVerifierConfigHash({
    verifierConfigHash: commitmentRoot,
    eligibilityRoot,
  });
  const resolvedProofContext = resolveProofContext({ proofContext, contextId });
  const split = splitClaimHash(claimHash);
  return [
    BigInt(secret),
    BigInt(siblings.length),
    ...siblings.map((value) => BigInt(value)),
    BigInt(pathIndices.length),
    ...pathIndices.map((value) => BigInt(value)),
    BigInt(resolvedCommitmentRoot),
    BigInt(resolvedProofContext),
    BigInt(recipient),
    split.hi,
    split.lo,
    BigInt(claimKind),
  ];
}
