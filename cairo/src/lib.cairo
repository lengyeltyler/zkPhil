/// Phil local-claim STARK proof program.
///
/// Outputs nine felts:
/// [0] eligibility_root
/// [1] context_id
/// [2] recipient
/// [3] claim_hash_hi
/// [4] claim_hash_lo
/// [5] nullifier
/// [6] credential_slot
/// [7] credential_leaf
/// [8] claim_kind

pub mod eligibility;

use eligibility::{MerkleProof, verify_eligibility_claim};
use core::array::ArrayTrait;
use core::traits::TryInto;

fn input_at(input: @Array<felt252>, idx: usize) -> felt252 {
    assert(idx < input.len(), 'Input underflow');
    *input.at(idx)
}

#[executable]
fn main(input: Array<felt252>) -> Array<felt252> {
    let mut i: usize = 0;

    let secret = input_at(@input, i);
    i += 1;

    let credential_slot = input_at(@input, i);
    i += 1;

    let siblings_len_felt = input_at(@input, i);
    i += 1;
    let siblings_len: usize = siblings_len_felt.try_into().unwrap();
    let mut siblings = ArrayTrait::new();
    let mut s_idx: usize = 0;
    while s_idx < siblings_len {
        siblings.append(input_at(@input, i));
        i += 1;
        s_idx += 1;
    };

    let path_len_felt = input_at(@input, i);
    i += 1;
    let path_len: usize = path_len_felt.try_into().unwrap();
    let mut path_indices = ArrayTrait::new();
    let mut p_idx: usize = 0;
    while p_idx < path_len {
        path_indices.append(input_at(@input, i));
        i += 1;
        p_idx += 1;
    };

    let eligibility_root = input_at(@input, i);
    i += 1;
    let context_id = input_at(@input, i);
    i += 1;
    let recipient = input_at(@input, i);
    i += 1;
    let claim_hash_hi = input_at(@input, i);
    i += 1;
    let claim_hash_lo = input_at(@input, i);
    i += 1;
    let claim_kind = input_at(@input, i);

    let proof = MerkleProof { siblings, path_indices };
    verify_eligibility_claim(
        secret,
        credential_slot,
        proof,
        eligibility_root,
        context_id,
        recipient,
        claim_hash_hi,
        claim_hash_lo,
        claim_kind,
    )
}
