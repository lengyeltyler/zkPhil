import dotenv from 'dotenv';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ethers } from 'ethers';

import {
  SEPOLIA_CHAIN_ID,
} from '../../shared/deploy/artBackendManifest.mjs';
import {
  MUTABLE_STACK_ACCOUNT_ABSTRACTION,
  MUTABLE_STACK_IDENTITY_PROOF,
  readMutableStackManifest,
} from '../../shared/deploy/mutableStackManifest.mjs';
import {
  getStableProtocolBindingsManifestPath,
  inspectStableProtocolBindings,
  readStableProtocolBindings,
} from '../../shared/deploy/protocolBindings.mjs';
import {
  readVerifySepoliaBindingsConfig,
  runVerifySepoliaBindings,
} from '../verify_sepolia_bindings.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, '..', '..');

function parseArgs(argv) {
  const args = {};
  for (let index = 2; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith('--')) {
      args[key] = true;
    } else {
      args[key] = next;
      index += 1;
    }
  }
  return args;
}

function readJson(filePath) {
  if (!fs.existsSync(filePath)) {
    return null;
  }
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function hasValue(value) {
  return String(value || '').trim().length > 0;
}

function looksLikePlaceholder(value) {
  const normalized = String(value || '').trim().toLowerCase();
  return (
    !normalized ||
    normalized.includes('your_') ||
    normalized.includes('placeholder') ||
    normalized.includes('rpc.example') ||
    normalized.includes('example')
  );
}

function describeValueState(label, value) {
  const raw = String(value || '').trim();
  return {
    label,
    present: raw.length > 0,
    placeholder: looksLikePlaceholder(raw),
    usable: raw.length > 0 && !looksLikePlaceholder(raw),
    value: raw,
  };
}

function usableEnvValue(value) {
  return looksLikePlaceholder(value) ? '' : String(value || '').trim();
}

function summarizeSchema(manifest) {
  if (!manifest.exists) {
    return 'missing';
  }
  return manifest.schema || 'legacy-flat-json';
}

function getStableManifestPath(rootDir = ROOT_DIR) {
  return path.join(rootDir, 'config', 'stable-art-backends', 'sepolia.json');
}

function readStableArtManifest(rootDir = ROOT_DIR) {
  const filePath = getStableManifestPath(rootDir);
  const manifest = readJson(filePath);
  if (!manifest?.contracts?.svgStorage || !manifest?.contracts?.layerRegistry) {
    return null;
  }
  return {
    filePath,
    source: String(manifest.source || ''),
    svgStorageAddress: manifest.contracts.svgStorage,
    layerRegistryAddress: manifest.contracts.layerRegistry,
    philNftAddress: manifest.contracts.philNft || '',
    raw: manifest,
  };
}

function readStableProtocolManifest(rootDir = ROOT_DIR) {
  return readStableProtocolBindings({
    chainId: SEPOLIA_CHAIN_ID,
    rootDir,
  });
}

function describeResolvedValueState(label, value, source) {
  const raw = String(value || '').trim();
  return {
    label,
    present: raw.length > 0,
    placeholder: looksLikePlaceholder(raw),
    usable: raw.length > 0 && !looksLikePlaceholder(raw),
    value: raw,
    source,
  };
}

function derivePaymasterSignerAddressFromKey(privateKey) {
  const raw = String(privateKey || '').trim();
  if (!raw || looksLikePlaceholder(raw)) {
    return '';
  }
  try {
    return new ethers.Wallet(raw).address;
  } catch {
    return '';
  }
}

function buildResolvedEnvStatus(env, aaDeployment, stableProtocol) {
  const explicitRpcUrl = String(env.RPC_URL || '').trim();
  const fallbackRpcUrl = String(env.RPC_URL_SEPOLIA || '').trim();

  const explicitPaymasterSigner = usableEnvValue(env.PAYMASTER_SIGNER);
  const paymasterSignerFromKey = derivePaymasterSignerAddressFromKey(env.PAYMASTER_SIGNER_KEY);
  const manifestPaymasterSigner = aaDeployment.config.paymasterSigner || '';

  const explicitStarknetCore = usableEnvValue(env.STARKNET_CORE);
  const manifestStarknetCore = aaDeployment.config.starknetCore || '';
  const stableStarknetCore = stableProtocol?.starknetCoreAddress || '';

  const explicitL2UnlockSender = usableEnvValue(env.L2_UNLOCK_SENDER);
  const legacyL2UnlockVerifier = usableEnvValue(env.L2_UNLOCK_VERIFIER);
  const manifestL2UnlockSender = aaDeployment.config.l2UnlockSender || '';
  const manifestL2UnlockSenderSource = aaDeployment.resolvedFrom?.config?.l2UnlockSender || '';
  const explicitEntryPoint = usableEnvValue(env.ENTRY_POINT_V07);
  const manifestEntryPoint = aaDeployment.dependencies.EntryPoint || '';
  const stableEntryPoint = stableProtocol?.entryPointV07Address || '';

  return {
    configuredChainId: describeResolvedValueState(
      'CHAIN_ID',
      env.CHAIN_ID || String(SEPOLIA_CHAIN_ID),
      'fixed:sepolia'
    ),
    rpcUrl: describeResolvedValueState(
      'RPC_URL',
      explicitRpcUrl || fallbackRpcUrl,
      explicitRpcUrl ? 'env:RPC_URL' : (fallbackRpcUrl ? 'env:RPC_URL_SEPOLIA' : 'missing')
    ),
    paymasterSignerAddress: describeResolvedValueState(
      'PAYMASTER_SIGNER',
      explicitPaymasterSigner || paymasterSignerFromKey || manifestPaymasterSigner,
      explicitPaymasterSigner
        ? 'env:PAYMASTER_SIGNER'
        : (paymasterSignerFromKey
          ? 'env:PAYMASTER_SIGNER_KEY'
          : (manifestPaymasterSigner
            ? `manifest:${aaDeployment.manifestPath}#config.paymasterSigner`
            : 'missing'))
    ),
    paymasterSignerKey: describeValueState('PAYMASTER_SIGNER_KEY', env.PAYMASTER_SIGNER_KEY),
    entryPoint: describeResolvedValueState(
      'ENTRY_POINT_V07',
      explicitEntryPoint || manifestEntryPoint || stableEntryPoint,
      explicitEntryPoint
        ? 'env:ENTRY_POINT_V07'
        : (manifestEntryPoint
        ? `manifest:${aaDeployment.manifestPath}#dependencies.EntryPoint`
        : (stableEntryPoint
          ? `stable:${stableProtocol.filePath}#contracts.entryPointV07`
          : 'missing'))
    ),
    starknetCore: describeResolvedValueState(
      'STARKNET_CORE',
      explicitStarknetCore || manifestStarknetCore || stableStarknetCore,
      explicitStarknetCore
        ? 'env:STARKNET_CORE'
        : (manifestStarknetCore
          ? `manifest:${aaDeployment.manifestPath}#config.starknetCore`
          : (stableStarknetCore
            ? `stable:${stableProtocol.filePath}#contracts.starknetCore`
            : 'missing'))
    ),
    l2UnlockSender: describeResolvedValueState(
      'L2_UNLOCK_SENDER',
      explicitL2UnlockSender || legacyL2UnlockVerifier || manifestL2UnlockSender,
      explicitL2UnlockSender
        ? 'env:L2_UNLOCK_SENDER'
        : (legacyL2UnlockVerifier
          ? 'env:L2_UNLOCK_VERIFIER'
          : (manifestL2UnlockSender
          ? `manifest:${aaDeployment.manifestPath}#${manifestL2UnlockSenderSource || 'config.l2UnlockSender'}`
          : 'missing')
      )
    ),
  };
}

function summarizeMutableStack(manifest) {
  const requiredCoverage =
    manifest.expectedComponents.length + manifest.expectedDependencies.length;
  const requiredPresent =
    manifest.expectedComponents.length - manifest.missingComponents.length +
    manifest.expectedDependencies.length - manifest.missingDependencies.length;

  return {
    stack: manifest.stack,
    label: manifest.label,
    manifestPath: manifest.manifestPath,
    exists: manifest.exists,
    schema: summarizeSchema(manifest),
    chainId: manifest.chainId,
    generatedAt: manifest.generatedAt,
    sourceScript: manifest.sourceScript,
    classification: manifest.classification,
    components: manifest.components,
    dependencies: manifest.dependencies,
    config: manifest.config,
    resolvedFrom: manifest.resolvedFrom,
    expectedComponents: manifest.expectedComponents,
    expectedDependencies: manifest.expectedDependencies,
    missingComponents: manifest.missingComponents,
    missingDependencies: manifest.missingDependencies,
    placeholderConfig: manifest.placeholderConfig,
    legacyFieldsPresent: manifest.legacyFieldsPresent,
    compatibilityAliasesPresent: manifest.compatibilityAliasesPresent,
    blockers: manifest.blockers,
    requiredCoverage: {
      present: requiredPresent,
      total: requiredCoverage,
    },
  };
}

function determineOverallMutableClassification(identityProof, accountAbstraction, envStatus) {
  if (
    identityProof.classification === 'complete' &&
    accountAbstraction.classification === 'complete'
  ) {
    if (
      envStatus.rpcUrl.usable &&
      envStatus.paymasterSignerAddress.usable &&
      envStatus.starknetCore.usable &&
      envStatus.l2UnlockSender.usable
    ) {
      return 'complete';
    }
    return 'placeholder-configured';
  }

  if (!identityProof.exists && !accountAbstraction.exists) {
    return 'missing';
  }

  return 'partial';
}

function collectAliasUsage(manifest) {
  const aliasNotes = [];
  for (const [field, source] of Object.entries(manifest.resolvedFrom.components || {})) {
    if (!source || source.endsWith(`.${field}`) || source === field) {
      continue;
    }
    aliasNotes.push(`${field} currently resolves via ${source}.`);
  }
  for (const [field, source] of Object.entries(manifest.resolvedFrom.dependencies || {})) {
    if (!source || source.endsWith(`.${field}`) || source === field) {
      continue;
    }
    aliasNotes.push(`${field} currently resolves via ${source}.`);
  }
  return aliasNotes;
}

function buildEffectiveEnv(env) {
  return {
    ...env,
    CHAIN_ID: String(SEPOLIA_CHAIN_ID),
    RPC_URL: String(env.RPC_URL || env.RPC_URL_SEPOLIA || '').trim(),
  };
}

export async function collectSepoliaStatus(
  env = process.env,
  rootDir = ROOT_DIR,
  { requireLive = false } = {}
) {
  const effectiveEnv = buildEffectiveEnv(env);
  const stableArt = readStableArtManifest(rootDir);
  const stableProtocol = readStableProtocolManifest(rootDir);
  const stark = summarizeMutableStack(
    readMutableStackManifest({
      stack: MUTABLE_STACK_IDENTITY_PROOF,
      chainId: SEPOLIA_CHAIN_ID,
      rootDir,
    })
  );
  const aa4337 = summarizeMutableStack(
    readMutableStackManifest({
      stack: MUTABLE_STACK_ACCOUNT_ABSTRACTION,
      chainId: SEPOLIA_CHAIN_ID,
      rootDir,
    })
  );

  const envStatus = buildResolvedEnvStatus(env, aa4337, stableProtocol);

  const warnings = [];
  const errors = [];

  if (hasValue(env.CHAIN_ID) && String(env.CHAIN_ID).trim() !== String(SEPOLIA_CHAIN_ID)) {
    warnings.push(`CHAIN_ID=${env.CHAIN_ID} is ignored by status:sepolia; this command always inspects Sepolia (${SEPOLIA_CHAIN_ID}).`);
  }
  if (!stableArt) {
    warnings.push(`Stable art/data manifest is missing at ${getStableManifestPath(rootDir)}.`);
  }
  if (!stableProtocol) {
    warnings.push(`Stable Sepolia protocol bindings are missing at ${getStableProtocolBindingsManifestPath(SEPOLIA_CHAIN_ID, rootDir)}.`);
  }
  if (!stark.exists) {
    warnings.push(`Mutable identity/proof manifest is missing at ${stark.manifestPath}.`);
  }
  if (!aa4337.exists) {
    warnings.push(`Mutable account/paymaster manifest is missing at ${aa4337.manifestPath}.`);
  }
  for (const manifest of [stark, aa4337]) {
    for (const blocker of manifest.blockers) {
      if (!manifest.exists && blocker === `Manifest is missing at ${manifest.manifestPath}.`) {
        continue;
      }
      warnings.push(`${manifest.label}: ${blocker}`);
    }
    if (manifest.legacyFieldsPresent.length > 0) {
      warnings.push(
        `${manifest.label}: legacy fields still present (${manifest.legacyFieldsPresent.join(', ')}).`
      );
    }
    const aliasUsage = collectAliasUsage(manifest);
    for (const note of aliasUsage) {
      warnings.push(`${manifest.label}: ${note}`);
    }
  }
  if (stark.classification === 'complete' && stark.dependencies.PhilSVGStorage && !stableArt) {
    warnings.push('Identity/proof manifest links reused art/data contracts, but the stable art/data manifest is missing.');
  }
  if (!envStatus.rpcUrl.usable) {
    warnings.push('RPC_URL or RPC_URL_SEPOLIA is missing or placeholder; live Sepolia verification will be skipped.');
  }
  if (!envStatus.paymasterSignerAddress.usable) {
    warnings.push('PAYMASTER_SIGNER, PAYMASTER_SIGNER_KEY, or 4337 manifest paymasterSigner is missing; paymaster verification cannot run live.');
  }
  if (!envStatus.starknetCore.usable) {
    warnings.push('STARKNET_CORE is unresolved. status:sepolia checks env, then deployments/4337_11155111.json, then config/stable-protocol-bindings/sepolia.json.');
  }
  if (!envStatus.l2UnlockSender.usable) {
    warnings.push(
      'L2_UNLOCK_SENDER is missing or placeholder. Compatibility alias: L2_UNLOCK_VERIFIER. No app-specific Starknet L2 unlock sender is currently tracked for Sepolia.'
    );
  }

  let stableProtocolVerification = null;
  if (stableProtocol && envStatus.rpcUrl.usable) {
    try {
      const provider = new ethers.JsonRpcProvider(envStatus.rpcUrl.value, undefined, { batchMaxCount: 1 });
      stableProtocolVerification = await inspectStableProtocolBindings(provider, stableProtocol);
      if (!stableProtocolVerification.ok) {
        warnings.push(
          `Stable Sepolia protocol bindings point to addresses without code (${stableProtocolVerification.missing.join(', ')}).`
        );
      }
    } catch (error) {
      warnings.push(
        `Stable Sepolia protocol binding inspection failed: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  let configStatus = {
    readable: false,
    error: '',
    values: null,
  };
  try {
    const config = readVerifySepoliaBindingsConfig(effectiveEnv, rootDir);
    configStatus = {
      readable: true,
      error: '',
      values: {
        proofGateAddress: config.proofGateAddress,
        philIdentityMintAddress: config.philIdentityMintAddress,
        philAccountFactoryAddress: config.philAccountFactoryAddress,
        paymasterAddress: config.paymasterAddress,
        factRegistryAddress: config.factRegistryAddress,
        entryPointAddress: config.entryPointAddress,
        paymasterSignerAddress: config.paymasterSignerAddress,
        starknetCoreAddress: config.starknetCoreAddress,
        l2UnlockSender: config.l2UnlockSender.toString(),
      },
    };
  } catch (error) {
    configStatus.error = error instanceof Error ? error.message : String(error);
    warnings.push(`Binding config is incomplete: ${configStatus.error}`);
  }

  const liveVerification = {
    attempted: false,
    ok: false,
    skipped: false,
    message: '',
    state: 'unknown',
  };

  if (configStatus.readable && envStatus.rpcUrl.usable) {
    liveVerification.attempted = true;
    try {
      await runVerifySepoliaBindings(
        readVerifySepoliaBindingsConfig(effectiveEnv, rootDir)
      );
      liveVerification.ok = true;
      liveVerification.state = 'passed';
      liveVerification.message = 'On-chain bindings verified successfully.';
    } catch (error) {
      liveVerification.state = 'failed';
      liveVerification.message = error instanceof Error ? error.message : String(error);
      errors.push(`Live Sepolia verification failed: ${liveVerification.message}`);
    }
  } else {
    liveVerification.skipped = true;
    liveVerification.state = 'skipped';
    liveVerification.message = 'Live Sepolia verification skipped because required env/config values are missing.';
    if (requireLive) {
      errors.push(liveVerification.message);
    }
  }

  return {
    generatedAt: new Date().toISOString(),
    chainId: SEPOLIA_CHAIN_ID,
    reused: {
      kind: 'stable-art-data',
      manifestPath: stableArt?.filePath || getStableManifestPath(rootDir),
      exists: Boolean(stableArt),
      source: stableArt?.source || '',
      contracts: stableArt
        ? {
          svgStorage: stableArt.svgStorageAddress,
          layerRegistry: stableArt.layerRegistryAddress,
          philNft: stableArt.philNftAddress || '',
        }
        : {},
      verification: stableArt?.raw?.verification || null,
    },
    protocol: {
      kind: 'stable-protocol-bindings',
      manifestPath: stableProtocol?.filePath || getStableProtocolBindingsManifestPath(SEPOLIA_CHAIN_ID, rootDir),
      exists: Boolean(stableProtocol),
      source: stableProtocol?.source || '',
      contracts: stableProtocol
        ? {
            entryPointV07: stableProtocol.entryPointV07Address,
            starknetCore: stableProtocol.starknetCoreAddress,
          }
        : {},
      notes: stableProtocol?.notes || {},
      verification: stableProtocolVerification,
    },
    mutable: {
      identityProof: stark,
      accountAbstraction: aa4337,
      overallClassification: determineOverallMutableClassification(stark, aa4337, envStatus),
    },
    env: envStatus,
    config: configStatus,
    liveVerification,
    expectations: {
      reused: ['config/stable-art-backends/sepolia.json', 'config/stable-protocol-bindings/sepolia.json'],
      redeployed: ['deployments/stark_11155111.json', 'deployments/4337_11155111.json'],
    },
    warnings,
    errors,
  };
}

function printAddress(label, value) {
  console.log(`  ${label}: ${value || '(missing)'}`);
}

function printResolvedValue(label, value, source) {
  if (!value) {
    console.log(`  ${label}: (missing)`);
    return;
  }
  if (source && source !== label) {
    console.log(`  ${label}: ${value} [via ${source}]`);
    return;
  }
  console.log(`  ${label}: ${value}`);
}

function printLines(title, values) {
  if (!values || values.length === 0) {
    return;
  }
  console.log(`  ${title}:`);
  for (const value of values) {
    console.log(`    - ${value}`);
  }
}

export function printSepoliaStatus(status) {
  console.log('zkPhil Sepolia Status');
  console.log(`  Generated: ${status.generatedAt}`);
  console.log(`  Chain ID:  ${status.chainId}`);
  console.log(`  Mutable status: ${status.mutable.overallClassification}`);
  console.log(`  Live verification: ${status.liveVerification.state}`);

  console.log('\nStable reused art/data');
  console.log(`  Manifest: ${status.reused.exists ? 'ok' : 'missing'} (${status.reused.manifestPath})`);
  if (status.reused.exists) {
    printAddress('PhilSVGStorage', status.reused.contracts.svgStorage);
    printAddress('PhilLayerRegistry', status.reused.contracts.layerRegistry);
    printAddress('PhilNFT', status.reused.contracts.philNft);
    if (status.reused.verification?.verified) {
      console.log('  Verification: verified');
    }
  }

  console.log('\nStable reused protocol bindings');
  console.log(`  Manifest: ${status.protocol.exists ? 'ok' : 'missing'} (${status.protocol.manifestPath})`);
  if (status.protocol.exists) {
    printAddress('EntryPointV07', status.protocol.contracts.entryPointV07);
    printAddress('StarknetCore', status.protocol.contracts.starknetCore);
    if (status.protocol.notes?.l2UnlockSender || status.protocol.notes?.l2UnlockVerifier) {
      console.log(`  Note: ${status.protocol.notes.l2UnlockSender || status.protocol.notes.l2UnlockVerifier}`);
    }
    if (status.protocol.verification?.ok) {
      console.log('  Verification: verified');
    }
  }

  console.log('\nMutable identity/proof stack');
  console.log(`  State: ${status.mutable.identityProof.classification}`);
  console.log(`  Manifest: ${status.mutable.identityProof.schema} (${status.mutable.identityProof.manifestPath})`);
  if (status.mutable.identityProof.sourceScript) {
    console.log(`  Source script: ${status.mutable.identityProof.sourceScript}`);
  }
  console.log(
    `  Required coverage: ${status.mutable.identityProof.requiredCoverage.present}/${status.mutable.identityProof.requiredCoverage.total}`
  );
  printResolvedValue(
    'PhilIdentityGate',
    status.mutable.identityProof.components.PhilIdentityGate,
    status.mutable.identityProof.resolvedFrom.components.PhilIdentityGate
  );
  printResolvedValue(
    'PhilIdentityMint',
    status.mutable.identityProof.components.PhilIdentityMint,
    status.mutable.identityProof.resolvedFrom.components.PhilIdentityMint
  );
  printResolvedValue(
    'humanityVerifier',
    status.mutable.identityProof.components.humanityVerifier,
    status.mutable.identityProof.resolvedFrom.components.humanityVerifier
  );
  printResolvedValue(
    'factRegistry',
    status.mutable.identityProof.dependencies.factRegistry,
    status.mutable.identityProof.resolvedFrom.dependencies.factRegistry
  );
  printResolvedValue(
    'PhilSVGStorage',
    status.mutable.identityProof.dependencies.PhilSVGStorage,
    status.mutable.identityProof.resolvedFrom.dependencies.PhilSVGStorage
  );
  printResolvedValue(
    'PhilLayerRegistry',
    status.mutable.identityProof.dependencies.PhilLayerRegistry,
    status.mutable.identityProof.resolvedFrom.dependencies.PhilLayerRegistry
  );
  printLines('Compatibility aliases present', status.mutable.identityProof.compatibilityAliasesPresent);
  printLines('Legacy fields still present', status.mutable.identityProof.legacyFieldsPresent);
  printLines('Blockers', status.mutable.identityProof.blockers);

  console.log('\nMutable account/paymaster stack');
  console.log(`  State: ${status.mutable.accountAbstraction.classification}`);
  console.log(`  Manifest: ${status.mutable.accountAbstraction.schema} (${status.mutable.accountAbstraction.manifestPath})`);
  if (status.mutable.accountAbstraction.sourceScript) {
    console.log(`  Source script: ${status.mutable.accountAbstraction.sourceScript}`);
  }
  console.log(
    `  Required coverage: ${status.mutable.accountAbstraction.requiredCoverage.present}/${status.mutable.accountAbstraction.requiredCoverage.total}`
  );
  printResolvedValue(
    'PhilAccountFactory',
    status.mutable.accountAbstraction.components.PhilAccountFactory,
    status.mutable.accountAbstraction.resolvedFrom.components.PhilAccountFactory
  );
  printResolvedValue(
    'PhilPaymaster',
    status.mutable.accountAbstraction.components.PhilPaymaster,
    status.mutable.accountAbstraction.resolvedFrom.components.PhilPaymaster
  );
  printResolvedValue(
    'PhilUnlockInbox',
    status.mutable.accountAbstraction.components.PhilUnlockInbox,
    status.mutable.accountAbstraction.resolvedFrom.components.PhilUnlockInbox
  );
  printResolvedValue(
    'PhilIdentityMint',
    status.mutable.accountAbstraction.dependencies.PhilIdentityMint,
    status.mutable.accountAbstraction.resolvedFrom.dependencies.PhilIdentityMint
  );
  printResolvedValue(
    'PhilIdentityGate',
    status.mutable.accountAbstraction.dependencies.PhilIdentityGate,
    status.mutable.accountAbstraction.resolvedFrom.dependencies.PhilIdentityGate
  );
  printResolvedValue(
    'EntryPoint',
    status.mutable.accountAbstraction.dependencies.EntryPoint,
    status.mutable.accountAbstraction.resolvedFrom.dependencies.EntryPoint
  );
  printLines('Placeholder config', status.mutable.accountAbstraction.placeholderConfig);
  printLines('Blockers', status.mutable.accountAbstraction.blockers);

  console.log('\nResolved config');
  console.log(`  RPC_URL: ${status.env.rpcUrl.usable ? `usable via ${status.env.rpcUrl.source}` : 'missing-or-placeholder'}`);
  console.log(`  ENTRY_POINT_V07: ${status.env.entryPoint.usable ? `usable via ${status.env.entryPoint.source}` : 'missing-or-placeholder'}`);
  console.log(`  PAYMASTER_SIGNER: ${status.env.paymasterSignerAddress.usable ? `usable via ${status.env.paymasterSignerAddress.source}` : 'missing-or-placeholder'}`);
  console.log(`  STARKNET_CORE: ${status.env.starknetCore.usable ? `usable via ${status.env.starknetCore.source}` : 'missing-or-placeholder'}`);
  console.log(`  L2_UNLOCK_SENDER: ${status.env.l2UnlockSender.usable ? `usable via ${status.env.l2UnlockSender.source}` : 'missing-or-placeholder'}`);
  console.log(`  Binding config: ${status.config.readable ? 'ready' : `incomplete (${status.config.error})`}`);

  console.log('\nVerification');
  if (status.liveVerification.attempted) {
    console.log(`  Live bindings: ${status.liveVerification.ok ? 'passed' : 'failed'}`);
  } else {
    console.log(`  Live bindings: skipped`);
  }
  console.log(`  Note: ${status.liveVerification.message}`);

  console.log('\nReuse boundary');
  console.log(`  Reused: ${status.expectations.reused.join(', ')}`);
  console.log(`  Mutable: ${status.expectations.redeployed.join(', ')}`);

  if (status.warnings.length > 0) {
    console.log('\nWarnings');
    for (const warning of status.warnings) {
      console.log(`  - ${warning}`);
    }
  }

  if (status.errors.length > 0) {
    console.log('\nErrors');
    for (const error of status.errors) {
      console.log(`  - ${error}`);
    }
  }

  console.log('\nSummary');
  console.log(`  warnings: ${status.warnings.length}`);
  console.log(`  errors:   ${status.errors.length}`);
}

async function main() {
  dotenv.config();
  const args = parseArgs(process.argv);
  const status = await collectSepoliaStatus(process.env, ROOT_DIR, {
    requireLive: Boolean(args['require-live']),
  });

  if (args.json) {
    process.stdout.write(`${JSON.stringify(status, null, 2)}\n`);
  } else {
    printSepoliaStatus(status);
  }

  if (status.errors.length > 0) {
    process.exitCode = 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`ERROR: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  });
}
