# Project State

Checkpoint: **2026-11-02**. **Phase 5 is complete** with three accepted actual testnet comparisons among ten trials. Each established the complete five-case/two-fixture matrix: the unsafe fixture violated recipient and once-only invariants in all three fault cases; the guarded fixture held them, with legitimate and expired controls holding on both. Full-suite dashboard and clean-reproduction checks passed. **Phase 6 local polish and submission preparation are complete**: the narrated recorded demo, measured script, submission copy, pitch/Q&A, verified requirements and final checklist are in [the package](submission/README.md). Publication and the actual application remain outstanding.

## Achieved evidence

| Area | Established result |
| --- | --- |
| Actual core comparison | Run `e73b251b-95a1-4699-a761-8a0e3ef50981`, captured `2026-11-02T10:42:26.876Z`, build `0.1.0 (19aa9e2)` |
| Public full-suite report | `examples/recorded-runs/core-suite.json` and `apps/web/public/reports/recorded-suite.json` contain the same sanitized actual capture with explicit recorded provenance |
| Chain evidence | Real deployed fixtures, public signatures, complete FINAL receipts, approval/state views and dedicated recipient balance changes on native NEAR testnet |
| Accepted repeats | `examples/recorded-runs/core-suite-repeat-2.json` (trial 6) and `examples/recorded-runs/core-suite-repeat-3.json` (trial 10) preserve the other two accepted comparisons |
| Technical acceptance | Full acceptance checker exited 0; three accepted among ten actual trials, with seven unsuccessful trials disclosed separately |
| Aggregate accepted evidence | All matrices match; 24 FINAL attempts and zero unresolved attempts per capture; 30 globally distinct invoice obligations and 72 globally distinct transaction hashes |
| Capture source | `19aa9e234d7b27605585588a1aa3ee3e748fb069`; public exports identify build `0.1.0 (19aa9e2)` and preserve live evidence with only provenance/build metadata changed |
| Comparison exit | Accepted plain suites exited 0 for the complete expected matrix below |
| Offline verification | Full-suite validation and strict guarded verification exited 0; strict unsafe verification exited 2, as expected for demonstrated violations |
| Public-report exclusion check | Controller found zero exact matches for nine known locally generated private-key strings before saving public evidence |
| Earlier direct transfer | `examples/recorded-runs/first-transfer.json`, captured `2026-11-02T07:10:09.845Z`, build `0.1.0 (9016111)`; exactly 0.001 NEAR settled with `HOLDS` |
| Shared validation | Versioned public report validator recalculates verdicts and rejects malformed, secret-bearing or inconsistent reports |
| Node checks | Latest controller core run passed 197/197 tests with zero failures, followed by passing typecheck |
| Production build | Dashboard production build passed, including a fresh clean snapshot |
| Full-suite dashboard before pagination | All five choices, target-specific approvals and raw FINAL evidence inspected; desktop content width 1265 within viewport 1280, mobile 375 within 390; JSON download/import preserved `core-suite.json` exactly |
| Capture-era clean reproduction | Snapshot `a053ce900e40947d61e601a0e4c8c66b078075f4` without `.env` or `.local/`: npm ci, runner build, Wasm preflight, strict guarded recorded verification and production web build passed; 115 packages installed, 117 audited, zero known advisories |
| Rust fixture logic | Earlier controller verification passed 74 SDK-host contract-method tests: guarded 38, unsafe 36; fixture sources are unchanged |
| Wasm artifacts | Optimized `res/unsafe_vault.wasm` (148,343 bytes) and `res/guarded_vault.wasm` (148,599 bytes) are bundled for deployment without a Rust build |
| Reproduction path | Recorded viewer and bootstrap/setup/suite commands, portable build prerequisites, evidence boundaries, dependency/AI attribution and MIT license are documented |

| Case | Unsafe fixture | Guarded fixture |
| --- | --- | --- |
| Legitimate control | `HOLDS`: one exact approved credit | `HOLDS`: one exact approved credit |
| Expired control | `HOLDS`: expiry rejection, zero credit | `HOLDS`: expiry rejection, zero credit |
| Recipient substitution | `VIOLATED`: alternate recipient credited | `HOLDS`: mismatch rejected, zero credit |
| Lost-response retry | `VIOLATED`: two distinct successful credits | `HOLDS`: one credit and duplicate rejection |
| Concurrent duplicate | `VIOLATED`: two distinct successful credits | `HOLDS`: one credit and duplicate rejection |


| Public accepted report | Run ID | Capture time |
| --- | --- | --- |
| [core-suite.json](../examples/recorded-runs/core-suite.json) | `e73b251b-95a1-4699-a761-8a0e3ef50981` | `2026-11-02T10:42:26.876Z` |
| [core-suite-repeat-2.json](../examples/recorded-runs/core-suite-repeat-2.json) | `13bb5a1d-023e-417e-84d1-774d94b05e19` | `2026-11-02T11:08:47.746Z` |
| [core-suite-repeat-3.json](../examples/recorded-runs/core-suite-repeat-3.json) | `9e5057ff-ae10-4f24-8d5a-5d37aac0e08b` | `2026-11-02T11:27:24.164Z` |

All three passed fresh validation and oracle checks, comparison/guarded exits 0 and expected unsafe exit 2. The [comparison screenshot](demo-comparison.jpg) shows the recorded unsafe/guarded view.

The earlier direct transfer is transaction [jvvNi5mMZHsiLUJtf93PuSPWXykFGtSyams6oYA15oi](https://testnet.nearblocks.io/txns/jvvNi5mMZHsiLUJtf93PuSPWXykFGtSyams6oYA15oi). Its recipient rose from 10 to 10.001 NEAR between finalized blocks `275866090` and `275866129`. It remains a separate direct example; the dashboard's recorded demo now loads the full fixture comparison.

The [verification record](verification.md), [acceptance evidence](acceptance-evidence.json) and [trial summary](trial-summary.json) contain executed checks and their limits. Local Node tests and Rust SDK-host tests establish logic; actual receipt settlement and balance changes are established by the separately captured testnet report. Provenance and account isolation are declared, without cryptographic authentication by the validator.

## Implemented behavior and operational findings

The two contracts share the payment interface, generic allowlist/cap checks, worker authorization and expiry checks. The unsafe target deliberately bypasses exact obligation detail and once-only status checks. The guarded target writes `Pending` before transfer, moves to `Paid` only after a matching successful private callback, permits `Failed` only after proven transfer failure, and retains an unknown outcome as locked `Pending`.

The runner provides disposable bootstrap, persisted deployment/setup reconciliation, canonical approvals, independent restricted worker keys, fresh invoice IDs and all five cases. Signing and private keys remain local; the secret setup manifest stays under ignored `.local/`. Public transaction metadata and retained hashes are checkpointed before broadcasts; later observations are retained on incomplete execution. An unknown guarded outcome is never automatically unlocked or retried.

Actual setup and suite execution exposed a legacy RPC missing-key response, endpoint deprecation and an insufficient worker gas allowance. Reviewed regressions and fixes preserve evidence and reject ambiguous query failures. The current default uses the free `https://test.rpc.fastnear.com` endpoint listed in [NEAR's provider documentation](https://docs.near.org/api/rpc/providers). Status, finalized block and full-receipt methods were verified there. Later trials encountered FastNEAR rate limits, fresh FINAL status timeouts on the dRPC free plan and transient transport failure through Intear. Hash-only follow-up through `https://testnet-rpc.intea.rs` observed the timed-out dRPC approval as FINAL without replaying it; the original capture stayed unchanged. Accepted comparisons are trials 4, 6 and 10, all through FastNEAR. Unsuccessful trials 1, 2, 3, 5, 7, 8 and 9 retain their original evidence and remain distinct from accepted captures.

The current worker default is a 2 NEAR gas-spending allowance. At protocol 88, the minimum gas purchase price exceeded the observed block gas price, making the former 0.05 NEAR allowance insufficient for 100 Tgas pays. Setup and suite reserve against the greater price with a fee buffer. This allowance does not transfer extra funding or cap the vault's NEAR spending. The earlier actual allowance-failure capture remains an explicit all-`INCONCLUSIVE` example at `examples/recorded-runs/worker-allowance-failure.json`.

The [README](../README.md) includes complete recorded-demo, direct-transfer and bootstrap/setup/suite commands. The [suite guide](suite.md) specifies configuration, reserve arithmetic, reconciliation, case mechanics and comparison versus strict-target exit codes.

## Evidence-ledger pagination checkpoint

The current viewer presents the run-level RPC ledger in pages of 20 records, with First/Previous/Next/Last controls above and below the list, visible record ranges and original record numbers. New imports reset to page one; full-report JSON and downloads retain all records. See [dashboard behavior](dashboard.md).

This change is limited to the evidence component, dashboard CSS and documentation. It changes the current application UI; accepted reports retain their original capture provenance at `19aa9e234d7b27605585588a1aa3ee3e748fb069`. Runner, core evaluator and contract behavior are unaffected. Scoped source review found no blockers, and web typecheck, the five existing web tests and the production build passed. Browser verification matched all 396 records across 20 pages to the preserved report, confirmed boundary controls, raw JSON, import reset and unchanged full export, and checked mobile/desktop layout. See the [verification checkpoint](verification.md#evidence-ledger-pagination-checkpoint) and [current ledger screenshot](ledger-pagination.png).

## Final checkpoint and next phase

Phase 5 is complete: technical acceptance, repeated comparisons, full-suite UI checks and clean reproduction passed. Phase 6 local preparation now includes a narrated video of actual recorded dashboard captures, a timed script with live-review fallback, a 1,743-character idea field, a 131-word human pitch with ten Q&A, official requirements and a final submission checklist. No deck is required by the reviewed rules. These materials predate the UI pagination update; the recorded chain evidence remains tied to capture commit `19aa9e2`.

The proposed track remains **AI Security & Defense** (`security`). The rules were verified on 2 November from the organizer's site and `HACKATHON.md`: public repository plus public X demo post are required, and a local-only demo requires video. The official deadline is **15 November 00:59 CET**; the internal target is **13 November 20:00 CET**. A current weighted judging rubric and personal eligibility are unverified.

Next: the builder reviews the package, supplies the intended public repository destination, lead name, email, mainnet prize account and exact contact consent, publishes the reviewed repository/video X post, and submits the verified public links. These values are null in the local worksheet. Publication, outreach and hackathon submission have not occurred. See [final checklist](submission/final-checklist.md) and [media verification](submission/media-verification.md).

Infrastructure failure, unknown callbacks and incomplete finality remain `INCONCLUSIVE`. Results are bounded by the named invariants and captured evidence. A saved successful comparison does not establish the outcome of a later run.

## Scope and validation limits

Approvals, proposed actions and fault injection are deliberately constructed. The deployed contracts, signatures, finalized receipts and recipient credits in the recorded suite are actual native NEAR testnet execution. No live language model or paid AI API drove the requests.

No live-model behavior, adoption metric or external user/maintainer feedback has been validated. Bounded tests, reviewed source and guarded fixture results do not establish production or comprehensive safety. Unknown callbacks can leave obligations locked, and there is no automatic recovery procedure.

The Phase 6 local package is prepared. Public deployment, publication, outreach and hackathon submission have not been performed. No live model, paid API or mainnet transaction was introduced during packaging.

## Dependency and attribution checkpoint

Direct pins are near-api-js **7.4.0**, near-sdk **5.30.0**, TypeScript **5.9.3**, Next.js **16.4.3**, React/ReactDOM **19.2.3** and Tailwind **4.1.18**. Checked toolchains are Node **24.19.0**, npm **11.17.0**, Rust/Cargo **1.97.1** and cargo-near **0.22.0**. Lockfiles retain transitive resolutions; local Wasm builds use explicitly non-reproducible build mode.

OpenAI Codex assisted implementation, tests, documentation and review under human direction. Project sources use the [MIT license](../LICENSE); upstream dependencies retain their licenses.
