import assert from 'node:assert/strict';
import test from 'node:test';
import type { JsonObject, JsonValue } from '../../core/src/index.js';
import { NearRpcClient, RpcRequestError } from '../src/index.js';

// Exact public controller capture replayed with injected fetch; no live request.
const capturedParams: JsonObject = { request_type: 'view_access_key', account_id: 'nrl-owner-45d5eb65.testnet',
  public_key: 'ed25519:Higv35iHJ5MtsrHjuyebb19pjNh3KmVJjNZhoomjX8yN', finality: 'final' };
const capturedResult: JsonObject = { block_hash: '8TwMNmRycMx4vFU7vfs7PWCggzQZHGzcVECz8tmEU8Qk', block_height: 275875794,
  error: 'access key ed25519:Higv35iHJ5MtsrHjuyebb19pjNh3KmVJjNZhoomjX8yN does not exist while viewing', logs: [] };
function replay(result: JsonValue, status = 200): NearRpcClient {
  return new NearRpcClient({ rpcUrl: 'https://rpc.testnet.near.org', timeoutMs: 100, fetchImpl: async (_url, init) => {
    const request = JSON.parse(String(init?.body)) as { id: string; method: string };
    assert.equal(request.method, 'query');
    return new Response(JSON.stringify({ jsonrpc: '2.0', id: request.id, result }), { status });
  } });
}
const publicFailure = (code: string) => (error: unknown): boolean => error instanceof RpcRequestError && error.publicError.category === 'rpc' && error.publicError.code === code;

test('the captured legacy missing-key result rejects as UNKNOWN_ACCESS_KEY and retains its complete public envelope', async () => {
  const rpc = replay(capturedResult);
  await assert.rejects(rpc.sendJsonRpc('query', capturedParams), publicFailure('UNKNOWN_ACCESS_KEY'));
  assert.deepEqual(rpc.records[0]!.response, { jsonrpc: '2.0', id: 'near-replay-1', result: capturedResult });
  assert.equal(rpc.records[0]!.error!.code, 'UNKNOWN_ACCESS_KEY');
});

test('structured UNKNOWN_ACCESS_KEY remains a typed RPC failure with raw block information', async () => {
  const response = { jsonrpc: '2.0', id: 'near-replay-1', error: { name: 'HANDLER_ERROR', cause: { name: 'UNKNOWN_ACCESS_KEY',
    info: { public_key: capturedParams.public_key!, block_hash: capturedResult.block_hash!, block_height: capturedResult.block_height! } }, message: 'Server error' } };
  const rpc = new NearRpcClient({ rpcUrl: 'https://rpc.testnet.near.org', fetchImpl: async () => new Response(JSON.stringify(response)) });
  await assert.rejects(rpc.sendJsonRpc('query', capturedParams), publicFailure('UNKNOWN_ACCESS_KEY'));
  assert.deepEqual(rpc.records[0]!.response, response);
});

const unrelatedErrors: { name: string; result: JsonObject; params?: JsonObject }[] = [
  { name: 'permission error', result: { ...capturedResult, error: 'Access key is not authorized to view this account.' } },
  { name: 'empty error', result: { ...capturedResult, error: '' } },
  { name: 'missing account', result: { ...capturedResult, error: 'account nrl-owner-45d5eb65.testnet does not exist while viewing' } },
  { name: 'another public key', result: { ...capturedResult, error: 'access key ed25519:11111111111111111111111111111111 does not exist while viewing' } },
  { name: 'a suffix after the missing-key phrase', result: { ...capturedResult, error: `${String(capturedResult.error)}; permission denied` } },
  { name: 'a different query type', result: capturedResult, params: { ...capturedParams, request_type: 'view_account' } },
  { name: 'missing block facts', result: { error: capturedResult.error!, logs: [] } },
  { name: 'unsafe block height', result: { ...capturedResult, block_height: Number.MAX_SAFE_INTEGER + 1 } },
  { name: 'a null error', result: { ...capturedResult, error: null } },
  { name: 'an object error', result: { ...capturedResult, error: { message: 'not a legacy string error' } } },
];
for (const value of unrelatedErrors) test(`legacy ${value.name} cannot authorize setup key creation`, async () => {
  const rpc = replay(value.result);
  await assert.rejects(rpc.sendJsonRpc('query', value.params ?? capturedParams), publicFailure('LEGACY_QUERY_ERROR'));
  assert.deepEqual((rpc.records[0]!.response as JsonObject).result, value.result);
});

test('successful query values and application JSON containing error remain successful transport results', async () => {
  const successful: JsonValue[] = [null, { nonce: 1000, permission: 'FullAccess', block_hash: capturedResult.block_hash!, block_height: 275875794 },
    { result: [...new TextEncoder().encode(JSON.stringify({ error: 'business value' }))], logs: [], block_hash: capturedResult.block_hash!, block_height: 275875794 }];
  for (const result of successful) {
    const rpc = replay(result); assert.deepEqual(await rpc.sendJsonRpc('query', capturedParams), result); assert.equal(rpc.records[0]!.error, undefined);
  }
});

test('an HTTP failure cannot be normalized into permission to create a missing key', async () => {
  const rpc = replay(capturedResult, 503);
  await assert.rejects(rpc.sendJsonRpc('query', capturedParams), (error: unknown) => error instanceof RpcRequestError
    && error.publicError.category === 'transport' && error.publicError.code === 'HTTP_503');
});
