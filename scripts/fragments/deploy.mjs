#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ethers } from 'ethers';

import { buildOnchainRendererAssets } from '../../shared/phil-renderer/renderPhil.mjs';
import { compilePhilContracts } from '../local/compileContracts.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, '..', '..');
const OUT_DIR = path.join(ROOT_DIR, 'artifacts', 'fragments');

const DEFAULT_RPC_URL = process.env.RPC_URL || 'http://127.0.0.1:8545';
const DEFAULT_PRIVATE_KEY = process.env.PRIVATE_KEY ||
  '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
const CHUNK_SIZE = 24_000;

function getArtifact(artifacts, name) {
  const artifact = artifacts[name];
  if (!artifact) {
    throw new Error(`Missing compiled artifact: ${name}`);
  }
  return artifact;
}

async function deployContract(wallet, artifact, args = []) {
  const factory = new ethers.ContractFactory(artifact.abi, artifact.bytecode, wallet);
  const contract = await factory.deploy(...args);
  await contract.waitForDeployment();
  return contract;
}

function chunkBytes(bytes, chunkSize = CHUNK_SIZE) {
  const out = [];
  for (let start = 0; start < bytes.length; start += chunkSize) {
    out.push(bytes.slice(start, Math.min(start + chunkSize, bytes.length)));
  }
  return out;
}

async function writeSstore2Chunks(sstore2, payloads) {
  const pointers = [];
  const offsets = [0];

  for (const payload of payloads) {
    const chunks = chunkBytes(payload);
    for (const chunk of chunks) {
      const pointer = await sstore2.write.staticCall(chunk);
      const tx = await sstore2.write(chunk);
      await tx.wait();
      pointers.push(pointer);
    }
    offsets.push(pointers.length);
  }

  return { pointers, offsets };
}

async function writeSstore2Blobs(sstore2, payloads) {
  const pointers = [];
  for (const payload of payloads) {
    const pointer = await sstore2.write.staticCall(payload);
    const tx = await sstore2.write(payload);
    await tx.wait();
    pointers.push(pointer);
  }
  return pointers;
}

async function main() {
  const provider = new ethers.JsonRpcProvider(DEFAULT_RPC_URL);
  const wallet = new ethers.Wallet(DEFAULT_PRIVATE_KEY, provider);
  const chain = await provider.getNetwork();
  const chainId = Number(chain.chainId);

  const artifacts = compilePhilContracts();
  const assets = buildOnchainRendererAssets();

  const sstore2 = await deployContract(wallet, getArtifact(artifacts, 'SSTORE2Deployer'));

  const { pointers: fragmentChunkPointers, offsets: fragmentOffsets } =
    await writeSstore2Chunks(sstore2, assets.flattenedFragmentPayloads);

  const palettePointers = await writeSstore2Blobs(sstore2, assets.palettePackedByPhil);

  const fragments = await deployContract(wallet, getArtifact(artifacts, 'PhilFragments'), [
    fragmentChunkPointers,
    fragmentOffsets,
    assets.flattenedDslFlags,
  ]);

  const palettes = await deployContract(wallet, getArtifact(artifacts, 'PhilPalettes'), [
    palettePointers,
    assets.paletteSlotCounts,
  ]);

  const renderer = await deployContract(wallet, getArtifact(artifacts, 'PhilRenderer'), [
    await fragments.getAddress(),
    await palettes.getAddress(),
    ethers.ZeroAddress,
  ]);

  const web3 = await deployContract(wallet, getArtifact(artifacts, 'PhilWeb3'), [
    await renderer.getAddress(),
  ]);

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const outFile = path.join(OUT_DIR, `deploy_${chainId}.json`);
  fs.writeFileSync(outFile, JSON.stringify({
    chainId,
    rpcUrl: DEFAULT_RPC_URL,
    deployer: wallet.address,
    SSTORE2Deployer: await sstore2.getAddress(),
    PhilFragments: await fragments.getAddress(),
    PhilPalettes: await palettes.getAddress(),
    PhilRenderer: await renderer.getAddress(),
    PhilWeb3: await web3.getAddress(),
    fragmentChunkPointers,
    fragmentOffsets,
    fragmentDslFlags: assets.flattenedDslFlags,
    palettePointers,
    paletteSlotCounts: assets.paletteSlotCounts,
    rendererAssetBytes: {
      fragmentsRaw: assets.stats.totalRawFragmentBytes,
      fragmentsEncoded: assets.stats.totalEncodedFragmentBytes,
      palettes: assets.stats.paletteBytes,
      total: assets.stats.totalEncodedFragmentBytes + assets.stats.paletteBytes,
      dslFragments: assets.stats.dslFragmentCount,
    },
  }, null, 2));

  console.log('Fragments deployed.');
  console.log(`  output: ${outFile}`);
  console.log(`  renderer: ${await renderer.getAddress()}`);
  console.log(`  web3 gateway: ${await web3.getAddress()}`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
