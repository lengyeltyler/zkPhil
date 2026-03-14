import test from 'node:test';
import assert from 'node:assert/strict';
import ganache from 'ganache';
import { ethers } from 'ethers';

import { compilePhilContracts } from '../scripts/local/compileContracts.mjs';
import {
  computeActionClaimHash,
  computeClaimHash,
  computeFactHash,
} from '../shared/proof/localStarkProver.mjs';

const PROGRAM_HASH = '0x4444444444444444444444444444444444444444444444444444444444444444';
const DROP_ID = 13n;
const CHAIN_ID = 31337;

function getArtifact(artifacts, name) {
  const artifact = artifacts[name];
  if (!artifact) throw new Error(`missing artifact: ${name}`);
  return artifact;
}

async function deployContract(signer, artifact, args = []) {
  const factory = new ethers.ContractFactory(artifact.abi, artifact.bytecode, signer);
  const contract = await factory.deploy(...args);
  await contract.waitForDeployment();
  return contract;
}

test('proof hash parity (js <-> solidity) for mint + generic action claims', async () => {
  const gProvider = ganache.provider({
    chain: { chainId: CHAIN_ID },
    wallet: {
      mnemonic: 'test test test test test test test test test test test junk',
      totalAccounts: 5,
      defaultBalance: 1000,
    },
    logging: { quiet: true },
  });

  const provider = new ethers.BrowserProvider(gProvider);

  try {
    const deployer = await provider.getSigner(0);
    const alice = await provider.getSigner(1);
    const bob = await provider.getSigner(2);

    const deployerAddr = await deployer.getAddress();
    const aliceAddr = await alice.getAddress();
    const bobAddr = await bob.getAddress();

    const artifacts = compilePhilContracts();
    const gate = await deployContract(deployer, getArtifact(artifacts, 'ProofGateTest13'), [
      PROGRAM_HASH,
      DROP_ID,
      deployerAddr,
    ]);
    const gateAddress = await gate.getAddress();

    const mintClaimJs = computeClaimHash({
      programHash: PROGRAM_HASH,
      dropId: DROP_ID,
      chainId: CHAIN_ID,
      proofGateAddress: gateAddress,
      recipient: aliceAddr,
      mintTo: bobAddr,
      philId: 2,
      paletteVariant: 4,
      mixMode: 1,
      mixSeed: 777,
      expiry: 123456,
    });
    const mintClaimSol = await gate.computeClaimHash(
      aliceAddr,
      bobAddr,
      2,
      4,
      1,
      777,
      123456
    );
    assert.equal(mintClaimJs, mintClaimSol, 'mint claim hash mismatch');

    const createActionHash = ethers.keccak256(
      ethers.AbiCoder.defaultAbiCoder().encode(
        ['address', 'address', 'uint256'],
        [gateAddress, aliceAddr, 0xdeadbeefn]
      )
    );

    const actionClaimJs = computeActionClaimHash({
      programHash: PROGRAM_HASH,
      dropId: DROP_ID,
      chainId: CHAIN_ID,
      proofGateAddress: gateAddress,
      recipient: aliceAddr,
      actionType: 2,
      actionHash: createActionHash,
      expiry: 999,
    });
    const actionClaimSol = await gate.computeActionClaimHash(
      aliceAddr,
      2,
      createActionHash,
      999
    );
    assert.equal(actionClaimJs, actionClaimSol, 'action claim hash mismatch');

    const mintFactJs = computeFactHash({ claimHash: mintClaimJs });
    const mintFactSol = await gate.computeExpectedFactHash(mintClaimSol);
    assert.equal(mintFactJs, mintFactSol, 'mint fact hash mismatch');

    const actionFactJs = computeFactHash({ claimHash: actionClaimJs });
    const actionFactSol = await gate.computeExpectedFactHash(actionClaimSol);
    assert.equal(actionFactJs, actionFactSol, 'action fact hash mismatch');
  } finally {
    await gProvider.disconnect();
  }
});
