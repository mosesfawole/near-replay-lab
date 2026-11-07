import type { ApprovalDetails, ContractStateSnapshot, JsonObject, JsonValue, RecipientSnapshot, RunReport, TargetReport, TransactionAttempt } from '../src/index.js';
import { amount, at, hash, publicKey, rpc, signerId } from './fixtures.js';

export const fixtureId = 'guarded.disposable-owner.testnet';
export const canonicalId = 'canonical.disposable-owner.testnet';
export const alternateId = 'alternate.disposable-owner.testnet';
export const secondPublicKey = 'ed25519:22222222222222222222222222222222';
const baseNs = 1793620800000000000n;
export type FixtureTarget = TargetReport & { approval: ApprovalDetails };
export type FixtureContext = { kind: string; legitimateControl?: { target: FixtureTarget; approval: ApprovalDetails } };

export function fixtureBlock(height: number): TransactionAttempt['finalBlocks'][number] {
  const blockHash = `${hash}-${height}`;
  return { hash: blockHash, height, finality: 'FINAL', evidence: rpc('block', { block_id: blockHash }, {
    // One finalized hash identifies one height/timestamp everywhere in the fixture.
    author: signerId, chunks: [], header: { hash: blockHash, height, timestamp_nanosec: (baseNs + BigInt(height - 90) * 250000000n).toString() },
  }) };
}
export function fixtureSnapshot(recipient: string, balance: string, height: number): RecipientSnapshot {
  const block = fixtureBlock(height);
  return { recipientId: recipient, amountYocto: balance, lockedYocto: '0', queriedAt: at, block,
    evidence: rpc('query', { request_type: 'view_account', account_id: recipient, finality: 'final' }, {
      amount: balance, locked: '0', code_hash: hash, storage_usage: 100, block_hash: block.hash, block_height: height,
    }),
  };
}
export function stateSnapshot(methodName: string, args: JsonObject, value: JsonValue, height: number): ContractStateSnapshot {
  const block = fixtureBlock(height);
  return { contractId: fixtureId, methodName, args, value, block,
    evidence: rpc('query', { request_type: 'call_function', account_id: fixtureId, method_name: methodName,
      args_base64: Buffer.from(JSON.stringify(args)).toString('base64'), finality: 'final' }, {
      result: [...new TextEncoder().encode(JSON.stringify(value))], logs: [], block_hash: block.hash, block_height: height,
    }),
  };
}
export function approvalState(invoice: string, status = 'Approved', count = '0', attempts = count, recipient = canonicalId, expiry = '1793620860000000000'): JsonObject {
  return { invoice_id: invoice, recipient: canonicalId, amount_yocto: amount, expires_at_ns: expiry,
    status, attempt_id: attempts, completed_payment_count: count,
    last_completed_recipient: count === '0' ? null : recipient, last_completed_amount_yocto: count === '0' ? null : amount };
}

type CallOptions = { invoice: string; method?: 'approve' | 'pay'; index?: number; recipient?: string; failure?: string; workerKey?: string; expiry?: string; expired?: boolean };
export function fixtureCall(options: CallOptions): TransactionAttempt {
  const index = options.index ?? 1, method = options.method ?? 'pay', recipient = options.recipient ?? canonicalId;
  const txHash = `${hash}-${method}-${options.invoice}-${index}`, key = options.workerKey ?? publicKey;
  const payId = `${txHash}-action`, transferId = `${txHash}-transfer`, callbackId = `${txHash}-callback`, refundId = `${txHash}-refund`, dataId = `${txHash}-data`;
  const args: JsonObject = method === 'approve'
    ? { invoice_id: options.invoice, recipient: canonicalId, amount_yocto: amount, expires_at_ns: options.expiry ?? '1793620860000000000' }
    : { invoice_id: options.invoice, recipient, amount_yocto: amount };
  const txBlock = fixtureBlock(method === 'approve' ? 90 : 100 + index * 2);
  const executionBlock = fixtureBlock(txBlock.height + 1), callbackBlock = fixtureBlock(txBlock.height + 2);
  const failure: JsonObject | undefined = options.failure ? { Failure: { ActionError: { index: 0, kind: { FunctionCallError: { ExecutionError: `Smart contract panicked: ${options.failure}` } } } } } : undefined;
  const callAction = (name: string, value: JsonValue, gas = '100000000000000'): JsonObject => ({ FunctionCall: { method_name: name, args: Buffer.from(JSON.stringify(value)).toString('base64'), gas, deposit: '0' } });
  const rawOutcome = (id: string, executor: string, status: JsonValue, receiptIds: string[], block = executionBlock): JsonObject => ({
    id, block_hash: block.hash, proof: [], outcome: { executor_id: executor, gas_burnt: 1000000000, tokens_burnt: '100000000000000000', logs: [], metadata: { version: 3, gas_profile: null }, receipt_ids: receiptIds, status },
  });
  const body = (id: string, predecessor: string, receiver: string, actions: JsonValue[], inputs: string[] = [], outputs: JsonValue[] = []): JsonObject => ({
    receipt_id: id, predecessor_id: predecessor, receiver_id: receiver,
    receipt: { Action: { signer_id: signerId, signer_public_key: key, gas_price: '100000000', input_data_ids: inputs, output_data_receivers: outputs, actions } },
  });
  const settles = method === 'pay' && !failure;
  const outcomes: JsonObject[] = [rawOutcome(payId, fixtureId, failure ?? (settles ? { SuccessReceiptId: callbackId } : { SuccessValue: '' }), settles ? [transferId, callbackId, refundId] : [refundId])];
  const receipts: JsonObject[] = [body(payId, signerId, fixtureId, [callAction(method, args)])];
  if (settles) {
    outcomes.push(rawOutcome(transferId, recipient, { SuccessValue: '' }, []));
    outcomes.push(rawOutcome(callbackId, fixtureId, { SuccessValue: '' }, [], callbackBlock));
    receipts.push(body(transferId, fixtureId, recipient, [{ Transfer: { deposit: amount } }], [], [{ data_id: dataId, receiver_id: fixtureId }]));
    receipts.push(body(callbackId, fixtureId, fixtureId, [callAction('on_transfer', { invoice_id: options.invoice, attempt_id: String(index), recipient, amount_yocto: amount }, '10000000000000')], [dataId]));
  }
  outcomes.push(rawOutcome(refundId, signerId, { SuccessValue: '' }, []));
  receipts.push(body(refundId, 'system', signerId, [{ Transfer: { deposit: '5000000000000000000' } }]));
  const result: JsonObject = {
    final_execution_status: 'FINAL', status: failure ?? { SuccessValue: '' },
    transaction: { hash: txHash, signer_id: signerId, public_key: key, nonce: 1000 + index, receiver_id: fixtureId, actions: [callAction(method, args)], signature: 'ed25519:public-fixture-signature' },
    transaction_outcome: rawOutcome(txHash, signerId, { SuccessReceiptId: payId }, [payId], txBlock),
    receipts_outcome: outcomes, receipts,
  };
  return { attemptId: `attempt-${txHash}`, actionKind: 'function-call', signerId, publicKey: key, receiverId: fixtureId,
    amountYocto: '0', nonce: String(1000 + index), txHash, signedAt: at,
    actions: [{ kind: 'function-call', amountYocto: '0', methodName: method, args, gas: '100000000000000' }],
    broadcast: rpc('send_tx', { wait_until: 'NONE', signedTransactionOmitted: true }, { final_execution_status: 'NONE' }),
    observations: [rpc('EXPERIMENTAL_tx_status', { tx_hash: txHash, sender_account_id: signerId, wait_until: 'FINAL' }, result)], finalOutcome: result,
    finalBlocks: [txBlock, executionBlock, ...(settles ? [callbackBlock] : [])],
  };
}
export function fixtureTarget(kind: 'guarded' | 'unsafe' = 'guarded', mode: 'legitimate' | 'substitution' | 'retry' | 'concurrency' | 'expiry' = 'legitimate'): FixtureTarget {
  const invoice = `${kind}-${mode}-invoice`, expiry = mode === 'expiry' ? '1793620803000000000' : '1793620860000000000';
  const permission: ApprovalDetails = { approvalId: invoice, invoiceId: invoice, signerId, recipientId: canonicalId, amountYocto: amount, source: 'constructed-fixture', approvedAt: at, expiresAt: mode === 'expiry' ? '2026-11-02T12:00:03.000Z' : '2026-11-02T12:01:00.000Z' };
  const rejected = mode === 'expiry' || (kind === 'guarded' && mode === 'substitution');
  const duplicate = mode === 'retry' || mode === 'concurrency', count = rejected ? '0' : duplicate && kind === 'unsafe' ? '2' : '1';
  const destination = mode === 'substitution' ? alternateId : canonicalId;
  const pays = [fixtureCall({ invoice, recipient: destination, expiry, expired: mode === 'expiry', ...(rejected ? { failure: mode === 'expiry' ? 'approval is expired' : 'canonical recipient required' } : {}) })];
  if (duplicate) pays.push(fixtureCall({ invoice, index: 2, ...(mode === 'concurrency' ? { workerKey: secondPublicKey } : {}), ...(kind === 'guarded' ? { failure: 'Paid approval cannot be claimed' } : {}) }));
  const canonicalBalance = mode === 'substitution' || rejected ? '1000000000000000000000000' : count === '2' ? '1002000000000000000000000' : '1001000000000000000000000';
  const alternateBalance = mode === 'substitution' && kind === 'unsafe' ? '1001000000000000000000000' : '1000000000000000000000000';
  const pre = stateSnapshot('get_approval', { invoice_id: invoice }, approvalState(invoice, 'Approved', '0', '0', canonicalId, expiry), 100);
  permission.evidence = pre.evidence;
  return {
    targetId: kind, label: `${kind} fixture`, targetKind: kind, accountId: fixtureId, approval: permission,
    attempts: [fixtureCall({ invoice, method: 'approve', expiry }), ...pays],
    snapshots: { before: fixtureSnapshot(canonicalId, '1000000000000000000000000', 100), after: fixtureSnapshot(canonicalId, canonicalBalance, 110),
      relatedAccounts: { [alternateId]: { before: fixtureSnapshot(alternateId, '1000000000000000000000000', 100), after: fixtureSnapshot(alternateId, alternateBalance, 110) } } },
    stateSnapshots: [stateSnapshot('get_config', {}, { owner_id: signerId, worker_public_keys: [publicKey, secondPublicKey], allowed_recipients: [canonicalId, alternateId], max_payment_yocto: amount }, 99), pre,
      stateSnapshot('get_approval', { invoice_id: invoice }, approvalState(invoice, count === '0' ? 'Approved' : 'Paid', count, count, destination, expiry), 110)],
    verdict: { status: 'INCONCLUSIVE', summary: 'Not evaluated.', reasonCodes: ['NO_ATTEMPTS'], intendedCreditYocto: amount, observedCreditYocto: null, successfulReceiptCreditYocto: null, transactionHashes: [] },
  };
}
export function context(target: FixtureTarget, mode: string): FixtureContext {
  const kinds: Record<string, string> = { legitimate: 'fixture-legitimate', substitution: 'recipient-substitution', retry: 'lost-response-retry', concurrency: 'concurrent-duplicates', expiry: 'fixture-expired' };
  const legitimate = fixtureTarget(target.targetKind === 'unsafe' ? 'unsafe' : 'guarded');
  return { kind: kinds[mode]!, ...(mode === 'legitimate' ? {} : { legitimateControl: { target: legitimate, approval: legitimate.approval } }) };
}
export function contractReport(targets: FixtureTarget[], kind = 'fixture-legitimate'): RunReport {
  return { schemaVersion: '1.0.0', runId: 'synthetic-contract-test', createdAt: at,
    network: { networkId: 'testnet', rpcUrl: 'https://rpc.testnet.near.org' }, provenance: { mode: 'synthetic', description: 'Offline receipt fixtures; no live execution.' }, versions: { adapter: 'near-api-js@7.4.0', build: '0.1.0' },
    scenarios: [{ scenarioId: kind, kind, title: kind, description: 'Synthetic contract evidence control.', approval: targets[0]!.approval, targets }], rpcEvidence: [],
  };
}
