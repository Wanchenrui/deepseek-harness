/** Assembled base → web-app → power-desktop authority and provider checks. */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import * as yaml from 'js-yaml'
import {
  applyEntryPatches,
  entryListSchema,
  type PatchOptions,
} from '@deepseek-ai/cordis-plugin-include'
import type { EntryOptions } from '@deepseek-ai/cordis-plugin-loader'

const packageRoot = fileURLToPath(new URL('..', import.meta.url))
const repositoryRoot = resolve(packageRoot, '../../..')

function readPatches(path: string): PatchOptions[] {
  const parsed = yaml.load(readFileSync(path, 'utf8'), { schema: entryListSchema })
  if (!Array.isArray(parsed)) throw new TypeError(`${path} must contain a patch list`)
  return parsed as PatchOptions[]
}

function composePowerDesktop(): { rows: EntryOptions[]; warnings: string[] } {
  const warnings: string[] = []
  const warn = (message: string, ...args: unknown[]): void => {
    let index = 0
    warnings.push(message.replaceAll('%C', () => JSON.stringify(args[index++])))
  }
  const base = readPatches(resolve(repositoryRoot, 'packages/bundle/base/cordis.patch.yml'))
  const web = readPatches(resolve(repositoryRoot, 'packages/bundle/web-app/cordis.patch.yml'))
  const power = readPatches(resolve(packageRoot, 'cordis.patch.yml'))
  const afterBase = applyEntryPatches([], base, warn)
  const afterWeb = applyEntryPatches(afterBase, web, warn)
  return { rows: applyEntryPatches(afterWeb, power, warn), warnings }
}

function byId(rows: readonly EntryOptions[]): Map<string, EntryOptions> {
  return new Map(rows.flatMap(row => row.id === undefined ? [] : [[row.id, row] as const]))
}

function presetRows(id: 'power-review' | 'power-fix'): EntryOptions[] {
  const path = resolve(repositoryRoot, `apps/cli/config/agent-presets/${id}/agent.cordis.yml`)
  const parsed = yaml.load(readFileSync(path, 'utf8'), { schema: entryListSchema })
  if (!Array.isArray(parsed)) throw new TypeError(`${id} must contain an entry list`)
  return parsed as EntryOptions[]
}

describe('power-desktop bundle composition', () => {
  it('applies after the real base and web-app layers without an unknown id', () => {
    const { warnings } = composePowerDesktop()
    expect(warnings).toEqual([])
  })

  it('keeps the process sandbox, swaps the filesystem provider, and closes egress and commands', () => {
    const { rows } = composePowerDesktop()
    const entries = byId(rows)

    expect(entries.get('sandbox')).toMatchObject({
      name: '@deepseek-ai/dsh-sandbox-local',
    })
    expect(entries.get('sandbox')?.disabled).not.toBe(true)
    expect(entries.get('sandbox-policy')).toMatchObject({
      name: '@deepseek-ai/dsh-sandbox-policy',
      config: { mode: 'read-only' },
    })
    expect(entries.get('fs-sandbox')?.disabled).toBe(true)
    expect(entries.get('fs-esafenet')).toMatchObject({
      name: '@deepseek-ai/dsh-fs-esafenet',
    })
    const enabledFileProviders = [...entries.values()].filter(row =>
      row.disabled !== true
      && (row.name === '@deepseek-ai/dsh-fs-sandbox' || row.name === '@deepseek-ai/dsh-fs-esafenet'))
    expect(enabledFileProviders.map(row => row.id)).toEqual(['fs-esafenet'])
    expect(entries.get('fs-observation-policy')?.disabled).not.toBe(true)

    expect(entries.get('tools')?.config).toEqual({ mode: 'native' })
    for (const id of [
      'code-runtime',
      'bash-sandbox',
      'pwsh-sandbox',
      'tool-bash',
      'tool-pwsh',
      'tool-str-replace-editor',
      'tool-web',
      'web',
      'web-search-deepseek',
      'session-telemetry-otel',
      'session-title-llm',
      'permission',
      'ui-permission',
    ]) {
      expect(entries.get(id)?.disabled, id).toBe(true)
    }
    expect(entries.get('approval')?.config).toEqual({ policy: 'never' })
    expect(entries.get('agent-presets')?.config).toEqual({
      default: 'power-review',
      allowedIds: ['power-review', 'power-fix'],
      includeUserRoot: false,
    })
  })

  it('contains no target-board or physical-actuation entry', () => {
    const { rows } = composePowerDesktop()
    const forbidden = /(?:^|[-_/])(board|flash|jlink|openocd|serial|swd|target|pwm|relay|precharge|contactor|nvm)(?:$|[-_/])/iu
    const matches = rows.filter(row => forbidden.test(`${row.id ?? ''} ${row.name ?? ''}`))
    expect(matches).toEqual([])
  })

  it('declares the provider and preset plugin installation closure', () => {
    const manifest = JSON.parse(readFileSync(resolve(packageRoot, 'package.json'), 'utf8')) as {
      dependencies?: Record<string, string>
      dsh?: { bundle?: { patch?: string } }
    }
    expect(manifest.dsh?.bundle?.patch).toBe('./cordis.patch.yml')
    for (const dependency of [
      '@deepseek-ai/dsh-fs-esafenet',
      '@deepseek-ai/dsh-power-prompt',
      '@deepseek-ai/dsh-power-policy',
      '@deepseek-ai/dsh-power-analysis',
      '@deepseek-ai/dsh-sandbox-policy',
      '@deepseek-ai/dsh-tool-fs',
      '@deepseek-ai/dsh-tool-fs-search',
    ]) {
      expect(manifest.dependencies, dependency).toHaveProperty(dependency, 'workspace:^')
    }
  })
})

describe('shipped power presets', () => {
  it.each([
    ['power-review', 'review', 'read-only', 'read-only'],
    ['power-fix', 'fix', 'workspace-write', 'task-scoped'],
  ] as const)('%s composes the intended fixed authority', (preset, policyMode, sandboxMode, mutation) => {
    const rows = presetRows(preset)
    const entries = byId(rows)
    const filesystem = entries.get('filesystem-authority')
    expect(filesystem).toMatchObject({
      name: 'cordis:group',
      group: true,
      isolate: { sandboxPolicy: true },
    })
    if (!Array.isArray(filesystem?.config)) throw new TypeError(`${preset} filesystem group must contain rows`)
    const fileEntries = byId(filesystem.config as EntryOptions[])
    expect(fileEntries.get(`power-${policyMode}-sandbox-policy`)?.config).toMatchObject({ mode: sandboxMode })
    expect(fileEntries.get('tool-fs')?.name).toBe('@deepseek-ai/dsh-tool-fs')
    expect(fileEntries.get('tool-fs')?.inject).toEqual(['sandboxPolicy'])
    expect(entries.get('power-policy')?.config).toEqual({ mode: policyMode })
    expect(entries.get('power-prompt')?.config).toMatchObject({ sourceMutation: mutation })
    expect(entries.get('power-analysis')).toMatchObject({
      name: '@deepseek-ai/dsh-power-analysis',
      config: { mode: policyMode },
    })
    expect(entries.get('agent-instructions')?.name).toBe('@deepseek-ai/dsh-agent-instructions')
    expect(entries.get('tool-fs-search')?.name).toBe('@deepseek-ai/dsh-tool-fs-search')

    const serialized = JSON.stringify(rows)
    expect(serialized).not.toMatch(/@deepseek-ai\/dsh-(?:tool-)?(?:bash|pwsh|terminal|web|code-runtime)/u)
    expect(entries.has('persona')).toBe(false)
  })
})
