use crate::callback_tests::callback_environment;
use crate::common::ApprovalStatus;
use crate::payment_tests::approved;
use crate::test_support::*;
use near_sdk::json_types::{U64, U128};
use near_sdk::test_utils::get_created_receipts;
use near_sdk::{PromiseResult, testing_env};

#[test]
fn substituted_transfer_success_records_actual_completion_beside_canonical_approval() {
    let mut vault = approved();
    drop(vault.pay("invoice-1".into(), account("bob.testnet"), U128(40)));
    callback_environment(vec![PromiseResult::Successful(vec![])], 101);
    vault.on_transfer("invoice-1".into(), U64(1), account("bob.testnet"), U128(40));
    let approval = vault.get_approval("invoice-1".into()).unwrap();
    assert_eq!(approval.recipient, account("alice.testnet"));
    assert_eq!(approval.amount_yocto.0, 20);
    assert_eq!(approval.completed_payment_count.0, 1);
    assert_eq!(
        approval.last_completed_recipient,
        Some(account("bob.testnet"))
    );
    assert_eq!(approval.last_completed_amount_yocto.unwrap().0, 40);
}

#[test]
fn both_concurrent_successful_callbacks_count_even_when_completed_in_reverse_order() {
    let mut vault = approved();
    drop(vault.pay("invoice-1".into(), account("alice.testnet"), PAYMENT));
    testing_env!(context("operator.testnet", 2, 101, 0));
    drop(vault.pay("invoice-1".into(), account("bob.testnet"), U128(40)));
    callback_environment(vec![PromiseResult::Successful(vec![])], 102);
    vault.on_transfer("invoice-1".into(), U64(2), account("bob.testnet"), U128(40));
    assert_eq!(
        vault
            .get_approval("invoice-1".into())
            .unwrap()
            .completed_payment_count
            .0,
        1
    );
    callback_environment(vec![PromiseResult::Successful(vec![])], 103);
    vault.on_transfer(
        "invoice-1".into(),
        U64(1),
        account("alice.testnet"),
        PAYMENT,
    );
    let approval = vault.get_approval("invoice-1".into()).unwrap();
    assert_eq!(approval.status, ApprovalStatus::Paid);
    assert_eq!(approval.attempt_id.0, 2);
    assert_eq!(approval.completed_payment_count.0, 2);
    assert_eq!(
        approval.last_completed_recipient,
        Some(account("alice.testnet"))
    );
    assert_eq!(approval.last_completed_amount_yocto.unwrap().0, 20);
}

#[test]
fn a_paid_invoice_still_schedules_another_fresh_worker_request() {
    let mut vault = approved();
    drop(vault.pay("invoice-1".into(), account("alice.testnet"), PAYMENT));
    callback_environment(vec![PromiseResult::Successful(vec![])], 101);
    vault.on_transfer(
        "invoice-1".into(),
        U64(1),
        account("alice.testnet"),
        PAYMENT,
    );
    testing_env!(context("operator.testnet", 2, 102, 0));
    drop(vault.pay("invoice-1".into(), account("alice.testnet"), PAYMENT));
    let approval = vault.get_approval("invoice-1".into()).unwrap();
    assert_eq!(approval.status, ApprovalStatus::Pending);
    assert_eq!(approval.attempt_id.0, 2);
    assert_eq!(approval.completed_payment_count.0, 1);
    assert_eq!(get_created_receipts().len(), 2);
    callback_environment(vec![PromiseResult::Successful(vec![])], 103);
    vault.on_transfer(
        "invoice-1".into(),
        U64(2),
        account("alice.testnet"),
        PAYMENT,
    );
    assert_eq!(
        vault
            .get_approval("invoice-1".into())
            .unwrap()
            .completed_payment_count
            .0,
        2
    );
}

#[test]
fn a_failed_concurrent_callback_preserves_an_earlier_successful_completion() {
    let mut vault = approved();
    drop(vault.pay("invoice-1".into(), account("alice.testnet"), PAYMENT));
    testing_env!(context("operator.testnet", 2, 101, 0));
    drop(vault.pay("invoice-1".into(), account("bob.testnet"), U128(40)));
    callback_environment(vec![PromiseResult::Successful(vec![])], 102);
    vault.on_transfer(
        "invoice-1".into(),
        U64(1),
        account("alice.testnet"),
        PAYMENT,
    );
    callback_environment(vec![PromiseResult::Failed], 103);
    vault.on_transfer("invoice-1".into(), U64(2), account("bob.testnet"), U128(40));
    let approval = vault.get_approval("invoice-1".into()).unwrap();
    assert_eq!(approval.status, ApprovalStatus::Failed);
    assert_eq!(approval.attempt_id.0, 2);
    assert_eq!(approval.completed_payment_count.0, 1);
    assert_eq!(
        approval.last_completed_recipient,
        Some(account("alice.testnet"))
    );
    assert_eq!(approval.last_completed_amount_yocto.unwrap().0, 20);
}
