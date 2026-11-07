import { isAbsolute, relative, resolve } from 'node:path';
import { KeyPairSigner, type KeyPairString } from 'near-api-js';

export const SUITE_AMOUNT_YOCTO = '1000000000000000000000';
export const SUITE_PAY_GAS = '100000000000000';
export interface OperatorConfig { operatorId: string; privateKey: string; rpcUrl: string; setupPath: string }
export interface SetupConfig extends OperatorConfig {
  unsafeWasmPath: string; guardedWasmPath: string; fixtureFundingYocto: string;
  recipientFundingYocto: string; workerAllowanceYocto: string; fixturePrefix?: string;
}
export interface SuiteConfig extends OperatorConfig { amountYocto: string; reportPath: string }
export type WasmCheckConfig = Pick<SetupConfig, 'unsafeWasmPath' | 'guardedWasmPath' | 'fixtureFundingYocto' | 'recipientFundingYocto'>;

export function exactPositiveYocto(value: string, name: string): string {
  if (!/^[1-9][0-9]*$/.test(value) || value.length > 39 || BigInt(value) > (1n << 128n) - 1n) {
    throw new Error(`${name} must be a positive exact yoctoNEAR integer within u128.`);
  }
  return value;
}
export function namedTestnetAccount(value: string, name: string): string {
  if (value.length > 64 || !/^[a-z0-9]+(?:[-_.][a-z0-9]+)*\.testnet$/.test(value)) throw new Error(`${name} must be a named disposable testnet account.`);
  return value;
}
export function localSetupPath(value = '.local/testnet-setup.json'): string {
  const root = resolve('.local'), path = resolve(value), suffix = relative(root, path);
  if (!suffix || isAbsolute(suffix) || suffix === '..' || suffix.startsWith(`..\\`) || suffix.startsWith('../') || !/\.json$/i.test(path) || path.includes('\0')) {
    throw new Error('NEAR_SETUP_PATH must name a JSON secret manifest inside the ignored .local directory.');
  }
  return path;
}
export function loadOperatorConfig(env: Record<string, string | undefined>): OperatorConfig {
  if (env.NEAR_NETWORK_ID !== undefined && env.NEAR_NETWORK_ID !== 'testnet') throw new Error('Only native NEAR testnet configuration is supported.');
  const required = (name: string): string => { const value = env[name]?.trim(); if (!value) throw new Error(`${name} is required.`); return value; };
  const operatorId = namedTestnetAccount(required('NEAR_TESTNET_ACCOUNT_ID'), 'NEAR_TESTNET_ACCOUNT_ID');
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
  return { operatorId, privateKey, rpcUrl, setupPath: localSetupPath(env.NEAR_SETUP_PATH?.trim() || undefined) };
}
export function loadSetupConfig(env: Record<string, string | undefined>): SetupConfig {
  const base = loadOperatorConfig(env), fixturePrefix = env.NEAR_FIXTURE_PREFIX?.trim() || undefined;
  if (fixturePrefix !== undefined && !/^[a-z][a-z0-9-]{0,11}$/.test(fixturePrefix)) throw new Error('NEAR_FIXTURE_PREFIX must be a short lowercase fixture prefix.');
  return {
    ...base, ...loadWasmCheckConfig(env),
    workerAllowanceYocto: exactPositiveYocto(env.NEAR_WORKER_ALLOWANCE_YOCTO ?? '2000000000000000000000000', 'NEAR_WORKER_ALLOWANCE_YOCTO'),
    ...(fixturePrefix ? { fixturePrefix } : {}),
  };
}
/** Artifact checks read only public paths/funding and need no operator credential. */
export function loadWasmCheckConfig(env: Record<string, string | undefined>): WasmCheckConfig {
  return { unsafeWasmPath: resolve(env.NEAR_UNSAFE_WASM_PATH?.trim() || 'res/unsafe_vault.wasm'),
    guardedWasmPath: resolve(env.NEAR_GUARDED_WASM_PATH?.trim() || 'res/guarded_vault.wasm'),
    fixtureFundingYocto: exactPositiveYocto(env.NEAR_FIXTURE_FUNDING_YOCTO ?? '2000000000000000000000000', 'NEAR_FIXTURE_FUNDING_YOCTO'),
    recipientFundingYocto: exactPositiveYocto(env.NEAR_RECIPIENT_FUNDING_YOCTO ?? '10000000000000000000000', 'NEAR_RECIPIENT_FUNDING_YOCTO') };
}
export function loadSuiteConfig(env: Record<string, string | undefined>): SuiteConfig {
  const base = loadOperatorConfig(env), amountYocto = exactPositiveYocto(env.NEAR_AMOUNT_YOCTO ?? SUITE_AMOUNT_YOCTO, 'NEAR_AMOUNT_YOCTO');
  if (amountYocto !== SUITE_AMOUNT_YOCTO) throw new Error('This fixture suite uses fixed 0.001 NEAR native testnet payments.');
  const reportPath = env.NEAR_REPORT_PATH?.trim() || `reports/local/fixture-suite-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
  if (!/\.json$/i.test(reportPath) || reportPath.includes('\0')) throw new Error('NEAR_REPORT_PATH must name a JSON report file.');
  return { ...base, amountYocto, reportPath: resolve(reportPath) };
}
