import { describe, expect, it } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ganache from 'ganache';
import { ethers } from 'ethers';

import authRoute from './auth.js';
import requestMintRoute from './requestMint.js';
import signPaymasterRoute from './signPaymaster.js';
import { AllowlistAccessError } from '../lib/allowlist.js';
import { PhilDatabase } from '../lib/db.js';

const DROP_ID = '13';
const PROGRAM_HASH = '0x' + '44'.repeat(32);
const CHAIN_ID = 31337;
const MNEMONIC = 'test test test test test test test test test test test junk';
const STARK_PUB_KEY_X = 123456789n;

const TEST_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(TEST_DIR, '..', '..', '..');

function readArtifact(name: string) {
  const candidates = [
    path.join(REPO_ROOT, 'artifacts', 'contracts', `${name}.sol`, `${name}.json`),
    path.join(REPO_ROOT, 'artifacts', 'contracts', 'mocks', `${name}.sol`, `${name}.json`),
  ];

  for (const artifactPath of candidates) {
    if (fs.existsSync(artifactPath)) {
      return JSON.parse(fs.readFileSync(artifactPath, 'utf8'));
    }
  }

  throw new Error(`Missing artifact for ${name}`);
}

async function deployContract(
  signer: ethers.Signer,
  artifact: { abi: unknown[]; bytecode: string },
  args: unknown[] = []
) {
  const factory = new ethers.ContractFactory(artifact.abi, artifact.bytecode, signer);
  const contract = await factory.deploy(...args);
  await contract.waitForDeployment();
  return contract;
}

function createAllowlistProvider(entries: Record<string, number>) {
  const normalizedEntries = new Map(
    Object.entries(entries).map(([address, remaining]) => [
      ethers.getAddress(address).toLowerCase(),
      remaining,
    ])
  );

  return {
    async getEligibility(_: string, address: string) {
      const normalized = ethers.getAddress(address).toLowerCase();
      const remaining = normalizedEntries.get(normalized) ?? 0;
      return {
        eligible: remaining > 0,
        remaining,
      };
    },
    async consumeMint(_: string, address: string) {
      const normalized = ethers.getAddress(address).toLowerCase();
      const remaining = normalizedEntries.get(normalized) ?? 0;
      if (remaining < 1) {
        throw new AllowlistAccessError(
          'ALLOWLIST_EXHAUSTED',
          403,
          'No allowlist spots left for this address'
        );
      }

      normalizedEntries.set(normalized, remaining - 1);
      return {
        eligible: remaining - 1 > 0,
        remaining: remaining - 1,
      };
    },
  };
}

async function authenticate(app: FastifyInstance, wallet: ethers.Wallet): Promise<string> {
  const challengeRes = await app.inject({
    method: 'POST',
    url: '/auth/challenge',
    payload: {
      recipient: wallet.address,
    },
  });
  expect(challengeRes.statusCode).toBe(200);
  const challenge = challengeRes.json();

  const verifyRes = await app.inject({
    method: 'POST',
    url: '/auth/verify',
    payload: {
      recipient: wallet.address,
      nonce: challenge.nonce,
      signature: await wallet.signMessage(challenge.message),
    },
  });
  expect(verifyRes.statusCode).toBe(200);
  return verifyRes.json().token as string;
}

function buildUserOp(params: {
  sender: string;
  philTestMintAddress: string;
  recipient: string;
  mintTo: string;
  philId: number;
  paletteVariant: number;
  mixMode: number;
  mixSeed: number;
  mintProof: {
    expiry: string;
    factHash: string;
    signature: string;
  };
  factoryAddress: string;
  createProof: {
    expiry: string;
    factHash: string;
    signature: string;
  };
}) {
  const executeIface = new ethers.Interface([
    'function execute(address target, uint256 value, bytes data)',
  ]);
  const mintIface = new ethers.Interface([
    'function mint(address recipient, address mintTo, uint8 philId, uint8 paletteVariant, uint8 mixMode, uint32 mixSeed, (uint256 expiry, bytes32 factHash, bytes signature) proof)',
  ]);
  const createIface = new ethers.Interface([
    'function createPhilAccount(address owner, uint256 starkPubKeyX, (uint256 expiry, bytes32 factHash, bytes signature) proof)',
  ]);

  const mintCalldata = mintIface.encodeFunctionData('mint', [
    params.recipient,
    params.mintTo,
    params.philId,
    params.paletteVariant,
    params.mixMode,
    params.mixSeed,
    params.mintProof,
  ]);

  const initCalldata = createIface.encodeFunctionData('createPhilAccount', [
    params.recipient,
    STARK_PUB_KEY_X,
    params.createProof,
  ]);

  return {
    sender: params.sender,
    nonce: '0x0',
    initCode: ethers.hexlify(ethers.concat([params.factoryAddress, initCalldata])),
    callData: executeIface.encodeFunctionData('execute', [
      params.philTestMintAddress,
      0n,
      mintCalldata,
    ]),
    accountGasLimits: ethers.zeroPadValue('0x01', 32),
    preVerificationGas: '0x5208',
    gasFees: ethers.zeroPadValue('0x02', 32),
  };
}

async function issueProofs(app: FastifyInstance, wallet: ethers.Wallet, harness: Harness) {
  const token = await authenticate(app, wallet);
  const createActionHash = ethers.hexlify(
    await harness.factory.computeCreateActionHash(wallet.address, STARK_PUB_KEY_X)
  );

  const mintRes = await app.inject({
    method: 'POST',
    url: '/request-mint',
    headers: {
      authorization: `Bearer ${token}`,
    },
    payload: {
      recipient: wallet.address,
      philId: 2,
      paletteVariant: 5,
      mixMode: 1,
      mixSeed: 1234,
    },
  });
  expect(mintRes.statusCode).toBe(200);
  const mintBody = mintRes.json();

  const createRes = await app.inject({
    method: 'POST',
    url: '/request-mint',
    headers: {
      authorization: `Bearer ${token}`,
    },
    payload: {
      kind: 'action',
      recipient: wallet.address,
      actionType: 2,
      actionHash: createActionHash,
      expiry: String(Math.floor(Date.now() / 1000) + 900),
    },
  });
  expect(createRes.statusCode).toBe(200);
  const createBody = createRes.json();

  const userOp = buildUserOp({
    sender: harness.smartAccount,
    philTestMintAddress: harness.philTestMintAddress,
    recipient: wallet.address,
    mintTo: harness.smartAccount,
    philId: 2,
    paletteVariant: 5,
    mixMode: 1,
    mixSeed: 1234,
    mintProof: mintBody.proof,
    factoryAddress: await harness.factory.getAddress(),
    createProof: createBody.proof,
  });

  return {
    token,
    proofId: mintBody.proofId as string,
    mintProof: mintBody.proof as { expiry: string; factHash: string; signature: string },
    createProof: createBody.proof as { expiry: string; factHash: string; signature: string },
    createActionHash,
    userOp,
  };
}

interface Harness {
  app: FastifyInstance;
  db: PhilDatabase;
  provider: ethers.BrowserProvider;
  ganacheProvider: ReturnType<typeof ganache.provider>;
  deployerWallet: ethers.HDNodeWallet;
  recipientWallet: ethers.HDNodeWallet;
  backendSignerWallet: ethers.HDNodeWallet;
  paymasterSignerWallet: ethers.HDNodeWallet;
  gate: ethers.Contract;
  factory: ethers.Contract;
  philTestMintAddress: string;
  smartAccount: string;
}

async function createHarness(options: { allowlistSignerAddress?: string } = {}): Promise<Harness> {
  const ganacheProvider = ganache.provider({
    chain: { chainId: CHAIN_ID },
    wallet: {
      mnemonic: MNEMONIC,
      totalAccounts: 8,
      defaultBalance: 1000,
    },
    logging: { quiet: true },
  });
  const provider = new ethers.BrowserProvider(ganacheProvider);
  const deployer = await provider.getSigner(0);
  const deployerWallet = ethers.HDNodeWallet.fromPhrase(
    MNEMONIC,
    undefined,
    "m/44'/60'/0'/0/0"
  ).connect(provider);
  const recipientWallet = ethers.HDNodeWallet.fromPhrase(
    MNEMONIC,
    undefined,
    "m/44'/60'/0'/0/1"
  ).connect(provider);
  const paymasterSignerWallet = ethers.HDNodeWallet.fromPhrase(
    MNEMONIC,
    undefined,
    "m/44'/60'/0'/0/2"
  ).connect(provider);

  const gate = await deployContract(deployer, readArtifact('ProofGateTest13'), [
    PROGRAM_HASH,
    BigInt(DROP_ID),
    await deployer.getAddress(),
  ]);
  const mockStarknetCore = await deployContract(deployer, readArtifact('MockStarknetCore'));
  const unlockInbox = await deployContract(deployer, readArtifact('PhilUnlockInbox'), [
    await mockStarknetCore.getAddress(),
    0,
  ]);
  const accountImpl = await deployContract(deployer, readArtifact('PhilAccount'));
  const philTestMintAddress = await (await provider.getSigner(7)).getAddress();
  const factory = await deployContract(deployer, readArtifact('PhilAccountFactory'), [
    await accountImpl.getAddress(),
    await unlockInbox.getAddress(),
    philTestMintAddress,
    await gate.getAddress(),
  ]);
  const paymaster = await deployContract(deployer, readArtifact('PhilPaymaster'), [
    await deployer.getAddress(),
    paymasterSignerWallet.address,
    philTestMintAddress,
  ]);

  const smartAccount = ethers.getAddress(
    await factory.getPhilAddress(recipientWallet.address, STARK_PUB_KEY_X)
  );

  const db = new PhilDatabase(':memory:');
  const app = Fastify();
  const backendSignerWallet = deployerWallet;

  await app.register(authRoute, {
    db,
    dropId: DROP_ID,
    chainId: CHAIN_ID,
    proofGateAddress: await gate.getAddress(),
  });

  await app.register(requestMintRoute, {
    dropId: DROP_ID,
    programHash: PROGRAM_HASH,
    chainId: CHAIN_ID,
    proofGateAddress: await gate.getAddress(),
    allowlistProvider: createAllowlistProvider({ [recipientWallet.address]: 2 }),
    allowlistSignerKey: backendSignerWallet.privateKey,
    mintTtlSeconds: 600,
    db,
    resolveSmartAccount: async () => smartAccount,
  });

  await app.register(signPaymasterRoute, {
    paymasterAddress: await paymaster.getAddress(),
    paymasterSignerKey: paymasterSignerWallet.privateKey,
    philTestMintAddress,
    proofGateAddress: await gate.getAddress(),
    allowlistSignerAddress: options.allowlistSignerAddress || backendSignerWallet.address,
    philAccountFactoryAddress: await factory.getAddress(),
    chainId: CHAIN_ID,
    db,
    provider,
  });

  return {
    app,
    db,
    provider,
    ganacheProvider,
    deployerWallet,
    recipientWallet,
    backendSignerWallet,
    paymasterSignerWallet,
    gate,
    factory,
    philTestMintAddress,
    smartAccount,
  };
}

async function closeHarness(harness: Harness) {
  await harness.app.close();
  harness.db.close();
  await harness.ganacheProvider.disconnect();
}

describe('/sign-paymaster live proof prechecks', () => {
  it('rejects invalid createProof embedded in initCode', async () => {
    const harness = await createHarness();
    try {
      const issued = await issueProofs(harness.app, harness.recipientWallet, harness);
      const invalidCreateProofUserOp = {
        ...issued.userOp,
        initCode: issued.userOp.initCode.replace(
          issued.createProof.factHash.slice(2),
          `ff${issued.createProof.factHash.slice(4)}`
        ),
      };

      const res = await harness.app.inject({
        method: 'POST',
        url: '/sign-paymaster',
        headers: {
          authorization: `Bearer ${issued.token}`,
        },
        payload: {
          proofId: issued.proofId,
          userOp: invalidCreateProofUserOp,
        },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json()).toMatchObject({
        success: false,
        code: 'CREATE_PROOF_FACTHASH_INVALID',
      });
    } finally {
      await closeHarness(harness);
    }
  });

  it('rejects createProof that is already consumed on-chain', async () => {
    const harness = await createHarness();
    try {
      const issued = await issueProofs(harness.app, harness.recipientWallet, harness);
      await (
        await harness.gate.verifyActionAndConsume(
          harness.recipientWallet.address,
          2,
          issued.createActionHash,
          issued.createProof
        )
      ).wait();

      const res = await harness.app.inject({
        method: 'POST',
        url: '/sign-paymaster',
        headers: {
          authorization: `Bearer ${issued.token}`,
        },
        payload: {
          proofId: issued.proofId,
          userOp: issued.userOp,
        },
      });

      expect(res.statusCode).toBe(409);
      expect(res.json()).toMatchObject({
        success: false,
        code: 'CREATE_PROOF_ALREADY_USED',
      });
    } finally {
      await closeHarness(harness);
    }
  });

  it('rejects mint proof that is already consumed on-chain', async () => {
    const harness = await createHarness();
    try {
      const issued = await issueProofs(harness.app, harness.recipientWallet, harness);
      await (
        await harness.gate.verifyAndConsume(
          harness.recipientWallet.address,
          harness.smartAccount,
          2,
          5,
          1,
          1234,
          issued.mintProof
        )
      ).wait();

      const res = await harness.app.inject({
        method: 'POST',
        url: '/sign-paymaster',
        headers: {
          authorization: `Bearer ${issued.token}`,
        },
        payload: {
          proofId: issued.proofId,
          userOp: issued.userOp,
        },
      });

      expect(res.statusCode).toBe(409);
      expect(res.json()).toMatchObject({
        success: false,
        code: 'MINT_PROOF_ALREADY_USED',
      });
    } finally {
      await closeHarness(harness);
    }
  });

  it('rejects allowlist signer mismatch', async () => {
    const mismatchWallet = ethers.Wallet.createRandom();
    const harness = await createHarness({
      allowlistSignerAddress: mismatchWallet.address,
    });
    try {
      const issued = await issueProofs(harness.app, harness.recipientWallet, harness);
      const res = await harness.app.inject({
        method: 'POST',
        url: '/sign-paymaster',
        headers: {
          authorization: `Bearer ${issued.token}`,
        },
        payload: {
          proofId: issued.proofId,
          userOp: issued.userOp,
        },
      });

      expect(res.statusCode).toBe(503);
      expect(res.json()).toMatchObject({
        success: false,
        code: 'ALLOWLIST_SIGNER_MISMATCH',
      });
    } finally {
      await closeHarness(harness);
    }
  });

  it('returns a sponsorship signature for a fully valid undeployed account userOp', async () => {
    const harness = await createHarness();
    try {
      const issued = await issueProofs(harness.app, harness.recipientWallet, harness);
      const res = await harness.app.inject({
        method: 'POST',
        url: '/sign-paymaster',
        headers: {
          authorization: `Bearer ${issued.token}`,
        },
        payload: {
          proofId: issued.proofId,
          userOp: issued.userOp,
        },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({
        success: true,
      });
      expect(res.json().paymasterAndData).toMatch(/^0x[a-f0-9]+$/);
      expect(ethers.dataLength(res.json().paymasterAndData)).toBe(149);
    } finally {
      await closeHarness(harness);
    }
  });
});
