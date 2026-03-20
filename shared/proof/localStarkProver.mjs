import { ethers } from 'ethers';
import { hash } from 'starknet';

export const ACTION_MINT = 1;
export const ACTION_ACCOUNT_CREATE = 2;
export const ACTION_CADENCE_MINT = 4;
export const ACTION_CADENCE_RESERVE = 5;
export const HUMANITY_PROVIDER_LOCAL_CREDENTIAL = 'local-credential';
export const HUMANITY_PROVIDER_LOCAL_CREDENTIAL_COMMITMENT = 'local-credential-commitment';
export const HUMANITY_PROVIDER_MOCK = 'mock-humanity';
export const HUMANITY_PROVIDER_MODE_CODE_LOCAL_CREDENTIAL = 1n;
export const HUMANITY_PROVIDER_MODE_CODE_MOCK = 2n;
export const DOMAIN_LOCAL_COMMITMENT = 1n;
export const DOMAIN_LOCAL_NULLIFIER = 2n;
export const DOMAIN_MOCK_COMMITMENT = 3n;
export const DOMAIN_MOCK_NULLIFIER = 4n;
export const DOMAIN_COMMITMENT = DOMAIN_LOCAL_COMMITMENT;
export const DOMAIN_NULLIFIER = DOMAIN_LOCAL_NULLIFIER;

function pedersen(a, b) {
  return BigInt(hash.computePedersenHash(a.toString(), b.toString()));
}

function resolveProofContext(params) {
  if (params.proofContext != null) {
    return params.proofContext;
  }
  if (params.contextId != null) {
    return params.contextId;
  }
  throw new Error('proofContext is required');
}

function resolveVerifierConfigHash(params) {
  if (params.verifierConfigHash != null) {
    return params.verifierConfigHash;
  }
  if (params.eligibilityRoot != null) {
    return params.eligibilityRoot;
  }
  throw new Error('verifierConfigHash is required');
}

function normalizeHumanityProviderMode(providerMode) {
  const normalized = String(providerMode || HUMANITY_PROVIDER_LOCAL_CREDENTIAL).trim().toLowerCase();
  if (
    normalized === HUMANITY_PROVIDER_LOCAL_CREDENTIAL ||
    normalized === HUMANITY_PROVIDER_LOCAL_CREDENTIAL_COMMITMENT ||
    normalized === 'credential' ||
    normalized === 'local'
  ) {
    return HUMANITY_PROVIDER_LOCAL_CREDENTIAL;
  }
  if (normalized === HUMANITY_PROVIDER_MOCK || normalized === 'mock') {
    return HUMANITY_PROVIDER_MOCK;
  }
  throw new Error(`Unsupported humanity provider mode: ${providerMode}`);
}

function normalizeSubjectValue(value) {
  if (typeof value === 'string' && /^0x[a-fA-F0-9]{40}$/.test(value.trim())) {
    return BigInt(ethers.getAddress(value));
  }
  return BigInt(value);
}

export function resolveHumanityProviderModeCode(providerMode) {
  if (typeof providerMode === 'bigint') {
    if (
      providerMode === HUMANITY_PROVIDER_MODE_CODE_LOCAL_CREDENTIAL ||
      providerMode === HUMANITY_PROVIDER_MODE_CODE_MOCK
    ) {
      return providerMode;
    }
    throw new Error(`Unsupported humanity provider mode code: ${providerMode}`);
  }

  const normalized = normalizeHumanityProviderMode(providerMode);
  return normalized === HUMANITY_PROVIDER_MOCK
    ? HUMANITY_PROVIDER_MODE_CODE_MOCK
    : HUMANITY_PROVIDER_MODE_CODE_LOCAL_CREDENTIAL;
}

function resolveCommitmentDomain(providerModeCode) {
  if (providerModeCode === HUMANITY_PROVIDER_MODE_CODE_LOCAL_CREDENTIAL) {
    return DOMAIN_LOCAL_COMMITMENT;
  }
  if (providerModeCode === HUMANITY_PROVIDER_MODE_CODE_MOCK) {
    return DOMAIN_MOCK_COMMITMENT;
  }
  throw new Error(`Unsupported humanity provider mode code: ${providerModeCode}`);
}

function resolveNullifierDomain(providerModeCode) {
  if (providerModeCode === HUMANITY_PROVIDER_MODE_CODE_LOCAL_CREDENTIAL) {
    return DOMAIN_LOCAL_NULLIFIER;
  }
  if (providerModeCode === HUMANITY_PROVIDER_MODE_CODE_MOCK) {
    return DOMAIN_MOCK_NULLIFIER;
  }
  throw new Error(`Unsupported humanity provider mode code: ${providerModeCode}`);
}

export function resolveIdentitySubject({
  providerMode,
  recipient,
  subject,
  identitySubject,
  mockHumanIdHash,
}) {
  const providerModeCode = resolveHumanityProviderModeCode(providerMode);
  const explicitSubject = identitySubject ?? subject ?? mockHumanIdHash;
  if (explicitSubject != null) {
    return normalizeSubjectValue(explicitSubject);
  }
  if (providerModeCode === HUMANITY_PROVIDER_MODE_CODE_LOCAL_CREDENTIAL) {
    return normalizeSubjectValue(recipient);
  }
  throw new Error('identitySubject or mockHumanIdHash is required for mock-humanity mode');
}

function resolveProofDomain({ chainId, proofGateAddress, proofGate }) {
  if (chainId == null) {
    throw new Error('chainId is required for domain-separated proof claims');
  }

  const resolvedProofGate = proofGateAddress || proofGate;
  if (!resolvedProofGate) {
    throw new Error('proofGateAddress is required for domain-separated proof claims');
  }

  return {
    chainId: BigInt(chainId),
    proofGateAddress: ethers.getAddress(resolvedProofGate),
  };
}

export function computeClaimHash({
  proofContext,
  contextId,
  programHash,
  chainId,
  proofGateAddress,
  proofGate,
  recipient,
  mintTo,
  philId,
  paletteVariant,
  mixMode = 0,
  mixSeed = 0,
  expiry,
}) {
  const resolvedProofContext = resolveProofContext({ proofContext, contextId });
  const domain = resolveProofDomain({ chainId, proofGateAddress, proofGate });
  return ethers.keccak256(
    ethers.AbiCoder.defaultAbiCoder().encode(
      ['bytes32', 'uint256', 'uint256', 'address', 'address', 'address', 'uint8', 'uint8', 'uint8', 'uint32', 'uint256'],
      [
        ethers.zeroPadValue(programHash, 32),
        BigInt(resolvedProofContext),
        domain.chainId,
        domain.proofGateAddress,
        ethers.getAddress(recipient),
        ethers.getAddress(mintTo),
        philId,
        paletteVariant,
        Number(mixMode) >>> 0,
        Number(mixSeed) >>> 0,
        BigInt(expiry),
      ]
    )
  );
}

export function computeActionClaimHash({
  proofContext,
  contextId,
  programHash,
  chainId,
  proofGateAddress,
  proofGate,
  recipient,
  actionType,
  actionHash,
  expiry,
}) {
  const resolvedProofContext = resolveProofContext({ proofContext, contextId });
  const domain = resolveProofDomain({ chainId, proofGateAddress, proofGate });
  return ethers.keccak256(
    ethers.AbiCoder.defaultAbiCoder().encode(
      ['bytes32', 'uint256', 'uint256', 'address', 'address', 'uint8', 'bytes32', 'uint256'],
      [
        ethers.zeroPadValue(programHash, 32),
        BigInt(resolvedProofContext),
        domain.chainId,
        domain.proofGateAddress,
        ethers.getAddress(recipient),
        Number(actionType) >>> 0,
        ethers.zeroPadValue(actionHash, 32),
        BigInt(expiry),
      ]
    )
  );
}

export function splitClaimHash(claimHash) {
  const value = BigInt(claimHash);
  return {
    hi: value >> 128n,
    lo: value & ((1n << 128n) - 1n),
  };
}

export function computeCredentialCommitment({
  secret,
  recipient,
  subject,
  identitySubject,
  providerMode = HUMANITY_PROVIDER_LOCAL_CREDENTIAL,
}) {
  const providerModeCode = resolveHumanityProviderModeCode(providerMode);
  const resolvedSubject = resolveIdentitySubject({
    providerMode: providerModeCode,
    recipient,
    subject,
    identitySubject,
  });
  return pedersen(
    resolveCommitmentDomain(providerModeCode),
    pedersen(BigInt(secret), resolvedSubject)
  );
}

export function computeIdentityNullifier({
  secret,
  proofContext,
  recipient,
  claimKind,
  subject,
  identitySubject,
  mockHumanIdHash,
  providerMode = HUMANITY_PROVIDER_LOCAL_CREDENTIAL,
}) {
  const providerModeCode = resolveHumanityProviderModeCode(providerMode);
  const resolvedSubject = resolveIdentitySubject({
    providerMode: providerModeCode,
    recipient,
    subject,
    identitySubject,
    mockHumanIdHash,
  });
  return pedersen(
    resolveNullifierDomain(providerModeCode),
    pedersen(
      BigInt(secret),
      pedersen(
        BigInt(claimKind),
        pedersen(BigInt(proofContext), resolvedSubject)
      )
    )
  );
}

export function encodeProofMetadata({
  identityNullifier,
  credentialCommitment,
}) {
  return ethers.AbiCoder.defaultAbiCoder().encode(
    ['uint256', 'uint256'],
    [BigInt(identityNullifier), BigInt(credentialCommitment)]
  );
}

export function decodeProofMetadata(encoded) {
  const [identityNullifier, credentialCommitment] = ethers.AbiCoder.defaultAbiCoder().decode(
    ['uint256', 'uint256'],
    encoded
  );
  return {
    identityNullifier: BigInt(identityNullifier),
    credentialCommitment: BigInt(credentialCommitment),
  };
}

export function buildFactOutputs({
  verifierConfigHash,
  proofContext,
  recipient,
  claimHash,
  identityNullifier,
  credentialCommitment,
  claimKind,
}) {
  const split = splitClaimHash(claimHash);
  return [
    BigInt(verifierConfigHash),
    BigInt(proofContext),
    BigInt(recipient),
    split.hi,
    split.lo,
    BigInt(identityNullifier),
    BigInt(credentialCommitment),
    BigInt(claimKind),
  ];
}

export function computeFactHash({
  programHash,
  outputs,
}) {
  const packedOutputs = ethers.solidityPacked(
    new Array(outputs.length).fill('uint256'),
    outputs.map((value) => BigInt(value).toString())
  );
  const outputsHash = ethers.keccak256(packedOutputs);
  return ethers.keccak256(
    ethers.AbiCoder.defaultAbiCoder().encode(
      ['bytes32', 'bytes32'],
      [ethers.zeroPadValue(programHash, 32), outputsHash]
    )
  ).toLowerCase();
}

export function computeMintActionHash({
  mintTo,
  philId,
  paletteVariant,
  mixMode = 0,
  mixSeed = 0,
}) {
  return ethers.keccak256(
    ethers.AbiCoder.defaultAbiCoder().encode(
      ['address', 'uint8', 'uint8', 'uint8', 'uint32'],
      [
        ethers.getAddress(mintTo),
        philId,
        paletteVariant,
        Number(mixMode) >>> 0,
        Number(mixSeed) >>> 0,
      ]
    )
  );
}

export function buildProofPayload({
  programHash,
  proofContext,
  contextId,
  recipient,
  claimHash,
  claimKind,
  verifierConfigHash,
  eligibilityRoot,
  secret,
  expiry,
  providerMode = HUMANITY_PROVIDER_LOCAL_CREDENTIAL,
  subject,
  identitySubject,
  mockHumanIdHash,
}) {
  const resolvedProofContext = resolveProofContext({ proofContext, contextId });
  const resolvedVerifierConfigHash = resolveVerifierConfigHash({ verifierConfigHash, eligibilityRoot });
  const normalizedRecipient = BigInt(ethers.getAddress(recipient));
  const resolvedIdentitySubject = resolveIdentitySubject({
    providerMode,
    recipient,
    subject,
    identitySubject,
    mockHumanIdHash,
  });
  const credentialCommitment = computeCredentialCommitment({
    secret,
    recipient: normalizedRecipient,
    subject: resolvedIdentitySubject,
    providerMode,
  });
  const identityNullifier = computeIdentityNullifier({
    secret,
    proofContext: resolvedProofContext,
    recipient: normalizedRecipient,
    claimKind,
    subject: resolvedIdentitySubject,
    providerMode,
  });
  const outputs = buildFactOutputs({
    verifierConfigHash: resolvedVerifierConfigHash,
    proofContext: resolvedProofContext,
    recipient: normalizedRecipient,
    claimHash,
    identityNullifier,
    credentialCommitment,
    claimKind,
  });
  const factHash = computeFactHash({
    programHash,
    outputs,
  });

  return {
    expiry: BigInt(expiry),
    factHash,
    signature: encodeProofMetadata({ identityNullifier, credentialCommitment }),
    claimHash,
    claimKind,
    outputs,
    publicOutputs: {
      verifierConfigHash: BigInt(resolvedVerifierConfigHash),
      proofContext: BigInt(resolvedProofContext),
      recipient: normalizedRecipient,
      claimHashHi: outputs[3],
      claimHashLo: outputs[4],
      identityNullifier,
      credentialCommitment,
      claimKind: BigInt(claimKind),
    },
  };
}

export async function generateLocalMintProof({
  programHash,
  proofContext,
  contextId,
  chainId,
  proofGateAddress,
  proofGate,
  recipient,
  mintTo,
  philId,
  paletteVariant,
  mixMode = 0,
  mixSeed = 0,
  expiry,
  verifierConfigHash,
  eligibilityRoot,
  secret,
  providerMode = HUMANITY_PROVIDER_LOCAL_CREDENTIAL,
  subject,
  identitySubject,
  mockHumanIdHash,
}) {
  const resolvedProofContext = resolveProofContext({ proofContext, contextId });
  const resolvedVerifierConfigHash = resolveVerifierConfigHash({ verifierConfigHash, eligibilityRoot });
  const claimHash = computeClaimHash({
    programHash,
    proofContext: resolvedProofContext,
    chainId,
    proofGateAddress,
    proofGate,
    recipient,
    mintTo,
    philId,
    paletteVariant,
    mixMode,
    mixSeed,
    expiry,
  });

  return buildProofPayload({
    programHash,
    proofContext: resolvedProofContext,
    recipient,
    claimHash,
    claimKind: ACTION_MINT,
    verifierConfigHash: resolvedVerifierConfigHash,
    secret,
    expiry,
    providerMode,
    subject,
    identitySubject,
    mockHumanIdHash,
  });
}

export async function generateLocalActionProof({
  programHash,
  proofContext,
  contextId,
  chainId,
  proofGateAddress,
  proofGate,
  recipient,
  actionType,
  actionHash,
  expiry,
  verifierConfigHash,
  eligibilityRoot,
  secret,
  providerMode = HUMANITY_PROVIDER_LOCAL_CREDENTIAL,
  subject,
  identitySubject,
  mockHumanIdHash,
}) {
  const resolvedProofContext = resolveProofContext({ proofContext, contextId });
  const resolvedVerifierConfigHash = resolveVerifierConfigHash({ verifierConfigHash, eligibilityRoot });
  const claimHash = computeActionClaimHash({
    programHash,
    proofContext: resolvedProofContext,
    chainId,
    proofGateAddress,
    proofGate,
    recipient,
    actionType,
    actionHash,
    expiry,
  });

  return buildProofPayload({
    programHash,
    proofContext: resolvedProofContext,
    recipient,
    claimHash,
    claimKind: actionType,
    verifierConfigHash: resolvedVerifierConfigHash,
    secret,
    expiry,
    providerMode,
    subject,
    identitySubject,
    mockHumanIdHash,
  });
}

export function prepareScarbInput({
  secret,
  siblings,
  pathIndices,
  commitmentRoot,
  eligibilityRoot,
  proofContext,
  contextId,
  recipient,
  claimHash,
  claimKind,
  providerMode = HUMANITY_PROVIDER_LOCAL_CREDENTIAL,
  subject,
  identitySubject,
  mockHumanIdHash,
}) {
  const resolvedCommitmentRoot = resolveVerifierConfigHash({
    verifierConfigHash: commitmentRoot,
    eligibilityRoot,
  });
  const resolvedProofContext = resolveProofContext({ proofContext, contextId });
  const split = splitClaimHash(claimHash);
  const providerModeCode = resolveHumanityProviderModeCode(providerMode);
  const resolvedIdentitySubject = resolveIdentitySubject({
    providerMode: providerModeCode,
    recipient,
    subject,
    identitySubject,
    mockHumanIdHash,
  });
  return [
    BigInt(secret),
    BigInt(siblings.length),
    ...siblings.map((value) => BigInt(value)),
    BigInt(pathIndices.length),
    ...pathIndices.map((value) => BigInt(value)),
    BigInt(resolvedCommitmentRoot),
    BigInt(resolvedProofContext),
    BigInt(recipient),
    split.hi,
    split.lo,
    BigInt(claimKind),
    providerModeCode,
    resolvedIdentitySubject,
  ];
}
