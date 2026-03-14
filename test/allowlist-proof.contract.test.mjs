import test from 'node:test';
import assert from 'node:assert/strict';
import ganache from 'ganache';
import { ethers } from 'ethers';

import { compilePhilContracts } from '../scripts/local/compileContracts.mjs';
import { generateLocalMintProof } from '../shared/proof/localStarkProver.mjs';
import {
  deployContract,
  deployHybridRendererSystem,
  getArtifact,
} from './hybrid-renderer-helpers.mjs';

const CHAIN_ID = 31337;
const MNEMONIC = 'test test test test test test test test test test test junk';
const PROGRAM_HASH = '0x4444444444444444444444444444444444444444444444444444444444444444';
const DROP_ID = 13n;

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

test('backend-signed proof gate contract behavior', async () => {
  const gProvider = ganache.provider({
    chain: { chainId: CHAIN_ID },
    wallet: { mnemonic: MNEMONIC, totalAccounts: 30, defaultBalance: 1000 },
    logging: { quiet: true },
  });
  const provider = new ethers.BrowserProvider(gProvider);
  try {
    const deployer = await provider.getSigner(0);
    const backendSigner = deriveWallet(provider, 0);
    const allowlistSigners = [];
    for (let i = 1; i <= 13; i += 1) {
      allowlistSigners.push(deriveWallet(provider, i));
    }

    const artifacts = compilePhilContracts();
    const { renderer } = await deployHybridRendererSystem(deployer, artifacts);

    const deployerAddress = await deployer.getAddress();
    const nonce = await provider.getTransactionCount(deployerAddress);
    const expectedMint = ethers.getCreateAddress({ from: deployerAddress, nonce: nonce + 1 });

    const gate = await deployContract(deployer, getArtifact(artifacts, 'ProofGateTest13'), [
      PROGRAM_HASH,
      DROP_ID,
      expectedMint,
    ]);
    const gateAddress = await gate.getAddress();

    const mint = await deployContract(deployer, getArtifact(artifacts, 'PhilTestMint'), [
      await renderer.getAddress(),
      gateAddress,
      deployerAddress,
    ]);

    const mintAbi = [
      'function mint(address recipient,address mintTo,uint8 philId,uint8 paletteVariant,uint8 mixMode,uint32 mixSeed,(uint256 expiry,bytes32 factHash,bytes signature) proof)',
      'function totalSupply() view returns (uint256)',
    ];
    const mintContract = new ethers.Contract(await mint.getAddress(), mintAbi, deployer);

    const firstSigner = allowlistSigners[0];
    const firstAddress = firstSigner.address;

    const firstProof = await generateLocalMintProof({
      signer: backendSigner,
      programHash: PROGRAM_HASH,
      dropId: DROP_ID,
      chainId: CHAIN_ID,
      proofGateAddress: gateAddress,
      recipient: firstAddress,
      mintTo: firstAddress,
      philId: 0,
      paletteVariant: 8,
      mixMode: 2,
      mixSeed: 123456789,
      expiry: 0,
    });

    await (await mintContract.mint(firstAddress, firstAddress, 0, 8, 2, 123456789, {
      expiry: firstProof.expiry,
      factHash: firstProof.factHash,
      signature: firstProof.signature,
    })).wait();

    await expectRevert(() =>
      mintContract.mint(firstAddress, firstAddress, 0, 8, 2, 123456789, {
        expiry: firstProof.expiry,
        factHash: firstProof.factHash,
        signature: firstProof.signature,
      })
    );

    const outsider = deriveWallet(provider, 20);
    const outsiderAddress = outsider.address;
    const outsiderProof = await generateLocalMintProof({
      signer: backendSigner,
      programHash: PROGRAM_HASH,
      dropId: DROP_ID,
      chainId: CHAIN_ID,
      proofGateAddress: gateAddress,
      recipient: outsiderAddress,
      mintTo: outsiderAddress,
      philId: 1,
      paletteVariant: 7,
      mixMode: 0,
      mixSeed: 0,
      expiry: 0,
    });

    await (await mintContract.mint(outsiderAddress, outsiderAddress, 1, 7, 0, 0, {
      expiry: outsiderProof.expiry,
      factHash: outsiderProof.factHash,
      signature: outsiderProof.signature,
    })).wait();

    const malformed = { ...firstProof, factHash: ethers.hexlify(ethers.randomBytes(32)) };
    await expectRevert(() =>
      mintContract.mint(firstAddress, firstAddress, 2, 6, 1, 111, {
        expiry: malformed.expiry,
        factHash: malformed.factHash,
        signature: firstProof.signature,
      })
    );

    const forged = await generateLocalMintProof({
      signer: outsider,
      programHash: PROGRAM_HASH,
      dropId: DROP_ID,
      chainId: CHAIN_ID,
      proofGateAddress: gateAddress,
      recipient: firstAddress,
      mintTo: firstAddress,
      philId: 3,
      paletteVariant: 5,
      mixMode: 1,
      mixSeed: 333,
      expiry: 0,
    });

    await expectRevert(() =>
      mintContract.mint(firstAddress, firstAddress, 3, 5, 1, 333, {
        expiry: forged.expiry,
        factHash: forged.factHash,
        signature: forged.signature,
      })
    );

    assert.equal(Number(await mintContract.totalSupply()), 2);
  } finally {
    gProvider.disconnect();
  }
});
