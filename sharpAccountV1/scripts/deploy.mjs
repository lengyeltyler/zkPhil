import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ethers } from 'ethers';

import { buildSharpProgram } from './build.mjs';
import { compileSharpContracts, writeSharpArtifacts } from './compile.mjs';
import {
  DEPLOYMENT_JSON,
  SHARP_ROOT,
  computeSecondFactorCommitment,
  ensureDir,
  readProgramHash,
} from './common.mjs';

const DEFAULT_MNEMONIC = 'test test test test test test test test test test test junk';

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

function artifactByName(artifacts, name) {
  const artifact = artifacts[name];
  if (!artifact) {
    throw new Error(`Missing compiled artifact: ${name}`);
  }
  return artifact;
}

async function deployContract(signer, artifact, args = []) {
  const factory = new ethers.ContractFactory(artifact.abi, artifact.bytecode, signer);
  const deployed = await factory.deploy(...args);
  await deployed.waitForDeployment();
  return deployed;
}

function walletFromConfig(provider, args) {
  if (args.privateKey || process.env.PRIVATE_KEY) {
    const privateKey = args.privateKey ?? process.env.PRIVATE_KEY;
    return new ethers.Wallet(privateKey, provider);
  }

  const mnemonic = args.mnemonic ?? process.env.MNEMONIC ?? DEFAULT_MNEMONIC;
  const index = Number(args.index ?? process.env.ACCOUNT_INDEX ?? 0);
  return ethers.HDNodeWallet.fromPhrase(mnemonic, undefined, `m/44'/60'/0'/0/${index}`).connect(provider);
}

export async function deploySharpStack({
  signer,
  owner,
  secondFactorSecret,
  writeOutput = true,
  outputFile = DEPLOYMENT_JSON,
}) {
  if (!signer.provider) {
    throw new Error('Signer must be connected to a provider');
  }

  const deploySigner = new ethers.NonceManager(signer);
  const artifacts = compileSharpContracts();
  const chainId = BigInt((await signer.provider.getNetwork()).chainId);
  const deployer = await deploySigner.getAddress();
  const ownerAddress = owner ? ethers.getAddress(owner) : deployer;
  const secondFactorCommitment = computeSecondFactorCommitment(secondFactorSecret);

  const registry = await deployContract(
    deploySigner,
    artifactByName(artifacts, 'LocalSharpFactRegistry'),
    [deployer]
  );
  const sharpAccount = await deployContract(
    deploySigner,
    artifactByName(artifacts, 'SharpAccount'),
    [ownerAddress, secondFactorCommitment, await registry.getAddress()]
  );
  const dummyTarget = await deployContract(
    deploySigner,
    artifactByName(artifacts, 'DummyTarget'),
    []
  );

  const deployment = {
    schema: 'sharpAccountV1-deployment-v1',
    generatedAt: new Date().toISOString(),
    chainId: chainId.toString(),
    deployer,
    owner: ownerAddress,
    programHash: readProgramHash(),
    secondFactorCommitment,
    factRegistry: await registry.getAddress(),
    sharpAccount: await sharpAccount.getAddress(),
    dummyTarget: await dummyTarget.getAddress(),
    nonce: '0',
  };

  if (writeOutput) {
    ensureDir(path.dirname(outputFile));
    fs.writeFileSync(outputFile, JSON.stringify(deployment, null, 2));
  }

  return {
    artifacts,
    deployment,
    contracts: {
      factRegistry: registry,
      sharpAccount,
      dummyTarget,
    },
  };
}

export async function runDeployCli(argv = process.argv) {
  const args = parseArgs(argv);
  const rpcUrl = args.rpc ?? process.env.RPC_URL ?? 'http://127.0.0.1:8545';
  const outFile = args.out ? path.resolve(args.out) : DEPLOYMENT_JSON;
  const secondFactorSecret =
    args.secondFactorSecret ??
    process.env.SECOND_FACTOR_SECRET ??
    'sharp-local-2fa-secret';

  if (!args.skipBuild) {
    buildSharpProgram();
  }
  writeSharpArtifacts(path.join(SHARP_ROOT, 'artifacts', 'compiled'));

  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const signer = walletFromConfig(provider, args);

  const owner = args.owner ?? process.env.OWNER_ADDRESS ?? (await signer.getAddress());
  const { deployment } = await deploySharpStack({
    signer,
    owner,
    secondFactorSecret,
    writeOutput: true,
    outputFile: outFile,
  });

  process.stdout.write(`Deployment written: ${outFile}\n`);
  process.stdout.write(`Program hash:       ${deployment.programHash}\n`);
  process.stdout.write(`Fact registry:      ${deployment.factRegistry}\n`);
  process.stdout.write(`Sharp account:      ${deployment.sharpAccount}\n`);
  process.stdout.write(`Dummy target:       ${deployment.dummyTarget}\n`);
  return deployment;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runDeployCli().catch((error) => {
    process.stderr.write(`${error.stack || error.message}\n`);
    process.exit(1);
  });
}
