import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import test from 'node:test';
import { validateRunReport, type RunReport, type TargetReport } from '../../core/src/index.js';
import * as runner from '../src/index.js';
import { OfflineSuiteChain, suiteScratch, syntheticSuiteProvenance } from './suite-fixtures.js';

type SuiteApi = {
  runSuite: (config: runner.SuiteConfig, options?: { client?: OfflineSuiteChain['client']; checkpoint?: (report: RunReport) => Promise<void>;
    provenance?: RunReport['provenance']; observation?: { timeoutMs: number; pollIntervalMs: number }; expiryWait?: { timeoutMs: number; pollIntervalMs: number } }) => Promise<RunReport>;
  suiteComparisonExitCode: (report: RunReport) => number;
  reportVerificationExitCode: (report: RunReport, target?: 'unsafe' | 'guarded') => number;
};
const api = runner as unknown as SuiteApi;
const observation = { timeoutMs: 50, pollIntervalMs: 1 }, expiryWait = { timeoutMs: 1_000, pollIntervalMs: 1 };
function target(report: RunReport, kind: string, fixture: 'unsafe' | 'guarded'): TargetReport {
  return report.scenarios.find((scenario) => scenario.kind === kind)!.targets.find((value) => value.targetKind === fixture)!;
}
async function capture(config: runner.SuiteConfig, chain: OfflineSuiteChain, checkpoint: (report: RunReport) => Promise<void> = async () => {}): Promise<RunReport> {
  return api.runSuite(config, { client: chain.client, checkpoint, provenance: syntheticSuiteProvenance, observation, expiryWait });
}

test('the complete five-case suite proves controls, unsafe violations and guarded rejections with exact native credit', async () => {
  const scratch = await suiteScratch(); try {
    const report = await capture(scratch.config, scratch.chain);
    assert.deepEqual(report.scenarios.map((scenario) => [scenario.kind, ...scenario.targets.map((value) => value.verdict.status)]), [
      ['fixture-legitimate', 'HOLDS', 'HOLDS'], ['fixture-expired', 'HOLDS', 'HOLDS'], ['recipient-substitution', 'VIOLATED', 'HOLDS'],
      ['lost-response-retry', 'VIOLATED', 'HOLDS'], ['concurrent-duplicates', 'VIOLATED', 'HOLDS'],
    ]);
    assert.equal(validateRunReport(report).valid, true); assert.equal(api.suiteComparisonExitCode(report), 0);
    assert.equal(api.reportVerificationExitCode(report, 'guarded'), 0); assert.equal(api.reportVerificationExitCode(report, 'unsafe'), 2);
    assert.equal(api.reportVerificationExitCode(report), 2); assert.equal(report.provenance.mode, 'synthetic');
    assert.equal(target(report, 'lost-response-retry', 'unsafe').verdict.observedCreditYocto, '2000000000000000000000');
    assert.equal(target(report, 'recipient-substitution', 'unsafe').verdict.observedCreditYocto, '0');
    const alternate = scratch.setup.fixtures.unsafe.substitutedRecipientId;
    const substitution = target(report, 'recipient-substitution', 'unsafe').snapshots.relatedAccounts![alternate]!;
    assert.equal(BigInt(substitution.after!.amountYocto) - BigInt(substitution.before!.amountYocto), 1000000000000000000000n);
    for (const fixture of Object.values(scratch.setup.fixtures)) assert.equal(report.scenarios.every((scenario) => scenario.targets.some((value) => value.approval?.recipientId === fixture.canonicalRecipientId)), true);
  } finally { await scratch.cleanup(); }
});

test('all ten targets exist initially and every signed hash is checkpointed before its broadcast, including both concurrent proposals', async () => {
  const scratch = await suiteScratch(); try {
    let latest: RunReport | undefined, count = 0;
    scratch.chain.beforeSend = async (call) => {
      assert.ok(latest); assert.equal(latest.scenarios.length, 5); assert.equal(latest.scenarios.flatMap((scenario) => scenario.targets).length, 10);
      const signed = latest.scenarios.flatMap((scenario) => scenario.targets).flatMap((value) => value.attempts).find((value) => value.txHash === call.hash);
      assert.ok(signed); assert.equal(signed.broadcast, null); count++;
      if (String(call.args.invoice_id).includes('concurrent-duplicates') && call.method === 'pay') {
        const proposal = latest.scenarios.flatMap((scenario) => scenario.targets).find((value) => value.attempts.some((attempt) => attempt.txHash === call.hash))!;
        assert.equal(proposal.attempts.filter((attempt) => attempt.actions[0]?.methodName === 'pay').length, 2);
      }
    };
    const report = await capture(scratch.config, scratch.chain, async (value) => { latest = structuredClone(value); });
    assert.equal(count, 24); assert.equal(scratch.chain.maximumBroadcasts, 2); assert.equal(api.suiteComparisonExitCode(report), 0);
    for (const scenario of report.scenarios) for (const value of scenario.targets) assert.ok(value.snapshots.after);
  } finally { await scratch.cleanup(); }
});

test('stale finalized access-key nonces do not cause implicit retries or nonce failures across serialized cases', async () => {
  const scratch = await suiteScratch(); try {
    const report = await capture(scratch.config, scratch.chain), lanes = new Map<string, bigint[]>();
    for (const call of scratch.chain.calls) lanes.set(call.transaction.publicKey.toString(), [...lanes.get(call.transaction.publicKey.toString()) ?? [], call.transaction.nonce]);
    assert.equal(scratch.chain.staleNonces, true); assert.equal(scratch.chain.calls.length, 24);
    for (const nonces of lanes.values()) for (let i = 1; i < nonces.length; i++) assert.equal(nonces[i]! > nonces[i - 1]!, true);
    assert.equal(report.scenarios.flatMap((scenario) => scenario.targets).some((value) => value.attempts.some((attempt) => attempt.error?.code === 'InvalidNonce')), false);
  } finally { await scratch.cleanup(); }
});

test('discarded responses recover only the saved hash through complete FINAL before a fresh-nonce duplicate retry', async () => {
  const scratch = await suiteScratch(); try {
    const report = await capture(scratch.config, scratch.chain);
    for (const fixture of ['unsafe', 'guarded'] as const) {
      const value = target(report, 'lost-response-retry', fixture), pays = value.attempts.filter((attempt) => attempt.actions[0]?.methodName === 'pay');
      assert.equal(pays.length, 2); assert.equal(pays[0]!.broadcast!.response, null); assert.equal(pays[0]!.broadcast!.error!.code, 'INJECTED_RESPONSE_DISCARD');
      assert.equal(pays[0]!.error, undefined); assert.equal(BigInt(pays[1]!.nonce) > BigInt(pays[0]!.nonce), true);
      assert.equal(pays[0]!.publicKey, pays[1]!.publicKey); assert.notEqual(pays[0]!.txHash, pays[1]!.txHash);
      assert.ok(value.stateSnapshots!.length >= 4);
      assert.ok(report.rpcEvidence.some((record) => record.method === 'query' && (record.params as Record<string, unknown>).request_type === 'view_account'
        && (record.params as Record<string, unknown>).account_id === value.approval!.recipientId));
    }
  } finally { await scratch.cleanup(); }
});

for (const fault of ['unknown', 'pending', 'missing-receipts'] as const) test(`${fault} first outcome prevents a duplicate retry and blocks that worker signing lane`, async () => {
  const scratch = await suiteScratch(); try {
    scratch.chain.fault = (call) => call.method === 'pay' && call.transaction.receiverId === scratch.setup.fixtures.guarded.accountId
      && String(call.args.invoice_id).includes('lost-response-retry') ? fault : undefined;
    const report = await capture(scratch.config, scratch.chain), value = target(report, 'lost-response-retry', 'guarded');
    assert.equal(value.verdict.status, 'INCONCLUSIVE'); assert.equal(value.attempts.filter((attempt) => attempt.actions[0]?.methodName === 'pay').length, 1);
    assert.equal(target(report, 'concurrent-duplicates', 'guarded').verdict.status, 'INCONCLUSIVE');
    assert.equal(scratch.chain.calls.some((call) => call.method === 'pay' && call.transaction.receiverId === scratch.setup.fixtures.guarded.accountId
      && String(call.args.invoice_id).includes('concurrent-duplicates')), false);
    assert.equal(validateRunReport(report).valid, true); assert.equal(api.suiteComparisonExitCode(report), 2);
    assert.equal(target(report, 'concurrent-duplicates', 'unsafe').verdict.status, 'VIOLATED');
  } finally { await scratch.cleanup(); }
});

test('a finalized first outcome with inconsistent intermediate balances cannot authorize a duplicate retry', async () => {
  const scratch = await suiteScratch(); try {
    scratch.chain.beforeSend = async (call) => {
      if (call.method === 'pay' && call.transaction.receiverId === scratch.setup.fixtures.guarded.accountId && String(call.args.invoice_id).includes('lost-response-retry')) {
        scratch.chain.balanceAdjustment = (id) => id === scratch.setup.fixtures.guarded.canonicalRecipientId ? 1n : 0n;
      }
    };
    const report = await capture(scratch.config, scratch.chain), value = target(report, 'lost-response-retry', 'guarded');
    assert.equal(value.verdict.status, 'INCONCLUSIVE'); assert.equal(value.attempts.filter((attempt) => attempt.actions[0]?.methodName === 'pay').length, 1);
    assert.ok(value.errors?.some((error) => error.code === 'FIRST_PAYMENT_UNPROVEN'));
  } finally { await scratch.cleanup(); }
});

test('a nonce-rejected expired case remains explicit INCONCLUSIVE and cannot count as fixture protection', async () => {
  const scratch = await suiteScratch(); try {
    scratch.chain.fault = (call) => call.method === 'pay' && call.transaction.receiverId === scratch.setup.fixtures.unsafe.accountId
      && String(call.args.invoice_id).includes('fixture-expired') ? 'nonce-rejection' : undefined;
    const report = await capture(scratch.config, scratch.chain), value = target(report, 'fixture-expired', 'unsafe');
    assert.equal(report.scenarios.length, 5); assert.equal(value.verdict.status, 'INCONCLUSIVE');
    assert.ok(value.attempts.some((attempt) => attempt.error?.code === 'InvalidNonce'));
    assert.equal(target(report, 'fixture-expired', 'guarded').verdict.status, 'HOLDS');
    assert.equal(api.suiteComparisonExitCode(report), 2); assert.equal(validateRunReport(report).valid, true);
  } finally { await scratch.cleanup(); }
});

for (const fault of ['allowance-rejection', 'gas-rejection'] as const) test(`${fault} is retained as INCONCLUSIVE and blocks the worker lane without FINAL polling`, async () => {
  const scratch = await suiteScratch(); try {
    scratch.chain.fault = (call) => call.method === 'pay' && call.transaction.receiverId === scratch.setup.fixtures.guarded.accountId
      && String(call.args.invoice_id).includes('fixture-expired') ? fault : undefined;
    const report = await capture(scratch.config, scratch.chain), value = target(report, 'fixture-expired', 'guarded');
    assert.equal(value.verdict.status, 'INCONCLUSIVE');
    const pay = value.attempts.find((attempt) => attempt.actions[0]?.methodName === 'pay')!;
    assert.equal(pay.error?.code, 'INVALID_TRANSACTION'); assert.equal(pay.broadcast!.error?.code, 'INVALID_TRANSACTION');
    assert.equal((pay.broadcast!.params as Record<string, unknown>).wait_until, 'INCLUDED');
    assert.ok(JSON.stringify(pay.broadcast!.response).includes(fault === 'allowance-rejection' ? 'NotEnoughAllowance' : 'TotalPrepaidGasExceeded'));
    assert.deepEqual(pay.observations, []); assert.equal(pay.finalOutcome, null);
    assert.equal(scratch.chain.calls.filter((call) => call.hash === pay.txHash).length, 1);
    assert.equal(report.rpcEvidence.some((record) => ['tx', 'tx_status', 'EXPERIMENTAL_tx_status'].includes(record.method)
      && (record.params as Record<string, unknown>).tx_hash === pay.txHash), false);
    assert.equal(target(report, 'recipient-substitution', 'guarded').verdict.status, 'INCONCLUSIVE');
    assert.equal(scratch.chain.calls.some((call) => call.method === 'pay' && call.transaction.receiverId === scratch.setup.fixtures.guarded.accountId
      && String(call.args.invoice_id).includes('recipient-substitution')), false);
    assert.equal(target(report, 'concurrent-duplicates', 'unsafe').verdict.status, 'VIOLATED');
    assert.equal(api.suiteComparisonExitCode(report), 2); assert.equal(validateRunReport(report).valid, true);
  } finally { await scratch.cleanup(); }
});

test('suite allowance preflight refuses a depleted fixture worker before any approval or pay signing', async () => {
  const scratch = await suiteScratch(); try {
    const fixture = scratch.setup.fixtures.guarded;
    const key = scratch.chain.accounts.get(scratch.config.operatorId)!.keys.get(fixture.workers[0].publicKey)!;
    (key.permission as { FunctionCall: { allowance: string } }).FunctionCall.allowance = '50000000000000000000000';
    const report = await capture(scratch.config, scratch.chain);
    for (const scenario of report.scenarios) {
      const guarded = scenario.targets.find((value) => value.targetKind === 'guarded')!;
      assert.equal(guarded.verdict.status, 'INCONCLUSIVE'); assert.deepEqual(guarded.attempts, []);
      assert.ok(guarded.errors?.some((error) => error.code === 'WORKER_ALLOWANCE_TOO_LOW'));
    }
    assert.equal(scratch.chain.calls.some((call) => call.transaction.receiverId === fixture.accountId), false);
    assert.equal(target(report, 'concurrent-duplicates', 'unsafe').verdict.status, 'VIOLATED');
    assert.equal(validateRunReport(report).valid, true); assert.equal(api.suiteComparisonExitCode(report), 2);
  } finally { await scratch.cleanup(); }
});

test('network failure retains a valid report with all defined cases and no broadcasts', async () => {
  const scratch = await suiteScratch(); try {
    scratch.chain.failStatus = true;
    const report = await capture(scratch.config, scratch.chain);
    assert.equal(report.scenarios.length, 5); assert.equal(scratch.chain.calls.length, 0);
    assert.equal(report.scenarios.every((scenario) => scenario.targets.length === 2 && scenario.targets.every((value) => value.verdict.status === 'INCONCLUSIVE' && value.errors?.length)), true);
    assert.equal(validateRunReport(report).valid, true);
  } finally { await scratch.cleanup(); }
});

test('a failed pre-broadcast checkpoint retains the signed evidence and stops every subsequent broadcast', async () => {
  const scratch = await suiteScratch(); try {
    const report = await capture(scratch.config, scratch.chain, async (value) => {
      if (value.scenarios.flatMap((scenario) => scenario.targets).some((entry) => entry.attempts.length)) throw new Error('Offline checkpoint storage unavailable.');
    });
    assert.equal(scratch.chain.calls.length, 0); assert.ok(report.scenarios[0]!.targets[0]!.attempts[0]!.txHash);
    assert.equal(report.scenarios.every((scenario) => scenario.targets.every((value) => value.verdict.status === 'INCONCLUSIVE')), true);
    assert.equal(validateRunReport(report).valid, true);
  } finally { await scratch.cleanup(); }
});

test('suite reports contain no known local secret even in an otherwise permitted public-signature slot', async () => {
  const scratch = await suiteScratch(); try {
    let changed = false;
    scratch.chain.beforeSend = async () => {
      if (changed) return;
      changed = true;
      // Public raw evidence can contain an arbitrary RPC string; known secrets still redact.
      scratch.chain.client.records.push({ method: 'block', params: { block_id: 'unrelated-offline-block' }, requestedAt: new Date().toISOString(), receivedAt: new Date().toISOString(),
        response: { jsonrpc: '2.0', id: 'offline', result: { author: 'offline-validator.testnet', header: { hash: 'unrelated-offline-block', height: 1, signature: scratch.setup.fixtures.guarded.workers[1].privateKey }, chunks: [] } } });
    };
    const report = await capture(scratch.config, scratch.chain), serialized = JSON.stringify(report);
    for (const secret of [scratch.config.privateKey, ...Object.values(scratch.setup.fixtures).flatMap((fixture) => [fixture.key.privateKey, ...fixture.workers.map((key) => key.privateKey)])]) assert.equal(serialized.includes(secret), false);
    assert.equal(serialized.includes('[REDACTED]'), true); assert.equal(validateRunReport(report).valid, true);
  } finally { await scratch.cleanup(); }
});

test('comparison exit requires the entire unique five-case matrix; target verification rejects missing or inconclusive targets', async () => {
  const scratch = await suiteScratch(); try {
    const report = await capture(scratch.config, scratch.chain), subset = structuredClone(report);
    subset.scenarios.pop(); assert.equal(api.suiteComparisonExitCode(subset), 2);
    const wrong = structuredClone(report); wrong.scenarios[4]!.kind = 'fixture-expired'; assert.equal(api.suiteComparisonExitCode(wrong), 2);
    const missing = structuredClone(report); for (const scenario of missing.scenarios) scenario.targets = scenario.targets.filter((value) => value.targetKind === 'unsafe');
    assert.equal(api.reportVerificationExitCode(missing, 'guarded'), 2);
    const unproven = structuredClone(report); target(unproven, 'lost-response-retry', 'guarded').snapshots.after = null;
    assert.equal(api.reportVerificationExitCode(unproven, 'guarded'), 2);
    await runner.writeRunReport(scratch.config.reportPath, report);
    const cli = 'dist/packages/runner/src/cli.js';
    const guarded = await promisify(execFile)(process.execPath, [cli, 'verify', scratch.config.reportPath, 'guarded']);
    assert.match(guarded.stdout, /HOLDS/);
    await assert.rejects(promisify(execFile)(process.execPath, [cli, 'verify', scratch.config.reportPath, 'unsafe']), (error: unknown) => (error as { code: number }).code === 2);
  } finally { await scratch.cleanup(); }
});

test('each suite run uses fresh invoice identifiers for every target', async () => {
  const scratch = await suiteScratch(); try {
    const first = await capture(scratch.config, scratch.chain); scratch.chain.staleNonces = false;
    const second = await capture(scratch.config, scratch.chain);
    const invoices = [...first.scenarios, ...second.scenarios].flatMap((scenario) => scenario.targets.map((value) => value.approval!.invoiceId));
    assert.equal(new Set(invoices).size, 20); assert.notEqual(first.runId, second.runId);
    assert.equal(api.suiteComparisonExitCode(first), 0); assert.equal(api.suiteComparisonExitCode(second), 0);
  } finally { await scratch.cleanup(); }
});

test('full receipt and multi-shard block evidence for ten targets fits a finite report-validation budget', async (t) => {
  const scratch = await suiteScratch(); try {
    scratch.chain.richBlocks = true;
    const report = await capture(scratch.config, scratch.chain);
    let nodes = 0;
    const stack: unknown[] = [report];
    while (stack.length) { const value = stack.pop(); nodes++; if (value && typeof value === 'object') stack.push(...Object.values(value)); }
    t.diagnostic(`Synthetic ten-target raw evidence: ${nodes} JSON nodes; ${Buffer.byteLength(JSON.stringify(report))} bytes.`);
    assert.ok(nodes > 100_000, `Expected realistic multi-target evidence to exceed the old direct-only budget; got ${nodes} nodes.`);
    assert.equal(validateRunReport(report).valid, true); assert.equal(api.suiteComparisonExitCode(report), 0);
    const oversized = { ...report, unrelatedOversizedEvidence: Array.from({ length: 1_000_001 }, () => null) };
    const rejected = validateRunReport(oversized); assert.equal(rejected.valid, false); assert.match(rejected.errors.join(' '), /validation limits/);
    assert.ok(rejected.errors.length <= 100);
  } finally { await scratch.cleanup(); }
});
