import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { inspectRuntimeClosure } from './verify-runtime-closure.ts'

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function writeManifest(root: string, file: string, manifest: Record<string, unknown>): string {
  const target = join(root, file)
  mkdirSync(dirname(target), { recursive: true })
  writeFileSync(target, `${JSON.stringify(manifest, null, 2)}\n`)
  return target
}

describe('runtime closure verifier', () => {
  it('checks required peers reached through an app package', async () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-runtime-closure-'))
    roots.push(root)
    writeManifest(root, 'apps/cli/package.json', {
      name: '@deepseek-ai/dsh',
      peerDependencies: { '@deepseek-ai/dsh-scope': 'workspace:^' },
    })
    writeManifest(root, 'packages/core/scope/package.json', { name: '@deepseek-ai/dsh-scope' })
    const runtime = writeManifest(root, 'apps/runtime/package.json', {
      name: 'runtime-probe',
      dependencies: { '@deepseek-ai/dsh': 'workspace:^' },
    })

    await expect(inspectRuntimeClosure(root, runtime)).resolves.toEqual({
      runtimeName: 'runtime-probe',
      packageCount: 1,
      failures: ['runtime-probe -> @deepseek-ai/dsh -> @deepseek-ai/dsh-scope'],
    })
  })

  it('accepts both checked-in dependency-only runtime manifests', async () => {
    const root = resolve(import.meta.dirname, '..')
    const manifests = [
      'python/sdk-runtime/package.json',
      'apps/power-desktop-runtime/package.json',
    ]
    for (const manifest of manifests) {
      const result = await inspectRuntimeClosure(root, resolve(root, manifest))
      expect(result.failures, manifest).toEqual([])
      expect(result.packageCount, manifest).toBeGreaterThan(0)
    }
  })
})
