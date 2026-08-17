import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SessionStore from '@deepseek-ai/dsh-session'
import type { Session } from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import CommandRuntime from '@deepseek-ai/dsh-commands'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import * as PowerAnalysis from '../src/index.ts'
import { validSnapshot } from './fixtures.ts'

async function setup(): Promise<{ ctx: Context; session: Session; fiber: Awaited<ReturnType<Context['plugin']>> }> {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(CommandRuntime)
  await ctx.plugin(SessionProjectionRegistry)
  const fiber = await ctx.plugin(PowerAnalysis)
  return { ctx, session: ctx.sessions.create(), fiber }
}

describe('power/analysis projection', () => {
  it('is null before the first report and folds latest complete state', async () => {
    const { ctx, session } = await setup()
    expect(ctx.sessionProjections.snapshot(session).values['power/analysis']).toBeNull()
    const first = validSnapshot()
    const second = validSnapshot({ status: 'complete', summary: 'Review complete.' })
    session.append('power/analysis-state', { kind: 'power/analysis-state', version: 1, snapshot: first })
    session.append('power/analysis-state', { kind: 'power/analysis-state', version: 1, snapshot: second })
    expect(ctx.sessionProjections.snapshot(session)).toEqual({
      asOfSeq: session.seq - 1,
      values: { 'power/analysis': second },
    })
  })

  it('returns the same reference for unrelated or malformed state events', () => {
    const state = validSnapshot()
    expect(PowerAnalysis.applyPowerAnalysisProjection(state, {
      type: 'turn/start', seq: 0, time: 0, data: { turn: 1 },
    })).toBe(state)
    expect(PowerAnalysis.applyPowerAnalysisProjection(state, {
      type: 'power/analysis-state', seq: 1, time: 0, data: { kind: 'power/analysis-state', version: 1, snapshot: {} },
    } as never)).toBe(state)
    expect(PowerAnalysis.applyPowerAnalysisProjection(state, {
      type: 'power/analysis-state', seq: 2, time: 0, data: null,
    } as never)).toBe(state)
    expect(PowerAnalysis.applyPowerAnalysisProjection(state, {
      type: 'power/analysis-state', seq: 3, time: 0,
      data: { kind: 'wrong', version: 1, snapshot: validSnapshot() },
    } as never)).toBe(state)
    expect(PowerAnalysis.applyPowerAnalysisProjection(state, {
      type: 'power/analysis-state', seq: 4, time: 0,
      data: { kind: 'power/analysis-state', version: 2, snapshot: validSnapshot() },
    } as never)).toBe(state)
  })

  it('drops the projection key when the contributing fiber unloads', async () => {
    const { ctx, session, fiber } = await setup()
    expect('power/analysis' in ctx.sessionProjections.snapshot(session).values).toBe(true)
    await fiber.dispose()
    expect('power/analysis' in ctx.sessionProjections.snapshot(session).values).toBe(false)
  })
})
