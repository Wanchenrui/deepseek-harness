/**
 * Verify that the executable deploy manifest supplies every required workspace
 * peer in its dependency graph. With auto peer installation disabled, a missing
 * root peer can otherwise fail only when Cordis loads the packaged plugin.
 */
import { globSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { relative, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { parseArgs } from 'node:util'

interface PackageManifest {
  name?: string
  dependencies?: Record<string, string>
  optionalDependencies?: Record<string, string>
  peerDependencies?: Record<string, string>
  peerDependenciesMeta?: Record<string, { optional?: boolean }>
}

interface WorkspacePackage {
  path: string
  manifest: PackageManifest
}

export interface RuntimeClosureInspection {
  runtimeName: string
  packageCount: number
  failures: string[]
}

/**
 * Inspect one dependency-only runtime manifest against the repository workspace.
 * @param root Repository root containing the workspace packages.
 * @param runtimeManifestPath Absolute path to the dependency-only manifest.
 * @returns Traversed package count and every missing required workspace peer.
 */
export async function inspectRuntimeClosure(
  root: string,
  runtimeManifestPath: string,
): Promise<RuntimeClosureInspection> {
  const runtimeManifest = await loadManifest(runtimeManifestPath)
  const runtimeName = runtimeManifest.name ?? relative(root, runtimeManifestPath)
  const workspace = await loadWorkspacePackages(root)
  const runtimeDependencies = runtimeManifest.dependencies ?? {}
  const parents = new Map<string, string | undefined>()
  const queue: string[] = []

  for (const dependency of Object.keys(runtimeDependencies).sort()) {
    if (!workspace.has(dependency)) continue
    parents.set(dependency, undefined)
    queue.push(dependency)
  }

  const failures: string[] = []
  for (let index = 0; index < queue.length; index += 1) {
    const packageName = queue[index]
    if (packageName === undefined) continue
    const current = workspace.get(packageName)
    if (current === undefined) continue
    const peers = current.manifest.peerDependencies ?? {}
    const peerMeta = current.manifest.peerDependenciesMeta ?? {}
    for (const peer of Object.keys(peers).sort()) {
      if (!workspace.has(peer) || peerMeta[peer]?.optional === true) continue
      if (runtimeDependencies[peer]?.startsWith('workspace:') === true) continue
      failures.push(`${formatChain(runtimeName, packageName, parents)} -> ${peer}`)
    }
    const dependencies = {
      ...current.manifest.dependencies,
      ...current.manifest.optionalDependencies,
    }
    for (const dependency of Object.keys(dependencies).sort()) {
      if (!workspace.has(dependency) || parents.has(dependency)) continue
      parents.set(dependency, packageName)
      queue.push(dependency)
    }
  }
  return { runtimeName, packageCount: queue.length, failures }
}

async function loadWorkspacePackages(root: string): Promise<Map<string, WorkspacePackage>> {
  const paths = globSync(['packages/*/*/package.json', 'vendor/*/package.json', 'apps/*/package.json'], { cwd: root })
    .sort()
    .map(relative => resolve(root, relative))
  const result = new Map<string, WorkspacePackage>()
  for (const path of paths) {
    const manifest = await loadManifest(path)
    if (manifest.name !== undefined) result.set(manifest.name, { path, manifest })
  }
  return result
}

async function loadManifest(path: string): Promise<PackageManifest> {
  return JSON.parse(await readFile(path, 'utf8')) as PackageManifest
}

function formatChain(
  runtimeName: string,
  packageName: string,
  parents: ReadonlyMap<string, string | undefined>,
): string {
  const chain = [packageName]
  let parent = parents.get(packageName)
  while (parent !== undefined) {
    chain.unshift(parent)
    parent = parents.get(parent)
  }
  return [runtimeName, ...chain].join(' -> ')
}

async function main(): Promise<void> {
  const root = resolve(import.meta.dirname, '..')
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: { manifest: { type: 'string' } },
  })
  const manifests = values.manifest
    ? [values.manifest]
    : ['python/sdk-runtime/package.json', 'apps/power-desktop-runtime/package.json']
  for (const manifest of manifests) {
    const runtimeManifestPath = resolve(root, manifest)
    const result = await inspectRuntimeClosure(root, runtimeManifestPath)
    if (result.failures.length > 0) {
      const label = relative(root, runtimeManifestPath).replaceAll('\\', '/')
      console.error(`verify-runtime-closure: required workspace peers are missing from ${label} dependencies:`)
      for (const failure of result.failures) console.error(`  ${failure}`)
      process.exitCode = 1
      continue
    }
    console.log(`verify-runtime-closure: ${manifest}: ${result.packageCount} workspace packages form a closed runtime dependency graph.`)
  }
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : undefined
if (invokedPath === import.meta.url) await main()
