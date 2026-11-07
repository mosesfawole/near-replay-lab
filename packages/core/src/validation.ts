import { REPORT_SCHEMA_VERSION, type ApprovalDetails, type ReportValidation, type RunReport, type ScenarioEvaluationContext, type TargetReport } from './types.js';
import { evaluateTargetEvidence } from './oracle.js';
import { publicSignaturePaths } from './public-signatures.js';

type Obj = Record<string, unknown>;
const unsigned = /^(0|[1-9][0-9]*)$/;
const signed = /^-?(0|[1-9][0-9]*)$/;
const secretField = /private[_-]?key|secret[_-]?key|seed[_-]?phrase|mnemonic/i;
const secretValue = /ed25519:[1-9A-HJ-NP-Za-km-z]{80,}/;
// Complete ten-target runs retain raw status/block evidence in several declared slots.
const maximumJsonNodes = 1_000_000;
function isObject(value: unknown): value is Obj { return value !== null && typeof value === 'object' && !Array.isArray(value); }

/** Browser-safe runtime validation, including a fresh calculation of every stored verdict. */
export function validateRunReport(input: unknown): ReportValidation {
  const errors: string[] = [];
  const fail = (path: string, message: string) => { if (errors.length < 100) errors.push(`${path}: ${message}`); };
  const signaturePaths = publicSignaturePaths(input);
  let nodes = 0;
  const scan = (value: unknown, path: string, ancestors: Set<object>, depth: number, parts: string[]): void => {
    if (++nodes > maximumJsonNodes || depth > 60) { fail(path, 'JSON evidence exceeds validation limits.'); return; }
    if (value === null || typeof value === 'boolean') return;
    if (typeof value === 'string') {
      if (value.length > 2_000_000) fail(path, 'String is too large.');
      if (!signaturePaths.has(JSON.stringify(parts)) && secretValue.test(value)) fail(path, 'Private secret key material is forbidden.');
      return;
    }
    if (typeof value === 'number') { if (!Number.isFinite(value)) fail(path, 'Must be a finite JSON number.'); return; }
    if (typeof value !== 'object') { fail(path, 'Must be JSON serializable.'); return; }
    if (ancestors.has(value)) { fail(path, 'Circular JSON evidence is forbidden.'); return; }
    ancestors.add(value);
    for (const key in value) {
      if (!Object.hasOwn(value, key)) continue;
      const child = (value as Obj)[key];
      if (secretField.test(key)) fail(`${path}.${key}`, 'Private key or secret fields are forbidden.');
      scan(child, `${path}.${key}`, ancestors, depth + 1, [...parts, key]);
      if (nodes > maximumJsonNodes) break;
    }
    ancestors.delete(value);
  };
  scan(input, 'report', new Set(), 0, []);
  const obj = (value: unknown, path: string): Obj => { if (!isObject(value)) { fail(path, 'Must be an object.'); return {}; } return value; };
  const str = (value: unknown, path: string): void => { if (typeof value !== 'string' || !value.trim()) fail(path, 'Must be a nonempty string.'); };
  const decimal = (value: unknown, path: string, allowSigned = false): void => {
    if (typeof value !== 'string' || value.length > 78 || !(allowSigned ? signed : unsigned).test(value)) fail(path, 'Must be an exact decimal integer string.');
  };
  const date = (value: unknown, path: string): void => {
    if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\dT/.test(value) || !Number.isFinite(Date.parse(value))) fail(path, 'Must be an ISO timestamp.');
  };
  const array = (value: unknown, path: string, nonempty = false): unknown[] => {
    if (!Array.isArray(value)) { fail(path, 'Must be an array.'); return []; }
    if (nonempty && value.length === 0) fail(path, 'Must not be empty.');
    return value;
  };
  const choice = (value: unknown, choices: string[], path: string): void => { if (typeof value !== 'string' || !choices.includes(value)) fail(path, `Must be ${choices.join(', ')}.`); };
  const account = (value: unknown, path: string): void => {
    if (typeof value !== 'string' || value.length > 64 || !/^[a-z0-9]+(?:[-_.][a-z0-9]+)*\.testnet$/.test(value)) fail(path, 'Must be a named testnet account ID.');
  };
  const publicError = (value: unknown, path: string): void => {
    const e = obj(value, path); choice(e.category, ['configuration', 'transport', 'timeout', 'rpc', 'evidence', 'local'], `${path}.category`);
    str(e.message, `${path}.message`); if (e.code !== undefined) str(e.code, `${path}.code`);
  };
  const rpc = (value: unknown, path: string): void => {
    const r = obj(value, path); str(r.method, `${path}.method`); date(r.requestedAt, `${path}.requestedAt`); date(r.receivedAt, `${path}.receivedAt`);
    if (!('params' in r)) fail(`${path}.params`, 'Public request parameters are required.');
    if (!('response' in r)) fail(`${path}.response`, 'Raw response or null is required.');
    if (r.error !== undefined) publicError(r.error, `${path}.error`);
  };
  const block = (value: unknown, path: string): void => {
    const b = obj(value, path); str(b.hash, `${path}.hash`); choice(b.finality, ['FINAL'], `${path}.finality`);
    if (typeof b.height !== 'number' || !Number.isSafeInteger(b.height) || b.height < 0) fail(`${path}.height`, 'Must be a safe integer block height.');
    if (b.evidence !== undefined) rpc(b.evidence, `${path}.evidence`);
  };
  const snapshot = (value: unknown, path: string): void => {
    if (value === null) return;
    const s = obj(value, path); account(s.recipientId, `${path}.recipientId`); decimal(s.amountYocto, `${path}.amountYocto`);
    decimal(s.lockedYocto, `${path}.lockedYocto`); date(s.queriedAt, `${path}.queriedAt`); block(s.block, `${path}.block`); rpc(s.evidence, `${path}.evidence`);
  };
  const balances = (value: unknown, path: string): void => { const b = obj(value, path); snapshot(b.before, `${path}.before`); snapshot(b.after, `${path}.after`); };
  const approval = (value: unknown, path: string): void => {
    const a = obj(value, path); str(a.approvalId, `${path}.approvalId`); account(a.signerId, `${path}.signerId`); account(a.recipientId, `${path}.recipientId`);
    decimal(a.amountYocto, `${path}.amountYocto`); choice(a.source, ['operator-config', 'constructed-fixture', 'on-chain'], `${path}.source`); date(a.approvedAt, `${path}.approvedAt`);
    if (a.expiresAt !== undefined) date(a.expiresAt, `${path}.expiresAt`); if (a.invoiceId !== undefined) str(a.invoiceId, `${path}.invoiceId`);
    if (a.evidence !== undefined) rpc(a.evidence, `${path}.evidence`);
  };
  const attempt = (value: unknown, path: string): void => {
    const a = obj(value, path); str(a.attemptId, `${path}.attemptId`); choice(a.actionKind, ['transfer', 'function-call'], `${path}.actionKind`);
    account(a.signerId, `${path}.signerId`); account(a.receiverId, `${path}.receiverId`); str(a.publicKey, `${path}.publicKey`);
    if (typeof a.publicKey === 'string' && !/^ed25519:[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(a.publicKey)) fail(`${path}.publicKey`, 'Must be an ed25519 public key.');
    decimal(a.amountYocto, `${path}.amountYocto`); decimal(a.nonce, `${path}.nonce`); str(a.txHash, `${path}.txHash`); date(a.signedAt, `${path}.signedAt`);
    array(a.actions, `${path}.actions`, true).forEach((action, i) => {
      const p = `${path}.actions[${i}]`, item = obj(action, p); choice(item.kind, ['transfer', 'function-call'], `${p}.kind`); decimal(item.amountYocto, `${p}.amountYocto`);
      if (item.kind === 'function-call') { str(item.methodName, `${p}.methodName`); decimal(item.gas, `${p}.gas`); if (!('args' in item)) fail(`${p}.args`, 'Arguments are required.'); }
    });
    if (a.broadcast !== null) rpc(a.broadcast, `${path}.broadcast`);
    array(a.observations, `${path}.observations`).forEach((r, i) => rpc(r, `${path}.observations[${i}]`));
    if (!('finalOutcome' in a)) fail(`${path}.finalOutcome`, 'Outcome or null is required.');
    array(a.finalBlocks, `${path}.finalBlocks`).forEach((b, i) => block(b, `${path}.finalBlocks[${i}]`));
    if (a.error !== undefined) publicError(a.error, `${path}.error`);
  };
  const root = obj(input, 'report');
  if (root.schemaVersion !== REPORT_SCHEMA_VERSION) fail('report.schemaVersion', `Only ${REPORT_SCHEMA_VERSION} is supported.`);
  str(root.runId, 'report.runId'); date(root.createdAt, 'report.createdAt');
  const network = obj(root.network, 'report.network'); choice(network.networkId, ['testnet'], 'report.network.networkId');
  str(network.rpcUrl, 'report.network.rpcUrl');
  try {
    const url = new URL(String(network.rpcUrl));
    if (url.protocol !== 'https:' || url.username || url.password || /mainnet/i.test(url.hostname)) fail('report.network.rpcUrl', 'Must be a public HTTPS testnet RPC URL.');
  } catch { fail('report.network.rpcUrl', 'Must be a valid RPC URL.'); }
  const provenance = obj(root.provenance, 'report.provenance'); choice(provenance.mode, ['live', 'recorded', 'synthetic'], 'report.provenance.mode'); str(provenance.description, 'report.provenance.description');
  const versions = obj(root.versions, 'report.versions'); str(versions.adapter, 'report.versions.adapter'); str(versions.build, 'report.versions.build');
  array(root.rpcEvidence, 'report.rpcEvidence').forEach((r, i) => rpc(r, `report.rpcEvidence[${i}]`));
  const evaluations: { target: TargetReport; approval: ApprovalDetails; kind: string; verdict: Obj; path: string }[] = [];
  const scenarioIds = new Set<string>();
  array(root.scenarios, 'report.scenarios', true).forEach((value, i) => {
    const p = `report.scenarios[${i}]`, s = obj(value, p);
    str(s.scenarioId, `${p}.scenarioId`); str(s.title, `${p}.title`); str(s.kind, `${p}.kind`); str(s.description, `${p}.description`); approval(s.approval, `${p}.approval`);
    if (typeof s.scenarioId === 'string') { if (scenarioIds.has(s.scenarioId)) fail(`${p}.scenarioId`, 'Must be unique.'); scenarioIds.add(s.scenarioId); }
    const targetIds = new Set<string>();
    array(s.targets, `${p}.targets`, true).forEach((value, j) => {
      const q = `${p}.targets[${j}]`, t = obj(value, q);
      str(t.targetId, `${q}.targetId`); str(t.label, `${q}.label`); choice(t.targetKind, ['direct', 'unsafe', 'guarded'], `${q}.targetKind`); account(t.accountId, `${q}.accountId`);
      if (t.approval !== undefined) approval(t.approval, `${q}.approval`);
      if (typeof t.targetId === 'string') { if (targetIds.has(t.targetId)) fail(`${q}.targetId`, 'Must be unique within the scenario.'); targetIds.add(t.targetId); }
      array(t.attempts, `${q}.attempts`).forEach((a, k) => attempt(a, `${q}.attempts[${k}]`)); balances(t.snapshots, `${q}.snapshots`);
      const snapshots = obj(t.snapshots, `${q}.snapshots`);
      if (snapshots.relatedAccounts !== undefined) {
        const related = obj(snapshots.relatedAccounts, `${q}.snapshots.relatedAccounts`);
        for (const [id, b] of Object.entries(related)) { account(id, `${q}.snapshots.relatedAccounts.key`); balances(b, `${q}.snapshots.relatedAccounts.${id}`); }
      }
      if (t.errors !== undefined) array(t.errors, `${q}.errors`).forEach((e, k) => publicError(e, `${q}.errors[${k}]`));
      if (t.stateSnapshots !== undefined) array(t.stateSnapshots, `${q}.stateSnapshots`).forEach((v, k) => {
        const r = `${q}.stateSnapshots[${k}]`, state = obj(v, r); account(state.contractId, `${r}.contractId`); str(state.methodName, `${r}.methodName`);
        if (!('args' in state) || !('value' in state)) fail(r, 'Contract arguments and state value are required.'); block(state.block, `${r}.block`); rpc(state.evidence, `${r}.evidence`);
      });
      const verdict = obj(t.verdict, `${q}.verdict`); choice(verdict.status, ['HOLDS', 'VIOLATED', 'INCONCLUSIVE'], `${q}.verdict.status`); str(verdict.summary, `${q}.verdict.summary`);
      array(verdict.reasonCodes, `${q}.verdict.reasonCodes`, true).forEach((c, k) => str(c, `${q}.verdict.reasonCodes[${k}]`));
      decimal(verdict.intendedCreditYocto, `${q}.verdict.intendedCreditYocto`);
      for (const key of ['observedCreditYocto', 'successfulReceiptCreditYocto']) if (verdict[key] !== null) decimal(verdict[key], `${q}.verdict.${key}`, key === 'observedCreditYocto');
      array(verdict.transactionHashes, `${q}.verdict.transactionHashes`).forEach((h, k) => str(h, `${q}.verdict.transactionHashes[${k}]`));
      evaluations.push({ target: t as unknown as TargetReport, approval: (t.approval ?? s.approval) as ApprovalDetails, kind: s.kind as string, verdict, path: q });
    });
  });
  // Evaluate only after every shape is checked, including controls elsewhere in the report.
  if (errors.length === 0) for (const entry of evaluations) {
    const controls = evaluations.filter((candidate) => candidate.kind === 'fixture-legitimate'
      && candidate.target.accountId === entry.target.accountId && candidate.target.targetKind === entry.target.targetKind);
    const context: ScenarioEvaluationContext = { kind: entry.kind,
      ...(controls.length === 1 ? { legitimateControl: { target: controls[0]!.target, approval: controls[0]!.approval } } : {}) };
    const evaluated = evaluateTargetEvidence(entry.target, entry.approval, context);
    for (const key of ['status', 'summary', 'intendedCreditYocto', 'observedCreditYocto', 'successfulReceiptCreditYocto', 'transactionHashes', 'reasonCodes'] as const) {
      if (JSON.stringify(entry.verdict[key]) !== JSON.stringify(evaluated[key])) fail(`${entry.path}.verdict.${key}`, 'Does not match a fresh evidence evaluation.');
    }
  }
  return errors.length ? { valid: false, errors } : { valid: true, errors: [], report: input as RunReport };
}

export function assertRunReport(input: unknown): RunReport {
  const result = validateRunReport(input);
  if (!result.valid) throw new Error(result.errors.join('\n'));
  return result.report;
}
