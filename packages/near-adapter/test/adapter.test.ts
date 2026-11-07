import assert from 'node:assert/strict';
import test from 'node:test';
import { KeyPair, KeyPairSigner } from 'near-api-js';
import { evaluateTargetEvidence, type JsonObject, type JsonValue } from '../../core/src/index.js';
import { amount, approval, attempt, finalOutcome, hash, publicBlock, publicKey, publicSignature, recipientId, receiptBlockHash, report, rpc, signerId, target, txBlockHash } from '../../core/test/fixtures.js';
import { broadcastTransaction, NearRpcClient, observeTransactionFinal, queryFinalizedBalance, sanitizePublicEvidence, signFunctionCall, signTransfer } from '../src/index.js';

type Request = { method: string; params: JsonObject; id: string };
function client(handler: (request: Request) => unknown | Promise<unknown>, timeoutMs = 500): NearRpcClient {
  const fetchImpl: typeof fetch = async (_url, init) => {
    const request = JSON.parse(String(init?.body)) as Request;
    const value = await handler(request);
    return new Response(JSON.stringify({ jsonrpc: '2.0', id: request.id, ...value as object }));
  };
  return new NearRpcClient({ rpcUrl: 'https://rpc.testnet.near.org', fetchImpl, timeoutMs });
}

function block(request: Request): unknown {
  const blockHash = request.params.block_id;
  return { result: { author: signerId, chunks: [], header: { hash: blockHash, height: blockHash === txBlockHash ? 101 : 102, timestamp_nanosec: '1793611200000000000' } } };
}

test('finalized balance query requests finality and preserves exact public raw balances', async () => {
  const rpc = client((request) => {
    assert.equal(request.method, 'query'); assert.equal(request.params.finality, 'final'); assert.equal(request.params.account_id, recipientId);
    return { result: { amount: '9007199254740993000000001', locked: '0', code_hash: hash, storage_usage: 182, block_hash: receiptBlockHash, block_height: 103 } };
  });
  const snapshot = await queryFinalizedBalance(rpc, recipientId);
  assert.equal(snapshot.amountYocto, '9007199254740993000000001'); assert.equal(snapshot.block.finality, 'FINAL');
  assert.equal((snapshot.evidence.response as JsonObject).jsonrpc, '2.0'); assert.doesNotThrow(() => JSON.stringify(snapshot));
});

test('after balance query waits until its final block covers the transfer receipt', async () => {
  let calls = 0;
  const rpc = client(() => ({ result: { amount, locked: '0', code_hash: hash, storage_usage: 182, block_hash: receiptBlockHash, block_height: ++calls === 1 ? 101 : 103 } }));
  const snapshot = await queryFinalizedBalance(rpc, recipientId, { minimumHeight: 103, pollIntervalMs: 1 });
  assert.equal(snapshot.block.height, 103); assert.equal(rpc.records.length, 2);
});

test('RPC chain ID must be testnet before a signing workflow proceeds', async () => {
  const rpc = client(() => ({ result: { chain_id: 'mainnet', latest_protocol_version: 80, version: { version: '2.14.0' }, sync_info: {} } }));
  await assert.rejects(rpc.verifyTestnet(), /testnet/);
  assert.equal((rpc.records[0]!.response as JsonObject).result !== undefined, true);
});

test('transfer signing retains the SDK transaction hash before any broadcast', async () => {
  let queries = 0;
  const rpc = client((request) => {
    assert.equal(request.method, 'query'); assert.equal(request.params.request_type, 'view_access_key'); assert.equal(request.params.finality, 'final'); queries++;
    return { result: { nonce: 1000, permission: 'FullAccess', block_hash: hash, block_height: 100 } };
  });
  const signer = new KeyPairSigner(KeyPair.fromRandom('ed25519'));
  const prepared = await signTransfer({ client: rpc, signer, signerId, receiverId: recipientId, amountYocto: amount });
  assert.match(prepared.attempt.txHash, /^[1-9A-HJ-NP-Za-km-z]{43,44}$/);
  assert.equal(prepared.attempt.nonce, '1001'); assert.equal(prepared.attempt.broadcast, null); assert.equal(queries, 1);
  assert.equal(prepared.signedTransaction.transaction.signerId, signerId);
  assert.equal(prepared.signedTransaction.transaction.receiverId, recipientId);
  assert.equal(prepared.attempt.publicKey, (await signer.getPublicKey()).toString());
});

test('INCLUDED broadcast response keeps the local hash and omits signed bytes from report parameters', async () => {
  const rpc = client((request) => {
    if (request.method === 'query') return { result: { nonce: 1000, permission: 'FullAccess', block_hash: hash, block_height: 100 } };
    assert.equal(request.method, 'send_tx'); assert.equal(request.params.wait_until, 'INCLUDED'); assert.equal(typeof request.params.signed_tx_base64, 'string');
    return { result: { final_execution_status: 'INCLUDED' } };
  });
  const prepared = await signTransfer({ client: rpc, signer: new KeyPairSigner(KeyPair.fromRandom('ed25519')), signerId, receiverId: recipientId, amountYocto: amount });
  const localHash = prepared.attempt.txHash;
  const result = await broadcastTransaction(rpc, prepared);
  assert.equal(result.txHash, localHash); assert.equal(result.finalOutcome, null);
  assert.equal((result.broadcast!.params as JsonObject).signed_tx_base64, undefined);
  assert.equal(((result.broadcast!.response as JsonObject).result as JsonObject).final_execution_status, 'INCLUDED');
});

test('INCLUDED NotEnoughAllowance rejection retains the exact raw error and never polls or rebroadcasts', async () => {
  const rejection = { code: -32000, message: 'Server error', data: { TxExecutionError: { InvalidTxError: { InvalidAccessKeyError: { NotEnoughAllowance: {
    account_id: signerId, public_key: publicKey, allowance: '50000000000000000000000', cost: '100920000147491000000000',
  } } } } }, cause: { name: 'INVALID_TRANSACTION', info: { InvalidAccessKeyError: { NotEnoughAllowance: {
    account_id: signerId, public_key: publicKey, allowance: '50000000000000000000000', cost: '100920000147491000000000',
  } } } } };
  let broadcasts = 0, statuses = 0;
  const rpc = client((request) => {
    if (request.method === 'query') return { result: { nonce: 1000, permission: 'FullAccess', block_hash: hash, block_height: 100 } };
    if (request.method === 'send_tx') { broadcasts++; assert.equal(request.params.wait_until, 'INCLUDED'); return { error: rejection }; }
    statuses++; return { error: { code: -32000, cause: { name: 'UNKNOWN_TRANSACTION' }, message: 'Unobserved rejected transaction.' } };
  });
  const prepared = await signFunctionCall({ client: rpc, signer: new KeyPairSigner(KeyPair.fromRandom('ed25519')), signerId, receiverId: 'disposable-fixture.testnet',
    amountYocto: '0', gas: '100000000000000', methodName: 'pay', args: { invoice_id: 'unapproved-public-probe' } });
  const localHash = prepared.attempt.txHash;
  await broadcastTransaction(rpc, prepared);
  await observeTransactionFinal(rpc, prepared.attempt, { timeoutMs: 10, pollIntervalMs: 1 });
  assert.equal(prepared.attempt.txHash, localHash); assert.equal(prepared.attempt.error?.code, 'INVALID_TRANSACTION');
  assert.deepEqual((prepared.attempt.broadcast!.response as JsonObject).error, rejection);
  assert.equal(prepared.attempt.broadcast!.error?.code, 'INVALID_TRANSACTION');
  assert.equal(prepared.attempt.finalOutcome, null); assert.deepEqual(prepared.attempt.observations, []);
  assert.equal(broadcasts, 1); assert.equal(statuses, 0);
});

test('FINAL observation polls beyond optimistic success and collects every finalized outcome block', async () => {
  let observations = 0;
  const rpc = client((request) => {
    if (request.method === 'block') return block(request);
    assert.equal(request.params.wait_until, 'FINAL'); assert.equal(request.params.tx_hash, hash); assert.equal(request.params.sender_account_id, signerId);
    const result = finalOutcome(); if (++observations === 1) result.final_execution_status = 'EXECUTED_OPTIMISTIC';
    return { result };
  });
  const pending = attempt(); pending.finalOutcome = null; pending.finalBlocks = []; pending.observations = [];
  await observeTransactionFinal(rpc, pending, { pollIntervalMs: 1 });
  assert.equal((pending.finalOutcome as unknown as JsonObject).final_execution_status, 'FINAL'); assert.equal(pending.observations.length, 2);
  assert.deepEqual(pending.finalBlocks.map((b) => b.height), [101, 102]);
  assert.equal(pending.finalBlocks[1]!.evidence!.method, 'block');
});

test('unsupported tx RPC uses tx_status fallback without broadcasting again', async () => {
  const rpc = client((request) => {
    if (request.method === 'block') return block(request);
    if (request.method === 'tx') return { error: { code: -32601, message: 'Method not found' } };
    assert.equal(request.method, 'tx_status'); assert.equal(request.params.wait_until, 'FINAL'); return { result: finalOutcome() };
  });
  const pending = attempt(); pending.finalOutcome = null; pending.finalBlocks = []; pending.observations = [];
  await observeTransactionFinal(rpc, pending, { pollIntervalMs: 1 });
  assert.equal((pending.finalOutcome as unknown as JsonObject).final_execution_status, 'FINAL');
  assert.deepEqual(pending.observations.map((r) => r.method), ['tx', 'tx_status']);
  assert.equal(pending.observations[0]!.error!.category, 'rpc');
});

test('missing receipt outcomes remain inconclusive after a bare FINAL status', async () => {
  const rpc = client(() => ({ result: { final_execution_status: 'FINAL', status: { SuccessValue: '' } } }));
  const evidence = target(); const pending = evidence.attempts[0]!; pending.finalOutcome = null; pending.finalBlocks = []; pending.observations = [];
  await observeTransactionFinal(rpc, pending, { pollIntervalMs: 1 });
  assert.equal(evaluateTargetEvidence(evidence, approval()).status, 'INCONCLUSIVE');
  assert.equal((pending.finalOutcome as unknown as JsonObject).final_execution_status, 'FINAL');
});

test('a hanging transport is aborted with bounded timeout and preserves its public failure', async () => {
  const fetchImpl: typeof fetch = async (_url, init) => new Promise<Response>((_resolve, reject) => {
    init?.signal?.addEventListener('abort', () => reject(init.signal!.reason), { once: true });
  });
  const rpc = new NearRpcClient({ rpcUrl: 'https://rpc.testnet.near.org', timeoutMs: 20, fetchImpl });
  await assert.rejects(rpc.sendJsonRpc('status', []), /timed out/i);
  assert.equal(rpc.records[0]!.response, null); assert.equal(rpc.records[0]!.error!.category, 'timeout');
});

test('sanitization removes keys but preserves public signer identities and RPC outcomes', () => {
  const secret = `ed25519:${'2'.repeat(87)}`;
  const result = sanitizePublicEvidence({ private_key: secret, nested: { message: `bad key ${secret}`, public_key: publicKey }, balance: 100n }, [secret]) as JsonObject;
  assert.equal(result.private_key, undefined); assert.equal((result.nested as JsonObject).public_key, publicKey);
  assert.equal((result.nested as JsonObject).message, 'bad key [REDACTED]'); assert.equal(result.balance, '100');
  assert.equal(JSON.stringify(result).includes(secret), false);
});

test('function-call signing keeps exact deposit, arguments and gas in public evidence', async () => {
  const rpc = client(() => ({ result: { nonce: 1000, permission: 'FullAccess', block_hash: hash, block_height: 100 } }));
  const prepared = await signFunctionCall({ client: rpc, signer: new KeyPairSigner(KeyPair.fromRandom('ed25519')), signerId, receiverId: 'disposable-fixture.testnet', amountYocto: '1', gas: '30000000000000', methodName: 'pay', args: { invoice_id: 'public-invoice', amount_yocto: amount } });
  assert.equal(prepared.attempt.actionKind, 'function-call'); assert.equal(prepared.attempt.amountYocto, '1');
  assert.deepEqual(prepared.attempt.actions[0]!.args, { invoice_id: 'public-invoice', amount_yocto: amount });
  assert.equal(prepared.attempt.actions[0]!.gas, '30000000000000'); assert.match(prepared.attempt.txHash, /^[1-9A-HJ-NP-Za-km-z]{43,44}$/);
});

test('a generic extension signature field cannot preserve a fresh private key', () => {
  const secret = KeyPair.fromRandom('ed25519').toString();
  const result = sanitizePublicEvidence({ extension: { signature: secret }, signature: secret }) as JsonObject;
  assert.equal(JSON.stringify(result).includes(secret), false);
  assert.equal((result.extension as JsonObject).signature === '[REDACTED]', true);
  assert.equal(result.signature === '[REDACTED]', true);
});

test('actual transaction signatures survive raw RPC and full report sanitization', () => {
  const signature = `ed25519:${'4'.repeat(87)}`, outcome = finalOutcome();
  (outcome.transaction as JsonObject).signature = signature;
  const envelope = { jsonrpc: '2.0', id: 'public-fixture', result: outcome };
  assert.equal(((sanitizePublicEvidence(outcome) as JsonObject).transaction as JsonObject).signature, signature);
  const response = sanitizePublicEvidence(envelope) as JsonObject;
  assert.equal(((response.result as JsonObject).transaction as JsonObject).signature, signature);
  const data = report(); (data.scenarios[0]!.targets[0]!.attempts[0]!.finalOutcome as JsonObject).transaction = outcome.transaction!;
  const sanitized = sanitizePublicEvidence(data) as JsonObject;
  const scenarios = sanitized.scenarios as JsonObject[], targets = scenarios[0]!.targets as JsonObject[], attempts = targets[0]!.attempts as JsonObject[];
  assert.equal(((attempts[0]!.finalOutcome as JsonObject).transaction as JsonObject).signature, signature);
});

test('explicit known-secret redaction applies even to a public transaction signature slot', () => {
  const secret = KeyPair.fromRandom('ed25519').toString(), outcome = finalOutcome();
  (outcome.transaction as JsonObject).signature = secret;
  const result = sanitizePublicEvidence(outcome, [secret]) as JsonObject;
  assert.equal(JSON.stringify(result).includes(secret), false);
  assert.equal((result.transaction as JsonObject).signature === '[REDACTED]', true);
  const block = publicBlock(); (block.header as JsonObject).signature = secret;
  (block.header as JsonObject).approvals = [secret]; (block.chunks as JsonObject[])[0]!.signature = secret;
  assert.equal(JSON.stringify(sanitizePublicEvidence(block, [secret])).includes(secret), false);
});

test('public block header, chunk and approval signatures survive result, envelope and report sanitization', () => {
  const block = publicBlock(txBlockHash, 101);
  const check = (result: JsonObject): void => {
    assert.equal((result.header as JsonObject).signature, publicSignature);
    assert.equal(((result.header as JsonObject).approvals as JsonValue[])[1], publicSignature);
    assert.equal((result.chunks as JsonObject[])[0]!.signature, publicSignature);
  };
  check(sanitizePublicEvidence(block) as JsonObject);
  const envelope = sanitizePublicEvidence({ jsonrpc: '2.0', id: 'public-block', result: block }) as JsonObject;
  check(envelope.result as JsonObject);
  const data = report(), evidence = rpc('block', { block_id: txBlockHash }, block);
  data.scenarios[0]!.targets[0]!.attempts[0]!.finalBlocks[0]!.evidence = evidence; data.rpcEvidence.push(evidence);
  const sanitized = sanitizePublicEvidence(data) as JsonObject, records = sanitized.rpcEvidence as JsonObject[];
  check((records[0]!.response as JsonObject).result as JsonObject);
});
