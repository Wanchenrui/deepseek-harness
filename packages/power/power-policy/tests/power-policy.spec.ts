import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { createScope } from '@deepseek-ai/dsh-scope'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { CallId } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime, { defineTool } from '@deepseek-ai/dsh-tools'
import * as PowerPolicy from '../src/index.ts'
import type { PowerPolicyDenial, PowerPolicyMode } from '../src/index.ts'

const TOOL_NAMES = [
  'read',
  'read_image',
  'grep',
  'glob',
  'power_report',
  'write',
  'edit',
  'bash',
  'inspect',
] as const

const FILE_TOOLS = ['read', 'read_image', 'write', 'edit'] as const

interface MountedPolicy {
  readonly ctx: Context
  readonly owner: Agent
  readonly scope: Context
  readonly row: ReturnType<Context['plugin']>
  readonly runs: Map<string, number>
}

function agent(id: string, cwd?: string): Agent {
  return {
    id: SessionId(id),
    session: { header: { ...cwd === undefined ? {} : { cwd } } },
  } as Agent
}

async function mount(mode: PowerPolicyMode, cwd?: string): Promise<MountedPolicy> {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt, {})
  await ctx.plugin(ToolRuntime, {})
  const runs = new Map<string, number>()
  for (const toolName of TOOL_NAMES) {
    ctx.tools.register(defineTool({
      name: toolName,
      description: `${toolName} test tool.`,
      parameters: {},
      output: {
        schema: { type: 'string' },
        render: (_args, value) => [{ type: 'text', text: value }],
      },
      execute: () => {
        runs.set(toolName, (runs.get(toolName) ?? 0) + 1)
        return Promise.resolve(toolName)
      },
    }))
  }
  const owner = agent(`policy-${mode}`, cwd)
  const scope = createScope(ctx, owner).ctx
  const row = scope.plugin(PowerPolicy, { mode })
  await row.await()
  return { ctx, owner, scope, row, runs }
}

async function execute(mounted: MountedPolicy, tool: string, arguments_: unknown = {}) {
  return mounted.ctx.tools.execute({
    signal: new AbortController().signal,
    callId: CallId(`call-${tool}`),
    name: tool,
    arguments: arguments_,
    agent: mounted.owner,
  })
}

function denial(result: Awaited<ReturnType<typeof execute>>): PowerPolicyDenial {
  expect(result.isError).toBe(true)
  const text = result.content
    .filter(block => block.type === 'text')
    .map(block => block.text)
    .join('')
  const expectedPrefix = `Error: ${PowerPolicy.POWER_POLICY_DENIAL_PREFIX}`
  expect(text.startsWith(expectedPrefix)).toBe(true)
  const parsed: unknown = JSON.parse(text.slice(expectedPrefix.length))
  return parsed as PowerPolicyDenial
}

describe('power policy', () => {
  it('exports one named function plugin with an explicit mode', () => {
    expect(PowerPolicy.name).toBe('power-policy')
    expect(PowerPolicy.inject).toEqual(['systemPrompt', 'tools'])
    expect('default' in PowerPolicy).toBe(false)
    expect(PowerPolicy.Config({ mode: 'review' })).toEqual({ mode: 'review' })
    expect(PowerPolicy.Config({ mode: 'fix' })).toEqual({ mode: 'fix' })
    expect(() => PowerPolicy.Config({} as never)).toThrow('$.mode missing required value')
    expect(() => PowerPolicy.Config({ mode: 'danger' } as never)).toThrow('$.mode expected "review" | "fix"')
  })

  it('requires an agent scope instead of installing process-wide authority', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt, {})
    await ctx.plugin(ToolRuntime, {})

    expect(() => { PowerPolicy.apply(ctx, { mode: 'review' }) })
      .toThrow('tools.presentAs() requires a scoped context')
    await ctx.fiber.dispose()
  })

  it('filters the review catalog after downstream assembly listeners run', async () => {
    const mounted = await mount('review')
    mounted.scope.on('system-prompt/assemble', async (_assembly, _context, next) => {
      const resolved = await next()
      const inspect = mounted.ctx.tools.schemas().find(tool => tool.name === 'inspect')
      /* v8 ignore next -- this test host always registers inspect above. */
      if (inspect === undefined) throw new Error('missing inspect test tool')
      return { ...resolved, tools: [...resolved.tools, inspect] }
    })

    const globalNames = (await mounted.ctx.systemPrompt.assemble()).tools.map(tool => tool.name)
    const scopedNames = (await mounted.ctx.systemPrompt.assemble({ scope: mounted.owner })).tools.map(tool => tool.name)

    expect(globalNames).toEqual([...TOOL_NAMES].sort())
    expect(scopedNames).toEqual(['glob', 'grep', 'power_report', 'read', 'read_image'])
    await mounted.ctx.fiber.dispose()
  })

  it('permits the non-filesystem review reporter without a session workspace', async () => {
    const mounted = await mount('review')

    const result = await execute(mounted, 'power_report')

    expect(result.isError).toBe(false)
    expect(mounted.runs.get('power_report')).toBe(1)
    await mounted.ctx.fiber.dispose()
  })

  it('permits omitted and canonical workspace-relative search roots in both modes', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-power-policy-workspace-'))
    try {
      await mkdir(join(root, 'src', 'nested'), { recursive: true })
      await symlink(
        join(root, 'src'),
        join(root, 'linked-src'),
        process.platform === 'win32' ? 'junction' : 'dir',
      )
      for (const mode of ['review', 'fix'] as const) {
        for (const [tool, arguments_] of [
          ['glob', { pattern: '**/*.ts' }],
          ['grep', { pattern: 'main', include: '*.ts' }],
          ['glob', { pattern: '**/*.ts', path: join('src', 'nested') }],
          ['grep', { pattern: 'main', path: 'linked-src' }],
        ] as const) {
          const mounted = await mount(mode, root)
          const result = await execute(mounted, tool, arguments_)

          expect(result.isError).toBe(false)
          expect(mounted.runs.get(tool)).toBe(1)
          await mounted.ctx.fiber.dispose()
        }
      }
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('permits existing session-relative file targets and prospective writes inside the workspace', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-power-policy-files-'))
    try {
      await mkdir(join(root, 'src'))
      await writeFile(join(root, 'src', 'existing.txt'), 'existing')
      await writeFile(join(root, 'src', 'image.png'), 'image')
      for (const [mode, calls] of [
        ['review', [
          ['read', { file_path: join('src', 'existing.txt') }],
          ['read_image', { file_path: join('src', 'image.png') }],
        ]],
        ['fix', [
          ['read', { file_path: join('src', 'existing.txt') }],
          ['read_image', { file_path: join('src', 'image.png') }],
          ['edit', { file_path: join('src', 'existing.txt') }],
          ['write', { file_path: join('src', 'existing.txt') }],
          ['write', { file_path: join('new', 'nested', 'created.txt') }],
        ]],
      ] as const) {
        for (const [tool, arguments_] of calls) {
          const mounted = await mount(mode, root)
          const result = await execute(mounted, tool, arguments_)

          expect(result.isError).toBe(false)
          expect(mounted.runs.get(tool)).toBe(1)
          await mounted.ctx.fiber.dispose()
        }
      }
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('denies malformed, rooted, traversing, unbound, and unverifiable search roots in both modes', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-power-policy-denials-'))
    try {
      const encodedTraversal = '%2e%2e%2foutside'
      const eightLayerTraversal = Array.from({ length: 7 })
        .reduce<string>(value => value.replaceAll('%', '%25'), encodedTraversal)
      const nineLayerTraversal = eightLayerTraversal.replaceAll('%', '%25')
      const encodedInvalid = Array.from({ length: 8 })
        .reduce<string>(value => value.replaceAll('%', '%25'), '%ZZ')
      const cases = [
        [null, 'invalid_arguments'],
        [[], 'invalid_arguments'],
        [{ pattern: '*', path: '' }, 'invalid_arguments'],
        [{ pattern: '*', path: 42 }, 'invalid_arguments'],
        [{ pattern: '*', path: '\u0000' }, 'invalid_arguments'],
        [{ pattern: '*', path: '/outside' }, 'absolute_path'],
        [{ pattern: '*', path: 'C:\\outside' }, 'absolute_path'],
        [{ pattern: '*', path: 'C:outside' }, 'absolute_path'],
        [{ pattern: '*', path: 'file:///outside' }, 'absolute_path'],
        [{ pattern: '*', path: '../outside' }, 'parent_traversal'],
        [{ pattern: '*', path: '..\\outside' }, 'parent_traversal'],
        [{ pattern: '*', path: 'safe/../outside' }, 'parent_traversal'],
        [{ pattern: '*', path: encodedTraversal }, 'parent_traversal'],
        [{ pattern: '*', path: '%252e%252e%252foutside' }, 'parent_traversal'],
        [{ pattern: '*', path: eightLayerTraversal }, 'parent_traversal'],
        [{ pattern: '*', path: nineLayerTraversal }, 'path_unverifiable'],
        [{ pattern: '*', path: '%' }, 'path_unverifiable'],
        [{ pattern: '*', path: encodedInvalid }, 'path_unverifiable'],
        [{ pattern: '*', path: 'missing' }, 'path_unverifiable'],
      ] as const

      for (const mode of ['review', 'fix'] as const) {
        for (const tool of ['glob', 'grep'] as const) {
          for (const [arguments_, category] of cases) {
            const mounted = await mount(mode, root)
            expect(denial(await execute(mounted, tool, arguments_))).toEqual({
              code: 'TOOL_ARGUMENTS_DENIED',
              mode,
              tool,
              category,
            })
            expect(mounted.runs.get(tool)).toBeUndefined()
            await mounted.ctx.fiber.dispose()
          }

          const unbound = await mount(mode)
          expect(denial(await execute(unbound, tool, { pattern: '*', path: '.' }))).toEqual({
            code: 'TOOL_ARGUMENTS_DENIED',
            mode,
            tool,
            category: 'workspace_unavailable',
          })
          expect(unbound.runs.get(tool)).toBeUndefined()
          await unbound.ctx.fiber.dispose()

          const defaultUnbound = await mount(mode)
          expect(denial(await execute(defaultUnbound, tool, { pattern: '*' }))).toEqual({
            code: 'TOOL_ARGUMENTS_DENIED',
            mode,
            tool,
            category: 'workspace_unavailable',
          })
          expect(defaultUnbound.runs.get(tool)).toBeUndefined()
          await defaultUnbound.ctx.fiber.dispose()
        }
      }
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('denies malformed, rooted, traversing, encoded, and unbound model file paths', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-power-policy-file-denials-'))
    try {
      const encodedTraversal = '%2e%2e%2foutside'
      const eightLayerTraversal = Array.from({ length: 7 })
        .reduce<string>(value => value.replaceAll('%', '%25'), encodedTraversal)
      const nineLayerTraversal = eightLayerTraversal.replaceAll('%', '%25')
      const cases = [
        [null, 'invalid_arguments'],
        [[], 'invalid_arguments'],
        [{}, 'invalid_arguments'],
        [{ file_path: '' }, 'invalid_arguments'],
        [{ file_path: 42 }, 'invalid_arguments'],
        [{ file_path: '\u0000' }, 'invalid_arguments'],
        [{ file_path: '/outside' }, 'absolute_path'],
        [{ file_path: 'C:\\outside' }, 'absolute_path'],
        [{ file_path: 'C:outside' }, 'absolute_path'],
        [{ file_path: 'file:///outside' }, 'absolute_path'],
        [{ file_path: '../outside' }, 'parent_traversal'],
        [{ file_path: '..\\outside' }, 'parent_traversal'],
        [{ file_path: 'safe/../outside' }, 'parent_traversal'],
        [{ file_path: encodedTraversal }, 'parent_traversal'],
        [{ file_path: '%252e%252e%252foutside' }, 'parent_traversal'],
        [{ file_path: eightLayerTraversal }, 'parent_traversal'],
        [{ file_path: nineLayerTraversal }, 'path_unverifiable'],
      ] as const

      for (const [mode, tools] of [
        ['review', ['read', 'read_image']],
        ['fix', FILE_TOOLS],
      ] as const) {
        for (const tool of tools) {
          for (const [arguments_, category] of cases) {
            const mounted = await mount(mode, root)
            expect(denial(await execute(mounted, tool, arguments_))).toEqual({
              code: 'TOOL_ARGUMENTS_DENIED',
              mode,
              tool,
              category,
            })
            expect(mounted.runs.get(tool)).toBeUndefined()
            await mounted.ctx.fiber.dispose()
          }

          const unbound = await mount(mode)
          expect(denial(await execute(unbound, tool, { file_path: 'inside.txt' }))).toEqual({
            code: 'TOOL_ARGUMENTS_DENIED',
            mode,
            tool,
            category: 'workspace_unavailable',
          })
          expect(unbound.runs.get(tool)).toBeUndefined()
          await unbound.ctx.fiber.dispose()
        }
      }
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('blocks sibling access even when the filesystem provider has a broader cwd', async () => {
    const providerRoot = await mkdtemp(join(tmpdir(), 'dsh-power-policy-provider-root-'))
    const workspace = join(providerRoot, 'session-workspace')
    try {
      await mkdir(workspace)
      await writeFile(join(providerRoot, 'sibling-secret.txt'), 'secret')
      for (const [mode, tools] of [
        ['review', ['read', 'read_image']],
        ['fix', FILE_TOOLS],
      ] as const) {
        for (const tool of tools) {
          const mounted = await mount(mode, workspace)
          const arguments_ = { file_path: join('..', 'sibling-secret.txt') }
          expect(denial(await execute(mounted, tool, arguments_))).toEqual({
            code: 'TOOL_ARGUMENTS_DENIED',
            mode,
            tool,
            category: 'parent_traversal',
          })
          expect(mounted.runs.get(tool)).toBeUndefined()
          await mounted.ctx.fiber.dispose()
        }
      }
    } finally {
      await rm(providerRoot, { recursive: true, force: true })
    }
  })

  it('rejects a supplied symlink or junction whose canonical target leaves the session workspace', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-power-policy-link-'))
    const workspace = join(root, 'workspace')
    const outside = join(root, 'outside')
    try {
      await mkdir(workspace)
      await mkdir(outside)
      await writeFile(join(outside, 'existing.txt'), 'outside')
      await symlink(outside, join(workspace, 'escape'), process.platform === 'win32' ? 'junction' : 'dir')

      for (const mode of ['review', 'fix'] as const) {
        for (const tool of ['glob', 'grep'] as const) {
          const mounted = await mount(mode, workspace)
          expect(denial(await execute(mounted, tool, { pattern: '*', path: 'escape' }))).toEqual({
            code: 'TOOL_ARGUMENTS_DENIED',
            mode,
            tool,
            category: 'workspace_escape',
          })
          expect(mounted.runs.get(tool)).toBeUndefined()
          await mounted.ctx.fiber.dispose()
        }
      }

      for (const [mode, tools] of [
        ['review', ['read', 'read_image']],
        ['fix', FILE_TOOLS],
      ] as const) {
        for (const tool of tools) {
          for (const target of tool === 'write'
            ? [join('escape', 'existing.txt'), join('escape', 'new.txt')]
            : [join('escape', 'existing.txt')]) {
            const mounted = await mount(mode, workspace)
            expect(denial(await execute(mounted, tool, { file_path: target }))).toEqual({
              code: 'TOOL_ARGUMENTS_DENIED',
              mode,
              tool,
              category: 'workspace_escape',
            })
            expect(mounted.runs.get(tool)).toBeUndefined()
            await mounted.ctx.fiber.dispose()
          }
        }
      }
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('fails closed for missing read/edit targets, invalid ancestors, and invalid workspaces', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-power-policy-unverifiable-'))
    const workspace = join(root, 'workspace')
    try {
      await mkdir(workspace)
      await writeFile(join(workspace, 'not-a-directory'), 'file')

      for (const tool of ['read', 'read_image', 'edit'] as const) {
        const mounted = await mount('fix', workspace)
        expect(denial(await execute(mounted, tool, { file_path: 'missing.txt' }))).toMatchObject({
          code: 'TOOL_ARGUMENTS_DENIED',
          tool,
          category: 'path_unverifiable',
        })
        expect(mounted.runs.get(tool)).toBeUndefined()
        await mounted.ctx.fiber.dispose()
      }

      const invalidAncestor = await mount('fix', workspace)
      expect(denial(await execute(invalidAncestor, 'write', {
        file_path: join('not-a-directory', 'new.txt'),
      }))).toMatchObject({
        code: 'TOOL_ARGUMENTS_DENIED',
        tool: 'write',
        category: 'path_unverifiable',
      })
      expect(invalidAncestor.runs.get('write')).toBeUndefined()
      await invalidAncestor.ctx.fiber.dispose()

      const cwdFile = join(root, 'cwd-file')
      await writeFile(cwdFile, 'file')
      for (const cwd of [cwdFile, join(root, 'missing-workspace')]) {
        const mounted = await mount('review', cwd)
        expect(denial(await execute(mounted, 'read', { file_path: '.' }))).toMatchObject({
          code: 'TOOL_ARGUMENTS_DENIED',
          category: 'path_unverifiable',
        })
        await mounted.ctx.fiber.dispose()
      }

      const relativeCwd = await mount('review', 'relative-workspace')
      expect(denial(await execute(relativeCwd, 'read', { file_path: 'inside.txt' }))).toMatchObject({
        code: 'TOOL_ARGUMENTS_DENIED',
        category: 'workspace_unavailable',
      })
      await relativeCwd.ctx.fiber.dispose()
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it.each([
    ['review', 'write'],
    ['review', 'edit'],
    ['fix', 'inspect'],
  ] as const)('rejects ordinary non-allowlisted tool %s/%s', async (mode, tool) => {
    const mounted = await mount(mode)

    expect(denial(await execute(mounted, tool))).toEqual({
      code: 'TOOL_NOT_ALLOWED',
      mode,
      tool,
      category: 'not_allowlisted',
    })
    expect(mounted.runs.get(tool)).toBeUndefined()
    await mounted.ctx.fiber.dispose()
  })

  it.each([
    ['pwsh', 'shell'],
    ['exec_command', 'shell'],
    ['browser_open', 'external_egress'],
    ['git_push', 'external_egress'],
    ['git_publish', 'external_egress'],
    ['clear_nvm', 'nvm_destructive'],
    ['factory_reset', 'nvm_destructive'],
    ['set_pwm', 'power_actuation'],
    ['enable_power_stage', 'power_actuation'],
    ['enable_gate_driver', 'power_actuation'],
    ['flash_board', 'target_execution'],
    ['can_bus_control', 'target_execution'],
  ] as const)('classifies high-risk tool %s as %s in both modes', async (tool, category) => {
    for (const mode of ['review', 'fix'] as const) {
      const mounted = await mount(mode)

      expect(denial(await execute(mounted, tool))).toEqual({
        code: 'HIGH_RISK_TOOL',
        mode,
        tool,
        category,
      })
      await mounted.ctx.fiber.dispose()
    }
  })

  it('does not disclose denied call arguments', async () => {
    const mounted = await mount('fix')

    const result = await execute(mounted, 'inspect', { secret: 'must-not-appear' })

    expect(JSON.stringify(result)).not.toContain('must-not-appear')
    expect(denial(result)).toMatchObject({ tool: 'inspect' })
    await mounted.ctx.fiber.dispose()
  })

  it('does not disclose a rejected search root', async () => {
    const mounted = await mount('review')
    const secretPath = '../private-workspace-token'

    const result = await execute(mounted, 'grep', { pattern: 'token', path: secretPath })

    expect(JSON.stringify(result)).not.toContain(secretPath)
    expect(denial(result)).toMatchObject({
      code: 'TOOL_ARGUMENTS_DENIED',
      category: 'parent_traversal',
    })
    await mounted.ctx.fiber.dispose()
  })

  it.each(FILE_TOOLS)('does not disclose a rejected %s file path', async (tool) => {
    const mounted = await mount('fix')
    const secretPath = '../private-file-token'

    const result = await execute(mounted, tool, { file_path: secretPath })

    expect(JSON.stringify(result)).not.toContain(secretPath)
    expect(denial(result)).toMatchObject({
      code: 'TOOL_ARGUMENTS_DENIED',
      category: 'parent_traversal',
    })
    await mounted.ctx.fiber.dispose()
  })

  it('denies after extensible pre-execute policy attempts to allow the call', async () => {
    const mounted = await mount('review')
    mounted.scope.on('tools/pre-execute', () => Promise.resolve({ kind: 'allow' }))

    const result = await execute(mounted, 'inspect')

    expect(denial(result)).toMatchObject({ code: 'TOOL_NOT_ALLOWED' })
    expect(mounted.runs.get('inspect')).toBeUndefined()
    await mounted.ctx.fiber.dispose()
  })

  it.each([
    ['glob', { pattern: '*', path: '../outside' }],
    ['read', { file_path: '../outside' }],
  ] as const)('keeps the %s workspace-path guard monotonic after pre-execute allows', async (tool, arguments_) => {
    const mounted = await mount('review')
    mounted.scope.on('tools/pre-execute', () => Promise.resolve({ kind: 'allow' }))

    const result = await execute(mounted, tool, arguments_)

    expect(denial(result)).toMatchObject({
      code: 'TOOL_ARGUMENTS_DENIED',
      category: 'parent_traversal',
    })
    expect(mounted.runs.get(tool)).toBeUndefined()
    await mounted.ctx.fiber.dispose()
  })

  it('isolates authority to the covered agent', async () => {
    const mounted = await mount('review')
    const other = agent('uncovered')

    const denied = await execute(mounted, 'inspect')
    const permitted = await mounted.ctx.tools.execute({
      signal: new AbortController().signal,
      callId: CallId('other-inspect'),
      name: 'inspect',
      arguments: {},
      agent: other,
    })

    expect(denial(denied)).toMatchObject({ category: 'not_allowlisted' })
    expect(permitted.isError).toBe(false)
    expect(mounted.runs.get('inspect')).toBe(1)
    await mounted.ctx.fiber.dispose()
  })

  it('declares native presentation and removes every registration on disposal', async () => {
    const mounted = await mount('review')
    const tools = mounted.scope.get('tools')
    /* v8 ignore next -- the mounted row injects tools before this assertion. */
    if (tools === undefined) throw new Error('missing scoped tool runtime')
    expect(() => tools.presentAs('code'))
      .toThrow('conflicts with "native" already declared for this scope')

    await mounted.row.dispose()

    const names = (await mounted.ctx.systemPrompt.assemble({ scope: mounted.owner })).tools.map(tool => tool.name)
    const result = await execute(mounted, 'inspect')
    expect(names).toEqual([...TOOL_NAMES].sort())
    expect(result.isError).toBe(false)
    expect(mounted.runs.get('inspect')).toBe(1)
    const restore = tools.presentAs('code')
    restore()
    await mounted.ctx.fiber.dispose()
  })
})
