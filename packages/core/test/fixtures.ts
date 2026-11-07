import type { ApprovalDetails, JsonObject, RecipientSnapshot, RpcEvidence, TargetReport, TransactionAttempt, RunReport } from '../src/index.js';

export const signerId = 'disposable-owner.testnet';
export const recipientId = 'disposable-recipient.testnet';
export const publicKey = 'ed25519:11111111111111111111111111111111';
export const hash = '11111111111111111111111111111111';
export const txBlockHash = '8qbHbw2BbbTHBW1sbeqakYXVKRQM8Ne7pLK7m6CVfeR';
export const receiptBlockHash = 'CktRuQ2mttgRGkXJtyksdKHjUdc2C4TgDzyB98oEzy8';
export const afterBlockHash = '11111111111111111111111111111112';
export const receiptId = 'GgBaCs3NCBuZN12kCJgAW63ydqohFkHEdfdEXBPzLHq';
export const at = '2026-11-02T12:00:00.000Z';
export const amount = '1000000000000000000000';
export const publicSignature = `ed25519:${'4'.repeat(87)}`;

/** SDK BlockHeaderView/ChunkHeaderView public signature fields, including approvals. */
export function publicBlock(blockHash = receiptBlockHash, height = 102): JsonObject {
  return {
    author: signerId,
    header: {
      approvals: [null, publicSignature], block_merkle_root: hash, challenges_result: [], challenges_root: hash,
      chunk_headers_root: hash, chunk_mask: [true], chunk_receipts_root: hash, chunk_tx_root: hash,
      chunks_included: 1, epoch_id: hash, gas_price: '100000000', hash: blockHash, height,
      last_ds_final_block: txBlockHash, last_final_block: txBlockHash, latest_protocol_version: 80,
      next_bp_hash: hash, next_epoch_id: hash, outcome_root: hash, prev_hash: txBlockHash, prev_height: height - 1,
      prev_state_root: hash, random_value: hash, signature: publicSignature,
      timestamp: 1793611200000000000, timestamp_nanosec: '1793611200000000000',
      total_supply: '1000000000000000000000000000000', validator_proposals: [],
    },
    chunks: [{
      balance_burnt: '0', chunk_hash: receiptId, encoded_length: 8, encoded_merkle_root: hash,
      gas_limit: 1000000000000000, gas_used: 223182562500, height_created: height, height_included: height,
      outcome_root: hash, outgoing_receipts_root: hash, prev_block_hash: txBlockHash, prev_state_root: hash,
      rent_paid: '0', shard_id: 0, signature: publicSignature, tx_root: hash, validator_proposals: [],
    }],
  };
}

export function rpc(method: string, params: JsonObject, result: JsonObject): RpcEvidence {
  return { method, params, requestedAt: at, receivedAt: at, response: { jsonrpc: '2.0', id: 'fixture', result } };
}

/** Public response shape mirrors NEAR tx FINAL, including transaction and all outcomes. */
export function finalOutcome(txHash = hash, receiver = recipientId, deposit = amount): JsonObject {
  const linkedReceiptId = txHash === hash ? receiptId : txBlockHash;
  return {
    final_execution_status: 'FINAL', status: { SuccessValue: '' },
    transaction: {
      actions: [{ Transfer: { deposit } }], hash: txHash, nonce: 1001,
      public_key: publicKey, receiver_id: receiver, signer_id: signerId,
      signature: 'ed25519:public-test-signature',
    },
    transaction_outcome: {
      block_hash: txBlockHash, id: txHash,
      outcome: {
        executor_id: signerId, gas_burnt: 223182562500, logs: [],
        metadata: { gas_profile: null, version: 1 }, receipt_ids: [linkedReceiptId],
        status: { SuccessReceiptId: linkedReceiptId }, tokens_burnt: '22318256250000000000',
      }, proof: [],
    },
    receipts_outcome: [{
      block_hash: receiptBlockHash, id: linkedReceiptId,
      outcome: {
        executor_id: receiver, gas_burnt: 223182562500, logs: [],
        metadata: { gas_profile: null, version: 1 }, receipt_ids: [],
        status: { SuccessValue: '' }, tokens_burnt: '22318256250000000000',
      }, proof: [],
    }],
  };
}

export function approval(): ApprovalDetails {
  return { approvalId: 'approval-1', signerId, recipientId, amountYocto: amount, source: 'operator-config', approvedAt: at };
}

export function snapshot(balance: string, height: number, blockHash: string): RecipientSnapshot {
  const raw = { amount: balance, locked: '0', code_hash: hash, storage_usage: 182, block_hash: blockHash, block_height: height };
  return {
    recipientId, amountYocto: balance, lockedYocto: '0', queriedAt: at,
    block: { hash: blockHash, height, finality: 'FINAL' },
    evidence: rpc('query', { request_type: 'view_account', account_id: recipientId, finality: 'final' }, raw),
  };
}

export function attempt(txHash = hash, receiver = recipientId, deposit = amount): TransactionAttempt {
  const result = finalOutcome(txHash, receiver, deposit);
  return {
    attemptId: `attempt-${txHash}`, actionKind: 'transfer', signerId, publicKey,
    receiverId: receiver, amountYocto: deposit, nonce: '1001', txHash, signedAt: at,
    actions: [{ kind: 'transfer', amountYocto: deposit }],
    broadcast: rpc('send_tx', { wait_until: 'NONE', signedTransactionOmitted: true }, { final_execution_status: 'NONE' }),
    observations: [rpc('tx', { tx_hash: txHash, sender_account_id: signerId, wait_until: 'FINAL' }, result)],
    finalOutcome: result,
    finalBlocks: [
      { hash: txBlockHash, height: 101, finality: 'FINAL', evidence: rpc('block', { block_id: txBlockHash }, { author: signerId, chunks: [], header: { hash: txBlockHash, height: 101 } }) },
      { hash: receiptBlockHash, height: 102, finality: 'FINAL', evidence: rpc('block', { block_id: receiptBlockHash }, { author: signerId, chunks: [], header: { hash: receiptBlockHash, height: 102 } }) },
    ],
  };
}

export function target(): TargetReport {
  return {
    targetId: 'direct', label: 'Direct transfer', targetKind: 'direct', accountId: signerId,
    attempts: [attempt()],
    snapshots: { before: snapshot('1000000000000000000000000', 100, hash), after: snapshot('1001000000000000000000000', 103, afterBlockHash) },
    verdict: {
      status: 'HOLDS', summary: 'Exactly one intended credit is proven.', reasonCodes: ['EXACT_INTENDED_CREDIT'],
      intendedCreditYocto: amount, observedCreditYocto: amount, successfulReceiptCreditYocto: amount, transactionHashes: [hash],
    },
  };
}

export function report(): RunReport {
  return {
    schemaVersion: '1.0.0', runId: 'fixture-run', createdAt: at,
    network: { networkId: 'testnet', rpcUrl: 'https://rpc.testnet.near.org' },
    provenance: { mode: 'synthetic', description: 'Offline public response fixture; no live execution.' },
    versions: { adapter: 'near-api-js@7.4.0', build: '0.1.0' },
    scenarios: [{ scenarioId: 'legitimate-transfer', kind: 'direct-transfer', title: 'Legitimate transfer', description: 'Exact credit control', approval: approval(), targets: [target()] }],
    rpcEvidence: [],
  };
}
