import test from 'node:test';
import assert from 'node:assert/strict';
import ganache from 'ganache';
import { ethers } from 'ethers';

import { compilePhilContracts } from '../scripts/local/compileContracts.mjs';
import {
  buildAndRegisterMintProof,
  buildMintProof,
  createEligibilityContext,
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
const PROGRAM_HASH = '0x5555555555555555555555555555555555555555555555555555555555555555';
const CONTEXT_ID = 99n;

function deriveWallet(provider, index) {
  const hd = ethers.HDNodeWallet.fromPhrase(MNEMONIC, undefined, `m/44'/60'/0'/0/${index}`);
  return hd.connect(provider);
}

function collectHexStrings(value, out = new Set(), depth = 0) {
  if (depth > 6 || value == null) return out;
  if (typeof value === 'string') {
    if (value.startsWith('0x') && value.length >= 10) out.add(value);
    return out;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectHexStrings(item, out, depth + 1);
    return out;
  }
  if (typeof value === 'object') {
    for (const item of Object.values(value)) collectHexStrings(item, out, depth + 1);
  }
  return out;
}

function decodeCustomErrorName(err, ifaces) {
  const dataCandidates = Array.from(collectHexStrings(err));
  for (const data of dataCandidates) {
    for (const iface of ifaces) {
      try {
        const parsed = iface.parseError(data);
        if (parsed?.name) return parsed.name;
      } catch {
        // try next candidate
      }
    }
  }
  const msg = String(err?.shortMessage ?? err?.message ?? '');
  const matched = msg.match(/custom error '([A-Za-z0-9_]+)\(/);
  return matched ? matched[1] : null;
}

async function expectCustomError(sendTx, expectedError, ifaces) {
  try {
    const tx = await sendTx();
    await tx.wait();
    assert.fail(`Expected ${expectedError} but transaction succeeded`);
  } catch (err) {
    const actual = decodeCustomErrorName(err, ifaces);
    assert.equal(actual, expectedError, `Expected ${expectedError}, got ${actual ?? 'unknown error'}`);
  }
}

test('error cases: mint input validation, gate restrictions, and supply cap', async () => {
  const gProvider = ganache.provider({
    chain: { chainId: CHAIN_ID },
    wallet: { mnemonic: MNEMONIC, totalAccounts: 40, defaultBalance: 1000 },
    logging: { quiet: true },
  });
  const provider = new ethers.BrowserProvider(gProvider);

  try {
    const deployer = await provider.getSigner(0);
    const signers = [];
    for (let i = 1; i <= 15; i += 1) signers.push(deriveWallet(provider, i));
    const eligibility = createEligibilityContext(
      signers.map((signer) => signer.address),
      { contextId: CONTEXT_ID, credentialsPerAddress: 1, seed: 'error-cases-contract-test' }
    );

    const artifacts = compilePhilContracts();
    const { renderer } = await deployHybridRendererSystem(deployer, artifacts);

    const deployerAddress = await deployer.getAddress();
    const nonce = await provider.getTransactionCount(deployerAddress);
    const expectedMint = ethers.getCreateAddress({ from: deployerAddress, nonce: nonce + 3 });

    const gateArtifact = getArtifact(artifacts, 'PhilIdentityGate');
    const mintArtifact = getArtifact(artifacts, 'PhilIdentityMint');
    const { registry, gate } = await deployFactProofGate({
      signer: deployer,
      deployContract,
      gateArtifact,
      registryArtifact: getArtifact(artifacts, 'DevProofVerifier'),
      verifierArtifact: getArtifact(artifacts, 'FactRegistryHumanityVerifier'),
      programHash: PROGRAM_HASH,
      contextId: CONTEXT_ID,
      verifierConfigHash: eligibility.bundle.verifierConfigHash,
      initialAuthorizedCaller: expectedMint,
    });
    const mint = await deployContract(deployer, mintArtifact, [
      await renderer.getAddress(),
      await gate.getAddress(),
      deployerAddress,
    ]);

    const mintContract = new ethers.Contract(await mint.getAddress(), mintArtifact.abi, deployer);
    const gateContract = new ethers.Contract(await gate.getAddress(), gateArtifact.abi, deployer);

    const mintIface = new ethers.Interface(mintArtifact.abi);
    const gateIface = new ethers.Interface(gateArtifact.abi);
    const ifaces = [mintIface, gateIface];

    const firstSigner = signers[0];
    const firstAddress = firstSigner.address;
    const gateAddress = await gate.getAddress();

    const validProof = await buildAndRegisterMintProof({
      registry,
      credential: eligibility.credentialFor(firstAddress),
      programHash: PROGRAM_HASH,
      contextId: CONTEXT_ID,
      chainId: CHAIN_ID,
      proofGateAddress: gateAddress,
      recipient: firstAddress,
      mintTo: firstAddress,
      philId: 0,
      paletteVariant: 0,
      mixMode: 0,
      mixSeed: 0,
      expiry: 0,
    });

    await expectCustomError(
      () => mintContract.connect(firstSigner).mint(firstAddress, firstAddress, 6, 0, 0, 0, toMintProof(validProof)),
      'BadPhilId',
      ifaces
    );

    await expectCustomError(
      () => mintContract.connect(firstSigner).mint(firstAddress, firstAddress, 0, 9, 0, 0, toMintProof(validProof)),
      'BadPaletteVariant',
      ifaces
    );

    await expectCustomError(
      () => mintContract.connect(firstSigner).mint(firstAddress, firstAddress, 0, 0, 3, 0, toMintProof(validProof)),
      'BadMixMode',
      ifaces
    );

    const expiredProof = await buildMintProof({
      credential: eligibility.credentialFor(firstAddress),
      programHash: PROGRAM_HASH,
      contextId: CONTEXT_ID,
      chainId: CHAIN_ID,
      proofGateAddress: gateAddress,
      recipient: firstAddress,
      mintTo: firstAddress,
      philId: 0,
      paletteVariant: 0,
      mixMode: 0,
      mixSeed: 0,
      expiry: 1n,
    });
    await registerProofFact(registry, expiredProof);

    await expectCustomError(
      () => mintContract.connect(firstSigner).mint(firstAddress, firstAddress, 0, 0, 0, 0, toMintProof(expiredProof)),
      'ProofExpired',
      ifaces
    );

    await expectCustomError(
      () => gateContract.connect(firstSigner).verifyAndConsume(firstAddress, firstAddress, 0, 0, 0, 0, toMintProof(validProof)),
      'UnauthorizedCaller',
      ifaces
    );

    for (let i = 0; i < 13; i += 1) {
      const signer = signers[i];
      const addr = signer.address;
      const philId = i % 6;
      const paletteVariant = i % 9;
      const proof = await buildAndRegisterMintProof({
        registry,
        credential: eligibility.credentialFor(addr),
        programHash: PROGRAM_HASH,
        contextId: CONTEXT_ID,
        chainId: CHAIN_ID,
        proofGateAddress: gateAddress,
        recipient: addr,
        mintTo: addr,
        philId,
        paletteVariant,
        mixMode: 0,
        mixSeed: 0,
        expiry: 0,
      });

      await (await mintContract.connect(signer).mint(addr, addr, philId, paletteVariant, 0, 0, toMintProof(proof))).wait();
    }

    assert.equal(Number(await mintContract.totalSupply()), 13);

    const signer14 = signers[13];
    const addr14 = signer14.address;
    const proof14 = await buildAndRegisterMintProof({
      registry,
      credential: eligibility.credentialFor(addr14),
      programHash: PROGRAM_HASH,
      contextId: CONTEXT_ID,
      chainId: CHAIN_ID,
      proofGateAddress: gateAddress,
      recipient: addr14,
      mintTo: addr14,
      philId: 13 % 6,
      paletteVariant: 13 % 9,
      mixMode: 0,
      mixSeed: 0,
      expiry: 0,
    });

    await expectCustomError(
      () => mintContract.connect(signer14).mint(addr14, addr14, 13 % 6, 13 % 9, 0, 0, toMintProof(proof14)),
      'SoldOut',
      ifaces
    );

    assert.equal(Number(await mintContract.totalSupply()), 13);
  } finally {
    gProvider.disconnect();
  }
});
