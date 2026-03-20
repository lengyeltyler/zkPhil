import test from 'node:test';
import assert from 'node:assert/strict';
import ganache from 'ganache';
import { ethers } from 'ethers';

import { compilePhilContracts } from '../scripts/local/compileContracts.mjs';
import { assertIncludesInOrder } from './test-helpers.mjs';
import {
  FIXTURE_VARIANTS,
  deployHybridRendererSystem,
} from './hybrid-renderer-helpers.mjs';

const CHAIN_ID = 31337;
const MNEMONIC = 'test test test test test test test test test test test junk';

function encodedFixture(fileName) {
  const variant = FIXTURE_VARIANTS.find((item) => item.fileName === fileName);
  if (!variant) {
    throw new Error(`Missing fixture asset for ${fileName}`);
  }
  return Buffer.from(variant.svg).toString('base64');
}

test('hybrid PhilRenderer is deterministic and preserves stack order', async () => {
  const gProvider = ganache.provider({
    chain: { chainId: CHAIN_ID },
    wallet: { mnemonic: MNEMONIC, totalAccounts: 10, defaultBalance: 1000 },
    logging: { quiet: true },
  });
  const provider = new ethers.BrowserProvider(gProvider);

  try {
    const deployer = await provider.getSigner(0);
    const artifacts = compilePhilContracts();
    const { renderer } = await deployHybridRendererSystem(deployer, artifacts);

    const first = await renderer.renderSvg(1, 2, 0, 0);
    const second = await renderer.renderSvg(1, 2, 0, 0);
    const swapped = await renderer.renderSvg(1, 2, 1, 12345);
    const permuted = await renderer.renderSvg(1, 2, 2, 67890);

    assert.equal(first, second);
    assert.match(first, /^<svg/);
    assert.ok(first.includes('</svg>'));
    assert.notEqual(first, swapped);
    assert.notEqual(swapped, permuted);

    assertIncludesInOrder(first, [
      encodedFixture('BgColorMidnight.svg'),
      encodedFixture('Body1Teal.svg'),
      encodedFixture('Top1Blue.svg'),
    ]);
  } finally {
    gProvider.disconnect();
  }
});
