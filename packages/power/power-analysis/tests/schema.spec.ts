import { describe, expect, it } from 'vitest'
import { decodePowerAnalysisSnapshot } from '../src/schema.ts'
import { validSnapshot } from './fixtures.ts'

describe('PowerAnalysisSnapshot validation', () => {
  it('accepts a complete evidence-labelled snapshot', () => {
    expect(decodePowerAnalysisSnapshot(validSnapshot())).toEqual(validSnapshot())
  })

  it.each(['VERIFIED_FACT', 'CODE_INFERENCE'] as const)(
    '%s requires an evidence reference',
    (label) => {
      const snapshot = validSnapshot({
        claims: [{ id: 'claim-1' as never, label, statement: 'A claim.', evidence: [] }],
        findings: [],
      })
      expect(() => decodePowerAnalysisSnapshot(snapshot)).toThrow(/requires at least one evidence reference/)
    },
  )

  it('requires engineering judgment basis and pending verification', () => {
    const snapshot = validSnapshot({
      claims: [{ id: 'claim-1' as never, label: 'ENGINEERING_JUDGMENT', statement: 'A trade-off.', evidence: [] }],
      findings: [],
    })
    expect(() => decodePowerAnalysisSnapshot(snapshot)).toThrow(/requires a basis/)
  })

  it('requires every finding to reference a declared claim', () => {
    const snapshot = validSnapshot()
    const finding = snapshot.findings[0]
    if (finding === undefined) throw new Error('fixture lacks finding')
    expect(() => decodePowerAnalysisSnapshot({
      ...snapshot,
      findings: [{ ...finding, claimIds: ['missing'] }],
    })).toThrow(/unknown claim id/)
  })

  it('rejects duplicate claim ids and an unknown without pending verification', () => {
    const snapshot = validSnapshot()
    const claim = snapshot.claims[0]
    if (claim === undefined) throw new Error('fixture lacks claim')
    expect(() => decodePowerAnalysisSnapshot({
      ...snapshot,
      claims: [claim, { ...claim }],
    })).toThrow(/duplicate claim id/)
    expect(() => decodePowerAnalysisSnapshot({
      ...snapshot,
      claims: [{ id: 'unknown-1', label: 'UNKNOWN', statement: 'Timing is unknown.', evidence: [] }],
      findings: [],
    })).toThrow(/UNKNOWN requires pending verification/)
  })

  it('accepts compiled only with a complete successful receipt', () => {
    const snapshot = validSnapshot({
      workflow: 'fix',
      mode: 'fix',
      build: {
        declaration: 'compiled',
        receipt: {
          status: 'success',
          exitCode: 0,
          command: 'pnpm run build',
          workingDirectory: 'D:/work/repo',
          startedAt: '2026-08-17T00:02:00.000Z',
          finishedAt: '2026-08-17T00:03:00.000Z',
          revision: 'abc1234',
          worktreeState: 'dirty',
          summary: 'Build exited successfully.',
        },
      },
    })
    expect(decodePowerAnalysisSnapshot(snapshot).build.declaration).toBe('compiled')
    expect(() => decodePowerAnalysisSnapshot({
      ...snapshot,
      build: { declaration: 'compiled', receipt: { ...snapshot.build.receipt, exitCode: 1 } },
    })).toThrow()
  })

  it('rejects reversed build timestamps and incomplete breaking compatibility', () => {
    const base = validSnapshot({ workflow: 'fix', mode: 'fix' })
    const receipt = {
      status: 'failed' as const,
      exitCode: 1,
      command: 'pnpm run build',
      workingDirectory: 'D:/work/repo',
      startedAt: '2026-08-17T00:04:00.000Z',
      finishedAt: '2026-08-17T00:03:00.000Z',
      revision: 'abc1234',
      worktreeState: 'clean',
      summary: 'Compiler rejected the source.',
    }
    expect(() => decodePowerAnalysisSnapshot({
      ...base,
      build: { declaration: 'failed', receipt },
    })).toThrow(/must not precede/)
    expect(() => decodePowerAnalysisSnapshot({
      ...base,
      compatibility: { api: 'breaking-change', abi: 'unknown', nvm: 'unknown', notes: [] },
    })).toThrow(/migration plan/)
  })

  it('fixes workflow mode and safety-change disclosure are internally consistent', () => {
    expect(() => decodePowerAnalysisSnapshot(validSnapshot({ workflow: 'fix', mode: 'review' }))).toThrow(/requires fix mode/)
    expect(() => decodePowerAnalysisSnapshot(validSnapshot({
      safetyBoundary: { ...validSnapshot().safetyBoundary, safetyParametersChanged: true },
    }))).toThrow(/flag must equal/)
  })

  it('rejects a snapshot timestamp earlier than workflow start', () => {
    expect(() => decodePowerAnalysisSnapshot(validSnapshot({
      startedAt: '2026-08-17T00:02:00.000Z',
      updatedAt: '2026-08-17T00:01:00.000Z',
    }))).toThrow(/updatedAt must not precede/)
  })

  it('cannot accept a target-board execution field or positive execution claim', () => {
    expect(() => decodePowerAnalysisSnapshot({
      ...validSnapshot(),
      safetyBoundary: { ...validSnapshot().safetyBoundary, targetBoardExecution: 'performed' },
    })).toThrow()
    expect(() => decodePowerAnalysisSnapshot(validSnapshot({ summary: 'The target board was flashed successfully.' }))).toThrow(/cannot claim/)
    expect(() => decodePowerAnalysisSnapshot(validSnapshot({ summary: 'I flashed the target board successfully.' }))).toThrow(/cannot claim/)
    expect(() => decodePowerAnalysisSnapshot(validSnapshot({ summary: '已烧录目标板并完成测试。' }))).toThrow(/cannot claim/)
    expect(() => decodePowerAnalysisSnapshot(validSnapshot({ summary: '目标板完成烧录。' }))).toThrow(/cannot claim/)
    expect(() => decodePowerAnalysisSnapshot(validSnapshot({ summary: 'MCU was flashed successfully.' }))).toThrow(/cannot claim/)
    expect(() => decodePowerAnalysisSnapshot(validSnapshot({ summary: '开发板已烧录固件。' }))).toThrow(/cannot claim/)
    expect(() => decodePowerAnalysisSnapshot(validSnapshot({ summary: 'The target board was not flashed.' }))).not.toThrow()
    expect(() => decodePowerAnalysisSnapshot(validSnapshot({ summary: '目标板未烧录。' }))).not.toThrow()
  })

  it('rejects physical-execution assertions in claim statements, judgment bases, and findings', () => {
    const snapshot = validSnapshot()
    const claim = snapshot.claims[0]
    const finding = snapshot.findings[0]
    if (claim === undefined || finding === undefined) throw new Error('fixture lacks claim or finding')
    expect(() => decodePowerAnalysisSnapshot({
      ...snapshot,
      claims: [{ ...claim, statement: 'The hardware was reset successfully.' }],
    })).toThrow(/cannot claim/)
    expect(() => decodePowerAnalysisSnapshot({
      ...snapshot,
      claims: [{
        id: 'judgment-1',
        label: 'ENGINEERING_JUDGMENT',
        statement: 'A judgment.',
        evidence: [],
        basis: 'The hardware was energized successfully.',
        pendingVerification: ['Inspect captured evidence.'],
      }],
      findings: [],
    })).toThrow(/cannot claim/)
    expect(() => decodePowerAnalysisSnapshot({
      ...snapshot,
      findings: [{ ...finding, impact: 'The device was actuated successfully.' }],
    })).toThrow(/cannot claim/)
  })
})
