/**
 * Secret Generation Module
 *
 * Generates and manages cryptographic secrets for eligibility credentials.
 */

import { randomBytes } from 'crypto';
import { computeLeaf, bigIntToHex } from './merkle.js';

// StarkNet prime field (Cairo felt252 max value)
const STARK_PRIME = BigInt(
  '0x800000000000011000000000000000000000000000000000000000000000001'
);

/**
 * Generate a random secret within the StarkNet field
 */
export function generateSecret(): bigint {
  // Generate 32 random bytes
  const bytes = randomBytes(32);
  const value = BigInt('0x' + bytes.toString('hex'));

  // Reduce to field element
  return value % STARK_PRIME;
}

/**
 * Generate multiple secrets
 */
export function generateSecrets(count: number): Array<{ secret: bigint; leaf: bigint }> {
  const secrets: Array<{ secret: bigint; leaf: bigint }> = [];

  for (let i = 0; i < count; i++) {
    const secret = generateSecret();
    const leaf = computeLeaf(secret);
    secrets.push({ secret, leaf });
  }

  return secrets;
}

/**
 * Secret entry for database storage
 */
export interface SecretData {
  secret: string; // Hex string
  leaf: string; // Hex string
  leafIndex: number;
}

/**
 * Generate secrets formatted for database storage
 */
export function generateSecretsForDb(count: number): SecretData[] {
  const secrets = generateSecrets(count);

  return secrets.map((s, i) => ({
    secret: bigIntToHex(s.secret),
    leaf: bigIntToHex(s.leaf),
    leafIndex: i,
  }));
}

/**
 * Validate that a secret is within the valid field range
 */
export function isValidSecret(secret: bigint): boolean {
  return secret >= 0n && secret < STARK_PRIME;
}

/**
 * Parse a hex string secret
 */
export function parseSecret(hex: string): bigint {
  const value = BigInt(hex.startsWith('0x') ? hex : '0x' + hex);
  if (!isValidSecret(value)) {
    throw new Error('Secret out of valid field range');
  }
  return value;
}
