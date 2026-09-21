import { useEffect, useRef, useState, type ReactNode } from 'react'
import {
  ArrowDown, ArrowRight, ChevronDown, ChevronUp, Cpu, FileText, FolderTree, Maximize2,
  Minimize2, MoreHorizontal, Settings, TerminalSquare, X,
} from 'lucide-react'
import { studioLocationLabel, type PanelBarEntry, type PanelBarId } from '../../lib/panelBar'
import type { PanelMenuIconId } from '../../lib/panelMenu'
import { resolveBandDrag, resolveBandHeight } from '../../lib/shellBand'
import { targetLabel } from '../../lib/terminalTarget'
import { HarnessMark } from './HarnessMark'
import { ResizeGrip } from '../ResizeGrip'

/**
 * bandControls.tsx — ONE height, ONE padding, ONE icon/label size for every control drawn on the
 * bottom band's own bar, the right slot's fixed-header switcher and the Studio bar (design item 3,
 * screenshot 1 — "the buttons are non-standard sizes and it is very confusing").
 *
 * BEFORE THIS FILE, the same idea existed at least THREE times and had already drifted from itself:
 * `ShellBand.tsx`'s `labeledBtn` (a bordered pill, height 22, no `boxSizing`, so its rendered box was
 * really 24px once the 1px border either side is added back), `SessionPanel.tsx`'s
 * `studioBandLabeledBtn`/`studioBandIconBtn` (byte-for-byte copies of the same numbers, kept as a
 * SECOND definition rather than an import), and `Studio.tsx`'s `LabeledIconButton` (the same 22px
 * height, but `border: 'none'` and `background: 'transparent'` — a ghost button standing next to
 * bordered pills of a different actual height). None of the three disagreed on purpose; they just
 * never shared a body. `SessionPanel.tsx` even exported a `Segment` component with a comment saying
 * exactly this ("a second hand-rolled copy of it is exactly the drift this whole lift-up was meant
 * to remove") and then nothing ever imported it — `ShellBand.tsx`'s own segmented tablists
 * (`targetSwitch`/`dockedTargetSwitch`) hand-rolled their buttons anyway.
 *
 * THE FIX IS `boxSizing: 'border-box'` PLUS AN EXPLICIT `height` ON EVERY BOX THAT CAN CARRY ONE —
 * including the segment's own WRAPPER, not only the pills beside it. A wrapper sized by its content
 * (`padding: 3` around a 22px button) measures 28px tall while a standalone pill beside it measures
 * 22-24px: same "control", visibly different heights, which is the whole complaint. Fixing the
 * wrapper's height explicitly and giving its tabs `height: '100%'` is what makes
 * `getBoundingClientRect().height` agree across every control this file exports.
 */

/**
 * BandResizeHandle — THE ONE GRIP, ALWAYS THE BAND'S FIRST CHILD, ALWAYS ITS TOP EDGE.
 *
 * Owner report: "dependendo da aba q eu to o item de indicacao de reposicionamento muda de lugar,
 * ele deveria estar SEMPRE no topo, na borda superior da barra inferior." Measured: `ShellBand`'s
 * own desktop branch already rendered its `role="separator"` handle as the ROOT's first child, above
 * the bar row — correct, and why Claude Code/Shell always looked right. `StudioBand` and
 * `SimpleDockedBand` (Contents/Hardware) each rendered their OWN copy of the same markup, but as the
 * bar row's SIBLING placed AFTER it, inside a `{open && (…)}` fragment — one row lower, level with
 * the toolbar, because that is genuinely where it sat in the DOM. Three copies that happened to
 * agree only for one of the three panels is not a rule, it is a coincidence; this component is the
 * rule, and every caller now renders it before its own bar row (see `StudioBand`/`SimpleDockedBand`/
 * `ShellBand`'s own docked branch).
 *
 * Presentation only — `useBandDrag` below is the one state machine that decides WHAT a drag on it
 * means; this component never reads `columnHeight` or persists anything itself, so a caller cannot
 * forget to gate it on `open`/`fullscreen` and get away with a HANDLE that draws but does nothing.
 */
export function BandResizeHandle({ label, onMouseDown, onTouchStart, onKeyDown }: {
  /** The full sentence — this handle's accessible name, band-specific ("Resize the Studio", "Resize
   *  Contents", `ShellBand`'s own `t.resize`). */
  label: string
  onMouseDown: (e: React.MouseEvent) => void
  onTouchStart: (e: React.TouchEvent) => void
  onKeyDown: (e: React.KeyboardEvent) => void
}) {
  return (
    <div
      role="separator"
      aria-orientation="horizontal"
      aria-label={label}
      tabIndex={0}
      className="ag-resize-handle"
      onMouseDown={onMouseDown}
      onTouchStart={onTouchStart}
      onKeyDown={onKeyDown}
      // Hit area UNCHANGED from before this fix (6px tall, full band width — well over the 44px
      // mobile floor already) — only the visual grip inside it is drawn by `ResizeGrip`, which adds
      // no size of its own. Never narrower than this.
      style={{ height: 6, cursor: 'ns-resize', background: 'transparent' }}
    ><ResizeGrip orientation="horizontal" /></div>
  )
}

/**
 * useBandDrag — the ONE drag-resize state machine behind every `BandResizeHandle`: track the
 * pointer, resolve the wanted height against `resolveBandDrag`, apply it, and escalate to the
 * band's own "full screen" the instant the drag crosses `BAND_FULLSCREEN_OVERSHOOT_PX` past the
 * column's ceiling. `StudioBand`, `SimpleDockedBand` and `ShellBand`'s own docked branch drove this
 * by hand — three copies of the identical mouse/touch machinery (`shellBand.ts`'s own header already
 * says the RESOLVER must be shared "or a second, hand-rolled copy … is exactly the drift this
 * repository's own CLAUDE.md exists to prevent"; this closes the gesture that drives it too),
 * differing only in what `apply`/`onFullscreen` do once resolved.
 *
 * Returns ready-made handlers to spread onto a `BandResizeHandle` — never a bag of refs a caller has
 * to wire up three ways, which is what let the three copies drift from each other in the first
 * place (`ShellBand` alone remembered the `!fullscreen` re-entry guard; it turns out to be
 * unnecessary — the SAME PIXEL of nulling `dragRef` after the first escalation already stops every
 * later `move` from doing anything at all, including a second `apply`/`onFullscreen` call).
 */
export function useBandDrag({
  renderedHeight, columnHeight, apply, onFullscreen, enabled = true,
}: {
  /** What is ACTUALLY on screen right now — the drag's own start point (never the persisted
   *  preference alone, which is stale while `full`; see each caller's own `renderedHeight`). */
  renderedHeight: number
  /** The centre column's own measured height — `0` reads as "never snap", exactly as
   *  `resolveBandHeight` already treats it. */
  columnHeight: number
  /** Applies (and, per caller, persists) the resolved `{height, full}` — `StudioBand`'s/
   *  `SimpleDockedBand`'s shared `applyHeight`, or `ShellBand`'s own `setBand`. */
  apply: (next: { height: number; full: boolean }) => void
  /**
   * The escalation once the drag crosses the overshoot threshold — `StudioBand`'s/
   * `SimpleDockedBand`'s `() => onFullscreenChange(true)`, or `ShellBand`'s own
   * `() => onOpenFullscreen(target)`.
   *
   * ABSENT where the band has nowhere to escalate TO — `ShellBand`'s own `onOpenFullscreen` is
   * optional, and a caller with no dedicated screen to navigate to must not have its drag SPENT the
   * instant the column fills: `resolveBandDrag` keeps clamping at `full: true` and the band simply
   * cannot grow further, exactly as before this hook existed.
   */
  onFullscreen?: () => void
  /** `false` on a placement that never shows this handle at all (`ShellBand`'s own mobile sheet) —
   *  the effect still runs every render (hooks run unconditionally), it just attaches no listeners,
   *  mirroring `ShellBand`'s own former `if (isMobile) return` guard. */
  enabled?: boolean
}): {
  onMouseDown: (e: React.MouseEvent) => void
  onTouchStart: (e: React.TouchEvent) => void
  onKeyDown: (e: React.KeyboardEvent) => void
} {
  const dragRef = useRef<{ startY: number; startH: number } | null>(null)
  // The drag's own start height must read whatever is on screen AT THE MOMENT THE GESTURE BEGINS,
  // never a value captured once at mount — a ref kept current on every render is what lets
  // `onMouseDown`/`onTouchStart` (plain callbacks, not effects) read it without becoming a dependency
  // that would tear the drag's own `useEffect` down and rebuild it on every pixel of movement.
  const startRef = useRef(renderedHeight)
  startRef.current = renderedHeight
  useEffect(() => {
    if (!enabled) return
    const move = (clientY: number) => {
      const d = dragRef.current
      if (!d) return
      // Grows UPWARD: every band this hook serves is docked at the bottom, so dragging up must
      // make it taller.
      const resolved = resolveBandDrag(d.startH + (d.startY - clientY), columnHeight)
      apply(resolved)
      if (resolved.fullscreen && onFullscreen) {
        onFullscreen()
        // The gesture is SPENT — nulling here is what makes every later `move` in this same drag a
        // no-op, so neither `apply` nor `onFullscreen` fires twice for one crossing.
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
  }, [enabled, columnHeight, apply, onFullscreen])
  return {
    onMouseDown: e => { e.preventDefault(); dragRef.current = { startY: e.clientY, startH: startRef.current } },
    onTouchStart: e => {
      const p = e.touches[0]
      if (p) dragRef.current = { startY: p.clientY, startH: startRef.current }
    },
    // The keyboard step never escalates to full screen — same as every caller's own handler before
    // this fix, and consistent with `resolveBandHeight` (no `fullscreen` field) rather than
    // `resolveBandDrag` (which the pointer path alone uses).
    onKeyDown: e => {
      if (e.key === 'ArrowUp') { e.preventDefault(); apply(resolveBandHeight(startRef.current + 24, columnHeight)) }
      if (e.key === 'ArrowDown') { e.preventDefault(); apply(resolveBandHeight(startRef.current - 24, columnHeight)) }
    },
  }
}

/** The one height every desktop control in this family shares. Mobile targets are always 44px
 *  (the house rule), never this figure — every component below takes `isMobile` and switches. */
export const BAND_CONTROL_H = 26

/** The standard clip-to-nothing technique — a node stays in the accessibility tree (and so in the
 *  element's accessible NAME) while painting no pixels. Used by `PanelBar`'s `compact` mode: an
 *  unlit tab's full label is still what a screen reader announces, only no longer beside the icon. */
const VISUALLY_HIDDEN: React.CSSProperties = {
  position: 'absolute', width: 1, height: 1, padding: 0, margin: -1,
  overflow: 'hidden', clip: 'rect(0,0,0,0)', whiteSpace: 'nowrap', border: 0,
}

const pillBase: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 5, flexShrink: 0,
  boxSizing: 'border-box', border: '1px solid var(--border-subtle)', borderRadius: 6,
  background: 'var(--bg-elevated)', color: 'var(--text-secondary)', cursor: 'pointer',
  fontFamily: 'inherit', fontSize: 11, fontWeight: 600, whiteSpace: 'nowrap',
}

/**
 * An icon plus a short visible word, in a bordered pill — "Mover para a direita", "Tela cheia",
 * "Encerrar shell", "Recolher"/"Expandir", "Mostrar/Ocultar árvore", "Árvore à direita/esquerda".
 * The ONE control every labelled action button in the band/Studio-bar family renders through.
 */
export function BandLabeledButton({
  label, visibleText, isMobile, onClick, pressed, children,
}: {
  /** The full sentence — the tooltip, and what a screen reader announces. */
  label: string
  /** The short word actually painted next to the icon. */
  visibleText: string
  isMobile: boolean
  onClick: (e: React.MouseEvent<HTMLButtonElement>) => void
  /** Present only for a toggle (the tree collapse/expand); omitted for a plain action. */
  pressed?: boolean
  children: ReactNode
}) {
  return (
    <button
      className="ag-tap-icon"
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      {...(pressed !== undefined ? { 'aria-pressed': pressed } : {})}
      style={{
        ...pillBase,
        height: isMobile ? 44 : BAND_CONTROL_H,
        padding: isMobile ? '0 12px' : '0 8px',
      }}
    >
      {children}
      <span>{visibleText}</span>
    </button>
  )
}

/**
 * The segmented tablist's own wrapper — "Claude Code | Shell | Studio", the right slot's header
 * switcher, "which terminal". `height` is fixed and `boxSizing: 'border-box'` on the wrapper itself,
 * so its own padding is spent INSIDE that figure rather than added on top of it — the exact defect
 * this file's header describes (a 28px box next to 22-24px pills).
 */
export function BandSegment({ label, isMobile, children }: {
  label: string
  isMobile: boolean
  children: ReactNode
}) {
  return (
    <div role="tablist" aria-label={label} style={{
      display: 'flex', alignItems: 'center', gap: 3, padding: '0 3px', flexShrink: 0,
      boxSizing: 'border-box', height: isMobile ? 44 : BAND_CONTROL_H,
      borderRadius: 8, background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)',
    }}>
      {children}
    </div>
  )
}

/**
 * PanelBar — the ONE panel switcher (design item 1: "the drawing moves the header's panel tab menu
 * ... DOWN into the bottom terminal bar, where Claude Code | Shell | Studio already lives"). It used
 * to be `App.tsx`'s `SessionHeaderSwitcher`, rendered in the fixed header; it now renders inside the
 * bottom band's own bar (`ShellBand`'s desktop bar and `StudioBand`'s bar both mount it), which is
 * why it lives here rather than in a page file — both bands import this component, neither imports
 * the other.
 *
 * `entries`/`onPick` decide everything about WHAT is offered and WHAT clicking it does — this
 * component only draws them, through `panelBarEntries` (`lib/panelBar.ts`) and whatever plumbing the
 * caller wires the click to. The first-open dot (`studioSeen`) stays on the Studio entry's icon
 * alone, exactly as it did in the header.
 */
export function PanelBar({
  entries, lang, studioSeen, harness, onPick, compact = false,
}: {
  entries: readonly PanelBarEntry[]
  lang: 'pt' | 'en'
  studioSeen: boolean
  /** Names the CLI segment after what is actually on that session's screen (`targetLabel`), the same
   *  way the band's own old occupant switcher always did. */
  harness?: string
  onPick: (id: PanelBarId) => void
  /**
   * BELOW ~1100PX (design item 7, `lib/panelBar.ts`'s own `bandBarCompact`), every UNLIT tab drops
   * its visible word and keeps only its icon — the tooltip (`title`) still carries the full
   * sentence, so nothing is lost, only unlabelled until hovered or focused. The LIT tab (and, for
   * Studio, its "lateral"/"embaixo" tag) ALWAYS keeps its label: it is the one fact the bar exists
   * to state at a glance, and a five-icon row with no visible answer to "what am I looking at" is
   * the wrong place to save the width.
   */
  compact?: boolean
}) {
  const pt = lang === 'pt'
  const cliLabel = targetLabel('cli', harness, lang)
  const shellLabel = targetLabel('shell', harness, lang)
  const meta: Record<PanelBarId, { label: string; icon: ReactNode; title: string }> = {
    contents: {
      label: pt ? 'Conteúdo' : 'Contents',
      icon: <FileText size={14} />,
      title: pt
        ? 'Conteúdo desta sessão — atividade, galeria, skills, subagentes e mais'
        : 'This session’s contents — activity, gallery, skills, subagents and more',
    },
    studio: {
      label: 'Studio',
      icon: (
        <span style={{ position: 'relative', display: 'flex' }}>
          <FolderTree size={14} />
          {!studioSeen && (
            <span aria-hidden="true" style={{
              position: 'absolute', top: -2, right: -2, width: 6, height: 6,
              borderRadius: '50%', background: 'var(--anthropic-orange)',
            }} />
          )}
        </span>
      ),
      title: pt
        ? 'Agentistics Studio (beta) — os arquivos desta sessão em árvore, com busca e editor'
        : 'Agentistics Studio (beta) — this session’s files as a tree, with search and an editor',
    },
    // THE CLI TAB CARRIES THE HARNESS'S OWN MARK (owner, 2026-09-19: "tem 2 icones de terminal
    // repetidos... coloca a logo do harness invés do icone de terminal") — the same `HarnessMark`
    // every chat bubble already uses, including its own monogram fallback for a harness with no
    // file yet, so this never needs a second mapping. `TerminalSquare` only when `harness` itself is
    // absent (a session `HarnessMark` could not even take a guess at). The SHELL tab keeps
    // `TerminalSquare` — it is not any vendor's assistant, so a generic terminal glyph is the
    // correct picture, and it is now the ONLY tab that draws one, which is the whole fix: two
    // identical glyphs on one bar told two different panes apart by nothing.
    //
    // `aria-hidden` on the wrapper: `HarnessMark`'s own `<img alt>`/`aria-label` names the VENDOR
    // ("Claude"), which is not this tab's own accessible name — the tab's `label` already carries
    // that (`targetLabel`, "Claude Code"). Without this the two concatenate into "Claude Code Claude
    // Code" for a screen reader; every other icon in this table is a decorative lucide glyph
    // (`aria-hidden` by default) and this one is decorative for exactly the same reason — the label
    // beside it, and the tab's own `title`, are what name it.
    cli: {
      label: cliLabel,
      icon: harness
        ? <span aria-hidden="true"><HarnessMark harness={harness} size={14} /></span>
        : <TerminalSquare size={14} />,
      title: cliLabel,
    },
    shell: { label: shellLabel, icon: <TerminalSquare size={14} />, title: shellLabel },
    hardware: {
      label: pt ? 'Hardware' : 'Hardware',
      icon: <Cpu size={14} />,
      title: pt ? 'Recursos de hardware' : 'Hardware resources',
    },
  }
  return (
    <BandSegment label={pt ? 'O que mostrar' : 'What to show'} isMobile={false}>
      {entries.map(({ id, on, studioAt }) => {
        const m = meta[id]
        const label = id === 'studio' && studioAt
          ? `${m.label} · ${studioLocationLabel(studioAt, pt)}`
          : m.label
        // The LIT tab (and, for Studio, its location tag) always keeps its visible word — see this
        // component's own `compact` doc comment. An unlit one in compact mode still carries the
        // FULL text as its accessible name (a screen reader gets no less than before), only painted
        // off-screen rather than beside the icon.
        const hideLabel = compact && !on
        return (
          <BandSegmentTab
            key={id}
            on={on}
            // Stops propagation unconditionally — this bar now renders inside the bottom band's own
            // whole-row collapse toggle (`ShellBand`/`StudioBand`), so an unstopped click would both
            // pick the tab AND collapse the band underneath it.
            onClick={e => { e.stopPropagation(); onPick(id) }}
            icon={m.icon}
            label={hideLabel ? <span style={VISUALLY_HIDDEN}>{label}</span> : <span>{label}</span>}
            title={m.title}
          />
        )
      })}
    </BandSegment>
  )
}

/** One tab inside a `BandSegment` — `height: '100%'` fills the wrapper's own fixed height exactly,
 *  rather than repeating a second number that could drift from it. */
export function BandSegmentTab({ on, onClick, icon, label, isMobile, title }: {
  on: boolean
  onClick: (e: React.MouseEvent<HTMLButtonElement>) => void
  icon?: ReactNode
  label: ReactNode
  isMobile?: boolean
  /** The fuller tooltip sentence. The tab's ACCESSIBLE NAME is always its visible text content
   *  (`label`), never this — a tag folded into `label` (design item 1's "the tag is also part of
   *  the tab's accessible name") would otherwise be lost the moment a caller also set `aria-label`. */
  title?: string
}) {
  return (
    <button
      role="tab"
      aria-selected={on}
      onClick={onClick}
      type="button"
      {...(title !== undefined ? { title } : {})}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 4, flexShrink: 0,
        height: '100%', padding: isMobile ? '0 14px' : '0 9px',
        borderRadius: 6, cursor: 'pointer', fontFamily: 'inherit', border: 'none',
        fontSize: 11, fontWeight: 650, whiteSpace: 'nowrap',
        background: on ? 'var(--bg-surface)' : 'transparent',
        color: on ? 'var(--text-primary)' : 'var(--text-tertiary)',
      }}
    >
      {icon}
      {label}
    </button>
  )
}

/**
 * THE ONE PLACE `lib/panelMenu.ts`'s ICON IDS BECOME REAL ICONS — every menu built from
 * `panelMenuEntries` (`ShellBand`'s own gear, `Studio.tsx`'s own gear, the right slot's own move
 * menu) resolves through this, so an id and its picture cannot disagree between callers the way
 * `PanelRightOpen`'s inward-pointing chevron once disagreed with "Move to the right". See that
 * module's own header for the convention this renders: arrows for a move, `Maximize2`/`Minimize2`
 * for full screen (now `PanelFixedControls`' own fixed button rather than a menu row), never reused
 * for anything else.
 */
export function panelMenuIconFor(id: PanelMenuIconId, size = 14): ReactNode {
  switch (id) {
    case 'arrow-right': return <ArrowRight size={size} />
    case 'arrow-down': return <ArrowDown size={size} />
    case 'maximize': return <Maximize2 size={size} />
    case 'minimize': return <Minimize2 size={size} />
    case 'x': return <X size={size} />
  }
}

export interface BandOverflowEntry {
  id: string
  label: string
  icon: ReactNode
  onSelect: () => void
}

/**
 * BandOverflowMenu — the "⋯" that holds a bottom bar's SECONDARY actions (design item 7: "with the
 * panel segment moving into this bar it must not become a wall of buttons"). Move/Full
 * screen/End shell/Show-hide tree used to sit inline as their own `BandLabeledButton`s, each with an
 * icon AND a visible word (the previous pass's own fix for "the buttons are non-standard sizes") —
 * which is exactly what made the bar too wide once the panel segment grew from three entries to
 * five (owner's screenshot: "segment + Mover para a direita + Tela cheia + Encerrar shell + Recolher
 * — too wide"). The entries KEEP their labels here, inside the menu, where width is not the
 * constraint — only the TRIGGER collapses them.
 *
 * Absent entirely when `entries` is empty, rather than a "⋯" that opens onto nothing: a control
 * whose one outcome is an empty menu teaches nothing, same rule as everywhere else in this file.
 */
export function BandOverflowMenu({ label, entries, isMobile = false, icon }: {
  label: string
  entries: readonly BandOverflowEntry[]
  isMobile?: boolean
  /** The trigger's own icon — `MoreHorizontal` ("⋯", the band's generic overflow) unless the caller
   *  names a more specific one, e.g. `Studio.tsx`'s own gear (`Settings`) for its layout menu, which
   *  is a DIFFERENT menu from the band's own "⋯" and reads as one at a glance only if its trigger
   *  does not share that glyph. */
  icon?: ReactNode
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const away = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false) }
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', away)
    document.addEventListener('keydown', key)
    return () => {
      document.removeEventListener('mousedown', away)
      document.removeEventListener('keydown', key)
    }
  }, [open])
  // FOCUS THE FIRST ITEM ON OPEN — Tab alone would still reach every item (they are plain buttons),
  // but a menu that opens with focus still on its trigger makes a keyboard user press Tab once just
  // to find out the menu is there at all.
  useEffect(() => {
    if (open) menuRef.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus()
  }, [open])
  if (entries.length === 0) return null
  // ARROW-KEY ROVING between the items, Home/End to the ends — the same shape a native <select> or
  // any desktop menu offers, on top of the Tab order every plain <button> already gives for free.
  const roveFocus = (delta: 1 | -1) => {
    const items = Array.from(menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? [])
    const i = items.indexOf(document.activeElement as HTMLButtonElement)
    const next = i === -1 ? (delta === 1 ? 0 : items.length - 1) : (i + delta + items.length) % items.length
    items[next]?.focus()
  }
  return (
    <div ref={ref} style={{ position: 'relative', flexShrink: 0, display: 'flex' }}>
      <button
        className="ag-tap-icon"
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={label}
        title={label}
        onClick={e => { e.stopPropagation(); setOpen(o => !o) }}
        style={{
          // The 44px mobile touch target is PROJECTED by `.ag-tap-icon` (`index.css`'s
          // invisible-hitbox rule), never painted here — a literal `width/height: isMobile ? 44`
          // on an icon button is the exact shape `touchTarget.lint.test.ts` refuses, the same rule
          // `SessionsPage.tsx`'s own `rightSlotIconBtn` already follows.
          ...pillBase,
          width: BAND_CONTROL_H, height: BAND_CONTROL_H, padding: 0,
        }}
      >{icon ?? <MoreHorizontal size={14} />}</button>
      {open && (
        <div
          ref={menuRef}
          role="menu"
          aria-label={label}
          onKeyDown={e => {
            if (e.key === 'ArrowDown') { e.preventDefault(); roveFocus(1) }
            else if (e.key === 'ArrowUp') { e.preventDefault(); roveFocus(-1) }
            else if (e.key === 'Home') { e.preventDefault(); menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')[0]?.focus() }
            else if (e.key === 'End') {
              e.preventDefault()
              const items = menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')
              items?.[items.length - 1]?.focus()
            }
          }}
          style={{
            position: 'absolute', top: '100%', right: 0, marginTop: 4, zIndex: 30, minWidth: 200,
            background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 8,
            padding: 4, boxShadow: 'var(--ag-shadow-pop)',
          }}
        >
          {entries.map(e => (
            <button
              key={e.id}
              role="menuitem"
              type="button"
              onClick={ev => { ev.stopPropagation(); setOpen(false); e.onSelect() }}
              style={{
                display: 'flex', alignItems: 'center', width: '100%', gap: 8,
                minHeight: isMobile ? 44 : 30, padding: '6px 10px',
                borderRadius: 6, border: 'none', textAlign: 'left',
                background: 'transparent', fontFamily: 'inherit', fontSize: 12, fontWeight: 500,
                color: 'var(--text-primary)', cursor: 'pointer',
              }}
              onMouseEnter={ev => { ev.currentTarget.style.background = 'var(--bg-elevated)' }}
              onMouseLeave={ev => { ev.currentTarget.style.background = 'transparent' }}
            >
              {e.icon}
              {e.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

/**
 * PanelFixedControls — the ONE cluster of per-panel controls (owner, 2026-09-19: "botões que
 * ficaram fixos pra qualquer aba que for aberta: tela cheia, minimizar... vamos ter apenas 1 icone
 * de engrenagem, ele sera o responsavel pelas configurações das abas de cada uma em individual").
 * Every panel that draws its own chrome — the bottom band's own bar (`ShellBand`, and the new
 * Contents/Hardware bands), the right slot's small header (`SessionsPage`'s `rightSlotBar`), and
 * the Studio's own toolbar in the right slot (`Studio.tsx`) — renders THIS, in THIS fixed order,
 * so a reader never has to relearn where a control lives from one panel to the next:
 *
 *   [full screen, only where offered] → [minimize, ALWAYS] → [gear, only with something to say]
 *
 * FULL SCREEN IS NEVER A MENU ROW ANY MORE. It used to be a row inside the same "⋯"/gear menu that
 * also offered move and close, which is what let a reader miss it entirely under two clicks for a
 * control the owner wanted reachable in one. `fullscreen` is `undefined` wherever a panel/slot pair
 * genuinely has nowhere to send it (never present and refusing) — see `fullscreenModeFor` in
 * `lib/panelMenu.ts` for which panels can and cannot.
 *
 * MINIMIZE IS ALWAYS THE SAME CHEVRON, ALWAYS THE ACCENT ORANGE — never the neutral secondary-text
 * colour every other icon in this file uses, and never buried in the gear. `collapsed` decides only
 * the ARROW'S DIRECTION (down to collapse, up to reopen); it does NOT decide whether the control is
 * drawn — a panel that can only ever be told to go away (the four right-slot panels that close
 * outright, `panelMenu.ts`'s own `close-right`) simply never reads `collapsed: true`, since there
 * is nothing left on screen to reopen it from once it has gone. `onMinimize` is OPTIONAL for
 * exactly ONE caller (`Studio.tsx`'s own toolbar, bottom-docked): `StudioBand`'s own outer bar
 * ALREADY draws this exact control there (`panelMenu.ts`'s `collapse-bottom`), so a second one here
 * would be the same duplication this whole feature exists to remove — see that call site's own
 * comment. Every other caller always provides it.
 *
 * THE GEAR HOLDS WHATEVER IS LEFT — move, close, panel-specific settings — and is ABSENT, never a
 * disabled trigger, when `gearEntries` is empty (`BandOverflowMenu`'s own rule).
 */
export function PanelFixedControls({
  lang, panelName, fullscreen, collapsed = false, onMinimize, minimizeLabel, gearLabel, gearEntries,
  isMobile = false,
}: {
  lang: 'pt' | 'en'
  /** The panel's own display name — folded into every button's accessible name/tooltip so two
   *  adjacent controls (e.g. Contents beside Hardware) never read as the same button twice over. */
  panelName: string
  /** Absent wherever this panel/slot pair has nowhere to send full screen. */
  fullscreen?: { active: boolean; onToggle: () => void }
  /** Is the panel this cluster belongs to CURRENTLY collapsed (still assigned, screen released) —
   *  the bottom band's own reading. `false` (the default) for a panel that closes outright instead
   *  of collapsing in place, which never has a "currently collapsed" state to report. */
  collapsed?: boolean
  /** Absent for exactly one caller — see this component's own header. */
  onMinimize?: () => void
  minimizeLabel?: string
  gearLabel: string
  gearEntries: readonly BandOverflowEntry[]
  isMobile?: boolean
}) {
  const pt = lang === 'pt'
  // The 44px mobile touch target is PROJECTED by `.ag-tap-icon` (`index.css`'s invisible-hitbox
  // rule), never painted here — a literal `width/height: isMobile ? 44` on an icon button is the
  // exact shape `touchTarget.lint.test.ts` refuses, the same rule `BandOverflowMenu`'s own trigger
  // and `SessionsPage.tsx`'s own `rightSlotIconBtn` already follow.
  const iconBtn: React.CSSProperties = {
    display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
    width: BAND_CONTROL_H, height: BAND_CONTROL_H, padding: 0,
    borderRadius: 6, border: 'none', background: 'transparent', cursor: 'pointer',
  }
  return (
    <>
      {fullscreen && (
        <button
          className="ag-tap-icon"
          type="button"
          onClick={e => { e.stopPropagation(); fullscreen.onToggle() }}
          title={fullscreen.active
            ? (pt ? `Sair da tela cheia — ${panelName}` : `Exit full screen — ${panelName}`)
            : (pt ? `${panelName} em tela cheia` : `${panelName} full screen`)}
          aria-label={fullscreen.active
            ? (pt ? `Sair da tela cheia — ${panelName}` : `Exit full screen — ${panelName}`)
            : (pt ? `${panelName} em tela cheia` : `${panelName} full screen`)}
          style={{ ...iconBtn, color: 'var(--text-secondary)' }}
        >{fullscreen.active ? <Minimize2 size={14} /> : <Maximize2 size={14} />}</button>
      )}
      {onMinimize && (
        <button
          className="ag-tap-icon"
          type="button"
          onClick={e => { e.stopPropagation(); onMinimize() }}
          title={minimizeLabel}
          aria-label={minimizeLabel}
          style={{ ...iconBtn, color: 'var(--anthropic-orange)' }}
        >{collapsed ? <ChevronUp size={14} /> : <ChevronDown size={14} />}</button>
      )}
      <BandOverflowMenu label={gearLabel} icon={<Settings size={14} />} entries={gearEntries} isMobile={isMobile} />
    </>
  )
}
