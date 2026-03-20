import fs from 'node:fs';
import path from 'node:path';
import { describe, it, expect } from 'vitest';
import { computeFactHash } from './factHash.js';

interface Vector {
  id: string;
  programHash: string;
  outputs: string[];
  factHash: string;
}

const vectors = JSON.parse(
  fs.readFileSync(path.resolve(process.cwd(), '../shared/fact_hash_vectors.json'), 'utf8')
) as Vector[];

describe('computeFactHash', () => {
  it('matches canonical test vectors', () => {
    for (const vector of vectors) {
      const outputs = vector.outputs.map((o) => BigInt(o));
      const actual = computeFactHash(vector.programHash, outputs);
      expect(actual).toBe(vector.factHash.toLowerCase());
    }
  });

  it('rejects non-uint256 outputs', () => {
    expect(() =>
      computeFactHash('0x' + '11'.repeat(32), [0n, 0n, 0n, 0n, 0n, (1n << 256n)])
    ).toThrow(/uint256 range/i);
  });
});
