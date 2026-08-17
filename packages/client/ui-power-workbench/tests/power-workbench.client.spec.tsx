// @vitest-environment jsdom
import { Context } from '@deepseek-ai/cordis'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  EMPTY_CHAT_SNAPSHOT, EMPTY_CONVERSATION_VIEWS, SlotRegistry,
} from '@deepseek-ai/dsh-client-runtime/client'
import type {
  ConversationSnapshot, SessionId, SessionListState, WorkspaceListState,
} from '@deepseek-ai/dsh-client-runtime/client'
import type { PowerAnalysisSnapshot } from '@deepseek-ai/dsh-power-analysis/client'
import { apply as applyLocale, inject as localeInject } from '@deepseek-ai/dsh-client-locale/client'
import { makeTranslate, stubSettingsScope } from '@deepseek-ai/dsh-client-test-runtime'
import {
  EngineeringWorkspacePanel, PowerWorkbench, SafetyBoundaryPanel, SessionPulsePanel,
  derivePowerWorkbenchPanel,
} from '../src/client/PowerWorkbench.tsx'
import type {
  PowerWorkbenchInspectorProps, PowerWorkbenchPanelOwnerProps, PowerWorkbenchPanelProps,
  PowerWorkbenchProps, PowerWorkbenchWorkspaceProps,
} from '../src/client/PowerWorkbench.tsx'
import { apply, inject } from '../src/client/index.ts'
import { zh } from '../src/client/locales.ts'
import { apply as applyNode } from '../src/index.ts'
import { apply as applyInvariant } from '../src/invariant.ts'

afterEach(cleanup)

const SID = 'power-session' as SessionId

function snapshot(overrides: Partial<ConversationSnapshot> = {}): ConversationSnapshot {
  return {
    sessionId: SID,
    views: EMPTY_CONVERSATION_VIEWS,
    chat: EMPTY_CHAT_SNAPSHOT,
    nodes: [],
    turnTimings: new Map(),
    turnEnds: new Map(),
    partial: null,
    runningCalls: [],
    pending: [],
    queue: [],
    running: false,
    subagent: null,
    composerPhase: 'active',
    removed: false,
    openState: 'open',
    openError: null,
    hasMore: false,
    loadingOlder: false,
    promptError: null,
    blank: false,
    lastAgentError: null,
    ...overrides,
  }
}

const analysisFixture = {
  schemaVersion: 1,
  workflow: 'review',
  mode: 'review',
  status: 'complete',
  task: 'Review the PWM enable ownership chain.',
  summary: 'One ownership defect remains; no target operation was performed.',
  claims: [
    {
      id: 'claim-owner' as PowerAnalysisSnapshot['claims'][number]['id'],
      label: 'VERIFIED_FACT',
      statement: 'The UI consumes a durable session projection.',
      evidence: [
        {
          kind: 'source_code',
          artifact: 'src/power.c',
          locator: 'power_enable:42',
          revision: 'abc123',
        },
        {
          kind: 'test',
          artifact: 'tests/power.spec.ts',
          locator: 'ownership case',
        },
      ],
    },
    {
      id: 'claim-build' as PowerAnalysisSnapshot['claims'][number]['id'],
      label: 'CODE_INFERENCE',
      statement: 'The inspected branch retains a single software owner.',
      evidence: [
        { kind: 'diff', artifact: 'working tree', locator: 'power ownership diff' },
      ],
    },
  ],
  findings: [
    {
      severity: 'high',
      title: 'Bypass path reaches enable request',
      location: 'src/power.c:42',
      claimIds: ['claim-owner' as PowerAnalysisSnapshot['claims'][number]['id']],
      impact: 'The intended single-owner invariant is weakened.',
      recommendation: 'Route the request through the existing owner.',
      verification: 'Run the ownership unit test.',
    },
    {
      severity: 'low',
      title: 'Follow-up evidence is missing',
      claimIds: ['claim-build' as PowerAnalysisSnapshot['claims'][number]['id']],
      impact: 'Review confidence remains bounded.',
      recommendation: 'Capture the missing artifact.',
      verification: 'Attach a stable locator.',
    },
  ],
  unknowns: ['Target timing remains unmeasured.'],
  build: {
    declaration: 'compiled',
    receipt: {
      status: 'success',
      exitCode: 0,
      command: 'pnpm exec tsc -b',
      workingDirectory: 'D:/workspace',
      startedAt: '2026-08-17T04:00:00.000Z',
      finishedAt: '2026-08-17T04:00:01.000Z',
      revision: 'abc123',
      worktreeState: 'dirty',
      summary: 'TypeScript project build completed.',
    },
  },
  compatibility: {
    api: 'unchanged',
    abi: 'compatible-change',
    nvm: 'breaking-change',
    notes: ['Fixture exercises all visible compatibility labels.'],
    migration: 'Migrate the fixture value.',
    rollback: 'Restore the fixture value.',
  },
  safetyBoundary: {
    targetBoardExecution: 'not-performed',
    powerStageOperation: 'not-performed',
    physicalActuation: 'not-performed',
    nvmClear: 'not-performed',
    targetAuthorization: 'not-granted',
    safetyParametersChanged: true,
    safetyParameterChanges: [
      {
        parameter: 'fixtureThreshold',
        oldValue: '1 V',
        newValue: '2 V',
        basis: 'Presentation-only fixture.',
        evidence: [
          { kind: 'test', artifact: 'power-workbench.client.spec.tsx', locator: 'analysisFixture' },
        ],
      },
    ],
  },
  startedAt: '2026-08-17T04:00:00.000Z',
  updatedAt: '2026-08-17T04:00:01.000Z',
} as const satisfies PowerAnalysisSnapshot

function standardKit(
  value = snapshot(),
  analysis?: PowerAnalysisSnapshot | null,
) {
  const sessions: SessionListState = {
    ids: [SID],
    byId: {
      [SID]: { id: SID, displayTitle: 'Power', running: value.running, blank: false, updatedAt: 0 },
    },
    current: SID,
    phase: 'ready',
    subagentsByParent: {},
    jobsBySession: {},
    currentAddress: undefined,
  }
  const workspaces: WorkspaceListState = {
    items: [], archivedSessionIds: [], state: 'idle', phase: 'ready', error: null,
    baselinesReady: true, recentWorkspaceId: undefined,
  }
  return {
    sessionId: SID,
    useSession: <T,>(selector: (input: ConversationSnapshot) => T): T => selector(value),
    useSessions: <T,>(selector: (input: SessionListState) => T): T => selector(sessions),
    useWorkspaces: <T,>(selector: (input: WorkspaceListState) => T): T => selector(workspaces),
    useProjection: (key: string) => key === 'power/analysis' ? analysis : undefined,
  }
}

const panel: PowerWorkbenchPanelOwnerProps = {
  state: 'running',
  completedTurns: 3,
  loadedEvents: 21,
  runningTools: 2,
  pendingInteractions: 1,
  queuedMessages: 4,
  analysis: null,
}

describe('workbench projection currency', () => {
  it('derives counts without presenting them as target telemetry', () => {
    expect(derivePowerWorkbenchPanel(snapshot({
      turnEnds: new Map([[1, 5], [2, 9]]),
      nodes: [{} as never, {} as never, {} as never],
      runningCalls: [{} as never],
      pending: [{} as never, {} as never],
      queue: [{} as never],
      running: true,
    }))).toEqual({
      state: 'running',
      completedTurns: 2,
      loadedEvents: 3,
      runningTools: 1,
      pendingInteractions: 2,
      queuedMessages: 1,
    })
  })

  it.each([
    ['removed', { removed: true }],
    ['loading', { openState: 'cold' as const }],
    ['loading', { openState: 'loading' as const }],
    ['attention', { openState: 'error' as const }],
    ['attention', { promptError: {} as never }],
    ['attention', { lastAgentError: 'failed' }],
    ['attention', { pending: [{} as never] }],
    ['idle', {}],
  ] as const)('derives %s from the authoritative Session fields', (expected, overrides) => {
    expect(derivePowerWorkbenchPanel(snapshot(overrides)).state).toBe(expected)
  })
})

describe('workbench presentation', () => {
  it('passes the same analysis projection through every shell slot', () => {
    const renderSlot = vi.fn((key: string, owner: PowerWorkbenchPanelOwnerProps) => (
      <div data-testid={key}>{owner.state}</div>
    ))
    render(<PowerWorkbench {...({
      ...standardKit(snapshot({ running: true }), analysisFixture),
      renderSlot,
      t: makeTranslate(zh),
    } as unknown as PowerWorkbenchProps)} />)
    expect(screen.getByRole('heading', { name: '功率软件工程控制台' })).toBeTruthy()
    expect(screen.getByText('设备网关未接入')).toBeTruthy()
    expect(screen.getByText('Agent 运行中')).toBeTruthy()
    expect(screen.getByTestId('power.workbench.overview').textContent).toBe('running')
    expect(screen.getByTestId('power.workbench.workspace').textContent).toBe('running')
    expect(screen.getByTestId('power.workbench.inspector').textContent).toBe('running')
    expect(renderSlot).toHaveBeenCalledTimes(3)
    expect(renderSlot.mock.calls.map(([key, owner]) => [key, owner.analysis])).toEqual([
      ['power.workbench.overview', analysisFixture],
      ['power.workbench.workspace', analysisFixture],
      ['power.workbench.inspector', analysisFixture],
    ])
  })

  it('passes an absent projection through the shell without synthesizing a report', () => {
    const renderSlot = vi.fn((_key: string, owner: PowerWorkbenchPanelOwnerProps) => (
      <div>{owner.analysis == null ? 'empty' : 'unexpected'}</div>
    ))
    render(<PowerWorkbench {...({
      ...standardKit(),
      renderSlot,
      t: makeTranslate(zh),
    } as unknown as PowerWorkbenchProps)} />)
    expect(renderSlot).toHaveBeenCalledTimes(3)
    expect(renderSlot.mock.calls.every(([, owner]) => owner.analysis === undefined)).toBe(true)
    expect(screen.getAllByText('empty')).toHaveLength(3)
  })

  it('renders explicit empty states when no analysis projection has been accepted', () => {
    const common = { ...standardKit(), ...panel, t: makeTranslate(zh) }
    const pulse = render(<SessionPulsePanel {...(common as unknown as PowerWorkbenchPanelProps)} />)
    expect(screen.getByText('已完成轮次').previousSibling?.textContent).toBe('3')
    expect(screen.getByText('已加载事件').previousSibling?.textContent).toBe('21')
    expect(screen.getByText('尚无功率分析投影')).toBeTruthy()
    pulse.unmount()

    const workspace = render(<EngineeringWorkspacePanel {...(
      common as unknown as PowerWorkbenchWorkspaceProps
    )} />)
    expect(screen.getByText('运行 /locate、/review、/incident、/requirement 或 /fix 后，这里会显示经过校验的完整分析快照。')).toBeTruthy()
    expect(screen.getByText('PWM / ADC 同步')).toBeTruthy()
    expect(screen.getByText('受控写入')).toBeTruthy()
    expect(screen.getAllByText('需要任务级授权')).toHaveLength(2)
    workspace.unmount()

    render(<SafetyBoundaryPanel {...(common as unknown as PowerWorkbenchInspectorProps)} />)
    expect(screen.getByText('尚无经过校验的领域安全快照；设备执行网关仍未挂载。')).toBeTruthy()
    expect(screen.getByText('设备执行网关')).toBeTruthy()
    expect(screen.getByText('MCU / FPGA / 硬件 Trip')).toBeTruthy()
    expect(screen.getByText('power.workbench.workspace')).toBeTruthy()
  })

  it('renders claims, evidence, findings, build receipt status, and location fallback', () => {
    const common = {
      ...standardKit(snapshot(), analysisFixture),
      ...panel,
      analysis: analysisFixture,
      t: makeTranslate(zh),
    }
    const pulse = render(<SessionPulsePanel {...(common as unknown as PowerWorkbenchPanelProps)} />)
    expect(screen.getByTestId('power-projection-digest').textContent)
      .toContain('/review · One ownership defect remains; no target operation was performed.')
    pulse.unmount()

    render(<EngineeringWorkspacePanel {...(
      common as unknown as PowerWorkbenchWorkspaceProps
    )} />)
    expect(screen.getByText('One ownership defect remains; no target operation was performed.')).toBeTruthy()
    expect(screen.getByText('结论').previousSibling?.textContent).toBe('2')
    expect(screen.getByText('证据引用').previousSibling?.textContent).toBe('3')
    expect(screen.getByText('问题项').previousSibling?.textContent).toBe('2')
    expect(screen.getByText('未知项').previousSibling?.textContent).toBe('1')
    expect(screen.getByText('已编译（有回执）')).toBeTruthy()
    expect(screen.getByText('src/power.c:42')).toBeTruthy()
    expect(screen.getByText('位置未提供')).toBeTruthy()
  })

  it.each([true, false])('renders the fixed authority boundary and safety-change flag %s', (changed) => {
    const analysis = {
      ...analysisFixture,
      safetyBoundary: {
        ...analysisFixture.safetyBoundary,
        safetyParametersChanged: changed,
        safetyParameterChanges: changed ? analysisFixture.safetyBoundary.safetyParameterChanges : [],
      },
    } satisfies PowerAnalysisSnapshot
    render(<SafetyBoundaryPanel {...({
      ...standardKit(snapshot(), analysis),
      ...panel,
      analysis,
      t: makeTranslate(zh),
    } as unknown as PowerWorkbenchInspectorProps)} />)
    expect(screen.getByText('未授予')).toBeTruthy()
    expect(screen.getAllByText('未执行')).toHaveLength(2)
    expect(screen.getByText(changed ? '有（查看旧值/新值/依据）' : '无')).toBeTruthy()
    expect(screen.getByText('未改变')).toBeTruthy()
    expect(screen.getByText('兼容变更')).toBeTruthy()
    expect(screen.getByText('破坏性变更')).toBeTruthy()
  })
})

describe('plugin lifecycle', () => {
  it('registers and retracts the workbench and every nested extension entry', async () => {
    const ctx = new Context()
    const slots = new SlotRegistry(ctx)
    slots.register({
      name: 'root',
      children: { 'conversation.view': { kind: 'list', scope: 'session' } },
    }, (_props: { renderSlot?: unknown }) => null)
    ctx.provide('connection', { api: { settings: {} }, isLoopback: false } as never)
    ctx.provide('remote', { $on: () => () => {} } as never)
    ctx.provide('settingsScope', { bind: () => stubSettingsScope().scope } as never)
    await ctx.plugin({ inject: [...localeInject], apply: applyLocale }).await()

    const fiber = ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    const view = slots.entries('conversation.view').find(entry => entry.options.id === 'power-workbench')
    expect(view?.options.label).toBeTypeOf('function')
    expect((view?.options.label as () => string)()).toBe('Power Workbench')
    expect(slots.entries('power.workbench.overview').map(entry => entry.options.id))
      .toEqual(['session-pulse'])
    expect(slots.entries('power.workbench.workspace').map(entry => entry.options.id))
      .toEqual(['engineering-domains'])
    expect(slots.entries('power.workbench.inspector').map(entry => entry.options.id))
      .toEqual(['safety-boundary'])

    await fiber.dispose()
    expect(slots.entries('conversation.view')).toEqual([])
    expect(slots.entries('power.workbench.overview')).toEqual([])

    const replacement = ctx.plugin({ inject: [...inject], apply })
    await replacement.await()
    expect(slots.entries('conversation.view').map(entry => entry.options.id))
      .toEqual(['power-workbench'])
    await replacement.dispose()
  })

  it('keeps the node half inert and registers invariant ownership', async () => {
    applyNode()
    const registered: string[] = []
    const ctx = new Context()
    ctx.provide('invariants')
    ctx.set('invariants', {
      register: (pkg: string) => { registered.push(pkg); return () => {} },
    } as never)
    await applyInvariant(ctx)
    expect(registered).toEqual(['@deepseek-ai/dsh-client-ui-power-workbench'])
  })
})
