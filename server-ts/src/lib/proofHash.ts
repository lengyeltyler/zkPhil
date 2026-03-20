import { ethers } from 'ethers';

const FACT_TAG = ethers.dataSlice(ethers.keccak256(ethers.toUtf8Bytes('FACT_V1')), 0, 4);

function normalizeBytes32(value: string): string {
  return ethers.zeroPadValue(value, 32).toLowerCase();
}

function normalizeAddress(value: string): string {
  return ethers.getAddress(value);
}

export function computeMintClaimHash(params: {
  programHash: string;
  proofContext: bigint | string | number;
  chainId: bigint | string | number;
  proofGateAddress: string;
  recipient: string;
  mintTo: string;
  philId: number;
  paletteVariant: number;
  mixMode: number;
  mixSeed: number;
  expiry: bigint | string | number;
}): string {
  return ethers.keccak256(
    ethers.AbiCoder.defaultAbiCoder().encode(
      ['bytes32', 'uint256', 'uint256', 'address', 'address', 'address', 'uint8', 'uint8', 'uint8', 'uint32', 'uint256'],
      [
        normalizeBytes32(params.programHash),
        BigInt(params.proofContext),
        BigInt(params.chainId),
        normalizeAddress(params.proofGateAddress),
        normalizeAddress(params.recipient),
        normalizeAddress(params.mintTo),
        params.philId,
        params.paletteVariant,
        params.mixMode,
        params.mixSeed >>> 0,
        BigInt(params.expiry),
      ]
    )
  );
}

export function computeActionClaimHash(params: {
  programHash: string;
  proofContext: bigint | string | number;
  chainId: bigint | string | number;
  proofGateAddress: string;
  recipient: string;
  actionType: number;
  actionHash: string;
  expiry: bigint | string | number;
}): string {
  return ethers.keccak256(
    ethers.AbiCoder.defaultAbiCoder().encode(
      ['bytes32', 'uint256', 'uint256', 'address', 'address', 'uint8', 'bytes32', 'uint256'],
      [
        normalizeBytes32(params.programHash),
        BigInt(params.proofContext),
        BigInt(params.chainId),
        normalizeAddress(params.proofGateAddress),
        normalizeAddress(params.recipient),
        params.actionType,
        normalizeBytes32(params.actionHash),
        BigInt(params.expiry),
      ]
    )
  );
}

export function computeProofFactHash(claimHash: string): string {
  return ethers.keccak256(
    ethers.AbiCoder.defaultAbiCoder().encode(
      ['bytes4', 'bytes32'],
      [FACT_TAG, normalizeBytes32(claimHash)]
    )
  ).toLowerCase();
}
