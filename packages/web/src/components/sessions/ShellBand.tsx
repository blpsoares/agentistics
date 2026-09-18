/**
 * ShellBand — a real shell, in the selected session's own folder, docked as the LAST band of the
 * session panel.
 *
 * It is called **Shell**, not Terminal, and that is not fussiness: the session header already
 * carries a `Chat | Terminal` toggle, and that "Terminal" is the ASSISTANT'S own screen — the tmux
 * pane `claude` is drawing in, where a permission dialog is answered. Two controls named Terminal
 * on one panel, doing different things, is an ambiguity nobody untangles on their own.
 *
 * ## What is reused, and what is new
 *
 * Everything that renders and drives a tmux pane in this browser already exists and is already
 * hardened: `SessionTerminal` (the lazily-chunked xterm), `useTerminalStream` (SSE + the honesty
 * line), `useTerminalWrite` (the ordered WS write channel with its per-key acks). This component
 * points all three at the SHELL scope — `lib/terminalEndpoint.ts` owns which routes that means —
 * and adds the two things a shell needs that a session does not: the band geometry, and the mobile
 * key strip.
 *
 * ## The unwatch discipline
 *
 * The capture loop runs ONLY while the band is open, this session is the selected one, and the
 * document is visible. It is the only per-second cost this feature has, and it is `shellWatching`'s
 * one job; `useTerminalStream(null)` is what actually drops the subscription, after which the
 * server's hub stops capturing as its last reader leaves. Collapsing the band, switching session
 * (the component is keyed by session, so it unmounts) or backgrounding the tab all stop it.
 *
 * ## Consent
 *
 * There is no arm/disarm here, unlike the fleet terminal's composer. OPENING the shell is the
 * consent — a person pressed a button that spawned `$SHELL` in a directory they named — and the
 * server refused the whole route unless `CAPS.localShell` and the `shellEnabled` switch both stand.
 * A second gate on top of that would be ceremony, not safety.
 *
 * ## Refusals
 *
 * `/api/shell/open` answers a REFUSAL as a 200 carrying a sentence (`no-tmux`, `no-cwd`,
 * `cwd-missing`, `at-cap`) — shown verbatim, never re-worded here. The route-level errors upstream
 * of it (`shell_disabled`, `shell_central`) carry a CODE and no prose, and `shellErrorText` is the
 * one place that turns those into sentences. A blank band is never an answer.
 */

import { Suspense, lazy, useCallback, useEffect, useMemo, useReducer, useRef, useState, type ReactNode } from 'react'
import {
  ChevronDown, ChevronUp, ChevronLeft, Loader2, Maximize2, PanelRightOpen,
  RotateCcw, TerminalSquare, Trash2,
} from 'lucide-react'
import { useDocumentVisible } from '../../hooks/useDocumentVisible'
import { useElementWidth } from '../../hooks/useElementWidth'
import { ResizeGrip } from '../ResizeGrip'
import { keyStripShown } from '../../lib/terminalSurface'
import { dockedShowsTarget, usePanelSlots } from '../../lib/panelSlots'
import {
  readTarget, targetLabel, targetScope, targetStreamId, type TerminalTarget,
} from '../../lib/terminalTarget'
import {
  atCap, ceilingRows, ceilingTitle, type CeilingRow, type CeilingShell,
} from '../../lib/shellCeiling'
import { useIsMobile } from '../../hooks/useIsMobile'
import { useTerminalStream } from '../../hooks/useTerminalStream'
import { useTerminalWrite } from '../../hooks/useTerminalWrite'
import {
  BAND_MIN_PX, readBandPrefs, resolveBandHeight, shellApiUrl, shellErrorText, shellWatching,
  bandGeometry, shellWhere, writeBandGeometry, writeBandPrefs, type BandPrefs,
} from '../../lib/shellBand'
import {
  INITIAL_SHELL_BAND, shellBandReducer, shellResolveWanted, type OpenShell,
} from '../../lib/shellBandState'
import { KEY_STRIP, ctrlKeyFor, keyBytes, stripKeyLabel } from '../../lib/keyStrip'
import { terminalStatus } from '../../lib/terminalStream'
import { createPaneResizer } from '../../lib/paneResizeRequest'
import { bandSegmentEntries } from '../../lib/bandSegment'
import { bandBarCompact, type PanelBarEntry, type PanelBarId } from '../../lib/panelBar'
import {
  BAND_CONTROL_H, BandOverflowMenu, BandSegment, BandSegmentTab, PanelBar, type BandOverflowEntry,
} from './bandControls'

const SessionTerminal = lazy(() => import('../SessionTerminal'))

interface T {
  title: string
  open: string
  opening: string
  close: string
  collapse: string
  expand: string
  toggleBar: string
  back: string
  ctrlHint: string
  ctrlRefused: (c: string) => string
  resize: string
  retry: string
  fullscreen: string
  endThis: string
  whichTerminal: string
  openOnRight: string
  /** The VISIBLE word beside the icon (fix-wave review, owner follow-up #5) — short, unlike the
   *  fuller `fullscreen`/`close`/`collapse`/`expand` sentences above, which stay the tooltip. */
  fullscreenLabel: string
  closeLabel: string
  collapseLabel: string
  expandLabel: string
}

const TXT: Record<'pt' | 'en', T> = {
  en: {
    title: 'Shell',
    open: 'Open a shell here',
    opening: 'Opening…',
    close: 'End this shell',
    collapse: 'Collapse the shell',
    expand: 'Expand the shell',
    toggleBar: 'Open or collapse the shell',
    back: 'Back to the session',
    ctrlHint: 'ctrl is armed — press a letter',
    ctrlRefused: c => `ctrl+${c} is not one of the keys this channel sends.`,
    resize: 'Drag to resize the shell',
    retry: 'Try again',
    fullscreen: 'Open the shell full screen',
    endThis: 'End this terminal',
    whichTerminal: 'Which terminal',
    openOnRight: 'This is open in the panel on the right. Pick it again to bring it back here.',
    fullscreenLabel: 'Full screen',
    closeLabel: 'End shell',
    collapseLabel: 'Collapse',
    expandLabel: 'Expand',
  },
  pt: {
    title: 'Shell',
    open: 'Abrir um shell aqui',
    opening: 'Abrindo…',
    close: 'Encerrar este shell',
    collapse: 'Recolher o shell',
    expand: 'Expandir o shell',
    toggleBar: 'Abrir ou recolher o shell',
    back: 'Voltar para a sessão',
    ctrlHint: 'ctrl armado — pressione uma letra',
    ctrlRefused: c => `ctrl+${c} não é uma das teclas que este canal envia.`,
    resize: 'Arraste para redimensionar o shell',
    retry: 'Tentar de novo',
    fullscreen: 'Abrir o shell em tela cheia',
    endThis: 'Encerrar este terminal',
    whichTerminal: 'Qual terminal',
    openOnRight: 'Isto está aberto no painel à direita. Selecione de novo para trazer de volta aqui.',
    fullscreenLabel: 'Tela cheia',
    closeLabel: 'Encerrar shell',
    collapseLabel: 'Recolher',
    expandLabel: 'Expandir',
  },
}

export interface ShellBandProps {
  /** The fleet row this shell belongs to. Its `cwd` is the server's to read — never sent from here. */
  sessionId: string
  /** Shown in the band's title, so it is obvious WHERE the shell was opened. */
  cwd?: string
  lang: 'pt' | 'en'
  theme: 'dark' | 'light'
  /** The harness running in this session, so the CLI target is named after what is on its screen
   *  (`Claude Code`) rather than after a concept ("Assistente"). Absent, or one this build has no
   *  label for, falls back to words — never to a blank segment. */
  harness?: string
  /**
   * WHERE this shell is drawn. `docked` is the band under the composer — the placement whose whole
   * point is SIMULTANEITY, reading the conversation while a build runs beside it. `dedicated` is
   * the shell filling its own screen: no bar, no drag handle, no collapsed state, because you got
   * here by asking for it and the way back is the screen's own control. `aside` (design §1.5) is
   * the RIGHT SLOT's own placement — it fills its box exactly like `dedicated` (no bar, no drag
   * handle: the slot's own switcher and close are the way out), but it is embedded beside the
   * conversation rather than a screen of its own, so it carries no key strip route and no
   * fullscreen control of its own.
   *
   * The three share every rule that matters — one stream, one write channel, one emulator, the same
   * unwatch discipline — which is the entire reason this is a prop and not a second component.
   */
  placement?: 'docked' | 'dedicated' | 'aside'
  /** Offered only when there is somewhere to go: the band's "take the whole screen" control. */
  onOpenFullscreen?: () => void
  /**
   * THE ONE PANEL BAR (design item 1) — `Conteúdo · Studio · Claude Code · Shell · Hardware`,
   * computed by the caller (`SessionPanel`, which has `panelSlots`/`artifactsStore` in scope) through
   * `panelBarEntries`. It replaces the docked band's own former `Claude Code | Shell | Studio`
   * segment — that segment's whole job (switch what THIS band shows) is a subset of what this bar
   * now does. `docked`, desktop only — `aside`/`dedicated` show one stream and nothing else sits
   * beside them, and mobile keeps its own compact switcher (see the module header).
   */
  barEntries?: readonly PanelBarEntry[]
  /**
   * A tab was picked. `SessionPanel` builds ONE such handler shared by this band and `StudioBand`,
   * so the two can never disagree about what clicking Contents/Studio/Hardware does — this band adds
   * only the cli/shell-specific side effects (`chooseTarget`, opening if collapsed) around it, in
   * `handleBarPick` below, because those two targets are this band's own local preference and no
   * other caller of the shared handler needs to know that.
   */
  onBarPick?: (id: PanelBarId) => void
  /** The first-open dot on the Studio entry — `App.tsx`'s own `studioSeen`, threaded down through
   *  `SessionPanel`. */
  studioSeen?: boolean
  /**
   * WHAT `panelSlots.ts` SAYS THE BOTTOM SLOT HOLDS, `'cli'`/`'shell'` only — seeds this band's own
   * `target` state on a FRESH MOUNT (a fresh mount happens whenever `StudioBand` swaps out for this
   * component: picking Claude Code or Shell from within `StudioBand`'s own bar displaces the Studio
   * and hands the bottom slot to whichever was picked, and without this the new `ShellBand` instance
   * would initialise `target` from its own stored preference, disagreeing with what was just
   * requested on the very first frame) — AND kept in sync for the life of the mount, below (the
   * effect next to `target`'s own declaration).
   *
   * That second half is not optional. `target` is this band's own LOCAL preference and nothing sets
   * it except `chooseTarget`, called only from THIS component's own click handlers
   * (`handleBarPick`, the mobile `targetSwitch`). `SessionPanel`'s "bring it to the bottom" gesture
   * (owner feedback, 2026-09-17) writes `panelSlots` from OUTSIDE this component — it has no access
   * to `chooseTarget` at all — so without the effect, `bottomOccupant` flips to the newly-moved
   * panel while `target` (and the stream on screen) stays whatever it was, which is what made
   * "Mover para baixo" read as "this just closes the right aside": the store moved the panel
   * correctly and this band kept showing the wrong thing, or nothing.
   */
  bottomOccupant?: 'cli' | 'shell' | null
  /**
   * THE TASK CONTROL (design item 3) — `SessionTitleFlag`, rendered at the bar's LEFT end, the same
   * element `StudioBand` and the no-terminal fallback band render. Built once by `SessionPanel` (it
   * owns the session's id/title/harness/task) and handed down as a node rather than reimplemented
   * three times — the exact reason `SessionTitleFlag` itself exists. `docked`/desktop only: mobile
   * keeps it in the page's own header (design item 4), and `aside`/`dedicated` show one stream with
   * no room for a second control.
   */
  taskControl?: ReactNode
  /**
   * "Bring the Studio to the bottom" (owner feedback, 2026-09-17) — present exactly when the Studio
   * sits in the right slot while THIS band is docked; see `SessionPanel`'s own `moveDownEntries`.
   * Merged into this band's own overflow menu rather than a second control — `docked` only, the
   * same reasoning as `onMoveToRight` below.
   */
  extraOverflowEntries?: readonly BandOverflowEntry[]
  /** Move whichever pane THIS band is currently showing to the right slot. Docked only — `aside` is
   *  already the right slot, and `dedicated` has no slot to move into. */
  onMoveToRight?: (target: TerminalTarget) => void
  /**
   * THE CENTRE COLUMN'S OWN MEASURED HEIGHT (design item 7) — what "full" resolves against, and
   * the ceiling `resolveBandHeight` reads. `docked` only: `dedicated`/`aside` already fill the
   * whole box they are given and have no drag handle to snap. Absent or `0` reads as "not measured
   * yet", which `resolveBandHeight` already treats as "never snap".
   */
  columnHeight?: number
}

export function ShellBand({
  sessionId, cwd, lang, theme, harness, placement = 'docked', onOpenFullscreen,
  barEntries, onBarPick, studioSeen = true, bottomOccupant = null, taskControl, extraOverflowEntries,
  onMoveToRight, columnHeight = 0,
}: ShellBandProps) {
  const t = TXT[lang]
  const isMobile = useIsMobile()
  const documentVisible = useDocumentVisible()

  // `dedicated` AND `aside` both fill whatever box they are given, with no bar of their own — see
  // the `placement` doc comment above. Kept as one boolean because every rule that follows from
  // "this is the whole box, not a collapsible band" is the same for both.
  const dedicated = placement === 'dedicated' || placement === 'aside'
  const [prefs, setPrefs] = useState(() => readBandPrefs())
  /**
   * WHICH terminal this band is showing. It is the band's own state and not the session's, because
   * the band is now the door to BOTH panes: the header's `Conversa | Terminal` toggle is gone, a
   * session opens on its conversation, and choosing a terminal is choosing which one.
   *
   * SEEDED FROM `bottomOccupant` WHEN IT NAMES ONE, the stored preference otherwise — see that
   * prop's own doc comment for why: a fresh mount (this component swapping in for `StudioBand`)
   * must show what was just requested, not whatever this band happened to show last time it was up.
   */
  const [target, setTarget] = useState<TerminalTarget>(
    () => bottomOccupant ?? readTarget(readBandPrefs().target),
  )
  const scope = targetScope(target)
  /**
   * EXCLUSIVITY WITH THE RIGHT SLOT (C3) — only the DOCKED placement needs this. This band's own
   * `target` (above) is a LOCAL preference, chosen through its own segmented control and never
   * written through `panelSlots.openPanel` except on an explicit click — so nothing stopped it going
   * on streaming (and capturing) the very pane the right slot had already taken, and nothing told it
   * to stop once that happened on its own, before any click. `dockedShowsTarget` is the one pure rule
   * (`panelSlots.ts`) both this band and the right slot's own render are ultimately judged against;
   * `dedicated`/`aside` never need it — `aside` IS the right slot's own placement, so there is
   * nothing else to exclude it FROM, and `dedicated` has no slot to conflict with.
   */
  const slotLayout = usePanelSlots().layout
  const excludedFromDocked = placement === 'docked' && !dockedShowsTarget(slotLayout, target)
  // A DEDICATED shell is open by definition — you navigated to a screen that is nothing else. The
  // stored `open` is the DOCKED band's state and must not decide it, or arriving here with the band
  // collapsed would show an empty screen with no way to fill it.
  const bandOpen = dedicated || prefs.open
  // THE MACHINE, not a pile of flags. See `shellBandState.ts` for the rule it enforces.
  const [band, dispatch] = useReducer(shellBandReducer, INITIAL_SHELL_BAND, init =>
    dedicated || readBandPrefs().open ? shellBandReducer(init, { type: 'openBand' }) : init)
  const shell = band.shell
  const [ctrlArmed, setCtrlArmed] = useState(false)
  /** The open shells, fetched ONLY when the ceiling refuses — see `shellCeiling.ts`. */
  const [ceiling, setCeiling] = useState<{ rows: CeilingRow[]; cap: number } | null>(null)
  const [ctrlNote, setCtrlNote] = useState<string | null>(null)

  /** Choosing a terminal is remembered, so the band comes back on the one you were using. */
  const chooseTarget = useCallback((next: TerminalTarget) => {
    setTarget(next)
    try { writeBandPrefs({ ...readBandPrefs(), target: next }) } catch { /* storage blocked */ }
  }, [])

  /**
   * FOLLOW `bottomOccupant` FOR THE LIFE OF THE MOUNT, not only at the first frame — see that prop's
   * own doc comment. A move triggered from outside this band's own bar (`SessionPanel`'s "bring it
   * to the bottom" overflow entry) writes `panelSlots` directly and has no way to call `chooseTarget`
   * itself; without this effect `target` stayed on whatever it was, `dockedShowsTarget` kept judging
   * the OLD target against the (now cleared) right slot, and the band showed the wrong stream — or,
   * once the right slot cleared, `terminalStream.ts`'s generic "pick a live session" placeholder —
   * while the panel bar's own tab read correctly lit. Guarded so a `bottomOccupant` of `null` (the
   * panel moved AWAY from the bottom, or nothing has ever named an occupant) never overwrites a
   * choice the person made by clicking inside this band itself.
   */
  useEffect(() => {
    if (bottomOccupant && bottomOccupant !== target) chooseTarget(bottomOccupant)
  }, [bottomOccupant, target, chooseTarget])

  const setBand = useCallback((next: Partial<{ open: boolean; height: number; full: boolean }>) => {
    setPrefs(p => {
      const merged: BandPrefs = { ...p, ...next }
      // `full: false` is written by OMISSION, matching `readBandPrefs`'s own convention — a
      // literal `false` and an absent key must read identically to every caller.
      if (merged.full === false) delete merged.full
      writeBandPrefs(merged)
      return merged
    })
    if (next.open === true) dispatch({ type: 'openBand' })
    if (next.open === false) dispatch({ type: 'closeBand' })
  }, [])

  /**
   * Resolve THIS session's shell: reuse the one already running for it, else open one.
   *
   * A shell lives until it is closed — it survives switching session, reloading the page and closing
   * the browser — so the list is asked first. Opening blind would mint a second shell per reload and
   * walk into the ceiling with seven copies of one directory.
   *
   * The effect is driven by ONE fact, `shellResolveWanted(band)`, and every exit dispatches: an
   * abandoned attempt goes back to `wanted` rather than leaving the band spinning on work nobody is
   * doing. That is the whole reason the machine exists — see `shellBandState.ts`.
   */
  // DEPENDS ON `band.attempt` AND NOT ON `band`. The effect dispatches, and an effect that depends
  // on what it dispatches cancels its own request on the very next render — the loop that made this
  // band spin on "Abrindo…". `attempt` moves only when a PERSON opens or retries.
  // Only the SHELL has to be resolved: the CLI pane IS the session and is already there. Asking
  // for one while the band is showing the other would mint a shell nobody opened.
  // EXCLUDED (C3): the right slot already resolves/streams this exact target, so the docked band
  // must not also open or reuse it — that is the second live reader `dockedShowsTarget` exists to
  // prevent.
  const wanted = shellResolveWanted(band) && target === 'shell' && !excludedFromDocked
  const wantedRef = useRef(wanted)
  wantedRef.current = wanted
  useEffect(() => {
    if (!wantedRef.current) return
    let cancelled = false
    dispatch({ type: 'resolving' })
    void (async () => {
      try {
        const listed = await fetch(shellApiUrl('/api/shell/list', lang))
        if (listed.ok) {
          const body = await listed.json() as { shells?: (OpenShell & { sessionId?: string })[] }
          const mine = (body.shells ?? []).find(sh => sh.sessionId === sessionId)
          if (mine) { if (!cancelled) dispatch({ type: 'resolved', shell: { id: mine.id, cwd: mine.cwd } }); return }
        } else {
          const body = await listed.json().catch(() => ({})) as { error?: string }
          if (body.error) { if (!cancelled) dispatch({ type: 'refused', message: shellErrorText(body.error, lang) }); return }
        }
        const res = await fetch(shellApiUrl('/api/shell/open', lang), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sessionId }),
        })
        const body = await res.json().catch(() => ({})) as {
          ok?: boolean; shell?: OpenShell; message?: string; error?: string; reason?: string
        }
        if (cancelled) return
        // A REFUSAL arrives as a sentence the server composed; it is shown verbatim. A route-level
        // error carries only a code, and `shellErrorText` is the one place that words those.
        if (body.ok && body.shell) dispatch({ type: 'resolved', shell: body.shell })
        // The CODE travels with the sentence: only `at-cap` has anything to offer, and matching on
        // a localized sentence would stop working the day somebody rewords it.
        else if (body.message) dispatch({ type: 'refused', message: body.message, ...(body.reason ? { reason: body.reason } : {}) })
        else dispatch({ type: 'refused', message: shellErrorText(body.error ?? 'network', lang) })
      } catch {
        if (!cancelled) dispatch({ type: 'refused', message: shellErrorText('network', lang) })
      }
    })()
    // An abandoned attempt is NOT a failure and NOT a silence: it returns to `wanted`, so the next
    // render asks again instead of leaving a spinner over nothing.
    return () => { cancelled = true; dispatch({ type: 'cancelled' }) }
    // `target` IS a dependency, and leaving it out was a measured bug: a band opened on the CLI
    // pane skips the resolve, and switching to the shell moved nothing the effect watches — so the
    // request that had been skipped was never made and the shell never appeared. It is safe to
    // depend on because a PERSON moves it, unlike the dispatches this effect makes itself.
  }, [band.attempt, sessionId, lang, target])

  /**
   * THE CEILING IS THE ONE REFUSAL A PERSON CAN ACT ON, and until now it was the one with no
   * action: nothing in this product listed or closed a shell, so "close one to open another" sent
   * you looking through eight other sessions. The list is fetched only on that refusal — `?titles=1`
   * costs a fleet walk, and the names are what make the rows distinguishable when every shell of a
   * repository sits in the same directory.
   */
  useEffect(() => {
    if (!atCap(band.reason)) { setCeiling(null); return }
    let gone = false
    void (async () => {
      const body = await fetch(shellApiUrl('/api/shell/list', lang) + '&titles=1')
        .then(r => r.ok ? r.json() as Promise<{ shells?: CeilingShell[]; cap?: number }> : null)
        .catch(() => null)
      if (gone || !body) return
      setCeiling({ rows: ceilingRows(body.shells ?? []), cap: body.cap ?? 0 })
    })()
    return () => { gone = true }
  }, [band.reason, band.attempt, lang])

  /** End one of the OTHER shells, then ask again — the retry is the whole point of the list. */
  const closeOther = useCallback(async (id: string) => {
    setCeiling(c => (c ? { ...c, rows: c.rows.filter(r => r.id !== id) } : c))
    await fetch(shellApiUrl('/api/shell/close', lang), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: [id] }),
    }).catch(() => {})
    dispatch({ type: 'retry' })
  }, [lang])

  // EXCLUDED (C3): never watch — never capture — a pane the right slot already shows. Without this
  // a move to the right left the docked band's own stream running: two live readers of one pane,
  // confirmed live as a second `GET /api/shell/stream?id=…` for the exact same shell.
  const watching = shellWatching({
    bandOpen,
    sessionSelected: Boolean(sessionId),
    documentVisible,
  }) && !excludedFromDocked
  /** The pane this band is watching: the session itself, or the shell it opened. `null` while a
   *  shell has not been resolved yet, which is what keeps the stream from asking for a blank. */
  const streamId = targetStreamId(target, { sessionId, shellId: shell?.id ?? null })
  // `null` is what DROPS the subscription — the client half of the unwatch discipline.
  // The remembered geometry rides the OPEN, so the pane is already this box's size on the first
  // frame instead of arriving at whatever width the last viewer left it — see `shellBand.ts`.
  const { state } = useTerminalStream(watching ? streamId : null, scope, bandGeometry(placement))
  const write = useTerminalWrite(streamId ?? '', watching && Boolean(streamId), lang, scope)
  // The honesty line must say WHOSE screen this is: "the agent's current screen" over a shell the
  // person opened themselves is simply false, and the reverse is just as wrong.
  const status = terminalStatus(state, lang, target === 'shell' ? 'shell' : 'session')
  /** A shell follows its box in BOTH directions — nothing in this product reads its screen. */
  const resizer = useMemo(
    () => createPaneResizer({ scope, id: streamId ?? '' }),
    [scope, streamId],
  )
  useEffect(() => () => resizer.cancel(), [resizer])
  /**
   * One measurement, two consumers: the pane is resized NOW (debounced) and the number is kept for
   * the NEXT open. Written straight to storage rather than through React state — the emulator
   * reports on every layout change, and a re-render of the whole panel for a number nothing on
   * screen shows would be a cost with no reader.
   */
  const onGeometry = useCallback((g: { cols: number; rows: number }) => {
    writeBandGeometry(placement, g)
    resizer.request(g)
  }, [resizer, placement])

  /**
   * One send path for everything.
   *
   * A strip press produces the same bytes a real keypress would (`keyBytes`) and goes through the
   * same `send`, so `splitInput`'s allowlist judges both identically — a key it would refuse cannot
   * reach the wire by a side door. `ctrl` is a STICKY modifier because a soft keyboard has no chord
   * to hold: it arms, and the next single character becomes the control key instead.
   */
  const send = useCallback((data: string) => {
    if (ctrlArmed) {
      setCtrlArmed(false)
      const key = ctrlKeyFor(data)
      if (!key) { setCtrlNote(t.ctrlRefused(data)); return }
      setCtrlNote(null)
      write.send(keyBytes(key))
      return
    }
    write.send(data)
  }, [ctrlArmed, write, t])

  const pressStrip = useCallback((id: string) => {
    const entry = KEY_STRIP.find(e => e.id === id)
    if (!entry) return
    if (entry.kind === 'modifier') { setCtrlNote(null); setCtrlArmed(a => !a); return }
    setCtrlArmed(false)
    write.send(keyBytes(entry.key))
  }, [write])

  const close = useCallback(async () => {
    if (!shell) return
    const id = shell.id
    dispatch({ type: 'ended' })
    setBand({ open: false })
    await fetch(shellApiUrl('/api/shell/close', lang), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: [id] }),
    }).catch(() => {})
  }, [shell, setBand, lang])

  // ---- the drag handle (design item 7: free-resizing, snapping to full) -----------------------
  /** What is ACTUALLY on screen right now — `columnHeight` while `full`, `prefs.height` otherwise.
   *  A drag's start point has to be THIS, never the stored `prefs.height` alone: while full, that
   *  field is stale (see `BandPrefs.full`'s own doc comment), and starting the drag from it would
   *  have the band jump the instant the pointer moved at all. */
  const renderedHeight = prefs.full && columnHeight > 0 ? columnHeight : prefs.height
  const dragRef = useRef<{ startY: number; startH: number } | null>(null)
  const onDragStart = (clientY: number) => { dragRef.current = { startY: clientY, startH: renderedHeight } }
  useEffect(() => {
    if (isMobile) return
    const move = (clientY: number) => {
      const d = dragRef.current
      if (!d) return
      // The band grows UPWARD: it is docked at the bottom, so dragging up must make it taller.
      setBand(resolveBandHeight(d.startH + (d.startY - clientY), columnHeight))
    }
    const onMouse = (e: MouseEvent) => move(e.clientY)
    const onTouch = (e: TouchEvent) => { const p = e.touches[0]; if (p) move(p.clientY) }
    const end = () => { dragRef.current = null }
    window.addEventListener('mousemove', onMouse)
    window.addEventListener('mouseup', end)
    window.addEventListener('touchmove', onTouch)
    window.addEventListener('touchend', end)
    return () => {
      window.removeEventListener('mousemove', onMouse)
      window.removeEventListener('mouseup', end)
      window.removeEventListener('touchmove', onTouch)
      window.removeEventListener('touchend', end)
    }
  }, [isMobile, setBand, columnHeight])

  /**
   * THE ONE CONTROL THAT PICKS A TERMINAL. It replaced the header's `Conversa | Terminal` toggle —
   * a session opens on its conversation, and this band is the door to both panes. The CLI segment
   * is named after the HARNESS, so it names what is on the screen instead of a concept.
   */
  const targetSwitch = (
    <BandSegment label={t.whichTerminal} isMobile={isMobile}>
      {bandSegmentEntries(target, { cli: true, shell: true, studio: false }).map(({ id, on }) => (
        <BandSegmentTab
          key={id}
          on={on}
          isMobile={isMobile}
          // Collapsed, picking a target is also the gesture that OPENS the band — the segment is
          // the door, so it must not need a second click on the bar behind it.
          onClick={e => {
            e.stopPropagation()
            chooseTarget(id as TerminalTarget)
            if (!bandOpen) setBand({ open: true })
          }}
          label={targetLabel(id as TerminalTarget, harness, lang)}
        />
      ))}
    </BandSegment>
  )

  /**
   * THE ONE PANEL BAR (design item 1) — replaces the docked band's former "Claude Code | Shell |
   * Studio" segment (`dockedTargetSwitch`, before this pass). `barEntries`/`onBarPick` come from
   * `SessionPanel`, which is what lets `StudioBand` render the exact same bar and the two never
   * disagree about what is lit or what clicking it does.
   *
   * The only thing THIS band adds around the shared handler is what makes cli/shell its OWN local
   * concern rather than something `panelSlots.ts` can decide alone: `target` is chosen through this
   * segment and never written back except on an explicit pick (see `target`'s own doc comment), so
   * picking the tab that is not currently showing must ALSO flip this band's local state and open it
   * if collapsed — the exact two things the old `dockedTargetSwitch` did by hand. A tab that IS
   * already lit is left to the shared handler alone: if it is lit because it is the band's own
   * occupant, that handler is a no-op (nothing to close from in here); if it is lit because it sits
   * on the RIGHT instead, the handler closes it there, which needs no local state change.
   */
  const handleBarPick = useCallback((id: PanelBarId) => {
    if ((id === 'cli' || id === 'shell') && !barEntries?.find(e => e.id === id)?.on) {
      chooseTarget(id)
      if (!bandOpen) setBand({ open: true })
    }
    onBarPick?.(id)
  }, [barEntries, onBarPick, chooseTarget, bandOpen, setBand])
  /** The bar's OWN measured width (design item 7), never the window's — see `useElementWidth`'s
   *  own header on why. */
  const [barWidthRef, barWidth] = useElementWidth()
  const compact = bandBarCompact(barWidth)
  const panelBar = barEntries !== undefined && (
    <PanelBar
      entries={barEntries} lang={lang} studioSeen={studioSeen} harness={harness} onPick={handleBarPick}
      compact={compact}
    />
  )
  /**
   * THE OVERFLOW MENU (design item 7) — Move/Full screen/End shell, each keeping its full label
   * INSIDE the menu (only the TRIGGER is compact). Exactly the three `BandLabeledButton`s this bar
   * used to draw inline, same conditions, same actions — moved so the row they used to widen no
   * longer has to hold them at all.
   */
  const overflowEntries: BandOverflowEntry[] = [
    ...(prefs.open && onMoveToRight ? [{
      id: 'move', label: lang === 'pt' ? 'Mover para a direita' : 'Move to the right',
      icon: <PanelRightOpen size={14} />, onSelect: () => onMoveToRight(target),
    }] : []),
    // "Bring the Studio to the bottom" (owner feedback, 2026-09-17) — not gated on `prefs.open`
    // like the entries above: it names what sits on the RIGHT, not what this band is doing, and a
    // collapsed band is still a valid place to bring something into.
    ...(extraOverflowEntries ?? []),
    ...(prefs.open && streamId && onOpenFullscreen ? [{
      id: 'fullscreen', label: t.fullscreen, icon: <Maximize2 size={14} />, onSelect: onOpenFullscreen,
    }] : []),
    ...(prefs.open && shell && target === 'shell' ? [{
      id: 'end', label: t.close, icon: <Trash2 size={14} />, onSelect: () => { void close() },
    }] : []),
  ]

  const where = shellWhere(cwd)

  const screen = (
    <div style={{
      flex: 1, minHeight: 0, borderRadius: 8, overflow: 'hidden',
      border: '1px solid var(--border-subtle)',
      background: theme === 'light' ? '#ffffff' : '#0e1116',
    }}>
      <Suspense fallback={<div style={{ padding: 12, fontSize: 12, fontFamily: 'monospace', color: 'var(--text-tertiary)' }}>
        {lang === 'pt' ? 'Carregando o emulador…' : 'Loading the emulator…'}
      </div>}>
        {/* key={shell.id}: a new shell gets a brand-new emulator, so no content leaks across. */}
        <SessionTerminal
          key={streamId ?? 'none'}
          frame={state.frame}
          theme={theme}
          showCursor={status.showCursor}
          interactive={write.ready}
          onInput={send}
          onGeometry={streamId ? onGeometry : undefined}
        />
      </Suspense>
    </div>
  )

  /** The one sentence the band always has: a refusal, a delivery failure, or what is on screen.
   *  EXCLUDED (C3) overrides all of it — the pane is not connecting or idle, it is simply showing
   *  somewhere else, and `status.detail` (built from an `idle`, un-watched stream) would otherwise
   *  say "No session"/"No shell" about a pane that is very much open, just not here. */
  const line = excludedFromDocked
    ? t.openOnRight
    : band.message ?? (write.reason ? write.reason : band.phase === 'opening' ? t.opening : status.detail)
  const lineIsBad = Boolean(band.message || write.reason)
  const busy = band.phase === 'opening'

  const notice = (
    <div
      role={lineIsBad ? 'status' : undefined}
      style={{
        fontSize: 11, lineHeight: 1.5, flexShrink: 0,
        color: lineIsBad ? 'var(--accent-red)' : 'var(--text-tertiary)',
      }}
    >
      {ctrlArmed ? t.ctrlHint : ctrlNote ?? line}
      {/* A refusal is a DEAD STOP by design — the band never retries a "no" on its own — so the way
          forward has to be on screen. Without it a refused band is a sentence and nothing else. */}
      {band.phase === 'refused' && !atCap(band.reason) && (
        <button
          onClick={() => dispatch({ type: 'retry' })}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 4, marginLeft: 8,
            minHeight: isMobile ? 44 : 22, padding: isMobile ? '0 12px' : '0 8px',
            borderRadius: 6, cursor: 'pointer', fontFamily: 'inherit', fontSize: 11, fontWeight: 600,
            border: '1px solid var(--border-subtle)', background: 'var(--bg-elevated)',
            color: 'var(--text-secondary)',
          }}
        >
          <RotateCcw size={11} />
          {t.retry}
        </button>
      )}
    </div>
  )

  /**
   * THE WAY OUT OF THE CEILING. `at-cap` used to be a sentence and nothing else; this is the list
   * the sentence was telling you to go and find. Each row NAMES its session (the directory alone
   * does not separate them — a repository's shells all sit in the same one) and carries the handle,
   * so two rows that still read alike are told apart by something.
   */
  const ceilingList = ceiling && atCap(band.reason) && target === 'shell' ? (
    <div style={{
      flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 6,
      maxHeight: isMobile ? 260 : 180, overflowY: 'auto',
      padding: 8, borderRadius: 8,
      border: '1px solid var(--border-subtle)', background: 'var(--bg-elevated)',
    }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-secondary)' }}>
        {ceilingTitle(ceiling.cap, lang)}
      </div>
      {ceiling.rows.map(row => (
        <div key={row.id} style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{
              fontSize: 12, fontWeight: 600, color: 'var(--text-primary)',
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>{row.title}</div>
            <div style={{
              fontSize: 10.5, color: 'var(--text-tertiary)', fontFamily: 'monospace',
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>{row.short}{row.where ? ` · ${row.where}` : ''}</div>
          </div>
          <button className="ag-tap-icon"
            onClick={() => { void closeOther(row.id) }}
            title={t.endThis}
            aria-label={`${t.endThis} — ${row.title}`}
            style={{
              // PAINTED small, TARGETED at 44px by `.ag-tap-icon` — the repo's rule, and the one
              // this list must not break: a row of 44px squares turns a compact list into a column
              // of boxes, while the finger still needs the 44.
              display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
              width: 26, height: 26,
              borderRadius: 6, cursor: 'pointer',
              border: '1px solid var(--border-subtle)', background: 'transparent',
              color: 'var(--text-tertiary)',
            }}
          >
            <Trash2 size={13} />
          </button>
        </div>
      ))}
    </div>
  ) : null

  const strip = (
    <div style={{
      display: 'flex', gap: 6, flexShrink: 0, overflowX: 'auto',
      paddingBottom: 'var(--safe-bottom)',
    }}>
      {KEY_STRIP.map(entry => {
        const armed = entry.kind === 'modifier' && ctrlArmed
        return (
          <button
            key={entry.id}
            onClick={() => pressStrip(entry.id)}
            aria-pressed={entry.kind === 'modifier' ? ctrlArmed : undefined}
            style={{
              // 44px is the MOBILE figure, and this strip exists only on mobile.
              minWidth: 44, minHeight: 44, flexShrink: 0,
              borderRadius: 8, cursor: 'pointer', fontFamily: 'inherit',
              fontSize: 14, fontWeight: 600,
              border: `1px solid ${armed ? 'var(--anthropic-orange)' : 'var(--border-subtle)'}`,
              background: armed ? 'var(--anthropic-orange)' : 'var(--bg-elevated)',
              color: armed ? '#fff' : 'var(--text-secondary)',
            }}
          >
            {stripKeyLabel(entry.id)}
          </button>
        )
      })}
    </div>
  )

  // ---- dedicated / aside: the shell fills the whole box it is given -----------------------------
  // No bar, no drag handle, no collapsed state: `dedicated` because you navigated to a screen that
  // is nothing else, `aside` because the right slot's own switcher and close are the way out. The
  // key strip follows `keyStripShown` — a phone has no ctrl key, and `dedicated` is the placement a
  // phone always gets (`aside` is desktop-only — see §1.6, the right slot opens as `dedicated` on a
  // phone instead).
  if (dedicated) {
    return (
      <div style={{
        flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', gap: 8,
      }}>
        {streamId ? screen : <div style={{ flex: 1 }} />}
        {notice}
        {ceilingList}
        {keyStripShown('dedicated', isMobile) && strip}
      </div>
    )
  }

  // ---- mobile: a full-screen sheet over the session --------------------------------------------
  if (isMobile) {
    if (!prefs.open) {
      // The door to BOTH terminals, and the SAME control the open band carries — the segmented
      // tablist, on the right. A phone has no header toggle to fall back on, so this bar is the
      // only way to a terminal; it may not be a control that changes shape between states.
      return (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8, width: '100%',
          minHeight: 44, padding: '0 12px', flexShrink: 0,
          borderTop: '1px solid var(--border)', background: 'var(--bg-surface)',
        }}>
          <span style={{ color: 'var(--anthropic-orange)', display: 'inline-flex', flexShrink: 0 }}>
            <TerminalSquare size={16} />
          </span>
          {where && <span style={{
            minWidth: 0, flex: 1, fontSize: 11, color: 'var(--text-tertiary)',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>{where}</span>}
          {!where && <span style={{ flex: 1 }} />}
          {targetSwitch}
        </div>
      )
    }
    return (
      <div style={{
        position: 'fixed', inset: 0, zIndex: 60,
        display: 'flex', flexDirection: 'column',
        background: 'var(--bg-base)',
        paddingTop: 'var(--safe-top)',
      }}>
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8, minHeight: 44, padding: '0 10px',
          borderBottom: '1px solid var(--border)', background: 'var(--bg-surface)', flexShrink: 0,
        }}>
          <button
            onClick={() => setBand({ open: false })}
            aria-label={t.back}
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              width: 44, height: 44, flexShrink: 0, marginLeft: -6,
              border: 'none', background: 'transparent', color: 'var(--text-secondary)', cursor: 'pointer',
            }}
          >
            <ChevronLeft size={20} />
          </button>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ fontSize: 13, fontWeight: 650, color: 'var(--text-primary)' }}>
              {targetLabel(target, harness, lang)}
            </div>
            {where && <div style={{
              fontSize: 10.5, color: 'var(--text-tertiary)',
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>{where}</div>}
          </div>
          {shell && target === 'shell' && (
            <button
              onClick={() => { void close() }}
              aria-label={t.close}
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                width: 44, height: 44, flexShrink: 0,
                border: 'none', background: 'transparent', color: 'var(--text-tertiary)', cursor: 'pointer',
              }}
            >
              <Trash2 size={18} />
            </button>
          )}
        </div>
        <div style={{
          flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', gap: 8, padding: 10,
        }}>
          {/* RIGHT, like every other placement's. */}
          <div style={{ display: 'flex', justifyContent: 'flex-end', flexShrink: 0 }}>{targetSwitch}</div>
          {/* EXCLUDED (C3): never render the screen for a target the right slot already shows —
              see `excludedFromDocked` above. */}
          {streamId && !excludedFromDocked ? screen : <div style={{ flex: 1 }} />}
          {notice}
          {ceilingList}
          {strip}
        </div>
      </div>
    )
  }

  // ---- desktop: the last band of the panel, under the composer ---------------------------------
  return (
    <div style={{
      // FULL (design item 7) flex-stretches this ROOT within `SessionPanel`'s own column, the same
      // two-step `StudioBand` uses for the identical reason — see that component's own header on
      // why a literal pixel figure equal to the whole measured column would overflow it by this
      // bar's own height.
      ...(prefs.full ? { flex: '1 1 auto', minHeight: 0 } : { flexShrink: 0 }),
      display: 'flex', flexDirection: 'column',
      borderTop: '1px solid var(--border)', background: 'var(--bg-surface)',
    }}>
      {/* The drag handle sits on the band's TOP edge — the VS Code geometry, where the panel is
          always the bottom-most strip. It is `role="separator"` and takes the arrow keys, so the
          band is resizable without a pointer. `ResizeGrip` (design item 6) marks it. */}
      {prefs.open && (
        <div
          role="separator"
          aria-orientation="horizontal"
          aria-label={t.resize}
          tabIndex={0}
          className="ag-resize-handle"
          onMouseDown={e => { e.preventDefault(); onDragStart(e.clientY) }}
          onKeyDown={e => {
            if (e.key === 'ArrowUp') { e.preventDefault(); setBand(resolveBandHeight(renderedHeight + 24, columnHeight)) }
            if (e.key === 'ArrowDown') { e.preventDefault(); setBand(resolveBandHeight(renderedHeight - 24, columnHeight)) }
          }}
          style={{ height: 6, cursor: 'ns-resize', background: 'transparent' }}
        ><ResizeGrip orientation="horizontal" /></div>
      )}
      {/* THE COMPACT BAR (design item 7): task control · panel segment (icon+label, collapsing to
          icons below ~1100px) · spacer · ONE "⋯" overflow menu · the collapse chevron as a plain
          icon button with a tooltip. Everything that used to widen this row on its own — the
          leading terminal icon, the uppercase target name, the `where` path, and Move/Full
          screen/End shell as their own labelled buttons — is gone or moved into the menu: the
          target name and the `where` path are redundant with the segment's own lit tab (which
          already names Claude Code/Shell), and the three actions keep their labels inside the menu
          instead of spending width on the row.

          THE WHOLE BAR IS STILL THE TOGGLE (its own long-standing reasoning, unchanged): a 26px
          chevron at the far right of a full-width strip is a target you have to aim at, and the
          strip beside it did nothing at all. `role="button"` rather than a real one: it contains
          buttons, and nesting them is invalid HTML. The controls inside it stop propagation, or
          picking a tab / opening the menu / ending a shell would also collapse the band. */}
      <div
        ref={barWidthRef}
        role="button"
        tabIndex={0}
        aria-expanded={prefs.open}
        aria-label={t.toggleBar}
        {...(where ? { title: where } : {})}
        onClick={() => setBand({ open: !prefs.open })}
        onKeyDown={e => {
          if (e.key !== 'Enter' && e.key !== ' ') return
          e.preventDefault()
          setBand({ open: !prefs.open })
        }}
        style={{
          display: 'flex', alignItems: 'center', gap: 8, padding: '4px 12px', minHeight: 32,
          cursor: 'pointer', userSelect: 'none',
        }}
      >
        {taskControl}
        {panelBar}
        {busy && <Loader2 size={13} className="ag-spin" style={{ color: 'var(--text-tertiary)' }} />}
        <span style={{ flex: 1 }} />
        <BandOverflowMenu
          label={lang === 'pt' ? 'Mais ações' : 'More actions'}
          entries={overflowEntries}
        />
        <button
          className="ag-tap-icon"
          type="button"
          title={prefs.open ? t.collapse : t.expand}
          aria-label={prefs.open ? t.collapse : t.expand}
          onClick={e => { e.stopPropagation(); setBand({ open: !prefs.open }) }}
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
            width: BAND_CONTROL_H, height: BAND_CONTROL_H, padding: 0,
            border: 'none', borderRadius: 6, background: 'transparent',
            color: 'var(--text-secondary)', cursor: 'pointer',
          }}
        >{prefs.open ? <ChevronDown size={14} /> : <ChevronUp size={14} />}</button>
      </div>
      {prefs.open && (
        <div style={{
          ...(prefs.full
            ? { flex: '1 1 auto', minHeight: 0 }
            : { height: Math.max(BAND_MIN_PX, renderedHeight), flexShrink: 0 }),
          display: 'flex', flexDirection: 'column', gap: 6, padding: '0 12px 10px',
        }}>
          {/* EXCLUDED (C3): the right slot already shows this exact target — see
              `excludedFromDocked` above. Never render the screen for it here too. */}
          {streamId && !excludedFromDocked ? screen : <div style={{ flex: 1 }} />}
          {notice}
          {ceilingList}
        </div>
      )}
    </div>
  )
}
