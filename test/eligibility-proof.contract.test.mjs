import test from 'node:test';
import assert from 'node:assert/strict';
import ganache from 'ganache';
import { ethers } from 'ethers';

import { compilePhilContracts } from '../scripts/local/compileContracts.mjs';
import {
  buildAndRegisterMintProof,
  createEligibilityContext,
  deployFactProofGate,
  toMintProof,
} from './proof-fixture.mjs';
import {
  deployContract,
  deployHybridRendererSystem,
  getArtifact,
} from './hybrid-renderer-helpers.mjs';

const CHAIN_ID = 31337;
const MNEMONIC = 'test test test test test test test test test test test junk';
const PROGRAM_HASH = '0x4444444444444444444444444444444444444444444444444444444444444444';
const CONTEXT_ID = 13n;

function deriveWallet(provider, index) {
  const hd = ethers.HDNodeWallet.fromPhrase(MNEMONIC, undefined, `m/44'/60'/0'/0/${index}`);
  return hd.connect(provider);
}

async function expectRevert(sendTx) {
  try {
    const tx = await sendTx();
    const receipt = await tx.wait();
    if (receipt?.status === 0 || receipt?.status === 0n) {
      return;
    }
    assert.fail('Missing expected rejection.');
  } catch {
    // expected
  }
}

test('fact-backed proof gate enforces registered eligibility proofs and nullifier replay protection', async () => {
  const gProvider = ganache.provider({
    chain: { chainId: CHAIN_ID },
    wallet: { mnemonic: MNEMONIC, totalAccounts: 30, defaultBalance: 1000 },
    logging: { quiet: true },
  });
  const provider = new ethers.BrowserProvider(gProvider);

  try {
    const deployer = await provider.getSigner(0);
    const eligibleA = deriveWallet(provider, 1);
    const eligibleB = deriveWallet(provider, 2);
    const outsider = deriveWallet(provider, 20);

    const eligibility = createEligibilityContext(
      [eligibleA.address, eligibleB.address],
      { contextId: CONTEXT_ID, credentialsPerAddress: 1, seed: 'eligibility-proof-contract-test' }
    );

    const artifacts = compilePhilContracts();
    const { renderer } = await deployHybridRendererSystem(deployer, artifacts);

    const deployerAddress = await deployer.getAddress();
    const nonce = await provider.getTransactionCount(deployerAddress);
    const expectedMint = ethers.getCreateAddress({ from: deployerAddress, nonce: nonce + 2 });

    const { registry, gate } = await deployFactProofGate({
      signer: deployer,
      deployContract,
      gateArtifact: getArtifact(artifacts, 'PhilIdentityGate'),
      registryArtifact: getArtifact(artifacts, 'DevProofVerifier'),
      programHash: PROGRAM_HASH,
      contextId: CONTEXT_ID,
      eligibilityRoot: eligibility.bundle.eligibilityRoot,
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

    const firstProof = await buildAndRegisterMintProof({
      registry,
      credential: eligibility.credentialFor(eligibleA.address),
      programHash: PROGRAM_HASH,
      contextId: CONTEXT_ID,
      chainId: CHAIN_ID,
      proofGateAddress: gateAddress,
      recipient: eligibleA.address,
      mintTo: eligibleA.address,
      philId: 0,
      paletteVariant: 8,
      mixMode: 2,
      mixSeed: 123456789,
      expiry: 0,
    });

    await (
      await mintContract.mint(
        eligibleA.address,
        eligibleA.address,
        0,
        8,
        2,
        123456789,
        toMintProof(firstProof)
      )
    ).wait();

    await expectRevert(() =>
      mintContract.mint(
        eligibleA.address,
        eligibleA.address,
        0,
        8,
        2,
        123456789,
        toMintProof(firstProof)
      )
    );

    const secondProof = await buildAndRegisterMintProof({
      registry,
      credential: eligibility.credentialFor(eligibleB.address),
      programHash: PROGRAM_HASH,
      contextId: CONTEXT_ID,
      chainId: CHAIN_ID,
      proofGateAddress: gateAddress,
      recipient: eligibleB.address,
      mintTo: eligibleB.address,
      philId: 1,
      paletteVariant: 7,
      mixMode: 0,
      mixSeed: 0,
      expiry: 0,
    });

    await (
      await mintContract.mint(
        eligibleB.address,
        eligibleB.address,
        1,
        7,
        0,
        0,
        toMintProof(secondProof)
      )
    ).wait();

    const malformed = {
      ...firstProof,
      factHash: ethers.hexlify(ethers.randomBytes(32)),
    };
    await expectRevert(() =>
      mintContract.mint(
        eligibleA.address,
        eligibleA.address,
        2,
        6,
        1,
        111,
        toMintProof(malformed)
      )
    );

    await expectRevert(() =>
      mintContract.mint(
        outsider.address,
        outsider.address,
        1,
        7,
        0,
        0,
        toMintProof(secondProof)
      )
    );

    assert.equal(Number(await mintContract.totalSupply()), 2);
  } finally {
    gProvider.disconnect();
  }
});
