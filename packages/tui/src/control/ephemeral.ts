/**
 * ephemeral.ts — arrangement that must survive a REMOUNT but not the process.
 *
 * ## The gap this fills
 *
 * There are two lifetimes in this app and, until now, only two places to keep state: React state,
 * which dies on every remount, and the persisted preferences, which live forever. Attaching to a
 * session is a REMOUNT — `runControlCenter` returns a `ControlExit`, `cli-start.ts` hands the tty to
 * tmux, and when you detach the Ink app is mounted again from scratch in the same process. So
 * anything held in React state silently resets every time you look at a session and come back.
 *
 * Reported: folding the menu away with `b`, entering a session, leaving it, and finding the menu
 * open again — every single time. The fold was deliberately not persisted, and that reasoning was
 * right: a menu still hidden three days later is a feature nobody can find their way out of. But
 * "not forever" was implemented as "not at all", and the round trip you make dozens of times an
 * hour was the casualty.
 *
 * Module state is exactly the missing lifetime. It survives the remount because the process is the
 * same one, and it is gone when you quit agentop — which is the honest boundary for a gesture you
 * made to look at something.
 *
 * ## Rules
 *
 * Nothing here is written to disk, and nothing here may be load-bearing: every value must have a
 * safe default, because a fresh process legitimately starts with all of them at that default. It is
 * for ARRANGEMENT — what is folded, what is scrolled — never for facts.
 */

/** Whether the sessions menu is folded away. Survives an attach round trip, not a restart. */
let sessionsMenuHidden = false

export function getSessionsMenuHidden(): boolean {
  return sessionsMenuHidden
}

export function setSessionsMenuHidden(hidden: boolean): void {
  sessionsMenuHidden = hidden
}

/** Reset every ephemeral value. Tests only — a process boundary is the real reset. */
export function forgetEphemeral(): void {
  sessionsMenuHidden = false
}
