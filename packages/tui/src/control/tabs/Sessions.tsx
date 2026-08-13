/**
 * Sessions — the fleet, and the second screen of the control center.
 *
 * The shape is the cockpit's, for the cockpit's reason: the data on this screen RELATES. The list is
 * the selection and the pane under it is a view OF it, so moving the cursor repaints the pane — what
 * the session is doing and, when it owes an explanation, why; its harness, its directory, how long
 * it has been alive and how long since it last did anything; the note left on it. The verbs sit on
 * that pane's floor and act on the row above them.
 *
 * THREE THINGS ARE DELIBERATELY DIFFERENT FROM `Services.tsx`, and each is a behaviour rather than a
 * cosmetic choice:
 *
 *  - **The list is full width and there is no second band pane.** The cockpit's band is the
 *    selection beside the MACHINE's settings; a session has no such neighbour, and half a band
 *    holding nothing is the dead region `cockpitLayout`'s own invariant forbids. The list is also
 *    the pane that most wants the columns: `sessionCells` gives up the DIRECTORY first, and the
 *    directory is what tells four sessions of one repo apart. So `cockpitLayout` is used for its
 *    height arithmetic — the band, the detail region, the reservation a question needs, the
 *    degradation ladder — and both of its columns are spent on the one pane there is.
 *
 *  - **The poll does not stop when the screen is hidden.** Everything else here follows `Logs.tsx`
 *    exactly (an `alive` guard, an interval cleared on unmount), except its `isActive` gate. That
 *    gate is right for a log, which nobody is waiting on; it is wrong for the two things this screen
 *    exists to produce for a user who is looking somewhere else — the header's waiting counter and
 *    the BEL. A bell that only rings while you are staring at the list is not a bell. The screen is
 *    mounted for the whole session (`display: none`, never unmounted), so "mounted" is the honest
 *    gate. It still runs at TWO cadences rather than one — see `POLL_ACTIVE_MS` — because "never
 *    stops" and "always costs the maximum" are different claims, and only the first one is required.
 *    Switching TO the tab still asks again on the spot rather than waiting out the interval.
 *
 *  - **`enter` is ATTACH, not "step into the verbs".** That is the one key a session list has to
 *    spend well, so `tab` is the only way to the action row — which is why `sessionsHints` is told
 *    the pane count and names the key.
 *
 * The screen decides nothing. Every verb is one `host` call performed through the shell's `run`, and
 * the terminal takeover behind `Attach` belongs to the host as well (Task 8): `attachCommand` hands
 * back an argv, and the refusal it can answer with is the one sentence this file words itself.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Box, Text, useInput } from 'ink'
import { truncate } from '../../components/Primitives'
import { DetailBody, SessionLine } from '../Chrome'
import { windowLabel } from '../surface.ts'
import { Pane, paneBody, paneRows } from '../Pane'
import {
  cockpitLayout,
  PANE_MIN_ROWS,
  sessionCells,
  sessionDetailLines,
  sessionName,
  sessionStateTone,
  sessionStateWord,
  sessionsHints,
  SERVICE_MARKER,
  type CockpitContent,
} from '../chrome.ts'
import {
  resolveFocusKey,
  resolveListKey,
  windowOffset,
  type NavKey,
  type SessionsFocus,
} from '../nav'
import { ConfirmPrompt, TextPrompt } from '../Prompt'
// The gate every byte reaches the terminal through while the alternate buffer is live. A BEL written
// with `process.stdout.write` would go through whatever the host has patched over the stream while
// an action runs — captured into a status line, or fed into a pane as text.
import { writeFrame } from '../altScreen'
import type { ControlStrings } from '../i18n'
import type { ActionResult, ControlHost, SessionSnapshot, SessionView } from '../types'
import type { RunAction, TabChrome } from '../ControlCenter'

/**
 * How often the fleet is re-read — five seconds while this tab is on screen, per the spec.
 *
 * It is not free — one tick is `readRegistry()` + a `tmux ls` + a full `/proc` scan
 * (`harnessProcesses()`) + one `capture-pane` per alive session — and the poll runs for the whole
 * life of `agentop`, per the class comment above. Paying the 5s price on the Help tab, the Logs tab
 * or a minimized terminal is the maximum cost for no extra benefit: the header counter and the BEL
 * are still fed correctly by a slower tick, since nothing reads THIS screen's list while it is not
 * the one on screen. So there are two numbers, not one — `isActive` picks between them — and
 * switching TO this tab still asks on the spot rather than waiting out whichever interval was
 * running.
 */
const POLL_ACTIVE_MS = 5000
/** The cadence everywhere else. Six times slower, which is the whole point: still fresh enough that
 *  the counter and the bell notice within half a minute, never as expensive as watching the list. */
const POLL_BACKGROUND_MS = 30000

/**
 * How often the clock ticks.
 *
 * Nothing is fetched on this interval: the ages in the detail pane are computed from stored
 * INSTANTS, so without a tick they would sit frozen between polls while the clock beside them moved.
 * Unlike the poll, this one DOES stop when the screen is hidden — a number nobody can see does not
 * need to be right.
 */
const CLOCK_MS = 1000

/** The terminal bell. Written as a code point so this file stays plain text. */
const BEL = String.fromCharCode(7)

/**
 * THE OVERLAY SEAM — the same one `Services.tsx` has, for the same reason.
 *
 * `cockpit` is the two panes; every other variant is a question, and while one is up it owns the
 * detail region and the keyboard (`capture: true`, which stands the global keys down). `overlayFor`
 * is the only place a `View` becomes something drawn, and no branch of it performs anything.
 */
type View =
  | { kind: 'cockpit' }
  /** Kill is the one irreversible verb here, so it is the one that asks first. */
  | { kind: 'kill'; id: string; name: string }
  | { kind: 'rename'; id: string; current: string }
  | { kind: 'note'; id: string; current: string }

/** One verb on the detail pane's action row. */
interface Action {
  label: string
  run: () => void
}

export interface SessionsProps {
  host: ControlHost
  strings: ControlStrings
  width: number
  height: number
  isActive: boolean
  /** The shell's funnel: spinner, status line, streamed output, post-action refresh. */
  run: RunAction
  onChrome: (chrome: TabChrome) => void
  /**
   * How many sessions are waiting on the user, reported on every snapshot.
   *
   * A CALLBACK OF ITS OWN rather than a field on `ScreenChrome`, deliberately. The shell scopes the
   * chrome report to the screen that is on top (`reports` in `ControlCenter`) — it has to, or a
   * hidden screen's `capture` flag would lock the global keys with no owner left to release it — and
   * this number's whole purpose is to reach a user who is looking at ANOTHER tab. Putting it on the
   * chrome would tie a fact that must survive a tab switch to a message the shell only listens to
   * while this tab is not switched away from.
   */
  onAttention: (count: number) => void
}

export function Sessions({
  host, strings: s, width, height, isActive, run, onChrome, onAttention,
}: SessionsProps) {
  const [view, setView] = useState<View>({ kind: 'cockpit' })
  const [wantFocus, setWantFocus] = useState<SessionsFocus>('list')
  const [actionIndex, setActionIndex] = useState(0)

  /**
   * `null` until the first read lands — which is NOT the same as an empty fleet.
   *
   * The same distinction `SessionSnapshot` exists for, one level up: "nobody has looked yet",
   * "nothing is running" and "nothing could be looked at" are three different sentences, and
   * rendering any of them as another is the confident zero this codebase keeps out of every surface.
   */
  const [snapshot, setSnapshot] = useState<SessionSnapshot | null>(null)
  const [now, setNow] = useState(() => Date.now())

  const views = useMemo(() => snapshot?.views ?? [], [snapshot])

  /**
   * The cursor follows a SESSION, not a row number.
   *
   * The host sorts the fleet attention-first, so a poll five seconds from now can legitimately
   * reorder it — a session that started waiting jumps to the top. A stored index would leave the
   * cursor on whatever slid into that slot, which is the row `x kill` would then act on.
   */
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const selection = Math.max(0, views.findIndex(v => v.id === selectedId))
  const selected: SessionView | undefined = views[selection]

  // Re-seat the cursor whenever it is not pointing at a row that exists — the FIRST snapshot
  // (`selectedId` is still `null`) and a poll that pruned the tracked session are the same case: the
  // fallback to row 0 above already moves `selection` for both, silently, and this is what keeps the
  // rest of the screen from lying about what that fallback means. A stored `actionIndex` surviving
  // the swap is what let a highlighted `Kill` end up highlighted on a session that never asked for
  // it, so it is reset here exactly as `move()` resets it when the USER changes rows — this is the
  // same reset for when the LIST changes out from under them. `wantFocus` is only nudged off the
  // action row, never off `list`, since the row it pointed at is what went missing, not the pane.
  useEffect(() => {
    if (snapshot === null) return
    if (selectedId !== null && views.some(v => v.id === selectedId)) return
    setSelectedId(views[0]?.id ?? null)
    setActionIndex(0)
    setWantFocus(f => (f === 'actions' ? 'list' : f))
  }, [snapshot, views, selectedId])

  const back = useCallback(() => setView({ kind: 'cockpit' }), [])

  // -------------------------------------------------------------------------
  // reading the fleet
  // -------------------------------------------------------------------------

  /**
   * The `alive` guard, as a ref because the poll outlives any one effect run.
   *
   * `host.sessions()` is contracted never to throw, and the `catch` is the belt to that braces: a
   * rejection on a five-second timer would otherwise take the control center down moments after it
   * opened, which is exactly what the contract is written to prevent.
   */
  const alive = useRef(true)
  useEffect(() => () => { alive.current = false }, [])

  const readSessions = useCallback(async () => {
    // The host contracts `host.sessions()` never to throw — a real read failure comes back as
    // `{ views: [], unavailable: ... }`, which is the HONEST empty fleet, not this catch. If it is
    // ever reached anyway, the truthful answer to a transient throw is "we don't know yet", not
    // "there are no sessions": overwriting a good snapshot with an empty one here would render a
    // contract violation as the confident zero this codebase forbids everywhere else. So a throw
    // simply keeps whatever the last honest snapshot was.
    try {
      const next = await host.sessions()
      if (alive.current) setSnapshot(next)
    } catch { /* keep the last snapshot — see above */ }
  }, [host])

  useEffect(() => {
    // One effect, not two. A second effect that also read on mount (to catch `isActive` becoming
    // true on open) cost the app two `/proc` scans and two capture rounds back to back — this one
    // reads on mount AND on every `isActive` transition, because both are the same event: the
    // dependency array re-runs the effect (and its immediate `readSessions()`) exactly when the tab
    // is switched to, and the cadence chosen below already matches which case it is.
    void readSessions()
    const ms = isActive ? POLL_ACTIVE_MS : POLL_BACKGROUND_MS
    const timer = setInterval(() => { void readSessions() }, ms)
    return () => clearInterval(timer)
  }, [readSessions, isActive])

  useEffect(() => {
    if (!isActive) return
    const timer = setInterval(() => setNow(Date.now()), CLOCK_MS)
    return () => clearInterval(timer)
  }, [isActive])

  // -------------------------------------------------------------------------
  // the counter, and the bell
  // -------------------------------------------------------------------------

  const waiting = useMemo(
    () => views.filter(v => v.state === 'waiting-approval' || v.state === 'waiting-input'),
    [views],
  )

  useEffect(() => { onAttention(waiting.length) }, [waiting.length, onAttention])

  /**
   * Which sessions were waiting at the PREVIOUS snapshot, so the bell rings on the transition.
   *
   * `null` is "nothing has been observed yet", and it is the reason the first snapshot only seeds
   * the memory: a transition needs a state to transition FROM, and a session that was already
   * waiting when `agentop` opened is not news — ringing for it would make the app beep every time it
   * starts. Ringing on the SET rather than on the count is the other half: two sessions swapping
   * places (one answered, another one asking) leaves the count at two and is still news.
   *
   * A session in `waiting-approval` or `waiting-input` is always a member. One in `unreadable` KEEPS
   * whatever membership it already had instead of being computed fresh — `unreadable` is not a
   * resolved state, it is the host saying a `capture-pane` failed on this particular tick (a state it
   * models precisely because that happens), so a session that was waiting and is now unreadable has
   * not been OBSERVED to have stopped waiting. Dropping it here and picking it back up next tick is
   * what rang the bell twice for one still-pending session; every other state (working, exited, …)
   * is a genuine observation and does clear it.
   */
  const wasWaiting = useRef<Set<string> | null>(null)

  useEffect(() => {
    if (snapshot === null) return
    const before = wasWaiting.current
    const ids = new Set(
      views
        .filter(v => (
          v.state === 'waiting-approval'
          || v.state === 'waiting-input'
          || (v.state === 'unreadable' && (before?.has(v.id) ?? false))
        ))
        .map(v => v.id),
    )
    wasWaiting.current = ids
    if (before === null) return
    for (const id of ids) {
      if (!before.has(id)) {
        writeFrame(BEL)
        return
      }
    }
  }, [snapshot, views])

  // -------------------------------------------------------------------------
  // the verbs — every one of them a single host call, none of them decided here
  // -------------------------------------------------------------------------

  /** Perform, then put the panes back and re-read the fleet: the row just changed under us. */
  const perform = useCallback((fn: () => Promise<ActionResult>, label: string) => {
    void run(fn, label).then(() => {
      back()
      void readSessions()
    })
  }, [run, back, readSessions])

  /**
   * `enter` on a row — ask the host how to take over this terminal.
   *
   * The HANDOVER is Task 8: it needs the real tty, which it can only have once Ink has been
   * unmounted and the alternate buffer left, and `attachCommand` returns the argv rather than
   * running it for exactly that reason. What this screen owns is the refusal — `null` carries no
   * message of its own (see `sessionNotAttachable`), so the sentence for it is the TUI's — and,
   * until the takeover lands, the argv itself, which is a command the user can genuinely run.
   */
  const attach = useCallback((id: string) => {
    perform(async () => {
      const argv = await host.attachCommand(id).catch(() => null)
      if (!argv) return { ok: false, message: s.sessionNotAttachable }
      return { ok: true, message: argv.join(' ') }
    }, s.actAttach)
  }, [host, perform, s.sessionNotAttachable, s.actAttach])

  /**
   * The verbs for the selected session — read off the ROW's own flags, never branched on its state.
   *
   * A verb that cannot work is ABSENT rather than present and failing, which is the same rule the
   * cockpit follows for a start it cannot perform. So an external process — one this machine only
   * saw in `/proc` — offers nothing at all, and the detail pane above the empty row says why in
   * words rather than leaving the user to guess.
   */
  const actions = useMemo<Action[]>(() => {
    if (!selected) return []
    const out: Action[] = []
    const id = selected.id

    if (selected.attachable) out.push({ label: s.actAttach, run: () => attach(id) })
    // `managed` is the registry entry: renaming and annotating patch it, and a process agentop does
    // not host has none to patch. Separate from `killable` on purpose — an EXITED session still has
    // an entry to label and a slot to clear.
    if (selected.managed) {
      out.push({ label: s.actRename, run: () => setView({ kind: 'rename', id, current: selected.label }) })
      out.push({ label: s.actNote, run: () => setView({ kind: 'note', id, current: selected.note }) })
    }
    if (selected.killable) {
      out.push({ label: s.actKill, run: () => setView({ kind: 'kill', id, name: sessionName(selected) }) })
    }
    return out
  }, [selected, s, attach])

  // -------------------------------------------------------------------------
  // geometry — measured from the rows about to be drawn, never guessed
  // -------------------------------------------------------------------------

  const detail = useMemo(
    () => (selected ? sessionDetailLines(selected, s, now) : null),
    [selected, s, now],
  )

  const capturing = view.kind !== 'cockpit'

  const content: CockpitContent = useMemo(() => {
    const widest = (pick: (v: SessionView) => string) =>
      views.reduce((n, v) => Math.max(n, pick(v).length), 0)
    // Per COLUMN, exactly as `serviceCells` is budgeted, because `sessionCells` aligns its cells
    // across the whole list. Advisory here — this screen spends both band columns on the one pane —
    // but measured rather than invented, so it stays true if a second band pane is ever added.
    const listWidth = SERVICE_MARKER
      + widest(v => sessionStateWord(v.state, s)) + 1
      + widest(v => v.harness) + 1
      + widest(sessionName) + 1
      + widest(v => v.cwd)

    return {
      services: listWidth,
      // There is no second band pane on this screen. Zero here is what keeps `cockpitLayout` from
      // sizing the band around rows nothing will draw.
      config: 0,
      configRows: 0,
      serviceRows: Math.max(1, views.length),
      // Every fact line plus a blank and the action row, counted only where each exists — and never
      // fewer than one, or a session with nothing to say would ask for a two-row pane, which is one
      // row below what can be framed and would render as a frameless hole.
      detailRows: Math.max(1, (detail?.lines.length ?? 0) + (actions.length > 0 ? 2 : 0)),
    }
  }, [views, s, detail, actions.length])

  const layout = useMemo(
    () => cockpitLayout(width, height, content, { question: capturing }),
    [width, height, content, capturing],
  )

  /**
   * The two heights this screen draws, out of the three `cockpitLayout` allocates.
   *
   * In the `columns` branch the band's two panes are SIDE BY SIDE, so `config` names the very rows
   * `services` already has — there is nothing to reclaim, only a second column this screen spends on
   * the list. Stacked, they are rows of their own, and rows handed to a pane that does not exist are
   * the dead region the layout's own invariant forbids: they go to the detail pane, or back to the
   * list when what is left could not be framed anyway.
   */
  const heights = useMemo(() => {
    // Nothing to detail. An empty fleet — or one that could not be read at all — has no selected
    // row, so the pane under the list would be an empty frame saying the same nothing the list is
    // already saying, at half the screen. The list takes the rows instead.
    if (!selected && !capturing) return { list: height, detail: 0 }

    const { services, config, detail: region } = layout.heights
    if (layout.kind === 'columns') return { list: services, detail: region }
    const merged = region + config
    return merged >= PANE_MIN_ROWS
      ? { list: services, detail: merged }
      : { list: services + merged, detail: 0 }
  }, [layout, selected, capturing, height])

  /**
   * Which focus regions are actually on screen — the input to every focus decision.
   *
   * The list is always drawn; the action row exists only when the detail pane was framed AND the
   * selected row has a verb. Focus that landed on a region the layout dropped is a cursor the user
   * cannot find and keys that appear to do nothing.
   */
  const panes = useMemo<SessionsFocus[]>(() => {
    const out: SessionsFocus[] = ['list']
    if (heights.detail > 0 && actions.length > 0) out.push('actions')
    return out
  }, [heights.detail, actions.length])

  // Derived rather than corrected in an effect, so a resize that drops the action row never leaves a
  // render where focus points at nothing. `nav.ts`'s `clampFocus` is `PaneId`-shaped and walks the
  // cockpit's three panes; with two regions and the list always drawn, the walk is the fallback.
  const focus: SessionsFocus = panes.includes(wantFocus) ? wantFocus : 'list'

  const listBody = paneBody(width)
  const listRows = paneRows(heights.list)
  const offset = windowOffset(selection, views.length, listRows)
  const shown = Math.max(0, Math.min(listRows, views.length - offset))
  const cells = useMemo(() => sessionCells(views, listBody, s), [views, listBody, s])

  // -------------------------------------------------------------------------
  // keys
  // -------------------------------------------------------------------------

  const move = useCallback((next: number) => {
    const row = views[next]
    if (!row) return
    setSelectedId(row.id)
    setActionIndex(0)
  }, [views])

  useInput((input, key) => {
    const nav: NavKey = {
      input,
      leftArrow: key.leftArrow,
      rightArrow: key.rightArrow,
      upArrow: key.upArrow,
      downArrow: key.downArrow,
      return: key.return,
      escape: key.escape,
      tab: key.tab,
      shift: key.shift,
    }

    if (key.tab) {
      const next = resolveFocusKey(nav, focus, panes)
      if (next) setWantFocus(next)
      return
    }

    if (focus === 'actions') {
      // esc returns to the list rather than leaving the screen: the action row is a step INTO the
      // selection, so stepping back out of it is what esc means everywhere else in this app.
      if (key.escape) return setWantFocus('list')
      if (actions.length === 0) return
      if (key.return) return actions[Math.min(actionIndex, actions.length - 1)]?.run()
      if (key.leftArrow) return setActionIndex(i => (i - 1 + actions.length) % actions.length)
      if (key.rightArrow) return setActionIndex(i => (i + 1) % actions.length)
      return
    }

    // The list. The letters are `sessionsHints`': they avoid every key the shell answers globally
    // (`q`, `m`) and both vi movement keys — `k` for "kill" would have been the same keypress as
    // "up". Each one is gated on the same flag that puts its verb on the action row, so a key whose
    // hint is absent does nothing rather than failing.
    //
    // `r` is the one exception, and it does not steal from the shell: Ink dispatches a key to every
    // active `useInput`, so the shell's own `r` (service status) still fires from its own hook. This
    // screen just ALSO answers it, which is what makes `sessionsHints`' `s.keyRefresh` true here — it
    // used to be a footer hint for a key that, on this screen, did nothing.
    if (input === 'r') { void readSessions(); return }
    if (!selected) return
    if (key.return && selected.attachable) return attach(selected.id)
    if (input === 'R' && selected.managed) {
      return setView({ kind: 'rename', id: selected.id, current: selected.label })
    }
    if (input === 'N' && selected.managed) {
      return setView({ kind: 'note', id: selected.id, current: selected.note })
    }
    if (input === 'x' && selected.killable) {
      return setView({ kind: 'kill', id: selected.id, name: sessionName(selected) })
    }

    const next = resolveListKey(nav, selection, views.length)
    if (next !== selection) move(next)
  }, { isActive: isActive && !capturing })

  // -------------------------------------------------------------------------
  // what the footer says, and who owns the arrows
  // -------------------------------------------------------------------------

  useEffect(() => {
    if (!isActive) return
    onChrome({
      capture: capturing,
      // The action row is a horizontal list, so it takes `←→` from the screen switcher — and the
      // footer stops saying `←→ screens` for exactly as long as that is true.
      claimArrows: !capturing && focus === 'actions',
      // A question's keys are its own. The kill confirmation is a two-item `Menu`, so it moves; the
      // rename and note prompts are text fields, where `↑↓` genuinely does nothing and naming it
      // would be the same lie this whole pairing exists to prevent.
      hints: view.kind === 'kill'
        ? [s.keyBack, s.keyMove, s.keySelect]
        : capturing
          ? [s.keyBack, s.keySelect]
          : sessionsHints(focus, s, {
              canAttach: Boolean(selected?.attachable),
              canKill: Boolean(selected?.killable),
              canEdit: Boolean(selected?.managed),
              hasRows: views.length > 0,
              // The wizard is Task 9, so `n` opens nothing yet and the footer must not name it.
              // Deleting this line is what turns the hint back on.
              canNew: false,
              panes: panes.length,
            }),
    })
  }, [isActive, capturing, focus, s, selected, views.length, panes.length, onChrome, view.kind])

  // -------------------------------------------------------------------------
  // drawing
  // -------------------------------------------------------------------------

  const overlay = overlayFor()

  const listPane = (
    <Pane
      title={s.tabsShort.sessions}
      // Only while the list is a WINDOW into a longer one — the same label the log viewer wears,
      // from the same helper, because two surfaces showing part of a list must not describe it
      // differently. A fleet that fits says nothing, rather than `1–3 / 3`.
      badge={shown < views.length ? windowLabel(offset, shown, views.length) : ''}
      focused={focus === 'list'}
      width={width}
      height={heights.list}
    >
      {snapshot === null
        ? <Text dimColor>{truncate(s.sessionsLoading, listBody)}</Text>
        // Already localized by the host, and NOT an empty fleet: "no tmux on this box" and "nothing
        // is running" are two different answers and only one of them is about sessions.
        : snapshot.unavailable
          ? <Text dimColor>{truncate(snapshot.unavailable, listBody)}</Text>
          : views.length === 0
            ? <Text dimColor>{truncate(s.sessionsEmpty, listBody)}</Text>
            : views.slice(offset, offset + listRows).map((v, i) => (
                <SessionLine
                  key={v.id}
                  word={sessionStateWord(v.state, s)}
                  tone={sessionStateTone(v.state)}
                  harness={v.harness}
                  name={sessionName(v)}
                  cwd={v.cwd}
                  selected={offset + i === selection}
                  focused={focus === 'list'}
                  cells={cells}
                />
              ))}
    </Pane>
  )

  const detailPane = heights.detail > 0 ? (
    <Pane
      title={selected ? sessionName(selected) : s.paneDetail}
      badge={selected?.harness ?? ''}
      focused={focus === 'actions'}
      width={width}
      height={heights.detail}
    >
      <DetailBody
        content={detail}
        actions={actions.map(a => a.label)}
        actionIndex={Math.min(actionIndex, Math.max(0, actions.length - 1))}
        focused={focus === 'actions'}
        width={paneBody(width)}
        rows={paneRows(heights.detail)}
      />
    </Pane>
  ) : null

  // A question owns the detail region and the list stays standing above it: deciding whether to kill
  // a session must never cost sight of the fleet it is part of. When the region could not be framed
  // at all — a very short terminal — the question takes the body instead, because a prompt squeezed
  // under a list it cannot fit beside is unusable and the list is one keypress away again.
  if (overlay && heights.detail < PANE_MIN_ROWS) {
    return (
      <Box flexDirection="column" width={width} height={height} flexShrink={0}>
        <Pane title={overlay.title} focused width={width} height={height}>
          {overlay.node}
        </Pane>
      </Box>
    )
  }

  return (
    <Box flexDirection="column" width={width} height={height} flexShrink={0}>
      {listPane}
      {overlay
        ? (
          <Pane title={overlay.title} focused width={width} height={heights.detail}>
            {overlay.node}
          </Pane>
        )
        : detailPane}
    </Box>
  )

  /**
   * The seam, in one function: `View` in, something drawn out.
   *
   * Every branch returns a title for the pane frame and a node for its inside, and reports its
   * outcome through `perform` — no branch performs anything itself. Declared last, and as a closure,
   * because it needs the callbacks above and nothing needs it.
   */
  function overlayFor(): { title: string; node: React.ReactNode } | null {
    const body = paneBody(width)
    const rows = paneRows(heights.detail >= PANE_MIN_ROWS ? heights.detail : height)

    switch (view.kind) {
      case 'cockpit':
        return null

      case 'kill':
        return {
          title: s.actKill,
          node: (
            <ConfirmPrompt
              label={s.sessionKillQuestion(view.name)}
              yesLabel={s.yes}
              noLabel={s.no}
              onAnswer={yes => (yes
                ? perform(() => host.killSession(view.id), s.actKill)
                : back())}
              onCancel={back}
              width={body}
              height={rows}
              isActive={isActive}
            />
          ),
        }

      case 'rename':
        return {
          title: s.actRename,
          node: (
            <TextPrompt
              // Remounting per row is what clears the previous answer; one shared field would offer
              // the last session's label while renaming this one.
              key={`rename:${view.id}`}
              label={s.sessionRenamePrompt}
              // The CURRENT value, so a rename never hides what it is replacing. It is the
              // placeholder rather than a default: submitting an empty field would then re-apply the
              // name that is already there, which is a no-op dressed up as a change.
              placeholder={view.current}
              onSubmit={value => perform(() => host.renameSession(view.id, value), s.actRename)}
              onCancel={back}
              width={body}
              isActive={isActive}
            />
          ),
        }

      case 'note':
        return {
          title: s.actNote,
          node: (
            <TextPrompt
              key={`note:${view.id}`}
              label={s.sessionNotePrompt}
              placeholder={view.current}
              onSubmit={value => perform(() => host.noteSession(view.id, value), s.actNote)}
              onCancel={back}
              width={body}
              isActive={isActive}
            />
          ),
        }
    }
  }
}
