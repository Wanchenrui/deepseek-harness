import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import { createScope, type ScopeKey } from '@deepseek-ai/dsh-scope'
import SystemPrompt, { renderPrompt } from '@deepseek-ai/dsh-system-prompt'
import { describe, expect, it } from 'vitest'
import * as PowerPrompt from '../src/index.ts'

const expectedDefaultPrompt = fileURLToPath(new URL(
  './fixtures/default-prompt.expected.md',
  import.meta.url,
))

async function harness(): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt, { includeHarnessIdentity: false })
  return ctx
}

function powerSections(ctx: Context, scope?: ScopeKey) {
  return ctx.systemPrompt.assemble(scope === undefined ? {} : { scope })
    .then(assembly => assembly.sections.filter(section => section.name.startsWith('power:')))
}

describe('power prompt', () => {
  it('pins the complete conservative prompt and section order', async () => {
    const ctx = await harness()
    await ctx.plugin(PowerPrompt, {})

    const expected = await readFile(expectedDefaultPrompt, 'utf8')
    const assembly = await ctx.systemPrompt.assemble()
    expect(renderPrompt(assembly)).toBe(expected.trimEnd())
    expect((await powerSections(ctx)).map(section => section.name)).toEqual([
      'power:role',
      'power:priority',
      'power:evidence',
      'power:authorization',
      'power:realtime-safety',
      'power:architecture-compatibility',
      'power:output',
      'power:environment',
    ])
    const fixedText = (await powerSections(ctx)).slice(0, -1).map(section => section.text).join('\n\n')
    expect(`sha256:${createHash('sha256').update(fixedText).digest('hex')}`)
      .toBe(PowerPrompt.POWER_PROMPT_FINGERPRINT)
    await ctx.fiber.dispose()
  })

  it('resolves safe defaults and rejects unsupported environment values', () => {
    expect(PowerPrompt.Config({})).toEqual({
      sourceAccess: 'native',
      sourceMutation: 'read-only',
      verification: 'static-only',
    })
    expect(() => PowerPrompt.Config({ sourceAccess: 'shell' as never })).toThrow()
    expect(() => PowerPrompt.Config({ sourceMutation: 'unrestricted' as never })).toThrow()
    expect(() => PowerPrompt.Config({ verification: 'target-board' as never })).toThrow()
  })

  it('keeps conservative defaults when apply bypasses schema resolution', async () => {
    const ctx = await harness()
    await ctx.plugin(Object.assign((inner: Context) => {
      PowerPrompt.apply(inner, {})
    }, { inject: ['systemPrompt'] }))

    expect((await powerSections(ctx)).at(-1)?.text).toContain('源码变更：只读')
    expect((await powerSections(ctx)).at(-1)?.text).toContain('验证范围：仅限静态读码与差异检查')
    await ctx.fiber.dispose()
  })

  it('describes the fixed PowerShell bridge without weakening immutable sections', async () => {
    const baseline = await harness()
    await baseline.plugin(PowerPrompt, {})
    const baselineSections = await powerSections(baseline)

    const configured = await harness()
    await configured.plugin(PowerPrompt, {
      sourceAccess: 'powershell-fixed',
      sourceMutation: 'task-scoped',
      verification: 'build-test',
    })
    const configuredSections = await powerSections(configured)

    expect(configuredSections.slice(0, -1)).toEqual(baselineSections.slice(0, -1))
    expect(configuredSections.at(-1)?.text).toBe(`## 当前环境约束

- 源码访问：固定且参数化的 PowerShell Get-Content/Set-Content 通道。
- 源码变更：仅限用户明确要求的源码任务范围；不得扩大修改面。
- 验证范围：允许在任务范围内构建、静态分析和运行单元测试，但不包含目标板执行。
- Esafenet 文件只能通过上述固定通道访问；运行时可在安装控制下使用 code.exe 进程别名承载该固定桥接，但不得暴露任意 PowerShell，也不得把该通道解释为目标板权限。
- 这些配置仅描述当前组合，不授予任何额外权限；固定授权边界和功率安全要求始终有效。`)
    expect(configuredSections.map(section => section.text).join('\n')).toContain('任何使目标芯片运行的操作都必须先取得任务级明确授权')
    expect(configuredSections.map(section => section.text).join('\n')).toContain('不得自动降低保护强度或扩大物理动作范围')

    await baseline.fiber.dispose()
    await configured.fiber.dispose()
  })

  it('keeps scoped prompt registrations isolated and removes them on fiber disposal', async () => {
    const ctx = await harness()
    const key: ScopeKey = { agent: 'power-agent' }
    const fiber = await createScope(ctx, key).ctx.plugin(PowerPrompt, {})

    expect(await powerSections(ctx)).toEqual([])
    expect(await powerSections(ctx, key)).toHaveLength(8)

    await fiber.dispose()
    expect(await powerSections(ctx, key)).toEqual([])
    await ctx.fiber.dispose()
  })

  it('fails loud on a duplicate mount without duplicating prompt text', async () => {
    const ctx = await harness()
    await ctx.plugin(PowerPrompt, {})

    await expect(ctx.plugin(PowerPrompt, {})).rejects.toThrow(/power:role.*already registered/u)
    expect(await powerSections(ctx)).toHaveLength(8)
    await ctx.fiber.dispose()
  })

  it('preserves the namespace plugin export through the real Loader unwrap path', async () => {
    expect('default' in PowerPrompt).toBe(false)
    const loader = Object.create(Loader.prototype) as Loader
    const unwrapped = loader.unwrapExports(PowerPrompt) as Record<string, unknown>
    expect(unwrapped).toBe(PowerPrompt)
    expect(unwrapped.name).toBe('power-prompt')
    expect(unwrapped.inject).toEqual(['systemPrompt'])
    expect(unwrapped.Config).toBeDefined()
    expect(typeof unwrapped.apply).toBe('function')

    const ctx = await harness()
    const plugin = loader.unwrapExports(PowerPrompt) as Parameters<Context['plugin']>[0]
    await ctx.plugin(plugin, {})
    expect(await powerSections(ctx)).toHaveLength(8)
    await ctx.fiber.dispose()
  })
})
