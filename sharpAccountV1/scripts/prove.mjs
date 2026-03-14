import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ethers } from 'ethers';

import {
  DEPLOYMENT_JSON,
  PROOF_JSON,
  computeCallDataHash,
  computeFactHash,
  computeIntentHash,
  computeSecondFactorCommitment,
  ensureDir,
  readProgramHash,
} from './common.mjs';

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

function asBigInt(value, name) {
  if (value === undefined || value === null || value === '') {
    throw new Error(`Missing required numeric argument: ${name}`);
  }
  return BigInt(value);
}

function asAddress(value, name) {
  if (!value) throw new Error(`Missing required address argument: ${name}`);
  return ethers.getAddress(value);
}

function asHexData(value, name) {
  if (!value) throw new Error(`Missing required calldata argument: ${name}`);
  return ethers.hexlify(value);
}

function loadDeployment(filePath) {
  if (!fs.existsSync(filePath)) return null;
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

export function generateSharpProofArtifact({
  wallet,
  smartAccount,
  target,
  callData,
  value,
  nonce,
  chainId,
  secondFactorSecret,
  outFile = PROOF_JSON,
}) {
  const programHash = readProgramHash();
  const normalizedWallet = asAddress(wallet, 'wallet');
  const normalizedSmartAccount = asAddress(smartAccount, 'smartAccount');
  const normalizedTarget = asAddress(target, 'target');
  const normalizedCallData = asHexData(callData, 'callData');
  const numericValue = BigInt(value);
  const numericNonce = BigInt(nonce);
  const numericChainId = BigInt(chainId);

  const secondFactorCommitment = computeSecondFactorCommitment(secondFactorSecret);
  const callDataHash = computeCallDataHash(normalizedCallData);
  const intentHash = computeIntentHash({
    wallet: normalizedWallet,
    smartAccount: normalizedSmartAccount,
    target: normalizedTarget,
    callDataHash,
    value: numericValue,
    nonce: numericNonce,
    chainId: numericChainId,
    secondFactorCommitment,
  });
  const factHash = computeFactHash(programHash, intentHash);

  const proofDigest = ethers.keccak256(
    ethers.AbiCoder.defaultAbiCoder().encode(
      ['bytes32', 'bytes32', 'bytes32'],
      [programHash, secondFactorCommitment, intentHash]
    )
  );

  const artifact = {
    schema: 'sharpAccountV1-proof-v1',
    generatedAt: new Date().toISOString(),
    programHash,
    publicInputs: {
      wallet: normalizedWallet,
      smartAccount: normalizedSmartAccount,
      target: normalizedTarget,
      callData: normalizedCallData,
      callDataHash,
      value: numericValue.toString(),
      nonce: numericNonce.toString(),
      chainId: numericChainId.toString(),
      secondFactorCommitment,
      intentHash,
    },
    sharp: {
      factHash,
      factComputation: 'keccak256(abi.encode(PROGRAM_HASH, intentHash))',
      proofDigest,
    },
  };

  if (outFile) {
    ensureDir(path.dirname(outFile));
    fs.writeFileSync(outFile, JSON.stringify(artifact, null, 2));
  }

  return artifact;
}

function buildSampleCallData(sampleNumber) {
  const dummy = new ethers.Interface(['function setNumber(uint256 value_)']);
  return dummy.encodeFunctionData('setNumber', [sampleNumber]);
}

export async function runProveCli(argv = process.argv) {
  const args = parseArgs(argv);
  const deploymentFile = args.deployment
    ? path.resolve(args.deployment)
    : DEPLOYMENT_JSON;
  const deployment = loadDeployment(deploymentFile);

  const secondFactorSecret =
    args.secondFactorSecret ??
    process.env.SECOND_FACTOR_SECRET ??
    'sharp-local-2fa-secret';

  const sampleMode = Boolean(args.sample);
  const outFile = args.out ? path.resolve(args.out) : PROOF_JSON;
  const sampleDefaults = {
    wallet: '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266',
    smartAccount: '0x1000000000000000000000000000000000000001',
    target: '0x2000000000000000000000000000000000000002',
    chainId: '31337',
  };

  const wallet =
    args.wallet ??
    deployment?.owner ??
    (sampleMode ? sampleDefaults.wallet : undefined);
  const smartAccount =
    args.smartAccount ??
    deployment?.sharpAccount ??
    (sampleMode ? sampleDefaults.smartAccount : undefined);
  const target =
    args.target ??
    deployment?.dummyTarget ??
    (sampleMode ? sampleDefaults.target : undefined);
  const callData = args.callData ?? (sampleMode ? buildSampleCallData(BigInt(args.sampleNumber ?? 1337)) : null);
  const value = args.value ?? '0';
  const nonce = args.nonce ?? deployment?.nonce ?? '0';
  const chainId =
    args.chainId ??
    deployment?.chainId ??
    process.env.CHAIN_ID ??
    (sampleMode ? sampleDefaults.chainId : undefined);

  if (!wallet || !smartAccount || !target || !callData || chainId === undefined) {
    throw new Error(
      'Missing proof inputs. Provide --wallet --smartAccount --target --callData --chainId, or use --sample after deploy.'
    );
  }

  const artifact = generateSharpProofArtifact({
    wallet: asAddress(wallet, 'wallet'),
    smartAccount: asAddress(smartAccount, 'smartAccount'),
    target: asAddress(target, 'target'),
    callData: asHexData(callData, 'callData'),
    value: asBigInt(value, 'value'),
    nonce: asBigInt(nonce, 'nonce'),
    chainId: asBigInt(chainId, 'chainId'),
    secondFactorSecret,
    outFile,
  });

  process.stdout.write(`Proof artifact written: ${outFile}\n`);
  process.stdout.write(`intentHash: ${artifact.publicInputs.intentHash}\n`);
  process.stdout.write(`factHash:   ${artifact.sharp.factHash}\n`);
  return artifact;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runProveCli().catch((error) => {
    process.stderr.write(`${error.stack || error.message}\n`);
    process.exit(1);
  });
}
