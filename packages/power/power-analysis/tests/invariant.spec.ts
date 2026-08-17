import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SessionStore from '@deepseek-ai/dsh-session'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'
import * as PowerInvariant from '../src/invariant.ts'
import { validSnapshot } from './fixtures.ts'

async function setup(): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(InvariantRegistry, { enabled: true })
  await ctx.plugin(PowerInvariant)
  return ctx
}

describe('power-analysis durable invariants', () => {
  it('accepts a valid live complete-state event', async () => {
    const ctx = await setup()
    expect(() => {
      ctx.emit('session/event', {} as Session, {
        type: 'power/analysis-state', seq: 0, time: 0,
        data: { kind: 'power/analysis-state', version: 1, snapshot: validSnapshot() },
      })
    }).not.toThrow()
  })

  it.each([
    [null, /data must be an object/],
    [{ kind: 'wrong', version: 1, snapshot: validSnapshot() }, /invalid kind/],
    [{ kind: 'power\/analysis-state', version: 2, snapshot: validSnapshot() }, /invalid kind|unsupported version/],
    [{ kind: 'power/analysis-state', version: 1, snapshot: { ...validSnapshot(), mode: 'fix' } }, /snapshot is invalid/],
  ])('rejects malformed persisted state', async (data, message) => {
    const ctx = await setup()
    expect(() => {
      ctx.emit('session/event', {} as Session, {
        type: 'power/analysis-state', seq: 0, time: 0, data,
      } as unknown as SessionEvent)
    }).toThrow(message)
  })

  it('ignores unrelated events', async () => {
    const ctx = await setup()
    expect(() => {
      ctx.emit('session/event', {} as Session, {
        type: 'turn/start', seq: 0, time: 0, data: { turn: 1 },
      })
    }).not.toThrow()
  })

  it('rejects an invalid existing snapshot on late invariant registration', async () => {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    ctx.sessions.create().append('power/analysis-state', {
      kind: 'power/analysis-state',
      version: 1,
      snapshot: { ...validSnapshot(), mode: 'fix' },
    } as never)
    await ctx.plugin(InvariantRegistry, { enabled: true })
    await expect(ctx.plugin(PowerInvariant).then(() => undefined)).rejects.toThrow(/snapshot is invalid/)
  })
})
