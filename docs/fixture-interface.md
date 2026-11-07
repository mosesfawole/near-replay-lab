# Constructed fixture interface

Both contracts use the same external methods. They are deliberately constructed reference targets, not production vaults or vendor vulnerabilities.

## Identity and permission model

One disposable operator account owns both fixtures. Two independent function-call keys per fixture are installed on that operator account, restricted to the receiver and `pay` method. Their allowance limits gas; it is not a vault spending limit. Fixtures authorize both the operator as predecessor and a configured worker public key as the transaction signer. This yields independent nonces without treating nonce rejection as payment protection.

Vault accounts hold their own funded native testnet NEAR. Signing keys stay in local configuration and never enter exported reports or the dashboard.

## JSON methods

- `new({owner_id, worker_public_keys, allowed_recipients, max_payment_yocto})`: initialize a fixture. Monetary values are decimal strings.
- `approve({invoice_id, recipient, amount_yocto, expires_at_ns})`: owner-only canonical obligation approval. Reject zero amounts, unallowed recipients, past expiry and replacement of existing identifiers. Expiry is a decimal nanosecond string.
- `pay({invoice_id, recipient, amount_yocto})`: authorized worker only, no attached deposit. Both enforce existing/unexpired approval, generic recipient allowlist, nonzero amount and per-payment amount cap.
- `get_approval({invoice_id})`: return canonical approved fields, status, attempt ID, completed payment count and last completed recipient/amount (if present), or null for unknown ID.
- `get_config({})`: expose public owner/worker keys, recipient allowlist and generic amount cap.
- `on_transfer({invoice_id, attempt_id, recipient, amount_yocto})`: private callback. Inspect raw promise result inside the contract; do not accept a caller-provided success flag.

Public status spelling: `Approved`, `Pending`, `Paid`, `Failed`. Integers crossing JSON boundaries use decimal strings (`U128`/`U64`).

## Guarded semantics

Bind every payment to the exact canonical recipient/amount. Reject Pending/Paid. Allow Approved or proven Failed to claim a new attempt before expiry. Increment attempt ID and store Pending atomically before scheduling native transfer plus callback. A private callback for the matching pending attempt stores Paid after success or Failed after proven failure. Missing, panicking, or inconsistent callback leaves Pending; no automatic unlock/recovery.

## Deliberately unsafe semantics

Enforce the common authorization, generic limits, existence and expiry checks, but omit exact recipient/amount binding and once-only claim checks. Each allowed request schedules a transfer. Completed payment count records successful callbacks; it does not prevent repeat settlement. This permits meaningful substituted-recipient and duplicate-payment comparisons under the same allowlist/cap.

## Evidence boundary

The suite observes actual finalized transfer receipts and dedicated recipient balances alongside these views. Callback state alone is insufficient evidence of a transfer. Independent-key or RPC failure yields INCONCLUSIVE. Legitimate/expired controls accompany failure cases.
