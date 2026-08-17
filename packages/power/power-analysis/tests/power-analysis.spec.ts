import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import CommandRuntime, { CommandId } from '@deepseek-ai/dsh-commands'
import { CallId } from '@deepseek-ai/dsh-llm'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import * as PowerAnalysis from '../src/index.ts'
import { validSnapshot } from './fixtures.ts'

type TestAgent = Agent & { readonly followupSpy: ReturnType<typeof vi.fn<Agent['followup']>> }

function fakeAgent(id = 'power-analysis-test'): TestAgent {
  const followupSpy = vi.fn<Agent['followup']>()
  return {
    id: SessionId(id),
    session: Session.create(SessionId(id)),
    status: 'idle',
    ctx: new Context(),
    options: {},
    followup: followupSpy,
    followupSpy,
  } as unknown as TestAgent
}

async function setup(mode?: PowerAnalysis.Config['mode']): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(CommandRuntime)
  if (mode === undefined) await ctx.plugin(PowerAnalysis)
  else await ctx.plugin(PowerAnalysis, { mode })
  return ctx
}

function text(result: { content: { type: string; text?: string }[] }): string {
  return result.content.filter(block => block.type === 'text').map(block => block.text).join('')
}

describe('power-analysis plugin', () => {
  it('power_report validates then appends a complete post-state event', async () => {
    const ctx = await setup()
    const agent = fakeAgent('reporter')
    const result = await ctx.tools.execute({
      signal: new AbortController().signal,
      callId: CallId('power-report-1'),
      name: 'power_report',
      arguments: { snapshot: validSnapshot({ status: 'complete' }) },
      agent,
    })
    expect(result.isError).toBe(false)
    expect(text(result)).toContain('status: complete')
    const event = agent.session.events.findLast(item => item.type === 'power/analysis-state')
    expect(event?.data.snapshot.status).toBe('complete')
  })

  it('power_report rejects invalid state before the durable append', async () => {
    const ctx = await setup()
    const agent = fakeAgent('invalid-reporter')
    const result = await ctx.tools.execute({
      signal: new AbortController().signal,
      callId: CallId('power-report-invalid'),
      name: 'power_report',
      arguments: { snapshot: { ...validSnapshot(), mode: 'fix' } },
      agent,
    })
    expect(result.isError).toBe(true)
    expect(agent.session.events.some(item => item.type === 'power/analysis-state')).toBe(false)
  })

  it.each([
    { authority: 'review', snapshot: validSnapshot({ workflow: 'fix', mode: 'fix' }) },
    { authority: 'fix', snapshot: validSnapshot() },
  ] as const)('power_report rejects $snapshot.mode state under $authority authority', async ({ authority, snapshot }) => {
    const ctx = await setup(authority)
    const agent = fakeAgent(`authority-${authority}`)
    const result = await ctx.tools.execute({
      signal: new AbortController().signal,
      callId: CallId(`power-report-authority-${authority}`),
      name: 'power_report',
      arguments: { snapshot },
      agent,
    })
    expect(result.isError).toBe(true)
    expect(text(result)).toContain(`does not match configured authority ${JSON.stringify(authority)}`)
    expect(agent.session.events.some(item => item.type === 'power/analysis-state')).toBe(false)
  })

  it('fix authority accepts a complete fix snapshot', async () => {
    const ctx = await setup('fix')
    const agent = fakeAgent('fix-reporter')
    const result = await ctx.tools.execute({
      signal: new AbortController().signal,
      callId: CallId('power-report-fix'),
      name: 'power_report',
      arguments: { snapshot: validSnapshot({ workflow: 'fix', mode: 'fix', status: 'complete' }) },
      agent,
    })
    expect(result.isError).toBe(false)
    expect(agent.session.events.findLast(item => item.type === 'power/analysis-state')?.data.snapshot.mode).toBe('fix')
  })

  it('rejects a non-agent report because no session owns it', async () => {
    const ctx = await setup()
    const result = await ctx.tools.execute({
      signal: new AbortController().signal,
      callId: CallId('power-report-no-agent'),
      name: 'power_report',
      arguments: { snapshot: validSnapshot() },
    })
    expect(result.isError).toBe(true)
    expect(text(result)).toContain('owning agent session')
  })

  it('presents a report call with stable generic-card metadata', async () => {
    const ctx = await setup()
    const snapshot = validSnapshot()
    expect(ctx.tools.get('power_report')?.presentCall?.({ snapshot })).toEqual({
      card: 'generic',
      title: 'Publish power analysis',
      kind: 'other',
      rawInput: snapshot,
    })
  })

  it.each(['locate', 'review', 'incident', 'requirement', 'fix'] as const)(
    '/%s initializes state and queues a fixed model-visible workflow prompt',
    async (workflow) => {
      const ctx = await setup(workflow === 'fix' ? 'fix' : 'review')
      const agent = fakeAgent(`command-${workflow}`)
      const command = ctx.commands.find(agent, workflow)
      if (command === undefined) throw new Error(`missing /${workflow}`)
      const result = await command.handler({
        commandId: CommandId(`cmd-${workflow}`),
        agent,
        rawInput: ' Inspect the enable path ',
        signal: new AbortController().signal,
      })
      expect(result.kind).toBe('success')
      const event = agent.session.events.findLast(item => item.type === 'power/analysis-state')
      expect(event?.data.snapshot).toMatchObject({
        workflow,
        mode: workflow === 'fix' ? 'fix' : 'review',
        task: 'Inspect the enable path',
      })
      expect(agent.followupSpy).toHaveBeenCalledOnce()
      const message = agent.followupSpy.mock.calls[0]?.[0]
      const prompt = message?.content.find(block => block.type === 'text')
      expect(prompt?.type === 'text' ? prompt.text : '').toContain('No target-board execution')
    },
  )

  it('defaults to review authority and exposes no /fix command', async () => {
    const ctx = await setup()
    const agent = fakeAgent('default-review')
    expect(ctx.commands.list(agent).map(command => command.name)).toEqual([
      'incident', 'locate', 'requirement', 'review',
    ])
    expect(ctx.commands.find(agent, 'fix')).toBeUndefined()
    expect(ctx.tools.get('power_report')?.description).toContain('Configured authority is review')
  })

  it('fix authority exposes only /fix', async () => {
    const ctx = await setup('fix')
    const agent = fakeAgent('fix-commands')
    expect(ctx.commands.list(agent).map(command => command.name)).toEqual(['fix'])
    expect(ctx.commands.find(agent, 'review')).toBeUndefined()
    expect(ctx.tools.get('power_report')?.description).toContain('Configured authority is fix')
  })

  it('empty workflow input returns usage without state or followup', async () => {
    const ctx = await setup()
    const agent = fakeAgent('empty-command')
    const command = ctx.commands.find(agent, 'review')
    if (command === undefined) throw new Error('missing /review')
    const result = await command.handler({
      commandId: CommandId('cmd-empty'), agent, rawInput: '   ', signal: new AbortController().signal,
    })
    expect(result).toEqual({ kind: 'error', text: 'Usage: /review <task>' })
    expect(agent.session.events.some(item => item.type === 'power/analysis-state')).toBe(false)
    expect(agent.followupSpy).not.toHaveBeenCalled()
  })

  it('unregisters its tool and commands on fiber disposal', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(CommandRuntime)
    const fiber = await ctx.plugin(PowerAnalysis, { mode: 'review' })
    const agent = fakeAgent('dispose')
    expect(ctx.tools.get('power_report')).toBeDefined()
    expect(ctx.commands.find(agent, 'review')).toBeDefined()
    await fiber.dispose()
    expect(ctx.tools.get('power_report')).toBeUndefined()
    expect(ctx.commands.find(agent, 'review')).toBeUndefined()
  })

  it('keeps namespace-plugin exports so Loader retains injection metadata', () => {
    expect('default' in PowerAnalysis).toBe(false)
    expect(PowerAnalysis.name).toBe('power-analysis')
    expect(PowerAnalysis.inject).toEqual(['tools', 'commands'])
    expect(PowerAnalysis.Config({} as PowerAnalysis.Config)).toEqual({ mode: 'review' })
  })
})
