import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { ethers } from 'ethers';

import { EligibilityAccessError, EligibilityProvider } from '../lib/eligibility.js';
import { IssuedMintProofRecord, PhilDatabase } from '../lib/db.js';
import { SmartAccountResolver } from '../lib/philAccount.js';
import {
  buildProofPayload,
  computeActionClaimHash,
  computeClaimHash,
} from '../../../shared/proof/localStarkProver.mjs';

const ACTION_ACCOUNT_CREATE = 2;

interface BaseProofBody {
  kind?: 'mint' | 'action';
  recipient: string;
  mockHumanId?: string;
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

interface ProvingRequestPayload {
  schema: 'zkphil-local-proof-request-v3';
  provingMode: 'scarb-stwo';
  provider: 'local-credential-commitment' | 'mock-humanity';
  providerMode: 'local-credential' | 'mock-humanity';
  kind: 'mint' | 'action';
  claimKind: number;
  recipient: string;
  verifierConfigHash: string;
  credentialSecret?: string;
  humanitySecret?: string;
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
  claimHash: string;
  expectedFactHash: string;
  expectedProofMetadata: string;
  expectedIdentityNullifier: string;
  expectedCredentialCommitment: string;
  expectedHumanityCommitment?: string;
  programHash: string;
  proofContext: string;
  expiry: string;
  mockHumanId?: string;
  mockHumanIdHash?: string;
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
  provingRequest: ProvingRequestPayload;
  mintToComputed?: string;
  proofId?: string;
  actionType?: number;
  actionHash?: string;
  humanityProvider?: string;
  mockHumanId?: string;
}

interface RequestMintFailure {
  success: false;
  code: string;
  error: string;
}

type RequestMintResponse = RequestMintSuccess | RequestMintFailure;

export interface RouteConfig {
  proofContext: string;
  programHash: string;
  chainId: number;
  proofGateAddress: string;
  eligibilityProvider: EligibilityProvider;
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
  provingRequest: ProvingRequestPayload,
  extra?: {
    actionType?: number;
    actionHash?: string;
    mintToComputed?: string;
    proofId?: string;
    humanityProvider?: string;
    mockHumanId?: string;
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
    provingRequest,
    ...extra,
  };
}

export default async function requestMintRoute(
  fastify: FastifyInstance,
  config: RouteConfig
) {
  const proofContext = BigInt(config.proofContext);
  const programHash = normalizeBytes32(config.programHash);
  const proofGateAddress = normalizeAddress(config.proofGateAddress);
  const chainId = BigInt(config.chainId);
  const eligibilityProvider = config.eligibilityProvider;
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
        return await eligibilityProvider.getEligibility(proofContext.toString(), recipient, 1);
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
        return await eligibilityProvider.getEligibility(proofContext.toString(), recipient, 1);
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
            mockHumanId: { type: 'string', pattern: '^[a-zA-Z0-9_-]{1,64}$' },
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
            proofContext,
            chainId,
            proofGateAddress,
            recipient,
            actionType: body.actionType,
            actionHash: body.actionHash,
            expiry,
          });
          const credential = await eligibilityProvider.selectCredential(
            proofContext.toString(),
            recipient,
            body.actionType,
            {
              mockHumanId: body.mockHumanId,
            }
          );
          const proofPayload = await buildProofPayload({
            programHash,
            proofContext,
            recipient,
            claimHash,
            claimKind: body.actionType,
            verifierConfigHash: credential.verifierConfigHash,
            secret: credential.humanitySecret ?? credential.credentialSecret,
            expiry,
            providerMode: credential.providerMode,
            identitySubject: credential.identitySource.value,
            mockHumanIdHash: credential.mockHumanIdHash,
          });
          const proof = {
            expiry: normalizeHexUint256(expiry).toLowerCase(),
            factHash: proofPayload.factHash,
            signature: proofPayload.signature.toLowerCase(),
          };
          const provingRequest: ProvingRequestPayload = {
            schema: 'zkphil-local-proof-request-v3',
            provingMode: 'scarb-stwo',
            provider: credential.provider,
            providerMode: credential.providerMode,
            kind,
            claimKind: body.actionType,
            recipient,
            verifierConfigHash: normalizeHexUint256(credential.verifierConfigHash),
            credentialSecret: credential.credentialSecret != null
              ? normalizeHexUint256(credential.credentialSecret)
              : undefined,
            humanitySecret: credential.humanitySecret != null
              ? normalizeHexUint256(credential.humanitySecret)
              : undefined,
            commitmentWitness: {
              commitmentRoot: normalizeHexUint256(credential.commitmentWitness.commitmentRoot),
              siblings: credential.commitmentWitness.siblings.map(normalizeHexUint256),
              pathIndices: credential.commitmentWitness.pathIndices,
            },
            identitySource: {
              kind: credential.identitySource.kind,
              value: normalizeHexUint256(credential.identitySource.value),
              label: credential.identitySource.label,
              ...(credential.identitySource.mockHumanId
                ? { mockHumanId: credential.identitySource.mockHumanId }
                : {}),
            },
            claimHash: claimHash.toLowerCase(),
            expectedFactHash: proof.factHash,
            expectedProofMetadata: proof.signature,
            expectedIdentityNullifier: normalizeHexUint256(proofPayload.publicOutputs.identityNullifier),
            expectedCredentialCommitment: normalizeHexUint256(proofPayload.publicOutputs.credentialCommitment),
            expectedHumanityCommitment: credential.providerMode === 'mock-humanity'
              ? normalizeHexUint256(proofPayload.publicOutputs.credentialCommitment)
              : undefined,
            programHash,
            proofContext: normalizeHexUint256(proofContext),
            expiry: proof.expiry,
            mockHumanId: credential.mockHumanId,
            mockHumanIdHash: credential.mockHumanIdHash != null
              ? normalizeHexUint256(credential.mockHumanIdHash)
              : undefined,
          };

          return successPayload('action', recipient, claimHash, proof, provingRequest, {
            actionType: body.actionType,
            actionHash: normalizeBytes32(body.actionHash),
            humanityProvider: credential.providerMode,
            mockHumanId: credential.mockHumanId,
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
        const claimHash = computeClaimHash({
          programHash,
          proofContext,
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
        const credential = await eligibilityProvider.selectCredential(
          proofContext.toString(),
          recipient,
          1,
          {
            mockHumanId: body.mockHumanId,
          }
        );
        const proofPayload = await buildProofPayload({
          programHash,
          proofContext,
          recipient,
          claimHash,
          claimKind: 1,
          verifierConfigHash: credential.verifierConfigHash,
          secret: credential.humanitySecret ?? credential.credentialSecret,
          expiry,
          providerMode: credential.providerMode,
          identitySubject: credential.identitySource.value,
          mockHumanIdHash: credential.mockHumanIdHash,
        });

        const proof = {
          expiry: normalizeHexUint256(expiry).toLowerCase(),
          factHash: proofPayload.factHash,
          signature: proofPayload.signature.toLowerCase(),
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
        db.createIssuedMintProof(issuedMintProof);

        const provingRequest: ProvingRequestPayload = {
          schema: 'zkphil-local-proof-request-v3',
          provingMode: 'scarb-stwo',
          provider: credential.provider,
          providerMode: credential.providerMode,
          kind,
          claimKind: 1,
          recipient,
          verifierConfigHash: normalizeHexUint256(credential.verifierConfigHash),
          credentialSecret: credential.credentialSecret != null
            ? normalizeHexUint256(credential.credentialSecret)
            : undefined,
          humanitySecret: credential.humanitySecret != null
            ? normalizeHexUint256(credential.humanitySecret)
            : undefined,
          commitmentWitness: {
            commitmentRoot: normalizeHexUint256(credential.commitmentWitness.commitmentRoot),
            siblings: credential.commitmentWitness.siblings.map(normalizeHexUint256),
            pathIndices: credential.commitmentWitness.pathIndices,
          },
          identitySource: {
            kind: credential.identitySource.kind,
            value: normalizeHexUint256(credential.identitySource.value),
            label: credential.identitySource.label,
            ...(credential.identitySource.mockHumanId
              ? { mockHumanId: credential.identitySource.mockHumanId }
              : {}),
          },
          claimHash: claimHash.toLowerCase(),
          expectedFactHash: proof.factHash,
          expectedProofMetadata: proof.signature,
          expectedIdentityNullifier: normalizeHexUint256(proofPayload.publicOutputs.identityNullifier),
          expectedCredentialCommitment: normalizeHexUint256(proofPayload.publicOutputs.credentialCommitment),
          expectedHumanityCommitment: credential.providerMode === 'mock-humanity'
            ? normalizeHexUint256(proofPayload.publicOutputs.credentialCommitment)
            : undefined,
          programHash,
          proofContext: normalizeHexUint256(proofContext),
          expiry: proof.expiry,
          mockHumanId: credential.mockHumanId,
          mockHumanIdHash: credential.mockHumanIdHash != null
            ? normalizeHexUint256(credential.mockHumanIdHash)
            : undefined,
        };

        return successPayload('mint', recipient, claimHash, proof, provingRequest, {
          mintToComputed,
          proofId,
          humanityProvider: credential.providerMode,
          mockHumanId: credential.mockHumanId,
        });
      } catch (error) {
        if (error instanceof EligibilityAccessError) {
          return reply.status(error.statusCode).send({
            success: false,
            code: error.code,
            error: error.message,
          });
        }
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
