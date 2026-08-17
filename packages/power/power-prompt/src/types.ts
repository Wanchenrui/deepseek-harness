/** Source access modes described to the power-software agent. */
export type PowerSourceAccess = 'native' | 'powershell-fixed'

/** Source mutation modes described to the power-software agent. */
export type PowerSourceMutation = 'read-only' | 'task-scoped'

/** Verification modes described to the power-software agent. */
export type PowerVerification = 'static-only' | 'build-test'

/** Fully resolved environment facts used to render one prompt assembly. */
export interface ResolvedPowerPromptConfig {
  /** Resolved file-reading path. */
  sourceAccess: PowerSourceAccess
  /** Resolved source mutation mode. */
  sourceMutation: PowerSourceMutation
  /** Resolved verification mode. */
  verification: PowerVerification
}
