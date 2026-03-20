import { describe, expect, it } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ganache from 'ganache';
import { ethers } from 'ethers';

import authRoute from './auth.js';
import requestMintRoute from './requestMint.js';
import signPaymasterRoute from './signPaymaster.js';
import { createEligibilityProvider } from '../lib/eligibility.js';
import { PhilDatabase } from '../lib/db.js';
import { buildCredentialBundle } from '../../../shared/proof/credentialBundle.mjs';

const PROOF_CONTEXT = '13';
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
    path.join(REPO_ROOT, 'artifacts', 'contracts', 'proofs', `${name}.sol`, `${name}.json`),
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
  philIdentityMintAddress: string;
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
      params.philIdentityMintAddress,
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

  await (await harness.registry.registerFact(ethers.zeroPadValue(mintBody.proof.factHash, 32))).wait();
  await (await harness.registry.registerFact(ethers.zeroPadValue(createBody.proof.factHash, 32))).wait();

  const userOp = buildUserOp({
    sender: harness.smartAccount,
    philIdentityMintAddress: harness.philIdentityMintAddress,
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
  registry: ethers.Contract;
  factory: ethers.Contract;
  philIdentityMintAddress: string;
  smartAccount: string;
  cleanupBundle: () => void;
}

async function createHarness(): Promise<Harness> {
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
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zkphil-sign-paymaster-'));
  const bundlePath = path.join(tempDir, 'credential-bundle.json');
  const bundle = buildCredentialBundle({
    proofContext: PROOF_CONTEXT,
    entries: [{ recipient: recipientWallet.address, credentialNonce: 0 }],
    seed: 'sign-paymaster-test',
  });
  fs.writeFileSync(bundlePath, JSON.stringify(bundle, null, 2));

  const registry = await deployContract(deployer, readArtifact('DevProofVerifier'), [
    await deployer.getAddress(),
  ]);
  const verifier = await deployContract(deployer, readArtifact('FactRegistryHumanityVerifier'), [
    PROGRAM_HASH,
    BigInt(PROOF_CONTEXT),
    await registry.getAddress(),
    bundle.verifierConfigHash,
  ]);
  const gate = await deployContract(deployer, readArtifact('PhilIdentityGate'), [
    await verifier.getAddress(),
    await deployer.getAddress(),
  ]);
  const mockStarknetCore = await deployContract(deployer, readArtifact('MockStarknetCore'));
  const unlockInbox = await deployContract(deployer, readArtifact('PhilUnlockInbox'), [
    await mockStarknetCore.getAddress(),
    0,
  ]);
  const accountImpl = await deployContract(deployer, readArtifact('PhilAccount'));
  const philIdentityMintAddress = await (await provider.getSigner(7)).getAddress();
  const factory = await deployContract(deployer, readArtifact('PhilAccountFactory'), [
    await accountImpl.getAddress(),
    await unlockInbox.getAddress(),
    philIdentityMintAddress,
    await gate.getAddress(),
  ]);
  const paymaster = await deployContract(deployer, readArtifact('PhilPaymaster'), [
    await deployer.getAddress(),
    paymasterSignerWallet.address,
    philIdentityMintAddress,
  ]);

  const smartAccount = ethers.getAddress(
    await factory.getPhilAddress(recipientWallet.address, STARK_PUB_KEY_X)
  );

  const db = new PhilDatabase(':memory:');
  const app = Fastify();
  const backendSignerWallet = deployerWallet;

  await app.register(authRoute, {
    db,
    proofContext: PROOF_CONTEXT,
    chainId: CHAIN_ID,
    proofGateAddress: await gate.getAddress(),
  });

  await app.register(requestMintRoute, {
    proofContext: PROOF_CONTEXT,
    programHash: PROGRAM_HASH,
    chainId: CHAIN_ID,
    proofGateAddress: await gate.getAddress(),
    eligibilityProvider: createEligibilityProvider({
      env: {
        CREDENTIAL_BUNDLE_PATH: bundlePath,
      } as NodeJS.ProcessEnv,
      isNullifierSpent: async (nullifier) => Boolean(await gate.isNullifierSpent(nullifier)),
      isProofReserved: async (proofMetadata) =>
        db.hasActiveIssuedMintProofSignature(proofMetadata, Math.floor(Date.now() / 1000)),
    }),
    mintTtlSeconds: 600,
    db,
    resolveSmartAccount: async () => smartAccount,
  });

  await app.register(signPaymasterRoute, {
    paymasterAddress: await paymaster.getAddress(),
    paymasterSignerKey: paymasterSignerWallet.privateKey,
    philIdentityMintAddress,
    proofGateAddress: await gate.getAddress(),
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
    registry,
    factory,
    philIdentityMintAddress,
    smartAccount,
    cleanupBundle: () => fs.rmSync(tempDir, { recursive: true, force: true }),
  };
}

async function closeHarness(harness: Harness) {
  await harness.app.close();
  harness.db.close();
  harness.cleanupBundle();
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

  it('rejects legacy backend-signature payloads that are not proof metadata', async () => {
    const harness = await createHarness();
    try {
      const issued = await issueProofs(harness.app, harness.recipientWallet, harness);
      const fakeLegacySignature = await harness.backendSignerWallet.signMessage(
        ethers.getBytes(issued.mintProof.factHash)
      );
      const invalidMintProofUserOp = {
        ...issued.userOp,
        callData: buildUserOp({
          sender: harness.smartAccount,
          philIdentityMintAddress: harness.philIdentityMintAddress,
          recipient: harness.recipientWallet.address,
          mintTo: harness.smartAccount,
          philId: 2,
          paletteVariant: 5,
          mixMode: 1,
          mixSeed: 1234,
          mintProof: {
            ...issued.mintProof,
            signature: fakeLegacySignature,
          },
          factoryAddress: await harness.factory.getAddress(),
          createProof: issued.createProof,
        }).callData,
      };
      const res = await harness.app.inject({
        method: 'POST',
        url: '/sign-paymaster',
        headers: {
          authorization: `Bearer ${issued.token}`,
        },
        payload: {
          proofId: issued.proofId,
          userOp: invalidMintProofUserOp,
        },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json()).toMatchObject({
        success: false,
        code: 'USEROP_PROOF_MISMATCH',
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
