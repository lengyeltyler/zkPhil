import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ethers } from 'ethers';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const SHARP_ROOT = path.resolve(__dirname, '..');

export const ACCOUNT_NAME = 'SharpAccountV1';
export const ACCOUNT_VERSION = '1';
export const PROGRAM_JSON = path.join(SHARP_ROOT, 'artifacts', 'program.json');
export const PROOF_JSON = path.join(SHARP_ROOT, 'artifacts', 'proof.json');
export const DEPLOYMENT_JSON = path.join(SHARP_ROOT, 'artifacts', 'deployment.json');
export const E2E_JSON = path.join(SHARP_ROOT, 'artifacts', 'e2e-report.json');

export function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

export function parseSecretBytes(secret) {
  if (typeof secret !== 'string' || secret.length === 0) {
    throw new Error('secondFactorSecret must be a non-empty string');
  }
  if (secret.startsWith('0x')) {
    return ethers.getBytes(secret);
  }
  return ethers.toUtf8Bytes(secret);
}

export function computeSecondFactorCommitment(secondFactorSecret) {
  return ethers.keccak256(parseSecretBytes(secondFactorSecret));
}

export function computeCallDataHash(callData) {
  return ethers.keccak256(ethers.getBytes(callData));
}

export function computeIntentHash({
  wallet,
  smartAccount,
  target,
  callDataHash,
  value,
  nonce,
  chainId,
  secondFactorCommitment,
}) {
  return ethers.keccak256(
    ethers.AbiCoder.defaultAbiCoder().encode(
      ['address', 'address', 'address', 'bytes32', 'uint256', 'uint64', 'uint256', 'bytes32'],
      [
        ethers.getAddress(wallet),
        ethers.getAddress(smartAccount),
        ethers.getAddress(target),
        ethers.zeroPadValue(callDataHash, 32),
        BigInt(value),
        BigInt(nonce),
        BigInt(chainId),
        ethers.zeroPadValue(secondFactorCommitment, 32),
      ]
    )
  );
}

export function computeFactHash(programHash, intentHash) {
  return ethers.keccak256(
    ethers.AbiCoder.defaultAbiCoder().encode(
      ['bytes32', 'bytes32'],
      [ethers.zeroPadValue(programHash, 32), ethers.zeroPadValue(intentHash, 32)]
    )
  );
}

export function typedDataDomain(chainId, verifyingContract) {
  return {
    name: ACCOUNT_NAME,
    version: ACCOUNT_VERSION,
    chainId: Number(chainId),
    verifyingContract: ethers.getAddress(verifyingContract),
  };
}

export const typedDataTypes = {
  Intent: [{ name: 'intentHash', type: 'bytes32' }],
};

export async function signIntentHash({
  signer,
  chainId,
  verifyingContract,
  intentHash,
}) {
  return signer.signTypedData(
    typedDataDomain(chainId, verifyingContract),
    typedDataTypes,
    { intentHash }
  );
}

export function readProgramHashFromContractSource() {
  const accountPath = path.join(SHARP_ROOT, 'contracts', 'SharpAccount.sol');
  const content = fs.readFileSync(accountPath, 'utf8');
  const match = content.match(/bytes32\s+public\s+constant\s+PROGRAM_HASH\s*=\s*(0x[a-fA-F0-9]{64})/);
  if (!match) {
    throw new Error(`Unable to parse PROGRAM_HASH from ${accountPath}`);
  }
  return match[1];
}

export function readProgramHash() {
  if (fs.existsSync(PROGRAM_JSON)) {
    const parsed = JSON.parse(fs.readFileSync(PROGRAM_JSON, 'utf8'));
    if (parsed?.programHash) {
      return parsed.programHash;
    }
  }
  return readProgramHashFromContractSource();
}

