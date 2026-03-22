#[starknet::interface]
pub trait IPhilUnlockSender<TContractState> {
    fn owner(self: @TContractState) -> starknet::ContractAddress;
    fn l1_recipient(self: @TContractState) -> felt252;
    fn set_l1_recipient(ref self: TContractState, new_l1_recipient: felt252);
    fn emit_unlock_ticket(
        ref self: TContractState,
        vault: felt252,
        nonce: u64,
        valid_after: u32,
        valid_until: u32,
        scope: u32,
        constraints_hash_hi: felt252,
        constraints_hash_lo: felt252,
    );
}

#[starknet::contract]
pub mod PhilUnlockSender {
    use core::array::ArrayTrait;
    use starknet::storage::{StoragePointerReadAccess, StoragePointerWriteAccess};
    use starknet::{ContractAddress, SyscallResultTrait, get_caller_address};
    use starknet::syscalls::send_message_to_l1_syscall;

    const NOT_OWNER: felt252 = 'NOT_OWNER';
    const INVALID_L1_RECIPIENT: felt252 = 'BAD_L1_RECIPIENT';

    #[storage]
    struct Storage {
        owner: ContractAddress,
        l1_recipient: felt252,
    }

    #[event]
    #[derive(Drop, starknet::Event)]
    enum Event {
        L1RecipientUpdated: L1RecipientUpdated,
        UnlockTicketSent: UnlockTicketSent,
    }

    #[derive(Drop, starknet::Event)]
    struct L1RecipientUpdated {
        recipient: felt252,
    }

    #[derive(Drop, starknet::Event)]
    struct UnlockTicketSent {
        vault: felt252,
        nonce: u64,
        l1_recipient: felt252,
        scope: u32,
        constraints_hash_hi: felt252,
        constraints_hash_lo: felt252,
    }

    #[constructor]
    fn constructor(
        ref self: ContractState, owner: ContractAddress, l1_recipient: felt252
    ) {
        self.owner.write(owner);
        self.l1_recipient.write(l1_recipient);
    }

    fn assert_owner(self: @ContractState) {
        let caller = get_caller_address();
        let owner = self.owner.read();
        assert(caller == owner, NOT_OWNER);
    }

    fn assert_non_zero_l1_recipient(l1_recipient: felt252) {
        assert(l1_recipient != 0, INVALID_L1_RECIPIENT);
    }

    #[external(v0)]
    fn owner(self: @ContractState) -> ContractAddress {
        self.owner.read()
    }

    #[external(v0)]
    fn l1_recipient(self: @ContractState) -> felt252 {
        self.l1_recipient.read()
    }

    #[external(v0)]
    fn set_l1_recipient(ref self: ContractState, new_l1_recipient: felt252) {
        assert_owner(@self);
        assert_non_zero_l1_recipient(new_l1_recipient);
        self.l1_recipient.write(new_l1_recipient);
        self.emit(Event::L1RecipientUpdated(L1RecipientUpdated {
            recipient: new_l1_recipient,
        }));
    }

    #[external(v0)]
    fn emit_unlock_ticket(
        ref self: ContractState,
        vault: felt252,
        nonce: u64,
        valid_after: u32,
        valid_until: u32,
        scope: u32,
        constraints_hash_hi: felt252,
        constraints_hash_lo: felt252,
    ) {
        assert_owner(@self);

        let l1_recipient = self.l1_recipient.read();
        assert_non_zero_l1_recipient(l1_recipient);

        let mut payload = ArrayTrait::new();
        payload.append(vault);
        payload.append(nonce.into());
        payload.append(valid_after.into());
        payload.append(valid_until.into());
        payload.append(scope.into());
        payload.append(constraints_hash_hi);
        payload.append(constraints_hash_lo);

        send_message_to_l1_syscall(l1_recipient, payload.span()).unwrap_syscall();
        self.emit(Event::UnlockTicketSent(UnlockTicketSent {
            vault,
            nonce,
            l1_recipient,
            scope,
            constraints_hash_hi,
            constraints_hash_lo,
        }));
    }
}
