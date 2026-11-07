# NEAR Replay Lab implementation

Authority: the user-approved Phase 4 definition at ../near-replay-lab-plan.md (outside this repository). This file translates that scope into implementation tasks. Start with a real transfer; finish the core suite before polishing.

## Global constraints

- Native NEAR testnet only. No paid API, mainnet account, existing user wallet, or outreach is required.
- Signing stays in the local runner. No private key enters browser code, reports, console output, or Git.
- Synthetic approvals, agent actions, and fault injection are constructed; chain execution and recorded reports must be real and labeled.
- The dashboard is read-only; imported reports are validated. A synthetic example cannot be displayed as real evidence.
- Exact yoctoNEAR strings at JSON boundaries; integer arithmetic for evidence. Inclusion alone never proves settlement.
- FINAL receipt execution, dedicated recipient accounts, finalized before/after references, complete raw outcomes, and contract state support verdicts.
- Independent worker keys for concurrency. Retry/concurrency test the same once-only invariant.
- Guarded state is Pending before transfer, Paid only after successful transfer callback, Failed only after proven transfer failure. Unknown outcome stays locked.
- Passing is bounded by tested invariants, not complete security. Missing or inconsistent evidence is INCONCLUSIVE.
- Source lives in this dedicated new repository on build/mvp. Keep local progress and review packages in .superpowers/sdd/implementation-plan/.
- Use meaningful behavior tests for financial/evidence logic. UI/config/prose does not require tests that mirror its implementation.

## Task 1: Core evidence types and first real transfer CLI

Create packages/core/src, packages/near-adapter/src, packages/runner/src and behavior tests under corresponding test directories. The root package and tsconfig are scaffolded. Use near-api-js 7.4.0, Node 24, TypeScript 5.9.3.

Provide a versioned RunReport type and runtime validator usable from the runner and dashboard. The report includes schemaVersion, runId, createdAt, network, recorded/live provenance, adapter/build versions, scenarios, approval details, and per-target attempts/snapshots/verdicts. Preserve complete public raw RPC outcomes, transaction hashes, signer/public-key identities and final block references. Never keys.

Expose types and evaluateTargetEvidence from packages/core/src/index.ts. Design a small documented shape compatible with multiple scenarios and target comparisons. Freeze that shape in docs/report-format.md for later tasks.

The initial scenario is a legitimate direct transfer between isolated testnet accounts. The oracle must derive whether exact intended credit happened from finalized balance evidence and successful finalized receipts. Any incomplete/nonfinal/nonce/transport result is INCONCLUSIVE. It must not accept empty evidence or use floating point. Add tests first that catch nonfinal success, missing balance, wrong recipient/amount, duplicate credit and legitimate success.

Implement a minimal JSON RPC client using the official SDK provider where practical, with finite timeouts and documented tx_status fallback. Retain the signed transaction hash before broadcast. Provide exported primitives to query finalized balances, sign/broadcast transfers or function calls, observe transactions through FINAL, and collect sanitized evidence. Tests must cover relevant evidence/final-status handling with realistic public response fixtures.

CLI commands: help, transfer, inspect/report validation. Read NEAR_TESTNET_ACCOUNT_ID, NEAR_TESTNET_PRIVATE_KEY, NEAR_TESTNET_RECIPIENT_ID, NEAR_RPC_URL (default official testnet RPC), NEAR_AMOUNT_YOCTO (default small exact amount), NEAR_REPORT_PATH. Explicitly reject non-testnet configuration. Do not fetch or print environment secrets. Validate required values before network side effects. Retain public evidence on failure. No faucet/account creation in this task; the controller owns disposable account setup.

Include .env.example with placeholder values, no secrets. Commands must be complete and runnable after npm install/npm run build:runner. Do not claim a live run unless actually executed; controller will supply accounts and execute it. Do not change apps/web or contracts.

Use test-first financial/evidence logic, show expected failures before implementation, run relevant tests and typecheck. Record commands/results, exports, report shape, concerns and modified paths in the task report. Do not commit; controller will review and commit the task.

## Task 2: Read-only evidence dashboard

Create apps/web as an npm workspace using Next.js 16.4.3, React/ReactDOM 19.2.3, TypeScript, Tailwind. Next was updated from the planning pin after npm audit identified fixed advisories. Use the frozen report schema from Task 1; import shared runtime validation. No signing or keys.

Build a responsive polished report viewer with a clear headline and tagline, scenario navigation, unsafe/guarded comparison, verdict labels, exact approved/observed amounts, before/after recipient balances, receipt timeline, expandable raw public evidence, explorer transaction links, network/run-date/provenance labels, report upload and JSON download.

Initial empty state must honestly explain how to generate/import a real report; no invented statistics or synthetic settlement. Ship a real recorded report only after the controller captures one. A direct-transfer report must render meaningfully before fixture suite reports exist. Keep color palettes accessible; a verdict is conveyed with text as well as color. Unknown/missing outcome remains INCONCLUSIVE.

Do not modify packages, contracts, or root lockfiles while another task owns them. Tell the controller what root workspace/dependency install is needed. Run web typecheck/build and inspect behavior where possible. No low-value tests of static UI/config. Record test/build evidence and limitations in the report.

## Task 3: Fixture contracts and three-scenario suite

Create Rust near-sdk 5.30.0 contracts/unsafe-vault and contracts/guarded-vault, with identical pay(invoice_id, recipient, amount_yocto) interface, owner setup/approval views, generic recipient allowlists/caps and worker authorization. Guarded: exact obligation detail/expiry binding, Pending atomic claim, private raw PromiseResult callback with attempt ID, Paid/Failed/Pending semantics. Unsafe deliberately bypasses exact detail and once-only obligation status, while generic checks still apply.

Extend adapter/runner to deploy fixtures, add restricted function-call workers, authorize obligations and run legitimate/expired controls plus recipient-substitution, lost-response fresh-nonce retry and concurrent independent-key duplicate scenarios. Each case uses fresh identifiers and dedicated recipients. Owner signing and worker keys remain local, never in reports. Serialize signing per key and retain hashes before broadcast.

Record finalized outcomes, views, balances and snapshots for both targets. Guarded rejection counts as holding only alongside legitimate control success; network/nonce failures remain inconclusive. Never retry an unknown guarded outcome.

Test meaningful contract state transitions and oracle boundaries, compile Wasm, execute the suite on testnet. Fixtures are not production-safe recommendations. CLI target verification exits nonzero for VIOLATED or INCONCLUSIVE; comparison-demo exits zero only when expected unsafe violations and guarded protections/controls are established.

Document exact contract build/deploy/run commands. Add scenario definitions and public reports from real runs after sanitization. The controller may split Rust and runner subtasks at stable interfaces to fit review/context size.

## Task 4: Reproduction, review, and build checkpoint

Write README, MIT LICENSE, architecture, real-versus-constructed explanation, dependency/AI attribution, limitations and commands. Record local validation in docs/verification.md and keep a sanitized actual report under examples/recorded-runs. Do not publish, create an X post, deploy a public site, or submit the hackathon entry in this phase.

Run meaningful financial/contract tests, runner typecheck, production dashboard build, the complete real suite if accounts/network available, report validation and visible UI check. Review the immutable final diff for correctness and scope. Resolve important findings. Update user-facing Project State with achieved facts and next tasks.

If testnet funding or infrastructure blocks the actual suite, still finish runnable code, build/tests, setup instructions, and empty-state dashboard. State the exact blocker and ask only for missing required input. Never fabricate a real-run report or call an unexecuted chain test passing.
