import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import {
  ACTION_ACCOUNT_CREATE,
  ACTION_MINT,
  buildProofPayload,
  prepareScarbInput,
  HUMANITY_PROVIDER_LOCAL_CREDENTIAL,
} from '../../shared/proof/localStarkProver.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, '..', '..');
const DEFAULT_MANIFEST_PATH = path.join(ROOT_DIR, 'cairo', 'Scarb.toml');

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

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function ensureDir(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function relOrAbsPath(filePath) {
  return path.isAbsolute(filePath) ? filePath : path.join(ROOT_DIR, filePath);
}

function resolveRequestSecret(input) {
  const secret = input.humanitySecret ?? input.credentialSecret ?? input.secret;
  if (secret == null) {
    throw new Error('proving request is missing humanitySecret/credentialSecret');
  }
  return BigInt(secret);
}

function resolveRequestWitness(input) {
  const witness = input.commitmentWitness ?? input.witness;
  if (!witness) {
    throw new Error('proving request is missing commitmentWitness');
  }
  return witness;
}

function resolveRequestProviderMode(input) {
  return input.providerMode
    ?? (input.provider === 'mock-humanity' ? 'mock-humanity' : HUMANITY_PROVIDER_LOCAL_CREDENTIAL);
}

function buildScarbArguments(input) {
  const witness = resolveRequestWitness(input);
  const serializedInput = prepareScarbInput({
    secret: resolveRequestSecret(input),
    siblings: witness.siblings.map((value) => BigInt(value)),
    pathIndices: witness.pathIndices.map((value) => Number(value)),
    commitmentRoot: BigInt(witness.commitmentRoot),
    proofContext: BigInt(input.proofContext),
    recipient: BigInt(input.recipient),
    claimHash: input.claimHash,
    claimKind: Number(input.claimKind),
    providerMode: resolveRequestProviderMode(input),
    identitySubject: input.identitySource?.value,
    mockHumanIdHash: input.mockHumanIdHash,
  }).map((value) => BigInt(value).toString());

  return [String(serializedInput.length), ...serializedInput].join(',');
}

function parseProgramOutput(stdout) {
  const start = stdout.indexOf('Program output:');
  if (start === -1) {
    return [];
  }
  const after = stdout.slice(start + 'Program output:'.length);
  const lines = after
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !line.startsWith('Saving output to:') && !line.startsWith('Proving ') && !line.startsWith('Verifying '));
  const values = [];
  for (const line of lines) {
    if (!/^[-]?\d+$/.test(line)) {
      break;
    }
    values.push(BigInt(line));
  }
  return values;
}

function normalizeFeltOutput(value) {
  const fieldPrime = (1n << 251n) + (17n << 192n) + 1n;
  return value < 0n ? value + fieldPrime : value;
}

function parseExecutionDir(stdout) {
  const match = stdout.match(/Saving output to:\s*(.+)$/m);
  return match ? match[1].trim() : null;
}

function findProofFile(executionDir) {
  const proofDir = path.join(executionDir, 'proof');
  if (!fs.existsSync(proofDir)) {
    return null;
  }
  const files = fs.readdirSync(proofDir)
    .filter((entry) => entry !== 'CACHEDIR.TAG')
    .map((entry) => path.join(proofDir, entry));
  return files[0] || null;
}

async function runCommand(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd || ROOT_DIR,
      env: options.env || process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`${command} ${args.join(' ')} failed (${code})\n${stdout}\n${stderr}`));
        return;
      }
      resolve({ stdout, stderr });
    });
  });
}

export async function generateLocalProofArtifact(options) {
  const manifestPath = relOrAbsPath(options.manifestPath || DEFAULT_MANIFEST_PATH);
  const request = typeof options.request === 'string'
    ? readJson(relOrAbsPath(options.request))
    : options.request;

  const scarbArgs = buildScarbArguments(request);
  const proofPayload = buildProofPayload({
    programHash: request.programHash,
    proofContext: BigInt(request.proofContext),
    recipient: request.recipient,
    claimHash: request.claimHash,
    claimKind: Number(request.claimKind),
    verifierConfigHash: BigInt(request.verifierConfigHash),
    secret: resolveRequestSecret(request),
    expiry: BigInt(request.expiry),
    providerMode: resolveRequestProviderMode(request),
    identitySubject: request.identitySource?.value,
    mockHumanIdHash: request.mockHumanIdHash,
  });

  const shouldProve = Boolean(options.prove);
  const baseArgs = ['--manifest-path', manifestPath];
  const runArgs = shouldProve
    ? [...baseArgs, 'prove', '--execute', '--print-program-output', '--arguments', scarbArgs]
    : [...baseArgs, 'execute', '--print-program-output', '--arguments', scarbArgs];

  const { stdout } = await runCommand('scarb', runArgs, {
    cwd: path.dirname(manifestPath),
  });

  const executionDir = parseExecutionDir(stdout);
  if (!executionDir) {
    throw new Error(`Unable to determine Scarb execution directory from output:\n${stdout}`);
  }

  const outputValues = parseProgramOutput(stdout).map(normalizeFeltOutput);
  if (outputValues.length > 0) {
    const expectedOutputs = proofPayload.outputs;
    const expectedSerializedLength = expectedOutputs.length + 1;
    const relevantOutputValues = outputValues.length > expectedSerializedLength
      ? outputValues.slice(-expectedSerializedLength)
      : outputValues;
    const [, ...publicOutputs] = relevantOutputValues;
    if (publicOutputs.length !== expectedOutputs.length) {
      throw new Error(`Unexpected Cairo output length ${publicOutputs.length}, expected ${expectedOutputs.length}`);
    }
    for (let i = 0; i < publicOutputs.length; i += 1) {
      if (publicOutputs[i] !== expectedOutputs[i]) {
        throw new Error(`Cairo output mismatch at index ${i}: ${publicOutputs[i]} != ${expectedOutputs[i]}`);
      }
    }
  }

  let proofFile = shouldProve ? findProofFile(executionDir) : null;
  if (proofFile && options.verify) {
    await runCommand('scarb', [
      '--manifest-path',
      manifestPath,
      'verify',
      '--proof-file',
      proofFile,
    ], {
      cwd: path.dirname(manifestPath),
    });
  }

  const artifact = {
    schema: 'zkphil-stwo-proof-artifact-v3',
    provider: request.provider,
    providerMode: resolveRequestProviderMode(request),
    generatedAt: new Date().toISOString(),
    kind: request.kind === 'action' ? 'action' : 'mint',
    provingMode: 'scarb-stwo',
    proofStatus: {
      executed: true,
      proved: shouldProve,
      verified: Boolean(options.verify && proofFile),
    },
    request,
    contractProof: {
      expiry: request.expiry,
      factHash: proofPayload.factHash,
      signature: proofPayload.signature,
    },
    publicOutputs: Object.fromEntries(
      Object.entries(proofPayload.publicOutputs).map(([key, value]) => [key, value.toString()])
    ),
    outputs: proofPayload.outputs.map((value) => value.toString()),
    scarb: {
      manifestPath,
      executionDir,
      proverInputPath: path.join(executionDir, 'prover_input.json'),
      proofFile,
      command: `scarb --manifest-path ${manifestPath} ${shouldProve ? 'prove --execute' : 'execute'} --arguments "${scarbArgs}"`,
    },
  };

  if (options.outFile) {
    const outFile = relOrAbsPath(options.outFile);
    ensureDir(outFile);
    fs.writeFileSync(outFile, JSON.stringify(artifact, null, 2));
  }

  return artifact;
}

async function main() {
  const args = parseArgs(process.argv);
  const requestFile = args.request;
  if (!requestFile) {
    throw new Error('Missing required --request <file>');
  }
  const artifact = await generateLocalProofArtifact({
    request: requestFile,
    manifestPath: args.manifest || DEFAULT_MANIFEST_PATH,
    outFile: args.out || path.join(ROOT_DIR, 'artifacts', 'proofs', 'local-proof-artifact.json'),
    prove: args.prove || false,
    verify: args.verify || false,
  });
  process.stdout.write(`${JSON.stringify(artifact, null, 2)}\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`${error.stack || error.message}\n`);
    process.exit(1);
  });
}
