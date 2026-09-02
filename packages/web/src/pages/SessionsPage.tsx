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

import { useNavigate, useOutletContext, useParams } from 'react-router-dom'
import { ChevronLeft } from 'lucide-react'
import type { AppContext } from '../lib/app-context'
import { useFleet, useFleetIndex } from '../lib/fleet'
import { useIsMobile } from '../hooks/useIsMobile'
import { FleetOverview } from '../components/sessions/FleetOverview'
import { SessionPanel } from '../components/sessions/SessionPanel'
import { SessionsAside } from '../components/nav/SessionsAside'

export default function SessionsPage() {
  const ctx = useOutletContext<AppContext>()
  const { lang, isCentral, theme } = ctx
  const pt = lang === 'pt'
  const { sessionId } = useParams()
  const navigate = useNavigate()
  const isMobile = useIsMobile()

  // Never on a central: it aggregates many machines and hosts none of their sessions, so the only
  // fleet it could read is its own box's, drawn under someone else's rows.
  const { fleet, loading, unsupported, act } = useFleet(pt ? 'pt' : 'en', !isCentral)
  const rowIndex = useFleetIndex(fleet.sessions)

  // Matched on BOTH ids for the same reason `fleetIndex` is keyed on both: a managed row is named
  // by its tmux session, while a closed conversation is named by its own conversation id, and a
  // link may carry either.
  const selected = sessionId === undefined
    ? undefined
    : fleet.rows.find(r => r.id === sessionId || r.conversationId === sessionId)

  const panel = selected === undefined ? null : (
    <SessionPanel
      session={selected}
      {...(rowIndex.get(selected.id) ? { row: rowIndex.get(selected.id)! } : {})}
      lang={pt ? 'pt' : 'en'}
      theme={theme === 'light' ? 'light' : 'dark'}
      act={act}
      onGone={() => navigate('/sessions')}
    />
  )

  // ---------------------------------------------------------------------------
  // Mobile: one column at a time.
  // ---------------------------------------------------------------------------
  if (isMobile) {
    if (panel) {
      return (
        <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
          <button
            onClick={() => navigate('/sessions')}
            style={{
              display: 'flex', alignItems: 'center', gap: 6,
              // 44px: this is the mobile figure, and it is the only way back from this screen.
              minHeight: 44, padding: '0 14px', flexShrink: 0,
              border: 'none', borderBottom: '1px solid var(--border)',
              background: 'var(--bg-surface)', color: 'var(--text-secondary)',
              fontFamily: 'inherit', fontSize: 13, fontWeight: 600, cursor: 'pointer',
            }}
          >
            <ChevronLeft size={16} />
            {pt ? 'Sessões' : 'Sessions'}
          </button>
          <div style={{ flex: 1, minHeight: 0 }}>{panel}</div>
        </div>
      )
    }
    return (
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0, padding: '10px 12px' }}>
        <SessionsAside
          lang={pt ? 'pt' : 'en'}
          rows={fleet.rows}
          finishedTasks={fleet.finishedTasks}
          loading={loading}
          unsupported={unsupported}
          {...(fleet.unavailable ? { unavailable: fleet.unavailable } : {})}
        />
      </div>
    )
  }

  // ---------------------------------------------------------------------------
  // Desktop: the aside holds the list; this is the centre.
  // ---------------------------------------------------------------------------
  if (panel) return panel

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
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
