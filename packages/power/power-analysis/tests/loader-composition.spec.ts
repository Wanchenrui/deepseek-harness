import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Include from '@deepseek-ai/cordis-plugin-include'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import type { Agent } from '@deepseek-ai/dsh-agent'
import CommandRuntime from '@deepseek-ai/dsh-commands'
import { CallId } from '@deepseek-ai/dsh-llm'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import * as PowerAnalysis from '../src/index.ts'
import { validSnapshot } from './fixtures.ts'

let root: string | undefined
let context: Context | undefined

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
})

async function boot(mode?: string): Promise<Context> {
  root = await mkdtemp(join(tmpdir(), 'dsh-power-analysis-loader-'))
  const configPath = join(root, 'cordis.yml')
  await writeFile(configPath, [
    "- name: '@deepseek-ai/dsh-system-prompt'",
    "- name: '@deepseek-ai/dsh-tools'",
    "- name: '@deepseek-ai/dsh-commands'",
    "- name: '@deepseek-ai/dsh-power-analysis'",
    ...mode === undefined ? [] : ['  config:', `    mode: ${mode}`],
    '',
  ].join('\n'))
  const ctx = new Context()
  context = ctx
  ctx.baseUrl = pathToFileURL(root).href + '/'
  await ctx.plugin(Loader)
  ctx.loader.builtins.include = Include
  const modules = new Map<string, unknown>([
    ['@deepseek-ai/dsh-system-prompt', SystemPrompt],
    ['@deepseek-ai/dsh-tools', ToolRuntime],
    ['@deepseek-ai/dsh-commands', CommandRuntime],
    ['@deepseek-ai/dsh-power-analysis', PowerAnalysis],
  ])
  ctx.loader.internal = {
    version: 'v2',
    async import(specifier: string) {
      if (!modules.has(specifier)) throw new Error(`unexpected Loader import: ${specifier}`)
      return modules.get(specifier)
    },
  } as unknown as NonNullable<typeof ctx.loader.internal>
  await ctx.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(configPath).href } })
  await ctx.loader.await()
  return ctx
}

describe('power-analysis real Loader composition', () => {
  it('defaults to review authority and omits /fix', async () => {
    const ctx = await boot()
    const id = SessionId('loader-power-analysis')
    const agent = {
      id,
      session: Session.create(id),
      status: 'idle',
      ctx,
      options: {},
      followup: vi.fn(),
    } as unknown as Agent
    expect(ctx.tools.schemas().some(schema => schema.name === 'power_report')).toBe(true)
    expect(ctx.commands.list(agent).map(command => command.name)).toEqual([
      'incident', 'locate', 'requirement', 'review',
    ])
  }, 30_000)

  it('boots fix authority with only /fix and accepts only a fix report', async () => {
    const ctx = await boot('fix')
    const id = SessionId('loader-power-analysis-fix')
    const agent = {
      id,
      session: Session.create(id),
      status: 'idle',
      ctx,
      options: {},
      followup: vi.fn(),
    } as unknown as Agent
    expect(ctx.commands.list(agent).map(command => command.name)).toEqual(['fix'])

    const accepted = await ctx.tools.execute({
      signal: new AbortController().signal,
      callId: CallId('loader-fix-report'),
      name: 'power_report',
      arguments: { snapshot: validSnapshot({ workflow: 'fix', mode: 'fix' }) },
      agent,
    })
    expect(accepted.isError).toBe(false)

    const rejected = await ctx.tools.execute({
      signal: new AbortController().signal,
      callId: CallId('loader-review-report'),
      name: 'power_report',
      arguments: { snapshot: validSnapshot() },
      agent,
    })
    expect(rejected.isError).toBe(true)
  }, 30_000)

  it('fails Loader composition on an unknown authority mode', async () => {
    await expect(boot('dangerous')).rejects.toThrow(/mode|review|fix/iu)
  }, 30_000)
})
