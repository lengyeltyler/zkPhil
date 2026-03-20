import assert from 'node:assert/strict';
import hre from 'hardhat';
import { ethers } from 'ethers';

import { buildMintProof, createEligibilityContext, deployFactProofGate, registerProofFact, toMintProof } from './proof-fixture.mjs';
import { PHIL_LAYER_ORDER } from '../src/layer-catalog.mjs';
import { FIXTURE_VARIANTS } from './hybrid-renderer-helpers.mjs';

const PROGRAM_HASH = '0x' + '44'.repeat(32);
const CONTEXT_ID = 13n;
const CHAIN_ID = 31337;

function resolveArtifactName(name) {
  switch (name) {
    case 'MockRenderer':
      return 'contracts/mocks/MockRenderer.sol:MockRenderer';
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

async function deployImmutableRendererSystem(signer) {
  const ownerAddress = await signer.getAddress();
  const storage = await deploy('PhilSVGStorage', signer, [ownerAddress]);
  const registry = await deploy('PhilLayerRegistry', signer, [
    await storage.getAddress(),
    ownerAddress,
  ]);

  await (await registry.registerLayers(
    PHIL_LAYER_ORDER.map((layer) => ({
      name: layer.name,
      minSelections: layer.minSelections,
      maxSelections: layer.maxSelections,
    }))
  )).wait();

  const assetInputs = [];
  const variantInputs = [];
  let nextAssetId = 1;

  for (const variant of FIXTURE_VARIANTS) {
    const svgBytes = Buffer.from(variant.svg);
    const svgId = await storage.storeSvg.staticCall(svgBytes);
    await (await storage.storeSvg(svgBytes)).wait();

    assetInputs.push({
      layerId: variant.layerId,
      storageId: svgId,
      sublayer: variant.sublayer,
      fileName: variant.fileName,
    });
    variantInputs.push({
      layerId: variant.layerId,
      label: variant.label,
      style: variant.style,
      color: variant.color,
      assetIds: [nextAssetId],
    });
    nextAssetId += 1;
  }

  await (await registry.registerAssets(assetInputs)).wait();
  await (await registry.registerVariants(variantInputs)).wait();

  const renderer = await deploy('PhilRenderer', signer, [
    await registry.getAddress(),
    await storage.getAddress(),
    ethers.ZeroAddress,
  ]);
  const web3 = await deploy('PhilWeb3', signer, [await renderer.getAddress()]);

  return { renderer, web3 };
}

async function buildFixture() {
  const provider = new ethers.BrowserProvider(hre.network.provider);
  const deployer = await provider.getSigner(0);
  const recipientSigner = await provider.getSigner(1);
  const otherEligibleSigner = await provider.getSigner(2);
  const wrongSigner = await provider.getSigner(3);
  const backendSigner = await provider.getSigner(4);

  const deployerAddress = await deployer.getAddress();
  const recipient = await recipientSigner.getAddress();
  const otherEligible = await otherEligibleSigner.getAddress();
  const wrongAddress = await wrongSigner.getAddress();

  const eligibility = createEligibilityContext(
    [recipient, otherEligible, wrongAddress],
    { contextId: CONTEXT_ID, credentialsPerAddress: 1, seed: 'proofgate-hardhat-fixture' }
  );

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

  return {
    registry,
    gate,
    gateAddress,
    mint,
    eligibility,
    backendSigner,
    recipientSigner,
    otherEligibleSigner,
    wrongSigner,
  };
}

describe('PhilIdentityGate fact-backed mint verification', function () {
  this.timeout(120000);

  it('accepts a valid locally generated mint proof once its fact is registered', async () => {
    const fixture = await buildFixture();
    const recipient = await fixture.recipientSigner.getAddress();

    const proof = await buildMintProof({
      credential: fixture.eligibility.credentialFor(recipient),
      programHash: PROGRAM_HASH,
      contextId: CONTEXT_ID,
      chainId: CHAIN_ID,
      proofGateAddress: fixture.gateAddress,
      recipient,
      mintTo: recipient,
      philId: 1,
      paletteVariant: 2,
      mixMode: 0,
      mixSeed: 7,
      expiry: Math.floor(Date.now() / 1000) + 900,
    });
    await registerProofFact(fixture.registry, proof);

    const tx = await fixture.mint.mint(
      recipient,
      recipient,
      1,
      2,
      0,
      7,
      toMintProof(proof)
    );
    await tx.wait();

    assert.equal(await fixture.mint.totalSupply(), 1n);
    assert.equal((await fixture.mint.ownerOf(0)).toLowerCase(), recipient.toLowerCase());
  });

  it('rejects an old backend ECDSA signature payload even if the claim hash was signed', async () => {
    const fixture = await buildFixture();
    const recipient = await fixture.recipientSigner.getAddress();
    const expiry = Math.floor(Date.now() / 1000) + 900;
    const claimHash = await fixture.gate.computeClaimHash(
      recipient,
      recipient,
      1,
      2,
      0,
      7,
      expiry
    );
    const legacySignature = await fixture.backendSigner.signMessage(ethers.getBytes(claimHash));

    await assert.rejects(
      fixture.mint.mint(recipient, recipient, 1, 2, 0, 7, {
        expiry,
        factHash: ethers.ZeroHash,
        signature: legacySignature,
      }),
      /InvalidProofMetadata|execution reverted/
    );
  });

  it('rejects expired fact-backed mint proofs', async () => {
    const fixture = await buildFixture();
    const recipient = await fixture.recipientSigner.getAddress();

    const proof = await buildMintProof({
      credential: fixture.eligibility.credentialFor(recipient),
      programHash: PROGRAM_HASH,
      contextId: CONTEXT_ID,
      chainId: CHAIN_ID,
      proofGateAddress: fixture.gateAddress,
      recipient,
      mintTo: recipient,
      philId: 1,
      paletteVariant: 2,
      mixMode: 0,
      mixSeed: 7,
      expiry: 1,
    });
    await registerProofFact(fixture.registry, proof);

    await assert.rejects(
      fixture.mint.mint(recipient, recipient, 1, 2, 0, 7, toMintProof(proof)),
      /ProofExpired|execution reverted/
    );
  });

  it('rejects replaying the same fact-backed mint proof', async () => {
    const fixture = await buildFixture();
    const recipient = await fixture.recipientSigner.getAddress();

    const proof = await buildMintProof({
      credential: fixture.eligibility.credentialFor(recipient),
      programHash: PROGRAM_HASH,
      contextId: CONTEXT_ID,
      chainId: CHAIN_ID,
      proofGateAddress: fixture.gateAddress,
      recipient,
      mintTo: recipient,
      philId: 1,
      paletteVariant: 2,
      mixMode: 0,
      mixSeed: 7,
      expiry: Math.floor(Date.now() / 1000) + 900,
    });
    await registerProofFact(fixture.registry, proof);

    const encodedProof = toMintProof(proof);
    const first = await fixture.mint.mint(recipient, recipient, 1, 2, 0, 7, encodedProof);
    await first.wait();

    await assert.rejects(
      fixture.mint.mint(recipient, recipient, 1, 2, 0, 7, encodedProof),
      /NullifierAlreadyUsed|execution reverted/
    );
  });

  it('rejects proofs reused with different mint parameters', async () => {
    const fixture = await buildFixture();
    const recipient = await fixture.recipientSigner.getAddress();

    const proof = await buildMintProof({
      credential: fixture.eligibility.credentialFor(recipient),
      programHash: PROGRAM_HASH,
      contextId: CONTEXT_ID,
      chainId: CHAIN_ID,
      proofGateAddress: fixture.gateAddress,
      recipient,
      mintTo: recipient,
      philId: 1,
      paletteVariant: 2,
      mixMode: 0,
      mixSeed: 7,
      expiry: Math.floor(Date.now() / 1000) + 900,
    });
    await registerProofFact(fixture.registry, proof);

    await assert.rejects(
      fixture.mint.mint(recipient, recipient, 1, 2, 0, 8, toMintProof(proof)),
      /InvalidFactHash|execution reverted/
    );
  });

  it('always inlines tokenURI metadata even if a web3 gateway exists', async () => {
    const provider = new ethers.BrowserProvider(hre.network.provider);
    const deployer = await provider.getSigner(0);
    const recipientSigner = await provider.getSigner(1);
    const recipient = await recipientSigner.getAddress();

    const eligibility = createEligibilityContext([recipient], {
      contextId: CONTEXT_ID,
      credentialsPerAddress: 1,
      seed: 'proofgate-tokenuri-test',
    });

    const deployerAddress = await deployer.getAddress();
    const { renderer, web3 } = await deployImmutableRendererSystem(deployer);
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

    const proof = await buildMintProof({
      credential: eligibility.credentialFor(recipient),
      programHash: PROGRAM_HASH,
      contextId: CONTEXT_ID,
      chainId: CHAIN_ID,
      proofGateAddress: gateAddress,
      recipient,
      mintTo: recipient,
      philId: 0,
      paletteVariant: 0,
      mixMode: 0,
      mixSeed: 0,
      expiry: Math.floor(Date.now() / 1000) + 900,
    });
    await registerProofFact(registry, proof);

    await (await mint.mint(
      recipient,
      recipient,
      0,
      0,
      0,
      0,
      toMintProof(proof)
    )).wait();

    const callOverrides = { gasLimit: 5_000_000n };
    const originalTokenURI = await mint.tokenURI.staticCall(0n, callOverrides);
    assert.match(originalTokenURI, /^data:application\/json;base64,/);
    const metadata = JSON.parse(
      Buffer.from(originalTokenURI.split(',')[1], 'base64').toString('utf8')
    );
    assert.match(metadata.image, /^data:image\/svg\+xml;base64,/);
    assert.doesNotMatch(originalTokenURI, /web3:\/\//);

    const [mime, data] = await web3.read.staticCall('/svg/0/0/0/0', callOverrides);
    assert.equal(mime, 'image/svg+xml');
    assert.match(ethers.toUtf8String(data), /^<svg /);

    await (await renderer.setGateway(await web3.getAddress())).wait();
    assert.equal(await mint.tokenURI.staticCall(0n, callOverrides), originalTokenURI);

    await assert.rejects(
      renderer.setCompactTokenURI(true),
      /CompactTokenURIDisabled|execution reverted/
    );
    assert.equal(await mint.tokenURI.staticCall(0n, callOverrides), originalTokenURI);
  });
});
