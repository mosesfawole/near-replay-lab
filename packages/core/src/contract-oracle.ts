import type { ApprovalDetails, ContractStateSnapshot, FinalBlockReference, JsonObject, JsonValue, RecipientSnapshot, RpcEvidence, ScenarioEvaluationContext, TargetEvidence, TargetVerdict, TransactionAttempt } from './types.js';

const decimal = /^(0|[1-9][0-9]*)$/;
const scenarioKinds = new Set(['fixture-legitimate', 'fixture-expired', 'recipient-substitution', 'lost-response-retry', 'concurrent-duplicates']);
function object(value: JsonValue | undefined): JsonObject | undefined { return value !== null && typeof value === 'object' && !Array.isArray(value) ? value : undefined; }
function integer(value: unknown, bits = 128): value is string { return typeof value === 'string' && value.length <= 39 && decimal.test(value) && BigInt(value) < (1n << BigInt(bits)); }
function exactNumber(value: JsonValue | undefined): string | undefined {
  if (typeof value === 'number') return Number.isSafeInteger(value) && value >= 0 ? String(value) : undefined;
  return integer(value) ? value : undefined;
}
function same(left: JsonValue | undefined, right: JsonValue | undefined): boolean {
  if (left === right) return true;
  if (Array.isArray(left) || Array.isArray(right)) return Array.isArray(left) && Array.isArray(right) && left.length === right.length && left.every((item, i) => same(item, right[i]));
  const a = object(left), b = object(right);
  return !!a && !!b && Object.keys(a).length === Object.keys(b).length && Object.keys(a).every((key) => Object.hasOwn(b, key) && same(a[key], b[key]));
}
function decodeJson(bytes: unknown): JsonValue | undefined {
  try {
    if (!Array.isArray(bytes) || !bytes.every((value) => Number.isInteger(value) && value >= 0 && value <= 255)) return undefined;
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(new Uint8Array(bytes))) as JsonValue;
  } catch { return undefined; }
}
function argumentsJson(value: JsonValue | undefined): JsonValue | undefined {
  try {
    if (typeof value !== 'string' || value.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(value)) return undefined;
    return decodeJson([...atob(value)].map((character) => character.charCodeAt(0)));
  } catch { return undefined; }
}
function blockDetails(ref: TransactionAttempt['finalBlocks'][number]): { height: number; ns: bigint } | undefined {
  const record = ref.evidence, params = object(record?.params), header = object(object(object(record?.response)?.result)?.header);
  if (ref.finality !== 'FINAL' || !Number.isSafeInteger(ref.height) || ref.height < 0 || record?.method !== 'block' || record.error
    || params?.block_id !== ref.hash || header?.hash !== ref.hash || header.height !== ref.height || !integer(header.timestamp_nanosec, 64)) return undefined;
  return { height: ref.height, ns: BigInt(header.timestamp_nanosec) };
}
type BlockPosition = NonNullable<ReturnType<typeof blockDetails>>;
function follows(child: BlockPosition, parent: BlockPosition): boolean { return child.height >= parent.height && child.ns >= parent.ns; }
function blockReferenceProblem(target: TargetEvidence, approval: ApprovalDetails): string | undefined {
  const known = new Map<string, { height: number; header?: JsonObject }>();
  const register = (hash: string, height: number, header?: JsonObject): string | undefined => {
    if (!hash || !Number.isSafeInteger(height) || height < 0) return 'MISSING_FINAL_BLOCK_REFERENCE';
    const previous = known.get(hash);
    if (previous && (previous.height !== height || previous.header && header && !same(previous.header, header))) return 'CONFLICTING_BLOCK_REFERENCE';
    known.set(hash, { height, header: previous?.header ?? header }); return undefined;
  };
  const reference = (ref: FinalBlockReference, requireBody = true): string | undefined => {
    let header: JsonObject | undefined;
    if (ref.evidence) {
      if (!blockDetails(ref)) return 'MISSING_FINAL_BLOCK_REFERENCE';
      header = object(object(object(ref.evidence.response)?.result)?.header);
    } else if (requireBody) return 'MISSING_FINAL_BLOCK_REFERENCE';
    return register(ref.hash, ref.height, header);
  };
  const query = (record?: RpcEvidence): string | undefined => {
    if (!record) return undefined;
    const result = object(object(record.response)?.result);
    if (record.method !== 'query' || !result || !('block_hash' in result) || !('block_height' in result)) return undefined;
    return typeof result.block_hash === 'string' && typeof result.block_height === 'number'
      ? register(result.block_hash, result.block_height) : 'MISSING_FINAL_BLOCK_REFERENCE';
  };
  for (const attempt of target.attempts) for (const ref of attempt.finalBlocks) { const problem = reference(ref); if (problem) return problem; }
  for (const state of target.stateSnapshots ?? []) { const problem = reference(state.block) ?? query(state.evidence); if (problem) return problem; }
  for (const pair of [target.snapshots, ...Object.values(target.snapshots.relatedAccounts ?? {})]) for (const snapshot of [pair.before, pair.after]) {
    if (snapshot) { const problem = reference(snapshot.block, false) ?? query(snapshot.evidence); if (problem) return problem; }
  }
  return query(approval.evidence);
}
function snapshotProblem(snapshot: RecipientSnapshot, id: string): string | undefined {
  const params = object(snapshot.evidence?.params), result = object(object(snapshot.evidence?.response)?.result);
  if (snapshot.block.finality !== 'FINAL') return 'NONFINAL_BALANCE';
  if (snapshot.recipientId !== id || !integer(snapshot.amountYocto) || !integer(snapshot.lockedYocto) || snapshot.evidence.error
    || params?.request_type !== 'view_account' || params.account_id !== id || params.finality !== 'final' || result?.amount !== snapshot.amountYocto
    || result.locked !== snapshot.lockedYocto || result.block_hash !== snapshot.block.hash || result.block_height !== snapshot.block.height
    || !Number.isSafeInteger(snapshot.block.height) || snapshot.block.height < 0) return 'INVALID_BALANCE';
  return undefined;
}
function stateValue(snapshot: ContractStateSnapshot, contract: string): JsonObject | undefined {
  const params = object(snapshot.evidence?.params), result = object(object(snapshot.evidence?.response)?.result);
  if (snapshot.contractId !== contract || !blockDetails(snapshot.block) || snapshot.evidence.error || params?.request_type !== 'call_function'
    || params.account_id !== contract || params.method_name !== snapshot.methodName || params.finality !== 'final'
    || !same(argumentsJson(params.args_base64), snapshot.args) || result?.block_hash !== snapshot.block.hash || result.block_height !== snapshot.block.height
    || !same(decodeJson(result.result), snapshot.value)) return undefined;
  return object(snapshot.value);
}
function executionStatus(value: JsonValue | undefined): 'success' | 'failure' | 'link' | undefined {
  const status = object(value);
  if (!status || Object.keys(status).length !== 1) return undefined;
  if (typeof status.SuccessValue === 'string') return 'success';
  if (typeof status.SuccessReceiptId === 'string') return 'link';
  if (object(status.Failure)) return 'failure';
  return undefined;
}
function panicMessage(value: JsonValue | undefined): string | undefined {
  const failure = object(object(value)?.Failure), action = object(failure?.ActionError), kind = object(action?.kind), call = object(kind?.FunctionCallError);
  return typeof call?.ExecutionError === 'string' ? call.ExecutionError : undefined;
}
function policyFailure(message: string | undefined, kind: string): boolean {
  if (!message) return false;
  const expected = kind === 'fixture-expired' ? ['approval is expired'] : kind === 'recipient-substitution' ? ['canonical recipient required', 'canonical amount required']
    : ['Pending approval cannot be claimed', 'Paid approval cannot be claimed'];
  return expected.some((text) => message === text || message === `Smart contract panicked: ${text}` || message === `Smart contract panicked: ${text}, filename: \"contracts/common.rs\"`);
}

interface NativeCredit { receiptId: string; recipientId: string; amount: bigint; callbackId: string; attemptId: string }
interface CallProof {
  attempt: TransactionAttempt; method: 'approve' | 'pay'; args: JsonObject; transfers: NativeCredit[]; failure?: string;
  firstHeight: number; lastHeight: number; executionNs: bigint; receiptIds: string[];
}

function callProof(attempt: TransactionAttempt, target: TargetEvidence, approval: ApprovalDetails, recipients: Set<string>): CallProof | string {
  if (attempt.error) return 'UNRESOLVED_ATTEMPT';
  const final = object(attempt.finalOutcome);
  if (final?.final_execution_status !== 'FINAL') return 'NONFINAL_TRANSACTION';
  if (!attempt.observations.some((record) => {
    const params = object(record.params), result = object(object(record.response)?.result);
    return !record.error && ['EXPERIMENTAL_tx_status', 'tx_status', 'tx'].includes(record.method) && params?.tx_hash === attempt.txHash
      && params.sender_account_id === attempt.signerId && params.wait_until === 'FINAL' && same(result, final);
  })) return 'MISSING_FINAL_RPC_EVIDENCE';
  const tx = object(final.transaction), action = attempt.actions[0], call = object(object(Array.isArray(tx?.actions) ? tx.actions[0] : undefined)?.FunctionCall);
  const args = object(argumentsJson(call?.args));
  if (!tx || tx.hash !== attempt.txHash || tx.signer_id !== approval.signerId || tx.signer_id !== attempt.signerId || tx.public_key !== attempt.publicKey
    || tx.receiver_id !== target.accountId || tx.receiver_id !== attempt.receiverId || exactNumber(tx.nonce) !== attempt.nonce
    || attempt.actionKind !== 'function-call' || !Array.isArray(tx.actions) || tx.actions.length !== 1 || attempt.actions.length !== 1
    || action?.kind !== 'function-call' || !call || call.method_name !== action.methodName || !['approve', 'pay'].includes(action.methodName ?? '')
    || !same(args, action.args) || exactNumber(call.gas) !== action.gas || call.deposit !== '0' || action.amountYocto !== '0' || attempt.amountYocto !== '0') return 'INCONSISTENT_TRANSACTION_IDENTITY';
  if (!args || args.invoice_id !== approval.invoiceId || !integer(args.amount_yocto) || BigInt(args.amount_yocto) === 0n || typeof args.recipient !== 'string') return 'INCONSISTENT_TRANSACTION_IDENTITY';
  const transaction = object(final.transaction_outcome), transactionExecution = object(transaction?.outcome), firstId = object(transactionExecution?.status)?.SuccessReceiptId;
  if (transaction?.id !== attempt.txHash || transactionExecution?.executor_id !== attempt.signerId || typeof firstId !== 'string'
    || !Array.isArray(transactionExecution.receipt_ids) || !transactionExecution.receipt_ids.includes(firstId)) return 'MISSING_TRANSACTION_OUTCOME';
  if (!Array.isArray(final.receipts_outcome) || final.receipts_outcome.length === 0) return 'MISSING_RECEIPT_OUTCOME';
  if (!Array.isArray(final.receipts) || final.receipts.length === 0) return 'MISSING_RECEIPT_BODY';
  const outcomes = new Map<string, JsonObject>(), bodies = new Map<string, JsonObject>();
  for (const value of final.receipts_outcome) { const receipt = object(value); if (!receipt || typeof receipt.id !== 'string' || outcomes.has(receipt.id)) return 'MISSING_RECEIPT_OUTCOME'; outcomes.set(receipt.id, receipt); }
  for (const value of final.receipts) { const receipt = object(value); if (!receipt || typeof receipt.receipt_id !== 'string' || bodies.has(receipt.receipt_id)) return 'MISSING_RECEIPT_BODY'; bodies.set(receipt.receipt_id, receipt); }
  if (outcomes.has(attempt.txHash) || bodies.has(attempt.txHash)) return 'INCONSISTENT_RECEIPT_IDENTITY';
  const visited = new Set<string>(), pending = [...transactionExecution.receipt_ids];
  while (pending.length) {
    const id = pending.pop(); if (typeof id !== 'string' || !outcomes.has(id)) return 'MISSING_RECEIPT_OUTCOME';
    if (visited.has(id)) continue; visited.add(id);
    const outcome = object(outcomes.get(id)?.outcome); if (!outcome || !Array.isArray(outcome.receipt_ids) || !executionStatus(outcome.status)) return 'MISSING_RECEIPT_OUTCOME';
    if (outcome.receipt_ids.some((child) => typeof child !== 'string')) return 'MISSING_RECEIPT_OUTCOME';
    pending.push(...outcome.receipt_ids);
  }
  if (visited.size !== outcomes.size) return 'UNLINKED_RECEIPT';
  let terminal: JsonValue | undefined;
  for (const id of outcomes.keys()) {
    let current = id; const seen = new Set<string>();
    while (true) {
      if (seen.has(current)) return 'MISSING_RECEIPT_OUTCOME'; seen.add(current);
      const execution = object(outcomes.get(current)?.outcome), status = object(execution?.status), next = status?.SuccessReceiptId;
      if (typeof next !== 'string') { if (id === firstId) terminal = status; break; }
      if (!outcomes.has(next) || !Array.isArray(execution?.receipt_ids) || !execution.receipt_ids.includes(next)) return 'MISSING_RECEIPT_OUTCOME'; current = next;
    }
  }
  if (!same(terminal, final.status) || !['success', 'failure'].includes(executionStatus(final.status) ?? '')) return 'INCONSISTENT_FINAL_STATUS';
  const first = bodies.get(firstId), firstAction = object(object(first?.receipt)?.Action), firstExecution = object(outcomes.get(firstId)?.outcome);
  if (!first) return 'MISSING_RECEIPT_BODY';
  if (first.predecessor_id !== attempt.signerId || first.receiver_id !== target.accountId || firstExecution?.executor_id !== target.accountId
    || firstAction?.signer_id !== attempt.signerId || firstAction.signer_public_key !== attempt.publicKey || !same(firstAction.actions, tx.actions)) return 'INCONSISTENT_RECEIPT_IDENTITY';
  const heights: number[] = [], positions = new Map<string, BlockPosition>();
  let executionNs: bigint | undefined;
  for (const receipt of [transaction, ...outcomes.values()]) {
    const ref = attempt.finalBlocks.find((block) => block.hash === receipt?.block_hash), details = ref && blockDetails(ref);
    if (!details) return 'MISSING_FINAL_BLOCK_REFERENCE'; heights.push(details.height); positions.set(String(receipt?.id), details);
    if (receipt?.id === firstId) executionNs = details.ns;
    if (receipt?.id !== attempt.txHash) {
      const body = bodies.get(String(receipt?.id));
      if (!body) return 'MISSING_RECEIPT_BODY';
      if (object(receipt?.outcome)?.executor_id !== body.receiver_id) return 'INCONSISTENT_RECEIPT_IDENTITY';
    }
  }
  if (executionNs === undefined) return 'MISSING_FINAL_BLOCK_REFERENCE';
  for (const receipt of [transaction, ...outcomes.values()]) {
    const parent = positions.get(String(receipt?.id))!, children = object(receipt?.outcome)?.receipt_ids as JsonValue[];
    for (const id of children) if (!follows(positions.get(String(id))!, parent)) return 'RECEIPT_CHRONOLOGY';
  }
  const transfers: NativeCredit[] = [], callbackIds = new Set<string>();
  for (const [id, body] of bodies) {
    const receiptAction = object(object(body.receipt)?.Action), actions = receiptAction?.actions;
    if (!Array.isArray(actions)) continue;
    const deposits = actions.map((item) => object(object(item)?.Transfer)?.deposit).filter((value) => value !== undefined);
    if (!deposits.length) continue;
    if (!recipients.has(String(body.receiver_id))) {
      if (body.predecessor_id === target.accountId) return 'UNOBSERVED_RECIPIENT';
      continue; // Runtime gas refunds to the operator are not obligation credits.
    }
    if (body.predecessor_id !== target.accountId || receiptAction?.signer_id !== attempt.signerId || receiptAction.signer_public_key !== attempt.publicKey
      || actions.length !== 1 || deposits.length !== 1 || !integer(deposits[0]) || BigInt(deposits[0]) === 0n || !visited.has(id)
      || !Array.isArray(firstExecution?.receipt_ids) || !firstExecution.receipt_ids.includes(id)) return 'INCONSISTENT_RECEIPT_IDENTITY';
    if (executionStatus(object(outcomes.get(id)?.outcome)?.status) !== 'success') return 'FAILED_TRANSFER';
    const callbackId = object(firstExecution.status)?.SuccessReceiptId;
    if (typeof callbackId !== 'string') return 'MISSING_CALLBACK';
    const callbackBody = bodies.get(callbackId), callbackAction = object(object(callbackBody?.receipt)?.Action);
    const callbackCall = object(object(Array.isArray(callbackAction?.actions) ? callbackAction.actions[0] : undefined)?.FunctionCall), callbackArgs = object(argumentsJson(callbackCall?.args));
    const outputs = receiptAction.output_data_receivers, inputs = callbackAction?.input_data_ids;
    const dependency = Array.isArray(outputs) && outputs.length === 1 ? object(outputs[0]) : undefined;
    if (!callbackBody || callbackBody.predecessor_id !== target.accountId || callbackBody.receiver_id !== target.accountId || callbackAction?.signer_id !== attempt.signerId
      || callbackAction.signer_public_key !== attempt.publicKey || !Array.isArray(callbackAction.actions) || callbackAction.actions.length !== 1
      || callbackCall?.method_name !== 'on_transfer' || callbackCall.deposit !== '0' || !callbackArgs || callbackArgs.invoice_id !== approval.invoiceId
      || callbackArgs.recipient !== body.receiver_id || callbackArgs.amount_yocto !== deposits[0] || !integer(callbackArgs.attempt_id, 64) || callbackArgs.attempt_id === '0'
      || !dependency || dependency.receiver_id !== target.accountId || typeof dependency.data_id !== 'string' || dependency.data_id.length === 0
      || !Array.isArray(inputs) || inputs.length !== 1 || typeof inputs[0] !== 'string' || inputs[0].length === 0 || inputs[0] !== dependency.data_id
      || callbackIds.has(callbackId)) return 'MISSING_CALLBACK';
    if (!follows(positions.get(callbackId)!, positions.get(id)!)) return 'RECEIPT_CHRONOLOGY';
    if (executionStatus(object(outcomes.get(callbackId)?.outcome)?.status) !== 'success') return 'PENDING_CALLBACK';
    callbackIds.add(callbackId); transfers.push({ receiptId: id, recipientId: body.receiver_id as string, amount: BigInt(deposits[0]), callbackId, attemptId: callbackArgs.attempt_id });
  }
  const method = action.methodName as 'approve' | 'pay', failed = executionStatus(firstExecution?.status) === 'failure';
  if (failed && transfers.length) return 'INCONSISTENT_FINAL_STATUS';
  for (const [id, receipt] of outcomes) {
    if (executionStatus(object(receipt.outcome)?.status) === 'failure' && id !== firstId) return 'UNEXPECTED_CONTRACT_FAILURE';
  }
  return { attempt, method, args, transfers, ...(failed ? { failure: panicMessage(firstExecution?.status) ?? 'Unknown contract failure.' } : {}),
    firstHeight: heights[0]!, lastHeight: Math.max(...heights), executionNs, receiptIds: [...outcomes.keys()] };
}

/** Bounded fixture oracle: finalized native receipt credit, exact balances, policy failures and callback state. */
export function evaluateContractEvidence(target: TargetEvidence, approval: ApprovalDetails, context?: ScenarioEvaluationContext): TargetVerdict {
  const verdict: TargetVerdict = { status: 'INCONCLUSIVE', summary: 'Finalized evidence does not establish the fixture scenario.', reasonCodes: [], intendedCreditYocto: approval.amountYocto,
    observedCreditYocto: null, successfulReceiptCreditYocto: null, transactionHashes: [...new Set(target.attempts.map((attempt) => attempt.txHash))] };
  const incomplete = (code: string): TargetVerdict => ({ ...verdict, reasonCodes: [code] });
  if (!integer(approval.amountYocto) || approval.amountYocto === '0' || !approval.signerId || !approval.recipientId || !approval.invoiceId || !approval.expiresAt) return incomplete('INVALID_APPROVAL');
  if (!context || !scenarioKinds.has(context.kind)) return incomplete('MISSING_SCENARIO_CONTEXT');
  if (target.errors?.length || target.attempts.some((attempt) => attempt.error)) return incomplete('UNRESOLVED_ATTEMPT');
  if (!target.attempts.length) return incomplete('NO_ATTEMPTS');
  const blockProblem = blockReferenceProblem(target, approval); if (blockProblem) return incomplete(blockProblem);
  if (context.kind !== 'fixture-legitimate') {
    const control = context.legitimateControl;
    if (!control || control.target.accountId !== target.accountId || control.target.targetKind !== target.targetKind || control.approval.invoiceId === approval.invoiceId) return incomplete('MISSING_LEGITIMATE_CONTROL');
    if (evaluateContractEvidence(control.target, control.approval, { kind: 'fixture-legitimate' }).status !== 'HOLDS') return incomplete('FAILED_LEGITIMATE_CONTROL');
  }
  const states = target.stateSnapshots ?? [], configState = states.find((state) => state.methodName === 'get_config');
  const approvalStates = states.filter((state) => state.methodName === 'get_approval' && object(state.args)?.invoice_id === approval.invoiceId);
  if (!configState || approvalStates.length < 2) return incomplete('MISSING_CONTRACT_STATE');
  const config = stateValue(configState, target.accountId), preState = approvalStates[0]!, postState = approvalStates.at(-1)!;
  const pre = stateValue(preState, target.accountId), post = stateValue(postState, target.accountId);
  if (!config || !pre || !post) return incomplete('INVALID_CONTRACT_STATE');
  if (post.status === 'Pending') return incomplete('PENDING_CALLBACK');
  const recipients = new Set([approval.recipientId, ...Object.keys(target.snapshots.relatedAccounts ?? {})]);
  const allowedRecipients = config.allowed_recipients;
  if (recipients.size !== 2 || recipients.has(target.accountId) || recipients.has(approval.signerId) || config.owner_id !== approval.signerId
    || !Array.isArray(config.worker_public_keys) || config.worker_public_keys.length !== 2 || new Set(config.worker_public_keys).size !== 2
    || !Array.isArray(allowedRecipients) || allowedRecipients.length !== 2 || [...recipients].some((id) => !allowedRecipients.includes(id))
    || !integer(config.max_payment_yocto) || BigInt(config.max_payment_yocto) < BigInt(approval.amountYocto)) return incomplete('INCONSISTENT_FIXTURE_CONFIG');
  if (pre.invoice_id !== approval.invoiceId || pre.recipient !== approval.recipientId || pre.amount_yocto !== approval.amountYocto || !integer(pre.expires_at_ns, 64)
    || pre.status !== 'Approved' || pre.completed_payment_count !== '0' || pre.attempt_id !== '0' || pre.last_completed_recipient !== null || pre.last_completed_amount_yocto !== null
    || new Date(Number(BigInt(pre.expires_at_ns) / 1000000n)).toISOString() !== approval.expiresAt) return incomplete('INCONSISTENT_APPROVAL');
  if (post.invoice_id !== pre.invoice_id || post.recipient !== pre.recipient || post.amount_yocto !== pre.amount_yocto || post.expires_at_ns !== pre.expires_at_ns
    || !integer(post.completed_payment_count, 64) || !integer(post.attempt_id, 64)) return incomplete('INCONSISTENT_APPROVAL');
  const proofs: CallProof[] = [], hashes = new Map<string, JsonValue>(), receiptIds = new Set<string>();
  for (const attempt of target.attempts) {
    const proof = callProof(attempt, target, approval, recipients); if (typeof proof === 'string') return incomplete(proof);
    if (hashes.has(attempt.txHash)) { if (!same(hashes.get(attempt.txHash), attempt.finalOutcome)) return incomplete('INCONSISTENT_TRANSACTION_IDENTITY'); continue; }
    hashes.set(attempt.txHash, attempt.finalOutcome!);
    if (proof.receiptIds.some((id) => receiptIds.has(id))) return incomplete('INCONSISTENT_RECEIPT_IDENTITY'); proof.receiptIds.forEach((id) => receiptIds.add(id)); proofs.push(proof);
  }
  const approvals = proofs.filter((proof) => proof.method === 'approve'), pays = proofs.filter((proof) => proof.method === 'pay'), expiry = BigInt(pre.expires_at_ns);
  if (approvals.length !== 1 || approvals[0]!.failure || approvals[0]!.transfers.length || !same(approvals[0]!.args, {
    invoice_id: approval.invoiceId, recipient: approval.recipientId, amount_yocto: approval.amountYocto, expires_at_ns: pre.expires_at_ns,
  }) || approvals[0]!.executionNs >= expiry || preState.block.height < approvals[0]!.lastHeight) return incomplete('INCONSISTENT_APPROVAL');
  if (!pays.length) return incomplete('NO_PAY_ATTEMPTS');
  if (configState.block.height >= Math.min(...pays.map((proof) => proof.firstHeight)) || preState.block.height >= Math.min(...pays.map((proof) => proof.firstHeight))
    || postState.block.height < Math.max(...pays.map((proof) => proof.lastHeight))) return incomplete('STATE_SNAPSHOT_ORDER');
  const credits = pays.flatMap((proof) => proof.transfers);
  for (const proof of pays) {
    if (!config.worker_public_keys.includes(proof.attempt.publicKey) || !recipients.has(String(proof.args.recipient)) || BigInt(proof.args.amount_yocto as string) > BigInt(config.max_payment_yocto as string)) return incomplete('INCONSISTENT_TRANSACTION_IDENTITY');
    if (proof.failure && !policyFailure(proof.failure, context.kind)) return incomplete('UNEXPECTED_CONTRACT_FAILURE');
    if (context.kind === 'fixture-expired' ? proof.executionNs < expiry : proof.executionNs >= expiry) return incomplete('EXPIRY_EVIDENCE_MISMATCH');
  }
  for (const id of recipients) {
    const pair = id === approval.recipientId ? target.snapshots : target.snapshots.relatedAccounts?.[id];
    if (!pair?.before || !pair.after) return incomplete('MISSING_BALANCE_SNAPSHOT');
    for (const snapshot of [pair.before, pair.after]) { const problem = snapshotProblem(snapshot, id); if (problem) return incomplete(problem); }
    if (pair.before.block.height >= pair.after.block.height || pays.some((proof) => pair.before!.block.height >= proof.firstHeight)) return incomplete('SNAPSHOT_ORDER');
    if (pays.some((proof) => pair.after!.block.height < proof.lastHeight)) return incomplete('BALANCE_PRECEDES_RECEIPT');
    const observed = BigInt(pair.after.amountYocto) - BigInt(pair.before.amountYocto), credited = credits.filter((credit) => credit.recipientId === id).reduce((sum, credit) => sum + credit.amount, 0n);
    if (id === approval.recipientId) { verdict.observedCreditYocto = observed.toString(); verdict.successfulReceiptCreditYocto = credited.toString(); }
    if (observed !== credited) return incomplete('BALANCE_RECEIPT_MISMATCH');
  }
  const completedAttempts = BigInt(post.attempt_id);
  if (BigInt(post.completed_payment_count) !== BigInt(credits.length) || completedAttempts !== BigInt(credits.length)
    || credits.some((credit) => BigInt(credit.attemptId) > completedAttempts) || new Set(credits.map((credit) => credit.attemptId)).size !== credits.length
    || (credits.length ? post.status !== 'Paid' || !credits.some((credit) => credit.recipientId === post.last_completed_recipient && credit.amount.toString() === post.last_completed_amount_yocto)
      : post.status !== 'Approved' || post.last_completed_recipient !== null || post.last_completed_amount_yocto !== null)) return incomplete('INCOMPLETE_CALLBACK_STATE');
  const duplicate = ['lost-response-retry', 'concurrent-duplicates'].includes(context.kind);
  if (pays.length !== (duplicate ? 2 : 1)) return incomplete('SCENARIO_ATTEMPT_MISMATCH');
  if (duplicate) {
    const a = pays[0]!, b = pays[1]!;
    if (context.kind === 'concurrent-duplicates' ? a.attempt.publicKey === b.attempt.publicKey
      : a.attempt.publicKey !== b.attempt.publicKey || BigInt(b.attempt.nonce) <= BigInt(a.attempt.nonce) || b.firstHeight < a.lastHeight) return incomplete('SCENARIO_ATTEMPT_MISMATCH');
  }
  const reasons: string[] = [];
  if (credits.some((credit) => credit.recipientId !== approval.recipientId)) reasons.push('RECIPIENT_MISMATCH');
  if (credits.some((credit) => credit.amount !== BigInt(approval.amountYocto))) reasons.push('AMOUNT_MISMATCH');
  if (credits.length > 1) reasons.push('DUPLICATE_CREDIT');
  if (context.kind === 'fixture-expired' && credits.length) reasons.push('EXPIRED_APPROVAL_CREDIT');
  if (reasons.length) return { ...verdict, status: 'VIOLATED', summary: 'Finalized fixture transfers violate the canonical obligation.', reasonCodes: reasons };
  const rejected = context.kind === 'fixture-expired' || context.kind === 'recipient-substitution';
  if (rejected) {
    if (credits.length !== 0 || pays.some((proof) => !proof.failure) || (context.kind === 'recipient-substitution' && pays.some((proof) => proof.args.recipient === approval.recipientId))) return incomplete('SCENARIO_BEHAVIOR_MISMATCH');
    return { ...verdict, status: 'HOLDS', summary: 'Fixture rejected the disallowed payment with zero recipient credit.', reasonCodes: ['CONTRACT_POLICY_REJECTION'] };
  }
  if (credits.length !== 1 || credits[0]!.recipientId !== approval.recipientId || credits[0]!.amount !== BigInt(approval.amountYocto)
    || pays.filter((proof) => proof.failure).length !== (duplicate ? 1 : 0)) return incomplete('SCENARIO_BEHAVIOR_MISMATCH');
  return { ...verdict, status: 'HOLDS', summary: 'Exactly one approved fixture transfer is proven.', reasonCodes: ['EXACT_INTENDED_CREDIT', ...(duplicate ? ['CONTRACT_POLICY_REJECTION'] : [])] };
}
