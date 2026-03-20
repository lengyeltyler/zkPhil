import test from 'node:test';
import assert from 'node:assert/strict';

import {
  evaluateBackendCompatibility,
  buildBackendCompatibilityMessage,
} from '../shared/config/backendCompatibility.mjs';

test('backend compatibility fails on proof gate mismatch', () => {
  const result = evaluateBackendCompatibility({
    backendStatus: {
      backendChainId: 31337,
      backendFactory: '0x1000000000000000000000000000000000000001',
      proofGateAddress: '0x2000000000000000000000000000000000000002',
      paymasterAddress: '0x4000000000000000000000000000000000000004',
    },
    expectedChainId: 31337,
    expectedFactory: '0x1000000000000000000000000000000000000001',
    expectedProofGate: '0x9999999999999999999999999999999999999999',
    expectedPaymaster: '0x4000000000000000000000000000000000000004',
  });

  assert.equal(result.ok, false);
  assert.match(buildBackendCompatibilityMessage(result), /proofGateAddress=/);
});

test('backend compatibility fails on paymaster mismatch', () => {
  const result = evaluateBackendCompatibility({
    backendStatus: {
      backendChainId: 31337,
      backendFactory: '0x1000000000000000000000000000000000000001',
      proofGateAddress: '0x2000000000000000000000000000000000000002',
      paymasterAddress: '0x4000000000000000000000000000000000000004',
    },
    expectedChainId: 31337,
    expectedFactory: '0x1000000000000000000000000000000000000001',
    expectedProofGate: '0x2000000000000000000000000000000000000002',
    expectedPaymaster: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  });

  assert.equal(result.ok, false);
  assert.match(buildBackendCompatibilityMessage(result), /paymasterAddress=/);
});
