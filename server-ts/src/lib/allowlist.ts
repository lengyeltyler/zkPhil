import { ethers } from 'ethers';
import { IssuedMintProofRecord, PhilDatabase } from './db.js';

export interface EligibilityResult {
  eligible: boolean;
  remaining: number;
}

export interface AllowlistProvider {
  getEligibility(dropId: string, address: string): Promise<EligibilityResult>;
  consumeMint(dropId: string, address: string): Promise<EligibilityResult>;
  consumeMintAndPersistProof?(
    dropId: string,
    address: string,
    record: IssuedMintProofRecord
  ): Promise<EligibilityResult>;
}

export class AllowlistAccessError extends Error {
  code: string;
  statusCode: number;

  constructor(code: string, statusCode: number, message: string) {
    super(message);
    this.name = 'AllowlistAccessError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

function normalizeAddress(value: string): string {
  return ethers.getAddress(value).toLowerCase();
}

class BackendAuthProvider implements AllowlistProvider {
  async getEligibility(_: string, address: string): Promise<EligibilityResult> {
    normalizeAddress(address);
    return {
      eligible: true,
      remaining: 1,
    };
  }

  async consumeMint(_: string, address: string): Promise<EligibilityResult> {
    normalizeAddress(address);
    return {
      eligible: true,
      remaining: 1,
    };
  }
}

class SingleAddressAllowlistProvider implements AllowlistProvider {
  private db: PhilDatabase;
  private allowedAddress: string;
  private slotsPerDrop: number;

  constructor(db: PhilDatabase, allowedAddress: string, slotsPerDrop: number) {
    if (!Number.isInteger(slotsPerDrop) || slotsPerDrop < 1) {
      throw new Error(`ALLOWLIST_SLOTS_PER_DROP must be a positive integer (received ${slotsPerDrop})`);
    }

    this.db = db;
    this.allowedAddress = normalizeAddress(allowedAddress);
    this.slotsPerDrop = slotsPerDrop;
  }

  private ensureDrop(dropId: string) {
    this.db.ensureAllowlistEntitlement(dropId, this.allowedAddress, this.slotsPerDrop);
  }

  async getEligibility(dropId: string, address: string): Promise<EligibilityResult> {
    const normalized = normalizeAddress(address);
    if (normalized !== this.allowedAddress) {
      return {
        eligible: false,
        remaining: 0,
      };
    }

    this.ensureDrop(dropId);
    const remaining = this.db.getAllowlistRemaining(dropId, normalized);
    return {
      eligible: remaining > 0,
      remaining,
    };
  }

  async consumeMint(dropId: string, address: string): Promise<EligibilityResult> {
    const normalized = normalizeAddress(address);
    if (normalized !== this.allowedAddress) {
      throw new AllowlistAccessError(
        'ALLOWLIST_ADDRESS_NOT_ALLOWED',
        403,
        'This address is not allowlisted for minting'
      );
    }

    this.ensureDrop(dropId);
    const remaining = this.db.consumeAllowlistEntitlement(dropId, normalized);
    if (remaining == null) {
      throw new AllowlistAccessError(
        'ALLOWLIST_EXHAUSTED',
        403,
        'No allowlist spots left for this address'
      );
    }

    return {
      eligible: remaining > 0,
      remaining,
    };
  }

  async consumeMintAndPersistProof(
    dropId: string,
    address: string,
    record: IssuedMintProofRecord
  ): Promise<EligibilityResult> {
    const normalized = normalizeAddress(address);
    if (normalized !== this.allowedAddress) {
      throw new AllowlistAccessError(
        'ALLOWLIST_ADDRESS_NOT_ALLOWED',
        403,
        'This address is not allowlisted for minting'
      );
    }

    this.ensureDrop(dropId);
    const remaining = this.db.consumeAllowlistEntitlementAndCreateIssuedMintProof(
      dropId,
      normalized,
      record
    );
    if (remaining == null) {
      throw new AllowlistAccessError(
        'ALLOWLIST_EXHAUSTED',
        403,
        'No allowlist spots left for this address'
      );
    }

    return {
      eligible: remaining > 0,
      remaining,
    };
  }
}

interface CreateAllowlistProviderOptions {
  db?: PhilDatabase;
  env?: NodeJS.ProcessEnv;
}

function isTruthy(value: string | undefined): boolean {
  return String(value || '').trim().toLowerCase() === 'true';
}

export function createAllowlistProvider(
  options: CreateAllowlistProviderOptions = {}
): AllowlistProvider {
  const env = options.env || process.env;
  const allowlistMode = String(env.ALLOWLIST_MODE || 'single_address').trim().toLowerCase();

  if (allowlistMode === 'unsafe_dev') {
    if (!isTruthy(env.UNSAFE_DEV_ALLOWLIST)) {
      throw new Error(
        'ALLOWLIST_MODE=unsafe_dev is disabled by default. Set UNSAFE_DEV_ALLOWLIST=true to enable the permissive developer allowlist.'
      );
    }
    return new BackendAuthProvider();
  }

  if (allowlistMode !== 'single_address') {
    throw new Error(
      `Unsupported ALLOWLIST_MODE=${allowlistMode || '(empty)'}. Supported values: single_address, unsafe_dev`
    );
  }

  if (!options.db) {
    throw new Error('ALLOWLIST_MODE=single_address requires a PhilDatabase instance');
  }

  const allowlistSingleAddress = String(env.ALLOWLIST_SINGLE_ADDRESS || '').trim();
  if (!allowlistSingleAddress) {
    throw new Error('ALLOWLIST_SINGLE_ADDRESS must be set when ALLOWLIST_MODE=single_address');
  }

  const slotsPerDrop = Number(env.ALLOWLIST_SLOTS_PER_DROP || '1');
  return new SingleAddressAllowlistProvider(options.db, allowlistSingleAddress, slotsPerDrop);
}
