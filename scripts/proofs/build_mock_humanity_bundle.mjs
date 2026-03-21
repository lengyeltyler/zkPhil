import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildMockHumanityBundle } from '../../shared/proof/mockHumanityBundle.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, '..', '..');

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

function normalizeInputHumans(rawHumans) {
  return rawHumans.map((entry, index) => {
    if (typeof entry === 'string') {
      return {
        mockHumanId: entry,
        label: entry,
      };
    }

    return {
      mockHumanId: entry.mockHumanId || entry.id || `human-${index}`,
      label: entry.label || entry.mockHumanId || entry.id || `Human ${index + 1}`,
      secret: entry.secret,
      seed: entry.seed,
    };
  });
}

async function main() {
  const args = parseArgs(process.argv);
  const inFile = args.in;
  if (!inFile) {
    throw new Error('Missing required --in <mock-humans.json>');
  }

  const parsed = JSON.parse(fs.readFileSync(path.resolve(inFile), 'utf8'));
  const rawHumans = Array.isArray(parsed) ? parsed : (parsed.humans || parsed.entries || []);
  const proofContext = BigInt(args.proofContext || args.contextId || parsed.proofContext || parsed.contextId || 13n);
  const seed = args.seed || parsed.seed || 'zkphil-mock-humanity';
  const outFile = path.resolve(
    args.out || path.join(ROOT_DIR, 'generated', 'proofs', 'mock-humanity-bundle.json')
  );

  const bundle = buildMockHumanityBundle({
    proofContext,
    humans: normalizeInputHumans(rawHumans),
    seed,
  });

  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, JSON.stringify(bundle, null, 2));
  process.stdout.write(`${JSON.stringify(bundle, null, 2)}\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`${error.stack || error.message}\n`);
    process.exit(1);
  });
}
