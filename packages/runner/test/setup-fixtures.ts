import { createHash } from 'node:crypto';
import { mkdir, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { baseEncode, decodeSignedTransaction, encodeTransaction, KeyPair, type Transaction } from 'near-api-js';
import type { JsonObject, JsonValue } from '../../core/src/index.js';
import { NearRpcClient } from '../../near-adapter/src/index.js';
import { hash } from '../../core/test/fixtures.js';

export async function setupScratch(): Promise<{ directory: string; cleanup: () => Promise<void> }> {
  const directory = resolve('.local', `offline-task3-${crypto.randomUUID()}`); await mkdir(directory, { recursive: true });
  return { directory, cleanup: async () => { if (!directory.startsWith(`${resolve('.local')}\\`) && !directory.startsWith(`${resolve('.local')}/`)) throw new Error('Invalid test cleanup path.'); await rm(directory, { recursive: true, force: true }); } };
}
export function setupEnv(directory: string): Record<string, string> {
  return { NEAR_TESTNET_ACCOUNT_ID: 'disposable-owner.testnet', NEAR_TESTNET_PRIVATE_KEY: KeyPair.fromRandom('ed25519').toString(), NEAR_SETUP_PATH: resolve(directory, 'testnet-setup.json') };
}
export interface OfflineAccount { amount: bigint; codeHash: string; keys: Map<string, { nonce: bigint; permission: JsonValue }>; config?: JsonObject }
export class OfflineSetupChain {
  readonly accounts = new Map<string, OfflineAccount>();
  readonly transactions: Transaction[] = [];
  beforeMutation?: () => Promise<void>;
  loseNextResponse = false;
  legacyMissingKeys = false;
  legacyMissingKeyMessage?: string;
  malformedMissingKeyResult?: JsonValue;
  missingKeyErrorCode = 'UNKNOWN_ACCESS_KEY';
  gasPrice = '100000000';
  minGasPurchasePrice: JsonValue = '1000000000';
  renewedNonce?: bigint;
  readonly client: NearRpcClient;
  constructor(env: Record<string, string>) {
    this.accounts.set(env.NEAR_TESTNET_ACCOUNT_ID!, { amount: 10000000000000000000000000n, codeHash: hash,
      keys: new Map([[KeyPair.fromString(env.NEAR_TESTNET_PRIVATE_KEY! as `ed25519:${string}`).getPublicKey().toString(), { nonce: 1000n, permission: 'FullAccess' }]]) });
    this.client = new NearRpcClient({ rpcUrl: 'https://rpc.testnet.near.org', timeoutMs: 200, fetchImpl: async (_url, init) => {
      const request = JSON.parse(String(init?.body)) as { id: string; method: string; params: JsonObject };
      const error = (name: string, message: string) => new Response(JSON.stringify({ jsonrpc: '2.0', id: request.id, error: { code: -32000, cause: { name, info: { error_message: message } }, message } }));
      let result: unknown;
      if (request.method === 'status') result = { chain_id: 'testnet', version: { version: '2.14.0' }, sync_info: {} };
      else if (request.method === 'block') result = { author: 'offline-validator.testnet', chunks: [], header: { hash: request.params.block_id ?? hash, height: 100 + this.transactions.length, timestamp_nanosec: '1793620800000000000', gas_price: this.gasPrice } };
      else if (request.method === 'EXPERIMENTAL_protocol_config') result = { protocol_version: 88, runtime_config: { min_gas_purchase_price: this.minGasPurchasePrice } };
      else if (request.method === 'query') {
        const account = this.accounts.get(String(request.params.account_id));
        if (!account) return error('UNKNOWN_ACCOUNT', 'Account does not exist.');
        if (request.params.request_type === 'view_account') result = { amount: account.amount.toString(), locked: '0', code_hash: account.codeHash, storage_usage: 200, block_hash: hash, block_height: 100 + this.transactions.length };
        else if (request.params.request_type === 'view_access_key') {
          const key = account.keys.get(String(request.params.public_key));
          if (!key && this.malformedMissingKeyResult !== undefined) result = this.malformedMissingKeyResult;
          else if (!key && this.legacyMissingKeys) result = { block_hash: hash, block_height: 100 + this.transactions.length, logs: [],
            error: this.legacyMissingKeyMessage ?? `access key ${String(request.params.public_key)} does not exist while viewing` };
          else if (!key) return error(this.missingKeyErrorCode, 'Access key does not exist.');
          else result = { nonce: Number(key.nonce), permission: key.permission, block_hash: hash, block_height: 100 + this.transactions.length };
        } else if (request.params.request_type === 'view_access_key_list') result = { keys: [...account.keys].map(([public_key, key]) => ({ public_key, access_key: { nonce: Number(key.nonce), permission: key.permission } })), block_hash: hash, block_height: 100 + this.transactions.length };
        else {
          if (!account.config) return error('VIEW_CALL_ERROR', 'The contract is not initialized');
          result = { result: [...new TextEncoder().encode(JSON.stringify(account.config))], logs: [], block_hash: hash, block_height: 100 + this.transactions.length };
        }
      } else if (request.method === 'send_tx') {
        await this.beforeMutation?.();
        const signed = decodeSignedTransaction(Buffer.from(String(request.params.signed_tx_base64), 'base64')), transaction = signed.transaction;
        this.transactions.push(transaction);
        const signer = this.accounts.get(transaction.signerId)!; signer.keys.get(transaction.publicKey.toString())!.nonce = transaction.nonce;
        const deletedKeys = new Set<string>();
        for (const action of transaction.actions) {
          if (action.createAccount) this.accounts.set(transaction.receiverId, { amount: 0n, codeHash: hash, keys: new Map() });
          const receiver = this.accounts.get(transaction.receiverId)!;
          if (action.transfer) { receiver.amount += action.transfer.deposit; signer.amount -= action.transfer.deposit; }
          if (action.deleteKey) {
            const deleted = action.deleteKey.publicKey as unknown as { ed25519Key: { data: number[] } };
            const publicKey = `ed25519:${baseEncode(new Uint8Array(deleted.ed25519Key.data))}`;
            if (!receiver.keys.delete(publicKey)) throw new Error('Offline DeleteKey must remove an existing key.');
            deletedKeys.add(publicKey);
          }
          if (action.addKey) {
            const permission = action.addKey.accessKey.permission.functionCall;
            // SDK transaction decoding normalizes the transaction key, while nested
            // AddKey public keys retain their Borsh enum/number-array representation.
            const added = action.addKey.publicKey as unknown as { ed25519Key: { data: number[] } };
            const publicKey = `ed25519:${baseEncode(new Uint8Array(added.ed25519Key.data))}`;
            receiver.keys.set(publicKey, { nonce: deletedKeys.has(publicKey) && this.renewedNonce !== undefined ? this.renewedNonce : BigInt(100 + this.transactions.length) * 1_000_000n - 1n,
              permission: permission ? { FunctionCall: { receiver_id: permission.receiverId, method_names: permission.methodNames, allowance: permission.allowance!.toString() } } : 'FullAccess' });
          }
          if (action.deployContract) receiver.codeHash = baseEncode(createHash('sha256').update(new Uint8Array(action.deployContract.code)).digest());
          if (action.functionCall) receiver.config = JSON.parse(new TextDecoder().decode(new Uint8Array(action.functionCall.args))) as JsonObject;
        }
        if (this.loseNextResponse) { this.loseNextResponse = false; throw new Error('Offline transport lost response after applying account management.'); }
        const txHash = baseEncode(createHash('sha256').update(encodeTransaction(transaction)).digest()), receiptId = `${txHash}-receipt`;
        const outcome = { executor_id: transaction.receiverId, gas_burnt: 1000, tokens_burnt: '1000', logs: [], receipt_ids: [], metadata: { version: 3, gas_profile: null }, status: { SuccessValue: '' } };
        result = { final_execution_status: 'FINAL', status: { SuccessValue: '' }, transaction: { hash: txHash, signer_id: transaction.signerId, public_key: transaction.publicKey.toString(), nonce: Number(transaction.nonce), receiver_id: transaction.receiverId, actions: [], signature: 'ed25519:offline-public-signature' },
          transaction_outcome: { id: txHash, block_hash: hash, proof: [], outcome: { ...outcome, executor_id: transaction.signerId, receipt_ids: [receiptId], status: { SuccessReceiptId: receiptId } } },
          receipts_outcome: [{ id: receiptId, block_hash: hash, proof: [], outcome }], receipts: [] };
      } else throw new Error('Unexpected offline setup RPC method.');
      return new Response(JSON.stringify({ jsonrpc: '2.0', id: request.id, result }));
    } });
  }
}
