/// Phil Test13 Allowlist Verification Module
///
/// Implements Pedersen-based Merkle tree verification and nullifier computation
/// following the STARK-Gated Mint specification.

use core::pedersen::pedersen;
use core::array::ArrayTrait;

/// Domain separator for leaf computation
/// leaf = pedersen(DOMAIN_LEAF, secret)
const DOMAIN_LEAF: felt252 = 1;

/// Domain separator for nullifier computation
/// nullifier = pedersen(DOMAIN_NULL, pedersen(secret, pedersen(drop_id, recipient)))
const DOMAIN_NULL: felt252 = 2;

/// Merkle proof structure
#[derive(Drop, Serde)]
pub struct MerkleProof {
    /// Sibling hashes along the path from leaf to root
    pub siblings: Array<felt252>,
    /// Path indices: 0 = leaf is left child, 1 = leaf is right child
    pub path_indices: Array<felt252>,
}

/// Verify allowlist membership and compute outputs
///
/// # Arguments
/// * `secret` - Private: The secret value (leaf preimage)
/// * `proof` - Private: Merkle proof (siblings + path indices)
/// * `root` - Public: Expected Merkle root
/// * `drop_id` - Public: Unique identifier for this drop
/// * `recipient` - Public: Address to receive the NFT
///
/// # Returns
/// Array of 6 felt252 values for Ethereum verification
pub fn verify_allowlist(
    secret: felt252,
    proof: MerkleProof,
    root: felt252,
    drop_id: felt252,
    recipient: felt252,
) -> Array<felt252> {
    // Step 1: Compute leaf from secret
    // leaf = pedersen(DOMAIN_LEAF, secret)
    let leaf = pedersen(DOMAIN_LEAF, secret);

    // Step 2: Verify Merkle proof
    let computed_root = compute_merkle_root(leaf, @proof);
    assert(computed_root == root, 'Invalid merkle proof');

    // Step 3: Compute nullifier
    // nullifier = pedersen(DOMAIN_NULL, pedersen(secret, pedersen(drop_id, recipient)))
    let inner = pedersen(drop_id, recipient);
    let middle = pedersen(secret, inner);
    let nullifier = pedersen(DOMAIN_NULL, middle);

    // Step 4: Build outputs array
    let mut outputs = ArrayTrait::new();
    outputs.append(root);           // [0] root - verified against contract
    outputs.append(drop_id);        // [1] drop_id - verified against contract
    outputs.append(recipient);      // [2] recipient - verified against mint params
    outputs.append(nullifier);      // [3] nullifier - burned on mint
    outputs.append(leaf);           // [4] leaf - debug
    outputs.append(proof.siblings.len().into()); // [5] idx (tree depth as proxy)

    outputs
}

/// Compute Merkle root from leaf and proof
fn compute_merkle_root(leaf: felt252, proof: @MerkleProof) -> felt252 {
    let mut current = leaf;
    let siblings = proof.siblings;
    let path_indices = proof.path_indices;

    let mut i: usize = 0;
    let len = siblings.len();

    while i < len {
        let sibling = *siblings.at(i);
        let is_right = *path_indices.at(i);

        // If is_right == 1, current is right child, sibling is left
        // If is_right == 0, current is left child, sibling is right
        current = if is_right == 1 {
            pedersen(sibling, current)
        } else {
            pedersen(current, sibling)
        };

        i += 1;
    };

    current
}

/// Compute leaf hash from secret
pub fn compute_leaf(secret: felt252) -> felt252 {
    pedersen(DOMAIN_LEAF, secret)
}

/// Compute nullifier from secret, drop_id, and recipient
pub fn compute_nullifier(secret: felt252, drop_id: felt252, recipient: felt252) -> felt252 {
    let inner = pedersen(drop_id, recipient);
    let middle = pedersen(secret, inner);
    pedersen(DOMAIN_NULL, middle)
}

#[cfg(test)]
mod tests {
    use super::{verify_allowlist, compute_leaf, compute_nullifier, MerkleProof, DOMAIN_LEAF, DOMAIN_NULL};
    use core::pedersen::pedersen;

    #[test]
    fn test_compute_leaf() {
        let secret: felt252 = 12345;
        let leaf = compute_leaf(secret);
        let expected = pedersen(DOMAIN_LEAF, secret);
        assert(leaf == expected, 'Leaf computation failed');
    }

    #[test]
    fn test_compute_nullifier() {
        let secret: felt252 = 12345;
        let drop_id: felt252 = 1;
        let recipient: felt252 = 0x1234567890abcdef;

        let nullifier = compute_nullifier(secret, drop_id, recipient);

        // Verify it follows the formula:
        // pedersen(DOMAIN_NULL, pedersen(secret, pedersen(drop_id, recipient)))
        let inner = pedersen(drop_id, recipient);
        let middle = pedersen(secret, inner);
        let expected = pedersen(DOMAIN_NULL, middle);

        assert(nullifier == expected, 'Nullifier computation failed');
    }

    #[test]
    fn test_single_leaf_tree() {
        // Single leaf tree: root == leaf
        let secret: felt252 = 42;
        let leaf = compute_leaf(secret);

        // Empty proof for single-leaf tree
        let proof = MerkleProof {
            siblings: ArrayTrait::new(),
            path_indices: ArrayTrait::new(),
        };

        let drop_id: felt252 = 1;
        let recipient: felt252 = 0xabcdef;

        // For single leaf, root == leaf
        let outputs = verify_allowlist(secret, proof, leaf, drop_id, recipient);

        assert(*outputs.at(0) == leaf, 'Root should equal leaf');
        assert(*outputs.at(1) == drop_id, 'Drop ID mismatch');
        assert(*outputs.at(2) == recipient, 'Recipient mismatch');
    }
}
