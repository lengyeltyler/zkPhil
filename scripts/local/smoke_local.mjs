import fs from 'node:fs';
import path from 'node:path';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

import { ethers } from 'ethers';

import { readDeployment, runMockHumanityFlow } from './mock_humanity_flow.mjs';

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, '..', '..');
const STATE_DIR = path.join(ROOT_DIR, '.local-dev');
const SUMMARY_PATH = path.join(STATE_DIR, 'smoke-local-summary.json');
const DEFAULT_RPC_URL = 'http://127.0.0.1:8545';
const DEFAULT_SERVER_URL = 'http://127.0.0.1:8787';
const DEFAULT_PROVER_URL = 'http://127.0.0.1:8747';
const DEFAULT_MINT_TTL_SECONDS = '1800';

function parseArgs(argv) {
  const args = {};
  for (let index = 2; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith('--')) {
      args[key] = true;
    } else {
      args[key] = next;
      index += 1;
    }
  }
  return args;
}

function ensureStateDir() {
  fs.mkdirSync(STATE_DIR, { recursive: true });
}

function writeSummary(summary) {
  ensureStateDir();
  fs.writeFileSync(SUMMARY_PATH, `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
}

async function runLoggedCommand(label, file, args, options = {}) {
  console.log(`\n[smoke] ${label}`);
  await new Promise((resolve, reject) => {
    const child = spawn(file, args, {
      cwd: ROOT_DIR,
      env: {
        ...process.env,
        ...options.env,
      },
      stdio: 'inherit',
    });
    child.on('error', reject);
    child.on('exit', (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(
        new Error(
          `${label} failed with ${signal ? `signal ${signal}` : `exit code ${code}`}.`
        )
      );
    });
  });
}

async function readStackStatus() {
  const { stdout } = await execFileAsync(
    process.execPath,
    ['scripts/local/stack_status.mjs', '--json'],
    {
      cwd: ROOT_DIR,
      maxBuffer: 1024 * 1024 * 4,
    }
  );
  return JSON.parse(stdout);
}

function assertReady(status) {
  const failures = [];
  if (!status.rpc?.healthy) failures.push(`rpc: ${status.rpc?.error || 'unhealthy'}`);
  if (!status.artBackend?.ready) failures.push(`artBackend: ${(status.artBackend?.missing || []).join(', ')}`);
  if (!status.starkCore?.ready) failures.push(`starkCore: ${(status.starkCore?.missing || []).join(', ')}`);
  if (!status.aa4337?.ready) failures.push(`aa4337: ${(status.aa4337?.missing || []).join(', ')}`);
  if (!status.services?.backend?.healthy) failures.push(`backend: ${status.services?.backend?.error || 'unhealthy'}`);
  if (!status.services?.prover?.healthy) failures.push(`prover: ${status.services?.prover?.error || 'unhealthy'}`);
  if (failures.length > 0) {
    throw new Error(`Local stack is not ready: ${failures.join('; ')}`);
  }
}

async function readMintState(rpcUrl) {
  const provider = new ethers.JsonRpcProvider(rpcUrl, undefined, { batchMaxCount: 1 });
  const starkDeployment = readDeployment('stark_31337.json');
  const mint = new ethers.Contract(
    starkDeployment.PhilIdentityMint,
    [
      'function totalSupply() view returns (uint256)',
      'function ownerOf(uint256 tokenId) view returns (address)',
    ],
    provider
  );
  const totalSupply = Number(await mint.totalSupply());
  const owners = [];
  for (let tokenId = 0; tokenId < totalSupply; tokenId += 1) {
    owners.push(await mint.ownerOf(tokenId));
  }
  return {
    totalSupply,
    owners,
  };
}

async function main() {
  const args = parseArgs(process.argv);
  const rpcUrl = String(args.rpc || process.env.RPC_URL || DEFAULT_RPC_URL).trim();
  const serverUrl = String(args.server || process.env.SERVER_URL || DEFAULT_SERVER_URL).trim();
  const proverUrl = String(args.prover || process.env.PROVER_URL || DEFAULT_PROVER_URL).trim();
  const fresh = args.fresh !== false && !args['no-fresh'];
  const keepUp = Boolean(args['keep-up']);
  const mockHumanA = String(args.mockHumanA || 'atlas');
  const mockHumanB = String(args.mockHumanB || 'briar');
  const walletAIndex = Number(args.walletA || 1);
  const walletBIndex = Number(args.walletB || 2);
  const mintTtlSeconds = String(args.mintTtlSeconds || process.env.MINT_TTL_SECONDS || DEFAULT_MINT_TTL_SECONDS);

  const summary = {
    schema: 'zkphil-local-smoke-v1',
    startedAt: new Date().toISOString(),
    passed: false,
    command: 'smoke:local',
    config: {
      rpcUrl,
      serverUrl,
      proverUrl,
      fresh,
      keepUp,
      mockHumanA,
      mockHumanB,
      walletAIndex,
      walletBIndex,
      mintTtlSeconds,
    },
    steps: [],
    assertions: [],
  };
  writeSummary(summary);

  try {
    await runLoggedCommand(
      `Bringing local stack up${fresh ? ' (fresh)' : ''}`,
      'bash',
      ['scripts/run_local_e2e.sh', 'up', ...(fresh ? ['--fresh'] : [])],
      {
        env: {
          MINT_TTL_SECONDS: mintTtlSeconds,
        },
      }
    );
    summary.steps.push({ step: 'up', ok: true });

    const status = await readStackStatus();
    assertReady(status);
    summary.steps.push({ step: 'status', ok: true });
    summary.status = status;

    const before = await readMintState(rpcUrl);
    summary.before = before;

    const flow = await runMockHumanityFlow({
      rpcUrl,
      serverUrl,
      proverUrl,
      mockHumanA,
      mockHumanB,
      walletAIndex,
      walletBIndex,
      log: true,
    });
    summary.steps.push({ step: 'mock-humanity-flow', ok: true });
    summary.flow = flow;

    const after = await readMintState(rpcUrl);
    summary.after = after;

    const expectedFirstTokenId = String(before.totalSupply);
    const expectedSecondTokenId = String(before.totalSupply + 1);
    const expectedTotalSupply = before.totalSupply + 2;

    if (flow.first.tokenId !== expectedFirstTokenId) {
      throw new Error(`Expected first tokenId ${expectedFirstTokenId}, got ${flow.first.tokenId}`);
    }
    if (flow.second.tokenId !== expectedSecondTokenId) {
      throw new Error(`Expected second tokenId ${expectedSecondTokenId}, got ${flow.second.tokenId}`);
    }
    if (after.totalSupply !== expectedTotalSupply) {
      throw new Error(`Expected totalSupply ${expectedTotalSupply}, got ${after.totalSupply}`);
    }
    if (after.owners[before.totalSupply]?.toLowerCase() !== flow.first.smartAccount.toLowerCase()) {
      throw new Error(
        `Token ${expectedFirstTokenId} owner mismatch: expected ${flow.first.smartAccount}, got ${after.owners[before.totalSupply]}`
      );
    }
    if (after.owners[before.totalSupply + 1]?.toLowerCase() !== flow.second.smartAccount.toLowerCase()) {
      throw new Error(
        `Token ${expectedSecondTokenId} owner mismatch: expected ${flow.second.smartAccount}, got ${after.owners[before.totalSupply + 1]}`
      );
    }

    summary.assertions.push(
      `token ${expectedFirstTokenId} minted to ${flow.first.smartAccount}`,
      `duplicate ${mockHumanA} mint rejected inside flow`,
      `token ${expectedSecondTokenId} minted to ${flow.second.smartAccount}`,
      `totalSupply advanced from ${before.totalSupply} to ${after.totalSupply}`
    );
    summary.passed = true;
    summary.finishedAt = new Date().toISOString();
    writeSummary(summary);

    console.log('\n[smoke] PASS');
    console.log(`  Summary: ${SUMMARY_PATH}`);
    console.log(`  First mint:  ${mockHumanA} -> token ${flow.first.tokenId}`);
    console.log(`  Second mint: ${mockHumanB} -> token ${flow.second.tokenId}`);
    console.log(`  Total supply: ${before.totalSupply} -> ${after.totalSupply}`);
  } catch (error) {
    summary.finishedAt = new Date().toISOString();
    summary.error = error instanceof Error ? error.message : String(error);
    writeSummary(summary);
    console.error('\n[smoke] FAIL');
    console.error(`  Summary: ${SUMMARY_PATH}`);
    console.error(`  Error: ${summary.error}`);
    process.exitCode = 1;
  } finally {
    if (!keepUp) {
      try {
        await runLoggedCommand('Tearing local stack down', 'bash', ['scripts/run_local_e2e.sh', 'down']);
        summary.steps.push({ step: 'down', ok: true });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        summary.steps.push({ step: 'down', ok: false, error: message });
        writeSummary(summary);
        if (!process.exitCode) {
          process.exitCode = 1;
        }
      }
    }
    summary.finishedAt = summary.finishedAt || new Date().toISOString();
    writeSummary(summary);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.stack || error.message : String(error));
    process.exit(1);
  });
}
