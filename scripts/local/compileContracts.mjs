import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import solc from 'solc';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, '..', '..');

const ENTRY_FILES = [
  'contracts/PhilSVGStorage.sol',
  'contracts/PhilLayerRegistry.sol',
  'contracts/PhilNFT.sol',
  'contracts/PhilRenderer.sol',
  'contracts/ProofGateTest13.sol',
  'contracts/PhilTestMint.sol',
  'contracts/Phil369CadenceMint.sol',
  'contracts/PhilWeb3.sol',
  'contracts/PhilMarketplace.sol',
  'contracts/SSTORE2Deployer.sol',
  'contracts/PhilFragments.sol',
  'contracts/PhilPalettes.sol',
  // Smart account stack — needed for account + marketplace smoke tests (Phase 4+)
  'contracts/PhilAccount.sol',
  'contracts/PhilAccountFactory.sol',
  // Test mocks
  'contracts/mocks/MockUnlockInbox.sol',
];

function readUtf8(filePath) {
  return fs.readFileSync(filePath, 'utf8');
}

function findImport(importPath) {
  const candidates = [
    path.join(ROOT_DIR, importPath),
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

export function compilePhilContracts() {
  const output = JSON.parse(solc.compile(JSON.stringify(buildInput()), { import: findImport }));

  if (output.errors?.length) {
    const hardErrors = output.errors.filter((e) => e.severity === 'error');
    if (hardErrors.length > 0) {
      const msg = hardErrors.map((e) => e.formattedMessage).join('\n');
      throw new Error(`solc compile failed:\n${msg}`);
    }
  }

  const contracts = {};
  for (const [sourceName, sourceContracts] of Object.entries(output.contracts)) {
    for (const [contractName, artifact] of Object.entries(sourceContracts)) {
      const bytecode = artifact.evm?.bytecode?.object ?? '';
      if (!bytecode) {
        continue;
      }
      contracts[contractName] = {
        sourceName,
        contractName,
        abi: artifact.abi,
        bytecode: `0x${bytecode}`,
      };
    }
  }

  return contracts;
}

export function writeCompiledArtifacts(outDir = path.join(ROOT_DIR, 'artifacts', 'manual-compile')) {
  const contracts = compilePhilContracts();
  fs.mkdirSync(outDir, { recursive: true });

  for (const [name, artifact] of Object.entries(contracts)) {
    const file = path.join(outDir, `${name}.json`);
    fs.writeFileSync(file, JSON.stringify(artifact, null, 2));
  }

  return contracts;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const outDir = path.join(ROOT_DIR, 'artifacts', 'manual-compile');
  const contracts = writeCompiledArtifacts(outDir);
  const names = Object.keys(contracts).sort();
  process.stdout.write(`Compiled ${names.length} contracts to ${outDir}\\n`);
  for (const name of names) {
    process.stdout.write(` - ${name}\\n`);
  }
}
