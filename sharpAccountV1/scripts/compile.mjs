import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import solc from 'solc';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, '..', '..');
const SHARP_DIR = path.resolve(__dirname, '..');

const ENTRY_FILES = [
  'sharpAccountV1/contracts/ISharpFactRegistry.sol',
  'sharpAccountV1/contracts/LocalSharpFactRegistry.sol',
  'sharpAccountV1/contracts/SharpAccount.sol',
  'sharpAccountV1/contracts/DummyTarget.sol',
];

function readUtf8(filePath) {
  return fs.readFileSync(filePath, 'utf8');
}

function findImport(importPath) {
  const candidates = [
    path.join(ROOT_DIR, importPath),
    path.join(SHARP_DIR, 'contracts', importPath),
    path.join(ROOT_DIR, 'contracts', importPath),
    path.join(ROOT_DIR, 'node_modules', importPath),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
      return { contents: readUtf8(candidate) };
    }
  }
  return { error: `File not found: ${importPath}` };
}

function buildInput() {
  const sources = {};
  for (const entry of ENTRY_FILES) {
    sources[entry] = { content: readUtf8(path.join(ROOT_DIR, entry)) };
  }

  return {
    language: 'Solidity',
    sources,
    settings: {
      evmVersion: 'paris',
      optimizer: {
        enabled: true,
        runs: 200,
      },
      viaIR: true,
      outputSelection: {
        '*': {
          '*': ['abi', 'evm.bytecode.object'],
        },
      },
    },
  };
}

export function compileSharpContracts() {
  const output = JSON.parse(solc.compile(JSON.stringify(buildInput()), { import: findImport }));
  if (output.errors?.length) {
    const hardErrors = output.errors.filter((e) => e.severity === 'error');
    if (hardErrors.length > 0) {
      throw new Error(hardErrors.map((e) => e.formattedMessage).join('\n'));
    }
  }

  const artifacts = {};
  for (const [sourceName, sourceContracts] of Object.entries(output.contracts)) {
    for (const [contractName, artifact] of Object.entries(sourceContracts)) {
      const bytecode = artifact.evm?.bytecode?.object ?? '';
      if (!bytecode) continue;
      artifacts[contractName] = {
        sourceName,
        contractName,
        abi: artifact.abi,
        bytecode: `0x${bytecode}`,
      };
    }
  }
  return artifacts;
}

export function writeSharpArtifacts(outDir = path.join(SHARP_DIR, 'artifacts', 'compiled')) {
  fs.mkdirSync(outDir, { recursive: true });
  const artifacts = compileSharpContracts();
  for (const [name, artifact] of Object.entries(artifacts)) {
    fs.writeFileSync(path.join(outDir, `${name}.json`), JSON.stringify(artifact, null, 2));
  }
  return artifacts;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const outDir = path.join(SHARP_DIR, 'artifacts', 'compiled');
  const artifacts = writeSharpArtifacts(outDir);
  console.log(`Compiled ${Object.keys(artifacts).length} contracts to ${outDir}`);
}

