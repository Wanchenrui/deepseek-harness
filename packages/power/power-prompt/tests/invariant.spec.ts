import { Context } from '@deepseek-ai/cordis'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'
import { describe, expect, it } from 'vitest'
import * as PowerPromptInvariant from '../src/invariant.ts'

describe('power-prompt invariant companion', () => {
  it('registers its explained empty runtime invariant', async () => {
    const ctx = new Context()
    await ctx.plugin(InvariantRegistry)
    const fiber = await ctx.plugin(PowerPromptInvariant)

    expect(() => {
      ctx.invariants.register('@deepseek-ai/dsh-power-prompt', () => {})
    }).toThrow(/already registered/u)

    await fiber.dispose()
    await ctx.fiber.dispose()
  })
})
