import assert from "node:assert/strict";
import test from "node:test";
import type { JsonValue } from "../../../packages/core/src/types.ts";
import {
  executionRows,
  explorerTransactionUrl,
  formatYocto,
  outcomeStatus,
} from "../lib/report-display.ts";

test("NEAR display retains the smallest yocto amount and exact fractional digits", () => {
  assert.equal(formatYocto("1"), "0.000000000000000000000001");
  assert.equal(formatYocto("10000000000000000000000"), "0.01");
  assert.equal(
    formatYocto("1000000000000000000000001"),
    "1.000000000000000000000001",
  );
});

test("NEAR display retains a large integer and signed balance decrease without floating point", () => {
  assert.equal(
    formatYocto("123456789123456789000000000000000000000001"),
    "123,456,789,123,456,789.000000000000000000000001",
  );
  assert.equal(formatYocto("-1"), "−0.000000000000000000000001");
  assert.equal(formatYocto("0"), "0");
  assert.equal(formatYocto(null), "Unknown");
});

test("missing and unrecognized execution status stay unknown rather than successful", () => {
  assert.equal(outcomeStatus(undefined), "UNKNOWN");
  assert.equal(outcomeStatus({ SuccessValue: 1 }), "UNKNOWN");
  assert.equal(outcomeStatus({ Pending: true }), "UNKNOWN");
  assert.equal(outcomeStatus({ SuccessReceiptId: "receipt-1" }), "SUCCEEDED");
  assert.equal(outcomeStatus({ SuccessValue: "" }), "SUCCEEDED");
  assert.equal(
    outcomeStatus({ SuccessValue: "", Failure: { ActionError: {} } }),
    "FAILED",
  );
});

test("receipt rows preserve distinct public outcomes, including a failed receipt", () => {
  const finalOutcome: {
    transaction_outcome: JsonValue;
    receipts_outcome: JsonValue[];
  } = {
    transaction_outcome: {
      id: "transaction-1",
      block_hash: "block-1",
      outcome: {
        executor_id: "signer.testnet",
        receipt_ids: ["receipt-1"],
        status: { SuccessReceiptId: "receipt-1" },
        logs: [],
      },
    },
    receipts_outcome: [
      {
        id: "receipt-1",
        block_hash: "block-2",
        outcome: {
          executor_id: "vault.testnet",
          receipt_ids: ["receipt-2"],
          status: { SuccessReceiptId: "receipt-2" },
          logs: ["pay requested"],
        },
      },
      {
        id: "receipt-2",
        block_hash: "block-3",
        outcome: {
          executor_id: "recipient.testnet",
          receipt_ids: [],
          status: { Failure: { ActionError: {} } },
          logs: [],
        },
      },
    ],
  };
  const rows = executionRows(finalOutcome);
  assert.equal(rows.length, 3);
  assert.deepEqual(
    rows.map(({ id, kind, status }) => ({ id, kind, status })),
    [
      { id: "transaction-1", kind: "transaction", status: "SUCCEEDED" },
      { id: "receipt-1", kind: "receipt", status: "SUCCEEDED" },
      { id: "receipt-2", kind: "receipt", status: "FAILED" },
    ],
  );
  assert.deepEqual(rows[1]?.logs, ["pay requested"]);
  assert.deepEqual(rows[2]?.raw, finalOutcome.receipts_outcome[1]);
  assert.deepEqual(executionRows(null), []);
});

test("transaction links remain on the NEAR testnet explorer and encode the imported hash", () => {
  assert.equal(
    explorerTransactionUrl("hash?network=mainnet"),
    "https://testnet.nearblocks.io/txns/hash%3Fnetwork%3Dmainnet",
  );
});
