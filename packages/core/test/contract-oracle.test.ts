import assert from 'node:assert/strict';
import test from 'node:test';
import { evaluateTargetEvidence, validateRunReport, type ApprovalDetails, type JsonObject, type TargetEvidence, type TargetVerdict } from '../src/index.js';
import { amount } from './fixtures.js';
import { alternateId, canonicalId, context, contractReport, fixtureBlock, fixtureCall, fixtureId, fixtureTarget, type FixtureContext, type FixtureTarget } from './contract-fixtures.js';

const evaluate = evaluateTargetEvidence as (target: TargetEvidence, approval: ApprovalDetails, context?: FixtureContext) => TargetVerdict;
const raw = (target: FixtureTarget, index = 1) => target.attempts[index]!.finalOutcome as JsonObject;
const verdict = (target: FixtureTarget, mode = 'legitimate') => evaluate(target, target.approval, context(target, mode));
const requireCode = (actual: TargetVerdict, code: string) => { assert.equal(actual.status, 'INCONCLUSIVE'); assert.ok(actual.reasonCodes.includes(code), actual.reasonCodes.join(', ')); };
function requireInconclusiveReport(target: FixtureTarget, code: string): void {
  const actual = verdict(target); requireCode(actual, code);
  target.verdict = verdict(fixtureTarget()); assert.equal(validateRunReport(contractReport([target])).valid, false);
  target.verdict = actual; assert.equal(validateRunReport(contractReport([target])).valid, true);
}

test('one actual native fixture Transfer receipt plus completed callback and exact balances establishes HOLDS', () => {
  const actual = verdict(fixtureTarget());
  assert.equal(actual.status, 'HOLDS'); assert.equal(actual.observedCreditYocto, '1000000000000000000000');
  assert.equal(actual.successfulReceiptCreditYocto, '1000000000000000000000');
});
test('contract success without downstream action receipt bodies cannot establish settlement', () => {
  const target = fixtureTarget(); delete raw(target).receipts;
  requireCode(verdict(target), 'MISSING_RECEIPT_BODY');
});
test('a forged transfer body from another predecessor is never credited to the fixture', () => {
  const target = fixtureTarget(), bodies = raw(target).receipts as JsonObject[];
  bodies[1]!.predecessor_id = 'forged-unrelated.testnet';
  requireCode(verdict(target), 'INCONSISTENT_RECEIPT_IDENTITY');
});
test('a failed native transfer cannot be counted as credit even if the recipient balance matches', () => {
  const target = fixtureTarget(), outcomes = raw(target).receipts_outcome as JsonObject[];
  (outcomes[1]!.outcome as JsonObject).status = { Failure: { ActionError: { index: 0, kind: { AccountDoesNotExist: { account_id: canonicalId } } } } };
  requireCode(verdict(target), 'FAILED_TRANSFER');
});
test('a proven transfer with a Pending approval callback remains INCONCLUSIVE', () => {
  const target = fixtureTarget(); (target.stateSnapshots!.at(-1)!.value as JsonObject).status = 'Pending';
  ((target.stateSnapshots!.at(-1)!.evidence.response as JsonObject).result as JsonObject).result = [...new TextEncoder().encode(JSON.stringify(target.stateSnapshots!.at(-1)!.value))];
  requireCode(verdict(target), 'PENDING_CALLBACK');
});
test('a substituted recipient within the generic allowlist and cap violates unsafe canonical binding', () => {
  const actual = verdict(fixtureTarget('unsafe', 'substitution'), 'substitution');
  assert.equal(actual.status, 'VIOLATED'); assert.ok(actual.reasonCodes.includes('RECIPIENT_MISMATCH'));
  assert.equal(actual.observedCreditYocto, '0');
});
test('guarded substitution HOLDS only with explicit canonical-policy failure and zero credit to both accounts', () => {
  const actual = verdict(fixtureTarget('guarded', 'substitution'), 'substitution');
  assert.equal(actual.status, 'HOLDS'); assert.equal(actual.observedCreditYocto, '0'); assert.equal(actual.successfulReceiptCreditYocto, '0');
});
test('two distinct unsafe completed pay transactions prove duplicate native credit', () => {
  const actual = verdict(fixtureTarget('unsafe', 'retry'), 'retry');
  assert.equal(actual.status, 'VIOLATED'); assert.ok(actual.reasonCodes.includes('DUPLICATE_CREDIT'));
  assert.equal(actual.successfulReceiptCreditYocto, '2000000000000000000000');
});
test('rebroadcasting one identical signed function call counts its native receipt once', () => {
  const target = fixtureTarget(); target.attempts.push(structuredClone(target.attempts[1]!));
  const actual = verdict(target); assert.equal(actual.status, 'HOLDS'); assert.equal(actual.successfulReceiptCreditYocto, amount);
  assert.equal(actual.transactionHashes.length, 2);
});
test('guarded fresh-nonce retry requires one completed transfer and an explicit once-only policy rejection', () => {
  const actual = verdict(fixtureTarget('guarded', 'retry'), 'retry');
  assert.equal(actual.status, 'HOLDS'); assert.equal(actual.successfulReceiptCreditYocto, amount);
});
test('guarded independent-key concurrency requires one completed transfer and an explicit duplicate rejection', () => {
  const actual = verdict(fixtureTarget('guarded', 'concurrency'), 'concurrency');
  assert.equal(actual.status, 'HOLDS'); assert.equal(actual.successfulReceiptCreditYocto, amount);
});
test('a nonce rejection cannot be reported as guarded duplicate protection', () => {
  const target = fixtureTarget('guarded', 'retry'); target.attempts[2]!.error = { category: 'rpc', code: 'InvalidNonce', message: 'Invalid nonce.' };
  requireCode(verdict(target, 'retry'), 'UNRESOLVED_ATTEMPT');
});
test('rejection controls require freshly evaluated legitimate evidence from the same fixture account', () => {
  const target = fixtureTarget('guarded', 'substitution');
  requireCode(evaluate(target, target.approval, { kind: 'recipient-substitution' }), 'MISSING_LEGITIMATE_CONTROL');
  const wrong = context(target, 'substitution'); wrong.legitimateControl!.target.accountId = 'other-fixture.testnet';
  requireCode(evaluate(target, target.approval, wrong), 'MISSING_LEGITIMATE_CONTROL');
});
test('a supplied HOLDS control verdict cannot replace missing real legitimate transfer evidence', () => {
  const target = fixtureTarget('guarded', 'substitution'), inputs = context(target, 'substitution');
  inputs.legitimateControl!.target.snapshots.after = null; inputs.legitimateControl!.target.verdict.status = 'HOLDS';
  requireCode(evaluate(target, target.approval, inputs), 'FAILED_LEGITIMATE_CONTROL');
});
test('approval created while valid then explicitly rejected after finalized expiry establishes the expired control', () => {
  const actual = verdict(fixtureTarget('guarded', 'expiry'), 'expiry');
  assert.equal(actual.status, 'HOLDS'); assert.equal(actual.observedCreditYocto, '0'); assert.equal(actual.successfulReceiptCreditYocto, '0');
});
test('an unrelated contract panic with zero credit is not an expiry or substitution defense', () => {
  const target = fixtureTarget('guarded', 'expiry');
  target.attempts[1] = fixtureCall({ invoice: target.approval.invoiceId!, failure: 'configured worker key required', expired: true });
  requireCode(verdict(target, 'expiry'), 'UNEXPECTED_CONTRACT_FAILURE');
});
test('a function-call success without an actual native payment stays INCONCLUSIVE', () => {
  const target = fixtureTarget(), outcome = raw(target), receipts = outcome.receipts as JsonObject[];
  (receipts[1]!.receipt as JsonObject).Action = { actions: [], signer_id: target.approval.signerId, signer_public_key: target.attempts[1]!.publicKey };
  assert.equal(verdict(target).status, 'INCONCLUSIVE');
});
test('contract state summaries must agree with complete raw finalized view bytes', () => {
  const target = fixtureTarget(); (target.stateSnapshots![1]!.value as JsonObject).recipient = alternateId;
  requireCode(verdict(target), 'INVALID_CONTRACT_STATE');
});
test('unrelated alternate-recipient balance changes cannot be attributed to a payment', () => {
  const target = fixtureTarget(); target.snapshots.relatedAccounts![alternateId]!.after!.amountYocto = '1001000000000000000000000';
  const response = target.snapshots.relatedAccounts![alternateId]!.after!.evidence.response as JsonObject;
  (response.result as JsonObject).amount = '1001000000000000000000000';
  requireCode(verdict(target), 'BALANCE_RECEIPT_MISMATCH');
});
test('a mismatched signed pay argument cannot borrow another invoice native receipts', () => {
  const target = fixtureTarget(); (target.attempts[1]!.actions[0]!.args as JsonObject).invoice_id = 'different-invoice';
  requireCode(verdict(target), 'INCONSISTENT_TRANSACTION_IDENTITY');
});
test('an after balance before any finalized callback cannot establish a fixture verdict', () => {
  const target = fixtureTarget(); target.snapshots.after!.block = fixtureBlock(103);
  Object.assign((target.snapshots.after!.evidence.response as JsonObject).result as JsonObject, { block_hash: target.snapshots.after!.block.hash, block_height: 103 });
  requireCode(verdict(target), 'BALANCE_PRECEDES_RECEIPT');
});

test('a callback executed before its parent pay receipt is INCONCLUSIVE even with matching balances and success', () => {
  const target = fixtureTarget(), pay = target.attempts[1]!;
  (raw(target).receipts_outcome as JsonObject[])[2]!.block_hash = pay.finalBlocks[0]!.hash;
  requireInconclusiveReport(target, 'RECEIPT_CHRONOLOGY');
});

test('a pay receipt aliased to the transaction hash cannot hide execution before its transaction', () => {
  const target = fixtureTarget(), pay = target.attempts[1]!, final = raw(target), later = fixtureBlock(106);
  pay.finalBlocks[0] = later; (final.transaction_outcome as JsonObject).block_hash = later.hash;
  const transactionExecution = (final.transaction_outcome as JsonObject).outcome as JsonObject;
  (transactionExecution.status as JsonObject).SuccessReceiptId = pay.txHash; transactionExecution.receipt_ids = [pay.txHash];
  (final.receipts_outcome as JsonObject[])[0]!.id = pay.txHash;
  (final.receipts as JsonObject[])[0]!.receipt_id = pay.txHash;
  requireInconclusiveReport(target, 'INCONSISTENT_RECEIPT_IDENTITY');
});

for (const [index, label] of [[1, 'native transfer'], [2, 'callback'], [3, 'runtime refund']] as const)
  test(`a ${label} receipt cannot reuse the transaction hash even in one finalized block`, () => {
    const target = fixtureTarget(), pay = target.attempts[1]!, final = raw(target), block = fixtureBlock(103);
    const outcomes = final.receipts_outcome as JsonObject[], bodies = final.receipts as JsonObject[], receiptId = outcomes[index]!.id;
    for (const receipt of [final.transaction_outcome as JsonObject, ...outcomes]) {
      receipt.block_hash = block.hash;
      const execution = receipt.outcome as JsonObject;
      execution.receipt_ids = (execution.receipt_ids as string[]).map((id) => id === receiptId ? pay.txHash : id);
      if ((execution.status as JsonObject).SuccessReceiptId === receiptId) (execution.status as JsonObject).SuccessReceiptId = pay.txHash;
    }
    outcomes[index]!.id = pay.txHash; bodies[index]!.receipt_id = pay.txHash; pay.finalBlocks = [block];
    requireInconclusiveReport(target, 'INCONSISTENT_RECEIPT_IDENTITY');
  });

test('an extra runtime refund body cannot alias the transaction hash without a matching receipt outcome', () => {
  const target = fixtureTarget(), bodies = raw(target).receipts as JsonObject[], alias = structuredClone(bodies.at(-1)!);
  alias.receipt_id = target.attempts[1]!.txHash; bodies.push(alias);
  requireInconclusiveReport(target, 'INCONSISTENT_RECEIPT_IDENTITY');
});

test('a transfer completed after its dependent callback is INCONCLUSIVE even when both follow the parent pay', () => {
  const target = fixtureTarget(), transferBlock = fixtureBlock(105);
  (raw(target).receipts_outcome as JsonObject[])[1]!.block_hash = transferBlock.hash;
  target.attempts[1]!.finalBlocks.push(transferBlock);
  requireInconclusiveReport(target, 'RECEIPT_CHRONOLOGY');
});

test('receipt timestamps cannot move backwards along a parent-to-child execution edge', () => {
  const target = fixtureTarget(), executionBlock = target.attempts[1]!.finalBlocks[1]!;
  const header = ((executionBlock.evidence!.response as JsonObject).result as JsonObject).header as JsonObject;
  header.timestamp_nanosec = '1793620802000000000';
  requireInconclusiveReport(target, 'RECEIPT_CHRONOLOGY');
});

test('one reused block hash cannot claim different heights in approval and callback evidence', () => {
  const target = fixtureTarget(), callback = target.attempts[1]!.finalBlocks[2]!, hash = target.stateSnapshots![1]!.block.hash;
  callback.hash = hash; callback.height = 105; (callback.evidence!.params as JsonObject).block_id = hash;
  Object.assign(((callback.evidence!.response as JsonObject).result as JsonObject).header as JsonObject, { hash, height: 105 });
  (raw(target).receipts_outcome as JsonObject[])[2]!.block_hash = hash;
  requireInconclusiveReport(target, 'CONFLICTING_BLOCK_REFERENCE');
});

test('a duplicate finalized reference for one hash cannot hide a conflicting timestamp', () => {
  const target = fixtureTarget(), conflicting = structuredClone(target.attempts[1]!.finalBlocks[2]!);
  (((conflicting.evidence!.response as JsonObject).result as JsonObject).header as JsonObject).timestamp_nanosec = '1793620803500000001';
  target.attempts[1]!.finalBlocks.push(conflicting);
  requireInconclusiveReport(target, 'CONFLICTING_BLOCK_REFERENCE');
});

test('state and balance references for one finalized hash must agree on header facts', () => {
  const target = fixtureTarget(), header = ((target.snapshots.before!.block.evidence!.response as JsonObject).result as JsonObject).header as JsonObject;
  header.prev_hash = 'contradictory-parent-hash';
  const stateHeader = ((target.stateSnapshots![1]!.block.evidence!.response as JsonObject).result as JsonObject).header as JsonObject;
  stateHeader.prev_hash = 'approved-parent-hash';
  requireInconclusiveReport(target, 'CONFLICTING_BLOCK_REFERENCE');
});

test('balance query references without block bodies cannot contradict a known finalized hash height', () => {
  const target = fixtureTarget(), before = target.snapshots.before!, hash = target.attempts[1]!.finalBlocks[2]!.hash;
  before.block.hash = hash; delete before.block.evidence;
  ((before.evidence.response as JsonObject).result as JsonObject).block_hash = hash;
  requireInconclusiveReport(target, 'CONFLICTING_BLOCK_REFERENCE');
});

test('causal receipts may share the same consistent finalized height and timestamp', () => {
  const target = fixtureTarget(); (raw(target).receipts_outcome as JsonObject[])[2]!.block_hash = target.attempts[1]!.finalBlocks[1]!.hash;
  assert.equal(verdict(target).status, 'HOLDS');
});

for (const identifier of [null, '', 1, true]) test(`a ${String(identifier)} callback dependency identifier cannot establish credit`, () => {
  const target = fixtureTarget(), bodies = raw(target).receipts as JsonObject[];
  const transfer = (bodies[1]!.receipt as JsonObject).Action as JsonObject, callback = (bodies[2]!.receipt as JsonObject).Action as JsonObject;
  transfer.output_data_receivers = [{ receiver_id: fixtureId, data_id: identifier }]; callback.input_data_ids = [identifier];
  requireInconclusiveReport(target, 'MISSING_CALLBACK');
});

test('an extra output receiver makes the native transfer callback dependency ambiguous', () => {
  const target = fixtureTarget(), bodies = raw(target).receipts as JsonObject[], transfer = (bodies[1]!.receipt as JsonObject).Action as JsonObject;
  (transfer.output_data_receivers as JsonObject[]).push({ receiver_id: 'unrelated.testnet', data_id: 'unrelated-data-id' });
  requireInconclusiveReport(target, 'MISSING_CALLBACK');
});

test('a matching ID among multiple callback inputs does not establish its sole native-transfer dependency', () => {
  const target = fixtureTarget(), bodies = raw(target).receipts as JsonObject[], callback = (bodies[2]!.receipt as JsonObject).Action as JsonObject;
  (callback.input_data_ids as string[]).push('unrelated-data-id');
  requireInconclusiveReport(target, 'MISSING_CALLBACK');
});

test('malformed extra output dependency records cannot be discarded while certifying a callback', () => {
  const target = fixtureTarget(), bodies = raw(target).receipts as JsonObject[], transfer = (bodies[1]!.receipt as JsonObject).Action as JsonObject;
  (transfer.output_data_receivers as unknown[]).push(null);
  requireInconclusiveReport(target, 'MISSING_CALLBACK');
});
test('nonfinal fixture execution and missing outcome links remain INCONCLUSIVE', () => {
  const target = fixtureTarget(); raw(target).final_execution_status = 'EXECUTED_OPTIMISTIC';
  requireCode(verdict(target), 'NONFINAL_TRANSACTION');
  const missing = fixtureTarget(); (raw(missing).receipts_outcome as JsonObject[]).splice(2, 1);
  requireCode(verdict(missing), 'MISSING_RECEIPT_OUTCOME');
});
test('validator accepts an isolated target approval override and derives fixture context from the scenario', () => {
  const target = fixtureTarget(); target.verdict = {
    status: 'HOLDS', summary: 'Exactly one approved fixture transfer is proven.', reasonCodes: ['EXACT_INTENDED_CREDIT'], intendedCreditYocto: amount,
    observedCreditYocto: amount, successfulReceiptCreditYocto: amount, transactionHashes: target.attempts.map((attempt) => attempt.txHash),
  };
  const report = contractReport([target]); report.scenarios[0]!.approval = { ...target.approval, recipientId: 'other-shared-recipient.testnet' };
  assert.equal(validateRunReport(report).valid, true);
  target.approval.amountYocto = '1e21'; assert.equal(validateRunReport(report).valid, false);
});
