use crate::common::ApprovalStatus;
use crate::payment_tests::approved;
use crate::test_support::*;
use near_sdk::json_types::U128;
use near_sdk::test_utils::get_created_receipts;
use near_sdk::testing_env;

#[test]
fn payment_rejects_another_allowed_recipient() {
    let mut vault = approved();
    assert_rejects(
        || {
            drop(vault.pay("invoice-1".into(), account("bob.testnet"), PAYMENT));
        },
        "canonical recipient",
    );
    assert_eq!(
        vault.get_approval("invoice-1".into()).unwrap().status,
        ApprovalStatus::Approved
    );
    assert!(get_created_receipts().is_empty());
}

#[test]
fn payment_rejects_a_different_amount_within_the_generic_cap() {
    let mut vault = approved();
    assert_rejects(
        || {
            drop(vault.pay("invoice-1".into(), account("alice.testnet"), U128(21)));
        },
        "canonical amount",
    );
    assert_eq!(
        vault.get_approval("invoice-1".into()).unwrap().attempt_id.0,
        0
    );
    assert!(get_created_receipts().is_empty());
}

#[test]
fn a_second_worker_cannot_claim_a_pending_invoice() {
    let mut vault = approved();
    drop(vault.pay("invoice-1".into(), account("alice.testnet"), PAYMENT));
    testing_env!(context("operator.testnet", 2, 101, 0));
    assert_rejects(
        || {
            drop(vault.pay("invoice-1".into(), account("alice.testnet"), PAYMENT));
        },
        "Pending",
    );
    assert_eq!(
        vault.get_approval("invoice-1".into()).unwrap().attempt_id.0,
        1
    );
    assert!(get_created_receipts().is_empty());
}
