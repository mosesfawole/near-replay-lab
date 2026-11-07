import assert from 'node:assert/strict';
import test from 'node:test';
import { KeyPair } from 'near-api-js';
import * as runner from '../src/index.js';

type ConfigExports = {
  loadSetupConfig: (env: Record<string, string | undefined>) => { operatorId: string; setupPath: string; fixtureFundingYocto: string; recipientFundingYocto: string; workerAllowanceYocto: string };
  loadSuiteConfig: (env: Record<string, string | undefined>) => { operatorId: string; setupPath: string; reportPath: string; amountYocto: string };
};
const api = runner as unknown as ConfigExports;
const values = () => ({ NEAR_TESTNET_ACCOUNT_ID: 'disposable-owner.testnet', NEAR_TESTNET_PRIVATE_KEY: KeyPair.fromRandom('ed25519').toString() });

test('fixture configuration accepts a disposable operator without a direct-transfer recipient', () => {
  let config: ReturnType<ConfigExports['loadSetupConfig']> | undefined;
  assert.doesNotThrow(() => { config = api.loadSetupConfig(values()); });
  assert.equal(config!.operatorId, 'disposable-owner.testnet');
  assert.equal(config!.fixtureFundingYocto, '2000000000000000000000000');
  assert.equal(config!.recipientFundingYocto, '10000000000000000000000');
  assert.equal(config!.workerAllowanceYocto, '2000000000000000000000000');
  assert.match(config!.setupPath, /[\\/]\.local[\\/]testnet-setup\.json$/);
});

test('suite configuration keeps native payments at exactly 0.001 testnet NEAR', () => {
  let config: ReturnType<ConfigExports['loadSuiteConfig']> | undefined;
  assert.doesNotThrow(() => { config = api.loadSuiteConfig(values()); });
  assert.equal(config!.amountYocto, '1000000000000000000000');
  assert.throws(() => api.loadSuiteConfig({ ...values(), NEAR_AMOUNT_YOCTO: '1e21' }), /exact|0\.001|integer/i);
  assert.throws(() => api.loadSuiteConfig({ ...values(), NEAR_AMOUNT_YOCTO: '2000000000000000000000' }), /0\.001|fixed|suite/i);
});

test('setup refuses public or traversal secret-manifest paths before account side effects', () => {
  for (const path of ['examples/setup.json', '.local/../../examples/setup.json', 'reports/local/setup.json']) {
    assert.throws(() => api.loadSetupConfig({ ...values(), NEAR_SETUP_PATH: path }), /\.local|local/i);
  }
  assert.doesNotThrow(() => api.loadSetupConfig({ ...values(), NEAR_SETUP_PATH: '.local/reproduction.json' }));
});

test('fixture funding and gas allowances never accept decimal or negative amounts', () => {
  for (const name of ['NEAR_FIXTURE_FUNDING_YOCTO', 'NEAR_RECIPIENT_FUNDING_YOCTO', 'NEAR_WORKER_ALLOWANCE_YOCTO']) {
    assert.throws(() => api.loadSetupConfig({ ...values(), [name]: '0.1' }), /integer|exact|yocto/i);
    assert.throws(() => api.loadSetupConfig({ ...values(), [name]: '-1' }), /integer|exact|yocto/i);
  }
});

test('fixture setup rejects mainnet configuration and reports no supplied secret', () => {
  const env = values();
  for (const invalid of [{ NEAR_NETWORK_ID: 'mainnet' }, { NEAR_TESTNET_ACCOUNT_ID: 'owner.near' }, { NEAR_RPC_URL: 'https://rpc.mainnet.near.org' }]) {
    let error: unknown;
    try { api.loadSetupConfig({ ...env, ...invalid }); } catch (caught) { error = caught; }
    assert.ok(error instanceof Error);
    assert.match(error.message, /testnet/i);
    assert.equal(error.message.includes(env.NEAR_TESTNET_PRIVATE_KEY), false);
  }
});
