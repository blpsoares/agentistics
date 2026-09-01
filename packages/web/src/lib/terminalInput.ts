/**
 * terminalInput.ts — the pure core of the INTERACTIVE live terminal (Phase 2, web half).
 *
 * The read channel (`terminalStream.ts`) shows what a managed session is drawing. This module is the
 * WRITE intent: it turns a person composing a line at the terminal into an honest, auditable send
 * through the one write verb the server already exposes — `POST /api/fleet/act { action:'prompt' }`,
 * which types a line into the session AND submits it, atomically, refusing when the session is on a
 * dialog and answering ok/fail. This module invents no endpoint; it is the browser-side state machine
 * that keeps that write honest.
 *
 * FOUR DECISIONS, resolved explicitly (the assignment's own list) — see docs/terminal-interactive.md:
 *
 * 1. CONSENT — per session, in-memory, explicit, revocable. Typing into a live coding agent changes
 *    another running process, so it is a deliberate opt-in (`arm`), never a side effect of the
 *    terminal being on screen. It is PER SESSION (arming one never arms its neighbour) and held only
 *    for this surface's lifetime — a reload or a re-open re-asks, because "drive this session now" is
 *    a decision to re-make, not a durable grant a stale tab keeps. `disarm` revokes it and drops any
 *    pending line. This is an INTENT gate, not a security boundary — the server's `localShell`
 *    capability + scope + dialog refusal remain the real authority; the gate keeps a human decision
 *    at the head of every interactive session.
 *
 * 2. BATCHED TO A LINE, not key-by-key. The only web-reachable write is `sendText`, which types a
 *    line and presses Enter as one act; there is no endpoint for a single raw key (`sendKey` is not
 *    web-exposed and `sendText` cannot omit the Enter). So per-key is not merely expensive here, it is
 *    unrepresentable. It would also be wrong even if it existed: one HTTP round-trip per keystroke
 *    floods the audit and risks reordering (requests can complete out of order). The line is edited
 *    LOCALLY (the native input is the line editor — backspace, cursor, paste are the browser's) and
 *    ONE request carries the finished line, ordered by construction. Raw char-mode (Ctrl-C, arrows,
 *    no-submit typing) needs a new server keystroke channel and is the documented Phase-2b escalation.
 *
 * 3. FAILURE MID-TYPING — the load-bearing rule: the terminal must never accept a key visually and
 *    fail to deliver it. This design removes the failure surface rather than papering over it: keys
 *    are LOCAL until submit, so nothing is delivered per key and nothing per key can be lost. The one
 *    delivery is the line, and it moves through explicit states — composing → sending → delivered |
 *    failed. A FAILED send does NOT clear the draft: the exact line stays, marked failed with the
 *    server's own reason, ready to retry. While `sending` the composer is LOCKED, so two lines can
 *    never race out of order. The local draft is drawn distinctly from the session's own output, so
 *    local echo is never mistaken for the session having received it.
 *
 * 4. AUDIT WITHOUT NOISE — only the atomic send is auditable (through the existing `promptAudit`
 *    record: who / session / text / when / outcome). Local edits (typing, backspacing) are NOT
 *    audited: they are not sends, and per-keystroke auditing is exactly the flood the assignment
 *    warns against. One line delivered-or-failed is one audit entry — the granularity the write
 *    channel already records; this module adds nothing to that schema.
 *
 * Everything here is pure and reducer-shaped so the honesty rules above are pinned by tests
 * (`terminalInput.test.ts`), not left to the JSX.
 */

/** A key was pressed; nothing has been sent yet. `sending` is the one line in flight; `failed` keeps
 *  the line that did not land. `idle` after a delivered line means "clean, ready for the next". */
export type SendStatus = 'idle' | 'sending' | 'failed'

export interface ComposerState {
  /** Decision 1 — the explicit, per-session, revocable consent to type. */
  armed: boolean
  /** Decision 2 — the local line buffer (cooked mode). Never sent until `submit`. */
  draft: string
  /** Decision 3 — the honest delivery state of the one line in flight. */
  status: SendStatus
  /** The server's verbatim refusal, kept while `failed` so the reason is on screen. */
  error: string | null
}

export const INITIAL_COMPOSER: ComposerState = { armed: false, draft: '', status: 'idle', error: null }

export type ComposerAction =
  | { type: 'arm' }
  | { type: 'disarm' }
  | { type: 'edit'; draft: string }
  | { type: 'submit' }
  | { type: 'sent'; ok: boolean; message: string }

/** Typing is allowed only while armed and not mid-send (the lock that prevents a reorder). */
export function canEdit(state: ComposerState): boolean {
  return state.armed && state.status !== 'sending'
}

/** A line may be sent only while armed, not mid-send, and with something non-blank to send. */
export function canSubmit(state: ComposerState): boolean {
  return state.armed && state.status !== 'sending' && state.draft.trim().length > 0
}

export function composerReducer(state: ComposerState, action: ComposerAction): ComposerState {
  switch (action.type) {
    case 'arm':
      // Idempotent: arming an already-armed composer never wipes a line in progress.
      return state.armed ? state : { armed: true, draft: '', status: 'idle', error: null }

    case 'disarm':
      // Revoking consent drops the pending line too — a session you stopped driving keeps nothing.
      return INITIAL_COMPOSER

    case 'edit':
      // Local editing only when it is allowed; typing after a failure clears the failed marker so the
      // revised line reads as a fresh attempt (its text is kept).
      if (!canEdit(state)) return state
      return { ...state, draft: action.draft, status: 'idle', error: null }

    case 'submit':
      if (!canSubmit(state)) return state
      return { ...state, status: 'sending', error: null }

    case 'sent':
      // A result only means anything while a send is actually in flight AND consent still stands: a
      // result that lands after the user disarmed must not resurrect a line or an armed state.
      if (!state.armed || state.status !== 'sending') return state
      return action.ok
        ? { armed: true, draft: '', status: 'idle', error: null }
        : { ...state, status: 'failed', error: action.message }

    default:
      return state
  }
}

/** The fleet-row states the interactive terminal understands (mirrors `FleetRow['state']`). */
export type FleetRowState =
  | 'working' | 'waiting' | 'waiting-approval' | 'exited' | 'lost' | 'unknown' | 'closed'

/**
 * Why a row cannot be typed into right now, or `null` when it can.
 *
 * - `external` — not an agentop-managed session; nothing here can write to it.
 * - `not-running` — exited / lost / closed; there is no live process to receive the line.
 * - `awaiting-approval` — the session is on a dialog, and the server refuses a prompt into one (the
 *   person must answer the dialog, not type past it). A `working` or `waiting` session IS typable —
 *   a queued line is picked up on the next turn.
 */
export type InteractionBlock = 'external' | 'not-running' | 'awaiting-approval' | null

export function interactionBlock(state: FleetRowState): InteractionBlock {
  switch (state) {
    case 'unknown':
      return 'external'
    case 'exited':
    case 'lost':
    case 'closed':
      return 'not-running'
    case 'waiting-approval':
      return 'awaiting-approval'
    default:
      return null
  }
}
