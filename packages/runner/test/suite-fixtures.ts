import { createHash } from 'node:crypto';
import { baseEncode, decodeSignedTransaction, encodeTransaction, type Transaction } from 'near-api-js';
import type { JsonObject, JsonValue, RunReport } from '../../core/src/index.js';
import { NearRpcClient } from '../../near-adapter/src/index.js';
import { readLocalTestnetSetup, setupTestnet, type LocalTestnetSetup } from '../src/setup.js';
import { loadSetupConfig, loadSuiteConfig, type SuiteConfig } from '../src/suite-config.js';
import { OfflineSetupChain, setupEnv, setupScratch, type OfflineAccount } from './setup-fixtures.js';

export type SuiteFault = 'unknown' | 'pending' | 'missing-receipts' | 'nonce-rejection' | 'allowance-rejection' | 'gas-rejection';
export interface OfflineCall { transaction: Transaction; hash: string; method: string; args: JsonObject }
export const syntheticSuiteProvenance: RunReport['provenance'] = { mode: 'synthetic', description: 'Offline SDK-signed fixture simulation; no live chain execution or model agent.' };

/** Real SDK signing against a deterministic, explicitly synthetic RPC/receipt chain. */
export class OfflineSuiteChain {
  readonly accounts: Map<string, OfflineAccount>;
  readonly calls: OfflineCall[] = [];
  readonly client: NearRpcClient;
  readonly outcomes = new Map<string, JsonObject>();
  readonly approvals = new Map<string, JsonObject>();
  readonly faults = new Map<string, SuiteFault>();
  readonly initialNonces = new Map<string, bigint>();
  readonly blocks = new Map<string, JsonObject>();
  staleNonces = true;
  richBlocks = false;
  failStatus = false;
  activeBroadcasts = 0;
  maximumBroadcasts = 0;
  beforeSend?: (call: OfflineCall) => Promise<void>;
  fault?: (call: OfflineCall) => SuiteFault | undefined;
  balanceAdjustment?: (accountId: string) => bigint;
  height = 200;
  timestampNs = 1793620800000000000n;

  constructor(readonly setup: LocalTestnetSetup, accounts: Map<string, OfflineAccount>) {
    this.accounts = accounts;
    for (const account of accounts.values()) for (const [key, state] of account.keys) this.initialNonces.set(key, state.nonce);
    this.block();
    this.client = new NearRpcClient({ rpcUrl: 'https://rpc.testnet.near.org', timeoutMs: 200, fetchImpl: async (_url, init) => {
      const request = JSON.parse(String(init?.body)) as { id: string; method: string; params: JsonObject };
      const failure = (name: string, message: string) => new Response(JSON.stringify({ jsonrpc: '2.0', id: request.id,
        error: { code: -32000, cause: { name }, message } }));
      let result: JsonValue;
      if (request.method === 'status') {
        if (this.failStatus) throw new Error('Offline test network unavailable.');
        result = { chain_id: 'testnet', version: { version: '2.14.0' }, sync_info: {} };
      } else if (request.method === 'block') {
        if (request.params.finality === 'final') { this.advance(); result = this.block(); }
        else result = this.blocks.get(String(request.params.block_id))!;
        if (!result) return failure('UNKNOWN_BLOCK', 'Unknown offline block.');
      } else if (request.method === 'EXPERIMENTAL_protocol_config') {
        result = { protocol_version: 88, runtime_config: { min_gas_purchase_price: '1000000000' } };
      } else if (request.method === 'query') {
        const id = String(request.params.account_id), account = this.accounts.get(id);
        if (!account) return failure('UNKNOWN_ACCOUNT', 'Unknown offline account.');
        const block = this.block(), header = block.header as JsonObject;
        const reference = { block_hash: header.hash!, block_height: header.height! };
        if (request.params.request_type === 'view_account') result = { ...reference,
          amount: (account.amount + (this.balanceAdjustment?.(id) ?? 0n)).toString(), locked: '0', code_hash: account.codeHash, storage_usage: 200 };
        else if (request.params.request_type === 'view_access_key') {
          const key = account.keys.get(String(request.params.public_key));
          if (!key) return failure('UNKNOWN_ACCESS_KEY', 'Unknown offline access key.');
          result = { ...reference, nonce: Number(this.staleNonces ? this.initialNonces.get(String(request.params.public_key))! : key.nonce), permission: key.permission };
        } else if (request.params.request_type === 'view_access_key_list') result = { ...reference,
          keys: [...account.keys].map(([public_key, key]) => ({ public_key, access_key: { nonce: Number(key.nonce), permission: key.permission } })) };
        else if (request.params.request_type === 'call_function') {
          const args = JSON.parse(Buffer.from(String(request.params.args_base64), 'base64').toString()) as JsonObject;
          const value = request.params.method_name === 'get_config' ? account.config! : this.approvals.get(`${id}/${String(args.invoice_id)}`) ?? null;
          result = { ...reference, logs: [], result: [...new TextEncoder().encode(JSON.stringify(value))] };
        } else throw new Error('Unexpected offline suite query.');
      } else if (request.method === 'send_tx') {
        if (request.params.wait_until !== 'INCLUDED') throw new Error('Offline suite requires validation-aware INCLUDED broadcast.');
        const signed = decodeSignedTransaction(Buffer.from(String(request.params.signed_tx_base64), 'base64'));
        const transaction = signed.transaction, action = transaction.actions[0]?.functionCall;
        if (!action) throw new Error('Suite must sign one function-call action.');
        const call: OfflineCall = { transaction, hash: baseEncode(createHash('sha256').update(encodeTransaction(transaction)).digest()),
          method: action.methodName, args: JSON.parse(new TextDecoder().decode(new Uint8Array(action.args))) as JsonObject };
        this.activeBroadcasts++; this.maximumBroadcasts = Math.max(this.maximumBroadcasts, this.activeBroadcasts);
        try {
          await this.beforeSend?.(call);
          // The asynchronous transport allows the independent-key concurrency case to overlap.
          await new Promise<void>((resolve) => setTimeout(resolve, 2));
          this.calls.push(call);
          const signer = this.accounts.get(transaction.signerId)!, key = signer.keys.get(transaction.publicKey.toString())!;
          const fault = this.fault?.(call);
          if (fault) this.faults.set(call.hash, fault);
          if (fault === 'allowance-rejection' || fault === 'gas-rejection') {
            const info = fault === 'allowance-rejection' ? { InvalidAccessKeyError: { NotEnoughAllowance: {
              account_id: transaction.signerId, public_key: transaction.publicKey.toString(), allowance: '50000000000000000000000', cost: '100920000147491000000000',
            } } } : { ActionsValidation: { TotalPrepaidGasExceeded: { total_prepaid_gas: '100000000000000', limit: '50000000000000' } } };
            return new Response(JSON.stringify({ jsonrpc: '2.0', id: request.id, error: { code: -32000, message: 'Server error',
              cause: { name: 'INVALID_TRANSACTION', info }, data: { TxExecutionError: { InvalidTxError: info } } } }));
          }
          if (transaction.nonce <= key.nonce || fault === 'nonce-rejection') return failure('InvalidNonce', 'Offline nonce rejection.');
          key.nonce = transaction.nonce;
          this.execute(call, fault);
          result = { final_execution_status: 'INCLUDED' };
        } finally { this.activeBroadcasts--; }
      } else if (['EXPERIMENTAL_tx_status', 'tx_status', 'tx'].includes(request.method)) {
        const hash = String(request.params.tx_hash), fault = this.faults.get(hash), outcome = this.outcomes.get(hash);
        if (!outcome) return failure(fault === 'nonce-rejection' ? 'InvalidNonce' : 'UNKNOWN_TRANSACTION', 'Offline transaction unavailable.');
        if (fault === 'unknown') result = { ...outcome, final_execution_status: 'EXECUTED_OPTIMISTIC' };
        else if (fault === 'missing-receipts') { result = structuredClone(outcome); delete (result as JsonObject).receipts; }
        else result = outcome;
      } else throw new Error('Unexpected offline suite RPC method.');
      return new Response(JSON.stringify({ jsonrpc: '2.0', id: request.id, result }));
    } });
  }

  private advance(): void { this.height++; this.timestampNs += 1_000_000_000n; this.block(); }
  private block(): JsonObject {
    const hash = baseEncode(createHash('sha256').update(`offline-suite-block-${this.height}`).digest());
    if (!this.blocks.has(hash)) this.blocks.set(hash, { author: 'offline-validator.testnet', chunks: [],
      header: { hash, height: this.height, timestamp_nanosec: this.timestampNs.toString(), gas_price: '100000000' } });
    const block = this.blocks.get(hash)!;
    if (this.richBlocks && !(block.header as JsonObject).approvals) {
      const header = block.header as JsonObject;
      Object.assign(header, { approvals: Array.from({ length: 200 }, (_, i) => i % 7 === 0 ? null : `ed25519:${'4'.repeat(87)}`),
        signature: `ed25519:${'4'.repeat(87)}`, chunk_mask: Array.from({ length: 8 }, () => true), epoch_id: hash, next_epoch_id: hash,
        prev_hash: hash, prev_state_root: hash, chunk_headers_root: hash, chunk_receipts_root: hash, chunk_tx_root: hash, outcome_root: hash,
        challenges_root: hash, block_merkle_root: hash, next_bp_hash: hash, random_value: hash, latest_protocol_version: 81,
        gas_price: '100000000', total_supply: '1000000000000000000000000000000000', validator_proposals: [], challenges_result: [] });
      block.chunks = Array.from({ length: 8 }, (_, shard_id) => ({ chunk_hash: hash, height_created: this.height, height_included: this.height,
        shard_id, prev_block_hash: hash, prev_state_root: hash, outcome_root: hash, encoded_merkle_root: hash, tx_root: hash, outgoing_receipts_root: hash,
        encoded_length: 12000, gas_used: 1000000000000, gas_limit: 1000000000000000, balance_burnt: '100000000000000000000',
        validator_proposals: [], signature: `ed25519:${'4'.repeat(87)}` }));
    }
    return block;
  }

  private execute(call: OfflineCall, fault?: SuiteFault): void {
    const { transaction: tx, hash, method, args } = call, fixture = Object.values(this.setup.fixtures).find((value) => value.accountId === tx.receiverId)!;
    const stateKey = `${tx.receiverId}/${String(args.invoice_id)}`, amount = String(args.amount_yocto), recipient = String(args.recipient);
    let state = this.approvals.get(stateKey), panic: string | undefined, settles = false;
    this.advance(); const transactionBlock = this.block();
    this.advance(); const executionBlock = this.block();
    if (method === 'approve') {
      if (state) panic = 'invoice already exists';
      else if (BigInt(String(args.expires_at_ns)) <= this.timestampNs) panic = 'approval must expire in the future';
      else { state = { invoice_id: args.invoice_id!, recipient, amount_yocto: amount, expires_at_ns: args.expires_at_ns!,
        status: 'Approved', attempt_id: '0', completed_payment_count: '0', last_completed_recipient: null, last_completed_amount_yocto: null }; this.approvals.set(stateKey, state); }
    } else {
      if (!state) panic = 'approval required';
      else if (this.timestampNs >= BigInt(String(state.expires_at_ns))) panic = 'approval is expired';
      else if (fixture.kind === 'guarded' && recipient !== state.recipient) panic = 'canonical recipient required';
      else if (fixture.kind === 'guarded' && state.status !== 'Approved') panic = `${String(state.status)} approval cannot be claimed`;
      else {
        settles = true; state.attempt_id = (BigInt(String(state.attempt_id)) + 1n).toString(); state.status = 'Pending';
        this.accounts.get(recipient)!.amount += BigInt(amount); this.accounts.get(tx.receiverId)!.amount -= BigInt(amount);
      }
    }
    const attemptId = state?.attempt_id ?? '0';
    this.advance(); const callbackBlock = this.block();
    if (settles && fault !== 'pending') {
      state!.status = 'Paid'; state!.completed_payment_count = (BigInt(String(state!.completed_payment_count)) + 1n).toString();
      state!.last_completed_recipient = recipient; state!.last_completed_amount_yocto = amount;
    }
    const firstId = `${hash}-action`, transferId = `${hash}-transfer`, callbackId = `${hash}-callback`, refundId = `${hash}-refund`, dataId = `${hash}-data`;
    const callAction = (name: string, value: JsonValue, gas: string): JsonObject => ({ FunctionCall: {
      method_name: name, args: Buffer.from(JSON.stringify(value)).toString('base64'), gas, deposit: '0' } });
    const mainAction = callAction(method, args, tx.actions[0]!.functionCall!.gas.toString());
    const failure = (message: string): JsonObject => ({ Failure: { ActionError: { index: 0,
      kind: { FunctionCallError: { ExecutionError: `Smart contract panicked: ${message}` } } } } });
    const outcome = (id: string, executor: string, status: JsonValue, children: string[], block: JsonObject): JsonObject => ({
      id, block_hash: (block.header as JsonObject).hash!, proof: [], outcome: { executor_id: executor, gas_burnt: 1_000_000_000,
        tokens_burnt: '100000000000000000', logs: [], metadata: { version: 3, gas_profile: null }, receipt_ids: children, status } });
    const body = (id: string, predecessor: string, receiver: string, actions: JsonValue[], inputs: string[] = [], outputs: JsonValue[] = []): JsonObject => ({
      receipt_id: id, predecessor_id: predecessor, receiver_id: receiver, receipt: { Action: { signer_id: tx.signerId,
        signer_public_key: tx.publicKey.toString(), gas_price: '100000000', input_data_ids: inputs, output_data_receivers: outputs, actions } } });
    const receiptOutcomes = [outcome(firstId, tx.receiverId, panic ? failure(panic) : settles ? { SuccessReceiptId: callbackId } : { SuccessValue: '' },
      settles ? [transferId, callbackId, refundId] : [refundId], executionBlock)];
    const receipts = [body(firstId, tx.signerId, tx.receiverId, [mainAction])];
    if (settles) {
      receiptOutcomes.push(outcome(transferId, recipient, { SuccessValue: '' }, [], executionBlock));
      receiptOutcomes.push(outcome(callbackId, tx.receiverId, fault === 'pending' ? failure('callback unavailable') : { SuccessValue: '' }, [], callbackBlock));
      receipts.push(body(transferId, tx.receiverId, recipient, [{ Transfer: { deposit: amount } }], [], [{ data_id: dataId, receiver_id: tx.receiverId }]));
      receipts.push(body(callbackId, tx.receiverId, tx.receiverId, [callAction('on_transfer', { invoice_id: args.invoice_id!,
        attempt_id: attemptId, recipient, amount_yocto: amount }, '10000000000000')], [dataId]));
    }
    receiptOutcomes.push(outcome(refundId, tx.signerId, { SuccessValue: '' }, [], callbackBlock));
    receipts.push(body(refundId, 'system', tx.signerId, [{ Transfer: { deposit: '5000000000000000000' } }]));
    this.outcomes.set(hash, { final_execution_status: 'FINAL', status: panic ? failure(panic) : fault === 'pending' ? failure('callback unavailable') : { SuccessValue: '' },
      transaction: { hash, signer_id: tx.signerId, public_key: tx.publicKey.toString(), nonce: Number(tx.nonce), receiver_id: tx.receiverId,
        actions: [mainAction], signature: `ed25519:${'4'.repeat(87)}` },
      transaction_outcome: outcome(hash, tx.signerId, { SuccessReceiptId: firstId }, [firstId], transactionBlock), receipts_outcome: receiptOutcomes, receipts });
  }
}

export async function suiteScratch(): Promise<{ config: SuiteConfig; setup: LocalTestnetSetup; chain: OfflineSuiteChain; cleanup: () => Promise<void> }> {
  const scratch = await setupScratch();
  try {
    const env = setupEnv(scratch.directory), setupChain = new OfflineSetupChain(env);
    await setupTestnet(loadSetupConfig(env), { client: setupChain.client });
    const setup = await readLocalTestnetSetup(env.NEAR_SETUP_PATH!, env.NEAR_TESTNET_ACCOUNT_ID!);
    return { config: loadSuiteConfig({ ...env, NEAR_REPORT_PATH: `${scratch.directory}/suite.json` }), setup,
      chain: new OfflineSuiteChain(setup, setupChain.accounts), cleanup: scratch.cleanup };
  } catch (error) { await scratch.cleanup(); throw error; }
}
