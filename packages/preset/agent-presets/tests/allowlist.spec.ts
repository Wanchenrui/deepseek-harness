import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import AgentPresets from '@deepseek-ai/dsh-agent-presets'
import type { Config } from '@deepseek-ai/dsh-agent-presets'

/** A rootless config exercises constructor validation without touching the host roster. */
function config(allowedIds?: string[], defaultId = 'standard'): Config {
  return {
    default: defaultId,
    ...allowedIds === undefined ? {} : { allowedIds },
    roots: [],
    includeUserRoot: false,
  }
}

describe('preset roster allowlist configuration', () => {
  it('preserves the unrestricted roster when omitted', () => {
    expect(AgentPresets.Config(config()).allowedIds).toBeUndefined()
    expect(() => new AgentPresets(new Context(), config())).not.toThrow()
  })

  it.each([
    ['an empty list', config([]), /must contain at least one preset id/],
    ['an invalid id', config(['']), /entry "" must match/],
    ['a duplicate id', config(['standard', 'standard']), /duplicate preset id "standard"/],
    ['a missing configured default', config(['minimal']), /must contain configured default "standard"/],
  ])('rejects %s during construction', (_name, roster, expected) => {
    expect(() => new AgentPresets(new Context(), roster)).toThrow(expected)
  })

  it('snapshots the configured ids instead of trusting later array mutation', async () => {
    const allowedIds = ['standard']
    const presets = new AgentPresets(new Context(), config(allowedIds))
    allowedIds.push('minimal')

    await expect(presets.resolve('minimal')).rejects.toMatchObject({ available: [] })
  })
})
