/**
 * machineActions.ts — PURE: which verbs may be performed on ANOTHER machine's session.
 *
 * The list is short, and what is missing from it is the point.
 *
 * **`approve` and `prompt` are excluded, and not because they are dangerous in themselves.** They
 * are excluded because neither can be offered honestly without the SCREEN. The cockpit's own rule
 * is that the dialog being readable IS the safety: a permission prompt is `1. Yes / 2. Yes, always
 * / 3. No`, an `AskUserQuestion` can offer five answers that do different work, and the keystroke
 * that answers cannot know which option it is taking (`parseDialogOptions`). An approve button on a
 * dialog nobody can read is precisely the accident that machinery exists to prevent — one user was
 * offered a destructive key over a question they never asked. And `prompt` types free text into
 * somebody's live session, which is the same act as sitting at their keyboard.
 *
 * So they are gated on `allowRemoteScreens`, the SECOND consent switch, and even with it granted
 * they are not implemented yet: the screen does not travel in this phase, so the honest answer is
 * that they are unavailable, said in words, rather than a button that takes an unread choice.
 *
 * Everything on the list below is a verb whose meaning is fully carried by the row itself — a name,
 * a note, a task, or ending/reopening a session — and none of them needs to read a terminal.
 */

/** Verbs that need no screen, and may cross to a central once the fleet consent is given. */
export const REMOTE_SCREENLESS_ACTIONS = [
  'rename', 'note', 'task', 'interrupt', 'kill', 'resume', 'openTask', 'finishTask',
] as const

export type RemoteScreenlessAction = typeof REMOTE_SCREENLESS_ACTIONS[number]

/**
 * Verbs that need the session's SCREEN to be offered honestly. Listed rather than merely absent, so
 * the UI can say WHY they are missing instead of leaving a hole a reader has to explain to
 * themselves — the same call `fleet-row.ts` makes for a verb a row cannot take.
 */
export const REMOTE_SCREEN_ACTIONS = ['approve', 'prompt'] as const

/**
 * May this action be performed remotely, given what the machine has agreed to?
 *
 * Total, and closed: an action this module does not know is REFUSED. A new `FleetActionId` added
 * upstream must be listed here on purpose before it can be driven from a central — the same
 * allowlist reasoning `reduceMachineFleetRow` uses for fields, applied to verbs.
 *
 * `screens` is accepted and currently narrows nothing, because the screen actions are not
 * implemented yet. It is a parameter rather than an afterthought so that turning them on is a
 * change in ONE predicate rather than a new gate scattered across the member and the central.
 */
export function remoteActionAllowed(
  action: string,
  consent: { sessions: boolean; screens: boolean },
): boolean {
  if (!consent.sessions) return false
  return (REMOTE_SCREENLESS_ACTIONS as readonly string[]).includes(action)
}

/** Why an action is not offered, as a code the UI turns into a sentence. `null` = it is offered. */
export function remoteActionRefusal(
  action: string,
  consent: { sessions: boolean; screens: boolean },
): 'no-consent' | 'needs-screen' | 'unknown' | null {
  if (!consent.sessions) return 'no-consent'
  if ((REMOTE_SCREENLESS_ACTIONS as readonly string[]).includes(action)) return null
  if ((REMOTE_SCREEN_ACTIONS as readonly string[]).includes(action)) return 'needs-screen'
  return 'unknown'
}
