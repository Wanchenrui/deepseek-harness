/**
 * Client-safe power-analysis vocabulary and the single declaration site for
 * the `power/analysis` session projection key.
 *
 * @module @deepseek-ai/dsh-power-analysis/types
 */

import type { Branded } from '@deepseek-ai/dsh-brand'

/** Current durable JSON format written by power-analysis events. */
export const POWER_ANALYSIS_SCHEMA_VERSION = 1 as const

/** Stable identity of one evidence-backed claim inside a snapshot. */
export type PowerClaimId = Branded<'PowerClaimId'>

/**
 * Brand a validated claim identifier without changing its wire value.
 * @param value - non-empty identifier already validated at an input boundary.
 * @returns the same string branded as a power claim identifier.
 */
export function PowerClaimId(value: string): PowerClaimId {
  return value as PowerClaimId
}

/** Workflow selected by the user-facing slash command. */
export type PowerWorkflow = 'locate' | 'review' | 'incident' | 'requirement' | 'fix'

/** Write authority expected by the workflow. */
export type PowerAnalysisMode = 'review' | 'fix'

/** Lifecycle reported by the current analysis snapshot. */
export type PowerAnalysisStatus = 'in_progress' | 'blocked' | 'complete'

/** Required epistemic classification for every report claim. */
export type EvidenceLabel =
  | 'VERIFIED_FACT'
  | 'CODE_INFERENCE'
  | 'ENGINEERING_JUDGMENT'
  | 'UNKNOWN'

/** Supported source classes for a concrete evidence reference. */
export type EvidenceKind =
  | 'source_code'
  | 'datasheet'
  | 'schematic'
  | 'log'
  | 'waveform'
  | 'measurement'
  | 'build'
  | 'test'
  | 'diff'

/** One inspectable source supporting a claim. */
export interface EvidenceRef {
  /** Source class used by renderers and reviewers. */
  readonly kind: EvidenceKind
  /** Workspace path, document identifier, or stable external locator. */
  readonly artifact: string
  /** Line, symbol, page, timestamp, channel, or other precise position. */
  readonly locator: string
  /** Source revision when the artifact can change independently. */
  readonly revision?: string
}

/** One evidence-labelled statement in the analysis. */
export interface Claim {
  /** Snapshot-local stable identifier referenced by findings. */
  readonly id: PowerClaimId
  /** Epistemic status of the statement. */
  readonly label: EvidenceLabel
  /** Exact statement being asserted or left unknown. */
  readonly statement: string
  /** Concrete sources; required for facts and code inferences. */
  readonly evidence: readonly EvidenceRef[]
  /** Reasoning basis required for engineering judgments. */
  readonly basis?: string
  /** Evidence or experiment still needed to close uncertainty. */
  readonly pendingVerification?: readonly string[]
}

/** Finding severity used by review and incident workflows. */
export type FindingSeverity = 'critical' | 'high' | 'medium' | 'low' | 'info'

/** One actionable finding tied to already-declared claims. */
export interface PowerFinding {
  /** Review severity; `info` is non-defect evidence. */
  readonly severity: FindingSeverity
  /** Concise finding title. */
  readonly title: string
  /** File, symbol, subsystem, or event position. */
  readonly location?: string
  /** Claim identifiers providing the finding's evidence chain. */
  readonly claimIds: readonly PowerClaimId[]
  /** Consequence if the finding is triggered. */
  readonly impact: string
  /** Smallest safe corrective or investigative action. */
  readonly recommendation: string
  /** Observable check that accepts or rejects the recommendation. */
  readonly verification: string
}

/** Common fields recorded for every attempted build. */
export interface BuildReceiptBase {
  /** Exact command that produced the receipt. */
  readonly command: string
  /** Working directory in which the command ran. */
  readonly workingDirectory: string
  /** RFC 3339 start timestamp. */
  readonly startedAt: string
  /** RFC 3339 finish timestamp, not earlier than `startedAt`. */
  readonly finishedAt: string
  /** Source revision inspected at receipt creation time. */
  readonly revision: string
  /** Whether uncommitted source changes were present for this invocation. */
  readonly worktreeState: 'clean' | 'dirty'
  /** Concise output summary; never a fabricated compiler transcript. */
  readonly summary: string
}

/** Receipt proving a successful build. */
export interface SuccessfulBuildReceipt extends BuildReceiptBase {
  readonly status: 'success'
  readonly exitCode: 0
}

/** Receipt proving an attempted build failed. */
export interface FailedBuildReceipt extends BuildReceiptBase {
  readonly status: 'failed'
  /** Non-zero process exit code. */
  readonly exitCode: number
}

/** Verifiable build execution receipt. */
export type BuildReceipt = SuccessfulBuildReceipt | FailedBuildReceipt

/** Explicit build claim; compilation is never inferred from prose. */
export type BuildVerification =
  | { readonly declaration: 'not-run'; readonly receipt: null; readonly reason: string }
  | { readonly declaration: 'failed'; readonly receipt: FailedBuildReceipt }
  | { readonly declaration: 'compiled'; readonly receipt: SuccessfulBuildReceipt }

/** Compatibility classification for one persisted or callable interface. */
export type CompatibilityLevel = 'unchanged' | 'compatible-change' | 'breaking-change' | 'unknown'

/** API, ABI, and NVM compatibility statement plus required recovery detail. */
export interface CompatibilityAssessment {
  readonly api: CompatibilityLevel
  readonly abi: CompatibilityLevel
  readonly nvm: CompatibilityLevel
  readonly notes: readonly string[]
  /** Required when any compatibility class is breaking. */
  readonly migration?: string
  /** Required when any compatibility class is breaking. */
  readonly rollback?: string
}

/** Source-level safety parameter change disclosed without executing hardware. */
export interface SafetyParameterChange {
  readonly parameter: string
  readonly oldValue: string
  readonly newValue: string
  readonly basis: string
  readonly evidence: readonly EvidenceRef[]
}

/** Fixed P0 physical-execution limits plus disclosed source changes. */
export interface SafetyBoundary {
  /** P0 reports cannot claim that target code was run or flashed. */
  readonly targetBoardExecution: 'not-performed'
  /** P0 reports cannot claim an energized power-stage operation. */
  readonly powerStageOperation: 'not-performed'
  /** P0 reports cannot claim PWM, relay, contactor, or precharge actuation. */
  readonly physicalActuation: 'not-performed'
  /** P0 reports cannot claim that target NVM was cleared. */
  readonly nvmClear: 'not-performed'
  /** This package never grants target-board authority. */
  readonly targetAuthorization: 'not-granted'
  /** Must agree exactly with `safetyParameterChanges.length > 0`. */
  readonly safetyParametersChanged: boolean
  /** Old/new/basis disclosures for protection, dead-time, trip, or safe-default source edits. */
  readonly safetyParameterChanges: readonly SafetyParameterChange[]
}

/** Complete, JSON-serializable post-change state stored in each domain event. */
export interface PowerAnalysisSnapshot {
  readonly schemaVersion: typeof POWER_ANALYSIS_SCHEMA_VERSION
  readonly workflow: PowerWorkflow
  readonly mode: PowerAnalysisMode
  readonly status: PowerAnalysisStatus
  /** Original slash-command task text or the task retained by a later report. */
  readonly task: string
  /** Concise current conclusion; its claims remain separately classified. */
  readonly summary: string
  readonly claims: readonly Claim[]
  readonly findings: readonly PowerFinding[]
  readonly unknowns: readonly string[]
  readonly build: BuildVerification
  readonly compatibility: CompatibilityAssessment
  readonly safetyBoundary: SafetyBoundary
  /** RFC 3339 workflow start timestamp. */
  readonly startedAt: string
  /** RFC 3339 snapshot timestamp, not earlier than `startedAt`. */
  readonly updatedAt: string
}

declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionMap {
    /** Latest complete `power/analysis-state` snapshot, or `null` before first use. */
    'power/analysis': PowerAnalysisSnapshot | null
  }
}
