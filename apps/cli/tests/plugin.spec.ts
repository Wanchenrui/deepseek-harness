import { existsSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { runPlugin } from '../src/plugin.ts'

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
})

describe('runPlugin', () => {
  it('rejects the sealed power profile before creating profile or pnpm state', () => {
    const home = mkdtempSync(join(tmpdir(), 'dsh-sealed-plugin-'))
    vi.stubEnv('DSH_HOME', home)
    const stderr = vi.spyOn(process.stderr, 'write').mockReturnValue(true)

    expect(runPlugin('power', ['add', 'example-plugin'])).toBe(1)
    expect(existsSync(join(home, 'profiles'))).toBe(false)
    expect(stderr).toHaveBeenCalledWith(expect.stringContaining('does not allow plugin management'))
  })
})
