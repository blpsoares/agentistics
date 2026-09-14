/**
 * sessionHeaderSwitcher.ts — which entries the Sessions workspace's ONE header tab group offers,
 * and in what order (design item 2, screenshot 6).
 *
 * The right slot used to be reached through THREE separate header controls (a Contents icon
 * button, a Studio button, a hardware chip) plus the aside's OWN internal tab row drawing the same
 * four choices a second time — which is how two of them ended up lit at once (screenshot 3): the
 * Contents button read its own `open` flag while the aside's row had already switched the slot to
 * Studio. One row, one selector (`rightSlotShowing`/`isPanelShown` in `panelSlots.ts`), fixes both:
 * there is now exactly one place that decides which entry is `on`.
 *
 * Pure and React-free so the ORDER and the PRESENCE rules can be tested without mounting anything —
 * the same shape `panelSlots.ts`'s own `allowed`/`gateOpen` take.
 */

export type HeaderSwitcherPanel = 'contents' | 'studio' | 'cli' | 'shell' | 'hardware'

export interface HeaderSwitcherGates {
  /** `appCtx.editorEnabled` — the server's own answer, never re-derived. */
  editorEnabled: boolean
  /** `appCtx.shellEnabled` — ditto. */
  shellEnabled: boolean
  /** This session is another machine's, reached through a central's relay — no `cli`/`shell` stream
   *  of its own exists to show. */
  relayed: boolean
  /** Hardware reads THIS machine's own process list — meaningless (and refused) on a central. */
  hardwareOffered: boolean
}

export interface HeaderSwitcherEntry {
  id: HeaderSwitcherPanel
  /** Is this the panel the right slot is currently showing? */
  on: boolean
}

/**
 * The entries to render, in a FIXED order (Conteúdo · Studio · Claude Code · Shell · Hardware —
 * design item 2's own listing), each carrying only whether it should render at all and whether it
 * is the lit one. ABSENT, never greyed, for a closed gate — the same rule `panelSlots.allowed`/
 * `gateOpen` already apply to the slot itself; this is the same rule read for a HEADER control that
 * a session with no `selected` fleet row cannot answer at all.
 */
export function headerSwitcherEntries(
  active: HeaderSwitcherPanel | null, gates: HeaderSwitcherGates,
): HeaderSwitcherEntry[] {
  const order: { id: HeaderSwitcherPanel; shown: boolean }[] = [
    { id: 'contents', shown: true },
    { id: 'studio', shown: gates.editorEnabled },
    { id: 'cli', shown: !gates.relayed },
    { id: 'shell', shown: gates.shellEnabled && !gates.relayed },
    { id: 'hardware', shown: gates.hardwareOffered },
  ]
  return order.filter(e => e.shown).map(e => ({ id: e.id, on: active === e.id }))
}
