use crate::common::ApprovalStatus;
use crate::payment_tests::approved;
use crate::test_support::*;
use near_sdk::json_types::U64;
use near_sdk::{PromiseResult, RuntimeFeesConfig, test_vm_config, testing_env};

pub fn callback_environment(results: Vec<PromiseResult>, timestamp: u64) {
    testing_env!(
        context("vault.testnet", 1, timestamp, 0),
        test_vm_config(),
        RuntimeFeesConfig::test(),
        Default::default(),
        results,
    );
}

#[test]
fn successful_raw_result_marks_paid_and_records_exact_completed_transfer() {
    let mut vault = approved();
    drop(vault.pay("invoice-1".into(), account("alice.testnet"), PAYMENT));
    callback_environment(
        vec![PromiseResult::Successful(b"arbitrary-result-data".to_vec())],
        300,
    );
    vault.on_transfer(
        "invoice-1".into(),
        U64(1),
        account("alice.testnet"),
        PAYMENT,
    );
    let approval = vault.get_approval("invoice-1".into()).unwrap();
    assert_eq!(approval.status, ApprovalStatus::Paid);
    assert_eq!(approval.attempt_id.0, 1);
    assert_eq!(approval.completed_payment_count.0, 1);
    assert_eq!(
        approval.last_completed_recipient,
        Some(account("alice.testnet"))
    );
    assert_eq!(approval.last_completed_amount_yocto.unwrap().0, 20);
}

#[test]
fn a_proven_failed_raw_result_marks_failed_without_incrementing_completions() {
    let mut vault = approved();
    drop(vault.pay("invoice-1".into(), account("alice.testnet"), PAYMENT));
    callback_environment(vec![PromiseResult::Failed], 101);
    vault.on_transfer(
        "invoice-1".into(),
        U64(1),
        account("alice.testnet"),
        PAYMENT,
    );
    let approval = vault.get_approval("invoice-1".into()).unwrap();
    assert_eq!(approval.status, ApprovalStatus::Failed);
    assert_eq!(approval.attempt_id.0, 1);
    assert_eq!(approval.completed_payment_count.0, 0);
    assert!(approval.last_completed_recipient.is_none());
    assert!(approval.last_completed_amount_yocto.is_none());
}

#[test]
fn callback_rejects_a_nonprivate_predecessor_despite_a_success_result() {
    let mut vault = approved();
    drop(vault.pay("invoice-1".into(), account("alice.testnet"), PAYMENT));
    testing_env!(
        context("operator.testnet", 1, 101, 0),
        test_vm_config(),
        RuntimeFeesConfig::test(),
        Default::default(),
        vec![PromiseResult::Successful(vec![])],
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
        "private",
    );
    assert_eq!(
        vault.get_approval("invoice-1".into()).unwrap().status,
        ApprovalStatus::Pending
    );
    assert_eq!(
        vault
            .get_approval("invoice-1".into())
            .unwrap()
            .completed_payment_count
            .0,
        0
    );
}

#[test]
fn callback_without_a_raw_result_leaves_pending() {
    let mut vault = approved();
    drop(vault.pay("invoice-1".into(), account("alice.testnet"), PAYMENT));
    callback_environment(vec![], 101);
    assert_rejects(
        || {
            vault.on_transfer(
                "invoice-1".into(),
                U64(1),
                account("alice.testnet"),
                PAYMENT,
            )
        },
        "one transfer result",
    );
    assert_eq!(
        vault.get_approval("invoice-1".into()).unwrap().status,
        ApprovalStatus::Pending
    );
}

#[test]
fn callback_with_multiple_raw_results_leaves_pending() {
    let mut vault = approved();
    drop(vault.pay("invoice-1".into(), account("alice.testnet"), PAYMENT));
    callback_environment(
        vec![PromiseResult::Successful(vec![]), PromiseResult::Failed],
        101,
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
        "one transfer result",
    );
    assert_eq!(
        vault.get_approval("invoice-1".into()).unwrap().status,
        ApprovalStatus::Pending
    );
}

#[test]
fn callback_rejects_unissued_attempts_without_changing_pending() {
    let mut vault = approved();
    drop(vault.pay("invoice-1".into(), account("alice.testnet"), PAYMENT));
    callback_environment(vec![PromiseResult::Successful(vec![])], 101);
    for attempt_id in [0, 2] {
        assert_rejects(
            || {
                vault.on_transfer(
                    "invoice-1".into(),
                    U64(attempt_id),
                    account("alice.testnet"),
                    PAYMENT,
                )
            },
            "attempt",
        );
        let approval = vault.get_approval("invoice-1".into()).unwrap();
        assert_eq!(approval.status, ApprovalStatus::Pending);
        assert_eq!(approval.completed_payment_count.0, 0);
    }
}
