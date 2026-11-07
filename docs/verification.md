# Verification record

Phase 5 technical acceptance passed: three complete actual comparisons are accepted. Phase 6 local submission materials and media are prepared; publication and the actual application remain outstanding. Executed checks and limits are recorded below.

## Actual testnet comparisons

All accepted captures use source commit `19aa9e234d7b27605585588a1aa3ee3e748fb069`. Each has five cases, two deployed fixtures, ten distinct invoice obligations and 24 distinct FINAL transaction attempts, including owner approvals.

| Public report | Run ID | Capture time (UTC) |
| --- | --- | --- |
| `examples/recorded-runs/core-suite.json` | `e73b251b-95a1-4699-a761-8a0e3ef50981` | `2026-11-02T10:42:26.876Z` |
| `examples/recorded-runs/core-suite-repeat-2.json` | `13bb5a1d-023e-417e-84d1-774d94b05e19` | `2026-11-02T11:08:47.746Z` |
| `examples/recorded-runs/core-suite-repeat-3.json` | `9e5057ff-ae10-4f24-8d5a-5d37aac0e08b` | `2026-11-02T11:27:24.164Z` |

The fresh offline audit confirmed 30 globally unique invoice obligations and 72 distinct FINAL transaction attempts across the three captures, with all matrices exact and no unresolved accepted attempt. Both recorded repeats preserve the corresponding live evidence exactly apart from provenance/build metadata. See [acceptance-evidence.json](acceptance-evidence.json) for hashes, capture identities, source/build consistency and per-run checks.

| Case | Unsafe fixture | Guarded fixture |
| --- | --- | --- |
| Legitimate approved payment | HOLDS; 0.001 NEAR intended credit | HOLDS; 0.001 NEAR intended credit |
| Expired approval | HOLDS; rejected, zero credit | HOLDS; rejected, zero credit |
| Recipient substitution | VIOLATED; alternate recipient receives 0.001 NEAR | HOLDS; rejected, zero credit |
| Lost-response retry | VIOLATED; two credits totaling 0.002 NEAR | HOLDS; one 0.001 NEAR credit |
| Concurrent independent-key duplicates | VIOLATED; two credits totaling 0.002 NEAR | HOLDS; one 0.001 NEAR credit |

Each accepted comparison exits 0. Offline validation recalculates the evidence verdicts; strict guarded verification exits 0 and strict unsafe verification exits 2 as expected. These are underlying Node CLI semantics; some shell/npm wrappers report a generic nonzero code for exit 2.

The main example and `apps/web/public/reports/recorded-suite.json` are byte-identical. Recorded exports preserve original public evidence and verdicts, with explicit recorded provenance and actual capture-build metadata. An exact-value scan covered nine locally held private strings and found zero matches on export.

## Executed local checks

- Controller full Node check after the gas-reserve repair: 197 tests passed, zero failures, cancellations or skips. The independently executed implementer check also passed 197/197. Financial/evidence tests cover missing outcomes, causal chronology, exact nonces, callbacks, duplicate credit, retained hashes and uncertain-state behavior.
- The subsequent RPC-default-only change passed 12 existing focused tests, a fresh runner build, typecheck and CLI help. No fixture/core behavior changed after the full check.
- Rust `cargo test --locked` passed 74 SDK-host contract-method tests: guarded 38 and unsafe 36. Contract sources are unchanged. These host tests are distinct from live receipt settlement.
- Both optimized Wasm artifacts passed bounded-module/export checks: unsafe 148,343 bytes (`5RA9JRYF1Ek9hVEe1DBysdB7ed1PjXmoW8jPkJ8w1y9s`), guarded 148,599 bytes (`38uqonUxW23gp4yFiygPjDFBDgrkcJAV6wQoc6ros4mv`).
- Web display checks passed 5/5. Strict TypeScript and production dashboard builds passed.

## Clean source reproduction

A fresh tracked-source snapshot at tree `a053ce900e40947d61e601a0e4c8c66b078075f4`, with no `.env` or `.local/`, ran:

```sh
npm ci
npm run build:runner
node dist/packages/runner/src/cli.js setup --check
node dist/packages/runner/src/cli.js verify examples/recorded-runs/core-suite.json guarded
npm run build:web
```

All commands exited 0. The install added 115 packages, audited 117, and reported zero known advisories. The production build completed compilation, TypeScript checking and static page generation. This snapshot contains the capture-era application/runner source and the first two reports; it predates the UI pagination update below. Later acceptance documentation/report additions were checked separately. No Rust installation or signing credential is needed for the recorded walkthrough.

A separate free bootstrap reproduction created a disposable operator with a finalized 10 NEAR balance. Its protected credentials were kept separate from the main setup and excluded from deliverables.

After adding all final reports and documentation, 93 tracked files were copied into the same credential-free reproduction and compared byte for byte. All three public comparison reports passed direct Node CLI validation and strict guarded verification with exit 0; strict unsafe verification returned the expected exit 2 for each. These nine clean-copy checks passed without loading credentials or making RPC calls. That copy's runtime/dependency source matched the successfully built capture source; the current viewer adds the subsequent UI pagination change.

## Visible dashboard verification before pagination

The production viewer loaded the full actual recorded report and correctly displayed all five scenario selections, target-specific approval recipients, exact unsafe/guarded credits, FINAL outcomes, retained hashes and expanded public RPC evidence.

Desktop content/scroll width was 1265 pixels in a 1280-pixel viewport; mobile width was 375 in a 390-pixel viewport. Neither had horizontal overflow. Mobile download used the accessible Download report JSON control. The downloaded report matched the parsed recorded example exactly, passed CLI validation and was successfully reimported. Malformed imports were rejected while preserving the previous valid report.

The final retry comparison screenshot is [demo-comparison.jpg](demo-comparison.jpg). Its unsafe credit is 0.002 NEAR and guarded credit is 0.001 NEAR. Temporary viewport overrides were reset after checks.

## Evidence-ledger pagination checkpoint

The current UI limits the run-level RPC ledger to 20 records per page, with First/Previous/Next/Last controls above and below the list, record ranges and original record numbers. Page navigation returns focus to the ledger heading, and importing a new report resets to page one. Full-report JSON and downloads retain all records.

The code change is scoped to `apps/web/components/evidence.tsx` and `apps/web/app/globals.css`, with updated [dashboard documentation](dashboard.md) and verification records. Scoped source review found no blockers. Controller web typecheck, all five existing web display tests and the production dashboard build passed.

The restarted production viewer loaded the preserved report `e73b251b-95a1-4699-a761-8a0e3ef50981`. Every page's raw JSON was compared by value with the full report: all 396 records matched in their original order, with 20 rows on pages 1–19 and 16 rows (381–396) on page 20. First/Previous and Next/Last disabled at their respective boundaries. Navigation from the bottom pager returned focus to `ledger-title` and the ledger heading to view; raw JSON remained expandable. Reimporting the same run ID reset the ledger to records 1–20. Importing the nine-record direct-transfer report displayed all nine rows without pagination. A download while viewing page 20 retained all 396 records and matched the preserved full report by JSON value.

Mobile content width was 375 pixels within a 390-pixel viewport, and desktop content width was 1265 within 1280. The mobile pager wrapped its range above the controls without horizontal overflow. Temporary viewport overrides were reset. No browser error logs were recorded. The [pagination screenshot](ledger-pagination.png) shows the current first page and controls.

The accepted capture provenance remains `19aa9e234d7b27605585588a1aa3ee3e748fb069`. The current application UI differs from that source; this patch does not change the runner, core evaluator, contracts or recorded chain evidence.

## Failed trials and recovery

Three complete comparisons were accepted from ten actual trials. The seven unsuccessful captures stay inconclusive and are retained locally without replaying their signed requests. [trial-summary.json](trial-summary.json) records every trial, original verdict counts, retained-report hashes and errors. The earlier allowance-failure capture is also public at `examples/recorded-runs/worker-allowance-failure.json`.

| Trial | Infrastructure finding |
| --- | --- |
| 1 | DNS/status preflight failure; no signed attempt |
| 2 | Former 0.05 NEAR restricted-worker allowance could not cover protocol 88 gas purchase requirements |
| 3 | Legacy NEAR RPC endpoint returned its deprecation/rate-limit error during block evidence collection |
| 5 | Unsafe worker 2 broadcast response was lost and its saved hash remained unobserved |
| 7 | Another unsafe worker 2 request remained unobserved; FastNEAR explicitly returned a free rate-limit error before the guarded concurrent case |
| 8 | dRPC's free request timeout prevented complete fresh FINAL observations; its owner approval was later observed FINAL by hash through Intear |
| 9 | Transport failed during unsafe substitution evidence collection and later views; the retained pay was subsequently observed FINAL by hash, while the captured report stayed inconclusive |

Setup now uses 2 NEAR virtual gas allowances and reserves against the greater of block gas price and protocol minimum purchase price, including a fee buffer. The allowance governs worker gas spending and does not add vault funding or cap vault payments.

Unknown payment packets were isolated using atomic same-public-key DeleteKey/AddKey management with identical receiver/pay restrictions. The pending manifest and prior nonce marker were saved before management; finalized replacement nonces exceeded the old chain nonce and every retained signed nonce. Setup then reconciled the same identities. Trial 5's nonce advanced from `275886295000001` past signed nonce `275886295000002` to `275890461000000`; after trial 7 the worker nonce was independently observed at `275891605000000`, past signed nonce `275890461000002`. The management response on dRPC timed out, so the resulting finalized key state was queried before reconciliation.

All diagnostic transaction status requests used only hash and signer. Full signed status was never used for old unknown packets: the nearcore fallback can forward the packet. No top-up, paid API or mainnet funds were needed.

## Independent source review

Whole-source review found exact-nonce and direct receipt chronology/coherence defects. Regressions and repairs at `1a674d6` passed independent re-review with no remaining findings. Earlier callback dependency/causal block fixes and the legacy missing-key RPC normalization were repaired at `69fc05e`. The gas-reserve/renewal repair at `2ed00de` passed its scoped review, including 24 independent integer/pricing probes. Those reviews cover the capture source at `19aa9e2`; the later UI pagination patch has the separate scoped review recorded above.

Final documentation/artifact review is ready with no remaining concrete findings. The reviewer independently matched all three report hashes/identities/counts to acceptance evidence, confirmed every trial in the ten-trial summary and checked 37 local links with none missing. Final diff checks passed. The tracked-file private-value scan covered 93 files and nine known private strings, with zero matches and no private/generated local paths tracked. Phase 5 is complete; Phase 6 publication, outreach and submission remain paused.

## Phase 6 local package checks

On 2 November, the local package checks confirmed all 11 exact organizer field names; a 15-character project name, 1,743-character idea, 213-character X draft, exactly ten judge Q&A, and seven null human/request/public/consent inputs. The draft is explicitly not sendable. All checked local Markdown links resolved, with no missing paths; the final diff check exited 0. The official rules were rechecked from the organizer site and `HACKATHON.md`, with personal eligibility and media limits left unknown.

The final recorded video has a 153.89-second container (about 2:34), H.264 at 1920 × 1080/30 fps and stereo AAC. Complete video/audio decode exited 0 with no decoder errors. Eight decoded scene frames matched the renders; genuine screenshot content was visually inspected. The [media verification](submission/media-verification.md) and [machine checks](submission/demo/media-checks.json) record measurements and the lack of a human listening/public-platform review. Narration is offline synthetic Windows System.Speech; no live-model or paid API was introduced.

During Phase 6 packaging, runtime/contract source matched `19aa9e2`; the UI pagination change came later. Prior 197 Node and 74 Rust host checks, clean reproduction and three actual comparisons remain the financial/contract evidence; unchanged core tests were not rerun during packaging. Independent review checked the submission claims, exact counts, raw report matrices, official requirements and media. The [final checklist](submission/final-checklist.md) retains all publication and application steps.

The final Phase 6 private-value scan covered 118 tracked files against nine known locally generated private strings, with zero matches. No private/generated local paths were tracked. The Phase 6 source archive was produced from tracked HEAD only, excluding local operator configuration, secrets, installed dependencies and scratch media; that package predates the pagination update.

## Evidence limits

Contracts, local signatures, finalized receipts, views and recipient credits are actual native NEAR testnet execution. Obligations, substituted proposals, concurrent scheduling and discarded responses are constructed inputs. No live language model was evaluated. Offline validation checks internal consistency; it does not authenticate an RPC operator or report author. HOLDS covers only the named invariant and captured evidence, rather than production or comprehensive safety. No external developer feedback, adoption or prize result has been established.
