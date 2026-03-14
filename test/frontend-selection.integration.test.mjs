import test from 'node:test';
import assert from 'node:assert/strict';
import ganache from 'ganache';
import { ethers } from 'ethers';

import { compilePhilContracts } from '../scripts/local/compileContracts.mjs';
import { generateLocalMintProof } from '../shared/proof/localStarkProver.mjs';
import { buildFeedSequence } from '../frontend-local/src/feed.js';
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

test('frontend-selected combo is exactly persisted and rendered on-chain', async () => {
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

    const mint = await deployContract(deployer, getArtifact(artifacts, 'PhilTestMint'), [
      await renderer.getAddress(),
      await gate.getAddress(),
      deployerAddress,
    ]);

    const mintAbi = [
      'function mint(address recipient,address mintTo,uint8 philId,uint8 paletteVariant,uint8 mixMode,uint32 mixSeed,(uint256 expiry,bytes32 factHash,bytes signature) proof)',
      'function totalSupply() view returns (uint256)',
      'function philIdOf(uint256 tokenId) view returns (uint8)',
      'function paletteVariantOf(uint256 tokenId) view returns (uint8)',
      'function mixModeOf(uint256 tokenId) view returns (uint8)',
      'function mixSeedOf(uint256 tokenId) view returns (uint32)',
    ];

    const mintContract = new ethers.Contract(await mint.getAddress(), mintAbi, deployer);
    const selected = buildFeedSequence({ feedSeed: 987654321, length: 80 }).items[17];
    const minter = allowlistSigners[2];

    const proof = await generateLocalMintProof({
      signer: backendSigner,
      programHash: PROGRAM_HASH,
      dropId: DROP_ID,
      chainId: CHAIN_ID,
      proofGateAddress: await gate.getAddress(),
      recipient: minter.address,
      mintTo: minter.address,
      philId: selected.philId,
      paletteVariant: selected.paletteVariant,
      mixMode: selected.mixMode,
      mixSeed: selected.mixSeed,
      expiry: 0,
    });

    const tokenId = Number(await mintContract.totalSupply());
    await (await mintContract.mint(
      minter.address,
      minter.address,
      selected.philId,
      selected.paletteVariant,
      selected.mixMode,
      selected.mixSeed,
      {
        expiry: proof.expiry,
        factHash: proof.factHash,
        signature: proof.signature,
      }
    )).wait();

    assert.equal(Number(await mintContract.philIdOf(tokenId)), selected.philId);
    assert.equal(Number(await mintContract.paletteVariantOf(tokenId)), selected.paletteVariant);
    assert.equal(Number(await mintContract.mixModeOf(tokenId)), selected.mixMode);
    assert.equal(Number(await mintContract.mixSeedOf(tokenId)), selected.mixSeed);
  } finally {
    gProvider.disconnect();
  }
});
