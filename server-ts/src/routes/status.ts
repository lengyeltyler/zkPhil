import { FastifyInstance } from 'fastify';

export interface StatusRouteConfig {
  proofContext: bigint;
  programHash: string;
  backendChainId: number;
  backendFactory: string;
  proofGateAddress: string;
  factRegistryAddress: string;
  paymasterAddress: string;
  backendNetwork: string;
  humanityProvider: string;
  humanityProviderLabel: string;
  humanityBridge: string;
  humanityProviderDevOnly: boolean;
  mockHumans?: Array<{
    mockHumanId: string;
    label: string;
  }>;
}

interface StatusResponse {
  status: 'ok';
  proofContext: string;
  programHash: string;
  backendChainId: number;
  backendFactory: string;
  proofGateAddress: string;
  factRegistryAddress: string;
  paymasterAddress: string;
  backendNetwork: string;
  humanityProvider: string;
  humanityProviderLabel: string;
  humanityBridge: string;
  humanityProviderDevOnly: boolean;
  mockHumans?: Array<{
    mockHumanId: string;
    label: string;
  }>;
}

export default async function statusRoute(
  fastify: FastifyInstance,
  config: StatusRouteConfig
) {
  const {
    proofContext,
    programHash,
    backendChainId,
    backendFactory,
    proofGateAddress,
    factRegistryAddress,
    paymasterAddress,
    backendNetwork,
    humanityProvider,
    humanityProviderLabel,
    humanityBridge,
    humanityProviderDevOnly,
    mockHumans,
  } = config;

  fastify.get('/status', async (): Promise<StatusResponse> => {
    return {
      status: 'ok',
      proofContext: `0x${proofContext.toString(16).padStart(64, '0')}`,
      programHash,
      backendChainId,
      backendFactory,
      proofGateAddress,
      factRegistryAddress,
      paymasterAddress,
      backendNetwork,
      humanityProvider,
      humanityProviderLabel,
      humanityBridge,
      humanityProviderDevOnly,
      mockHumans,
    };
  });

  fastify.get('/health', async () => {
    return { status: 'ok' };
  });
}
