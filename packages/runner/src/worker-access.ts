import { NearRpcClient, RpcRequestError } from '../../near-adapter/src/index.js';
import { SUITE_PAY_GAS } from './suite-config.js';

export interface WorkerAllowanceReserve { perPayYocto: bigint; perSuiteYocto: bigint }
function object(value: unknown): Record<string, unknown> | undefined { return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined; }
function invalid(code: string, message: string): never { throw new RpcRequestError({ category: 'configuration', code, message }); }
function unsigned(value: unknown, name: string, bits: 64 | 128): bigint {
  if (typeof value !== 'string' || !/^(0|[1-9][0-9]*)$/.test(value) || value.length > (bits === 64 ? 20 : 39) || BigInt(value) >= (1n << BigInt(bits))) {
    return invalid('INVALID_WORKER_BUDGET_METADATA', `${name} must be a canonical exact unsigned u${bits} integer.`);
  }
  return BigInt(value);
}
export function exactWorkerNonce(value: unknown): bigint {
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value) || value < 0) return invalid('INVALID_WORKER_NONCE', 'Worker nonce cannot be represented exactly; key management is refused.');
    value = String(value);
  }
  return unsigned(value, 'Worker nonce', 64);
}
/** Reject broader or malformed permissions before considering a bounded renewal. */
export function checkedWorkerAccessKey(value: unknown, receiverId: string): { nonce: bigint; allowance: bigint } {
  const key = object(value), permission = object(key?.permission), call = object(permission?.FunctionCall);
  if (!permission || Object.keys(permission).length !== 1 || !call || Object.keys(call).sort().join(',') !== 'allowance,method_names,receiver_id'
    || call.receiver_id !== receiverId || !Array.isArray(call.method_names) || call.method_names.length !== 1 || call.method_names[0] !== 'pay') {
    return invalid('WORKER_PERMISSION_MISMATCH', 'Worker requires an exact bounded FunctionCall permission for its fixture receiver and pay method.');
  }
  return { nonce: exactWorkerNonce(key?.nonce), allowance: unsigned(call.allowance, 'Worker allowance', 128) };
}
/** A small spending reserve, not a runtime fee estimator: six 100-Tgas pays plus 25% for fees. */
export async function queryWorkerAllowanceReserve(client: NearRpcClient): Promise<WorkerAllowanceReserve> {
  const block = object(await client.sendJsonRpc('block', { finality: 'final' })), header = object(block?.header);
  if (typeof header?.hash !== 'string' || !Number.isSafeInteger(header.height) || (header.height as number) < 0) {
    return invalid('INVALID_GAS_PRICE_RESPONSE', 'Finalized gas-price query omitted a complete block reference.');
  }
  const currentPrice = unsigned(header.gas_price, 'Finalized block gas price', 128);
  if (currentPrice === 0n) return invalid('INVALID_GAS_PRICE_RESPONSE', 'Finalized block gas price must be positive.');
  const protocol = object(await client.sendJsonRpc('EXPERIMENTAL_protocol_config', { block_id: header.hash }));
  if (!Number.isSafeInteger(protocol?.protocol_version) || (protocol!.protocol_version as number) <= 0) {
    return invalid('INVALID_PROTOCOL_CONFIG', 'Protocol gas purchase floor is unproven.');
  }
  const floor = unsigned(object(protocol?.runtime_config)?.min_gas_purchase_price, 'Protocol gas purchase floor', 128);
  const price = currentPrice > floor ? currentPrice : floor, perPayYocto = (BigInt(SUITE_PAY_GAS) * price * 125n + 99n) / 100n;
  const perSuiteYocto = perPayYocto * 6n;
  if (perSuiteYocto >= (1n << 128n)) return invalid('WORKER_ALLOWANCE_TOO_LOW', 'Six-pay worker allowance reserve is outside u128.');
  return { perPayYocto, perSuiteYocto };
}
