/** Browser plugin contributing an extensible power-software workbench view. */

import type { Context } from '@deepseek-ai/cordis'
// Type-only: pulls the locale service and conversation view declaration into this program.
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import {
  EngineeringWorkspacePanel, PowerWorkbench, SafetyBoundaryPanel, SessionPulsePanel,
} from './PowerWorkbench.tsx'
import type { PowerWorkbenchPanelOwnerProps } from './PowerWorkbench.tsx'
import { en, NS, zh } from './locales.ts'

/** Required services: the conversation view slot, nested slot registry, and locale service. */
export const inject = ['slots', 'locale']

/**
 * Register the workbench view and its default panels as one disposable slot contribution set.
 * @param ctx - client root context.
 */
export function apply(ctx: Context): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-power-workbench: dictionaries')
  const t = ctx.locale.bind(NS)
  ctx.slots.inject('conversation.view', function* () {
    yield ctx.slots.register({
      name: 'conversation.view',
      id: 'power-workbench',
      order: 5,
      locale: NS,
      label: () => t('view.label'),
      children: {
        'power.workbench.overview': { kind: 'list', scope: 'session' },
        'power.workbench.workspace': { kind: 'list', scope: 'session' },
        'power.workbench.inspector': { kind: 'list', scope: 'session' },
      },
    }, PowerWorkbench)
    yield ctx.slots.register({
      name: 'power.workbench.overview', id: 'session-pulse', order: 0, locale: NS,
    }, SessionPulsePanel)
    yield ctx.slots.register({
      name: 'power.workbench.workspace', id: 'engineering-domains', order: 0, locale: NS,
    }, EngineeringWorkspacePanel)
    yield ctx.slots.register({
      name: 'power.workbench.inspector', id: 'safety-boundary', order: 0, locale: NS,
    }, SafetyBoundaryPanel)
  })
}

export type { PowerWorkbenchPanelOwnerProps }
