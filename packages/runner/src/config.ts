import { resolve } from 'node:path';
import { KeyPairSigner, type KeyPairString } from 'near-api-js';

export interface TransferConfig { signerId: string; privateKey: string; recipientId: string; rpcUrl: string; amountYocto: string; reportPath: string }
export function loadTransferConfig(env: Record<string, string | undefined>): TransferConfig {
  if (env.NEAR_NETWORK_ID !== undefined && env.NEAR_NETWORK_ID !== 'testnet') throw new Error('Only native NEAR testnet configuration is supported.');
  const required = (name: string): string => { const value = env[name]?.trim(); if (!value) throw new Error(`${name} is required.`); return value; };
  const signerId = required('NEAR_TESTNET_ACCOUNT_ID'), recipientId = required('NEAR_TESTNET_RECIPIENT_ID');
  for (const [name, value] of [['NEAR_TESTNET_ACCOUNT_ID', signerId], ['NEAR_TESTNET_RECIPIENT_ID', recipientId]]) {
    if (value!.length > 64 || !/^[a-z0-9]+(?:[-_.][a-z0-9]+)*\.testnet$/.test(value!)) throw new Error(`${name} must be a named disposable testnet account.`);
  }
  if (signerId === recipientId) throw new Error('NEAR_TESTNET_RECIPIENT_ID must be distinct from the testnet signer.');
  const privateKey = required('NEAR_TESTNET_PRIVATE_KEY');
  try {
    if (!/^ed25519:[1-9A-HJ-NP-Za-km-z]{80,90}$/.test(privateKey)) throw new Error('Invalid key.');
    KeyPairSigner.fromSecretKey(privateKey as KeyPairString);
  } catch { throw new Error('NEAR_TESTNET_PRIVATE_KEY must be a valid disposable ed25519 testnet private key.'); }
  const rpcUrl = env.NEAR_RPC_URL?.trim() || 'https://test.rpc.fastnear.com';
  try {
    const url = new URL(rpcUrl);
    if (url.protocol !== 'https:' || url.username || url.password || url.hash || /mainnet/i.test(url.hostname)) throw new Error('Invalid URL.');
  } catch { throw new Error('NEAR_RPC_URL must be a public HTTPS testnet RPC URL without credentials.'); }
  const amountYocto = env.NEAR_AMOUNT_YOCTO ?? '1000000000000000000000';
  if (!/^[1-9][0-9]*$/.test(amountYocto) || amountYocto.length > 39 || BigInt(amountYocto) > (1n << 128n) - 1n) throw new Error('NEAR_AMOUNT_YOCTO must be a positive exact yoctoNEAR integer within u128.');
  const reportPath = env.NEAR_REPORT_PATH?.trim() || `reports/local/direct-transfer-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
  if (!/\.json$/i.test(reportPath) || reportPath.includes('\0')) throw new Error('NEAR_REPORT_PATH must name a JSON file.');
  return { signerId, privateKey, recipientId, rpcUrl, amountYocto, reportPath: resolve(reportPath) };
}
