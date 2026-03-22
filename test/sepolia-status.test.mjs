import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { collectSepoliaStatus } from '../scripts/sepolia/status.mjs';

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2));
}

function writeStableProtocolBindings(tempRoot) {
  writeJson(path.join(tempRoot, 'config', 'stable-protocol-bindings', 'sepolia.json'), {
    schema: 'zkphil-stable-protocol-bindings-v1',
    chainId: 11155111,
    stable: true,
    source: 'stable sepolia protocol',
    contracts: {
      entryPointV07: '0xB00000000000000000000000000000000000000B',
      starknetCore: '0xD00000000000000000000000000000000000000D',
    },
    notes: {
      l2UnlockSender: 'deploy app-specific Starknet sender separately',
    },
  });
}

test('collectSepoliaStatus reports reused and mutable manifests without requiring live RPC', async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'zkphil-sepolia-status-'));

  writeJson(path.join(tempRoot, 'config', 'stable-art-backends', 'sepolia.json'), {
    schema: 'zkphil-stable-art-backend-v1',
    chainId: 11155111,
    stable: true,
    source: 'stable sepolia',
    contracts: {
      svgStorage: '0x1000000000000000000000000000000000000001',
      layerRegistry: '0x2000000000000000000000000000000000000002',
      philNft: '0x3000000000000000000000000000000000000003',
    },
  });
  writeStableProtocolBindings(tempRoot);
  writeJson(path.join(tempRoot, 'deployments', 'stark_11155111.json'), {
    PhilIdentityGate: '0x4000000000000000000000000000000000000004',
    PhilIdentityMint: '0x5000000000000000000000000000000000000005',
    humanityVerifier: '0x6000000000000000000000000000000000000006',
    factRegistry: '0x7000000000000000000000000000000000000007',
  });
  writeJson(path.join(tempRoot, 'deployments', '4337_11155111.json'), {
    PhilAccountFactory: '0x8000000000000000000000000000000000000008',
    PhilPaymaster: '0x9000000000000000000000000000000000000009',
    PhilUnlockInbox: '0xA00000000000000000000000000000000000000A',
    PhilIdentityMint: '0x5000000000000000000000000000000000000005',
    PhilIdentityGate: '0x4000000000000000000000000000000000000004',
    EntryPoint: '0xB00000000000000000000000000000000000000B',
    paymasterSigner: '0xC00000000000000000000000000000000000000C',
    starknetCore: '0xD00000000000000000000000000000000000000D',
    l2UnlockSender: '0x1234',
  });

  const status = await collectSepoliaStatus(
    {
      RPC_URL_SEPOLIA: 'https://rpc.example',
      PAYMASTER_SIGNER: '0xE00000000000000000000000000000000000000E',
      STARKNET_CORE: '0xF00000000000000000000000000000000000000F',
      L2_UNLOCK_SENDER: '0x1234',
    },
    tempRoot,
    { requireLive: false }
  );

  assert.equal(status.reused.exists, true);
  assert.equal(status.protocol.exists, true);
  assert.equal(status.mutable.identityProof.exists, true);
  assert.equal(status.mutable.accountAbstraction.exists, true);
  assert.equal(status.mutable.identityProof.classification, 'complete');
  assert.equal(status.mutable.accountAbstraction.classification, 'complete');
  assert.equal(status.mutable.overallClassification, 'placeholder-configured');
  assert.equal(status.config.readable, true);
  assert.equal(status.errors.length, 0);
  assert.equal(status.liveVerification.skipped, true);
  assert.equal(status.protocol.contracts.entryPointV07, '0xB00000000000000000000000000000000000000B');
  assert.equal(status.env.paymasterSignerAddress.source, 'env:PAYMASTER_SIGNER');
  assert.equal(status.env.starknetCore.source, 'env:STARKNET_CORE');
  assert.match(
    status.warnings.join('\n'),
    /live Sepolia verification will be skipped/i
  );
});

test('collectSepoliaStatus fails when live verification is required but env is incomplete', async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'zkphil-sepolia-status-'));
  const status = await collectSepoliaStatus({}, tempRoot, { requireLive: true });

  assert.equal(status.mutable.overallClassification, 'missing');
  assert.equal(status.liveVerification.skipped, true);
  assert.ok(status.errors.length > 0);
});

test('collectSepoliaStatus accepts the legacy L2 unlock verifier env alias as compatibility input', async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'zkphil-sepolia-status-'));

  writeJson(path.join(tempRoot, 'config', 'stable-art-backends', 'sepolia.json'), {
    schema: 'zkphil-stable-art-backend-v1',
    chainId: 11155111,
    stable: true,
    source: 'stable sepolia',
    contracts: {
      svgStorage: '0x1000000000000000000000000000000000000001',
      layerRegistry: '0x2000000000000000000000000000000000000002',
      philNft: '0x3000000000000000000000000000000000000003',
    },
  });
  writeStableProtocolBindings(tempRoot);
  writeJson(path.join(tempRoot, 'deployments', 'stark_11155111.json'), {
    PhilIdentityGate: '0x4000000000000000000000000000000000000004',
    PhilIdentityMint: '0x5000000000000000000000000000000000000005',
    humanityVerifier: '0x6000000000000000000000000000000000000006',
    factRegistry: '0x7000000000000000000000000000000000000007',
  });
  writeJson(path.join(tempRoot, 'deployments', '4337_11155111.json'), {
    PhilAccountFactory: '0x8000000000000000000000000000000000000008',
    PhilPaymaster: '0x9000000000000000000000000000000000000009',
    PhilUnlockInbox: '0xA00000000000000000000000000000000000000A',
    PhilIdentityMint: '0x5000000000000000000000000000000000000005',
    PhilIdentityGate: '0x4000000000000000000000000000000000000004',
    EntryPoint: '0xB00000000000000000000000000000000000000B',
    paymasterSigner: '0xC00000000000000000000000000000000000000C',
    starknetCore: '0xD00000000000000000000000000000000000000D',
  });

  const status = await collectSepoliaStatus(
    {
      RPC_URL_SEPOLIA: 'https://rpc.example',
      PAYMASTER_SIGNER: '0xE00000000000000000000000000000000000000E',
      L2_UNLOCK_VERIFIER: '0x1234',
    },
    tempRoot,
    { requireLive: false }
  );

  assert.equal(status.env.l2UnlockSender.source, 'env:L2_UNLOCK_VERIFIER');
  assert.equal(status.env.l2UnlockSender.value, '0x1234');
});

test('collectSepoliaStatus classifies legacy Stark manifests as partial and surfaces leftovers', async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'zkphil-sepolia-status-'));

  writeJson(path.join(tempRoot, 'config', 'stable-art-backends', 'sepolia.json'), {
    schema: 'zkphil-stable-art-backend-v1',
    chainId: 11155111,
    stable: true,
    source: 'stable sepolia',
    contracts: {
      svgStorage: '0x1000000000000000000000000000000000000001',
      layerRegistry: '0x2000000000000000000000000000000000000002',
      philNft: '0x3000000000000000000000000000000000000003',
    },
  });
  writeStableProtocolBindings(tempRoot);
  writeJson(path.join(tempRoot, 'deployments', 'stark_11155111.json'), {
    ProofGate: '0x4000000000000000000000000000000000000004',
    ProofGateTest13: '0x4000000000000000000000000000000000000004',
    PhilTestMint: '0x5000000000000000000000000000000000000005',
    PhilSVGStorage: '0x1000000000000000000000000000000000000001',
    PhilLayerRegistry: '0x2000000000000000000000000000000000000002',
    PhilNFT: '0x3000000000000000000000000000000000000003',
    dropId: '13',
    allowlistSigner: '0x6000000000000000000000000000000000000006',
    ProofMode: 'BACKEND_SIGNER_ONLY',
  });

  const status = await collectSepoliaStatus(
    {
      RPC_URL: 'https://sepolia.example',
      PAYMASTER_SIGNER_KEY: '0x59c6995e998f97a5a0044966f0945382db1f29b5a9497f58dff5c29d3db4d62e',
    },
    tempRoot,
    { requireLive: false }
  );

  assert.equal(status.mutable.identityProof.classification, 'partial');
  assert.deepEqual(status.mutable.identityProof.legacyFieldsPresent, [
    'ProofGateTest13',
    'PhilTestMint',
    'dropId',
    'allowlistSigner',
  ]);
  assert.equal(status.mutable.identityProof.resolvedFrom.components.PhilIdentityGate, 'ProofGate');
  assert.equal(status.mutable.identityProof.resolvedFrom.components.PhilIdentityMint, 'PhilTestMint');
  assert.match(status.warnings.join('\n'), /Legacy ProofMode=BACKEND_SIGNER_ONLY/);
});

test('collectSepoliaStatus resolves Starknet core from stable protocol bindings when 4337 manifest is missing', async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'zkphil-sepolia-status-'));

  writeJson(path.join(tempRoot, 'config', 'stable-art-backends', 'sepolia.json'), {
    schema: 'zkphil-stable-art-backend-v1',
    chainId: 11155111,
    stable: true,
    source: 'stable sepolia',
    contracts: {
      svgStorage: '0x1000000000000000000000000000000000000001',
      layerRegistry: '0x2000000000000000000000000000000000000002',
      philNft: '0x3000000000000000000000000000000000000003',
    },
  });
  writeStableProtocolBindings(tempRoot);
  writeJson(path.join(tempRoot, 'deployments', 'stark_11155111.json'), {
    schema: 'zkphil-mutable-stack-v1',
    stack: 'identity-proof',
    chainId: 11155111,
    components: {
      PhilIdentityGate: '0x4000000000000000000000000000000000000004',
      PhilIdentityMint: '0x5000000000000000000000000000000000000005',
      humanityVerifier: '0x6000000000000000000000000000000000000006',
    },
    dependencies: {
      factRegistry: '0x7000000000000000000000000000000000000007',
    },
    config: {},
    PhilIdentityGate: '0x4000000000000000000000000000000000000004',
    PhilIdentityMint: '0x5000000000000000000000000000000000000005',
    humanityVerifier: '0x6000000000000000000000000000000000000006',
    factRegistry: '0x7000000000000000000000000000000000000007',
  });

  const status = await collectSepoliaStatus(
    {
      RPC_URL: 'https://sepolia.example',
      PAYMASTER_SIGNER_KEY: '0x59c6995e998f97a5a0044966f0945382db1f29b5a9497f58dff5c29d3db4d62e',
    },
    tempRoot,
    { requireLive: false }
  );

  assert.equal(status.env.entryPoint.source, `stable:${path.join(tempRoot, 'config', 'stable-protocol-bindings', 'sepolia.json')}#contracts.entryPointV07`);
  assert.equal(status.env.starknetCore.source, `stable:${path.join(tempRoot, 'config', 'stable-protocol-bindings', 'sepolia.json')}#contracts.starknetCore`);
  assert.match(status.warnings.join('\n'), /L2_UNLOCK_SENDER is missing or placeholder/);
  assert.doesNotMatch(status.warnings.join('\n'), /STARKNET_CORE is unresolved/);
});
