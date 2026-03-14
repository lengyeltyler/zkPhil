import crypto from 'node:crypto';
import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { ethers } from 'ethers';
import { PhilDatabase } from '../lib/db.js';

const CHALLENGE_TTL_SECONDS = 5 * 60;
const SESSION_TTL_SECONDS = 10 * 60;
const AUTH_TAG = 'TEST13_AUTH_V1';

interface ChallengeBody {
  recipient: string;
}

interface VerifyBody {
  recipient: string;
  nonce: string;
  signature: string;
}

export interface AuthRouteConfig {
  db: PhilDatabase;
  dropId: string;
  chainId: number;
  proofGateAddress: string;
}

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

function normalizeAddress(value: string): string {
  return ethers.getAddress(value).toLowerCase();
}

function buildChallengeMessage(input: {
  dropId: string;
  chainId: number;
  proofGateAddress: string;
  recipient: string;
  nonce: string;
  issuedAt: number;
  expiresAt: number;
}): string {
  return [
    AUTH_TAG,
    `dropId: ${input.dropId}`,
    `chainId: ${input.chainId}`,
    `proofGate: ${ethers.getAddress(input.proofGateAddress)}`,
    `recipient: ${ethers.getAddress(input.recipient)}`,
    `nonce: ${input.nonce}`,
    `issuedAt: ${input.issuedAt}`,
    `expiresAt: ${input.expiresAt}`,
  ].join('\n');
}

export default async function authRoute(
  fastify: FastifyInstance,
  config: AuthRouteConfig
) {
  const { db, dropId, chainId, proofGateAddress } = config;

  fastify.post<{ Body: ChallengeBody }>(
    '/auth/challenge',
    {
      schema: {
        body: {
          type: 'object',
          required: ['recipient'],
          additionalProperties: false,
          properties: {
            recipient: { type: 'string', pattern: '^0x[a-fA-F0-9]{40}$' },
          },
        },
      },
    },
    async (
      request: FastifyRequest<{ Body: ChallengeBody }>,
      reply: FastifyReply
    ) => {
      try {
        const recipient = normalizeAddress(request.body.recipient);
        const issuedAt = nowSeconds();
        const expiresAt = issuedAt + CHALLENGE_TTL_SECONDS;
        const nonce = `0x${crypto.randomBytes(16).toString('hex')}`;
        const message = buildChallengeMessage({
          dropId,
          chainId,
          proofGateAddress,
          recipient,
          nonce,
          issuedAt,
          expiresAt,
        });

        db.createAuthChallenge({
          nonce,
          recipient,
          message,
          issued_at: issuedAt,
          expires_at: expiresAt,
        });

        return {
          success: true,
          nonce,
          message,
          expiresAt,
        };
      } catch (error) {
        fastify.log.error(error);
        return reply.status(400).send({
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }
  );

  fastify.post<{ Body: VerifyBody }>(
    '/auth/verify',
    {
      schema: {
        body: {
          type: 'object',
          required: ['recipient', 'nonce', 'signature'],
          additionalProperties: false,
          properties: {
            recipient: { type: 'string', pattern: '^0x[a-fA-F0-9]{40}$' },
            nonce: { type: 'string', pattern: '^0x([a-fA-F0-9]{2})+$' },
            signature: { type: 'string', pattern: '^0x([a-fA-F0-9]{2})+$' },
          },
        },
      },
    },
    async (
      request: FastifyRequest<{ Body: VerifyBody }>,
      reply: FastifyReply
    ) => {
      try {
        const recipient = normalizeAddress(request.body.recipient);
        const nonce = request.body.nonce.toLowerCase();
        const now = nowSeconds();
        const challenge = db.consumeAuthChallenge(recipient, nonce, now);
        if (!challenge) {
          return reply.status(401).send({
            success: false,
            code: 'INVALID_CHALLENGE',
            error: 'Challenge is missing, expired, or already used',
          });
        }

        const recovered = normalizeAddress(
          ethers.verifyMessage(challenge.message, request.body.signature)
        );
        if (recovered !== recipient) {
          return reply.status(401).send({
            success: false,
            code: 'INVALID_SIGNATURE',
            error: 'Signature does not recover the requested recipient',
          });
        }

        const token = `pst_${crypto.randomBytes(24).toString('hex')}`;
        const expiresAt = now + SESSION_TTL_SECONDS;
        db.createAuthSession({
          token,
          recipient,
          issued_at: now,
          expires_at: expiresAt,
        });

        return {
          success: true,
          token,
          expiresAt,
        };
      } catch (error) {
        fastify.log.error(error);
        return reply.status(400).send({
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }
  );
}
