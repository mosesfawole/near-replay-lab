import type {
  JsonObject,
  JsonValue,
} from "../../../packages/core/src/types.ts";

export type ExecutionStatus = "SUCCEEDED" | "FAILED" | "UNKNOWN";
export interface ExecutionRow {
  kind: "transaction" | "receipt";
  id: string;
  executorId: string;
  blockHash: string;
  status: ExecutionStatus;
  logs: string[];
  raw: JsonValue;
}

/** All 24 fractional digits remain available; no Number conversion or rounding. */
export function formatYocto(value: string | null): string {
  if (value === null) return "Unknown";
  const amount = BigInt(value);
  const magnitude = (amount < 0n ? -amount : amount)
    .toString()
    .padStart(25, "0");
  const whole = magnitude.slice(0, -24).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const fraction = magnitude.slice(-24).replace(/0+$/, "");
  return `${amount < 0n ? "−" : ""}${whole}${fraction ? `.${fraction}` : ""}`;
}

function object(value: JsonValue | undefined): JsonObject | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value
    : undefined;
}

/** An execution status is a receipt observation, never a settlement verdict. */
export function outcomeStatus(value: JsonValue | undefined): ExecutionStatus {
  const status = object(value);
  if (!status) return "UNKNOWN";
  if ("Failure" in status) return "FAILED";
  if (
    typeof status.SuccessValue === "string" ||
    (typeof status.SuccessReceiptId === "string" &&
      status.SuccessReceiptId.length > 0)
  )
    return "SUCCEEDED";
  return "UNKNOWN";
}

export function executionRows(finalOutcome: JsonValue | null): ExecutionRow[] {
  const final = object(finalOutcome);
  if (!final) return [];
  const rows: ExecutionRow[] = [];
  const append = (value: JsonValue | undefined, kind: ExecutionRow["kind"]) => {
    const record = object(value);
    if (!record) return;
    const execution = object(record.outcome);
    rows.push({
      kind,
      id: typeof record.id === "string" ? record.id : "Not reported",
      executorId:
        typeof execution?.executor_id === "string"
          ? execution.executor_id
          : "Not reported",
      blockHash: typeof record.block_hash === "string" ? record.block_hash : "",
      status: outcomeStatus(execution?.status),
      logs: Array.isArray(execution?.logs)
        ? execution.logs.filter((log): log is string => typeof log === "string")
        : [],
      raw: record,
    });
  };
  append(final.transaction_outcome, "transaction");
  if (Array.isArray(final.receipts_outcome)) {
    for (const receipt of final.receipts_outcome) append(receipt, "receipt");
  }
  return rows;
}

export function explorerTransactionUrl(hash: string): string {
  return `https://testnet.nearblocks.io/txns/${encodeURIComponent(hash)}`;
}

export function formatTimestamp(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return `${date.toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" })} UTC`;
}

export function shortHash(value: string): string {
  return value.length > 22 ? `${value.slice(0, 10)}…${value.slice(-8)}` : value;
}
