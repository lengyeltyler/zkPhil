import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  MUTABLE_STACK_ACCOUNT_ABSTRACTION,
  MUTABLE_STACK_IDENTITY_PROOF,
  readMutableStackManifest,
  writeMutableStackManifest,
} from '../shared/deploy/mutableStackManifest.mjs';

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2));
}

test('readMutableStackManifest normalizes legacy identity-proof aliases and leftovers', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'zkphil-mutable-stack-'));

  writeJson(path.join(tempRoot, 'deployments', 'stark_11155111.json'), {
    ProofGate: '0x1000000000000000000000000000000000000001',
    ProofGateTest13: '0x1000000000000000000000000000000000000001',
    PhilTestMint: '0x2000000000000000000000000000000000000002',
    dropId: '13',
    allowlistSigner: '0x3000000000000000000000000000000000000003',
    ProofMode: 'BACKEND_SIGNER_ONLY',
  });

  const manifest = readMutableStackManifest({
    stack: MUTABLE_STACK_IDENTITY_PROOF,
    chainId: 11155111,
    rootDir: tempRoot,
  });

  assert.equal(manifest.classification, 'partial');
  assert.equal(manifest.components.PhilIdentityGate, '0x1000000000000000000000000000000000000001');
  assert.equal(manifest.components.PhilIdentityMint, '0x2000000000000000000000000000000000000002');
  assert.equal(manifest.resolvedFrom.components.PhilIdentityGate, 'ProofGate');
  assert.equal(manifest.resolvedFrom.components.PhilIdentityMint, 'PhilTestMint');
  assert.deepEqual(manifest.legacyFieldsPresent, [
    'ProofGateTest13',
    'PhilTestMint',
    'dropId',
    'allowlistSigner',
  ]);
  assert.match(manifest.blockers.join('\n'), /Legacy ProofMode=BACKEND_SIGNER_ONLY/);
});

test('writeMutableStackManifest emits a complete structured 4337 manifest', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'zkphil-mutable-stack-'));

  const writeResult = writeMutableStackManifest({
    stack: MUTABLE_STACK_ACCOUNT_ABSTRACTION,
    chainId: 11155111,
    rootDir: tempRoot,
    sourceScript: 'scripts/deploy_4337.mjs',
    components: {
      PhilAccountImpl: '0x1000000000000000000000000000000000000001',
      PhilUnlockInbox: '0x2000000000000000000000000000000000000002',
      PhilAccountFactory: '0x3000000000000000000000000000000000000003',
      PhilPaymaster: '0x4000000000000000000000000000000000000004',
    },
    dependencies: {
      EntryPoint: '0x5000000000000000000000000000000000000005',
      PhilIdentityMint: '0x6000000000000000000000000000000000000006',
      PhilIdentityGate: '0x7000000000000000000000000000000000000007',
    },
    config: {
      paymasterSigner: '0x8000000000000000000000000000000000000008',
      starknetCore: '0x9000000000000000000000000000000000000009',
      l2UnlockVerifier: '0x1234',
      paymasterDeposit: '0.1',
      useMockInbox: false,
    },
  });

  const manifest = readMutableStackManifest({
    stack: MUTABLE_STACK_ACCOUNT_ABSTRACTION,
    chainId: 11155111,
    rootDir: tempRoot,
  });

  assert.equal(writeResult.payload.schema, 'zkphil-mutable-stack-v1');
  assert.equal(manifest.classification, 'complete');
  assert.equal(manifest.schema, 'zkphil-mutable-stack-v1');
  assert.equal(manifest.sourceScript, 'scripts/deploy_4337.mjs');
  assert.equal(manifest.config.paymasterSigner, '0x8000000000000000000000000000000000000008');
  assert.equal(manifest.config.starknetCore, '0x9000000000000000000000000000000000000009');
  assert.equal(manifest.config.l2UnlockVerifier, '0x1234');
  assert.deepEqual(manifest.blockers, []);
});

test('readMutableStackManifest marks non-local mock inbox 4337 manifests as placeholder-configured', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'zkphil-mutable-stack-'));

  writeJson(path.join(tempRoot, 'deployments', '4337_11155111.json'), {
    schema: 'zkphil-mutable-stack-v1',
    stack: 'account-abstraction',
    chainId: 11155111,
    components: {
      PhilAccountFactory: '0x1000000000000000000000000000000000000001',
      PhilPaymaster: '0x2000000000000000000000000000000000000002',
      PhilUnlockInbox: '0x3000000000000000000000000000000000000003',
      MockStarknetCore: '0x4000000000000000000000000000000000000004',
    },
    dependencies: {
      PhilIdentityMint: '0x5000000000000000000000000000000000000005',
      PhilIdentityGate: '0x6000000000000000000000000000000000000006',
      EntryPoint: '0x7000000000000000000000000000000000000007',
    },
    config: {
      paymasterSigner: '0x8000000000000000000000000000000000000008',
      starknetCore: '0x4000000000000000000000000000000000000004',
      l2UnlockVerifier: '0',
      useMockInbox: true,
    },
  });

  const manifest = readMutableStackManifest({
    stack: MUTABLE_STACK_ACCOUNT_ABSTRACTION,
    chainId: 11155111,
    rootDir: tempRoot,
  });

  assert.equal(manifest.classification, 'placeholder-configured');
  assert.deepEqual(manifest.placeholderConfig, ['l2UnlockVerifier', 'useMockInbox']);
  assert.match(
    manifest.blockers.join('\n'),
    /useMockInbox=true is DEV\/TEST ONLY/
  );
});

test('writeMutableStackManifest omits empty inactive verifier aliases from identity-proof manifests', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'zkphil-mutable-stack-'));

  const { payload } = writeMutableStackManifest({
    stack: MUTABLE_STACK_IDENTITY_PROOF,
    chainId: 11155111,
    rootDir: tempRoot,
    sourceScript: 'scripts/deploy_stark.mjs',
    components: {
      PhilIdentityGate: '0x1000000000000000000000000000000000000001',
      PhilIdentityMint: '0x2000000000000000000000000000000000000002',
      humanityVerifier: '0x3000000000000000000000000000000000000003',
    },
    dependencies: {
      factRegistry: '0x4000000000000000000000000000000000000004',
    },
    config: {
      humanityProvider: 'local-credential',
      proofMode: 'LOCAL_STWO_FACTS',
    },
  });

  assert.equal(payload.ProofGate, '0x1000000000000000000000000000000000000001');
  assert.equal(payload.FactRegistryHumanityVerifier, '0x3000000000000000000000000000000000000003');
  assert.equal('MockHumanityVerifier' in payload, false);
});
