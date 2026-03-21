import { ethers } from 'ethers';

import { withRpcRetry } from '../../shared/deploy/rpcRetry.mjs';

const DEFAULT_TIMEOUT_MS = Number(process.env.TX_TIMEOUT_MS || '180000');

function getExplorerBase(chainId) {
  switch (Number(chainId || 0)) {
    case 1:
      return 'https://etherscan.io';
    case 11155111:
      return 'https://sepolia.etherscan.io';
    case 17000:
      return 'https://holesky.etherscan.io';
    default:
      return '';
  }
}

export function getTxUrl(chainId, txHash) {
  const base = getExplorerBase(chainId);
  return base ? `${base}/tx/${txHash}` : '';
}

export function getAddressUrl(chainId, address) {
  const base = getExplorerBase(chainId);
  return base ? `${base}/address/${ethers.getAddress(address)}` : '';
}

export function logTx(label, txHash, chainId = Number(process.env.CHAIN_ID || '0')) {
  console.log(`[tx] ${label}`);
  console.log(`  hash: ${txHash}`);
  const url = getTxUrl(chainId, txHash);
  if (url) {
    console.log(`  explorer: ${url}`);
  }
}

export async function waitForReceiptWithTimeout(
  provider,
  txHash,
  timeoutMs = DEFAULT_TIMEOUT_MS
) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    const receipt = await withRpcRetry(
      `getTransactionReceipt(${txHash})`,
      () => provider.getTransactionReceipt(txHash)
    );
    if (!receipt) {
      await new Promise((resolve) => setTimeout(resolve, 3_000));
      continue;
    }

    if (receipt.status !== 1n && receipt.status !== 1) {
      throw new Error(`Transaction reverted on-chain: ${txHash}`);
    }

    return receipt;
  }

  throw new Error(
    `Timed out after ${timeoutMs}ms waiting for transaction receipt: ${txHash}`
  );
}
