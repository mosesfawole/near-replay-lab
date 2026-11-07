import { KeyPairSigner, type KeyPairString } from 'near-api-js';
import { assertRunReport, evaluateTargetEvidence, type ApprovalDetails, type JsonObject, type JsonValue, type PublicError,
  type RunReport, type ScenarioEvaluationContext, type TargetReport, type TransactionAttempt } from '../../core/src/index.js';
import { broadcastTransaction, NearRpcClient, observeTransactionFinal, queryFinalizedBalance, queryFinalizedBlock,
  queryFinalizedContractState, RpcRequestError, sanitizePublicEvidence, signFunctionCall, toPublicError, waitForFinalizedTimestamp,
  type ObservationOptions, type PreparedTransaction } from '../../near-adapter/src/index.js';
import { SCENARIO_DEFINITIONS, type FixtureScenarioKind } from '../../../scenarios/definitions.js';
import { writeRunReport } from './reports.js';
import { matchesFixtureConfig, readLocalTestnetSetup, type FixtureKind, type LocalFixtureSetup, type LocalSigningKey } from './setup.js';
import { loadSuiteConfig, SUITE_PAY_GAS, type SuiteConfig } from './suite-config.js';
import { checkedWorkerAccessKey, queryWorkerAllowanceReserve, type WorkerAllowanceReserve } from './worker-access.js';

export interface SuiteProgress { scenarioId: string; targetKind: FixtureKind; event: 'signed' | 'case-complete'; txHash?: string }
export interface RunSuiteOptions {
  client?: NearRpcClient;
  checkpoint?: (report: RunReport) => Promise<void>;
  provenance?: RunReport['provenance'];
  observation?: Pick<ObservationOptions, 'timeoutMs' | 'pollIntervalMs'>;
  expiryWait?: Pick<ObservationOptions, 'timeoutMs' | 'pollIntervalMs'>;
  progress?: (progress: SuiteProgress) => void;
}
const emptyCodeHash = '11111111111111111111111111111111';
const nanosPerSecond = 1_000_000_000n;
function object(value: unknown): JsonObject | undefined { return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as JsonObject : undefined; }
function failure(code: string, message: string, category: PublicError['category'] = 'evidence'): RpcRequestError {
  return new RpcRequestError({ category, code, message });
}
function timestampIso(ns: bigint): string { return new Date(Number(ns / 1_000_000n)).toISOString(); }
function minimumHeight(target: TargetReport): number { return Math.max(0, ...target.attempts.flatMap((attempt) => attempt.finalBlocks.map((block) => block.height))); }
function isFinal(attempt: TransactionAttempt): boolean {
  return !attempt.error && object(attempt.finalOutcome)?.final_execution_status === 'FINAL' && attempt.finalBlocks.length > 0;
}
function checkTiming(value: RunSuiteOptions['observation'], maximum: number): void {
  for (const [name, number] of Object.entries(value ?? {})) if (!Number.isSafeInteger(number) || number <= 0 || (name === 'timeoutMs' && number > maximum)) throw new Error('Suite observation timings must be bounded positive integers.');
}

/** Five explicit cases, with local one-shot signing and public evidence persisted before every send. */
export async function runSuite(input: SuiteConfig, options: RunSuiteOptions = {}): Promise<RunReport> {
  const config = loadSuiteConfig({ NEAR_TESTNET_ACCOUNT_ID: input.operatorId, NEAR_TESTNET_PRIVATE_KEY: input.privateKey,
    NEAR_RPC_URL: input.rpcUrl, NEAR_SETUP_PATH: input.setupPath, NEAR_AMOUNT_YOCTO: input.amountYocto, NEAR_REPORT_PATH: input.reportPath });
  checkTiming(options.observation, 300_000); checkTiming(options.expiryWait, 30_000);
  const setup = await readLocalTestnetSetup(config.setupPath, config.operatorId);
  if (setup.status !== 'ready') throw new Error('Local fixture setup is pending. Rerun setup to reconcile it before the suite.');
  const createdAt = new Date().toISOString(), runId = crypto.randomUUID();
  const secrets = [config.privateKey, ...Object.values(setup.fixtures).flatMap((fixture) => [fixture.key.privateKey, ...fixture.workers.map((key) => key.privateKey)])];
  const client = options.client ?? new NearRpcClient({ rpcUrl: config.rpcUrl });
  const report: RunReport = {
    schemaVersion: '1.0.0', runId, createdAt, network: { networkId: 'testnet', rpcUrl: config.rpcUrl },
    provenance: options.provenance ?? { mode: 'live', description: 'Local runner capture of actual native NEAR testnet fixture execution, approvals, FINAL receipts and balances. Obligations, hostile proposals, response discard and scheduling are constructed; no live model agent is claimed.' },
    versions: { adapter: 'near-api-js@7.4.0', build: '0.1.0' }, rpcEvidence: client.records,
    scenarios: SCENARIO_DEFINITIONS.map((definition) => {
      const targets = (['unsafe', 'guarded'] as const).map((kind): TargetReport => {
        const fixture = setup.fixtures[kind], invoiceId = `nrl-${runId}-${definition.kind}-${kind}`;
        const approval: ApprovalDetails = { approvalId: invoiceId, invoiceId, signerId: config.operatorId, recipientId: fixture.canonicalRecipientId,
          amountYocto: config.amountYocto, source: 'constructed-fixture', approvedAt: createdAt, expiresAt: new Date(Date.parse(createdAt) + 300_000).toISOString() };
        return { targetId: kind, targetKind: kind, label: `${kind === 'unsafe' ? 'Deliberately unsafe' : 'Guarded'} fixture`, accountId: fixture.accountId, approval,
          attempts: [], stateSnapshots: [], snapshots: { before: null, after: null, relatedAccounts: { [fixture.substitutedRecipientId]: { before: null, after: null } } },
          verdict: evaluateTargetEvidence({ targetId: kind, targetKind: kind, label: kind, accountId: fixture.accountId, attempts: [], snapshots: { before: null, after: null } }, approval, { kind: definition.kind }) };
      });
      return { scenarioId: definition.kind, ...definition, approval: targets[0]!.approval!, targets };
    }),
  };
  const contextFor = (target: TargetReport, kind: string): ScenarioEvaluationContext => {
    const controls = report.scenarios.filter((scenario) => scenario.kind === 'fixture-legitimate').flatMap((scenario) => scenario.targets)
      .filter((value) => value.accountId === target.accountId && value.targetKind === target.targetKind);
    return { kind, ...(controls.length === 1 ? { legitimateControl: { target: controls[0]!, approval: controls[0]!.approval! } } : {}) };
  };
  const publicReport = (): RunReport => {
    for (const scenario of report.scenarios) for (const target of scenario.targets) target.verdict = evaluateTargetEvidence(target, target.approval!, contextFor(target, scenario.kind));
    return assertRunReport(sanitizePublicEvidence(report, secrets));
  };
  let persistenceFailed = false;
  const checkpoint = async (): Promise<void> => {
    try { await (options.checkpoint ?? ((value) => writeRunReport(config.reportPath, value)))(publicReport()); }
    catch { persistenceFailed = true; throw failure('REPORT_CHECKPOINT_FAILED', 'Public report checkpoint failed; further broadcasts are stopped.', 'local'); }
  };
  const nonceFloors = new Map<string, string>(), blockedKeys = new Map<string, PublicError>(), completed = new Set<TargetReport>();
  let workerAllowanceReserve: WorkerAllowanceReserve;
  const allowancePreflighted = new Set<string>();
  const ownerSigner = KeyPairSigner.fromSecretKey(config.privateKey as KeyPairString), ownerKey = (await ownerSigner.getPublicKey()).toString();
  const assertLane = (publicKey: string): void => {
    const blocked = blockedKeys.get(publicKey);
    if (blocked) throw failure('SIGNING_LANE_BLOCKED', `Signing lane remains blocked after incomplete evidence: ${blocked.code ?? blocked.category}.`);
  };
  const appendError = (target: TargetReport, error: unknown): void => {
    target.errors = [...target.errors ?? [], sanitizePublicEvidence(toPublicError(error), secrets) as unknown as PublicError];
  };

  const prepare = async (target: TargetReport, scenarioId: string, methodName: 'approve' | 'pay', args: JsonObject, worker?: LocalSigningKey): Promise<PreparedTransaction> => {
    const signer = worker ? KeyPairSigner.fromSecretKey(worker.privateKey as KeyPairString) : ownerSigner, publicKey = worker?.publicKey ?? ownerKey;
    assertLane(publicKey);
    const prepared = await signFunctionCall({ client, signer, signerId: config.operatorId, receiverId: target.accountId, amountYocto: '0',
      gas: methodName === 'approve' ? '30000000000000' : SUITE_PAY_GAS, methodName, args, nonceFloor: nonceFloors.get(publicKey) });
    nonceFloors.set(publicKey, prepared.attempt.nonce); target.attempts.push(prepared.attempt);
    options.progress?.({ scenarioId, targetKind: target.targetKind as FixtureKind, event: 'signed', txHash: prepared.attempt.txHash });
    return prepared;
  };
  const observe = async (prepared: PreparedTransaction): Promise<boolean> => {
    await observeTransactionFinal(client, prepared.attempt, { ...options.observation, includeReceipts: true });
    if (isFinal(prepared.attempt)) return true;
    const error = prepared.attempt.error ?? { category: 'evidence' as const, code: 'UNKNOWN_FINAL_OUTCOME', message: 'Saved signed hash has no complete FINAL evidence.' };
    blockedKeys.set(prepared.attempt.publicKey, error); return false;
  };
  const sendOne = async (prepared: PreparedTransaction, discardResponse = false): Promise<void> => {
    await checkpoint();
    await broadcastTransaction(client, prepared, { discardResponse });
    await checkpoint();
    if (!await observe(prepared)) throw failure('UNKNOWN_FINAL_OUTCOME', `Saved signed hash ${prepared.attempt.txHash} has incomplete FINAL evidence; no new transaction is authorized on that signing lane.`);
  };
  const capturePost = async (target: TargetReport, fixture: LocalFixtureSetup): Promise<void> => {
    const height = minimumHeight(target);
    target.stateSnapshots!.push(await queryFinalizedContractState(client, fixture.accountId, 'get_approval', { invoice_id: target.approval!.invoiceId! }, { ...options.observation, minimumHeight: height }));
    target.snapshots.after = await queryFinalizedBalance(client, fixture.canonicalRecipientId, { ...options.observation, minimumHeight: height });
    target.snapshots.relatedAccounts![fixture.substitutedRecipientId]!.after = await queryFinalizedBalance(client, fixture.substitutedRecipientId, { ...options.observation, minimumHeight: height });
  };
  const checkFixture = async (target: TargetReport, fixture: LocalFixtureSetup): Promise<void> => {
    const account = object(await client.sendJsonRpc('query', { request_type: 'view_account', account_id: fixture.accountId, finality: 'final' }));
    if (account?.code_hash !== fixture.wasmHash) throw failure('FIXTURE_CODE_MISMATCH', 'Fixture on-chain code differs from the persisted local Wasm hash.');
    const state = await queryFinalizedContractState(client, fixture.accountId, 'get_config', {}, options.observation);
    target.stateSnapshots!.push(state);
    if (!matchesFixtureConfig(state.value, fixture, config.operatorId)) throw failure('FIXTURE_CONFIG_MISMATCH', 'Fixture owner, workers, allowlist or amount cap differs from the local setup.');
    for (const id of [fixture.canonicalRecipientId, fixture.substitutedRecipientId]) {
      const view = object(await client.sendJsonRpc('query', { request_type: 'view_account', account_id: id, finality: 'final' }));
      const keys = object(await client.sendJsonRpc('query', { request_type: 'view_access_key_list', account_id: id, finality: 'final' }));
      if (view?.code_hash !== emptyCodeHash || !Array.isArray(keys?.keys) || keys.keys.length !== 0) throw failure('RECIPIENT_ISOLATION_MISMATCH', 'Dedicated recipient has code or access keys; fixture evidence isolation is unavailable.');
    }
    for (const worker of fixture.workers) {
      const key = object(await client.sendJsonRpc('query', { request_type: 'view_access_key', account_id: config.operatorId, public_key: worker.publicKey, finality: 'final' }));
      const installed = checkedWorkerAccessKey(key, fixture.accountId);
      const required = allowancePreflighted.has(fixture.accountId) ? workerAllowanceReserve.perPayYocto : workerAllowanceReserve.perSuiteYocto;
      if (installed.allowance < required) throw failure('WORKER_ALLOWANCE_TOO_LOW', 'Worker allowance cannot cover the protocol-floor/current-price gas reserve; rerun setup.', 'configuration');
    }
    allowancePreflighted.add(fixture.accountId);
  };

  const runTarget = async (target: TargetReport, kind: FixtureScenarioKind): Promise<void> => {
    const fixture = setup.fixtures[target.targetKind as FixtureKind], workers = kind === 'concurrent-duplicates' ? fixture.workers : [fixture.workers[0]];
    assertLane(ownerKey); for (const worker of workers) assertLane(worker.publicKey);
    await checkFixture(target, fixture);
    const finalized = await queryFinalizedBlock(client), expiry = BigInt(finalized.timestampNs) + (kind === 'fixture-expired' ? 15n : 300n) * nanosPerSecond;
    const approval = target.approval!;
    approval.approvedAt = timestampIso(BigInt(finalized.timestampNs)); approval.expiresAt = timestampIso(expiry);
    const owner = await prepare(target, kind, 'approve', { invoice_id: approval.invoiceId!, recipient: approval.recipientId,
      amount_yocto: approval.amountYocto, expires_at_ns: expiry.toString() });
    await sendOne(owner);
    if (typeof object(object(owner.attempt.finalOutcome)?.status)?.SuccessValue !== 'string') throw failure('APPROVAL_FAILED', 'Owner approval did not execute successfully through FINAL.');
    const pre = await queryFinalizedContractState(client, fixture.accountId, 'get_approval', { invoice_id: approval.invoiceId! }, { ...options.observation, minimumHeight: minimumHeight(target) });
    target.stateSnapshots!.push(pre); approval.evidence = pre.evidence;
    if (object(pre.value)?.status !== 'Approved') throw failure('APPROVAL_STATE_MISMATCH', 'Fresh owner approval is not finalized as Approved.');
    target.snapshots.before = await queryFinalizedBalance(client, fixture.canonicalRecipientId, { ...options.observation, minimumHeight: pre.block.height });
    target.snapshots.relatedAccounts![fixture.substitutedRecipientId]!.before = await queryFinalizedBalance(client, fixture.substitutedRecipientId, { ...options.observation, minimumHeight: pre.block.height });
    await checkpoint();
    if (kind === 'fixture-expired') await waitForFinalizedTimestamp(client, expiry.toString(), options.expiryWait);
    const args: JsonObject = { invoice_id: approval.invoiceId!, recipient: kind === 'recipient-substitution' ? fixture.substitutedRecipientId : approval.recipientId, amount_yocto: approval.amountYocto };
    if (kind === 'concurrent-duplicates') {
      const first = await prepare(target, kind, 'pay', args, fixture.workers[0]), second = await prepare(target, kind, 'pay', args, fixture.workers[1]);
      await checkpoint(); // Both independent signed proposals are durable before either send.
      await Promise.all([broadcastTransaction(client, first), broadcastTransaction(client, second)]);
      await checkpoint();
      // Observations are serialized so each attempt retains only its own status records.
      const firstKnown = await observe(first), secondKnown = await observe(second);
      if (!firstKnown || !secondKnown) throw failure('UNKNOWN_FINAL_OUTCOME', 'At least one independent saved hash has incomplete FINAL evidence; both retained proposals remain visible.');
    } else {
      const first = await prepare(target, kind, 'pay', args, fixture.workers[0]);
      await sendOne(first, kind === 'lost-response-retry');
      if (kind === 'lost-response-retry') {
        await capturePost(target, fixture);
        const proof = evaluateTargetEvidence(target, approval, { kind: 'fixture-legitimate' });
        if (proof.status !== 'HOLDS') {
          const error = failure('FIRST_PAYMENT_UNPROVEN', `First payment cannot authorize a fresh-nonce duplicate: ${proof.reasonCodes.join(', ')}.`);
          blockedKeys.set(first.attempt.publicKey, error.publicError); throw error;
        }
        await checkpoint();
        const retry = await prepare(target, kind, 'pay', args, fixture.workers[0]);
        await sendOne(retry);
      }
    }
    await capturePost(target, fixture);
    const proof = evaluateTargetEvidence(target, approval, contextFor(target, kind));
    if (proof.status === 'INCONCLUSIVE') for (const attempt of target.attempts.filter((value) => value.actions[0]?.methodName === 'pay')) {
      blockedKeys.set(attempt.publicKey, { category: 'evidence', code: proof.reasonCodes[0] ?? 'INCOMPLETE_SCENARIO_EVIDENCE', message: proof.summary });
    }
  };

  let active: TargetReport | undefined;
  try {
    await checkpoint();
    await client.verifyTestnet();
    workerAllowanceReserve = await queryWorkerAllowanceReserve(client);
    const owner = object(await client.sendJsonRpc('query', { request_type: 'view_access_key', account_id: config.operatorId, public_key: ownerKey, finality: 'final' }));
    if (owner?.permission !== 'FullAccess') throw failure('OWNER_PERMISSION_MISMATCH', 'Suite approval signing requires the disposable full-access testnet operator.', 'configuration');
    for (const scenario of report.scenarios) for (const target of scenario.targets) {
      active = target;
      try { await runTarget(target, scenario.kind as FixtureScenarioKind); }
      catch (error) {
        appendError(target, error);
        const pays = target.attempts.filter((attempt) => attempt.actions[0]?.methodName === 'pay');
        for (const attempt of pays) if (!blockedKeys.has(attempt.publicKey)) blockedKeys.set(attempt.publicKey, toPublicError(error));
        if (pays.length && !persistenceFailed) try { await capturePost(target, setup.fixtures[target.targetKind as FixtureKind]); } catch (captureError) { appendError(target, captureError); }
      }
      if (persistenceFailed) throw failure('REPORT_CHECKPOINT_FAILED', 'Public report persistence failed; all further broadcasts are stopped.', 'local');
      await checkpoint(); completed.add(target);
      options.progress?.({ scenarioId: scenario.scenarioId, targetKind: target.targetKind as FixtureKind, event: 'case-complete' });
    }
    active = undefined;
  } catch (error) {
    for (const scenario of report.scenarios) for (const target of scenario.targets) if (!completed.has(target)) {
      if (target !== active || !target.errors?.length) appendError(target, error);
    }
    if (!persistenceFailed) try { await checkpoint(); } catch { /* Retained return value still includes every case; no further send follows. */ }
  }
  return publicReport();
}
