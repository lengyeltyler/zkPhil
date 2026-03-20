/// Phil local-claim STARK proof program.
///
/// Outputs eight felts:
/// [0] verifier_config_hash
/// [1] proof_context
/// [2] recipient
/// [3] claim_hash_hi
/// [4] claim_hash_lo
/// [5] identity_nullifier
/// [6] credential_commitment
/// [7] claim_kind

pub mod credential;

use credential::{CommitmentWitness, verify_humanity_claim};
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

    let commitment_root = input_at(@input, i);
    i += 1;
    let proof_context = input_at(@input, i);
    i += 1;
    let recipient = input_at(@input, i);
    i += 1;
    let claim_hash_hi = input_at(@input, i);
    i += 1;
    let claim_hash_lo = input_at(@input, i);
    i += 1;
    let claim_kind = input_at(@input, i);
    i += 1;
    let provider_mode = input_at(@input, i);
    i += 1;
    let identity_subject = input_at(@input, i);

    let witness = CommitmentWitness { siblings, path_indices };
    verify_humanity_claim(
        secret,
        witness,
        commitment_root,
        proof_context,
        recipient,
        claim_hash_hi,
        claim_hash_lo,
        claim_kind,
        provider_mode,
        identity_subject,
    )
}
