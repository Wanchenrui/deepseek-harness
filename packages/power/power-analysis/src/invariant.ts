/** Durable power-analysis event invariants. @module @deepseek-ai/dsh-power-analysis/invariant */

import type { Context } from '@deepseek-ai/cordis'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import type { InvariantFailure, InvariantInstaller } from '@deepseek-ai/dsh-invariants'
import { powerAnalysisSnapshotSchema } from './schema.ts'
import { POWER_ANALYSIS_SCHEMA_VERSION } from './types.ts'

const PACKAGE_NAME = '@deepseek-ai/dsh-power-analysis'

/** Cordis companion plugin name. */
export const name = 'power-analysis-invariant'
/** Service required before the companion reserves package ownership. */
export const inject = ['invariants']

/** Validate one package-owned event and ignore unrelated events. */
function validateEvent(event: SessionEvent, fail: InvariantFailure): void {
  if (event.type !== 'power/analysis-state') return
  const data: unknown = event.data
  if (typeof data !== 'object' || data === null) fail('power/analysis-state data must be an object')
  const record = data as Record<string, unknown>
  if (record.kind !== 'power/analysis-state') fail('power/analysis-state carries an invalid kind')
  if (record.version !== POWER_ANALYSIS_SCHEMA_VERSION) {
    fail(`power/analysis-state carries unsupported version ${String(record.version)}`)
  }
  const result = powerAnalysisSnapshotSchema.safeParse(record.snapshot)
  if (!result.success) fail(`power/analysis-state snapshot is invalid: ${result.error.message}`)
}

/* jscpd:ignore-start -- package companions share replay and dispatch plumbing */
/** Install validation for existing and newly appended analysis state. */
const install: InvariantInstaller = Object.assign((ctx: Context, fail: InvariantFailure) => {
  for (const session of ctx.sessions.list()) {
    for (const event of session.events) validateEvent(event, fail)
  }
  ctx.on('internal/dispatch', (_mode, eventName, args) => {
    if (eventName !== 'session/event') return
    validateEvent((args as [Session, SessionEvent])[1], fail)
  }, { global: true })
}, { inject: ['sessions'] })
/* jscpd:ignore-end */

/**
 * Register the package invariant companion.
 * @param ctx - context carrying the invariant registry.
 * @returns the installed registration disposer.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
