import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { ethers } from 'ethers';

import { readVerifySepoliaBindingsConfig } from '../scripts/verify_sepolia_bindings.mjs';

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
      entryPointV07: '0x8000000000000000000000000000000000000008',
      starknetCore: '0x5000000000000000000000000000000000000005',
    },
    notes: {
      l2UnlockSender: 'deploy app-specific Starknet sender separately',
    },
  });
}

function writeStarknetAppBindings(tempRoot, overrides = {}) {
  writeJson(path.join(tempRoot, 'config', 'starknet-app-bindings', 'sepolia.json'), {
    schema: 'zkphil-starknet-app-bindings-v1',
    deploymentType: 'starknet-app-binding',
    starknetNetwork: 'sepolia',
    l1ChainId: 11155111,
    sourceScript: 'scripts/starknet/deploy_unlock_sender.mjs',
    contracts: {
      unlockSender: '0x1234',
      owner: '0x5678',
    },
    bindings: {
      l1Recipient: '0x7000000000000000000000000000000000000007',
      payloadVersion: 'zkphil-unlock-ticket-v1',
      constraintsHashEncoding: 'bytes32-hi-lo-128',
    },
    ...overrides,
  });
}

test('readVerifySepoliaBindingsConfig resolves the active Sepolia manifest set', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'verify-sepolia-'));
  const deploymentsDir = path.join(tempRoot, 'deployments');
  fs.mkdirSync(deploymentsDir, { recursive: true });
  writeStableProtocolBindings(tempRoot);
  writeStarknetAppBindings(tempRoot);

  const paymasterWallet = ethers.Wallet.createRandom();

  writeJson(path.join(deploymentsDir, 'stark_11155111.json'), {
    PhilIdentityGate: '0x1000000000000000000000000000000000000001',
    PhilIdentityMint: '0x2000000000000000000000000000000000000002',
    factRegistry: '0x9000000000000000000000000000000000000009',
  });
  writeJson(path.join(deploymentsDir, '4337_11155111.json'), {
    PhilAccountFactory: '0x3000000000000000000000000000000000000003',
    PhilPaymaster: '0x4000000000000000000000000000000000000004',
    EntryPoint: '0x8000000000000000000000000000000000000008',
  });

  const config = readVerifySepoliaBindingsConfig(
    {
      RPC_URL: 'https://rpc.invalid',
      CHAIN_ID: '11155111',
      STARKNET_RPC_URL: 'https://starknet.invalid',
      PAYMASTER_SIGNER_KEY: paymasterWallet.privateKey,
    },
    tempRoot
  );

  assert.equal(config.configuredChainId, 11155111);
  assert.equal(config.proofGateAddress, '0x1000000000000000000000000000000000000001');
  assert.equal(config.philIdentityMintAddress, '0x2000000000000000000000000000000000000002');
  assert.equal(config.philAccountFactoryAddress, '0x3000000000000000000000000000000000000003');
  assert.equal(config.paymasterAddress, '0x4000000000000000000000000000000000000004');
  assert.equal(config.factRegistryAddress, '0x9000000000000000000000000000000000000009');
  assert.equal(config.entryPointAddress, '0x8000000000000000000000000000000000000008');
  assert.equal(config.paymasterSignerAddress, paymasterWallet.address);
  assert.equal(config.starknetCoreAddress, '0x5000000000000000000000000000000000000005');
  assert.equal(config.l2UnlockSender, 0x1234n);
});

test('readVerifySepoliaBindingsConfig fails closed when Starknet bindings are missing', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'verify-sepolia-'));
  const deploymentsDir = path.join(tempRoot, 'deployments');
  fs.mkdirSync(deploymentsDir, { recursive: true });

  writeJson(path.join(deploymentsDir, 'stark_11155111.json'), {
    PhilIdentityGate: '0x1000000000000000000000000000000000000001',
    PhilIdentityMint: '0x2000000000000000000000000000000000000002',
    factRegistry: '0x3000000000000000000000000000000000000003',
  });
  writeJson(path.join(deploymentsDir, '4337_11155111.json'), {
    PhilAccountFactory: '0x4000000000000000000000000000000000000004',
    PhilPaymaster: '0x5000000000000000000000000000000000000005',
    EntryPoint: '0x8000000000000000000000000000000000000008',
  });

  assert.throws(
    () =>
      readVerifySepoliaBindingsConfig(
        {
          RPC_URL: 'https://rpc.invalid',
          CHAIN_ID: '11155111',
          PAYMASTER_SIGNER: '0x6000000000000000000000000000000000000006',
          L2_UNLOCK_SENDER: '0x1234',
        },
        tempRoot
      ),
    /STARKNET_CORE|Starknet app binding manifest/
  );

  assert.throws(
    () =>
      readVerifySepoliaBindingsConfig(
        {
          RPC_URL: 'https://rpc.invalid',
          CHAIN_ID: '11155111',
          PAYMASTER_SIGNER: '0x6000000000000000000000000000000000000006',
        },
        tempRoot
      ),
    /L2_UNLOCK_SENDER/
  );
});

test('readVerifySepoliaBindingsConfig can resolve mutable 4337 config from the manifest', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'verify-sepolia-'));
  const deploymentsDir = path.join(tempRoot, 'deployments');
  fs.mkdirSync(deploymentsDir, { recursive: true });
  writeStableProtocolBindings(tempRoot);
  writeStarknetAppBindings(tempRoot);

  writeJson(path.join(deploymentsDir, 'stark_11155111.json'), {
    schema: 'zkphil-mutable-stack-v1',
    stack: 'identity-proof',
    chainId: 11155111,
    components: {
      PhilIdentityGate: '0x1000000000000000000000000000000000000001',
      PhilIdentityMint: '0x2000000000000000000000000000000000000002',
      humanityVerifier: '0x3000000000000000000000000000000000000003',
    },
    dependencies: {
      factRegistry: '0x4000000000000000000000000000000000000004',
    },
    config: {},
    PhilIdentityGate: '0x1000000000000000000000000000000000000001',
    PhilIdentityMint: '0x2000000000000000000000000000000000000002',
    humanityVerifier: '0x3000000000000000000000000000000000000003',
    factRegistry: '0x4000000000000000000000000000000000000004',
  });
  writeJson(path.join(deploymentsDir, '4337_11155111.json'), {
    schema: 'zkphil-mutable-stack-v1',
    stack: 'account-abstraction',
    chainId: 11155111,
    components: {
      PhilAccountFactory: '0x5000000000000000000000000000000000000005',
      PhilPaymaster: '0x6000000000000000000000000000000000000006',
      PhilUnlockInbox: '0x7000000000000000000000000000000000000007',
    },
    dependencies: {
      PhilIdentityMint: '0x2000000000000000000000000000000000000002',
      PhilIdentityGate: '0x1000000000000000000000000000000000000001',
      EntryPoint: '0x8000000000000000000000000000000000000008',
    },
    config: {
      paymasterSigner: '0x9000000000000000000000000000000000000009',
      starknetCore: '0xA00000000000000000000000000000000000000A',
      l2UnlockSender: '0x1234',
    },
    PhilAccountFactory: '0x5000000000000000000000000000000000000005',
    PhilPaymaster: '0x6000000000000000000000000000000000000006',
    PhilUnlockInbox: '0x7000000000000000000000000000000000000007',
    PhilIdentityMint: '0x2000000000000000000000000000000000000002',
    PhilIdentityGate: '0x1000000000000000000000000000000000000001',
    EntryPoint: '0x8000000000000000000000000000000000000008',
    paymasterSigner: '0x9000000000000000000000000000000000000009',
    starknetCore: '0xA00000000000000000000000000000000000000A',
    l2UnlockSender: '0x1234',
  });

  const config = readVerifySepoliaBindingsConfig(
    {
      RPC_URL: 'https://rpc.invalid',
      CHAIN_ID: '11155111',
      STARKNET_RPC_URL: 'https://starknet.invalid',
    },
    tempRoot
  );

  assert.equal(config.paymasterSignerAddress, '0x9000000000000000000000000000000000000009');
  assert.equal(config.entryPointAddress, '0x8000000000000000000000000000000000000008');
  assert.equal(config.starknetCoreAddress, '0xA00000000000000000000000000000000000000A');
  assert.equal(config.l2UnlockSender, 0x1234n);
});

test('readVerifySepoliaBindingsConfig accepts the legacy env alias for compatibility', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'verify-sepolia-'));
  const deploymentsDir = path.join(tempRoot, 'deployments');
  fs.mkdirSync(deploymentsDir, { recursive: true });
  writeStableProtocolBindings(tempRoot);
  writeStarknetAppBindings(tempRoot);

  writeJson(path.join(deploymentsDir, 'stark_11155111.json'), {
    PhilIdentityGate: '0x1000000000000000000000000000000000000001',
    PhilIdentityMint: '0x2000000000000000000000000000000000000002',
    factRegistry: '0x4000000000000000000000000000000000000004',
  });
  writeJson(path.join(deploymentsDir, '4337_11155111.json'), {
    PhilAccountFactory: '0x5000000000000000000000000000000000000005',
    PhilPaymaster: '0x6000000000000000000000000000000000000006',
    EntryPoint: '0x8000000000000000000000000000000000000008',
    paymasterSigner: '0x9000000000000000000000000000000000000009',
  });

  const config = readVerifySepoliaBindingsConfig(
    {
      RPC_URL: 'https://rpc.invalid',
      CHAIN_ID: '11155111',
      STARKNET_RPC_URL: 'https://starknet.invalid',
      L2_UNLOCK_VERIFIER: '0x1234',
    },
    tempRoot
  );

  assert.equal(config.l2UnlockSender, 0x1234n);
});

test('readVerifySepoliaBindingsConfig rejects zero L2 unlock sender values', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'verify-sepolia-'));
  const deploymentsDir = path.join(tempRoot, 'deployments');
  fs.mkdirSync(deploymentsDir, { recursive: true });
  writeStableProtocolBindings(tempRoot);
  writeStarknetAppBindings(tempRoot, {
    contracts: {
      unlockSender: '',
      owner: '0x5678',
    },
  });

  writeJson(path.join(deploymentsDir, 'stark_11155111.json'), {
    PhilIdentityGate: '0x1000000000000000000000000000000000000001',
    PhilIdentityMint: '0x2000000000000000000000000000000000000002',
    factRegistry: '0x4000000000000000000000000000000000000004',
  });
  writeJson(path.join(deploymentsDir, '4337_11155111.json'), {
    PhilAccountFactory: '0x5000000000000000000000000000000000000005',
    PhilPaymaster: '0x6000000000000000000000000000000000000006',
    EntryPoint: '0x8000000000000000000000000000000000000008',
    paymasterSigner: '0x9000000000000000000000000000000000000009',
    l2UnlockSender: '0',
  });

  assert.throws(
    () =>
      readVerifySepoliaBindingsConfig(
        {
          RPC_URL: 'https://rpc.invalid',
          CHAIN_ID: '11155111',
          STARKNET_RPC_URL: 'https://starknet.invalid',
        },
        tempRoot
      ),
    /config\.l2UnlockSender: Starknet felt must be non-zero|L2_UNLOCK_SENDER/
  );
});
