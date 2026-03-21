import assert from 'node:assert/strict';
import test from 'node:test';

import { withRpcRetry } from '../shared/deploy/rpcRetry.mjs';

test('withRpcRetry retries retryable transport errors', async () => {
  let attempts = 0;
  const result = await withRpcRetry(
    'retry-test',
    async () => {
      attempts += 1;
      if (attempts < 3) {
        const error = new Error('socket hang up');
        error.code = 'ECONNRESET';
        throw error;
      }
      return 'ok';
    },
    {
      delaysMs: [0, 0],
    }
  );

  assert.equal(result, 'ok');
  assert.equal(attempts, 3);
});

test('withRpcRetry does not swallow non-retryable errors', async () => {
  await assert.rejects(
    () => withRpcRetry(
      'retry-test',
      async () => {
        throw new Error('bad input');
      },
      {
        delaysMs: [0, 0],
      }
    ),
    /bad input/
  );
});
