import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildOnchainRendererAssets,
  decodeDslV2,
  encodeDslV2,
} from '../shared/phil-renderer/renderPhil.mjs';

test('dsl v2 encoder/decoder round-trip a representative svg snippet', () => {
  const snippet = '<g><circle cx="1" cy="2" r="3" fill="#abcdef" opacity=".7"/></g>';
  const encoded = encodeDslV2(snippet);
  const decoded = decodeDslV2(encoded);
  assert.equal(decoded, snippet);
});

test('all DSL-encoded fragment payloads decode back to exact source snippet', () => {
  const assets = buildOnchainRendererAssets();
  const dslFragments = assets.fragments.filter((fragment) => fragment.isDsl);
  assert.ok(dslFragments.length >= 1, 'expected at least one fragment to be DSL-encoded');

  for (const fragment of dslFragments) {
    const decoded = decodeDslV2(fragment.bytes);
    assert.equal(
      decoded,
      fragment.content,
      `dsl decode mismatch for phil=${fragment.philId} slot=${fragment.slotIndex}`
    );
  }
});
