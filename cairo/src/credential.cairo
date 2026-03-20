/// Phil local credential verification module.
///
/// The current provider binds a private credential secret to a recipient and
/// proves inclusion of the resulting commitment inside a provider config hash.
/// That config hash is currently a Merkle root, but the surrounding
/// architecture treats it as a verifier detail rather than the product model.
///
/// Dev/test mock-humanity mode reuses the same proving surface, but swaps the
/// identity subject from `recipient` to a deterministic `mock_human_id_hash`.

use core::array::ArrayTrait;
use core::pedersen::pedersen;

const PROVIDER_MODE_LOCAL_CREDENTIAL: felt252 = 1;
const PROVIDER_MODE_MOCK_HUMANITY: felt252 = 2;
const DOMAIN_LOCAL_COMMITMENT: felt252 = 1;
const DOMAIN_LOCAL_NULLIFIER: felt252 = 2;
const DOMAIN_MOCK_COMMITMENT: felt252 = 3;
const DOMAIN_MOCK_NULLIFIER: felt252 = 4;

#[derive(Drop, Serde)]
pub struct CommitmentWitness {
    pub siblings: Array<felt252>,
    pub path_indices: Array<felt252>,
}

pub fn verify_humanity_claim(
    secret: felt252,
    witness: CommitmentWitness,
    verifier_config_hash: felt252,
    proof_context: felt252,
    recipient: felt252,
    claim_hash_hi: felt252,
    claim_hash_lo: felt252,
    claim_kind: felt252,
    provider_mode: felt252,
    identity_subject: felt252,
) -> Array<felt252> {
    let credential_commitment = compute_provider_commitment(secret, identity_subject, provider_mode);
    let computed_root = compute_commitment_root(credential_commitment, @witness);
    assert(computed_root == verifier_config_hash, 'Invalid commitment witness');

    let identity_nullifier =
        compute_provider_identity_nullifier(secret, proof_context, identity_subject, claim_kind, provider_mode);

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
    verify_humanity_claim(
        secret,
        witness,
        verifier_config_hash,
        proof_context,
        recipient,
        claim_hash_hi,
        claim_hash_lo,
        claim_kind,
        PROVIDER_MODE_LOCAL_CREDENTIAL,
        recipient,
    )
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

fn provider_domains(provider_mode: felt252) -> (felt252, felt252) {
    if provider_mode == PROVIDER_MODE_LOCAL_CREDENTIAL {
        (DOMAIN_LOCAL_COMMITMENT, DOMAIN_LOCAL_NULLIFIER)
    } else {
        assert(provider_mode == PROVIDER_MODE_MOCK_HUMANITY, 'Unsupported provider mode');
        (DOMAIN_MOCK_COMMITMENT, DOMAIN_MOCK_NULLIFIER)
    }
}

pub fn compute_provider_commitment(
    secret: felt252,
    identity_subject: felt252,
    provider_mode: felt252,
) -> felt252 {
    let (commitment_domain, _) = provider_domains(provider_mode);
    pedersen(commitment_domain, pedersen(secret, identity_subject))
}

pub fn compute_credential_commitment(secret: felt252, recipient: felt252) -> felt252 {
    compute_provider_commitment(secret, recipient, PROVIDER_MODE_LOCAL_CREDENTIAL)
}

pub fn compute_provider_identity_nullifier(
    secret: felt252,
    proof_context: felt252,
    identity_subject: felt252,
    claim_kind: felt252,
    provider_mode: felt252,
) -> felt252 {
    let (_, nullifier_domain) = provider_domains(provider_mode);
    let context_binding = pedersen(proof_context, identity_subject);
    let kind_binding = pedersen(claim_kind, context_binding);
    let secret_binding = pedersen(secret, kind_binding);
    pedersen(nullifier_domain, secret_binding)
}

pub fn compute_identity_nullifier(
    secret: felt252,
    proof_context: felt252,
    recipient: felt252,
    claim_kind: felt252,
) -> felt252 {
    compute_provider_identity_nullifier(
        secret,
        proof_context,
        recipient,
        claim_kind,
        PROVIDER_MODE_LOCAL_CREDENTIAL,
    )
}

#[cfg(test)]
mod tests {
    use super::{
        CommitmentWitness,
        DOMAIN_LOCAL_COMMITMENT,
        DOMAIN_LOCAL_NULLIFIER,
        DOMAIN_MOCK_COMMITMENT,
        DOMAIN_MOCK_NULLIFIER,
        PROVIDER_MODE_MOCK_HUMANITY,
        compute_provider_commitment,
        compute_provider_identity_nullifier,
        compute_credential_commitment,
        compute_identity_nullifier,
        verify_humanity_claim,
        verify_credential_claim,
    };
    use core::array::ArrayTrait;
    use core::pedersen::pedersen;

    #[test]
    fn test_compute_credential_commitment_binds_recipient() {
        let secret: felt252 = 12345;
        let recipient: felt252 = 0x1234;
        let expected = pedersen(DOMAIN_LOCAL_COMMITMENT, pedersen(secret, recipient));
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
            DOMAIN_LOCAL_NULLIFIER,
            pedersen(secret, pedersen(claim_kind, pedersen(proof_context, recipient))),
        );
        let identity_nullifier = compute_identity_nullifier(secret, proof_context, recipient, claim_kind);
        assert(identity_nullifier == expected, 'Nullifier computation failed');
    }

    #[test]
    fn test_mock_humanity_domains_are_separated_from_local_provider() {
        let secret: felt252 = 777;
        let mock_human_id_hash: felt252 = 0x123456789;
        let proof_context: felt252 = 13;
        let claim_kind: felt252 = 1;

        let mock_commitment =
            compute_provider_commitment(secret, mock_human_id_hash, PROVIDER_MODE_MOCK_HUMANITY);
        let mock_nullifier = compute_provider_identity_nullifier(
            secret,
            proof_context,
            mock_human_id_hash,
            claim_kind,
            PROVIDER_MODE_MOCK_HUMANITY,
        );

        assert(
            mock_commitment == pedersen(DOMAIN_MOCK_COMMITMENT, pedersen(secret, mock_human_id_hash)),
            'Mock commitment domain mismatch',
        );
        assert(
            mock_nullifier == pedersen(
                DOMAIN_MOCK_NULLIFIER,
                pedersen(secret, pedersen(claim_kind, pedersen(proof_context, mock_human_id_hash))),
            ),
            'Mock nullifier domain mismatch',
        );
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

    #[test]
    fn test_mock_humanity_claim_outputs_preserve_recipient_binding_in_public_outputs() {
        let secret: felt252 = 42;
        let recipient: felt252 = 0xabcdef;
        let mock_human_id_hash: felt252 = 0x1234;
        let claim_hash_hi: felt252 = 12;
        let claim_hash_lo: felt252 = 34;
        let claim_kind: felt252 = 1;
        let humanity_commitment =
            compute_provider_commitment(secret, mock_human_id_hash, PROVIDER_MODE_MOCK_HUMANITY);

        let witness = CommitmentWitness {
            siblings: ArrayTrait::new(),
            path_indices: ArrayTrait::new(),
        };

        let outputs = verify_humanity_claim(
            secret,
            witness,
            humanity_commitment,
            13,
            recipient,
            claim_hash_hi,
            claim_hash_lo,
            claim_kind,
            PROVIDER_MODE_MOCK_HUMANITY,
            mock_human_id_hash,
        );

        assert(*outputs.at(0) == humanity_commitment, 'config mismatch');
        assert(*outputs.at(2) == recipient, 'recipient output mismatch');
        assert(*outputs.at(6) == humanity_commitment, 'humanity commitment mismatch');
    }
}
