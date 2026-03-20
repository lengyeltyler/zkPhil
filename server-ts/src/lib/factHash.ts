/**
 * Fact Hash Computation Module
 *
 * Computes the factHash that Atlantic Satellite uses to verify proofs.
 */

import { ethers } from 'ethers';

/**
 * Compute the fact hash from program hash and outputs
 *
 * factHash = keccak256(abi.encode(PROGRAM_HASH, keccak256(abi.encodePacked(outputs))))
 *
 * @param programHash - The hash of the compiled Cairo program (bytes32)
 * @param outputs - The 6 felt outputs from the Cairo program
 * @returns The computed factHash as bytes32
 */
export function computeFactHash(programHash: string, outputs: bigint[]): string {
  if (!outputs.length) {
    throw new Error('Expected at least one public output');
  }

  for (const output of outputs) {
    if (output < 0n || output > ((1n << 256n) - 1n)) {
      throw new Error('Output value is out of uint256 range');
    }
  }

  const outputsAsUint256 = outputs.map((o) => o.toString());

  // outputHash = keccak256(abi.encodePacked(outputs))
  // abi.encodePacked for uint256[] is just concatenation of 32-byte values
  const packedOutputs = ethers.solidityPacked(
    new Array(outputs.length).fill('uint256'),
    outputsAsUint256
  );
  const outputHash = ethers.keccak256(packedOutputs);

  // Normalize program hash to bytes32 (pad if needed)
  const programHash32 = ethers.zeroPadValue(programHash, 32);

  // factHash = keccak256(abi.encode(PROGRAM_HASH, outputHash))
  const encoded = ethers.AbiCoder.defaultAbiCoder().encode(
    ['bytes32', 'bytes32'],
    [programHash32, outputHash]
  );
  const factHash = ethers.keccak256(encoded);

  return factHash.toLowerCase();
}

/**
 * Verify that a factHash matches the expected computation
 */
export function verifyFactHash(
  factHash: string,
  programHash: string,
  outputs: bigint[]
): boolean {
  const computed = computeFactHash(programHash, outputs);
  return computed.toLowerCase() === factHash.toLowerCase();
}

/**
 * Build the outputs array from individual components
 */
export function buildOutputs(
  ...values: bigint[]
): bigint[] {
  return values;
}
