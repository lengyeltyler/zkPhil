import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { ethers } from 'ethers';
import { AllowlistAccessError, AllowlistProvider } from '../lib/allowlist.js';
import { IssuedMintProofRecord, PhilDatabase } from '../lib/db.js';
import { SmartAccountResolver } from '../lib/philAccount.js';
import {
  computeActionClaimHash,
  computeMintClaimHash,
  computeProofFactHash,
} from '../lib/proofHash.js';

const ACTION_ACCOUNT_CREATE = 2;

interface BaseProofBody {
  kind?: 'mint' | 'action';
  recipient: string;
}

interface MintProofBody extends BaseProofBody {
  kind?: 'mint';
  mintTo?: string;
  philId: number;
  paletteVariant: number;
  mixMode?: number;
  mixSeed?: number;
}

interface ActionProofBody extends BaseProofBody {
  kind: 'action';
  expiry: string | number;
  actionType: number;
  actionHash: string;
}

type RequestMintBody = MintProofBody | ActionProofBody;

interface MintProofPayload {
  expiry: string;
  factHash: string;
  signature: string;
}

interface RequestMintSuccess {
  success: true;
  kind: 'mint' | 'action';
  recipient: string;
  claimHash: string;
  expiry: string;
  factHash: string;
  signature: string;
  proof: MintProofPayload;
  mintToComputed?: string;
  proofId?: string;
  actionType?: number;
  actionHash?: string;
}

interface RequestMintFailure {
  success: false;
  code: string;
  error: string;
}

type RequestMintResponse = RequestMintSuccess | RequestMintFailure;

export interface RouteConfig {
  dropId: string;
  programHash: string;
  chainId: number;
  proofGateAddress: string;
  allowlistProvider: AllowlistProvider;
  allowlistSignerKey: string;
  mintTtlSeconds: number;
  db: PhilDatabase;
  resolveSmartAccount: SmartAccountResolver;
}

function normalizeHexUint256(value: string | number | bigint): string {
  const parsed = typeof value === 'bigint'
    ? value
    : typeof value === 'number'
      ? BigInt(value)
      : BigInt(value);
  if (parsed < 0n) throw new Error('Negative uint256 is invalid');
  return `0x${parsed.toString(16).padStart(64, '0')}`;
}

function normalizeAddress(value: string): string {
  return ethers.getAddress(value).toLowerCase();
}

function normalizeBytes32(value: string): string {
  return ethers.zeroPadValue(value, 32).toLowerCase();
}

function normalizeSignature(value: string): string {
  return ethers.hexlify(value).toLowerCase();
}

function normalizeExpiry(value: string | number): bigint {
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || value < 0) {
      throw new Error('expiry must be a non-negative number');
    }
    return BigInt(Math.trunc(value));
  }
  return BigInt(value);
}

function currentUnixTimeSeconds(): bigint {
  return BigInt(Math.floor(Date.now() / 1000));
}

function currentUnixTimeSecondsNumber(): number {
  return Math.floor(Date.now() / 1000);
}

function extractBearerToken(headerValue: string | undefined): string | null {
  if (!headerValue) return null;
  const match = headerValue.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : null;
}

function successPayload(
  kind: 'mint' | 'action',
  recipient: string,
  claimHash: string,
  proof: MintProofPayload,
  extra?: {
    actionType?: number;
    actionHash?: string;
    mintToComputed?: string;
    proofId?: string;
  }
): RequestMintSuccess {
  return {
    success: true,
    kind,
    recipient,
    claimHash: claimHash.toLowerCase(),
    expiry: proof.expiry,
    factHash: proof.factHash,
    signature: proof.signature,
    proof,
    ...extra,
  };
}

export default async function requestMintRoute(
  fastify: FastifyInstance,
  config: RouteConfig
) {
  const dropId = BigInt(config.dropId);
  const programHash = normalizeBytes32(config.programHash);
  const proofGateAddress = normalizeAddress(config.proofGateAddress);
  const chainId = BigInt(config.chainId);
  const allowlistProvider = config.allowlistProvider;
  const allowlistSigner = new ethers.Wallet(config.allowlistSignerKey);
  const mintTtlSeconds = BigInt(Math.max(1, config.mintTtlSeconds));
  const db = config.db;
  const resolveSmartAccount = config.resolveSmartAccount;

  function getAuthRecipient(
    request: FastifyRequest,
    expectedRecipient: string
  ):
    | { recipient: string }
    | { statusCode: number; body: RequestMintFailure } {
    const token = extractBearerToken(request.headers.authorization);
    if (!token) {
      return {
        statusCode: 401,
        body: {
          success: false,
          code: 'AUTH_REQUIRED',
          error: 'Authorization bearer token is required',
        },
      };
    }

    const session = db.getAuthSession(token, currentUnixTimeSecondsNumber());
    if (!session) {
      return {
        statusCode: 401,
        body: {
          success: false,
          code: 'AUTH_INVALID',
          error: 'Authorization token is missing, expired, or invalid',
        },
      };
    }

    if (session.recipient !== expectedRecipient.toLowerCase()) {
      return {
        statusCode: 403,
        body: {
          success: false,
          code: 'AUTH_RECIPIENT_MISMATCH',
          error: 'Authorization token does not match the requested recipient',
        },
      };
    }

    return { recipient: session.recipient };
  }

  fastify.get<{ Querystring: { address: string } }>(
    '/eligibility',
    {
      schema: {
        querystring: {
          type: 'object',
          required: ['address'],
          additionalProperties: false,
          properties: {
            address: { type: 'string', pattern: '^0x[a-fA-F0-9]{40}$' },
          },
        },
      },
    },
    async (request, reply) => {
      try {
        const recipient = normalizeAddress(request.query.address);
        return await allowlistProvider.getEligibility(dropId.toString(), recipient);
      } catch (error) {
        fastify.log.error(error);
        return reply.status(500).send({
          eligible: false,
          remaining: 0,
        });
      }
    }
  );

  fastify.post<{ Body: { recipient: string } }>(
    '/eligibility',
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
    async (request, reply) => {
      try {
        const recipient = normalizeAddress(request.body.recipient);
        return await allowlistProvider.getEligibility(dropId.toString(), recipient);
      } catch (error) {
        fastify.log.error(error);
        return reply.status(500).send({
          eligible: false,
          remaining: 0,
        });
      }
    }
  );

  fastify.post<{ Body: RequestMintBody }>(
    '/request-mint',
    {
      schema: {
        body: {
          type: 'object',
          required: ['recipient'],
          additionalProperties: false,
          properties: {
            kind: { type: 'string', enum: ['mint', 'action'] },
            recipient: { type: 'string', pattern: '^0x[a-fA-F0-9]{40}$' },
            expiry: {
              anyOf: [
                { type: 'string', pattern: '^0x[a-fA-F0-9]+$|^[0-9]+$' },
                { type: 'number' },
              ],
            },
            mintTo: { type: 'string', pattern: '^0x[a-fA-F0-9]{40}$' },
            philId: { type: 'integer', minimum: 0, maximum: 255 },
            paletteVariant: { type: 'integer', minimum: 0, maximum: 255 },
            mixMode: { type: 'integer', minimum: 0, maximum: 255 },
            mixSeed: { type: 'integer', minimum: 0, maximum: 4294967295 },
            actionType: { type: 'integer', minimum: 1, maximum: 255 },
            actionHash: { type: 'string', pattern: '^0x[a-fA-F0-9]{64}$' },
          },
        },
      },
    },
    async (
      request: FastifyRequest<{ Body: RequestMintBody }>,
      reply: FastifyReply
    ): Promise<RequestMintResponse> => {
      try {
        const kind = request.body.kind === 'action' ? 'action' : 'mint';
        const recipient = normalizeAddress(request.body.recipient);
        const auth = getAuthRecipient(request, recipient);
        if ('statusCode' in auth) {
          return reply.status(auth.statusCode).send(auth.body);
        }

        if (kind === 'action') {
          const body = request.body as ActionProofBody;
          if (body.actionType == null || !body.actionHash) {
            return reply.status(400).send({
              success: false,
              code: 'ACTION_FIELDS_REQUIRED',
              error: 'actionType and actionHash are required for action proofs',
            });
          }
          if (body.expiry == null) {
            return reply.status(400).send({
              success: false,
              code: 'ACTION_EXPIRY_REQUIRED',
              error: 'expiry is required for action proofs',
            });
          }
          if (body.actionType !== ACTION_ACCOUNT_CREATE) {
            return reply.status(400).send({
              success: false,
              code: 'ACTION_PROOF_DISABLED',
              error:
                'Only ACTION_ACCOUNT_CREATE (2) is supported. Execution approvals are unlock-ticket-only and are not issued by backend.',
            });
          }

          const expiry = normalizeExpiry(body.expiry);
          const claimHash = computeActionClaimHash({
            programHash,
            dropId,
            chainId,
            proofGateAddress,
            recipient,
            actionType: body.actionType,
            actionHash: body.actionHash,
            expiry,
          });
          const signature = normalizeSignature(
            await allowlistSigner.signMessage(ethers.getBytes(claimHash))
          );
          const proof = {
            expiry: normalizeHexUint256(expiry).toLowerCase(),
            factHash: computeProofFactHash(claimHash),
            signature,
          };

          return successPayload('action', recipient, claimHash, proof, {
            actionType: body.actionType,
            actionHash: normalizeBytes32(body.actionHash),
          });
        }

        const body = request.body as MintProofBody;
        if (body.philId == null || body.paletteVariant == null) {
          return reply.status(400).send({
            success: false,
            code: 'MINT_FIELDS_REQUIRED',
            error: 'philId and paletteVariant are required for mint proofs',
          });
        }

        const mintToComputed = normalizeAddress(await resolveSmartAccount(recipient));
        if (body.mintTo != null) {
          const requestedMintTo = normalizeAddress(body.mintTo);
          if (requestedMintTo !== mintToComputed) {
            return reply.status(400).send({
              success: false,
              code: 'MINT_TO_MISMATCH',
              error: 'mintTo must match the deterministic PhilAccount for the authenticated recipient',
            });
          }
        }

        const mixMode = Number(body.mixMode ?? 0);
        const mixSeed = Number(body.mixSeed ?? 0);
        const expiry = currentUnixTimeSeconds() + mintTtlSeconds;
        const claimHash = computeMintClaimHash({
          programHash,
          dropId,
          chainId,
          proofGateAddress,
          recipient,
          mintTo: mintToComputed,
          philId: Number(body.philId),
          paletteVariant: Number(body.paletteVariant),
          mixMode,
          mixSeed,
          expiry,
        });
        const signature = normalizeSignature(
          await allowlistSigner.signMessage(ethers.getBytes(claimHash))
        );

        const proof = {
          expiry: normalizeHexUint256(expiry).toLowerCase(),
          factHash: computeProofFactHash(claimHash),
          signature,
        };
        const proofId = `proof_${ethers.hexlify(ethers.randomBytes(16)).slice(2).toLowerCase()}`;
        const issuedAt = currentUnixTimeSecondsNumber();
        const issuedMintProof: IssuedMintProofRecord = {
          proofId,
          recipient,
          mintTo: mintToComputed,
          philId: Number(body.philId),
          paletteVariant: Number(body.paletteVariant),
          mixMode,
          mixSeed,
          expiry: proof.expiry,
          claimHash: claimHash.toLowerCase(),
          factHash: proof.factHash,
          signature: proof.signature,
          issuedAt,
          expiresAt: Number(expiry),
          paymasterSignedAt: null,
          usedAt: null,
        };

        try {
          if (typeof allowlistProvider.consumeMintAndPersistProof === 'function') {
            await allowlistProvider.consumeMintAndPersistProof(
              dropId.toString(),
              recipient,
              issuedMintProof
            );
          } else {
            await allowlistProvider.consumeMint(dropId.toString(), recipient);
            db.createIssuedMintProof(issuedMintProof);
          }
        } catch (error) {
          if (error instanceof AllowlistAccessError) {
            return reply.status(error.statusCode).send({
              success: false,
              code: error.code,
              error: error.message,
            });
          }
          throw error;
        }

        return successPayload('mint', recipient, claimHash, proof, {
          mintToComputed,
          proofId,
        });
      } catch (error) {
        fastify.log.error(error);
        return reply.status(500).send({
          success: false,
          code: 'INTERNAL_ERROR',
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }
  );
}
