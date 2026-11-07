# Live pitch and judge questions

Local presentation draft; nothing has been published or submitted. The official material does not require a deck. A local-only demo requires a published video before submission; see the [verified rules](rules-and-requirements.md).

## 60-second pitch

Target script, approximately 60 seconds at a natural pace. Read aloud and time it before recording; this draft is not a measured narration.

> You approved one payment of 0.001 NEAR. After a lost response and a fresh retry, our unsafe vault paid 0.002. Our guarded vault paid 0.001.
>
> NEAR Replay Lab replays payment failures and shows exactly what settled. We run five cases against two real contracts on native NEAR testnet. The dashboard checks the approved obligation, linked FINAL receipts and exact recipient credit; a green function call is not enough.
>
> Three complete comparisons covered 30 unique obligations and 72 finalized transactions, including approvals. Seven other trials remain inconclusive and are disclosed.
>
> The inputs are constructed; we did not evaluate a live model. This tests the payment boundary an AI integration relies on. Open the retry case: two distinct credits on the unsafe side, one on the guarded side, and the receipts behind both.

Evidence: [comparison and checks](../verification.md), [accepted captures](../acceptance-evidence.json), [all trials](../trial-summary.json), [recorded report](../../examples/recorded-runs/core-suite.json).

## Exactly ten tough judge questions

### 1. Why does an AI security project matter without a live LLM?

A model's suggestion becomes consequential when a payment tool executes it. We deliberately supply bad and repeated proposals to test that boundary independently of which model produced them. This demonstrates bounded execution invariants; measuring a model's tendency to choose those actions would require a separate evaluation. [Evidence boundary](../architecture.md)

### 2. You built the vulnerable fixture yourself. What is original here?

The weakness is deliberate, and we make no claim to have found a vendor vulnerability. The contribution is the inspectable comparison: the same five cases, controls on both fixtures, actual chain settlement, and an oracle that follows approval, receipt and balance evidence. The scope is two constructed vaults; broader integrations remain future work. [Fixture scope](../architecture.md), [five-case matrix](../verification.md)

### 3. Why does this need NEAR?

NEAR gives us actual native transfers, restricted function-call worker keys, independent nonces and asynchronous transfer/callback execution. Those are the mechanisms we exercise: a worker's gas allowance does not bind the vault's payment obligation, and a successful function call does not by itself establish recipient credit. Testnet receipts and finalized balances let judges inspect the resulting settlement. [NEAR execution flow](../architecture.md)

### 4. Is the duplicate result just the same transaction counted twice?

No. The oracle counts an identical signed hash once. The retry case submits a fresh nonce and signature for the same invoice after discarding the first broadcast response; the concurrent case uses independent keys. Unsafe settlement requires two distinct successful credits, while the guarded fixture claims Pending before scheduling either transfer. [Duplicate semantics](../architecture.md), [measured credits](../verification.md)

### 5. What happens if the transfer settles but its callback is unknown?

The guarded obligation stays locked in Pending. Only a matching private callback with a proven successful raw transfer result records Paid; a proven failed transfer may record Failed. Missing or inconsistent evidence cannot authorize an automatic unlock or retry. That prevents an assumed retry from becoming a second payment, but can leave an obligation operationally stuck; there is no automatic recovery procedure. [State transitions and limits](../architecture.md)

### 6. Seven of ten trials failed. Why should we trust the result?

We disclose all ten trials and accept only the three complete matrices. The seven incomplete captures encountered allowance, DNS, endpoint, rate-limit, timeout or transport problems, and retained inconclusive results. Each accepted capture has 24 distinct FINAL transaction attempts and zero unresolved attempts. This is evidence of those three comparisons, not a measured reliability rate for future runs. [All trials](../trial-summary.json), [acceptance checks](../acceptance-evidence.json)

### 7. Who wants this, and what proves demand?

The intended users are developers connecting AI workflows to NEAR payment tools or vaults. The proposed value is a repeatable check before handing a worker spending authority, with evidence that can be reviewed when responses are lost. We have no external developer feedback, customer, adoption or willingness-to-pay evidence yet. A next validation step would be adapting the harness to a consenting integration and testing whether its maintainer finds the report useful. [Current limits](../project-state.md)

### 8. How can another developer integrate or reproduce it?

They can run the recorded viewer and offline CLI verification with Node 24, without keys, Rust or testnet funds. A fresh comparison uses disposable accounts, the bundled Wasm artifacts and documented bootstrap/setup/suite commands. An external contract needs an adapter that maps its canonical obligation, actions, finalized state and recipient credit into the report; no plug-and-play external adapter is claimed. [Reproduction commands](../../README.md), [component boundaries](../architecture.md)

### 9. What impact have you actually measured?

In each accepted duplicate case, an approved 0.001 NEAR obligation produced 0.002 NEAR credit in the unsafe fixture and 0.001 NEAR in the guarded fixture. Substitution credited the alternate recipient only in the unsafe fixture; both legitimate and expired controls held. Across three accepted captures we recorded 30 unique obligations and 72 distinct FINAL transactions, including approvals. These are fixture outcomes; no customer loss reduction, latency gain, model accuracy or adoption impact has been measured. [Exact results](../verification.md), [aggregate counts](../acceptance-evidence.json)

### 10. Is the guarded vault safe to put into production?

The evidence supports the named invariants in these captured cases and bounded local checks: 197 Node tests and 74 Rust SDK-host tests, plus reproduction and UI checks. It is a disposable testnet fixture, with unresolved-callback liveness limits and declared RPC/account-isolation assumptions. Production use would need its own threat model, operational recovery design and independent audit; no comprehensive or production safety claim is made. [Verification limits](../verification.md), [trust assumptions](../architecture.md)
