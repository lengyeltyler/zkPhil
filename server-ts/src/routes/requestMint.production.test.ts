import { describe, expect, it } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';
import { ethers } from 'ethers';

import authRoute from './auth.js';
import requestMintRoute from './requestMint.js';
import { createAllowlistProvider } from '../lib/allowlist.js';
import { PhilDatabase } from '../lib/db.js';

const DROP_ID = '13';
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
  const backendSigner = ethers.Wallet.createRandom();
  const db = new PhilDatabase(':memory:');
  const app = Fastify();
  const env = {
    ALLOWLIST_MODE: 'single_address',
    ALLOWLIST_SINGLE_ADDRESS: allowedAddress,
    ALLOWLIST_SLOTS_PER_DROP: '1',
    UNSAFE_DEV_ALLOWLIST: 'false',
  } as NodeJS.ProcessEnv;

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
    allowlistProvider: createAllowlistProvider({ db, env }),
    allowlistSignerKey: backendSigner.privateKey,
    mintTtlSeconds: 600,
    db,
    resolveSmartAccount: async (recipient: string) => resolveSmartAccountForRecipient(recipient),
  });

  return { app, db };
}

async function closeApp(app: FastifyInstance, db: PhilDatabase) {
  await app.close();
  db.close();
}

describe('production allowlist wiring', () => {
  it('allows the configured single address exactly once and rejects others', async () => {
    const allowlistedWallet = ethers.Wallet.createRandom();
    const nonAllowlistedWallet = ethers.Wallet.createRandom();
    const { app, db } = await createApp(allowlistedWallet.address);

    try {
      const allowlistedToken = await authenticate(app, allowlistedWallet);
      const first = await app.inject({
        method: 'POST',
        url: '/request-mint',
        headers: {
          authorization: `Bearer ${allowlistedToken}`,
        },
        payload: {
          recipient: allowlistedWallet.address,
          philId: 2,
          paletteVariant: 5,
        },
      });
      expect(first.statusCode).toBe(200);

      const second = await app.inject({
        method: 'POST',
        url: '/request-mint',
        headers: {
          authorization: `Bearer ${allowlistedToken}`,
        },
        payload: {
          recipient: allowlistedWallet.address,
          philId: 2,
          paletteVariant: 5,
        },
      });
      expect(second.statusCode).toBe(403);
      expect(second.json()).toMatchObject({
        success: false,
        code: 'ALLOWLIST_EXHAUSTED',
      });

      const nonAllowlistedToken = await authenticate(app, nonAllowlistedWallet);
      const outsider = await app.inject({
        method: 'POST',
        url: '/request-mint',
        headers: {
          authorization: `Bearer ${nonAllowlistedToken}`,
        },
        payload: {
          recipient: nonAllowlistedWallet.address,
          philId: 2,
          paletteVariant: 5,
        },
      });
      expect(outsider.statusCode).toBe(403);
      expect(outsider.json()).toMatchObject({
        success: false,
        code: 'ALLOWLIST_ADDRESS_NOT_ALLOWED',
      });
    } finally {
      await closeApp(app, db);
    }
  });

  it('allows at most one parallel request for the same wallet', async () => {
    const allowlistedWallet = ethers.Wallet.createRandom();
    const { app, db } = await createApp(allowlistedWallet.address);

    try {
      const token = await authenticate(app, allowlistedWallet);
      const requestPayload = {
        method: 'POST' as const,
        url: '/request-mint',
        headers: {
          authorization: `Bearer ${token}`,
        },
        payload: {
          recipient: allowlistedWallet.address,
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
        code: 'ALLOWLIST_EXHAUSTED',
      });
    } finally {
      await closeApp(app, db);
    }
  });
});
