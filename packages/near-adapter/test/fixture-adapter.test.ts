import assert from 'node:assert/strict';
import test from 'node:test';
import { KeyPair, KeyPairSigner } from 'near-api-js';
import type { ContractStateSnapshot, JsonObject, TransactionAttempt } from '../../core/src/index.js';
import { fixtureCall } from '../../core/test/contract-fixtures.js';
import { finalOutcome, hash, recipientId, signerId } from '../../core/test/fixtures.js';
import * as adapter from '../src/index.js';

type Request = { method: string; params: JsonObject; id: string };
function client(handler: (request: Request) => unknown | Promise<unknown>): adapter.NearRpcClient {
  return new adapter.NearRpcClient({ rpcUrl: 'https://rpc.testnet.near.org', timeoutMs: 100,
    fetchImpl: async (_url, init) => { const request = JSON.parse(String(init?.body)) as Request; return new Response(JSON.stringify({ jsonrpc: '2.0', id: request.id, ...await handler(request) as object })); } });
}
const blockResponse = (request: Request) => ({ result: { author: signerId, chunks: [], header: { hash: request.params.block_id, height: 104, timestamp_nanosec: '1793620803000000000' } } });
const pending = () => { const attempt = fixtureCall({ invoice: 'public-adapter-invoice' }); attempt.finalOutcome = null; attempt.observations = []; attempt.finalBlocks = []; return attempt; };
type NewAdapter = {
  broadcastTransaction: (client: adapter.NearRpcClient, prepared: adapter.PreparedTransaction, options?: { discardResponse?: boolean }) => Promise<TransactionAttempt>;
  queryFinalizedContractState: (client: adapter.NearRpcClient, contractId: string, methodName: string, args: JsonObject, options?: { minimumHeight?: number; pollIntervalMs?: number; timeoutMs?: number }) => Promise<ContractStateSnapshot>;
  waitForFinalizedTimestamp: (client: adapter.NearRpcClient, timestampNs: string, options?: { pollIntervalMs?: number; timeoutMs?: number }) => Promise<{ timestampNs: string }>;
};
const api = adapter as unknown as NewAdapter;

test('an explicit per-key nonce floor produces one fresh signature despite a lagging finalized access-key query', async () => {
  const rpc = client(() => ({ result: { nonce: 1000, permission: 'FullAccess', block_hash: hash, block_height: 100 } }));
  const sign = adapter.signFunctionCall as (options: adapter.SignFunctionCallOptions & { nonceFloor: string }) => Promise<adapter.PreparedTransaction>;
  const prepared = await sign({ client: rpc, signer: new KeyPairSigner(KeyPair.fromRandom('ed25519')), signerId, receiverId: 'fixture.testnet', amountYocto: '0',
    methodName: 'pay', args: { invoice_id: 'same-obligation', recipient: recipientId, amount_yocto: '1000000000000000000000' }, gas: '100000000000000', nonceFloor: '1005' });
  assert.equal(prepared.attempt.nonce, '1006'); assert.equal(prepared.signedTransaction.transaction.nonce, 1006n); assert.equal(prepared.attempt.broadcast, null);
  assert.equal(rpc.records.filter((record) => record.method === 'query').length, 1);
});

test('function-call FINAL observation requests full receipt bodies from the official SDK receipt-status method', async () => {
  const rpc = client((request) => {
    if (request.method === 'block') return blockResponse(request);
    if (request.method === 'tx') return { result: { ...fixtureCall({ invoice: 'public-adapter-invoice' }).finalOutcome as object, receipts: undefined } };
    assert.equal(request.method, 'EXPERIMENTAL_tx_status'); assert.equal(request.params.wait_until, 'FINAL');
    return { result: fixtureCall({ invoice: 'public-adapter-invoice' }).finalOutcome };
  });
  const attempt = pending(); await adapter.observeTransactionFinal(rpc, attempt, { pollIntervalMs: 1, timeoutMs: 200 });
  assert.ok(Array.isArray((attempt.finalOutcome as JsonObject).receipts));
  assert.equal(attempt.observations[0]!.method, 'EXPERIMENTAL_tx_status'); assert.equal(attempt.error, undefined);
});
test('unsupported full-receipt status falls back without re-signing or rebroadcasting', async () => {
  const rpc = client((request) => {
    if (request.method === 'block') return blockResponse(request);
    if (request.method === 'EXPERIMENTAL_tx_status') return { error: { code: -32601, message: 'Method not found' } };
    assert.equal(request.method, 'tx_status'); return { result: fixtureCall({ invoice: 'public-adapter-invoice' }).finalOutcome };
  });
  const attempt = pending(); await adapter.observeTransactionFinal(rpc, attempt, { pollIntervalMs: 1, timeoutMs: 200 });
  assert.deepEqual(attempt.observations.map((record) => record.method), ['EXPERIMENTAL_tx_status', 'tx_status']);
  assert.ok(Array.isArray((attempt.finalOutcome as JsonObject).receipts)); assert.equal(attempt.error, undefined);
});
test('a bare FINAL function-call status retains raw evidence but reports missing receipt bodies', async () => {
  const rpc = client((request) => {
    if (request.method === 'block') return blockResponse(request);
    const result = fixtureCall({ invoice: 'public-adapter-invoice' }).finalOutcome as JsonObject; delete result.receipts; return { result };
  });
  const attempt = pending(); await adapter.observeTransactionFinal(rpc, attempt, { pollIntervalMs: 1, timeoutMs: 200 });
  assert.equal((attempt.finalOutcome as JsonObject).final_execution_status, 'FINAL'); assert.equal(attempt.error?.code, 'MISSING_RECEIPT_BODY');
  assert.ok(attempt.observations.length > 0);
});
test('complete FINAL failed pay attempts preserve their actual contract failure receipt', async () => {
  const outcome = fixtureCall({ invoice: 'public-adapter-invoice', failure: 'canonical recipient required' }).finalOutcome;
  const rpc = client((request) => request.method === 'block' ? blockResponse(request) : ({ result: outcome }));
  const attempt = pending(); await adapter.observeTransactionFinal(rpc, attempt, { pollIntervalMs: 1, timeoutMs: 200 });
  assert.ok((attempt.finalOutcome as JsonObject).status); assert.ok(Array.isArray((attempt.finalOutcome as JsonObject).receipts)); assert.equal(attempt.error, undefined);
});
test('constructed response loss discards the real send response while retaining the signed hash for FINAL recovery', async () => {
  let prepared: adapter.PreparedTransaction;
  const rpc = client((request) => {
    if (request.method === 'query') return { result: { nonce: 1000, permission: 'FullAccess', block_hash: hash, block_height: 100 } };
    if (request.method === 'send_tx') return { result: { final_execution_status: 'NONE' } };
    if (request.method === 'block') return blockResponse(request);
    const outcome = finalOutcome(prepared.attempt.txHash); (outcome.transaction as JsonObject).public_key = prepared.attempt.publicKey;
    return { result: outcome };
  });
  prepared = await adapter.signTransfer({ client: rpc, signer: new KeyPairSigner(KeyPair.fromRandom('ed25519')), signerId, receiverId: recipientId, amountYocto: '1000000000000000000000' });
  const signedHash = prepared.attempt.txHash;
  await api.broadcastTransaction(rpc, prepared, { discardResponse: true });
  assert.equal(prepared.attempt.broadcast!.response, null); assert.equal(prepared.attempt.broadcast!.error!.code, 'INJECTED_RESPONSE_DISCARD');
  assert.equal(prepared.attempt.txHash, signedHash); assert.equal((prepared.attempt.broadcast!.params as JsonObject).signed_tx_base64, undefined);
  await adapter.observeTransactionFinal(rpc, prepared.attempt, { pollIntervalMs: 1, timeoutMs: 200 });
  assert.equal(prepared.attempt.error, undefined); assert.equal(prepared.attempt.txHash, signedHash);
});
test('concurrent independent-key broadcasts retain the RPC record belonging to each signed transaction', async () => {
  const rpc = client(async (request) => {
    if (request.method === 'query') return { result: { nonce: 1000, permission: 'FullAccess', block_hash: hash, block_height: 100 } };
    assert.equal(request.method, 'send_tx'); if (request.id.endsWith('3')) await new Promise((resolve) => setTimeout(resolve, 5));
    return { result: { request_marker: request.id, final_execution_status: 'NONE' } };
  });
  const prepared = await Promise.all([1, 2].map((invoice) => adapter.signFunctionCall({ client: rpc, signer: new KeyPairSigner(KeyPair.fromRandom('ed25519')), signerId,
    receiverId: 'fixture.testnet', amountYocto: '0', gas: '100000000000000', methodName: 'pay', args: { invoice_id: `invoice-${invoice}`, recipient: recipientId, amount_yocto: '1000000000000000000000' } })));
  await Promise.all(prepared.map((item) => api.broadcastTransaction(rpc, item)));
  for (const item of prepared) assert.equal((item.attempt.broadcast!.params as JsonObject).tx_hash, item.attempt.txHash);
  assert.notEqual(prepared[0]!.attempt.broadcast, prepared[1]!.attempt.broadcast);
});
test('finalized contract views decode exact JSON bytes and wait until the required receipt block', async () => {
  let queries = 0;
  const value = { invoice_id: 'public-invoice', amount_yocto: '9007199254740993000000001', status: 'Paid' };
  const rpc = client((request) => {
    if (request.method === 'block') return { result: { author: signerId, chunks: [], header: { hash: request.params.block_id, height: 102, timestamp_nanosec: '1793620803000000000' } } };
    assert.equal(request.method, 'query'); assert.equal(request.params.finality, 'final'); assert.equal(request.params.request_type, 'call_function');
    assert.deepEqual(JSON.parse(Buffer.from(String(request.params.args_base64), 'base64').toString()), { invoice_id: 'public-invoice' });
    return { result: { result: [...new TextEncoder().encode(JSON.stringify(value))], logs: [], block_hash: hash, block_height: ++queries === 1 ? 100 : 102 } };
  });
  let result: ContractStateSnapshot | undefined;
  await assert.doesNotReject(async () => { result = await api.queryFinalizedContractState(rpc, 'fixture.testnet', 'get_approval', { invoice_id: 'public-invoice' }, { minimumHeight: 102, pollIntervalMs: 1 }); });
  assert.equal(result!.block.height, 102); assert.deepEqual(result!.value, value); assert.equal(result!.block.evidence!.method, 'block');
});
test('finalized expiry waits compare nanosecond strings exactly at a one-nanosecond boundary', async () => {
  const expiry = '1793620800000000001'; let blocks = 0, current = '1793620800000000000';
  const rpc = client((request) => {
    assert.equal(request.method, 'block');
    if (request.params.finality === 'final') current = ++blocks === 1 ? '1793620800000000000' : expiry;
    return { result: { author: signerId, chunks: [], header: { hash, height: 102, timestamp_nanosec: current } } };
  });
  let result: { timestampNs: string } | undefined;
  await assert.doesNotReject(async () => { result = await api.waitForFinalizedTimestamp(rpc, expiry, { pollIntervalMs: 1, timeoutMs: 100 }); });
  assert.equal(result!.timestampNs, expiry); assert.equal(blocks, 2);
});

test('a 10 ms expiry deadline aborts the first of two injected 40 ms block responses and rejects late success', async (t) => {
  const expiry = '1793620800000000001'; let requests = 0, finished = false, signal: AbortSignal | undefined;
  const rpc = new adapter.NearRpcClient({ rpcUrl: 'https://rpc.testnet.near.org', timeoutMs: 100, fetchImpl: async (_url, init) => {
    requests++; signal = init?.signal as AbortSignal;
    const request = JSON.parse(String(init?.body)) as Request;
    await new Promise((resolve) => setTimeout(resolve, 40)); finished = true;
    return new Response(JSON.stringify({ jsonrpc: '2.0', id: request.id, result: { author: signerId, chunks: [], header: { hash, height: 102, timestamp_nanosec: expiry } } }));
  } });
  const started = performance.now();
  await assert.rejects(api.waitForFinalizedTimestamp(rpc, expiry, { timeoutMs: 10, pollIntervalMs: 1 }), (error: unknown) =>
    error instanceof adapter.RpcRequestError && error.publicError.code === 'FINALIZED_EXPIRY_TIMEOUT');
  t.diagnostic(`Expiry deadline 10 ms, delayed responses 40 ms each; rejected after ${Math.round(performance.now() - started)} ms.`);
  assert.equal(requests, 1); assert.equal(finished, false); assert.equal(signal?.aborted, true);
  assert.equal(rpc.records.length, 1); assert.equal(rpc.records[0]!.response, null); assert.equal(rpc.records[0]!.error?.category, 'timeout');
});

test('the historical block verification uses the remaining shared expiry deadline', async () => {
  const expiry = '1793620800000000001'; let requests = 0, verified = false, signal: AbortSignal | undefined;
  const rpc = new adapter.NearRpcClient({ rpcUrl: 'https://rpc.testnet.near.org', timeoutMs: 100, fetchImpl: async (_url, init) => {
    const request = JSON.parse(String(init?.body)) as Request; requests++;
    if (request.params.block_id) { signal = init?.signal as AbortSignal; await new Promise((resolve) => setTimeout(resolve, 40)); verified = true; }
    return new Response(JSON.stringify({ jsonrpc: '2.0', id: request.id, result: { author: signerId, chunks: [], header: { hash, height: 102, timestamp_nanosec: expiry } } }));
  } });
  await assert.rejects(api.waitForFinalizedTimestamp(rpc, expiry, { timeoutMs: 10, pollIntervalMs: 1 }), (error: unknown) =>
    error instanceof adapter.RpcRequestError && error.publicError.code === 'FINALIZED_EXPIRY_TIMEOUT');
  assert.equal(requests, 2); assert.equal(verified, false); assert.equal(signal?.aborted, true);
  assert.equal(rpc.records.length, 2); assert.equal(rpc.records[1]!.response, null); assert.equal(rpc.records[1]!.error?.category, 'timeout');
});
