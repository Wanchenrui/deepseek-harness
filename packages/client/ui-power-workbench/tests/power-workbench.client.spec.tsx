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

function standardKit(value = snapshot()) {
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
    useProjection: () => undefined,
  }
}

const panel: PowerWorkbenchPanelOwnerProps = {
  state: 'running',
  completedTurns: 3,
  loadedEvents: 21,
  runningTools: 2,
  pendingInteractions: 1,
  queuedMessages: 4,
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
  it('renders the shell and dispatches the same read-only currency to every extension region', () => {
    const renderSlot = vi.fn((key: string, owner: PowerWorkbenchPanelOwnerProps) => (
      <div data-testid={key}>{owner.state}</div>
    ))
    render(<PowerWorkbench {...({
      ...standardKit(snapshot({ running: true })),
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
  })

  it('renders projection counts, domain modules, the verification ladder, and ownership boundaries', () => {
    const common = { ...standardKit(), ...panel, t: makeTranslate(zh) }
    const pulse = render(<SessionPulsePanel {...(common as unknown as PowerWorkbenchPanelProps)} />)
    expect(screen.getByText('已完成轮次').previousSibling?.textContent).toBe('3')
    expect(screen.getByText('已加载事件').previousSibling?.textContent).toBe('21')
    pulse.unmount()

    const workspace = render(<EngineeringWorkspacePanel {...(
      common as unknown as PowerWorkbenchWorkspaceProps
    )} />)
    expect(screen.getByText('PWM / ADC 同步')).toBeTruthy()
    expect(screen.getByText('受控写入')).toBeTruthy()
    expect(screen.getAllByText('需要任务级授权')).toHaveLength(2)
    workspace.unmount()

    render(<SafetyBoundaryPanel {...(common as unknown as PowerWorkbenchInspectorProps)} />)
    expect(screen.getByText('设备执行网关')).toBeTruthy()
    expect(screen.getByText('MCU / FPGA / 硬件 Trip')).toBeTruthy()
    expect(screen.getByText('power.workbench.workspace')).toBeTruthy()
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
