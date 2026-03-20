import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ganache from 'ganache';
import { ethers } from 'ethers';

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TEST_MNEMONIC = 'test test test test test test test test test test test junk';
function readArtifact(name) {
  const artifactPath = path.join(
    ROOT_DIR,
    'artifacts',
    'contracts',
    `${name}.sol`,
    `${name}.json`
  );
  return JSON.parse(fs.readFileSync(artifactPath, 'utf8'));
}

async function deployContract(signer, artifact, args = []) {
  const factory = new ethers.ContractFactory(artifact.abi, artifact.bytecode, signer);
  const contract = await factory.deploy(...args);
  await contract.waitForDeployment();
  return contract;
}

test('PhilPaymaster accepts the current mint calldata shape', async () => {
  const gProvider = ganache.provider({
    chain: { chainId: 31337 },
    wallet: {
      mnemonic: TEST_MNEMONIC,
      totalAccounts: 4,
      defaultBalance: 1000,
    },
    logging: { quiet: true },
  });

  const provider = new ethers.BrowserProvider(gProvider);

  try {
    const deployer = await provider.getSigner(0);
    const recipient = await provider.getSigner(1);
    const sender = await provider.getSigner(2);
    const philIdentityMint = await recipient.getAddress();

    const paymaster = await deployContract(
      deployer,
      readArtifact('PhilPaymaster'),
      [
        await deployer.getAddress(),
        await deployer.getAddress(),
        philIdentityMint,
      ]
    );

    const executeIface = new ethers.Interface([
      'function execute(address target, uint256 value, bytes data)',
    ]);
    const mintIface = new ethers.Interface([
      'function mint(address recipient, address mintTo, uint8 philId, uint8 paletteVariant, uint8 mixMode, uint32 mixSeed, (uint256 expiry, bytes32 factHash, bytes signature) proof)',
    ]);

    const senderAddress = await sender.getAddress();
    const now = Math.floor(Date.now() / 1000);
    const mintData = mintIface.encodeFunctionData('mint', [
      await recipient.getAddress(),
      senderAddress,
      1,
      2,
      0,
      77,
      {
        expiry: BigInt(now + 600),
        factHash: `0x${'11'.repeat(32)}`,
        signature: `0x${'22'.repeat(96)}`,
      },
    ]);

    const userOp = {
      sender: senderAddress,
      nonce: 0n,
      initCode: '0x',
      callData: executeIface.encodeFunctionData('execute', [philIdentityMint, 0n, mintData]),
      accountGasLimits: `0x${'00'.repeat(32)}`,
      preVerificationGas: 1n,
      gasFees: `0x${'00'.repeat(32)}`,
      paymasterAndData: '0x',
      signature: '0x',
    };

    assert.equal(
      await paymaster.sponsorshipCheckReason(userOp),
      0n,
      'paymaster rejected the current mint calldata shape'
    );
  } finally {
    await gProvider.disconnect();
  }
});

test('PhilPaymaster rejects paymasterAndData with trailing bytes', async () => {
  const gProvider = ganache.provider({
    chain: { chainId: 31337 },
    wallet: {
      mnemonic: TEST_MNEMONIC,
      totalAccounts: 4,
      defaultBalance: 1000,
    },
    logging: { quiet: true },
  });

  const provider = new ethers.BrowserProvider(gProvider);

  try {
    const deployer = await provider.getSigner(0);
    const recipient = await provider.getSigner(1);
    const sender = await provider.getSigner(2);
    const philIdentityMint = await recipient.getAddress();

    const paymaster = await deployContract(
      deployer,
      readArtifact('PhilPaymaster'),
      [
        await deployer.getAddress(),
        await deployer.getAddress(),
        philIdentityMint,
      ]
    );

    const executeIface = new ethers.Interface([
      'function execute(address target, uint256 value, bytes data)',
    ]);
    const mintIface = new ethers.Interface([
      'function mint(address recipient, address mintTo, uint8 philId, uint8 paletteVariant, uint8 mixMode, uint32 mixSeed, (uint256 expiry, bytes32 factHash, bytes signature) proof)',
    ]);

    const senderAddress = await sender.getAddress();
    const now = Math.floor(Date.now() / 1000);
    const mintData = mintIface.encodeFunctionData('mint', [
      await recipient.getAddress(),
      senderAddress,
      1,
      2,
      0,
      77,
      {
        expiry: BigInt(now + 600),
        factHash: `0x${'11'.repeat(32)}`,
        signature: `0x${'22'.repeat(96)}`,
      },
    ]);

    const userOp = {
      sender: senderAddress,
      nonce: 0n,
      initCode: '0x',
      callData: executeIface.encodeFunctionData('execute', [philIdentityMint, 0n, mintData]),
      accountGasLimits: `0x${'00'.repeat(32)}`,
      preVerificationGas: 1n,
      gasFees: `0x${'00'.repeat(32)}`,
      paymasterAndData: '0x',
      signature: '0x',
    };

    const validAfter = BigInt(now);
    const validUntil = BigInt(now + 600);
    const hash = await paymaster.getHash(userOp, validUntil, validAfter);
    const verifyingSigner = ethers.HDNodeWallet.fromPhrase(
      TEST_MNEMONIC,
      undefined,
      "m/44'/60'/0'/0/0"
    ).connect(provider);
    const signature = await verifyingSigner.signMessage(ethers.getBytes(hash));
    const canonicalPaymasterAndData = ethers.hexlify(
      ethers.concat([
        await paymaster.getAddress(),
        ethers.zeroPadValue(ethers.toBeHex(validUntil), 16),
        ethers.zeroPadValue(ethers.toBeHex(validAfter), 16),
        signature,
      ])
    );

    const [, validationData] = await paymaster.validatePaymasterUserOp(
      {
        ...userOp,
        paymasterAndData: canonicalPaymasterAndData,
      },
      ethers.ZeroHash,
      0n
    );
    assert.equal(
      validationData & 1n,
      0n,
      'canonical paymasterAndData should keep the signature-failure bit clear'
    );

    const paymasterAndData = ethers.hexlify(
      ethers.concat([canonicalPaymasterAndData, '0x00'])
    );

    await assert.rejects(
      paymaster.validatePaymasterUserOp(
        {
          ...userOp,
          paymasterAndData,
        },
        ethers.ZeroHash,
        0n
      ),
      /InvalidPaymasterData|execution reverted/
    );
  } finally {
    await gProvider.disconnect();
  }
});
