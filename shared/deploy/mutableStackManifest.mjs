import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { ethers } from 'ethers';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, '..', '..');

export const MUTABLE_STACK_IDENTITY_PROOF = 'identity-proof';
export const MUTABLE_STACK_ACCOUNT_ABSTRACTION = 'account-abstraction';

const STACK_CONFIG = {
  [MUTABLE_STACK_IDENTITY_PROOF]: {
    prefix: 'stark',
    label: 'Mutable identity/proof stack',
    expectedComponents: ['PhilIdentityGate', 'PhilIdentityMint', 'humanityVerifier'],
    expectedDependencies: ['factRegistry'],
    optionalComponents: ['PhilRenderer', 'PhilWeb3'],
    optionalDependencies: ['PhilSVGStorage', 'PhilLayerRegistry', 'PhilNFT'],
    legacyFields: ['ProofGateTest13', 'PhilTestMint', 'dropId', 'allowlistSigner'],
    compatibilityAliases: ['ProofGate', 'FactRegistryHumanityVerifier', 'MockHumanityVerifier'],
    componentCandidates: {
      PhilIdentityGate: ['components.PhilIdentityGate', 'contracts.PhilIdentityGate', 'PhilIdentityGate', 'ProofGate'],
      PhilIdentityMint: ['components.PhilIdentityMint', 'contracts.PhilIdentityMint', 'PhilIdentityMint', 'PhilTestMint'],
      humanityVerifier: [
        'components.humanityVerifier',
        'contracts.humanityVerifier',
        'humanityVerifier',
        'MockHumanityVerifier',
        'FactRegistryHumanityVerifier',
      ],
      PhilRenderer: ['components.PhilRenderer', 'contracts.PhilRenderer', 'PhilRenderer'],
      PhilWeb3: ['components.PhilWeb3', 'contracts.PhilWeb3', 'PhilWeb3'],
    },
    dependencyCandidates: {
      factRegistry: ['dependencies.factRegistry', 'config.factRegistry', 'factRegistry'],
      PhilSVGStorage: ['dependencies.PhilSVGStorage', 'contracts.PhilSVGStorage', 'PhilSVGStorage'],
      PhilLayerRegistry: ['dependencies.PhilLayerRegistry', 'contracts.PhilLayerRegistry', 'PhilLayerRegistry'],
      PhilNFT: ['dependencies.PhilNFT', 'contracts.PhilNFT', 'PhilNFT'],
    },
    configKeys: [
      'humanityProvider',
      'programHash',
      'proofContext',
      'verifierConfigHash',
      'artBackendReused',
      'artBackendMode',
      'artBackendManifest',
      'artBackendSource',
      'proofMode',
    ],
    placeholderSensitiveConfigKeys: [],
    extraCompatibilityFields: ['chainId'],
  },
  [MUTABLE_STACK_ACCOUNT_ABSTRACTION]: {
    prefix: '4337',
    label: 'Mutable account/paymaster stack',
    expectedComponents: ['PhilAccountFactory', 'PhilPaymaster', 'PhilUnlockInbox'],
    expectedDependencies: ['PhilIdentityMint', 'PhilIdentityGate', 'EntryPoint'],
    optionalComponents: ['PhilAccountImpl', 'MockStarknetCore'],
    optionalDependencies: [],
    legacyFields: [],
    compatibilityAliases: [],
    componentCandidates: {
      PhilAccountImpl: ['components.PhilAccountImpl', 'contracts.PhilAccountImpl', 'PhilAccountImpl'],
      PhilUnlockInbox: ['components.PhilUnlockInbox', 'contracts.PhilUnlockInbox', 'PhilUnlockInbox'],
      PhilAccountFactory: ['components.PhilAccountFactory', 'contracts.PhilAccountFactory', 'PhilAccountFactory'],
      PhilPaymaster: ['components.PhilPaymaster', 'contracts.PhilPaymaster', 'PhilPaymaster'],
      MockStarknetCore: ['components.MockStarknetCore', 'contracts.MockStarknetCore', 'MockStarknetCore'],
    },
    dependencyCandidates: {
      PhilIdentityMint: ['dependencies.PhilIdentityMint', 'links.PhilIdentityMint', 'PhilIdentityMint'],
      PhilIdentityGate: ['dependencies.PhilIdentityGate', 'links.PhilIdentityGate', 'PhilIdentityGate', 'ProofGate'],
      EntryPoint: ['dependencies.EntryPoint', 'links.EntryPoint', 'EntryPoint'],
    },
    configKeys: [
      'paymasterSigner',
      'starknetCore',
      'l2UnlockVerifier',
      'paymasterDeposit',
      'useMockInbox',
    ],
    placeholderSensitiveConfigKeys: ['paymasterSigner', 'starknetCore', 'l2UnlockVerifier'],
    extraCompatibilityFields: ['chainId'],
  },
};

function readJson(filePath) {
  if (!fs.existsSync(filePath)) {
    return null;
  }
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function hasValue(value) {
  if (typeof value === 'boolean') {
    return true;
  }
  return String(value ?? '').trim().length > 0;
}

function looksLikePlaceholder(value) {
  const normalized = String(value ?? '').trim().toLowerCase();
  return (
    !normalized ||
    normalized.includes('your_') ||
    normalized.includes('placeholder') ||
    normalized.includes('rpc.example') ||
    normalized.includes('example')
  );
}

function looksLikeAddress(value) {
  const trimmed = String(value ?? '').trim();
  if (!trimmed || looksLikePlaceholder(trimmed)) {
    return false;
  }
  try {
    ethers.getAddress(trimmed);
    return true;
  } catch {
    return false;
  }
}

function normalizeAddress(value) {
  const trimmed = String(value ?? '').trim();
  if (!trimmed || looksLikePlaceholder(trimmed)) {
    return '';
  }
  try {
    return ethers.getAddress(trimmed);
  } catch {
    return trimmed;
  }
}

function getFromPath(target, dottedPath) {
  const segments = dottedPath.split('.');
  let current = target;
  for (const segment of segments) {
    if (!current || typeof current !== 'object' || !(segment in current)) {
      return undefined;
    }
    current = current[segment];
  }
  return current;
}

function pickResolvedValue(rawManifest, candidates, normalizer = (value) => value) {
  for (const candidate of candidates) {
    const rawValue = getFromPath(rawManifest, candidate);
    if (hasValue(rawValue)) {
      return {
        value: normalizer(rawValue),
        source: candidate,
      };
    }
  }
  return {
    value: '',
    source: '',
  };
}

function normalizeConfigValue(value) {
  if (typeof value === 'boolean') {
    return value;
  }
  const trimmed = String(value ?? '').trim();
  return trimmed;
}

function coerceStructuredConfig(rawManifest, config) {
  const components = {};
  const dependencies = {};
  const configValues = {};
  const resolvedFrom = {
    components: {},
    dependencies: {},
    config: {},
  };

  for (const [key, candidates] of Object.entries(config.componentCandidates)) {
    const resolved = pickResolvedValue(rawManifest, candidates, normalizeAddress);
    components[key] = resolved.value;
    resolvedFrom.components[key] = resolved.source;
  }

  for (const [key, candidates] of Object.entries(config.dependencyCandidates)) {
    const resolved = pickResolvedValue(rawManifest, candidates, normalizeAddress);
    dependencies[key] = resolved.value;
    resolvedFrom.dependencies[key] = resolved.source;
  }

  for (const key of config.configKeys) {
    const resolved = pickResolvedValue(
      rawManifest,
      [`config.${key}`, key],
      normalizeConfigValue
    );
    configValues[key] = resolved.value;
    resolvedFrom.config[key] = resolved.source;
  }

  return {
    components,
    dependencies,
    config: configValues,
    resolvedFrom,
  };
}

function buildCompatibilitySummary(rawManifest, config) {
  return {
    legacyFieldsPresent: config.legacyFields.filter((field) => hasValue(rawManifest?.[field])),
    compatibilityAliasesPresent: config.compatibilityAliases.filter((field) => hasValue(rawManifest?.[field])),
  };
}

function analyzeStructuredManifest(rawManifest, stack, manifestPath) {
  const config = STACK_CONFIG[stack];
  if (!config) {
    throw new Error(`Unsupported mutable stack: ${stack}`);
  }

  if (!rawManifest || typeof rawManifest !== 'object') {
    return {
      stack,
      label: config.label,
      prefix: config.prefix,
      manifestPath,
      exists: false,
      schema: '',
      chainId: null,
      generatedAt: '',
      sourceScript: '',
      components: {},
      dependencies: {},
      config: {},
      resolvedFrom: { components: {}, dependencies: {}, config: {} },
      expectedComponents: [...config.expectedComponents],
      expectedDependencies: [...config.expectedDependencies],
      missingComponents: [...config.expectedComponents],
      missingDependencies: [...config.expectedDependencies],
      placeholderConfig: [],
      invalidComponents: [],
      invalidDependencies: [],
      legacyFieldsPresent: [],
      compatibilityAliasesPresent: [],
      classification: 'missing',
      blockers: [`Manifest is missing at ${manifestPath}.`],
      raw: null,
    };
  }

  const normalized = coerceStructuredConfig(rawManifest, config);
  const compatibilitySummary = buildCompatibilitySummary(rawManifest, config);

  const missingComponents = config.expectedComponents.filter((key) => !looksLikeAddress(normalized.components[key]));
  const missingDependencies = config.expectedDependencies.filter((key) => !looksLikeAddress(normalized.dependencies[key]));
  const invalidComponents = Object.entries(normalized.components)
    .filter(([, value]) => hasValue(value) && !looksLikeAddress(value))
    .map(([key]) => key);
  const invalidDependencies = Object.entries(normalized.dependencies)
    .filter(([, value]) => hasValue(value) && !looksLikeAddress(value))
    .map(([key]) => key);
  const placeholderConfig = config.placeholderSensitiveConfigKeys.filter((key) =>
    looksLikePlaceholder(normalized.config[key])
  );

  const blockers = [];
  for (const key of missingComponents) {
    blockers.push(`Missing component ${key}.`);
  }
  for (const key of missingDependencies) {
    blockers.push(`Missing dependency ${key}.`);
  }
  for (const key of invalidComponents) {
    blockers.push(`Component ${key} is set but not a valid address.`);
  }
  for (const key of invalidDependencies) {
    blockers.push(`Dependency ${key} is set but not a valid address.`);
  }
  for (const key of placeholderConfig) {
    blockers.push(`Config ${key} is missing or placeholder-configured.`);
  }
  if (
    rawManifest.ProofMode &&
    String(rawManifest.ProofMode).trim().toUpperCase() === 'BACKEND_SIGNER_ONLY'
  ) {
    blockers.push('Legacy ProofMode=BACKEND_SIGNER_ONLY is still present.');
  }

  let classification = 'complete';
  if (missingComponents.length > 0 || missingDependencies.length > 0 || invalidComponents.length > 0 || invalidDependencies.length > 0) {
    classification = 'partial';
  } else if (placeholderConfig.length > 0) {
    classification = 'placeholder-configured';
  }

  return {
    stack,
    label: config.label,
    prefix: config.prefix,
    manifestPath,
    exists: true,
    schema: String(rawManifest.schema || ''),
    chainId: Number(rawManifest.chainId || 0) || null,
    generatedAt: String(rawManifest.generatedAt || ''),
    sourceScript: String(rawManifest.sourceScript || ''),
    components: normalized.components,
    dependencies: normalized.dependencies,
    config: normalized.config,
    resolvedFrom: normalized.resolvedFrom,
    expectedComponents: [...config.expectedComponents],
    expectedDependencies: [...config.expectedDependencies],
    optionalComponents: [...config.optionalComponents],
    optionalDependencies: [...config.optionalDependencies],
    missingComponents,
    missingDependencies,
    placeholderConfig,
    invalidComponents,
    invalidDependencies,
    legacyFieldsPresent: compatibilitySummary.legacyFieldsPresent,
    compatibilityAliasesPresent: compatibilitySummary.compatibilityAliasesPresent,
    classification,
    blockers,
    raw: rawManifest,
  };
}

function buildCompatibilityFields(stack, components, dependencies, config) {
  if (stack === MUTABLE_STACK_IDENTITY_PROOF) {
    return {
      ProofGate: components.PhilIdentityGate || '',
      PhilIdentityGate: components.PhilIdentityGate || '',
      PhilIdentityMint: components.PhilIdentityMint || '',
      humanityVerifier: components.humanityVerifier || '',
      FactRegistryHumanityVerifier:
        config.humanityProvider === 'mock' ? '' : components.humanityVerifier || '',
      MockHumanityVerifier:
        config.humanityProvider === 'mock' ? components.humanityVerifier || '' : '',
      PhilRenderer: components.PhilRenderer || '',
      PhilWeb3: components.PhilWeb3 || '',
      PhilSVGStorage: dependencies.PhilSVGStorage || '',
      PhilLayerRegistry: dependencies.PhilLayerRegistry || '',
      PhilNFT: dependencies.PhilNFT || '',
      factRegistry: dependencies.factRegistry || '',
      humanityProvider: config.humanityProvider || '',
      programHash: config.programHash || '',
      proofContext: config.proofContext || '',
      verifierConfigHash: config.verifierConfigHash || '',
      artBackendReused: Boolean(config.artBackendReused),
      artBackendMode: config.artBackendMode || '',
      artBackendManifest: config.artBackendManifest || '',
      artBackendSource: config.artBackendSource || '',
      ProofMode: config.proofMode || '',
    };
  }

  return {
    EntryPoint: dependencies.EntryPoint || '',
    PhilIdentityMint: dependencies.PhilIdentityMint || '',
    PhilIdentityGate: dependencies.PhilIdentityGate || '',
    PhilAccountImpl: components.PhilAccountImpl || '',
    PhilUnlockInbox: components.PhilUnlockInbox || '',
    PhilAccountFactory: components.PhilAccountFactory || '',
    PhilPaymaster: components.PhilPaymaster || '',
    MockStarknetCore: components.MockStarknetCore || '',
    paymasterSigner: config.paymasterSigner || '',
    starknetCore: config.starknetCore || '',
    l2UnlockVerifier: config.l2UnlockVerifier || '',
    paymasterDeposit: config.paymasterDeposit || '',
    useMockInbox: Boolean(config.useMockInbox),
  };
}

function pruneEmptyCompatibilityFields(fields) {
  return Object.fromEntries(
    Object.entries(fields).filter(([, value]) => hasValue(value))
  );
}

export function getMutableStackManifestPath(stack, chainId, rootDir = ROOT_DIR) {
  const config = STACK_CONFIG[stack];
  if (!config) {
    throw new Error(`Unsupported mutable stack: ${stack}`);
  }
  return path.join(rootDir, 'deployments', `${config.prefix}_${chainId}.json`);
}

export function readMutableStackManifest({ stack, chainId, rootDir = ROOT_DIR } = {}) {
  const manifestPath = getMutableStackManifestPath(stack, chainId, rootDir);
  return analyzeStructuredManifest(readJson(manifestPath), stack, manifestPath);
}

export function writeMutableStackManifest({
  stack,
  chainId,
  rootDir = ROOT_DIR,
  sourceScript = '',
  generatedAt = new Date().toISOString(),
  components = {},
  dependencies = {},
  config = {},
} = {}) {
  const stackConfig = STACK_CONFIG[stack];
  if (!stackConfig) {
    throw new Error(`Unsupported mutable stack: ${stack}`);
  }

  const manifestPath = getMutableStackManifestPath(stack, chainId, rootDir);
  const normalizedComponents = {};
  for (const key of Object.keys(stackConfig.componentCandidates)) {
    normalizedComponents[key] = normalizeAddress(components[key]);
  }

  const normalizedDependencies = {};
  for (const key of Object.keys(stackConfig.dependencyCandidates)) {
    normalizedDependencies[key] = normalizeAddress(dependencies[key]);
  }

  const normalizedConfig = {};
  for (const key of stackConfig.configKeys) {
    normalizedConfig[key] = normalizeConfigValue(config[key]);
  }

  const compatibilityFields = buildCompatibilityFields(
    stack,
    normalizedComponents,
    normalizedDependencies,
    normalizedConfig
  );

  const payload = {
    schema: 'zkphil-mutable-stack-v1',
    deploymentType: 'mutable',
    stack,
    chainId: Number(chainId),
    generatedAt,
    sourceScript,
    components: normalizedComponents,
    dependencies: normalizedDependencies,
    config: normalizedConfig,
    expectedComponents: [...stackConfig.expectedComponents],
    expectedDependencies: [...stackConfig.expectedDependencies],
    ...pruneEmptyCompatibilityFields(compatibilityFields),
  };

  const analyzed = analyzeStructuredManifest(payload, stack, manifestPath);
  payload.status = {
    classification: analyzed.classification,
    missingComponents: analyzed.missingComponents,
    missingDependencies: analyzed.missingDependencies,
    placeholderConfig: analyzed.placeholderConfig,
    invalidComponents: analyzed.invalidComponents,
    invalidDependencies: analyzed.invalidDependencies,
    legacyFieldsPresent: analyzed.legacyFieldsPresent,
    compatibilityAliasesPresent: analyzed.compatibilityAliasesPresent,
    blockers: analyzed.blockers,
  };

  fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
  fs.writeFileSync(manifestPath, JSON.stringify(payload, null, 2));

  return {
    manifestPath,
    payload,
  };
}
