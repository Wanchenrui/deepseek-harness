/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-power-desktop`.
 * @module @deepseek-ai/dsh-power-desktop/invariant
 */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-power-desktop'

/** Cordis companion plugin name. */
export const name = 'power-desktop-bundle-invariant'
/** Service required before the companion can register. */
export const inject = ['invariants']

// No runtime invariant: this package carries a static patch list. The real
// composition test applies it after base and web-app and audits the resulting
// provider, authority, network, telemetry, and preset rows.
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
