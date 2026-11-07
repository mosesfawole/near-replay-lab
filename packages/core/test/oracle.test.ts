import assert from 'node:assert/strict';
import test from 'node:test';
import { evaluateTargetEvidence, validateRunReport, type JsonObject, type JsonValue } from '../src/index.js';
import { afterBlockHash, amount, approval, attempt, hash, receiptBlockHash, receiptId, report, snapshot, target, txBlockHash } from './fixtures.js';

function requireInconclusiveReport(data: ReturnType<typeof report>, code: string): void {
  const scenario = data.scenarios[0]!, evidence = scenario.targets[0]!, verdict = evaluateTargetEvidence(evidence, scenario.approval);
  assert.equal(verdict.status, 'INCONCLUSIVE'); assert.ok(verdict.reasonCodes.includes(code), verdict.reasonCodes.join(', '));
  assert.equal(validateRunReport(data).valid, false);
  evidence.verdict = verdict; assert.equal(validateRunReport(data).valid, true);
}

test('legitimate finalized receipts and an exact integer balance delta establish HOLDS', () => {
  const verdict = evaluateTargetEvidence(target(), approval());
  assert.equal(verdict.status, 'HOLDS');
  assert.equal(verdict.observedCreditYocto, '1000000000000000000000');
  assert.equal(verdict.successfulReceiptCreditYocto, '1000000000000000000000');
});

test('a rounded unsafe numeric transaction nonce cannot establish direct credit', () => {
  const data = report(), signed = data.scenarios[0]!.targets[0]!.attempts[0]!;
  signed.nonce = '9007199254740992'; (signed.finalOutcome as JsonObject).transaction = {
    ...((signed.finalOutcome as JsonObject).transaction as JsonObject), nonce: JSON.parse('9007199254740993') as number,
  };
  requireInconclusiveReport(data, 'INCONSISTENT_TRANSACTION_IDENTITY');
});

test('a numeric transaction nonce at Number.MAX_SAFE_INTEGER retains exact direct identity', () => {
  const data = report(), scenario = data.scenarios[0]!, evidence = scenario.targets[0]!, signed = evidence.attempts[0]!;
  signed.nonce = '9007199254740991'; ((signed.finalOutcome as JsonObject).transaction as JsonObject).nonce = 9007199254740991;
  evidence.verdict = evaluateTargetEvidence(evidence, scenario.approval);
  assert.equal(evidence.verdict.status, 'HOLDS'); assert.equal(validateRunReport(data).valid, true);
});

for (const nonce of ['9007199254740993', '18446744073709551615']) test(`an exact string transaction nonce ${nonce} retains direct identity`, () => {
  const data = report(), scenario = data.scenarios[0]!, evidence = scenario.targets[0]!, signed = evidence.attempts[0]!;
  signed.nonce = nonce; ((signed.finalOutcome as JsonObject).transaction as JsonObject).nonce = nonce;
  evidence.verdict = evaluateTargetEvidence(evidence, scenario.approval);
  assert.equal(evidence.verdict.status, 'HOLDS'); assert.equal(validateRunReport(data).valid, true);
});

test('empty attempts never establish settlement', () => {
  const evidence = target(); evidence.attempts = [];
  const verdict = evaluateTargetEvidence(evidence, approval());
  assert.equal(verdict.status, 'INCONCLUSIVE'); assert.ok(verdict.reasonCodes.includes('NO_ATTEMPTS'));
});

test('nonfinal execution success cannot establish settlement', () => {
  const evidence = target(); (evidence.attempts[0]!.finalOutcome as JsonObject).final_execution_status = 'EXECUTED_OPTIMISTIC';
  const verdict = evaluateTargetEvidence(evidence, approval());
  assert.equal(verdict.status, 'INCONCLUSIVE'); assert.ok(verdict.reasonCodes.includes('NONFINAL_TRANSACTION'));
});

test('missing finalized balance evidence stays INCONCLUSIVE', () => {
  const evidence = target(); evidence.snapshots.after = null;
  const verdict = evaluateTargetEvidence(evidence, approval());
  assert.equal(verdict.status, 'INCONCLUSIVE'); assert.ok(verdict.reasonCodes.includes('MISSING_BALANCE_SNAPSHOT'));
});

test('a successful finalized transfer to a different recipient violates the approval', () => {
  const evidence = target(); evidence.attempts = [attempt(hash, 'substituted-recipient.testnet')];
  evidence.snapshots.after = snapshot('1000000000000000000000000', 103, afterBlockHash);
  const verdict = evaluateTargetEvidence(evidence, approval());
  assert.equal(verdict.status, 'VIOLATED'); assert.ok(verdict.reasonCodes.includes('RECIPIENT_MISMATCH'));
});

test('a successful finalized transfer of the wrong exact amount violates the approval', () => {
  const evidence = target(); evidence.attempts = [attempt(hash, approval().recipientId, '2000000000000000000000')];
  evidence.snapshots.after = snapshot('1002000000000000000000000', 103, afterBlockHash);
  const verdict = evaluateTargetEvidence(evidence, approval());
  assert.equal(verdict.status, 'VIOLATED'); assert.ok(verdict.reasonCodes.includes('AMOUNT_MISMATCH'));
});

test('two distinct finalized transactions and double credit establish duplicate-credit violation', () => {
  const evidence = target(); evidence.attempts.push(attempt('SecondPublicTransactionHash111111111111111111'));
  evidence.snapshots.after = snapshot('1002000000000000000000000', 103, afterBlockHash);
  const verdict = evaluateTargetEvidence(evidence, approval());
  assert.equal(verdict.status, 'VIOLATED'); assert.ok(verdict.reasonCodes.includes('DUPLICATE_CREDIT'));
});

test('rebroadcasting the same signed transaction does not count its receipt twice', () => {
  const evidence = target(); evidence.attempts.push(attempt());
  const verdict = evaluateTargetEvidence(evidence, approval());
  assert.equal(verdict.status, 'HOLDS'); assert.equal(verdict.successfulReceiptCreditYocto, amount);
  assert.deepEqual(verdict.transactionHashes, [hash]);
});

test('a transport failure without a FINAL observation is INCONCLUSIVE', () => {
  const evidence = target(); evidence.attempts[0]!.finalOutcome = null;
  evidence.attempts[0]!.error = { category: 'transport', message: 'Connection closed after broadcast.' };
  const verdict = evaluateTargetEvidence(evidence, approval());
  assert.equal(verdict.status, 'INCONCLUSIVE'); assert.ok(verdict.reasonCodes.includes('UNRESOLVED_ATTEMPT'));
});

test('a nonce error cannot be reported as a protection or settlement', () => {
  const evidence = target(); evidence.attempts[0]!.error = { category: 'rpc', code: 'InvalidNonce', message: 'Invalid nonce.' };
  const verdict = evaluateTargetEvidence(evidence, approval());
  assert.equal(verdict.status, 'INCONCLUSIVE'); assert.ok(verdict.reasonCodes.includes('UNRESOLVED_ATTEMPT'));
});

test('missing linked transfer receipt cannot be hidden behind top-level SuccessValue', () => {
  const evidence = target(); (evidence.attempts[0]!.finalOutcome as JsonObject).receipts_outcome = [];
  const verdict = evaluateTargetEvidence(evidence, approval());
  assert.equal(verdict.status, 'INCONCLUSIVE'); assert.ok(verdict.reasonCodes.includes('MISSING_RECEIPT_OUTCOME'));
});

test('failed receipt cannot establish intended credit even with a matching balance delta', () => {
  const evidence = target(); const outcome = evidence.attempts[0]!.finalOutcome as JsonObject;
  const receipts = outcome.receipts_outcome as JsonObject[];
  (receipts[0]!.outcome as JsonObject).status = { Failure: { ActionError: { index: 0, kind: 'AccountDoesNotExist' } } };
  const verdict = evaluateTargetEvidence(evidence, approval());
  assert.equal(verdict.status, 'INCONCLUSIVE'); assert.ok(verdict.reasonCodes.includes('FAILED_RECEIPT'));
});

test('unrelated balance changes cannot be mistaken for transfer receipt credit', () => {
  const evidence = target(); evidence.snapshots.after = snapshot('1003000000000000000000000', 103, afterBlockHash);
  const verdict = evaluateTargetEvidence(evidence, approval());
  assert.equal(verdict.status, 'INCONCLUSIVE'); assert.ok(verdict.reasonCodes.includes('BALANCE_RECEIPT_MISMATCH'));
});

test('a finalized before snapshot taken after the receipt cannot establish its delta', () => {
  const evidence = target(); evidence.snapshots.before = snapshot('1000000000000000000000000', 103, afterBlockHash);
  const verdict = evaluateTargetEvidence(evidence, approval());
  assert.equal(verdict.status, 'INCONCLUSIVE'); assert.ok(verdict.reasonCodes.includes('SNAPSHOT_ORDER'));
});

test('an after snapshot older than a finalized receipt is incomplete', () => {
  const evidence = target(); evidence.snapshots.after = snapshot('1001000000000000000000000', 101, afterBlockHash);
  const verdict = evaluateTargetEvidence(evidence, approval());
  assert.equal(verdict.status, 'INCONCLUSIVE'); assert.ok(verdict.reasonCodes.includes('BALANCE_PRECEDES_RECEIPT'));
});

test('inconsistent transaction hash or action summaries cannot satisfy the oracle', () => {
  const evidence = target(); (evidence.attempts[0]!.finalOutcome as JsonObject).transaction = { hash: 'OtherHash' };
  const verdict = evaluateTargetEvidence(evidence, approval());
  assert.equal(verdict.status, 'INCONCLUSIVE'); assert.ok(verdict.reasonCodes.includes('INCONSISTENT_TRANSACTION_IDENTITY'));
});

test('decimal or exponential amount strings never enter financial arithmetic', () => {
  const permission = approval(); permission.amountYocto = '1e21';
  const verdict = evaluateTargetEvidence(target(), permission);
  assert.equal(verdict.status, 'INCONCLUSIVE'); assert.ok(verdict.reasonCodes.includes('INVALID_APPROVAL'));
});

test('integer arithmetic preserves one yoctoNEAR above Number.MAX_SAFE_INTEGER', () => {
  const permission = approval(); permission.amountYocto = '1';
  const evidence = target(); evidence.attempts = [attempt(hash, permission.recipientId, '1')];
  evidence.snapshots.before = snapshot('9007199254740993000000000', 100, hash);
  evidence.snapshots.after = snapshot('9007199254740993000000001', 103, afterBlockHash);
  const verdict = evaluateTargetEvidence(evidence, permission);
  assert.equal(verdict.status, 'HOLDS'); assert.equal(verdict.observedCreditYocto, '1');
});

test('a claimed FINAL outcome without matching raw RPC evidence remains inconclusive', () => {
  const evidence = target(); evidence.attempts[0]!.observations = [];
  const verdict = evaluateTargetEvidence(evidence, approval());
  assert.equal(verdict.status, 'INCONCLUSIVE'); assert.ok(verdict.reasonCodes.includes('MISSING_FINAL_RPC_EVIDENCE'));
});

test('a claimed final block height must agree with its complete raw block header', () => {
  const evidence = target(); const block = evidence.attempts[0]!.finalBlocks[0]!;
  const result = (block.evidence!.response as JsonObject).result as JsonObject;
  (result.header as JsonObject).height = 999;
  const verdict = evaluateTargetEvidence(evidence, approval());
  assert.equal(verdict.status, 'INCONCLUSIVE'); assert.ok(verdict.reasonCodes.includes('MISSING_FINAL_BLOCK_REFERENCE'));
});

test('a direct transfer receipt executed before its transaction cannot establish credit', () => {
  const data = report(), block = data.scenarios[0]!.targets[0]!.attempts[0]!.finalBlocks[1]!;
  block.height = 90; (((block.evidence!.response as JsonObject).result as JsonObject).header as JsonObject).height = 90;
  requireInconclusiveReport(data, 'RECEIPT_CHRONOLOGY');
});

test('a direct receipt cannot alias the transaction hash while preserving a claimed credit', () => {
  const data = report(), signed = data.scenarios[0]!.targets[0]!.attempts[0]!, final = signed.finalOutcome as JsonObject;
  const transactionExecution = (final.transaction_outcome as JsonObject).outcome as JsonObject;
  (transactionExecution.status as JsonObject).SuccessReceiptId = signed.txHash; transactionExecution.receipt_ids = [signed.txHash];
  (final.receipts_outcome as JsonObject[])[0]!.id = signed.txHash;
  requireInconclusiveReport(data, 'INCONSISTENT_RECEIPT_IDENTITY');
});

test('a direct downstream receipt cannot execute before its parent receipt', () => {
  const data = report(), signed = data.scenarios[0]!.targets[0]!.attempts[0]!, final = signed.finalOutcome as JsonObject;
  const receipts = final.receipts_outcome as JsonObject[], first = receipts[0]!, child = structuredClone(first);
  child.id = '4vJ9JU1bJJE96FWSJKvHsmmFZAP4NxkaRGdjGTgvMT3'; child.block_hash = txBlockHash;
  (first.outcome as JsonObject).status = { SuccessReceiptId: child.id }; (first.outcome as JsonObject).receipt_ids = [child.id];
  receipts.push(child);
  requireInconclusiveReport(data, 'RECEIPT_CHRONOLOGY');
});

test('a direct transfer receipt can execute in the same consistent finalized block as its transaction', () => {
  const data = report(), scenario = data.scenarios[0]!, evidence = scenario.targets[0]!;
  ((evidence.attempts[0]!.finalOutcome as JsonObject).receipts_outcome as JsonObject[])[0]!.block_hash = txBlockHash;
  evidence.verdict = evaluateTargetEvidence(evidence, scenario.approval);
  assert.equal(evidence.verdict.status, 'HOLDS'); assert.equal(validateRunReport(data).valid, true);
});

test('a direct before balance must precede every supplied finalized receipt', () => {
  const data = report(), signed = data.scenarios[0]!.targets[0]!.attempts[0]!, final = signed.finalOutcome as JsonObject;
  const receipts = final.receipts_outcome as JsonObject[], earlier = structuredClone(receipts[0]!), block = structuredClone(signed.finalBlocks[1]!);
  earlier.id = '4vJ9JU1bJJE96FWSJKvHsmmFZAP4NxkaRGdjGTgvMT3'; earlier.block_hash = 'EarlierFinalizedReceiptHash'; receipts.push(earlier);
  block.hash = 'EarlierFinalizedReceiptHash'; block.height = 99; (block.evidence!.params as JsonObject).block_id = block.hash;
  Object.assign(((block.evidence!.response as JsonObject).result as JsonObject).header as JsonObject, { hash: block.hash, height: 99 });
  signed.finalBlocks.push(block);
  requireInconclusiveReport(data, 'SNAPSHOT_ORDER');
});

for (const [blockHash, label] of [[hash, 'before balance'], [txBlockHash, 'transaction'], [receiptBlockHash, 'receipt']] as const)
  test(`a direct after balance cannot contradict the known ${label} block hash height`, () => {
    const data = report(), after = data.scenarios[0]!.targets[0]!.snapshots.after!;
    after.block.hash = blockHash; ((after.evidence.response as JsonObject).result as JsonObject).block_hash = blockHash;
    requireInconclusiveReport(data, 'CONFLICTING_BLOCK_REFERENCE');
  });

test('a duplicate finalized reference cannot give one direct block hash two heights', () => {
  const data = report(), signed = data.scenarios[0]!.targets[0]!.attempts[0]!, duplicate = structuredClone(signed.finalBlocks[1]!);
  duplicate.height = 101; (((duplicate.evidence!.response as JsonObject).result as JsonObject).header as JsonObject).height = 101;
  signed.finalBlocks.push(duplicate);
  requireInconclusiveReport(data, 'CONFLICTING_BLOCK_REFERENCE');
});

test('direct finalized references for one hash must agree on raw header facts', () => {
  const data = report(), signed = data.scenarios[0]!.targets[0]!.attempts[0]!, block = signed.finalBlocks[1]!;
  (((block.evidence!.response as JsonObject).result as JsonObject).header as JsonObject).prev_hash = txBlockHash;
  const duplicate = structuredClone(block);
  (((duplicate.evidence!.response as JsonObject).result as JsonObject).header as JsonObject).prev_hash = 'ConflictingPreviousBlockHash';
  signed.finalBlocks.push(duplicate);
  requireInconclusiveReport(data, 'CONFLICTING_BLOCK_REFERENCE');
});

test('a receipt SuccessReceiptId cannot establish HOLDS when its downstream result is absent', () => {
  const data = report(), scenario = data.scenarios[0]!, evidence = scenario.targets[0]!;
  const raw = evidence.attempts[0]!.finalOutcome as JsonObject;
  const receipt = (raw.receipts_outcome as JsonObject[])[0]!;
  (receipt.outcome as JsonObject).status = { SuccessReceiptId: 'AbsentDownstreamReceipt' };
  const verdict = evaluateTargetEvidence(evidence, scenario.approval);
  assert.equal(verdict.status, 'INCONCLUSIVE'); assert.ok(verdict.reasonCodes.includes('MISSING_RECEIPT_OUTCOME'));
  assert.equal(validateRunReport(data).valid, false);
});

test('receipt status links must reach a terminal success instead of forming a cycle', () => {
  const evidence = target(), raw = evidence.attempts[0]!.finalOutcome as JsonObject;
  const receipt = (raw.receipts_outcome as JsonObject[])[0]!, outcome = receipt.outcome as JsonObject;
  outcome.status = { SuccessReceiptId: receipt.id! }; outcome.receipt_ids = [receipt.id!];
  const verdict = evaluateTargetEvidence(evidence, approval());
  assert.equal(verdict.status, 'INCONCLUSIVE'); assert.ok(verdict.reasonCodes.includes('MISSING_RECEIPT_OUTCOME'));
});

test('a complete receipt status link ending in matching terminal success remains valid', () => {
  const data = report(), scenario = data.scenarios[0]!, raw = scenario.targets[0]!.attempts[0]!.finalOutcome as JsonObject;
  const receipts = raw.receipts_outcome as JsonObject[], first = receipts[0]!, child = structuredClone(first);
  child.id = '4vJ9JU1bJJE96FWSJKvHsmmFZAP4NxkaRGdjGTgvMT3';
  (first.outcome as JsonObject).status = { SuccessReceiptId: child.id };
  (first.outcome as JsonObject).receipt_ids = [child.id];
  receipts.push(child);
  assert.equal(evaluateTargetEvidence(scenario.targets[0]!, scenario.approval).status, 'HOLDS');
  assert.equal(validateRunReport(data).valid, true);
});

test('same-hash duplicate outcomes stay HOLDS when equivalent object keys are reordered', () => {
  const reorder = (value: JsonValue): JsonValue => {
    if (Array.isArray(value)) return value.map(reorder);
    if (value !== null && typeof value === 'object') return Object.fromEntries(Object.entries(value).reverse().map(([key, child]) => [key, reorder(child)]));
    return value;
  };
  const data = report(), scenario = data.scenarios[0]!, evidence = scenario.targets[0]!, duplicate = attempt();
  duplicate.finalOutcome = reorder(duplicate.finalOutcome!);
  (duplicate.observations[0]!.response as JsonObject).result = duplicate.finalOutcome;
  evidence.attempts.push(duplicate);
  const verdict = evaluateTargetEvidence(evidence, scenario.approval);
  assert.equal(verdict.status, 'HOLDS'); assert.equal(verdict.successfulReceiptCreditYocto, amount);
  assert.deepEqual(verdict.transactionHashes, [hash]); assert.equal(validateRunReport(data).valid, true);
});
