/**
 * fleet-row.ts — PURE. One `ControlSession`, shaped into the row the WEB Sessions page draws, with
 * the verbs it may offer already decided.
 *
 * The decision is NOT made here. `sessionActions` (`@agentistics/tui/control/sessions`) is the one
 * answer to "what can this row take", and the cockpit resolves every keypress against it; this
 * module calls it and carries the result over the wire. A browser-side re-derivation would be a
 * second set of rules — the bug `task-reopen.ts` exists to have fixed once — and it would go wrong
 * in the one direction that costs work: offering `approve` on a numbered dialog belonging to a
 * harness with no verified way to pick, where the keystroke takes whichever row is highlighted.
 *
 * What IS decided here is narrower and belongs to the browser: which of those verbs a PAGE can
 * perform at all. `attach` hands a real terminal to a session and a browser has none, so the row
 * carries the command that does it instead of a button that cannot.
 */

import { actionWords, sessionActions, type SessionAction } from '@agentistics/tui/control/sessions'
import type { ControlSession } from '@agentistics/tui/control'
import type { ControlStrings } from '@agentistics/tui/control/i18n'

/**
 * Verbs the WEB cannot perform, whatever the row says.
 *
 * `attach` needs the tty the cockpit gives up to reach it; a browser tab has none, so it is offered
 * as a COMMAND to copy rather than as a button. The three selection-less verbs (`new`, `search`,
 * `group`) are chrome of the cockpit's own screen and are not per-row actions at all.
 */
const NOT_IN_BROWSER: ReadonlySet<SessionAction> = new Set<SessionAction>([
  'attach', 'new', 'search', 'group', 'reopenFell',
])

/**
 * What the page may ask to be done to one row — a strict subset of the cockpit's verbs.
 *
 * It lives HERE, in the leaf, rather than beside its implementation in `fleet-web.ts`: `index.ts`
 * names this type to parse a request body, and `fleet-web.ts` reaches `cli-start.ts` and through it
 * Ink and React. The HTTP server must not name that module even in a type position — the two
 * handlers load it by dynamic import precisely so a machine that never opens the Sessions page
 * never pays for it, and naming it in an `import type` puts it back in the resolver's path.
 */
export type FleetActionId =
  | 'approve' | 'prompt' | 'rename' | 'note' | 'task' | 'kill' | 'resume'
  | 'openTask' | 'finishTask'

export interface FleetActionRequest {
  id: string
  action: FleetActionId
  /** The text for `prompt`/`rename`/`note`/`task`. */
  text?: string
  /** The option NUMBER for `approve` on a numbered dialog. Never defaulted — see `answerSession`. */
  choice?: number
}

/** How a verb is offered to the page: performable, present-but-refused, or absent. */
export interface FleetVerb {
  action: SessionAction
  label: string
  /**
   * False when this row cannot take it. Drawn DISABLED, never removed — the cockpit made the same
   * call and recorded why: with a fleet agentop did not start, a row that drops from nine verbs to
   * four reads as a broken feature, and absence communicates nothing about WHY.
   */
  enabled: boolean
  /**
   * Why it is off, when the row can say. Already localized, and it is the row's OWN sentence
   * (`approveBlind`, `chooseBlind`, …) wherever one exists — a verb that refuses silently is
   * indistinguishable from a control that is broken.
   */
  reason?: string
}

export interface FleetRow {
  id: string
  title: string
  harness: string
  cwd: string
  project: string
  state: ControlSession['state']
  stateLabel: string
  /** True for a row agentop hosts. An `external`/`closed` row carries no activity and no verbs. */
  actionable: boolean
  task?: string
  note?: string
  model?: string
  conversationId?: string
  /** The dialog this session is blocked on, verbatim, and the options read off it. */
  approvalLines?: string[]
  dialogOptions?: { number: number; label: string; selected: boolean }[]
  /** The row's own sentences for what cannot be done to it. Already localized. */
  approvalBlind?: string
  approveBlind?: string
  chooseBlind?: string
  conversationBlind?: string
  /** `agentop session attach <handle>` — what a browser offers instead of attaching. */
  attachCommand: string
  verbs: FleetVerb[]
}

/**
 * The handle `agentop session attach` resolves — the first characters of the id, as the cockpit's
 * own `id` column prints them. Short on purpose: it is meant to be typed.
 */
export function sessionHandleOf(id: string): string {
  return id.slice(0, 12)
}

/**
 * Why a verb is off for this row, in the row's own words where it has any.
 *
 * Only the cases the ROW can answer are named. "This session is not running" is not returned for
 * `prompt` — the state word beside the button already says it, and a sentence repeating a cell one
 * centimetre away is noise. What is returned is what nothing else on the row says: a row agentop
 * does not host, a harness whose dialog nobody has read, an option list this harness cannot pick
 * from, a conversation that can never be linked.
 *
 * A `closed` row gets NO sentence and is not treated as external: it is a conversation on this
 * machine that is simply not running, which its own state word already says. Handing it
 * "started outside agentop" would be a false sentence in the confident direction.
 */
export function verbReason(
  row: ControlSession,
  action: SessionAction,
  s: ControlStrings,
): string | undefined {
  if (row.state === 'unknown' && action !== 'resume') return s.sessionsExternalNote
  if (action === 'approve') return row.chooseBlind ?? row.approveBlind ?? row.approvalBlind
  if (action === 'resume' && !row.resume) return row.conversationBlind
  return undefined
}

/** One control-center row, shaped for the browser — verbs, wording and refusals included. */
export function fleetRow(row: ControlSession, s: ControlStrings): FleetRow {
  const words = actionWords(s)
  const verbs = sessionActions(row)
    .filter(a => !NOT_IN_BROWSER.has(a.action))
    .map(a => {
      const reason = a.enabled ? undefined : verbReason(row, a.action, s)
      return {
        action: a.action,
        label: words[a.action],
        enabled: a.enabled,
        ...(reason ? { reason } : {}),
      }
    })
  return {
    id: row.id,
    title: row.title,
    harness: row.harness,
    cwd: row.cwd,
    project: row.project,
    state: row.state,
    stateLabel: row.stateLabel,
    actionable: row.actionable,
    ...(row.task ? { task: row.task } : {}),
    ...(row.note ? { note: row.note } : {}),
    ...(row.model ? { model: row.model } : {}),
    ...(row.conversationId ? { conversationId: row.conversationId } : {}),
    ...(row.approvalLines?.length ? { approvalLines: row.approvalLines } : {}),
    ...(row.dialogOptions?.length ? { dialogOptions: [...row.dialogOptions] } : {}),
    ...(row.approvalBlind ? { approvalBlind: row.approvalBlind } : {}),
    ...(row.approveBlind ? { approveBlind: row.approveBlind } : {}),
    ...(row.chooseBlind ? { chooseBlind: row.chooseBlind } : {}),
    ...(row.conversationBlind ? { conversationBlind: row.conversationBlind } : {}),
    attachCommand: `agentop session attach ${sessionHandleOf(row.id)}`,
    verbs,
  }
}
