import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { ethers } from 'ethers';

import { PhilDatabase } from '../lib/db.js';

interface RegisterProofBody {
  proofId?: string;
  proof: {
    expiry: string;
    factHash: string;
    signature: string;
  };
}

interface RegisterProofResponse {
  success: boolean;
  factHash?: string;
  registered?: boolean;
  code?: string;
  error?: string;
}

export interface RegisterProofRouteConfig {
  chainId: number;
  provider: ethers.Provider;
  factRegistryAddress: string;
  factRegistryOperatorKey?: string;
  db: PhilDatabase;
}

export default async function registerProofRoute(
  fastify: FastifyInstance,
  config: RegisterProofRouteConfig
) {
  const isLocalChain = Number(config.chainId) === 31337;
  const normalizedRegistry = ethers.getAddress(config.factRegistryAddress);
  const operatorKey = String(config.factRegistryOperatorKey || '').trim();
  const signer = isLocalChain && operatorKey
    ? new ethers.Wallet(operatorKey, config.provider)
    : null;

  fastify.post<{ Body: RegisterProofBody }>(
    '/register-proof',
    {
      schema: {
        body: {
          type: 'object',
          required: ['proof'],
          additionalProperties: false,
          properties: {
            proofId: { type: 'string' },
            proof: {
              type: 'object',
              required: ['expiry', 'factHash', 'signature'],
              additionalProperties: false,
              properties: {
                expiry: { type: 'string', pattern: '^0x[a-fA-F0-9]+$|^[0-9]+$' },
                factHash: { type: 'string', pattern: '^0x[a-fA-F0-9]{64}$' },
                signature: { type: 'string', pattern: '^0x([a-fA-F0-9]{2})*$' },
              },
            },
          },
        },
      },
    },
    async (
      request: FastifyRequest<{ Body: RegisterProofBody }>,
      reply: FastifyReply
    ): Promise<RegisterProofResponse> => {
      if (!isLocalChain) {
        return reply.status(501).send({
          success: false,
          code: 'PROOF_REGISTRATION_UNAVAILABLE',
          error: 'Local fact registration is only available on chainId 31337. Use an external fact registry on public networks.',
        });
      }
      if (!signer) {
        return reply.status(500).send({
          success: false,
          code: 'FACT_REGISTRY_OPERATOR_MISSING',
          error: 'FACT_REGISTRY_OPERATOR_KEY must be configured for local fact registration.',
        });
      }

      const factHash = ethers.zeroPadValue(request.body.proof.factHash, 32).toLowerCase();
      if (request.body.proofId) {
        const proofRecord = config.db.getIssuedMintProof(
          request.body.proofId,
          Math.floor(Date.now() / 1000)
        );
        if (!proofRecord) {
          return reply.status(404).send({
            success: false,
            code: 'PROOF_NOT_FOUND',
            error: 'proofId is unknown or expired',
          });
        }
        if (
          proofRecord.factHash !== factHash ||
          proofRecord.signature !== request.body.proof.signature.toLowerCase()
        ) {
          return reply.status(400).send({
            success: false,
            code: 'PROOF_PAYLOAD_MISMATCH',
            error: 'Submitted proof payload does not match the issued proving request',
          });
        }
      }

      const registry = new ethers.Contract(
        normalizedRegistry,
        ['function registerFact(bytes32 fact) external'],
        signer
      );

      const tx = await registry.registerFact(factHash);
      await tx.wait();

      return {
        success: true,
        registered: true,
        factHash,
      };
    }
  );
}
