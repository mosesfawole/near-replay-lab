import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import test from 'node:test';
import { KeyPair } from 'near-api-js';
import { RpcRequestError } from '../../near-adapter/src/index.js';
import * as runner from '../src/index.js';
import { OfflineSetupChain, setupEnv, setupScratch } from './setup-fixtures.js';

type NewRunner = {
  setupTestnet: (config: runner.SetupConfig, options?: { client?: OfflineSetupChain['client'] }) => Promise<{ setupPath: string; operatorId: string; fixtures: { accountId: string; workerPublicKeys: string[] }[] }>;
  bootstrapTestnet: (options?: { directory?: string; fetchImpl?: typeof fetch; client?: OfflineSetupChain['client'] }) => Promise<{ operatorId: string; envPath: string }>;
};
const api = runner as unknown as NewRunner;

test('invalid Wasm prevents network requests, funding and secret-manifest writes', async () => {
  const scratch = await setupScratch(); try {
    const env = setupEnv(scratch.directory), chain = new OfflineSetupChain(env); const invalid = resolve(scratch.directory, 'invalid.wasm'); await writeFile(invalid, 'invalid module');
    await assert.rejects(async () => api.setupTestnet(runner.loadSetupConfig({ ...env, NEAR_UNSAFE_WASM_PATH: invalid }), { client: chain.client }), /Wasm|WebAssembly|module/i);
    assert.equal(chain.client.records.length, 0); await assert.rejects(readFile(env.NEAR_SETUP_PATH!, 'utf8'), { code: 'ENOENT' });
  } finally { await scratch.cleanup(); }
});
test('fixture funding must cover exact Wasm byte storage before chain side effects', async () => {
  const scratch = await setupScratch(); try {
    const env = setupEnv(scratch.directory), chain = new OfflineSetupChain(env);
    await assert.rejects(async () => api.setupTestnet(runner.loadSetupConfig({ ...env, NEAR_FIXTURE_FUNDING_YOCTO: '1000000000000000000000000' }), { client: chain.client }), /funding|storage/i);
    assert.equal(chain.transactions.length, 0); assert.equal(chain.client.records.length, 0);
  } finally { await scratch.cleanup(); }
});
test('setup persists six generated keys before creating accounts and installs four receiver/pay restrictions', async () => {
  const scratch = await setupScratch(); try {
    const env = setupEnv(scratch.directory), chain = new OfflineSetupChain(env); let checked = false;
    chain.beforeMutation = async () => {
      const manifest = JSON.parse(await readFile(env.NEAR_SETUP_PATH!, 'utf8')) as { fixtures: Record<string, { key: { privateKey: string; publicKey: string }; workers: { privateKey: string; publicKey: string }[] }> };
      const keys = Object.values(manifest.fixtures).flatMap((fixture) => [fixture.key, ...fixture.workers]);
      assert.equal(keys.length, 6); assert.equal(new Set(keys.map((key) => key.publicKey)).size, 6);
      assert.equal(keys.every((key) => KeyPair.fromString(key.privateKey as `ed25519:${string}`).getPublicKey().toString() === key.publicKey), true); checked = true;
    };
    let result: Awaited<ReturnType<NewRunner['setupTestnet']>> | undefined;
    await assert.doesNotReject(async () => { result = await api.setupTestnet(runner.loadSetupConfig(env), { client: chain.client }); });
    assert.equal(checked, true); assert.equal(result!.fixtures.length, 2); assert.equal(chain.accounts.size, 7);
    const restrictions = chain.transactions.flatMap((transaction) => transaction.actions.flatMap((action) => action.addKey?.accessKey.permission.functionCall ? [action.addKey.accessKey.permission.functionCall] : []));
    assert.equal(restrictions.length, 4);
    for (const restriction of restrictions) { assert.deepEqual(restriction.methodNames, ['pay']); assert.ok(result!.fixtures.some((fixture) => fixture.accountId === restriction.receiverId)); assert.equal(restriction.allowance, 2000000000000000000000000n); }
    assert.equal(JSON.stringify(result).includes(env.NEAR_TESTNET_PRIVATE_KEY!), false);
  } finally { await scratch.cleanup(); }
});
test('setup reruns reuse the manifest and perform no duplicate creation, deployment or key additions', async () => {
  const scratch = await setupScratch(); try {
    const env = setupEnv(scratch.directory), chain = new OfflineSetupChain(env), config = runner.loadSetupConfig(env);
    await assert.doesNotReject(async () => api.setupTestnet(config, { client: chain.client }));
    const manifest = await readFile(env.NEAR_SETUP_PATH!, 'utf8'), mutations = chain.transactions.length;
    await api.setupTestnet(config, { client: chain.client });
    assert.equal(chain.transactions.length, mutations); assert.equal((await readFile(env.NEAR_SETUP_PATH!, 'utf8')) === manifest, true);
  } finally { await scratch.cleanup(); }
});
test('lost setup response retains local keys and a rerun reconciles the already-created account', async () => {
  const scratch = await setupScratch(); try {
    const env = setupEnv(scratch.directory), chain = new OfflineSetupChain(env), config = runner.loadSetupConfig(env); chain.loseNextResponse = true;
    await assert.rejects(async () => api.setupTestnet(config, { client: chain.client }), /lost response/i);
    const retained = JSON.parse(await readFile(env.NEAR_SETUP_PATH!, 'utf8')) as { status: string };
    assert.equal(retained.status, 'pending'); await api.setupTestnet(config, { client: chain.client });
    const creations = chain.transactions.flatMap((transaction) => transaction.actions.filter((action) => action.createAccount));
    assert.equal(creations.length, 6); assert.equal(chain.accounts.size, 7);
  } finally { await scratch.cleanup(); }
});
test('bootstrap refuses an existing environment file before contacting the free helper', async () => {
  const scratch = await setupScratch(); try {
    const envPath = resolve(scratch.directory, '.env'); await writeFile(envPath, 'EXISTING_DISPOSABLE_CONFIGURATION=true\n'); let helperCalls = 0;
    await assert.rejects(async () => api.bootstrapTestnet({ directory: scratch.directory, fetchImpl: async () => { helperCalls++; return new Response('{}'); } }), /existing|overwrite|\.env/i);
    assert.equal(helperCalls, 0); assert.equal(await readFile(envPath, 'utf8'), 'EXISTING_DISPOSABLE_CONFIGURATION=true\n');
  } finally { await scratch.cleanup(); }
});

test('free bootstrap persists local owner credentials before the helper and exports public configuration only', async () => {
  const scratch = await setupScratch(); try {
    const chain = new OfflineSetupChain(setupEnv(scratch.directory)); let helperCalls = 0, persisted = false, generatedSecret = '';
    const fetchImpl: typeof fetch = async (url, init) => {
      assert.equal(String(url), 'https://helper.testnet.near.org/account'); helperCalls++;
      const request = JSON.parse(String(init?.body)) as { newAccountId: string; newAccountPublicKey: string };
      const manifest = JSON.parse(await readFile(resolve(scratch.directory, '.local', 'bootstrap.json'), 'utf8')) as { operatorId: string; key: { privateKey: string; publicKey: string } };
      assert.equal(manifest.operatorId, request.newAccountId); assert.equal(manifest.key.publicKey, request.newAccountPublicKey);
      generatedSecret = manifest.key.privateKey; persisted = (await readFile(resolve(scratch.directory, '.env'), 'utf8')).includes(generatedSecret);
      chain.accounts.set(request.newAccountId, { amount: 10000000000000000000000000n, codeHash: '11111111111111111111111111111111', keys: new Map([[request.newAccountPublicKey, { nonce: 1000n, permission: 'FullAccess' }]]) });
      return new Response(JSON.stringify({ status: 'created' }));
    };
    let result: Awaited<ReturnType<NewRunner['bootstrapTestnet']>> | undefined;
    await assert.doesNotReject(async () => { result = await api.bootstrapTestnet({ directory: scratch.directory, fetchImpl, client: chain.client }); });
    assert.equal(helperCalls, 1); assert.equal(persisted, true); assert.match(result!.operatorId, /^nrl-[a-f0-9]+\.testnet$/);
    assert.equal(JSON.stringify(result).includes(generatedSecret), false);
  } finally { await scratch.cleanup(); }
});

test('setup summary redacts every known generated secret even inside recognized public block signatures', async () => {
  const scratch = await setupScratch(); try {
    const env = setupEnv(scratch.directory), chain = new OfflineSetupChain(env); let secret = '';
    chain.beforeMutation = async () => {
      if (secret) return;
      const manifest = JSON.parse(await readFile(env.NEAR_SETUP_PATH!, 'utf8')) as { fixtures: { guarded: { workers: { privateKey: string }[] } } };
      secret = manifest.fixtures.guarded.workers[1]!.privateKey;
      chain.client.records.push({ method: 'block', params: { block_id: 'offline-public-block' }, requestedAt: new Date().toISOString(), receivedAt: new Date().toISOString(),
        response: { jsonrpc: '2.0', id: 'offline', result: { author: 'offline-validator.testnet', chunks: [], header: { hash: 'offline-public-block', height: 1, signature: secret } } } });
    };
    const summary = await api.setupTestnet(runner.loadSetupConfig(env), { client: chain.client });
    assert.ok(secret); assert.equal(JSON.stringify(summary).includes(secret), false); assert.equal(JSON.stringify(summary).includes('[REDACTED]'), true);
  } finally { await scratch.cleanup(); }
});

test('legacy missing-key query results install all four restricted workers and a rerun reuses them', async () => {
  const scratch = await setupScratch(); try {
    const env = setupEnv(scratch.directory), chain = new OfflineSetupChain(env), config = runner.loadSetupConfig(env); chain.legacyMissingKeys = true;
    await assert.doesNotReject(api.setupTestnet(config, { client: chain.client }));
    const workerActions = chain.transactions.flatMap((transaction) => transaction.actions.filter((action) => action.addKey?.accessKey.permission.functionCall));
    assert.equal(workerActions.length, 4); assert.equal(chain.accounts.get(config.operatorId)!.keys.size, 5);
    assert.ok(chain.client.records.some((record) => record.error?.code === 'UNKNOWN_ACCESS_KEY' && record.response !== null));
    const manifest = await readFile(config.setupPath, 'utf8'), count = chain.transactions.length;
    await api.setupTestnet(config, { client: chain.client });
    assert.equal(chain.transactions.length, count); assert.equal(await readFile(config.setupPath, 'utf8'), manifest);
  } finally { await scratch.cleanup(); }
});

test('legacy worker installation resumes a pending unsafe-only setup with the same persisted keys', async () => {
  const scratch = await setupScratch(); try {
    const env = setupEnv(scratch.directory), chain = new OfflineSetupChain(env), config = runner.loadSetupConfig(env); chain.legacyMissingKeys = true;
    chain.beforeMutation = async () => { if (chain.transactions.length === 3) throw new Error('Offline interruption before first worker installation.'); };
    await assert.rejects(api.setupTestnet(config, { client: chain.client }), /Offline interruption/);
    const pending = JSON.parse(await readFile(config.setupPath, 'utf8')) as runner.LocalTestnetSetup;
    assert.equal(pending.status, 'pending'); assert.equal(chain.accounts.size, 4);
    chain.beforeMutation = undefined;
    await api.setupTestnet(config, { client: chain.client });
    const ready = JSON.parse(await readFile(config.setupPath, 'utf8')) as runner.LocalTestnetSetup;
    assert.deepEqual(ready.fixtures, pending.fixtures); assert.equal(ready.status, 'ready');
    assert.equal(chain.transactions.flatMap((transaction) => transaction.actions.filter((action) => action.createAccount)).length, 6);
    assert.equal(chain.transactions.flatMap((transaction) => transaction.actions.filter((action) => action.addKey?.accessKey.permission.functionCall)).length, 4);
  } finally { await scratch.cleanup(); }
});

test('a legacy permission error keeps setup pending without installing worker keys', async () => {
  const scratch = await setupScratch(); try {
    const env = setupEnv(scratch.directory), chain = new OfflineSetupChain(env), config = runner.loadSetupConfig(env);
    chain.legacyMissingKeys = true; chain.legacyMissingKeyMessage = 'Worker access key permission is not authorized.';
    await assert.rejects(api.setupTestnet(config, { client: chain.client }), (error: unknown) => error instanceof RpcRequestError && error.publicError.code === 'LEGACY_QUERY_ERROR');
    assert.equal(chain.transactions.flatMap((transaction) => transaction.actions.filter((action) => action.addKey?.accessKey.permission.functionCall)).length, 0);
    assert.equal((JSON.parse(await readFile(config.setupPath, 'utf8')) as runner.LocalTestnetSetup).status, 'pending');
  } finally { await scratch.cleanup(); }
});

for (const result of [null, true]) test(`a ${String(result)} access-key response cannot be interpreted as permission to install a worker`, async () => {
  const scratch = await setupScratch(); try {
    const env = setupEnv(scratch.directory), chain = new OfflineSetupChain(env), config = runner.loadSetupConfig(env); chain.malformedMissingKeyResult = result;
    await assert.rejects(api.setupTestnet(config, { client: chain.client }), (error: unknown) => error instanceof RpcRequestError && error.publicError.code === 'INVALID_ACCESS_KEY_RESPONSE');
    assert.equal(chain.transactions.flatMap((transaction) => transaction.actions.filter((action) => action.addKey?.accessKey.permission.functionCall)).length, 0);
    assert.equal((JSON.parse(await readFile(config.setupPath, 'utf8')) as runner.LocalTestnetSetup).status, 'pending');
  } finally { await scratch.cleanup(); }
});

test('an UNKNOWN_ACCOUNT query error is not missing-key evidence and cannot authorize worker installation', async () => {
  const scratch = await setupScratch(); try {
    const env = setupEnv(scratch.directory), chain = new OfflineSetupChain(env), config = runner.loadSetupConfig(env); chain.missingKeyErrorCode = 'UNKNOWN_ACCOUNT';
    await assert.rejects(api.setupTestnet(config, { client: chain.client }), (error: unknown) => error instanceof RpcRequestError && error.publicError.code === 'UNKNOWN_ACCOUNT');
    assert.equal(chain.transactions.flatMap((transaction) => transaction.actions.filter((action) => action.addKey?.accessKey.permission.functionCall)).length, 0);
  } finally { await scratch.cleanup(); }
});

for (const allowance of ['50000000000000000000000', '0']) test(`setup atomically renews a ${allowance} worker allowance with the same persisted key`, async () => {
  const scratch = await setupScratch(); try {
    const env = setupEnv(scratch.directory), chain = new OfflineSetupChain(env), config = runner.loadSetupConfig(env);
    await api.setupTestnet(config, { client: chain.client });
    const original = JSON.parse(await readFile(config.setupPath, 'utf8')) as runner.LocalTestnetSetup;
    const fixture = original.fixtures.unsafe, worker = fixture.workers[0], key = chain.accounts.get(config.operatorId)!.keys.get(worker.publicKey)!;
    (key.permission as { FunctionCall: { allowance: string } }).FunctionCall.allowance = allowance; key.nonce = 1000n;
    const before = chain.transactions.length;
    chain.beforeMutation = async () => {
      const pending = JSON.parse(await readFile(config.setupPath, 'utf8')) as runner.LocalTestnetSetup;
      assert.equal(pending.status, 'pending'); assert.deepEqual(pending.fixtures, original.fixtures);
    };
    await api.setupTestnet(config, { client: chain.client });
    assert.equal(chain.transactions.length, before + 1);
    const repair = chain.transactions.at(-1)!;
    assert.equal(repair.signerId, config.operatorId); assert.equal(repair.receiverId, config.operatorId);
    assert.equal(repair.actions.length, 2); assert.ok(repair.actions[0]!.deleteKey); assert.ok(repair.actions[1]!.addKey);
    assert.deepEqual(repair.actions[0]!.deleteKey!.publicKey, repair.actions[1]!.addKey!.publicKey);
    const installed = chain.accounts.get(config.operatorId)!.keys.get(worker.publicKey)!;
    assert.deepEqual(installed.permission, { FunctionCall: { receiver_id: fixture.accountId, method_names: ['pay'], allowance: '2000000000000000000000000' } });
    assert.ok(installed.nonce >= 1001n, 'The previously signed one-shot nonce must be invalid after renewal.');
    const ready = JSON.parse(await readFile(config.setupPath, 'utf8')) as runner.LocalTestnetSetup;
    assert.equal(ready.status, 'ready'); assert.deepEqual(ready.fixtures, original.fixtures);
  } finally { await scratch.cleanup(); }
});

test('setup reuses a consumed but adequate worker allowance without resetting its nonce or budget', async () => {
  const scratch = await setupScratch(); try {
    const env = setupEnv(scratch.directory), chain = new OfflineSetupChain(env), config = runner.loadSetupConfig(env);
    await api.setupTestnet(config, { client: chain.client });
    const original = await readFile(config.setupPath, 'utf8'), setup = JSON.parse(original) as runner.LocalTestnetSetup;
    const key = chain.accounts.get(config.operatorId)!.keys.get(setup.fixtures.guarded.workers[0].publicKey)!;
    (key.permission as { FunctionCall: { allowance: string } }).FunctionCall.allowance = '1000000000000000000000000';
    const nonce = key.nonce, before = chain.transactions.length;
    await api.setupTestnet(config, { client: chain.client });
    assert.equal(chain.transactions.length, before); assert.equal(key.nonce, nonce);
    assert.equal((key.permission as { FunctionCall: { allowance: string } }).FunctionCall.allowance, '1000000000000000000000000');
    assert.equal(await readFile(config.setupPath, 'utf8'), original);
  } finally { await scratch.cleanup(); }
});

test('lost renewal response resumes pending setup with the same keys and no duplicate renewal', async () => {
  const scratch = await setupScratch(); try {
    const env = setupEnv(scratch.directory), chain = new OfflineSetupChain(env), config = runner.loadSetupConfig(env);
    await api.setupTestnet(config, { client: chain.client });
    const original = JSON.parse(await readFile(config.setupPath, 'utf8')) as runner.LocalTestnetSetup;
    const key = chain.accounts.get(config.operatorId)!.keys.get(original.fixtures.unsafe.workers[0].publicKey)!;
    (key.permission as { FunctionCall: { allowance: string } }).FunctionCall.allowance = '50000000000000000000000'; key.nonce = 1000n;
    chain.loseNextResponse = true;
    await assert.rejects(api.setupTestnet(config, { client: chain.client }), /lost response/i);
    const pending = JSON.parse(await readFile(config.setupPath, 'utf8')) as runner.LocalTestnetSetup;
    assert.equal(pending.status, 'pending'); assert.deepEqual(pending.fixtures, original.fixtures);
    const before = chain.transactions.length;
    await api.setupTestnet(config, { client: chain.client });
    assert.equal(chain.transactions.length, before);
    const ready = JSON.parse(await readFile(config.setupPath, 'utf8')) as runner.LocalTestnetSetup;
    assert.equal(ready.status, 'ready'); assert.deepEqual(ready.fixtures, original.fixtures);
  } finally { await scratch.cleanup(); }
});

test('a missing worker on a ready setup becomes pending before installation and resumes a lost response', async () => {
  const scratch = await setupScratch(); try {
    const env = setupEnv(scratch.directory), chain = new OfflineSetupChain(env), config = runner.loadSetupConfig(env);
    await api.setupTestnet(config, { client: chain.client });
    const original = JSON.parse(await readFile(config.setupPath, 'utf8')) as runner.LocalTestnetSetup;
    const publicKey = original.fixtures.guarded.workers[1].publicKey;
    assert.equal(chain.accounts.get(config.operatorId)!.keys.delete(publicKey), true);
    chain.beforeMutation = async () => {
      const pending = JSON.parse(await readFile(config.setupPath, 'utf8')) as runner.LocalTestnetSetup;
      assert.equal(pending.status, 'pending'); assert.deepEqual(pending.fixtures, original.fixtures);
    };
    chain.loseNextResponse = true;
    await assert.rejects(api.setupTestnet(config, { client: chain.client }), /lost response/i);
    assert.equal((JSON.parse(await readFile(config.setupPath, 'utf8')) as runner.LocalTestnetSetup).status, 'pending');
    const before = chain.transactions.length;
    await api.setupTestnet(config, { client: chain.client });
    assert.equal(chain.transactions.length, before); assert.ok(chain.accounts.get(config.operatorId)!.keys.has(publicKey));
    const ready = JSON.parse(await readFile(config.setupPath, 'utf8')) as runner.LocalTestnetSetup;
    assert.equal(ready.status, 'ready'); assert.deepEqual(ready.fixtures, original.fixtures);
  } finally { await scratch.cleanup(); }
});

test('renewal with a non-advancing nonce stays pending even after a lost response and resume', async () => {
  const scratch = await setupScratch(); try {
    const env = setupEnv(scratch.directory), chain = new OfflineSetupChain(env), config = runner.loadSetupConfig(env);
    await api.setupTestnet(config, { client: chain.client });
    const setup = JSON.parse(await readFile(config.setupPath, 'utf8')) as runner.LocalTestnetSetup;
    const key = chain.accounts.get(config.operatorId)!.keys.get(setup.fixtures.unsafe.workers[0].publicKey)!;
    (key.permission as { FunctionCall: { allowance: string } }).FunctionCall.allowance = '50000000000000000000000'; key.nonce = 1000n;
    chain.renewedNonce = 1000n; chain.loseNextResponse = true;
    await assert.rejects(api.setupTestnet(config, { client: chain.client }), /lost response/i);
    const before = chain.transactions.length;
    await assert.rejects(api.setupTestnet(config, { client: chain.client }), /nonce|advance/i);
    assert.equal(chain.transactions.length, before);
    assert.equal((JSON.parse(await readFile(config.setupPath, 'utf8')) as runner.LocalTestnetSetup).status, 'pending');
  } finally { await scratch.cleanup(); }
});

for (const malformed of ['full-access', 'unlimited', 'receiver', 'methods', 'leading-zero', 'overflow', 'extra-permission', 'extra-field', 'unsafe-nonce', 'negative-nonce'] as const) test(`setup refuses ${malformed} worker metadata without renewal`, async () => {
  const scratch = await setupScratch(); try {
    const env = setupEnv(scratch.directory), chain = new OfflineSetupChain(env), config = runner.loadSetupConfig(env);
    await api.setupTestnet(config, { client: chain.client });
    const setup = JSON.parse(await readFile(config.setupPath, 'utf8')) as runner.LocalTestnetSetup;
    const key = chain.accounts.get(config.operatorId)!.keys.get(setup.fixtures.unsafe.workers[0].publicKey)!;
    const permission = key.permission as { FunctionCall: { receiver_id: string; method_names: string[]; allowance: string | null; extra?: boolean }; extra?: boolean };
    permission.FunctionCall.allowance = '50000000000000000000000';
    if (malformed === 'unlimited') permission.FunctionCall.allowance = null;
    if (malformed === 'receiver') permission.FunctionCall.receiver_id = setup.fixtures.guarded.accountId;
    if (malformed === 'methods') permission.FunctionCall.method_names = ['pay', 'approve'];
    if (malformed === 'leading-zero') permission.FunctionCall.allowance = '050000000000000000000000';
    if (malformed === 'overflow') permission.FunctionCall.allowance = (1n << 128n).toString();
    if (malformed === 'extra-permission') permission.extra = true;
    if (malformed === 'extra-field') permission.FunctionCall.extra = true;
    if (malformed === 'full-access') key.permission = 'FullAccess';
    if (malformed === 'unsafe-nonce') key.nonce = 9007199254740993n;
    if (malformed === 'negative-nonce') key.nonce = -1n;
    const before = chain.transactions.length;
    await assert.rejects(api.setupTestnet(config, { client: chain.client }), /worker|permission|allowance|nonce/i);
    assert.equal(chain.transactions.length, before);
    assert.equal((JSON.parse(await readFile(config.setupPath, 'utf8')) as runner.LocalTestnetSetup).status, 'pending');
  } finally { await scratch.cleanup(); }
});

for (const price of ['protocol-floor', 'current-price'] as const) test(`setup rejects a configured budget below the ${price} six-pay reserve before funding`, async () => {
  const scratch = await setupScratch(); try {
    const env = setupEnv(scratch.directory), chain = new OfflineSetupChain(env);
    if (price === 'current-price') chain.gasPrice = '2000000000';
    const config = runner.loadSetupConfig({ ...env, NEAR_WORKER_ALLOWANCE_YOCTO: price === 'current-price' ? '1000000000000000000000000' : '50000000000000000000000' });
    await assert.rejects(api.setupTestnet(config, { client: chain.client }), /allowance|reserve|budget/i);
    assert.equal(chain.transactions.length, 0); assert.equal(chain.accounts.size, 1);
  } finally { await scratch.cleanup(); }
});

test('malformed protocol gas purchase floor cannot authorize setup funding', async () => {
  const scratch = await setupScratch(); try {
    const env = setupEnv(scratch.directory), chain = new OfflineSetupChain(env); chain.minGasPurchasePrice = null;
    await assert.rejects(api.setupTestnet(runner.loadSetupConfig(env), { client: chain.client }), /gas|protocol|floor/i);
    assert.equal(chain.transactions.length, 0);
  } finally { await scratch.cleanup(); }
});
