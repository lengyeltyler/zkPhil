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
  });

  const status = await collectSepoliaStatus(
    {
      RPC_URL_SEPOLIA: 'https://rpc.example',
      PAYMASTER_SIGNER: '0xB00000000000000000000000000000000000000B',
      STARKNET_CORE: '0xC00000000000000000000000000000000000000C',
      L2_UNLOCK_VERIFIER: '0x1234',
    },
    tempRoot,
    { requireLive: false }
  );

  assert.equal(status.reused.exists, true);
  assert.equal(status.mutable.identityProof.exists, true);
  assert.equal(status.mutable.accountAbstraction.exists, true);
  assert.equal(status.config.readable, true);
  assert.equal(status.errors.length, 0);
  assert.equal(status.liveVerification.skipped, true);
  assert.match(
    status.warnings.join('\n'),
    /live Sepolia verification will be skipped/i
  );
});

test('collectSepoliaStatus fails when live verification is required but env is incomplete', async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'zkphil-sepolia-status-'));
  const status = await collectSepoliaStatus({}, tempRoot, { requireLive: true });

  assert.equal(status.liveVerification.skipped, true);
  assert.ok(status.errors.length > 0);
});
