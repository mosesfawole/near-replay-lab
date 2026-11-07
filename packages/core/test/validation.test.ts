import assert from 'node:assert/strict';
import test from 'node:test';
import { KeyPair } from 'near-api-js';
import { assertRunReport, evaluateTargetEvidence, validateRunReport } from '../src/index.js';
import { publicBlock, report, rpc, txBlockHash } from './fixtures.js';
import type { JsonObject } from '../src/index.js';

test('versioned synthetic public evidence is accepted and keeps its honest provenance', () => {
  const result = validateRunReport(report());
  assert.equal(result.valid, true);
  if (result.valid) assert.equal(result.report.provenance.mode, 'synthetic');
});

test('unsupported report versions and non-testnet networks are rejected', () => {
  const data = report() as unknown as Record<string, unknown>; data.schemaVersion = '2.0.0';
  let result = validateRunReport(data); assert.equal(result.valid, false); assert.match(result.errors.join(' '), /schemaVersion/);
  data.schemaVersion = '1.0.0'; data.network = { networkId: 'mainnet', rpcUrl: 'https://rpc.mainnet.near.org' };
  result = validateRunReport(data); assert.equal(result.valid, false); assert.match(result.errors.join(' '), /network/);
});

test('missing provenance cannot be imported as a real run', () => {
  const data = report() as unknown as Record<string, unknown>; delete data.provenance;
  const result = validateRunReport(data); assert.equal(result.valid, false); assert.match(result.errors.join(' '), /provenance/);
});

test('tampered HOLDS verdict is rejected when actual balance evidence is missing', () => {
  const data = report(); data.scenarios[0]!.targets[0]!.snapshots.after = null;
  const result = validateRunReport(data); assert.equal(result.valid, false); assert.match(result.errors.join(' '), /verdict/);
});

test('keys cannot appear in report extensions or raw RPC evidence', () => {
  const data = report() as unknown as Record<string, unknown>; data.extension = { nested: { private_key: 'never-a-real-secret' } };
  const result = validateRunReport(data); assert.equal(result.valid, false); assert.match(result.errors.join(' '), /secret|private/i);
});

test('runtime money validation rejects numeric amounts', () => {
  const data = report(); (data.scenarios[0]!.approval as unknown as Record<string, unknown>).amountYocto = 1000000000000000000000;
  const result = validateRunReport(data); assert.equal(result.valid, false); assert.match(result.errors.join(' '), /amountYocto/);
});

test('assertRunReport throws useful validation errors on untrusted imports', () => {
  assert.throws(() => assertRunReport({ schemaVersion: '0.0.0' }), /schemaVersion/);
});

test('real-length public transaction signatures survive secret validation', () => {
  const data = report(), outcome = data.scenarios[0]!.targets[0]!.attempts[0]!.finalOutcome as JsonObject;
  (outcome.transaction as JsonObject).signature = `ed25519:${'4'.repeat(87)}`;
  assert.equal(validateRunReport(data).valid, true);
});

test('malformed collections return bounded errors instead of throwing after the error cap', () => {
  const data = report() as unknown as { scenarios: { targets: unknown[] }[] };
  data.scenarios[0]!.targets = Array.from({ length: 20 }, () => ({}));
  let result;
  assert.doesNotThrow(() => { result = validateRunReport(data); });
  assert.equal(result!.valid, false); assert.ok(result!.errors.length <= 100);
});

test('an extension signature field cannot bypass private-key import validation', () => {
  const secret = KeyPair.fromRandom('ed25519').toString();
  const data = report() as unknown as Record<string, unknown>; data.extension = { signature: secret };
  const result = validateRunReport(data);
  assert.equal(result.valid, false); assert.match(result.errors.join(' '), /extension.signature/);
  assert.equal(JSON.stringify(result).includes(secret), false);
});

test('contradicting verdict summaries are rejected for HOLDS and INCONCLUSIVE imports', () => {
  for (const missingBalance of [false, true]) {
    const data = report(), scenario = data.scenarios[0]!, evidence = scenario.targets[0]!;
    if (missingBalance) evidence.snapshots.after = null;
    evidence.verdict = evaluateTargetEvidence(evidence, scenario.approval);
    evidence.verdict.summary = missingBalance ? 'Exactly one intended credit is proven.' : 'No intended payment was proven.';
    const result = validateRunReport(data);
    assert.equal(result.valid, false); assert.match(result.errors.join(' '), /verdict.summary/);
  }
});

test('public block header, chunk and approval signatures validate in declared RPC evidence slots', () => {
  const data = report(), block = data.scenarios[0]!.targets[0]!.attempts[0]!.finalBlocks[0]!;
  block.evidence = rpc('block', { block_id: txBlockHash }, publicBlock(txBlockHash, 101));
  data.rpcEvidence.push(block.evidence);
  assert.equal(validateRunReport(data).valid, true);
});
