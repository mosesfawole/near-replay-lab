use crate::test_support::*;
use near_sdk::json_types::{U64, U128};
use near_sdk::{PublicKey, serde_json, testing_env};

#[cfg(test)]
fn fixture() -> impl_contract::Vault {
    reset();
    impl_contract::Vault::new(
        account("operator.testnet"),
        vec![worker(1), worker(2)],
        vec![account("alice.testnet"), account("bob.testnet")],
        U128(100),
    )
}

mod impl_contract {
    #[cfg(test)]
    pub type Vault = super::super::ContractUnderTest;
}

#[test]
fn canonical_approval_exposes_exact_decimal_fields() {
    let mut vault = fixture();
    vault.approve(
        "invoice-1".into(),
        account("alice.testnet"),
        PAYMENT,
        EXPIRY,
    );
    let view = serde_json::to_value(vault.get_approval("invoice-1".into()).unwrap()).unwrap();
    assert_eq!(
        view,
        serde_json::json!({
            "invoice_id": "invoice-1", "recipient": "alice.testnet", "amount_yocto": "20",
            "expires_at_ns": "200", "status": "Approved", "attempt_id": "0", "completed_payment_count": "0",
            "last_completed_recipient": null, "last_completed_amount_yocto": null
        })
    );
    assert!(vault.get_approval("unknown".into()).is_none());
}

#[test]
fn public_config_returns_two_distinct_worker_keys_and_generic_limits() {
    let vault = fixture();
    let config = vault.get_config();
    assert_eq!(config.owner_id, account("operator.testnet"));
    assert_eq!(config.worker_public_keys, vec![worker(1), worker(2)]);
    assert_eq!(
        config.allowed_recipients,
        vec![account("alice.testnet"), account("bob.testnet")]
    );
    assert_eq!(
        serde_json::to_value(config.max_payment_yocto).unwrap(),
        "100"
    );
}

#[test]
fn approval_requires_owner_predecessor() {
    let mut vault = fixture();
    testing_env!(context("attacker.testnet", 1, 100, 0));
    assert_rejects(
        || {
            vault.approve(
                "invoice-1".into(),
                account("alice.testnet"),
                PAYMENT,
                EXPIRY,
            )
        },
        "owner",
    );
    assert!(vault.get_approval("invoice-1".into()).is_none());
}

#[test]
fn approval_rejects_existing_identifier_without_replacing_it() {
    let mut vault = fixture();
    vault.approve(
        "invoice-1".into(),
        account("alice.testnet"),
        PAYMENT,
        EXPIRY,
    );
    assert_rejects(
        || {
            vault.approve(
                "invoice-1".into(),
                account("bob.testnet"),
                U128(40),
                U64(300),
            )
        },
        "already exists",
    );
    let view = vault.get_approval("invoice-1".into()).unwrap();
    assert_eq!(view.recipient, account("alice.testnet"));
    assert_eq!(view.amount_yocto.0, 20);
    assert_eq!(view.expires_at_ns.0, 200);
}

#[test]
fn approval_rejects_zero_amount() {
    let mut vault = fixture();
    assert_rejects(
        || {
            vault.approve(
                "invoice-1".into(),
                account("alice.testnet"),
                U128(0),
                EXPIRY,
            )
        },
        "nonzero",
    );
}

#[test]
fn approval_rejects_amount_above_generic_cap() {
    let mut vault = fixture();
    assert_rejects(
        || {
            vault.approve(
                "invoice-1".into(),
                account("alice.testnet"),
                U128(101),
                EXPIRY,
            )
        },
        "cap",
    );
}

#[test]
fn approval_rejects_unallowed_recipient() {
    let mut vault = fixture();
    assert_rejects(
        || {
            vault.approve(
                "invoice-1".into(),
                account("mallory.testnet"),
                PAYMENT,
                EXPIRY,
            )
        },
        "allowlist",
    );
}

#[test]
fn approval_rejects_expiry_at_or_before_current_block() {
    let mut vault = fixture();
    for expiry in [99, 100] {
        assert_rejects(
            || {
                vault.approve(
                    format!("invoice-{expiry}"),
                    account("alice.testnet"),
                    PAYMENT,
                    U64(expiry),
                )
            },
            "expiry",
        );
    }
}

#[test]
fn approval_identifier_and_total_state_are_bounded() {
    let mut vault = fixture();
    assert_rejects(
        || vault.approve(String::new(), account("alice.testnet"), PAYMENT, EXPIRY),
        "identifier",
    );
    assert_rejects(
        || vault.approve("x".repeat(129), account("alice.testnet"), PAYMENT, EXPIRY),
        "identifier",
    );
    for number in 0..256 {
        vault.approve(
            format!("invoice-{number}"),
            account("alice.testnet"),
            PAYMENT,
            EXPIRY,
        );
    }
    assert_rejects(
        || {
            vault.approve(
                "invoice-257".into(),
                account("alice.testnet"),
                PAYMENT,
                EXPIRY,
            )
        },
        "approval capacity",
    );
}

#[test]
fn configuration_rejects_empty_duplicate_or_excessive_lists() {
    reset();
    let create = |keys: Vec<PublicKey>, recipients| {
        impl_contract::Vault::new(account("operator.testnet"), keys, recipients, U128(100))
    };
    assert_rejects(
        || {
            create(vec![], vec![account("alice.testnet")]);
        },
        "worker",
    );
    assert_rejects(
        || {
            create(vec![worker(1); 17], vec![account("alice.testnet")]);
        },
        "worker",
    );
    assert_rejects(
        || {
            create(vec![worker(1), worker(1)], vec![account("alice.testnet")]);
        },
        "duplicate worker",
    );
    assert_rejects(
        || {
            create(vec![worker(1)], vec![]);
        },
        "recipient",
    );
    assert_rejects(
        || {
            create(vec![worker(1)], vec![account("alice.testnet"); 17]);
        },
        "recipient",
    );
    assert_rejects(
        || {
            create(
                vec![worker(1)],
                vec![account("alice.testnet"), account("alice.testnet")],
            );
        },
        "duplicate recipient",
    );
}

#[test]
fn configuration_rejects_zero_payment_cap() {
    reset();
    assert_rejects(
        || {
            impl_contract::Vault::new(
                account("operator.testnet"),
                vec![worker(1)],
                vec![account("alice.testnet")],
                U128(0),
            );
        },
        "nonzero",
    );
}
