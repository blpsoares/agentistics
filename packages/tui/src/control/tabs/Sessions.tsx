/**
 * Sessions.tsx — the fleet, on one screen.
 *
 * This screen knows nothing about tmux, `/proc` or what a harness prints: every session and every
 * word describing it arrives from `host.sessions()` already decided and already localized, exactly
 * as the services list arrives from `host.refresh()`. What it owns is the arrangement — which rows
 * fit, how they group, which one the cursor is on — and all of that arithmetic lives in the pure
 * `sessions.ts` beside it.
 *
 * The screen exists to answer one question at a glance: which of these is waiting for me. So the
 * ordering puts that first, the state word is the last cell given up under width pressure, and the
 * counter it feeds is drawn in the header where it is readable from every other tab.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Box, Text, useInput } from 'ink'
import type {
  ActionResult, ControlExit, ControlHost, ControlSession, ControlSessions, SessionState,
  SessionViewPrefs,
} from '../types'
import type { ControlStrings } from '../i18n'
import type { TabChrome } from '../ControlCenter'
import { resolveListKey, windowOffset, type NavKey } from '../nav'
import { ACTION_SEP, actionAtColumn, fitActionRow } from '../chrome.ts'
import { Divider } from '../Surface'
import { ConfirmPrompt, TextPrompt } from '../Prompt'
import { SessionWizard } from './SessionWizard'
import {
  GROUPINGS, detailLines, groupSessions, selectableIndexes, sessionCells, sessionRows,
  QUESTION_ROWS, actionLabels, asideRows, asideSelectable, enabledActionIndexes, filterSessions,
  sessionActions, sessionsCockpit, sessionsLayout, summaryCells, sessionColumns, padCell,
  taskCounts, sessionMetric,
  type AsideRow, type OfferedAction, type SessionColumns, type SessionToggle,
  type DetailLine, type SessionAction, type SessionGrouping, type SessionRow,
} from '../sessions'
import { isActivation, wheelDelta } from '../mouse'
import { usePointer } from '../pointer'
import { truncate } from '../../components/Primitives'
import { COLORS, HARNESS_COLOR } from '../../theme'

/** The colour each state wears. Paired with a WORD everywhere it is drawn — a fleet state announced
 *  in colour alone is unreadable on a terminal with a flattened palette, and this is the one screen
 *  whose whole purpose is that single fact. */
const STATE_COLOR: Record<SessionState, string | undefined> = {
  'waiting-approval': COLORS.danger,
  // Amber is also the selection colour, which they can share: a selected row already carries the
  // `❯` cursor and a bold title, so the two never have to be told apart by hue alone.
  waiting: COLORS.accent,
  working: COLORS.success,
  exited: COLORS.muted,
  lost: COLORS.muted,
  unknown: COLORS.muted,
  closed: COLORS.muted,
}

/**
 * A question this screen is asking. While one is open it reports `capture`, so the global keys stand
 * down — typing a session name would otherwise quit the app on the `q` and refresh it on the `r`.
 */
type Ask =
  /** Everything about WHAT the list shows, in one vertical panel. */
  | { kind: 'view' }
  | { kind: 'search' }
  | { kind: 'task'; session: ControlSession }
  | { kind: 'openTask'; session: ControlSession }
  | { kind: 'resume'; session: ControlSession }
  | { kind: 'rename'; session: ControlSession }
  | { kind: 'note'; session: ControlSession }
  | { kind: 'kill'; session: ControlSession }
  /** Starting a new one — the only question that needs no selected row. */
  | { kind: 'new' }

export function Sessions({
  host, fleet, strings: s, width, height, isActive, run, onChrome, onExit, onRefreshFleet,
  view, onView,
}: {
  host: ControlHost
  /** `null` until the first poll lands, `undefined` when the host has no fleet at all. The two are
   *  different sentences and the screen must not collapse them. */
  fleet: ControlSessions | null | undefined
  strings: ControlStrings
  width: number
  height: number
  isActive: boolean
  /** The shell's single funnel for performing anything — spinner, status line, refresh. */
  run: (fn: () => Promise<ActionResult>, label?: string) => Promise<ActionResult>
  onChrome: (chrome: TabChrome) => void
  onExit: (exit: ControlExit) => void
  /** Re-poll immediately rather than waiting out the interval — an action the user just took must
   *  be visible in the list before the next tick, or the screen looks like it ignored them. */
  onRefreshFleet: () => void
  /** How the list was arranged last time, as the host remembered it. */
  view: SessionViewPrefs | undefined
  /** Store the arrangement, so a restart does not throw away what the user chose. */
  onView: (v: SessionViewPrefs) => void
}) {
  const [grouping, setGrouping] = useState<SessionGrouping>(view?.grouping ?? 'none')
  const [cursor, setCursor] = useState(0)
  const [ask, setAsk] = useState<Ask | null>(null)
  const [query, setQuery] = useState('')
  /**
   * Whether the visible action row has the keyboard.
   *
   * The row is there so the screen can be used WITHOUT knowing any letters — every verb is spelled
   * out, reachable with `tab` and the arrows, and clickable. The letters stay as accelerators for
   * people who already know them; they were never meant to be the only way in.
   */
  /**
   * Whether closed conversations are listed at all.
   *
   * OFF by default. The screen is about what is happening, and on a real machine the history is an
   * order of magnitude bigger than the fleet — it buried the live rows the first time it shipped on.
   * One keypress and one visible toggle bring it back, and search reaches it either way.
   */
  const [showClosed, setShowClosed] = useState(view?.showClosed ?? false)
  /** Whether the "no task" bucket is listed while grouping by task. Hidden by default: the point of
   *  grouping by task is seeing the tasks, and everything unfiled is the biggest group there is. */
  const [hideEmptyTask, setHideEmptyTask] = useState(!(view?.showUnfiled ?? false))
  const [actionsFocused, setActionsFocused] = useState(false)
  const [actionIndex, setActionIndex] = useState(0)
  /**
   * Whether a FINISHED session is listed.
   *
   * Its own switch rather than sharing the closed one: a session that ran here and ended is a
   * different thing from a conversation that was never ours, and someone who wants yesterday's
   * conversations back does not necessarily want every pane that exited today.
   */
  const [showExited, setShowExited] = useState(view?.showExited ?? false)
  /**
   * The task the list is scoped to, or `null` for the whole fleet.
   *
   * Scoping rather than navigating away: a task is a place you work out of, so picking one narrows
   * the list you are already looking at and every verb keeps working on the rows inside it.
   */
  const [taskFilter, setTaskFilter] = useState<string | null>(null)
  /** Which pane has the keyboard. The aside is a real pane, not a strip of hints. */
  const [focus, setFocus] = useState<'list' | 'aside'>('list')
  const [asideIndex, setAsideIndex] = useState(0)

  const rows = useMemo(() => sessionRows(groupSessions(
    filterSessions(
      (fleet?.sessions ?? []).filter(v =>
        (showClosed || v.state !== 'closed')
        && (showExited || (v.state !== 'exited' && v.state !== 'lost'))
        // Scoped to one task: every verb still works, on the rows inside it.
        && (taskFilter === null || v.task === taskFilter)
        // Only ever applies while grouping by task: everywhere else an unfiled session is simply a
        // session, and hiding it would make the list lie about how many there are.
        && !(hideEmptyTask && grouping === 'task' && !v.task)),
      query,
    ),
    grouping,
    {
      harness: s.sessionsUnknownHarness,
      model: s.sessionsUnknownModel,
      project: s.sessionsUnknownProject,
      task: s.sessionsUnknownTask,
    },
  ), s.sessionsClosedWord), [fleet?.sessions, grouping, query, showClosed, showExited, hideEmptyTask, taskFilter, s])

  const selectable = useMemo(() => selectableIndexes(rows), [rows])

  // Clamped on every render rather than corrected in an effect: a session that ends between two
  // polls shortens the list under the cursor, and a stored index would point past the end for one
  // frame — which is the frame the user presses enter on.
  const at = selectable.length === 0 ? -1 : Math.min(cursor, selectable.length - 1)
  const selected: ControlSession | undefined = at < 0
    ? undefined
    : (rows[selectable[at]!] as Extract<SessionRow, { kind: 'session' }>).session

  // The detail pane asks for exactly what it has to say, and the list absorbs the difference. A
  // pane sized to a constant leaves dead rows under it — air under a pane is a fault, and a list
  // with room to grow is not air, it is a list.
  const detail = useMemo(() => (selected ? detailLines(selected, {
    where: s.sessionsWhere,
    model: s.sessionsModel,
    note: s.sessionsNote,
    started: s.sessionsStarted,
    external: s.sessionsExternalNote,
    closed: s.sessionsClosedNote,
    doing: s.sessionsDoing,
    task: s.sessionsTask,
    metrics: s.sessionsMetrics,
    // Absent when the backend did not report one — an invented keystroke is worse than none, since
    // the whole point of this line is that it is the key that actually works here.
    ...(fleet?.detachHint ? { detach: { label: s.sessionsDetach, keys: fleet.detachHint } } : {}),
    // The clock arithmetic happens HERE, not in the pure module and not in the string table: the
    // host reports the INSTANT a session started, and the pane repaints far more often than the
    // poll runs, so a duration computed anywhere upstream would freeze at whatever it was.
  }, startedAt => s.sessionsAgo(Math.max(0, Math.round((Date.now() - startedAt) / 1000)))) : []),
  [selected, s, fleet?.detachHint])
  // A question needs room whether or not the detail pane earned any, so it sets the floor. The
  // cockpit reserves `QUESTION_ROWS` for the same reason: a prompt with nowhere to draw is a prompt
  // the user cannot answer.
  // The action row is drawn from this screen's own budget, so it is subtracted BEFORE the split. A
  // row taken without being paid for is composited over the one under it, which reads as a corrupt
  // frame rather than a cramped one.
  const actionRows = height >= 12 ? 2 : height >= 8 ? 1 : 0
  const layout = sessionsLayout(
    Math.max(1, height - actionRows),
    ask ? Math.max(QUESTION_ROWS, detail.length) : detail.length,
  )

  /**
   * Act on the selected row, or say why it cannot be acted on.
   *
   * An external session is LISTED because the fleet in one place is the point, and refused here
   * because agentop did not start it — it has no backend to attach to and no record to rename. The
   * refusal is a sentence rather than a silently ignored keypress: a control that does nothing and
   * says nothing is indistinguishable from a broken one.
   */
  const actions = useMemo(() => sessionActions(selected), [selected])
  // The cursor moves over the ENABLED verbs only; the dim ones keep the row's shape and are never
  // landed on. Clamped every render, because which are enabled changes with the selection.
  const liveActions = useMemo(() => enabledActionIndexes(actions), [actions])
  const liveAt = liveActions.length === 0 ? 0 : Math.min(actionIndex, liveActions.length - 1)
  const at2 = liveActions[liveAt] ?? 0
  const actionWords = useMemo(() => actionLabels(actions, {
    attach: s.actSessions.attach,
    resume: s.actSessions.resume,
    rename: s.actSessions.rename,
    note: s.actSessions.note,
    task: s.actSessions.task,
    kill: s.actSessions.kill,
    openTask: s.actSessions.openTask,
    new: s.actSessions.newSession,
    search: s.actSessions.search,
    group: s.actSessions.group,
  }), [actions, s])

  const asideList = useMemo(() => asideRows({
    actions,
    actionWords: {
      attach: s.actSessions.attach, resume: s.actSessions.resume, rename: s.actSessions.rename,
      note: s.actSessions.note, task: s.actSessions.task, kill: s.actSessions.kill,
      openTask: s.actSessions.openTask, new: s.actSessions.newSession,
      search: s.actSessions.search, group: s.actSessions.group,
    },
    grouping,
    groupWords: s.sessionsGroupings,
    toggles: { closed: showClosed, exited: showExited, unfiled: !hideEmptyTask },
    toggleWords: {
      closed: s.toggleClosed, exited: s.toggleExited, unfiled: s.toggleUnfiled,
    },
    headings: { actions: s.asideActions, view: s.asideView, show: s.asideShow },
    showUnfiled: grouping === 'task',
    tasks: {
      // Counted over the WHOLE fleet: the count is what says a task has work in it, and counting
      // after the filters would report the number the filter left.
      counts: taskCounts(fleet?.sessions ?? []),
      active: taskFilter,
      heading: s.asideTasks,
      allLabel: s.asideAllTasks,
    },
  }), [actions, grouping, showClosed, showExited, hideEmptyTask, taskFilter, fleet?.sessions, s])

  const asidePicks = useMemo(() => asideSelectable(asideList), [asideList])
  const asideAt = asidePicks.length === 0 ? -1 : Math.min(asideIndex, asidePicks.length - 1)
  const asideRow = asideAt < 0 ? -1 : asidePicks[asideAt]!

  const asideLabel = useMemo(
    () => asideList.reduce((n, r) => Math.max(n, 'label' in r ? r.label.length + 2 : 0), 0),
    [asideList],
  )
  const cockpit = sessionsCockpit({
    width,
    height,
    asideLabel,
    detailWanted: ask ? Math.max(QUESTION_ROWS, detail.length) : detail.length,
  })


  /** Run one verb, whether it arrived from a letter, an arrow key or a click. */
  const runAction = useCallback((a: SessionAction) => {
    if (a === 'new') { if (host.spawnSession) setAsk({ kind: 'new' }); return }
    if (a === 'search') { setAsk({ kind: 'search' }); return }
    // Opens the panel rather than cycling blind. A control that changes something without showing
    // what the options were, or what the current one is, is a control people stop trusting — and
    // the hide-closed and hide-unfiled switches had nowhere to live at all.
    if (a === 'group') { setAsk({ kind: 'view' }); return }
    if (!selected) return
    if (a === 'attach') return actOn('attach')
    if (a === 'resume') { setAsk({ kind: 'resume', session: selected }); return }
    if (a === 'openTask') { setAsk({ kind: 'openTask', session: selected }); return }
    return actOn(a)
  }, [host, grouping, selected])

  const actOn = useCallback((kind: Ask['kind'] | 'attach') => {
    if (!selected) return
    if (!selected.actionable) {
      void run(async () => ({ ok: false, message: s.sessionsNotActionable }))
      return
    }
    if (kind === 'attach') {
      const attach = host.attachSession
      if (!attach) return
      void (async () => {
        const ticket = await attach.call(host, selected.id)
        // The screen never execs anything: it reports the intent, the shell releases the terminal,
        // and `cli-start.ts` hands it over. Coming back is the other half of the same gesture.
        if (ticket) onExit({ kind: 'attach', ticket })
      })()
      return
    }
    setAsk({ kind, session: selected })
  }, [selected, host, run, onExit, s])

  /** Run whatever an aside row means — the same path a key and a click both take. */
  const runAside = useCallback((index: number) => {
    const row = asideList[index]
    if (!row) return
    if (row.kind === 'action') { if (row.enabled) runAction(row.action); return }
    if (row.kind === 'group') { setGrouping(row.value); setCursor(0); return }
    if (row.kind === 'task') { setTaskFilter(row.name || null); setCursor(0); return }
    if (row.kind !== 'toggle') return
    setCursor(0)
    if (row.toggle === 'closed') return setShowClosed(v => !v)
    if (row.toggle === 'exited') return setShowExited(v => !v)
    return setHideEmptyTask(v => !v)
  }, [asideList, runAction])

  useInput((input, key) => {
    const nav: NavKey = {
      input,
      upArrow: key.upArrow,
      downArrow: key.downArrow,
      pageUp: key.pageUp,
      pageDown: key.pageDown,
      home: key.home,
      end: key.end,
      shift: key.shift,
    }

    // `tab` moves between the list and the MENU, which is what makes every verb and every switch
    // reachable without knowing a single letter. The menu is a real pane, so it keeps its own
    // cursor while the list keeps its selection.
    if (key.tab) {
      if (cockpit.aside > 0) setFocus(f => (f === 'list' ? 'aside' : 'list'))
      else setActionsFocused(f => !f)
      return
    }

    if (focus === 'aside' && cockpit.aside > 0) {
      if (key.escape) { setFocus('list'); return }
      if (key.return) return runAside(asideRow)
      if (key.upArrow || input === 'k') return setAsideIndex(Math.max(0, asideAt - 1))
      if (key.downArrow || input === 'j') return setAsideIndex(Math.min(asidePicks.length - 1, asideAt + 1))
      return
    }

    if (actionsFocused) {
      if (key.escape) { setActionsFocused(false); return }
      if (key.return) return runAction(actions[at2]?.action ?? 'new')
      if (key.leftArrow) return setActionIndex(Math.max(0, liveAt - 1))
      if (key.rightArrow) return setActionIndex(Math.min(liveActions.length - 1, liveAt + 1))
      return
    }

    // `enter` on a session opens its MANAGEMENT rather than attaching to it.
    //
    // Attaching is the most drastic thing this screen does — it hands the whole terminal away — and
    // making it the default answer to "I want to look at this" meant there was no way to reach the
    // other verbs without already knowing where they were. Now enter moves to the menu, with the
    // cursor on the first verb this row can take; attaching is the verb at the top of it.
    if (key.return) {
      if (cockpit.aside > 0 && selected) {
        setFocus('aside')
        setAsideIndex(0)
        return
      }
      // No menu to move to on a narrow terminal, so enter keeps its old meaning there.
      return runAction(actions[liveActions[0] ?? 0]?.action ?? 'new')
    }
    if (input === 'v') return runAction('group')
    if (input === 'c') { setShowClosed(v => !v); setCursor(0); return }
    if (input === 'e') { setShowExited(v => !v); setCursor(0); return }
    if (input === 'u' && grouping === 'task') { setHideEmptyTask(v => !v); setCursor(0); return }
    if (input === 'a') return runAction('new')
    // Attaching has its OWN key because `enter` deliberately does not do it any more: enter opens
    // the menu, which is what made every other verb reachable, and the cost of that was three
    // keystrokes for the thing this screen is most often opened to do.
    if (input === 'o') return runAction('attach')
    if (input === '/') return runAction('search')
    // `k` is deliberately NOT the kill key — it is `up` in this list, and a key that moves the
    // cursor on one screen and destroys work on another is the shape of a real accident.
    if (input === 'x') return runAction('kill')
    if (input === 'n') return runAction('rename')
    if (input === 't') return runAction('note')

    if (selectable.length > 0) {
      const next = resolveListKey(nav, Math.max(0, at), selectable.length)
      if (next !== at) setCursor(next)
    }
  }, { isActive: isActive && ask === null })

  /**
   * Apply what the host remembered, ONCE, when it arrives.
   *
   * `useState(view?.…)` alone is not enough: the status is null on the first render and the stored
   * arrangement lands a moment later, so the initial value is always the default. Guarded by a ref
   * so this can never fight a change the user makes afterwards.
   */
  const restored = useRef(false)
  useEffect(() => {
    if (restored.current || !view) return
    restored.current = true
    setGrouping(view.grouping)
    setShowClosed(view.showClosed)
    setShowExited(view.showExited)
    setHideEmptyTask(!view.showUnfiled)
  }, [view])

  // Written whenever any part of the arrangement moves, rather than at each call site: four setters
  // that each had to remember to persist is four places for one to be forgotten. It waits for the
  // restore, so the defaults of a first render never overwrite what was stored.
  useEffect(() => {
    if (!restored.current && view) return
    onView({ grouping, showClosed, showExited, showUnfiled: !hideEmptyTask })
  }, [grouping, showClosed, showExited, hideEmptyTask, onView, view])

  useEffect(() => {
    if (!isActive) return
    // While a question is open the global keys stand down and the footer says only what works —
    // a hint for a key that does nothing is the one bug this footer exists to prevent.
    onChrome(ask
      ? { capture: true, hints: [s.keyBack] }
      : focus === 'aside' && cockpit.aside > 0
        // The menu is a vertical list, so it answers ↑↓ and enter — and `esc` is the way back to the
        // sessions. A hint for a key that does nothing here is the one bug this footer prevents.
        ? { capture: false, claimArrows: true, hints: [s.keyQuit, s.keyMove, s.keyRun, s.keyBack, s.keyTabsAlt] }
      : actionsFocused
        // While the action row has the keyboard it is a horizontal list, so it claims the arrows —
        // and the footer stops saying they change screen for exactly as long as that is true.
        ? { capture: false, claimArrows: true, hints: [s.keyQuit, s.keyActionMove, s.keyRun, s.keyBack, s.keyTabsAlt] }
        : {
            // The LIST claims the arrows too, which is the whole reason `[`/`]` exist. `←`/`→` had
            // no meaning inside this screen and every meaning outside it, so reading down a list
            // and overshooting by one row left the screen entirely — the cursor keys of the thing
            // you are reading must not also be the way out of it.
            capture: false,
            claimArrows: true,
            hints: [
              s.keyQuit, s.keyTabsAlt, s.keySessionsActions, s.keySessionsAttach, s.keyMove,
              s.keySessionsSearch, s.keySessionsNew, s.keySessionsGroup, s.keySessionsClosed,
              ...(grouping === 'task' ? [s.keySessionsNoTask] : []),
            ],
          })
  }, [isActive, onChrome, s, ask, actionsFocused, focus, cockpit.aside, grouping])

  usePointer(p => {
    const wheel = wheelDelta(p.button)
    if (wheel !== 0) {
      if (selectable.length === 0) return
      const next = Math.min(Math.max(0, Math.max(0, at) + wheel), selectable.length - 1)
      return setCursor(next)
    }
    if (!isActivation(p)) return

    // The MENU is the left column of the band. Answered FIRST, because every hit test below is
    // written in the list's coordinates — and the menu was not answering the mouse at all, which
    // for a menu built to be clicked is the whole of it not working.
    if (cockpit.aside > 0 && p.x < cockpit.aside && p.y < cockpit.band) {
      const asideOffset = windowOffset(Math.max(0, asideRow), asideList.length, cockpit.band)
      const index = asideOffset + p.y
      const row = asideList[index]
      if (!row || row.kind === 'heading' || row.kind === 'rule') return
      if (row.kind === 'action' && !row.enabled) return
      setFocus('aside')
      setAsideIndex(Math.max(0, asidePicks.indexOf(index)))
      runAside(index)
      return
    }
    // The divider column belongs to neither pane; a click on it is a click on nothing.
    if (cockpit.aside > 0 && p.x === cockpit.aside) return

    // The summary row states what is being shown; the controls live in the view panel, which a
    // click on that row opens. One place to change these, rather than two that can disagree.
    if (layout.summary && p.y === 0) { setAsk({ kind: 'view' }); return }

    // The action row is the LAST row this screen draws. Resolved against the very same fit the row
    // was rendered from, so a click and the drawn cells can never disagree.
    if (actionRows > 0 && p.y === layout.list + (layout.summary ? 1 : 0)) {
      const fit = fitActionRow(actionWords, at2, width)
      const hit = actionAtColumn(fit, p.x)
      // A click on a DIM verb does nothing at all: the row keeps its shape so the menu is legible,
      // not so that unavailable things can be pressed.
      if (hit !== null && actions[hit]?.enabled) {
        setActionsFocused(true)
        setActionIndex(liveActions.indexOf(hit))
        runAction(actions[hit]!.action)
      }
      return
    }

    // The list starts under the summary row; a click anywhere else on the screen is a click on
    // nothing, which is not an error to report.
    const listTop = layout.summary ? 1 : 0
    const row = offset + (p.y - listTop)
    if (p.y < listTop || row < 0 || row >= rows.length) return
    const found = selectable.indexOf(row)
    if (found >= 0) setCursor(found)
  }, { isActive })

  const offset = windowOffset(at < 0 ? 0 : selectable[at]!, rows.length, layout.list)
  const visible = rows.slice(offset, offset + layout.list)

  // Measured across the rows ON SCREEN, so the state, harness and directory columns line up. A
  // single long title thirty rows down must not narrow every visible row to pay for something
  // nobody can see.
  const columns = useMemo(
    () => sessionColumns(
      visible.flatMap(r => (r.kind === 'session' ? [r.session] : [])),
      cockpit.list,
    ),
    [visible, cockpit.list],
  )

  // The wizard takes the WHOLE screen rather than the detail strip: it is six questions with a
  // search field in the middle, and squeezing that under a list would give the one control that
  // decides where work happens three rows to show its results in.
  if (ask?.kind === 'view') {
    return (
      <Box flexDirection="column" width={width} flexShrink={0}>
        <ViewOptions
          strings={s}
          grouping={grouping}
          showClosed={showClosed}
          hideEmptyTask={hideEmptyTask}
          width={width}
          height={height}
          isActive={isActive}
          onGrouping={g => { setGrouping(g); setCursor(0) }}
          onShowClosed={v => { setShowClosed(v); setCursor(0) }}
          onHideEmptyTask={v => { setHideEmptyTask(v); setCursor(0) }}
          onClose={() => setAsk(null)}
        />
      </Box>
    )
  }

  if (ask?.kind === 'new') {
    return (
      <Box flexDirection="column" width={width} flexShrink={0}>
        <SessionWizard
          host={host}
          strings={s}
          width={width}
          height={height}
          isActive={isActive}
          onCancel={() => setAsk(null)}
          onDone={result => {
            setAsk(null)
            // A successful ATTACHED start is the same handover `enter` performs — the screen reports
            // the intent and the shell releases the terminal.
            if (result.ok && result.ticket) return onExit({ kind: 'attach', ticket: result.ticket })
            void run(async () => ({ ok: result.ok, message: result.message })).then(onRefreshFleet)
          }}
        />
      </Box>
    )
  }

  // `flexShrink={0}`: the budget above is this screen's contract with the pane around it, and a Box
  // that shrinks would spend the same rows again on Yoga's terms.
  const listWidth = cockpit.list

  return (
    <Box flexDirection="column" width={width} flexShrink={0}>
      {/* The BAND: the menu beside the list. Everything this screen can do is on the left, visible,
          navigable and clickable — which is the whole point of it existing. */}
      <Box flexDirection="row" width={width} flexShrink={0}>
      {cockpit.aside > 0 ? (
        <>
          <AsideMenu
            rows={asideList}
            cursor={asideRow}
            focused={focus === 'aside'}
            width={cockpit.aside}
            height={cockpit.band}
            // Slicing from zero would leave the view switches below the fold on a short terminal —
            // invisible, and still the thing `enter` would act on.
            offset={windowOffset(Math.max(0, asideRow), asideList.length, cockpit.band)}
            allTasksLabel={s.asideAllTasks}
          />
          <Box flexDirection="column" width={1} flexShrink={0}>
            {Array.from({ length: cockpit.band }, (_, i) => (
              <Text key={i} dimColor>│</Text>
            ))}
          </Box>
        </>
      ) : null}

      <Box flexDirection="column" width={listWidth} flexShrink={0}>
      {layout.summary ? (
        <SummaryRow
          fleet={fleet}
          grouping={grouping}
          strings={s}
          width={listWidth}
          showClosed={showClosed}
          hideEmptyTask={grouping === 'task' ? hideEmptyTask : null}
        />
      ) : null}

      {fleet === undefined ? (
        <Text dimColor>{s.sessionsUnsupported}</Text>
      ) : fleet === null ? (
        <Text dimColor>{s.sessionsLoading}</Text>
      ) : rows.length === 0 ? (
        // An empty fleet is only ever reported as empty when the poll actually worked. When it did
        // not, the host's own sentence is what the summary row is already showing.
        <Text dimColor>{fleet.unavailable ? '' : s.sessionsEmpty}</Text>
      ) : (
        // NO fixed height: the rows pack upward so the action row and the detail pane sit directly
        // under the list. Padding this region to the full budget put them at the BOTTOM of a tall
        // screen — on a tablet that is thirty blank rows between a five-row list and its controls,
        // and it reads as the controls having disappeared. The leftover space belongs at the very
        // bottom of the frame, where nobody is looking for anything.
        <Box flexDirection="column" flexShrink={0}>
          {visible.map((row, i) => {
            const index = offset + i
            if (row.kind === 'spacer') return <Text key={`s${index}`}> </Text>
            if (row.kind === 'heading') {
              // A heading is drawn as a HEADING: accented, bold, with a rule running out to the
              // edge. Dim grey at the same weight as its rows is not a hierarchy — it is a list that
              // happens to be sorted, which is what this screen was.
              const head = `${row.label}  ${row.count}`
              const rule = Math.max(0, listWidth - head.length - 3)
              return (
                <Text key={`h${index}`} wrap="truncate">
                  <Text color={row.muted ? COLORS.muted : COLORS.secondary} bold={!row.muted}>
                    {truncate(head, listWidth)}
                  </Text>
                  <Text dimColor>{rule > 0 ? `  ${'─'.repeat(rule)}` : ''}</Text>
                </Text>
              )
            }
            return (
              <SessionRowView
                key={row.session.id}
                session={row.session}
                selected={selected?.id === row.session.id}
                columns={columns}
                width={listWidth}
              />
            )
          })}
        </Box>
      )}
      </Box>
      </Box>

      {/* The action row stays as the KEYBOARD path for a narrow terminal that has no menu, and as a
          familiar horizontal echo of it where there is one. It is drawn full width, under the band,
          because it acts on the selection rather than on either pane. */}
      {actionRows > 0 && cockpit.aside === 0 ? (
        <>
          {height >= 12 ? <Text> </Text> : null}
          <SessionActionRow
            labels={actionWords}
            actions={actions}
            selected={at2}
            focused={actionsFocused}
            width={width}
          />
        </>
      ) : null}

      {ask ? (
        <>
          <Divider width={width} />
          <Question
            ask={ask as Exclude<Ask, { kind: 'new' } | { kind: 'view' }>}
            strings={s}
            width={width}
            onClose={() => setAsk(null)}
            onRun={(fn, label) => {
              setAsk(null)
              void run(fn, label).then(onRefreshFleet)
            }}
            host={host}
            query={query}
            onQuery={setQuery}
            fleet={fleet}
          />
        </>
      ) : layout.detail > 0 && detail.length > 0 ? (
        <>
          <Divider width={width} />
          <Detail lines={detail} width={width} rows={layout.detail - 1} />
        </>
      ) : null}
    </Box>
  )
}

/**
 * How many, and how many of them are waiting — plus the dimension the list is grouped by.
 *
 * The waiting count is stated here as well as in the header because this is the screen a user is
 * looking at when they act on it, and a number they have to look away to read is a number they stop
 * trusting.
 */
/**
 * How many, how many are waiting — and the grouping, as a row of CELLS rather than a corner label.
 *
 * The dimension used to be a word in the corner cycled by a hidden `v`, which is the shape of a
 * control nobody finds: the screen said `GROUP task` without ever saying that was a thing you could
 * change, let alone how. Now every dimension is on screen, the current one is underlined, and
 * clicking one selects it — the same selector idiom the Logs screen uses for its sources, measured
 * by the same pure fit so a click and the drawn cells can never disagree.
 */
/**
 * What the list is showing right now, in words — and nothing you can press.
 *
 * It used to be a control strip: the grouping as clickable cells, the two visibility switches as
 * corner labels. That crammed three controls and two counts into one row, and the switches were
 * neither findable nor obviously switches. The controls moved to the view panel; this row's job is
 * to state the answer, so a glance tells you why the list looks the way it does.
 */
function SummaryRow({ fleet, grouping, strings: s, width, showClosed, hideEmptyTask }: {
  fleet: ControlSessions | null | undefined
  grouping: SessionGrouping
  strings: ControlStrings
  width: number
  showClosed: boolean
  /** `null` when the setting does not apply — grouping by anything but task. */
  hideEmptyTask: boolean | null
}) {
  if (fleet?.unavailable) {
    return <Text color={COLORS.accent} wrap="truncate">{truncate(fleet.unavailable, width)}</Text>
  }
  const waiting = fleet?.attention ?? 0

  // Only the filters that are actually HIDING something are named. A row that lists every setting
  // at its default is noise; one that names what is being withheld is an explanation.
  const hiding: string[] = []
  if (!showClosed) hiding.push(s.viewClosedOn)
  if (hideEmptyTask) hiding.push(s.viewUnfiledOn)

  // MEASURED, never left to Yoga: a row that wraps takes two of the screen's rows while its budget
  // counted one, and everything below it — the action row, the detail pane, the footer — is pushed
  // off the bottom. That failure reads as "the whole screen vanished", not as "one row is too wide".
  const cells = summaryCells({
    group: `${s.sessionsGroupBy} ${s.sessionsGroupings[grouping]}`,
    hiding: hiding.length > 0 ? `− ${hiding.join(', ')}` : '',
    count: s.sessionsCount(fleet?.sessions.length ?? 0),
    waiting: waiting > 0 ? s.sessionsWaitingCount(waiting) : '',
    width,
  })

  return (
    <Box flexDirection="row" width={width} justifyContent="space-between" flexShrink={0}>
      <Text wrap="truncate">
        <Text dimColor>{`${s.sessionsGroupBy} `}</Text>
        <Text bold>{cells.group.slice(s.sessionsGroupBy.length + 1)}</Text>
        {cells.hiding ? <Text dimColor>{`   ${cells.hiding}`}</Text> : null}
      </Text>
      <Text wrap="truncate">
        <Text dimColor>{cells.count}</Text>
        {cells.waiting ? (
          <Text color={COLORS.accent} bold>{`   ${cells.waiting}`}</Text>
        ) : null}
      </Text>
    </Box>
  )
}

function SessionRowView({ session, selected, columns, width }: {
  session: ControlSession
  selected: boolean
  columns: SessionColumns
  width: number
}) {
  // `harness` is a plain string here because it can be EMPTY — a session the registry has
  // forgotten runs a harness nobody recorded. An empty one simply gets no colour.
  const harnessColor = harnessColorOf(session.harness)
  const gap = '  '

  return (
    <Text wrap="truncate">
      <Text color={selected ? COLORS.accent : undefined}>{selected ? '❯ ' : '  '}</Text>
      {/* Colour AND word, always paired — and PADDED, so every title starts in the same column.
          Two spaces between unpadded cells is what made this read as a jumble of words: the state
          words differ by ten characters, so nothing after them ever lined up. */}
      <Text color={STATE_COLOR[session.state]} bold={session.state === 'waiting-approval'}>
        {padCell(session.stateLabel, columns.state)}
      </Text>
      {columns.title > 0 ? (
        <Text color={selected ? COLORS.accent : undefined} bold={selected}>
          {gap + padCell(session.title, columns.title)}
        </Text>
      ) : null}
      {/* Usage sits right of the name and left of the harness — it is a number about THIS row, and
          a row you are deciding whether to close is one whose cost you want beside its name rather
          than one selection away in the detail pane. */}
      {columns.metrics > 0 ? (
        <Text color={COLORS.secondary}>{gap + padCell(sessionMetric(session), columns.metrics)}</Text>
      ) : null}
      {columns.harness > 0 ? (
        <Text color={harnessColor}>{gap + padCell(session.harness, columns.harness)}</Text>
      ) : null}
      {columns.where > 0 ? (
        <Text dimColor>{gap + padCell(session.project, columns.where)}</Text>
      ) : null}
    </Text>
  )
}

/** The harness palette, safe for the empty harness an unregistered session carries. */
function harnessColorOf(harness: string): string | undefined {
  return (HARNESS_COLOR as Record<string, string | undefined>)[harness]
}

/**
 * The facts, cut from the bottom to the rows this pane was given.
 *
 * The lines themselves are decided by the pure `detailLines`, because the LAYOUT needs their count
 * before anything is drawn — see `sessionsLayout`.
 */
function Detail({ lines, width, rows }: {
  lines: readonly DetailLine[]
  width: number
  rows: number
}) {
  const labelWidth = Math.max(...lines.map(l => l.label.length), 0)

  return (
    <Box flexDirection="column">
      {lines.slice(0, Math.max(0, rows)).map(l => (
        <Text key={l.key} wrap="truncate" dimColor={l.note}>
          {l.label ? <Text dimColor>{l.label.padEnd(labelWidth)}  </Text> : <Text>{' '.repeat(labelWidth + 2)}</Text>}
          {/* What the assistant said is drawn in the text colour: it is the content, and everything
              else on this pane is a label for it. */}
          <Text color={l.say ? COLORS.text : undefined}>
            {truncate(l.value, Math.max(1, width - labelWidth - 2))}
          </Text>
        </Text>
      ))}
    </Box>
  )
}

/**
 * The three questions this screen asks, drawn where the detail pane was.
 *
 * In place of the facts rather than over them: a modal floating above a list is a second thing to
 * read at the moment the user is deciding, and the row being acted on is still visible above.
 */
/**
 * The questions this screen asks, drawn where the detail pane was.
 *
 * In place of the facts rather than over them: a modal floating above a list is a second thing to
 * read at the moment the user is deciding, and the row being acted on stays visible above.
 */
function Question({ ask, strings: s, width, onClose, onRun, host, query, onQuery, fleet }: {
  /** Never `new` — the wizard takes the whole screen and is rendered before this is reached. */
  ask: Exclude<Ask, { kind: 'new' } | { kind: 'view' }>
  strings: ControlStrings
  width: number
  onClose: () => void
  onRun: (fn: () => Promise<ActionResult>, label?: string) => void
  host: ControlHost
  query: string
  onQuery: (q: string) => void
  /** Needed to say how many sessions a task actually has — the confirmation used to say zero. */
  fleet: ControlSessions | null | undefined
}) {
  if (ask.kind === 'search') {
    return (
      <Box flexDirection="column" width={width}>
      <Text dimColor>{truncate(s.promptHint, width)}</Text>
      <TextPrompt
        label={s.sessionsSearchLabel}
        defaultValue={query}
        width={width}
        onCancel={onClose}
        // Applied on submit rather than per keystroke: the list under it is re-grouped and re-sorted
        // on every change, and a cursor that jumps while someone is still typing is unusable.
        onSubmit={value => { onQuery(value.trim()); onClose() }}
      />
      </Box>
    )
  }

  const { session } = ask

  if (ask.kind === 'kill') {
    return (
      <ConfirmPrompt
        label={s.sessionsKillConfirm(session.title)}
        yesLabel={s.yes}
        noLabel={s.no}
        width={width}
        onCancel={onClose}
        onAnswer={(yes: boolean) => {
          if (!yes) return onClose()
          const kill = host.killSession
          if (!kill) return onClose()
          onRun(() => kill.call(host, session.id), s.actSessions.kill)
        }}
      />
    )
  }

  if (ask.kind === 'resume') {
    const target = session.resume
    return (
      <ConfirmPrompt
        // The conversation's OWN title is in the question, which is what lets the person — who knows
        // what they were doing — judge whether it is the right one. No heuristic here could.
        label={`${s.sessionsResumeConfirm(target?.title ?? session.title)}${
          session.state === 'unknown' ? ` ${s.sessionsResumeRunning}` : ''}`}
        yesLabel={s.yes}
        noLabel={s.no}
        width={width}
        onCancel={onClose}
        onAnswer={(yes: boolean) => {
          const resume = host.resumeSession
          if (!yes || !target || !resume) return onClose()
          onRun(() => resume.call(host, {
            sessionId: target.sessionId,
            harness: session.harness,
            cwd: session.cwd,
            label: target.title,
            attach: false,
          }).then(r => ({ ok: r.ok, message: r.message })), s.actSessions.resume)
        }}
      />
    )
  }

  if (ask.kind === 'openTask') {
    const task = session.task ?? ''
    // Counted from the fleet rather than passed as a literal `0`, which is what it was — the
    // question offered to reopen "all 0 sessions" of a task that plainly had some, which is the
    // kind of number that makes a person stop trusting every other number on the screen.
    const count = (fleet?.sessions ?? []).filter(v => v.task === task).length
    return (
      <ConfirmPrompt
        label={s.sessionsOpenTaskConfirm(task, count)}
        yesLabel={s.yes}
        noLabel={s.no}
        width={width}
        onCancel={onClose}
        onAnswer={(yes: boolean) => {
          const open = host.openTask
          if (!yes || !open) return onClose()
          onRun(() => open.call(host, task), s.actSessions.openTask)
        }}
      />
    )
  }

  const isRename = ask.kind === 'rename'
  const isTask = ask.kind === 'task'

  if (isTask) {
    return (
      <TaskChoice
        host={host}
        strings={s}
        current={session.task ?? ''}
        width={width}
        onCancel={onClose}
        onPick={value => {
          const fn = host.taskSession
          if (!fn) return onClose()
          onRun(() => fn.call(host, session.id, value.trim()), s.actSessions.task)
        }}
      />
    )
  }

  return (
    <Box flexDirection="column" width={width}>
    <Text dimColor>{truncate(s.promptHint, width)}</Text>
    <TextPrompt
      label={isRename ? s.sessionsRenamePrompt : s.sessionsNotePrompt}
      // The current value is offered as the default, so `enter` on an unchanged field is a no-op
      // rather than a way to accidentally blank a name.
      defaultValue={(isRename ? session.title : session.note) ?? ''}
      width={width}
      onCancel={onClose}
      onSubmit={value => {
        const text = value.trim()
        const fn = isRename ? host.renameSession : host.noteSession
        if (!fn || !text) return onClose()
        onRun(
          () => fn.call(host, session.id, text),
          isRename ? s.actSessions.rename : s.actSessions.note,
        )
      }}
    />
    </Box>
  )
}

/**
 * Everything about WHAT the list shows, as ONE vertical panel.
 *
 * It replaced a cramped horizontal strip that cycled the grouping on a hidden key and had nowhere
 * to put the two visibility switches — so they were a corner label people did not find, changed by
 * a letter nobody was told about. A vertical list is navigable with two keys, states every option
 * AND the one in force, and has room to say what each does.
 *
 * Rendered where the whole screen is, like the wizard: this is a decision, not an annotation, and
 * squeezing it under the list is what made it unreadable the first time.
 */
function ViewOptions({
  strings: s, grouping, showClosed, hideEmptyTask, width, height, isActive,
  onGrouping, onShowClosed, onHideEmptyTask, onClose,
}: {
  strings: ControlStrings
  grouping: SessionGrouping
  showClosed: boolean
  hideEmptyTask: boolean
  width: number
  height: number
  isActive: boolean
  onGrouping: (g: SessionGrouping) => void
  onShowClosed: (v: boolean) => void
  onHideEmptyTask: (v: boolean) => void
  onClose: () => void
}) {
  // One flat list of rows so the cursor moves over exactly what is drawn — the same reason the
  // fleet list flattens its groups.
  type Row =
    | { kind: 'heading'; label: string }
    | { kind: 'group'; value: SessionGrouping }
    | { kind: 'closed' }
    | { kind: 'unfiled' }

  const rows: Row[] = [
    { kind: 'heading', label: s.viewGroupBy },
    ...GROUPINGS.map(g => ({ kind: 'group' as const, value: g })),
    { kind: 'heading', label: s.viewShow },
    { kind: 'closed' },
    // Only meaningful while grouping by task, so it is ABSENT otherwise rather than inert.
    ...(grouping === 'task' ? [{ kind: 'unfiled' as const }] : []),
  ]
  const selectable = rows.map((r, i) => (r.kind === 'heading' ? -1 : i)).filter(i => i >= 0)

  const [index, setIndex] = useState(0)
  const at = Math.min(index, Math.max(0, selectable.length - 1))
  const cursorRow = selectable[at] ?? 0

  useInput((input, key) => {
    if (key.escape) return onClose()
    if (key.upArrow || input === 'k') return setIndex(Math.max(0, at - 1))
    if (key.downArrow || input === 'j') return setIndex(Math.min(selectable.length - 1, at + 1))
    if (!key.return) return
    const row = rows[cursorRow]
    if (!row) return
    if (row.kind === 'group') return onGrouping(row.value)
    if (row.kind === 'closed') return onShowClosed(!showClosed)
    if (row.kind === 'unfiled') return onHideEmptyTask(!hideEmptyTask)
  }, { isActive })

  const body = Math.max(1, height - 2)

  return (
    <Box flexDirection="column" width={width} flexShrink={0}>
      <Text bold>{truncate(s.viewTitle, width)}</Text>
      <Text dimColor>{truncate(s.viewHint, width)}</Text>
      {rows.slice(0, body).map((row, i) => {
        if (row.kind === 'heading') {
          return <Text key={`h${i}`} dimColor bold>{truncate(row.label, width)}</Text>
        }
        const active = i === cursorRow
        // Every row states BOTH what it is and whether it is on. A list of options that shows only
        // the cursor makes you press things to find out what they already were.
        // The dot means SHOWN, always — for every row on this panel. It read the other way round
        // for the unfiled toggle, whose state is stored as "hidden": a filled dot beside "sessions
        // with no task" said they were visible while they were the one thing being withheld.
        const on = row.kind === 'group'
          ? row.value === grouping
          : row.kind === 'closed' ? showClosed : !hideEmptyTask
        const label = row.kind === 'group'
          ? s.sessionsGroupings[row.value]
          : row.kind === 'closed' ? s.viewClosedOn
          : s.viewUnfiledOn
        return (
          <Text key={`r${i}`} wrap="truncate">
            <Text color={active ? COLORS.accent : undefined}>{active ? '  ❯ ' : '    '}</Text>
            {/* Glyph plus word: which options are on must survive a terminal that drops colour. */}
            <Text color={on ? COLORS.success : COLORS.muted}>{on ? '● ' : '○ '}</Text>
            <Text color={active ? COLORS.accent : undefined} bold={active}>
              {truncate(label, Math.max(1, width - 8))}
            </Text>
          </Text>
        )
      })}
    </Box>
  )
}

/**
 * The verbs, all of them, with the ones this row cannot take drawn dim.
 *
 * A local row rather than the shared `ActionRow`: that one takes plain labels and cannot say that a
 * cell is unavailable, and the services cockpit it was written for has no such state. The FIT is
 * still the shared, tested one, so what is drawn and what a click resolves against are the same
 * measurement.
 */
function SessionActionRow({ labels, actions, selected, focused, width }: {
  labels: string[]
  actions: readonly OfferedAction[]
  selected: number
  focused: boolean
  width: number
}) {
  const fit = fitActionRow(labels, selected, width)
  return (
    <Text wrap="truncate">
      <Text dimColor>{fit.less ? '‹ ' : '  '}</Text>
      {fit.labels.map((cell, i) => {
        const index = fit.from + i
        const enabled = actions[index]?.enabled ?? false
        const active = index === selected && focused
        return (
          <Text key={cell} dimColor={!enabled}>
            {i > 0 ? ACTION_SEP : ''}
            {/* Underlined as well as accented, the same way the cockpit marks the verb it would
                run: which cell is selected must survive a flattened palette. */}
            <Text
              color={active ? COLORS.accent : enabled ? undefined : COLORS.muted}
              bold={active}
              underline={active}
            >
              {cell}
            </Text>
          </Text>
        )
      })}
      <Text dimColor>{fit.more ? ' ›' : ''}</Text>
    </Text>
  )
}

/**
 * Filing a session under a task: pick one that exists, or type a new one.
 *
 * A pick rather than a spelling test. A task is a free string, so typing "auth-refactor" a second
 * time as "auth refactor" makes two tasks that look like one and group like two — offering what
 * already exists is what prevents that, and typing still creates a new one when that is what you
 * mean. The list narrows as you type, so a machine with twenty tasks is still one field away.
 */
function TaskChoice({ host, strings: s, current, width, onCancel, onPick }: {
  host: ControlHost
  strings: ControlStrings
  current: string
  width: number
  onCancel: () => void
  onPick: (value: string) => void
}) {
  const [tasks, setTasks] = useState<string[] | null>(null)
  const [typed, setTyped] = useState('')
  const [index, setIndex] = useState(0)

  useEffect(() => {
    const read = host.sessionTasks
    if (!read) { setTasks([]); return }
    let alive = true
    void read.call(host).then(list => { if (alive) setTasks(list) })
    return () => { alive = false }
  }, [host])

  const matching = useMemo(() => {
    const q = typed.trim().toLowerCase()
    const all = tasks ?? []
    return q ? all.filter(t => t.toLowerCase().includes(q)) : all
  }, [tasks, typed])

  // `''` clears the task, and is offered as a row so removing one is not a hidden gesture.
  const rows = useMemo(() => ['', ...matching], [matching])
  const at = Math.min(index, Math.max(0, rows.length - 1))

  useInput((input, key) => {
    if (key.escape) return onCancel()
    // What is TYPED wins over what is highlighted the moment there is any: that is how a new task
    // gets created, and it must not require clearing the list first.
    if (key.return) return onPick(typed.trim() || rows[at] || '')
    if (key.backspace || key.delete) { setTyped(v => v.slice(0, -1)); setIndex(0); return }
    if (key.upArrow) return setIndex(Math.max(0, at - 1))
    if (key.downArrow) return setIndex(Math.min(rows.length - 1, at + 1))
    if (key.ctrl || key.meta || key.tab) return
    const printable = [...input].filter(ch => ch >= ' ' && ch !== '\x7f').join('')
    if (printable) { setTyped(v => v + printable); setIndex(0) }
  })

  return (
    <Box flexDirection="column" width={width}>
      <Text bold>{truncate(s.sessionsTaskPrompt, width)}</Text>
      <Text dimColor>{truncate(s.taskHint, width)}</Text>
      <Text>
        <Text dimColor>{'› '}</Text>
        {typed ? <Text>{truncate(typed, Math.max(1, width - 2))}</Text> : <Text dimColor>…</Text>}
      </Text>
      {tasks === null ? (
        <Text dimColor>{s.sessionsLoading}</Text>
      ) : (
        rows.slice(0, 6).map((task, i) => {
          const active = !typed && i === at
          const label = task === '' ? s.taskNone : task
          return (
            <Text key={task || '_none'} wrap="truncate" dimColor={Boolean(typed)}>
              <Text color={active ? COLORS.accent : undefined}>{active ? '❯ ' : '  '}</Text>
              <Text color={active ? COLORS.accent : undefined} bold={active}>
                {truncate(label, Math.max(1, width - 4))}
              </Text>
              {task && task === current ? <Text dimColor>{`  ${s.taskCurrent}`}</Text> : null}
            </Text>
          )
        })
      )}
    </Box>
  )
}

/**
 * The aside menu — everything this screen can do, on the left, visible.
 *
 * It exists because every control here used to be a letter: the grouping cycled on a hidden `v`, the
 * visibility switches were a corner label, and the verbs only appeared once you knew `tab` reached
 * them. A person opening this screen for the first time could see a list of sessions and no way to
 * act on any of them. A menu you can read and click is not a nicety here.
 *
 * Every row states its own state — a filled dot for a grouping in force or a switch that is on —
 * because a menu that shows only a cursor makes you press things to find out what they already were.
 */
function AsideMenu({ rows, cursor, focused, width, height, offset, allTasksLabel }: {
  rows: readonly AsideRow[]
  /** Index into `rows` of the row under the cursor, or `-1`. */
  cursor: number
  focused: boolean
  width: number
  height: number
  offset: number
  /** What the "every task" row is called — localized chrome the menu does not own. */
  allTasksLabel: string
}) {
  const inner = Math.max(1, width - 2)
  return (
    <Box flexDirection="column" width={width} flexShrink={0}>
      {rows.slice(offset, offset + height).map((row, at) => {
        const i = offset + at
        if (row.kind === 'rule') {
          return <Text key={`r${i}`} dimColor>{'─'.repeat(inner)}</Text>
        }
        if (row.kind === 'heading') {
          return <Text key={`h${i}`} dimColor bold wrap="truncate">{truncate(row.label, width)}</Text>
        }
        const active = i === cursor && focused
        // An action has no on/off state — a dot beside "Rename" would be claiming something. Only
        // the switches, the grouping and the task scope carry one.
        const dot = row.kind === 'action' ? '  ' : row.on ? '● ' : '○ '
        const enabled = row.kind !== 'action' || row.enabled
        // A task row carries its COUNT, which is what says the task has work in it. The label is
        // truncated around it rather than the count being dropped: a task named at its full length
        // with no number tells you nothing you did not already know from the grouping.
        const count = row.kind === 'task' && row.name ? ` ${row.count}` : ''
        const label = row.kind === 'task' ? (row.name || allTasksLabel) : row.label
        return (
          <Text key={`${row.kind}${i}`} wrap="truncate" dimColor={!enabled}>
            <Text color={active ? COLORS.accent : undefined}>{active ? '❯' : ' '}</Text>
            <Text color={row.kind !== 'action' && row.on ? COLORS.success : COLORS.muted}>{dot}</Text>
            <Text
              color={active ? COLORS.accent : enabled ? undefined : COLORS.muted}
              bold={active}
            >
              {truncate(label, Math.max(1, width - 3 - count.length))}
            </Text>
            {count ? <Text dimColor>{count}</Text> : null}
          </Text>
        )
      })}
    </Box>
  )
}
