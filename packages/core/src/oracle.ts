import type { ApprovalDetails, JsonObject, JsonValue, RecipientSnapshot, ScenarioEvaluationContext, TargetEvidence, TargetVerdict, TransactionAttempt } from './types.js';
import { evaluateContractEvidence } from './contract-oracle.js';

const integer = /^(0|[1-9][0-9]*)$/;
function object(value: JsonValue | undefined): JsonObject | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value : undefined;
}
function money(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 78 && integer.test(value);
}
function sameJson(left: JsonValue | undefined, right: JsonValue | undefined): boolean {
  if (left === right) return true;
  if (Array.isArray(left) || Array.isArray(right)) return Array.isArray(left) && Array.isArray(right)
    && left.length === right.length && left.every((value, i) => sameJson(value, right[i]));
  const a = object(left), b = object(right);
  return !!a && !!b && Object.keys(a).length === Object.keys(b).length
    && Object.keys(a).every((key) => Object.hasOwn(b, key) && sameJson(a[key], b[key]));
}
function success(value: JsonValue | undefined): boolean {
  const status = object(value);
  return !!status && Object.keys(status).length === 1 && (typeof status.SuccessValue === 'string' || typeof status.SuccessReceiptId === 'string');
}
function snapshotProblem(snapshot: RecipientSnapshot, recipientId: string): string | undefined {
  if (snapshot.block?.finality !== 'FINAL') return 'NONFINAL_BALANCE';
  if (snapshot.recipientId !== recipientId) return 'RECIPIENT_SNAPSHOT_MISMATCH';
  if (!money(snapshot.amountYocto) || !money(snapshot.lockedYocto)) return 'INVALID_BALANCE';
  const params = object(snapshot.evidence?.params);
  const result = object(object(snapshot.evidence?.response)?.result);
  if (!result || snapshot.evidence.error || params?.request_type !== 'view_account' || params.account_id !== recipientId
    || params.finality !== 'final' || result.amount !== snapshot.amountYocto || result.locked !== snapshot.lockedYocto
    || result.block_hash !== snapshot.block.hash || result.block_height !== snapshot.block.height
    || !Number.isSafeInteger(snapshot.block.height) || snapshot.block.height < 0) return 'INVALID_BALANCE';
  return undefined;
}

function blockReferenceProblem(target: TargetEvidence): string | undefined {
  const known = new Map<string, { height: number; header?: JsonObject }>();
  const references = [...target.attempts.flatMap((attempt) => attempt.finalBlocks), ...(target.stateSnapshots ?? []).map((state) => state.block)];
  for (const pair of [target.snapshots, ...Object.values(target.snapshots.relatedAccounts ?? {})]) {
    for (const snapshot of [pair.before, pair.after]) if (snapshot) references.push(snapshot.block);
  }
  for (const ref of references) {
    const record = ref.evidence, params = object(record?.params), header = object(object(object(record?.response)?.result)?.header);
    if (!ref.hash || ref.finality !== 'FINAL' || !Number.isSafeInteger(ref.height) || ref.height < 0
      || record && (record.method !== 'block' || record.error || params?.block_id !== ref.hash || header?.hash !== ref.hash || header.height !== ref.height)) {
      return 'MISSING_FINAL_BLOCK_REFERENCE';
    }
    const previous = known.get(ref.hash);
    if (previous && (previous.height !== ref.height || previous.header && header && !sameJson(previous.header, header))) return 'CONFLICTING_BLOCK_REFERENCE';
    known.set(ref.hash, { height: ref.height, header: previous?.header ?? header });
  }
  return undefined;
}

interface TransferProof { recipientId: string; amount: bigint; firstHeight: number; lastHeight: number }
function transferProof(attempt: TransactionAttempt): TransferProof | string {
  if (attempt.error) return 'UNRESOLVED_ATTEMPT';
  const final = object(attempt.finalOutcome);
  if (final?.final_execution_status !== 'FINAL') return 'NONFINAL_TRANSACTION';
  const finalRpc = attempt.observations.some((record) => {
    const params = object(record.params), result = object(object(record.response)?.result);
    return !record.error && ['tx', 'tx_status', 'EXPERIMENTAL_tx_status'].includes(record.method)
      && params?.wait_until === 'FINAL' && params.tx_hash === attempt.txHash && params.sender_account_id === attempt.signerId
      && result?.final_execution_status === 'FINAL' && sameJson(result, final);
  });
  if (!finalRpc) return 'MISSING_FINAL_RPC_EVIDENCE';
  const tx = object(final.transaction);
  if (!tx || tx.hash !== attempt.txHash || tx.signer_id !== attempt.signerId || tx.public_key !== attempt.publicKey
    || tx.receiver_id !== attempt.receiverId || (typeof tx.nonce === 'number' && (!Number.isSafeInteger(tx.nonce) || tx.nonce < 0))
    || String(tx.nonce) !== attempt.nonce) return 'INCONSISTENT_TRANSACTION_IDENTITY';
  if (attempt.actionKind !== 'transfer' || !Array.isArray(tx.actions) || tx.actions.length !== 1
    || attempt.actions.length !== 1 || attempt.actions[0]?.kind !== 'transfer') return 'UNSUPPORTED_ACTION';
  const deposit = object(object(tx.actions[0])?.Transfer)?.deposit;
  if (!money(deposit) || BigInt(deposit) <= 0n || deposit !== attempt.amountYocto
    || attempt.actions[0]?.amountYocto !== deposit) return 'INCONSISTENT_TRANSACTION_IDENTITY';
  const transactionOutcome = object(final.transaction_outcome);
  const transactionExecution = object(transactionOutcome?.outcome);
  if (!transactionOutcome || transactionOutcome.id !== attempt.txHash || !transactionExecution
    || transactionExecution.executor_id !== attempt.signerId) return 'MISSING_TRANSACTION_OUTCOME';
  const linkedId = object(transactionExecution.status)?.SuccessReceiptId;
  if (typeof linkedId !== 'string' || !Array.isArray(transactionExecution.receipt_ids)
    || !transactionExecution.receipt_ids.includes(linkedId)) return 'MISSING_RECEIPT_OUTCOME';
  if (!Array.isArray(final.receipts_outcome) || final.receipts_outcome.length === 0) return 'MISSING_RECEIPT_OUTCOME';
  const receipts = new Map<string, JsonObject>();
  for (const value of final.receipts_outcome) {
    const receipt = object(value);
    if (!receipt || typeof receipt.id !== 'string' || receipts.has(receipt.id)) return 'MISSING_RECEIPT_OUTCOME';
    receipts.set(receipt.id, receipt);
  }
  if (receipts.has(attempt.txHash)) return 'INCONSISTENT_RECEIPT_IDENTITY';
  const linked = object(receipts.get(linkedId)?.outcome);
  if (!linked || linked.executor_id !== attempt.receiverId) return 'MISSING_RECEIPT_OUTCOME';
  if (!success(final.status) || typeof object(final.status)?.SuccessValue !== 'string' || !success(transactionExecution.status)) return 'FAILED_RECEIPT';
  if (transactionExecution.receipt_ids.some((id) => typeof id !== 'string' || !receipts.has(id))) return 'MISSING_RECEIPT_OUTCOME';
  for (const receipt of receipts.values()) {
    const outcome = object(receipt.outcome);
    if (!outcome || !success(outcome.status)) return 'FAILED_RECEIPT';
    if (!Array.isArray(outcome.receipt_ids) || outcome.receipt_ids.some((id) => typeof id !== 'string' || !receipts.has(id))) {
      return 'MISSING_RECEIPT_OUTCOME';
    }
    const nextId = object(outcome.status)?.SuccessReceiptId;
    if (typeof nextId === 'string' && (!receipts.has(nextId) || !outcome.receipt_ids.includes(nextId))) return 'MISSING_RECEIPT_OUTCOME';
  }
  for (const id of receipts.keys()) {
    let currentId = id;
    const seen = new Set<string>();
    while (true) {
      if (seen.has(currentId)) return 'MISSING_RECEIPT_OUTCOME';
      seen.add(currentId);
      const status = object(object(receipts.get(currentId)?.outcome)?.status);
      if (typeof status?.SuccessValue === 'string') {
        if (id === linkedId && status.SuccessValue !== object(final.status)?.SuccessValue) return 'FAILED_RECEIPT';
        break;
      }
      if (typeof status?.SuccessReceiptId !== 'string' || !receipts.has(status.SuccessReceiptId)) return 'MISSING_RECEIPT_OUTCOME';
      currentId = status.SuccessReceiptId;
    }
  }
  const executions = [transactionOutcome, ...receipts.values()], heights: number[] = [], positions = new Map<string, number>();
  for (const receipt of executions) {
    const ref = attempt.finalBlocks.find((b) => b.hash === receipt.block_hash && b.finality === 'FINAL');
    if (!ref || !Number.isSafeInteger(ref.height) || ref.height < 0) return 'MISSING_FINAL_BLOCK_REFERENCE';
    const record = ref.evidence, params = object(record?.params), header = object(object(object(record?.response)?.result)?.header);
    if (!record || record.method !== 'block' || record.error || params?.block_id !== ref.hash
      || header?.hash !== ref.hash || header.height !== ref.height) return 'MISSING_FINAL_BLOCK_REFERENCE';
    heights.push(ref.height); positions.set(receipt.id as string, ref.height);
  }
  for (const receipt of executions) {
    const parentHeight = positions.get(receipt.id as string)!, children = (receipt.outcome as JsonObject).receipt_ids as string[];
    if (children.some((id) => positions.get(id)! < parentHeight)) return 'RECEIPT_CHRONOLOGY';
  }
  return { recipientId: attempt.receiverId, amount: BigInt(deposit), firstHeight: Math.min(...heights), lastHeight: Math.max(...heights) };
}

export function evaluateTargetEvidence(target: TargetEvidence, approval: ApprovalDetails, context?: ScenarioEvaluationContext): TargetVerdict {
  if (target.targetKind !== 'direct') return evaluateContractEvidence(target, approval, context);
  const verdict: TargetVerdict = {
    status: 'INCONCLUSIVE', summary: 'Finalized evidence does not establish the intended credit.', reasonCodes: [],
    intendedCreditYocto: approval.amountYocto, observedCreditYocto: null, successfulReceiptCreditYocto: null,
    transactionHashes: [...new Set(target.attempts.map((a) => a.txHash))],
  };
  const incomplete = (code: string): TargetVerdict => ({ ...verdict, reasonCodes: [code] });
  if (!money(approval.amountYocto) || BigInt(approval.amountYocto) <= 0n || !approval.recipientId || !approval.signerId) return incomplete('INVALID_APPROVAL');
  if (target.errors?.length) return incomplete('UNRESOLVED_ATTEMPT');
  if (target.attempts.length === 0) return incomplete('NO_ATTEMPTS');
  const { before, after } = target.snapshots;
  if (!before || !after) return incomplete('MISSING_BALANCE_SNAPSHOT');
  for (const snapshot of [before, after]) {
    const problem = snapshotProblem(snapshot, approval.recipientId);
    if (problem) return incomplete(problem);
  }
  const blockProblem = blockReferenceProblem(target);
  if (blockProblem) return incomplete(blockProblem);
  if (before.block.height >= after.block.height) return incomplete('SNAPSHOT_ORDER');
  verdict.observedCreditYocto = (BigInt(after.amountYocto) - BigInt(before.amountYocto)).toString();
  const proofs: TransferProof[] = [];
  const outcomes = new Map<string, JsonValue>();
  for (const attempt of target.attempts) {
    if (attempt.signerId !== approval.signerId) return incomplete('INCONSISTENT_TRANSACTION_IDENTITY');
    const proof = transferProof(attempt);
    if (typeof proof === 'string') return incomplete(proof);
    if (before.block.height >= proof.firstHeight) return incomplete('SNAPSHOT_ORDER');
    if (after.block.height < proof.lastHeight) return incomplete('BALANCE_PRECEDES_RECEIPT');
    if (outcomes.has(attempt.txHash)) {
      if (!sameJson(outcomes.get(attempt.txHash), attempt.finalOutcome)) return incomplete('INCONSISTENT_TRANSACTION_IDENTITY');
      continue;
    }
    outcomes.set(attempt.txHash, attempt.finalOutcome); proofs.push(proof);
  }
  const credited = proofs.filter((p) => p.recipientId === approval.recipientId).reduce((sum, p) => sum + p.amount, 0n);
  verdict.successfulReceiptCreditYocto = credited.toString();
  if (BigInt(verdict.observedCreditYocto!) !== credited) return incomplete('BALANCE_RECEIPT_MISMATCH');
  const reasons: string[] = [];
  if (proofs.some((p) => p.recipientId !== approval.recipientId)) reasons.push('RECIPIENT_MISMATCH');
  if (proofs.some((p) => p.amount !== BigInt(approval.amountYocto))) reasons.push('AMOUNT_MISMATCH');
  if (proofs.length > 1) reasons.push('DUPLICATE_CREDIT');
  if (reasons.length) return { ...verdict, status: 'VIOLATED', summary: 'Successful finalized transfers violate the exact approval.', reasonCodes: reasons };
  if (credited !== BigInt(approval.amountYocto)) return incomplete('BALANCE_RECEIPT_MISMATCH');
  return { ...verdict, status: 'HOLDS', summary: 'Exactly one intended credit is proven.', reasonCodes: ['EXACT_INTENDED_CREDIT'] };
}
