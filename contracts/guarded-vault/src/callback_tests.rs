use crate::callback_tests::callback_environment;
use crate::common::ApprovalStatus;
use crate::payment_tests::approved;
use crate::test_support::*;
use near_sdk::json_types::{U64, U128};
use near_sdk::test_utils::get_created_receipts;
use near_sdk::{PromiseResult, testing_env};

#[test]
fn callback_rejects_inconsistent_recipient_or_amount_and_preserves_pending() {
    let mut vault = approved();
    drop(vault.pay("invoice-1".into(), account("alice.testnet"), PAYMENT));
    callback_environment(vec![PromiseResult::Successful(vec![])], 101);
    assert_rejects(
        || vault.on_transfer("invoice-1".into(), U64(1), account("bob.testnet"), PAYMENT),
        "canonical recipient",
    );
    assert_rejects(
        || {
            vault.on_transfer(
                "invoice-1".into(),
                U64(1),
                account("alice.testnet"),
                U128(21),
            )
        },
        "canonical amount",
    );
    let approval = vault.get_approval("invoice-1".into()).unwrap();
    assert_eq!(approval.status, ApprovalStatus::Pending);
    assert_eq!(approval.completed_payment_count.0, 0);
    assert!(approval.last_completed_recipient.is_none());
}

#[test]
fn a_paid_invoice_rejects_a_new_worker_claim() {
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
    assert_rejects(
        || {
            drop(vault.pay("invoice-1".into(), account("alice.testnet"), PAYMENT));
        },
        "Paid",
    );
    let approval = vault.get_approval("invoice-1".into()).unwrap();
    assert_eq!(approval.status, ApprovalStatus::Paid);
    assert_eq!(approval.attempt_id.0, 1);
    assert_eq!(approval.completed_payment_count.0, 1);
    assert!(get_created_receipts().is_empty());
}

#[test]
fn a_proven_failure_allows_one_new_claim_and_rejects_the_stale_callback() {
    let mut vault = approved();
    drop(vault.pay("invoice-1".into(), account("alice.testnet"), PAYMENT));
    callback_environment(vec![PromiseResult::Failed], 101);
    vault.on_transfer(
        "invoice-1".into(),
        U64(1),
        account("alice.testnet"),
        PAYMENT,
    );
    testing_env!(context("operator.testnet", 2, 102, 0));
    drop(vault.pay("invoice-1".into(), account("alice.testnet"), PAYMENT));
    assert_eq!(
        vault.get_approval("invoice-1".into()).unwrap().attempt_id.0,
        2
    );
    callback_environment(vec![PromiseResult::Successful(vec![])], 103);
    assert_rejects(
        || {
            vault.on_transfer(
                "invoice-1".into(),
                U64(1),
                account("alice.testnet"),
                PAYMENT,
            )
        },
        "attempt",
    );
    assert_eq!(
        vault.get_approval("invoice-1".into()).unwrap().status,
        ApprovalStatus::Pending
    );
    vault.on_transfer(
        "invoice-1".into(),
        U64(2),
        account("alice.testnet"),
        PAYMENT,
    );
    let approval = vault.get_approval("invoice-1".into()).unwrap();
    assert_eq!(approval.status, ApprovalStatus::Paid);
    assert_eq!(approval.attempt_id.0, 2);
    assert_eq!(approval.completed_payment_count.0, 1);
}

#[test]
fn a_failed_invoice_cannot_be_retried_after_expiry() {
    let mut vault = approved();
    drop(vault.pay("invoice-1".into(), account("alice.testnet"), PAYMENT));
    callback_environment(vec![PromiseResult::Failed], 101);
    vault.on_transfer(
        "invoice-1".into(),
        U64(1),
        account("alice.testnet"),
        PAYMENT,
    );
    testing_env!(context("operator.testnet", 2, 200, 0));
    assert_rejects(
        || {
            drop(vault.pay("invoice-1".into(), account("alice.testnet"), PAYMENT));
        },
        "expired",
    );
    let approval = vault.get_approval("invoice-1".into()).unwrap();
    assert_eq!(approval.status, ApprovalStatus::Failed);
    assert_eq!(approval.attempt_id.0, 1);
    assert!(get_created_receipts().is_empty());
}

#[test]
fn an_already_completed_callback_cannot_increment_the_paid_count_again() {
    let mut vault = approved();
    drop(vault.pay("invoice-1".into(), account("alice.testnet"), PAYMENT));
    callback_environment(vec![PromiseResult::Successful(vec![])], 101);
    vault.on_transfer(
        "invoice-1".into(),
        U64(1),
        account("alice.testnet"),
        PAYMENT,
    );
    assert_rejects(
        || {
            vault.on_transfer(
                "invoice-1".into(),
                U64(1),
                account("alice.testnet"),
                PAYMENT,
            )
        },
        "Pending",
    );
    assert_eq!(
        vault
            .get_approval("invoice-1".into())
            .unwrap()
            .completed_payment_count
            .0,
        1
    );
}
