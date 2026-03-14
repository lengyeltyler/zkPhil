/**
 * Pedersen-based Merkle Tree Module
 *
 * Uses StarkNet's Pedersen hash to match the Cairo program.
 */

import { hash } from 'starknet';

// Domain separators (must match Cairo program)
const DOMAIN_LEAF = 1n;
const DOMAIN_NULL = 2n;

/**
 * Compute Pedersen hash of two felts
 */
export function pedersen(a: bigint, b: bigint): bigint {
  return BigInt(hash.computePedersenHash(a.toString(), b.toString()));
}

/**
 * Compute leaf from secret
 * leaf = pedersen(DOMAIN_LEAF, secret)
 */
export function computeLeaf(secret: bigint): bigint {
  return pedersen(DOMAIN_LEAF, secret);
}

/**
 * Compute nullifier from secret, dropId, and recipient
 * nullifier = pedersen(DOMAIN_NULL, pedersen(secret, pedersen(dropId, recipient)))
 */
export function computeNullifier(secret: bigint, dropId: bigint, recipient: bigint): bigint {
  const inner = pedersen(dropId, recipient);
  const middle = pedersen(secret, inner);
  return pedersen(DOMAIN_NULL, middle);
}

/**
 * Merkle proof structure
 */
export interface MerkleProof {
  siblings: bigint[];
  pathIndices: number[]; // 0 = left, 1 = right
  root: bigint;
  leaf: bigint;
  leafIndex: number;
}

/**
 * Pedersen-based Merkle Tree
 */
export class PedersenMerkleTree {
  private leaves: bigint[] = [];
  private layers: bigint[][] = [];
  private depth: number;
  private zeroValues: bigint[] = [];

  constructor(depth: number = 4) {
    this.depth = depth;
    this.initZeroValues();
  }

  /**
   * Initialize zero values for empty nodes at each level
   */
  private initZeroValues(): void {
    // Zero value for leaves (hash of 0)
    let current = 0n;
    this.zeroValues.push(current);

    // Compute zero values for each level
    for (let i = 0; i < this.depth; i++) {
      current = pedersen(current, current);
      this.zeroValues.push(current);
    }
  }

  /**
   * Insert a leaf into the tree
   */
  insert(leaf: bigint): number {
    const index = this.leaves.length;
    this.leaves.push(leaf);
    this.rebuild();
    return index;
  }

  /**
   * Insert multiple leaves at once
   */
  insertBatch(leaves: bigint[]): void {
    for (const leaf of leaves) {
      this.leaves.push(leaf);
    }
    this.rebuild();
  }

  /**
   * Rebuild internal layers after insertions
   */
  private rebuild(): void {
    this.layers = [this.leaves.slice()];

    for (let level = 0; level < this.depth; level++) {
      const prevLayer = this.layers[level];
      const currentLayer: bigint[] = [];

      // Pad to even length with zero values
      const paddedLength = Math.ceil(prevLayer.length / 2) * 2;

      for (let i = 0; i < paddedLength; i += 2) {
        const left = prevLayer[i] ?? this.zeroValues[level];
        const right = prevLayer[i + 1] ?? this.zeroValues[level];
        currentLayer.push(pedersen(left, right));
      }

      if (currentLayer.length === 0) {
        currentLayer.push(this.zeroValues[level + 1]);
      }

      this.layers.push(currentLayer);
    }
  }

  /**
   * Get the Merkle root
   */
  getRoot(): bigint {
    if (this.layers.length === 0 || this.layers[this.depth].length === 0) {
      return this.zeroValues[this.depth];
    }
    return this.layers[this.depth][0];
  }

  /**
   * Generate a Merkle proof for a leaf at the given index
   */
  getProof(leafIndex: number): MerkleProof {
    if (leafIndex >= this.leaves.length) {
      throw new Error(`Leaf index ${leafIndex} out of bounds (${this.leaves.length} leaves)`);
    }

    const siblings: bigint[] = [];
    const pathIndices: number[] = [];
    let currentIndex = leafIndex;

    for (let level = 0; level < this.depth; level++) {
      const isRight = currentIndex % 2 === 1;
      pathIndices.push(isRight ? 1 : 0);

      const siblingIndex = isRight ? currentIndex - 1 : currentIndex + 1;
      const sibling = this.layers[level][siblingIndex] ?? this.zeroValues[level];
      siblings.push(sibling);

      currentIndex = Math.floor(currentIndex / 2);
    }

    return {
      siblings,
      pathIndices,
      root: this.getRoot(),
      leaf: this.leaves[leafIndex],
      leafIndex,
    };
  }

  /**
   * Verify a Merkle proof
   */
  static verifyProof(proof: MerkleProof): boolean {
    let current = proof.leaf;

    for (let i = 0; i < proof.siblings.length; i++) {
      const sibling = proof.siblings[i];
      const isRight = proof.pathIndices[i] === 1;

      if (isRight) {
        current = pedersen(sibling, current);
      } else {
        current = pedersen(current, sibling);
      }
    }

    return current === proof.root;
  }

  /**
   * Get all leaves
   */
  getLeaves(): bigint[] {
    return this.leaves.slice();
  }

  /**
   * Get the index of a leaf
   */
  indexOf(leaf: bigint): number {
    return this.leaves.findIndex(l => l === leaf);
  }

  /**
   * Get tree depth
   */
  getDepth(): number {
    return this.depth;
  }
}

/**
 * Convert a hex string to bigint
 */
export function hexToBigInt(hex: string): bigint {
  if (hex.startsWith('0x')) {
    return BigInt(hex);
  }
  return BigInt('0x' + hex);
}

/**
 * Convert bigint to hex string (64 chars, 0x prefixed)
 */
export function bigIntToHex(n: bigint): string {
  return '0x' + n.toString(16).padStart(64, '0');
}

/**
 * Convert an Ethereum address to felt252
 */
export function addressToFelt(address: string): bigint {
  return BigInt(address);
}
