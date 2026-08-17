import { PowerClaimId } from '../src/types.ts'
import type { PowerAnalysisSnapshot } from '../src/types.ts'

/** Build one valid, deterministic report for package tests. */
export function validSnapshot(overrides: Partial<PowerAnalysisSnapshot> = {}): PowerAnalysisSnapshot {
  return {
    schemaVersion: 1,
    workflow: 'review',
    mode: 'review',
    status: 'in_progress',
    task: 'Review the PWM enable path',
    summary: 'The enable owner was located in source; runtime behavior remains unmeasured.',
    claims: [{
      id: PowerClaimId('claim-enable-owner'),
      label: 'VERIFIED_FACT',
      statement: 'The enable function is declared in control.c.',
      evidence: [{ kind: 'source_code', artifact: 'src/control.c', locator: 'line 42', revision: 'abc1234' }],
    }],
    findings: [{
      severity: 'info',
      title: 'Enable owner located',
      location: 'src/control.c:42',
      claimIds: [PowerClaimId('claim-enable-owner')],
      impact: 'The physical execution owner can be reviewed from one entry point.',
      recommendation: 'Inspect callers and protection gates before proposing a change.',
      verification: 'Trace every call site and record exact source locations.',
    }],
    unknowns: ['Target timing and hardware behavior have not been measured.'],
    build: { declaration: 'not-run', receipt: null, reason: 'This report is read-only.' },
    compatibility: {
      api: 'unchanged',
      abi: 'unchanged',
      nvm: 'unchanged',
      notes: ['No interface or persistence edit is part of this report.'],
    },
    safetyBoundary: {
      targetBoardExecution: 'not-performed',
      powerStageOperation: 'not-performed',
      physicalActuation: 'not-performed',
      nvmClear: 'not-performed',
      targetAuthorization: 'not-granted',
      safetyParametersChanged: false,
      safetyParameterChanges: [],
    },
    startedAt: '2026-08-17T00:00:00.000Z',
    updatedAt: '2026-08-17T00:01:00.000Z',
    ...overrides,
  }
}
