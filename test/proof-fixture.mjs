import { ethers } from 'ethers';

import { buildCredentialBundle, getRecipientCredentials } from '../shared/proof/credentialBundle.mjs';
import { buildMockHumanityBundle, getMockHuman } from '../shared/proof/mockHumanityBundle.mjs';
import {
  generateLocalActionProof,
  generateLocalMintProof,
  HUMANITY_PROVIDER_MOCK,
} from '../shared/proof/localStarkProver.mjs';

export function createEligibilityContext(addresses, { proofContext, contextId, credentialsPerAddress, seed } = {}) {
  const resolvedProofContext = proofContext ?? contextId;
  if (resolvedProofContext == null) {
    throw new Error('proofContext is required for test credential fixtures');
  }
  const resolvedCredentialsPerAddress = credentialsPerAddress ?? 1;
  const entries = [];
  for (const address of addresses) {
    for (let credentialNonce = 0; credentialNonce < resolvedCredentialsPerAddress; credentialNonce += 1) {
      entries.push({ recipient: address, credentialNonce });
    }
  }

  const bundle = buildCredentialBundle({
    proofContext: resolvedProofContext,
    entries,
    seed,
  });

  return {
    bundle,
    credentialFor(address, credentialIndex = 0) {
      const credentials = getRecipientCredentials(bundle, address);
      const entry = credentials[credentialIndex];
      if (!entry) {
        throw new Error(`missing credential for ${address} at index ${credentialIndex}`);
      }
      return {
        verifierConfigHash: bundle.verifierConfigHash,
        credentialSecret: entry.secret,
        credentialCommitment: entry.credentialCommitment,
        commitmentWitness: {
          commitmentRoot: bundle.verifierConfigHash,
          siblings: entry.siblings,
          pathIndices: entry.pathIndices,
        },
      };
    },
  };
}

export function createMockHumanityContext(mockHumans, { proofContext, contextId, seed } = {}) {
  const resolvedProofContext = proofContext ?? contextId;
  if (resolvedProofContext == null) {
    throw new Error('proofContext is required for mock humanity fixtures');
  }

  const humans = mockHumans.map((entry, index) => {
    if (typeof entry === 'string') {
      return {
        mockHumanId: entry,
        label: entry,
      };
    }

    return {
      mockHumanId: entry.mockHumanId || entry.id || `mock-human-${index}`,
      label: entry.label || entry.mockHumanId || entry.id || `Mock Human ${index + 1}`,
      secret: entry.secret,
    };
  });

  const bundle = buildMockHumanityBundle({
    proofContext: resolvedProofContext,
    humans,
    seed,
  });

  return {
    bundle,
    humanFor(mockHumanId) {
      const entry = getMockHuman(bundle, mockHumanId);
      if (!entry) {
        throw new Error(`missing mock human fixture for ${mockHumanId}`);
      }
      return {
        verifierConfigHash: bundle.verifierConfigHash,
        humanitySecret: entry.humanitySecret,
        credentialCommitment: entry.humanityCommitment,
        providerMode: HUMANITY_PROVIDER_MOCK,
        mockHumanId: entry.mockHumanId,
        mockHumanIdHash: entry.mockHumanIdHash,
        identitySource: {
          kind: 'mock-human',
          value: entry.mockHumanIdHash,
          label: entry.label,
          mockHumanId: entry.mockHumanId,
        },
        commitmentWitness: {
          commitmentRoot: bundle.verifierConfigHash,
          siblings: entry.siblings,
          pathIndices: entry.pathIndices,
        },
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
  verifierArtifact,
  programHash,
  proofContext,
  contextId,
  verifierConfigHash,
  initialAuthorizedCaller,
}) {
  const operator = await signer.getAddress();
  const registry = await deployContract(signer, registryArtifact, [operator]);
  const verifier = await deployContract(signer, verifierArtifact, [
    programHash,
    proofContext ?? contextId,
    await registry.getAddress(),
    verifierConfigHash,
  ]);
  const gate = await deployContract(signer, gateArtifact, [
    await verifier.getAddress(),
    initialAuthorizedCaller,
  ]);

  return {
    registry,
    verifier,
    gate,
  };
}

export async function registerProofFact(registry, proof) {
  await (await registry.registerFact(ethers.zeroPadValue(proof.factHash, 32))).wait();
}

export async function buildMintProof({
  credential,
  programHash,
  proofContext,
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
    proofContext: proofContext ?? contextId,
    chainId,
    proofGateAddress,
    recipient,
    mintTo,
    philId,
    paletteVariant,
    mixMode,
    mixSeed,
    expiry,
    verifierConfigHash: credential.verifierConfigHash,
    secret: credential.humanitySecret ?? credential.credentialSecret,
    providerMode: credential.providerMode,
    identitySubject: credential.identitySource?.value,
    mockHumanIdHash: credential.mockHumanIdHash,
  });
}

export async function buildActionProof({
  credential,
  programHash,
  proofContext,
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
    proofContext: proofContext ?? contextId,
    chainId,
    proofGateAddress,
    recipient,
    actionType,
    actionHash,
    expiry,
    verifierConfigHash: credential.verifierConfigHash,
    secret: credential.humanitySecret ?? credential.credentialSecret,
    providerMode: credential.providerMode,
    identitySubject: credential.identitySource?.value,
    mockHumanIdHash: credential.mockHumanIdHash,
  });
}

export async function buildAndRegisterMintProof({
  registry,
  credential,
  programHash,
  proofContext,
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
    proofContext: proofContext ?? contextId,
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
  proofContext,
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
    proofContext: proofContext ?? contextId,
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
