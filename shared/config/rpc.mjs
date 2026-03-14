const DEFAULT_RPC_PROFILE = 'node';
const DEFAULT_RPC_URL_NODE = 'http://127.0.0.1:8545';

function readEnv(env, name) {
  const value = env[name];
  return typeof value === 'string' ? value.trim() : '';
}

export function getRpcUrl(env = process.env) {
  const explicitRpcUrl = readEnv(env, 'RPC_URL');
  if (explicitRpcUrl) {
    return explicitRpcUrl;
  }

  const rpcProfile = readEnv(env, 'RPC_PROFILE').toLowerCase() || DEFAULT_RPC_PROFILE;
  if (rpcProfile === 'node') {
    return readEnv(env, 'RPC_URL_NODE') || DEFAULT_RPC_URL_NODE;
  }

  if (rpcProfile === 'cloudflare') {
    throw new Error('RPC_PROFILE=cloudflare is deprecated in this repo. Use RPC_PROFILE=node or set RPC_URL explicitly.');
  }

  throw new Error(`Unsupported RPC_PROFILE=${rpcProfile}. Use RPC_PROFILE=node or set RPC_URL explicitly.`);
}

export async function assertChain(provider, expectedChainId) {
  const normalizedExpectedChainId = Number(expectedChainId);
  if (!Number.isInteger(normalizedExpectedChainId) || normalizedExpectedChainId <= 0) {
    throw new Error(`Invalid expected chain id: ${expectedChainId}`);
  }

  const network = await provider.getNetwork();
  const actualChainId = Number(network.chainId);
  if (actualChainId !== normalizedExpectedChainId) {
    throw new Error(`RPC chain mismatch: expected ${normalizedExpectedChainId}, got ${actualChainId}`);
  }

  return actualChainId;
}
