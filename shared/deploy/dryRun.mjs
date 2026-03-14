import { ethers } from 'ethers';

const TRUTHY = new Set(['1', 'true', 'yes', 'y', 'on']);

export const DEFAULT_DRY_RUN_PRIVATE_KEY =
  '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
export const DEFAULT_DRY_RUN_ADDRESS = new ethers.Wallet(DEFAULT_DRY_RUN_PRIVATE_KEY).address;
export const ZERO_BYTES32 = `0x${'0'.repeat(64)}`;

function formatError(error) {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return String(error);
}

function normalizeValue(value) {
  if (value == null) {
    return 0n;
  }
  return BigInt(value);
}

function compactTxRequest(txRequest) {
  const compact = {};
  for (const key of ['from', 'to', 'data', 'value']) {
    const value = txRequest?.[key];
    if (value != null && value !== '') {
      compact[key] = key === 'value' ? normalizeValue(value) : value;
    }
  }
  return compact;
}

function serializeForLog(value) {
  if (typeof value === 'bigint') {
    return value.toString();
  }
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean' || value == null) {
    return value;
  }
  if (value instanceof Uint8Array) {
    return ethers.hexlify(value);
  }
  if (Array.isArray(value)) {
    return value.map((entry) => serializeForLog(entry));
  }
  if (typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, serializeForLog(entry)])
    );
  }
  return String(value);
}

function formatGasEstimate(result) {
  if (!result) {
    return 'not attempted';
  }
  if (result.gas != null) {
    return result.gas.toString();
  }
  if (result.skipped) {
    return result.skipped;
  }
  return `unavailable (${result.error || 'unknown error'})`;
}

function logArgs(args) {
  console.log(`  constructor args: ${JSON.stringify(serializeForLog(args))}`);
}

function logTxEnvelope(txRequest) {
  const value = normalizeValue(txRequest?.value);
  console.log(`  calldata: ${txRequest?.data || '0x'}`);
  console.log(`  value: ${value.toString()} wei (${ethers.formatEther(value)} ETH)`);
}

export function isTruthy(value) {
  return TRUTHY.has(String(value || '').toLowerCase());
}

export function isDryRunEnabled(env = process.env) {
  return isTruthy(env.DRY_RUN);
}

export function installDryRunGuards(...signers) {
  for (const signer of signers) {
    if (!signer || typeof signer.sendTransaction !== 'function' || signer.__dryRunGuardInstalled) {
      continue;
    }

    Object.defineProperty(signer, '__dryRunGuardInstalled', {
      value: true,
      enumerable: false,
      configurable: false,
      writable: false,
    });

    signer.sendTransaction = async (txRequest) => {
      const kind = txRequest?.to ? `call to ${txRequest.to}` : 'contract deployment';
      throw new Error(`Broadcast blocked in DRY_RUN: attempted ${kind}`);
    };
  }
}

export async function tryEstimateGas(provider, txRequest) {
  try {
    const gas = await provider.estimateGas(compactTxRequest(txRequest));
    return { gas };
  } catch (error) {
    return { error: formatError(error) };
  }
}

export class DryRunPlanner {
  static async create({ provider, from }) {
    const normalizedFrom = ethers.getAddress(from);
    const initialNonce = await provider.getTransactionCount(normalizedFrom, 'latest');
    return new DryRunPlanner({ from: normalizedFrom, initialNonce });
  }

  constructor({ from, initialNonce }) {
    this.from = ethers.getAddress(from);
    this.nextNonce = Number(initialNonce);
    this.nextStep = 1;
  }

  reserveTx() {
    const reservation = {
      step: this.nextStep,
      nonce: this.nextNonce,
    };
    this.nextStep += 1;
    this.nextNonce += 1;
    return reservation;
  }

  previewDeploymentAddress(nonce) {
    return ethers.getCreateAddress({
      from: this.from,
      nonce,
    });
  }

  previewContractCreateAddress(from, nonce) {
    return ethers.getCreateAddress({
      from: ethers.getAddress(from),
      nonce,
    });
  }
}

export async function planDeploy({
  provider,
  planner,
  from,
  artifact,
  contractName,
  args = [],
  value = 0n,
  note = '',
}) {
  const factory = new ethers.ContractFactory(artifact.abi, artifact.bytecode);
  const txRequest = await factory.getDeployTransaction(...args);
  txRequest.from = ethers.getAddress(from);
  txRequest.value = normalizeValue(value);

  const reservation = planner.reserveTx();
  const previewAddress = planner.previewDeploymentAddress(reservation.nonce);
  const gasEstimate = await tryEstimateGas(provider, txRequest);

  console.log(`[DRY_RUN] ${reservation.step}. DEPLOY ${contractName}`);
  console.log(`  nonce: ${reservation.nonce}`);
  logArgs(args);
  console.log('  address: address unknown until broadcast');
  console.log(`  nonce preview: ${previewAddress}`);
  logTxEnvelope(txRequest);
  console.log(`  gas estimate: ${formatGasEstimate(gasEstimate)}`);
  if (note) {
    console.log(`  note: ${note}`);
  }
  console.log('  SKIPPED (DRY_RUN)');

  return {
    ...reservation,
    address: previewAddress,
    txRequest,
    gasEstimate,
  };
}

export async function planContractCall({
  provider,
  planner,
  from,
  contractName,
  contractAddress,
  abi,
  method,
  args = [],
  value = 0n,
  note = '',
  predictedResult = '',
  canEstimate = true,
}) {
  const iface = ethers.Interface.from(abi);
  const txRequest = {
    from: ethers.getAddress(from),
    to: ethers.getAddress(contractAddress),
    data: iface.encodeFunctionData(method, args),
    value: normalizeValue(value),
  };
  const reservation = planner.reserveTx();
  const gasEstimate = canEstimate
    ? await tryEstimateGas(provider, txRequest)
    : { skipped: 'not possible before prior skipped deployment is broadcast' };

  console.log(`[DRY_RUN] ${reservation.step}. CALL ${contractName}.${method}`);
  console.log(`  nonce: ${reservation.nonce}`);
  console.log(`  target contract: ${contractName}`);
  console.log(`  target address: ${txRequest.to}`);
  logTxEnvelope(txRequest);
  console.log(`  gas estimate: ${formatGasEstimate(gasEstimate)}`);
  if (predictedResult) {
    console.log(`  predicted result: ${predictedResult}`);
  }
  if (note) {
    console.log(`  note: ${note}`);
  }
  console.log('  SKIPPED (DRY_RUN)');

  return {
    ...reservation,
    txRequest,
    gasEstimate,
  };
}
