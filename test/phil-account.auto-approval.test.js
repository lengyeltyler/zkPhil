import assert from 'node:assert/strict';
import hre from 'hardhat';
import { ethers } from 'ethers';

import {
  ACTION_ACCOUNT_CREATE,
  generateLocalActionProof,
  generateLocalMintProof,
} from '../shared/proof/localStarkProver.mjs';
import {
  buildMintUserOp,
  encodeExecuteCalldata,
  getUserOpHash,
  signUserOp,
} from '../frontend/userop.js';

const PROGRAM_HASH = '0x' + '44'.repeat(32);
const DROP_ID = 13n;
const CHAIN_ID = 31337;
const LOCAL_ENTRY_POINT_V07 = '0x1000000000000000000000000000000000000001';

function resolveArtifactName(name) {
  switch (name) {
    case 'MockRenderer':
      return 'contracts/mocks/MockRenderer.sol:MockRenderer';
    case 'MockUnlockInbox':
      return 'contracts/mocks/MockUnlockInbox.sol:MockUnlockInbox';
    case 'EntryPointLocalMock':
      return 'contracts/EntryPointLocalMock.sol:EntryPointLocalMock';
    default:
      return `contracts/${name}.sol:${name}`;
  }
}

async function deploy(name, signer, args = [], overrides = {}) {
  const artifact = await hre.artifacts.readArtifact(resolveArtifactName(name));
  const factory = new ethers.ContractFactory(artifact.abi, artifact.bytecode, signer);
  const contract = await factory.deploy(...args, overrides);
  await contract.waitForDeployment();
  return contract;
}

function toMintProof(proof) {
  return {
    expiry: proof.expiry,
    factHash: proof.factHash,
    signature: proof.signature,
  };
}

async function installLocalEntryPoint(provider, signer) {
  const existingCode = await provider.getCode(LOCAL_ENTRY_POINT_V07);
  if (existingCode !== '0x') {
    return new ethers.Contract(
      LOCAL_ENTRY_POINT_V07,
      [
        'function handleOps(tuple(address sender, uint256 nonce, bytes initCode, bytes callData, bytes32 accountGasLimits, uint256 preVerificationGas, bytes32 gasFees, bytes paymasterAndData, bytes signature)[] ops, address payable beneficiary) external',
      ],
      signer
    );
  }

  const entryPointImpl = await deploy('EntryPointLocalMock', signer);
  const runtimeCode = await provider.getCode(await entryPointImpl.getAddress());
  await hre.network.provider.send('hardhat_setCode', [LOCAL_ENTRY_POINT_V07, runtimeCode]);

  return new ethers.Contract(
    LOCAL_ENTRY_POINT_V07,
    [
      'function handleOps(tuple(address sender, uint256 nonce, bytes initCode, bytes callData, bytes32 accountGasLimits, uint256 preVerificationGas, bytes32 gasFees, bytes paymasterAndData, bytes signature)[] ops, address payable beneficiary) external',
    ],
    signer
  );
}

async function buildFixture() {
  const provider = new ethers.BrowserProvider(hre.network.provider);
  const deployer = await provider.getSigner(0);
  const owner = await provider.getSigner(1);
  const attacker = await provider.getSigner(2);
  const bundler = await provider.getSigner(3);

  const deployerAddress = await deployer.getAddress();
  const ownerAddress = await owner.getAddress();
  const attackerAddress = await attacker.getAddress();

  const entryPoint = await installLocalEntryPoint(provider, bundler);
  const renderer = await deploy('MockRenderer', deployer);

  const nextNonce = await provider.getTransactionCount(deployerAddress);
  const predictedMintAddress = ethers.getCreateAddress({
    from: deployerAddress,
    nonce: nextNonce + 1,
  });

  const gate = await deploy('ProofGateTest13', deployer, [
    PROGRAM_HASH,
    DROP_ID,
    predictedMintAddress,
  ]);
  const gateAddress = await gate.getAddress();
  const mint = await deploy('PhilTestMint', deployer, [
    await renderer.getAddress(),
    gateAddress,
    deployerAddress,
  ]);
  const unlockInbox = await deploy('MockUnlockInbox', deployer);
  const accountImpl = await deploy('PhilAccount', deployer);
  const factory = await deploy('PhilAccountFactory', deployer, [
    await accountImpl.getAddress(),
    await unlockInbox.getAddress(),
    await mint.getAddress(),
    gateAddress,
  ]);

  await (await gate.setAuthorizedCaller(await factory.getAddress(), true)).wait();

  const starkPubKeyX = 0x1234567890abcdefn;
  const smartAccount = await factory.getPhilAddress(ownerAddress, starkPubKeyX);
  const createActionHash = await factory.computeCreateActionHash(ownerAddress, starkPubKeyX);

  const createProof = await generateLocalActionProof({
    signer: deployer,
    programHash: PROGRAM_HASH,
    dropId: DROP_ID,
    chainId: CHAIN_ID,
    proofGateAddress: gateAddress,
    recipient: ownerAddress,
    actionType: ACTION_ACCOUNT_CREATE,
    actionHash: createActionHash,
    expiry: Math.floor(Date.now() / 1000) + 900,
  });

  const mintProof = await generateLocalMintProof({
    signer: deployer,
    programHash: PROGRAM_HASH,
    dropId: DROP_ID,
    chainId: CHAIN_ID,
    proofGateAddress: gateAddress,
    recipient: ownerAddress,
    mintTo: smartAccount,
    philId: 1,
    paletteVariant: 2,
    mixMode: 0,
    mixSeed: 0,
    expiry: Math.floor(Date.now() / 1000) + 900,
  });

  const buildSignedMintUserOp = async () => {
    const userOp = await buildMintUserOp({
      ethers,
      smartAccount,
      factoryAddress: await factory.getAddress(),
      isDeployed: false,
      eoa: ownerAddress,
      starkPubKeyX,
      philTestMint: await mint.getAddress(),
      createProof: toMintProof(createProof),
      mintParams: {
        recipient: ownerAddress,
        mintTo: smartAccount,
        philId: 1,
        paletteVariant: 2,
        mixMode: 0,
        mixSeed: 0,
        proof: toMintProof(mintProof),
      },
      provider,
      entryPointAddress: LOCAL_ENTRY_POINT_V07,
    });

    const userOpHash = getUserOpHash(ethers, userOp, CHAIN_ID, LOCAL_ENTRY_POINT_V07);
    userOp.signature = await signUserOp({
      ethers,
      userOpHash,
      eoaSigner: owner,
    });
    return userOp;
  };

  return {
    provider,
    owner,
    bundler,
    attackerAddress,
    entryPoint,
    mint,
    factory,
    smartAccount,
    buildSignedMintUserOp,
    innerMintData: mint.interface.encodeFunctionData('mint', [
      ownerAddress,
      smartAccount,
      1,
      2,
      0,
      0,
      toMintProof(mintProof),
    ]),
    createProof: toMintProof(createProof),
  };
}

describe('PhilAccount first-userOp mint auto-approval', function () {
  this.timeout(120000);

  it('allows first-userOp deploy+mint only when the embedded mint proof is valid', async () => {
    const fixture = await buildFixture();
    const userOp = await fixture.buildSignedMintUserOp();

    const tx = await fixture.entryPoint.connect(fixture.bundler).handleOps(
      [userOp],
      await fixture.bundler.getAddress()
    );
    await tx.wait();

    assert.equal(await fixture.provider.getCode(fixture.smartAccount) !== '0x', true);
    assert.equal(await fixture.mint.totalSupply(), 1n);
    assert.equal(
      (await fixture.mint.ownerOf(0)).toLowerCase(),
      fixture.smartAccount.toLowerCase()
    );
  });

  it('does not auto-approve arbitrary execute calls during the first userOp', async () => {
    const fixture = await buildFixture();
    const userOp = await fixture.buildSignedMintUserOp();

    userOp.callData = encodeExecuteCalldata(ethers, fixture.attackerAddress, 0n, '0x');
    const userOpHash = getUserOpHash(ethers, userOp, CHAIN_ID, LOCAL_ENTRY_POINT_V07);
    userOp.signature = await signUserOp({
      ethers,
      userOpHash,
      eoaSigner: fixture.owner,
    });

    await assert.rejects(
      fixture.entryPoint.connect(fixture.bundler).handleOps([userOp], await fixture.bundler.getAddress()),
      /FailedOp|ProofRequired|execution reverted/
    );

    assert.equal(await fixture.mint.totalSupply(), 0n);
  });

  it('consumes the auto-approval and does not leave execute unlocked afterward', async () => {
    const fixture = await buildFixture();
    const userOp = await fixture.buildSignedMintUserOp();

    const tx = await fixture.entryPoint.connect(fixture.bundler).handleOps(
      [userOp],
      await fixture.bundler.getAddress()
    );
    await tx.wait();

    const account = new ethers.Contract(
      fixture.smartAccount,
      ['function execute(address target, uint256 value, bytes data) payable returns (bytes)'],
      fixture.owner
    );

    await assert.rejects(
      account.execute(await fixture.mint.getAddress(), 0n, fixture.innerMintData),
      /ProofRequired|execution reverted/
    );
  });
});
