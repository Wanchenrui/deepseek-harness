/**
 * Evidence-labelled power analysis: replayable whole-state projection,
 * model reporting tool, and user-facing workflow commands.
 *
 * @module @deepseek-ai/dsh-power-analysis
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { CommandInvocation, CommandResult } from '@deepseek-ai/dsh-commands'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-session-projection'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { z as zod } from 'zod'
import type { ZodType } from 'zod'
import { decodePowerAnalysisSnapshot, powerAnalysisSnapshotSchema } from './schema.ts'
import { POWER_ANALYSIS_SCHEMA_VERSION } from './types.ts'
import type {
  PowerAnalysisMode,
  PowerAnalysisSnapshot,
  PowerWorkflow,
} from './types.ts'
import type { PowerAnalysisStateEvent } from './domain.ts'

export type * from './types.ts'
export type * from './domain.ts'
export { decodePowerAnalysisSnapshot, powerAnalysisSnapshotSchema } from './schema.ts'

/** Cordis plugin name and message-source attribution. */
export const name = 'power-analysis'
/** Required registries; session projection remains an optional child. */
export const inject = ['tools', 'commands']

/** Deployment authority for commands and accepted report snapshots. */
export interface Config {
  /** `review` exposes read-only workflows; `fix` exposes only `/fix`. */
  mode: PowerAnalysisMode
}

/** Validated deployment configuration with a conservative review default. */
export const Config: z<Config> = z.object({
  mode: z.union(['review', 'fix'] as const).default('review'),
})

const reviewWorkflows = ['locate', 'review', 'incident', 'requirement'] as const

const workflowDescriptions: Readonly<Record<PowerWorkflow, string>> = {
  locate: 'locate power-firmware behavior and its evidence chain',
  review: 'review power-firmware code with safety-ranked findings',
  incident: 'investigate a power-system incident from logs and evidence',
  requirement: 'trace a power-control requirement to implementation and tests',
  fix: 'implement and verify a bounded power-firmware source change',
}

const workflowInstructions: Readonly<Record<PowerWorkflow, string>> = {
  locate: 'Trace the requested behavior through callers, state, configuration, concurrency, PWM/ADC/protection ownership, and build entry points.',
  review: 'Report findings in severity order with exact locations, trigger conditions, impact, corrective action, and verification.',
  incident: 'Build an evidence-backed timeline, separate observations from hypotheses, and state what would falsify each live hypothesis.',
  requirement: 'Map the requirement to interfaces, state transitions, timing, faults, implementation locations, and acceptance evidence.',
  fix: 'Make the smallest reviewable source/configuration/test change, preserve API/ABI/NVM behavior unless explicitly disclosed, and attach real build or test receipts only after execution.',
}

const projectionSchema: ZodType<PowerAnalysisSnapshot | null> = zod.union([
  powerAnalysisSnapshotSchema,
  zod.null(),
])

/**
 * Last-wins replay transition for complete power-analysis state events.
 * @param state - state covering every prior event.
 * @param event - next committed session event.
 * @returns the latest valid snapshot or the unchanged reference.
 */
export function applyPowerAnalysisProjection(
  state: PowerAnalysisSnapshot | null,
  event: SessionEvent,
): PowerAnalysisSnapshot | null {
  if (event.type !== 'power/analysis-state') return state
  const data: unknown = event.data
  if (typeof data !== 'object' || data === null) return state
  const record = data as Record<string, unknown>
  if (record.kind !== 'power/analysis-state' || record.version !== POWER_ANALYSIS_SCHEMA_VERSION) return state
  const parsed = powerAnalysisSnapshotSchema.safeParse(record.snapshot)
  return parsed.success ? parsed.data : state
}

/**
 * Create the safe, evidence-empty state written when a workflow begins.
 * @param workflow - selected workflow.
 * @param task - trimmed user-supplied task.
 * @param now - workflow start time.
 * @returns a complete schema-v1 snapshot.
 */
export function createInitialPowerAnalysisSnapshot(
  workflow: PowerWorkflow,
  task: string,
  now: Date = new Date(),
): PowerAnalysisSnapshot {
  const mode: PowerAnalysisMode = workflow === 'fix' ? 'fix' : 'review'
  const at = now.toISOString()
  return {
    schemaVersion: POWER_ANALYSIS_SCHEMA_VERSION,
    workflow,
    mode,
    status: 'in_progress',
    task,
    summary: `${workflow} workflow initialized; evidence collection has not started.`,
    claims: [],
    findings: [],
    unknowns: ['Evidence has not been collected yet.'],
    build: {
      declaration: 'not-run',
      receipt: null,
      reason: 'No build has been run in this workflow yet.',
    },
    compatibility: {
      api: 'unknown',
      abi: 'unknown',
      nvm: 'unknown',
      notes: ['Compatibility has not been assessed yet.'],
    },
    safetyBoundary: {
      targetBoardExecution: 'not-performed',
      powerStageOperation: 'not-performed',
      physicalActuation: 'not-performed',
      nvmClear: 'not-performed',
      targetAuthorization: 'not-granted',
      safetyParametersChanged: false,
      safetyParameterChanges: [],
    },
    startedAt: at,
    updatedAt: at,
  }
}

/** Append one already-validated whole-state event. */
function appendSnapshot(session: Session, snapshot: PowerAnalysisSnapshot): SessionEvent<'power/analysis-state'> {
  const payload: PowerAnalysisStateEvent = {
    kind: 'power/analysis-state',
    version: POWER_ANALYSIS_SCHEMA_VERSION,
    snapshot,
  }
  return session.append('power/analysis-state', payload)
}

/** Fixed model prompt created by each admitted workflow command. */
function workflowPrompt(workflow: PowerWorkflow, mode: PowerAnalysisMode, task: string): string {
  return [
    `<power-analysis-workflow name=${JSON.stringify(workflow)} mode=${JSON.stringify(mode)}>`,
    workflowInstructions[workflow],
    `User task JSON: ${JSON.stringify(task)}`,
    '',
    'Use only accessible source, documentation, logs, waveforms, and actual command results.',
    'Classify every claim as VERIFIED_FACT, CODE_INFERENCE, ENGINEERING_JUDGMENT, or UNKNOWN and attach the required evidence or pending verification.',
    'Use power_report to publish the complete current snapshot after material updates and at completion.',
    'A compiled declaration requires a successful receipt with exitCode 0, exact command, working directory, source revision, clean/dirty worktree state, and start/finish timestamps.',
    'No target-board execution, flashing, reset, energized power-stage action, PWM/relay/contactor/precharge actuation, or NVM clear is authorized. Do not claim any occurred.',
    '</power-analysis-workflow>',
  ].join('\n')
}

/** Execute one workflow command without sending the slash syntax to the model. */
function startWorkflow(workflow: PowerWorkflow, invocation: CommandInvocation): CommandResult {
  const task = invocation.rawInput.trim()
  if (task.length === 0) {
    return { kind: 'error', text: `Usage: /${workflow} <task>` }
  }
  const snapshot = createInitialPowerAnalysisSnapshot(workflow, task)
  const event = appendSnapshot(invocation.agent.session, snapshot)
  invocation.agent.followup(createUserMessage({
    content: [{ type: 'text', text: workflowPrompt(workflow, snapshot.mode, task) }],
    source: { kind: 'plugin', plugin: name },
  }))
  return {
    kind: 'success',
    text: `Started /${workflow} in ${snapshot.mode} mode. Target-board execution remains unauthorized and was not performed.`,
    sourceEventSeq: event.seq,
  }
}

/**
 * Register the projection, authority-matched report tool, and allowed workflows.
 * @param ctx - registrant context carrying command and tool registries.
 * @param config - deployment authority; omitted mode resolves to `review`.
 */
export function apply(ctx: Context, config: Config = { mode: 'review' }): void {
  const authority = config.mode
  ctx.inject(['sessionProjections'], (projectionCtx) => {
    projectionCtx.sessionProjections.register<'power/analysis', PowerAnalysisSnapshot | null>({
      key: 'power/analysis',
      schema: projectionSchema,
      init: () => null,
      apply: applyPowerAnalysisProjection,
      view: state => state,
      stateVersion: POWER_ANALYSIS_SCHEMA_VERSION,
    })
  })

  ctx.tools.register(defineTool({
    name: 'power_report',
    description: [
      'Publish the COMPLETE current PowerAnalysisSnapshot v1 for this session; each call replaces the projection state.',
      'Required fields: schemaVersion, workflow, mode, status, task, summary, claims, findings, unknowns, build, compatibility, safetyBoundary, startedAt, updatedAt.',
      'Facts and code inferences require EvidenceRef entries; engineering judgments require basis and pendingVerification; unknowns require pendingVerification.',
      'Set build.declaration to compiled only with a matching successful BuildReceipt. Physical-execution fields are fixed to not-performed/not-granted.',
      `Configured authority is ${authority}; only ${authority} snapshots are accepted.`,
    ].join(' '),
    parameters: {
      snapshot: {
        type: 'json',
        required: true,
        description: 'Complete PowerAnalysisSnapshot JSON value. Partial updates are rejected.',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          accepted: { type: 'boolean', const: true, required: true },
          eventSeq: { type: 'integer', required: true },
          schemaVersion: { type: 'integer', const: POWER_ANALYSIS_SCHEMA_VERSION, required: true },
          status: {
            type: 'string',
            enum: ['in_progress', 'blocked', 'complete'],
            required: true,
          },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: `Power analysis snapshot accepted at event ${value.eventSeq}; status: ${value.status}.`,
      }],
    },
    execute(args, exec) {
      if (!exec.agent) throw new Error('power_report requires an owning agent session')
      const snapshot = decodePowerAnalysisSnapshot(args.snapshot)
      if (snapshot.mode !== authority) {
        throw new Error(
          `power_report snapshot mode ${JSON.stringify(snapshot.mode)} does not match configured authority ${JSON.stringify(authority)}`,
        )
      }
      const event = appendSnapshot(exec.agent.session, snapshot)
      return Promise.resolve({
        accepted: true,
        eventSeq: event.seq,
        schemaVersion: POWER_ANALYSIS_SCHEMA_VERSION,
        status: snapshot.status,
      })
    },
    presentCall: args => ({
      card: 'generic',
      title: 'Publish power analysis',
      kind: 'other',
      rawInput: args.snapshot,
    }),
  }))

  const workflows: readonly PowerWorkflow[] = authority === 'review' ? reviewWorkflows : ['fix']
  for (const workflow of workflows) {
    ctx.commands.register({
      name: workflow,
      description: workflowDescriptions[workflow],
      input: { hint: '<task>' },
      recordInput: false,
      handler: invocation => startWorkflow(workflow, invocation),
    })
  }
}
