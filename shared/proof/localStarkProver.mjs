import { ethers } from 'ethers';

export const ACTION_MINT = 1;
export const ACTION_ACCOUNT_CREATE = 2;
export const ACTION_CADENCE_MINT = 4;
export const ACTION_CADENCE_RESERVE = 5;
export const FACT_TAG = ethers.dataSlice(ethers.keccak256(ethers.toUtf8Bytes('FACT_V1')), 0, 4);

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

/**
 * Claim hash format must match ProofGateTest13.computeClaimHash.
 */
export function computeClaimHash({
  dropId,
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
        BigInt(dropId),
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

/**
 * Action claim hash format must match ProofGateTest13.computeActionClaimHash.
 */
export function computeActionClaimHash({
  dropId,
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
        BigInt(dropId),
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

export function computeFactHash({
  claimHash,
}) {
  return ethers.keccak256(
    ethers.AbiCoder.defaultAbiCoder().encode(
      ['bytes4', 'bytes32'],
      [
        FACT_TAG,
        ethers.zeroPadValue(claimHash, 32),
      ]
    )
  );
}

export function computeBackendMintFactHash({
  claimHash,
}) {
  return ethers.keccak256(
    ethers.AbiCoder.defaultAbiCoder().encode(
      ['bytes4', 'bytes32'],
      [
        FACT_TAG,
        ethers.zeroPadValue(claimHash, 32),
      ]
    )
  );
}

/**
 * Local deterministic prover boundary.
 * This emits proof payloads with the same shape the on-chain verifier expects.
 */
export async function generateLocalMintProof({
  signer,
  programHash,
  dropId,
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
  const claimHash = computeClaimHash({
    programHash,
    dropId,
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

  const factHash = computeFactHash({ claimHash });

  const signature = await signer.signMessage(ethers.getBytes(claimHash));

  return {
    expiry: BigInt(expiry),
    factHash,
    signature,
    claimHash,
  };
}

/**
 * Local deterministic prover for non-mint action proofs.
 */
export async function generateLocalActionProof({
  signer,
  programHash,
  dropId,
  chainId,
  proofGateAddress,
  proofGate,
  recipient,
  actionType,
  actionHash,
  expiry,
}) {
  const claimHash = computeActionClaimHash({
    programHash,
    dropId,
    chainId,
    proofGateAddress,
    proofGate,
    recipient,
    actionType,
    actionHash,
    expiry,
  });

  const factHash = computeFactHash({ claimHash });

  const signature = await signer.signMessage(ethers.getBytes(claimHash));

  return {
    expiry: BigInt(expiry),
    factHash,
    signature,
    claimHash,
    actionType,
    actionHash,
  };
}
