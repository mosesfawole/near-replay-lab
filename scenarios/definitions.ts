export const SCENARIO_DEFINITIONS = [
  { kind: 'fixture-legitimate', title: 'Legitimate approved payment', description: 'A constructed canonical obligation is approved by the disposable operator and paid once through an authorized worker.' },
  { kind: 'fixture-expired', title: 'Expired approval control', description: 'The operator approves while valid. The runner waits for finalized chain timestamps to reach expiry, then submits the canonical payment.' },
  { kind: 'recipient-substitution', title: 'Recipient substitution', description: 'A constructed hostile proposal substitutes the dedicated alternate recipient while remaining within the shared generic recipient allowlist and amount cap.' },
  { kind: 'lost-response-retry', title: 'Discarded response and duplicate retry', description: 'Constructed transport fault injection discards the first broadcast response. After the saved hash, callback and exact first credit are proven through FINAL, the runner deliberately signs a fresh-nonce duplicate proposal.' },
  { kind: 'concurrent-duplicates', title: 'Concurrent independent-key duplicates', description: 'Two constructed duplicate proposals for one obligation are signed with independent restricted worker keys and broadcast concurrently.' },
] as const;

export type FixtureScenarioKind = typeof SCENARIO_DEFINITIONS[number]['kind'];
