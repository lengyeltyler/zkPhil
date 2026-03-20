import assert from 'node:assert/strict';
import hre from 'hardhat';
import { ethers } from 'ethers';

import {
  buildAndRegisterMintProof,
  createEligibilityContext,
  deployFactProofGate,
  toMintProof,
} from './proof-fixture.mjs';

const PROGRAM_HASH = '0x' + '44'.repeat(32);
const CONTEXT_ID = 13n;
const CHAIN_ID = 31337;
const BPS_DENOMINATOR = 10_000n;

function resolveArtifactName(name) {
  switch (name) {
    case 'MockRenderer':
      return 'contracts/mocks/MockRenderer.sol:MockRenderer';
    case 'MarketplaceReentrantBuyer':
      return 'contracts/mocks/MarketplaceReentrantBuyer.sol:MarketplaceReentrantBuyer';
    case 'DevProofVerifier':
      return 'contracts/proofs/DevProofVerifier.sol:DevProofVerifier';
    case 'FactRegistryHumanityVerifier':
      return 'contracts/proofs/FactRegistryHumanityVerifier.sol:FactRegistryHumanityVerifier';
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

async function getChainBalance(address) {
  return BigInt(await hre.network.provider.send('eth_getBalance', [address, 'latest']));
}

function computeRoyalty(amount, royaltyBps) {
  return (amount * BigInt(royaltyBps)) / BPS_DENOMINATOR;
}

async function mintPhil({ mint, registry, gateAddress, eligibility, recipient, tokenIndex }) {
  const recipientAddress = typeof recipient === 'string' ? recipient : await recipient.getAddress();
  const philId = tokenIndex % 6;
  const paletteVariant = tokenIndex % 9;
  const mixMode = tokenIndex % 3;
  const mixSeed = tokenIndex + 1;
  const expiry = Math.floor(Date.now() / 1000) + 900;
  const tokenId = await mint.totalSupply();

  const proof = await buildAndRegisterMintProof({
    registry,
    credential: eligibility.credentialFor(recipientAddress, tokenIndex),
    programHash: PROGRAM_HASH,
    contextId: CONTEXT_ID,
    chainId: CHAIN_ID,
    proofGateAddress: gateAddress,
    recipient: recipientAddress,
    mintTo: recipientAddress,
    philId,
    paletteVariant,
    mixMode,
    mixSeed,
    expiry,
  });

  const tx = await mint.mint(
    recipientAddress,
    recipientAddress,
    philId,
    paletteVariant,
    mixMode,
    mixSeed,
    toMintProof(proof)
  );
  await tx.wait();

  return tokenId;
}

async function buildFixture({ royaltyBps = 369 } = {}) {
  const provider = new ethers.BrowserProvider(hre.network.provider);
  const deployer = await provider.getSigner(0);
  const seller = await provider.getSigner(1);
  const buyer = await provider.getSigner(2);
  const privateBuyer = await provider.getSigner(3);
  const otherBuyer = await provider.getSigner(4);
  const bidderOne = await provider.getSigner(5);
  const bidderTwo = await provider.getSigner(6);
  const royaltyRecipient = await provider.getSigner(7);

  const deployerAddress = await deployer.getAddress();
  const sellerAddress = await seller.getAddress();
  const eligibility = createEligibilityContext([sellerAddress], {
    contextId: CONTEXT_ID,
    credentialsPerAddress: 4,
    seed: 'phil-marketplace-test',
  });

  const renderer = await deploy('MockRenderer', deployer);
  const registryArtifact = await hre.artifacts.readArtifact(resolveArtifactName('DevProofVerifier'));
  const gateArtifact = await hre.artifacts.readArtifact(resolveArtifactName('PhilIdentityGate'));
  const verifierArtifact = await hre.artifacts.readArtifact(resolveArtifactName('FactRegistryHumanityVerifier'));
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
    verifierArtifact,
    programHash: PROGRAM_HASH,
    contextId: CONTEXT_ID,
    verifierConfigHash: eligibility.bundle.verifierConfigHash,
    initialAuthorizedCaller: deployerAddress,
  });
  const gateAddress = await gate.getAddress();
  const mint = await deploy('PhilIdentityMint', deployer, [
    await renderer.getAddress(),
    gateAddress,
    deployerAddress,
  ]);
  await (await gate.setAuthorizedCaller(await mint.getAddress(), true)).wait();

  const marketplace = await deploy('PhilMarketplace', deployer, [
    await mint.getAddress(),
    await royaltyRecipient.getAddress(),
    royaltyBps,
  ]);
  const reentrantBuyer = await deploy('MarketplaceReentrantBuyer', deployer, [
    await marketplace.getAddress(),
  ]);

  for (let tokenIndex = 0; tokenIndex < 4; tokenIndex += 1) {
    await mintPhil({
      mint,
      registry,
      gateAddress,
      eligibility,
      recipient: sellerAddress,
      tokenIndex,
    });
  }

  return {
    provider,
    deployer,
    seller,
    sellerAddress,
    buyer,
    privateBuyer,
    otherBuyer,
    bidderOne,
    bidderTwo,
    royaltyRecipient,
    gate,
    mint,
    marketplace,
    reentrantBuyer,
    royaltyBps,
  };
}

describe('PhilMarketplace core flows', function () {
  this.timeout(120000);

  it('supports a public offer and buy flow', async () => {
    const fixture = await buildFixture();
    const price = ethers.parseEther('1');
    const tokenId = 0n;
    const royaltyAmount = computeRoyalty(price, fixture.royaltyBps);

    await (await fixture.mint.connect(fixture.seller).approve(await fixture.marketplace.getAddress(), tokenId)).wait();
    await (await fixture.marketplace.connect(fixture.seller).offerForSale(tokenId, price, ethers.ZeroAddress)).wait();

    const sellerBalanceBefore = await getChainBalance(fixture.sellerAddress);
    const royaltyRecipientBefore = await getChainBalance(await fixture.royaltyRecipient.getAddress());
    const tx = await fixture.marketplace.connect(fixture.buyer).buy(tokenId, { value: price });
    await tx.wait();

    const sellerBalanceAfter = await getChainBalance(fixture.sellerAddress);
    const royaltyRecipientAfter = await getChainBalance(await fixture.royaltyRecipient.getAddress());
    assert.equal((await fixture.mint.ownerOf(tokenId)).toLowerCase(), (await fixture.buyer.getAddress()).toLowerCase());
    assert.equal(sellerBalanceAfter - sellerBalanceBefore, price - royaltyAmount);
    assert.equal(royaltyRecipientAfter - royaltyRecipientBefore, royaltyAmount);
    assert.equal((await fixture.marketplace.offers(tokenId)).seller, ethers.ZeroAddress);
    assert.equal(await getChainBalance(await fixture.marketplace.getAddress()), 0n);
  });

  it('restricts private offers to the designated buyer', async () => {
    const fixture = await buildFixture();
    const price = ethers.parseEther('1');
    const tokenId = 1n;

    await (await fixture.mint.connect(fixture.seller).approve(await fixture.marketplace.getAddress(), tokenId)).wait();
    await (await fixture.marketplace.connect(fixture.seller).offerForSale(
      tokenId,
      price,
      await fixture.privateBuyer.getAddress()
    )).wait();

    await assert.rejects(
      fixture.marketplace.connect(fixture.otherBuyer).buy(tokenId, { value: price }),
      /NotAuthorizedBuyer|execution reverted/
    );

    const tx = await fixture.marketplace.connect(fixture.privateBuyer).buy(tokenId, { value: price });
    await tx.wait();

    assert.equal(
      (await fixture.mint.ownerOf(tokenId)).toLowerCase(),
      (await fixture.privateBuyer.getAddress()).toLowerCase()
    );
  });

  it('allows sellers to cancel active offers', async () => {
    const fixture = await buildFixture();
    const tokenId = 0n;

    await (await fixture.mint.connect(fixture.seller).approve(await fixture.marketplace.getAddress(), tokenId)).wait();
    await (await fixture.marketplace.connect(fixture.seller).offerForSale(
      tokenId,
      ethers.parseEther('0.5'),
      ethers.ZeroAddress
    )).wait();
    await (await fixture.marketplace.connect(fixture.seller).cancelOffer(tokenId)).wait();

    assert.equal((await fixture.marketplace.offers(tokenId)).seller, ethers.ZeroAddress);
    await assert.rejects(
      fixture.marketplace.connect(fixture.buyer).buy(tokenId, { value: ethers.parseEther('0.5') }),
      /NoActiveOffer|execution reverted/
    );
  });

  it('holds bids in escrow and lets bidders withdraw them', async () => {
    const fixture = await buildFixture();
    const tokenId = 0n;
    const bidAmount = ethers.parseEther('1');

    await (await fixture.marketplace.connect(fixture.bidderOne).enterBid(tokenId, { value: bidAmount })).wait();

    let bid = await fixture.marketplace.bids(tokenId);
    assert.equal(bid.bidder.toLowerCase(), (await fixture.bidderOne.getAddress()).toLowerCase());
    assert.equal(bid.amount, bidAmount);
    assert.equal(await getChainBalance(await fixture.marketplace.getAddress()), bidAmount);

    await (await fixture.marketplace.connect(fixture.bidderOne).withdrawBid(tokenId)).wait();

    bid = await fixture.marketplace.bids(tokenId);
    assert.equal(bid.bidder, ethers.ZeroAddress);
    assert.equal(bid.amount, 0n);
    assert.equal(await getChainBalance(await fixture.marketplace.getAddress()), 0n);
  });

  it('lets the token owner accept the current highest bid and receive the proceeds', async () => {
    const fixture = await buildFixture();
    const tokenId = 2n;
    const bidAmount = ethers.parseEther('1');
    const royaltyAmount = computeRoyalty(bidAmount, fixture.royaltyBps);

    await (await fixture.mint.connect(fixture.seller).setApprovalForAll(await fixture.marketplace.getAddress(), true)).wait();
    await (await fixture.marketplace.connect(fixture.bidderOne).enterBid(tokenId, { value: bidAmount })).wait();

    const sellerBalanceBefore = await getChainBalance(fixture.sellerAddress);
    const royaltyRecipientBefore = await getChainBalance(await fixture.royaltyRecipient.getAddress());
    const tx = await fixture.marketplace.connect(fixture.seller).acceptBid(tokenId, bidAmount);
    const receipt = await tx.wait();
    const gasPrice = receipt.gasPrice ?? receipt.effectiveGasPrice ?? 0n;
    const gasCost = receipt.gasUsed * gasPrice;

    const sellerBalanceAfter = await getChainBalance(fixture.sellerAddress);
    const royaltyRecipientAfter = await getChainBalance(await fixture.royaltyRecipient.getAddress());
    const bid = await fixture.marketplace.bids(tokenId);
    assert.equal((await fixture.mint.ownerOf(tokenId)).toLowerCase(), (await fixture.bidderOne.getAddress()).toLowerCase());
    assert.equal(sellerBalanceAfter - sellerBalanceBefore + gasCost, bidAmount - royaltyAmount);
    assert.equal(royaltyRecipientAfter - royaltyRecipientBefore, royaltyAmount);
    assert.equal(bid.bidder, ethers.ZeroAddress);
    assert.equal(bid.amount, 0n);
    assert.equal(await getChainBalance(await fixture.marketplace.getAddress()), 0n);
  });

  it('refunds the previous highest bidder when a higher bid is placed', async () => {
    const fixture = await buildFixture();
    const tokenId = 3n;
    const firstBid = ethers.parseEther('1');
    const secondBid = ethers.parseEther('2');
    const firstBidderAddress = await fixture.bidderOne.getAddress();
    const firstBidderBalanceBefore = await getChainBalance(firstBidderAddress);

    const firstTx = await fixture.marketplace.connect(fixture.bidderOne).enterBid(tokenId, { value: firstBid });
    const firstReceipt = await firstTx.wait();
    const firstGasPrice = firstReceipt.gasPrice ?? firstReceipt.effectiveGasPrice ?? 0n;
    const firstGasCost = firstReceipt.gasUsed * firstGasPrice;
    assert.equal(await getChainBalance(await fixture.marketplace.getAddress()), firstBid);

    await (await fixture.marketplace.connect(fixture.bidderTwo).enterBid(tokenId, { value: secondBid })).wait();

    const bid = await fixture.marketplace.bids(tokenId);
    const firstBidderBalanceAfter = await getChainBalance(firstBidderAddress);
    assert.equal(bid.bidder.toLowerCase(), (await fixture.bidderTwo.getAddress()).toLowerCase());
    assert.equal(bid.amount, secondBid);
    assert.equal(await getChainBalance(await fixture.marketplace.getAddress()), secondBid);
    assert.equal(firstBidderBalanceBefore - firstBidderBalanceAfter, firstGasCost);
  });

  it('blocks reentrant nested buys from an ERC721 receiver callback', async () => {
    const fixture = await buildFixture();
    const price = ethers.parseEther('1');

    await (await fixture.mint.connect(fixture.seller).setApprovalForAll(await fixture.marketplace.getAddress(), true)).wait();
    await (await fixture.marketplace.connect(fixture.seller).offerForSale(0n, price, ethers.ZeroAddress)).wait();
    await (await fixture.marketplace.connect(fixture.seller).offerForSale(1n, price, ethers.ZeroAddress)).wait();

    await (await fixture.deployer.sendTransaction({
      to: await fixture.reentrantBuyer.getAddress(),
      value: price,
    })).wait();
    await (await fixture.reentrantBuyer.configureReentry(1n, price)).wait();

    const tx = await fixture.reentrantBuyer.attackBuy(0n, { value: price });
    await tx.wait();

    assert.equal(
      (await fixture.mint.ownerOf(0n)).toLowerCase(),
      (await fixture.reentrantBuyer.getAddress()).toLowerCase()
    );
    assert.equal((await fixture.mint.ownerOf(1n)).toLowerCase(), fixture.sellerAddress.toLowerCase());
    assert.equal(await fixture.reentrantBuyer.attemptedReentry(), true);
    assert.equal(await fixture.reentrantBuyer.reentrySucceeded(), false);
  });

  it('requires marketplace approval for offers and bid acceptance', async () => {
    const fixture = await buildFixture();
    const tokenId = 0n;
    const bidAmount = ethers.parseEther('1');

    await assert.rejects(
      fixture.marketplace.connect(fixture.seller).offerForSale(tokenId, bidAmount, ethers.ZeroAddress),
      /MarketplaceNotApproved|execution reverted/
    );

    await (await fixture.marketplace.connect(fixture.bidderOne).enterBid(tokenId, { value: bidAmount })).wait();

    await assert.rejects(
      fixture.marketplace.connect(fixture.seller).acceptBid(tokenId, bidAmount),
      /MarketplaceNotApproved|execution reverted/
    );
  });

  it('routes sale ETH only to the seller and royalty recipient', async () => {
    const salePrice = ethers.parseEther('1');

    const fixture = await buildFixture();
    const royaltyAmount = computeRoyalty(salePrice, fixture.royaltyBps);
    await (await fixture.mint.connect(fixture.seller).approve(await fixture.marketplace.getAddress(), 0n)).wait();
    await (await fixture.marketplace.connect(fixture.seller).offerForSale(
      0n,
      salePrice,
      ethers.ZeroAddress
    )).wait();

    const sellerBefore = await getChainBalance(fixture.sellerAddress);
    const royaltyRecipientBefore = await getChainBalance(await fixture.royaltyRecipient.getAddress());
    await (await fixture.marketplace.connect(fixture.buyer).buy(0n, { value: salePrice })).wait();
    const sellerAfter = await getChainBalance(fixture.sellerAddress);
    const royaltyRecipientAfter = await getChainBalance(await fixture.royaltyRecipient.getAddress());

    assert.equal(sellerAfter - sellerBefore, salePrice - royaltyAmount);
    assert.equal(royaltyRecipientAfter - royaltyRecipientBefore, royaltyAmount);
    assert.equal(
      (sellerAfter - sellerBefore) + (royaltyRecipientAfter - royaltyRecipientBefore),
      salePrice
    );
    assert.equal(await getChainBalance(await fixture.marketplace.getAddress()), 0n);
  });
});
