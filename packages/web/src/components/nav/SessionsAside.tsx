/**
 * SessionsAside — the fleet, in the sidebar's body.
 *
 * It arranges NOTHING itself. Grouping, ordering and search all come from
 * `@agentistics/tui/control/session-fleet` — the very module the terminal cockpit resolves them
 * with — because two implementations of "which band does this row belong to" is exactly the defect
 * this whole branch exists to remove. What this file owns is the drawing.
 *
 * The list is the FLEET, not the stored history: it shows a session that is running with no stored
 * conversation behind it (an `external` assistant, a `lost` row after a reboot, one started a moment
 * ago), which the old page could not, because it listed metrics and hung the fleet off them as
 * decoration.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Search, X } from 'lucide-react'
import {
  DEFAULT_ORDER, filterSessions, groupSessions, sessionNotify,
  type ControlSession,
} from '@agentistics/tui/control/session-fleet'
import { controlStrings, sessionWordBook } from '@agentistics/tui/control/i18n'
import { HARNESS_COLORS } from '../../lib/harness'
import { dayLabels, daysAgo } from '../../lib/sessionDays'

export interface SessionsAsideProps {
  lang: 'pt' | 'en'
  rows: readonly ControlSession[]
  finishedTasks: readonly string[]
  /** True until the first poll answers — an empty list before then is "not asked yet". */
  loading: boolean
  /** This machine may not be asked at all: a central, or a profile with no host power. */
  unsupported: boolean
  /** Already-localized reason the list may not be the whole truth. */
  unavailable?: string
}

/** The colour a state is said in. `running` is its own token, not `success`, which reads teal. */
const STATE_COLOR: Record<string, string> = {
  working: '#22c55e',
  waiting: 'var(--anthropic-orange)',
  'waiting-approval': 'var(--anthropic-orange)',
  exited: 'var(--text-tertiary)',
  lost: 'var(--text-tertiary)',
  closed: 'var(--text-tertiary)',
  unknown: 'var(--text-tertiary)',
}

export function SessionsAside({
  lang, rows, finishedTasks, loading, unsupported, unavailable,
}: SessionsAsideProps) {
  const pt = lang === 'pt'
  const navigate = useNavigate()
  const { sessionId } = useParams()
  const [query, setQuery] = useState('')
  const searchRef = useRef<HTMLInputElement>(null)

  // The top bar's magnifier focuses this field. An event rather than a prop because the button and
  // the field are in two different subtrees, and threading a ref through the whole shell to join
  // them would put layout plumbing in every component between.
  useEffect(() => {
    const focus = () => searchRef.current?.focus()
    window.addEventListener('agentistics:focus-session-search', focus)
    return () => window.removeEventListener('agentistics:focus-session-search', focus)
  }, [])

  const strings = useMemo(() => controlStrings(lang), [lang])

  // `now` is read once per arrangement rather than per row: two rows landing either side of midnight
  // during one render would be banded against two different "today"s.
  const groups = useMemo(() => {
    const now = Date.now()
    const words = sessionWordBook(strings, dayLabels(lang, now))
    const matched = filterSessions(rows, query)
    const banded = groupSessions(matched, 'day', words, finishedTasks, DEFAULT_ORDER)
    // Newest band first, and a band that is not a day at all — the rows with no timestamp — last:
    // it is an absence, and an absence has no place among the dates.
    return [...banded].sort((a, b) => {
      const da = daysAgo(a.key, now), db = daysAgo(b.key, now)
      if (da === undefined) return 1
      if (db === undefined) return -1
      return da - db
    })
  }, [rows, query, finishedTasks, strings, lang])

  const total = groups.reduce((n, g) => n + g.sessions.length, 0)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, gap: 10, paddingTop: 4 }}>
      <div style={{ position: 'relative', padding: '0 2px' }}>
        <Search
          size={13}
          style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-tertiary)', pointerEvents: 'none' }}
        />
        <input
          ref={searchRef}
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder={pt ? 'Buscar sessão…' : 'Search sessions…'}
          style={{
            width: '100%', boxSizing: 'border-box',
            padding: '9px 26px 9px 30px', borderRadius: 9,
            border: '1px solid var(--border-subtle)', background: 'var(--bg-elevated)',
            color: 'var(--text-primary)', fontFamily: 'inherit',
            // 16px on mobile or iOS Safari zooms the viewport; the global guard in index.css
            // handles it, so this stays the desktop figure and is not overridden inline.
            fontSize: 12.5, outline: 'none',
          }}
        />
        {query !== '' && (
          <button
            onClick={() => setQuery('')}
            aria-label={pt ? 'Limpar busca' : 'Clear search'}
            style={{
              position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)',
              display: 'flex', border: 'none', background: 'transparent',
              color: 'var(--text-tertiary)', cursor: 'pointer', padding: 2,
            }}
          >
            <X size={12} />
          </button>
        )}
      </div>

      <div className="ag-noscroll" style={{ flex: 1, minHeight: 0, overflowY: 'auto', overflowX: 'hidden' }}>
        {total === 0 ? (
          <EmptyReason
            pt={pt} loading={loading} unsupported={unsupported}
            unavailable={unavailable} searching={query !== ''}
          />
        ) : groups.map(group => (
          <div key={group.key} style={{ marginBottom: 10 }}>
            <div style={{
              display: 'flex', alignItems: 'baseline', gap: 6,
              padding: '6px 9px 7px', fontSize: 10.5, fontWeight: 700,
              textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-tertiary)',
            }}>
              <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>{group.label}</span>
              <span style={{ marginLeft: 'auto', fontWeight: 600, opacity: 0.75 }}>{group.sessions.length}</span>
            </div>
            {group.sessions.map(s => (
              <SessionRow
                key={s.id}
                session={s}
                selected={s.id === sessionId || s.conversationId === sessionId}
                onOpen={() => navigate(`/sessions/${s.id}`)}
              />
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}

/**
 * Why the list is empty, in words.
 *
 * Four different facts, and rendering any of them as the others is the confident-zero defect: "not
 * asked yet", "this machine may not be asked", "the poll failed", "your search matched nothing" and
 * "there are genuinely no sessions" send a reader to five different places.
 */
function EmptyReason({ pt, loading, unsupported, unavailable, searching }: {
  pt: boolean; loading: boolean; unsupported: boolean; unavailable?: string; searching: boolean
}) {
  const text = loading
    ? (pt ? 'Lendo as sessões desta máquina…' : 'Reading this machine’s sessions…')
    : unsupported
      ? (pt
          ? 'Esta instalação não pode listar sessões — um central agrega várias máquinas e não hospeda as sessões de nenhuma delas.'
          : 'This install cannot list sessions — a central aggregates many machines and hosts none of their sessions.')
      : unavailable
        ? unavailable
        : searching
          ? (pt ? 'Nenhuma sessão corresponde à busca.' : 'No session matches that search.')
          : (pt ? 'Nenhuma sessão nesta máquina ainda.' : 'No sessions on this machine yet.')

  return (
    <div style={{
      padding: '14px 10px', fontSize: 11.5, lineHeight: 1.55,
      color: 'var(--text-tertiary)',
    }}>
      {text}
    </div>
  )
}

function SessionRow({ session, selected, onOpen }: {
  session: ControlSession; selected: boolean; onOpen: () => void
}) {
  const wants = sessionNotify(session)
  const color = STATE_COLOR[session.state] ?? 'var(--text-tertiary)'
  return (
    <button
      onClick={onOpen}
      style={{
        display: 'flex', alignItems: 'center', gap: 8, width: '100%',
        padding: '9px 9px', borderRadius: 9, border: 'none', textAlign: 'left',
        background: selected ? 'var(--anthropic-orange-dim)' : 'transparent',
        color: selected ? 'var(--text-primary)' : 'var(--text-secondary)',
        cursor: 'pointer', fontFamily: 'inherit', minWidth: 0,
        transition: 'background 0.15s',
      }}
      onMouseEnter={e => { if (!selected) e.currentTarget.style.background = 'var(--bg-elevated)' }}
      onMouseLeave={e => { if (!selected) e.currentTarget.style.background = 'transparent' }}
    >
      {/* The dot marks a row that WANTS somebody. It never carries the message alone — the state
          word is beside it — because a fact said only in colour is a fact some readers never get. */}
      <span
        aria-hidden
        style={{
          width: 6, height: 6, borderRadius: 3, flexShrink: 0,
          background: wants ? 'var(--anthropic-orange)' : color,
          opacity: wants ? 1 : 0.55,
        }}
      />
      <span style={{ minWidth: 0, flex: 1, display: 'flex', flexDirection: 'column', gap: 3 }}>
        <span style={{
          fontSize: 12.5, fontWeight: selected || wants ? 650 : 500,
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {session.title}
        </span>
        <span style={{
          fontSize: 10.5, color: wants ? 'var(--anthropic-orange)' : 'var(--text-tertiary)',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {session.stateLabel}
          {session.task ? ` · ${session.task}` : ''}
        </span>
      </span>
      <span
        aria-hidden
        title={session.harness}
        style={{
          width: 5, height: 5, borderRadius: 3, flexShrink: 0,
          background: (HARNESS_COLORS as Record<string, string>)[session.harness] ?? 'var(--text-tertiary)',
        }}
      />
    </button>
  )
}
