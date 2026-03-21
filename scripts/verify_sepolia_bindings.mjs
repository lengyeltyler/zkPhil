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

const DEFAULT_CHAIN_ID = 11155111;
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, '..');

function requireAddress(label, value) {
  const trimmed = String(value || '').trim();
  if (!trimmed) {
    throw new Error(`${label} must be set or resolvable from deployments.`);
  }

  return ethers.getAddress(trimmed);
}

function requireUint256(label, value) {
  const trimmed = String(value || '').trim();
  if (!trimmed) {
    throw new Error(`${label} must be set.`);
  }

  try {
    return BigInt(trimmed);
  } catch {
    throw new Error(`${label} must be a uint256-compatible integer.`);
  }
}

function resolveSignerAddress(env, options) {
  const explicitAddress = String(env[options.addressEnvKey] || '').trim();
  if (explicitAddress) {
    return requireAddress(options.addressEnvKey, explicitAddress);
  }

  const privateKey = String(env[options.privateKeyEnvKey] || '').trim();
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

  return {
    rpcUrl,
    configuredChainId,
    proofGateAddress: requireAddress(
      'PROOF_GATE',
      env.PROOF_GATE ||
        starkDeployment.components.PhilIdentityGate ||
        aaDeployment.dependencies.PhilIdentityGate
    ),
    philIdentityMintAddress: requireAddress(
      'PHIL_IDENTITY_MINT',
      env.PHIL_IDENTITY_MINT ||
        starkDeployment.components.PhilIdentityMint ||
        aaDeployment.dependencies.PhilIdentityMint
    ),
    philAccountFactoryAddress: requireAddress(
      'PHIL_ACCOUNT_FACTORY',
      env.PHIL_ACCOUNT_FACTORY || aaDeployment.components.PhilAccountFactory
    ),
    paymasterAddress: requireAddress(
      'PHIL_PAYMASTER',
      env.PHIL_PAYMASTER || aaDeployment.components.PhilPaymaster
    ),
    factRegistryAddress: requireAddress(
      'FACT_REGISTRY',
      env.FACT_REGISTRY || starkDeployment.dependencies.factRegistry
    ),
    paymasterSignerAddress: resolveSignerAddress(env, {
      label: 'PhilPaymaster.verifyingSigner()',
      addressEnvKey: 'PAYMASTER_SIGNER',
      privateKeyEnvKey: 'PAYMASTER_SIGNER_KEY',
      fallbackAddress: aaDeployment.config.paymasterSigner || '',
    }),
    starknetCoreAddress: requireAddress(
      'STARKNET_CORE',
      env.STARKNET_CORE || aaDeployment.config.starknetCore
    ),
    l2UnlockVerifier: requireUint256(
      'L2_UNLOCK_VERIFIER',
      env.L2_UNLOCK_VERIFIER || aaDeployment.config.l2UnlockVerifier
    ),
  };
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
        'function verifyingSigner() view returns (address)',
        'function philIdentityMint() view returns (address)',
      ],
      provider
    );

    const onchainFactRegistry = ethers.getAddress(await humanityVerifier.factRegistry());
    const onchainFactoryProofGate = ethers.getAddress(await factory.proofGate());
    const onchainFactoryPhilIdentityMint = ethers.getAddress(await factory.philIdentityMint());
    const onchainUnlockInbox = ethers.getAddress(await factory.unlockInbox());
    const onchainPaymasterSigner = ethers.getAddress(await paymaster.verifyingSigner());
    const onchainPaymasterPhilIdentityMint = ethers.getAddress(await paymaster.philIdentityMint());

    await assertContractCode(provider, 'PhilUnlockInbox', onchainUnlockInbox);

    const unlockInbox = new ethers.Contract(
      onchainUnlockInbox,
      [
        'function starknetCore() view returns (address)',
        'function l2VerifierAddress() view returns (uint256)',
      ],
      provider
    );

    const onchainStarknetCore = ethers.getAddress(await unlockInbox.starknetCore());
    const onchainL2Verifier = BigInt(await unlockInbox.l2VerifierAddress());

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
    if (onchainL2Verifier !== config.l2UnlockVerifier) {
      throw new Error(
        `PhilUnlockInbox.l2VerifierAddress() mismatch. Expected ${config.l2UnlockVerifier}, got ${onchainL2Verifier}.`
      );
    }

    console.log(`Verified Sepolia deployment bindings on chain ${connectedChainId}:`);
    console.log(`  HumanityVerifier.factRegistry(): ${onchainFactRegistry}`);
    console.log(`  ProofGate.authorizedCaller(PHIL_IDENTITY_MINT): true`);
    console.log(`  ProofGate.authorizedCaller(PHIL_ACCOUNT_FACTORY): true`);
    console.log(`  PHIL_ACCOUNT_FACTORY.proofGate(): ${onchainFactoryProofGate}`);
    console.log(`  PHIL_ACCOUNT_FACTORY.philIdentityMint(): ${onchainFactoryPhilIdentityMint}`);
    console.log(`  PHIL_ACCOUNT_FACTORY.unlockInbox(): ${onchainUnlockInbox}`);
    console.log(`  PHIL_PAYMASTER.verifyingSigner(): ${onchainPaymasterSigner}`);
    console.log(`  PHIL_PAYMASTER.philIdentityMint(): ${onchainPaymasterPhilIdentityMint}`);
    console.log(`  PhilUnlockInbox.starknetCore(): ${onchainStarknetCore}`);
    console.log(`  PhilUnlockInbox.l2VerifierAddress(): ${onchainL2Verifier}`);
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
