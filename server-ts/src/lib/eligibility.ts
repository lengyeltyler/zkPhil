import fs from 'node:fs';
import path from 'node:path';

import { ethers } from 'ethers';

import {
  getRecipientCredentials,
  normalizeAddress,
} from '../../../shared/proof/credentialBundle.mjs';
import {
  encodeProofMetadata,
  computeCredentialCommitment,
  computeIdentityNullifier,
} from '../../../shared/proof/localStarkProver.mjs';

export interface EligibilityResult {
  eligible: boolean;
  remaining: number;
}

export interface EligibilityWitness {
  verifierConfigHash: string;
  credentialSecret: string;
  credentialCommitment: string;
  identityNullifier: string;
  commitmentWitness: {
    commitmentRoot: string;
    siblings: string[];
    pathIndices: number[];
  };
}

export interface EligibilityProvider {
  getEligibility(proofContext: string, address: string, claimKind?: number): Promise<EligibilityResult>;
  selectCredential(proofContext: string, address: string, claimKind: number): Promise<EligibilityWitness>;
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

interface CredentialBundle {
  schema: string;
  proofContext: string;
  verifierConfigHash: string;
  credentialsByRecipient: Record<string, Array<{
    credentialNonce: string;
    secret: string;
    credentialCommitment: string;
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

function normalizeProofContext(value: string | number | bigint): string {
  return BigInt(value).toString();
}

function resolveBundlePath(env: NodeJS.ProcessEnv): string {
  const rawPath = String(env.CREDENTIAL_BUNDLE_PATH || env.ELIGIBILITY_BUNDLE_PATH || '').trim();
  if (!rawPath) {
    throw new Error('CREDENTIAL_BUNDLE_PATH must be set for local proving mode');
  }
  return path.isAbsolute(rawPath)
    ? rawPath
    : path.resolve(process.cwd(), rawPath);
}

function loadBundle(filePath: string): CredentialBundle {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Credential bundle not found: ${filePath}`);
  }
  const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  if (!parsed || parsed.schema !== 'zkphil-credential-bundle-v2') {
    throw new Error(`Unsupported credential bundle schema in ${filePath}`);
  }
  return parsed as CredentialBundle;
}

class StaticCredentialBundleProvider implements EligibilityProvider {
  private readonly bundle: CredentialBundle;
  private readonly isNullifierSpent: (nullifier: bigint) => Promise<boolean>;
  private readonly isProofReserved: (proofMetadata: string) => Promise<boolean>;

  constructor(
    bundle: CredentialBundle,
    isNullifierSpent: (nullifier: bigint) => Promise<boolean>,
    isProofReserved: (proofMetadata: string) => Promise<boolean>
  ) {
    this.bundle = bundle;
    this.isNullifierSpent = isNullifierSpent;
    this.isProofReserved = isProofReserved;
  }

  private assertContext(proofContext: string): void {
    if (normalizeProofContext(proofContext) !== normalizeProofContext(this.bundle.proofContext)) {
      throw new Error(
        `Credential bundle proofContext=${this.bundle.proofContext} does not match requested proofContext=${normalizeProofContext(proofContext)}`
      );
    }
  }

  async getEligibility(proofContext: string, address: string, claimKind: number = 1): Promise<EligibilityResult> {
    this.assertContext(proofContext);
    const recipient = normalizeAddress(address);
    const credentials = getRecipientCredentials(this.bundle, recipient) as CredentialBundle['credentialsByRecipient'][string];
    let remaining = 0;
    for (const entry of credentials) {
      const identityNullifier = computeIdentityNullifier({
        secret: entry.secret,
        proofContext,
        recipient: BigInt(recipient),
        claimKind,
      });
      const credentialCommitment = computeCredentialCommitment({
        secret: entry.secret,
        recipient: BigInt(recipient),
      });
      const proofMetadata = encodeProofMetadata({
        identityNullifier,
        credentialCommitment,
      });
      if (!(await this.isNullifierSpent(identityNullifier)) && !(await this.isProofReserved(proofMetadata))) {
        remaining += 1;
      }
    }
    return {
      eligible: remaining > 0,
      remaining,
    };
  }

  async selectCredential(proofContext: string, address: string, claimKind: number): Promise<EligibilityWitness> {
    this.assertContext(proofContext);
    const recipient = normalizeAddress(address);
    const credentials = getRecipientCredentials(this.bundle, recipient) as CredentialBundle['credentialsByRecipient'][string];
    if (credentials.length === 0) {
      throw new EligibilityAccessError(
        'ELIGIBILITY_ADDRESS_NOT_ALLOWED',
        403,
        'This address is not eligible to issue a Phil identity'
      );
    }

    for (const entry of credentials) {
      const identityNullifier = computeIdentityNullifier({
        secret: entry.secret,
        proofContext,
        recipient: BigInt(recipient),
        claimKind,
      });
      const credentialCommitment = computeCredentialCommitment({
        secret: entry.secret,
        recipient: BigInt(recipient),
      });
      const proofMetadata = encodeProofMetadata({
        identityNullifier,
        credentialCommitment,
      });
      if (await this.isNullifierSpent(identityNullifier) || await this.isProofReserved(proofMetadata)) {
        continue;
      }

      return {
        verifierConfigHash: this.bundle.verifierConfigHash,
        credentialSecret: BigInt(entry.secret).toString(),
        credentialCommitment: credentialCommitment.toString(),
        identityNullifier: identityNullifier.toString(),
        commitmentWitness: {
          commitmentRoot: this.bundle.verifierConfigHash,
          siblings: entry.siblings.map((value) => BigInt(value).toString()),
          pathIndices: entry.pathIndices.map((value) => Number(value)),
        },
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
  const bundlePath = resolveBundlePath(env);
  const bundle = loadBundle(bundlePath);
  return new StaticCredentialBundleProvider(
    bundle,
    options.isNullifierSpent,
    options.isProofReserved || (async () => false)
  );
}
