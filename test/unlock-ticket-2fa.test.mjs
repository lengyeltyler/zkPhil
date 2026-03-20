import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import hre from 'hardhat';
import { ethers } from 'ethers';

import {
  ACTION_ACCOUNT_CREATE,
} from '../shared/proof/localStarkProver.mjs';
import {
  buildAndRegisterActionProof,
  createEligibilityContext,
  deployFactProofGate,
  toMintProof,
} from './proof-fixture.mjs';

const PROGRAM_HASH = '0x' + '55'.repeat(32);
const CONTEXT_ID = 13n;
const CHAIN_ID = 31337;
const LEGACY_SINGLE_ARM_SELECTOR = '0x225bbcd9';
const LEGACY_BATCH_ARM_SELECTOR = '0xc9f2414c';
const LEGACY_FACTORY_SELECTOR = '0xf43df9b6';
const ARTIFACT_FQNS = {
  MockRenderer: 'contracts/mocks/MockRenderer.sol:MockRenderer',
  DevProofVerifier: 'contracts/proofs/DevProofVerifier.sol:DevProofVerifier',
  PhilIdentityGate: 'contracts/PhilIdentityGate.sol:PhilIdentityGate',
  PhilIdentityMint: 'contracts/PhilIdentityMint.sol:PhilIdentityMint',
  MockStarknetCore: 'contracts/mocks/MockStarknetCore.sol:MockStarknetCore',
  PhilUnlockInbox: 'contracts/PhilUnlockInbox.sol:PhilUnlockInbox',
  PhilAccount: 'contracts/PhilAccount.sol:PhilAccount',
  PhilAccountFactory: 'contracts/PhilAccountFactory.sol:PhilAccountFactory',
};

async function deploy(name, signer, args = [], overrides = {}) {
  const artifact = await hre.artifacts.readArtifact(ARTIFACT_FQNS[name] || name);
  const factory = new ethers.ContractFactory(artifact.abi, artifact.bytecode, signer);
  const contract = await factory.deploy(...args, overrides);
  await contract.waitForDeployment();
  return contract;
}

function computeCallConstraintsHash(target, value, data) {
  return ethers.keccak256(
    ethers.AbiCoder.defaultAbiCoder().encode(
      ['address', 'uint256', 'bytes'],
      [ethers.getAddress(target), BigInt(value), data]
    )
  );
}

function computeBatchConstraintsHash(calls) {
  return ethers.keccak256(
    ethers.AbiCoder.defaultAbiCoder().encode(
      ['tuple(address target,uint256 value,bytes data)[]'],
      [calls]
    )
  );
}

async function buildFixture() {
  const provider = new ethers.BrowserProvider(hre.network.provider);
  const deployer = await provider.getSigner(0);
  const owner = await provider.getSigner(1);
  const targetA = await provider.getSigner(2);
  const targetB = await provider.getSigner(3);
  const deployerAddress = await deployer.getAddress();
  const ownerAddress = await owner.getAddress();
  const eligibility = createEligibilityContext([ownerAddress], {
    contextId: CONTEXT_ID,
    credentialsPerAddress: 1,
    seed: 'unlock-ticket-2fa',
  });

  const renderer = await deploy('MockRenderer', deployer);
  const registryArtifact = await hre.artifacts.readArtifact(ARTIFACT_FQNS.DevProofVerifier);
  const gateArtifact = await hre.artifacts.readArtifact(ARTIFACT_FQNS.PhilIdentityGate);
  const { registry, gate } = await deployFactProofGate({
    signer: deployer,
    deployContract: async (signer, artifact, args = []) => {
      const factory = new ethers.ContractFactory(artifact.abi, artifact.bytecode, signer);
      const contract = await factory.deploy(...args);
      await contract.waitForDeployment();
      return contract;
    },
    gateArtifact,
    registryArtifact,
    programHash: PROGRAM_HASH,
    contextId: CONTEXT_ID,
    eligibilityRoot: eligibility.bundle.eligibilityRoot,
    initialAuthorizedCaller: deployerAddress,
  });
  const mint = await deploy('PhilIdentityMint', deployer, [
    await renderer.getAddress(),
    await gate.getAddress(),
    deployerAddress,
  ]);
  const starknetCore = await deploy('MockStarknetCore', deployer);
  const unlockInbox = await deploy('PhilUnlockInbox', deployer, [
    await starknetCore.getAddress(),
    1n,
  ]);
  const accountImpl = await deploy('PhilAccount', deployer);
  const factory = await deploy('PhilAccountFactory', deployer, [
    await accountImpl.getAddress(),
    await unlockInbox.getAddress(),
    await mint.getAddress(),
    await gate.getAddress(),
  ]);

  await (await gate.setAuthorizedCaller(await factory.getAddress(), true)).wait();

  const starkPubKeyX = 0x1234567890abcdefn;
  const accountAddress = await factory.getPhilAddress(ownerAddress, starkPubKeyX);
  const createActionHash = await factory.computeCreateActionHash(ownerAddress, starkPubKeyX);
  const createProof = await buildAndRegisterActionProof({
    registry,
    credential: eligibility.credentialFor(ownerAddress),
    programHash: PROGRAM_HASH,
    contextId: CONTEXT_ID,
    chainId: CHAIN_ID,
    proofGateAddress: await gate.getAddress(),
    recipient: ownerAddress,
    actionType: ACTION_ACCOUNT_CREATE,
    actionHash: createActionHash,
    expiry: Math.floor(Date.now() / 1000) + 900,
  });

  await (
    await factory
      .connect(owner)
      ['createPhilAccount(address,uint256,(uint256,bytes32,bytes))'](
        ownerAddress,
        starkPubKeyX,
        toMintProof(createProof)
      )
  ).wait();

  const accountArtifact = await hre.artifacts.readArtifact(ARTIFACT_FQNS.PhilAccount);
  const account = new ethers.Contract(accountAddress, accountArtifact.abi, owner);

  assert.equal(
    (await account.unlockInbox()).toLowerCase(),
    (await unlockInbox.getAddress()).toLowerCase()
  );
  assert.equal(await account.isOwner(ownerAddress), true);
  assert.equal(await account.proofVerifier(), ethers.ZeroAddress);

  return {
    provider,
    owner,
    ownerAddress,
    account,
    accountAddress,
    unlockInbox,
    factory,
    targetA: await targetA.getAddress(),
    targetB: await targetB.getAddress(),
  };
}

describe('PhilAccount unlock-ticket-only execution approvals', function () {
  it('arms with a fresh unlock ticket and consumes the approval exactly once', async () => {
    const fixture = await buildFixture();
    const data = '0x';
    const constraintsHash = computeCallConstraintsHash(fixture.targetA, 0n, data);

    await (
      await fixture.unlockInbox.recordTicket(
        fixture.accountAddress,
        1,
        0,
        0,
        0,
        constraintsHash
      )
    ).wait();

    await (
      await fixture.account.approveExecutionWithUnlock(
        fixture.ownerAddress,
        fixture.targetA,
        0n,
        data
      )
    ).wait();

    await (await fixture.account.execute(fixture.targetA, 0n, data)).wait();

    await assert.rejects(
      fixture.account.execute(fixture.targetA, 0n, data),
      /ProofRequired|execution reverted/
    );
  });

  it('requires a strictly newer unlock ticket nonce for each arming step', async () => {
    const fixture = await buildFixture();
    const data = '0x';
    const constraintsHash = computeCallConstraintsHash(fixture.targetA, 0n, data);

    await (
      await fixture.unlockInbox.recordTicket(
        fixture.accountAddress,
        1,
        0,
        0,
        0,
        constraintsHash
      )
    ).wait();

    await (
      await fixture.account.approveExecutionWithUnlock(
        fixture.ownerAddress,
        fixture.targetA,
        0n,
        data
      )
    ).wait();

    await assert.rejects(
      fixture.account.approveExecutionWithUnlock(
        fixture.ownerAddress,
        fixture.targetA,
        0n,
        data
      ),
      /NoFreshUnlockTicket|execution reverted/
    );
  });

  it('rejects arming when the unlock ticket constraints do not match the exact call', async () => {
    const fixture = await buildFixture();
    const data = '0x';
    const wrongHash = computeCallConstraintsHash(fixture.targetB, 0n, data);

    await (
      await fixture.unlockInbox.recordTicket(
        fixture.accountAddress,
        1,
        0,
        0,
        0,
        wrongHash
      )
    ).wait();

    await assert.rejects(
      fixture.account.approveExecutionWithUnlock(
        fixture.ownerAddress,
        fixture.targetA,
        0n,
        data
      ),
      /UnlockTicketConstraintsMismatch|execution reverted/
    );
  });

  it('binds batch approvals to the exact encoded call array', async () => {
    const fixture = await buildFixture();
    const calls = [
      { target: fixture.targetA, value: 0n, data: '0x' },
      { target: fixture.targetB, value: 0n, data: '0x' },
    ];
    const constraintsHash = computeBatchConstraintsHash(calls);

    await (
      await fixture.unlockInbox.recordTicket(
        fixture.accountAddress,
        1,
        0,
        0,
        0,
        constraintsHash
      )
    ).wait();

    await (
      await fixture.account.approveExecutionBatchWithUnlock(
        fixture.ownerAddress,
        calls
      )
    ).wait();

    await (await fixture.account.executeBatch(calls)).wait();

    const mutatedCalls = [
      { target: fixture.targetB, value: 0n, data: '0x' },
      { target: fixture.targetA, value: 0n, data: '0x' },
    ];
    await assert.rejects(
      fixture.account.executeBatch(mutatedCalls),
      /ProofRequired|execution reverted/
    );
  });

  it('keeps every backend execution-proof entrypoint hard-disabled', async () => {
    const fixture = await buildFixture();
    const dummyProof = {
      expiry: 0n,
      factHash: ethers.ZeroHash,
      signature: '0x',
    };
    const coder = ethers.AbiCoder.defaultAbiCoder();
    const singleArmData = ethers.concat([
      LEGACY_SINGLE_ARM_SELECTOR,
      coder.encode(
        ['address', 'address', 'uint256', 'bytes', 'tuple(uint256 expiry,bytes32 factHash,bytes signature)'],
        [fixture.ownerAddress, fixture.targetA, 0n, '0x', dummyProof]
      ),
    ]);
    const batchArmData = ethers.concat([
      LEGACY_BATCH_ARM_SELECTOR,
      coder.encode(
        ['address', 'tuple(address target,uint256 value,bytes data)[]', 'tuple(uint256 expiry,bytes32 factHash,bytes signature)'],
        [
          fixture.ownerAddress,
          [{ target: fixture.targetA, value: 0n, data: '0x' }],
          dummyProof,
        ]
      ),
    ]);
    const factoryArmData = ethers.concat([
      LEGACY_FACTORY_SELECTOR,
      coder.encode(
        ['address', 'bytes32', 'tuple(uint256 expiry,bytes32 factHash,bytes signature)'],
        [fixture.ownerAddress, ethers.ZeroHash, dummyProof]
      ),
    ]);

    await assert.rejects(
      fixture.owner.sendTransaction({
        to: fixture.accountAddress,
        data: singleArmData,
      }),
      /BackendExecutionProofDisabled|execution reverted/
    );

    await assert.rejects(
      fixture.owner.sendTransaction({
        to: fixture.accountAddress,
        data: batchArmData,
      }),
      /BackendExecutionProofDisabled|execution reverted/
    );

    await assert.rejects(
      fixture.owner.sendTransaction({
        to: await fixture.factory.getAddress(),
        data: factoryArmData,
      }),
      /BackendExecutionProofDisabled|execution reverted/
    );
  });
});
