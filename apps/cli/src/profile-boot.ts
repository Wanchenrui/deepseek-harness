/**
 * Shared profile boot for every `dsh` surface: resolve the profile, stack its
 * patch layers (bundle layers in `dsh.profile.bundles` order, the profile's
 * own `cordis.patch.yml`, `--patch` overlays, the telemetry switch), mount the
 * tree over the profile's empty root config, keep mutable profile patch
 * layers live, and wire fail-loud plus bounded shutdown. The shipped Power
 * Desktop profile accepts only its installation-owned bundle tuple.
 *
 * App flags are not the launcher's business: the invocation's inner arguments
 * are provided to the tree through `ctx.cmdlineArgs`, where any injected app
 * plugin may read the same immutable snapshot.
 * @module @deepseek-ai/dsh/profile-boot
 */

import { existsSync, realpathSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { FiberState, type Context } from '@deepseek-ai/cordis'
import type { PatchOptions } from '@deepseek-ai/cordis-plugin-include'
import type { EntryOptions } from '@deepseek-ai/cordis-plugin-loader'
import {
  boot,
  composeEntries,
  healProfilesModuleFallback,
  installFailLoud,
  isSealedProfile,
  loadOptionalPatches,
  loadOverlayPatches,
  loadProfile,
  PROFILE_PATCH_FILENAME,
  watchUserPatches,
  type Profile,
} from '@deepseek-ai/dsh-app-boot'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'

/** Shipped agent-preset root: beside this app's own config, in both source and built layouts. */
const SHIPPED_PRESET_ROOT = fileURLToPath(new URL('../config/agent-presets/', import.meta.url))

/** Installation-owned empty include root for the sealed Power Desktop profile. */
const SHIPPED_POWER_ROOT_CONFIG = fileURLToPath(new URL('../config/power-root.cordis.yml', import.meta.url))

import { DSH_LAUNCH_ENVIRONMENT_KEY, type LaunchEnvironmentSnapshot } from '@deepseek-ai/dsh-launch-environment'
import { provideCmdline } from '@deepseek-ai/dsh-cmdline'
import { createProcessShutdown, type ProcessShutdown } from './process-shutdown.ts'

const NAME = 'dsh'

/**
 * The home-level user patch layer (`$DSH_HOME/cordis.patch.yml`), applied
 * over every profile's own layer. Resolved per call, not at module load:
 * `$DSH_HOME` may be set by the test or launcher after import.
 * @returns the absolute patch-file path.
 */
export function homePatchPath(): string {
  return join(resolveDshHome(), PROFILE_PATCH_FILENAME)
}

/**
 * Reject command-line patch overlays for a sealed profile before reading the
 * named files or initializing profile state.
 * @param profile - profile name from argv or a direct runner call.
 * @param patchFiles - requested `--patch` files.
 */
export function assertProfileOverlayFilesAllowed(profile: string, patchFiles: readonly string[]): void {
  if (isSealedProfile(profile) && patchFiles.length > 0) {
    throw new Error(`${NAME}: sealed profile ${JSON.stringify(profile)} rejects --patch overlays`)
  }
}

/**
 * Load the home-level user patch for a mutable profile. A sealed profile
 * rejects the file's presence instead of ignoring a machine-level override.
 * @param profile - profile name being composed.
 * @returns the parsed patch list, or undefined when the file is absent.
 */
export function loadProfileHomePatches(profile: string): PatchOptions[] | undefined {
  const file = homePatchPath()
  if (isSealedProfile(profile)) {
    if (existsSync(file)) {
      throw new Error(
        `${NAME}: sealed profile ${JSON.stringify(profile)} rejects home patch file ${file}; `
        + 'remove the file or use --dump-default-config',
      )
    }
    return undefined
  }
  return loadOptionalPatches(NAME, file)
}

/**
 * Return the user patch files watched for a profile's live recomposition.
 * @param profile - loaded profile with its profile-local patch path.
 * @returns no paths for a sealed profile; profile and home paths otherwise.
 */
export function profilePatchWatchFiles(profile: Profile): string[] {
  return isSealedProfile(profile.name) ? [] : [profile.patchPath, homePatchPath()]
}

/**
 * Select the Loader base for bare plugin names.
 * @param profile - profile name being booted.
 * @returns this installed app module for a sealed profile; undefined preserves
 * configuration-project resolution for mutable profiles.
 */
export function profileBareModuleBaseUrl(profile: string): string | undefined {
  return isSealedProfile(profile) ? import.meta.url : undefined
}

/**
 * Select the include root for a loaded profile.
 * @param profile - loaded profile whose composition will be dumped or booted.
 * @returns the installation-owned root for a sealed profile; its profile-local
 * root otherwise.
 */
export function profileRootConfigPath(profile: Profile): string {
  return isSealedProfile(profile.name)
    ? SHIPPED_POWER_ROOT_CONFIG
    : join(profile.dir, PROFILE_ROOT_FILENAME)
}

/** Absolute path of this dsh installation's package.json (both anchors: src/ and lib/ sit one level under apps/cli). */
export const INSTALL_ANCHOR = fileURLToPath(new URL('../package.json', import.meta.url))

/** 当前应用包的安装所有目录。 */
const INSTALL_APP_ROOT = dirname(INSTALL_ANCHOR)

/**
 * 从 monorepo 运行时保护完整源码根；npm 安装形态只保护应用包自身。
 */
const INSTALL_SOURCE_ROOT = (() => {
  const candidate = resolve(INSTALL_APP_ROOT, '..', '..')
  const sourceAnchor = join(candidate, 'apps', 'cli', 'package.json')
  if (!existsSync(join(candidate, 'pnpm-workspace.yaml')) || !existsSync(sourceAnchor)) return INSTALL_APP_ROOT
  return realpathSync.native(sourceAnchor) === realpathSync.native(INSTALL_ANCHOR)
    ? candidate
    : INSTALL_APP_ROOT
})()

/** 判断 `parent` 是否包含 `candidate`，相等也视为包含。 */
function containsPath(parent: string, candidate: string): boolean {
  const rest = relative(parent, candidate)
  return rest === '' || (!rest.startsWith(`..${sep}`)
    && rest !== '..' && !isAbsolute(rest))
}

/**
 * 解析符号链接与 junction 后，拒绝与安装所有目录相等或双向包含的可写工作区。
 * @param workspace - 本次运行选择的既存工作区目录。
 * @param installationRoots - 安装所有的既存目录。
 */
export function assertWorkspaceDisjointFromInstallation(
  workspace: string,
  installationRoots: readonly string[],
): void {
  const canonicalWorkspace = realpathSync.native(resolve(workspace))
  const canonicalRoots = new Set(installationRoots.map(root => realpathSync.native(resolve(root))))
  for (const root of canonicalRoots) {
    if (containsPath(canonicalWorkspace, root) || containsPath(root, canonicalWorkspace)) {
      throw new Error(
        `${NAME}: sealed profile "power" workspace ${canonicalWorkspace} overlaps installation-owned path ${root}`,
      )
    }
  }
}

/** The session-telemetry row id the DSH_TELEMETRY_DISABLED switch targets. */
const TELEMETRY_ROW_ID = 'session-telemetry-otel'

/** The empty root entry list every profile tree patches over. */
const PROFILE_ROOT_CONFIG = `# dsh profile root — an empty entry list. The tree is composed as patches:
# each bundle in package.json's dsh.profile.bundles, then cordis.patch.yml, then any
# --patch overlays. Edit cordis.patch.yml, not this file.
[]
`

/** Root config filename inside a profile directory. */
const PROFILE_ROOT_FILENAME = 'cordis.yml'

/**
 * Resolve the telemetry opt-out switch into its boot patch. ANY non-empty
 * value (including `'0'`/`'false'`) disables: a privacy switch prefers
 * off-by-mistake over on-by-mistake. A composition without the telemetry row
 * exports nothing, so the switch is then trivially satisfied and no patch is
 * generated — custom profiles need not mount telemetry to run with the
 * switch set.
 * @param disabledEnv - the raw `DSH_TELEMETRY_DISABLED` value (`undefined` when unset).
 * @param hasRow - whether the composition carries the telemetry row.
 * @returns the disable patch, or `undefined` when no hard-disable patch is required.
 */
export function resolveTelemetryPatch(disabledEnv: string | undefined, hasRow: boolean): PatchOptions | undefined {
  if ((disabledEnv ?? '') === '' || !hasRow) return undefined
  return { id: TELEMETRY_ROW_ID, disabled: true }
}

/**
 * Load a resolved profile for `name`: heal the shared module fallback, then
 * (re)write the empty root config. The root is always rewritten: the whole
 * composition is patch layers, and the vendored Loader's tree write-back (a
 * plugin self-disposing persists the current tree) can bake composed rows
 * into this file — which would duplicate every bundle insert on the next
 * boot. The file exists on disk only because the Loader needs a real include
 * root to anchor `baseUrl` at the profile directory (the config dump anchors
 * on the same file, so both compose over the identical base).
 * @param name - the profile name.
 * @param userLayer - `false` skips parsing `cordis.patch.yml` (the default dump).
 * @returns the loaded profile.
 */
export function prepareProfile(name: string, userLayer = true): Profile {
  // The sealed profile resolves bare plugins against this installation and
  // therefore neither needs nor writes the mutable profiles module fallback.
  if (!isSealedProfile(name)) healProfilesModuleFallback(INSTALL_ANCHOR)
  const profile = loadProfile(NAME, name, INSTALL_ANCHOR, undefined, { userLayer })
  if (!isSealedProfile(name)) writeFileSync(join(profile.dir, PROFILE_ROOT_FILENAME), PROFILE_ROOT_CONFIG)
  return profile
}

/** One profile's patch layers (application order) and the row index of its pre-flag composition. */
interface ComposedProfile {
  profile: Profile
  /** Bundle layers concatenated — the part below the user layers on a live reload. */
  bundlePatches: PatchOptions[]
  /** The home-level user layer (`$DSH_HOME/cordis.patch.yml`), applied after the profile's own. */
  homePatches: PatchOptions[]
  /** Layers above the user layers on a live reload: `--patch` overlays and the telemetry switch. */
  overlays: PatchOptions[]
  /**
   * id → row of the composed tree (bundles + user layers + overlays), for the
   * launcher's own row checks.
   */
  rows: ReadonlyMap<string, EntryOptions>
}

/** The full patch stack of one composed profile, in application order. */
function allPatches(composed: ComposedProfile): PatchOptions[] {
  return [
    ...composed.bundlePatches,
    ...composed.profile.patches,
    ...composed.homePatches,
    ...composed.overlays,
  ]
}

/**
 * Load `name` and compose its effective patch stack: bundle layers in
 * `dsh.profile.bundles` order (the base bundle gates the shell stacks by
 * platform on its own rows), the profile's user layer, the home-level user
 * layer (`$DSH_HOME/cordis.patch.yml` — machine-local preferences that apply
 * to every profile, so it outranks the per-profile layer), `--patch` overlays,
 * then the telemetry switch.
 * @param name - the profile name.
 * @param patchFiles - `--patch` overlay paths, in argv order.
 * @returns the profile, its patch layers, and the composed row index.
 */
function composeProfile(
  name: string,
  patchFiles: readonly string[],
): ComposedProfile {
  assertProfileOverlayFilesAllowed(name, patchFiles)
  const profile = prepareProfile(name)
  const homePatches = loadProfileHomePatches(name) ?? []
  const overlays = patchFiles.flatMap(file => loadOverlayPatches(NAME, resolve(file)))
  const bundlePatches = profile.layers.flatMap(layer => layer.patches)
  const rows = new Map<string, EntryOptions>()
  for (const row of composeEntries([bundlePatches, profile.patches, homePatches, overlays])) {
    if (typeof row.id === 'string') rows.set(row.id, row)
  }
  const composedOverlays = [...overlays]
  // The SHIPPED root is the part of the roster only this app can resolve: it
  // sits beside this app's own config, in both the source and built layouts.
  // The writable root the roster appends is `dsh-agent-presets`' own, so a
  // launcher that never reaches this patch still finds a person's presets.
  if (rows.has('agent-presets')) {
    composedOverlays.push({
      id: 'agent-presets',
      config: {
        ...(rows.get('agent-presets')?.config ?? {}) as Record<string, unknown>,
        roots: [{ path: SHIPPED_PRESET_ROOT, trust: 'system' }],
      },
    })
  }
  const telemetryPatch = resolveTelemetryPatch(process.env.DSH_TELEMETRY_DISABLED, rows.has(TELEMETRY_ROW_ID))
  if (telemetryPatch !== undefined) composedOverlays.push(telemetryPatch)
  return { profile, bundlePatches, homePatches, overlays: composedOverlays, rows }
}

/** Options for {@link runProfile}. */
export interface RunProfileOptions {
  /** This run's frozen environment snapshot, provided before any entry mounts. */
  environment: LaunchEnvironmentSnapshot
  /** The profile name to boot. */
  profile: string
  /** `--patch` overlay paths, in argv order. */
  patchFiles: readonly string[]
  /** The invocation's inner arguments, handed to the tree through `ctx.cmdlineArgs`. */
  args: readonly string[]
}

/**
 * Re-throw a watcher-setup failure unless a shutdown already owns the tree:
 * a signal aborted this invocation, or an app requested exit (`ctx.appExit`
 * from a fast one-shot) and the root's disposal rejected the in-flight setup
 * await. Either way the failure describes a tree that is exiting as asked,
 * not a broken watch.
 * @param ctx - the booted root context.
 * @param signal - this invocation's signal-shutdown fact.
 * @param error - the setup failure.
 */
function suppressShutdownError(ctx: Context, signal: AbortSignal, error: unknown): void {
  if (signal.aborted) return
  if (ctx.fiber.state !== FiberState.ACTIVE || ctx.get('loader') === undefined) return
  throw error
}

/**
 * Boot one profile invocation end to end and leave process lifetime to the
 * mounted plugins (or to a one-shot runner the composition mounts).
 * @param options - environment snapshot, profile name, overlays, and the booted app's own arguments.
 * @returns the settled root context and the shutdown controller.
 */
export async function runProfile(options: RunProfileOptions): Promise<{ ctx: Context; shutdown: ProcessShutdown }> {
  const composed = composeProfile(options.profile, options.patchFiles)
  if (isSealedProfile(options.profile)) {
    assertWorkspaceDisjointFromInstallation(process.cwd(), [
      INSTALL_SOURCE_ROOT,
      INSTALL_APP_ROOT,
      SHIPPED_PRESET_ROOT,
      dirname(SHIPPED_POWER_ROOT_CONFIG),
      ...composed.profile.layers.map(layer => layer.packageDir),
    ])
  }
  const app: { current?: Context } = {}
  const shutdown = createProcessShutdown(async () => { await app.current?.fiber.dispose() })
  const signalShutdown = new AbortController()
  const interrupt = (code: number): void => {
    signalShutdown.abort()
    shutdown.interrupt(code)
  }
  // Signals own teardown throughout the startup window, not only after boot()
  // settles: an inserted provider can publish before sibling rows finish mounting.
  // SIGTERM is a supervisor's ordinary stop request and exits 0 on every
  // surface — the launcher does not know whether the app considered its work
  // complete; SIGINT is a user interrupt and reports 130.
  process.on('SIGTERM', () => { interrupt(0) })
  process.on('SIGINT', () => { interrupt(130) })
  installFailLoud(NAME, process, async () => {
    await app.current?.fiber.dispose()
  })

  const rootConfig = profileRootConfigPath(composed.profile)
  const patchWatchFiles = profilePatchWatchFiles(composed.profile)
  // Recomposition for the live user layers: bundle layers below, overlays
  // above, so a user edit can never displace them. Parsed app arguments are
  // not in here at all — they live in app-provided services that survive a
  // recomposition. Each watched user file is re-read per generation (the HMR
  // watcher hands us only the changed file's patches, which one of the reads
  // duplicates — fresh reads keep the two watchers from stitching in each
  // other's stale copy).
  // Fresh clones per generation: the include pushes `insert` rows into the
  // mounted tree BY REFERENCE and later id-targeted patches mutate those
  // objects in place. Reusing one parsed patch object across applications
  // would bake a user override into the bundle's in-memory insert row, so
  // removing the override could never revert the row to the bundle default.
  const composeLive = (): PatchOptions[] => structuredClone([
    ...composed.bundlePatches,
    ...patchWatchFiles.flatMap(file => loadOptionalPatches(NAME, file) ?? []),
    ...composed.overlays,
  ])
  // Cloned for the same insert-aliasing reason as composeLive: the boot
  // application must not mutate the objects later reloads recompose from.
  const ctx = await boot(NAME, rootConfig, structuredClone(allPatches(composed)), (hostCtx) => {
    app.current = hostCtx
    // Before any config-tree entry mounts, so plugins resolve all launch-time
    // environment values from the same immutable provenance snapshot.
    hostCtx.provide(DSH_LAUNCH_ENVIRONMENT_KEY, options.environment)
    // The command line and bounded exit request are launcher facts available
    // to every app plugin that injects the argument snapshot.
    provideCmdline(hostCtx, {
      args: options.args,
      exit: code => void shutdown.shutdown(code),
    })
  }, profileBareModuleBaseUrl(options.profile))
  app.current = ctx
  // A surface can dispose the whole tree while boot or this post-boot watcher
  // setup is still in flight — a signal, or a fast one-shot's appExit. Loader
  // presence and fiber state own liveness; the initial check skips a tree
  // that already exited, and the catch below re-checks for an exit that
  // landed mid-setup. Mutable profiles always watch both user layers; the
  // sealed profile has no watch paths and never mounts a watch-only HMR
  // service. A one-shot surface exits through its bounded shutdown, which
  // disposes any watchers before the loop drains.
  if (patchWatchFiles.length > 0
    && !signalShutdown.signal.aborted
    && ctx.fiber.state === FiberState.ACTIVE
    && ctx.get('loader') !== undefined) {
    try {
      // Config-only HMR for the live profile patch layer: the web bundle
      // disables the shared module-reload `hmr` row (its reload lifecycle is
      // untested), so when the composition leaves no HMR service, mount a
      // watch-only instance with no module roots — cordis.patch.yml edits stay
      // live on every long-lived surface. A silent skip would break the
      // documented hot-reload contract. HMR injects the timer service, which a
      // bare custom profile may not mount either.
      if (ctx.get('hmr') === undefined) {
        if (ctx.get('timer') === undefined) {
          await ctx.loader.create({ name: '@deepseek-ai/cordis-plugin-timer' })
        }
        await ctx.loader.create({ name: '@deepseek-ai/cordis-plugin-hmr', config: { root: [] } })
      }
      for (const filename of patchWatchFiles) {
        await watchUserPatches(ctx, { binName: NAME, filename, compose: composeLive })
      }
    } catch (error) {
      suppressShutdownError(ctx, signalShutdown.signal, error)
    }
  }
  return { ctx, shutdown }
}
