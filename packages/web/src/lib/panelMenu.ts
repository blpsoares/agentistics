/**
 * panelMenu.ts — PURE. The ONE builder behind every panel's own placement menu (Contents, Studio,
 * Claude Code, Shell, Hardware), so the five of them cannot drift apart the way they had: "Mover
 * para a direita" (no panel named) sat beside "Trazer o Studio para baixo" (a different verb, this
 * time naming it) in the SAME menu, which belonged to whichever panel the band happened to be
 * showing — reported as "os icones direcionais... estao contraintuitivos" once the wording confusion
 * was fixed and the icons were looked at directly.
 *
 * ONE MENU NEVER NAMES A PANEL OTHER THAN THE ONE IT BELONGS TO. `panelMenuEntries` takes the panel
 * id and returns entries phrased "Mover o Studio para a direita" / "Mover o Studio para baixo" —
 * always THIS panel's own name, always the SAME verb ("Mover"/"Move") for both directions, so a
 * reader never has to work out which panel a row in this menu is about.
 *
 * THE ICON CONVENTION, STATED ONCE SO THE NEXT ROW CANNOT PICK THE OTHER ONE (owner, 2026-09-19):
 * "os icones direcionais de 'trazer pra direita' 'trazer pra baixo' estao contraintuitivos, a seta
 * ta pro lado oposto do que eh dito" — `PanelRightOpen`'s own chevron pointed LEFT (into the panel)
 * on a row that said "move to the right", because that icon means "expand FROM here", not "go
 * THERE". So: **every row's icon points at the DESTINATION, never at the panel's current position**,
 * and the convention is ARROWS (`ArrowRight`/`ArrowDown`), not the panel glyphs — an arrow's
 * direction cannot be misread the way a panel glyph's internal divider can. Full screen keeps its
 * own established pair (`Maximize2`/`Minimize2`, `iconId: 'maximize'|'minimize'`) — a DIFFERENT
 * question ("cover everything" vs "go back") with its own long-standing icons, not a placement move.
 *
 * A ROW IS ABSENT, NEVER PRESENT AND REFUSING, WHEN IT HAS NOTHING TO ACT ON. `move-right`/
 * `move-bottom` are offered only when `allowed()` (`panelSlots.ts`) says the OTHER slot can host this
 * panel at all — `contents` and `hardware` can only ever be in the right slot, so neither one ever
 * carries a `move-bottom` row, in either slot's menu. `fullscreen`/`exit-fullscreen` is offered only
 * when the caller says there is somewhere for it to go (`fullscreenAvailable` — true today only for
 * the Studio, bottom-docked; see `Studio.tsx`'s own `onToggleFullscreen` for why it is absent
 * everywhere else).
 *
 * MINIMIZE IS DELIBERATELY NOT A ROW HERE. It is the panel's own ALWAYS-VISIBLE icon (never buried
 * in a menu — owner: "sempre visível, não escondido em um menu"), rendered beside this menu's own
 * trigger rather than inside it; see `panelMinimizeAction` below for what it DOES per panel and slot,
 * and each caller (`StudioBand`/`ShellBand`'s own chevron, the new right-slot header) for where it is
 * drawn.
 *
 * CLOSE IS THE STUDIO'S OWN EXCEPTION, not a row every panel carries — see the one `if (panel ===
 * 'studio')` in this file for the full reasoning. In short: everywhere else, minimizing ALREADY
 * closes the panel outright (`panelMinimizeAction`'s own `close-right`) or has nothing left to close
 * TO (a local session's bottom band always refills itself), so a second "Fechar X" row beside the
 * always-visible minimize icon would be one control doing what the other already does, under a
 * different picture. The Studio is the one panel where "close" means something a minimize does not:
 * in the right slot it does NOT already close on minimize (`collapse-right-park` — the buffers
 * survive), and at the bottom, removing it genuinely changes what is docked there.
 */

import { allowed, type PanelId, type SlotId } from './panelSlots'

/**
 * Every icon this menu (or the minimize control beside it) ever draws — resolved to a real lucide
 * component only at the JSX call site, never here, so this module stays render-free and every
 * caller resolves the SAME id to the SAME icon (`panelMenuIconFor` in `bandControls.tsx`).
 *
 * `chevron-right` is never returned by `panelMenuEntries` itself — it is the RIGHT SLOT's own
 * always-visible minimize icon (`SessionsPage.tsx`'s new right-slot header, for Contents/Hardware/
 * the CLI pane/the Shell pane), listed here so that control resolves through the SAME table as
 * every menu row rather than picking its own icon by hand. The BOTTOM band's own minimize is its
 * existing collapse chevron (`ChevronUp`/`ChevronDown`, a genuine toggle between two states) and is
 * drawn directly by `StudioBand`/`ShellBand` — it was never part of this vocabulary and does not
 * need to be, since nothing else in the product ever needs to resolve "collapse the bottom band" by
 * an id.
 */
export type PanelMenuIconId = 'arrow-right' | 'arrow-down' | 'maximize' | 'minimize' | 'chevron-right' | 'x'

export type PanelMenuEntryId = 'move-right' | 'move-bottom' | 'fullscreen' | 'exit-fullscreen' | 'close'

export interface PanelMenuEntry {
  id: PanelMenuEntryId
  label: string
  iconId: PanelMenuIconId
}

export interface PanelMenuInput {
  panel: PanelId
  /** Where this panel CURRENTLY sits — the menu offers the move toward the OTHER slot. */
  slot: SlotId
  lang: 'pt' | 'en'
  /** This panel's own display name, already resolved by the caller (`targetLabel` for cli/shell,
   *  'Studio', 'Hardware', the localized 'Conteúdo'/'Contents') — this module names no panel itself,
   *  or a harness-named CLI pane would read as "Move Claude Code" in one build and something else in
   *  another for no reason this file could ever know about. */
  panelName: string
  /** Absent wherever full screen has nowhere to apply — see this module's own header. */
  fullscreenAvailable: boolean
  fullscreen: boolean
}

/**
 * THE SHARED BUILDER. One pure function, taking the panel id, its current slot and the gates —
 * every caller (`StudioBand`'s "Mais ações", `ShellBand`'s own overflow, `Studio.tsx`'s own gear,
 * and the new right-slot headers for Contents/Hardware) asks THIS for what to offer and draws
 * exactly what comes back, so five menus cannot say five different things about one decision.
 */
export function panelMenuEntries({
  panel, slot, lang, panelName, fullscreenAvailable, fullscreen,
}: PanelMenuInput): PanelMenuEntry[] {
  const pt = lang === 'pt'
  const entries: PanelMenuEntry[] = []
  const other: SlotId = slot === 'right' ? 'bottom' : 'right'
  // MOVE — absent, never present-and-refusing, when the destination cannot host this panel at all
  // (`contents`/`hardware` never reach `bottom` — `panelSlots.ts`'s own `allowed`).
  if (allowed(other, panel)) {
    entries.push(other === 'right'
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
  if (fullscreenAvailable) {
    entries.push(fullscreen
      ? { id: 'exit-fullscreen', label: pt ? 'Sair da tela cheia' : 'Exit full screen', iconId: 'minimize' }
      : { id: 'fullscreen', label: pt ? 'Tela cheia' : 'Full screen', iconId: 'maximize' })
  }
  // CLOSE IS OFFERED ONLY WHERE IT MEANS SOMETHING DIFFERENT FROM THE ALWAYS-VISIBLE MINIMIZE ICON
  // — never a second control doing the exact same thing with a different picture. In the right
  // slot, `panelMinimizeAction` already makes minimizing Contents/Hardware/the CLI pane/the Shell
  // pane a full close (`close-right` — see that function's own header on why that is SAFE, not a
  // shortcut); a "Fechar X" row beside a minimize icon that already closes it would be the exact
  // duplication `panelMinimizeAction`'s header warns against. At the bottom, closing the CLI or
  // Shell pane has no visible effect at all — `lib/panelBar.ts`'s `bottomBandFor` always refills a
  // local session's bottom band with `ShellBand` regardless of what `panelSlots` remembers there, so
  // the one thing the Shell pane needs beyond minimize is its OWN destructive "end this shell"
  // (`ShellBand`'s own overflow entry, ending the real process — a different question from placement
  // and kept as that component's own addition, never folded into this generic vocabulary). The
  // STUDIO is the one panel where "close" is neither of those: it is the ONLY right-slot panel that
  // does NOT already close on minimize (see `collapse-right-park`), and removing it from the bottom
  // genuinely changes what is docked there (the band falls back to the session's own pane). So
  // `close` is this builder's one panel-specific exception, not a rule every panel shares.
  if (panel === 'studio') {
    entries.push({
      id: 'close',
      label: pt ? `Fechar ${panelName}` : `Close ${panelName}`,
      iconId: 'x',
    })
  }
  return entries
}

// ---------------------------------------------------------------------------------------------
// The always-visible MINIMIZE control — never a row in the menu above (owner: always visible,
// beside the gear, one icon and one meaning everywhere).
// ---------------------------------------------------------------------------------------------

/**
 * WHAT MINIMIZING THIS PANEL, IN THIS SLOT, ACTUALLY DOES.
 *
 * Three shapes, and the difference is entirely about WHAT WOULD BE LOST by a plain unmount:
 *
 *  - **`collapse-bottom`** — every panel the bottom band can ever hold (`studio`/`cli`/`shell`)
 *    already has a park-not-unmount mechanism there: `StudioBand`'s own `bottomOpen`
 *    (`panelSlots.ts`) parks the Studio's persistent host with its Monaco buffers untouched, and
 *    `ShellBand`'s own `BandPrefs.open` (`shellBand.ts`) merely stops WATCHING the stream — the
 *    session or shell it is reading keeps running, server-side, regardless. Minimizing here is
 *    exactly the existing collapse chevron; there was nothing new to build.
 *  - **`collapse-right-park`** — the ONE new case. The right slot has never had a "minimized but
 *    still assigned" state, and the Studio is the ONE right-slot panel that would lose real,
 *    unrecoverable state (an in-memory, unsaved Monaco edit) to an ordinary unmount — see
 *    `panelSlots.ts`'s own `rightOpen`, the right slot's exact analogue of `bottomOpen`.
 *  - **`close-right`** — Contents, Hardware, and the CLI/Shell panes, all in the right slot, are
 *    unmounted outright. This is SAFE, not a shortcut: none of them holds client-only state a
 *    remount cannot recover — Contents and Hardware are read-only live views, and the CLI/Shell
 *    STREAM this minimizes is a client-side subscription to a server-side session or shell process
 *    that is completely unaffected by the browser tab watching it (`ShellBand`'s own module header:
 *    "a shell lives until it is closed... survives switching session, reloading the page"). Building
 *    a park mechanism for four more panels to avoid an unmount that loses nothing would be
 *    complexity with no reader.
 *
 * `null` when this panel cannot even sit in this slot (`panelSlots.allowed`) — there is nothing to
 * minimize, so there must be no control offering to.
 */
export type MinimizeAction = 'collapse-bottom' | 'collapse-right-park' | 'close-right'

export function panelMinimizeAction(panel: PanelId, slot: SlotId): MinimizeAction | null {
  if (!allowed(slot, panel)) return null
  if (slot === 'bottom') return 'collapse-bottom'
  return panel === 'studio' ? 'collapse-right-park' : 'close-right'
}
