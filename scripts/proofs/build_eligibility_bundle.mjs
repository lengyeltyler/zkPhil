import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildEligibilityBundle } from '../../shared/proof/eligibilityBundle.mjs';

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

function normalizeInputEntries(rawEntries, credentialsPerAddress) {
  const entries = [];
  for (const rawEntry of rawEntries) {
    if (typeof rawEntry === 'string') {
      for (let credentialSlot = 0; credentialSlot < credentialsPerAddress; credentialSlot += 1) {
        entries.push({ recipient: rawEntry, credentialSlot });
      }
      continue;
    }

    const recipient = rawEntry.recipient || rawEntry.address;
    const count = Number(rawEntry.credentials ?? rawEntry.count ?? credentialsPerAddress);
    for (let credentialSlot = 0; credentialSlot < count; credentialSlot += 1) {
      entries.push({
        recipient,
        credentialSlot:
          rawEntry.credentialSlot != null
            ? Number(rawEntry.credentialSlot) + credentialSlot
            : credentialSlot,
        secret: rawEntry.secret,
      });
    }
  }
  return entries;
}

async function main() {
  const args = parseArgs(process.argv);
  const inFile = args.in;
  if (!inFile) {
    throw new Error('Missing required --in <eligibility.json>');
  }

  const parsed = JSON.parse(fs.readFileSync(path.resolve(inFile), 'utf8'));
  const rawEntries = Array.isArray(parsed) ? parsed : (parsed.entries || []);
  const credentialsPerAddress = Number(args.credentials || parsed.credentialsPerAddress || 1);
  const contextId = BigInt(args.contextId || parsed.contextId || 13n);
  const seed = args.seed || parsed.seed || 'zkphil-local-eligibility';
  const outFile = path.resolve(
    args.out || path.join(ROOT_DIR, 'artifacts', 'proofs', 'eligibility-bundle.json')
  );

  const bundle = buildEligibilityBundle({
    contextId,
    entries: normalizeInputEntries(rawEntries, credentialsPerAddress),
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
