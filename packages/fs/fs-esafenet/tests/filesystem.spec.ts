import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { existsSync } from 'node:fs'
import { chmod, mkdtemp, mkdir, rm, stat, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { EsafenetFileSystem } from '@deepseek-ai/dsh-fs-esafenet'
import { SandboxPolicyService } from '@deepseek-ai/dsh-sandbox-policy'
import type { FsTarget } from '@deepseek-ai/dsh-fs'

vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 })

let directory: string
let ctx: Context
let fs: EsafenetFileSystem
let confinedArgv: string[][]

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'dsh-esafenet-'))
  confinedArgv = []
  ctx = new Context()
  ctx.provide('sandbox')
  ctx.set('sandbox', {
    confine: (argv: readonly string[]) => {
      confinedArgv.push([...argv])
      return {
        argv: [...argv],
        enforcement: 'full',
        denialSignatures: [],
        runnerFailureRules: [],
      }
    },
  } as never)
  await ctx.plugin(SandboxPolicyService, { mode: 'workspace-write', workspaceRoot: directory })
  await ctx.plugin(EsafenetFileSystem, {
    cwd: directory,
    operationTimeoutMs: 10_000,
    maxTextBytes: 1024 * 1024,
  })
  fs = ctx.fs as EsafenetFileSystem
})

afterEach(async () => {
  await ctx.fiber.dispose()
  await rm(directory, { recursive: true, force: true })
})

async function versionOf(target: FsTarget) {
  const info = await fs.stat(target)
  if (!info) throw new Error('expected file metadata')
  return info.version
}

describe('fixed PowerShell bridge', () => {
  it('reads text, streams text, and reads bounded bytes through structured stdin', async () => {
    const name = "literal '; Write-Output injected.txt"
    await writeFile(join(directory, name), 'one\ntwo')
    const target = await fs.resolve(name)

    expect(await fs.readText(target)).toBe('one\ntwo')
    let streamed = ''
    for await (const chunk of await fs.streamText(target)) streamed += chunk
    expect(streamed).toBe('one\ntwo')
    expect(Buffer.from(await fs.readBytes(target, undefined, 7)).toString('utf8')).toBe('one\ntwo')
    await expect(fs.readBytes(target, undefined, 6)).rejects.toMatchObject({ code: 'FS_TOO_LARGE' })
    expect(confinedArgv).not.toHaveLength(0)
    expect(basename(confinedArgv[0]?.[0] ?? '')).toBe(process.platform === 'win32' ? 'code.exe' : 'pwsh')
    expect(confinedArgv.flat().join('\n')).not.toContain(name)
  })

  it('rejects binary, invalid UTF-8, directories, missing files, and aborted reads', async () => {
    await writeFile(join(directory, 'binary.bin'), Buffer.from([0x61, 0x00, 0x62]))
    await writeFile(join(directory, 'invalid.txt'), Buffer.from([0x61, 0xff, 0x62]))
    await expect(fs.readText(await fs.resolve('binary.bin'))).rejects.toMatchObject({ code: 'FS_NOT_TEXT' })
    await expect(fs.readText(await fs.resolve('invalid.txt'))).rejects.toMatchObject({ code: 'FS_NOT_TEXT' })
    await expect(fs.readText(await fs.resolve('.'))).rejects.toMatchObject({ code: 'FS_NOT_REGULAR_FILE' })
    await expect(fs.readText(await fs.resolve('missing.txt'))).rejects.toMatchObject({ code: 'FS_NOT_FOUND' })
    await expect(fs.readText(await fs.resolve('missing.txt'), AbortSignal.abort())).rejects.toMatchObject({ code: 'FS_ABORTED' })
    await expect(fs.readBytes(await fs.resolve('missing.txt'), undefined, 0)).rejects.toThrow(
      'fs-esafenet: maxBytes must be a positive safe integer',
    )
  })

  it('creates, guarded-replaces, and edits while preserving CRLF storage', async () => {
    const target = await fs.resolve('control.c')
    const created = await fs.writeText(target, 'a\r\nOLD\r\nb\r\n', { kind: 'createIfAbsent' })
    expect(created.operation).toBe('create')
    expect(created.before).toBeNull()
    expect(created.after).toBe('a\nOLD\nb\n')

    const edited = await fs.editText(
      target,
      { oldString: 'OLD', newString: 'NEW', replaceAll: false },
      { version: created.version },
    )
    expect(edited).toMatchObject({ before: 'a\nOLD\nb\n', after: 'a\nNEW\nb\n' })
    expect(await fs.readText(target)).toBe('a\r\nNEW\r\nb\r\n')

    const replaced = await fs.writeText(
      target,
      'final',
      { kind: 'replaceIfVersion', version: edited.version },
    )
    expect(replaced.operation).toBe('update')
    expect(replaced.before).toBe('a\nNEW\nb\n')
    expect(replaced.version).toBe(await versionOf(target))
    expect(await fs.readText(target)).toBe('final')
  })

  it('fails closed on stale guards, ambiguous edits, and non-regular targets', async () => {
    await writeFile(join(directory, 'repeated.txt'), 'a a')
    const target = await fs.resolve('repeated.txt')
    const current = await versionOf(target)
    await expect(fs.writeText(target, 'x', { kind: 'createIfAbsent' }))
      .rejects.toMatchObject({ code: 'FS_NOT_OBSERVED' })
    await writeFile(join(directory, 'repeated.txt'), 'changed externally')
    await expect(fs.writeText(target, 'x', { kind: 'replaceIfVersion', version: current }))
      .rejects.toMatchObject({ code: 'FS_STALE_VERSION' })
    const changedVersion = await versionOf(target)
    await fs.writeText(target, 'a a', { kind: 'replaceIfVersion', version: changedVersion })
    const repeatedVersion = await versionOf(target)
    await expect(fs.editText(target, { oldString: 'a', newString: 'b', replaceAll: false }, { version: repeatedVersion }))
      .rejects.toMatchObject({ code: 'FS_AMBIGUOUS_EDIT' })
    await expect(fs.editText(target, { oldString: 'z', newString: 'b', replaceAll: false }, { version: repeatedVersion }))
      .rejects.toMatchObject({ code: 'FS_EDIT_NOT_FOUND' })
    await expect(fs.editText(target, { oldString: '', newString: 'b', replaceAll: false }, { version: repeatedVersion }))
      .rejects.toMatchObject({ code: 'FS_EDIT_NOT_FOUND' })
    await expect(fs.editText(await fs.resolve('missing.txt'), { oldString: 'a', newString: 'b', replaceAll: false }))
      .rejects.toMatchObject({ code: 'FS_STALE_VERSION' })
    await expect(fs.writeText(await fs.resolve('.'), 'x'))
      .rejects.toMatchObject({ code: 'FS_NOT_REGULAR_FILE' })
  })

  it('serializes same-target guarded mutations so only one wins', async () => {
    await writeFile(join(directory, 'race.txt'), 'base')
    const target = await fs.resolve('race.txt')
    const version = await versionOf(target)
    const results = await Promise.allSettled([
      fs.writeText(target, 'one', { kind: 'replaceIfVersion', version }),
      fs.editText(target, { oldString: 'base', newString: 'two', replaceAll: false }, { version }),
    ])
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1)
    expect(results.filter(result => result.status === 'rejected')).toHaveLength(1)
    expect((results.find(result => result.status === 'rejected') as PromiseRejectedResult).reason)
      .toMatchObject({ code: 'FS_STALE_VERSION' })
  })

  it.runIf(process.platform !== 'win32')('preserves the published Unix mode when replacing content', async () => {
    const path = join(directory, 'executable.sh')
    await writeFile(path, '#!/bin/sh\nexit 0\n')
    await chmod(path, 0o750)
    const target = await fs.resolve('executable.sh')
    const version = await versionOf(target)

    await fs.writeText(target, '#!/bin/sh\nexit 1\n', { kind: 'replaceIfVersion', version })

    expect((await stat(path)).mode & 0o777).toBe(0o750)
  })

  it('removes the private code.exe alias when the provider is disposed', async () => {
    await writeFile(join(directory, 'dispose.txt'), 'value')
    await fs.readText(await fs.resolve('dispose.txt'))
    const executable = confinedArgv[0]?.[0]
    expect(executable).toBeDefined()

    await ctx.fiber.dispose()

    if (process.platform === 'win32') expect(existsSync(executable as string)).toBe(false)
  })
})

describe('sandbox and configuration', () => {
  it('denies all writes in read-only mode and writes outside the workspace', async () => {
    const inside = await fs.resolve('inside.txt')
    await expect(fs.writeText(inside, 'denied', undefined, undefined, {
      mode: 'read-only',
      workspaceRoot: directory,
    })).rejects.toMatchObject({ code: 'FS_SANDBOX_DENIED' })

    const outsideTarget = await fs.resolve(join(process.cwd(), 'dsh-esafenet-denied-write.txt'))
    await expect(fs.writeText(outsideTarget, 'denied')).rejects.toMatchObject({ code: 'FS_SANDBOX_DENIED' })
    await expect(fs.readText(await fs.resolve(join(process.cwd(), 'package.json'))))
      .rejects.toMatchObject({ code: 'FS_SANDBOX_DENIED' })
    await expect(fs.writeText(inside, 'denied', undefined, undefined, {
      mode: 'danger-full-access',
      workspaceRoot: directory,
    })).rejects.toMatchObject({ code: 'FS_SANDBOX_DENIED' })
  })

  it.runIf(process.platform === 'win32')('rejects a junction whose resolved target leaves the workspace', async () => {
    const outside = await mkdtemp(join(tmpdir(), 'dsh-esafenet-outside-'))
    try {
      await writeFile(join(outside, 'outside.txt'), 'outside')
      await symlink(outside, join(directory, 'escape'), 'junction')
      const escaped = await fs.resolve('escape/outside.txt')
      await expect(fs.readText(escaped)).rejects.toMatchObject({ code: 'FS_SANDBOX_DENIED' })
      await expect(fs.writeText(escaped, 'denied')).rejects.toMatchObject({ code: 'FS_SANDBOX_DENIED' })
    }
    finally {
      await rm(outside, { recursive: true, force: true })
    }
  })

  it.runIf(process.platform === 'win32')('validates configuration before creating a private code.exe alias', async () => {
    const aliasParent = await mkdtemp(join(tmpdir(), 'dsh-esafenet-invalid-alias-'))
    const priorLocalAppData = process.env.LOCALAPPDATA
    const invalid = new Context()
    try {
      process.env.LOCALAPPDATA = aliasParent
      invalid.provide('sandbox')
      invalid.set('sandbox', {
        confine: (argv: readonly string[]) => ({
          argv: [...argv],
          enforcement: 'full',
          denialSignatures: [],
          runnerFailureRules: [],
        }),
      } as never)
      await invalid.plugin(SandboxPolicyService, { mode: 'workspace-write', workspaceRoot: directory })

      expect(() => new EsafenetFileSystem(invalid, {
        cwd: directory,
        diffBasisMaxBytes: 1024,
        operationTimeoutMs: 0,
        maxTextBytes: 1024,
      })).toThrow(/operationTimeoutMs must be a positive safe integer/)
      expect(existsSync(join(aliasParent, 'DeepSeekHarness', 'esafenet-bridge'))).toBe(false)
    }
    finally {
      if (priorLocalAppData === undefined) delete process.env.LOCALAPPDATA
      else process.env.LOCALAPPDATA = priorLocalAppData
      await invalid.fiber.dispose()
      await rm(aliasParent, { recursive: true, force: true })
    }
  })

  it('accepts nested workspace paths and rejects invalid numeric config', async () => {
    await mkdir(join(directory, 'nested'))
    const nested = await fs.resolve('nested/value.txt')
    await fs.writeText(nested, 'ok')
    expect(await fs.readText(nested)).toBe('ok')
    await expect(fs.writeText(await fs.resolve('large.txt'), 'x'.repeat(1024 * 1024 + 1)))
      .rejects.toMatchObject({ code: 'FS_TOO_LARGE' })

    for (const config of [
      { operationTimeoutMs: 0 },
      { operationTimeoutMs: 2_147_483_648 },
      { maxTextBytes: -1 },
      { maxTextBytes: 64 * 1024 * 1024 + 1 },
    ]) {
      const invalid = new Context()
      invalid.provide('sandbox')
      invalid.set('sandbox', {
        confine: (argv: readonly string[]) => ({
          argv: [...argv],
          enforcement: 'full',
          denialSignatures: [],
          runnerFailureRules: [],
        }),
      } as never)
      await invalid.plugin(SandboxPolicyService, { mode: 'workspace-write', workspaceRoot: directory })
      await expect(invalid.plugin(EsafenetFileSystem, { cwd: directory, ...config })).rejects.toThrow(
        /must be a positive safe integer/,
      )
      await invalid.fiber.dispose()
    }
  })
})
