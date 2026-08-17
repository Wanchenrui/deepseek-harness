/** Keyless real-Loader checks for the shipped preset schemas and final guard. */

import { readFileSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Group from '@deepseek-ai/cordis-plugin-group'
import Include from '@deepseek-ai/cordis-plugin-include'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import type { Agent } from '@deepseek-ai/dsh-agent'
import * as AgentInstructions from '@deepseek-ai/dsh-agent-instructions'
import CommandRuntime from '@deepseek-ai/dsh-commands'
import { CallId } from '@deepseek-ai/dsh-llm'
import * as FsEsafenet from '@deepseek-ai/dsh-fs-esafenet'
import * as PowerAnalysis from '@deepseek-ai/dsh-power-analysis'
import * as PowerPolicy from '@deepseek-ai/dsh-power-policy'
import * as PowerPrompt from '@deepseek-ai/dsh-power-prompt'
import * as SandboxPolicy from '@deepseek-ai/dsh-sandbox-policy'
import { createScope } from '@deepseek-ai/dsh-scope'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import type { PromptAssembly } from '@deepseek-ai/dsh-system-prompt'
import * as ToolFs from '@deepseek-ai/dsh-tool-fs'
import * as ToolFsSearch from '@deepseek-ai/dsh-tool-fs-search'
import ToolRuntime, { defineTool } from '@deepseek-ai/dsh-tools'

type PowerPreset = 'power-review' | 'power-fix'

const repositoryRoot = resolve(fileURLToPath(new URL('../../../../', import.meta.url)))
const contexts: Context[] = []

afterEach(async () => {
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
})

function moduleMap(): ReadonlyMap<string, unknown> {
  return new Map<string, unknown>([
    ['@deepseek-ai/dsh-agent-instructions', AgentInstructions],
    ['@deepseek-ai/dsh-fs-esafenet', FsEsafenet],
    ['@deepseek-ai/dsh-power-analysis', PowerAnalysis],
    ['@deepseek-ai/dsh-power-policy', PowerPolicy],
    ['@deepseek-ai/dsh-power-prompt', PowerPrompt],
    ['@deepseek-ai/dsh-sandbox-policy', SandboxPolicy],
    ['@deepseek-ai/dsh-tool-fs', ToolFs],
    ['@deepseek-ai/dsh-tool-fs-search', ToolFsSearch],
  ])
}

function dangerousTool(name: string, runs: { count: number }): ReturnType<typeof defineTool> {
  return defineTool({
    name,
    description: `Test-only ${name} capability.`,
    parameters: {},
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: value }],
    },
    execute: () => {
      runs.count += 1
      return Promise.resolve('unexpected execution')
    },
  })
}

async function boot(preset: PowerPreset): Promise<{
  ctx: Context
  owner: Agent
  dangerousRuns: { count: number }
  sandboxMode: string | undefined
}> {
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(SystemPrompt, { persona: '' })
  await ctx.plugin(ToolRuntime, { mode: 'native' })
  await ctx.plugin(CommandRuntime)
  // The real preset tools resolve these host seams. The filesystem fake is not
  // executed in this test; its advertised mode makes tool-fs require the
  // preset's isolated policy, exactly as the real Esafenet provider does.
  ctx.provide('fs', { sandboxMode: 'read-only' } as never)
  ctx.provide('subprocess', {} as never)

  const dangerousRuns = { count: 0 }
  ctx.tools.register(dangerousTool('bash', dangerousRuns))
  ctx.tools.register(dangerousTool('target_flash', dangerousRuns))

  const id = SessionId(`runtime-${preset}`)
  const owner = {
    id,
    session: Session.create(id),
    status: 'idle',
    options: {},
  } as unknown as Agent
  const scoped = createScope(ctx, owner).ctx
  Object.assign(owner, { ctx: scoped })
  await scoped.plugin(Loader)
  const loader = scoped.get('loader')
  if (loader === undefined) throw new Error('missing scoped Loader')
  loader.builtins.include = Include
  loader.builtins.group = Group
  const modules = moduleMap()
  loader.internal = {
    version: 'v2',
    async import(specifier: string) {
      const plugin = modules.get(specifier)
      if (plugin === undefined) throw new Error(`unexpected Loader import: ${specifier}`)
      return plugin
    },
  } as unknown as NonNullable<typeof loader.internal>
  const configPath = resolve(repositoryRoot, `apps/cli/config/agent-presets/${preset}/agent.cordis.yml`)
  // Assert the test composes the shipped bytes, not a hand-built row list.
  expect(readFileSync(configPath, 'utf8')).toContain('@deepseek-ai/dsh-power-policy')
  await loader.create({ name: 'cordis:include', config: { path: pathToFileURL(configPath).href } })
  await loader.await()

  const policies = Object.getOwnPropertySymbols(ctx.reflect.store)
    .map(key => ctx.reflect.store[key])
    .filter(service => service?.name === 'sandboxPolicy')
  expect(policies).toHaveLength(1)
  const sandboxMode = (policies[0]?.value as { defaultMode?: string } | undefined)?.defaultMode
  return { ctx, owner, dangerousRuns, sandboxMode }
}

function resultText(result: Awaited<ReturnType<ToolRuntime['execute']>>): string {
  return result.content.filter(block => block.type === 'text').map(block => block.text).join('')
}

function modelSurface(assembly: PromptAssembly): Pick<PromptAssembly, 'sections' | 'tools'> {
  return { sections: assembly.sections, tools: assembly.tools }
}

describe('Power Desktop shipped preset runtime', () => {
  it('boots power-review through Loader with read-only schemas and executor denial', async () => {
    const test = await boot('power-review')
    const assembly = await test.ctx.systemPrompt.assemble({ scope: test.owner })
    expect(assembly.tools.map(tool => tool.name).sort()).toEqual(['glob', 'grep', 'power_report', 'read'])
    expect(test.sandboxMode).toBe('read-only')
    expect(assembly.sections.some(section => section.name === 'power:role')).toBe(true)
    expect(modelSurface(assembly)).toMatchSnapshot('power-review assembled model surface')

    const deniedWrite = await test.ctx.tools.execute({
      signal: new AbortController().signal,
      callId: CallId('review-write'),
      name: 'write',
      arguments: { file_path: 'blocked.c', content: 'blocked' },
      agent: test.owner,
    })
    expect(deniedWrite.isError).toBe(true)
    expect(resultText(deniedWrite)).toContain('TOOL_NOT_ALLOWED')

    const deniedShell = await test.ctx.tools.execute({
      signal: new AbortController().signal,
      callId: CallId('review-shell'),
      name: 'bash',
      arguments: {},
      agent: test.owner,
    })
    expect(deniedShell.isError).toBe(true)
    expect(resultText(deniedShell)).toContain('"category":"shell"')
    expect(test.dangerousRuns.count).toBe(0)
  }, 30_000)

  it('boots power-fix through Loader with workspace-only mutation and immutable high-risk denial', async () => {
    const test = await boot('power-fix')
    const assembly = await test.ctx.systemPrompt.assemble({ scope: test.owner })
    expect(assembly.tools.map(tool => tool.name).sort()).toEqual([
      'edit', 'glob', 'grep', 'power_report', 'read', 'write',
    ])
    expect(test.sandboxMode).toBe('workspace-write')
    expect(modelSurface(assembly)).toMatchSnapshot('power-fix assembled model surface')

    const deniedTarget = await test.ctx.tools.execute({
      signal: new AbortController().signal,
      callId: CallId('fix-target'),
      name: 'target_flash',
      arguments: {},
      agent: test.owner,
    })
    expect(deniedTarget.isError).toBe(true)
    expect(resultText(deniedTarget)).toContain('"category":"target_execution"')
    expect(test.dangerousRuns.count).toBe(0)
  }, 30_000)
})
