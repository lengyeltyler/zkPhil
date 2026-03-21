import dotenv from 'dotenv';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  SEPOLIA_CHAIN_ID,
} from '../../shared/deploy/artBackendManifest.mjs';
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

function readDeployment(prefix, chainId, rootDir = ROOT_DIR) {
  const manifestPath = path.join(rootDir, 'deployments', `${prefix}_${chainId}.json`);
  return {
    manifestPath,
    manifest: readJson(manifestPath),
  };
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

function summarizeDeployment(prefix, chainId, manifest, rootDir = ROOT_DIR) {
  return {
    prefix,
    chainId,
    manifestPath: path.join(rootDir, 'deployments', `${prefix}_${chainId}.json`),
    exists: Boolean(manifest),
    contracts: manifest || {},
  };
}

function warnOnMissingContract(warnings, label, value, manifestPath) {
  if (!hasValue(value)) {
    warnings.push(`${label} is missing from ${manifestPath}.`);
  }
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
  const stark = readDeployment('stark', SEPOLIA_CHAIN_ID, rootDir);
  const aa4337 = readDeployment('4337', SEPOLIA_CHAIN_ID, rootDir);

  const envStatus = {
    configuredChainId: describeValueState('CHAIN_ID', env.CHAIN_ID || String(SEPOLIA_CHAIN_ID)),
    rpcUrl: describeValueState('RPC_URL', effectiveEnv.RPC_URL),
    paymasterSignerAddress: describeValueState('PAYMASTER_SIGNER', env.PAYMASTER_SIGNER),
    paymasterSignerKey: describeValueState('PAYMASTER_SIGNER_KEY', env.PAYMASTER_SIGNER_KEY),
    starknetCore: describeValueState('STARKNET_CORE', env.STARKNET_CORE),
    l2UnlockVerifier: describeValueState('L2_UNLOCK_VERIFIER', env.L2_UNLOCK_VERIFIER),
  };

  const warnings = [];
  const errors = [];

  if (hasValue(env.CHAIN_ID) && String(env.CHAIN_ID).trim() !== String(SEPOLIA_CHAIN_ID)) {
    warnings.push(`CHAIN_ID=${env.CHAIN_ID} is ignored by status:sepolia; this command always inspects Sepolia (${SEPOLIA_CHAIN_ID}).`);
  }
  if (!stableArt) {
    warnings.push(`Stable art/data manifest is missing at ${getStableManifestPath(rootDir)}.`);
  }
  if (!stark.manifest) {
    warnings.push(`Mutable identity/proof manifest is missing at ${stark.manifestPath}.`);
  }
  if (!aa4337.manifest) {
    warnings.push(`Mutable account/paymaster manifest is missing at ${aa4337.manifestPath}.`);
  }
  if (stark.manifest) {
    warnOnMissingContract(warnings, 'PhilIdentityGate/ProofGate', stark.manifest.PhilIdentityGate || stark.manifest.ProofGate, stark.manifestPath);
    warnOnMissingContract(warnings, 'PhilIdentityMint', stark.manifest.PhilIdentityMint, stark.manifestPath);
    warnOnMissingContract(warnings, 'humanityVerifier', stark.manifest.humanityVerifier || stark.manifest.MockHumanityVerifier || stark.manifest.FactRegistryHumanityVerifier, stark.manifestPath);
  }
  if (aa4337.manifest) {
    warnOnMissingContract(warnings, 'PhilAccountFactory', aa4337.manifest.PhilAccountFactory, aa4337.manifestPath);
    warnOnMissingContract(warnings, 'PhilPaymaster', aa4337.manifest.PhilPaymaster, aa4337.manifestPath);
    warnOnMissingContract(warnings, 'PhilUnlockInbox', aa4337.manifest.PhilUnlockInbox, aa4337.manifestPath);
  }
  if (!envStatus.rpcUrl.usable) {
    warnings.push('RPC_URL or RPC_URL_SEPOLIA is missing or placeholder; live Sepolia verification will be skipped.');
  }
  if (!envStatus.paymasterSignerAddress.usable && !envStatus.paymasterSignerKey.usable) {
    warnings.push('PAYMASTER_SIGNER or PAYMASTER_SIGNER_KEY is missing; paymaster signer verification cannot run live.');
  }
  if (!envStatus.starknetCore.usable) {
    warnings.push('STARKNET_CORE is missing or placeholder.');
  }
  if (!envStatus.l2UnlockVerifier.usable) {
    warnings.push('L2_UNLOCK_VERIFIER is missing or placeholder.');
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
        paymasterSignerAddress: config.paymasterSignerAddress,
        starknetCoreAddress: config.starknetCoreAddress,
        l2UnlockVerifier: config.l2UnlockVerifier.toString(),
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
  };

  if (configStatus.readable && envStatus.rpcUrl.usable) {
    liveVerification.attempted = true;
    try {
      await runVerifySepoliaBindings(
        readVerifySepoliaBindingsConfig(effectiveEnv, rootDir)
      );
      liveVerification.ok = true;
      liveVerification.message = 'On-chain bindings verified successfully.';
    } catch (error) {
      liveVerification.message = error instanceof Error ? error.message : String(error);
      errors.push(`Live Sepolia verification failed: ${liveVerification.message}`);
    }
  } else {
    liveVerification.skipped = true;
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
    mutable: {
      identityProof: summarizeDeployment('stark', SEPOLIA_CHAIN_ID, stark.manifest, rootDir),
      accountAbstraction: summarizeDeployment('4337', SEPOLIA_CHAIN_ID, aa4337.manifest, rootDir),
    },
    env: envStatus,
    config: configStatus,
    liveVerification,
    expectations: {
      reused: ['config/stable-art-backends/sepolia.json'],
      redeployed: ['deployments/stark_11155111.json', 'deployments/4337_11155111.json'],
    },
    warnings,
    errors,
  };
}

function printAddress(label, value) {
  console.log(`  ${label}: ${value || '(missing)'}`);
}

export function printSepoliaStatus(status) {
  console.log('zkPhil Sepolia Status');
  console.log(`  Generated: ${status.generatedAt}`);
  console.log(`  Chain ID:  ${status.chainId}`);

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

  console.log('\nMutable identity/proof stack');
  console.log(`  Manifest: ${status.mutable.identityProof.exists ? 'ok' : 'missing'} (${status.mutable.identityProof.manifestPath})`);
  printAddress('PhilIdentityGate', status.mutable.identityProof.contracts.PhilIdentityGate || status.mutable.identityProof.contracts.ProofGate || '');
  printAddress('PhilIdentityMint', status.mutable.identityProof.contracts.PhilIdentityMint || '');
  printAddress('humanityVerifier', status.mutable.identityProof.contracts.humanityVerifier || status.mutable.identityProof.contracts.MockHumanityVerifier || status.mutable.identityProof.contracts.FactRegistryHumanityVerifier || '');

  console.log('\nMutable account/paymaster stack');
  console.log(`  Manifest: ${status.mutable.accountAbstraction.exists ? 'ok' : 'missing'} (${status.mutable.accountAbstraction.manifestPath})`);
  printAddress('PhilAccountFactory', status.mutable.accountAbstraction.contracts.PhilAccountFactory || '');
  printAddress('PhilPaymaster', status.mutable.accountAbstraction.contracts.PhilPaymaster || '');
  printAddress('PhilUnlockInbox', status.mutable.accountAbstraction.contracts.PhilUnlockInbox || '');

  console.log('\nEnv / config');
  console.log(`  RPC_URL: ${status.env.rpcUrl.usable ? 'usable' : 'missing-or-placeholder'}`);
  console.log(`  PAYMASTER_SIGNER(_KEY): ${(status.env.paymasterSignerAddress.usable || status.env.paymasterSignerKey.usable) ? 'usable' : 'missing-or-placeholder'}`);
  console.log(`  STARKNET_CORE: ${status.env.starknetCore.usable ? 'usable' : 'missing-or-placeholder'}`);
  console.log(`  L2_UNLOCK_VERIFIER: ${status.env.l2UnlockVerifier.usable ? 'usable' : 'missing-or-placeholder'}`);
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
