import { validateRunReport, type RunReport } from '../../core/src/index.js';
import { SCENARIO_DEFINITIONS } from '../../../scenarios/definitions.js';
import type { FixtureKind } from './setup.js';

/** A comparison demonstrates the deliberately unsafe failures only with both positive controls. */
export function suiteComparisonExitCode(report: RunReport): number {
  if (!validateRunReport(report).valid || report.scenarios.length !== SCENARIO_DEFINITIONS.length) return 2;
  const seen = new Set<string>();
  for (const definition of SCENARIO_DEFINITIONS) {
    const cases = report.scenarios.filter((scenario) => scenario.kind === definition.kind);
    if (cases.length !== 1) return 2;
    const scenario = cases[0]!;
    if (seen.has(scenario.scenarioId) || scenario.targets.length !== 2) return 2;
    seen.add(scenario.scenarioId);
    for (const kind of ['unsafe', 'guarded'] as const) {
      const targets = scenario.targets.filter((target) => target.targetKind === kind);
      const expected = kind === 'unsafe' && !['fixture-legitimate', 'fixture-expired'].includes(definition.kind) ? 'VIOLATED' : 'HOLDS';
      if (targets.length !== 1 || targets[0]!.verdict.status !== expected) return 2;
    }
  }
  return 0;
}

/** Shape validation alone does not verify a tested target: every selected verdict must hold. */
export function reportVerificationExitCode(report: RunReport, selectedTarget?: FixtureKind): number {
  if (!validateRunReport(report).valid) return 2;
  for (const scenario of report.scenarios) {
    const targets = scenario.targets.filter((target) => selectedTarget === undefined || target.targetKind === selectedTarget);
    if (!targets.length || targets.some((target) => target.verdict.status !== 'HOLDS')) return 2;
  }
  return 0;
}
