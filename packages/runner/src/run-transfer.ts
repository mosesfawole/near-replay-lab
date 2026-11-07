import { KeyPairSigner, type KeyPairString } from 'near-api-js';
import { assertRunReport, evaluateTargetEvidence, type PublicError, type RunReport, type TargetReport } from '../../core/src/index.js';
import { broadcastTransaction, NearRpcClient, observeTransactionFinal, queryFinalizedBalance, sanitizePublicEvidence, signTransfer, toPublicError } from '../../near-adapter/src/index.js';
import { loadTransferConfig, type TransferConfig } from './config.js';

export interface RunTransferOptions {
  client?: NearRpcClient;
  checkpoint?: (report: RunReport) => Promise<void>;
  provenance?: RunReport['provenance'];
}

/** Sign locally, checkpoint the hash before broadcast, then collect finalized public evidence. */
export async function runTransfer(input: TransferConfig, options: RunTransferOptions = {}): Promise<RunReport> {
  // Programmatic callers receive the same local validation as the CLI, before any RPC.
  const config = loadTransferConfig({
    NEAR_TESTNET_ACCOUNT_ID: input.signerId, NEAR_TESTNET_PRIVATE_KEY: input.privateKey,
    NEAR_TESTNET_RECIPIENT_ID: input.recipientId, NEAR_RPC_URL: input.rpcUrl,
    NEAR_AMOUNT_YOCTO: input.amountYocto, NEAR_REPORT_PATH: input.reportPath,
  });
  const client = options.client ?? new NearRpcClient({ rpcUrl: config.rpcUrl });
  const createdAt = new Date().toISOString(), runId = crypto.randomUUID();
  const approval = { approvalId: `${runId}:approval`, signerId: config.signerId, recipientId: config.recipientId,
    amountYocto: config.amountYocto, source: 'operator-config' as const, approvedAt: createdAt };
  const target: TargetReport = {
    targetId: 'direct', label: 'Direct transfer', targetKind: 'direct', accountId: config.signerId,
    attempts: [], snapshots: { before: null, after: null },
    verdict: { status: 'INCONCLUSIVE', summary: 'No transaction evidence yet.', reasonCodes: ['NO_ATTEMPTS'], intendedCreditYocto: config.amountYocto,
      observedCreditYocto: null, successfulReceiptCreditYocto: null, transactionHashes: [] },
  };
  const report: RunReport = {
    schemaVersion: '1.0.0', runId, createdAt, network: { networkId: 'testnet', rpcUrl: config.rpcUrl },
    provenance: options.provenance ?? { mode: 'live', description: 'Public RPC evidence captured by the local runner from native NEAR testnet.' },
    versions: { adapter: 'near-api-js@7.4.0', build: '0.1.0' },
    scenarios: [{ scenarioId: 'legitimate-transfer', kind: 'direct-transfer', title: 'Legitimate direct transfer',
      description: 'An operator-configured exact transfer between isolated disposable testnet accounts.', approval, targets: [target] }],
    rpcEvidence: client.records,
  };
  const publicReport = (): RunReport => {
    target.verdict = evaluateTargetEvidence(target, approval);
    return assertRunReport(sanitizePublicEvidence(report, [config.privateKey]));
  };
  const checkpoint = async (): Promise<void> => { if (options.checkpoint) await options.checkpoint(publicReport()); };
  try {
    await checkpoint();
    await client.verifyTestnet();
    target.snapshots.before = await queryFinalizedBalance(client, config.recipientId);
    await checkpoint();
    const signer = KeyPairSigner.fromSecretKey(config.privateKey as KeyPairString);
    const prepared = await signTransfer({ client, signer, signerId: config.signerId, receiverId: config.recipientId, amountYocto: config.amountYocto });
    target.attempts.push(prepared.attempt);
    await checkpoint(); // This must succeed before the first network broadcast.
    await broadcastTransaction(client, prepared);
    await checkpoint();
    await observeTransactionFinal(client, prepared.attempt);
    const minimumHeight = Math.max(target.snapshots.before.block.height, ...prepared.attempt.finalBlocks.map((b) => b.height));
    target.snapshots.after = await queryFinalizedBalance(client, config.recipientId, { minimumHeight });
    await checkpoint();
  } catch (error) {
    target.errors = [...target.errors ?? [], sanitizePublicEvidence(toPublicError(error), [config.privateKey]) as unknown as PublicError];
    await checkpoint();
  }
  return publicReport();
}
