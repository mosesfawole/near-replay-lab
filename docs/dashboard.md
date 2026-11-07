# Read-only report dashboard

The web workspace uses Next.js **16.4.3**, React and ReactDOM **19.2.3**, TypeScript **5.9.3** from the root workspace, and Tailwind **4.1.18**. The controller replaced the originally requested Next 16.1.6 with the patched release after dependency auditing. The dashboard imports types and runtime validation from the browser-safe shared core; it has no signing or NEAR SDK dependency.

From the repository root:

```powershell
npm ci
npm run dev
```

Open the URL printed by Next.js, normally `http://localhost:3000`. Production and focused checks:

```powershell
npm run test --workspace apps/web
npm run typecheck --workspace apps/web
npm run build:web
npm run start --workspace apps/web
```

The dev and build scripts explicitly use webpack. `next.config.ts` resolves the shared core's `.js` ESM specifiers to source `.ts` files; those specifiers remain compatible with the compiled local runner. Fonts use system families, so a web build does not download font assets.

## Local fixture capture guide

The workbench's local guide leads through the complete unsafe/guarded fixture comparison, using the runner commands documented in [suite.md](suite.md):

```powershell
npm ci
npm run build:runner
npm run cli -- bootstrap
npm run cli -- setup --check
npm run cli -- setup
npm run cli -- suite
```

Bootstrap uses the free native testnet helper and requires a fresh checkout without `.env`. Skip it when an existing disposable operator is already configured. The local Wasm check validates the bundled artifacts before setup. Setup deploys the fixtures and stores generated credentials locally; signing stays in the runner.

Import the public JSON path printed by `suite`. With no `NEAR_REPORT_PATH` override, its timestamped default is `reports/local/fixture-suite-*.json`. The guide does not need a direct-transfer recipient. Direct-transfer reports remain supported by the viewer.

For a fixed output path and strict guarded verification, the full suite instructions also provide:

```powershell
$env:NEAR_REPORT_PATH = 'reports/local/fixture-suite.json'
npm run cli -- suite
npm run cli -- validate reports/local/fixture-suite.json
npm run cli -- verify reports/local/fixture-suite.json guarded
```

`validate` checks public report structure and derived verdicts; `verify` requires every selected guarded verdict to hold. A successful comparison deliberately records unsafe violations, so strict unsafe verification returns a nonzero exit code. Neither report command sends a payment or makes an RPC call.

## Import and evidence flow

**Import report** accepts a single JSON file up to 20 MiB. The empty workbench also accepts a dropped file. A successful import passes `validateRunReport`, including its recalculation of stored verdicts. An unsupported schema, invalid evidence shape, secret-bearing data, or inconsistent stored verdict is rejected. An import error leaves the previously loaded report available. Files are held in tab memory without local storage, upload, or server mutation.

The scenario index comes from the report. A direct-transfer report renders independently; reports containing unsafe and guarded targets display matching evidence structures side by side at wide viewport sizes and stacked at smaller sizes. Each target shows:

- Its literal `HOLDS`, `VIOLATED`, or `INCONCLUSIVE` verdict, summary, and reason codes.
- The exact approved amount, observed recipient balance delta, and successful receipt-derived credit. Human-readable NEAR values retain all significant fractional digits; original yoctoNEAR integers remain visible.
- Before/after recipient balances, capture times, and finalized block references. Missing snapshots say **Unknown**. Related account balances and finalized contract state views appear when present.
- Signed public attempt metadata, an external link to the fixed NEAR testnet explorer, and the recorded transaction/receipt outcomes ordered by their recorded block heights. Execution statuses are observations, separate from settlement verdicts; no timestamps are inferred for receipts.
- Expandable complete public JSON for approvals, snapshots, individual execution outcomes, attempts and their RPC observations, target evidence, the run-level RPC ledger, and the full report.

Every target uses `target.approval ?? scenario.approval` for its approved amount, intended recipient, and approval evidence. When any target records an approval override, the scenario overview shows a labeled approval panel for each target instead of presenting the scenario-level recipient as shared by both fixtures. This preserves the separate canonical and substituted recipient accounts used by each fixture. Direct-transfer reports without overrides retain the single scenario approval view.

**Download JSON** exports the validated report currently in view. **Remove** clears the report from the tab. Report metadata retains the network, capture time, provenance description, adapter/build version, RPC endpoint, and run ID. Provenance is a claim in the report, not an authenticated proof of origin. A synthetic import is visibly labeled **Synthetic fixture**.

The run-level evidence ledger shows **20 RPC records per page**, with First/Previous/Next/Last controls above and below the list. The range and page count remain visible, and record numbers refer to their original positions in the full report. Changing pages returns focus and the view to the ledger heading; a newly imported report resets to page one. Reports with at most 20 records use one list without pagination, and the empty-evidence message remains available. Paging only changes presentation: Download JSON and the complete-report panel retain every record.

## Actual recorded demo

**Load recorded demo** fetches the same-origin path `/reports/recorded-suite.json` with a 15-second timeout and validates it using the same core validator. It requires `provenance.mode` to equal `recorded`. This saved capture never claims to be a continuously live run. Missing, invalid, oversized, or unavailable files leave the honest empty state or current imported report intact, with an explanation. There is no fabricated fallback.

The controller supplies `apps/web/public/reports/recorded-suite.json` only after capturing and sanitizing real testnet execution. A real direct-transfer capture can be used first and replaced with the complete real fixture-suite capture later. No actual capture was authored by the dashboard worker.

## Accessibility and boundaries

The interface uses native buttons, details/summary controls, a keyboard skip link, visible focus rings, a polite import-status announcement, and an alert for import errors. Verdict text and icons accompany color. Raw JSON panels are focusable and scrollable. Responsive layouts protect long account IDs, hashes, and exact integer amounts; reduced-motion preferences disable smooth scrolling and transitions.

The initial empty state makes no settlement claim or invented statistic. Core evaluator support defines which invariants can produce a conclusive result; the UI never substitutes a receipt success for a payment verdict. Import validation does not authenticate an RPC operator or account isolation. The viewer performs no signing, wallet connection, account creation, payment submission, database operation, or private-key handling. Only an explicit recorded-demo request and user-opened explorer links require network access.

The display helper tests exercise exact monetary formatting, failed/unknown execution observations, preservation of distinct receipt rows, and testnet explorer URL encoding. Static layout and configuration are checked through typecheck/build and browser QA, without snapshot tests that mirror their implementation.
