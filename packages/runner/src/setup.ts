import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { Account, actions, baseEncode, KeyPair, KeyPairSigner, PublicKey, type Action, type KeyPairString } from 'near-api-js';
import type { JsonObject, JsonValue, RpcEvidence } from '../../core/src/index.js';
import { NearRpcClient, queryFinalizedContractState, RpcRequestError, sanitizePublicEvidence, toPublicError } from '../../near-adapter/src/index.js';
import { exactPositiveYocto, loadSetupConfig, localSetupPath, namedTestnetAccount, SUITE_AMOUNT_YOCTO, type SetupConfig } from './suite-config.js';
import { checkedWorkerAccessKey, exactWorkerNonce, queryWorkerAllowanceReserve } from './worker-access.js';

export type FixtureKind = 'unsafe' | 'guarded';
export interface LocalSigningKey { publicKey: string; privateKey: string }
export interface LocalFixtureSetup {
  kind: FixtureKind; accountId: string; key: LocalSigningKey; workers: [LocalSigningKey, LocalSigningKey];
  canonicalRecipientId: string; substitutedRecipientId: string; wasmHash: string;
}
export interface LocalTestnetSetup {
  setupVersion: '1.0.0'; operatorId: string; createdAt: string; setupId: string; status: 'pending' | 'ready';
  fixtures: Record<FixtureKind, LocalFixtureSetup>;
  workerRenewalNonces?: Record<string, string>;
}
export interface WasmArtifact { path: string; bytes: Uint8Array; hash: string }
export interface SetupSummary {
  setupPath: string; operatorId: string; status: 'ready';
  fixtures: { kind: FixtureKind; accountId: string; canonicalRecipientId: string; substitutedRecipientId: string; workerPublicKeys: string[]; wasmHash: string }[];
  rpcEvidence: RpcEvidence[];
}
const storageByteCost = 10000000000000000000n, emptyCodeHash = baseEncode(new Uint8Array(32));
function object(value: unknown): Record<string, unknown> | undefined { return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined; }
function generatedKey(): LocalSigningKey { const key = KeyPair.fromRandom('ed25519'); return { publicKey: key.getPublicKey().toString(), privateKey: key.toString() }; }
function validateKey(input: unknown): LocalSigningKey {
  const key = object(input);
  try {
    if (typeof key?.privateKey !== 'string' || typeof key.publicKey !== 'string' || !key.privateKey.startsWith('ed25519:')
      || KeyPair.fromString(key.privateKey as KeyPairString).getPublicKey().toString() !== key.publicKey) throw new Error('Invalid key.');
  } catch { throw new Error('Local setup contains an invalid signing key; no account action was taken.'); }
  return key as unknown as LocalSigningKey;
}
export function assertLocalTestnetSetup(input: unknown, operatorId: string): LocalTestnetSetup {
  const value = object(input), fixtures = object(value?.fixtures);
  if (value?.setupVersion !== '1.0.0' || value.operatorId !== operatorId || !['pending', 'ready'].includes(String(value.status))
    || typeof value.setupId !== 'string' || typeof value.createdAt !== 'string' || !Number.isFinite(Date.parse(value.createdAt)) || !fixtures) throw new Error('Local setup manifest is invalid or belongs to a different disposable operator.');
  const accounts = new Set<string>([operatorId]), keys = new Set<string>();
  for (const kind of ['unsafe', 'guarded'] as const) {
    const fixture = object(fixtures[kind]);
    if (!fixture || fixture.kind !== kind || !Array.isArray(fixture.workers) || fixture.workers.length !== 2 || typeof fixture.wasmHash !== 'string') throw new Error('Local setup requires two fixtures and two independent workers per fixture.');
    for (const name of ['accountId', 'canonicalRecipientId', 'substitutedRecipientId']) {
      const id = namedTestnetAccount(String(fixture[name]), `Local fixture ${name}`);
      if (!id.endsWith(`.${operatorId}`) || accounts.has(id)) throw new Error('Local fixtures and recipients must be isolated subaccounts of the disposable operator.'); accounts.add(id);
    }
    for (const key of [validateKey(fixture.key), ...fixture.workers.map(validateKey)]) {
      if (keys.has(key.publicKey)) throw new Error('Local setup worker and fixture signing keys must be independent.'); keys.add(key.publicKey);
    }
  }
  if (value.workerRenewalNonces !== undefined) {
    const renewals = object(value.workerRenewalNonces), workers = new Set(Object.values((input as LocalTestnetSetup).fixtures).flatMap((fixture) => fixture.workers.map((key) => key.publicKey)));
    if (!renewals || value.status !== 'pending' || Object.keys(renewals).length > 4) throw new Error('Local setup worker renewal markers are invalid.');
    for (const [publicKey, nonce] of Object.entries(renewals)) {
      if (!workers.has(publicKey) || typeof nonce !== 'string') throw new Error('Local setup worker renewal marker does not match a persisted worker.');
      exactWorkerNonce(nonce);
    }
  }
  return input as LocalTestnetSetup;
}
export async function readLocalTestnetSetup(path: string, operatorId: string): Promise<LocalTestnetSetup> {
  const destination = localSetupPath(path); let value: unknown;
  try { value = JSON.parse(await readFile(destination, 'utf8')); } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new Error('Local fixture setup is missing. Run npm run cli -- setup first.');
    throw new Error('Local fixture setup is unreadable or invalid JSON.');
  }
  return assertLocalTestnetSetup(value, operatorId);
}
export async function validateWasmFiles(config: Pick<SetupConfig, 'unsafeWasmPath' | 'guardedWasmPath' | 'fixtureFundingYocto' | 'recipientFundingYocto'>): Promise<Record<FixtureKind, WasmArtifact>> {
  const artifacts = {} as Record<FixtureKind, WasmArtifact>;
  for (const [kind, path] of [['unsafe', config.unsafeWasmPath], ['guarded', config.guardedWasmPath]] as const) {
    const bytes = await readFile(path); let exports: WebAssembly.ModuleExportDescriptor[];
    try { if (bytes.length > 4_000_000) throw new Error('Too large.'); exports = WebAssembly.Module.exports(new WebAssembly.Module(bytes)); }
    catch { throw new Error(`Fixture ${kind} Wasm is not a valid bounded WebAssembly module.`); }
    if (['new', 'approve', 'pay', 'get_config', 'get_approval', 'on_transfer'].some((method) => !exports.some((entry) => entry.name === method && entry.kind === 'function'))) throw new Error(`Fixture ${kind} Wasm is missing the frozen contract interface.`);
    const minimumFunding = BigInt(bytes.length + 16_384) * storageByteCost + 20n * BigInt(SUITE_AMOUNT_YOCTO);
    if (BigInt(exactPositiveYocto(config.fixtureFundingYocto, 'Fixture funding')) < minimumFunding) throw new Error('Fixture funding cannot cover exact Wasm byte storage, state reserve and small native test payments.');
    artifacts[kind] = { path, bytes, hash: baseEncode(createHash('sha256').update(bytes).digest()) };
  }
  if (BigInt(exactPositiveYocto(config.recipientFundingYocto, 'Recipient funding')) < 256n * storageByteCost) throw new Error('Recipient funding must cover isolated account storage.');
  return artifacts;
}
function generateManifest(config: SetupConfig, artifacts: Record<FixtureKind, WasmArtifact>): LocalTestnetSetup {
  const setupId = crypto.randomUUID().replaceAll('-', '').slice(0, 8), prefix = config.fixturePrefix ?? `r${setupId.slice(0, 6)}`;
  const fixture = (kind: FixtureKind, letter: string): LocalFixtureSetup => ({
    kind, accountId: namedTestnetAccount(`${prefix}${letter}.${config.operatorId}`, 'Fixture subaccount'), key: generatedKey(), workers: [generatedKey(), generatedKey()],
    canonicalRecipientId: namedTestnetAccount(`${prefix}${letter}c.${config.operatorId}`, 'Canonical recipient'),
    substitutedRecipientId: namedTestnetAccount(`${prefix}${letter}s.${config.operatorId}`, 'Substituted recipient'), wasmHash: artifacts[kind].hash,
  });
  return { setupVersion: '1.0.0', operatorId: config.operatorId, createdAt: new Date().toISOString(), setupId, status: 'pending', fixtures: { unsafe: fixture('unsafe', 'u'), guarded: fixture('guarded', 'g') } };
}
async function saveManifest(path: string, manifest: LocalTestnetSetup, initial = false): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  if (initial) { await writeFile(path, `${JSON.stringify(manifest, null, 2)}\n`, { flag: 'wx', mode: 0o600 }); return; }
  const temporary = `${path}.tmp-${crypto.randomUUID()}`;
  await writeFile(temporary, `${JSON.stringify(manifest, null, 2)}\n`, { flag: 'wx', mode: 0o600 }); await rename(temporary, path);
}
async function accountView(client: NearRpcClient, accountId: string): Promise<Record<string, unknown> | undefined> {
  try { return object(await client.sendJsonRpc('query', { request_type: 'view_account', account_id: accountId, finality: 'final' })); }
  catch (error) { if (toPublicError(error).code === 'UNKNOWN_ACCOUNT') return undefined; throw error; }
}
async function accessKey(client: NearRpcClient, accountId: string, publicKey: string): Promise<Record<string, unknown> | undefined> {
  try {
    const result = object(await client.sendJsonRpc('query', { request_type: 'view_access_key', account_id: accountId, public_key: publicKey, finality: 'final' }));
    if (!result) throw new RpcRequestError({ category: 'evidence', code: 'INVALID_ACCESS_KEY_RESPONSE', message: 'Finalized access-key query omitted an object response; missing-key status is unproven.' });
    return result;
  } catch (error) { if (toPublicError(error).code === 'UNKNOWN_ACCESS_KEY') return undefined; throw error; }
}
export function fixtureConfig(fixture: LocalFixtureSetup, operatorId: string): JsonObject {
  return { owner_id: operatorId, worker_public_keys: fixture.workers.map((key) => key.publicKey), allowed_recipients: [fixture.canonicalRecipientId, fixture.substitutedRecipientId], max_payment_yocto: SUITE_AMOUNT_YOCTO };
}
export function matchesFixtureConfig(value: JsonValue, fixture: LocalFixtureSetup, operatorId: string): boolean {
  const config = object(value), expected = fixtureConfig(fixture, operatorId);
  return !!config && ['owner_id', 'max_payment_yocto'].every((key) => config[key] === expected[key])
    && ['worker_public_keys', 'allowed_recipients'].every((key) => JSON.stringify(config[key]) === JSON.stringify(expected[key]));
}
async function management(account: Account, receiverId: string, actionsList: Action[]): Promise<void> {
  // These serialized account-management actions are separate from one-shot fault scenarios.
  const result = await account.signAndSendTransaction({ receiverId, actions: actionsList, waitUntil: 'FINAL', retries: 0 });
  if (result.final_execution_status !== 'FINAL' || !object(result.status)?.SuccessValue && object(result.status)?.SuccessValue !== '') throw new Error('Account management did not produce a complete successful FINAL outcome. Rerun setup to reconcile local accounts.');
}

/** Persist local secrets first; reconcile generated account identities on every rerun. */
export async function setupTestnet(input: SetupConfig, options: { client?: NearRpcClient } = {}): Promise<SetupSummary> {
  const config = loadSetupConfig({ NEAR_TESTNET_ACCOUNT_ID: input.operatorId, NEAR_TESTNET_PRIVATE_KEY: input.privateKey, NEAR_RPC_URL: input.rpcUrl, NEAR_SETUP_PATH: input.setupPath,
    NEAR_UNSAFE_WASM_PATH: input.unsafeWasmPath, NEAR_GUARDED_WASM_PATH: input.guardedWasmPath, NEAR_FIXTURE_FUNDING_YOCTO: input.fixtureFundingYocto,
    NEAR_RECIPIENT_FUNDING_YOCTO: input.recipientFundingYocto, NEAR_WORKER_ALLOWANCE_YOCTO: input.workerAllowanceYocto, NEAR_FIXTURE_PREFIX: input.fixturePrefix });
  const artifacts = await validateWasmFiles(config); let manifest: LocalTestnetSetup;
  try { manifest = assertLocalTestnetSetup(JSON.parse(await readFile(config.setupPath, 'utf8')), config.operatorId); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    manifest = generateManifest(config, artifacts); await saveManifest(config.setupPath, manifest, true);
  }
  for (const kind of ['unsafe', 'guarded'] as const) if (manifest.fixtures[kind].wasmHash !== artifacts[kind].hash) throw new Error('Fixture Wasm differs from the persisted local setup. Use a fresh ignored setup manifest for another build.');
  if (manifest.status !== 'pending') { manifest.status = 'pending'; await saveManifest(config.setupPath, manifest); }
  const client = options.client ?? new NearRpcClient({ rpcUrl: config.rpcUrl }); await client.verifyTestnet();
  const allowanceReserve = await queryWorkerAllowanceReserve(client);
  if (BigInt(config.workerAllowanceYocto) < allowanceReserve.perSuiteYocto) throw new RpcRequestError({ category: 'configuration', code: 'WORKER_ALLOWANCE_TOO_LOW',
    message: `Configured worker allowance cannot cover the six-pay gas reserve of ${allowanceReserve.perSuiteYocto} yoctoNEAR, including a 25% fee buffer.` });
  const signer = KeyPairSigner.fromSecretKey(config.privateKey as KeyPairString), operator = new Account(config.operatorId, client, signer);
  const operatorKey = await accessKey(client, config.operatorId, (await signer.getPublicKey()).toString());
  if (operatorKey?.permission !== 'FullAccess') throw new Error('Fixture setup requires a full-access disposable testnet operator.');
  if (typeof operatorKey.nonce === 'number' && !Number.isSafeInteger(operatorKey.nonce)) throw new Error('Operator nonce is not exact; setup signing is refused.');
  const existing = new Map<string, Record<string, unknown> | undefined>(); let requiredFunding = 0n;
  for (const fixture of Object.values(manifest.fixtures)) for (const [accountId, funding] of [[fixture.canonicalRecipientId, config.recipientFundingYocto], [fixture.substitutedRecipientId, config.recipientFundingYocto], [fixture.accountId, config.fixtureFundingYocto]]) {
    const state = await accountView(client, accountId!); existing.set(accountId!, state); if (!state) requiredFunding += BigInt(funding!);
  }
  const owner = await accountView(client, config.operatorId);
  if (!owner || typeof owner.amount !== 'string' || typeof owner.storage_usage !== 'number' || !Number.isSafeInteger(owner.storage_usage)
    || BigInt(owner.amount) - BigInt(owner.storage_usage) * storageByteCost < requiredFunding + 50000000000000000000000n) throw new Error('Free testnet operator balance cannot cover fixture funding and serialized setup gas.');
  for (const fixture of Object.values(manifest.fixtures)) {
    for (const accountId of [fixture.canonicalRecipientId, fixture.substitutedRecipientId]) {
      if (!existing.get(accountId)) await management(operator, accountId, [actions.createAccount(), actions.transfer(BigInt(config.recipientFundingYocto))]);
      const view = await accountView(client, accountId), keys = object(await client.sendJsonRpc('query', { request_type: 'view_access_key_list', account_id: accountId, finality: 'final' }));
      if (view?.code_hash !== emptyCodeHash || !Array.isArray(keys?.keys) || keys.keys.length) throw new Error('A dedicated recipient has code or access keys; setup isolation cannot be established.');
    }
    const artifact = artifacts[fixture.kind], initializer = actions.functionCall('new', fixtureConfig(fixture, config.operatorId), 30000000000000n, 0n);
    if (!existing.get(fixture.accountId)) await management(operator, fixture.accountId, [actions.createAccount(), actions.transfer(BigInt(config.fixtureFundingYocto)), actions.addFullAccessKey(PublicKey.from(fixture.key.publicKey)), actions.deployContract(artifact.bytes), initializer]);
    const view = await accountView(client, fixture.accountId), key = await accessKey(client, fixture.accountId, fixture.key.publicKey);
    if (key?.permission !== 'FullAccess') throw new Error('Fixture full-access key does not match the persisted generated account.');
    const fixtureAccount = new Account(fixture.accountId, client, fixture.key.privateKey as KeyPairString);
    if (view?.code_hash === emptyCodeHash) await management(fixtureAccount, fixture.accountId, [actions.deployContract(artifact.bytes), initializer]);
    else if (view?.code_hash !== artifact.hash) throw new Error('Fixture on-chain code hash differs from the locally validated Wasm.');
    let state;
    try { state = await queryFinalizedContractState(client, fixture.accountId, 'get_config', {}); }
    catch (error) {
      if (!/not initialized/i.test(JSON.stringify(client.records.at(-1)?.response))) throw error;
      await management(fixtureAccount, fixture.accountId, [initializer]); state = await queryFinalizedContractState(client, fixture.accountId, 'get_config', {});
    }
    if (!matchesFixtureConfig(state.value, fixture, config.operatorId)) throw new Error('Public fixture owner, workers, allowlist or amount cap differs from the persisted setup.');
    for (const worker of fixture.workers) {
      const present = await accessKey(client, config.operatorId, worker.publicKey);
      const current = present ? checkedWorkerAccessKey(present, fixture.accountId) : undefined;
      if (current && current.allowance < allowanceReserve.perSuiteYocto) {
        // Keep the exact previous nonce through a lost management response. A ready
        // manifest was already made pending before any installation or renewal.
        manifest.workerRenewalNonces ??= {};
        manifest.workerRenewalNonces[worker.publicKey] = current.nonce.toString();
        await saveManifest(config.setupPath, manifest);
        await management(operator, config.operatorId, [actions.deleteKey(PublicKey.from(worker.publicKey)),
          actions.addFunctionCallAccessKey(PublicKey.from(worker.publicKey), fixture.accountId, ['pay'], BigInt(config.workerAllowanceYocto))]);
      }
      if (!present) await management(operator, config.operatorId, [actions.addFunctionCallAccessKey(PublicKey.from(worker.publicKey), fixture.accountId, ['pay'], BigInt(config.workerAllowanceYocto))]);
      const installed = checkedWorkerAccessKey(await accessKey(client, config.operatorId, worker.publicKey), fixture.accountId);
      if (installed.allowance < allowanceReserve.perSuiteYocto) throw new RpcRequestError({ category: 'configuration', code: 'WORKER_ALLOWANCE_TOO_LOW', message: 'Installed worker allowance cannot cover the six-pay gas reserve.' });
      const previousNonce = manifest.workerRenewalNonces?.[worker.publicKey];
      if (previousNonce !== undefined) {
        if (installed.nonce <= exactWorkerNonce(previousNonce)) throw new RpcRequestError({ category: 'evidence', code: 'WORKER_RENEWAL_NONCE_NOT_ADVANCED', message: 'Renewed worker nonce did not advance beyond its persisted prior nonce; setup remains pending.' });
        delete manifest.workerRenewalNonces![worker.publicKey];
        if (!Object.keys(manifest.workerRenewalNonces!).length) delete manifest.workerRenewalNonces;
        await saveManifest(config.setupPath, manifest);
      }
    }
  }
  manifest.status = 'ready'; await saveManifest(config.setupPath, manifest);
  const secrets = [config.privateKey, ...Object.values(manifest.fixtures).flatMap((fixture) => [fixture.key.privateKey, ...fixture.workers.map((key) => key.privateKey)])];
  const summary = sanitizePublicEvidence({ setupPath: config.setupPath, operatorId: config.operatorId, status: 'ready', fixtures: Object.values(manifest.fixtures).map((fixture) => ({ kind: fixture.kind,
    accountId: fixture.accountId, canonicalRecipientId: fixture.canonicalRecipientId, substitutedRecipientId: fixture.substitutedRecipientId, workerPublicKeys: fixture.workers.map((key) => key.publicKey), wasmHash: fixture.wasmHash })) }, secrets) as unknown as Omit<SetupSummary, 'rpcEvidence'>;
  const rpcEvidence = client.records.map((record): RpcEvidence => {
    const { response, ...fields } = record;
    // Each recognized raw envelope keeps its scoped public signatures, with known
    // local secrets always redacted even if an RPC places one in a signature slot.
    return { ...sanitizePublicEvidence(fields, secrets) as unknown as Omit<RpcEvidence, 'response'>, response: sanitizePublicEvidence(response, secrets) };
  });
  return { ...summary, rpcEvidence };
}
