import { ethers } from 'ethers';

import { buildEligibilityBundle, getRecipientCredentials } from '../shared/proof/eligibilityBundle.mjs';
import {
  generateLocalActionProof,
  generateLocalMintProof,
} from '../shared/proof/localStarkProver.mjs';

export function createEligibilityContext(addresses, { contextId, credentialsPerAddress, seed } = {}) {
  if (contextId == null) {
    throw new Error('contextId is required for test eligibility fixtures');
  }
  const resolvedCredentialsPerAddress = credentialsPerAddress ?? 1;
  const entries = [];
  for (const address of addresses) {
    for (let credentialSlot = 0; credentialSlot < resolvedCredentialsPerAddress; credentialSlot += 1) {
      entries.push({ recipient: address, credentialSlot });
    }
  }

  const bundle = buildEligibilityBundle({
    contextId,
    entries,
    seed,
  });

  return {
    bundle,
    credentialFor(address, credentialSlot = 0) {
      const credentials = getRecipientCredentials(bundle, address);
      const entry = credentials.find((candidate) => Number(candidate.credentialSlot) === credentialSlot);
      if (!entry) {
        throw new Error(`missing eligibility credential for ${address} credentialSlot ${credentialSlot}`);
      }
      return {
        eligibilityRoot: bundle.eligibilityRoot,
        credentialSlot: entry.credentialSlot,
        secret: entry.secret,
        credentialLeaf: entry.credentialLeaf,
        siblings: entry.siblings,
        pathIndices: entry.pathIndices,
      };
    },
  };
}

export function toMintProof(proof) {
  return {
    expiry: proof.expiry,
    factHash: proof.factHash,
    signature: proof.signature,
  };
}

export async function deployFactProofGate({
  signer,
  deployContract,
  gateArtifact,
  registryArtifact,
  programHash,
  contextId,
  eligibilityRoot,
  initialAuthorizedCaller,
}) {
  const operator = await signer.getAddress();
  const registry = await deployContract(signer, registryArtifact, [operator]);
  const gate = await deployContract(signer, gateArtifact, [
    programHash,
    contextId,
    await registry.getAddress(),
    eligibilityRoot,
    initialAuthorizedCaller,
  ]);

  return {
    registry,
    gate,
  };
}

export async function registerProofFact(registry, proof) {
  await (await registry.registerFact(ethers.zeroPadValue(proof.factHash, 32))).wait();
}

export async function buildMintProof({
  credential,
  programHash,
  contextId,
  chainId,
  proofGateAddress,
  recipient,
  mintTo,
  philId,
  paletteVariant,
  mixMode = 0,
  mixSeed = 0,
  expiry,
}) {
  return generateLocalMintProof({
    programHash,
    contextId,
    chainId,
    proofGateAddress,
    recipient,
    mintTo,
    philId,
    paletteVariant,
    mixMode,
    mixSeed,
    expiry,
    eligibilityRoot: credential.eligibilityRoot,
    secret: credential.secret,
    credentialSlot: credential.credentialSlot,
  });
}

export async function buildActionProof({
  credential,
  programHash,
  contextId,
  chainId,
  proofGateAddress,
  recipient,
  actionType,
  actionHash,
  expiry,
}) {
  return generateLocalActionProof({
    programHash,
    contextId,
    chainId,
    proofGateAddress,
    recipient,
    actionType,
    actionHash,
    expiry,
    eligibilityRoot: credential.eligibilityRoot,
    secret: credential.secret,
    credentialSlot: credential.credentialSlot,
  });
}

export async function buildAndRegisterMintProof({
  registry,
  credential,
  programHash,
  contextId,
  chainId,
  proofGateAddress,
  recipient,
  mintTo,
  philId,
  paletteVariant,
  mixMode = 0,
  mixSeed = 0,
  expiry,
}) {
  const proof = await buildMintProof({
    credential,
    programHash,
    contextId,
    chainId,
    proofGateAddress,
    recipient,
    mintTo,
    philId,
    paletteVariant,
    mixMode,
    mixSeed,
    expiry,
  });
  await registerProofFact(registry, proof);
  return proof;
}

export async function buildAndRegisterActionProof({
  registry,
  credential,
  programHash,
  contextId,
  chainId,
  proofGateAddress,
  recipient,
  actionType,
  actionHash,
  expiry,
}) {
  const proof = await buildActionProof({
    credential,
    programHash,
    contextId,
    chainId,
    proofGateAddress,
    recipient,
    actionType,
    actionHash,
    expiry,
  });
  await registerProofFact(registry, proof);
  return proof;
}
