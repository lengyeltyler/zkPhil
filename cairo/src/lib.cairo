/// Phil Test13 Allowlist STARK Proof Program
///
/// This Cairo program proves:
/// 1. The prover knows a `secret` whose leaf exists in the allowlist Merkle tree
/// 2. The `nullifier` is correctly derived to prevent replay attacks
/// 3. The proof is bound to a specific `recipient` and `drop_id`
///
/// Outputs 6 felts for verification on Ethereum:
/// [0] root - Merkle root of allowlist (verified against contract)
/// [1] drop_id - Unique identifier for this drop (verified against contract)
/// [2] recipient - Address receiving the NFT (verified against mint params)
/// [3] nullifier - Prevents replay (burned on mint)
/// [4] leaf - Debug: computed leaf hash
/// [5] idx - Debug: leaf index in tree

pub mod allowlist;

use allowlist::{verify_allowlist, MerkleProof};
use core::traits::TryInto;
use core::array::ArrayTrait;

fn input_at(input: @Array<felt252>, idx: usize) -> felt252 {
    assert(idx < input.len(), 'Input underflow');
    *input.at(idx)
}

/// Main function - entry point for Atlantic execution
///
/// Input format (Atlantic Cairo 1):
/// A single Array<felt252> with this layout:
/// [ secret,
///   siblings_len, siblings...,
///   path_len, path_indices...,
///   root, drop_id, recipient ]
///
/// Output: Array of 6 felt252 values
#[executable]
fn main(
    input: Array<felt252>,
) -> Array<felt252> {
    let mut i: usize = 0;

    // secret
    let secret = input_at(@input, i);
    i += 1;

    // siblings
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

    // path indices
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

    // root, drop_id, recipient
    let root = input_at(@input, i);
    i += 1;
    let drop_id = input_at(@input, i);
    i += 1;
    let recipient = input_at(@input, i);

    // Build MerkleProof struct
    let proof = MerkleProof { siblings, path_indices };

    // Verify and return outputs
    verify_allowlist(secret, proof, root, drop_id, recipient)
}
