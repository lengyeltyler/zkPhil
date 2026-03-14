import { FastifyInstance } from 'fastify';

export interface StatusRouteConfig {
  dropId: bigint;
  programHash: string;
  backendChainId: number;
  backendFactory: string;
  proofGateAddress: string;
  allowlistSigner: string;
  paymasterAddress: string;
  backendNetwork: string;
}

interface StatusResponse {
  status: 'ok';
  dropId: string;
  programHash: string;
  backendChainId: number;
  backendFactory: string;
  proofGateAddress: string;
  allowlistSigner: string;
  paymasterAddress: string;
  backendNetwork: string;
}

export default async function statusRoute(
  fastify: FastifyInstance,
  config: StatusRouteConfig
) {
  const {
    dropId,
    programHash,
    backendChainId,
    backendFactory,
    proofGateAddress,
    allowlistSigner,
    paymasterAddress,
    backendNetwork,
  } = config;

  fastify.get('/status', async (): Promise<StatusResponse> => {
    return {
      status: 'ok',
      dropId: `0x${dropId.toString(16).padStart(64, '0')}`,
      programHash,
      backendChainId,
      backendFactory,
      proofGateAddress,
      allowlistSigner,
      paymasterAddress,
      backendNetwork,
    };
  });

  fastify.get('/health', async () => {
    return { status: 'ok' };
  });
}
