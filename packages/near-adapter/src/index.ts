import { actions, baseDecode, baseEncode, createTransaction, encodeTransaction, JsonRpcProvider, type SignedTransaction, type Signer } from 'near-api-js';
import type { ContractStateSnapshot, FinalBlockReference, JsonObject, JsonValue, PublicError, RecipientSnapshot, RpcEvidence, TransactionAttempt } from '../../core/src/index.js';
import { publicSignaturePaths } from '../../core/src/public-signatures.js';

export interface RpcClientOptions { rpcUrl: string; timeoutMs?: number; fetchImpl?: typeof fetch }
export interface ObservationOptions { timeoutMs?: number; pollIntervalMs?: number; includeReceipts?: boolean }
export interface SignTransferOptions { client: NearRpcClient; signer: Signer; signerId: string; receiverId: string; amountYocto: string; nonceFloor?: string }
export interface SignFunctionCallOptions extends SignTransferOptions { methodName: string; args: JsonValue; gas: string }
export interface PreparedTransaction { signedTransaction: SignedTransaction; attempt: TransactionAttempt }
export interface BroadcastOptions { discardResponse?: boolean }
interface RpcRequestCapture { metadata?: JsonObject; discardResponse?: boolean; onEvidence?: (record: RpcEvidence) => void; deadlineMs?: number }
export interface FinalizedTimestampBlock { block: FinalBlockReference; timestampNs: string }

const integer = /^(0|[1-9][0-9]*)$/;
const secretField = /private[_-]?key|secret[_-]?key|seed[_-]?phrase|mnemonic/i;
const u128Max = (1n << 128n) - 1n;
const now = () => new Date().toISOString();
function object(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}
function unsigned(value: unknown, label: string, positive = false): bigint {
  if (typeof value !== 'string' || value.length > 39 || !integer.test(value)) throw new Error(`${label} must be an exact decimal integer string.`);
  const result = BigInt(value);
  if (result > u128Max || (positive && result === 0n)) throw new Error(`${label} is outside its valid range.`);
  return result;
}
function namedTestnetAccount(value: string): void {
  if (value.length > 64 || !/^[a-z0-9]+(?:[-_.][a-z0-9]+)*\.testnet$/.test(value)) throw new Error('A named disposable testnet account ID is required.');
}
function timing(options: ObservationOptions): { timeoutMs: number; pollIntervalMs: number } {
  const timeoutMs = options.timeoutMs ?? 90_000, pollIntervalMs = options.pollIntervalMs ?? 1_000;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > 300_000 || !Number.isSafeInteger(pollIntervalMs) || pollIntervalMs <= 0) throw new Error('Observation timings must be finite positive integers.');
  return { timeoutMs, pollIntervalMs };
}
async function pause(ms: number): Promise<void> { await new Promise<void>((resolve) => setTimeout(resolve, ms)); }

export class RpcRequestError extends Error {
  constructor(readonly publicError: PublicError, readonly evidence?: RpcEvidence) { super(publicError.message); this.name = 'RpcRequestError'; }
}

export function toPublicError(error: unknown, category: PublicError['category'] = 'local'): PublicError {
  if (error instanceof RpcRequestError) return error.publicError;
  return { category, message: String(sanitizePublicEvidence(error instanceof Error ? error.message : 'Unknown local error.')) };
}
function legacyQueryError(method: string, params: unknown, value: unknown): PublicError | undefined {
  const result = object(value);
  if (method !== 'query' || !result || !Object.hasOwn(result, 'error')) return undefined;
  const request = object(params), message = typeof result.error === 'string' ? result.error : undefined;
  const missingKey = message?.match(/^access key (.*?) does not exist while viewing$/)?.[1];
  const identified = request?.request_type === 'view_access_key' && typeof request.public_key === 'string' && request.public_key.length > 0
    && missingKey === request.public_key && typeof result.block_hash === 'string' && result.block_hash.length > 0
    && typeof result.block_height === 'number' && Number.isSafeInteger(result.block_height) && result.block_height >= 0;
  return { category: 'rpc', code: identified ? 'UNKNOWN_ACCESS_KEY' : 'LEGACY_QUERY_ERROR',
    message: `RPC query failed: ${message === undefined ? 'Malformed legacy query error.' : String(sanitizePublicEvidence(message))}` };
}

export class NearRpcClient extends JsonRpcProvider {
  readonly records: RpcEvidence[] = [];
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;
  private requestId = 0;
  constructor(options: RpcClientOptions) {
    super({ url: options.rpcUrl }, { retries: 0 });
    const url = new URL(options.rpcUrl);
    if (url.protocol !== 'https:' || url.username || url.password || /mainnet/i.test(url.hostname)) throw new Error('A public HTTPS testnet RPC URL is required.');
    this.timeoutMs = options.timeoutMs ?? 15_000;
    if (!Number.isSafeInteger(this.timeoutMs) || this.timeoutMs <= 0 || this.timeoutMs > 120_000) throw new Error('RPC timeout must be a finite positive integer.');
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  /** SDK methods use this bounded transport so complete public errors are not discarded. */
  override async sendJsonRpc(method: string, params: unknown, capture: RpcRequestCapture = {}): Promise<any> {
    const publicParams = method === 'send_tx'
      ? { wait_until: object(params)?.wait_until ?? 'NONE', signedTransactionOmitted: true, ...capture.metadata,
        ...(capture.discardResponse ? { responseDiscarded: true } : {}) }
      : params;
    const record: RpcEvidence = { method, params: sanitizePublicEvidence(publicParams), requestedAt: now(), receivedAt: now(), response: null };
    const controller = new AbortController();
    const deadline = Math.min(Date.now() + this.timeoutMs, capture.deadlineMs ?? Infinity), timeoutMs = Math.max(0, deadline - Date.now());
    const timeoutError = new Error('RPC request timed out.');
    let timer: ReturnType<typeof setTimeout>;
    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => { controller.abort(timeoutError); reject(timeoutError); }, Math.max(1, timeoutMs));
    });
    try {
      if (timeoutMs === 0) { controller.abort(timeoutError); throw timeoutError; }
      const response = await Promise.race([this.fetchImpl(this.connection.url, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: controller.signal,
        body: JSON.stringify({ jsonrpc: '2.0', id: `near-replay-${++this.requestId}`, method, params }),
      }), timeout]);
      if (method === 'send_tx' && capture.discardResponse) throw new RpcRequestError({ category: 'transport',
        message: 'Constructed fault injection discarded the broadcast response after sending the signed transaction.', code: 'INJECTED_RESPONSE_DISCARD' });
      const text = await Promise.race([response.text(), timeout]);
      let envelope: unknown;
      try { envelope = JSON.parse(text); } catch { throw new RpcRequestError({ category: 'rpc', message: `RPC ${method} returned invalid JSON.`, code: `HTTP_${response.status}` }); }
      record.response = sanitizePublicEvidence(envelope);
      const body = object(envelope);
      if (!body || body.jsonrpc !== '2.0') throw new RpcRequestError({ category: 'rpc', message: `RPC ${method} returned a malformed envelope.` });
      if (body.error !== undefined) {
        const error = object(body.error), cause = object(error?.cause), data = object(error?.data);
        const code = cause?.name ?? data?.name ?? error?.name ?? error?.code;
        throw new RpcRequestError({ category: 'rpc', message: `RPC ${method} failed: ${String(error?.message ?? 'JSON-RPC error')}`, ...(code === undefined ? {} : { code: String(code) }) });
      }
      if (!response.ok) throw new RpcRequestError({ category: 'transport', message: `RPC ${method} returned HTTP ${response.status}.`, code: `HTTP_${response.status}` });
      if (!('result' in body)) throw new RpcRequestError({ category: 'rpc', message: `RPC ${method} response is missing result.` });
      if (Date.now() >= deadline) { controller.abort(timeoutError); throw timeoutError; }
      const queryError = legacyQueryError(method, params, body.result);
      if (queryError) throw new RpcRequestError(queryError);
      return body.result;
    } catch (error) {
      const failure = controller.signal.aborted
        ? { category: 'timeout' as const, message: `RPC ${method} request timed out after ${timeoutMs} ms.`, code: 'RPC_TIMEOUT' }
        : toPublicError(error, 'transport');
      record.error = failure;
      throw new RpcRequestError(failure, record);
    } finally {
      clearTimeout(timer!); record.receivedAt = now(); this.records.push(record); capture.onEvidence?.(record);
    }
  }

  async verifyTestnet(): Promise<void> {
    const status = await this.viewNodeStatus();
    if (status.chain_id !== 'testnet') throw new RpcRequestError({ category: 'configuration', message: 'RPC chain ID is not testnet; signing is refused.', code: 'NON_TESTNET_RPC' });
  }
}

export function sanitizePublicEvidence(value: unknown, secrets: string[] = []): JsonValue {
  const signaturePaths = publicSignaturePaths(value);
  const visit = (value: unknown, path: string[] = []): JsonValue => {
    if (value === null || typeof value === 'boolean') return value;
    if (typeof value === 'bigint') return value.toString();
    if (typeof value === 'number') return Number.isFinite(value) ? value : null;
    if (typeof value === 'string') {
      let result = value;
      for (const secret of secrets) if (secret) result = result.split(secret).join('[REDACTED]');
      if (!signaturePaths.has(JSON.stringify(path))) result = result.replace(/ed25519:[1-9A-HJ-NP-Za-km-z]{80,}/g, '[REDACTED]');
      return result;
    }
    if (Array.isArray(value)) return value.map((v, i) => visit(v, [...path, String(i)]));
    if (value && typeof value === 'object') {
      const result: JsonObject = {};
      for (const [key, child] of Object.entries(value)) {
        if (secretField.test(key) || child === undefined) continue;
        Object.defineProperty(result, key, { value: visit(child, [...path, key]), enumerable: true, configurable: true, writable: true });
      }
      return result;
    }
    return null;
  };
  return visit(value);
}

export async function queryFinalizedBalance(client: NearRpcClient, accountId: string, options: ObservationOptions & { minimumHeight?: number } = {}): Promise<RecipientSnapshot> {
  namedTestnetAccount(accountId);
  const { timeoutMs, pollIntervalMs } = timing(options), minimumHeight = options.minimumHeight ?? 0;
  if (!Number.isSafeInteger(minimumHeight) || minimumHeight < 0) throw new Error('Minimum final block height must be a safe integer.');
  const deadline = Date.now() + timeoutMs;
  do {
    const result = object(await client.sendJsonRpc('query', { request_type: 'view_account', account_id: accountId, finality: 'final' }));
    if (!result || typeof result.block_hash !== 'string' || !Number.isSafeInteger(result.block_height)) throw new Error('Finalized account query returned incomplete block evidence.');
    unsigned(result.amount, 'Account balance'); unsigned(result.locked, 'Locked balance');
    const height = result.block_height as number;
    if (height >= minimumHeight) return {
      recipientId: accountId, amountYocto: result.amount as string, lockedYocto: result.locked as string,
      queriedAt: now(), block: { hash: result.block_hash, height, finality: 'FINAL' }, evidence: client.records.at(-1)!,
    };
    await pause(Math.min(pollIntervalMs, Math.max(1, deadline - Date.now())));
  } while (Date.now() < deadline);
  throw new RpcRequestError({ category: 'timeout', message: 'Finalized balance did not reach the transaction receipt block before the deadline.', code: 'BALANCE_FINALITY_TIMEOUT' });
}

async function prepare(options: SignTransferOptions, action: ReturnType<typeof actions.transfer>, publicAction: TransactionAttempt['actions'][number]): Promise<PreparedTransaction> {
  namedTestnetAccount(options.signerId); namedTestnetAccount(options.receiverId);
  const publicKey = await options.signer.getPublicKey();
  if (publicKey.keyType !== 0) throw new Error('The local testnet runner requires an ed25519 signer.');
  const accessKey = object(await options.client.sendJsonRpc('query', {
    request_type: 'view_access_key', account_id: options.signerId, public_key: publicKey.toString(), finality: 'final',
  }));
  if (!accessKey || typeof accessKey.block_hash !== 'string') throw new Error('Access-key query returned incomplete block evidence.');
  const rawNonce = accessKey.nonce;
  if (typeof rawNonce === 'number' && (!Number.isSafeInteger(rawNonce) || rawNonce < 0)) throw new Error('Access-key nonce cannot be represented exactly; signing is refused.');
  const chainNonce = unsigned(typeof rawNonce === 'number' ? String(rawNonce) : rawNonce, 'Access-key nonce');
  const floor = options.nonceFloor === undefined ? 0n : unsigned(options.nonceFloor, 'Explicit nonce floor');
  const nonce = (chainNonce > floor ? chainNonce : floor) + 1n;
  if (nonce >= (1n << 64n)) throw new Error('Transaction nonce is outside u64; signing is refused.');
  if (publicAction.kind === 'transfer' && accessKey.permission !== 'FullAccess') throw new Error('A direct transfer requires a full-access disposable key.');
  const tx = createTransaction(options.signerId, publicKey, options.receiverId, nonce, [action], baseDecode(accessKey.block_hash));
  const { signedTransaction, txHash } = await options.signer.signTransaction(tx);
  return {
    signedTransaction,
    attempt: {
      attemptId: crypto.randomUUID(), actionKind: publicAction.kind, signerId: options.signerId, publicKey: publicKey.toString(),
      receiverId: options.receiverId, amountYocto: options.amountYocto, nonce: nonce.toString(), txHash: baseEncode(txHash), signedAt: now(),
      actions: [publicAction], broadcast: null, observations: [], finalOutcome: null, finalBlocks: [],
    },
  };
}

export async function signTransfer(options: SignTransferOptions): Promise<PreparedTransaction> {
  const amount = unsigned(options.amountYocto, 'Transfer amount', true);
  if (options.signerId === options.receiverId) throw new Error('A dedicated recipient distinct from the signer is required.');
  return prepare(options, actions.transfer(amount), { kind: 'transfer', amountYocto: options.amountYocto });
}

export async function signFunctionCall(options: SignFunctionCallOptions): Promise<PreparedTransaction> {
  const deposit = unsigned(options.amountYocto, 'Function-call deposit'), gas = unsigned(options.gas, 'Function-call gas', true);
  if (gas > 300_000_000_000_000n || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(options.methodName)) throw new Error('Function-call method or gas is invalid.');
  const args = sanitizePublicEvidence(options.args);
  return prepare(options, actions.functionCall(options.methodName, new TextEncoder().encode(JSON.stringify(args)), gas, deposit),
    { kind: 'function-call', amountYocto: options.amountYocto, methodName: options.methodName, args, gas: options.gas });
}

export async function broadcastTransaction(client: NearRpcClient, prepared: PreparedTransaction, options: BroadcastOptions = {}): Promise<TransactionAttempt> {
  const attempt = prepared.attempt;
  try {
    // Use the official SDK encoder and provider transport. A per-request capture avoids
    // mixing the two public records when independent worker keys broadcast together.
    await client.sendJsonRpc('send_tx', { signed_tx_base64: Buffer.from(encodeTransaction(prepared.signedTransaction)).toString('base64'), wait_until: 'INCLUDED' },
      { metadata: { tx_hash: attempt.txHash }, discardResponse: options.discardResponse, onEvidence: (record) => { attempt.broadcast = record; } });
  }
  catch (error) { attempt.error = toPublicError(error); }
  return attempt;
}

function retryable(error: PublicError): boolean {
  return error.category === 'timeout' || error.category === 'transport' || /UNKNOWN_TRANSACTION|TIMEOUT_ERROR/.test(error.code ?? '');
}

async function finalBlocks(client: NearRpcClient, attempt: TransactionAttempt): Promise<void> {
  const result = object(attempt.finalOutcome), transaction = object(result?.transaction_outcome);
  const receipts = Array.isArray(result?.receipts_outcome) ? result.receipts_outcome : [];
  const hashes = [...new Set([transaction?.block_hash, ...receipts.map((r) => object(r)?.block_hash)].filter((v): v is string => typeof v === 'string'))];
  for (const hash of hashes) {
    const response = await client.viewBlock({ blockId: hash }), header = response.header;
    if (header.hash !== hash || !Number.isSafeInteger(header.height) || header.height < 0) throw new Error('Finalized outcome block reference is inconsistent.');
    attempt.finalBlocks.push({ hash, height: header.height, finality: 'FINAL', evidence: client.records.at(-1)! });
  }
}

/** Observes only the retained hash. Never broadcasts, rebuilds or signs a retry. */
export async function observeTransactionFinal(client: NearRpcClient, attempt: TransactionAttempt, options: ObservationOptions = {}): Promise<TransactionAttempt> {
  // INCLUDED reports validation rejection before a hash becomes observable. Hash-only
  // FINAL polling cannot recover that error and must not overwrite its raw evidence.
  if (attempt.broadcast?.error?.code === 'INVALID_TRANSACTION') return attempt;
  const { timeoutMs, pollIntervalMs } = timing(options), deadline = Date.now() + timeoutMs;
  const includeReceipts = options.includeReceipts ?? attempt.actionKind === 'function-call';
  const methods: readonly string[] = includeReceipts ? ['EXPERIMENTAL_tx_status', 'tx_status'] : ['tx', 'tx_status', 'EXPERIMENTAL_tx_status'];
  let methodIndex = 0;
  do {
    const start = client.records.length;
    try {
      const result = methodIndex === 0
        ? includeReceipts
          ? await client.viewTransactionStatusWithReceipts({ txHash: attempt.txHash, accountId: attempt.signerId, waitUntil: 'FINAL' })
          : await client.viewTransactionStatus({ txHash: attempt.txHash, accountId: attempt.signerId, waitUntil: 'FINAL' })
        : await client.sendJsonRpc(methods[methodIndex]!, { tx_hash: attempt.txHash, sender_account_id: attempt.signerId, wait_until: 'FINAL' });
      if (object(result)?.final_execution_status === 'FINAL') {
        attempt.finalOutcome = sanitizePublicEvidence(result);
        const receipts = object(result)?.receipts;
        if (includeReceipts && (!Array.isArray(receipts) || receipts.length === 0) && methodIndex < methods.length - 1) { methodIndex++; continue; }
        if (attempt.error?.category !== 'rpc') delete attempt.error;
        attempt.finalBlocks = [];
        try { await finalBlocks(client, attempt); } catch (error) { attempt.error = toPublicError(error, 'evidence'); }
        if (includeReceipts && (!Array.isArray(receipts) || receipts.length === 0)) attempt.error = { category: 'evidence', code: 'MISSING_RECEIPT_BODY',
          message: 'FINAL function-call status omitted downstream receipt bodies; native credit cannot be established.' };
        return attempt;
      }
    } catch (error) {
      const failure = toPublicError(error);
      if (failure.code === '-32601' && methodIndex < methods.length - 1) { methodIndex++; continue; }
      if (!retryable(failure)) { attempt.error = failure; return attempt; }
    } finally {
      attempt.observations.push(...client.records.slice(start).filter((r) => methods.includes(r.method)));
    }
    await pause(Math.min(pollIntervalMs, Math.max(1, deadline - Date.now())));
  } while (Date.now() < deadline);
  attempt.error = { category: 'timeout', message: 'Transaction FINAL observation deadline expired; its outcome remains unknown.', code: 'FINAL_OBSERVATION_TIMEOUT' };
  return attempt;
}

async function finalizedTimestampBlock(client: NearRpcClient, deadlineMs?: number): Promise<FinalizedTimestampBlock> {
  const result = deadlineMs === undefined ? await client.viewBlock({ finality: 'final' })
    : await client.sendJsonRpc('block', { finality: 'final' }, { deadlineMs }), header = result.header;
  if (typeof header.hash !== 'string' || !Number.isSafeInteger(header.height) || header.height < 0) throw new Error('Finalized block query returned incomplete evidence.');
  unsigned(header.timestamp_nanosec, 'Finalized block timestamp');
  if (BigInt(header.timestamp_nanosec) >= (1n << 64n)) throw new Error('Finalized block timestamp is outside u64.');
  const reference = deadlineMs === undefined ? await client.viewBlock({ blockId: header.hash })
    : await client.sendJsonRpc('block', { block_id: header.hash }, { deadlineMs });
  if (reference.header.hash !== header.hash || reference.header.height !== header.height || reference.header.timestamp_nanosec !== header.timestamp_nanosec) throw new Error('Finalized timestamp block reference is inconsistent.');
  return { block: { hash: header.hash, height: header.height, finality: 'FINAL', evidence: client.records.at(-1)! }, timestampNs: header.timestamp_nanosec };
}
export async function queryFinalizedBlock(client: NearRpcClient): Promise<FinalizedTimestampBlock> { return finalizedTimestampBlock(client); }

/** Wait on finalized chain timestamps, never on estimated local-clock expiry. */
export async function waitForFinalizedTimestamp(client: NearRpcClient, timestampNs: string, options: ObservationOptions = {}): Promise<FinalizedTimestampBlock> {
  const target = unsigned(timestampNs, 'Approval expiry'), { timeoutMs, pollIntervalMs } = timing({ ...options, timeoutMs: options.timeoutMs ?? 30_000 });
  if (target >= (1n << 64n) || timeoutMs > 30_000) throw new Error('Fixture expiry waits must be within u64 and bounded to 30 seconds.');
  const deadline = Date.now() + timeoutMs;
  const expired = (): RpcRequestError => new RpcRequestError({ category: 'timeout', code: 'FINALIZED_EXPIRY_TIMEOUT', message: 'Finalized chain timestamps did not reach the approval expiry within the bounded wait.' });
  do {
    try {
      const block = await finalizedTimestampBlock(client, deadline);
      if (Date.now() >= deadline) throw expired();
      if (BigInt(block.timestampNs) >= target) return block;
    } catch (error) { if (Date.now() >= deadline) throw expired(); throw error; }
    const remaining = deadline - Date.now(); if (remaining <= 0) break;
    await pause(Math.min(pollIntervalMs, remaining));
  } while (Date.now() < deadline);
  throw expired();
}

/** Complete raw call_function bytes and the finalized block supporting the decoded view. */
export async function queryFinalizedContractState(client: NearRpcClient, contractId: string, methodName: string, args: JsonValue,
  options: ObservationOptions & { minimumHeight?: number } = {}): Promise<ContractStateSnapshot> {
  namedTestnetAccount(contractId);
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(methodName)) throw new Error('Contract view method is invalid.');
  const publicArgs = sanitizePublicEvidence(args), { timeoutMs, pollIntervalMs } = timing(options), minimumHeight = options.minimumHeight ?? 0;
  if (!Number.isSafeInteger(minimumHeight) || minimumHeight < 0) throw new Error('Minimum final contract-view height must be a safe integer.');
  const deadline = Date.now() + timeoutMs;
  do {
    const result = object(await client.sendJsonRpc('query', { request_type: 'call_function', account_id: contractId, method_name: methodName,
      args_base64: Buffer.from(JSON.stringify(publicArgs)).toString('base64'), finality: 'final' })), evidence = client.records.at(-1)!;
    if (!result || typeof result.block_hash !== 'string' || !Number.isSafeInteger(result.block_height) || !Array.isArray(result.result)
      || !result.result.every((value) => typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 255)) throw new Error('Finalized contract view returned incomplete JSON byte evidence.');
    if ((result.block_height as number) >= minimumHeight) {
      let value: unknown;
      try { value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(new Uint8Array(result.result))); } catch { throw new Error('Finalized contract view did not return valid JSON.'); }
      const block = await client.viewBlock({ blockId: result.block_hash });
      if (block.header.hash !== result.block_hash || block.header.height !== result.block_height) throw new Error('Finalized contract-view block reference is inconsistent.');
      return { contractId, methodName, args: publicArgs, value: sanitizePublicEvidence(value), evidence,
        block: { hash: result.block_hash, height: result.block_height as number, finality: 'FINAL', evidence: client.records.at(-1)! } };
    }
    await pause(Math.min(pollIntervalMs, Math.max(1, deadline - Date.now())));
  } while (Date.now() < deadline);
  throw new RpcRequestError({ category: 'timeout', code: 'CONTRACT_VIEW_FINALITY_TIMEOUT', message: 'Finalized contract view did not reach all receipt blocks before the deadline.' });
}
