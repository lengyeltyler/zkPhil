/// SharpAccountV1 intent program.
///
/// Public output:
/// - intent_hash (u256 / bytes32)
///
/// Input order (all ABI words as u256):
/// 0: wallet
/// 1: smartAccount
/// 2: target
/// 3: callDataHash
/// 4: value
/// 5: nonce
/// 6: chainId
/// 7: secondFactorSecret
///
/// Semantics:
/// secondFactorCommitment = keccak256(secondFactorSecret)
/// intentHash = keccak256(
///   wallet,
///   smartAccount,
///   target,
///   callDataHash,
///   value,
///   nonce,
///   chainId,
///   secondFactorCommitment
/// )
use core::array::ArrayTrait;
use core::keccak::keccak_u256s_be_inputs;

fn input_at(input: @Array<u256>, idx: usize) -> u256 {
    assert(idx < input.len(), 'Input underflow');
    *input.at(idx)
}

#[executable]
fn main(input: Array<u256>) -> u256 {
    assert(input.len() == 8, 'Invalid input length');

    let wallet = input_at(@input, 0);
    let smart_account = input_at(@input, 1);
    let target = input_at(@input, 2);
    let call_data_hash = input_at(@input, 3);
    let value = input_at(@input, 4);
    let nonce = input_at(@input, 5);
    let chain_id = input_at(@input, 6);
    let second_factor_secret = input_at(@input, 7);

    // secondFactorCommitment = keccak256(abi.encode(secret_word))
    let mut second_factor_words = ArrayTrait::new();
    second_factor_words.append(second_factor_secret);
    let second_factor_commitment = keccak_u256s_be_inputs(@second_factor_words);

    let mut intent_words = ArrayTrait::new();
    intent_words.append(wallet);
    intent_words.append(smart_account);
    intent_words.append(target);
    intent_words.append(call_data_hash);
    intent_words.append(value);
    intent_words.append(nonce);
    intent_words.append(chain_id);
    intent_words.append(second_factor_commitment);

    keccak_u256s_be_inputs(@intent_words)
}
