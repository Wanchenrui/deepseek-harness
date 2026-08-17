import { existsSync, mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import type { Profile } from '@deepseek-ai/dsh-app-boot'
import { createLaunchEnvironmentSnapshot } from '@deepseek-ai/dsh-launch-environment'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  assertProfileOverlayFilesAllowed,
  assertWorkspaceDisjointFromInstallation,
  homePatchPath,
  loadProfileHomePatches,
  profileBareModuleBaseUrl,
  profilePatchWatchFiles,
  profileRootConfigPath,
  runProfile,
} from '../src/profile-boot.ts'

afterEach(() => {
  vi.unstubAllEnvs()
})

/** Build the profile fields used by the watch-path selector. */
function profile(name: string, patchPath: string): Profile {
  return { name, dir: dirname(patchPath), layers: [], patchPath, patches: [] }
}

describe('sealed power profile overlays', () => {
  it('rejects --patch paths before reading them while mutable profiles keep them', () => {
    expect(() => { assertProfileOverlayFilesAllowed('power', ['missing.yml']) })
      .toThrow('rejects --patch overlays')
    expect(() => { assertProfileOverlayFilesAllowed('web', ['missing.yml']) }).not.toThrow()
    expect(() => { assertProfileOverlayFilesAllowed('power', []) }).not.toThrow()
  })

  it('rejects a home patch and exposes no HMR watch paths', () => {
    const home = mkdtempSync(join(tmpdir(), 'dsh-sealed-overlays-'))
    vi.stubEnv('DSH_HOME', home)
    const homePatch = homePatchPath()
    const profilePatch = join(home, 'profiles', 'power', 'cordis.patch.yml')

    expect(loadProfileHomePatches('power')).toBeUndefined()
    writeFileSync(homePatch, '[]\n')
    expect(() => loadProfileHomePatches('power')).toThrow('rejects home patch file')
    expect(loadProfileHomePatches('web')).toEqual([])
    expect(profilePatchWatchFiles(profile('power', profilePatch))).toEqual([])
    expect(profilePatchWatchFiles(profile('web', profilePatch))).toEqual([profilePatch, homePatch])
  })

  it('anchors bare power plugins to the installed app only', () => {
    expect(profileBareModuleBaseUrl('power')).toContain('profile-boot')
    expect(profileBareModuleBaseUrl('web')).toBeUndefined()
    const patchPath = join('profile', 'cordis.patch.yml')
    const sealedRoot = profileRootConfigPath(profile('power', patchPath))
    expect(sealedRoot).toContain('power-root.cordis.yml')
    expect(existsSync(sealedRoot)).toBe(true)
    expect(profileRootConfigPath(profile('web', patchPath))).toBe(join('profile', 'cordis.yml'))
  })
})

describe('sealed power workspace ownership', () => {
  it('rejects the source checkout as the workspace before mounting the profile', async () => {
    vi.stubEnv('DSH_HOME', mkdtempSync(join(tmpdir(), 'dsh-power-workspace-boot-')))
    await expect(runProfile({
      environment: createLaunchEnvironmentSnapshot([{ source: 'process', values: {} }]),
      profile: 'power',
      patchFiles: [],
      args: [],
    })).rejects.toThrow('overlaps installation-owned path')
  })

  it('rejects equal and bidirectionally nested installation paths while allowing a sibling', () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-power-workspace-'))
    const installation = join(root, 'installation')
    const nestedWorkspace = join(installation, 'workspace')
    const siblingWorkspace = join(root, 'workspace')
    mkdirSync(nestedWorkspace, { recursive: true })
    mkdirSync(siblingWorkspace)

    expect(() => { assertWorkspaceDisjointFromInstallation(installation, [installation]) }).toThrow('overlaps')
    expect(() => { assertWorkspaceDisjointFromInstallation(root, [installation]) }).toThrow('overlaps')
    expect(() => { assertWorkspaceDisjointFromInstallation(nestedWorkspace, [installation]) }).toThrow('overlaps')
    expect(() => { assertWorkspaceDisjointFromInstallation(siblingWorkspace, [installation]) }).not.toThrow()
  })

  it('compares canonical junction or symlink targets', () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-power-workspace-link-'))
    const installation = join(root, 'installation')
    const alias = join(root, 'workspace-alias')
    mkdirSync(installation)
    symlinkSync(installation, alias, process.platform === 'win32' ? 'junction' : 'dir')

    expect(() => { assertWorkspaceDisjointFromInstallation(alias, [installation]) }).toThrow('overlaps')
  })
})
