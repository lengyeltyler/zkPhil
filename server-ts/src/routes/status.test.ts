import { describe, expect, it } from 'vitest';
import Fastify from 'fastify';

import statusRoute from './status.js';

describe('/status', () => {
  it('returns the expanded compatibility fields', async () => {
    const app = Fastify();
    await app.register(statusRoute, {
      contextId: 13n,
      programHash: '0x' + '44'.repeat(32),
      backendChainId: 31337,
      backendFactory: '0x1000000000000000000000000000000000000001',
      proofGateAddress: '0x2000000000000000000000000000000000000002',
      factRegistryAddress: '0x3000000000000000000000000000000000000003',
      paymasterAddress: '0x4000000000000000000000000000000000000004',
      backendNetwork: 'local',
    });

    try {
      const res = await app.inject({
        method: 'GET',
        url: '/status',
      });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({
        status: 'ok',
        contextId: '0x' + '0'.repeat(63) + 'd',
        backendChainId: 31337,
        backendFactory: '0x1000000000000000000000000000000000000001',
        proofGateAddress: '0x2000000000000000000000000000000000000002',
        factRegistryAddress: '0x3000000000000000000000000000000000000003',
        paymasterAddress: '0x4000000000000000000000000000000000000004',
      });
    } finally {
      await app.close();
    }
  });
});
