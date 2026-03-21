import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { ethers } from 'ethers';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, '..', '..');
const DEFAULT_RPC_URL = 'http://127.0.0.1:8545';
const DEFAULT_SERVER_URL = 'http://127.0.0.1:8787';
const DEFAULT_PROVER_URL = 'http://127.0.0.1:8747';
const DEFAULT_CHAIN_ID = 31337n;
const MNEMONIC = 'test test test test test test test test test test test junk';

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) {
      args[key] = true;
    } else {
      args[key] = next;
      i += 1;
    }
  }
  return args;
}

export function deriveWallet(provider, index) {
  const hd = ethers.HDNodeWallet.fromPhrase(MNEMONIC, undefined, `m/44'/60'/0'/0/${index}`);
  return hd.connect(provider);
}

export function deterministicStarkKeyX(owner, chainId = DEFAULT_CHAIN_ID) {
  const pubKey = ethers.solidityPackedKeccak256(
    ['string', 'uint256', 'address'],
    ['phil-test-mode-stark-pubkey', BigInt(chainId), owner]
  );
  return ethers.toBeHex(BigInt(pubKey), 32);
}

export function readDeployment(fileName) {
  return JSON.parse(
    fs.readFileSync(path.join(ROOT_DIR, 'deployments', fileName), 'utf8')
  );
}

export async function fetchJson(url, options = {}) {
  const res = await fetch(url, options);
  const payload = await res.json().catch(() => null);
  if (!res.ok) {
    const codePrefix = payload?.code ? `${payload.code}: ` : '';
    const reason = `${codePrefix}${payload?.error || payload?.code || `HTTP ${res.status}`}`;
    throw new Error(`${url} failed: ${reason}`);
  }
  return payload;
}

export async function authenticate(serverUrl, wallet) {
  const challenge = await fetchJson(`${serverUrl}/auth/challenge`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ recipient: wallet.address }),
  });
  const verify = await fetchJson(`${serverUrl}/auth/verify`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      recipient: wallet.address,
      nonce: challenge.nonce,
      signature: await wallet.signMessage(challenge.message),
    }),
  });
  return verify.token;
}

export async function requestProof({
  serverUrl,
  proverUrl,
  token,
  payload,
}) {
  const requestRes = await fetchJson(`${serverUrl}/request-mint`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(payload),
  });

  const localProof = await fetchJson(`${proverUrl}/prove`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ request: requestRes.provingRequest }),
  });

  await fetchJson(`${serverUrl}/register-proof`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      proofId: requestRes.proofId,
      proof: localProof.proof,
    }),
  });

  return {
    ...requestRes,
    proof: localProof.proof,
    artifact: localProof.artifact,
  };
}

export async function runMintFlow({
  wallet,
  mockHumanId,
  philId,
  paletteVariant,
  provider,
  serverUrl,
  proverUrl,
  deployments,
  deployments4337,
}) {
  const token = await authenticate(serverUrl, wallet);
  const factory = new ethers.Contract(
    deployments4337.PhilAccountFactory,
    [
      'function computeCreateActionHash(address owner, uint256 starkPubKeyX) view returns (bytes32)',
      'function getPhilAddress(address owner, uint256 starkPubKeyX) view returns (address)',
      'function createPhilAccount(address owner, uint256 starkPubKeyX, (uint256 expiry, bytes32 factHash, bytes signature) proof) returns (address)',
    ],
    wallet
  );
  const mint = new ethers.Contract(
    deployments.PhilIdentityMint,
    [
      'function mint(address recipient,address mintTo,uint8 philId,uint8 paletteVariant,uint8 mixMode,uint32 mixSeed,(uint256 expiry,bytes32 factHash,bytes signature) proof)',
      'function ownerOf(uint256 tokenId) view returns (address)',
      'function totalSupply() view returns (uint256)',
    ],
    wallet
  );

  const starkPubKeyX = deterministicStarkKeyX(wallet.address);
  const smartAccount = await factory.getPhilAddress(wallet.address, starkPubKeyX);
  const createActionHash = await factory.computeCreateActionHash(wallet.address, starkPubKeyX);

  const createProofRes = await requestProof({
    serverUrl,
    proverUrl,
    token,
    payload: {
      kind: 'action',
      recipient: wallet.address,
      mockHumanId,
      actionType: 2,
      actionHash: createActionHash,
      expiry: String(Math.floor(Date.now() / 1000) + 900),
    },
  });

  await (await factory.createPhilAccount(wallet.address, starkPubKeyX, createProofRes.proof)).wait();

  const supplyBefore = await mint.totalSupply();
  const mintProofRes = await requestProof({
    serverUrl,
    proverUrl,
    token,
    payload: {
      kind: 'mint',
      recipient: wallet.address,
      mintTo: smartAccount,
      mockHumanId,
      philId,
      paletteVariant,
      mixMode: 0,
      mixSeed: 0,
    },
  });

  await (
    await mint.mint(
      wallet.address,
      smartAccount,
      philId,
      paletteVariant,
      0,
      0,
      mintProofRes.proof
    )
  ).wait();

  const owner = await mint.ownerOf(supplyBefore);
  if (owner.toLowerCase() !== smartAccount.toLowerCase()) {
    throw new Error(`ownerOf(${supplyBefore}) mismatch: expected ${smartAccount}, got ${owner}`);
  }

  return {
    tokenId: supplyBefore.toString(),
    smartAccount,
  };
}

export async function runMockHumanityFlow({
  rpcUrl = process.env.RPC_URL || DEFAULT_RPC_URL,
  serverUrl = process.env.SERVER_URL || DEFAULT_SERVER_URL,
  proverUrl = process.env.PROVER_URL || DEFAULT_PROVER_URL,
  mockHumanA = 'atlas',
  mockHumanB = 'briar',
  walletAIndex = 1,
  walletBIndex = 2,
  deployments = readDeployment('stark_31337.json'),
  deployments4337 = readDeployment('4337_31337.json'),
  log = true,
} = {}) {
  const provider = new ethers.JsonRpcProvider(rpcUrl, undefined, { batchMaxCount: 1 });
  const walletA = deriveWallet(provider, Number(walletAIndex));
  const walletB = deriveWallet(provider, Number(walletBIndex));

  if (log) {
    console.log('Running mock-humanity end-to-end flow...');
    console.log(`  RPC: ${rpcUrl}`);
    console.log(`  Server: ${serverUrl}`);
    console.log(`  Prover: ${proverUrl}`);
    console.log(`  Mock humans: ${mockHumanA}, ${mockHumanB}`);
  }

  const first = await runMintFlow({
    wallet: walletA,
    mockHumanId: mockHumanA,
    philId: 0,
    paletteVariant: 1,
    provider,
    serverUrl,
    proverUrl,
    deployments,
    deployments4337,
  });
  if (log) {
    console.log(`Minted ${mockHumanA} to ${first.smartAccount} as token ${first.tokenId}`);
  }

  const tokenB = await authenticate(serverUrl, walletB);
  let sameHumanRejected = false;
  try {
    await fetchJson(`${serverUrl}/request-mint`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${tokenB}`,
      },
      body: JSON.stringify({
        recipient: walletB.address,
        mockHumanId: mockHumanA,
        philId: 1,
        paletteVariant: 2,
      }),
    });
  } catch (error) {
    const message = String(error.message || error);
    sameHumanRejected =
      message.includes('MOCK_HUMAN_ALREADY_USED') ||
      message.includes('already consumed its Phil identity nullifier');
  }
  if (!sameHumanRejected) {
    throw new Error(`Expected ${mockHumanA} to be rejected on second use`);
  }
  if (log) {
    console.log(`Confirmed ${mockHumanA} cannot mint twice`);
  }

  const second = await runMintFlow({
    wallet: walletB,
    mockHumanId: mockHumanB,
    philId: 1,
    paletteVariant: 2,
    provider,
    serverUrl,
    proverUrl,
    deployments,
    deployments4337,
  });
  if (log) {
    console.log(`Minted ${mockHumanB} to ${second.smartAccount} as token ${second.tokenId}`);
  }

  return {
    rpcUrl,
    serverUrl,
    proverUrl,
    mockHumanA,
    mockHumanB,
    walletA: walletA.address,
    walletB: walletB.address,
    first,
    second,
  };
}

async function main() {
  const args = parseArgs(process.argv);
  const summary = await runMockHumanityFlow({
    rpcUrl: args.rpc || process.env.RPC_URL || DEFAULT_RPC_URL,
    serverUrl: args.server || process.env.SERVER_URL || DEFAULT_SERVER_URL,
    proverUrl: args.prover || process.env.PROVER_URL || DEFAULT_PROVER_URL,
    mockHumanA: args.mockHumanA || 'atlas',
    mockHumanB: args.mockHumanB || 'briar',
    walletAIndex: Number(args.walletA || 1),
    walletBIndex: Number(args.walletB || 2),
    log: !args.json,
  });
  if (args.json) {
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error.stack || error.message || String(error));
    process.exit(1);
  });
}
