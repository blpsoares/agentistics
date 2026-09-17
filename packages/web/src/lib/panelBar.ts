/**
 * sessionHeaderSwitcher.ts — which entries the Sessions workspace's ONE header tab group offers, in
 * what order, and which is lit (design item 2, screenshot 6; owner follow-up, screenshot 5 — "I want
 * them all in ONE tab menu, and the Studio must be ACTIVE from the moment it is open, ... with a
 * small tag saying where it is open").
 *
 * The right slot used to be reached through THREE separate header controls (a Contents icon
 * button, a Studio button, a hardware chip) plus the aside's OWN internal tab row drawing the same
 * four choices a second time — which is how two of them ended up lit at once (screenshot 3): the
 * Contents button read its own `open` flag while the aside's row had already switched the slot to
 * Studio. One row, one selector (`rightSlotShowing`/`isPanelShown` in `panelSlots.ts`), fixes both:
 * there is now exactly one place that decides which entry is `on`.
 *
 * `contents`/`cli`/`shell`/`hardware` are lit exactly when they occupy the RIGHT slot — unchanged.
 * `studio` is DIFFERENT: it is lit whenever the Studio is on screen in EITHER slot (`isPanelShown`),
 * because the Studio is a standing feature the reader keeps open, not a thing that only counts while
 * it happens to be on the right. That is also why it is the ONE entry that can carry a `studioAt`
 * tag — where it currently sits — and the one case where TWO entries may read `on` at once: Studio
 * docked at the BOTTOM while something else occupies the RIGHT slot. Every other combination still
 * lights at most one entry, because a slot can hold only one panel at a time.
 *
 * Pure and React-free so the ORDER, PRESENCE and TAG rules can be tested without mounting anything —
 * the same shape `panelSlots.ts`'s own `allowed`/`gateOpen` take.
 */

export type HeaderSwitcherPanel = 'contents' | 'studio' | 'cli' | 'shell' | 'hardware'

/** Where the Studio currently sits, for the tab's own tag — `'side'` for the right slot (rendered
 *  "lateral"/"side"), `'bottom'` for the bottom band ("embaixo"/"bottom"). Named after the SLOT's
 *  meaning to a reader, not its storage key (`panelSlots.ts`'s `'right'`), so this module never has
 *  to import that one just to rename its values at the call site. */
export type StudioLocation = 'side' | 'bottom'

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
  /** Is this the panel the right slot is currently showing — or, for `studio` alone, is it on
   *  screen in EITHER slot? */
  on: boolean
  /** Present only on the `studio` entry, and only while it is `on` — where it sits right now. */
  studioAt?: StudioLocation
}

/**
 * The entries to render, in a FIXED order (Conteúdo · Studio · Claude Code · Shell · Hardware —
 * design item 2's own listing), each carrying whether it should render at all, whether it is the lit
 * one, and — for Studio — where it sits.
 *
 * `rightOccupant` is `rightSlotShowing(layout, contentsOpen)` — what the RIGHT slot itself is
 * showing, exactly as before. `bottomOccupant` is `layout.bottom` — the bottom band's own occupant,
 * needed only to tell whether the Studio has moved down there instead. ABSENT, never greyed, for a
 * closed gate — the same rule `panelSlots.allowed`/`gateOpen` already apply to the slot itself.
 */
export function headerSwitcherEntries(
  rightOccupant: HeaderSwitcherPanel | null,
  bottomOccupant: HeaderSwitcherPanel | null,
  gates: HeaderSwitcherGates,
): HeaderSwitcherEntry[] {
  const order: { id: HeaderSwitcherPanel; shown: boolean }[] = [
    { id: 'contents', shown: true },
    { id: 'studio', shown: gates.editorEnabled },
    { id: 'cli', shown: !gates.relayed },
    { id: 'shell', shown: gates.shellEnabled && !gates.relayed },
    { id: 'hardware', shown: gates.hardwareOffered },
  ]
  const studioAt: StudioLocation | undefined =
    rightOccupant === 'studio' ? 'side' : bottomOccupant === 'studio' ? 'bottom' : undefined
  return order.filter(e => e.shown).map(e => {
    if (e.id === 'studio') {
      return studioAt !== undefined ? { id: e.id, on: true, studioAt } : { id: e.id, on: false }
    }
    return { id: e.id, on: rightOccupant === e.id }
  })
}

/** The tag's own two words, EN/PT — kept here so both the tab's visible text and its (identical)
 *  accessible name are built from one source. */
export function studioLocationLabel(at: StudioLocation, pt: boolean): string {
  if (at === 'side') return pt ? 'lateral' : 'side'
  return pt ? 'embaixo' : 'bottom'
}
