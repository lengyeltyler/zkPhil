import test from 'node:test';
import assert from 'node:assert/strict';
import ganache from 'ganache';
import { ethers } from 'ethers';

import { compilePhilContracts } from '../scripts/local/compileContracts.mjs';
import {
  buildAndRegisterMintProof,
  buildMintProof,
  createMockHumanityContext,
  deployFactProofGate,
  registerProofFact,
  toMintProof,
} from './proof-fixture.mjs';
import {
  deployContract,
  deployHybridRendererSystem,
  getArtifact,
} from './hybrid-renderer-helpers.mjs';

const CHAIN_ID = 31337;
const MNEMONIC = 'test test test test test test test test test test test junk';
const PROGRAM_HASH = '0x6666666666666666666666666666666666666666666666666666666666666666';
const CONTEXT_ID = 13n;

function deriveWallet(provider, index) {
  const hd = ethers.HDNodeWallet.fromPhrase(MNEMONIC, undefined, `m/44'/60'/0'/0/${index}`);
  return hd.connect(provider);
}

async function expectRevert(sendTx, label) {
  try {
    const tx = await sendTx();
    await tx.wait();
    assert.fail(`Expected revert for ${label}`);
  } catch {
    // expected
  }
}

test('mock-humanity verifier enforces one-human-one-identity and recipient/context/artifact failures', async () => {
  const gProvider = ganache.provider({
    chain: { chainId: CHAIN_ID },
    wallet: { mnemonic: MNEMONIC, totalAccounts: 30, defaultBalance: 1000 },
    logging: { quiet: true },
  });
  const provider = new ethers.BrowserProvider(gProvider);

  try {
    const deployer = await provider.getSigner(0);
    const recipientA = deriveWallet(provider, 1);
    const recipientB = deriveWallet(provider, 2);
    const outsider = deriveWallet(provider, 3);

    const mockHumanity = createMockHumanityContext(
      ['atlas', 'briar', 'cinder', 'delta'],
      { contextId: CONTEXT_ID, seed: 'mock-humanity-contract-test' }
    );

    const artifacts = compilePhilContracts();
    const { renderer } = await deployHybridRendererSystem(deployer, artifacts);

    const deployerAddress = await deployer.getAddress();
    const nonce = await provider.getTransactionCount(deployerAddress);
    const expectedMint = ethers.getCreateAddress({ from: deployerAddress, nonce: nonce + 3 });

    const { registry, gate } = await deployFactProofGate({
      signer: deployer,
      deployContract,
      gateArtifact: getArtifact(artifacts, 'PhilIdentityGate'),
      registryArtifact: getArtifact(artifacts, 'DevProofVerifier'),
      verifierArtifact: getArtifact(artifacts, 'MockHumanityVerifier'),
      programHash: PROGRAM_HASH,
      contextId: CONTEXT_ID,
      verifierConfigHash: mockHumanity.bundle.verifierConfigHash,
      initialAuthorizedCaller: expectedMint,
    });
    const gateAddress = await gate.getAddress();

    const mint = await deployContract(deployer, getArtifact(artifacts, 'PhilIdentityMint'), [
      await renderer.getAddress(),
      gateAddress,
      deployerAddress,
    ]);

    const mintAbi = [
      'function mint(address recipient,address mintTo,uint8 philId,uint8 paletteVariant,uint8 mixMode,uint32 mixSeed,(uint256 expiry,bytes32 factHash,bytes signature) proof)',
      'function totalSupply() view returns (uint256)',
    ];
    const mintContract = new ethers.Contract(await mint.getAddress(), mintAbi, deployer);

    const atlasProof = await buildAndRegisterMintProof({
      registry,
      credential: mockHumanity.humanFor('atlas'),
      programHash: PROGRAM_HASH,
      contextId: CONTEXT_ID,
      chainId: CHAIN_ID,
      proofGateAddress: gateAddress,
      recipient: recipientA.address,
      mintTo: recipientA.address,
      philId: 0,
      paletteVariant: 1,
      mixMode: 0,
      mixSeed: 101,
      expiry: 0,
    });

    await (
      await mintContract.mint(
        recipientA.address,
        recipientA.address,
        0,
        1,
        0,
        101,
        toMintProof(atlasProof)
      )
    ).wait();

    const atlasSecondWalletProof = await buildAndRegisterMintProof({
      registry,
      credential: mockHumanity.humanFor('atlas'),
      programHash: PROGRAM_HASH,
      contextId: CONTEXT_ID,
      chainId: CHAIN_ID,
      proofGateAddress: gateAddress,
      recipient: recipientB.address,
      mintTo: recipientB.address,
      philId: 1,
      paletteVariant: 2,
      mixMode: 0,
      mixSeed: 202,
      expiry: 0,
    });

    await expectRevert(
      () => mintContract.mint(
        recipientB.address,
        recipientB.address,
        1,
        2,
        0,
        202,
        toMintProof(atlasSecondWalletProof)
      ),
      'same mock human second mint'
    );

    const briarProof = await buildAndRegisterMintProof({
      registry,
      credential: mockHumanity.humanFor('briar'),
      programHash: PROGRAM_HASH,
      contextId: CONTEXT_ID,
      chainId: CHAIN_ID,
      proofGateAddress: gateAddress,
      recipient: recipientB.address,
      mintTo: recipientB.address,
      philId: 1,
      paletteVariant: 3,
      mixMode: 1,
      mixSeed: 303,
      expiry: 0,
    });

    await (
      await mintContract.mint(
        recipientB.address,
        recipientB.address,
        1,
        3,
        1,
        303,
        toMintProof(briarProof)
      )
    ).wait();

    const cinderProof = await buildAndRegisterMintProof({
      registry,
      credential: mockHumanity.humanFor('cinder'),
      programHash: PROGRAM_HASH,
      contextId: CONTEXT_ID,
      chainId: CHAIN_ID,
      proofGateAddress: gateAddress,
      recipient: recipientA.address,
      mintTo: recipientA.address,
      philId: 2,
      paletteVariant: 4,
      mixMode: 0,
      mixSeed: 404,
      expiry: 0,
    });

    await expectRevert(
      () => mintContract.mint(
        outsider.address,
        outsider.address,
        2,
        4,
        0,
        404,
        toMintProof(cinderProof)
      ),
      'wrong recipient / wrong wallet'
    );

    const wrongContextProof = await buildMintProof({
      credential: mockHumanity.humanFor('delta'),
      programHash: PROGRAM_HASH,
      contextId: CONTEXT_ID + 1n,
      chainId: CHAIN_ID,
      proofGateAddress: gateAddress,
      recipient: outsider.address,
      mintTo: outsider.address,
      philId: 3,
      paletteVariant: 5,
      mixMode: 0,
      mixSeed: 505,
      expiry: 0,
    });
    await registerProofFact(registry, wrongContextProof);

    await expectRevert(
      () => mintContract.mint(
        outsider.address,
        outsider.address,
        3,
        5,
        0,
        505,
        toMintProof(wrongContextProof)
      ),
      'wrong proofContext'
    );

    const invalidArtifact = {
      ...cinderProof,
      factHash: ethers.hexlify(ethers.randomBytes(32)),
    };
    await expectRevert(
      () => mintContract.mint(
        recipientA.address,
        recipientA.address,
        2,
        4,
        0,
        404,
        toMintProof(invalidArtifact)
      ),
      'invalid artifact'
    );

    await expectRevert(
      () => mintContract.mint(
        recipientA.address,
        recipientA.address,
        0,
        1,
        0,
        101,
        toMintProof(atlasProof)
      ),
      'replayed proof'
    );

    assert.equal(Number(await mintContract.totalSupply()), 2);
  } finally {
    gProvider.disconnect();
  }
});
