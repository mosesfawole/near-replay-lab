//! Deliberately unsafe fixture: generic authorization and limits without obligation binding or a once-only claim.

#[path = "../../common.rs"]
mod common;

use common::{ApprovalView, ConfigView, FixtureState};
use near_sdk::json_types::{U64, U128};
use near_sdk::{AccountId, Gas, NearToken, PanicOnDefault, Promise, PublicKey, env, near};

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct UnsafeVault {
    state: FixtureState,
}

#[near]
impl UnsafeVault {
    #[init]
    pub fn new(
        owner_id: AccountId,
        worker_public_keys: Vec<PublicKey>,
        allowed_recipients: Vec<AccountId>,
        max_payment_yocto: U128,
    ) -> Self {
        Self {
            state: FixtureState::new(
                owner_id,
                worker_public_keys,
                allowed_recipients,
                max_payment_yocto,
            ),
        }
    }

    pub fn approve(
        &mut self,
        invoice_id: String,
        recipient: AccountId,
        amount_yocto: U128,
        expires_at_ns: U64,
    ) {
        self.state
            .approve(invoice_id, recipient, amount_yocto, expires_at_ns);
    }

    pub fn pay(&mut self, invoice_id: String, recipient: AccountId, amount_yocto: U128) -> Promise {
        let attempt_id = self
            .state
            .claim(&invoice_id, &recipient, amount_yocto.0, false);
        Promise::new(recipient.clone())
            .transfer(NearToken::from_yoctonear(amount_yocto.0))
            .then(
                Self::ext(env::current_account_id())
                    .with_static_gas(Gas::from_tgas(10))
                    .on_transfer(invoice_id, U64(attempt_id), recipient, amount_yocto),
            )
    }

    pub fn get_approval(&self, invoice_id: String) -> Option<ApprovalView> {
        self.state.get_approval(invoice_id)
    }

    pub fn get_config(&self) -> ConfigView {
        self.state.get_config()
    }

    #[private]
    pub fn on_transfer(
        &mut self,
        invoice_id: String,
        attempt_id: U64,
        recipient: AccountId,
        amount_yocto: U128,
    ) {
        self.state
            .on_transfer(&invoice_id, attempt_id.0, recipient, amount_yocto.0, false);
    }
}

#[cfg(test)]
type ContractUnderTest = UnsafeVault;

#[cfg(test)]
#[path = "../../test_support.rs"]
mod test_support;

#[cfg(test)]
#[path = "../../common_tests.rs"]
mod common_tests;

#[cfg(test)]
#[path = "../../payment_tests.rs"]
mod payment_tests;

#[cfg(test)]
#[path = "payment_tests.rs"]
mod unsafe_payment_tests;

#[cfg(test)]
#[path = "../../callback_tests.rs"]
mod callback_tests;

#[cfg(test)]
#[path = "callback_tests.rs"]
mod unsafe_callback_tests;
