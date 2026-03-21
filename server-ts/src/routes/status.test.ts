import { describe, expect, it } from 'vitest';
import Fastify from 'fastify';

import statusRoute from './status.js';

describe('/status', () => {
  it('returns the current provider-aware status fields', async () => {
    const app = Fastify();
    await app.register(statusRoute, {
      proofContext: 13n,
      programHash: '0x' + '44'.repeat(32),
      backendChainId: 31337,
      backendFactory: '0x1000000000000000000000000000000000000001',
      proofGateAddress: '0x2000000000000000000000000000000000000002',
      factRegistryAddress: '0x3000000000000000000000000000000000000003',
      paymasterAddress: '0x4000000000000000000000000000000000000004',
      backendNetwork: 'local',
      humanityProvider: 'mock-humanity',
      humanityProviderLabel: 'DEV/TEST mock humanity',
      humanityBridge: 'fact-registry',
      humanityProviderDevOnly: true,
      mockHumans: [{ mockHumanId: 'atlas', label: 'Atlas' }],
    });

    try {
      const res = await app.inject({
        method: 'GET',
        url: '/status',
      });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({
        status: 'ok',
        proofContext: '0x' + '0'.repeat(63) + 'd',
        backendChainId: 31337,
        backendFactory: '0x1000000000000000000000000000000000000001',
        proofGateAddress: '0x2000000000000000000000000000000000000002',
        factRegistryAddress: '0x3000000000000000000000000000000000000003',
        paymasterAddress: '0x4000000000000000000000000000000000000004',
        humanityProvider: 'mock-humanity',
        humanityProviderLabel: 'DEV/TEST mock humanity',
        humanityBridge: 'fact-registry',
        humanityProviderDevOnly: true,
      });
    } finally {
      await app.close();
    }
  });
});
