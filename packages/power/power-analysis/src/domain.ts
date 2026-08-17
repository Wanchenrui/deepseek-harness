/** Host-only durable event vocabulary for power analysis. @module @deepseek-ai/dsh-power-analysis */

import type { PowerAnalysisSnapshot } from './types.ts'

/** Complete post-change payload of one power-analysis state event. */
export interface PowerAnalysisStateEvent {
  readonly kind: 'power/analysis-state'
  readonly version: 1
  readonly snapshot: PowerAnalysisSnapshot
}

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /** Complete replayable power-analysis state after one accepted update. */
    'power/analysis-state': PowerAnalysisStateEvent
  }
}
