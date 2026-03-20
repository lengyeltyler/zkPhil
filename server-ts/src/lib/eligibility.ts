import fs from 'node:fs';
import path from 'node:path';

import { ethers } from 'ethers';

import {
  getRecipientCredentials,
  normalizeAddress,
} from '../../../shared/proof/eligibilityBundle.mjs';
import {
  encodeProofMetadata,
  computeLeaf,
  computeNullifier,
} from '../../../shared/proof/localStarkProver.mjs';

export interface EligibilityResult {
  eligible: boolean;
  remaining: number;
}

export interface EligibilityWitness {
  eligibilityRoot: string;
  credentialSlot: string;
  secret: string;
  credentialLeaf: string;
  nullifier: string;
  siblings: string[];
  pathIndices: number[];
}

export interface EligibilityProvider {
  getEligibility(contextId: string, address: string, claimKind?: number): Promise<EligibilityResult>;
  selectCredential(contextId: string, address: string, claimKind: number): Promise<EligibilityWitness>;
}

export class EligibilityAccessError extends Error {
  code: string;
  statusCode: number;

  constructor(code: string, statusCode: number, message: string) {
    super(message);
    this.name = 'EligibilityAccessError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

interface EligibilityBundle {
  schema: string;
  contextId: string;
  eligibilityRoot: string;
  credentialsByRecipient: Record<string, Array<{
    credentialSlot: string;
    secret: string;
    credentialLeaf: string;
    index: number;
    siblings: string[];
    pathIndices: number[];
  }>>;
}

interface CreateEligibilityProviderOptions {
  env?: NodeJS.ProcessEnv;
  isNullifierSpent: (nullifier: bigint) => Promise<boolean>;
  isProofReserved?: (proofMetadata: string) => Promise<boolean>;
}

function normalizeContextId(value: string | number | bigint): string {
  return BigInt(value).toString();
}

function resolveBundlePath(rawPath: string): string {
  if (!rawPath) {
    throw new Error('ELIGIBILITY_BUNDLE_PATH must be set for local proving mode');
  }
  return path.isAbsolute(rawPath)
    ? rawPath
    : path.resolve(process.cwd(), rawPath);
}

function loadBundle(filePath: string): EligibilityBundle {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Eligibility bundle not found: ${filePath}`);
  }
  const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  if (!parsed || parsed.schema !== 'zkphil-eligibility-bundle-v1') {
    throw new Error(`Unsupported eligibility bundle schema in ${filePath}`);
  }
  return parsed as EligibilityBundle;
}

class StaticEligibilityBundleProvider implements EligibilityProvider {
  private readonly bundle: EligibilityBundle;
  private readonly isNullifierSpent: (nullifier: bigint) => Promise<boolean>;
  private readonly isProofReserved: (proofMetadata: string) => Promise<boolean>;

  constructor(
    bundle: EligibilityBundle,
    isNullifierSpent: (nullifier: bigint) => Promise<boolean>,
    isProofReserved: (proofMetadata: string) => Promise<boolean>
  ) {
    this.bundle = bundle;
    this.isNullifierSpent = isNullifierSpent;
    this.isProofReserved = isProofReserved;
  }

  private assertContext(contextId: string): void {
    if (normalizeContextId(contextId) !== normalizeContextId(this.bundle.contextId)) {
      throw new Error(
        `Eligibility bundle contextId=${this.bundle.contextId} does not match requested contextId=${normalizeContextId(contextId)}`
      );
    }
  }

  async getEligibility(contextId: string, address: string, claimKind: number = 1): Promise<EligibilityResult> {
    this.assertContext(contextId);
    const recipient = normalizeAddress(address);
    const credentials = getRecipientCredentials(this.bundle, recipient) as EligibilityBundle['credentialsByRecipient'][string];
    let remaining = 0;
    for (const entry of credentials) {
      const nullifier = computeNullifier({
        secret: entry.secret,
        credentialSlot: entry.credentialSlot,
        contextId,
        recipient: BigInt(recipient),
        claimKind,
      });
      const credentialLeaf = computeLeaf({
        secret: entry.secret,
        recipient: BigInt(recipient),
        credentialSlot: entry.credentialSlot,
      });
      const proofMetadata = encodeProofMetadata({
        nullifier,
        credentialSlot: entry.credentialSlot,
        credentialLeaf,
      });
      if (!(await this.isNullifierSpent(nullifier)) && !(await this.isProofReserved(proofMetadata))) {
        remaining += 1;
      }
    }
    return {
      eligible: remaining > 0,
      remaining,
    };
  }

  async selectCredential(contextId: string, address: string, claimKind: number): Promise<EligibilityWitness> {
    this.assertContext(contextId);
    const recipient = normalizeAddress(address);
    const credentials = getRecipientCredentials(this.bundle, recipient) as EligibilityBundle['credentialsByRecipient'][string];
    if (credentials.length === 0) {
      throw new EligibilityAccessError(
        'ELIGIBILITY_ADDRESS_NOT_ALLOWED',
        403,
        'This address is not eligible to issue a Phil identity'
      );
    }

    for (const entry of credentials) {
      const nullifier = computeNullifier({
        secret: entry.secret,
        credentialSlot: entry.credentialSlot,
        contextId,
        recipient: BigInt(recipient),
        claimKind,
      });
      const expectedCredentialLeaf = computeLeaf({
        secret: entry.secret,
        recipient: BigInt(recipient),
        credentialSlot: entry.credentialSlot,
      });
      const proofMetadata = encodeProofMetadata({
        nullifier,
        credentialSlot: entry.credentialSlot,
        credentialLeaf: expectedCredentialLeaf,
      });
      if (await this.isNullifierSpent(nullifier) || await this.isProofReserved(proofMetadata)) {
        continue;
      }

      return {
        eligibilityRoot: this.bundle.eligibilityRoot,
        credentialSlot: BigInt(entry.credentialSlot).toString(),
        secret: BigInt(entry.secret).toString(),
        credentialLeaf: expectedCredentialLeaf.toString(),
        nullifier: nullifier.toString(),
        siblings: entry.siblings.map((value) => BigInt(value).toString()),
        pathIndices: entry.pathIndices.map((value) => Number(value)),
      };
    }

    throw new EligibilityAccessError(
      'ELIGIBILITY_EXHAUSTED',
      403,
      'No unused eligibility credentials remain for this address'
    );
  }
}

export function createEligibilityProvider(
  options: CreateEligibilityProviderOptions
): EligibilityProvider {
  const env = options.env || process.env;
  const bundlePath = resolveBundlePath(String(env.ELIGIBILITY_BUNDLE_PATH || '').trim());
  const bundle = loadBundle(bundlePath);
  return new StaticEligibilityBundleProvider(
    bundle,
    options.isNullifierSpent,
    options.isProofReserved || (async () => false)
  );
}
