import { ethers } from 'ethers';

const SEPOLIA_CHAIN_ID = 11155111;
const DEFAULT_SEPOLIA_MAX_FEE_GWEI = process.env.SEPOLIA_MAX_FEE_GWEI || '2';
const DEFAULT_SEPOLIA_PRIORITY_FEE_GWEI = process.env.SEPOLIA_PRIORITY_FEE_GWEI || '1';

function maxBigInt(a, b) {
  return a > b ? a : b;
}

export async function getRecommendedTxOverrides(provider) {
  const network = await provider.getNetwork();
  if (Number(network.chainId) !== SEPOLIA_CHAIN_ID) {
    return {};
  }

  const feeData = await provider.getFeeData();
  const maxFeeFloor = ethers.parseUnits(DEFAULT_SEPOLIA_MAX_FEE_GWEI, 'gwei');
  const priorityFloor = ethers.parseUnits(DEFAULT_SEPOLIA_PRIORITY_FEE_GWEI, 'gwei');

  const estimatedPriority =
    feeData.maxPriorityFeePerGas || feeData.gasPrice || priorityFloor;
  const maxPriorityFeePerGas = maxBigInt(estimatedPriority, priorityFloor);

  const estimatedMaxFee =
    feeData.maxFeePerGas || feeData.gasPrice || maxFeeFloor;
  const maxFeePerGas = maxBigInt(
    estimatedMaxFee,
    maxBigInt(maxFeeFloor, maxPriorityFeePerGas)
  );

  return {
    maxFeePerGas,
    maxPriorityFeePerGas
  };
}

export async function mergeRecommendedTxOverrides(provider, overrides = {}) {
  const recommended = await getRecommendedTxOverrides(provider);
  return {
    ...recommended,
    ...overrides
  };
}
