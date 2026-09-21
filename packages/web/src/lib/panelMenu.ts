/**
 * panelMenu.ts — PURE. The ONE builder behind every panel's own placement menu, so the fourteen
 * panels cannot drift apart the way they had (see the pre-rail revision of this file for the
 * "os icones direcionais... estao contraintuitivos" history this module already fixed once).
 *
 * ONE MENU NEVER NAMES A PANEL OTHER THAN THE ONE IT BELONGS TO. `panelMenuEntries` takes the panel
 * id and returns entries phrased "Mover X para a direita" / "Mover X para baixo" — always THIS
 * panel's own name, always the SAME verb ("Mover"/"Move") for both directions.
 *
 * AFTER THE RIGHT ICON RAIL (2026-09-21), "the right" IS the rail: a panel placed `'rail'` shows its
 * icon there and opens into the content area beside it; `'bottom'` is unchanged, a tab in the bottom
 * band. The user-facing words stay "para a direita"/"to the right" — that is still the correct
 * mental model (the panel's content still ends up on the right side of the screen) — only the
 * internal placement id (`OpenPlacement`, from `panelSlots.ts`) is renamed from the old two-slot
 * `SlotId`.
 *
 * THE ICON CONVENTION, STATED ONCE: **every row's icon points at the DESTINATION, never at the
 * panel's current position** — arrows (`ArrowRight`/`ArrowDown`), never the panel glyphs.
 *
 * A ROW IS ABSENT, NEVER PRESENT AND REFUSING, WHEN IT HAS NOTHING TO ACT ON. `move-right`/
 * `move-bottom` are offered only when `allowed()` (`panelSlots.ts`) says the OTHER placement can
 * host this panel at all — every panel can reach every placement today, so this is no longer a real
 * restriction, but the check stays for a panel added later with a genuinely closed placement.
 *
 * FULL SCREEN and MINIMIZE are NOT rows here — see `fullscreenModeFor`/`panelMinimizeAction` below,
 * both fixed controls (`bandControls.tsx`'s `PanelFixedControls`), never menu rows.
 *
 * CLOSE is the Studio's own exception — see the one `if (panel === 'studio')` below.
 */

import { allowed, type OpenPlacement, type PanelId } from './panelSlots'

/**
 * Every icon this menu ever draws — resolved to a real lucide component only at the JSX call site
 * (`panelMenuIconFor` in `bandControls.tsx`), never here, so this module stays render-free.
 */
export type PanelMenuIconId = 'arrow-right' | 'arrow-down' | 'maximize' | 'minimize' | 'x'

export type PanelMenuEntryId = 'move-right' | 'move-bottom' | 'close'

export interface PanelMenuEntry {
  id: PanelMenuEntryId
  label: string
  iconId: PanelMenuIconId
}

export interface PanelMenuInput {
  panel: PanelId
  /** Where this panel CURRENTLY sits — the menu offers the move toward the OTHER placement. */
  placement: OpenPlacement
  lang: 'pt' | 'en'
  /** This panel's own display name, already resolved by the caller — this module names no panel
   *  itself, or a harness-named CLI pane would read as "Move Claude Code" in one build and something
   *  else in another for no reason this file could ever know about. */
  panelName: string
}

/**
 * THE SHARED BUILDER. One pure function, taking the panel id and its current placement — every
 * caller (`ShellBand`'s own gear, `Studio.tsx`'s own gear, the right slot's own headers, the bottom
 * band's docked panels) asks THIS for what to offer.
 */
export function panelMenuEntries({
  panel, placement, lang, panelName,
}: PanelMenuInput): PanelMenuEntry[] {
  const pt = lang === 'pt'
  const entries: PanelMenuEntry[] = []
  const other: OpenPlacement = placement === 'rail' ? 'bottom' : 'rail'
  if (allowed(other, panel)) {
    entries.push(other === 'rail'
      ? {
        id: 'move-right',
        label: pt ? `Mover ${panelName} para a direita` : `Move ${panelName} to the right`,
        iconId: 'arrow-right',
      }
      : {
        id: 'move-bottom',
        label: pt ? `Mover ${panelName} para baixo` : `Move ${panelName} to the bottom`,
        iconId: 'arrow-down',
      })
  }
  // CLOSE IS OFFERED ONLY WHERE IT MEANS SOMETHING DIFFERENT FROM THE ALWAYS-VISIBLE MINIMIZE ICON
  // — see `panelMinimizeAction`'s own header. Every panel but the Studio already closes outright on
  // minimize when it sits on the rail (`close-right`), and at the bottom the band always refills
  // itself, so there is nothing left for a second "Fechar X" row to say. The STUDIO is the one panel
  // that PARKS instead of closing on the rail (`collapse-right-park` — its Monaco buffers survive),
  // so it alone needs a genuine close.
  if (panel === 'studio') {
    entries.push({
      id: 'close',
      label: pt ? `Fechar ${panelName}` : `Close ${panelName}`,
      iconId: 'x',
    })
  }
  return entries
}

/**
 * THE ONE THING EVERY ICON'S RIGHT-CLICK MENU OFFERS (addendum, 2026-09-21) — the move verb toward
 * the panel's other placement, split out of `panelMenuEntries` because CLOSE (the Studio's one
 * exception) stays a GEAR row, never a context-menu row. The context menu mirrors what a DRAG can
 * do (drag only ever moves a panel, never closes one), so it can never offer more than a drag could.
 * `null` when the other placement cannot host this panel at all (`allowed()`, today never false).
 */
export function panelMoveEntry(input: PanelMenuInput): PanelMenuEntry | null {
  return panelMenuEntries(input).find(e => e.id === 'move-right' || e.id === 'move-bottom') ?? null
}

/**
 * GEAR ENTRIES WITH THE MOVE VERB REMOVED (addendum, 2026-09-21) — every existing caller of
 * `panelMenuEntries` for its OWN gear now filters through this instead, so the move row disappears
 * from the gear everywhere in one place rather than at each call site. A panel whose gear would then
 * hold NOTHING (every panel but the Studio, today) draws no gear at all — `BandOverflowMenu`'s own
 * empty-entries rule, unchanged.
 */
export function panelMenuEntriesWithoutMove(input: PanelMenuInput): PanelMenuEntry[] {
  return panelMenuEntries(input).filter(e => e.id !== 'move-right' && e.id !== 'move-bottom')
}

// ---------------------------------------------------------------------------------------------
// The always-visible FULL SCREEN control — a fixed button, never a row above.
// ---------------------------------------------------------------------------------------------

/**
 * WHAT PRESSING "FULL SCREEN" ON THIS PANEL ACTUALLY DOES:
 *  - **`'navigate'`** — `cli`/`shell`. Their full screen goes to the dedicated screen
 *    (`/sessions/:id/terminal`), which survives a reload and can be shared.
 *  - **`'overlay'`** — every other panel (the ten former Contents tabs, `studio`, `hardware`). None
 *    has a dedicated screen of its own, so full screen means covering the whole viewport IN PLACE.
 */
export function fullscreenModeFor(panel: PanelId): 'overlay' | 'navigate' {
  return panel === 'cli' || panel === 'shell' ? 'navigate' : 'overlay'
}

// ---------------------------------------------------------------------------------------------
// The always-visible MINIMIZE control — never a row in the menu above.
// ---------------------------------------------------------------------------------------------

/**
 * WHAT MINIMIZING THIS PANEL, IN THIS PLACEMENT'S SLOT, ACTUALLY DOES.
 *
 *  - **`collapse-bottom`** — the bottom band collapses in place; the pane it was showing keeps
 *    whatever server-side state it had (a live stream, a cached tab read) regardless.
 *  - **`collapse-right-park`** — the Studio alone, on the rail. The one panel that would lose real,
 *    unrecoverable state (an in-memory, unsaved Monaco edit) to an ordinary unmount.
 *  - **`close-right`** — every other panel, on the rail. Safe: none holds client-only state a
 *    remount cannot recover.
 *
 * `null` when this panel cannot even sit in this placement (`panelSlots.allowed`).
 */
export type MinimizeAction = 'collapse-bottom' | 'collapse-right-park' | 'close-right'

export function panelMinimizeAction(panel: PanelId, placement: OpenPlacement): MinimizeAction | null {
  if (!allowed(placement, panel)) return null
  if (placement === 'bottom') return 'collapse-bottom'
  return panel === 'studio' ? 'collapse-right-park' : 'close-right'
}
