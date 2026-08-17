/** Runtime validation for model JSON and durable power-analysis state. @module @deepseek-ai/dsh-power-analysis */

import { z as zod } from 'zod'
import type { ZodType } from 'zod'
import {
  POWER_ANALYSIS_SCHEMA_VERSION,
  PowerClaimId,
} from './types.ts'
import type {
  BuildReceipt,
  Claim,
  CompatibilityAssessment,
  EvidenceRef,
  PowerAnalysisSnapshot,
  PowerFinding,
  SafetyBoundary,
  SafetyParameterChange,
} from './types.ts'

const trimmedText = zod.string().min(1).refine(value => value.trim() === value, 'must be trimmed')
const timestamp = zod.iso.datetime({ offset: true })

const evidenceRefSchema = zod.object({
  kind: zod.enum([
    'source_code', 'datasheet', 'schematic', 'log', 'waveform',
    'measurement', 'build', 'test', 'diff',
  ]),
  artifact: trimmedText,
  locator: trimmedText,
  revision: trimmedText.optional(),
}).strict() as unknown as ZodType<EvidenceRef>

const claimSchema = zod.object({
  id: trimmedText.transform(PowerClaimId),
  label: zod.enum(['VERIFIED_FACT', 'CODE_INFERENCE', 'ENGINEERING_JUDGMENT', 'UNKNOWN']),
  statement: trimmedText,
  evidence: zod.array(evidenceRefSchema),
  basis: trimmedText.optional(),
  pendingVerification: zod.array(trimmedText).min(1).optional(),
}).strict() as unknown as ZodType<Claim>

const findingSchema = zod.object({
  severity: zod.enum(['critical', 'high', 'medium', 'low', 'info']),
  title: trimmedText,
  location: trimmedText.optional(),
  claimIds: zod.array(trimmedText.transform(PowerClaimId)).min(1),
  impact: trimmedText,
  recommendation: trimmedText,
  verification: trimmedText,
}).strict() as unknown as ZodType<PowerFinding>

const buildReceiptFields = {
  command: trimmedText,
  workingDirectory: trimmedText,
  startedAt: timestamp,
  finishedAt: timestamp,
  revision: trimmedText,
  worktreeState: zod.enum(['clean', 'dirty']),
  summary: trimmedText,
}

const successfulBuildReceiptSchema = zod.object({
  status: zod.literal('success'),
  exitCode: zod.literal(0),
  ...buildReceiptFields,
}).strict()

const failedBuildReceiptSchema = zod.object({
  status: zod.literal('failed'),
  exitCode: zod.number().int().refine(value => value !== 0, 'failed build exitCode must be non-zero'),
  ...buildReceiptFields,
}).strict()

const buildVerificationSchema = zod.discriminatedUnion('declaration', [
  zod.object({
    declaration: zod.literal('not-run'),
    receipt: zod.null(),
    reason: trimmedText,
  }).strict(),
  zod.object({
    declaration: zod.literal('failed'),
    receipt: failedBuildReceiptSchema,
  }).strict(),
  zod.object({
    declaration: zod.literal('compiled'),
    receipt: successfulBuildReceiptSchema,
  }).strict(),
])

const compatibilityLevelSchema = zod.enum(['unchanged', 'compatible-change', 'breaking-change', 'unknown'])
const compatibilitySchema = zod.object({
  api: compatibilityLevelSchema,
  abi: compatibilityLevelSchema,
  nvm: compatibilityLevelSchema,
  notes: zod.array(trimmedText),
  migration: trimmedText.optional(),
  rollback: trimmedText.optional(),
}).strict() as unknown as ZodType<CompatibilityAssessment>

const safetyParameterChangeSchema: ZodType<SafetyParameterChange> = zod.object({
  parameter: trimmedText,
  oldValue: trimmedText,
  newValue: trimmedText,
  basis: trimmedText,
  evidence: zod.array(evidenceRefSchema).min(1),
}).strict()

const safetyBoundarySchema: ZodType<SafetyBoundary> = zod.object({
  targetBoardExecution: zod.literal('not-performed'),
  powerStageOperation: zod.literal('not-performed'),
  physicalActuation: zod.literal('not-performed'),
  nvmClear: zod.literal('not-performed'),
  targetAuthorization: zod.literal('not-granted'),
  safetyParametersChanged: zod.boolean(),
  safetyParameterChanges: zod.array(safetyParameterChangeSchema),
}).strict()

/** Detect a positive natural-language assertion that P0 physically operated hardware. */
function assertsPhysicalExecution(text: string): boolean {
  const englishSubject = '(?:target board|development board|dev board|hardware|device|power stage|MCU|microcontroller|controller)'
  const englishAction = '(?:flashed|programmed|loaded firmware|energized|powered on|reset|executed|ran|actuated|tested)'
  const englishPattern = new RegExp(
    `(?:\\b${englishSubject}\\b.{0,80}\\b${englishAction}\\b|\\b${englishAction}\\b.{0,80}\\b${englishSubject}\\b)`,
    'iu',
  )
  const english = englishPattern.exec(text)
  if (english !== null && !/\b(?:not|never|without)\b/iu.test(english[0])) return true

  const chineseSubject = '(?:目标板|开发板|实机|硬件|功率级|MCU|微控制器|控制器|芯片)'
  const chineseAction = '(?:运行|执行|烧录|刷写|下载|复位|上电|发波|动作|测试)'
  const chinesePattern = new RegExp(
    `(?:${chineseSubject}.{0,40}${chineseAction}|${chineseAction}.{0,40}${chineseSubject})`,
    'u',
  )
  const chinese = chinesePattern.exec(text)
  if (chinese === null) return false
  return !/(?:未|没有|从未|并未|未曾|不会|不得|禁止|不应|无需).{0,24}(?:目标板|开发板|实机|硬件|功率级|MCU|微控制器|控制器|芯片|运行|执行|烧录|刷写|下载|复位|上电|发波|动作|测试)/u.test(chinese[0])
}

/** Add a stable relational-validation issue. */
function issue(
  ctx: zod.RefinementCtx,
  path: (string | number)[],
  message: string,
): void {
  ctx.addIssue({ code: 'custom', path, message })
}

/** Schema for the complete durable and model-submitted snapshot. */
export const powerAnalysisSnapshotSchema: ZodType<PowerAnalysisSnapshot> = zod.object({
  schemaVersion: zod.literal(POWER_ANALYSIS_SCHEMA_VERSION),
  workflow: zod.enum(['locate', 'review', 'incident', 'requirement', 'fix']),
  mode: zod.enum(['review', 'fix']),
  status: zod.enum(['in_progress', 'blocked', 'complete']),
  task: trimmedText,
  summary: trimmedText,
  claims: zod.array(claimSchema),
  findings: zod.array(findingSchema),
  unknowns: zod.array(trimmedText),
  build: buildVerificationSchema,
  compatibility: compatibilitySchema,
  safetyBoundary: safetyBoundarySchema,
  startedAt: timestamp,
  updatedAt: timestamp,
}).strict().superRefine((snapshot, ctx) => {
  const expectedMode = snapshot.workflow === 'fix' ? 'fix' : 'review'
  if (snapshot.mode !== expectedMode) {
    issue(ctx, ['mode'], `${snapshot.workflow} workflow requires ${expectedMode} mode`)
  }
  if (Date.parse(snapshot.updatedAt) < Date.parse(snapshot.startedAt)) {
    issue(ctx, ['updatedAt'], 'updatedAt must not precede startedAt')
  }

  const claimIds = new Set<string>()
  snapshot.claims.forEach((claim, index) => {
    if (claimIds.has(claim.id)) issue(ctx, ['claims', index, 'id'], `duplicate claim id ${JSON.stringify(claim.id)}`)
    claimIds.add(claim.id)
    if ((claim.label === 'VERIFIED_FACT' || claim.label === 'CODE_INFERENCE') && claim.evidence.length === 0) {
      issue(ctx, ['claims', index, 'evidence'], `${claim.label} requires at least one evidence reference`)
    }
    if (claim.label === 'ENGINEERING_JUDGMENT') {
      if (claim.basis === undefined) issue(ctx, ['claims', index, 'basis'], 'ENGINEERING_JUDGMENT requires a basis')
      if (claim.pendingVerification === undefined) {
        issue(ctx, ['claims', index, 'pendingVerification'], 'ENGINEERING_JUDGMENT requires pending verification')
      }
    }
    if (claim.label === 'UNKNOWN' && claim.pendingVerification === undefined) {
      issue(ctx, ['claims', index, 'pendingVerification'], 'UNKNOWN requires pending verification')
    }
    if (assertsPhysicalExecution(claim.statement) || (claim.basis !== undefined && assertsPhysicalExecution(claim.basis))) {
      issue(ctx, ['claims', index], 'P0 reports cannot claim target-board or power-stage execution')
    }
  })

  snapshot.findings.forEach((finding, findingIndex) => {
    finding.claimIds.forEach((claimId, claimIndex) => {
      if (!claimIds.has(claimId)) {
        issue(ctx, ['findings', findingIndex, 'claimIds', claimIndex], `unknown claim id ${JSON.stringify(claimId)}`)
      }
    })
    for (const text of [finding.impact, finding.recommendation, finding.verification]) {
      if (assertsPhysicalExecution(text)) {
        issue(ctx, ['findings', findingIndex], 'P0 reports cannot claim target-board or power-stage execution')
        break
      }
    }
  })

  const receipt: BuildReceipt | null = snapshot.build.receipt
  if (receipt !== null && Date.parse(receipt.finishedAt) < Date.parse(receipt.startedAt)) {
    issue(ctx, ['build', 'receipt', 'finishedAt'], 'build finishedAt must not precede startedAt')
  }

  const compatibility = snapshot.compatibility
  const breaking = compatibility.api === 'breaking-change'
    || compatibility.abi === 'breaking-change'
    || compatibility.nvm === 'breaking-change'
  if (breaking && compatibility.migration === undefined) {
    issue(ctx, ['compatibility', 'migration'], 'breaking compatibility requires a migration plan')
  }
  if (breaking && compatibility.rollback === undefined) {
    issue(ctx, ['compatibility', 'rollback'], 'breaking compatibility requires a rollback plan')
  }

  const safety = snapshot.safetyBoundary
  if (safety.safetyParametersChanged !== (safety.safetyParameterChanges.length > 0)) {
    issue(ctx, ['safetyBoundary', 'safetyParametersChanged'], 'flag must equal safetyParameterChanges.length > 0')
  }

  const prose = [snapshot.summary, ...snapshot.unknowns, ...snapshot.compatibility.notes]
  if (prose.some(assertsPhysicalExecution)) {
    issue(ctx, ['summary'], 'P0 reports cannot claim target-board or power-stage execution')
  }
})

/**
 * Parse untrusted model or durable JSON into the canonical snapshot.
 * @param value - untrusted JSON value.
 * @returns a detached, validated power-analysis snapshot.
 */
export function decodePowerAnalysisSnapshot(value: unknown): PowerAnalysisSnapshot {
  return powerAnalysisSnapshotSchema.parse(value)
}
