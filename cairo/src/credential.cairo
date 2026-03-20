/// Phil local credential verification module.
///
/// The current provider binds a private credential secret to a recipient and
/// proves inclusion of the resulting commitment inside a provider config hash.
/// That config hash is currently a Merkle root, but the surrounding
/// architecture treats it as a verifier detail rather than the product model.

use core::array::ArrayTrait;
use core::pedersen::pedersen;

const DOMAIN_COMMITMENT: felt252 = 1;
const DOMAIN_NULLIFIER: felt252 = 2;

#[derive(Drop, Serde)]
pub struct CommitmentWitness {
    pub siblings: Array<felt252>,
    pub path_indices: Array<felt252>,
}

pub fn verify_credential_claim(
    secret: felt252,
    witness: CommitmentWitness,
    verifier_config_hash: felt252,
    proof_context: felt252,
    recipient: felt252,
    claim_hash_hi: felt252,
    claim_hash_lo: felt252,
    claim_kind: felt252,
) -> Array<felt252> {
    let credential_commitment = compute_credential_commitment(secret, recipient);
    let computed_root = compute_commitment_root(credential_commitment, @witness);
    assert(computed_root == verifier_config_hash, 'Invalid commitment witness');

    let identity_nullifier = compute_identity_nullifier(secret, proof_context, recipient, claim_kind);

    let mut outputs = ArrayTrait::new();
    outputs.append(verifier_config_hash);
    outputs.append(proof_context);
    outputs.append(recipient);
    outputs.append(claim_hash_hi);
    outputs.append(claim_hash_lo);
    outputs.append(identity_nullifier);
    outputs.append(credential_commitment);
    outputs.append(claim_kind);
    outputs
}

fn compute_commitment_root(commitment: felt252, witness: @CommitmentWitness) -> felt252 {
    let mut current = commitment;
    let siblings = witness.siblings;
    let path_indices = witness.path_indices;

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

pub fn compute_credential_commitment(secret: felt252, recipient: felt252) -> felt252 {
    pedersen(DOMAIN_COMMITMENT, pedersen(secret, recipient))
}

pub fn compute_identity_nullifier(
    secret: felt252,
    proof_context: felt252,
    recipient: felt252,
    claim_kind: felt252,
) -> felt252 {
    let context_binding = pedersen(proof_context, recipient);
    let kind_binding = pedersen(claim_kind, context_binding);
    let secret_binding = pedersen(secret, kind_binding);
    pedersen(DOMAIN_NULLIFIER, secret_binding)
}

#[cfg(test)]
mod tests {
    use super::{
        CommitmentWitness,
        DOMAIN_COMMITMENT,
        DOMAIN_NULLIFIER,
        compute_credential_commitment,
        compute_identity_nullifier,
        verify_credential_claim,
    };
    use core::array::ArrayTrait;
    use core::pedersen::pedersen;

    #[test]
    fn test_compute_credential_commitment_binds_recipient() {
        let secret: felt252 = 12345;
        let recipient: felt252 = 0x1234;
        let expected = pedersen(DOMAIN_COMMITMENT, pedersen(secret, recipient));
        let credential_commitment = compute_credential_commitment(secret, recipient);
        assert(credential_commitment == expected, 'Commitment computation failed');
    }

    #[test]
    fn test_compute_identity_nullifier_binds_claim_kind() {
        let secret: felt252 = 12345;
        let proof_context: felt252 = 13;
        let recipient: felt252 = 0x123456;
        let claim_kind: felt252 = 1;

        let expected = pedersen(
            DOMAIN_NULLIFIER,
            pedersen(secret, pedersen(claim_kind, pedersen(proof_context, recipient))),
        );
        let identity_nullifier = compute_identity_nullifier(secret, proof_context, recipient, claim_kind);
        assert(identity_nullifier == expected, 'Nullifier computation failed');
    }

    #[test]
    fn test_single_commitment_claim_outputs() {
        let secret: felt252 = 42;
        let recipient: felt252 = 0xabcdef;
        let claim_hash_hi: felt252 = 12;
        let claim_hash_lo: felt252 = 34;
        let claim_kind: felt252 = 1;
        let credential_commitment = compute_credential_commitment(secret, recipient);

        let witness = CommitmentWitness {
            siblings: ArrayTrait::new(),
            path_indices: ArrayTrait::new(),
        };

        let outputs = verify_credential_claim(
            secret,
            witness,
            credential_commitment,
            13,
            recipient,
            claim_hash_hi,
            claim_hash_lo,
            claim_kind,
        );

        assert(*outputs.at(0) == credential_commitment, 'config mismatch');
        assert(*outputs.at(3) == claim_hash_hi, 'claim hash hi mismatch');
        assert(*outputs.at(4) == claim_hash_lo, 'claim hash lo mismatch');
        assert(*outputs.at(6) == credential_commitment, 'credential commitment mismatch');
        assert(*outputs.at(7) == claim_kind, 'claim kind mismatch');
    }
}
