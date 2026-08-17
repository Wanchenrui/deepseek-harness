import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import { createScope } from '@deepseek-ai/dsh-scope'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { CallId } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime, { defineTool } from '@deepseek-ai/dsh-tools'
import * as PowerPolicy from '../src/index.ts'

let root: string | undefined
let context: Context | undefined

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
})

describe('power policy real Loader composition through cordis.yml', () => {
  it('loads in an agent scope, minimizes schemas, and blocks direct execution', async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-power-policy-loader-'))
    const configPath = join(root, 'cordis.yml')
    await writeFile(configPath, [
      "- name: '@deepseek-ai/dsh-power-policy'",
      '  config:',
      '    mode: review',
      '',
    ].join('\n'))

    context = new Context()
    context.baseUrl = pathToFileURL(root).href + '/'
    await context.plugin(SystemPrompt, {})
    await context.plugin(ToolRuntime, {})
    let readRuns = 0
    let shellRuns = 0
    for (const [toolName, run] of [
      ['read', () => { readRuns += 1 }],
      ['bash', () => { shellRuns += 1 }],
    ] as const) {
      context.tools.register(defineTool({
        name: toolName,
        description: `${toolName} Loader tool.`,
        parameters: {},
        output: {
          schema: { type: 'string' },
          render: (_args, value) => [{ type: 'text', text: value }],
        },
        execute: () => {
          run()
          return Promise.resolve(toolName)
        },
      }))
    }

    const owner = { id: SessionId('loader-policy'), session: { header: { cwd: root } } } as Agent
    const scoped = createScope(context, owner).ctx
    await scoped.plugin(Loader)
    const loader = scoped.get('loader')
    /* v8 ignore next -- Loader completed immediately above. */
    if (loader === undefined) throw new Error('missing scoped Loader service')
    loader.builtins.include = Include
    loader.internal = {
      version: 'v2',
      async import(specifier: string) {
        if (specifier !== '@deepseek-ai/dsh-power-policy') {
          throw new Error(`unexpected Loader import: ${specifier}`)
        }
        return PowerPolicy
      },
    } as unknown as NonNullable<typeof loader.internal>
    await loader.create({
      name: 'cordis:include',
      config: { path: pathToFileURL(configPath).href },
    })
    await loader.await()

    expect((await context.systemPrompt.assemble({ scope: owner })).tools.map(tool => tool.name)).toEqual(['read'])
    const read = await context.tools.execute({
      signal: new AbortController().signal,
      callId: CallId('loader-read'),
      name: 'read',
      arguments: { file_path: 'cordis.yml' },
      agent: owner,
    })
    const shell = await context.tools.execute({
      signal: new AbortController().signal,
      callId: CallId('loader-shell'),
      name: 'bash',
      arguments: {},
      agent: owner,
    })
    expect(read.isError).toBe(false)
    expect(shell.isError).toBe(true)
    const shellText = shell.content
      .filter(block => block.type === 'text')
      .map(block => block.text)
      .join('')
    expect(shellText).toContain('"category":"shell"')
    expect({ readRuns, shellRuns }).toEqual({ readRuns: 1, shellRuns: 0 })
  })
})
