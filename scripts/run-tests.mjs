import "dotenv/config";

import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";

import { REPO_ROOT } from "../src/workspace.mjs";

const TEST_RPC_URL = "http://127.0.0.1:8545";
const TEST_FILES = [
  path.join("test", "svg-storage.test.mjs"),
  path.join("test", "layer-registry.test.mjs"),
  path.join("test", "body-base.test.mjs"),
  path.join("test", "phil-nft.test.mjs")
];

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function waitForRpc(url, timeoutMs, nodeProcess) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    if (nodeProcess.exitCode !== null) {
      throw new Error(`Hardhat node exited early with code ${nodeProcess.exitCode}`);
    }

    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "eth_chainId",
          params: []
        })
      });
      const payload = await response.json();
      if (payload.result) {
        return;
      }
    } catch (error) {
      await delay(500);
    }
  }

  throw new Error(`Timed out waiting for ${url}`);
}

function killProcess(processHandle) {
  if (processHandle.exitCode === null) {
    processHandle.kill("SIGTERM");
  }
}

const hardhatNode = spawn("npx", ["hardhat", "node"], {
  cwd: REPO_ROOT,
  env: process.env,
  stdio: ["ignore", "pipe", "pipe"]
});

let hardhatLogs = "";
hardhatNode.stdout.on("data", (chunk) => {
  hardhatLogs += chunk.toString();
  if (hardhatLogs.length > 12000) {
    hardhatLogs = hardhatLogs.slice(-12000);
  }
});
hardhatNode.stderr.on("data", (chunk) => {
  hardhatLogs += chunk.toString();
  if (hardhatLogs.length > 12000) {
    hardhatLogs = hardhatLogs.slice(-12000);
  }
});

try {
  await waitForRpc(TEST_RPC_URL, 20_000, hardhatNode);

  const child = spawn(process.execPath, ["--test", ...TEST_FILES], {
    cwd: REPO_ROOT,
    env: {
      ...process.env,
      TEST_RPC_URL
    },
    stdio: "inherit"
  });

  const exitCode = await new Promise((resolve, reject) => {
    child.on("exit", resolve);
    child.on("error", reject);
  });

  if (exitCode !== 0) {
    process.exitCode = exitCode || 1;
  }
} catch (error) {
  console.error(error.message);
  if (hardhatLogs) {
    console.error(hardhatLogs);
  }
  process.exitCode = 1;
} finally {
  killProcess(hardhatNode);
}
