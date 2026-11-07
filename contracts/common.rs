use near_sdk::borsh::{BorshDeserialize, BorshSerialize};
use near_sdk::json_types::{U64, U128};
use near_sdk::serde::{Deserialize, Serialize};
use near_sdk::store::LookupMap;
use near_sdk::{AccountId, PromiseResult, PublicKey, env, require};

const MAX_WORKERS: usize = 16;
const MAX_RECIPIENTS: usize = 16;
const MAX_APPROVALS: u32 = 256;
const MAX_INVOICE_BYTES: usize = 128;

#[derive(BorshDeserialize, BorshSerialize, Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[borsh(crate = "near_sdk::borsh")]
#[serde(crate = "near_sdk::serde")]
pub enum ApprovalStatus {
    Approved,
    Pending,
    Paid,
    Failed,
}

#[derive(Serialize, Deserialize, Debug)]
#[serde(crate = "near_sdk::serde")]
pub struct ApprovalView {
    pub invoice_id: String,
    pub recipient: AccountId,
    pub amount_yocto: U128,
    pub expires_at_ns: U64,
    pub status: ApprovalStatus,
    pub attempt_id: U64,
    pub completed_payment_count: U64,
    pub last_completed_recipient: Option<AccountId>,
    pub last_completed_amount_yocto: Option<U128>,
}

#[derive(Serialize, Deserialize, Debug)]
#[serde(crate = "near_sdk::serde")]
pub struct ConfigView {
    pub owner_id: AccountId,
    pub worker_public_keys: Vec<PublicKey>,
    pub allowed_recipients: Vec<AccountId>,
    pub max_payment_yocto: U128,
}

#[derive(BorshDeserialize, BorshSerialize)]
#[borsh(crate = "near_sdk::borsh")]
pub struct FixtureState {
    owner_id: AccountId,
    worker_public_keys: Vec<PublicKey>,
    allowed_recipients: Vec<AccountId>,
    max_payment_yocto: u128,
    approvals: LookupMap<String, Approval>,
    approval_count: u32,
}

#[derive(BorshDeserialize, BorshSerialize, Clone)]
#[borsh(crate = "near_sdk::borsh")]
struct Approval {
    recipient: AccountId,
    amount_yocto: u128,
    expires_at_ns: u64,
    status: ApprovalStatus,
    attempt_id: u64,
    completed_payment_count: u64,
    last_completed_recipient: Option<AccountId>,
    last_completed_amount_yocto: Option<u128>,
}

impl FixtureState {
    pub fn new(
        owner_id: AccountId,
        worker_public_keys: Vec<PublicKey>,
        allowed_recipients: Vec<AccountId>,
        max_payment_yocto: U128,
    ) -> Self {
        require!(
            !worker_public_keys.is_empty() && worker_public_keys.len() <= MAX_WORKERS,
            "worker list must contain 1..16 keys"
        );
        for (index, key) in worker_public_keys.iter().enumerate() {
            require!(
                !worker_public_keys[..index].contains(key),
                "duplicate worker key"
            );
        }
        require!(
            !allowed_recipients.is_empty() && allowed_recipients.len() <= MAX_RECIPIENTS,
            "recipient list must contain 1..16 accounts"
        );
        for (index, recipient) in allowed_recipients.iter().enumerate() {
            require!(
                !allowed_recipients[..index].contains(recipient),
                "duplicate recipient"
            );
        }
        require!(max_payment_yocto.0 > 0, "payment cap must be nonzero");
        Self {
            owner_id,
            worker_public_keys,
            allowed_recipients,
            max_payment_yocto: max_payment_yocto.0,
            approvals: LookupMap::new(b"approvals".to_vec()),
            approval_count: 0,
        }
    }

    pub fn approve(
        &mut self,
        invoice_id: String,
        recipient: AccountId,
        amount_yocto: U128,
        expires_at_ns: U64,
    ) {
        self.assert_owner();
        Self::validate_invoice_id(&invoice_id);
        require!(
            !self.approvals.contains_key(&invoice_id),
            "approval already exists"
        );
        require!(
            self.approval_count < MAX_APPROVALS,
            "approval capacity reached"
        );
        self.validate_payment(&recipient, amount_yocto.0);
        require!(
            expires_at_ns.0 > env::block_timestamp(),
            "approval expiry must be in the future"
        );
        self.approvals.insert(
            invoice_id,
            Approval {
                recipient,
                amount_yocto: amount_yocto.0,
                expires_at_ns: expires_at_ns.0,
                status: ApprovalStatus::Approved,
                attempt_id: 0,
                completed_payment_count: 0,
                last_completed_recipient: None,
                last_completed_amount_yocto: None,
            },
        );
        self.approval_count += 1;
    }

    pub fn get_config(&self) -> ConfigView {
        ConfigView {
            owner_id: self.owner_id.clone(),
            worker_public_keys: self.worker_public_keys.clone(),
            allowed_recipients: self.allowed_recipients.clone(),
            max_payment_yocto: U128(self.max_payment_yocto),
        }
    }

    pub fn get_approval(&self, invoice_id: String) -> Option<ApprovalView> {
        self.approvals
            .get(&invoice_id)
            .map(|approval| ApprovalView {
                invoice_id,
                recipient: approval.recipient.clone(),
                amount_yocto: U128(approval.amount_yocto),
                expires_at_ns: U64(approval.expires_at_ns),
                status: approval.status.clone(),
                attempt_id: U64(approval.attempt_id),
                completed_payment_count: U64(approval.completed_payment_count),
                last_completed_recipient: approval.last_completed_recipient.clone(),
                last_completed_amount_yocto: approval.last_completed_amount_yocto.map(U128),
            })
    }

    pub fn claim(
        &mut self,
        invoice_id: &str,
        recipient: &AccountId,
        amount: u128,
        guarded: bool,
    ) -> u64 {
        self.assert_owner();
        require!(
            self.worker_public_keys.contains(&env::signer_account_pk()),
            "configured worker key required"
        );
        require!(
            env::attached_deposit().as_yoctonear() == 0,
            "attached deposit is not accepted"
        );
        Self::validate_invoice_id(invoice_id);
        self.validate_payment(recipient, amount);
        let invoice_id = invoice_id.to_string();
        let mut approval = self
            .approvals
            .get(&invoice_id)
            .cloned()
            .unwrap_or_else(|| env::panic_str("unknown approval"));
        require!(
            env::block_timestamp() < approval.expires_at_ns,
            "approval is expired"
        );
        if guarded {
            require!(
                recipient == &approval.recipient,
                "canonical recipient required"
            );
            require!(amount == approval.amount_yocto, "canonical amount required");
            require!(
                approval.status != ApprovalStatus::Pending,
                "Pending approval cannot be claimed"
            );
            require!(
                approval.status != ApprovalStatus::Paid,
                "Paid approval cannot be claimed"
            );
        }
        let attempt_id = approval
            .attempt_id
            .checked_add(1)
            .unwrap_or_else(|| env::panic_str("attempt id exhausted"));
        approval.attempt_id = attempt_id;
        // This claim is stored before the contract constructs the outgoing promise.
        approval.status = ApprovalStatus::Pending;
        self.approvals.insert(invoice_id, approval);
        attempt_id
    }

    pub fn on_transfer(
        &mut self,
        invoice_id: &str,
        attempt_id: u64,
        recipient: AccountId,
        amount: u128,
        guarded: bool,
    ) {
        // The exported method is #[private]; this also guards direct method calls.
        near_sdk::assert_self();
        require!(
            env::promise_results_count() == 1,
            "callback requires one transfer result"
        );
        Self::validate_invoice_id(invoice_id);
        self.validate_payment(&recipient, amount);
        let invoice_id = invoice_id.to_string();
        let mut approval = self
            .approvals
            .get(&invoice_id)
            .cloned()
            .unwrap_or_else(|| env::panic_str("unknown approval"));
        if guarded {
            require!(
                approval.status == ApprovalStatus::Pending,
                "callback requires Pending approval"
            );
            require!(
                attempt_id > 0 && attempt_id == approval.attempt_id,
                "callback attempt does not match Pending claim"
            );
            require!(
                recipient == approval.recipient,
                "canonical recipient required"
            );
            require!(amount == approval.amount_yocto, "canonical amount required");
        } else {
            // Intentionally accept older issued attempts: unsafe concurrent transfers
            // each have their own callback, regardless of the latest status/attempt.
            require!(
                attempt_id > 0 && attempt_id <= approval.attempt_id,
                "callback attempt was not issued"
            );
        }
        // This contract only schedules native transfers, whose result payload is
        // empty. Deliberately inspect the raw variant rather than a supplied flag.
        #[allow(deprecated)]
        let result = env::promise_result(0);
        match result {
            PromiseResult::Successful(_) => {
                approval.completed_payment_count = approval
                    .completed_payment_count
                    .checked_add(1)
                    .unwrap_or_else(|| env::panic_str("completion count exhausted"));
                approval.last_completed_recipient = Some(recipient);
                approval.last_completed_amount_yocto = Some(amount);
                approval.status = ApprovalStatus::Paid;
            }
            PromiseResult::Failed => {
                approval.status = ApprovalStatus::Failed;
            }
        }
        self.approvals.insert(invoice_id, approval);
    }

    fn assert_owner(&self) {
        require!(
            env::predecessor_account_id() == self.owner_id,
            "owner predecessor required"
        );
    }

    fn validate_invoice_id(invoice_id: &str) {
        require!(
            !invoice_id.is_empty() && invoice_id.len() <= MAX_INVOICE_BYTES,
            "identifier must contain 1..128 UTF-8 bytes"
        );
    }

    fn validate_payment(&self, recipient: &AccountId, amount: u128) {
        require!(
            self.allowed_recipients.contains(recipient),
            "recipient is not in the allowlist"
        );
        require!(amount > 0, "amount must be nonzero");
        require!(
            amount <= self.max_payment_yocto,
            "amount exceeds payment cap"
        );
    }
}
