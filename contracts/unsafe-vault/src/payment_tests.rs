use crate::common::ApprovalStatus;
use crate::payment_tests::approved;
use crate::test_support::*;
use near_sdk::json_types::U128;
use near_sdk::mock::MockAction;
use near_sdk::test_utils::get_created_receipts;
use near_sdk::testing_env;

#[test]
fn payment_transfers_a_substituted_allowed_recipient_and_amount() {
    let mut vault = approved();
    drop(vault.pay("invoice-1".into(), account("bob.testnet"), U128(40)));
    let approval = vault.get_approval("invoice-1".into()).unwrap();
    assert_eq!(approval.recipient, account("alice.testnet"));
    assert_eq!(approval.amount_yocto.0, 20);
    assert_eq!(approval.status, ApprovalStatus::Pending);
    let receipts = get_created_receipts();
    assert_eq!(receipts[0].receiver_id, account("bob.testnet"));
    assert!(
        matches!(receipts[0].actions.as_slice(), [MockAction::Transfer { deposit, .. }] if deposit.as_yoctonear() == 40)
    );
}

#[test]
fn a_second_worker_schedules_a_second_transfer_while_the_first_is_pending() {
    let mut vault = approved();
    drop(vault.pay("invoice-1".into(), account("alice.testnet"), PAYMENT));
    assert_eq!(get_created_receipts().len(), 2);
    testing_env!(context("operator.testnet", 2, 101, 0));
    drop(vault.pay("invoice-1".into(), account("alice.testnet"), PAYMENT));
    let approval = vault.get_approval("invoice-1".into()).unwrap();
    assert_eq!(approval.attempt_id.0, 2);
    assert_eq!(approval.completed_payment_count.0, 0);
    assert_eq!(get_created_receipts().len(), 2);
}
