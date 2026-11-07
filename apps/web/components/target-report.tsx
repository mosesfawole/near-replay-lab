import type {
  ApprovalDetails,
  BalanceSnapshots,
  TargetReport,
  TransactionAttempt,
} from "@near-replay/core";
import {
  executionRows,
  explorerTransactionUrl,
  formatTimestamp,
  shortHash,
} from "@/lib/report-display";
import { Amount, RawEvidence, VerdictBadge } from "./evidence";
import { Icon } from "./icon";

const kindLabels = {
  direct: "Direct transfer",
  unsafe: "Unsafe fixture",
  guarded: "Guarded fixture",
};

function BalancePair({ snapshots }: { snapshots: BalanceSnapshots }) {
  return (
    <div className="balance-pair">
      {(["before", "after"] as const).map((phase) => {
        const snapshot = snapshots[phase];
        return (
          <div className="balance-point" key={phase}>
            <span className="field-label">
              {phase === "before" ? "Before" : "After"}
            </span>
            <Amount value={snapshot?.amountYocto ?? null} />
            {snapshot ? (
              <>
                <span className="block-reference">
                  FINAL · block {snapshot.block.height.toLocaleString("en-US")}
                </span>
                <time dateTime={snapshot.queriedAt}>
                  {formatTimestamp(snapshot.queriedAt)}
                </time>
                <code className="snapshot-account">{snapshot.recipientId}</code>
              </>
            ) : (
              <span className="missing-label">No snapshot captured</span>
            )}
          </div>
        );
      })}
    </div>
  );
}

function ReceiptTimeline({ attempt }: { attempt: TransactionAttempt }) {
  const rows = executionRows(attempt.finalOutcome).sort((a, b) => {
    const aHeight = attempt.finalBlocks.find(
      (block) => block.hash === a.blockHash,
    )?.height;
    const bHeight = attempt.finalBlocks.find(
      (block) => block.hash === b.blockHash,
    )?.height;
    if (aHeight === undefined && bHeight === undefined) return 0;
    if (aHeight === undefined) return 1;
    if (bHeight === undefined) return -1;
    return aHeight - bHeight;
  });
  if (rows.length === 0)
    return (
      <div className="missing-timeline">
        <Icon name="clock" />
        <div>
          <strong>No execution outcomes captured</strong>
          <p>
            Transaction inclusion alone does not establish the intended credit.
          </p>
        </div>
      </div>
    );
  return (
    <ol className="receipt-timeline">
      {rows.map((row, index) => {
        const block = attempt.finalBlocks.find(
          (reference) => reference.hash === row.blockHash,
        );
        return (
          <li
            className="execution-row"
            data-status={row.status}
            key={`${row.id}-${index}`}
          >
            <span className="timeline-node">
              <Icon
                name={
                  row.status === "FAILED"
                    ? "close"
                    : row.status === "SUCCEEDED"
                      ? "check"
                      : "clock"
                }
              />
            </span>
            <div className="execution-body">
              <div className="execution-heading">
                <span>
                  {row.kind === "transaction"
                    ? "Transaction execution"
                    : "Receipt execution"}
                </span>
                <span className="execution-status">{row.status}</span>
              </div>
              <code className="executor">{row.executorId}</code>
              <div className="execution-reference">
                <span>
                  {block
                    ? `FINAL · block ${block.height.toLocaleString("en-US")}`
                    : "Final block reference missing"}
                </span>
                <code title={row.id}>{shortHash(row.id)}</code>
              </div>
              {row.logs.length > 0 && (
                <pre className="receipt-logs">
                  <code>{row.logs.join("\n")}</code>
                </pre>
              )}
              <RawEvidence title="Public execution outcome" value={row.raw} />
            </div>
          </li>
        );
      })}
    </ol>
  );
}

function AttemptView({
  attempt,
  index,
}: {
  attempt: TransactionAttempt;
  index: number;
}) {
  const outcome =
    attempt.finalOutcome !== null &&
    typeof attempt.finalOutcome === "object" &&
    !Array.isArray(attempt.finalOutcome)
      ? attempt.finalOutcome
      : null;
  const final = outcome?.final_execution_status === "FINAL";
  return (
    <details className="attempt" open={index === 0}>
      <summary>
        <span className="attempt-number">
          {String(index + 1).padStart(2, "0")}
        </span>
        <div>
          <strong>
            {attempt.actionKind === "transfer" ? "Transfer" : "Function call"}
          </strong>
          <span className="attempt-id">{attempt.attemptId}</span>
        </div>
        <span className={`finality-label ${final ? "finality-confirmed" : ""}`}>
          {final ? "FINAL observed" : "FINAL not established"}
        </span>
        <Icon name="chevron" className="details-chevron" />
      </summary>
      <div className="attempt-content">
        <div className="transaction-link-row">
          <span className="field-label">Transaction hash</span>
          <a
            href={explorerTransactionUrl(attempt.txHash)}
            target="_blank"
            rel="noopener noreferrer"
            className="transaction-link"
          >
            <code>{attempt.txHash}</code>
            <Icon name="external" />
            <span className="sr-only">
              Open transaction on NEAR testnet explorer
            </span>
          </a>
        </div>
        <dl className="attempt-fields">
          <div>
            <dt>Signer</dt>
            <dd>
              <code>{attempt.signerId}</code>
            </dd>
          </div>
          <div>
            <dt>Receiver</dt>
            <dd>
              <code>{attempt.receiverId}</code>
            </dd>
          </div>
          <div>
            <dt>Nonce</dt>
            <dd>
              <code>{attempt.nonce}</code>
            </dd>
          </div>
          <div>
            <dt>Signed at</dt>
            <dd>
              <time dateTime={attempt.signedAt}>
                {formatTimestamp(attempt.signedAt)}
              </time>
            </dd>
          </div>
        </dl>
        {attempt.error && (
          <div className="evidence-error">
            <Icon name="close" />
            <div>
              <strong>{attempt.error.category} error</strong>
              <p>{attempt.error.message}</p>
            </div>
          </div>
        )}
        <div className="timeline-heading">
          <h4>Receipt timeline</h4>
          <span>Ordered by recorded block</span>
        </div>
        <ReceiptTimeline attempt={attempt} />
        <RawEvidence
          title="Complete attempt and RPC observations"
          value={attempt}
          hint="Public JSON"
        />
      </div>
    </details>
  );
}

export function TargetReportCard({
  target,
  approval: scenarioApproval,
}: {
  target: TargetReport;
  approval: ApprovalDetails;
}) {
  const approval = target.approval ?? scenarioApproval;
  const related = Object.entries(target.snapshots.relatedAccounts ?? {});
  return (
    <article
      className="target-card panel"
      data-kind={target.targetKind}
      data-verdict={target.verdict.status}
      aria-labelledby={`target-${target.targetId}`}
    >
      <div className="target-topline">
        <span className="target-kind">
          <Icon
            name={
              target.targetKind === "guarded"
                ? "shield"
                : target.targetKind === "unsafe"
                  ? "unlock"
                  : "arrow"
            }
          />
          {kindLabels[target.targetKind]}
        </span>
        <VerdictBadge status={target.verdict.status} />
      </div>
      <h3 id={`target-${target.targetId}`}>{target.label}</h3>
      <code className="target-account">{target.accountId}</code>
      <p className="verdict-summary">{target.verdict.summary}</p>
      <ul className="reason-codes" aria-label="Verdict reason codes">
        {target.verdict.reasonCodes.map((reason) => (
          <li key={reason}>
            <code>{reason}</code>
          </li>
        ))}
      </ul>
      <div className="target-amounts">
        <div>
          <span className="field-label">Approved credit</span>
          <Amount value={approval.amountYocto} />
        </div>
        <div>
          <span className="field-label">Observed balance delta</span>
          <Amount value={target.verdict.observedCreditYocto} />
        </div>
      </div>
      <div className="receipt-credit">
        <span className="field-label">Successful receipt-derived credit</span>
        <Amount value={target.verdict.successfulReceiptCreditYocto} />
      </div>
      <section
        className="balance-section"
        aria-label="Approved recipient balances"
      >
        <div className="subsection-heading">
          <h4>Recipient balance</h4>
          <Icon name="layers" />
        </div>
        <code className="recipient-account">{approval.recipientId}</code>
        <BalancePair snapshots={target.snapshots} />
        <RawEvidence
          title="Balance snapshots and query evidence"
          value={target.snapshots}
        />
      </section>
      {related.length > 0 && (
        <details className="related-accounts">
          <summary>
            <span>Related account balances</span>
            <span className="count-label">{related.length}</span>
            <Icon name="chevron" className="details-chevron" />
          </summary>
          <div>
            {related.map(([accountId, snapshots]) => (
              <section className="related-account" key={accountId}>
                <code className="recipient-account">{accountId}</code>
                <BalancePair snapshots={snapshots} />
              </section>
            ))}
          </div>
        </details>
      )}
      {target.stateSnapshots && target.stateSnapshots.length > 0 && (
        <section className="contract-state">
          <div className="subsection-heading">
            <h4>Finalized contract views</h4>
            <Icon name="shield" />
          </div>
          {target.stateSnapshots.map((snapshot, index) => (
            <RawEvidence
              key={`${snapshot.contractId}-${snapshot.methodName}-${index}`}
              title={`${snapshot.methodName} · block ${snapshot.block.height}`}
              value={snapshot}
            />
          ))}
        </section>
      )}
      {target.errors && target.errors.length > 0 && (
        <div className="target-errors">
          {target.errors.map((error, index) => (
            <div className="evidence-error" key={`${error.category}-${index}`}>
              <Icon name="close" />
              <div>
                <strong>Run error · {error.category}</strong>
                <p>{error.message}</p>
              </div>
            </div>
          ))}
        </div>
      )}
      <section className="attempts-section">
        <div className="subsection-heading">
          <h4>Signed attempts</h4>
          <span className="count-label">{target.attempts.length}</span>
        </div>
        {target.attempts.length > 0 ? (
          target.attempts.map((attempt, index) => (
            <AttemptView
              attempt={attempt}
              index={index}
              key={`${attempt.attemptId}-${index}`}
            />
          ))
        ) : (
          <div className="missing-timeline">
            <Icon name="clock" />
            <div>
              <strong>No signed attempts captured</strong>
              <p>Review the errors and public RPC evidence for this target.</p>
            </div>
          </div>
        )}
      </section>
      <RawEvidence title="Complete target evidence" value={target} />
    </article>
  );
}
