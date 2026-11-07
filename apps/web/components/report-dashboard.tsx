"use client";

import {
  useId,
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent,
} from "react";
import {
  validateRunReport,
  type ApprovalDetails,
  type RunReport,
  type ScenarioReport,
} from "@near-replay/core";
import { formatTimestamp } from "@/lib/report-display";
import { Amount, RawEvidence, RpcLedger, VerdictBadge } from "./evidence";
import { Icon } from "./icon";
import { TargetReportCard } from "./target-report";

const MAX_REPORT_BYTES = 20 * 1024 * 1024;
const sourceLabels: Record<ApprovalDetails["source"], string> = {
  "operator-config": "Operator configuration",
  "constructed-fixture": "Constructed fixture",
  "on-chain": "On-chain approval",
};
const provenanceLabels: Record<RunReport["provenance"]["mode"], string> = {
  live: "Live RPC capture",
  recorded: "Recorded capture",
  synthetic: "Synthetic fixture",
};

function Brand() {
  return (
    <div className="brand">
      <span className="brand-mark" aria-hidden="true">
        <svg viewBox="0 0 28 28" fill="none">
          <path
            d="M6 21V7a1 1 0 0 1 1.8-.6L20 21V7M6 21l5-5M20 7l-5 5"
            stroke="currentColor"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </span>
      <span>
        NEAR <strong>Replay Lab</strong>
      </span>
    </div>
  );
}

function EmptyState({
  onImport,
  onLoadRecorded,
  loading,
  dragging,
  onDragOver,
  onDragLeave,
  onDrop,
}: {
  onImport: () => void;
  onLoadRecorded: () => void;
  loading: boolean;
  dragging: boolean;
  onDragOver: (event: DragEvent) => void;
  onDragLeave: () => void;
  onDrop: (event: DragEvent) => void;
}) {
  return (
    <section
      className={`empty-state panel ${dragging ? "is-dragging" : ""}`}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      aria-labelledby="empty-title"
    >
      <div className="empty-flow" aria-hidden="true">
        <div className="flow-node">
          <Icon name="file" />
          <span>Approval</span>
        </div>
        <span className="flow-connector">
          <Icon name="arrow" />
        </span>
        <div className="flow-node">
          <Icon name="arrow" />
          <span>Transfer</span>
        </div>
        <span className="flow-connector">
          <Icon name="arrow" />
        </span>
        <div className="flow-node flow-final">
          <Icon name="receipt" />
          <span>FINAL receipts</span>
        </div>
      </div>
      <span className="eyebrow">YOUR EVIDENCE, IN VIEW</span>
      <h2 id="empty-title">Start with a real run.</h2>
      <p className="empty-description">
        Import a NEAR testnet report to follow the approved payment, inspect
        every recorded receipt, and check the recipient’s balance.
      </p>
      <div className="empty-actions">
        <button
          type="button"
          className="button button-primary button-large"
          onClick={onImport}
          disabled={loading}
        >
          <Icon name="upload" />
          {loading ? "Checking report…" : "Import run report"}
          <Icon name="arrow" />
        </button>
        <button
          type="button"
          className="button button-secondary"
          onClick={onLoadRecorded}
          disabled={loading}
        >
          <Icon name="receipt" />
          Load recorded demo
        </button>
      </div>
      <span className="drop-hint">
        Or drop a report here · JSON, up to 20 MiB
      </span>
      <div className="empty-note">
        <Icon name="clock" />
        <p>
          No run is loaded. Verdicts and balances appear only after a report
          passes validation.
        </p>
      </div>
    </section>
  );
}

function CaptureGuide() {
  return (
    <section
      className="capture-guide panel"
      id="capture-guide"
      aria-labelledby="capture-title"
    >
      <div className="section-heading">
        <div>
          <span className="eyebrow">FROM YOUR LOCAL RUNNER</span>
          <h2 id="capture-title">Capture. Compare. Inspect.</h2>
        </div>
        <Icon name="terminal" />
      </div>
      <div className="capture-steps">
        <div>
          <span className="step-number">01</span>
          <h3>Bootstrap testnet</h3>
          <p>
            Use the free bootstrap to create a disposable operator in a fresh
            checkout.
          </p>
        </div>
        <div>
          <span className="step-number">02</span>
          <h3>Run the comparison</h3>
          <p>
            Check the bundled Wasm, run setup, then run the fixture suite.
            Signing stays in the local runner.
          </p>
        </div>
        <div>
          <span className="step-number">03</span>
          <h3>Bring the JSON here</h3>
          <p>
            Import the JSON path printed by suite. Default:{" "}
            <code>reports/local/fixture-suite-*.json</code>.
          </p>
        </div>
      </div>
      <details className="runner-commands">
        <summary>
          <Icon name="terminal" />
          <span>Show fixture comparison commands</span>
          <Icon name="chevron" className="details-chevron" />
        </summary>
        <pre tabIndex={0}>
          <code>
            {
              "npm ci\nnpm run build:runner\nnpm run cli -- bootstrap\nnpm run cli -- setup --check\nnpm run cli -- setup\nnpm run cli -- suite"
            }
          </code>
        </pre>
        <p>
          Run these from the repository root. Bootstrap requires a checkout
          without <code>.env</code>; skip it when a disposable operator is
          already configured.
        </p>
      </details>
    </section>
  );
}

function EvidenceGuide() {
  return (
    <section
      className="evidence-guide"
      id="evidence-guide"
      aria-labelledby="guide-title"
    >
      <div className="guide-intro">
        <span className="eyebrow">READ THE VERDICT</span>
        <h2 id="guide-title">A receipt is part of the proof.</h2>
        <p>
          The evaluator combines the exact approval, finalized execution, and
          recipient balance evidence. A successful top-level call alone does not
          prove a downstream payment.
        </p>
      </div>
      <div className="verdict-guide">
        <div>
          <VerdictBadge status="HOLDS" />
          <p>The evidence establishes the tested invariant.</p>
        </div>
        <div>
          <VerdictBadge status="VIOLATED" />
          <p>
            Finalized evidence establishes a payment outside the tested
            invariant.
          </p>
        </div>
        <div>
          <VerdictBadge status="INCONCLUSIVE" />
          <p>
            Missing, unknown, or inconsistent evidence leaves the result
            unresolved.
          </p>
        </div>
      </div>
    </section>
  );
}

function ScenarioNavigation({
  report,
  selectedId,
  onSelect,
}: {
  report: RunReport | null;
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  return (
    <aside className="scenario-sidebar">
      <div className="sidebar-title">
        <span className="eyebrow">SCENARIO INDEX</span>
        {report && (
          <span className="count-label">{report.scenarios.length}</span>
        )}
      </div>
      {report ? (
        <nav aria-label="Scenarios" className="scenario-list">
          {report.scenarios.map((scenario, index) => (
            <button
              type="button"
              key={scenario.scenarioId}
              className={`scenario-button ${selectedId === scenario.scenarioId ? "is-selected" : ""}`}
              aria-pressed={selectedId === scenario.scenarioId}
              onClick={() => onSelect(scenario.scenarioId)}
            >
              <span className="scenario-number">
                {String(index + 1).padStart(2, "0")}
              </span>
              <span className="scenario-button-content">
                <strong>{scenario.title}</strong>
                <span>
                  {scenario.targets
                    .map((target) =>
                      target.targetKind === "direct"
                        ? "Direct transfer"
                        : target.targetKind === "unsafe"
                          ? "Unsafe"
                          : "Guarded",
                    )
                    .join(" / ")}
                </span>
              </span>
              <Icon name="chevron" />
            </button>
          ))}
        </nav>
      ) : (
        <div className="sidebar-empty">
          <Icon name="layers" />
          <strong>No scenarios loaded</strong>
          <p>
            Your report defines the scenarios and the targets you can inspect.
          </p>
        </div>
      )}
      <div className="sidebar-note">
        <span className="sidebar-note-icon">
          <Icon name="shield" />
        </span>
        <strong>Evidence stays local</strong>
        <p>
          The viewer reads your file in this tab. Signing belongs to the local
          runner.
        </p>
      </div>
      {report && (
        <a href="#rpc-ledger" className="ledger-jump">
          <Icon name="code" />
          Public RPC ledger
          <Icon name="arrow" />
        </a>
      )}
    </aside>
  );
}

function ApprovalPanel({
  approval,
  targetLabel,
}: {
  approval: ApprovalDetails;
  targetLabel?: string;
}) {
  const headingId = useId();
  return (
    <section className="approval-panel panel" aria-labelledby={headingId}>
      <div className="approval-primary">
        <div>
          <span className="eyebrow" id={headingId}>
            {targetLabel
              ? `APPROVAL FOR ${targetLabel}`
              : "THE APPROVED OBLIGATION"}
          </span>
          <Amount value={approval.amountYocto} large />
        </div>
        <div className="approval-recipient">
          <span className="field-label">Intended recipient</span>
          <code>{approval.recipientId}</code>
          <span className="approval-source">
            {sourceLabels[approval.source]}
          </span>
        </div>
      </div>
      <dl className="approval-fields">
        <div>
          <dt>Signer</dt>
          <dd>
            <code>{approval.signerId}</code>
          </dd>
        </div>
        <div>
          <dt>Approval ID</dt>
          <dd>
            <code>{approval.approvalId}</code>
          </dd>
        </div>
        <div>
          <dt>Approved at</dt>
          <dd>
            <time dateTime={approval.approvedAt}>
              {formatTimestamp(approval.approvedAt)}
            </time>
          </dd>
        </div>
        <div>
          <dt>Expiry</dt>
          <dd>
            {approval.expiresAt ? (
              <time dateTime={approval.expiresAt}>
                {formatTimestamp(approval.expiresAt)}
              </time>
            ) : (
              "No expiry recorded"
            )}
          </dd>
        </div>
        {approval.invoiceId && (
          <div>
            <dt>Invoice ID</dt>
            <dd>
              <code>{approval.invoiceId}</code>
            </dd>
          </div>
        )}
      </dl>
      <RawEvidence
        title={
          targetLabel
            ? `Approval evidence · ${targetLabel}`
            : "Complete approval evidence"
        }
        value={approval}
      />
    </section>
  );
}

function ScenarioView({
  scenario,
  index,
}: {
  scenario: ScenarioReport;
  index: number;
}) {
  const comparison =
    scenario.targets.some((target) => target.targetKind === "unsafe") &&
    scenario.targets.some((target) => target.targetKind === "guarded");
  const order = { direct: 0, unsafe: 1, guarded: 2 };
  const targets = [...scenario.targets].sort(
    (a, b) => order[a.targetKind] - order[b.targetKind],
  );
  const hasTargetApprovals = targets.some(
    (target) => target.approval !== undefined,
  );
  return (
    <section className="scenario-view" aria-labelledby="scenario-title">
      <div className="scenario-heading">
        <div className="scenario-eyebrow">
          <span className="eyebrow">
            SCENARIO {String(index + 1).padStart(2, "0")}
          </span>
          <span className="scenario-kind">
            {scenario.kind.replace(/[_-]+/g, " ")}
          </span>
        </div>
        <h2 id="scenario-title">{scenario.title}</h2>
        <p>{scenario.description}</p>
      </div>
      {hasTargetApprovals ? (
        <div className="per-target-approvals">
          <p className="approval-scope-note">
            Approvals are shown per target. Review the exact recipient and
            amount for each execution path.
          </p>
          <div
            className={`targets-grid ${targets.length === 1 ? "single-target" : ""}`}
          >
            {targets.map((target) => (
              <ApprovalPanel
                key={target.targetId}
                approval={target.approval ?? scenario.approval}
                targetLabel={target.label}
              />
            ))}
          </div>
        </div>
      ) : (
        <ApprovalPanel approval={scenario.approval} />
      )}
      <div className="comparison-heading">
        <div>
          <span className="eyebrow">
            {comparison ? "EXECUTION COMPARISON" : "PAYMENT EVIDENCE"}
          </span>
          <h2>
            {comparison
              ? hasTargetApprovals
                ? "Compare each target’s execution."
                : "Same obligation. Two execution paths."
              : "Follow the payment."}
          </h2>
        </div>
        <span className="comparison-note">
          {comparison ? "Unsafe / Guarded" : "Approval → Receipts → Balance"}
        </span>
      </div>
      <div
        className={`targets-grid ${targets.length === 1 ? "single-target" : ""}`}
      >
        {targets.map((target) => (
          <TargetReportCard
            key={target.targetId}
            target={target}
            approval={scenario.approval}
          />
        ))}
      </div>
    </section>
  );
}

export function ReportDashboard() {
  const uploader = useRef<HTMLInputElement>(null);
  const sequence = useRef(0);
  const [report, setReport] = useState<RunReport | null>(null);
  const [sourceName, setSourceName] = useState("");
  const [scenarioId, setScenarioId] = useState<string | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [importMessage, setImportMessage] = useState("");
  const scenario =
    report?.scenarios.find((item) => item.scenarioId === scenarioId) ??
    report?.scenarios[0];

  const importFile = async (file: File) => {
    const token = ++sequence.current;
    setErrors([]);
    setImportMessage("");
    setLoading(true);
    setDragging(false);
    try {
      if (file.size > MAX_REPORT_BYTES) {
        setErrors([
          "This report is larger than 20 MiB. Import a smaller exported run report.",
        ]);
        return;
      }
      let input: unknown;
      try {
        input = JSON.parse(await file.text());
      } catch {
        if (token === sequence.current)
          setErrors([
            "This file could not be read as JSON. Import a JSON RunReport exported by the local runner.",
          ]);
        return;
      }
      if (token !== sequence.current) return;
      const result = validateRunReport(input);
      if (!result.valid) {
        setErrors(
          result.errors.length
            ? result.errors
            : ["This file does not match the supported RunReport format."],
        );
        return;
      }
      setReport(result.report);
      setScenarioId(result.report.scenarios[0]?.scenarioId ?? null);
      setSourceName(file.name);
      setImportMessage(
        `Imported ${file.name}. Report structure and derived verdicts passed validation.`,
      );
    } catch {
      if (token === sequence.current)
        setErrors([
          "This report could not be validated. Export a supported RunReport with the local runner and try again.",
        ]);
    } finally {
      if (token === sequence.current) setLoading(false);
    }
  };

  const loadRecordedDemo = async () => {
    const token = ++sequence.current;
    setErrors([]);
    setImportMessage("");
    setLoading(true);
    try {
      const response = await fetch("/reports/recorded-suite.json", {
        cache: "no-store",
        credentials: "omit",
        signal: AbortSignal.timeout(15000),
      });
      if (token !== sequence.current) return;
      if (response.status === 404) {
        setErrors([
          "No recorded demo is available yet. Import a report exported by your local testnet runner.",
        ]);
        return;
      }
      if (!response.ok) {
        setErrors([
          "The recorded demo could not be loaded. Import a local run report instead.",
        ]);
        return;
      }
      const content = await response.text();
      if (token !== sequence.current) return;
      if (new Blob([content]).size > MAX_REPORT_BYTES) {
        setErrors([
          "The recorded demo is larger than 20 MiB. Import a smaller exported run report.",
        ]);
        return;
      }
      let input: unknown;
      try {
        input = JSON.parse(content);
      } catch {
        setErrors([
          "The recorded demo is not readable RunReport JSON. Import a local report instead.",
        ]);
        return;
      }
      const result = validateRunReport(input);
      if (!result.valid) {
        setErrors(result.errors);
        return;
      }
      if (result.report.provenance.mode !== "recorded") {
        setErrors([
          "The demo file must identify itself as a recorded capture. Import your local report to inspect its original provenance.",
        ]);
        return;
      }
      setReport(result.report);
      setScenarioId(result.report.scenarios[0]?.scenarioId ?? null);
      setSourceName("recorded-suite.json");
      setImportMessage(
        "Loaded the recorded demo. This saved capture is not a continuously live run.",
      );
    } catch {
      if (token === sequence.current)
        setErrors([
          "The recorded demo could not be loaded or validated. Import a local run report instead.",
        ]);
    } finally {
      if (token === sequence.current) setLoading(false);
    }
  };

  const onFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (file) void importFile(file);
  };
  const onDrop = (event: DragEvent) => {
    event.preventDefault();
    setDragging(false);
    if (loading) return;
    if (event.dataTransfer.files.length !== 1) {
      setErrors(["Import one run report at a time."]);
      return;
    }
    const file = event.dataTransfer.files[0];
    if (file) void importFile(file);
  };
  const downloadReport = () => {
    if (!report) return;
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(report, null, 2)], { type: "application/json" }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = `${report.runId.replace(/[^a-zA-Z0-9._-]/g, "_") || "near-run"}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const clearReport = () => {
    sequence.current += 1;
    setReport(null);
    setScenarioId(null);
    setSourceName("");
    setErrors([]);
    setImportMessage("Report removed from this tab.");
    setLoading(false);
  };

  return (
    <div className="app-shell">
      <a className="skip-link" href="#workbench">
        Skip to workbench
      </a>
      <header className="site-header">
        <Brand />
        <nav className="top-nav" aria-label="Page">
          <a href="#workbench" className="nav-active">
            Workbench
          </a>
          <a href="#evidence-guide">Evidence guide</a>
        </nav>
        <div className="header-actions">
          {report && (
            <button
              type="button"
              className="button button-secondary"
              onClick={downloadReport}
              aria-label="Download report JSON"
            >
              <Icon name="download" />
              <span>Download JSON</span>
            </button>
          )}
          <button
            type="button"
            className="button button-primary"
            onClick={() => uploader.current?.click()}
            disabled={loading}
          >
            <Icon name="upload" />
            <span>{loading ? "Checking…" : "Import report"}</span>
          </button>
        </div>
        <input
          ref={uploader}
          className="sr-only"
          type="file"
          accept=".json,application/json"
          onChange={onFileChange}
          aria-label="Import run report JSON"
          tabIndex={-1}
        />
      </header>
      <main>
        <section className="hero">
          <div className="hero-copy">
            <div className="hero-eyebrow">
              <span className="eyebrow">A WORKBENCH FOR AGENT PAYMENTS</span>
              <span className="testnet-label">NEAR TESTNET</span>
            </div>
            <h1>
              Test agent payments.
              <br />
              <span>Inspect the receipts.</span>
            </h1>
            <p>
              Follow the approval, the execution, and the exact credit.
              <br className="desktop-break" /> Public evidence for every
              verdict.
            </p>
          </div>
          <div className="hero-caption">
            <span className="caption-rule" />
            <Icon name="receipt" />
            <span>
              From intent
              <br />
              to execution.
            </span>
          </div>
        </section>
        <div
          className="status-announcement sr-only"
          role="status"
          aria-live="polite"
        >
          {importMessage}
        </div>
        {errors.length > 0 && (
          <section className="import-error" role="alert">
            <Icon name="close" />
            <div>
              <h2>Report could not be imported</h2>
              <p>
                {report
                  ? "The current report is still loaded."
                  : "Import a supported RunReport to continue."}
              </p>
              <ul>
                {errors.slice(0, 8).map((error, index) => (
                  <li key={index}>{error}</li>
                ))}
              </ul>
              {errors.length > 8 && (
                <details>
                  <summary>
                    Show {errors.length - 8} more validation errors
                  </summary>
                  <ul>
                    {errors.slice(8).map((error, index) => (
                      <li key={index}>{error}</li>
                    ))}
                  </ul>
                </details>
              )}
            </div>
            <button
              type="button"
              className="icon-button"
              onClick={() => setErrors([])}
              aria-label="Dismiss import error"
            >
              <Icon name="close" />
            </button>
          </section>
        )}
        {report && (
          <section className="report-context" aria-label="Report context">
            <div className="report-metadata">
              <div>
                <span className="field-label">Network</span>
                <strong>{report.network.networkId}</strong>
              </div>
              <div>
                <span className="field-label">Captured at</span>
                <time dateTime={report.createdAt}>
                  {formatTimestamp(report.createdAt)}
                </time>
              </div>
              <div>
                <span className="field-label">Provenance</span>
                <strong
                  className="provenance-label"
                  data-mode={report.provenance.mode}
                >
                  {provenanceLabels[report.provenance.mode]}
                </strong>
              </div>
              <div className="report-source">
                <span className="field-label">Report file</span>
                <span title={sourceName}>{sourceName}</span>
                <button
                  type="button"
                  className="text-button"
                  onClick={clearReport}
                >
                  Remove
                </button>
              </div>
            </div>
            <div className="provenance-description">
              <span>
                <Icon name="check" />
                Validated on import
              </span>
              <p>
                {report.provenance.description} Imported provenance is a claim
                of origin, not an authenticated proof.
              </p>
            </div>
          </section>
        )}
        <div className="workbench-layout" id="workbench">
          <ScenarioNavigation
            report={report}
            selectedId={scenario?.scenarioId ?? null}
            onSelect={setScenarioId}
          />
          <div className="workbench-content">
            {scenario && report ? (
              <>
                <ScenarioView
                  scenario={scenario}
                  index={report.scenarios.findIndex(
                    (item) => item.scenarioId === scenario.scenarioId,
                  )}
                />
                <RpcLedger records={report.rpcEvidence} />
                <section className="full-report panel">
                  <div className="report-version">
                    <span>
                      Run <code>{report.runId}</code>
                    </span>
                    <span>
                      Schema {report.schemaVersion} · {report.versions.adapter}{" "}
                      · build {report.versions.build}
                    </span>
                  </div>
                  <RawEvidence
                    title="Complete imported run report"
                    value={report}
                    hint="Public JSON"
                  />
                  <div className="rpc-endpoint">
                    <span className="field-label">Recorded RPC endpoint</span>
                    <code>{report.network.rpcUrl}</code>
                  </div>
                </section>
              </>
            ) : (
              <EmptyState
                onImport={() => uploader.current?.click()}
                onLoadRecorded={() => void loadRecordedDemo()}
                loading={loading}
                dragging={dragging}
                onDragOver={(event) => {
                  event.preventDefault();
                  if (!loading) setDragging(true);
                }}
                onDragLeave={() => setDragging(false)}
                onDrop={onDrop}
              />
            )}
            <CaptureGuide />
          </div>
        </div>
        <EvidenceGuide />
      </main>
      <footer className="site-footer">
        <Brand />
        <p>Read-only by design. Signing stays in your local runner.</p>
        <span>Native NEAR · Testnet</span>
      </footer>
    </div>
  );
}
