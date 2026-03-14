import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import ganache from 'ganache';
import { ethers } from 'ethers';

import { buildSharpProgram } from './build.mjs';
import { deploySharpStack } from './deploy.mjs';
import { generateSharpProofArtifact } from './prove.mjs';
import {
  E2E_JSON,
  PROOF_JSON,
  computeCallDataHash,
  signIntentHash,
} from './common.mjs';

const MNEMONIC = 'test test test test test test test test test test test junk';
const CHAIN_ID = 31337;
const SECOND_FACTOR_SECRET = process.env.SECOND_FACTOR_SECRET ?? 'sharp-local-2fa-secret';

function deriveWallet(provider, index) {
  const hd = ethers.HDNodeWallet.fromPhrase(MNEMONIC, undefined, `m/44'/60'/0'/0/${index}`);
  return hd.connect(provider);
}

async function expectRevert(promiseFactory, label) {
  let reverted = false;
  try {
    const tx = await promiseFactory();
    const receipt = await tx.wait();
    reverted = receipt?.status === 0 || receipt?.status === 0n;
  } catch {
    reverted = true;
  }
  if (!reverted) {
    throw new Error(`Expected revert for ${label}, but transaction succeeded`);
  }
}

export async function runE2E() {
  buildSharpProgram();

  const gProvider = ganache.provider({
    chain: { chainId: CHAIN_ID },
    wallet: { mnemonic: MNEMONIC, totalAccounts: 10, defaultBalance: 1000 },
    logging: { quiet: true },
  });

  const provider = new ethers.BrowserProvider(gProvider);

  try {
    const ownerWallet = deriveWallet(provider, 0);
    const relayerWallet = new ethers.NonceManager(deriveWallet(provider, 1));
    const chainId = BigInt((await provider.getNetwork()).chainId);
    const ownerNonce = await ownerWallet.getNonce();
    const predictedRegistry = ethers.getCreateAddress({ from: ownerWallet.address, nonce: ownerNonce });
    const predictedSharp = ethers.getCreateAddress({ from: ownerWallet.address, nonce: ownerNonce + 1 });
    const predictedDummy = ethers.getCreateAddress({ from: ownerWallet.address, nonce: ownerNonce + 2 });
    const dummyInterface = new ethers.Interface(['function setNumber(uint256 value_)']);
    const callData = dummyInterface.encodeFunctionData('setNumber', [1337n]);

    const proof = generateSharpProofArtifact({
      wallet: ownerWallet.address,
      smartAccount: predictedSharp,
      target: predictedDummy,
      callData,
      value: 0n,
      nonce: 0n,
      chainId,
      secondFactorSecret: SECOND_FACTOR_SECRET,
      outFile: PROOF_JSON,
    });

    const { deployment, contracts } = await deploySharpStack({
      signer: ownerWallet,
      owner: ownerWallet.address,
      secondFactorSecret: SECOND_FACTOR_SECRET,
      writeOutput: true,
    });

    assert.equal(deployment.factRegistry.toLowerCase(), predictedRegistry.toLowerCase(), 'Predicted registry mismatch');
    assert.equal(deployment.sharpAccount.toLowerCase(), predictedSharp.toLowerCase(), 'Predicted smart account mismatch');
    assert.equal(deployment.dummyTarget.toLowerCase(), predictedDummy.toLowerCase(), 'Predicted target mismatch');

    const sharp = contracts.sharpAccount.connect(relayerWallet);
    const registry = contracts.factRegistry.connect(ownerWallet);

    const contractComputedIntent = await contracts.sharpAccount.computeIntentHash(
      deployment.dummyTarget,
      computeCallDataHash(callData),
      0n,
      0n,
      chainId
    );
    assert.equal(
      contractComputedIntent.toLowerCase(),
      proof.publicInputs.intentHash.toLowerCase(),
      'Solidity intent hash must match proof input intent hash'
    );

    await (await registry.registerFact(proof.sharp.factHash)).wait();

    const signature = await signIntentHash({
      signer: ownerWallet,
      chainId,
      verifyingContract: deployment.sharpAccount,
      intentHash: proof.publicInputs.intentHash,
    });

    const executeTx = await sharp.execute(
      deployment.dummyTarget,
      0n,
      callData,
      signature,
      proof.publicInputs.intentHash
    );
    const executeReceipt = await executeTx.wait();

    assert.equal((await contracts.sharpAccount.nonce()).toString(), '1', 'Nonce must increment');
    assert.equal((await contracts.dummyTarget.number()).toString(), '1337', 'Dummy target must update');
    assert.equal(
      (await contracts.dummyTarget.lastCaller()).toLowerCase(),
      deployment.sharpAccount.toLowerCase(),
      'Smart account must be msg.sender of downstream call'
    );

    await expectRevert(
      () =>
        sharp.execute(
          deployment.dummyTarget,
          0n,
          callData,
          signature,
          proof.publicInputs.intentHash
        ),
      'replay'
    );

    const report = {
      schema: 'sharpAccountV1-e2e-report-v1',
      generatedAt: new Date().toISOString(),
      chainId: chainId.toString(),
      deployment,
      proof: {
        file: path.relative(path.resolve('.'), PROOF_JSON),
        intentHash: proof.publicInputs.intentHash,
        factHash: proof.sharp.factHash,
      },
      execute: {
        txHash: executeReceipt.hash,
        gasUsed: executeReceipt.gasUsed.toString(),
      },
      assertions: {
        nonce: (await contracts.sharpAccount.nonce()).toString(),
        dummyNumber: (await contracts.dummyTarget.number()).toString(),
        replayBlocked: true,
      },
      success: true,
    };

    fs.writeFileSync(E2E_JSON, JSON.stringify(report, null, 2));

    process.stdout.write('sharpAccountV1 e2e success\n');
    process.stdout.write(` - account: ${deployment.sharpAccount}\n`);
    process.stdout.write(` - target:  ${deployment.dummyTarget}\n`);
    process.stdout.write(` - tx:      ${executeReceipt.hash}\n`);
    process.stdout.write(` - report:  ${E2E_JSON}\n`);
    return report;
  } finally {
    gProvider.disconnect();
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runE2E().catch((error) => {
    process.stderr.write(`${error.stack || error.message}\n`);
    process.exit(1);
  });
}
