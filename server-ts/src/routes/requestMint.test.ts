import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';
import { ethers } from 'ethers';

import authRoute from './auth.js';
import requestMintRoute from './requestMint.js';
import { createEligibilityProvider } from '../lib/eligibility.js';
import { PhilDatabase } from '../lib/db.js';
import { buildCredentialBundle } from '../../../shared/proof/credentialBundle.mjs';
import { buildMockHumanityBundle } from '../../../shared/proof/mockHumanityBundle.mjs';
import { buildProofPayload, computeClaimHash } from '../../../shared/proof/localStarkProver.mjs';

const PROOF_CONTEXT = '13';
const PROGRAM_HASH = '0x' + '44'.repeat(32);
const PROOF_GATE = '0x1000000000000000000000000000000000000013';
const CHAIN_ID = 31337;
const MINT_TTL_SECONDS = 600;

function resolveSmartAccountForRecipient(recipient: string): string {
  return ethers.getCreateAddress({
    from: ethers.getAddress(recipient),
    nonce: 1,
  }).toLowerCase();
}

function resolveLegacyMintRecipient(recipient: string): string {
  return ethers.getAddress(recipient).toLowerCase();
}

function buildCredentialBundleFile(entries: Record<string, number>, seed: string) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zkphil-request-mint-'));
  const bundlePath = path.join(tempDir, 'credential-bundle.json');
  const bundleEntries: Array<{ recipient: string; credentialNonce: number }> = [];

  for (const [recipient, credentials] of Object.entries(entries)) {
    for (let credentialNonce = 0; credentialNonce < credentials; credentialNonce += 1) {
      bundleEntries.push({
        recipient,
        credentialNonce,
      });
    }
  }

  const bundle = buildCredentialBundle({
    proofContext: PROOF_CONTEXT,
    entries: bundleEntries,
    seed,
  });

  fs.writeFileSync(bundlePath, JSON.stringify(bundle, null, 2));
  return {
    bundle,
    bundlePath,
    cleanup() {
      fs.rmSync(tempDir, { recursive: true, force: true });
    },
  };
}

function buildMockHumanityBundleFile(mockHumanIds: string[], seed: string) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zkphil-request-mint-mock-humanity-'));
  const bundlePath = path.join(tempDir, 'mock-humanity-bundle.json');
  const bundle = buildMockHumanityBundle({
    proofContext: PROOF_CONTEXT,
    humans: mockHumanIds.map((mockHumanId) => ({
      mockHumanId,
      label: mockHumanId,
    })),
    seed,
  });

  fs.writeFileSync(bundlePath, JSON.stringify(bundle, null, 2));
  return {
    bundle,
    bundlePath,
    cleanup() {
      fs.rmSync(tempDir, { recursive: true, force: true });
    },
  };
}

async function createApp(
  entries: Record<string, number>,
  resolveSmartAccount: (recipient: string) => Promise<string> | string = resolveSmartAccountForRecipient,
  options: {
    humanityProvider?: 'local-credential' | 'mock-humanity';
    mockHumanIds?: string[];
  } = {}
) {
  const db = new PhilDatabase(':memory:');
  const app = Fastify();
  const humanityProvider = options.humanityProvider || 'local-credential';
  const bundleFixture = humanityProvider === 'mock-humanity'
    ? buildMockHumanityBundleFile(options.mockHumanIds || ['atlas', 'briar'], 'request-mint-route-mock')
    : buildCredentialBundleFile(entries, 'request-mint-route-test');

  await app.register(authRoute, {
    db,
    proofContext: PROOF_CONTEXT,
    chainId: CHAIN_ID,
    proofGateAddress: PROOF_GATE,
  });

  await app.register(requestMintRoute, {
    proofContext: PROOF_CONTEXT,
    programHash: PROGRAM_HASH,
    chainId: CHAIN_ID,
    proofGateAddress: PROOF_GATE,
    eligibilityProvider: createEligibilityProvider({
      env: {
        HUMANITY_PROVIDER: humanityProvider === 'mock-humanity' ? 'mock' : 'local-credential',
        CHAIN_ID: String(CHAIN_ID),
        NODE_ENV: 'development',
        ...(humanityProvider === 'mock-humanity'
          ? { MOCK_HUMANITY_BUNDLE_PATH: bundleFixture.bundlePath }
          : { CREDENTIAL_BUNDLE_PATH: bundleFixture.bundlePath }),
      } as NodeJS.ProcessEnv,
      isNullifierSpent: async () => false,
      isProofReserved: async (proofMetadata) =>
        db.hasActiveIssuedMintProofSignature(proofMetadata, Math.floor(Date.now() / 1000)),
    }),
    mintTtlSeconds: MINT_TTL_SECONDS,
    db,
    resolveSmartAccount,
  });

  return {
    app,
    db,
    bundle: bundleFixture.bundle,
    cleanupBundle: bundleFixture.cleanup,
  };
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

async function closeApp(
  app: FastifyInstance,
  db: PhilDatabase,
  cleanupBundle: () => void
) {
  await app.close();
  db.close();
  cleanupBundle();
}

describe('/request-mint local proving flow', () => {
  it('rejects mint proof requests without an auth token', async () => {
    const wallet = ethers.Wallet.createRandom();
    const { app, db, cleanupBundle } = await createApp({ [wallet.address]: 1 });

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
      await closeApp(app, db, cleanupBundle);
    }
  });

  it('rejects using a token for one recipient to request a proof for another', async () => {
    const walletA = ethers.Wallet.createRandom();
    const walletB = ethers.Wallet.createRandom();
    const { app, db, cleanupBundle } = await createApp({
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
      await closeApp(app, db, cleanupBundle);
    }
  });

  it('rejects a mintTo that does not match the deterministic smart account', async () => {
    const wallet = ethers.Wallet.createRandom();
    const { app, db, cleanupBundle } = await createApp({ [wallet.address]: 1 });

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
      await closeApp(app, db, cleanupBundle);
    }
  });

  it('supports direct mint binding when the resolver returns the recipient EOA', async () => {
    const wallet = ethers.Wallet.createRandom();
    const { app, db, cleanupBundle } = await createApp(
      { [wallet.address]: 1 },
      async (recipient: string) => resolveLegacyMintRecipient(recipient)
    );

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
          mintTo: wallet.address,
          philId: 1,
          paletteVariant: 4,
        },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({
        success: true,
        kind: 'mint',
        mintToComputed: resolveLegacyMintRecipient(wallet.address),
      });
    } finally {
      await closeApp(app, db, cleanupBundle);
    }
  });

  it('returns local proving inputs and reserves the eligibility credential exactly once', async () => {
    const wallet = ethers.Wallet.createRandom();
    const { app, db, bundle, cleanupBundle } = await createApp({ [wallet.address]: 1 });

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
      const claimHash = computeClaimHash({
        programHash: PROGRAM_HASH,
        proofContext: BigInt(PROOF_CONTEXT),
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
      const proof = buildProofPayload({
        programHash: PROGRAM_HASH,
        proofContext: BigInt(PROOF_CONTEXT),
        recipient: wallet.address,
        claimHash,
        claimKind: 1,
        verifierConfigHash: bundle.verifierConfigHash,
        secret: body.provingRequest.credentialSecret,
        expiry,
      });

      expect(body.success).toBe(true);
      expect(body.kind).toBe('mint');
      expect(body.mintToComputed).toBe(mintToComputed);
      expect(body.proofId).toMatch(/^proof_[a-f0-9]+$/);
      expect(body.claimHash).toBe(claimHash.toLowerCase());
      expect(body.proof).toEqual({
        expiry: body.expiry,
        factHash: proof.factHash,
        signature: proof.signature,
      });
      expect(body.provingRequest).toMatchObject({
        schema: 'zkphil-local-proof-request-v3',
        provingMode: 'scarb-stwo',
        provider: 'local-credential-commitment',
        providerMode: 'local-credential',
        kind: 'mint',
        claimKind: 1,
        recipient: wallet.address.toLowerCase(),
        claimHash: claimHash.toLowerCase(),
        expectedFactHash: proof.factHash,
        expectedProofMetadata: proof.signature,
        programHash: PROGRAM_HASH,
        identitySource: {
          kind: 'recipient',
        },
      });
      expect(Number(expiry)).toBeGreaterThanOrEqual(before + MINT_TTL_SECONDS);
      expect(Number(expiry)).toBeLessThanOrEqual(after + MINT_TTL_SECONDS + 1);

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
        code: 'ELIGIBILITY_EXHAUSTED',
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
        humanityProvider: 'local-credential',
      });
    } finally {
      await closeApp(app, db, cleanupBundle);
    }
  });

  it('returns mock-humanity proving inputs and reserves a mock human across wallets', async () => {
    const walletA = ethers.Wallet.createRandom();
    const walletB = ethers.Wallet.createRandom();
    const { app, db, cleanupBundle } = await createApp(
      {},
      resolveSmartAccountForRecipient,
      {
        humanityProvider: 'mock-humanity',
        mockHumanIds: ['atlas', 'briar'],
      }
    );

    try {
      const tokenA = await authenticate(app, walletA);
      const first = await app.inject({
        method: 'POST',
        url: '/request-mint',
        headers: {
          authorization: `Bearer ${tokenA}`,
        },
        payload: {
          recipient: walletA.address,
          mockHumanId: 'atlas',
          philId: 2,
          paletteVariant: 5,
        },
      });

      expect(first.statusCode).toBe(200);
      expect(first.json()).toMatchObject({
        success: true,
        humanityProvider: 'mock-humanity',
        mockHumanId: 'atlas',
        provingRequest: {
          schema: 'zkphil-local-proof-request-v3',
          provider: 'mock-humanity',
          providerMode: 'mock-humanity',
          mockHumanId: 'atlas',
          identitySource: {
            kind: 'mock-human',
            mockHumanId: 'atlas',
          },
        },
      });

      const tokenB = await authenticate(app, walletB);
      const second = await app.inject({
        method: 'POST',
        url: '/request-mint',
        headers: {
          authorization: `Bearer ${tokenB}`,
        },
        payload: {
          recipient: walletB.address,
          mockHumanId: 'atlas',
          philId: 3,
          paletteVariant: 4,
        },
      });

      expect(second.statusCode).toBe(403);
      expect(second.json()).toMatchObject({
        success: false,
        code: 'MOCK_HUMAN_ALREADY_USED',
      });
    } finally {
      await closeApp(app, db, cleanupBundle);
    }
  });

  it('requires mockHumanId when mock-humanity mode is active', async () => {
    const wallet = ethers.Wallet.createRandom();
    const { app, db, cleanupBundle } = await createApp(
      {},
      resolveSmartAccountForRecipient,
      {
        humanityProvider: 'mock-humanity',
        mockHumanIds: ['atlas'],
      }
    );

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
          philId: 1,
          paletteVariant: 1,
        },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json()).toMatchObject({
        success: false,
        code: 'MOCK_HUMAN_ID_REQUIRED',
      });
    } finally {
      await closeApp(app, db, cleanupBundle);
    }
  });

  it('hard-rejects action proofs other than ACTION_ACCOUNT_CREATE', async () => {
    const wallet = ethers.Wallet.createRandom();
    const { app, db, cleanupBundle } = await createApp({ [wallet.address]: 1 });

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
      });
    } finally {
      await closeApp(app, db, cleanupBundle);
    }
  });

  it('does not lose the eligibility credential if proof persistence fails', async () => {
    const wallet = ethers.Wallet.createRandom();
    const { app, db, cleanupBundle } = await createApp({ [wallet.address]: 1 });

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
        humanityProvider: 'local-credential',
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
    } finally {
      await closeApp(app, db, cleanupBundle);
    }
  });
});
