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

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { ChevronDown, ChevronUp } from 'lucide-react'
import { getCentralMachine } from '../../lib/centralMachinePick'
import { ResizeGrip } from '../ResizeGrip'
import { useIsMobile } from '../../hooks/useIsMobile'
import { useElementWidth } from '../../hooks/useElementWidth'
import { resolveForViewport, rightSlotShowing, usePanelSlots } from '../../lib/panelSlots'
import { closeArtifacts, openArtifacts, useArtifacts } from '../../lib/artifactsStore'
import {
  bandBarCompact, bottomBandFor, gatedBottomOccupant, panelBarEntries, resolvePanelBarPick,
  type PanelBarEntry, type PanelBarGates, type PanelBarId,
} from '../../lib/panelBar'
import type { TerminalTarget } from '../../lib/terminalTarget'
import { panelMenuEntries } from '../../lib/panelMenu'
import { RelayedScreen } from './RelayedScreen'
import type { ControlSession } from '@agentistics/tui/control/session-fleet'
import type { FleetActionId, FleetRow } from '../../lib/fleet'
import { TerminalRegion } from '../RecentSessions'
import { SessionChat, type SessionChatProps } from './SessionChat'
import { SessionActions } from './SessionActions'
import { SessionTitleFlag } from './SessionTitleFlag'
import { ShellBand } from './ShellBand'
import {
  BAND_MIN_PX, readBandPrefs, resolveBandDrag, resolveBandHeight, writeBandPrefs,
} from '../../lib/shellBand'
import {
  BAND_CONTROL_H, PanelBar, PanelFixedControls, panelMenuIconFor, type BandOverflowEntry,
} from './bandControls'

export type SessionView = 'chat' | 'terminal'

/**
 * THE ONE "cover the whole viewport in place" full-screen overlay z-index — below every modal
 * (`ConfirmModal` is 2000, `primitives.tsx`), ABOVE the sticky header it is deliberately covering.
 * Used by `StudioBand` and, as of 2026-09-19 (`fullscreenModeFor`'s own `'overlay'` mode), by the
 * new Contents/Hardware bottom bands here AND by `SessionsPage.tsx`'s own right-slot overlay — one
 * constant, so a panel reads the identical stacking whichever slot or band it is fullscreened from.
 *
 * MEASURED, not guessed: `TopBar.tsx`'s own header is `position: fixed` at `zIndex: 300` — a plain
 * `90` sat visually BEHIND it despite `getBoundingClientRect()` confirming the full-screen box
 * really did cover `{0, 0, 1440, 900}`; `document.elementFromPoint()` on the header's own row
 * answered with the header, not the band, which is what "full screen" covering everything except
 * the one bar it most needed to cover looks like. `320` clears the header with room to spare while
 * staying under the first ordinary dialog tier (`SessionDrilldownModal` and friends start at 350).
 */
export const PANEL_FULLSCREEN_Z = 320

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
  /**
   * Take WHICHEVER PANE the docked band is showing — `cli` or `shell` — to its own screen. Absent
   * where there is no route to take it to. The band tells this callback which one it is on
   * (`ShellBand`'s own `onOpenFullscreen`), so a reader pressing "full screen" while reading the
   * Claude Code pane lands on the Claude Code pane, not the shell's.
   */
  onOpenShellFullscreen?: (target: TerminalTarget) => void
  /**
   * May this machine serve a per-session utility SHELL right now — `CAPS.localShell` AND the
   * user's own switch, as `/api/team/session` reports it.
   *
   * Absent reads as OFF. It no longer decides whether the bottom band exists at all — see
   * `lib/panelBar.ts`'s own `bottomBandFor` for why that was the bug — only whether `ShellBand`
   * offers the SHELL half of what it can show: with it off, the segment drops the Shell tab
   * (`panelBarEntries`' own `shell` gate) and `ShellBand` itself never shows or opens a shell pane
   * (its own `shellEnabled` prop), while the CLI pane — the session's own harness terminal, not the
   * shell — stays fully reachable. It is never inferred from `capabilities.localShell` alone — that
   * is the profile's answer, and the switch may only ever narrow it further.
   */
  shellEnabled?: boolean
  /** `CAPS.localShell` alone, never narrowed by the preference — see `ShellBand`'s own prop of the
   *  same name for why the disabled-shell empty state needs both this AND `shellEnabled`. */
  shellCapable?: boolean
  /** Straight through to `ShellBand`'s own prop of the same name — see there. */
  onShellEnabledChange?: () => void | Promise<void>
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
  /** Hardware reads THIS machine's own process list — offered on the panel bar unless this session
   *  is viewed through a central (`!isCentral`, the same fact the header's old switcher read). */
  hardwareOffered?: boolean
  /** The Studio entry's first-open dot — `App.tsx`'s own `studioSeen`, so every surface that can
   *  open the Studio clears the same one flag. */
  studioSeen?: boolean
  /** A task was just created and linked from the bottom bar's own task control — see
   *  `SessionTitleFlag`'s own `onLinked`. */
  onTaskLinked?: () => void
  /**
   * IS THE STUDIO'S BOTTOM BAND IN TRUE FULL SCREEN — the whole viewport, not merely "fills the
   * centre column". Owned by `SessionsPage` (the caller), because it has to hand the SAME flag to
   * `Studio.tsx` itself, a sibling mount reached through `StudioHost`'s portal that this component
   * cannot see — a flag `StudioBand` invented locally could never agree with the gear menu's own
   * exit control on which state is current. Absent reads as `false`; see `StudioBand`'s own header.
   */
  studioFullscreen?: boolean
  onStudioFullscreenChange?: (next: boolean) => void
  /**
   * CONTENTS/HARDWARE, DOCKED AT THE BOTTOM (owner, 2026-09-19). This component holds no Monaco-
   * style buffer for either — a plain remount is safe (`panelMenu.ts`'s own `panelMinimizeAction`
   * already says so for the right slot's `close-right`) — so, unlike the Studio, there is no
   * persistent host to re-parent: the CALLER's own already-built element (`SessionsPage`'s
   * `artifactsPane`/`hardwarePaneEl`, the SAME ones the right slot renders) is simply mounted here
   * instead, through `SimpleDockedBand`'s own `children`.
   */
  contentsPane?: ReactNode
  contentsFullscreen?: boolean
  onContentsFullscreenChange?: (next: boolean) => void
  hardwarePane?: ReactNode
  hardwareFullscreen?: boolean
  onHardwareFullscreenChange?: (next: boolean) => void
}

export function SessionPanel({
  session, row, lang, theme, act, authorName, onGone, onOpened, view: viewProp, onViewChange,
  onArtifacts, shellEnabled, shellCapable, onShellEnabledChange, editorEnabled, onOpenTerminal,
  onOpenShellFullscreen, onStudioBandRef, hardwareOffered, studioSeen = true, onTaskLinked,
  studioFullscreen, onStudioFullscreenChange,
  contentsPane, contentsFullscreen, onContentsFullscreenChange,
  hardwarePane, hardwareFullscreen, onHardwareFullscreenChange,
}: SessionPanelProps) {
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
    movePanel: moveSlotPanel, setBottomOpen, setRightOpen,
  } = usePanelSlots()
  const slotLayout = resolveForViewport(rawSlotLayout, isMobile)
  /**
   * WHICH OF THE THREE DESKTOP-ONLY PANELS GENUINELY OCCUPIES THE BOTTOM SLOT RIGHT NOW —
   * `lib/panelBar.ts`'s `bottomBandFor` own input, generalized 2026-09-19 from `studio` alone to
   * also carry `contents`/`hardware` (`panelSlots.ts`'s `BOTTOM_PANELS`, same date). `isMobile` is
   * never re-checked here for `contents`/`hardware`: `resolveForViewport` already clears a
   * desktop-only bottom occupant before this line runs, so `slotLayout.bottom` can only ever be one
   * of them on a genuine desktop viewport.
   *
   * Named `bottomDesktopPanel`, NOT `bottomOccupant` — that name is already `gatedBottomOccupant`'s
   * own result below, which answers a different question (what does the PANEL BAR light) over a
   * different domain (any of the five ids, gated only by the shell switch).
   */
  const bottomDesktopPanel: 'studio' | 'contents' | 'hardware' | null =
    slotLayout.bottom === 'studio' ? (editorEnabled === true ? 'studio' : null)
    : slotLayout.bottom === 'contents' ? 'contents'
    : slotLayout.bottom === 'hardware' ? 'hardware'
    : null

  /** WHICH BAND RENDERS AT THE FOOT OF THE PANEL — `lib/panelBar.ts`'s own `bottomBandFor`. Kept
   *  here as one small pure call rather than as a JSX ternary so the decision can be planted and
   *  tested without mounting anything; see that function's own doc comment for the rule itself. */
  const bottomBand = bottomBandFor({ bottomOccupant: bottomDesktopPanel, relayed, isMobile })

  /**
   * THE ONE PANEL BAR (design item 1) — computed here, where `slotLayout`/`artifactsStore`/`relayed`
   * are all already in scope, and handed down as data + one callback to whichever bottom band
   * actually renders it (`ShellBand`'s desktop bar, `StudioBand`'s bar, the new Contents/Hardware
   * bottom bands, or the no-terminal fallback band below) — so none of them can draw a different bar
   * for the same session.
   *
   * `contents` keeps going through the OLD `artifactsStore` (`openArtifacts`/`closeArtifacts`),
   * deliberately — see `panelSlots.ts`'s own header on why `contents` carries no field of its own
   * there. Every other entry goes through `panelSlots` directly.
   *
   * A TAB NEVER CLOSES ANYTHING ANY MORE (owner, 2026-09-19 — see `onPanelBarPick`'s own doc
   * comment for the fix and why it replaced the old toggle reading). LIT BECAUSE A PANEL IS THE
   * BOTTOM BAND'S OWN OCCUPANT restores it from collapsed if needed and is otherwise a no-op —
   * there is nothing to close FROM in that reading, since the band itself decides what it shows.
   */
  const art = useArtifacts()
  const rightOccupant = rightSlotShowing(slotLayout, art.open)
  const panelBarGates: PanelBarGates = {
    editorEnabled: editorEnabled === true,
    shellEnabled: shellEnabled === true,
    relayed,
    hardwareOffered: hardwareOffered === true,
  }
  // GATED — a stale `bottom: 'shell'` left over from before the switch turned off reads as `'cli'`
  // here too, or the bar would light no tab at all over a pane `ShellBand` draws anyway (its own
  // `target` is clamped the same way independently). See `gatedBottomOccupant`'s own doc comment.
  const bottomOccupant = gatedBottomOccupant(slotLayout.bottom, panelBarGates.shellEnabled)
  const barEntries = panelBarEntries(rightOccupant, bottomOccupant, panelBarGates)
  /**
   * ONE MENU NEVER NAMES A PANEL OTHER THAN ITS OWN (owner, 2026-09-19 — "movi o studio pra direita,
   * mas ao clicar na engrenagem nao aparecem as opcoes corretas de mover"). Before this, whichever
   * band happened to be docked at the bottom offered a `moveDownEntries` row NAMING WHATEVER PANEL
   * SAT ON THE RIGHT — so a reader looking at the Shell's own "⋯" could find "Trazer o Studio para
   * baixo" in it, a verb about a panel that menu had nothing to do with. That panel already has its
   * OWN menu wherever it is actually drawn (the right slot's own header, below, or its own gear for
   * the Studio) offering exactly this move through `panelMenuEntries` — there is nothing left for
   * the CURRENTLY DOCKED band's menu to say about a DIFFERENT panel, so it says nothing.
   *
   * A TAB CLICK SELECTS, IT NEVER TOGGLES — `lib/panelBar.ts`'s own `resolvePanelBarPick`, a PURE
   * function extracted from what used to be three hand-written copies of this exact rule here (one
   * for `studio`, one for `contents`, one shared branch for `hardware`/`cli`/`shell`). See that
   * function's own header for the fix and the three answers it can give; this only wires each
   * answer to the right side effect, one panel at a time — `contents` alone goes through the legacy
   * `artifactsStore` (`panelSlots.ts`'s own header explains why), and `rightOpen` is passed `true`
   * for every panel but `studio` since none of the other four ever parks in the right slot with its
   * content released (`panelMinimizeAction`'s `close-right` removes it from `rightOccupant`
   * entirely instead) — `'restore-right'` is consequently unreachable for them, which is correct.
   */
  const onPanelBarPick = useCallback((id: PanelBarId) => {
    const rightOpen = id === 'studio' ? slotLayout.rightOpen : true
    const action = resolvePanelBarPick({
      id, rightOccupant, bottomOccupant, rightOpen, bottomOpen: slotLayout.bottomOpen,
    })
    if (action.kind === 'noop') return
    if (action.kind === 'restore-right') { setRightOpen(true); return }
    if (action.kind === 'restore-bottom') { setBottomOpen(true); return }
    // action.kind === 'open'
    if (id === 'contents') openArtifacts()
    else openSlotPanel(id)
  }, [
    rightOccupant, bottomOccupant, slotLayout.rightOpen, slotLayout.bottomOpen,
    openSlotPanel, setRightOpen, setBottomOpen,
  ])

  const taskControl = (
    <SessionTitleFlag
      session={{
        id: session.id, title: session.title,
        ...(session.harness ? { harness: session.harness } : {}),
        ...(session.task ? { task: session.task } : {}),
      }}
      lang={lang}
      size={BAND_CONTROL_H}
      {...(onTaskLinked ? { onLinked: onTaskLinked } : {})}
    />
  )

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

          WHICH BAND renders is `bottomBand` (`lib/panelBar.ts`'s `bottomBandFor`, computed above).
          `shellEnabled` no longer decides PRESENCE — only `ShellBand`'s own shell half, through its
          own `shellEnabled` prop below. Absent on a RELAYED session for the same reason the live
          stream is: those routes are the machine's own and a central refuses them outright, so a
          band there could only ever draw a refusal (`bar-only`, or `none` on a phone — untouched by
          this fix, see `bottomBandFor`'s own doc comment).

          THE STUDIO CAN OCCUPY THIS SAME BAND (`lib/panelSlots.ts`'s `bottom` slot), and when it
          does this renders a SEPARATE small band rather than teaching `ShellBand` a third target:
          `ShellBand` bundles the session's own pane and the shell because both are terminal STREAMS
          answering the one consent/geometry machinery in `lib/terminalSurface.ts` — the Studio is
          neither, and its own persistent host (`StudioHost`, mounted once by `SessionsPage`) is what
          must never be torn down by an ordinary collapse. `key={session.id}` still resets the band's
          own open/collapsed feel per session; the Studio's own mount lives one level up. */}
      {bottomBand === 'studio' ? (
        <StudioBand
          key={session.id}
          lang={lang}
          open={slotLayout.bottomOpen}
          columnHeight={columnHeight}
          onToggleOpen={() => setBottomOpen(!slotLayout.bottomOpen)}
          barEntries={barEntries}
          onBarPick={onPanelBarPick}
          studioSeen={studioSeen}
          taskControl={taskControl}
          fullscreen={studioFullscreen === true}
          onFullscreenChange={onStudioFullscreenChange ?? (() => {})}
          {...(session.harness ? { harness: session.harness } : {})}
          {...(onStudioBandRef ? { contentRef: onStudioBandRef } : {})}
        />
      ) : bottomBand === 'shell' ? (
        <ShellBand
          key={session.id}
          sessionId={session.id}
          {...(session.cwd ? { cwd: session.cwd } : {})}
          {...(onOpenShellFullscreen ? { onOpenFullscreen: onOpenShellFullscreen } : {})}
          {...(session.harness ? { harness: session.harness } : {})}
          lang={lang}
          theme={theme}
          columnHeight={columnHeight}
          barEntries={barEntries}
          onBarPick={onPanelBarPick}
          studioSeen={studioSeen}
          // The security narrowing: WHICH of the two panes ShellBand may ever show/open, never
          // whether it renders at all — see this prop's own doc comment on `ShellBand`.
          shellEnabled={panelBarGates.shellEnabled}
          shellCapable={shellCapable !== false}
          {...(onShellEnabledChange ? { onShellEnabledChange } : {})}
          // RAW, ungated — deliberately NOT the `bottomOccupant` const above (which
          // `gatedBottomOccupant` already turned 'shell' into 'cli' for the BAR's own lit-tab
          // reading). `ShellBand` decides for ITSELF whether a genuine 'shell' record is usable —
          // see `resolveDockedTarget`'s own header — and needs the un-clamped slot value to do it,
          // or the very record that should draw the disabled-shell empty state would already read
          // as 'cli' by the time it got here.
          bottomOccupant={slotLayout.bottom === 'cli' || slotLayout.bottom === 'shell' ? slotLayout.bottom : null}
          taskControl={taskControl}
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
      ) : bottomBand === 'contents' ? (
        <SimpleDockedBand
          key={session.id}
          panel="contents"
          panelName={pt ? 'Conteúdo' : 'Contents'}
          lang={lang}
          open={slotLayout.bottomOpen}
          columnHeight={columnHeight}
          onToggleOpen={() => setBottomOpen(!slotLayout.bottomOpen)}
          // `closeSlotPanel('contents')` FIRST — Contents at the bottom is tracked through
          // `panelSlots` (`slotLayout.bottom`), but at the right it is still tracked through the
          // legacy `artifactsStore` flag alone (`panelSlots.ts`'s own header). `openArtifacts()`
          // never clears `slotLayout.bottom`, so skipping this would leave BOTH stores claiming
          // Contents — lit in the bar twice, for two different slots at once.
          onMoveToRight={() => { closeSlotPanel('contents'); openArtifacts() }}
          barEntries={barEntries}
          onBarPick={onPanelBarPick}
          studioSeen={studioSeen}
          taskControl={taskControl}
          fullscreen={contentsFullscreen === true}
          onFullscreenChange={onContentsFullscreenChange ?? (() => {})}
          {...(session.harness ? { harness: session.harness } : {})}
        >
          {contentsPane}
        </SimpleDockedBand>
      ) : bottomBand === 'hardware' ? (
        <SimpleDockedBand
          key={session.id}
          panel="hardware"
          panelName={pt ? 'Hardware' : 'Hardware'}
          lang={lang}
          open={slotLayout.bottomOpen}
          columnHeight={columnHeight}
          onToggleOpen={() => setBottomOpen(!slotLayout.bottomOpen)}
          onMoveToRight={() => openSlotPanel('hardware', 'right')}
          barEntries={barEntries}
          onBarPick={onPanelBarPick}
          studioSeen={studioSeen}
          taskControl={taskControl}
          fullscreen={hardwareFullscreen === true}
          onFullscreenChange={onHardwareFullscreenChange ?? (() => {})}
          {...(session.harness ? { harness: session.harness } : {})}
        >
          {hardwarePane}
        </SimpleDockedBand>
      ) : bottomBand === 'bar-only' && (
        /* THE ONLY CASE LEFT (design item 1: "It must also be present when no terminal is shown at
           the bottom") — a RELAYED session on desktop: no `cli`/`shell` stream of its own to dock,
           the one gap this fix leaves exactly as it found it (`bottomBandFor`'s own doc comment).
           Contents/Studio/Hardware must stay reachable regardless, or removing the header's own copy
           of this bar (item 2) would make them unreachable entirely. `PanelBarBand` is the same bar
           in the same slim shape `ShellBand`'s own collapsed bar takes, minus a stream it has
           nothing to show. */
        <PanelBarBand
          key={session.id}
          lang={lang}
          open={slotLayout.bottomOpen}
          onToggleOpen={() => setBottomOpen(!slotLayout.bottomOpen)}
          barEntries={barEntries}
          onBarPick={onPanelBarPick}
          studioSeen={studioSeen}
          taskControl={taskControl}
          reason="relayed"
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
  lang, open, columnHeight, onToggleOpen, barEntries, onBarPick, studioSeen,
  taskControl, contentRef, fullscreen, onFullscreenChange, harness,
}: {
  lang: 'pt' | 'en'
  open: boolean
  /** The centre column's own measured height — what "full" resolves against. `0` = not measured
   *  yet, and `resolveBandHeight` already reads that as "never snap". */
  columnHeight: number
  onToggleOpen: () => void
  /**
   * TRUE FULL SCREEN — the whole viewport, not merely "fills the centre column" (`heightPrefs.full`,
   * unaffected by this). Owned by `SessionsPage` (it also has to hand the SAME flag to `Studio.tsx`,
   * a sibling mount reached through `StudioHost`'s portal, which this component cannot see), so this
   * is a controlled pair of props rather than local state — see `resolveStudioBandDrag` in
   * `shellBand.ts` for the threshold a drag crosses to request it, and `Studio.tsx`'s own gear menu
   * for the deliberate (non-drag) way to ask for the same thing.
   */
  fullscreen: boolean
  onFullscreenChange: (next: boolean) => void
  /**
   * THE ONE PANEL BAR (design item 1) — the same `entries`/`onPick` `ShellBand`'s desktop bar
   * renders, computed once by `SessionPanel`. Picking Claude Code or Shell from it DISPLACES the
   * Studio (`openPanel('cli'|'shell')`, at whichever slot it last sat in), asking first only if the
   * Studio being displaced is dirty — the same segment `ShellBand`'s own bar shows, now offering
   * Studio back the other way.
   */
  barEntries: readonly PanelBarEntry[]
  onBarPick: (id: PanelBarId) => void
  studioSeen: boolean
  taskControl: ReactNode
  contentRef?: (el: HTMLDivElement | null) => void
  /**
   * THE SESSION'S OWN HARNESS (owner, 2026-09-19: "quando eu to com o studio selecionado fica
   * 'sessão CLI' deveria ficar normalmente o nome do harness e a logo") — this band's own `PanelBar`
   * never received it, so its `cli` tab fell back to the generic "Sessão CLI"/"CLI session" label
   * every time the Studio (not `ShellBand`) was the bottom band's own occupant, which is exactly
   * when a reader is looking at this component. `ShellBand`'s own bar always passed it correctly;
   * this was the one bar that did not.
   */
  harness?: string
}) {
  const pt = lang === 'pt'
  /** The bar's OWN measured width (design item 7), never the window's — see `useElementWidth`'s
   *  own header on why. */
  const [barWidthRef, barWidth] = useElementWidth()
  const compact = bandBarCompact(barWidth)
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
      const resolved = resolveBandDrag(d.startH + (d.startY - clientY), columnHeight)
      // `height`/`full` are ALWAYS applied — never skipped in favour of only flipping `fullscreen`
      // — because they stay exactly what the ORDINARY snap would have answered (see
      // `resolveStudioBandDrag`'s own header): this is what leaves a SANE, column-filling record
      // behind for `renderedHeight` to fall back to the moment full screen is left, rather than
      // whatever the drag's own raw, unbounded number happened to be.
      applyHeight(resolved)
      if (resolved.fullscreen && !fullscreen) {
        onFullscreenChange(true)
        // The gesture is SPENT: once past the threshold there is nothing left a further pixel of
        // mouse movement could mean, and continuing to track it would just keep calling
        // `applyHeight`/`onFullscreenChange` on every subsequent move for no visible effect (the
        // band's own box no longer reads either value once `fullscreen` takes over the layout).
        dragRef.current = null
      }
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
  }, [applyHeight, columnHeight, fullscreen, onFullscreenChange])

  // COLLAPSING EXITS FULL SCREEN TOO — a band collapsed while fullscreen would otherwise leave the
  // flag standing with nothing on screen it still describes, so the NEXT expand would silently
  // reopen full screen from a plain "Expandir" press nobody asked to mean that.
  useEffect(() => {
    if (!open && fullscreen) onFullscreenChange(false)
  }, [open, fullscreen, onFullscreenChange])
  return (
    <div style={{
      // TRUE FULL SCREEN covers the WHOLE VIEWPORT — the sticky header, the fleet aside, everything
      // — not merely the centre column `heightPrefs.full` already fills; `PANEL_FULLSCREEN_Z` sits
      // comfortably below every modal (`ConfirmModal` is 2000) so a "close without saving" dialog
      // still draws over it.
      //
      // FULL (design item 7) is an EXPLICIT PIXEL HEIGHT, never `flex: '1 1 auto'` — see
      // `resolveBandDrag`'s own header in `shellBand.ts` for the whole story of the bug that shape
      // was. `renderedHeight` already resolves to the measured `columnHeight` while `heightPrefs.full`
      // is true, so this is the SAME number the content box below spends via its own `flex: '1 1
      // auto'` — the root states the total, the content box fills whatever the header/handle above it
      // leave over, and the two can never add up to more or less than the column. Gated on `open`:
      // a COLLAPSED band shows only its header row and must stay auto-sized to it, whatever `full`
      // says — the bar's own click is what set `full`, not what asks to render it this frame.
      ...(fullscreen
        ? { position: 'fixed', inset: 0, zIndex: PANEL_FULLSCREEN_Z }
        : open && heightPrefs.full
          ? { height: renderedHeight, flexShrink: 0 }
          : { flexShrink: 0 }),
      display: 'flex', flexDirection: 'column',
      borderTop: '1px solid var(--border)', background: 'var(--bg-surface)',
    }}>
      {/* THE COMPACT BAR (design item 7) — the exact same shape `ShellBand`'s desktop bar takes:
          task control · panel segment (collapsing to icons below ~1100px) · spacer · ONE "⋯"
          overflow menu · the collapse chevron as a plain icon button. The leading "STUDIO" icon and
          label are gone with it — the segment's own lit tab already says "Studio", so the label was
          the same fact painted twice.

          THE TREE'S OWN SHOW/HIDE TOGGLE STAYS WHERE IT ALREADY IS, inside `Studio.tsx`'s own bar,
          and does NOT also appear in this menu — a previous pass removed a floating SECOND way to
          reach it (the collapsed-tree rail) on exactly the principle that there must be exactly ONE
          way back once the tree is minimized. Adding it here would reopen that. */}
      <div
        ref={barWidthRef}
        style={{
          display: 'flex', alignItems: 'center', gap: 8, padding: '4px 12px', minHeight: 32,
        }}
      >
        {taskControl}
        {/* THE ONE PANEL BAR (design item 1) — `PanelBar` is the SAME component `ShellBand`'s
            desktop bar renders, given the SAME `barEntries`/`onBarPick` `SessionPanel` computed for
            both, so the two can never draw a different answer for the same session again — Studio
            simply reads `on` here, since this bar IS the Studio. `harness` (owner, 2026-09-19) is
            what makes its `cli` tab read "Claude Code" here too, instead of the generic fallback —
            see this component's own `harness` prop doc comment. */}
        <PanelBar
          entries={barEntries} lang={lang} studioSeen={studioSeen} onPick={onBarPick} compact={compact}
          {...(harness ? { harness } : {})}
        />
        <span style={{ flex: 1 }} />
        {/* NO SECOND MENU HERE ANY MORE (owner, 2026-09-19: "no studio aparece os 3 pontinhos e a
            engrenagem"). This band's own "Mais ações" used to duplicate move/full-screen/close —
            already offered by `Studio.tsx`'s own ONE gear, rendered a few pixels below this bar in
            the content it portals into — so a reader saw both a "⋯" here and a gear there for the
            SAME panel. Full screen is ALSO no longer a menu row anywhere (§2): it is `Studio.tsx`'s
            own fixed button now, beside its gear. `onMoveToRight`/`onClose` are gone from this
            band's own props with it — `Studio.tsx` already gets `onMove`/`onExit` directly from
            `SessionsPage`, so this band never had anything left to say about either. */}
        {/* THE ONE MINIMIZE CONTROL FOR THIS BAND (owner, 2026-09-19: "botoes que ficaram fixos...
            minimizar... mas ela deve ser laranja") — a plain collapse/expand chevron, ALWAYS this
            band's own accent orange, never the neutral secondary-text colour every other icon here
            uses. It is the ONLY way to collapse or reopen the band; the bar's own click handler
            above is gone (see this file's own module header on the tab-click fix this pairs with —
            a tab SELECTS, a fixed control MINIMIZES, and conflating the two is what let a stray
            click on the tab area silently collapse a panel nobody asked to hide). */}
        <button
          className="ag-tap-icon"
          type="button"
          title={open ? (pt ? 'Recolher' : 'Collapse') : (pt ? 'Expandir' : 'Expand')}
          aria-label={open ? (pt ? 'Recolher o Studio' : 'Collapse the Studio') : (pt ? 'Expandir o Studio' : 'Expand the Studio')}
          onClick={e => { e.stopPropagation(); onToggleOpen() }}
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
            width: BAND_CONTROL_H, height: BAND_CONTROL_H, padding: 0,
            border: 'none', borderRadius: 6, background: 'transparent',
            color: 'var(--anthropic-orange)', cursor: 'pointer',
          }}
        >{open ? <ChevronDown size={14} /> : <ChevronUp size={14} />}</button>
      </div>
      {open && (
        // A FRAGMENT, NOT A DIV — this is the freeze's root cause and the whole fix.
        //
        // The handle and the content box below used to sit inside an extra `<div style={{display:
        // 'flex', flexDirection: 'column'}}>` wrapper, with no `flex`/`minHeight` of its own — so it
        // took only the height its CONTENT asked for (default `flex: 0 1 auto`) instead of growing
        // to fill whatever the ROOT above it (which DOES flex-stretch when `full`) actually had to
        // give it. The content box's own `flex: '1 1 auto'` then had nothing to grow INTO — a
        // flex-grow child cannot exceed a non-growing parent — so both handle and content collapsed
        // to their minimum size and the root's remaining ~400px sat empty below them: the drag
        // reached the top, the band's OWN box did grow (confirmed by measuring it directly), and
        // everything inside it rendered into a sliver at the top, which is what read as "the band
        // went empty… and never became full screen." `ShellBand` never had this bug — its own
        // handle and content box are direct children of ITS root, with no such wrapper — and this
        // fragment makes `StudioBand` match that shape exactly rather than inventing a second one.
        <>
          {/* THE DRAG HANDLE (design item 7) — free-resizing, no low ceiling, and it SNAPS to fill
              the centre column within `BAND_SNAP_THRESHOLD_PX` of its top; see `resolveBandHeight`
              and this component's own header for why the height/full record is SHARED with
              `ShellBand`. Same geometry as that band's own handle: on the TOP edge, grows upward.
              ABSENT in true full screen — there is nothing left to negotiate a HEIGHT for once the
              band covers the whole viewport, and a handle that visually does nothing is worse than
              none: the way back is the chevron above, the gear menu, or Esc, never this drag. */}
          {!fullscreen && (
            <div
              role="separator"
              aria-orientation="horizontal"
              aria-label={pt ? 'Redimensionar o Studio' : 'Resize the Studio'}
              tabIndex={0}
              className="ag-resize-handle"
              onMouseDown={e => { e.preventDefault(); onDragStart(e.clientY) }}
              onTouchStart={e => { const p = e.touches[0]; if (p) onDragStart(p.clientY) }}
              onKeyDown={e => {
                if (e.key === 'ArrowUp') { e.preventDefault(); applyHeight(resolveBandHeight(renderedHeight + 24, columnHeight)) }
                if (e.key === 'ArrowDown') { e.preventDefault(); applyHeight(resolveBandHeight(renderedHeight - 24, columnHeight)) }
              }}
              style={{ height: 6, cursor: 'ns-resize', background: 'transparent' }}
            ><ResizeGrip orientation="horizontal" /></div>
          )}
          <div style={{
            // NOT full/fullscreen: an explicit pixel height, because the ROOT above is auto-sized
            // (content decides it) and has no box of its own to hand this one a share of. FULL OR
            // FULLSCREEN: the ROOT is itself stretched (`flex: 1 1 auto` or `position: fixed;
            // inset: 0` — see its own style, above), so this box in turn just takes `flex: 1` of
            // THAT — the same two-step every other flexed box in this file uses. This only works
            // because it is now a DIRECT child of the root — see the fragment above.
            ...(heightPrefs.full || fullscreen
              ? { flex: '1 1 auto', minHeight: 0 }
              : { height: Math.max(BAND_MIN_PX, renderedHeight), flexShrink: 0 }),
            display: 'flex', flexDirection: 'column', padding: '0 12px 10px',
          }}>
            <div ref={contentRef} style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }} />
          </div>
        </>
      )}
    </div>
  )
}

/**
 * SimpleDockedBand — Contents and Hardware, docked at the bottom (owner, 2026-09-19: "o hardware
 * nao ta com a opcao de abrir no componente inferior e nem o Conteúdo, ambos também deveriam estar
 * aparecendo"). It mirrors `StudioBand`'s own outer chrome (the same free-resizing drag handle,
 * sharing the identical persisted height/full record — a reader who learned "drag near the top to
 * fill the column" gets the same feel here) but renders `children` directly instead of portaling
 * into a persistent host: neither Contents nor Hardware holds client-only state a remount could
 * lose (`panelMenu.ts`'s own `panelMinimizeAction` already says so for the right slot's `close-
 * right`, and the same fact is what makes a plain remount safe here too), so there is nothing here
 * that needs `StudioHost`'s re-parenting trick.
 *
 * UNLIKE `StudioBand`, this band carries the FULL fixed trio in ONE place
 * (`bandControls.tsx`'s `PanelFixedControls`: full screen, minimize, gear) — Contents/Hardware have
 * no toolbar of their own the way Studio does, so there is nowhere else for these three to live.
 */
function SimpleDockedBand({
  panel, panelName, lang, open, columnHeight, onToggleOpen, onMoveToRight, barEntries, onBarPick,
  studioSeen, taskControl, fullscreen, onFullscreenChange, harness, children,
}: {
  panel: 'contents' | 'hardware'
  panelName: string
  lang: 'pt' | 'en'
  open: boolean
  columnHeight: number
  onToggleOpen: () => void
  onMoveToRight: () => void
  barEntries: readonly PanelBarEntry[]
  onBarPick: (id: PanelBarId) => void
  studioSeen: boolean
  taskControl: ReactNode
  fullscreen: boolean
  onFullscreenChange: (next: boolean) => void
  harness?: string
  children: ReactNode
}) {
  const pt = lang === 'pt'
  const [barWidthRef, barWidth] = useElementWidth()
  const compact = bandBarCompact(barWidth)
  // THE SAME persisted height/full record `StudioBand`/`ShellBand` already share (`shellBand.ts`'s
  // `agentistics-shell-band` key) — one memory for "drag near the top to fill the column", however
  // many kinds of panel a reader has parked there over time.
  const [heightPrefs, setHeightPrefs] = useState(() => {
    const p = readBandPrefs()
    return { height: p.height, full: p.full === true }
  })
  const applyHeight = useCallback((next: { height: number; full: boolean }) => {
    setHeightPrefs(next)
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
      const resolved = resolveBandDrag(d.startH + (d.startY - clientY), columnHeight)
      applyHeight(resolved)
      if (resolved.fullscreen && !fullscreen) {
        onFullscreenChange(true)
        dragRef.current = null
      }
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
  }, [applyHeight, columnHeight, fullscreen, onFullscreenChange])
  useEffect(() => {
    if (!open && fullscreen) onFullscreenChange(false)
  }, [open, fullscreen, onFullscreenChange])
  const gearEntries: readonly BandOverflowEntry[] = panelMenuEntries({
    panel, slot: 'bottom', lang, panelName,
  }).map(entry => ({
    id: entry.id, label: entry.label, icon: panelMenuIconFor(entry.iconId),
    onSelect: onMoveToRight,
  }))
  return (
    <div style={{
      ...(fullscreen
        ? { position: 'fixed', inset: 0, zIndex: PANEL_FULLSCREEN_Z }
        : open && heightPrefs.full
          ? { height: renderedHeight, flexShrink: 0 }
          : { flexShrink: 0 }),
      display: 'flex', flexDirection: 'column',
      borderTop: '1px solid var(--border)', background: 'var(--bg-surface)',
    }}>
      <div
        ref={barWidthRef}
        style={{
          display: 'flex', alignItems: 'center', gap: 8, padding: '4px 12px', minHeight: 32,
        }}
      >
        {taskControl}
        <PanelBar
          entries={barEntries} lang={lang} studioSeen={studioSeen} onPick={onBarPick} compact={compact}
          {...(harness ? { harness } : {})}
        />
        <span style={{ flex: 1 }} />
        <PanelFixedControls
          lang={lang}
          panelName={panelName}
          fullscreen={{ active: fullscreen, onToggle: () => onFullscreenChange(!fullscreen) }}
          collapsed={!open}
          onMinimize={onToggleOpen}
          minimizeLabel={open ? (pt ? `Recolher ${panelName}` : `Collapse ${panelName}`)
            : (pt ? `Expandir ${panelName}` : `Expand ${panelName}`)}
          gearLabel={pt ? `Opções — ${panelName}` : `${panelName} options`}
          gearEntries={gearEntries}
        />
      </div>
      {open && (
        <>
          {!fullscreen && (
            <div
              role="separator"
              aria-orientation="horizontal"
              aria-label={pt ? `Redimensionar ${panelName}` : `Resize ${panelName}`}
              tabIndex={0}
              className="ag-resize-handle"
              onMouseDown={e => { e.preventDefault(); onDragStart(e.clientY) }}
              onTouchStart={e => { const p = e.touches[0]; if (p) onDragStart(p.clientY) }}
              onKeyDown={e => {
                if (e.key === 'ArrowUp') { e.preventDefault(); applyHeight(resolveBandHeight(renderedHeight + 24, columnHeight)) }
                if (e.key === 'ArrowDown') { e.preventDefault(); applyHeight(resolveBandHeight(renderedHeight - 24, columnHeight)) }
              }}
              style={{ height: 6, cursor: 'ns-resize', background: 'transparent' }}
            ><ResizeGrip orientation="horizontal" /></div>
          )}
          <div style={{
            ...(heightPrefs.full || fullscreen
              ? { flex: '1 1 auto', minHeight: 0 }
              : { height: Math.max(BAND_MIN_PX, renderedHeight), flexShrink: 0 }),
            display: 'flex', flexDirection: 'column', padding: '0 12px 10px', overflow: 'hidden',
          }}>
            <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, overflow: 'auto' }}>
              {children}
            </div>
          </div>
        </>
      )}
    </div>
  )
}

/**
 * PanelBarBand — the panel bar with nothing docked behind it (design item 1: "It must also be
 * present when no terminal is shown at the bottom"). Renders on a RELAYED session — no `cli`/`shell`
 * stream of its own to show — the one case left with genuinely nothing to dock, so
 * Contents/Studio/Hardware stay reachable rather than vanishing along with the terminal streams.
 *
 * `reason` used to also carry `'shell-off'`: before `bottomBandFor` (`lib/panelBar.ts`) existed, a
 * LOCAL session with the shell switched off fell through to this same band, because `ShellBand` was
 * gated on `shellEnabled` at the call site instead of on its own `shellEnabled` prop. That was the
 * bug this pass fixes — a local session always gets `ShellBand` now (its own CLI pane is the
 * session's harness terminal, never gated by the shell switch), so this band is relayed-only and the
 * reason is no longer a choice.
 *
 * A SLIM BAR ONLY — the same header row `ShellBand`'s own collapsed bar takes (same height, same
 * toggle), minus a stream it has nothing to show. Expanding it reveals one sentence naming WHY there
 * is nothing to dock here, so "Expandir" is never a control whose one outcome is emptiness with no
 * explanation.
 */
function PanelBarBand({
  lang, open, onToggleOpen, barEntries, onBarPick, studioSeen, taskControl, reason,
}: {
  lang: 'pt' | 'en'
  open: boolean
  onToggleOpen: () => void
  barEntries: readonly PanelBarEntry[]
  onBarPick: (id: PanelBarId) => void
  studioSeen: boolean
  taskControl: ReactNode
  reason: 'relayed'
}) {
  const pt = lang === 'pt'
  const REASON_TEXT: Record<'relayed', { en: string; pt: string }> = {
    relayed: {
      en: 'This session belongs to another machine — no terminal to show here.',
      pt: 'Esta sessão pertence a outra máquina — não há terminal para mostrar aqui.',
    },
  }
  const [barWidthRef, barWidth] = useElementWidth()
  const compact = bandBarCompact(barWidth)
  return (
    <div style={{
      flexShrink: 0, display: 'flex', flexDirection: 'column',
      borderTop: '1px solid var(--border)', background: 'var(--bg-surface)',
    }}>
      <div
        ref={barWidthRef}
        role="button"
        tabIndex={0}
        aria-expanded={open}
        aria-label={pt ? 'Abrir ou recolher' : 'Open or collapse'}
        onClick={onToggleOpen}
        onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onToggleOpen() } }}
        style={{
          display: 'flex', alignItems: 'center', gap: 8, padding: '4px 12px', minHeight: 32,
          cursor: 'pointer', userSelect: 'none',
        }}
      >
        {taskControl}
        <PanelBar entries={barEntries} lang={lang} studioSeen={studioSeen} onPick={onBarPick} compact={compact} />
        <span style={{ flex: 1 }} />
        {/* NO OVERFLOW MENU HERE — this band belongs to no panel of its own (a relayed session has
            no `cli`/`shell` stream to dock), and there is nothing left to say about a panel sitting
            elsewhere: see `SessionPanel`'s own module comment on why a menu never names a panel
            other than the one it belongs to. */}
        <button
          className="ag-tap-icon"
          type="button"
          title={open ? (pt ? 'Recolher' : 'Collapse') : (pt ? 'Expandir' : 'Expand')}
          aria-label={open ? (pt ? 'Recolher' : 'Collapse') : (pt ? 'Expandir' : 'Expand')}
          onClick={e => { e.stopPropagation(); onToggleOpen() }}
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
            width: BAND_CONTROL_H, height: BAND_CONTROL_H, padding: 0,
            border: 'none', borderRadius: 6, background: 'transparent',
            color: 'var(--text-secondary)', cursor: 'pointer',
          }}
        >{open ? <ChevronDown size={14} /> : <ChevronUp size={14} />}</button>
      </div>
      {open && (
        <div style={{ fontSize: 11, lineHeight: 1.5, color: 'var(--text-tertiary)', padding: '0 12px 10px' }}>
          {pt ? REASON_TEXT[reason].pt : REASON_TEXT[reason].en}
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
