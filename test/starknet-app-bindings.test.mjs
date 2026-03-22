import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  readStarknetAppBindings,
  resolveUnlockSenderSource,
  writeStarknetAppBindings,
} from '../shared/deploy/starknetAppBindings.mjs';

test('writeStarknetAppBindings emits a complete Starknet app binding manifest', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'zkphil-starknet-bindings-'));

  writeStarknetAppBindings({
    l1ChainId: 11155111,
    rootDir: tempRoot,
    sourceScript: 'scripts/starknet/deploy_unlock_sender.mjs',
    unlockSender: '0x1234',
    owner: '0x5678',
    l1Recipient: '0xA00000000000000000000000000000000000000A',
  });

  const manifest = readStarknetAppBindings({
    l1ChainId: 11155111,
    rootDir: tempRoot,
  });

  assert.equal(manifest.exists, true);
  assert.equal(manifest.classification, 'complete');
  assert.equal(manifest.contracts.unlockSender, '0x1234');
  assert.equal(manifest.bindings.l1Recipient, '0xA00000000000000000000000000000000000000A');
  assert.equal(manifest.bindings.payloadVersion, 'zkphil-unlock-ticket-v1');
  assert.equal(manifest.bindings.constraintsHashEncoding, 'bytes32-hi-lo-128');
});

test('readStarknetAppBindings marks missing recipient bindings as partial', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'zkphil-starknet-bindings-'));

  fs.mkdirSync(path.join(tempRoot, 'config', 'starknet-app-bindings'), { recursive: true });
  fs.writeFileSync(
    path.join(tempRoot, 'config', 'starknet-app-bindings', 'sepolia.json'),
    JSON.stringify({
      schema: 'zkphil-starknet-app-bindings-v1',
      contracts: {
        unlockSender: '0x1234',
        owner: '0x5678',
      },
      bindings: {
        payloadVersion: 'zkphil-unlock-ticket-v1',
        constraintsHashEncoding: 'bytes32-hi-lo-128',
      },
    }, null, 2)
  );

  const manifest = readStarknetAppBindings({
    l1ChainId: 11155111,
    rootDir: tempRoot,
  });

  assert.equal(manifest.classification, 'partial');
  assert.match(manifest.blockers.join('\n'), /Missing L1 unlock inbox recipient binding/);
});

test('resolveUnlockSenderSource falls back from the 4337 manifest to Starknet app bindings', () => {
  const resolved = resolveUnlockSenderSource({
    envSender: '',
    envLegacyAlias: '',
    aaManifestSender: '',
    starknetAppSender: '0x1234',
    aaManifestPath: '/tmp/4337_11155111.json',
    starknetAppManifestPath: '/tmp/starknet-app-bindings/sepolia.json',
  });

  assert.equal(resolved.value, '0x1234');
  assert.equal(
    resolved.source,
    'manifest:/tmp/starknet-app-bindings/sepolia.json#contracts.unlockSender'
  );
});
