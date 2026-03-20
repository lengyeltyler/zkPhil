import { ethers } from 'ethers';
import { hash } from 'starknet';

export const ACTION_MINT = 1;
export const ACTION_ACCOUNT_CREATE = 2;
export const ACTION_CADENCE_MINT = 4;
export const ACTION_CADENCE_RESERVE = 5;
export const DOMAIN_LEAF = 1n;
export const DOMAIN_NULL = 2n;

function pedersen(a, b) {
  return BigInt(hash.computePedersenHash(a.toString(), b.toString()));
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
  const domain = resolveProofDomain({ chainId, proofGateAddress, proofGate });
  return ethers.keccak256(
    ethers.AbiCoder.defaultAbiCoder().encode(
      ['bytes32', 'uint256', 'uint256', 'address', 'address', 'address', 'uint8', 'uint8', 'uint8', 'uint32', 'uint256'],
      [
        ethers.zeroPadValue(programHash, 32),
        BigInt(contextId),
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
  const domain = resolveProofDomain({ chainId, proofGateAddress, proofGate });
  return ethers.keccak256(
    ethers.AbiCoder.defaultAbiCoder().encode(
      ['bytes32', 'uint256', 'uint256', 'address', 'address', 'uint8', 'bytes32', 'uint256'],
      [
        ethers.zeroPadValue(programHash, 32),
        BigInt(contextId),
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

export function computeLeaf({
  secret,
  recipient,
  credentialSlot,
}) {
  return pedersen(
    DOMAIN_LEAF,
    pedersen(BigInt(secret), pedersen(BigInt(recipient), BigInt(credentialSlot)))
  );
}

export function computeNullifier({
  secret,
  credentialSlot,
  contextId,
  recipient,
  claimKind,
}) {
  return pedersen(
    DOMAIN_NULL,
    pedersen(
      BigInt(secret),
      pedersen(
        BigInt(claimKind),
        pedersen(BigInt(credentialSlot), pedersen(BigInt(contextId), BigInt(recipient)))
      )
    )
  );
}

export function encodeProofMetadata({
  nullifier,
  credentialSlot,
  credentialLeaf,
}) {
  return ethers.AbiCoder.defaultAbiCoder().encode(
    ['uint256', 'uint256', 'uint256'],
    [BigInt(nullifier), BigInt(credentialSlot), BigInt(credentialLeaf)]
  );
}

export function decodeProofMetadata(encoded) {
  const [nullifier, credentialSlot, credentialLeaf] = ethers.AbiCoder.defaultAbiCoder().decode(
    ['uint256', 'uint256', 'uint256'],
    encoded
  );
  return {
    nullifier: BigInt(nullifier),
    credentialSlot: BigInt(credentialSlot),
    credentialLeaf: BigInt(credentialLeaf),
  };
}

export function buildFactOutputs({
  eligibilityRoot,
  contextId,
  recipient,
  claimHash,
  nullifier,
  credentialSlot,
  credentialLeaf,
  claimKind,
}) {
  const split = splitClaimHash(claimHash);
  return [
    BigInt(eligibilityRoot),
    BigInt(contextId),
    BigInt(recipient),
    split.hi,
    split.lo,
    BigInt(nullifier),
    BigInt(credentialSlot),
    BigInt(credentialLeaf),
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
  contextId,
  recipient,
  claimHash,
  claimKind,
  eligibilityRoot,
  secret,
  credentialSlot,
  expiry,
}) {
  const normalizedRecipient = BigInt(ethers.getAddress(recipient));
  const credentialLeaf = computeLeaf({
    secret,
    recipient: normalizedRecipient,
    credentialSlot,
  });
  const nullifier = computeNullifier({
    secret,
    credentialSlot,
    contextId,
    recipient: normalizedRecipient,
    claimKind,
  });
  const outputs = buildFactOutputs({
    eligibilityRoot,
    contextId,
    recipient: normalizedRecipient,
    claimHash,
    nullifier,
    credentialSlot,
    credentialLeaf,
    claimKind,
  });
  const factHash = computeFactHash({
    programHash,
    outputs,
  });

  return {
    expiry: BigInt(expiry),
    factHash,
    signature: encodeProofMetadata({ nullifier, credentialSlot, credentialLeaf }),
    claimHash,
    claimKind,
    outputs,
    publicOutputs: {
      eligibilityRoot: BigInt(eligibilityRoot),
      contextId: BigInt(contextId),
      recipient: normalizedRecipient,
      claimHashHi: outputs[3],
      claimHashLo: outputs[4],
      nullifier,
      credentialSlot: BigInt(credentialSlot),
      credentialLeaf,
      claimKind: BigInt(claimKind),
    },
  };
}

export async function generateLocalMintProof({
  programHash,
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
  eligibilityRoot,
  secret,
  credentialSlot = 0,
}) {
  const claimHash = computeClaimHash({
    programHash,
    contextId,
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
    contextId,
    recipient,
    claimHash,
    claimKind: ACTION_MINT,
    eligibilityRoot,
    secret,
    credentialSlot,
    expiry,
  });
}

export async function generateLocalActionProof({
  programHash,
  contextId,
  chainId,
  proofGateAddress,
  proofGate,
  recipient,
  actionType,
  actionHash,
  expiry,
  eligibilityRoot,
  secret,
  credentialSlot = 0,
}) {
  const claimHash = computeActionClaimHash({
    programHash,
    contextId,
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
    contextId,
    recipient,
    claimHash,
    claimKind: actionType,
    eligibilityRoot,
    secret,
    credentialSlot,
    expiry,
  });
}

export function prepareScarbInput({
  secret,
  credentialSlot,
  siblings,
  pathIndices,
  eligibilityRoot,
  contextId,
  recipient,
  claimHash,
  claimKind,
}) {
  const split = splitClaimHash(claimHash);
  return [
    BigInt(secret),
    BigInt(credentialSlot),
    BigInt(siblings.length),
    ...siblings.map((value) => BigInt(value)),
    BigInt(pathIndices.length),
    ...pathIndices.map((value) => BigInt(value)),
    BigInt(eligibilityRoot),
    BigInt(contextId),
    BigInt(recipient),
    split.hi,
    split.lo,
    BigInt(claimKind),
  ];
}
