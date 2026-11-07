# Recorded demo report

The dashboard's **Load recorded demo** action requests `/reports/recorded-suite.json` from this directory. It contains the actual five-case/two-fixture NEAR testnet comparison captured at `2026-11-02T10:42:26.876Z`, run `e73b251b-95a1-4699-a761-8a0e3ef50981`, capture build `0.1.0 (19aa9e2)`.

The served file is byte-identical to `examples/recorded-runs/core-suite.json` at the repository root. Both pass the shared RunReport validator with explicit `recorded` provenance. Approvals, proposed actions and transport faults are constructed; deployed contracts, signatures, finalized receipts and recipient credits are actual testnet execution. The file preserves complete public RPC and receipt evidence, exact amounts and freshly derived verdicts. It is saved evidence, with no live language model evaluation or continuous feed; provenance labels do not authenticate a report author or RPC operator.

Do not place signing keys, environment files, signed transaction bytes, or invented execution here. A missing or invalid file never produces a fallback report.
