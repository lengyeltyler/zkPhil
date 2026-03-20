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
import { buildEligibilityBundle } from '../../../shared/proof/eligibilityBundle.mjs';

const CONTEXT_ID = '13';
const PROGRAM_HASH = '0x' + '44'.repeat(32);
const PROOF_GATE = '0x1000000000000000000000000000000000000013';
const CHAIN_ID = 31337;

function resolveSmartAccountForRecipient(recipient: string): string {
  return ethers.getCreateAddress({
    from: ethers.getAddress(recipient),
    nonce: 1,
  }).toLowerCase();
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
  const challenge = challengeRes.json();

  const verifyRes = await app.inject({
    method: 'POST',
    url: '/auth/verify',
    payload: {
      recipient: wallet.address,
      nonce: challenge.nonce,
      signature: await wallet.signMessage(challenge.message),
    },
  });
  expect(verifyRes.statusCode).toBe(200);
  return verifyRes.json().token as string;
}

async function createApp(allowedAddress: string) {
  const db = new PhilDatabase(':memory:');
  const app = Fastify();
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zkphil-request-mint-production-'));
  const bundlePath = path.join(tempDir, 'eligibility-bundle.json');
  fs.writeFileSync(bundlePath, JSON.stringify(buildEligibilityBundle({
    contextId: CONTEXT_ID,
    entries: [{ recipient: allowedAddress, credentialSlot: 0 }],
    seed: 'request-mint-production-test',
  }), null, 2));

  await app.register(authRoute, {
    db,
    contextId: CONTEXT_ID,
    chainId: CHAIN_ID,
    proofGateAddress: PROOF_GATE,
  });

  await app.register(requestMintRoute, {
    contextId: CONTEXT_ID,
    programHash: PROGRAM_HASH,
    chainId: CHAIN_ID,
    proofGateAddress: PROOF_GATE,
    eligibilityProvider: createEligibilityProvider({
      env: {
        ELIGIBILITY_BUNDLE_PATH: bundlePath,
      } as NodeJS.ProcessEnv,
      isNullifierSpent: async () => false,
      isProofReserved: async (proofMetadata) =>
        db.hasActiveIssuedMintProofSignature(proofMetadata, Math.floor(Date.now() / 1000)),
    }),
    mintTtlSeconds: 600,
    db,
    resolveSmartAccount: async (recipient: string) => resolveSmartAccountForRecipient(recipient),
  });

  return {
    app,
    db,
    cleanupBundle() {
      fs.rmSync(tempDir, { recursive: true, force: true });
    },
  };
}

async function closeApp(app: FastifyInstance, db: PhilDatabase, cleanupBundle: () => void) {
  await app.close();
  db.close();
  cleanupBundle();
}

describe('production eligibility wiring', () => {
  it('allows the configured single address exactly once and rejects others', async () => {
    const eligibleWallet = ethers.Wallet.createRandom();
    const ineligibleWallet = ethers.Wallet.createRandom();
    const { app, db, cleanupBundle } = await createApp(eligibleWallet.address);

    try {
      const eligibleToken = await authenticate(app, eligibleWallet);
      const first = await app.inject({
        method: 'POST',
        url: '/request-mint',
        headers: {
          authorization: `Bearer ${eligibleToken}`,
        },
        payload: {
          recipient: eligibleWallet.address,
          philId: 2,
          paletteVariant: 5,
        },
      });
      expect(first.statusCode).toBe(200);

      const second = await app.inject({
        method: 'POST',
        url: '/request-mint',
        headers: {
          authorization: `Bearer ${eligibleToken}`,
        },
        payload: {
          recipient: eligibleWallet.address,
          philId: 2,
          paletteVariant: 5,
        },
      });
      expect(second.statusCode).toBe(403);
      expect(second.json()).toMatchObject({
        success: false,
        code: 'ELIGIBILITY_EXHAUSTED',
      });

      const ineligibleToken = await authenticate(app, ineligibleWallet);
      const outsider = await app.inject({
        method: 'POST',
        url: '/request-mint',
        headers: {
          authorization: `Bearer ${ineligibleToken}`,
        },
        payload: {
          recipient: ineligibleWallet.address,
          philId: 2,
          paletteVariant: 5,
        },
      });
      expect(outsider.statusCode).toBe(403);
      expect(outsider.json()).toMatchObject({
        success: false,
        code: 'ELIGIBILITY_ADDRESS_NOT_ALLOWED',
      });
    } finally {
      await closeApp(app, db, cleanupBundle);
    }
  });

  it('allows at most one parallel request for the same wallet', async () => {
    const eligibleWallet = ethers.Wallet.createRandom();
    const { app, db, cleanupBundle } = await createApp(eligibleWallet.address);

    try {
      const token = await authenticate(app, eligibleWallet);
      const requestPayload = {
        method: 'POST' as const,
        url: '/request-mint',
        headers: {
          authorization: `Bearer ${token}`,
        },
        payload: {
          recipient: eligibleWallet.address,
          philId: 2,
          paletteVariant: 5,
        },
      };

      const [first, second] = await Promise.all([
        app.inject(requestPayload),
        app.inject(requestPayload),
      ]);
      const successCount = [first, second].filter((res) => res.statusCode === 200).length;
      const failureCount = [first, second].filter((res) => res.statusCode === 403).length;

      expect(successCount).toBe(1);
      expect(failureCount).toBe(1);
      const failedResponse = [first, second].find((res) => res.statusCode === 403);
      expect(failedResponse?.json()).toMatchObject({
        success: false,
        code: 'ELIGIBILITY_EXHAUSTED',
      });
    } finally {
      await closeApp(app, db, cleanupBundle);
    }
  });
});
