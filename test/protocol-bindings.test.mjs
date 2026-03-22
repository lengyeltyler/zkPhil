import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  getStableProtocolBindingsManifestPath,
  readStableProtocolBindings,
} from '../shared/deploy/protocolBindings.mjs';

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2));
}

test('getStableProtocolBindingsManifestPath resolves the tracked Sepolia manifest path', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'zkphil-protocol-bindings-'));
  assert.equal(
    getStableProtocolBindingsManifestPath(11155111, tempRoot),
    path.join(tempRoot, 'config', 'stable-protocol-bindings', 'sepolia.json')
  );
  assert.equal(getStableProtocolBindingsManifestPath(31337, tempRoot), '');
});

test('readStableProtocolBindings loads the tracked Sepolia binding manifest shape', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'zkphil-protocol-bindings-'));
  writeJson(path.join(tempRoot, 'config', 'stable-protocol-bindings', 'sepolia.json'), {
    schema: 'zkphil-stable-protocol-bindings-v1',
    chainId: 11155111,
    stable: true,
    source: 'stable sepolia protocol',
    contracts: {
      entryPointV07: '0x1000000000000000000000000000000000000001',
      starknetCore: '0x2000000000000000000000000000000000000002',
    },
    notes: {
      l2UnlockSender: 'app-specific',
    },
  });

  const manifest = readStableProtocolBindings({
    chainId: 11155111,
    rootDir: tempRoot,
  });

  assert.ok(manifest);
  assert.equal(manifest.entryPointV07Address, '0x1000000000000000000000000000000000000001');
  assert.equal(manifest.starknetCoreAddress, '0x2000000000000000000000000000000000000002');
  assert.equal(manifest.notes.l2UnlockSender, 'app-specific');
});
