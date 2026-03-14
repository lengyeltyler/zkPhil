/**
 * Quick test script for the server components
 */

import { hash } from 'starknet';

// Test Pedersen hash (matches Cairo)
function pedersen(a, b) {
  return BigInt(hash.computePedersenHash(a.toString(), b.toString()));
}

// Domain constants (must match Cairo)
const DOMAIN_LEAF = 1n;
const DOMAIN_NULL = 2n;

// Compute leaf
function computeLeaf(secret) {
  return pedersen(DOMAIN_LEAF, secret);
}

// Compute nullifier
function computeNullifier(secret, dropId, recipient) {
  const inner = pedersen(dropId, recipient);
  const middle = pedersen(secret, inner);
  return pedersen(DOMAIN_NULL, middle);
}

// Simple Merkle tree for testing
class SimpleMerkleTree {
  constructor() {
    this.leaves = [];
  }

  insert(leaf) {
    this.leaves.push(leaf);
  }

  getRoot() {
    if (this.leaves.length === 0) return 0n;
    if (this.leaves.length === 1) return this.leaves[0];

    let layer = [...this.leaves];
    while (layer.length > 1) {
      const newLayer = [];
      for (let i = 0; i < layer.length; i += 2) {
        const left = layer[i];
        const right = layer[i + 1] ?? left; // Pad with duplicate if odd
        newLayer.push(pedersen(left, right));
      }
      layer = newLayer;
    }
    return layer[0];
  }

  getProof(index) {
    const siblings = [];
    const pathIndices = [];

    let layer = [...this.leaves];
    let currentIndex = index;

    while (layer.length > 1) {
      const isRight = currentIndex % 2 === 1;
      pathIndices.push(isRight ? 1 : 0);

      const siblingIndex = isRight ? currentIndex - 1 : currentIndex + 1;
      const sibling = layer[siblingIndex] ?? layer[currentIndex];
      siblings.push(sibling);

      // Move to next layer
      const newLayer = [];
      for (let i = 0; i < layer.length; i += 2) {
        const left = layer[i];
        const right = layer[i + 1] ?? left;
        newLayer.push(pedersen(left, right));
      }
      layer = newLayer;
      currentIndex = Math.floor(currentIndex / 2);
    }

    return { siblings, pathIndices };
  }
}

// Verify proof matches root
function verifyProof(leaf, siblings, pathIndices, expectedRoot) {
  let current = leaf;
  for (let i = 0; i < siblings.length; i++) {
    const isRight = pathIndices[i] === 1;
    if (isRight) {
      current = pedersen(siblings[i], current);
    } else {
      current = pedersen(current, siblings[i]);
    }
  }
  return current === expectedRoot;
}

console.log('='.repeat(60));
console.log('PHIL TEST13 SERVER COMPONENT TESTS');
console.log('='.repeat(60));

// Test 1: Leaf computation
console.log('\n1. Testing leaf computation...');
const secret1 = 12345n;
const leaf1 = computeLeaf(secret1);
console.log(`   Secret: ${secret1}`);
console.log(`   Leaf: ${leaf1}`);
console.log(`   ✓ Leaf computed successfully`);

// Test 2: Nullifier computation
console.log('\n2. Testing nullifier computation...');
const dropId = 1n;
const recipient = BigInt('0x1234567890abcdef1234567890abcdef12345678');
const nullifier = computeNullifier(secret1, dropId, recipient);
console.log(`   Drop ID: ${dropId}`);
console.log(`   Recipient: ${recipient.toString(16)}`);
console.log(`   Nullifier: ${nullifier}`);
console.log(`   ✓ Nullifier computed successfully`);

// Test 3: Merkle tree with 13 leaves
console.log('\n3. Testing Merkle tree with 13 leaves...');
const tree = new SimpleMerkleTree();
const secrets = [];
for (let i = 0; i < 13; i++) {
  const secret = BigInt(1000 + i);
  const leaf = computeLeaf(secret);
  secrets.push({ secret, leaf, index: i });
  tree.insert(leaf);
}
const root = tree.getRoot();
console.log(`   Inserted 13 leaves`);
console.log(`   Root: ${root}`);
console.log(`   ✓ Tree built successfully`);

// Test 4: Merkle proof verification
console.log('\n4. Testing Merkle proof verification...');
const testIndex = 5;
const testLeaf = secrets[testIndex].leaf;
const proof = tree.getProof(testIndex);
const isValid = verifyProof(testLeaf, proof.siblings, proof.pathIndices, root);
console.log(`   Testing leaf at index ${testIndex}`);
console.log(`   Siblings: ${proof.siblings.length}`);
console.log(`   Path indices: [${proof.pathIndices.join(', ')}]`);
console.log(`   Proof valid: ${isValid}`);
if (isValid) {
  console.log(`   ✓ Proof verification passed`);
} else {
  console.log(`   ✗ Proof verification FAILED`);
  process.exit(1);
}

// Test 5: Simulate full mint flow
console.log('\n5. Simulating full mint flow...');
const mintSecret = secrets[7].secret;
const mintLeaf = secrets[7].leaf;
const mintProof = tree.getProof(7);
const mintRecipient = BigInt('0xabcdefabcdefabcdefabcdefabcdefabcdefabcd');
const mintNullifier = computeNullifier(mintSecret, dropId, mintRecipient);

// Build outputs (as Cairo program would)
const outputs = [
  root,                // [0] root
  dropId,              // [1] dropId
  mintRecipient,       // [2] recipient
  mintNullifier,       // [3] nullifier
  mintLeaf,            // [4] leaf (debug)
  BigInt(7),           // [5] idx (debug)
];

console.log('   Outputs:');
outputs.forEach((o, i) => {
  console.log(`     [${i}]: 0x${o.toString(16).padStart(64, '0')}`);
});
console.log(`   ✓ Full mint flow simulation successful`);

console.log('\n' + '='.repeat(60));
console.log('ALL TESTS PASSED');
console.log('='.repeat(60));
