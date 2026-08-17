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

function writeWorkspace(root: string, patterns: readonly string[]): void {
  writeFileSync(join(root, 'pnpm-workspace.yaml'), `packages:\n${patterns.map(pattern => `  - ${pattern}`).join('\n')}\n`)
}

describe('runtime closure verifier', () => {
  it('checks required peers reached through an app package', async () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-runtime-closure-'))
    roots.push(root)
    writeWorkspace(root, ['apps/*', 'packages/*/*'])
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

  it('follows the declared native launcher root and package patterns', async () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-runtime-closure-native-'))
    roots.push(root)
    writeWorkspace(root, [
      'apps/*',
      'native/landlock-run',
      'native/landlock-run/packages/*',
    ])
    writeManifest(root, 'native/landlock-run/package.json', {
      name: '@probe/landlock-workspace',
      dependencies: { '@probe/landlock-entry': 'workspace:*' },
    })
    writeManifest(root, 'native/landlock-run/packages/entry/package.json', {
      name: '@probe/landlock-entry',
      peerDependencies: { '@probe/landlock-linux-x64': 'workspace:*' },
    })
    writeManifest(root, 'native/landlock-run/packages/linux-x64/package.json', {
      name: '@probe/landlock-linux-x64',
    })
    const runtime = writeManifest(root, 'apps/runtime/package.json', {
      name: 'native-runtime-probe',
      dependencies: { '@probe/landlock-workspace': 'workspace:*' },
    })

    await expect(inspectRuntimeClosure(root, runtime)).resolves.toEqual({
      runtimeName: 'native-runtime-probe',
      packageCount: 2,
      failures: [
        'native-runtime-probe -> @probe/landlock-workspace -> @probe/landlock-entry -> @probe/landlock-linux-x64',
      ],
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
