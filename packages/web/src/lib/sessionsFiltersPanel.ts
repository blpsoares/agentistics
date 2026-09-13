/**
 * sessionsFiltersPanel.ts — PURE: the two keyboard decisions the Filtros panel's collapse makes.
 *
 * The panel is always MOUNTED (the grid-rows animation needs the collapsed state still in the DOM
 * to glide out of it), so a `gridTemplateRows: 0fr` + `overflow: hidden` collapse is a purely VISUAL
 * fact — every control inside it (the date presets, "Limpar filtros", the dimension chips) stayed
 * reachable by Tab and readable by a screen reader while invisible. Reported by review: 12 Tab
 * presses from the closed trigger crossed nine hidden controls, including "Limpar filtros" — a
 * keyboard user pressing Enter there silently clears every filter and turns "Só ativas" off.
 *
 * `filtrosPanelInert` answers what the DOM should carry: the HTML `inert` attribute (not
 * `visibility: hidden`, which still leaves an element focusable via `tabindex` in older engines, and
 * not `aria-hidden` alone, which does not stop a *sighted* keyboard user tabbing into it) removes a
 * collapsed panel from the tab order and the accessibility tree in one step, the same technique
 * `RepoFileEditor.tsx` and `Studio.tsx` already use for a hidden layer in this codebase. `true` is
 * given rather than `false` so the collapsed case renders the attribute at all — an element is only
 * ever inert by that attribute's PRESENCE, and `inert={false}` still creates a false-vs-absent
 * distinction some engines have gotten wrong.
 *
 * `sessionsFiltersShouldReturnFocus` answers the other half: if the reader's focus is INSIDE the
 * panel at the moment it collapses (its own trigger, `inert`, or a stray close-on-blur elsewhere
 * moved it there), that focus needs to land back on the trigger — or it lands on `inert` content and
 * the browser resets it to the document body, which reads as "the keyboard silently stopped
 * working". It answers `false` while the panel is (or is about to be) open: only a COLLAPSE ever
 * needs to relocate focus, since expanding never removes anything from the tab order.
 */

export function filtrosPanelInert(open: boolean): true | undefined {
  return !open || undefined
}

export function sessionsFiltersShouldReturnFocus(
  willBeOpen: boolean,
  focusIsInsidePanel: boolean,
): boolean {
  return !willBeOpen && focusIsInsidePanel
}
