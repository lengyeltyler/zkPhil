/**
 * Compute Account Route
 *
 * Computes the deterministic Smart Account address for a given
 * EOA address and STARK public key by calling the on-chain factory's
 * getPhilAddress() function.
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { ethers } from 'ethers';

interface ComputeAccountBody {
  eoa: string;           // EOA address (0x...)
  starkPubKeyX: string;  // STARK public key X-coordinate (hex uint256)
  createProof?: {
    expiry: string;
    factHash: string;
    signature: string;
  };
}

interface ComputeAccountResponse {
  success: boolean;
  smartAccount?: string;
  eoa?: string;
  starkPubKeyX?: string;
  chainId?: number;
  factoryAddress?: string;
  salt?: string;
  initCodeHash?: string;
  createActionHash?: string;
  error?: string;
}

export interface ComputeAccountConfig {
  factoryAddress: string;
  provider: ethers.Provider;
}

const FACTORY_ABI = [
  'function getPhilAddress(address owner, uint256 starkPubKeyX) view returns (address)',
  'function computeSalt(address owner, uint256 starkPubKeyX) pure returns (bytes32)',
  'function computeCreateActionHash(address owner, uint256 starkPubKeyX) view returns (bytes32)',
  'function createPhilAccount(address owner, uint256 starkPubKeyX, (uint256 expiry, bytes32 factHash, bytes signature) proof) returns (address)',
];

export default async function computeAccountRoute(
  fastify: FastifyInstance,
  config: ComputeAccountConfig
) {
  const { factoryAddress, provider } = config;
  const factory = new ethers.Contract(factoryAddress, FACTORY_ABI, provider);
  const normalizedFactoryAddress = ethers.getAddress(factoryAddress);

  fastify.post<{ Body: ComputeAccountBody }>(
    '/compute-account',
    {
      schema: {
        body: {
          type: 'object',
          required: ['eoa', 'starkPubKeyX'],
          additionalProperties: false,
          properties: {
            eoa: { type: 'string', pattern: '^0x[a-fA-F0-9]{40}$' },
            starkPubKeyX: { type: 'string', pattern: '^0x[a-fA-F0-9]+$' },
            createProof: {
              type: 'object',
              additionalProperties: false,
              properties: {
                expiry: { type: 'string', pattern: '^0x[a-fA-F0-9]+$|^[0-9]+$' },
                factHash: { type: 'string', pattern: '^0x[a-fA-F0-9]{64}$' },
                signature: { type: 'string', pattern: '^0x([a-fA-F0-9]{2})+$' },
              },
            },
          },
        },
        response: {
          200: {
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              smartAccount: { type: 'string' },
              eoa: { type: 'string' },
              starkPubKeyX: { type: 'string' },
              chainId: { type: 'number' },
              factoryAddress: { type: 'string' },
              salt: { type: 'string' },
              initCodeHash: { type: 'string' },
              createActionHash: { type: 'string' },
            },
          },
          400: {
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              error: { type: 'string' },
            },
          },
        },
      },
    },
    async (
      request: FastifyRequest<{ Body: ComputeAccountBody }>,
      reply: FastifyReply
    ): Promise<ComputeAccountResponse> => {
      const { eoa, starkPubKeyX, createProof } = request.body;

      try {
        const normalizedEoa = ethers.getAddress(eoa);
        const normalizedStarkPubKeyX = ethers.toBeHex(BigInt(starkPubKeyX));
        const [smartAccount, salt, createActionHash, network] = await Promise.all([
          factory.getPhilAddress(normalizedEoa, normalizedStarkPubKeyX),
          factory.computeSalt(normalizedEoa, normalizedStarkPubKeyX),
          factory.computeCreateActionHash(normalizedEoa, normalizedStarkPubKeyX),
          provider.getNetwork(),
        ]);

        let initCodeHash: string | undefined;
        if (createProof) {
          const initCallData = factory.interface.encodeFunctionData('createPhilAccount', [
            normalizedEoa,
            normalizedStarkPubKeyX,
            {
              expiry: BigInt(createProof.expiry),
              factHash: ethers.zeroPadValue(createProof.factHash, 32),
              signature: createProof.signature,
            },
          ]);
          const initCode = ethers.concat([normalizedFactoryAddress, initCallData]);
          initCodeHash = ethers.keccak256(initCode);
        }

        fastify.log.info({
          msg: 'Smart Account address computed',
          chainId: Number(network.chainId),
          factoryAddress: normalizedFactoryAddress,
          owner: normalizedEoa,
          starkPubKeyX: normalizedStarkPubKeyX,
          salt,
          initCodeHash,
          createActionHash,
          smartAccount,
        });

        return {
          success: true,
          smartAccount,
          eoa: normalizedEoa,
          starkPubKeyX: normalizedStarkPubKeyX,
          chainId: Number(network.chainId),
          factoryAddress: normalizedFactoryAddress,
          salt,
          initCodeHash,
          createActionHash,
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
