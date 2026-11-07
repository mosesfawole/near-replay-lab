use crate::common::ApprovalStatus;
use crate::test_support::*;
use near_sdk::json_types::U128;
use near_sdk::mock::MockAction;
use near_sdk::test_utils::get_created_receipts;
use near_sdk::{serde_json, testing_env};

pub fn approved() -> crate::ContractUnderTest {
    reset();
    let mut vault = crate::ContractUnderTest::new(
        account("operator.testnet"),
        vec![worker(1), worker(2)],
        vec![account("alice.testnet"), account("bob.testnet")],
        U128(100),
    );
    vault.approve(
        "invoice-1".into(),
        account("alice.testnet"),
        PAYMENT,
        EXPIRY,
    );
    vault
}

#[test]
fn legitimate_worker_claim_stores_pending_and_schedules_exact_native_transfer() {
    let mut vault = approved();
    drop(vault.pay("invoice-1".into(), account("alice.testnet"), PAYMENT));
    let approval = vault.get_approval("invoice-1".into()).unwrap();
    assert_eq!(approval.status, ApprovalStatus::Pending);
    assert_eq!(approval.attempt_id.0, 1);
    assert_eq!(approval.completed_payment_count.0, 0);
    let receipts = get_created_receipts();
    assert_eq!(receipts.len(), 2);
    assert_eq!(receipts[0].receiver_id, account("alice.testnet"));
    assert!(
        matches!(receipts[0].actions.as_slice(), [MockAction::Transfer { deposit, .. }] if deposit.as_yoctonear() == 20)
    );
    assert_eq!(receipts[1].receiver_id, account("vault.testnet"));
    assert_eq!(receipts[1].receipt_indices, vec![0]);
    match &receipts[1].actions[0] {
        MockAction::FunctionCallWeight {
            method_name,
            args,
            attached_deposit,
            prepaid_gas,
            ..
        } => {
            assert_eq!(method_name, b"on_transfer");
            assert_eq!(attached_deposit.as_yoctonear(), 0);
            assert_eq!(prepaid_gas.as_gas(), 10_000_000_000_000);
            assert_eq!(
                serde_json::from_slice::<serde_json::Value>(args).unwrap(),
                serde_json::json!({
                    "invoice_id": "invoice-1", "attempt_id": "1", "recipient": "alice.testnet", "amount_yocto": "20"
                })
            );
        }
        other => panic!("expected transfer callback action, got {other:?}"),
    }
}

#[test]
fn a_second_configured_worker_key_can_claim_an_independent_invoice() {
    let mut vault = approved();
    vault.approve("invoice-2".into(), account("bob.testnet"), U128(30), EXPIRY);
    testing_env!(context("operator.testnet", 2, 100, 0));
    drop(vault.pay("invoice-2".into(), account("bob.testnet"), U128(30)));
    let approval = vault.get_approval("invoice-2".into()).unwrap();
    assert_eq!(approval.status, ApprovalStatus::Pending);
    assert_eq!(approval.attempt_id.0, 1);
    assert_eq!(
        get_created_receipts()[0].receiver_id,
        account("bob.testnet")
    );
}

#[test]
fn payment_rejects_an_unauthorized_predecessor_even_with_a_worker_key() {
    let mut vault = approved();
    testing_env!(context("attacker.testnet", 1, 100, 0));
    assert_rejects(
        || {
            drop(vault.pay("invoice-1".into(), account("alice.testnet"), PAYMENT));
        },
        "owner",
    );
    assert_eq!(
        vault.get_approval("invoice-1".into()).unwrap().status,
        ApprovalStatus::Approved
    );
    assert!(get_created_receipts().is_empty());
}

#[test]
fn payment_rejects_the_owner_with_an_unconfigured_signing_key() {
    let mut vault = approved();
    testing_env!(context("operator.testnet", 3, 100, 0));
    assert_rejects(
        || {
            drop(vault.pay("invoice-1".into(), account("alice.testnet"), PAYMENT));
        },
        "worker key",
    );
    assert_eq!(
        vault.get_approval("invoice-1".into()).unwrap().attempt_id.0,
        0
    );
    assert!(get_created_receipts().is_empty());
}

#[test]
fn payment_rejects_any_attached_deposit() {
    let mut vault = approved();
    testing_env!(context("operator.testnet", 1, 100, 1));
    assert_rejects(
        || {
            drop(vault.pay("invoice-1".into(), account("alice.testnet"), PAYMENT));
        },
        "deposit",
    );
    assert!(get_created_receipts().is_empty());
}

#[test]
fn payment_rejects_an_unknown_approval() {
    let mut vault = approved();
    assert_rejects(
        || {
            drop(vault.pay("unknown".into(), account("alice.testnet"), PAYMENT));
        },
        "unknown approval",
    );
    assert!(get_created_receipts().is_empty());
}

#[test]
fn payment_rejects_an_unallowed_recipient() {
    let mut vault = approved();
    assert_rejects(
        || {
            drop(vault.pay("invoice-1".into(), account("mallory.testnet"), PAYMENT));
        },
        "allowlist",
    );
    assert!(get_created_receipts().is_empty());
}

#[test]
fn payment_rejects_zero_amount() {
    let mut vault = approved();
    assert_rejects(
        || {
            drop(vault.pay("invoice-1".into(), account("alice.testnet"), U128(0)));
        },
        "nonzero",
    );
    assert!(get_created_receipts().is_empty());
}

#[test]
fn payment_rejects_an_amount_above_the_generic_cap() {
    let mut vault = approved();
    assert_rejects(
        || {
            drop(vault.pay("invoice-1".into(), account("alice.testnet"), U128(101)));
        },
        "cap",
    );
    assert!(get_created_receipts().is_empty());
}

#[test]
fn payment_rejects_an_expired_approval_at_the_exact_boundary() {
    let mut vault = approved();
    testing_env!(context("operator.testnet", 1, 200, 0));
    assert_rejects(
        || {
            drop(vault.pay("invoice-1".into(), account("alice.testnet"), PAYMENT));
        },
        "expired",
    );
    assert_eq!(
        vault.get_approval("invoice-1".into()).unwrap().status,
        ApprovalStatus::Approved
    );
    assert!(get_created_receipts().is_empty());
}

#[test]
fn a_missing_callback_leaves_the_claim_pending() {
    let mut vault = approved();
    drop(vault.pay("invoice-1".into(), account("alice.testnet"), PAYMENT));
    testing_env!(context("operator.testnet", 2, 300, 0));
    let approval = vault.get_approval("invoice-1".into()).unwrap();
    assert_eq!(approval.status, ApprovalStatus::Pending);
    assert_eq!(approval.attempt_id.0, 1);
    assert_eq!(approval.completed_payment_count.0, 0);
    assert!(approval.last_completed_recipient.is_none());
}

#[test]
fn a_pending_claim_survives_saved_state_and_a_fresh_execution_context() {
    let mut vault = approved();
    drop(vault.pay("invoice-1".into(), account("alice.testnet"), PAYMENT));
    near_sdk::env::state_write(&vault);
    drop(vault);
    testing_env!(context("operator.testnet", 2, 101, 0));
    let reloaded: crate::ContractUnderTest = near_sdk::env::state_read().unwrap();
    let approval = reloaded.get_approval("invoice-1".into()).unwrap();
    assert_eq!(approval.status, ApprovalStatus::Pending);
    assert_eq!(approval.attempt_id.0, 1);
    assert_eq!(approval.amount_yocto.0, 20);
    assert_eq!(approval.completed_payment_count.0, 0);
}

#[test]
fn amounts_beyond_u64_and_javascript_precision_remain_exact_in_transfer_and_json() {
    reset();
    let mut vault = crate::ContractUnderTest::new(
        account("operator.testnet"),
        vec![worker(1)],
        vec![account("alice.testnet")],
        U128(18_446_744_073_709_551_617),
    );
    vault.approve(
        "invoice-big".into(),
        account("alice.testnet"),
        U128(18_446_744_073_709_551_617),
        near_sdk::json_types::U64(4_000_000_000_000_000_000),
    );
    drop(vault.pay(
        "invoice-big".into(),
        account("alice.testnet"),
        U128(18_446_744_073_709_551_617),
    ));
    let view = serde_json::to_value(vault.get_approval("invoice-big".into()).unwrap()).unwrap();
    assert_eq!(view["amount_yocto"], "18446744073709551617");
    assert_eq!(view["expires_at_ns"], "4000000000000000000");
    let receipts = get_created_receipts();
    assert!(
        matches!(receipts[0].actions.as_slice(), [MockAction::Transfer { deposit, .. }] if deposit.as_yoctonear() == 18_446_744_073_709_551_617)
    );
    match &receipts[1].actions[0] {
        MockAction::FunctionCallWeight { args, .. } => {
            let callback: serde_json::Value = serde_json::from_slice(args).unwrap();
            assert_eq!(callback["amount_yocto"], "18446744073709551617");
        }
        other => panic!("expected callback, got {other:?}"),
    }
}
