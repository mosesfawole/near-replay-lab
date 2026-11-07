"use client";

import { useRef, useState } from "react";
import type { JsonValue, RpcEvidence, VerdictStatus } from "@near-replay/core";
import { formatTimestamp, formatYocto } from "@/lib/report-display";
import { Icon } from "./icon";

export function VerdictBadge({ status }: { status: VerdictStatus }) {
  return (
    <span className="verdict-badge" data-status={status}>
      <Icon
        name={
          status === "HOLDS"
            ? "check"
            : status === "VIOLATED"
              ? "close"
              : "clock"
        }
      />
      {status}
    </span>
  );
}

export function Amount({
  value,
  large = false,
}: {
  value: string | null;
  large?: boolean;
}) {
  return (
    <div className={`amount ${large ? "amount-large" : ""}`}>
      <span className="amount-readable">
        {formatYocto(value)}
        {value !== null && <span className="currency"> NEAR</span>}
      </span>
      <span className="amount-exact">
        {value === null ? "Evidence not established" : `${value} yoctoNEAR`}
      </span>
    </div>
  );
}

export function RawEvidence({
  title,
  value,
  hint,
}: {
  title: string;
  value: unknown;
  hint?: string;
}) {
  return (
    <details className="raw-evidence">
      <summary>
        <Icon name="code" />
        <span className="raw-title">{title}</span>
        {hint && <span className="raw-hint">{hint}</span>}
        <Icon name="chevron" className="details-chevron" />
      </summary>
      <pre tabIndex={0} aria-label={`${title} JSON`}>
        <code>{JSON.stringify(value, null, 2)}</code>
      </pre>
    </details>
  );
}

function responseHasError(response: JsonValue | null): boolean {
  return (
    response !== null &&
    typeof response === "object" &&
    !Array.isArray(response) &&
    "error" in response
  );
}

const RPC_PAGE_SIZE = 20;

function LedgerPagination({
  pageIndex,
  pageCount,
  firstRecord,
  lastRecord,
  totalRecords,
  position,
  onPageChange,
}: {
  pageIndex: number;
  pageCount: number;
  firstRecord: number;
  lastRecord: number;
  totalRecords: number;
  position: "top" | "bottom";
  onPageChange: (pageIndex: number) => void;
}) {
  return (
    <nav
      className={`ledger-pagination ledger-pagination-${position}`}
      aria-label={`Evidence ledger pagination, ${position}`}
    >
      <span
        className="ledger-range"
        aria-live={position === "top" ? "polite" : "off"}
        aria-atomic="true"
      >
        Showing {firstRecord}–{lastRecord} of {totalRecords}
      </span>
      <div className="ledger-page-controls">
        <button
          type="button"
          className="button button-secondary ledger-page-button"
          onClick={() => onPageChange(0)}
          disabled={pageIndex === 0}
          aria-label="First page"
        >
          First
        </button>
        <button
          type="button"
          className="button button-secondary ledger-page-button"
          onClick={() => onPageChange(pageIndex - 1)}
          disabled={pageIndex === 0}
          aria-label="Previous page"
        >
          Previous
        </button>
        <span className="ledger-page-number">
          Page {pageIndex + 1} of {pageCount}
        </span>
        <button
          type="button"
          className="button button-secondary ledger-page-button"
          onClick={() => onPageChange(pageIndex + 1)}
          disabled={pageIndex === pageCount - 1}
          aria-label="Next page"
        >
          Next
        </button>
        <button
          type="button"
          className="button button-secondary ledger-page-button"
          onClick={() => onPageChange(pageCount - 1)}
          disabled={pageIndex === pageCount - 1}
          aria-label="Last page"
        >
          Last
        </button>
      </div>
    </nav>
  );
}

export function RpcLedger({ records }: { records: RpcEvidence[] }) {
  const ledgerRef = useRef<HTMLElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const [pagination, setPagination] = useState({ records, pageIndex: 0 });
  // A new import resets navigation, even when it has the same run ID.
  if (pagination.records !== records) {
    setPagination({ records, pageIndex: 0 });
  }
  const pageCount = Math.max(1, Math.ceil(records.length / RPC_PAGE_SIZE));
  const pageIndex =
    pagination.records === records
      ? Math.min(pagination.pageIndex, pageCount - 1)
      : 0;
  const firstIndex = pageIndex * RPC_PAGE_SIZE;
  const visibleRecords = records.slice(firstIndex, firstIndex + RPC_PAGE_SIZE);
  const onPageChange = (nextPage: number) => {
    setPagination({
      records,
      pageIndex: Math.max(0, Math.min(nextPage, pageCount - 1)),
    });
    // Keep the new page's start and keyboard focus in view from either pager.
    headingRef.current?.focus({ preventScroll: true });
    ledgerRef.current?.scrollIntoView({ block: "start" });
  };
  const paginationProps = {
    pageIndex,
    pageCount,
    firstRecord: firstIndex + 1,
    lastRecord: firstIndex + visibleRecords.length,
    totalRecords: records.length,
    onPageChange,
  };

  return (
    <section
      ref={ledgerRef}
      className="ledger panel"
      id="rpc-ledger"
      aria-labelledby="ledger-title"
    >
      <div className="section-heading">
        <div>
          <span className="eyebrow">PUBLIC RPC EVIDENCE</span>
          <h2 id="ledger-title" ref={headingRef} tabIndex={-1}>
            The evidence ledger
          </h2>
        </div>
        <span className="count-label">
          {records.length} {records.length === 1 ? "record" : "records"}
        </span>
      </div>
      <p className="section-description">
        Complete public responses, including requests made before signing and
        errors. Attempt-specific observations also appear with each transaction.
      </p>
      {records.length === 0 ? (
        <p className="missing-evidence">
          No run-level RPC records were captured. Inspect the attempt evidence
          above.
        </p>
      ) : (
        <>
          {pageCount > 1 && (
            <LedgerPagination {...paginationProps} position="top" />
          )}
          <div className="rpc-list">
            {visibleRecords.map((record, localIndex) => {
              const index = firstIndex + localIndex;
              return (
                <details
                  className="rpc-record"
                  key={`${record.requestedAt}-${record.method}-${index}`}
                >
                  <summary>
                    <span className="rpc-index">
                      {String(index + 1).padStart(2, "0")}
                    </span>
                    <code>{record.method}</code>
                    <span
                      className={`rpc-state ${record.error || responseHasError(record.response) ? "rpc-error" : ""}`}
                    >
                      {record.error || responseHasError(record.response)
                        ? "Error recorded"
                        : record.response === null
                          ? "No response"
                          : "Response recorded"}
                    </span>
                    <time dateTime={record.requestedAt}>
                      {formatTimestamp(record.requestedAt)}
                    </time>
                    <Icon name="chevron" className="details-chevron" />
                  </summary>
                  <pre
                    tabIndex={0}
                    aria-label={`${record.method} RPC record ${index + 1}`}
                  >
                    <code>{JSON.stringify(record, null, 2)}</code>
                  </pre>
                </details>
              );
            })}
          </div>
          {pageCount > 1 && (
            <LedgerPagination {...paginationProps} position="bottom" />
          )}
        </>
      )}
    </section>
  );
}
