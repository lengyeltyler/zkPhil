import dotenv from 'dotenv';
import { ethers } from 'ethers';
import path from 'path';
import { fileURLToPath } from 'url';

import { withRpcRetry } from '../shared/deploy/rpcRetry.mjs';
import {
  MUTABLE_STACK_ACCOUNT_ABSTRACTION,
  MUTABLE_STACK_IDENTITY_PROOF,
  readMutableStackManifest,
} from '../shared/deploy/mutableStackManifest.mjs';
import {
  readStableProtocolBindings,
} from '../shared/deploy/protocolBindings.mjs';

const DEFAULT_CHAIN_ID = 11155111;
const L2_UNLOCK_SENDER_LABEL_WITH_ALIAS =
  'L2_UNLOCK_SENDER (compatibility alias: L2_UNLOCK_VERIFIER)';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, '..');

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

function usableEnvValue(value) {
  return looksLikePlaceholder(value) ? '' : String(value || '').trim();
}

function requireAddress(label, value) {
  const trimmed = String(value || '').trim();
  if (!trimmed) {
    throw new Error(`${label} must be set or resolvable from deployments.`);
  }

  return ethers.getAddress(trimmed);
}

function requireUint256(label, value, { allowZero = true } = {}) {
  const trimmed = String(value || '').trim();
  if (!trimmed) {
    throw new Error(`${label} must be set.`);
  }

  try {
    const parsed = BigInt(trimmed);
    if (!allowZero && parsed === 0n) {
      throw new Error(`${label} must be set to a non-zero Starknet contract felt.`);
    }
    return parsed;
  } catch {
    if (!allowZero && String(trimmed) === '0') {
      throw new Error(`${label} must be set to a non-zero Starknet contract felt.`);
    }
    throw new Error(`${label} must be a uint256-compatible integer.`);
  }
}

function resolveSignerAddress(env, options) {
  const explicitAddress = usableEnvValue(env[options.addressEnvKey]);
  if (explicitAddress) {
    return requireAddress(options.addressEnvKey, explicitAddress);
  }

  const privateKey = usableEnvValue(env[options.privateKeyEnvKey]);
  if (privateKey) {
    return new ethers.Wallet(privateKey).address;
  }

  if (options.fallbackAddress) {
    return requireAddress(options.label, options.fallbackAddress);
  }

  throw new Error(
    `${options.privateKeyEnvKey} must be set, or provide ${options.addressEnvKey}.`
  );
}

export function assertAddressMatch(label, expected, actual) {
  if (expected.toLowerCase() !== actual.toLowerCase()) {
    throw new Error(`${label} mismatch. Expected ${expected}, got ${actual}.`);
  }
}

export function assertEnabled(label, enabled) {
  if (!enabled) {
    throw new Error(`${label} must be enabled.`);
  }
}

export function readVerifySepoliaBindingsConfig(env = process.env, rootDir = ROOT_DIR) {
  const rpcUrl = String(env.RPC_URL || '').trim();
  if (!rpcUrl) {
    throw new Error('RPC_URL must be set explicitly in environment.');
  }

  const configuredChainId = Number(env.CHAIN_ID || DEFAULT_CHAIN_ID);
  if (!Number.isInteger(configuredChainId)) {
    throw new Error('CHAIN_ID must be an integer.');
  }

  const starkDeployment = readMutableStackManifest({
    stack: MUTABLE_STACK_IDENTITY_PROOF,
    chainId: configuredChainId,
    rootDir,
  });
  const aaDeployment = readMutableStackManifest({
    stack: MUTABLE_STACK_ACCOUNT_ABSTRACTION,
    chainId: configuredChainId,
    rootDir,
  });
  const stableProtocolBindings = readStableProtocolBindings({
    chainId: configuredChainId,
    rootDir,
  });
  const proofGateOverride = usableEnvValue(env.PROOF_GATE);
  const philIdentityMintOverride = usableEnvValue(env.PHIL_IDENTITY_MINT);
  const philAccountFactoryOverride = usableEnvValue(env.PHIL_ACCOUNT_FACTORY);
  const paymasterOverride = usableEnvValue(env.PHIL_PAYMASTER);
  const factRegistryOverride = usableEnvValue(env.FACT_REGISTRY);
  const entryPointOverride = usableEnvValue(env.ENTRY_POINT_V07);
  const starknetCoreOverride = usableEnvValue(env.STARKNET_CORE);
  const l2UnlockSenderOverride =
    usableEnvValue(env.L2_UNLOCK_SENDER) ||
    usableEnvValue(env.L2_UNLOCK_VERIFIER);

  const errors = [];
  function resolveAddress(label, value) {
    try {
      return requireAddress(label, value);
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
      return '';
    }
  }
  function resolveUint256(label, value, options) {
    try {
      return requireUint256(label, value, options);
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
      return null;
    }
  }

  const config = {
    rpcUrl,
    configuredChainId,
    proofGateAddress: resolveAddress(
      'PROOF_GATE',
      proofGateOverride ||
        starkDeployment.components.PhilIdentityGate ||
        aaDeployment.dependencies.PhilIdentityGate
    ),
    philIdentityMintAddress: resolveAddress(
      'PHIL_IDENTITY_MINT',
      philIdentityMintOverride ||
        starkDeployment.components.PhilIdentityMint ||
        aaDeployment.dependencies.PhilIdentityMint
    ),
    philAccountFactoryAddress: resolveAddress(
      'PHIL_ACCOUNT_FACTORY',
      philAccountFactoryOverride || aaDeployment.components.PhilAccountFactory
    ),
    paymasterAddress: resolveAddress(
      'PHIL_PAYMASTER',
      paymasterOverride || aaDeployment.components.PhilPaymaster
    ),
    factRegistryAddress: resolveAddress(
      'FACT_REGISTRY',
      factRegistryOverride || starkDeployment.dependencies.factRegistry
    ),
    entryPointAddress: resolveAddress(
      'ENTRY_POINT_V07',
      entryPointOverride ||
        aaDeployment.dependencies.EntryPoint ||
        stableProtocolBindings?.entryPointV07Address ||
        ''
    ),
    paymasterSignerAddress: '',
    starknetCoreAddress: resolveAddress(
      'STARKNET_CORE',
      starknetCoreOverride ||
        aaDeployment.config.starknetCore ||
        stableProtocolBindings?.starknetCoreAddress ||
        ''
    ),
    l2UnlockSender: resolveUint256(
      L2_UNLOCK_SENDER_LABEL_WITH_ALIAS,
      l2UnlockSenderOverride || aaDeployment.config.l2UnlockSender,
      { allowZero: false }
    ),
  };

  try {
    config.paymasterSignerAddress = resolveSignerAddress(env, {
      label: 'PhilPaymaster.verifyingSigner()',
      addressEnvKey: 'PAYMASTER_SIGNER',
      privateKeyEnvKey: 'PAYMASTER_SIGNER_KEY',
      fallbackAddress: aaDeployment.config.paymasterSigner || '',
    });
  } catch (error) {
    errors.push(error instanceof Error ? error.message : String(error));
  }

  if (errors.length > 0) {
    throw new Error(errors.join('; '));
  }

  return config;
}

async function readUnlockSender(unlockInbox) {
  try {
    return BigInt(await unlockInbox.l2UnlockSender());
  } catch {
    return BigInt(await unlockInbox.l2VerifierAddress());
  }
}

async function assertContractCode(provider, label, address) {
  const code = await provider.getCode(address);
  if (code === '0x') {
    throw new Error(`${label} has no code at ${address}.`);
  }
}

export async function runVerifySepoliaBindings(
  config = readVerifySepoliaBindingsConfig(process.env)
) {
  const provider = new ethers.JsonRpcProvider(config.rpcUrl, undefined, { batchMaxCount: 1 });

  await withRpcRetry('verify sepolia bindings', async () => {
    const network = await provider.getNetwork();
    const connectedChainId = Number(network.chainId);
    if (connectedChainId !== config.configuredChainId) {
      throw new Error(
        `RPC chain mismatch. Connected chainId=${connectedChainId}, expected ${config.configuredChainId}.`
      );
    }

    await assertContractCode(provider, 'ProofGate', config.proofGateAddress);
    await assertContractCode(provider, 'PhilIdentityMint', config.philIdentityMintAddress);
    await assertContractCode(provider, 'PhilAccountFactory', config.philAccountFactoryAddress);
    await assertContractCode(provider, 'PhilPaymaster', config.paymasterAddress);

    const proofGate = new ethers.Contract(
      config.proofGateAddress,
      [
        'function humanityVerifier() view returns (address)',
        'function authorizedCaller(address) view returns (bool)',
      ],
      provider
    );
    const humanityVerifier = new ethers.Contract(
      ethers.getAddress(await proofGate.humanityVerifier()),
      [
        'function factRegistry() view returns (address)',
      ],
      provider
    );
    const factory = new ethers.Contract(
      config.philAccountFactoryAddress,
      [
        'function proofGate() view returns (address)',
        'function philIdentityMint() view returns (address)',
        'function unlockInbox() view returns (address)',
      ],
      provider
    );
    const paymaster = new ethers.Contract(
      config.paymasterAddress,
      [
        'function entryPoint() view returns (address)',
        'function verifyingSigner() view returns (address)',
        'function philIdentityMint() view returns (address)',
      ],
      provider
    );

    const onchainFactRegistry = ethers.getAddress(await humanityVerifier.factRegistry());
    const onchainFactoryProofGate = ethers.getAddress(await factory.proofGate());
    const onchainFactoryPhilIdentityMint = ethers.getAddress(await factory.philIdentityMint());
    const onchainUnlockInbox = ethers.getAddress(await factory.unlockInbox());
    const onchainPaymasterEntryPoint = ethers.getAddress(await paymaster.entryPoint());
    const onchainPaymasterSigner = ethers.getAddress(await paymaster.verifyingSigner());
    const onchainPaymasterPhilIdentityMint = ethers.getAddress(await paymaster.philIdentityMint());

    await assertContractCode(provider, 'PhilUnlockInbox', onchainUnlockInbox);

    const unlockInbox = new ethers.Contract(
      onchainUnlockInbox,
      [
        'function starknetCore() view returns (address)',
        'function l2UnlockSender() view returns (uint256)',
        'function l2VerifierAddress() view returns (uint256)',
      ],
      provider
    );

    const onchainStarknetCore = ethers.getAddress(await unlockInbox.starknetCore());
    const onchainL2UnlockSender = await readUnlockSender(unlockInbox);

    assertAddressMatch(
      'HumanityVerifier.factRegistry()',
      config.factRegistryAddress,
      onchainFactRegistry
    );
    assertEnabled(
      'ProofGate.authorizedCaller(PHIL_IDENTITY_MINT)',
      Boolean(await proofGate.authorizedCaller(config.philIdentityMintAddress))
    );
    assertEnabled(
      'ProofGate.authorizedCaller(PHIL_ACCOUNT_FACTORY)',
      Boolean(await proofGate.authorizedCaller(config.philAccountFactoryAddress))
    );
    assertAddressMatch(
      'PHIL_ACCOUNT_FACTORY.proofGate()',
      config.proofGateAddress,
      onchainFactoryProofGate
    );
    assertAddressMatch(
      'PHIL_ACCOUNT_FACTORY.philIdentityMint()',
      config.philIdentityMintAddress,
      onchainFactoryPhilIdentityMint
    );
    assertAddressMatch(
      'PHIL_PAYMASTER.entryPoint()',
      config.entryPointAddress,
      onchainPaymasterEntryPoint
    );
    assertAddressMatch(
      'PHIL_PAYMASTER.verifyingSigner()',
      config.paymasterSignerAddress,
      onchainPaymasterSigner
    );
    assertAddressMatch(
      'PHIL_PAYMASTER.philIdentityMint()',
      config.philIdentityMintAddress,
      onchainPaymasterPhilIdentityMint
    );
    assertAddressMatch(
      'PhilUnlockInbox.starknetCore()',
      config.starknetCoreAddress,
      onchainStarknetCore
    );
    if (onchainL2UnlockSender !== config.l2UnlockSender) {
      throw new Error(
        `PhilUnlockInbox L2 unlock sender mismatch. Expected ${config.l2UnlockSender}, got ${onchainL2UnlockSender}.`
      );
    }

    console.log(`Verified Sepolia deployment bindings on chain ${connectedChainId}:`);
    console.log(`  HumanityVerifier.factRegistry(): ${onchainFactRegistry}`);
    console.log(`  ProofGate.authorizedCaller(PHIL_IDENTITY_MINT): true`);
    console.log(`  ProofGate.authorizedCaller(PHIL_ACCOUNT_FACTORY): true`);
    console.log(`  PHIL_ACCOUNT_FACTORY.proofGate(): ${onchainFactoryProofGate}`);
    console.log(`  PHIL_ACCOUNT_FACTORY.philIdentityMint(): ${onchainFactoryPhilIdentityMint}`);
    console.log(`  PHIL_ACCOUNT_FACTORY.unlockInbox(): ${onchainUnlockInbox}`);
    console.log(`  PHIL_PAYMASTER.entryPoint(): ${onchainPaymasterEntryPoint}`);
    console.log(`  PHIL_PAYMASTER.verifyingSigner(): ${onchainPaymasterSigner}`);
    console.log(`  PHIL_PAYMASTER.philIdentityMint(): ${onchainPaymasterPhilIdentityMint}`);
    console.log(`  PhilUnlockInbox.starknetCore(): ${onchainStarknetCore}`);
    console.log(`  PhilUnlockInbox.l2UnlockSender(): ${onchainL2UnlockSender}`);
  });
}

async function main() {
  dotenv.config();
  const config = readVerifySepoliaBindingsConfig(process.env);
  await runVerifySepoliaBindings(config);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`ERROR: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  });
}
