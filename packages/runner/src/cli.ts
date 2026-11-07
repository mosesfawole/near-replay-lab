import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { RunReport } from '../../core/src/index.js';
import { sanitizePublicEvidence, toPublicError } from '../../near-adapter/src/index.js';
import { loadTransferConfig } from './config.js';
import { bootstrapTestnet } from './bootstrap.js';
import { inspectRunReport, writeRunReport } from './reports.js';
import { runSuite } from './run-suite.js';
import { runTransfer } from './run-transfer.js';
import { setupTestnet, validateWasmFiles, type FixtureKind } from './setup.js';
import { loadSetupConfig, loadSuiteConfig, loadWasmCheckConfig } from './suite-config.js';
import { reportVerificationExitCode, suiteComparisonExitCode } from './verdict-exits.js';

export const HELP = `NEAR Replay Lab — native testnet payment evidence

  npm run build:runner
  npm run cli -- help
  npm run cli -- bootstrap
  npm run cli -- setup --check
  npm run cli -- setup
  npm run cli -- transfer
  npm run cli -- suite
  npm run cli -- suite --target guarded
  npm run cli -- inspect <report.json>
  npm run cli -- validate <report.json>
  npm run cli -- verify <report.json> [unsafe|guarded]

Transfer reads NEAR_TESTNET_ACCOUNT_ID, NEAR_TESTNET_PRIVATE_KEY,
NEAR_TESTNET_RECIPIENT_ID, NEAR_RPC_URL, NEAR_AMOUNT_YOCTO and
NEAR_REPORT_PATH. Copy .env.example to .env and use isolated disposable
testnet accounts. Default amount is 1000000000000000000000 yoctoNEAR.
RPC defaults to https://test.rpc.fastnear.com. Signing stays local.

Bootstrap uses the free testnet helper and exclusively creates a new .env;
it refuses an existing .env. Setup validates res/unsafe_vault.wasm and
res/guarded_vault.wasm before funding fixtures or writing generated keys.
Setup --check is local, reads no operator credential and makes no RPC call.
Generated fixture/worker keys stay in .local/testnet-setup.json.
Suite uses the same operator and local setup, fixed 0.001 NEAR payments,
fresh invoice IDs, dedicated recipients and two independent worker keys.

The runner saves the signed hash before broadcast, observes only that hash
through FINAL, and records complete public RPC evidence on failure.
Transfer exits 0 only for HOLDS; VIOLATED or INCONCLUSIVE exits 2.
Suite exits 0 only for the complete five-case comparison: both controls
HOLDS, all three unsafe attacks VIOLATED and all three guarded attacks
HOLDS. Suite always captures both fixtures; --target selects strict target
verification for its exit code. Verify exits 2 if any selected verdict is
VIOLATED or INCONCLUSIVE. Inspect/validate/verify make no RPC calls.
Inspect/validate exits 0 for valid shape and freshly derived verdicts.
`;

function summarize(report: RunReport, selectedTarget?: FixtureKind): void {
  console.log(`Run ${report.runId} · ${report.network.networkId} · ${report.provenance.mode}`);
  for (const scenario of report.scenarios) for (const target of scenario.targets) {
    if (selectedTarget !== undefined && target.targetKind !== selectedTarget) continue;
    console.log(`${target.verdict.status} ${scenario.scenarioId}/${target.targetId}`);
    console.log(`Approved ${target.verdict.intendedCreditYocto} yoctoNEAR; observed ${target.verdict.observedCreditYocto ?? 'unknown'} yoctoNEAR.`);
    for (const hash of target.verdict.transactionHashes) console.log(`Transaction ${hash}`);
    console.log(target.verdict.summary);
  }
}

export async function main(args: string[] = process.argv.slice(2)): Promise<number> {
  const command = args[0] ?? 'help';
  if (['help', '--help', '-h'].includes(command)) { console.log(HELP); return 0; }
  if (command === 'inspect' || command === 'validate') {
    if (args.length !== 2 || !args[1]) throw new Error('Usage: npm run cli -- inspect <report.json>');
    const report = await inspectRunReport(args[1]); summarize(report); console.log('Report schema and derived verdicts are valid.'); return 0;
  }
  if (command === 'verify') {
    if (args.length < 2 || args.length > 3 || !args[1] || (args[2] !== undefined && !['unsafe', 'guarded'].includes(args[2]))) throw new Error('Usage: npm run cli -- verify <report.json> [unsafe|guarded]');
    const report = await inspectRunReport(args[1]), selected = args[2] as FixtureKind | undefined;
    summarize(report, selected); return reportVerificationExitCode(report, selected);
  }
  if (command === 'bootstrap' && args.length === 1) {
    const result = await bootstrapTestnet(); console.log(`Disposable operator ${result.operatorId}`); console.log(`Finalized balance ${result.balanceYocto} yoctoNEAR.`);
    console.log(`Local environment ${result.envPath}`); return 0;
  }
  if (command === 'setup' && args.length === 2 && args[1] === '--check') {
    const artifacts = await validateWasmFiles(loadWasmCheckConfig(process.env));
    for (const [kind, artifact] of Object.entries(artifacts)) console.log(`Validated ${kind} Wasm: ${artifact.bytes.length} bytes · ${artifact.hash}`);
    return 0;
  }
  if (command === 'setup' && args.length === 1) {
    const result = await setupTestnet(loadSetupConfig(process.env));
    console.log(`Ready disposable fixtures for ${result.operatorId}`);
    for (const fixture of result.fixtures) console.log(`${fixture.kind} ${fixture.accountId} · canonical ${fixture.canonicalRecipientId} · alternate ${fixture.substitutedRecipientId} · Wasm ${fixture.wasmHash}`);
    console.log(`Local generated keys ${result.setupPath}`); return 0;
  }
  if (command === 'suite') {
    if (!(args.length === 1 || (args.length === 3 && args[1] === '--target' && ['unsafe', 'guarded'].includes(args[2]!)))) throw new Error('Usage: npm run cli -- suite [--target unsafe|guarded]');
    const selected = args[2] as FixtureKind | undefined, config = loadSuiteConfig(process.env);
    const report = await runSuite(config, { checkpoint: (value) => writeRunReport(config.reportPath, value), progress: (event) => {
      console.log(`${event.event} ${event.scenarioId}/${event.targetKind}${event.txHash ? ` ${event.txHash}` : ''}`);
    } });
    summarize(report, selected); console.log(`Report ${config.reportPath}`);
    return selected === undefined ? suiteComparisonExitCode(report) : reportVerificationExitCode(report, selected);
  }
  if (command !== 'transfer' || args.length !== 1) throw new Error('Unknown command. Run npm run cli -- help.');
  const config = loadTransferConfig(process.env);
  await mkdir(dirname(config.reportPath), { recursive: true });
  const report = await runTransfer(config, { checkpoint: (r) => writeRunReport(config.reportPath, r) });
  summarize(report); console.log(`Report ${config.reportPath}`);
  return reportVerificationExitCode(report);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { process.exitCode = await main(); }
  catch (error) {
    const message = sanitizePublicEvidence(toPublicError(error).message, [process.env.NEAR_TESTNET_PRIVATE_KEY ?? '']);
    console.error(`Error: ${message}`); process.exitCode = 1;
  }
}
