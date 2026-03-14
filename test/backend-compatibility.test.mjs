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
      allowlistSigner: '0x3000000000000000000000000000000000000003',
      paymasterAddress: '0x4000000000000000000000000000000000000004',
    },
    expectedChainId: 31337,
    expectedFactory: '0x1000000000000000000000000000000000000001',
    expectedProofGate: '0x9999999999999999999999999999999999999999',
    expectedAllowlistSigner: '0x3000000000000000000000000000000000000003',
    expectedPaymaster: '0x4000000000000000000000000000000000000004',
  });

  assert.equal(result.ok, false);
  assert.match(buildBackendCompatibilityMessage(result), /proofGateAddress=/);
});

test('backend compatibility fails on allowlist signer mismatch', () => {
  const result = evaluateBackendCompatibility({
    backendStatus: {
      backendChainId: 31337,
      backendFactory: '0x1000000000000000000000000000000000000001',
      proofGateAddress: '0x2000000000000000000000000000000000000002',
      allowlistSigner: '0x3000000000000000000000000000000000000003',
      paymasterAddress: '0x4000000000000000000000000000000000000004',
    },
    expectedChainId: 31337,
    expectedFactory: '0x1000000000000000000000000000000000000001',
    expectedProofGate: '0x2000000000000000000000000000000000000002',
    expectedAllowlistSigner: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    expectedPaymaster: '0x4000000000000000000000000000000000000004',
  });

  assert.equal(result.ok, false);
  assert.match(buildBackendCompatibilityMessage(result), /allowlistSigner=/);
});
