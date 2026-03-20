import fs from 'node:fs';
import path from 'node:path';

import {
  getRecipientCredentials,
  normalizeAddress,
} from '../../../shared/proof/credentialBundle.mjs';
import {
  getMockHuman,
  getMockHumanIds,
} from '../../../shared/proof/mockHumanityBundle.mjs';
import {
  HUMANITY_PROVIDER_LOCAL_CREDENTIAL,
  HUMANITY_PROVIDER_LOCAL_CREDENTIAL_COMMITMENT,
  HUMANITY_PROVIDER_MOCK,
  encodeProofMetadata,
  computeCredentialCommitment,
  computeIdentityNullifier,
} from '../../../shared/proof/localStarkProver.mjs';

export interface EligibilityResult {
  eligible: boolean;
  remaining: number;
  humanityProvider?: string;
  mockHumans?: Array<{
    mockHumanId: string;
    label: string;
    available: boolean;
  }>;
}

export interface EligibilityWitness {
  provider: 'local-credential-commitment' | 'mock-humanity';
  providerMode: 'local-credential' | 'mock-humanity';
  verifierConfigHash: string;
  credentialSecret?: string;
  humanitySecret?: string;
  credentialCommitment: string;
  identityNullifier: string;
  commitmentWitness: {
    commitmentRoot: string;
    siblings: string[];
    pathIndices: number[];
  };
  identitySource: {
    kind: 'recipient' | 'mock-human';
    value: string;
    label: string;
    mockHumanId?: string;
  };
  mockHumanId?: string;
  mockHumanIdHash?: string;
}

export interface HumanityProviderInfo {
  mode: 'local-credential' | 'mock-humanity';
  label: string;
  devOnly: boolean;
  bridge: 'fact-registry';
  mockHumans?: Array<{
    mockHumanId: string;
    label: string;
  }>;
}

export interface EligibilityProvider {
  getInfo(): HumanityProviderInfo;
  getEligibility(
    proofContext: string,
    address: string,
    claimKind?: number
  ): Promise<EligibilityResult>;
  selectCredential(
    proofContext: string,
    address: string,
    claimKind: number,
    options?: {
      mockHumanId?: string;
    }
  ): Promise<EligibilityWitness>;
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

interface MockHumanityBundle {
  schema: string;
  proofContext: string;
  verifierConfigHash: string;
  mockHumansById: Record<string, {
    mockHumanId: string;
    label: string;
    mockHumanIdHash: string;
    humanitySecret: string;
    humanityCommitment: string;
    index: number;
    siblings: string[];
    pathIndices: number[];
  }>;
  mockHumanIds?: string[];
}

interface CreateEligibilityProviderOptions {
  env?: NodeJS.ProcessEnv;
  isNullifierSpent: (nullifier: bigint) => Promise<boolean>;
  isProofReserved?: (proofMetadata: string) => Promise<boolean>;
}

function normalizeProofContext(value: string | number | bigint): string {
  return BigInt(value).toString();
}

function normalizeProviderMode(rawValue: string | undefined): 'local-credential' | 'mock-humanity' {
  const normalized = String(rawValue || HUMANITY_PROVIDER_LOCAL_CREDENTIAL).trim().toLowerCase();
  if (
    normalized === HUMANITY_PROVIDER_LOCAL_CREDENTIAL ||
    normalized === HUMANITY_PROVIDER_LOCAL_CREDENTIAL_COMMITMENT ||
    normalized === 'credential' ||
    normalized === 'local'
  ) {
    return HUMANITY_PROVIDER_LOCAL_CREDENTIAL;
  }
  if (normalized === HUMANITY_PROVIDER_MOCK || normalized === 'mock') {
    return HUMANITY_PROVIDER_MOCK;
  }
  throw new Error(`Unsupported HUMANITY_PROVIDER=${rawValue}`);
}

function resolveWritablePath(rawPath: string): string {
  if (!rawPath) {
    return '';
  }
  return path.isAbsolute(rawPath)
    ? rawPath
    : path.resolve(process.cwd(), rawPath);
}

function resolveCredentialBundlePath(env: NodeJS.ProcessEnv): string {
  const rawPath = String(
    env.HUMANITY_BUNDLE_PATH ||
    env.CREDENTIAL_BUNDLE_PATH ||
    env.ELIGIBILITY_BUNDLE_PATH ||
    ''
  ).trim();
  if (!rawPath) {
    throw new Error('CREDENTIAL_BUNDLE_PATH or HUMANITY_BUNDLE_PATH must be set for local-credential mode');
  }
  return resolveWritablePath(rawPath);
}

function resolveMockHumanityBundlePath(env: NodeJS.ProcessEnv): string {
  const rawPath = String(
    env.MOCK_HUMANITY_BUNDLE_PATH ||
    env.HUMANITY_BUNDLE_PATH ||
    ''
  ).trim();
  if (!rawPath) {
    throw new Error('MOCK_HUMANITY_BUNDLE_PATH or HUMANITY_BUNDLE_PATH must be set for mock-humanity mode');
  }
  return resolveWritablePath(rawPath);
}

function loadBundle<T>(filePath: string, expectedSchema: string): T {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Bundle not found: ${filePath}`);
  }
  const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  if (!parsed || parsed.schema !== expectedSchema) {
    throw new Error(`Unsupported bundle schema in ${filePath}. Expected ${expectedSchema}.`);
  }
  return parsed as T;
}

function ensureMockModeAllowed(env: NodeJS.ProcessEnv): void {
  const nodeEnv = String(env.NODE_ENV || '').trim().toLowerCase();
  if (nodeEnv === 'production') {
    throw new Error('HUMANITY_PROVIDER=mock is DEV/TEST ONLY and must not run with NODE_ENV=production');
  }

  const configuredChainId = String(env.CHAIN_ID || '').trim();
  if (configuredChainId && BigInt(configuredChainId) !== 31337n) {
    throw new Error('HUMANITY_PROVIDER=mock is DEV/TEST ONLY and currently restricted to CHAIN_ID=31337');
  }
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

  getInfo(): HumanityProviderInfo {
    return {
      mode: HUMANITY_PROVIDER_LOCAL_CREDENTIAL,
      label: 'Local credential commitment',
      devOnly: false,
      bridge: 'fact-registry',
    };
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
    const credentials = getRecipientCredentials(
      this.bundle,
      recipient
    ) as CredentialBundle['credentialsByRecipient'][string];
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
      humanityProvider: HUMANITY_PROVIDER_LOCAL_CREDENTIAL,
    };
  }

  async selectCredential(
    proofContext: string,
    address: string,
    claimKind: number,
  ): Promise<EligibilityWitness> {
    this.assertContext(proofContext);
    const recipient = normalizeAddress(address);
    const credentials = getRecipientCredentials(
      this.bundle,
      recipient
    ) as CredentialBundle['credentialsByRecipient'][string];
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
        provider: HUMANITY_PROVIDER_LOCAL_CREDENTIAL_COMMITMENT,
        providerMode: HUMANITY_PROVIDER_LOCAL_CREDENTIAL,
        verifierConfigHash: this.bundle.verifierConfigHash,
        credentialSecret: BigInt(entry.secret).toString(),
        credentialCommitment: credentialCommitment.toString(),
        identityNullifier: identityNullifier.toString(),
        commitmentWitness: {
          commitmentRoot: this.bundle.verifierConfigHash,
          siblings: entry.siblings.map((value) => BigInt(value).toString()),
          pathIndices: entry.pathIndices.map((value) => Number(value)),
        },
        identitySource: {
          kind: 'recipient',
          value: BigInt(recipient).toString(),
          label: recipient,
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

class MockHumanityBundleProvider implements EligibilityProvider {
  private readonly bundle: MockHumanityBundle;
  private readonly isNullifierSpent: (nullifier: bigint) => Promise<boolean>;
  private readonly isProofReserved: (proofMetadata: string) => Promise<boolean>;

  constructor(
    bundle: MockHumanityBundle,
    isNullifierSpent: (nullifier: bigint) => Promise<boolean>,
    isProofReserved: (proofMetadata: string) => Promise<boolean>
  ) {
    this.bundle = bundle;
    this.isNullifierSpent = isNullifierSpent;
    this.isProofReserved = isProofReserved;
  }

  getInfo(): HumanityProviderInfo {
    return {
      mode: HUMANITY_PROVIDER_MOCK,
      label: 'DEV/TEST mock humanity',
      devOnly: true,
      bridge: 'fact-registry',
      mockHumans: getMockHumanIds(this.bundle).map((mockHumanId) => {
        const mockHuman = getMockHuman(this.bundle, mockHumanId)!;
        return {
          mockHumanId,
          label: String(mockHuman.label || mockHumanId),
        };
      }),
    };
  }

  private assertContext(proofContext: string): void {
    if (normalizeProofContext(proofContext) !== normalizeProofContext(this.bundle.proofContext)) {
      throw new Error(
        `Mock humanity bundle proofContext=${this.bundle.proofContext} does not match requested proofContext=${normalizeProofContext(proofContext)}`
      );
    }
  }

  private async buildMockHumanStatus(
    proofContext: string,
    claimKind: number
  ): Promise<EligibilityResult['mockHumans']> {
    const mockHumans = [];
    for (const mockHumanId of getMockHumanIds(this.bundle)) {
      const mockHuman = getMockHuman(this.bundle, mockHumanId);
      if (!mockHuman) continue;
      const identityNullifier = computeIdentityNullifier({
        secret: mockHuman.humanitySecret,
        proofContext,
        recipient: 0n,
        claimKind,
        providerMode: HUMANITY_PROVIDER_MOCK,
        mockHumanIdHash: mockHuman.mockHumanIdHash,
      });
      const credentialCommitment = computeCredentialCommitment({
        secret: mockHuman.humanitySecret,
        subject: mockHuman.mockHumanIdHash,
        providerMode: HUMANITY_PROVIDER_MOCK,
      });
      const proofMetadata = encodeProofMetadata({
        identityNullifier,
        credentialCommitment,
      });
      mockHumans.push({
        mockHumanId,
        label: String(mockHuman.label || mockHumanId),
        available:
          !(await this.isNullifierSpent(identityNullifier)) &&
          !(await this.isProofReserved(proofMetadata)),
      });
    }
    return mockHumans;
  }

  async getEligibility(proofContext: string, _address: string, claimKind: number = 1): Promise<EligibilityResult> {
    this.assertContext(proofContext);
    const mockHumans = await this.buildMockHumanStatus(proofContext, claimKind);
    const remaining = mockHumans.filter((entry) => entry.available).length;
    return {
      eligible: remaining > 0,
      remaining,
      humanityProvider: HUMANITY_PROVIDER_MOCK,
      mockHumans,
    };
  }

  async selectCredential(
    proofContext: string,
    address: string,
    claimKind: number,
    options?: {
      mockHumanId?: string;
    }
  ): Promise<EligibilityWitness> {
    this.assertContext(proofContext);

    const requestedMockHumanId = String(options?.mockHumanId || '').trim().toLowerCase();
    if (!requestedMockHumanId) {
      throw new EligibilityAccessError(
        'MOCK_HUMAN_ID_REQUIRED',
        400,
        'mockHumanId is required when HUMANITY_PROVIDER=mock'
      );
    }

    const mockHuman = getMockHuman(this.bundle, requestedMockHumanId);
    if (!mockHuman) {
      throw new EligibilityAccessError(
        'MOCK_HUMAN_NOT_FOUND',
        404,
        `Unknown mockHumanId: ${requestedMockHumanId}`
      );
    }

    const recipient = normalizeAddress(address);
    const identityNullifier = computeIdentityNullifier({
      secret: mockHuman.humanitySecret,
      proofContext,
      recipient: BigInt(recipient),
      claimKind,
      providerMode: HUMANITY_PROVIDER_MOCK,
      mockHumanIdHash: mockHuman.mockHumanIdHash,
    });
    const credentialCommitment = computeCredentialCommitment({
      secret: mockHuman.humanitySecret,
      subject: mockHuman.mockHumanIdHash,
      providerMode: HUMANITY_PROVIDER_MOCK,
    });
    const proofMetadata = encodeProofMetadata({
      identityNullifier,
      credentialCommitment,
    });
    if (await this.isNullifierSpent(identityNullifier) || await this.isProofReserved(proofMetadata)) {
      throw new EligibilityAccessError(
        'MOCK_HUMAN_ALREADY_USED',
        403,
        `Mock human ${requestedMockHumanId} has already consumed its Phil identity nullifier`
      );
    }

    return {
      provider: HUMANITY_PROVIDER_MOCK,
      providerMode: HUMANITY_PROVIDER_MOCK,
      verifierConfigHash: this.bundle.verifierConfigHash,
      humanitySecret: BigInt(mockHuman.humanitySecret).toString(),
      credentialCommitment: credentialCommitment.toString(),
      identityNullifier: identityNullifier.toString(),
      commitmentWitness: {
        commitmentRoot: this.bundle.verifierConfigHash,
        siblings: mockHuman.siblings.map((value) => BigInt(value).toString()),
        pathIndices: mockHuman.pathIndices.map((value) => Number(value)),
      },
      identitySource: {
        kind: 'mock-human',
        value: BigInt(mockHuman.mockHumanIdHash).toString(),
        label: String(mockHuman.label || requestedMockHumanId),
        mockHumanId: requestedMockHumanId,
      },
      mockHumanId: requestedMockHumanId,
      mockHumanIdHash: BigInt(mockHuman.mockHumanIdHash).toString(),
    };
  }
}

export function createEligibilityProvider(
  options: CreateEligibilityProviderOptions
): EligibilityProvider {
  const env = options.env || process.env;
  const providerMode = normalizeProviderMode(env.HUMANITY_PROVIDER);

  if (providerMode === HUMANITY_PROVIDER_MOCK) {
    ensureMockModeAllowed(env);
    const bundlePath = resolveMockHumanityBundlePath(env);
    const bundle = loadBundle<MockHumanityBundle>(bundlePath, 'zkphil-mock-humanity-bundle-v1');
    return new MockHumanityBundleProvider(
      bundle,
      options.isNullifierSpent,
      options.isProofReserved || (async () => false)
    );
  }

  const bundlePath = resolveCredentialBundlePath(env);
  const bundle = loadBundle<CredentialBundle>(bundlePath, 'zkphil-credential-bundle-v2');
  return new StaticCredentialBundleProvider(
    bundle,
    options.isNullifierSpent,
    options.isProofReserved || (async () => false)
  );
}
