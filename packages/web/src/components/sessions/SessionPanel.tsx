/**
 * SessionPanel — one selected session, as a terminal or as a conversation.
 *
 * The two views answer different questions and neither replaces the other. The TERMINAL is the
 * whole truth: everything the assistant draws, tool output included, and the only place a dialog
 * can be answered. The CHAT is the readable half: what was actually said, with the box drawing and
 * the status strip gone.
 *
 * So the toggle is per session and it defaults to CHAT where a chat can exist and to TERMINAL where
 * it cannot. Where it cannot, the Chat segment is ABSENT rather than disabled — a control that is
 * present and refuses teaches nothing, while its absence plus the sentence in the panel says which
 * harnesses can do this and why yours cannot.
 *
 * ON DESKTOP this panel draws NO header of its own any more — the title, the Chat/Terminal tabs and
 * the "···" actions moved UP into the shared sticky header in `App.tsx`, right below the fleet's
 * filter bar. Two bordered strips stacked on top of each other said the same thing twice; one strip
 * is the whole point of sharing a header with the filters at all. `view`/`onViewChange` being
 * PROVIDED is the signal that the caller is showing that shared header (desktop): this component
 * then reads the view instead of owning it and renders no header. On MOBILE, where the shared header
 * is hidden for lack of room, this panel is still fully self-contained — `SessionsPage`'s mobile
 * branch passes neither prop, and the header below returns.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { ChevronDown, ChevronUp, FolderTree, MessagesSquare, PanelRightOpen, TerminalSquare, X } from 'lucide-react'
import { getCentralMachine } from '../../lib/centralMachinePick'
import { useIsMobile } from '../../hooks/useIsMobile'
import { resolveForViewport, usePanelSlots } from '../../lib/panelSlots'
import { RelayedScreen } from './RelayedScreen'
import type { ControlSession } from '@agentistics/tui/control/session-fleet'
import type { FleetActionId, FleetRow } from '../../lib/fleet'
import { TerminalRegion } from '../RecentSessions'
import { SessionChat, type SessionChatProps } from './SessionChat'
import { SessionActions } from './SessionActions'
import { ShellBand } from './ShellBand'
import { targetLabel } from '../../lib/terminalTarget'
import { BAND_MIN_PX, readBandPrefs, resolveBandHeight, writeBandPrefs } from '../../lib/shellBand'
import { bandSegmentEntries } from '../../lib/bandSegment'
import { BandLabeledButton, BandSegment, BandSegmentTab } from './bandControls'

export type SessionView = 'chat' | 'terminal'

export interface SessionPanelProps {
  session: ControlSession
  /** The shaped row, for the terminal's own composer and verb list. */
  row?: FleetRow
  lang: 'pt' | 'en'
  theme: 'dark' | 'light'
  act: (req: { id: string; action: FleetActionId; text?: string; choice?: number })
    => Promise<{ ok: boolean; message: string; id?: string }>
  authorName?: string
  /** Called after a verb that removes the row — the panel has nothing left to show. */
  onGone?: () => void
  /**
   * A verb REPLACED this session with another — go to it.
   *
   * Reopening mints a NEW managed id for the same conversation, retires the row it replaced, and
   * `collapseSupersededSessions` then drops the old row from the fleet entirely. Without this the
   * panel stays selecting an id that no longer resolves: it empties, and every button on it acts on
   * a row the server cannot find. Reported as "reabri uma sessão fechada e não me permitia stopar
   * ela". `SessionActions` has always answered with the new id; only this surface was not listening.
   */
  onOpened?: (id: string) => void
  /** Provided together — see the module header. Their presence means "a shared header up in
   *  App.tsx already shows the title/tabs/actions for this session; draw none of your own." */
  view?: SessionView
  onViewChange?: (v: SessionView) => void
  /** Passed straight to `SessionChat` — see its own `onArtifacts`. This panel reads none of it. */
  onArtifacts?: SessionChatProps['onArtifacts']
  /**
   * OPEN THE TERMINAL ON ITS OWN SCREEN.
   *
   * A callback and not a path, for the reason `onOpenFull` is one on the metrics card: this panel
   * does not know how the surface around it navigates. Absent where there is nowhere to go, and
   * then the enlarge control is ABSENT too rather than inert.
   */
  onOpenTerminal?: () => void
  /** Take the SHELL to its own screen. Absent where there is no route to take it to. */
  onOpenShellFullscreen?: () => void
  /**
   * May this machine serve a per-session utility SHELL right now — `CAPS.localShell` AND the
   * user's own switch, as `/api/team/session` reports it.
   *
   * Absent reads as OFF, and the band is then ABSENT rather than present-and-refusing: a control
   * that is there and says no teaches nothing, while Settings → Sessions is where the switch lives
   * and says so. It is never inferred from `capabilities.localShell` alone — that is the profile's
   * answer, and the switch may only ever narrow it further.
   */
  shellEnabled?: boolean
  /**
   * May this machine serve the repository explorer at all — the same already-resolved
   * `editorEnabled` `ArtifactsAside` used to read. Gates whether the BOTTOM band may ever show the
   * Studio: absent reads as OFF, exactly as `shellEnabled` does.
   */
  editorEnabled?: boolean
  /**
   * The DOM box the Studio's persistent host should physically move into while it occupies the
   * BOTTOM slot and the band is expanded — see `StudioHost.tsx`, mounted by the caller (this
   * component owns no Monaco of its own). `null` while the band is collapsed or the Studio sits
   * elsewhere, which is also what the caller reads as "park it".
   */
  onStudioBandRef?: (el: HTMLDivElement | null) => void
}

export function SessionPanel({ session, row, lang, theme, act, authorName, onGone, onOpened, view: viewProp, onViewChange, onArtifacts, shellEnabled, editorEnabled, onOpenTerminal, onOpenShellFullscreen, onStudioBandRef }: SessionPanelProps) {
  /**
   * Is this a session of ANOTHER machine, reached through the relay?
   *
   * Asked of the picker rather than of the row, because it is a fact about THIS page: a central
   * shows one machine's relayed fleet at a time, and every route this panel would otherwise call
   * (`/api/fleet/stream`, the chat read) is the machine's own and refused here. The row cannot
   * answer it — a relayed row is deliberately shaped like a local one so the list needs no branch.
   *
   * The CONVERSATION is unavailable too, and not by omission: on-demand chat retrieval was removed
   * from the reverse channel and `GET /api/team/session-chat` answers 410. So the toggle is not
   * offered, exactly as it is not offered for a harness that can never name its conversation — a
   * segmented control with one working segment is a label pretending to be a control.
   */
  const relayed = getCentralMachine() !== null
  const pt = lang === 'pt'

  /**
   * Can this session be read as a conversation at all?
   *
   * `conversationBlind` is the row's own sentence for a harness that can never report which
   * conversation it is writing. Reused rather than re-derived: the row, the chat view and this
   * toggle must give one answer, and this is the one place that could quietly disagree.
   */
  const chattable = session.conversationBlind === undefined && !relayed

  // Uncontrolled (mobile, self-contained) unless the caller hands in `onViewChange` — see the
  // module header. The local state is still declared unconditionally (hooks can't be), it is just
  // never read when a controlled view is in play.
  const [localView, setLocalView] = useState<SessionView>(chattable ? 'chat' : 'terminal')
  const controlled = onViewChange !== undefined
  const view = controlled ? (viewProp ?? 'chat') : localView
  const setView = controlled ? onViewChange! : setLocalView
  const active: SessionView = chattable ? view : 'terminal'

  /**
   * WHERE THE STUDIO SITS — `lib/panelSlots.ts`, design §1. Read through `resolveForViewport` with
   * this component's OWN `isMobile`, or a phone here and the desktop `SessionsPage` that mounts
   * `StudioHost` could disagree about whether the bottom slot exists at all — a phone has no docked
   * band (`dockedAllowed` in `terminalSurface.ts`), so a stored `bottom: 'studio'` must read as
   * absent here exactly as it reads as the right sheet there.
   */
  const isMobile = useIsMobile()
  const {
    layout: rawSlotLayout, openPanel: openSlotPanel, closePanel: closeSlotPanel,
    movePanel: moveSlotPanel, setBottomOpen,
  } = usePanelSlots()
  const slotLayout = resolveForViewport(rawSlotLayout, isMobile)
  const bottomIsStudio = !isMobile && editorEnabled === true && slotLayout.bottom === 'studio'

  /**
   * THE CENTRE COLUMN'S OWN HEIGHT, MEASURED (design item 7) — what "full" means for the bottom
   * band. `window.innerHeight` was the wrong number even before this: it is the WHOLE viewport,
   * mobile status-bar insets and all, while the band must never cover more than the column it
   * actually docks inside (the mobile header above it, on the branch that has one; never the left
   * or right aside, which are beside this column, not above or below it). A `ResizeObserver` on
   * this component's own outer box is the same pattern `Studio.tsx`'s `measure` uses for the
   * tree/editor split, for the same reason: the box can change size for causes with no event of
   * their own (a sidebar drag, a window resize, an aside opening).
   */
  const [columnHeight, setColumnHeight] = useState(0)
  const columnObserver = useRef<ResizeObserver | null>(null)
  const measureColumn = useCallback((el: HTMLDivElement | null) => {
    columnObserver.current?.disconnect()
    columnObserver.current = null
    if (el === null) return
    setColumnHeight(el.getBoundingClientRect().height)
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(entries => {
      const h = entries[0]?.contentRect.height
      if (h !== undefined) setColumnHeight(h)
    })
    ro.observe(el)
    columnObserver.current = ro
  }, [])
  useEffect(() => () => { columnObserver.current?.disconnect() }, [])

  return (
    // `flex: 1` + `minHeight: 0`, NOT `height: 100%`. In a column flex container a percentage
    // height on an item that is itself being flexed does not reliably resolve, and when it does not
    // the scroll container inside grows to its content instead of scrolling — which is the single
    // cause of two reported bugs: the conversation opening at the top (scrollTop on a non-scrolling
    // element does nothing) and the jump-to-latest arrow never appearing (`scrollHeight` equals
    // `clientHeight`, so the reader always measures as "at the tail").
    <div ref={measureColumn} style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
      {/* MOBILE ONLY now — see the module header. PINNED exactly as before: `flexShrink: 0` plus
          `position: sticky` as the second, independent guarantee. */}
      {!controlled && (
      <header style={{
        display: 'flex', alignItems: 'center', gap: 12,
        padding: '12px 20px', borderBottom: '1px solid var(--border)',
        background: 'var(--bg-surface)',
        flexShrink: 0, minWidth: 0, position: 'sticky', top: 0, zIndex: 2,
      }}>
        <div style={{ minWidth: 0, flex: 1 }}>
          <h1 style={{
            margin: 0, fontSize: 15, fontWeight: 650, color: 'var(--text-primary)',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>
            {session.title}
          </h1>
          <p style={{
            margin: '2px 0 0', fontSize: 11.5, color: 'var(--text-tertiary)',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>
            {session.stateLabel}
            {session.task ? ` · ${session.task}` : ''}
            {session.project ? ` · ${session.project}` : ''}
          </p>
        </div>

        {/* THE `Conversa | Terminal` TOGGLE IS GONE, and its absence is the design.
            A session opens on its CONVERSATION — that is what a session is — and the terminals are
            reached from the BAND at the foot of the panel, which names both of them. Two controls
            for one decision, in two places, with different words ("Terminal" here, "Assistente"
            there) was the ambiguity phase 1 set out to avoid and this header reintroduced. */}

        {/* The row's verbs. Every one of them, its label and whether it is enabled arrive already
            decided by `sessionActions` — the same answer the terminal cockpit resolves against. */}
        {row && (
          <SessionActions
            row={row}
            lang={lang}
            act={act}
            {...(onGone ? { onGone } : {})}
            {...(onOpened ? { onOpened } : {})}
          />
        )}
      </header>
      )}

      <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {/* KEYED BY THE SESSION, and this is a correctness fix rather than a hint to React.
            Without it the same instance is reused when `session` changes, so every piece of state
            that is READ ONCE AT MOUNT belongs to whichever session was open first: the draft
            (`useState(() => readDraft(session.id))`), the attachments, and the in-flight `sending`
            / `stopping` flags.
            Reported, and it is the worst shape this could take: a message typed for one session
            was sent into ANOTHER after switching rows mid-request, with every button in the new
            session's composer stuck on a spinner that belonged to the old one. Per-session state
            must not outlive the session, and a `key` is how React is told that. */}
        {active === 'chat' ? (
          <SessionChat
            key={session.id}
            session={session} {...(row ? { row } : {})} lang={lang} act={act}
            {...(onArtifacts ? { onArtifacts } : {})}
            /* THE SAME callback the row's menu gets. There are two Reopen buttons on this
               screen — the menu's verb and the composer's — and they must land in one place. */
            {...(onOpened ? { onReopened: onOpened } : {})}
          />
        ) : relayed ? (
          /* ANOTHER MACHINE's session. The live stream is the machine's own SSE route, refused on a
             central and not relayed — so `TerminalRegion` would connect to nothing and say so,
             which is honest and useless. What the machine sends is its last captured frame, and
             `RelayedScreen` draws that while saying it is a snapshot. */
          <RelayedScreen {...(session.lastLines ? { lines: session.lastLines } : {})} lang={lang} />
        ) : (
          <div style={{ flex: 1, minHeight: 0, padding: 16, display: 'flex', flexDirection: 'column' }}>
            {/* The very component the sessions list uses. Assembling a second one from the stream
                hook, the emulator and a composer would be three things that must agree about
                reconnects, stalls, zoom and the consent gate on typing into a live session. */}
            <TerminalRegion
              /* REPLACING the conversation, and inside the workspace — so focus is the consent and
                 a phone gets the key strip. See `lib/terminalSurface.ts`. */
              placement="replacing"
              {...(onOpenTerminal ? { onMaximize: onOpenTerminal } : {})}
              id={session.id}
              theme={theme}
              lang={lang}
              fill
              {...(row ? { row } : {})}
              act={act}
              {...(authorName ? { authorName } : {})}
            />
          </div>
        )}
      </div>

      {/* THE LAST BAND, below everything — the VS Code geometry, where the panel is always the
          bottom-most strip. It is deliberately OUTSIDE the view switch: a shell you opened to run
          `bun test` must not vanish because you moved from the conversation to the assistant's own
          screen. It is keyed by session, so switching rows unmounts it — which is also what drops
          its stream, the client half of the unwatch discipline.

          Absent on a RELAYED session for the same reason the live stream is: those routes are the
          machine's own and a central refuses them outright, so a band there could only ever draw a
          refusal. Absent when the machine does not serve shells at all — see `shellEnabled`.

          THE STUDIO CAN OCCUPY THIS SAME BAND (`lib/panelSlots.ts`'s `bottom` slot), and when it
          does this renders a SEPARATE small band rather than teaching `ShellBand` a third target:
          `ShellBand` bundles the session's own pane and the shell because both are terminal STREAMS
          answering the one consent/geometry machinery in `lib/terminalSurface.ts` — the Studio is
          neither, and its own persistent host (`StudioHost`, mounted once by `SessionsPage`) is what
          must never be torn down by an ordinary collapse. `key={session.id}` still resets the band's
          own open/collapsed feel per session; the Studio's own mount lives one level up. */}
      {bottomIsStudio ? (
        <StudioBand
          key={session.id}
          lang={lang}
          open={slotLayout.bottomOpen}
          columnHeight={columnHeight}
          onToggleOpen={() => setBottomOpen(!slotLayout.bottomOpen)}
          onMoveToRight={() => moveSlotPanel('studio', 'right')}
          onClose={() => closeSlotPanel('studio')}
          // Claude Code and Shell join the same segment (design §1.3) — picking either DISPLACES
          // the Studio through `panelSlots.openPanel`, asking first only when it is dirty
          // (`showPanel`'s own `studioDisplaced` check), never a second, redundant question.
          {...(!relayed ? { onSelectCli: () => openSlotPanel('cli', 'bottom') } : {})}
          {...(shellEnabled && !relayed ? { onSelectShell: () => openSlotPanel('shell', 'bottom') } : {})}
          harness={session.harness}
          {...(onStudioBandRef ? { contentRef: onStudioBandRef } : {})}
        />
      ) : shellEnabled && !relayed && (
        <ShellBand
          key={session.id}
          sessionId={session.id}
          {...(session.cwd ? { cwd: session.cwd } : {})}
          {...(onOpenShellFullscreen ? { onOpenFullscreen: onOpenShellFullscreen } : {})}
          {...(session.harness ? { harness: session.harness } : {})}
          lang={lang}
          theme={theme}
          columnHeight={columnHeight}
          studioEnabled={editorEnabled === true}
          onSelectStudio={() => openSlotPanel('studio', 'bottom')}
          onSelectTerminal={id => openSlotPanel(id, 'bottom')}
          /*
           * `openSlotPanel`, deliberately NOT `moveSlotPanel` (C3's second half). The docked band's
           * own `cli`/`shell` preference (`shellBand.ts`'s `target`) is never written through
           * `panelSlots` except on an explicit tab click, so on a fresh session (or before the first
           * click) `slotLayout.bottom` had never recorded what this band was already showing —
           * `movePanel` refuses when its panel is not shown in EITHER slot, so "move to the right"
           * was a silent no-op the very first time. `openPanel` places it regardless of whether
           * `panelSlots` had ever heard of it there, which is exactly right: what the band is
           * showing right now IS what the person means to move.
           */
          onMoveToRight={id => openSlotPanel(id, 'right')}
        />
      )}
    </div>
  )
}

/**
 * StudioBand — the bottom band's OWN small bar while it holds the Studio, mirroring `ShellBand`'s
 * desktop bar (the whole strip toggles, the collapse chevron sits on the right) without any of its
 * terminal-target machinery. Collapsing NEVER drops the Studio: `contentRef`'s box is rendered only
 * while `open`, and the caller (`SessionsPage`) reads that same fact as "park it" rather than
 * "unmount it" — see `StudioHost.tsx`.
 *
 * FREE-RESIZING, WITH THE SAME SNAP-TO-FULL `ShellBand` HAS (design item 7) — the two bands share
 * ONE persisted height/full record (`shellBand.ts`'s `readBandPrefs`/`writeBandPrefs`, the same
 * `agentistics-shell-band` storage key), so a reader who has learned "drag this near the top to
 * fill the column" gets the identical feel switching between the Studio and the assistant's own
 * pane in the same band — two implementations of one gesture, sharing one memory, is the point.
 * `open` and `target` are untouched here: THIS band's open/closed state comes from `panelSlots.ts`
 * (`slotLayout.bottomOpen`, passed in as `open`), not from the shared record's own `open` field,
 * which is `ShellBand`'s alone — only `height`/`full` are read and written from here.
 */
function StudioBand({
  lang, open, columnHeight, onToggleOpen, onMoveToRight, onClose, onSelectCli, onSelectShell, harness, contentRef,
}: {
  lang: 'pt' | 'en'
  open: boolean
  /** The centre column's own measured height — what "full" resolves against. `0` = not measured
   *  yet, and `resolveBandHeight` already reads that as "never snap". */
  columnHeight: number
  onToggleOpen: () => void
  onMoveToRight: () => void
  onClose: () => void
  /** Present only when the target may be reached — absent, never disabled, per §1.5's gates. Picking
   *  either DISPLACES the Studio (`openPanel('cli'|'shell', 'bottom')`), asking first only if it is
   *  dirty — the same segment `ShellBand`'s own docked bar shows for cli/shell, now offering Studio
   *  back the other way. */
  onSelectCli?: () => void
  onSelectShell?: () => void
  harness?: string
  contentRef?: (el: HTMLDivElement | null) => void
}) {
  const pt = lang === 'pt'
  const [heightPrefs, setHeightPrefs] = useState(() => {
    const p = readBandPrefs()
    return { height: p.height, full: p.full === true }
  })
  const applyHeight = useCallback((next: { height: number; full: boolean }) => {
    setHeightPrefs(next)
    // `full: false` is written by OMISSION (never as a literal `false`) — matching how
    // `readBandPrefs` treats the two the same way, and what stops a stale `full: true` from a
    // PREVIOUS session surviving an ordinary resize that no longer asks for it.
    const { full: _previousFull, ...rest } = readBandPrefs()
    void _previousFull
    writeBandPrefs({ ...rest, height: next.height, ...(next.full ? { full: true } : {}) })
  }, [])
  const renderedHeight = heightPrefs.full && columnHeight > 0 ? columnHeight : heightPrefs.height
  const dragRef = useRef<{ startY: number; startH: number } | null>(null)
  const onDragStart = (clientY: number) => { dragRef.current = { startY: clientY, startH: renderedHeight } }
  useEffect(() => {
    const move = (clientY: number) => {
      const d = dragRef.current
      if (!d) return
      // Grows UPWARD, exactly like `ShellBand`'s own handle: docked at the bottom, so dragging up
      // must make it taller.
      applyHeight(resolveBandHeight(d.startH + (d.startY - clientY), columnHeight))
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
  }, [applyHeight, columnHeight])
  return (
    <div style={{
      // FULL (design item 7) makes THIS ROOT flex-stretch within `SessionPanel`'s own column,
      // competing with the chat area's own `flex: 1, minHeight: 0` for the same space — which is
      // what lets the band reach the column's actual height without ever measuring a pixel figure
      // that has to subtract the chat area's chrome by hand. Not full: sized by its own content
      // (the bar plus whatever explicit height the content box below asks for), same as always.
      ...(heightPrefs.full ? { flex: '1 1 auto', minHeight: 0 } : { flexShrink: 0 }),
      display: 'flex', flexDirection: 'column',
      borderTop: '1px solid var(--border)', background: 'var(--bg-surface)',
    }}>
      <div
        role="button"
        tabIndex={0}
        aria-expanded={open}
        aria-label={pt ? 'Abrir ou recolher o Studio' : 'Open or collapse the Studio'}
        onClick={onToggleOpen}
        onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onToggleOpen() } }}
        style={{
          display: 'flex', alignItems: 'center', gap: 8, padding: '4px 12px', minHeight: 32,
          cursor: 'pointer', userSelect: 'none',
        }}
      >
        <span style={{ color: 'var(--anthropic-orange)', display: 'inline-flex' }}><FolderTree size={14} /></span>
        <span style={{ fontSize: 11.5, fontWeight: 700, letterSpacing: 0.4, color: 'var(--text-secondary)' }}>
          STUDIO
        </span>
        {/* THE SPACER COMES BEFORE THE SEGMENT, not after — this is the whole fix for item 1. The
            band's header must not change SHAPE with its occupant: `ShellBand`'s own desktop bar
            (this same band, showing `cli`/`shell` instead) has always put its segment on the RIGHT,
            right before the move/close/collapse icon buttons — a spacer, then the segment, then the
            icons. This bar used to put the segment right after the "STUDIO" label instead, which
            read as the segment sitting on the LEFT the moment the Studio (rather than Claude Code or
            Shell) was the band's occupant — reported with a screenshot circling exactly that jump. */}
        <span style={{ flex: 1 }} />
        {/* THE SEGMENT ALWAYS OFFERS ALL THREE (design item 2, screenshot 2 — "when I open the
            Studio it disappears from the tab menu"): this bar used to draw only `cli`/`shell` here,
            because "what else can I switch to" was answered by hand a second time and Studio was
            never asked about itself. `bandSegmentEntries` is the SAME pure function `ShellBand`'s
            own docked segment calls, so the two can never draw a different answer for the same
            occupant again — Studio simply reads `on` here, since this bar IS the Studio. */}
        <div onClick={e => e.stopPropagation()}>
          <BandSegment label={pt ? 'Qual terminal' : 'Which terminal'} isMobile={false}>
            {bandSegmentEntries('studio', { cli: !!onSelectCli, shell: !!onSelectShell, studio: true })
              .map(({ id, on }) => (
                <BandSegmentTab
                  key={id}
                  on={on}
                  onClick={id === 'cli' ? onSelectCli! : id === 'shell' ? onSelectShell! : () => {}}
                  icon={id === 'studio' ? <FolderTree size={11} /> : undefined}
                  label={id === 'studio' ? 'Studio' : targetLabel(id, harness, lang)}
                />
              ))}
          </BandSegment>
        </div>
        {/* item 5 (screenshot 4): a distinct, conventional icon PLUS a visible label on desktop —
            the plain icon pair here was circled as confusing beside the aside's own move control.
            item 3 (screenshot 1): the SAME shared control every other labelled button in this
            family (the band's own move/close/collapse trio, the Studio bar's tree toggles) renders
            through, so none of them can drift into a different height/padding again. */}
        <BandLabeledButton
          isMobile={false}
          onClick={e => { e.stopPropagation(); onMoveToRight() }}
          label={pt ? 'Mover o Studio para a direita' : 'Move the Studio to the right'}
          visibleText={pt ? 'Mover para a direita' : 'Move to the right'}
        ><PanelRightOpen size={13} /></BandLabeledButton>
        <BandLabeledButton
          isMobile={false}
          onClick={e => { e.stopPropagation(); onClose() }}
          label={pt ? 'Fechar o Studio' : 'Close the Studio'}
          visibleText={pt ? 'Fechar' : 'Close'}
        ><X size={13} /></BandLabeledButton>
        <BandLabeledButton
          isMobile={false}
          onClick={e => { e.stopPropagation(); onToggleOpen() }}
          label={open ? (pt ? 'Recolher o Studio' : 'Collapse the Studio') : (pt ? 'Expandir o Studio' : 'Expand the Studio')}
          visibleText={open ? (pt ? 'Recolher' : 'Collapse') : (pt ? 'Expandir' : 'Expand')}
        >{open ? <ChevronDown size={13} /> : <ChevronUp size={13} />}</BandLabeledButton>
      </div>
      {open && (
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          {/* THE DRAG HANDLE (design item 7) — free-resizing, no low ceiling, and it SNAPS to fill
              the centre column within `BAND_SNAP_THRESHOLD_PX` of its top; see `resolveBandHeight`
              and this component's own header for why the height/full record is SHARED with
              `ShellBand`. Same geometry as that band's own handle: on the TOP edge, grows upward. */}
          <div
            role="separator"
            aria-orientation="horizontal"
            aria-label={pt ? 'Redimensionar o Studio' : 'Resize the Studio'}
            tabIndex={0}
            onMouseDown={e => { e.preventDefault(); onDragStart(e.clientY) }}
            onTouchStart={e => { const p = e.touches[0]; if (p) onDragStart(p.clientY) }}
            onKeyDown={e => {
              if (e.key === 'ArrowUp') { e.preventDefault(); applyHeight(resolveBandHeight(renderedHeight + 24, columnHeight)) }
              if (e.key === 'ArrowDown') { e.preventDefault(); applyHeight(resolveBandHeight(renderedHeight - 24, columnHeight)) }
            }}
            style={{ height: 6, cursor: 'ns-resize', background: 'transparent' }}
          />
          <div style={{
            // NOT full: an explicit pixel height, because the ROOT above is auto-sized (content
            // decides it) and has no box of its own to hand this one a share of. FULL: the ROOT is
            // itself flex-stretched (see its own style, above), so this box in turn just takes
            // `flex: 1` of THAT — the same two-step every other flexed box in this file uses.
            ...(heightPrefs.full
              ? { flex: '1 1 auto', minHeight: 0 }
              : { height: Math.max(BAND_MIN_PX, renderedHeight), flexShrink: 0 }),
            display: 'flex', flexDirection: 'column', padding: '0 12px 10px',
          }}>
            <div ref={contentRef} style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }} />
          </div>
        </div>
      )}
    </div>
  )
}

// The band's own controls (the move/close/collapse trio, the "which terminal" segment) now render
// through `bandControls.tsx` — see its own header for why the two near-duplicate implementations
// that used to live here (`studioBandIconBtn`/`studioBandLabeledBtn`, and a `Segment` component
// exported for exactly this purpose and never actually imported anywhere) were the drift design
// item 3 exists to close, not a second one to keep beside it.
