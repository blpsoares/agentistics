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

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { useIsMobile } from '../../hooks/useIsMobile'
import { useNavigate, useParams } from 'react-router-dom'
import { Eye, EyeOff, Pin, PinOff, Plus, Search, X } from 'lucide-react'
import type { Filters, HarnessId, Project } from '@agentistics/core'
import {
  ACTIVE_STATES, DEFAULT_ORDER, GROUPINGS,
  filterSessions, groupSessions, sessionNotify,
  type ControlSession, type SessionGroupingId,
} from '@agentistics/tui/control/session-fleet'
import { controlStrings, sessionWordBook } from '@agentistics/tui/control/i18n'
import { filterFleet } from '../../lib/fleetFilter'
import { FiltersBar } from '../FiltersBar'
import { HARNESS_COLORS, HARNESS_LABELS } from '../../lib/harness'
import { dayLabels, daysAgo } from '../../lib/sessionDays'
import { NewSessionModal } from '../sessions/NewSessionModal'
import {
  MAX_PINNED, getPinnedIds, pinnedServerSnapshot, subscribePinnedSessions, togglePinnedSession,
} from '../../lib/pinnedSessions'

/**
 * The fleet's OWN filter dimensions — harness, project, repo, model — each a fact a row carries
 * itself. Deliberately not the dashboard's `Filters` state: that one scopes stored METRICS (a date
 * range, a set of models over history) and was removed from this workspace on purpose (see
 * `fleetFilter.ts`'s header) — a fleet is what is running now, not a historical window. This block
 * builds the narrower `Filters` shape `filterFleet` actually reads and owns no rule of its own.
 *
 * Rendered through the SAME `FiltersBar` the dashboard uses (`only` restricted to the four
 * dimensions above, `hideDateRange` dropping the one control that means nothing for a live fleet)
 * rather than a second, bespoke filter widget — a fleet's harness/project/repo/model chips are the
 * same KIND of control the dashboard already has, and inventing a second implementation of "pick a
 * value to narrow by" is exactly the defect this whole branch exists to remove.
 */
interface FleetFilterState {
  harnesses: HarnessId[]
  projects: string[]
  repos: string[]
  models: string[]
}
const EMPTY_FLEET_FILTER: FleetFilterState = { harnesses: [], projects: [], repos: [], models: [] }

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
  working: 'var(--accent-green)',
  waiting: 'var(--anthropic-orange)',
  'waiting-approval': 'var(--anthropic-orange)',
  exited: 'var(--text-tertiary)',
  lost: 'var(--text-tertiary)',
  closed: 'var(--text-tertiary)',
  unknown: 'var(--text-tertiary)',
}

/**
 * The wash behind a LIVE row, so its state is readable without reading the word.
 *
 * Only the two active states get one. A tint on every row is a list with no contrast left, and the
 * point of the wash is that the handful of rows doing something stand out from the history under
 * them. It is a WASH, never the row's whole background: the selected row's own highlight has to
 * stay distinguishable from it, or selection stops being visible on exactly the rows you select
 * most.
 */
const STATE_WASH: Record<string, string> = {
  working: 'color-mix(in srgb, #22c55e 10%, transparent)',
  waiting: 'color-mix(in srgb, var(--anthropic-orange) 12%, transparent)',
  'waiting-approval': 'color-mix(in srgb, var(--anthropic-orange) 12%, transparent)',
}

/**
 * What a pin is stored under.
 *
 * The CONVERSATION where the harness reports one, because a managed row's id is its tmux session
 * name and is minted fresh on every reopen — keying by that would unpin a conversation at exactly
 * the moment somebody who pinned it wants it back. Where no conversation link can ever exist
 * (codex, kimi, gemini, agy — see `conversationBlind`) the row id is the only key there is.
 */
/**
 * A model id, shortened for a narrow column.
 *
 * The provider prefix and the dated suffix are what a person already knows or does not care about
 * in a sidebar — `anthropic/claude-sonnet-4-5-20250929` becomes `claude-sonnet-4-5`. The full id is
 * on the row's `title` attribute, so nothing is lost.
 */
function shortModel(model: string): string {
  const bare = model.includes('/') ? model.slice(model.lastIndexOf('/') + 1) : model
  return bare.replace(/-\d{8}$/, '')
}

function pinKeyOf(row: ControlSession): string {
  return row.conversationId ?? row.id
}

export function SessionsAside({
  lang, rows, finishedTasks, loading, unsupported, unavailable,
}: SessionsAsideProps) {
  const pt = lang === 'pt'
  const navigate = useNavigate()
  // 44px is the MOBILE figure. Applying it on desktop turns a compact list into a row of buttons.
  const isMobile = useIsMobile()
  const tap = isMobile ? 44 : undefined
  const { sessionId } = useParams()
  const [query, setQuery] = useState('')
  const [creating, setCreating] = useState(false)
  /**
   * What the bands stand for. `day` by default; every dimension the terminal cockpit offers is
   * offered here, from the same `GROUPINGS` table, so the two can never disagree about what a
   * grouping means or what a band is called.
   */
  const [grouping, setGrouping] = useState<SessionGroupingId>('day')
  /**
   * Only the conversations that are RUNNING. On by default, matching `DEFAULT_SESSION_VIEW` in the
   * terminal cockpit — a machine with months of named work otherwise opens on all of it, and the
   * handful doing something right now is what the workspace is for.
   *
   * It is strict, so when nothing is running the list is empty — which is why `EmptyReason` has to
   * name THIS switch rather than blaming the search: the rows behind it are still there.
   */
  const [onlyActive, setOnlyActive] = useState(true)
  /** The fleet's own filter block — harness/project/repo/model. See `FleetFilterState` above. */
  const [fleetFilter, setFleetFilter] = useState<FleetFilterState>(EMPTY_FLEET_FILTER)
  /**
   * The pinned set, from the module that already owns it.
   *
   * `useSyncExternalStore` rather than local state because the store is shared — `RecentSessions`
   * reads the same one — and two components holding their own copy is how a pin lands in one list
   * and not the other. Its rules (a hard limit of three, the fourth REFUSED rather than silently
   * swapped) live there and are not re-decided here.
   */
  const pins = useSyncExternalStore(subscribePinnedSessions, getPinnedIds, pinnedServerSnapshot)
  const pinned = useMemo(() => new Set(pins), [pins])
  const flip = (row: ControlSession) => {
    const out = togglePinnedSession(pinKeyOf(row))
    if (!out.ok && out.reason === 'limit') {
      setPinNotice(pt
        ? `No máximo ${MAX_PINNED} conversas fixadas. Solte uma antes de fixar outra.`
        : `At most ${MAX_PINNED} pinned conversations. Unpin one first.`)
      return
    }
    setPinNotice(null)
  }
  const [pinNotice, setPinNotice] = useState<string | null>(null)
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
  /** The grouping names, from the control center's own table — never a second set of words. */
  const groupWords = strings.sessionsGroupings as Record<string, string>

  // The values the filter block can offer, read off the WHOLE fleet rather than the filtered result —
  // narrowing to "codex" must not make every other harness's chip disappear, or there would be no way
  // back to it without clearing the block first.
  const harnessOptions = useMemo(
    () => Array.from(new Set(rows.map(r => r.harness).filter(h => h !== ''))).sort() as HarnessId[],
    [rows],
  )
  const modelOptions = useMemo(
    () => Array.from(new Set(rows.map(r => r.model).filter((m): m is string => m !== undefined))).sort(),
    [rows],
  )
  // `FiltersBar`'s project picker and its repo dimension (derived from `Project.gitRemote`) both
  // read a `Project[]`, which is the dashboard's shape — a fleet row is not one, so this is the
  // adapter, built ONCE from the live rows rather than from stored data this workspace has none of.
  // Keyed by `cwd`, which is also what `filterFleet`'s project match falls back to for an exact path.
  const fleetProjects: Project[] = useMemo(() => {
    const byPath = new Map<string, Project>()
    for (const r of rows) {
      if (r.cwd === '' || byPath.has(r.cwd)) continue
      byPath.set(r.cwd, {
        path: r.cwd, name: r.project || r.cwd, sessions: [],
        ...(r.repo ? { gitRemote: r.repo } : {}),
      })
    }
    return Array.from(byPath.values())
  }, [rows])
  const fleetSessionCountByProject = useMemo(() => {
    const counts: Record<string, number> = {}
    for (const r of rows) { if (r.cwd !== '') counts[r.cwd] = (counts[r.cwd] ?? 0) + 1 }
    return counts
  }, [rows])
  const fleetFiltersAsFilters: Filters = useMemo(() => ({
    dateRange: 'all', customStart: '', customEnd: '',
    projects: fleetFilter.projects, repos: fleetFilter.repos, models: fleetFilter.models,
    harnesses: fleetFilter.harnesses,
  }), [fleetFilter])
  const onFleetFiltersChange = (f: Filters) => {
    setFleetFilter({
      harnesses: f.harnesses ?? [], projects: f.projects, repos: f.repos ?? [], models: f.models,
    })
  }

  // `now` is read once per arrangement rather than per row: two rows landing either side of midnight
  // during one render would be banded against two different "today"s.
  const active = useMemo(() => new Set<string>(ACTIVE_STATES), [])
  // `filterFleet` owns harness/project/repo/model AND `activeOnly`, but the onlyActive switch needs
  // its OWN withheld count (see `hidden` below) independent of the value filters, so it is applied
  // here as an ordinary array filter rather than through `activeOnly: true`.
  const valueFiltered = useMemo(
    () => filterFleet({ rows, filters: fleetFiltersAsFilters, activeOnly: false }).rows,
    [rows, fleetFiltersAsFilters],
  )
  const searched = useMemo(() => filterSessions(valueFiltered, query), [valueFiltered, query])
  const matched = useMemo(
    () => (onlyActive ? searched.filter(r => active.has(r.state)) : searched),
    [searched, onlyActive, active],
  )
  /** How many rows the switch is withholding, so the row can say what turning it off would show. */
  const hidden = useMemo(
    () => (onlyActive ? searched.filter(r => !active.has(r.state)).length : 0),
    [searched, onlyActive, active],
  )

  /** The pinned rows, in the order they were pinned. Their own band, above everything. */
  const pinnedRows = useMemo(
    () => pins.map(k => matched.find(r => pinKeyOf(r) === k)).filter((r): r is ControlSession => r !== undefined),
    [pins, matched],
  )

  const groups = useMemo(() => {
    const now = Date.now()
    const words = sessionWordBook(strings, dayLabels(lang, now))
    // A pinned row is shown ONCE, in its own band. Leaving it in its ordinary band too would make
    // the list longer than the fleet and the count beside each heading wrong.
    const rest = matched.filter(r => !pinned.has(pinKeyOf(r)))
    const banded = groupSessions(rest, grouping, words, finishedTasks, DEFAULT_ORDER)
    // Only the DAY grouping has a natural order — newest first, with the band that is not a day at
    // all (rows with no timestamp) last, because an absence has no place among the dates. Every
    // other dimension keeps the order `groupSessions` produced; re-sorting it here would be a
    // second opinion about an arrangement that module already decided.
    if (grouping !== 'day') return banded
    return [...banded].sort((a, b) => {
      const da = daysAgo(a.key, now), db = daysAgo(b.key, now)
      if (da === undefined) return 1
      if (db === undefined) return -1
      return da - db
    })
  }, [matched, pinned, grouping, finishedTasks, strings, lang])

  const total = groups.reduce((n, g) => n + g.sessions.length, 0) + pinnedRows.length

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, gap: 10, paddingTop: 4 }}>
      <button
        onClick={() => setCreating(true)}
        style={{
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7,
          margin: '0 2px', padding: '9px 12px', borderRadius: 9, cursor: 'pointer', minHeight: tap,
          border: '1px dashed var(--border)', background: 'transparent',
          color: 'var(--text-secondary)', fontFamily: 'inherit', fontSize: 12.5, fontWeight: 600,
        }}
        onMouseEnter={e => {
          e.currentTarget.style.borderColor = 'var(--anthropic-orange)'
          e.currentTarget.style.color = 'var(--anthropic-orange)'
        }}
        onMouseLeave={e => {
          e.currentTarget.style.borderColor = 'var(--border)'
          e.currentTarget.style.color = 'var(--text-secondary)'
        }}
      >
        <Plus size={14} />
        {pt ? 'Nova sessão' : 'New session'}
      </button>

      {creating && (
        <NewSessionModal
          lang={lang}
          onClose={() => setCreating(false)}
          onStarted={id => {
            setCreating(false)
            // Straight into it. The row will arrive on the next poll; navigating now means the
            // panel is already open on it when it does.
            if (id) navigate(`/sessions/${id}`)
          }}
        />
      )}

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

      {/* ALWAYS VISIBLE — never behind a second click. A native `<select>` rather than the earlier
          popover: every dimension the terminal cockpit offers, from the same `GROUPINGS` table, so
          the two can never disagree about what a grouping means or what a band is called. */}
      <div style={{ padding: '0 2px' }}>
        <select
          value={grouping}
          onChange={e => setGrouping(e.target.value as SessionGroupingId)}
          style={{
            width: '100%', minHeight: tap,
            padding: '6px 9px', borderRadius: 8, cursor: 'pointer',
            border: '1px solid var(--border-subtle)', background: 'var(--bg-elevated)',
            color: 'var(--text-secondary)', fontFamily: 'inherit', fontSize: 11.5, fontWeight: 600,
          }}
        >
          {GROUPINGS.map(g => (
            <option key={g} value={g}>{pt ? 'Agrupar: ' : 'Group by: '}{groupWords[g] ?? g}</option>
          ))}
        </select>
      </div>

      {/* The fleet's OWN filter block — harness/project/repo/model, each a fact a row carries
          itself — through the SAME `FiltersBar` the dashboard uses. A section with only one option
          offers nothing to narrow, which is what `only` restricted to a dimension with >1 value
          already achieves inside FiltersBar's own "+ Filter" menu; `hideDateRange` drops the one
          control that means nothing for a live fleet (see `fleetFilter.ts`'s header). */}
      {(harnessOptions.length > 1 || fleetProjects.some(p => p.gitRemote) || fleetProjects.length > 1
        || modelOptions.length > 1) && (
        <FiltersBar
          only={['harnesses', 'repos', 'projects', 'models']}
          hideDateRange
          compact
          filters={fleetFiltersAsFilters}
          onChange={onFleetFiltersChange}
          projects={fleetProjects}
          sessionCountByProject={fleetSessionCountByProject}
          models={modelOptions}
          harnesses={harnessOptions}
          users={[]}
          lang={lang}
        />
      )}

      <button
        onClick={() => setOnlyActive(v => !v)}
        style={{
          display: 'flex', alignItems: 'center', gap: 7, width: 'calc(100% - 4px)',
          margin: '0 2px', padding: '6px 9px', borderRadius: 8, cursor: 'pointer', minHeight: tap,
          border: '1px solid var(--border-subtle)',
          background: onlyActive ? 'var(--anthropic-orange-dim)' : 'transparent',
          color: onlyActive ? 'var(--anthropic-orange)' : 'var(--text-tertiary)',
          fontFamily: 'inherit', fontSize: 11.5, fontWeight: 600,
        }}
      >
        {onlyActive ? <Eye size={12} style={{ flexShrink: 0 }} /> : <EyeOff size={12} style={{ flexShrink: 0 }} />}
        <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {pt ? 'Só as que estão rodando' : 'Only what is running'}
        </span>
        {/* The count of what is being withheld. A switch that narrows silently is one people
            conclude is broken when the list looks short. */}
        {onlyActive && hidden > 0 && (
          <span style={{ marginLeft: 'auto', fontWeight: 700, opacity: 0.8, flexShrink: 0 }}>+{hidden}</span>
        )}
      </button>

      {pinNotice && (
        <p role="status" style={{
          margin: '0 4px', fontSize: 11, lineHeight: 1.45, color: 'var(--anthropic-orange)',
        }}>
          {pinNotice}
        </p>
      )}

      <div className="ag-noscroll" style={{ flex: 1, minHeight: 0, overflowY: 'auto', overflowX: 'hidden' }}>
        {/* The pinned band, above everything and OUTSIDE the grouping — that is what pinning is
            for: the two or three sessions that must not move when the arrangement changes. */}
        {pinnedRows.length > 0 && (
          <div style={{ marginBottom: 16 }}>
            <div style={{
              display: 'flex', alignItems: 'center', gap: 6,
              padding: '6px 9px 7px', fontSize: 10.5, fontWeight: 700,
              textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--anthropic-orange)',
            }}>
              <Pin size={11} />
              <span>{pt ? 'Fixadas' : 'Pinned'}</span>
              <span style={{ marginLeft: 'auto', fontWeight: 600, opacity: 0.75 }}>{pinnedRows.length}</span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {pinnedRows.map(s => (
                <SessionRow
                  key={`pin-${s.id}`}
                  session={s}
                  selected={s.id === sessionId || s.conversationId === sessionId}
                  pinned
                  {...(tap ? { tap } : {})}
                  onPin={() => flip(s)}
                  onOpen={() => navigate(`/sessions/${s.id}`)}
                />
              ))}
            </div>
          </div>
        )}
        {total === 0 ? (
          <EmptyReason
            pt={pt} loading={loading} unsupported={unsupported}
            unavailable={unavailable} searching={query !== ''}
            withheld={onlyActive ? hidden : 0}
            onShowAll={() => setOnlyActive(false)}
            filterNarrowed={
              (fleetFilter.harnesses.length + fleetFilter.projects.length
                + fleetFilter.repos.length + fleetFilter.models.length) > 0
              && valueFiltered.length < rows.length
            }
            onClearFilters={() => setFleetFilter(EMPTY_FLEET_FILTER)}
          />
        ) : groups.map(group => (
          <div key={group.key} style={{ marginBottom: 16 }}>
            <div style={{
              display: 'flex', alignItems: 'baseline', gap: 6,
              padding: '6px 9px 7px', fontSize: 10.5, fontWeight: 700,
              textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-tertiary)',
            }}>
              <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>{group.label}</span>
              <span style={{ marginLeft: 'auto', fontWeight: 600, opacity: 0.75 }}>{group.sessions.length}</span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {group.sessions.map(s => (
              <SessionRow
                key={s.id}
                session={s}
                selected={s.id === sessionId || s.conversationId === sessionId}
                pinned={pinned.has(pinKeyOf(s))}
                {...(tap ? { tap } : {})}
                onPin={() => flip(s)}
                onOpen={() => navigate(`/sessions/${s.id}`)}
              />
            ))}
            </div>
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
/**
 * Why the list is empty, in words, plus the way out when there is one.
 *
 * Six different facts, and rendering any of them as the others is the confident-zero defect: not
 * asked yet, this machine may not be asked, the poll failed, your search matched nothing, the
 * only-running switch is withholding rows, and there are genuinely none. Each sends a reader
 * somewhere different — and the fifth is the one that must name the switch, because the rows are
 * still there and blaming the search would send somebody to clear a field that is already empty.
 */
function EmptyReason({
  pt, loading, unsupported, unavailable, searching, withheld, onShowAll, filterNarrowed, onClearFilters,
}: {
  pt: boolean; loading: boolean; unsupported: boolean; unavailable?: string; searching: boolean
  /** How many rows the only-running switch is holding back. */
  withheld: number
  onShowAll: () => void
  /** The fleet's own filter block (harness/project/repo/model) hid every row — a SEPARATE fact
      from the only-running switch, and checked first: with the block narrowing to nothing, the
      switch and the search both read as empty too, and blaming either would send someone to clear
      a control that was never the cause. */
  filterNarrowed: boolean
  onClearFilters: () => void
}) {
  const text = loading
    ? (pt ? 'Lendo as sessões desta máquina…' : 'Reading this machine’s sessions…')
    : unsupported
      ? (pt
          ? 'Esta instalação não pode listar sessões — um central agrega várias máquinas e não hospeda as sessões de nenhuma delas.'
          : 'This install cannot list sessions — a central aggregates many machines and hosts none of their sessions.')
      : unavailable
        ? unavailable
        : filterNarrowed
          ? (pt ? 'Nenhuma sessão corresponde aos filtros.' : 'No session matches the filters.')
          : withheld > 0
            ? (pt
                ? `Nada rodando agora. ${withheld} ${withheld === 1 ? 'conversa está' : 'conversas estão'} escondida${withheld === 1 ? '' : 's'} pelo filtro.`
                : `Nothing is running right now. ${withheld} ${withheld === 1 ? 'conversation is' : 'conversations are'} hidden by the filter.`)
            : searching
              ? (pt ? 'Nenhuma sessão corresponde à busca.' : 'No session matches that search.')
              : (pt ? 'Nenhuma sessão nesta máquina ainda.' : 'No sessions on this machine yet.')

  return (
    <div style={{
      padding: '14px 10px', fontSize: 11.5, lineHeight: 1.55,
      color: 'var(--text-tertiary)', display: 'flex', flexDirection: 'column', gap: 8,
    }}>
      <span>{text}</span>
      {/* The way out, named rather than left for the reader to find. */}
      {!loading && !unsupported && !unavailable && filterNarrowed && (
        <button
          onClick={onClearFilters}
          style={{
            alignSelf: 'flex-start', padding: '5px 10px', borderRadius: 7, cursor: 'pointer',
            border: '1px solid var(--border-subtle)', background: 'transparent',
            color: 'var(--anthropic-orange)', fontFamily: 'inherit', fontSize: 11.5, fontWeight: 600,
          }}
        >
          {pt ? 'Limpar filtros' : 'Clear filters'}
        </button>
      )}
      {!loading && !unsupported && !unavailable && !filterNarrowed && withheld > 0 && (
        <button
          onClick={onShowAll}
          style={{
            alignSelf: 'flex-start', padding: '5px 10px', borderRadius: 7, cursor: 'pointer',
            border: '1px solid var(--border-subtle)', background: 'transparent',
            color: 'var(--anthropic-orange)', fontFamily: 'inherit', fontSize: 11.5, fontWeight: 600,
          }}
        >
          {pt ? 'Mostrar todas' : 'Show all'}
        </button>
      )}
    </div>
  )
}

function SessionRow({ session, selected, pinned, tap, onPin, onOpen }: {
  session: ControlSession; selected: boolean
  /** Minimum row height on mobile — 44px, and undefined on desktop. */
  tap?: number
  pinned?: boolean
  onPin?: () => void
  onOpen: () => void
}) {
  const wants = sessionNotify(session)
  const color = STATE_COLOR[session.state] ?? 'var(--text-tertiary)'
  return (
    <button
      onClick={onOpen}
      style={{
        display: 'flex', alignItems: 'center', gap: 8, width: '100%',
        padding: '9px 9px', borderRadius: 9, border: 'none', textAlign: 'left', minHeight: tap,
        background: selected ? 'var(--anthropic-orange-dim)' : (STATE_WASH[session.state] ?? 'transparent'),
        // A live row also carries a coloured edge. The wash alone is faint by design, and an edge
        // survives a light theme and a colour-blind reader where a 10% tint does not.
        boxShadow: selected || !STATE_WASH[session.state]
          ? undefined
          : `inset 2px 0 0 ${STATE_COLOR[session.state] ?? 'transparent'}`,
        color: selected ? 'var(--text-primary)' : 'var(--text-secondary)',
        cursor: 'pointer', fontFamily: 'inherit', minWidth: 0,
        transition: 'background 0.15s',
      }}
      onMouseEnter={e => { if (!selected) e.currentTarget.style.background = 'var(--bg-elevated)' }}
      onMouseLeave={e => {
        if (!selected) e.currentTarget.style.background = STATE_WASH[session.state] ?? 'transparent'
      }}
      title={session.model ? `${session.title}\n${session.model}` : session.title}
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
          display: 'flex', alignItems: 'center', gap: 5, minWidth: 0,
          fontSize: 10.5, color: wants ? 'var(--anthropic-orange)' : 'var(--text-tertiary)',
        }}>
          <span style={{ flexShrink: 0 }}>{session.stateLabel}</span>
          <span style={{ opacity: 0.4, flexShrink: 0 }}>·</span>
          <span style={{
            color: (HARNESS_COLORS as Record<string, string>)[session.harness] ?? 'var(--text-tertiary)',
            fontWeight: 650, flexShrink: 0,
          }}>
            {(HARNESS_LABELS as Record<string, string>)[session.harness] ?? session.harness}
          </span>
          {/* The model, when the row knows one. A row that does not is not "some default model" —
              it is unknown, and inventing a name there is the confident-zero defect in words. */}
          {session.model && (
            <>
              <span style={{ opacity: 0.4, flexShrink: 0 }}>·</span>
              <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {shortModel(session.model)}
              </span>
            </>
          )}
          {session.task && (
            <>
              <span style={{ opacity: 0.4, flexShrink: 0 }}>·</span>
              <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {session.task}
              </span>
            </>
          )}
        </span>
      </span>
      {/* The assistant, NAMED. It was a 5px dot, which carries the fact in colour alone — and a
          colour is not a name. The model sits with it on the meta line below. */}
      {/* The pin lives on the row rather than in a menu: it is a one-click decision about the row
          you are looking at. `role="button"` on a span, because a <button> inside a <button> is
          invalid HTML and browsers resolve it by dropping one of them. */}
      {onPin && (
        <span
          role="button"
          tabIndex={0}
          aria-label={pinned ? 'Unpin' : 'Pin'}
          title={pinned ? 'Unpin' : 'Pin'}
          onClick={e => { e.stopPropagation(); onPin() }}
          onKeyDown={e => {
            if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); onPin() }
          }}
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
            width: 20, height: 20, borderRadius: 6, cursor: 'pointer',
            color: pinned ? 'var(--anthropic-orange)' : 'var(--text-tertiary)',
            // A pin nobody set is faint until the row is hovered: a column of pin glyphs down an
            // unpinned list is noise beside the titles they sit next to.
            // There is no hover on a touch screen, so the pin is always visible there. On desktop
            // it appears with the row — see `.ag-row-pin` in index.css.
            opacity: pinned || tap ? 1 : 0,
            transition: 'opacity 0.15s',
          }}
          className="ag-row-pin"
        >
          {pinned ? <Pin size={12} /> : <PinOff size={12} />}
        </span>
      )}
    </button>
  )
}
