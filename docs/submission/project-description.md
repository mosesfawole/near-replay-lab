# Project description and field copy

Local draft prepared on 2026-11-02. Nothing has been published or submitted. The public repository and demo-post URLs are not available yet. Use the [structured draft](submission-draft.json) for publication status and missing form values.

The organizer verifies `projectName` at 2-80 characters and `idea` at 20-2,000; `projectUrl` and `demoUrl` each allow at most 300. Source: [official submission contract](https://nearhackathon.com/HACKATHON.md) and [verified rules](rules-and-requirements.md). No separate tagline/summary field or limit is verified. Those variants are optional copy.

Counts below include spaces, punctuation and LF newlines inside the copy, and exclude code fences. The copy uses ASCII characters.

## Project name - 15 characters

```text
NEAR Replay Lab
```

## Tagline - 83 characters

Optional copy; separate platform limit unknown.

```text
We replay payment failures against NEAR integrations and show exactly what settled.
```

## Short description - 281 characters

Optional copy; separate platform limit unknown. This also fits the verified idea limit if a shorter idea is preferred.

```text
An approved 0.001 NEAR obligation settled as 0.002 NEAR in the unsafe fixture and 0.001 NEAR in the guarded fixture. NEAR Replay Lab replays payment failures, then checks finalized receipts and exact recipient credit against the approved recipient, amount and once-only obligation.
```

## Recommended idea field - 1743 characters

Fits the organizer's verified 20-2,000 character limit.

```text
An approved 0.001 NEAR obligation settled as 0.002 NEAR in our unsafe fixture and 0.001 NEAR in the guarded fixture. NEAR Replay Lab makes that difference inspectable: replay the failure, open the FINAL receipts, and see exactly who received what.

We test the execution boundary for payment-capable AI integrations. A local TypeScript runner sends constructed requests to two disposable Rust contracts on native NEAR testnet. The five cases are legitimate payment, expired approval, recipient substitution, retry after a discarded broadcast response, and concurrent duplicate requests from independent keys. Both vaults share authorization, allowlist, cap and expiry checks. The guarded vault also binds the exact approved recipient and amount and claims Pending before transfer.

The evidence oracle checks linked successful FINAL receipts, canonical approvals and exact recipient balance changes. The read-only Next.js dashboard recalculates each verdict as HOLDS, VIOLATED or INCONCLUSIVE; a green function call alone does not prove payment. A repeated signed hash counts once. Our duplicate cases use fresh signed requests for the same invoice.

Three complete comparisons were accepted from ten actual trials: 30 unique obligations and 72 distinct FINAL transactions, including owner approvals. Seven infrastructure-limited trials remain inconclusive and are disclosed. 197 Node tests and 74 Rust SDK-host tests passed; clean reproduction and dashboard checks passed.

The experiment uses constructed inputs; no live model or real vendor vulnerability was evaluated. An unknown callback outcome leaves the guarded obligation locked. Production safety and adoption are unproven. Built by solo developer @mosesfawole with Codex assistance.
```

## Track and attribution

Proposed track: **AI Security & Defense**, official form value `tracks: ["security"]`. The track calls for spending limits, policy engines and sandboxed wallets. This project tests whether a payment execution policy survives substitutions and duplicate requests. Official guidance says an own NEAR contract that fits the track is sufficient; final acceptance remains the organizer's decision.

Solo builder: **@mosesfawole**. OpenAI Codex assisted implementation, tests, documentation and review under human direction. The runner constructs payment actions deterministically and makes no live-model or paid AI API call. The [README](../../README.md) lists dependencies, AI assistance and the MIT license.

## Evidence behind the copy

- The [verification record](../verification.md) establishes the 0.002/0.001 NEAR comparison, 197 Node checks, 74 Rust SDK-host checks, clean reproduction and dashboard checks.
- [Acceptance evidence](../acceptance-evidence.json) records three accepted matrices, 30 unique invoice obligations and 72 distinct FINAL transaction hashes, including owner approvals.
- The [ten-trial summary](../trial-summary.json) discloses seven infrastructure-limited incomplete captures. These trials retain inconclusive results; they are not counted as accepted comparisons.
- The [architecture](../architecture.md) explains exact obligation binding, fresh-request duplicate semantics, private callbacks, retained hashes and the evidence oracle. See the [recorded comparison](../../examples/recorded-runs/core-suite.json) and [comparison screenshot](../demo-comparison.jpg).

These are constructed failure cases against disposable fixtures with actual native NEAR testnet execution. There is no measured live-model performance, real vendor vulnerability, mainnet deployment, production safety, external customer adoption or prize result. Offline validation checks internal evidence consistency; it does not authenticate a report author or RPC operator.
