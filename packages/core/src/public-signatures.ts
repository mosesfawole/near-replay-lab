type Obj = Record<string, unknown>;
const transactionMethods = new Set(['tx', 'tx_status', 'EXPERIMENTAL_tx_status', 'send_tx']);
const executionStatuses = new Set(['NONE', 'INCLUDED', 'EXECUTED_OPTIMISTIC', 'INCLUDED_FINAL', 'EXECUTED', 'FINAL']);
function object(value: unknown): Obj | undefined { return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Obj : undefined; }
function array(value: unknown): unknown[] { return Array.isArray(value) ? value : []; }

/** Exact public signature slots in recognized NEAR results, envelopes or RunReport evidence. */
export function publicSignaturePaths(input: unknown): ReadonlySet<string> {
  const paths = new Set<string>();
  const permit = (path: string[]) => paths.add(JSON.stringify(path));
  const transaction = (value: unknown, path: string[]): void => {
    const result = object(value), tx = object(result?.transaction);
    if (!result || !tx || !['hash', 'signer_id', 'receiver_id', 'public_key'].every((key) => typeof tx[key] === 'string')
      || !Array.isArray(tx.actions) || !('nonce' in tx)) return;
    const status = typeof result.final_execution_status === 'string' && executionStatuses.has(result.final_execution_status);
    const outcome = object(result.status) && object(result.transaction_outcome) && Array.isArray(result.receipts_outcome);
    if (status || outcome) permit([...path, 'transaction', 'signature']);
  };
  const block = (value: unknown, path: string[]): void => {
    const result = object(value), header = object(result?.header);
    if (!result || typeof result.author !== 'string' || !header || typeof header.hash !== 'string'
      || !Number.isSafeInteger(header.height) || !Array.isArray(result.chunks)) return;
    permit([...path, 'header', 'signature']);
    array(header.approvals).forEach((approval, i) => { if (typeof approval === 'string') permit([...path, 'header', 'approvals', String(i)]); });
    result.chunks.forEach((value, i) => {
      const chunk = object(value);
      if (chunk && typeof chunk.chunk_hash === 'string' && Number.isSafeInteger(chunk.height_created)) permit([...path, 'chunks', String(i), 'signature']);
    });
  };
  const envelope = (value: unknown, path: string[], kind?: 'transaction' | 'block'): void => {
    const body = object(value);
    if (body?.jsonrpc !== '2.0') return;
    if (kind !== 'block') transaction(body.result, [...path, 'result']);
    if (kind !== 'transaction') block(body.result, [...path, 'result']);
  };
  const rpc = (value: unknown, path: string[]): void => {
    const record = object(value);
    if (record?.method === 'block') envelope(record.response, [...path, 'response'], 'block');
    else if (typeof record?.method === 'string' && transactionMethods.has(record.method)) envelope(record.response, [...path, 'response'], 'transaction');
  };
  const blockReference = (value: unknown, path: string[]): void => { rpc(object(value)?.evidence, [...path, 'evidence']); };
  const balances = (value: unknown, path: string[]): void => {
    const pair = object(value);
    for (const side of ['before', 'after']) {
      const snapshot = object(pair?.[side]);
      rpc(snapshot?.evidence, [...path, side, 'evidence']);
      blockReference(snapshot?.block, [...path, side, 'block']);
    }
  };
  const root = object(input);
  if (root?.schemaVersion === '1.0.0') {
    array(root.rpcEvidence).forEach((record, i) => rpc(record, ['rpcEvidence', String(i)]));
    array(root.scenarios).forEach((value, i) => {
      const scenario = object(value), scenarioPath = ['scenarios', String(i)];
      rpc(object(scenario?.approval)?.evidence, [...scenarioPath, 'approval', 'evidence']);
      array(scenario?.targets).forEach((value, j) => {
        const target = object(value), targetPath = [...scenarioPath, 'targets', String(j)];
        array(target?.attempts).forEach((value, k) => {
          const attempt = object(value), attemptPath = [...targetPath, 'attempts', String(k)];
          transaction(attempt?.finalOutcome, [...attemptPath, 'finalOutcome']);
          rpc(attempt?.broadcast, [...attemptPath, 'broadcast']);
          array(attempt?.observations).forEach((record, n) => rpc(record, [...attemptPath, 'observations', String(n)]));
          array(attempt?.finalBlocks).forEach((ref, n) => blockReference(ref, [...attemptPath, 'finalBlocks', String(n)]));
        });
        balances(target?.snapshots, [...targetPath, 'snapshots']);
        const related = object(object(target?.snapshots)?.relatedAccounts);
        for (const [id, pair] of Object.entries(related ?? {})) balances(pair, [...targetPath, 'snapshots', 'relatedAccounts', id]);
        array(target?.stateSnapshots).forEach((value, n) => {
          const state = object(value), statePath = [...targetPath, 'stateSnapshots', String(n)];
          rpc(state?.evidence, [...statePath, 'evidence']); blockReference(state?.block, [...statePath, 'block']);
        });
      });
    });
  } else {
    transaction(input, []); block(input, []); envelope(input, []);
  }
  return paths;
}
