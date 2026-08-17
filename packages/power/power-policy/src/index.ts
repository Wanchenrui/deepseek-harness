/**
 * Fail-closed tool authority for power-software review and controlled fixes.
 * @module @deepseek-ai/dsh-power-policy
 */

import { lstatSync, realpathSync } from 'node:fs'
import { basename, dirname, isAbsolute, posix, relative, resolve, sep, win32 } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
// Type-only imports install the service and event declaration merges used below.
import type {} from '@deepseek-ai/dsh-system-prompt'
import type { ToolExecution } from '@deepseek-ai/dsh-tools'

/** Cordis plugin name. */
export const name = 'power-policy'

/** Services required to filter model-visible schemas and enforce execution authority. */
export const inject = ['systemPrompt', 'tools']

/** Supported power-software authority modes. */
export type PowerPolicyMode = 'review' | 'fix'

/** Stable machine-readable denial codes emitted by the execution guard. */
export type PowerPolicyDenialCode = 'HIGH_RISK_TOOL' | 'TOOL_ARGUMENTS_DENIED' | 'TOOL_NOT_ALLOWED'

/** High-risk class or allowlist failure reported by the execution guard. */
export type PowerPolicyDenialCategory =
  | 'shell'
  | 'external_egress'
  | 'target_execution'
  | 'power_actuation'
  | 'nvm_destructive'
  | 'invalid_arguments'
  | 'absolute_path'
  | 'parent_traversal'
  | 'workspace_unavailable'
  | 'workspace_escape'
  | 'path_unverifiable'
  | 'not_allowlisted'

type HighRiskDenialCategory =
  | 'shell'
  | 'external_egress'
  | 'target_execution'
  | 'power_actuation'
  | 'nvm_destructive'

type WorkspacePathDenialCategory =
  | 'invalid_arguments'
  | 'absolute_path'
  | 'parent_traversal'
  | 'workspace_unavailable'
  | 'workspace_escape'
  | 'path_unverifiable'

/** Machine-readable payload serialized after {@link POWER_POLICY_DENIAL_PREFIX}. */
export interface PowerPolicyDenial {
  /** Stable denial code. */
  readonly code: PowerPolicyDenialCode
  /** Policy mode active for the rejected call. */
  readonly mode: PowerPolicyMode
  /** Exact registered tool name that was rejected. */
  readonly tool: string
  /** 由工具名或工作区路径权限检查选出的稳定分类。 */
  readonly category: PowerPolicyDenialCategory
}

/** Prefix before the JSON denial payload returned by the execution guard. */
export const POWER_POLICY_DENIAL_PREFIX = 'POWER_POLICY_DENIED '

/** Plugin configuration. */
export interface Config {
  /** `review` is read-only; `fix` additionally permits controlled file mutation. */
  readonly mode: PowerPolicyMode
}

/** Runtime schema. The mode is explicit so a missing authority choice fails at load. */
export const Config: z<Config> = z.object({
  mode: z.union(['review', 'fix'] as const).required(),
})

const REVIEW_TOOLS = new Set(['read', 'read_image', 'grep', 'glob', 'power_report'])
const FIX_TOOLS = new Set([...REVIEW_TOOLS, 'write', 'edit'])

interface WorkspacePathSpec {
  readonly argument: 'file_path' | 'path'
  readonly optional: boolean
  readonly allowMissingTarget: boolean
}

const WORKSPACE_PATH_SPECS = new Map<string, WorkspacePathSpec>([
  ['read', { argument: 'file_path', optional: false, allowMissingTarget: false }],
  ['read_image', { argument: 'file_path', optional: false, allowMissingTarget: false }],
  ['grep', { argument: 'path', optional: true, allowMissingTarget: false }],
  ['glob', { argument: 'path', optional: true, allowMissingTarget: false }],
  ['write', { argument: 'file_path', optional: false, allowMissingTarget: true }],
  ['edit', { argument: 'file_path', optional: false, allowMissingTarget: false }],
])

const SHELL_TOKENS = new Set([
  'bash', 'cmd', 'command', 'exec', 'powershell', 'process', 'pwsh', 'shell', 'spawn', 'subprocess', 'terminal',
])
const EXTERNAL_EGRESS_TOKENS = new Set([
  'browser', 'curl', 'email', 'http', 'https', 'mail', 'network', 'send', 'socket', 'upload', 'web', 'wget',
])
const TARGET_EXECUTION_TOKENS = new Set([
  'board', 'burn', 'debug', 'debugger', 'device', 'dslogic', 'dsview', 'firmware', 'flash', 'gdb', 'jlink',
  'modbus', 'openocd', 'probe', 'program', 'serial', 'swd', 'target', 'uart',
])
const POWER_ACTUATION_TOKENS = new Set([
  'contactor', 'converter', 'epwm', 'igbt', 'inverter', 'mosfet', 'precharge', 'pwm', 'relay', 'trip',
])
const NVM_STORAGE_TOKENS = new Set(['eeprom', 'nvm'])
const DESTRUCTIVE_TOKENS = new Set(['clear', 'erase', 'factory', 'format', 'reset', 'wipe'])

/** Convert tool identifiers from common separator and camel-case forms to tokens. */
function toolTokens(tool: string): ReadonlySet<string> {
  const normalized = tool
    .replace(/([a-z\d])([A-Z])/gu, '$1_$2')
    .toLowerCase()
    .replace(/[^a-z\d]+/gu, '_')
  return new Set(normalized.split('_').filter(Boolean))
}

/** Return whether two tokens occur together in one identifier. */
function hasBoth(tokens: ReadonlySet<string>, left: string, right: string): boolean {
  return tokens.has(left) && tokens.has(right)
}

/** Return whether any member of a fixed safety vocabulary occurs in the identifier. */
function hasAny(tokens: ReadonlySet<string>, vocabulary: ReadonlySet<string>): boolean {
  for (const token of tokens) {
    if (vocabulary.has(token)) return true
  }
  return false
}

/** Classify names that must remain denied independently of the active mode. */
function highRiskCategory(tool: string): HighRiskDenialCategory | undefined {
  const tokens = toolTokens(tool)
  if (hasAny(tokens, SHELL_TOKENS)) return 'shell'
  if (hasAny(tokens, EXTERNAL_EGRESS_TOKENS)
    || hasBoth(tokens, 'git', 'push')
    || hasBoth(tokens, 'git', 'publish')) return 'external_egress'
  if ((hasAny(tokens, NVM_STORAGE_TOKENS) && hasAny(tokens, DESTRUCTIVE_TOKENS))
    || hasBoth(tokens, 'factory', 'reset')) return 'nvm_destructive'
  if (hasAny(tokens, POWER_ACTUATION_TOKENS)
    || hasBoth(tokens, 'power', 'stage')
    || hasBoth(tokens, 'gate', 'driver')) return 'power_actuation'
  if (hasAny(tokens, TARGET_EXECUTION_TOKENS)
    || hasBoth(tokens, 'can', 'bus')) return 'target_execution'
  return undefined
}

/** Whether a value is the detached JSON object expected for model tool arguments. */
function isArgumentObject(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Produce bounded percent-decoded views for detecting encoded traversal or
 * rooted paths. Ripgrep receives the raw JSON string, but rejecting an encoded
 * equivalent keeps this boundary safe if an adapter ever decodes once before
 * dispatch. More than eight changing layers is treated as unverifiable.
 */
function pathViews(path: string): readonly string[] | undefined {
  const views = [path]
  let current = path
  for (let depth = 0; depth < 8; depth++) {
    let decoded: string
    try {
      decoded = decodeURIComponent(current)
    } catch {
      return views
    }
    if (decoded === current) return views
    views.push(decoded)
    current = decoded
  }
  try {
    return decodeURIComponent(current) === current ? views : undefined
  } catch {
    return views
  }
}

/** Recognize rooted paths independently of the host platform's separator rules. */
function isPortableAbsolute(path: string): boolean {
  return posix.isAbsolute(path)
    || win32.isAbsolute(path)
    // `C:relative` is drive-relative on Windows and is not safely workspace-relative.
    || /^[a-z]:/iu.test(path)
    // URI-like roots are not filesystem-relative inputs for these local tools.
    || /^[a-z][a-z\d+.-]*:/iu.test(path)
}

/** Recognize a parent component under either Windows or POSIX separators. */
function hasParentTraversal(path: string): boolean {
  return path.split(/[\\/]+/u).some(part => part === '..')
}

/** Return whether `target` is the workspace itself or a descendant after canonicalization. */
function isContained(workspace: string, target: string): boolean {
  const rel = relative(workspace, target)
  return rel === '' || (!isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${sep}`))
}

/**
 * 解析已存在目标，或解析预期写入目标最深的已存在祖先。
 * 同步规范化现有分量，使已经指向工作区外的符号链接或 junction
 * 对范围检查保持可见；链接损坏或其他解析失败时一律关闭权限。
 */
function canonicalTarget(target: string, allowMissing: boolean): string | undefined {
  let current = target
  const missingSegments: string[] = []
  while (true) {
    try {
      lstatSync(current)
    } catch (error: unknown) {
      if (!allowMissing) return undefined
      /* v8 ignore next -- 非 ENOENT 分支需要主机权限或 I/O 故障。 */
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') return undefined
      const parent = dirname(current)
      /* v8 ignore next -- 支持平台上的绝对文件系统根始终存在。 */
      if (parent === current) return undefined
      missingSegments.unshift(basename(current))
      current = parent
      continue
    }
    try {
      const canonical = realpathSync.native(current)
      if (missingSegments.length > 0 && !lstatSync(canonical).isDirectory()) return undefined
      return missingSegments.length === 0 ? canonical : resolve(canonical, ...missingSegments)
    } catch {
      /* v8 ignore next -- 需要现有路径在 lstat 与 realpath 之间消失或发生 I/O 故障。 */
      return undefined
    }
  }
}

/**
 * 针对调用会话的实时工作区校验每个允许的文件系统路径。
 * `glob`/`grep` 使用可选 `path`，面向模型的文件工具使用必填
 * `file_path`；只有 `write` 可以指定尚不存在的目标。
 * 此检查是时点守卫，并非原子文件系统租约。
 */
function workspacePathDenial(exec: Readonly<ToolExecution>): WorkspacePathDenialCategory | undefined {
  const spec = WORKSPACE_PATH_SPECS.get(exec.name)
  if (spec === undefined) return undefined
  if (!isArgumentObject(exec.arguments)) return 'invalid_arguments'
  const supplied = exec.arguments[spec.argument]
  if (supplied === undefined && !spec.optional) return 'invalid_arguments'
  const path = supplied === undefined ? '.' : supplied
  if (typeof path !== 'string' || path.trim().length === 0 || /[\u0000-\u001f\u007f]/u.test(path)) {
    return 'invalid_arguments'
  }

  const views = pathViews(path)
  if (views === undefined) return 'path_unverifiable'
  for (const view of views) {
    if (isPortableAbsolute(view)) return 'absolute_path'
    if (hasParentTraversal(view)) return 'parent_traversal'
  }

  const workspace = exec.agent?.session.header.cwd
  if (typeof workspace !== 'string' || !isAbsolute(workspace)) return 'workspace_unavailable'
  let canonicalWorkspace: string
  try {
    canonicalWorkspace = realpathSync.native(workspace)
    if (!lstatSync(canonicalWorkspace).isDirectory()) return 'path_unverifiable'
  } catch {
    return 'path_unverifiable'
  }
  const lexicalTarget = resolve(canonicalWorkspace, path)
  /* v8 ignore next -- 前面的跨平台绝对路径与父级分量检查已拒绝所有可达词法逃逸。 */
  if (!isContained(canonicalWorkspace, lexicalTarget)) return 'workspace_escape'
  const canonical = canonicalTarget(lexicalTarget, spec.allowMissingTarget)
  if (canonical === undefined) return 'path_unverifiable'
  const canonicalTargetInside = isContained(canonicalWorkspace, canonical)
  return canonicalTargetInside ? undefined : 'workspace_escape'
}

/** Serialize one denial without including tool arguments or other sensitive data. */
function denialReason(mode: PowerPolicyMode, exec: Readonly<ToolExecution>, allowed: ReadonlySet<string>): string | undefined {
  const { name: tool } = exec
  const highRisk = highRiskCategory(tool)
  const pathDenial = highRisk === undefined && allowed.has(tool) ? workspacePathDenial(exec) : undefined
  const denial: PowerPolicyDenial | undefined = highRisk === undefined
    ? pathDenial !== undefined
      ? { code: 'TOOL_ARGUMENTS_DENIED', mode, tool, category: pathDenial }
      : allowed.has(tool)
        ? undefined
        : { code: 'TOOL_NOT_ALLOWED', mode, tool, category: 'not_allowlisted' }
    : { code: 'HIGH_RISK_TOOL', mode, tool, category: highRisk }
  return denial === undefined ? undefined : POWER_POLICY_DENIAL_PREFIX + JSON.stringify(denial)
}

/**
 * Apply native presentation, schema minimization, and final execution denial to one agent scope.
 * The plugin rejects a process-global mount because `tools.presentAs()` accepts only scoped contexts.
 * @param ctx - the agent or preset scope that owns this authority policy.
 * @param config - the explicit review or controlled-fix mode.
 */
export function apply(ctx: Context, config: Config): void {
  const allowed = config.mode === 'review' ? REVIEW_TOOLS : FIX_TOOLS

  ctx.tools.presentAs('native')
  ctx.on('system-prompt/assemble', async (_assembly, _context, next) => {
    const resolved = await next()
    return {
      ...resolved,
      tools: resolved.tools.filter(tool => allowed.has(tool.name)),
    }
  }, { prepend: true })
  ctx.tools.guard(exec => denialReason(config.mode, exec, allowed))
}
