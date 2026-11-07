/** JSON boundaries use decimal strings for all yoctoNEAR and nonce values. */
export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };
export const REPORT_SCHEMA_VERSION = '1.0.0' as const;
export type VerdictStatus = 'HOLDS' | 'VIOLATED' | 'INCONCLUSIVE';

export interface PublicError {
  category: 'configuration' | 'transport' | 'timeout' | 'rpc' | 'evidence' | 'local';
  message: string;
  code?: string;
}

/** Complete public JSON-RPC response, including its envelope, or a transport failure. */
export interface RpcEvidence {
  method: string;
  params: JsonValue;
  requestedAt: string;
  receivedAt: string;
  response: JsonValue | null;
  error?: PublicError;
}

export interface FinalBlockReference {
  hash: string;
  height: number;
  finality: 'FINAL';
  evidence?: RpcEvidence;
}

export interface RecipientSnapshot {
  recipientId: string;
  amountYocto: string;
  lockedYocto: string;
  queriedAt: string;
  block: FinalBlockReference;
  evidence: RpcEvidence;
}

export interface BalanceSnapshots {
  before: RecipientSnapshot | null;
  after: RecipientSnapshot | null;
}

export interface PublicAction {
  kind: 'transfer' | 'function-call';
  amountYocto: string;
  methodName?: string;
  args?: JsonValue;
  gas?: string;
}

/** Signed bytes and private key material intentionally have no field in this type. */
export interface TransactionAttempt {
  attemptId: string;
  actionKind: 'transfer' | 'function-call';
  signerId: string;
  publicKey: string;
  receiverId: string;
  amountYocto: string;
  nonce: string;
  txHash: string;
  signedAt: string;
  actions: PublicAction[];
  broadcast: RpcEvidence | null;
  observations: RpcEvidence[];
  finalOutcome: JsonValue | null;
  finalBlocks: FinalBlockReference[];
  /** Only unresolved errors live here; a broadcast error remains in broadcast evidence. */
  error?: PublicError;
}

export interface ApprovalDetails {
  approvalId: string;
  signerId: string;
  recipientId: string;
  amountYocto: string;
  source: 'operator-config' | 'constructed-fixture' | 'on-chain';
  approvedAt: string;
  expiresAt?: string;
  invoiceId?: string;
  evidence?: RpcEvidence;
}

export interface ContractStateSnapshot {
  contractId: string;
  methodName: string;
  args: JsonValue;
  value: JsonValue;
  block: FinalBlockReference;
  evidence: RpcEvidence;
}

export interface TargetEvidence {
  targetId: string;
  label: string;
  targetKind: 'direct' | 'unsafe' | 'guarded';
  accountId: string;
  attempts: TransactionAttempt[];
  snapshots: BalanceSnapshots & { relatedAccounts?: Record<string, BalanceSnapshots> };
  stateSnapshots?: ContractStateSnapshot[];
  errors?: PublicError[];
}

export interface TargetVerdict {
  status: VerdictStatus;
  summary: string;
  reasonCodes: string[];
  intendedCreditYocto: string;
  observedCreditYocto: string | null;
  successfulReceiptCreditYocto: string | null;
  transactionHashes: string[];
}

export interface TargetReport extends TargetEvidence {
  /** Fixture comparisons use dedicated recipients and an isolated obligation per target. */
  approval?: ApprovalDetails;
  verdict: TargetVerdict;
}

/** Derived by report validation; a stored verdict or caller-supplied success flag is never a control. */
export interface ScenarioEvaluationContext {
  kind: string;
  legitimateControl?: { target: TargetEvidence; approval: ApprovalDetails };
}

export interface ScenarioReport {
  scenarioId: string;
  title: string;
  kind: string;
  description: string;
  approval: ApprovalDetails;
  targets: TargetReport[];
}

export interface RunReport {
  schemaVersion: typeof REPORT_SCHEMA_VERSION;
  runId: string;
  createdAt: string;
  network: { networkId: 'testnet'; rpcUrl: string };
  provenance: { mode: 'live' | 'recorded' | 'synthetic'; description: string };
  versions: { adapter: string; build: string };
  scenarios: ScenarioReport[];
  /** Includes status, access-key queries, errors and block queries, even before signing. */
  rpcEvidence: RpcEvidence[];
}

export type ReportValidation =
  | { valid: true; errors: []; report: RunReport }
  | { valid: false; errors: string[] };
