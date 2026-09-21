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
 * tooltip opening rightward would run off-screen).
 *
 * NEVER SCROLLS (spec §4: "The rail never scrolls its icons: overflow is the dropdown, not a
 * scrollbar") — that dropdown is a LATER pass; for now a rail taller than its column simply clips
 * (`overflow: hidden`), which is the honest incomplete state rather than a scrollbar this design
 * explicitly rules out.
 */

import { useState } from 'react'
import { panelIconFor } from '../../lib/panelIcons'
import { panelTitle } from '../../lib/panelMeta'
import { RAIL_WIDTH_PX } from '../../lib/rightAsideEdge'
import type { PanelId } from '../../lib/panelSlots'

export { RAIL_WIDTH_PX }

export interface PanelRailProps {
  /** Already filtered (gates subtracted) and ordered — see this module's own header. */
  panels: readonly PanelId[]
  /** Which panel the content area is currently showing, if any. */
  active: PanelId | null
  lang: 'pt' | 'en'
  /** Names the `cli` icon after the session's own harness, exactly like the bottom band's tab. */
  harness?: string
  onOpen: (id: PanelId) => void
}

export function PanelRail({ panels, active, lang, harness, onOpen }: PanelRailProps) {
  const pt = lang === 'pt'
  const [named, setNamed] = useState<PanelId | null>(null)
  return (
    <div
      role="tablist"
      aria-label={pt ? 'Painéis' : 'Panels'}
      aria-orientation="vertical"
      style={{
        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2,
        width: RAIL_WIDTH_PX, flexShrink: 0, padding: '8px 4px',
        borderLeft: '1px solid var(--border)', background: 'var(--bg-surface)',
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
            onClick={() => onOpen(id)}
            onMouseEnter={() => setNamed(id)}
            onMouseLeave={() => setNamed(s => (s === id ? null : s))}
            onFocus={() => setNamed(id)}
            onBlur={() => setNamed(s => (s === id ? null : s))}
            style={{
              position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center',
              width: 32, height: 32, flexShrink: 0, borderRadius: 8, border: 'none', padding: 0,
              cursor: 'pointer', fontFamily: 'inherit',
              background: on ? 'var(--bg-elevated)' : 'transparent',
              color: on ? 'var(--anthropic-orange)' : 'var(--text-secondary)',
            }}
          >
            {panelIconFor(id, 16, harness)}
            {named === id && (
              <span
                role="tooltip"
                style={{
                  position: 'absolute', right: 'calc(100% + 8px)', top: '50%',
                  transform: 'translateY(-50%)', whiteSpace: 'nowrap',
                  padding: '4px 8px', borderRadius: 6, fontSize: 11, fontWeight: 600,
                  background: 'var(--bg-elevated)', color: 'var(--text-primary)',
                  border: '1px solid var(--border)', boxShadow: '0 4px 12px -4px rgba(0,0,0,0.4)',
                  pointerEvents: 'none', zIndex: 50,
                }}
              >{title}</span>
            )}
          </button>
        )
      })}
    </div>
  )
}
