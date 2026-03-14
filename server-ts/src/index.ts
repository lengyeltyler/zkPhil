/**
 * Phil Test13 Proof Server
 *
 * Server for issuing backend-signed proofs for Phil Test13.
 */

import Fastify from 'fastify';
import cors from '@fastify/cors';
import dotenv from 'dotenv';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { createAllowlistProvider, type AllowlistProvider } from './lib/allowlist.js';
import { PhilDatabase } from './lib/db.js';
import { createSmartAccountResolver } from './lib/philAccount.js';

import authRoute from './routes/auth.js';
import requestMintRoute from './routes/requestMint.js';
import statusRoute from './routes/status.js';
import computeAccountRoute from './routes/computeAccount.js';
import signPaymasterRoute from './routes/signPaymaster.js';

const INDEX_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(INDEX_DIR, '..', '..');
dotenv.config({ path: path.join(REPO_ROOT, '.env.local') });
dotenv.config({ path: path.join(REPO_ROOT, '.env') });

type DeploymentMap = Record<string, string>;

const DEFAULT_RPC_URL_NODE = 'http://127.0.0.1:8545';
const DEFAULT_DEV_CORS_ORIGINS = [
  'http://localhost:3000',
  'http://127.0.0.1:3000',
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'http://localhost:8080',
  'http://127.0.0.1:8080',
];

function readEnv(name: string): string {
  return (process.env[name] || '').trim();
}

function resolveRpcUrl(): string {
  const explicitRpcUrl = readEnv('RPC_URL');
  if (explicitRpcUrl) {
    return explicitRpcUrl;
  }

  const rpcProfile = readEnv('RPC_PROFILE').toLowerCase() || 'node';
  if (rpcProfile === 'node') {
    return readEnv('RPC_URL_NODE') || DEFAULT_RPC_URL_NODE;
  }

  return '';
}

function resolveWritablePath(rawPath: string): string {
  if (!rawPath) {
    return '';
  }
  if (path.isAbsolute(rawPath)) {
    return rawPath;
  }

  const cwdCandidate = path.resolve(process.cwd(), rawPath);
  if (existsSync(path.dirname(cwdCandidate))) {
    return cwdCandidate;
  }

  return path.resolve(REPO_ROOT, rawPath);
}

const PORT = parseInt(process.env.PORT || '8787', 10);
const HOST = process.env.HOST || '127.0.0.1';
const DROP_ID_RAW = process.env.DROP_ID || '13';
const DATABASE_PATH = resolveWritablePath(process.env.DATABASE_PATH || './server-ts/data/phil_test13.db');
const PROGRAM_HASH = process.env.PROGRAM_HASH || '';
const CHAIN_ID_RAW = process.env.CHAIN_ID || '';
const RPC_URL = resolveRpcUrl();
const PAYMASTER_SIGNER_KEY = process.env.PAYMASTER_SIGNER_KEY || '';
const ALLOWLIST_SIGNER_KEY = process.env.ALLOWLIST_SIGNER_KEY || '';
const MINT_TTL_SECONDS = parseInt(process.env.MINT_TTL_SECONDS || '600', 10);

const SUPPORTED_CHAIN_IDS = new Map<number, string>([
  [1, 'mainnet'],
  [11155111, 'sepolia'],
  [17000, 'holesky'],
  [31337, 'local'],
]);

function getDeploymentPath(fileName: string): string {
  return path.join(REPO_ROOT, 'deployments', fileName);
}

function readDeployment(fileName: string): DeploymentMap | null {
  const deploymentPath = getDeploymentPath(fileName);
  if (!existsSync(deploymentPath)) {
    return null;
  }

  try {
    const parsed = JSON.parse(readFileSync(deploymentPath, 'utf8'));
    if (!parsed || typeof parsed !== 'object') {
      return null;
    }
    return parsed as DeploymentMap;
  } catch {
    return null;
  }
}

const RATE_LIMIT_WINDOW_MS = parseInt(process.env.RATE_LIMIT_WINDOW_MS || '60000', 10);
const RATE_LIMIT_MAX = parseInt(process.env.RATE_LIMIT_MAX || '120', 10);

export function isLoopbackHost(host: string): boolean {
  const normalized = String(host || '').trim().toLowerCase();
  return (
    normalized === '127.0.0.1' ||
    normalized === 'localhost' ||
    normalized === '::1'
  );
}

export function assertAddressBinding(
  label: string,
  expected: string,
  actual: string
): void {
  if (expected.toLowerCase() !== actual.toLowerCase()) {
    throw new Error(`${label} mismatch. Expected ${expected}, got ${actual}.`);
  }
}

export function assertEnabledBinding(label: string, enabled: boolean): void {
  if (!enabled) {
    throw new Error(`${label} must be enabled.`);
  }
}

export function assertSafeHostBinding(env = process.env): void {
  const nodeEnv = String(env.NODE_ENV || '').trim().toLowerCase();
  const host = String(env.HOST || '127.0.0.1').trim();
  const allowUnsafeNonLoopback = String(env.UNSAFE_NONLOOPBACK_OK || '').trim().toLowerCase() === 'true';

  if (nodeEnv === 'production' && !isLoopbackHost(host) && !allowUnsafeNonLoopback) {
    throw new Error(
      `Refusing to bind production backend to non-loopback HOST=${host}. Set UNSAFE_NONLOOPBACK_OK=true only for an explicitly unsafe override.`
    );
  }
}

function isLoopbackOrigin(origin: string): boolean {
  try {
    const url = new URL(origin);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
    return url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '::1';
  } catch {
    return false;
  }
}

export function buildCorsConfig(env = process.env) {
  const nodeEnv = String(env.NODE_ENV || '').trim().toLowerCase();
  const defaultOrigins = nodeEnv === 'production' ? [] : DEFAULT_DEV_CORS_ORIGINS;
  const allowedOrigins = new Set(
    (env.CORS_ORIGINS || env.CORS_ORIGIN || defaultOrigins.join(','))
      .split(',')
      .map((origin) => origin.trim())
      .filter(Boolean)
  );
  const allowLoopbackOrigins = String(
    env.ALLOW_LOOPBACK_ORIGINS || (nodeEnv === 'production' ? 'false' : 'true')
  ).toLowerCase() !== 'false';

  return {
    allowedOrigins,
    allowLoopbackOrigins,
  };
}

export function isCorsOriginAllowed(
  origin: string | undefined,
  env = process.env
): boolean {
  const { allowedOrigins, allowLoopbackOrigins } = buildCorsConfig(env);
  if (!origin) {
    // Non-browser or same-origin local tooling may omit Origin. Allow them.
    return true;
  }
  if (allowedOrigins.has('*') || allowedOrigins.has(origin)) {
    return true;
  }
  if (allowLoopbackOrigins && isLoopbackOrigin(origin)) {
    return true;
  }
  return false;
}

async function main() {
  try {
    assertSafeHostBinding(process.env);
  } catch (error) {
    console.error(`ERROR: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }

  if (!CHAIN_ID_RAW) {
    console.error('ERROR: CHAIN_ID must be set explicitly in environment');
    process.exit(1);
  }
  if (!RPC_URL) {
    console.error('ERROR: RPC_URL must be set explicitly, or resolve from RPC_PROFILE/RPC_URL_NODE/RPC_URL_CLOUDFLARE');
    process.exit(1);
  }

  const CHAIN_ID = Number(CHAIN_ID_RAW);
  if (!Number.isInteger(CHAIN_ID)) {
    console.error(`ERROR: Invalid CHAIN_ID: ${CHAIN_ID_RAW}`);
    process.exit(1);
  }

  const backendNetwork = SUPPORTED_CHAIN_IDS.get(CHAIN_ID);
  if (!backendNetwork) {
    console.error(
      `ERROR: Unsupported CHAIN_ID=${CHAIN_ID}. Supported values: ${[...SUPPORTED_CHAIN_IDS.keys()].join(', ')}`
    );
    process.exit(1);
  }

  if (!PROGRAM_HASH) {
    console.error('ERROR: PROGRAM_HASH must be set in environment');
    process.exit(1);
  }
  if (!ALLOWLIST_SIGNER_KEY) {
    console.error('ERROR: ALLOWLIST_SIGNER_KEY must be set in environment');
    process.exit(1);
  }
  if (!Number.isFinite(MINT_TTL_SECONDS) || MINT_TTL_SECONDS < 1) {
    console.error(`ERROR: Invalid MINT_TTL_SECONDS: ${process.env.MINT_TTL_SECONDS || ''}`);
    process.exit(1);
  }

  const DROP_ID = BigInt(DROP_ID_RAW);
  const aaDeployment = readDeployment(`4337_${CHAIN_ID}.json`);
  const starkDeployment = readDeployment(`stark_${CHAIN_ID}.json`);
  const PHIL_ACCOUNT_FACTORY = process.env.PHIL_ACCOUNT_FACTORY || aaDeployment?.PhilAccountFactory || '';
  const PAYMASTER_ADDRESS = process.env.PHIL_PAYMASTER || aaDeployment?.PhilPaymaster || '';
  const PROOF_GATE_ADDRESS =
    process.env.PROOF_GATE ||
    starkDeployment?.ProofGateTest13 ||
    starkDeployment?.ProofGate ||
    aaDeployment?.ProofGateTest13 ||
    '';
  const PHIL_TEST_MINT_ADDRESS =
    process.env.PHIL_TEST_MINT ||
    starkDeployment?.PhilTestMint ||
    aaDeployment?.PhilTestMint ||
    '';

  if (!PROOF_GATE_ADDRESS) {
    console.error(
      `ERROR: Proof gate address is unresolved for chain ${CHAIN_ID}. Set PROOF_GATE or provide deployments/${`stark_${CHAIN_ID}.json`}.`
    );
    process.exit(1);
  }
  if (!PHIL_ACCOUNT_FACTORY) {
    console.error(
      `ERROR: PHIL_ACCOUNT_FACTORY is required for deterministic mintTo binding on chain ${CHAIN_ID}.`
    );
    process.exit(1);
  }
  if (PAYMASTER_ADDRESS && !PAYMASTER_SIGNER_KEY) {
    console.error('ERROR: PAYMASTER_SIGNER_KEY must be set when PHIL_PAYMASTER is configured');
    process.exit(1);
  }
  if (PAYMASTER_ADDRESS && !PHIL_TEST_MINT_ADDRESS) {
    console.error('ERROR: PHIL_TEST_MINT must be set when PHIL_PAYMASTER is configured');
    process.exit(1);
  }

  const db = new PhilDatabase(DATABASE_PATH);
  const { allowedOrigins, allowLoopbackOrigins } = buildCorsConfig(process.env);

  let allowlistProvider: AllowlistProvider;
  try {
    allowlistProvider = createAllowlistProvider({ db });
  } catch (error) {
    console.error(`ERROR: ${error instanceof Error ? error.message : String(error)}`);
    db.close();
    process.exit(1);
  }

  const { ethers } = await import('ethers');
  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const allowlistSignerAddress = new ethers.Wallet(ALLOWLIST_SIGNER_KEY).address;
  const paymasterSignerAddress = PAYMASTER_SIGNER_KEY
    ? new ethers.Wallet(PAYMASTER_SIGNER_KEY).address
    : '';
  const providerNetwork = await provider.getNetwork();
  const providerChainId = Number(providerNetwork.chainId);
  if (providerChainId !== CHAIN_ID) {
    console.error(
      `ERROR: RPC chain mismatch: CHAIN_ID=${CHAIN_ID}, provider=${providerChainId}, RPC_URL=${RPC_URL}`
    );
    process.exit(1);
  }

  const factoryCode = await provider.getCode(PHIL_ACCOUNT_FACTORY);
  if (factoryCode === '0x') {
    db.close();
    throw new Error(
      `No contract code at PHIL_ACCOUNT_FACTORY=${PHIL_ACCOUNT_FACTORY} on chain ${CHAIN_ID} (${RPC_URL})`
    );
  }

  const factoryReader = new ethers.Contract(
    PHIL_ACCOUNT_FACTORY,
    [
      'function proofGate() view returns (address)',
      'function philTestMint() view returns (address)',
      'function unlockInbox() view returns (address)',
    ],
    provider
  );
  const proofGateReader = new ethers.Contract(
    PROOF_GATE_ADDRESS,
    [
      'function allowlistSigner() view returns (address)',
      'function authorizedCaller(address) view returns (bool)',
    ],
    provider
  );
  const onchainAllowlistSigner = ethers.getAddress(await proofGateReader.allowlistSigner());
  if (onchainAllowlistSigner.toLowerCase() !== allowlistSignerAddress.toLowerCase()) {
    db.close();
    console.error(
      `ERROR: ALLOWLIST_SIGNER_KEY mismatch. Configured signer ${allowlistSignerAddress} does not match ProofGate.allowlistSigner() ${onchainAllowlistSigner}.`
    );
    process.exit(1);
  }

  const onchainFactoryProofGate = ethers.getAddress(await factoryReader.proofGate());
  try {
    assertAddressBinding(
      'PHIL_ACCOUNT_FACTORY.proofGate()',
      ethers.getAddress(PROOF_GATE_ADDRESS),
      onchainFactoryProofGate
    );
  } catch (error) {
    db.close();
    console.error(`ERROR: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }

  const onchainFactoryPhilTestMint = ethers.getAddress(await factoryReader.philTestMint());
  if (PHIL_TEST_MINT_ADDRESS) {
    try {
      assertAddressBinding(
        'PHIL_ACCOUNT_FACTORY.philTestMint()',
        ethers.getAddress(PHIL_TEST_MINT_ADDRESS),
        onchainFactoryPhilTestMint
      );
    } catch (error) {
      db.close();
      console.error(`ERROR: ${error instanceof Error ? error.message : String(error)}`);
      process.exit(1);
    }
  }

  const onchainUnlockInbox = ethers.getAddress(await factoryReader.unlockInbox());
  const unlockInboxCode = await provider.getCode(onchainUnlockInbox);
  if (unlockInboxCode === '0x') {
    db.close();
    console.error(
      `ERROR: No contract code at PHIL_ACCOUNT_FACTORY.unlockInbox()=${onchainUnlockInbox} on chain ${CHAIN_ID} (${RPC_URL})`
    );
    process.exit(1);
  }

  try {
    assertEnabledBinding(
      'ProofGate.authorizedCaller(PHIL_ACCOUNT_FACTORY)',
      Boolean(await proofGateReader.authorizedCaller(PHIL_ACCOUNT_FACTORY))
    );
  } catch (error) {
    db.close();
    console.error(`ERROR: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }

  if (PHIL_TEST_MINT_ADDRESS) {
    try {
      assertEnabledBinding(
        'ProofGate.authorizedCaller(PHIL_TEST_MINT)',
        Boolean(await proofGateReader.authorizedCaller(PHIL_TEST_MINT_ADDRESS))
      );
    } catch (error) {
      db.close();
      console.error(`ERROR: ${error instanceof Error ? error.message : String(error)}`);
      process.exit(1);
    }
  }

  if (PAYMASTER_ADDRESS && PAYMASTER_SIGNER_KEY) {
    const paymasterReader = new ethers.Contract(
      PAYMASTER_ADDRESS,
      [
        'function verifyingSigner() view returns (address)',
        'function philTestMint() view returns (address)',
      ],
      provider
    );

    const onchainPaymasterSigner = ethers.getAddress(await paymasterReader.verifyingSigner());
    const onchainPaymasterPhilTestMint = ethers.getAddress(await paymasterReader.philTestMint());
    try {
      assertAddressBinding(
        'PHIL_PAYMASTER.verifyingSigner()',
        paymasterSignerAddress,
        onchainPaymasterSigner
      );
      assertAddressBinding(
        'PHIL_PAYMASTER.philTestMint()',
        ethers.getAddress(PHIL_TEST_MINT_ADDRESS),
        onchainPaymasterPhilTestMint
      );
    } catch (error) {
      db.close();
      console.error(`ERROR: ${error instanceof Error ? error.message : String(error)}`);
      process.exit(1);
    }
  }

  const resolveSmartAccount = createSmartAccountResolver({
    provider,
    factoryAddress: PHIL_ACCOUNT_FACTORY,
    chainId: CHAIN_ID,
  });

  const fastify = Fastify({
    logger: true,
  });

  const rateBuckets = new Map<string, { count: number; resetAt: number }>();
  fastify.addHook('onRequest', async (request, reply) => {
    const key = request.ip || 'unknown';
    const now = Date.now();
    const bucket = rateBuckets.get(key);

    if (!bucket || now >= bucket.resetAt) {
      rateBuckets.set(key, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
      return;
    }

    if (bucket.count >= RATE_LIMIT_MAX) {
      reply.code(429).send({
        success: false,
        code: 'RATE_LIMITED',
        error: 'Too many requests. Please retry later.',
      });
      return reply;
    }

    bucket.count += 1;
  });

  await fastify.register(cors, {
    origin: (origin, cb) => {
      if (isCorsOriginAllowed(origin, process.env)) {
        cb(null, true);
        return;
      }
      cb(new Error(`CORS origin not allowed: ${origin}`), false);
    },
  });

  fastify.log.info(`Database initialized at ${DATABASE_PATH}`);

  await fastify.register(statusRoute, {
    dropId: DROP_ID,
    programHash: PROGRAM_HASH,
    backendChainId: providerChainId,
    backendFactory: PHIL_ACCOUNT_FACTORY,
    proofGateAddress: PROOF_GATE_ADDRESS,
    allowlistSigner: allowlistSignerAddress,
    paymasterAddress: PAYMASTER_ADDRESS,
    backendNetwork,
  });

  await fastify.register(authRoute, {
    db,
    dropId: `0x${DROP_ID.toString(16).padStart(64, '0')}`,
    chainId: providerChainId,
    proofGateAddress: PROOF_GATE_ADDRESS,
  });

  await fastify.register(requestMintRoute, {
    dropId: DROP_ID.toString(),
    programHash: PROGRAM_HASH,
    chainId: providerChainId,
    proofGateAddress: PROOF_GATE_ADDRESS,
    allowlistProvider,
    allowlistSignerKey: ALLOWLIST_SIGNER_KEY,
    mintTtlSeconds: MINT_TTL_SECONDS,
    db,
    resolveSmartAccount,
  });

  await fastify.register(computeAccountRoute, {
    factoryAddress: PHIL_ACCOUNT_FACTORY,
    provider,
  });

  if (PAYMASTER_ADDRESS && PAYMASTER_SIGNER_KEY) {
    await fastify.register(signPaymasterRoute, {
      paymasterAddress: PAYMASTER_ADDRESS,
      paymasterSignerKey: PAYMASTER_SIGNER_KEY,
      philTestMintAddress: PHIL_TEST_MINT_ADDRESS,
      philAccountFactoryAddress: PHIL_ACCOUNT_FACTORY,
      proofGateAddress: PROOF_GATE_ADDRESS,
      allowlistSignerAddress,
      chainId: providerChainId,
      db,
      provider,
    });
  }

  const shutdown = async () => {
    fastify.log.info('Shutting down...');
    db.close();
    await fastify.close();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  try {
    await fastify.listen({ port: PORT, host: HOST });

    console.log('\n' + '='.repeat(60));
    console.log('PHIL TEST13 PROOF SERVER');
    console.log('='.repeat(60));
    console.log(`Server running on http://${HOST}:${PORT}`);
    console.log(`Drop ID: ${DROP_ID}`);
    console.log(`Chain ID: ${CHAIN_ID}`);
    console.log(`Backend Network: ${backendNetwork}`);
    console.log(`Program Hash: ${PROGRAM_HASH}`);
    console.log(`Allowlist Signer: ${allowlistSignerAddress}`);
    console.log(`CORS origins: ${allowedOrigins.size === 0 ? '(none)' : [...allowedOrigins].join(', ')}`);
    console.log(`Loopback origins allowed: ${allowLoopbackOrigins}`);
    console.log(`Mint TTL (s): ${MINT_TTL_SECONDS}`);
    if (PHIL_ACCOUNT_FACTORY) {
      console.log(`Factory: ${PHIL_ACCOUNT_FACTORY}`);
    }
    if (PHIL_TEST_MINT_ADDRESS) {
      console.log(`PhilTestMint: ${PHIL_TEST_MINT_ADDRESS}`);
    }
    if (PAYMASTER_ADDRESS) {
      console.log(`Paymaster: ${PAYMASTER_ADDRESS}`);
    }
    console.log(`ProofGate: ${PROOF_GATE_ADDRESS}`);
    console.log('='.repeat(60));
    console.log('\nEndpoints:');
    console.log('  GET  /health         - Health check');
    console.log('  GET  /status         - Server status');
    console.log('  GET  /eligibility    - Check backend mint eligibility');
    console.log('  POST /auth/challenge - Build recipient auth challenge');
    console.log('  POST /auth/verify    - Verify recipient auth challenge');
    console.log('  POST /request-mint   - Request backend-signed proof payload');
    console.log('  POST /compute-account - Compute Smart Account address');
    if (PAYMASTER_ADDRESS) {
      console.log('  POST /sign-paymaster  - Sign paymaster sponsorship');
    }
    console.log('='.repeat(60) + '\n');
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  main().catch((error) => {
    console.error(`ERROR: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  });
}
