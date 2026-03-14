import test from 'node:test';
import assert from 'node:assert/strict';
import ganache from 'ganache';
import { ethers } from 'ethers';

import { buildSharpProgram } from '../scripts/build.mjs';
import { deploySharpStack } from '../scripts/deploy.mjs';
import { generateSharpProofArtifact } from '../scripts/prove.mjs';
import { computeCallDataHash, signIntentHash } from '../scripts/common.mjs';

const CHAIN_ID = 31337;
const MNEMONIC = 'test test test test test test test test test test test junk';
const SECOND_FACTOR_SECRET = 'sharp-local-2fa-secret';

function deriveWallet(provider, index) {
  const hd = ethers.HDNodeWallet.fromPhrase(MNEMONIC, undefined, `m/44'/60'/0'/0/${index}`);
  return hd.connect(provider);
}

async function deployContract(signer, artifact, args = []) {
  const factory = new ethers.ContractFactory(artifact.abi, artifact.bytecode, signer);
  const contract = await factory.deploy(...args);
  await contract.waitForDeployment();
  return contract;
}

async function expectRevert(send, label) {
  let reverted = false;
  try {
    const tx = await send();
    const receipt = await tx.wait();
    reverted = receipt?.status === 0 || receipt?.status === 0n;
  } catch {
    reverted = true;
  }
  assert.equal(reverted, true, `${label} should revert`);
}

async function createFixture() {
  buildSharpProgram();

  const gProvider = ganache.provider({
    chain: { chainId: CHAIN_ID },
    wallet: { mnemonic: MNEMONIC, totalAccounts: 12, defaultBalance: 1000 },
    logging: { quiet: true },
  });
  const provider = new ethers.BrowserProvider(gProvider);
  const ownerWallet = deriveWallet(provider, 0);
  const ownerTx = new ethers.NonceManager(ownerWallet);
  const relayer = new ethers.NonceManager(deriveWallet(provider, 1));
  const outsider = deriveWallet(provider, 2);

  const deployed = await deploySharpStack({
    signer: ownerTx,
    owner: ownerWallet.address,
    secondFactorSecret: SECOND_FACTOR_SECRET,
    writeOutput: false,
  });

  return {
    gProvider,
    provider,
    ownerWallet,
    ownerTx,
    relayer,
    outsider,
    ...deployed,
  };
}

function buildSetNumberCalldata(contract, value) {
  return contract.interface.encodeFunctionData('setNumber', [BigInt(value)]);
}

async function buildProofAndSig({
  owner,
  chainId,
  smartAccount,
  target,
  callData,
  nonce,
  secret = SECOND_FACTOR_SECRET,
  signatureWallet = owner,
  verifyingContract = smartAccount,
}) {
  const proof = generateSharpProofArtifact({
    wallet: owner.address,
    smartAccount,
    target,
    callData,
    value: 0n,
    nonce,
    chainId,
    secondFactorSecret: secret,
    outFile: null,
  });

  const signature = await signIntentHash({
    signer: signatureWallet,
    chainId,
    verifyingContract,
    intentHash: proof.publicInputs.intentHash,
  });

  return { proof, signature };
}

test('valid signature + valid proof succeeds', async () => {
  const fx = await createFixture();
  try {
    const chainId = BigInt((await fx.provider.getNetwork()).chainId);
    const callData = buildSetNumberCalldata(fx.contracts.dummyTarget, 7);
    const { proof, signature } = await buildProofAndSig({
      owner: fx.ownerWallet,
      chainId,
      smartAccount: await fx.contracts.sharpAccount.getAddress(),
      target: await fx.contracts.dummyTarget.getAddress(),
      callData,
      nonce: 0n,
    });

    await (await fx.contracts.factRegistry.connect(fx.ownerTx).registerFact(proof.sharp.factHash)).wait();

    const contractIntent = await fx.contracts.sharpAccount.computeIntentHash(
      await fx.contracts.dummyTarget.getAddress(),
      computeCallDataHash(callData),
      0n,
      0n,
      chainId
    );
    assert.equal(contractIntent.toLowerCase(), proof.publicInputs.intentHash.toLowerCase());

    await (await fx.contracts.sharpAccount.connect(fx.relayer).execute(
      await fx.contracts.dummyTarget.getAddress(),
      0n,
      callData,
      signature,
      proof.publicInputs.intentHash
    )).wait();

    assert.equal((await fx.contracts.sharpAccount.nonce()).toString(), '1');
    assert.equal((await fx.contracts.dummyTarget.number()).toString(), '7');
  } finally {
    fx.gProvider.disconnect();
  }
});

test('valid signature + missing proof fails', async () => {
  const fx = await createFixture();
  try {
    const chainId = BigInt((await fx.provider.getNetwork()).chainId);
    const targetAddress = await fx.contracts.dummyTarget.getAddress();
    const callData = buildSetNumberCalldata(fx.contracts.dummyTarget, 11);
    const { proof, signature } = await buildProofAndSig({
      owner: fx.ownerWallet,
      chainId,
      smartAccount: await fx.contracts.sharpAccount.getAddress(),
      target: targetAddress,
      callData,
      nonce: 0n,
    });

    await expectRevert(
      () => fx.contracts.sharpAccount.connect(fx.relayer).execute(
        targetAddress,
        0n,
        callData,
        signature,
        proof.publicInputs.intentHash
      ),
      'missing proof'
    );
  } finally {
    fx.gProvider.disconnect();
  }
});

test('valid proof + bad signature fails', async () => {
  const fx = await createFixture();
  try {
    const chainId = BigInt((await fx.provider.getNetwork()).chainId);
    const targetAddress = await fx.contracts.dummyTarget.getAddress();
    const callData = buildSetNumberCalldata(fx.contracts.dummyTarget, 12);
    const { proof, signature } = await buildProofAndSig({
      owner: fx.ownerWallet,
      chainId,
      smartAccount: await fx.contracts.sharpAccount.getAddress(),
      target: targetAddress,
      callData,
      nonce: 0n,
      signatureWallet: fx.outsider,
    });

    await (await fx.contracts.factRegistry.connect(fx.ownerTx).registerFact(proof.sharp.factHash)).wait();

    await expectRevert(
      () => fx.contracts.sharpAccount.connect(fx.relayer).execute(
        targetAddress,
        0n,
        callData,
        signature,
        proof.publicInputs.intentHash
      ),
      'bad signature'
    );
  } finally {
    fx.gProvider.disconnect();
  }
});

test('replay nonce fails', async () => {
  const fx = await createFixture();
  try {
    const chainId = BigInt((await fx.provider.getNetwork()).chainId);
    const targetAddress = await fx.contracts.dummyTarget.getAddress();
    const callData = buildSetNumberCalldata(fx.contracts.dummyTarget, 13);
    const { proof, signature } = await buildProofAndSig({
      owner: fx.ownerWallet,
      chainId,
      smartAccount: await fx.contracts.sharpAccount.getAddress(),
      target: targetAddress,
      callData,
      nonce: 0n,
    });

    await (await fx.contracts.factRegistry.connect(fx.ownerTx).registerFact(proof.sharp.factHash)).wait();
    await (await fx.contracts.sharpAccount.connect(fx.relayer).execute(
      targetAddress,
      0n,
      callData,
      signature,
      proof.publicInputs.intentHash
    )).wait();

    await expectRevert(
      () => fx.contracts.sharpAccount.connect(fx.relayer).execute(
        targetAddress,
        0n,
        callData,
        signature,
        proof.publicInputs.intentHash
      ),
      'nonce replay'
    );
  } finally {
    fx.gProvider.disconnect();
  }
});

test('proof bound to different smartAccount fails', async () => {
  const fx = await createFixture();
  try {
    const chainId = BigInt((await fx.provider.getNetwork()).chainId);
    const targetAddress = await fx.contracts.dummyTarget.getAddress();
    const sharpArtifact = fx.artifacts.SharpAccount;
    const secondAccount = await deployContract(fx.ownerTx, sharpArtifact, [
      fx.ownerWallet.address,
      await fx.contracts.sharpAccount.secondFactorCommitment(),
      await fx.contracts.factRegistry.getAddress(),
    ]);

    const callData = buildSetNumberCalldata(fx.contracts.dummyTarget, 21);
    const { proof, signature } = await buildProofAndSig({
      owner: fx.ownerWallet,
      chainId,
      smartAccount: await fx.contracts.sharpAccount.getAddress(),
      target: targetAddress,
      callData,
      nonce: 0n,
      verifyingContract: await secondAccount.getAddress(),
    });

    await (await fx.contracts.factRegistry.connect(fx.ownerTx).registerFact(proof.sharp.factHash)).wait();

    await expectRevert(
      () => secondAccount.connect(fx.relayer).execute(
        targetAddress,
        0n,
        callData,
        signature,
        proof.publicInputs.intentHash
      ),
      'proof/smartAccount mismatch'
    );
  } finally {
    fx.gProvider.disconnect();
  }
});

test('proof bound to different target fails', async () => {
  const fx = await createFixture();
  try {
    const chainId = BigInt((await fx.provider.getNetwork()).chainId);
    const targetAddress = await fx.contracts.dummyTarget.getAddress();
    const dummyArtifact = fx.artifacts.DummyTarget;
    const otherTarget = await deployContract(fx.ownerTx, dummyArtifact, []);
    const otherTargetAddress = await otherTarget.getAddress();

    const callData = buildSetNumberCalldata(fx.contracts.dummyTarget, 31);
    const { proof, signature } = await buildProofAndSig({
      owner: fx.ownerWallet,
      chainId,
      smartAccount: await fx.contracts.sharpAccount.getAddress(),
      target: targetAddress,
      callData,
      nonce: 0n,
    });

    await (await fx.contracts.factRegistry.connect(fx.ownerTx).registerFact(proof.sharp.factHash)).wait();

    await expectRevert(
      () => fx.contracts.sharpAccount.connect(fx.relayer).execute(
        otherTargetAddress,
        0n,
        callData,
        signature,
        proof.publicInputs.intentHash
      ),
      'proof/target mismatch'
    );
  } finally {
    fx.gProvider.disconnect();
  }
});
