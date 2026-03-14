import { describe, expect, it } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';
import { ethers } from 'ethers';
import authRoute from './auth.js';
import requestMintRoute from './requestMint.js';
import {
  AllowlistAccessError,
  createAllowlistProvider as createConfiguredAllowlistProvider,
} from '../lib/allowlist.js';
import { PhilDatabase } from '../lib/db.js';
import { computeMintClaimHash, computeProofFactHash } from '../lib/proofHash.js';

const DROP_ID = '13';
const PROGRAM_HASH = '0x' + '44'.repeat(32);
const PROOF_GATE = '0x1000000000000000000000000000000000000013';
const CHAIN_ID = 31337;
const MINT_TTL_SECONDS = 600;

function createStaticAllowlistProvider(entries: Record<string, number>) {
  const normalizedEntries = new Map(
    Object.entries(entries).map(([address, remaining]) => [
      ethers.getAddress(address).toLowerCase(),
      remaining,
    ])
  );

  return {
    async getAddresses() {
      return [...normalizedEntries.keys()];
    },
    async getEligibility(_: string, address: string) {
      const normalized = ethers.getAddress(address).toLowerCase();
      const remaining = normalizedEntries.get(normalized) ?? 0;
      return {
        eligible: remaining > 0,
        remaining,
      };
    },
    async consumeMint(_: string, address: string) {
      const normalized = ethers.getAddress(address).toLowerCase();
      const remaining = normalizedEntries.get(normalized) ?? 0;
      if (remaining < 1) {
        throw new AllowlistAccessError(
          'ALLOWLIST_EXHAUSTED',
          403,
          'No allowlist spots left for this address'
        );
      }

      normalizedEntries.set(normalized, remaining - 1);
      return {
        eligible: remaining - 1 > 0,
        remaining: remaining - 1,
      };
    },
  };
}

function resolveSmartAccountForRecipient(recipient: string): string {
  return ethers.getCreateAddress({
    from: ethers.getAddress(recipient),
    nonce: 1,
  }).toLowerCase();
}

async function createApp(entries: Record<string, number>) {
  const backendSigner = ethers.Wallet.createRandom();
  const db = new PhilDatabase(':memory:');
  const app = Fastify();

  await app.register(authRoute, {
    db,
    dropId: DROP_ID,
    chainId: CHAIN_ID,
    proofGateAddress: PROOF_GATE,
  });

  await app.register(requestMintRoute, {
    dropId: DROP_ID,
    programHash: PROGRAM_HASH,
    chainId: CHAIN_ID,
    proofGateAddress: PROOF_GATE,
    allowlistProvider: createStaticAllowlistProvider(entries),
    allowlistSignerKey: backendSigner.privateKey,
    mintTtlSeconds: MINT_TTL_SECONDS,
    db,
    resolveSmartAccount: async (recipient: string) => resolveSmartAccountForRecipient(recipient),
  });

  return { app, db, backendSigner };
}

async function createSingleAddressApp(
  allowedAddress: string,
  slotsPerDrop = 1
) {
  const backendSigner = ethers.Wallet.createRandom();
  const db = new PhilDatabase(':memory:');
  const app = Fastify();

  await app.register(authRoute, {
    db,
    dropId: DROP_ID,
    chainId: CHAIN_ID,
    proofGateAddress: PROOF_GATE,
  });

  await app.register(requestMintRoute, {
    dropId: DROP_ID,
    programHash: PROGRAM_HASH,
    chainId: CHAIN_ID,
    proofGateAddress: PROOF_GATE,
    allowlistProvider: createConfiguredAllowlistProvider({
      db,
      env: {
        ALLOWLIST_MODE: 'single_address',
        ALLOWLIST_SINGLE_ADDRESS: allowedAddress,
        ALLOWLIST_SLOTS_PER_DROP: String(slotsPerDrop),
        UNSAFE_DEV_ALLOWLIST: 'false',
      } as NodeJS.ProcessEnv,
    }),
    allowlistSignerKey: backendSigner.privateKey,
    mintTtlSeconds: MINT_TTL_SECONDS,
    db,
    resolveSmartAccount: async (recipient: string) => resolveSmartAccountForRecipient(recipient),
  });

  return { app, db, backendSigner };
}

async function authenticate(app: FastifyInstance, wallet: ethers.Wallet): Promise<string> {
  const challengeRes = await app.inject({
    method: 'POST',
    url: '/auth/challenge',
    payload: {
      recipient: wallet.address,
    },
  });

  expect(challengeRes.statusCode).toBe(200);
  const challengeBody = challengeRes.json();
  const signature = await wallet.signMessage(challengeBody.message);

  const verifyRes = await app.inject({
    method: 'POST',
    url: '/auth/verify',
    payload: {
      recipient: wallet.address,
      nonce: challengeBody.nonce,
      signature,
    },
  });

  expect(verifyRes.statusCode).toBe(200);
  return verifyRes.json().token as string;
}

async function closeApp(app: FastifyInstance, db: PhilDatabase) {
  await app.close();
  db.close();
}

describe('/request-mint backend-signer auth binding', () => {
  it('rejects mint proof requests without an auth token', async () => {
    const wallet = ethers.Wallet.createRandom();
    const { app, db } = await createApp({ [wallet.address]: 1 });

    try {
      const res = await app.inject({
        method: 'POST',
        url: '/request-mint',
        payload: {
          recipient: wallet.address,
          philId: 2,
          paletteVariant: 5,
        },
      });

      expect(res.statusCode).toBe(401);
      expect(res.json()).toMatchObject({
        success: false,
        code: 'AUTH_REQUIRED',
      });
    } finally {
      await closeApp(app, db);
    }
  });

  it('rejects using a token for one recipient to request a proof for another', async () => {
    const walletA = ethers.Wallet.createRandom();
    const walletB = ethers.Wallet.createRandom();
    const { app, db } = await createApp({
      [walletA.address]: 1,
      [walletB.address]: 1,
    });

    try {
      const token = await authenticate(app, walletA);
      const res = await app.inject({
        method: 'POST',
        url: '/request-mint',
        headers: {
          authorization: `Bearer ${token}`,
        },
        payload: {
          recipient: walletB.address,
          philId: 1,
          paletteVariant: 3,
        },
      });

      expect(res.statusCode).toBe(403);
      expect(res.json()).toMatchObject({
        success: false,
        code: 'AUTH_RECIPIENT_MISMATCH',
      });
    } finally {
      await closeApp(app, db);
    }
  });

  it('rejects a mintTo that does not match the backend-derived smart account', async () => {
    const wallet = ethers.Wallet.createRandom();
    const { app, db } = await createApp({ [wallet.address]: 1 });

    try {
      const token = await authenticate(app, wallet);
      const res = await app.inject({
        method: 'POST',
        url: '/request-mint',
        headers: {
          authorization: `Bearer ${token}`,
        },
        payload: {
          recipient: wallet.address,
          mintTo: ethers.Wallet.createRandom().address,
          philId: 4,
          paletteVariant: 2,
        },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json()).toMatchObject({
        success: false,
        code: 'MINT_TO_MISMATCH',
      });
    } finally {
      await closeApp(app, db);
    }
  });

  it('returns the backend-derived smart account and consumes the allowance exactly once', async () => {
    const backendSigner = ethers.Wallet.createRandom();
    const wallet = ethers.Wallet.createRandom();
    const db = new PhilDatabase(':memory:');
    const app = Fastify();

    await app.register(authRoute, {
      db,
      dropId: DROP_ID,
      chainId: CHAIN_ID,
      proofGateAddress: PROOF_GATE,
    });

    await app.register(requestMintRoute, {
      dropId: DROP_ID,
      programHash: PROGRAM_HASH,
      chainId: CHAIN_ID,
      proofGateAddress: PROOF_GATE,
      allowlistProvider: createStaticAllowlistProvider({ [wallet.address]: 1 }),
      allowlistSignerKey: backendSigner.privateKey,
      mintTtlSeconds: MINT_TTL_SECONDS,
      db,
      resolveSmartAccount: async (recipient: string) => resolveSmartAccountForRecipient(recipient),
    });

    try {
      const token = await authenticate(app, wallet);
      const before = Math.floor(Date.now() / 1000);
      const mintToComputed = resolveSmartAccountForRecipient(wallet.address);

      const first = await app.inject({
        method: 'POST',
        url: '/request-mint',
        headers: {
          authorization: `Bearer ${token}`,
        },
        payload: {
          recipient: wallet.address,
          mintTo: mintToComputed,
          philId: 2,
          paletteVariant: 5,
          mixMode: 1,
          mixSeed: 1234,
        },
      });

      expect(first.statusCode).toBe(200);
      const body = first.json();
      const expiry = BigInt(body.expiry);
      const after = Math.floor(Date.now() / 1000);
      const claimHash = computeMintClaimHash({
        programHash: PROGRAM_HASH,
        dropId: BigInt(DROP_ID),
        chainId: BigInt(CHAIN_ID),
        proofGateAddress: PROOF_GATE,
        recipient: wallet.address,
        mintTo: mintToComputed,
        philId: 2,
        paletteVariant: 5,
        mixMode: 1,
        mixSeed: 1234,
        expiry,
      });

      expect(body.success).toBe(true);
      expect(body.kind).toBe('mint');
      expect(body.mintToComputed).toBe(mintToComputed);
      expect(body.proofId).toMatch(/^proof_[a-f0-9]+$/);
      expect(body.claimHash).toBe(claimHash.toLowerCase());
      expect(body.factHash).toBe(computeProofFactHash(claimHash));
      expect(Number(expiry)).toBeGreaterThanOrEqual(before + MINT_TTL_SECONDS);
      expect(Number(expiry)).toBeLessThanOrEqual(after + MINT_TTL_SECONDS + 1);
      expect(
        ethers.verifyMessage(ethers.getBytes(claimHash), body.signature).toLowerCase()
      ).toBe(backendSigner.address.toLowerCase());
      expect(body.proof).toEqual({
        expiry: body.expiry,
        factHash: body.factHash,
        signature: body.signature,
      });

      const second = await app.inject({
        method: 'POST',
        url: '/request-mint',
        headers: {
          authorization: `Bearer ${token}`,
        },
        payload: {
          recipient: wallet.address,
          philId: 2,
          paletteVariant: 5,
          mixMode: 1,
          mixSeed: 1234,
        },
      });

      expect(second.statusCode).toBe(403);
      expect(second.json()).toMatchObject({
        success: false,
        code: 'ALLOWLIST_EXHAUSTED',
      });

      const eligibility = await app.inject({
        method: 'POST',
        url: '/eligibility',
        payload: { recipient: wallet.address },
      });
      expect(eligibility.statusCode).toBe(200);
      expect(eligibility.json()).toEqual({
        eligible: false,
        remaining: 0,
      });
    } finally {
      await closeApp(app, db);
    }
  });

  it('hard-rejects action proofs other than ACTION_ACCOUNT_CREATE', async () => {
    const wallet = ethers.Wallet.createRandom();
    const { app, db } = await createApp({ [wallet.address]: 1 });

    try {
      const token = await authenticate(app, wallet);
      const res = await app.inject({
        method: 'POST',
        url: '/request-mint',
        headers: {
          authorization: `Bearer ${token}`,
        },
        payload: {
          kind: 'action',
          recipient: wallet.address,
          actionType: 3,
          actionHash: ethers.hexlify(ethers.randomBytes(32)),
          expiry: String(Math.floor(Date.now() / 1000) + 900),
        },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json()).toMatchObject({
        success: false,
        code: 'ACTION_PROOF_DISABLED',
        error:
          'Only ACTION_ACCOUNT_CREATE (2) is supported. Execution approvals are unlock-ticket-only and are not issued by backend.',
      });
    } finally {
      await closeApp(app, db);
    }
  });

  it('does not lose the single-address allowance if proof persistence fails', async () => {
    const wallet = ethers.Wallet.createRandom();
    const { app, db } = await createSingleAddressApp(wallet.address, 1);

    const originalCreateIssuedMintProof = db.createIssuedMintProof.bind(db);
    let failOnce = true;
    (db as PhilDatabase & {
      createIssuedMintProof: PhilDatabase['createIssuedMintProof'];
    }).createIssuedMintProof = ((record) => {
      if (failOnce) {
        failOnce = false;
        throw new Error('forced issued_mint_proofs insert failure');
      }
      return originalCreateIssuedMintProof(record);
    }) as PhilDatabase['createIssuedMintProof'];

    try {
      const token = await authenticate(app, wallet);
      const first = await app.inject({
        method: 'POST',
        url: '/request-mint',
        headers: {
          authorization: `Bearer ${token}`,
        },
        payload: {
          recipient: wallet.address,
          philId: 1,
          paletteVariant: 1,
        },
      });

      expect(first.statusCode).toBe(500);
      expect(first.json()).toMatchObject({
        success: false,
        code: 'INTERNAL_ERROR',
      });

      const afterFailure = await app.inject({
        method: 'POST',
        url: '/eligibility',
        payload: { recipient: wallet.address },
      });
      expect(afterFailure.statusCode).toBe(200);
      expect(afterFailure.json()).toEqual({
        eligible: true,
        remaining: 1,
      });

      const second = await app.inject({
        method: 'POST',
        url: '/request-mint',
        headers: {
          authorization: `Bearer ${token}`,
        },
        payload: {
          recipient: wallet.address,
          philId: 1,
          paletteVariant: 1,
        },
      });

      expect(second.statusCode).toBe(200);

      const afterSuccess = await app.inject({
        method: 'POST',
        url: '/eligibility',
        payload: { recipient: wallet.address },
      });
      expect(afterSuccess.statusCode).toBe(200);
      expect(afterSuccess.json()).toEqual({
        eligible: false,
        remaining: 0,
      });
    } finally {
      await closeApp(app, db);
    }
  });

  it('atomically consumes the single-address allowance exactly once on successful issuance', async () => {
    const wallet = ethers.Wallet.createRandom();
    const { app, db } = await createSingleAddressApp(wallet.address, 1);

    try {
      const token = await authenticate(app, wallet);
      const first = await app.inject({
        method: 'POST',
        url: '/request-mint',
        headers: {
          authorization: `Bearer ${token}`,
        },
        payload: {
          recipient: wallet.address,
          philId: 3,
          paletteVariant: 4,
        },
      });

      expect(first.statusCode).toBe(200);
      const firstBody = first.json();
      const proof = db.getIssuedMintProof(
        firstBody.proofId as string,
        Math.floor(Date.now() / 1000)
      );
      expect(proof?.recipient).toBe(wallet.address.toLowerCase());

      const second = await app.inject({
        method: 'POST',
        url: '/request-mint',
        headers: {
          authorization: `Bearer ${token}`,
        },
        payload: {
          recipient: wallet.address,
          philId: 3,
          paletteVariant: 4,
        },
      });

      expect(second.statusCode).toBe(403);
      expect(second.json()).toMatchObject({
        success: false,
        code: 'ALLOWLIST_EXHAUSTED',
      });

      const eligibility = await app.inject({
        method: 'POST',
        url: '/eligibility',
        payload: { recipient: wallet.address },
      });
      expect(eligibility.statusCode).toBe(200);
      expect(eligibility.json()).toEqual({
        eligible: false,
        remaining: 0,
      });
    } finally {
      await closeApp(app, db);
    }
  });
});
