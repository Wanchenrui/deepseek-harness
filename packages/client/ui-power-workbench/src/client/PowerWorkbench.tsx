/** Extensible power-software workbench shell and its default read-only panels. */

import type { ConversationSnapshot } from '@deepseek-ai/dsh-client-runtime/client'
import type {
  PropsLocale, PropsRenderSlots, PropsRuntime,
} from '@deepseek-ai/dsh-client-ui-slots'
import type { PowerWorkbenchKey } from './locales.ts'
import css from './PowerWorkbench.module.css'

/** Session facts passed from the workbench shell to independently registered panels. */
export interface PowerWorkbenchPanelOwnerProps {
  /** Presentation state derived only from the current Session snapshot. */
  state: 'loading' | 'idle' | 'running' | 'attention' | 'removed'
  /** Completed turns in the currently loaded event window. */
  completedTurns: number
  /** Events in the currently loaded compatibility projection. */
  loadedEvents: number
  /** Tool calls still running in the current Session. */
  runningTools: number
  /** Human interactions currently awaiting an answer. */
  pendingInteractions: number
  /** Messages admitted to the transient queue. */
  queuedMessages: number
}

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap {
    /** Compact session summary cards above the engineering workspace. */
    'power.workbench.overview': {
      kind: 'list'
      scope: 'session'
      owner: PowerWorkbenchPanelOwnerProps
    }
    /** Primary domain panels such as timing, control, logs, and build evidence. */
    'power.workbench.workspace': {
      kind: 'list'
      scope: 'session'
      owner: PowerWorkbenchPanelOwnerProps
    }
    /** Secondary safety, provenance, and authorization inspectors. */
    'power.workbench.inspector': {
      kind: 'list'
      scope: 'session'
      owner: PowerWorkbenchPanelOwnerProps
    }
  }
}

/** Full workbench view props composed by the slot renderer. */
export type PowerWorkbenchProps = PropsRuntime<'conversation.view'> & PropsRenderSlots<
  'power.workbench.overview' | 'power.workbench.workspace' | 'power.workbench.inspector'
> & PropsLocale<'powerWorkbench'>

/** Full props for a default panel contribution. */
export type PowerWorkbenchPanelProps = PropsRuntime<'power.workbench.overview'>
  & PropsLocale<'powerWorkbench'>

/** Full props for a primary workspace contribution. */
export type PowerWorkbenchWorkspaceProps = PropsRuntime<'power.workbench.workspace'>
  & PropsLocale<'powerWorkbench'>

/** Full props for an inspector contribution. */
export type PowerWorkbenchInspectorProps = PropsRuntime<'power.workbench.inspector'>
  & PropsLocale<'powerWorkbench'>

/**
 * Convert a Session snapshot into the stable, target-neutral panel currency.
 * @param snapshot - current browser Session projection.
 * @returns read-only workbench facts; no field is target telemetry.
 */
export function derivePowerWorkbenchPanel(
  snapshot: ConversationSnapshot,
): PowerWorkbenchPanelOwnerProps {
  let state: PowerWorkbenchPanelOwnerProps['state']
  if (snapshot.removed) state = 'removed'
  else if (snapshot.openState === 'cold' || snapshot.openState === 'loading') state = 'loading'
  else if (snapshot.running) state = 'running'
  else if (snapshot.openState === 'error'
    || snapshot.promptError !== null
    || snapshot.lastAgentError !== null
    || snapshot.pending.length > 0) state = 'attention'
  else state = 'idle'
  return {
    state,
    completedTurns: snapshot.turnEnds.size,
    loadedEvents: snapshot.nodes.length,
    runningTools: snapshot.runningCalls.length,
    pendingInteractions: snapshot.pending.length,
    queuedMessages: snapshot.queue.length,
  }
}

function stateKey(state: PowerWorkbenchPanelOwnerProps['state']): PowerWorkbenchKey {
  return `state.${state}`
}

/** Main workbench shell; independently registered panels fill its three child slots. */
export function PowerWorkbench({ useSession, renderSlot, t }: PowerWorkbenchProps) {
  const panel = useSession(derivePowerWorkbenchPanel)
  return (
    <main className={css.root} aria-labelledby="power-workbench-title">
      <section className={css.hero}>
        <div className={css.heroCopy}>
          <div className={css.eyebrow}>{t('hero.eyebrow')}</div>
          <h1 id="power-workbench-title" className={css.heroTitle}>{t('hero.title')}</h1>
          <p className={css.heroDescription}>{t('hero.description')}</p>
          <div className={css.chips}>
            <span className={css.chip} data-tone="safe">{t('hero.readOnly')}</span>
            <span className={css.chip} data-tone="warning">{t('hero.gatewayAbsent')}</span>
            <span className={css.chip} data-tone="business">{t('hero.sessionProjection')}</span>
            <span className={css.chip} data-state={panel.state}>{t(stateKey(panel.state))}</span>
          </div>
        </div>
        <div className={css.signalArt} aria-hidden="true">
          {Array.from({ length: 16 }, (_, index) => <span key={index} />)}
        </div>
      </section>

      <section className={css.overview} aria-label={t('overview.title')}>
        {renderSlot('power.workbench.overview', panel)}
      </section>

      <div className={css.contentGrid}>
        <section className={css.workspace} aria-label={t('domains.title')}>
          {renderSlot('power.workbench.workspace', panel)}
        </section>
        <aside className={css.inspector} aria-label={t('safety.title')}>
          {renderSlot('power.workbench.inspector', panel)}
        </aside>
      </div>
    </main>
  )
}

/** Default overview contribution showing only current Session projection counts. */
export function SessionPulsePanel({
  state, completedTurns, loadedEvents, runningTools, pendingInteractions, queuedMessages, t,
}: PowerWorkbenchPanelProps) {
  const metrics = [
    [t('overview.turns'), completedTurns],
    [t('overview.events'), loadedEvents],
    [t('overview.runningTools'), runningTools],
    [t('overview.pending'), pendingInteractions],
    [t('overview.queued'), queuedMessages],
  ] as const
  return (
    <article className={css.panel} data-testid="power-session-pulse">
      <div className={css.panelHeadingRow}>
        <div>
          <div className={css.panelKicker}>{t('hero.sessionProjection')}</div>
          <h2 className={css.panelTitle}>{t('overview.title')}</h2>
        </div>
        <span className={css.statePill} data-state={state}>{t(stateKey(state))}</span>
      </div>
      <p className={css.panelDescription}>{t('overview.description')}</p>
      <div className={css.metrics}>
        {metrics.map(([label, value]) => (
          <div key={label} className={css.metric}>
            <strong>{value}</strong>
            <span>{label}</span>
          </div>
        ))}
      </div>
    </article>
  )
}

/** Default primary contribution: domain map plus the risk-ordered validation ladder. */
export function EngineeringWorkspacePanel({ t }: PowerWorkbenchWorkspaceProps) {
  const domains = [
    ['timing', t('domain.timing'), t('domain.timing.detail')],
    ['control', t('domain.control'), t('domain.control.detail')],
    ['protection', t('domain.protection'), t('domain.protection.detail')],
    ['nvm', t('domain.nvm'), t('domain.nvm.detail')],
    ['evidence', t('domain.evidence'), t('domain.evidence.detail')],
    ['build', t('domain.build'), t('domain.build.detail')],
  ] as const
  const stages = [
    [t('flow.source'), t('flow.available'), 'available'],
    [t('flow.build'), t('flow.available'), 'available'],
    [t('flow.simulation'), t('flow.extension'), 'extension'],
    [t('flow.targetRead'), t('flow.gated'), 'gated'],
    [t('flow.controlledWrite'), t('flow.gated'), 'gated'],
  ] as const
  return (
    <>
      <article className={css.panel} data-testid="power-domain-map">
        <div className={css.panelKicker}>{t('domains.kicker')}</div>
        <h2 className={css.panelTitle}>{t('domains.title')}</h2>
        <p className={css.panelDescription}>{t('domains.description')}</p>
        <div className={css.domainGrid}>
          {domains.map(([id, title, detail]) => (
            <section key={id} className={css.domainCard}>
              <div className={css.domainId}>{id}</div>
              <h3>{title}</h3>
              <p>{detail}</p>
            </section>
          ))}
        </div>
      </article>

      <article className={css.panel} data-testid="power-verification-ladder">
        <div className={css.panelKicker}>{t('flow.kicker')}</div>
        <h2 className={css.panelTitle}>{t('flow.title')}</h2>
        <p className={css.panelDescription}>{t('flow.description')}</p>
        <ol className={css.ladder}>
          {stages.map(([label, status, kind], index) => (
            <li key={label} className={css.stage} data-stage={kind}>
              <span className={css.stageIndex}>{String(index + 1).padStart(2, '0')}</span>
              <span className={css.stageDot} />
              <span className={css.stageLabel}>{label}</span>
              <span className={css.stageStatus}>{status}</span>
            </li>
          ))}
        </ol>
        <p className={css.safetyNote}>{t('flow.note')}</p>
      </article>
    </>
  )
}

/** Default inspector contribution making execution ownership explicit. */
export function SafetyBoundaryPanel({ t }: PowerWorkbenchInspectorProps) {
  const boundaries = [
    [t('safety.ui'), t('safety.ui.detail'), 'active'],
    [t('safety.gateway'), t('safety.gateway.detail'), 'absent'],
    [t('safety.trip'), t('safety.trip.detail'), 'external'],
  ] as const
  return (
    <>
      <article className={css.panel} data-testid="power-safety-boundary">
        <div className={css.panelKicker}>{t('safety.kicker')}</div>
        <h2 className={css.panelTitle}>{t('safety.title')}</h2>
        <p className={css.panelDescription}>{t('safety.description')}</p>
        <div className={css.boundaries}>
          {boundaries.map(([title, detail, state]) => (
            <section key={title} className={css.boundary} data-boundary={state}>
              <span className={css.boundaryMarker} aria-hidden="true" />
              <div>
                <h3>{title}</h3>
                <p>{detail}</p>
              </div>
            </section>
          ))}
        </div>
      </article>

      <article className={css.panel} data-testid="power-extension-slots">
        <div className={css.panelKicker}>{t('extensions.kicker')}</div>
        <h2 className={css.panelTitle}>{t('extensions.title')}</h2>
        <dl className={css.extensionList}>
          <div><dt>{t('extensions.overview')}</dt><dd>power.workbench.overview</dd></div>
          <div><dt>{t('extensions.workspace')}</dt><dd>power.workbench.workspace</dd></div>
          <div><dt>{t('extensions.inspector')}</dt><dd>power.workbench.inspector</dd></div>
        </dl>
      </article>
    </>
  )
}
