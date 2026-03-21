import assert from 'node:assert/strict';
import test from 'node:test';

import { shouldFlushSmallSvgBatch } from '../scripts/local/deployPhilSystem.mjs';

test('shouldFlushSmallSvgBatch flushes before a pending batch would exceed the byte cap', () => {
  const batchConfig = {
    smallBatchMaxItems: 8,
    smallBatchMaxBytes: 48_000,
  };

  assert.equal(
    shouldFlushSmallSvgBatch({
      pendingCount: 3,
      pendingBytes: 40_000,
      nextAssetSize: 9_000,
      batchConfig,
    }),
    true
  );
});

test('shouldFlushSmallSvgBatch flushes before a pending batch would exceed the item cap', () => {
  const batchConfig = {
    smallBatchMaxItems: 8,
    smallBatchMaxBytes: 48_000,
  };

  assert.equal(
    shouldFlushSmallSvgBatch({
      pendingCount: 8,
      pendingBytes: 12_000,
      nextAssetSize: 1_000,
      batchConfig,
    }),
    true
  );
});

test('shouldFlushSmallSvgBatch keeps an empty batch open for the first asset', () => {
  const batchConfig = {
    smallBatchMaxItems: 8,
    smallBatchMaxBytes: 48_000,
  };

  assert.equal(
    shouldFlushSmallSvgBatch({
      pendingCount: 0,
      pendingBytes: 0,
      nextAssetSize: 20_000,
      batchConfig,
    }),
    false
  );
});
