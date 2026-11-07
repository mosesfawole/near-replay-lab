# Timed demo script

Recorded walkthrough duration: **about 2:34** (153.867 seconds in the scene timeline; 153.89 seconds in the encoded container). Eight scenes use a 0.3-second lead and 1.2-second tail around individually measured speech. Timecodes below are truncated to whole seconds; the media manifest preserves exact boundaries. This is an editorial length; no organizer video limit was published.

The [video](demo/near-replay-lab-demo.mp4) is an edited walkthrough of actual saved dashboard screenshots with authored summary cards. It is not continuous live execution footage. Narration is offline synthetic Microsoft Hazel Desktop at synthesis rate 4, with no time stretching. Every frame labels **RECORDED NEAR TESTNET EVIDENCE / 2 NOV 2026**. The first full comparison comes from `core-suite.json`, build `0.1.0 (19aa9e2)`.

| Time | Screen / purpose |
| --- | --- |
| 00:00–00:14 | One approval. Two credits? |
| 00:14–00:35 | Define the obligation. Follow the evidence. |
| 00:35–00:52 | An allowlist is not an exact approval. |
| 00:52–01:13 | A fresh request can pay twice. |
| 01:13–01:31 | Claim Pending before the transfer. |
| 01:31–01:50 | A green call is not payment proof. |
| 01:50–02:13 | Reproduce the result. Keep the failures. |
| 02:13–02:33 | Inspect before you trust the settlement. |

## Narration transcript

### 01 · 00:00–00:14 · One approval. Two credits?

One approved payment should settle once. Here, an approval for zero point zero zero one NEAR produces twice that credit in our unsafe fixture. The guarded fixture pays exactly once. NEAR Replay Lab makes that difference inspectable.

### 02 · 00:14–00:35 · Define the obligation. Follow the evidence.

This is saved evidence from native NEAR testnet, captured on November second. The canonical obligation binds an invoice, recipient, exact amount, and expiry. We construct the approvals, proposed actions, and faults. The deployed Rust contracts, signatures, finalized receipts, state views, and recipient credits are real. No live language model is being evaluated.

### 03 · 00:35–00:52 · An allowlist is not an exact approval.

First, substitute another allowed recipient. Both vaults have authorization, an allowlist, an amount cap, and expiry checks. The unsafe vault still pays the alternate recipient. The intended recipient gets nothing. The guarded vault binds the exact obligation and rejects the mismatch.

### 04 · 00:52–01:13 · A fresh request can pay twice.

Next, discard the first broadcast response. The runner retains the signed hash, observes it through FINAL, and proves the first exact credit. Only then do we deliberately sign a fresh nonce request for the same invoice. The unsafe fixture credits twice. The guarded fixture rejects the duplicate. Observing an identical signed hash twice would count only once.

### 05 · 01:13–01:31 · Claim Pending before the transfer.

Now broadcast duplicate proposals concurrently from two restricted keys with independent nonces. The unsafe vault pays twice again. The guarded vault claims Pending before creating the transfer, so only one request can settle. A matching private callback can finish the claim. An unknown callback outcome stays locked.

### 06 · 01:31–01:50 · A green call is not payment proof.

Open a payment attempt and follow the public receipt chain to the recipient. Inclusion or a green top level call alone cannot prove settlement. Our evidence oracle requires transaction identity, linked successful FINAL receipts, canonical approval evidence, and the exact recipient balance change. Missing or inconsistent evidence remains inconclusive.

### 07 · 01:50–02:13 · Reproduce the result. Keep the failures.

Three complete comparisons were accepted from ten actual trials. Seven infrastructure limited captures are preserved. The accepted runs contain thirty unique invoices and seventy two distinct FINAL transactions, including approvals. One hundred ninety seven Node tests and seventy four Rust host tests passed. Clean reproduction and dashboard checks passed. These bounded results do not establish production safety.

### 08 · 02:13–02:33 · Inspect before you trust the settlement.

The goal is to help developers test payment execution policies before relying on them. Native NEAR contracts and the official JavaScript and Rust SDKs supply the execution boundary. The report viewer needs no wallet connection. Built at NEAR HACKATHON by solo developer mosesfawole with Codex assistance. Open the report, replay the faults, and inspect the credit.

## Interactive walkthrough and backup

Use the credential-free [README quickstart](../../README.md#open-the-recorded-demo). Open the viewer, select **Load recorded demo**, and state that this is a saved actual capture. Choose **Discarded response and duplicate retry** first: point to the exact 0.001 approval, unsafe 0.002 observed/receipt-derived credit, and guarded 0.001 credit. A judge can understand the central result without waiting for another network run.

Then choose **Recipient substitution** and expand the related alternate-account balances: the unsafe fixture pays the alternate recipient while the intended recipient receives zero; guarded rejects. Choose **Concurrent independent-key duplicates** and compare credits. Expand an actual payment attempt, then its receipt outcomes and raw public evidence. Explain that top-level success alone is insufficient and that FINAL receipt/body/balance evidence drives the verdict. Download the JSON or import the checked report to inspect it independently.

The five scenarios test two payment properties: exact recipient/amount binding and once-only settlement. Retry and concurrency are separate mechanisms testing once-only settlement. Controls establish legitimate behavior and expiry rejection. These are constructed approvals/proposals/faults against actual disposable testnet contracts, with no live-model evaluation.

If the viewer or local server is unavailable, play the saved video and open [core-suite.json](../../examples/recorded-runs/core-suite.json). Use [media verification](media-verification.md) for provenance and [technical verification](../verification.md) for the three accepted comparisons among ten trials. A future live suite must be assessed independently; it may remain INCONCLUSIVE under infrastructure failure.

Finish with the developer value: test exact payment execution policies, inspect public proof, and identify where a fresh request can settle again. Native NEAR contracts, restricted function-call keys, receipts and official SDKs are substantive execution dependencies. The proposed own-contract/CI integrations and user feedback in the roadmap are future work, not demonstrated adoption.
