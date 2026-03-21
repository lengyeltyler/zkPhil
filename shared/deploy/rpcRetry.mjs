function parseRetryDelays(rawValue) {
  const raw = String(rawValue || '').trim();
  if (!raw) {
    return [500, 1_500, 3_000];
  }

  const parsed = raw
    .split(',')
    .map((entry) => Number(entry.trim()))
    .filter((entry) => Number.isFinite(entry) && entry >= 0);
  return parsed.length > 0 ? parsed : [500, 1_500, 3_000];
}

export const DEFAULT_RPC_RETRY_DELAYS_MS = parseRetryDelays(process.env.RPC_RETRY_DELAYS_MS);

export function formatRpcError(error) {
  if (error instanceof Error) {
    const code = error.code ? ` (${error.code})` : '';
    return `${error.message}${code}`;
  }
  return String(error);
}

export function isRateLimitError(error) {
  const message = String(error?.shortMessage || error?.message || error).toLowerCase();
  return (
    message.includes('too many requests') ||
    message.includes('rate limit') ||
    message.includes('-32005')
  );
}

export function isRetryableRpcError(error) {
  if (isRateLimitError(error)) {
    return true;
  }

  const code = String(error?.code || '').toUpperCase();
  if (['ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'EPIPE', 'UND_ERR_SOCKET'].includes(code)) {
    return true;
  }

  const message = String(error?.shortMessage || error?.message || error).toLowerCase();
  return (
    message.includes('socket hang up') ||
    message.includes('fetch failed') ||
    message.includes('network error') ||
    message.includes('connection reset') ||
    message.includes('headers timeout') ||
    message.includes('gateway timeout') ||
    message.includes('service unavailable') ||
    message.includes('temporarily unavailable') ||
    message.includes('timeout exceeded')
  );
}

export async function sleep(delayMs) {
  await new Promise((resolve) => setTimeout(resolve, delayMs));
}

export async function withRpcRetry(
  label,
  fn,
  {
    delaysMs = DEFAULT_RPC_RETRY_DELAYS_MS,
    retryable = isRetryableRpcError,
    onRetry = null,
  } = {}
) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await fn();
    } catch (error) {
      if (!retryable(error) || attempt >= delaysMs.length) {
        throw error;
      }

      const delayMs = delaysMs[attempt];
      const reason = formatRpcError(error);
      if (typeof onRetry === 'function') {
        onRetry({ attempt: attempt + 1, delayMs, error, reason });
      } else {
        console.warn(`${label}: ${reason}. Retrying in ${delayMs}ms...`);
      }
      await sleep(delayMs);
    }
  }
}
