# Native testnet fixture suite

The local runner executes five constructed payment scenarios against both deployed fixtures. Obligations, hostile proposals, response discard and request scheduling are constructed inputs. A CLI run captures actual approvals, transfers, callbacks, complete FINAL receipts and dedicated recipient balances. Offline tests use explicit `synthetic` provenance; no language model drives the payment requests.

## Reproduce

Use Node 24 and run commands from the repository root. The checked JavaScript SDK is `near-api-js@7.4.0`.

```powershell
npm ci
npm run build:runner
node dist/packages/runner/src/cli.js setup --check
```

The artifact check validates both Wasm modules, their six required exports, and exact funding for code storage, state reserve and small payments. It needs no operator credential and makes no RPC calls. Deployable files are `res/unsafe_vault.wasm` and `res/guarded_vault.wasm`. Rebuild commands and the Rust toolchain are in [contract-build.md](contract-build.md).

In a fresh checkout without `.env`, the free helper can create a new disposable testnet operator:

```powershell
npm run cli -- bootstrap
```

Bootstrap exclusively writes `.env` and `.local/bootstrap.json` before calling `https://helper.testnet.near.org/account`. It refuses an existing `.env` and retains generated credentials if the helper outcome cannot be verified. With an existing disposable operator, edit local `.env` using the placeholders in `.env.example`; the operator must have a full-access ed25519 key and sufficient free testnet funds. No direct-transfer recipient is required for setup or suite.

```powershell
npm run cli -- setup
$env:NEAR_REPORT_PATH = 'reports/local/fixture-suite.json'
npm run cli -- suite
npm run cli -- validate reports/local/fixture-suite.json
npm run cli -- verify reports/local/fixture-suite.json guarded
```

Equivalent suite commands in a POSIX shell:

```sh
npm run cli -- setup
NEAR_REPORT_PATH=reports/local/fixture-suite.json npm run cli -- suite
npm run cli -- validate reports/local/fixture-suite.json
npm run cli -- verify reports/local/fixture-suite.json guarded
```

The npm CLI script loads an existing `.env`. Omit `NEAR_REPORT_PATH` to get a timestamped suite filename. A configured filename is atomically replaced by checkpoints, so give the suite its own report path. Import the resulting public JSON in the read-only dashboard.

## Local configuration and setup

| Variable | Default or meaning |
| --- | --- |
| `NEAR_TESTNET_ACCOUNT_ID` | Disposable named `.testnet` operator |
| `NEAR_TESTNET_PRIVATE_KEY` | Its local full-access ed25519 key |
| `NEAR_RPC_URL` | `https://test.rpc.fastnear.com`, the free FastNEAR testnet endpoint listed in [NEAR's provider documentation](https://docs.near.org/api/rpc/providers) |
| `NEAR_SETUP_PATH` | `.local/testnet-setup.json`; must stay inside ignored `.local/` |
| `NEAR_UNSAFE_WASM_PATH` | `res/unsafe_vault.wasm` |
| `NEAR_GUARDED_WASM_PATH` | `res/guarded_vault.wasm` |
| `NEAR_FIXTURE_FUNDING_YOCTO` | `2000000000000000000000000`, 2 NEAR per fixture |
| `NEAR_RECIPIENT_FUNDING_YOCTO` | `10000000000000000000000`, 0.01 NEAR per recipient |
| `NEAR_WORKER_ALLOWANCE_YOCTO` | `2000000000000000000000000`, 2 NEAR gas allowance per worker |
| `NEAR_AMOUNT_YOCTO` | Exactly `1000000000000000000000`, 0.001 NEAR for this suite |
| `NEAR_REPORT_PATH` | Timestamped `reports/local/fixture-suite-*.json` when absent |
| `NEAR_FIXTURE_PREFIX` | Optional short lowercase prefix when first generating fixture identities |

Setup reserves about 4.04 NEAR across two fixtures and four keyless recipients, plus gas. Wasm storage is calculated with integer arithmetic at `10^19` yoctoNEAR per byte, a 16 KiB state reserve and twenty small payments per fixture. Each worker allowance is a virtual gas-spending cap on the operator account, with no additional funding transfer.

Worker pays retain 100 Tgas. Setup and suite preflight use the greater of the finalized block gas price and that block's protocol `runtime_config.min_gas_purchase_price`, with a 25% fee buffer. At the protocol-88 floor of `1000000000` yoctoNEAR per gas, the reserve is 0.125 NEAR per pay and 0.75 NEAR for the primary worker's six calls in one suite. The default 2 NEAR also covers eighteen calls at the measured validation cost of 0.100920000147491 NEAR, before allowance refunds. Suite checks the six-call reserve before the fixture's first case and a per-pay reserve thereafter. This small preflight does not estimate every runtime fee; definitive node validation remains authoritative.

The secret manifest stores two generated fixture full-access keys and four independent worker keys, two per fixture. Each worker is installed on the operator account with a function-call permission restricted to that fixture receiver and the `pay` method. Canonical and substituted recipients are dedicated, keyless subaccounts of the same disposable operator. The manifest is saved as `pending` before account actions, then `ready` after reconciliation.

Rerunning `setup` reuses the persisted keys, reconciles already-created accounts and checks code hashes, configuration and permissions. Consumed allowances that still cover the six-call reserve are reused. An insufficient allowance, including an exact exhausted `"0"`, is renewed only after verifying the exact bounded FunctionCall permission, fixture receiver, sole `pay` method, canonical u128 allowance and exact u64 nonce. Renewal atomically deletes and adds the same public key with the configured bounded allowance. Broader, unlimited, mismatched or malformed permissions stop setup.

The manifest becomes pending before any management action. A renewal records its prior finalized nonce until the new key is verified with an adequate allowance and a greater nonce; a lost response retains this marker and the same local keys for reconciliation. Nonce advancement alone does not prove that every previously signed packet is invalid: before running after repair, compare the renewed finalized nonce with the highest retained unresolved signed nonce and require it to be at least that value. Never resend those old packets. A changed Wasm hash requires a separate fresh manifest. Local secret writes use mode `0600`; Windows relies on the containing folder's user-restricted ACL. Public setup summaries and reports redact every known generated secret, including strings in public-signature slots.

Worker installation requires a positively identified missing-key query error. The runner handles both structured RPC errors and the legacy result-level missing-key message with matching requested public key and valid block facts. Other legacy errors, null or primitive access-key results, and a missing-account error stop setup with the saved manifest still pending. They do not authorize key installation or regenerate credentials.

## Cases and exit codes

Each run builds all ten target entries before execution and gives each one a fresh invoice ID. The first balance pair observes its own canonical recipient; the alternate has a related-account pair. Cases execute serially, and signing is serial on each key. Only the two independent worker broadcasts in the concurrency case overlap.

| Scenario kind | Unsafe fixture | Guarded fixture |
| --- | --- | --- |
| `fixture-legitimate` | HOLDS: one exact approved credit | HOLDS: one exact approved credit |
| `fixture-expired` | HOLDS: explicit expiry rejection, zero credit | HOLDS: explicit expiry rejection, zero credit |
| `recipient-substitution` | VIOLATED: alternate recipient receives credit | HOLDS: canonical-recipient rejection, zero credit |
| `lost-response-retry` | VIOLATED: two distinct successful credits | HOLDS: one credit and explicit duplicate rejection |
| `concurrent-duplicates` | VIOLATED: two distinct successful credits | HOLDS: one credit and explicit Pending/Paid rejection |

The expiry control approves while valid with an expiry fifteen seconds after a finalized chain timestamp. It then waits on finalized timestamps, bounded to thirty seconds, before signing the payment. A slow or incomplete run remains INCONCLUSIVE.

Both block lookups and every poll share the expiry deadline. In-flight fetches/body reads use the remaining budget and an abort signal; responses completing after that deadline cannot satisfy the expiry wait.

The response-loss case sends the first real signed transaction, intentionally discards its response before reading its body, and observes only the retained hash. Before a fresh-nonce duplicate can be prepared, the first full FINAL outcome, successful callback, approval view and both recipient balances must independently establish exactly one approved credit. Intermediate raw views and balances remain in `rpcEvidence`. Unknown FINAL, missing receipt bodies, an unresolved Pending callback or inconsistent credit blocks that worker lane for the rest of the run. The kit never unlocks or retries an unknown obligation.

Both concurrency proposals are signed with separate restricted keys and checkpointed together before either send. Their broadcasts run concurrently; status observations run serially. Explicit per-key nonce floors retain the highest nonce signed within the run when finalized access-key queries lag. The runner never asks the SDK to re-sign or rebroadcast a fault case automatically.

`suite` exits **0** only for the exact complete matrix above. It exits **2** for any missing, violated control, unexpected result or INCONCLUSIVE evidence. `verify <report> [unsafe|guarded]` exits 0 only when every selected target verdict HOLDS, and 2 for VIOLATED, INCONCLUSIVE or a missing selected target. Consequently, verifying the deliberately unsafe fixture returns 2 in a successful comparison. `suite --target guarded` still captures both fixtures and uses strict guarded verification for its exit code. Command/configuration errors exit **1**. `inspect` and `validate` check shape and recalculated verdicts without RPC calls; a valid report can describe a violation. These are the Node runner's exit codes; the npm wrapper may report a nonzero runner result as **1**.

## Evidence and failure retention

Every owner `approve` and worker `pay` signature is retained in `attempts` before broadcast. A checkpoint must succeed before each send and after each case. Failed cases stay in the report with explicit INCONCLUSIVE verdicts and retained public errors, hashes and raw RPC responses. A failed persistence checkpoint stops subsequent broadcasts.

One-shot broadcasts use `send_tx` with `wait_until: "INCLUDED"` so validation failures can be returned before an accepted transaction becomes observable. A definitive `INVALID_TRANSACTION` keeps its complete raw error envelope and terminal attempt error, skips FINAL polling and blocks the signing lane. Access-key allowance or gas rejection remains INCONCLUSIVE and cannot establish fixture protection. Accepted transactions and discarded or uncertain responses still require independent FINAL observation of the locally retained hash.

Function-call observation uses the official SDK full-receipt status method (`EXPERIMENTAL_tx_status`), falling back to `tx_status` when necessary. A bare FINAL result without receipt bodies remains incomplete. The oracle checks signed transaction and receipt identity, successful downstream native Transfer receipts, linked matching private callbacks, exact raw approval/configuration views, finalized timestamp/block references and both recipient balance deltas. Gas refunds to unrelated accounts are excluded. State or top-level function-call success alone cannot prove recipient credit.

All non-legitimate fixture verdicts also require a freshly evaluated legitimate control for the same fixture. Contract policy rejection requires an explicit expected failure and zero receipt and balance credit; nonce or network rejection cannot establish protection. Identical signed hashes count once. See [report-format.md](report-format.md) for the schema, target approval overrides, public signature scope and finite import limits.

The constructed fixtures have a fixed 256-approval bound, so repeated runs consume that local experiment state. The guarded result is bounded by the tested invariants and captured evidence. Live testnet results must be reviewed separately from synthetic tests; local green tests do not establish live settlement.
