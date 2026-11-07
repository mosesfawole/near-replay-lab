import assert from 'node:assert/strict';
import test from 'node:test';
import { KeyPair } from 'near-api-js';
import { validateRunReport, type JsonObject, type RunReport } from '../../core/src/index.js';
import { afterBlockHash, amount, finalOutcome, hash, publicBlock, publicSignature, recipientId, receiptBlockHash, signerId, txBlockHash } from '../../core/test/fixtures.js';
import { NearRpcClient } from '../../near-adapter/src/index.js';
import { loadTransferConfig } from '../src/config.js';
import { runTransfer } from '../src/run-transfer.js';

function env(): Record<string, string> {
  return { NEAR_TESTNET_ACCOUNT_ID: signerId, NEAR_TESTNET_PRIVATE_KEY: KeyPair.fromRandom('ed25519').toString(), NEAR_TESTNET_RECIPIENT_ID: recipientId };
}

test('configuration validates required values locally with exact small defaults', () => {
  const config = loadTransferConfig(env());
  assert.equal(config.rpcUrl, 'https://test.rpc.fastnear.com'); assert.equal(config.amountYocto, '1000000000000000000000');
  assert.equal(config.signerId, signerId); assert.equal(config.recipientId, recipientId); assert.match(config.reportPath, /\.json$/);
});

test('missing keys and recipients are rejected without printing key values', () => {
  const values = env(), key = values.NEAR_TESTNET_PRIVATE_KEY!; delete values.NEAR_TESTNET_RECIPIENT_ID;
  assert.throws(() => loadTransferConfig(values), (error: unknown) => error instanceof Error && /NEAR_TESTNET_RECIPIENT_ID/.test(error.message) && !error.message.includes(key));
});

test('non-testnet account, RPC URL and network configuration are rejected before side effects', () => {
  for (const change of [{ NEAR_TESTNET_ACCOUNT_ID: 'user.near' }, { NEAR_RPC_URL: 'https://rpc.mainnet.near.org' }, { NEAR_NETWORK_ID: 'mainnet' }]) {
    assert.throws(() => loadTransferConfig({ ...env(), ...change }), /testnet/i);
  }
});

test('transfer amount never accepts decimals, exponential notation or zero', () => {
  for (const value of ['1.5', '1e21', '0', '-1', '01']) assert.throws(() => loadTransferConfig({ ...env(), NEAR_AMOUNT_YOCTO: value }), /NEAR_AMOUNT_YOCTO/);
});

test('network failure still produces a valid public INCONCLUSIVE report', async () => {
  const values = env(), config = loadTransferConfig(values), checkpoints: RunReport[] = [];
  const fetchImpl: typeof fetch = async () => { throw new Error('Network unavailable.'); };
  const rpc = new NearRpcClient({ rpcUrl: config.rpcUrl, timeoutMs: 25, fetchImpl });
  const report = await runTransfer(config, { client: rpc, provenance: { mode: 'synthetic', description: 'Offline network-failure fixture.' }, checkpoint: async (r) => { checkpoints.push(structuredClone(r)); } });
  assert.equal(report.scenarios[0]!.targets[0]!.verdict.status, 'INCONCLUSIVE');
  assert.equal(report.rpcEvidence[0]!.error!.category, 'transport'); assert.equal(validateRunReport(report).valid, true);
  assert.ok(checkpoints.length > 0); assert.equal(JSON.stringify(report).includes(values.NEAR_TESTNET_PRIVATE_KEY!), false);
});

test('signed transaction hash is checkpointed before the runner broadcasts', async () => {
  const config = loadTransferConfig(env()); let checkpointedHash: string | undefined, observedBroadcast = false;
  const fetchImpl: typeof fetch = async (_url, init) => {
    const request = JSON.parse(String(init?.body)) as { method: string; params: JsonObject; id: string };
    let result: unknown;
    if (request.method === 'status') result = { chain_id: 'testnet', version: { version: '2.14.0' }, sync_info: {} };
    else if (request.method === 'query' && request.params.request_type === 'view_account') result = { amount: '1000000000000000000000000', locked: '0', code_hash: hash, storage_usage: 182, block_hash: receiptBlockHash, block_height: 100 };
    else if (request.method === 'query') result = { nonce: 1000, permission: 'FullAccess', block_hash: hash, block_height: 100 };
    else if (request.method === 'send_tx') { assert.ok(checkpointedHash); observedBroadcast = true; return new Response(JSON.stringify({ jsonrpc: '2.0', id: request.id, error: { code: -32000, cause: { name: 'InvalidNonce' }, message: 'Invalid nonce.' } })); }
    else return new Response(JSON.stringify({ jsonrpc: '2.0', id: request.id, error: { code: -32000, cause: { name: 'InvalidNonce' }, message: 'Unknown transaction.' } }));
    return new Response(JSON.stringify({ jsonrpc: '2.0', id: request.id, result }));
  };
  const rpc = new NearRpcClient({ rpcUrl: config.rpcUrl, timeoutMs: 100, fetchImpl });
  const report = await runTransfer(config, { client: rpc, provenance: { mode: 'synthetic', description: 'Offline nonce-failure fixture.' }, checkpoint: async (r) => { const attempt = r.scenarios[0]!.targets[0]!.attempts[0]; if (attempt && !attempt.broadcast) checkpointedHash = attempt.txHash; } });
  assert.equal(observedBroadcast, true); assert.equal(report.scenarios[0]!.targets[0]!.attempts[0]!.txHash, checkpointedHash);
  assert.equal(report.scenarios[0]!.targets[0]!.verdict.status, 'INCONCLUSIVE'); assert.equal(validateRunReport(report).valid, true);
  assert.equal(report.scenarios[0]!.approval.amountYocto, amount);
});

test('complete FINAL transfer capture yields HOLDS and preserves public signatures without keys', async () => {
  const config = loadTransferConfig(env()); let signedHash: string | undefined, signedPublicKey: string | undefined, balanceQueries = 0;
  const fetchImpl: typeof fetch = async (_url, init) => {
    const request = JSON.parse(String(init?.body)) as { method: string; params: JsonObject; id: string };
    let result: unknown;
    if (request.method === 'status') result = { chain_id: 'testnet', version: { version: '2.14.0' }, sync_info: {} };
    else if (request.method === 'query' && request.params.request_type === 'view_account') result = {
      amount: ++balanceQueries === 1 ? '1000000000000000000000000' : '1001000000000000000000000', locked: '0', code_hash: hash, storage_usage: 182,
      block_hash: balanceQueries === 1 ? hash : afterBlockHash, block_height: balanceQueries === 1 ? 100 : 103,
    };
    else if (request.method === 'query') result = { nonce: 1000, permission: 'FullAccess', block_hash: hash, block_height: 100 };
    else if (request.method === 'send_tx') { assert.ok(signedHash); result = { final_execution_status: 'NONE' }; }
    else if (request.method === 'block') result = publicBlock(request.params.block_id as string, request.params.block_id === txBlockHash ? 101 : 102);
    else {
      assert.equal(request.params.tx_hash, signedHash); const outcome = finalOutcome(signedHash!);
      (outcome.transaction as JsonObject).public_key = signedPublicKey!;
      (outcome.transaction as JsonObject).signature = `ed25519:${'4'.repeat(87)}`;
      result = outcome;
    }
    return new Response(JSON.stringify({ jsonrpc: '2.0', id: request.id, result }));
  };
  const rpc = new NearRpcClient({ rpcUrl: config.rpcUrl, fetchImpl, timeoutMs: 100 });
  const report = await runTransfer(config, { client: rpc, provenance: { mode: 'synthetic', description: 'Offline finalized transfer fixture, never live execution.' }, checkpoint: async (r) => {
    const attempt = r.scenarios[0]!.targets[0]!.attempts[0]; if (attempt) { signedHash = attempt.txHash; signedPublicKey = attempt.publicKey; }
  } });
  assert.equal(report.scenarios[0]!.targets[0]!.verdict.status, 'HOLDS'); assert.equal(validateRunReport(report).valid, true);
  assert.equal(report.provenance.mode, 'synthetic'); assert.equal(JSON.stringify(report).includes(config.privateKey), false);
  const raw = report.scenarios[0]!.targets[0]!.attempts[0]!.finalOutcome as JsonObject;
  assert.equal((raw.transaction as JsonObject).signature, `ed25519:${'4'.repeat(87)}`);
  const block = report.scenarios[0]!.targets[0]!.attempts[0]!.finalBlocks[0]!.evidence!.response as JsonObject;
  assert.equal(((block.result as JsonObject).header as JsonObject).signature, publicSignature);
  assert.equal((((block.result as JsonObject).header as JsonObject).approvals as string[])[1], publicSignature);
});
