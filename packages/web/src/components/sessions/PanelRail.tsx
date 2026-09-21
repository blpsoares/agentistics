/**
 * PanelRail — the icon rail on the right edge of the sessions workspace (right-rail spec §2).
 *
 * ALWAYS PRESENT ON DESKTOP, icons only, VS Code's activity bar. `panels` is already filtered and
 * ordered by the caller (`panelSlots.railPanels`, with whatever server/per-session gates apply —
 * `hardwareOffered`, `editorEnabled`, `relayed` — already subtracted): this component draws exactly
 * what it is given and decides nothing about which panels exist.
 *
 * CLICKING opens that panel in the content area to the rail's OWN LEFT — this component never
 * decides where that content renders, only that `onOpen(id)` was asked for; the caller
 * (`SessionsPage.tsx`) is what keeps the content area from ever painting UNDER the rail (the rail is
 * a flex sibling with a fixed width, never absolutely positioned over anything).
 *
 * HOVER NAMES THE ICON, AND SO DOES KEYBOARD FOCUS (spec §2). A native `title` attribute would
 * satisfy the first alone — most browsers show it only on a POINTER hover, never on `:focus` — so
 * this draws its own tooltip, shown on `mouseenter`/`focus` alike and hidden on the matching leave/
 * blur, positioned to the LEFT of the rail (the rail sits at the screen's own right edge, so a
 * tooltip opening rightward would run off-screen). It carries the TITLE and a one-line DESCRIPTION
 * (addendum item 1: "nao ta aparecendo o cardzinho explicativo").
 *
 * PORTALED TO `document.body`, `position: fixed`, measured off the hovered button's own rect —
 * NEVER `position: absolute` inside this component's tree. It was, once, and shipped invisible: the
 * rail's own `overflow: hidden` (immediately below, load-bearing for "the rail never scrolls its
 * icons") clips ANY descendant whose box extends outside the rail's bounds, which the tooltip does
 * BY DESIGN — it opens 8px to the tooltip's own LEFT of a 44px-wide column, i.e. entirely outside
 * it. Clipping is a layout/paint fact, not a stacking-context one, so no `z-index` could have
 * rescued it. This is why it "worked in the preview and failed in production": it never actually
 * worked — the phase-1 verification confirmed the tooltip NODE existed (right text, right DOM) and
 * never confirmed it was PAINTED, so a bug present in dev from the start went unnoticed until a
 * real hover in the shipped build showed nothing. `SessionsGroupMenu.tsx`'s own popover already
 * solves the identical problem the identical way — `createPortal` + `position: fixed` — this
 * follows that established pattern rather than inventing a second one.
 *
 * NEVER SCROLLS (spec §4: "The rail never scrolls its icons: overflow is the dropdown, not a
 * scrollbar") — that dropdown is a LATER pass; for now a rail taller than its column simply clips
 * (`overflow: hidden`), which is the honest incomplete state rather than a scrollbar this design
 * explicitly rules out.
 *
 * DRAG (spec §3), mouse only — it reaches neither the keyboard nor a phone, which is exactly why the
 * gear's move verbs stay clickable everywhere this drag can reach and everywhere it cannot. Dragging
 * one icon onto another REORDERS the rail; dragging an icon here from the BOTTOM band (or anywhere
 * else carrying the shared drag payload — `dragReorder.ts`'s `DRAG_KEY_TYPE`) MOVES it onto the
 * rail. This component only ever reports "this key was dropped on that target" — `onDrop` decides
 * what that means, via the pure `planPanelDrop`; the DOM layer holds no order arithmetic of its own,
 * only which icon is being dragged/hovered, for the drop-target highlight.
 */

import { useState } from 'react'
import { createPortal } from 'react-dom'
import { ArrowDown } from 'lucide-react'
import { PanelContextMenu, type PanelContextMenuEntry } from './bandControls'
import { readDragPayload, setDragPayload } from '../../lib/dragReorder'
import { panelIconFor } from '../../lib/panelIcons'
import { panelDescription, panelTitle } from '../../lib/panelMeta'
import { panelMoveEntry } from '../../lib/panelMenu'
import { railClickAction } from '../../lib/panelSlots'
import { RAIL_WIDTH_PX } from '../../lib/rightAsideEdge'
import type { PanelDropTarget, PanelId } from '../../lib/panelSlots'

export { RAIL_WIDTH_PX }

export interface PanelRailProps {
  /** Already filtered (gates subtracted) and ordered — see this module's own header. */
  panels: readonly PanelId[]
  /** Which panel the content area is currently showing, if any. */
  active: PanelId | null
  /** Is the RIGHT SLOT's own content currently visible — `SlotLayout.rightOpen`. Decides what a
   *  click on the ACTIVE icon does (`railClickAction`); irrelevant to every other icon. */
  rightOpen: boolean
  lang: 'pt' | 'en'
  /** Names the `cli` icon after the session's own harness, exactly like the bottom band's tab. */
  harness?: string
  onOpen: (id: PanelId) => void
  /**
   * Minimize `id` — the rail-icon-toggle's other half (addendum item 3). Takes the panel id, NOT a
   * bare callback: `SlotLayout.rightOpen` genuinely gates visibility for exactly ONE panel (the
   * Studio, `panelMinimizeAction`'s `collapse-right-park`) — every other panel's own minimize is a
   * full `closeSlotPanel` (`close-right`), which `rightOpen` alone does not express (`open` in
   * `resolveDockedTarget`'s own slot-layout construction reads `slotLayout.right !== null` for those
   * — `rightOpen` never gated them, or Skills stayed fully visible with its "minimized" flag flipped
   * and nothing on screen changing). The caller dispatches through `panelMinimizeAction` itself; this
   * component decides only WHETHER to minimize, never WHAT that means for a given panel.
   */
  onMinimize: (id: PanelId) => void
  /** The context menu's own move verb (addendum, 2026-09-21) — always "move to the bottom", since
   *  every rail panel's other placement is the bottom band. */
  onMove: (id: PanelId) => void
  /** A drag ended here (spec §3) — either on a specific icon or on the rail's own empty space. */
  onDrop: (dragPanel: PanelId, target: PanelDropTarget) => void
}

export function PanelRail({
  panels, active, rightOpen, lang, harness, onOpen, onMinimize, onMove, onDrop,
}: PanelRailProps) {
  const pt = lang === 'pt'
  const [named, setNamed] = useState<{ id: PanelId; rect: DOMRect } | null>(null)
  const [dragOver, setDragOver] = useState<PanelId | 'bar' | null>(null)
  const [menu, setMenu] = useState<{ panel: PanelId; at: { x: number; y: number } } | null>(null)

  const dropHere = (e: React.DragEvent, target: PanelDropTarget) => {
    e.preventDefault()
    const key = readDragPayload(e)
    if (key) onDrop(key as PanelId, target)
    setDragOver(null)
  }

  const openMenuAt = (id: PanelId, rect: DOMRect) => {
    setMenu({ panel: id, at: { x: rect.left, y: rect.top } })
  }

  const menuEntries: readonly PanelContextMenuEntry[] = menu
    ? (() => {
      const move = panelMoveEntry({ panel: menu.panel, placement: 'rail', lang, panelName: panelTitle(menu.panel, pt) })
      return move ? [{ id: move.id, label: move.label, icon: <ArrowDown size={14} />, onSelect: () => onMove(menu.panel) }] : []
    })()
    : []

  return (
    <div
      role="tablist"
      aria-label={pt ? 'Painéis' : 'Panels'}
      aria-orientation="vertical"
      onDragOver={e => { e.preventDefault(); setDragOver(s => s ?? 'bar') }}
      onDragLeave={e => {
        if (e.currentTarget === e.target) setDragOver(null)
      }}
      onDrop={e => dropHere(e, { placement: 'rail' })}
      style={{
        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2,
        width: RAIL_WIDTH_PX, flexShrink: 0, padding: '8px 4px',
        borderLeft: dragOver === 'bar' ? '1px solid var(--anthropic-orange)' : '1px solid var(--border)',
        background: 'var(--bg-surface)',
        overflow: 'hidden',
      }}
    >
      {panels.map(id => {
        const on = id === active
        const title = panelTitle(id, pt)
        return (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={on}
            aria-label={title}
            draggable
            onDragStart={e => setDragPayload(e, id)}
            onDragEnd={() => setDragOver(null)}
            onDragOver={e => { e.preventDefault(); e.stopPropagation(); e.dataTransfer.dropEffect = 'move'; setDragOver(id) }}
            onDrop={e => { e.stopPropagation(); dropHere(e, { panel: id }) }}
            // THE RAIL IS A LAUNCHER (addendum item 3) — `railClickAction` decides, never a bare
            // "always open". See that function's own header for why the bottom bar's tabs (select-
            // only) do NOT follow the same rule.
            onClick={() => (railClickAction(active, rightOpen, id) === 'minimize' ? onMinimize(id) : onOpen(id))}
            // RIGHT-CLICK / Menu key / Shift+F10 — the icon's own context menu (addendum, 2026-09-21:
            // the move verb that used to live in a gear this icon never had). Anchored to the
            // button's own rect, not the event coordinates — see `PanelContextMenu`'s own header.
            onContextMenu={e => { e.preventDefault(); openMenuAt(id, e.currentTarget.getBoundingClientRect()) }}
            onMouseEnter={e => setNamed({ id, rect: e.currentTarget.getBoundingClientRect() })}
            onMouseLeave={() => setNamed(s => (s?.id === id ? null : s))}
            onFocus={e => setNamed({ id, rect: e.currentTarget.getBoundingClientRect() })}
            onBlur={() => setNamed(s => (s?.id === id ? null : s))}
            style={{
              position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center',
              width: 32, height: 32, flexShrink: 0, borderRadius: 8, border: 'none', padding: 0,
              cursor: 'pointer', fontFamily: 'inherit',
              background: on ? 'var(--bg-elevated)' : 'transparent',
              color: on ? 'var(--anthropic-orange)' : 'var(--text-secondary)',
              // The drop target is shown as an EDGE, matching the pinned-sessions band's own
              // convention — a list that reflows under the cursor moves the target you aimed at.
              boxShadow: dragOver === id ? 'inset 0 0 0 1.5px var(--anthropic-orange)' : undefined,
            }}
          >
            {panelIconFor(id, 16, harness)}
          </button>
        )
      })}
      {/* THE TOOLTIP — portaled to `document.body`, NEVER `position: absolute` in this tree. See
          this module's own header for the clipping bug this replaced (`overflow: hidden` above
          clipped the old in-tree version entirely, in every build, dev included). */}
      {named && createPortal(
        <div
          role="tooltip"
          style={{
            position: 'fixed',
            top: named.rect.top + named.rect.height / 2,
            left: named.rect.left - 8,
            transform: 'translate(-100%, -50%)',
            maxWidth: 220, padding: '6px 10px', borderRadius: 8,
            background: 'var(--bg-elevated)', color: 'var(--text-primary)',
            border: '1px solid var(--border)', boxShadow: '0 4px 12px -4px rgba(0,0,0,0.4)',
            pointerEvents: 'none', zIndex: 1250,
          }}
        >
          <div style={{ fontSize: 11.5, fontWeight: 700 }}>{panelTitle(named.id, pt)}</div>
          <div style={{ fontSize: 10.5, color: 'var(--text-tertiary)', marginTop: 2, lineHeight: 1.4 }}>
            {panelDescription(named.id, pt)}
          </div>
        </div>,
        document.body,
      )}
      {menu && (
        <PanelContextMenu at={menu.at} entries={menuEntries} onClose={() => setMenu(null)} />
      )}
    </div>
  )
}
