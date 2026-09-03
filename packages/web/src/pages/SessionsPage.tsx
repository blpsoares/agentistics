/**
 * SessionsPage — the CENTRE of the sessions workspace.
 *
 * On DESKTOP the list is not here: it is the aside's body (`SessionsAside`), because in this
 * workspace the sidebar IS the list, the way the chat applications this is shaped after do it. So
 * the page has two states — nothing selected, which shows what the fleet is doing, and one session
 * selected, which shows that session as a conversation or as its terminal.
 *
 * On MOBILE there is no aside at all — `App.tsx` renders `SideNav` only above the breakpoint — so
 * the page carries both halves and shows ONE AT A TIME, which is the convention every other
 * full-screen surface here follows. Nothing selected is the list; a selection is the session, with
 * a way back. The same components either way: a phone-only list would be a second implementation of
 * the arrangement, and it would drift.
 *
 * What it does NOT do is fetch. `useFleet` is a shared, refcounted store: the aside and this page
 * read the same snapshot from the same poll, so a list and a detail pane can never disagree about
 * a session's state by one poll interval — which is a bug people report as flicker.
 */

import { useNavigate, useOutletContext, useParams, useSearchParams } from 'react-router-dom'
import { ChevronLeft, MessagesSquare, TerminalSquare } from 'lucide-react'
import type { AppContext } from '../lib/app-context'
import { useFleet, useFleetIndex } from '../lib/fleet'
import { useIsMobile } from '../hooks/useIsMobile'
import { FleetOverview } from '../components/sessions/FleetOverview'
import { FiltersBar } from '../components/FiltersBar'
import { SessionPanel, type SessionView } from '../components/sessions/SessionPanel'
import { SessionsAside } from '../components/nav/SessionsAside'
import { SessionActions } from '../components/sessions/SessionActions'

export default function SessionsPage() {
  const ctx = useOutletContext<AppContext>()
  const {
    lang, isCentral, theme, filters, setFilters, activeOnly, setActiveOnly,
    availableProjects, sessionCountByProject, models, availableHarnesses,
  } = ctx
  const pt = lang === 'pt'
  const { sessionId } = useParams()
  const navigate = useNavigate()
  const isMobile = useIsMobile()

  // Never on a central: it aggregates many machines and hosts none of their sessions, so the only
  // fleet it could read is its own box's, drawn under someone else's rows.
  const { fleet, loading, unsupported: pollUnsupported, stale, act } = useFleet(pt ? 'pt' : 'en')
  /**
   * A CENTRAL cannot list a fleet, and must SAY so.
   *
   * `useFleet`'s second argument only stops the polling, and its `unsupported` is reported as false
   * whenever polling is off — so on a central the page fell through every branch to "No sessions on
   * this machine yet.", which is false twice over: a central hosts no sessions, and the machines'
   * sessions it CAN reach are one screen away in Settings → Machines. The one sentence that would
   * have said the true thing was switched off by the very flag that makes it true.
   *
   * The same N/A-versus-a-confident-0 rule the dashboard applies to harness capabilities: an empty
   * list may never stand in for "this install cannot answer".
   */
  // NOT `|| isCentral` any more: on a central the fleet is answered by the RELAY for the machine
  // the aside's picker has chosen, so `unsupported` is again exactly what the poller reports —
  // including the machine's own named refusal.
  const unsupported = pollUnsupported
  const rowIndex = useFleetIndex(fleet.sessions)

  // Matched on BOTH ids for the same reason `fleetIndex` is keyed on both: a managed row is named
  // by its tmux session, while a closed conversation is named by its own conversation id, and a
  // link may carry either.
  const selected = sessionId === undefined
    ? undefined
    : fleet.rows.find(r => r.id === sessionId || r.conversationId === sessionId)

  // The Chat/Terminal choice, in the URL — the SAME `?view=` the shared header in `App.tsx` reads
  // and writes on desktop. Independent `useSearchParams()` calls on the one search string, not a
  // prop threaded down from there: the header and this page can never disagree about which view is
  // showing without a context wire built just to carry two strings.
  const [viewParams, setViewParams] = useSearchParams()
  const sessionView: SessionView = viewParams.get('view') === 'terminal' ? 'terminal' : 'chat'
  const setSessionView = (v: SessionView) => setViewParams(prev => {
    const next = new URLSearchParams(prev)
    if (v === 'chat') next.delete('view')
    else next.set('view', v)
    return next
  }, { replace: true })

  const panel = selected === undefined ? null : (
    <SessionPanel
      session={selected}
      {...(rowIndex.get(selected.id) ? { row: rowIndex.get(selected.id)! } : {})}
      lang={pt ? 'pt' : 'en'}
      theme={theme === 'light' ? 'light' : 'dark'}
      act={act}
      onGone={() => navigate('/sessions')}
      // CONTROLLED on both layouts now. Passing `onViewChange` is what suppresses SessionPanel's
      // own header, and mobile draws the same three things in the row that already holds the back
      // button — one bar instead of two stacked ones saying overlapping things.
      view={sessionView}
      onViewChange={setSessionView}
    />
  )

  // ---------------------------------------------------------------------------
  // Mobile: one column at a time.
  // ---------------------------------------------------------------------------
  if (isMobile) {
    if (panel && selected) {
      return (
        <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
          {/* ONE bar. It used to be two: this back row, and SessionPanel's own header directly
              under it carrying the title, the tabs and the verbs. On a 390px screen that spent
              ~100px of a 664px viewport on chrome before a single message — and the back arrow
              already says where you are, so the word beside it was the least useful thing there.
              The arrow keeps its own 44px target; the title takes the room the label gave up. */}
          <div style={{
            display: 'flex', alignItems: 'center', gap: 8,
            minHeight: 44, padding: '0 10px', flexShrink: 0,
            // Installed as a PWA this is the topmost thing on the screen, so it carries the
            // status-bar band itself — without it the arrow and the tabs sat under the clock and
            // the taps went to the status bar. See `--safe-top`.
            paddingTop: 'var(--safe-top)',
            borderBottom: '1px solid var(--border)', background: 'var(--bg-surface)',
          }}>
            <button
              onClick={() => navigate('/sessions')}
              aria-label={pt ? 'Voltar para as sessões' : 'Back to sessions'}
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                // 44px is the mobile figure, and this is the only way back from this screen.
                width: 44, height: 44, flexShrink: 0, marginLeft: -6,
                border: 'none', background: 'transparent', color: 'var(--text-secondary)',
                cursor: 'pointer',
              }}
            >
              <ChevronLeft size={20} />
            </button>

            <div style={{ minWidth: 0, flex: 1, display: 'flex', flexDirection: 'column' }}>
              <span style={{
                fontSize: 13, fontWeight: 650, color: 'var(--text-primary)',
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              }}>
                {selected.title}
              </span>
              {/* The state stays, on its own line: it is the one fact that changes while you read,
                  and the row below is a conversation that does not repeat it. */}
              <span style={{
                fontSize: 10.5, color: 'var(--text-tertiary)',
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              }}>
                {selected.stateLabel}
                {selected.project ? ` · ${selected.project}` : ''}
              </span>
            </div>

            {/* Icons only — the words "Chat" and "Terminal" beside a title on a 390px screen push
                the title to about six characters. The `aria-label` carries the name. */}
            {selected.conversationBlind === undefined && (
              <div role="tablist" style={{
                display: 'flex', gap: 2, padding: 2, borderRadius: 9, flexShrink: 0,
                background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)',
              }}>
                {([
                  ['chat', <MessagesSquare key="c" size={15} />, pt ? 'Conversa' : 'Chat'],
                  ['terminal', <TerminalSquare key="t" size={15} />, 'Terminal'],
                ] as const).map(([id, icon, label]) => (
                  <button
                    key={id}
                    role="tab"
                    aria-selected={sessionView === id}
                    aria-label={label}
                    onClick={() => setSessionView(id)}
                    style={{
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      width: 38, height: 34, borderRadius: 7, border: 'none', cursor: 'pointer',
                      background: sessionView === id ? 'var(--bg-surface)' : 'transparent',
                      color: sessionView === id ? 'var(--anthropic-orange)' : 'var(--text-tertiary)',
                    }}
                  >
                    {icon}
                  </button>
                ))}
              </div>
            )}

            {rowIndex.get(selected.id) && (
              <SessionActions
                row={rowIndex.get(selected.id)!}
                lang={pt ? 'pt' : 'en'}
                act={act}
                onGone={() => navigate('/sessions')}
              />
            )}
          </div>
          {/* `display: flex` is the load-bearing part, not `flex: 1`.
              This div had `flex: 1, minHeight: 0` and no display, so it was a BLOCK. Its child —
              SessionPanel's own `flex: 1 1 0%` column — was therefore not a flex item at all, and
              a block child ignores its parent's height and grows to its content. Measured on an
              iPhone 12 viewport: this div sat at the correct 620px while the panel inside it was
              40.319px tall, which put the composer 40.305px down the page. The input was not
              hidden — it was rendered far below the fold, and the conversation could not scroll
              because the box that was supposed to scroll had no bounded height to scroll within.
              `flex: 1` on a child means nothing until its PARENT is a flex container. */}
          <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>{panel}</div>
        </div>
      )
    }
    return (
      <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
        {/* The mobile FiltersBar — its OWN "+ Filtro" compact shape, not a shrunk copy of the
            desktop bar. Same `filters`/`activeOnly` state the desktop shared header edits (both
            come from `AppContext`, computed once in App.tsx), scoped to the four dimensions that
            describe a live fleet row — `only` here matches the desktop Sessions call, minus the
            central-only dimensions (members/teams/machines/presence/tags) this workspace has never
            offered on either layout. */}
        <div style={{
          flexShrink: 0, borderBottom: '1px solid var(--border)', padding: '4px 8px',
          // Same reason as the open-session bar above: the shared header is hidden on this layout,
          // so this row IS the top of the screen and owns the status-bar band. The date presets
          // were unpressable without it.
          paddingTop: 'calc(4px + var(--safe-top))',
        }}>
          <FiltersBar
            compact
            only={['harnesses', 'repos', 'projects', 'models']}
            activeOnly={activeOnly}
            onActiveOnlyChange={setActiveOnly}
            filters={filters}
            onChange={setFilters}
            projects={availableProjects}
            sessionCountByProject={sessionCountByProject}
            models={models}
            harnesses={availableHarnesses}
            users={[]}
            lang={lang}
          />
        </div>
        {/* `display: flex` again, and for the third time in this file's history the SAME rule:
            `flex: 1` on a child means nothing until its PARENT is a flex container. This div had
            `flex: 1, minHeight: 0` and no display, so `SessionsAside`'s own `flex: 1 1 0%` column
            was an ordinary block that grew to its content — and with it the scrolling box inside.
            Measured on an iPhone 12 with "Active only" off: the scroller reported
            clientHeight 16.567px against a 664px viewport, `scrollTop` could not move, and the 306
            inactive rows sat below the fold with no way to reach them. The band heading counted
            them correctly the whole time, which is what made it read as "the rows are missing"
            rather than "the list cannot scroll". */}
        <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', padding: '10px 12px' }}>
          <SessionsAside
            lang={pt ? 'pt' : 'en'}
            rows={fleet.rows}
            finishedTasks={fleet.finishedTasks}
            loading={loading}
            unsupported={unsupported}
            filters={filters}
            activeOnly={activeOnly}
            {...(fleet.unavailable ? { unavailable: fleet.unavailable } : {})}
            stale={stale}
          />
        </div>
      </div>
    )
  }

  // ---------------------------------------------------------------------------
  // Desktop: the aside holds the list; this is the centre.
  // ---------------------------------------------------------------------------
  if (panel) return panel

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
      {/* A link to a session that is no longer in the list is not the same as no link at all, and
          the overview would silently swallow the difference — so it is said, once, above it. */}
      {sessionId !== undefined && !loading && (
        <p role="status" style={{
          margin: 0, padding: '12px 20px', fontSize: 12, lineHeight: 1.5,
          color: 'var(--text-tertiary)', borderBottom: '1px solid var(--border)',
        }}>
          {pt
            ? 'Essa sessão não está mais na lista desta máquina.'
            : 'That session is no longer in this machine’s list.'}
        </p>
      )}
      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
        <FleetOverview
          lang={pt ? 'pt' : 'en'}
          rows={fleet.rows}
          loading={loading}
          unsupported={unsupported}
          {...(fleet.unavailable ? { unavailable: fleet.unavailable } : {})}
        />
      </div>
    </div>
  )
}
