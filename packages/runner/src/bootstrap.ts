import { access, mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { KeyPair } from 'near-api-js';
import { NearRpcClient, queryFinalizedBalance, toPublicError } from '../../near-adapter/src/index.js';

export interface BootstrapOptions { directory?: string; rpcUrl?: string; fetchImpl?: typeof fetch; client?: NearRpcClient }
export interface BootstrapSummary { operatorId: string; envPath: string; balanceYocto: string }
/** Free testnet helper only. Exclusive files retain generated credentials before helper side effects. */
export async function bootstrapTestnet(options: BootstrapOptions = {}): Promise<BootstrapSummary> {
  const root = resolve(options.directory ?? '.'), envPath = resolve(root, '.env'), keyPath = resolve(root, '.local', 'bootstrap.json');
  try { await access(envPath); throw new Error('An existing .env will not be overwritten. Use its disposable operator with setup.'); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  const key = KeyPair.fromRandom('ed25519'), operatorId = `nrl-${crypto.randomUUID().replaceAll('-', '').slice(0, 16)}.testnet`;
  const rpcUrl = options.rpcUrl ?? 'https://test.rpc.fastnear.com', client = options.client ?? new NearRpcClient({ rpcUrl });
  await mkdir(resolve(root, '.local'), { recursive: true });
  await writeFile(keyPath, `${JSON.stringify({ operatorId, key: { publicKey: key.getPublicKey().toString(), privateKey: key.toString() }, createdAt: new Date().toISOString() }, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
  await writeFile(envPath, `# Free helper-funded disposable native NEAR testnet operator.\nNEAR_NETWORK_ID=testnet\nNEAR_TESTNET_ACCOUNT_ID=${operatorId}\nNEAR_TESTNET_PRIVATE_KEY=${key.toString()}\nNEAR_RPC_URL=${rpcUrl}\nNEAR_AMOUNT_YOCTO=1000000000000000000000\nNEAR_SETUP_PATH=.local/testnet-setup.json\n`, { flag: 'wx', mode: 0o600 });
  await client.verifyTestnet();
  const abort = new AbortController(), timer = setTimeout(() => abort.abort(), 15_000); let helperFailure: unknown;
  try {
    const response = await (options.fetchImpl ?? fetch)('https://helper.testnet.near.org/account', { method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: abort.signal,
      body: JSON.stringify({ newAccountId: operatorId, newAccountPublicKey: key.getPublicKey().toString() }) });
    if (!response.ok) helperFailure = new Error(`Free testnet helper returned HTTP ${response.status}.`);
  } catch (error) { helperFailure = error; } finally { clearTimeout(timer); }
  const deadline = Date.now() + 90_000;
  do {
    try {
      const balance = await queryFinalizedBalance(client, operatorId), accessKey = await client.sendJsonRpc('query', { request_type: 'view_access_key', account_id: operatorId, public_key: key.getPublicKey().toString(), finality: 'final' });
      if (accessKey.permission !== 'FullAccess') throw new Error('Free helper account does not expose the generated full-access key.');
      return { operatorId, envPath, balanceYocto: balance.amountYocto };
    } catch (error) {
      if (!['UNKNOWN_ACCOUNT', 'UNKNOWN_ACCESS_KEY'].includes(toPublicError(error).code ?? '')) throw error;
      if (helperFailure && Date.now() + 1_000 >= deadline) break;
    }
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  } while (Date.now() < deadline);
  throw new Error('Free helper account could not be verified through FINAL. Generated local .env and .local/bootstrap.json were retained for recovery.');
}
