/**
 * terminalSurface.ts — PURE. The rules every terminal in this dashboard obeys, stated once.
 *
 * There are two terminal implementations in the web app and they answer different questions:
 * `TerminalRegion` shows the ASSISTANT's own tmux pane, `ShellBand` shows a PTY the person opened.
 * That difference is real and is not what this module unifies. What it unifies is everything that
 * was decided TWICE and differently — who may type, and what a phone gets — because two answers to
 * one question is how a product ends up arguing with itself in front of a user.
 *
 * The placements are the four surfaces a terminal can occupy, and they are the axis every rule here
 * turns on. `card` is the odd one and the reason the axis is placement rather than session: it is
 * the terminal embedded in the dashboard's session list, which appears because you scrolled past
 * it rather than because you asked for it.
 */

/** Where a terminal is being drawn. CLOSED — a new surface must be named here on purpose. */
export type TerminalPlacement =
  /** Inside a card in the dashboard's session list. You did not go there to type. */
  | 'card'
  /** The band docked under the session panel (desktop only — see `dockedAllowed`). */
  | 'docked'
  /** Replacing the conversation, behind the panel's own Chat|Terminal toggle. */
  | 'replacing'
  /** Its own screen, at its own route. */
  | 'dedicated'

export const TERMINAL_PLACEMENTS: readonly TerminalPlacement[] = [
  'card', 'docked', 'replacing', 'dedicated',
]

/**
 * How this surface asks permission before a keystroke reaches a live process.
 *
 * **`focus` wherever the terminal is the thing you asked for**, which is every placement inside the
 * sessions workspace: you pressed a tab, expanded a band, or opened the dedicated screen. Every
 * terminal on every platform works this way, and the VS Code extension in this same repo already
 * shipped that decision ("FOCUS is the consent gate") while the web kept an explicit arm button —
 * so one product held two answers to one question.
 *
 * **`button` only in a `card`.** That terminal renders inside a row of a list somebody is
 * scrolling; nobody went there to drive the session, and a stray keystroke lands in whatever dialog
 * the assistant has open.
 *
 * Dropping the button does NOT drop the honesty: there is still no local echo, the per-key acks
 * still run, and "not delivered" is still said in words. The button is CONSENT, not safety.
 */
export function consentMode(placement: TerminalPlacement): 'focus' | 'button' {
  return placement === 'card' ? 'button' : 'focus'
}

/**
 * Does this surface draw the `esc tab ctrl ↑ ↓ ← →` strip?
 *
 * On mobile only, and never in a card. A soft keyboard has no Escape, no Tab and — as the cockpit
 * already records — no arrow keys at all, so without the strip there is no leaving `vim` and no
 * Ctrl+C. The shell band has had it since phase 2; the ASSISTANT's own terminal never did, which is
 * the larger gap of the two: a permission dialog's footer says `Esc to cancel`.
 *
 * A card is excluded even on a phone: that terminal is read-only until armed, so a row of
 * send-a-key buttons over it would be five controls that do nothing.
 */
export function keyStripShown(placement: TerminalPlacement, isMobile: boolean): boolean {
  return isMobile && placement !== 'card'
}

/**
 * May a docked band exist at this width?
 *
 * No, on a phone. Measured while designing phase 2: at 390px with the keyboard open there are
 * ~250px of visible height, and split between the conversation, the composer and a terminal that is
 * ~80px each — four lines of terminal. On mobile the terminal is the dedicated sheet instead.
 */
export function dockedAllowed(isMobile: boolean): boolean {
  return !isMobile
}
