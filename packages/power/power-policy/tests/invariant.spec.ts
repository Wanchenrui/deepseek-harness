import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'
import * as PowerPolicyInvariant from '../src/invariant.ts'

describe('power policy invariant companion', () => {
  it('reserves and releases the package registration', async () => {
    const ctx = new Context()
    await ctx.plugin(InvariantRegistry, {})

    const dispose = await PowerPolicyInvariant.apply(ctx)

    expect(PowerPolicyInvariant.name).toBe('power-policy-invariant')
    expect(PowerPolicyInvariant.inject).toEqual(['invariants'])
    expect('default' in PowerPolicyInvariant).toBe(false)
    expect(() => ctx.invariants.register('@deepseek-ai/dsh-power-policy', () => {}))
      .toThrow('is already registered')
    await (dispose as () => Promise<void>)()
    const replacement = ctx.invariants.register('@deepseek-ai/dsh-power-policy', () => {})
    await (replacement as () => Promise<void>)()
    await ctx.fiber.dispose()
  })
})
