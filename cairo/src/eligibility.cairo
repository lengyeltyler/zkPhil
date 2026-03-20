/// Phil local eligibility verification module.
///
/// The credential witness is bound to a specific recipient address and
/// credential slot so a leaked secret cannot be replayed for a different
/// address.

use core::array::ArrayTrait;
use core::pedersen::pedersen;

const DOMAIN_LEAF: felt252 = 1;
const DOMAIN_NULL: felt252 = 2;

#[derive(Drop, Serde)]
pub struct MerkleProof {
    pub siblings: Array<felt252>,
    pub path_indices: Array<felt252>,
}

pub fn verify_eligibility_claim(
    secret: felt252,
    credential_slot: felt252,
    proof: MerkleProof,
    eligibility_root: felt252,
    context_id: felt252,
    recipient: felt252,
    claim_hash_hi: felt252,
    claim_hash_lo: felt252,
    claim_kind: felt252,
) -> Array<felt252> {
    let credential_leaf = compute_leaf(secret, recipient, credential_slot);
    let computed_root = compute_merkle_root(credential_leaf, @proof);
    assert(computed_root == eligibility_root, 'Invalid merkle proof');

    let nullifier = compute_nullifier(secret, credential_slot, context_id, recipient, claim_kind);

    let mut outputs = ArrayTrait::new();
    outputs.append(eligibility_root);
    outputs.append(context_id);
    outputs.append(recipient);
    outputs.append(claim_hash_hi);
    outputs.append(claim_hash_lo);
    outputs.append(nullifier);
    outputs.append(credential_slot);
    outputs.append(credential_leaf);
    outputs.append(claim_kind);
    outputs
}

fn compute_merkle_root(leaf: felt252, proof: @MerkleProof) -> felt252 {
    let mut current = leaf;
    let siblings = proof.siblings;
    let path_indices = proof.path_indices;

    let mut i: usize = 0;
    let len = siblings.len();

    while i < len {
        let sibling = *siblings.at(i);
        let is_right = *path_indices.at(i);
        current = if is_right == 1 {
            pedersen(sibling, current)
        } else {
            pedersen(current, sibling)
        };
        i += 1;
    };

    current
}

pub fn compute_leaf(secret: felt252, recipient: felt252, credential_slot: felt252) -> felt252 {
    let recipient_binding = pedersen(recipient, credential_slot);
    let secret_binding = pedersen(secret, recipient_binding);
    pedersen(DOMAIN_LEAF, secret_binding)
}

pub fn compute_nullifier(
    secret: felt252,
    credential_slot: felt252,
    context_id: felt252,
    recipient: felt252,
    claim_kind: felt252,
) -> felt252 {
    let context_recipient = pedersen(context_id, recipient);
    let credential_binding = pedersen(credential_slot, context_recipient);
    let kind_binding = pedersen(claim_kind, credential_binding);
    let secret_binding = pedersen(secret, kind_binding);
    pedersen(DOMAIN_NULL, secret_binding)
}

#[cfg(test)]
mod tests {
    use super::{compute_leaf, compute_nullifier, verify_eligibility_claim, MerkleProof, DOMAIN_LEAF, DOMAIN_NULL};
    use core::array::ArrayTrait;
    use core::pedersen::pedersen;

    #[test]
    fn test_compute_leaf_binds_recipient_and_credential_slot() {
        let secret: felt252 = 12345;
        let recipient: felt252 = 0x1234;
        let credential_slot: felt252 = 7;
        let expected = pedersen(DOMAIN_LEAF, pedersen(secret, pedersen(recipient, credential_slot)));
        let credential_leaf = compute_leaf(secret, recipient, credential_slot);
        assert(credential_leaf == expected, 'Leaf computation failed');
    }

    #[test]
    fn test_compute_nullifier_binds_claim_kind() {
        let secret: felt252 = 12345;
        let credential_slot: felt252 = 2;
        let context_id: felt252 = 13;
        let recipient: felt252 = 0x123456;
        let claim_kind: felt252 = 1;

        let expected = pedersen(
            DOMAIN_NULL,
            pedersen(
                secret,
                pedersen(claim_kind, pedersen(credential_slot, pedersen(context_id, recipient))),
            ),
        );
        let nullifier = compute_nullifier(secret, credential_slot, context_id, recipient, claim_kind);
        assert(nullifier == expected, 'Nullifier computation failed');
    }

    #[test]
    fn test_single_leaf_tree_claim_outputs() {
        let secret: felt252 = 42;
        let recipient: felt252 = 0xabcdef;
        let credential_slot: felt252 = 0;
        let claim_hash_hi: felt252 = 12;
        let claim_hash_lo: felt252 = 34;
        let claim_kind: felt252 = 1;
        let credential_leaf = compute_leaf(secret, recipient, credential_slot);

        let proof = MerkleProof {
            siblings: ArrayTrait::new(),
            path_indices: ArrayTrait::new(),
        };

        let outputs = verify_eligibility_claim(
            secret,
            credential_slot,
            proof,
            credential_leaf,
            13,
            recipient,
            claim_hash_hi,
            claim_hash_lo,
            claim_kind,
        );

        assert(*outputs.at(0) == credential_leaf, 'Root should equal leaf');
        assert(*outputs.at(3) == claim_hash_hi, 'claim hash hi mismatch');
        assert(*outputs.at(4) == claim_hash_lo, 'claim hash lo mismatch');
        assert(*outputs.at(6) == credential_slot, 'credential slot mismatch');
        assert(*outputs.at(8) == claim_kind, 'claim kind mismatch');
    }
}
