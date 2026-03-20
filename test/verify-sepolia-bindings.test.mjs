import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { ethers } from 'ethers';

import { readVerifySepoliaBindingsConfig } from '../scripts/verify_sepolia_bindings.mjs';

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2));
}

test('readVerifySepoliaBindingsConfig resolves the active Sepolia manifest set', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'verify-sepolia-'));
  const deploymentsDir = path.join(tempRoot, 'deployments');
  fs.mkdirSync(deploymentsDir, { recursive: true });

  const paymasterWallet = ethers.Wallet.createRandom();

  writeJson(path.join(deploymentsDir, 'stark_11155111.json'), {
    PhilIdentityGate: '0x1000000000000000000000000000000000000001',
    PhilIdentityMint: '0x2000000000000000000000000000000000000002',
    factRegistry: '0x9000000000000000000000000000000000000009',
  });
  writeJson(path.join(deploymentsDir, '4337_11155111.json'), {
    PhilAccountFactory: '0x3000000000000000000000000000000000000003',
    PhilPaymaster: '0x4000000000000000000000000000000000000004',
  });

  const config = readVerifySepoliaBindingsConfig(
    {
      RPC_URL: 'https://rpc.example',
      CHAIN_ID: '11155111',
      PAYMASTER_SIGNER_KEY: paymasterWallet.privateKey,
      STARKNET_CORE: '0x5000000000000000000000000000000000000005',
      L2_UNLOCK_VERIFIER: '0x1234',
    },
    tempRoot
  );

  assert.equal(config.configuredChainId, 11155111);
  assert.equal(config.proofGateAddress, '0x1000000000000000000000000000000000000001');
  assert.equal(config.philIdentityMintAddress, '0x2000000000000000000000000000000000000002');
  assert.equal(config.philAccountFactoryAddress, '0x3000000000000000000000000000000000000003');
  assert.equal(config.paymasterAddress, '0x4000000000000000000000000000000000000004');
  assert.equal(config.factRegistryAddress, '0x9000000000000000000000000000000000000009');
  assert.equal(config.paymasterSignerAddress, paymasterWallet.address);
  assert.equal(config.starknetCoreAddress, '0x5000000000000000000000000000000000000005');
  assert.equal(config.l2UnlockVerifier, 0x1234n);
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
  });

  assert.throws(
    () =>
      readVerifySepoliaBindingsConfig(
        {
          RPC_URL: 'https://rpc.example',
          CHAIN_ID: '11155111',
          PAYMASTER_SIGNER: '0x6000000000000000000000000000000000000006',
          L2_UNLOCK_VERIFIER: '0x1234',
        },
        tempRoot
      ),
    /STARKNET_CORE/
  );

  assert.throws(
    () =>
      readVerifySepoliaBindingsConfig(
        {
          RPC_URL: 'https://rpc.example',
          CHAIN_ID: '11155111',
          PAYMASTER_SIGNER: '0x6000000000000000000000000000000000000006',
          STARKNET_CORE: '0x7000000000000000000000000000000000000007',
        },
        tempRoot
      ),
    /L2_UNLOCK_VERIFIER/
  );
});
