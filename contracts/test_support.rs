#![allow(dead_code)]

use near_sdk::json_types::{U64, U128};
use near_sdk::test_utils::VMContextBuilder;
use near_sdk::{AccountId, NearToken, PublicKey, testing_env};

#[cfg(test)]
pub fn account(name: &str) -> AccountId {
    name.parse().unwrap()
}

pub fn worker(index: u8) -> PublicKey {
    let mut data = vec![0u8];
    data.extend([index; 32]);
    PublicKey::try_from(data).unwrap()
}

pub fn context(predecessor: &str, key: u8, timestamp: u64, deposit: u128) -> near_sdk::VMContext {
    VMContextBuilder::new()
        .current_account_id(account("vault.testnet"))
        .signer_account_id(account("operator.testnet"))
        .predecessor_account_id(account(predecessor))
        .signer_account_pk(worker(key))
        .block_timestamp(timestamp)
        .account_balance(NearToken::from_near(100))
        .attached_deposit(NearToken::from_yoctonear(deposit))
        .build()
}

pub fn reset() {
    near_sdk::mock::with_mocked_blockchain(|blockchain| {
        blockchain.take_storage();
    });
    testing_env!(context("operator.testnet", 1, 100, 0));
}

pub fn panic_message(operation: impl FnOnce()) -> String {
    let error = std::panic::catch_unwind(std::panic::AssertUnwindSafe(operation))
        .expect_err("operation must reject");
    if let Some(message) = error.downcast_ref::<String>() {
        message.clone()
    } else if let Some(message) = error.downcast_ref::<&str>() {
        (*message).to_string()
    } else {
        panic!("unexpected non-string panic")
    }
}

pub fn assert_rejects(operation: impl FnOnce(), reason: &str) {
    let message = panic_message(operation);
    assert!(
        message.contains(reason),
        "expected rejection containing {reason:?}, got {message:?}"
    );
}

pub const PAYMENT: U128 = U128(20);
pub const EXPIRY: U64 = U64(200);
