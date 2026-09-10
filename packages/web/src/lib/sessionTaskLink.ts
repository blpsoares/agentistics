/**
 * sessionTaskLink.ts — PURE. Which DELIVERY a session belongs to, on the session's metrics card.
 *
 * The card answers "what has this conversation spent"; this is the one line of identity beside it,
 * asked for so the delivery is one click away instead of a search on the board.
 *
 * **The ref is the TITLE, and that is deliberate rather than lazy.** A fleet row carries
 * `task?: string` — the delivery's NAME — because the id lives on the session record the server
 * holds and never reaches the wire. `findTask` (server, `task-report.ts`) resolves a ref by id,
 * then by exact title, then case-insensitively, so the name the row already has IS a ref the board
 * accepts. That is what makes this link cost NO extra request: no id lookup, no task list fetched
 * to open a card. `SessionTasksTab` makes the same join for the same reason and records it as "the
 * honest join the browser can make"; two places matching by name is one rule, not two.
 *
 * The cost of that rule, stated: two deliveries sharing a title would resolve to whichever the
 * server finds first. Creating a title that already exists returns the existing delivery rather
 * than a duplicate, so a collision takes a deliberate rename to produce.
 */

/** What the card should draw for the delivery — three outcomes, and `none` is one of them. */
export type SessionTaskLink =
  /** Filed, and there is somewhere to go. */
  | { kind: 'link'; title: string; path: string }
  /** Filed, but this surface cannot navigate — say the name, offer no control. */
  | { kind: 'label'; title: string }
  /** Filed under nothing. Draw NOTHING: no dash, no empty row. */
  | { kind: 'none' }

/**
 * The board's own route for one delivery, from a ref.
 *
 * ENCODED, because a title is not a path: `feat/x` would otherwise become `/tasks/feat/x`, two
 * segments against a one-segment route, and match nothing. Every other caller in this app already
 * encodes; this is that same rule with a test on it.
 */
export function taskPath(ref: string): string {
  return `/tasks/${encodeURIComponent(ref)}`
}

/**
 * @param task    the delivery's name, off the fleet row — absent when the session is filed under
 *                nothing
 * @param canOpen does this surface have anywhere to navigate? A card on a screen with no router
 *                names the delivery and offers no control, the same rule `onOpenFull` keeps.
 */
export function sessionTaskLink(task: string | undefined, canOpen: boolean): SessionTaskLink {
  const title = task?.trim() ?? ''
  if (!title) return { kind: 'none' }
  return canOpen ? { kind: 'link', title, path: taskPath(title) } : { kind: 'label', title }
}
