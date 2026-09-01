/**
 * fleet-input.ts — PURE. Raw keystrokes into a managed session: what may be sent, and as what.
 *
 * This is the escalation `docs/terminal-interactive.md` named and deliberately did not build: the
 * line composer types a whole line and presses Enter, which covers "send the agent a message" and
 * covers nothing else. Ctrl-C, the arrow keys that move a highlighted option, Esc, Tab completion
 * inside the tool, and typing WITHOUT an implicit submit all need individual keys, and there was no
 * server endpoint that could carry one.
 *
 * Two shapes, and they are opposites — confusing them fails silently, which is why the backend has
 * kept them apart from the beginning:
 *
 * - **text** is typed literally (`send-keys -l`) and submits NOTHING. Sent as a key name, `hello`
 *   would be interpreted as a key nobody has.
 * - **key** is one NAMED key in tmux's vocabulary (`Enter`, `Escape`, `C-c`, `Up`). Sent as text,
 *   `Enter` is five characters typed into the assistant's prompt.
 *
 * The client sends the BROWSER's own key vocabulary (`KeyboardEvent.key` plus its modifiers) and the
 * mapping to tmux's happens here — one implementation, on the side that has to validate it anyway.
 * A client that mapped it first would be a second vocabulary, and the server would still have to
 * check the result, so the check may as well be the mapping.
 *
 * **Nothing outside the table is sent.** `send-keys` given an unrecognised name does not fail
 * cleanly — it falls back to sending the string, so a bogus "key" becomes typed text in somebody's
 * session. An unmapped key is refused instead, in a sentence.
 */

/** The request body, as it arrives: every field unknown until it has been read. */
export interface FleetInputBody {
  id?: unknown
  /** Literal characters to type. No submit, no interpretation. */
  text?: unknown
  /** One key press, in the browser's vocabulary. */
  key?: unknown
}

export interface FleetKeyPress {
  /** `KeyboardEvent.key` — `a`, `Enter`, `ArrowUp`, `F5`. */
  key: string
  ctrl?: boolean
  alt?: boolean
  shift?: boolean
}

export type FleetInputPlan =
  | { kind: 'text'; id: string; text: string }
  | { kind: 'key'; id: string; key: string }

export type FleetInputRefusal =
  | 'no_session'
  /** Neither `text` nor `key`, or an empty one. */
  | 'empty'
  /** A key with no tmux equivalent, or a modifier combination that cannot be expressed. */
  | 'unknown_key'
  /** Control characters inside `text`. They are keys, and they must arrive as keys. */
  | 'control_in_text'
  /** More than one paste's worth in a single call. */
  | 'too_long'

export type FleetInputDecision =
  | { ok: true; plan: FleetInputPlan }
  | { ok: false; reason: FleetInputRefusal; detail?: string }

/**
 * A ceiling on one call, not on typing.
 *
 * A person types a few characters per event; this size exists for the paste, and it is generous
 * enough for a real one (a stack trace, a URL, a block of config) while keeping a single request
 * from carrying a file.
 */
export const MAX_INPUT_TEXT = 4096

/**
 * `KeyboardEvent.key` → tmux's name, for the keys that HAVE one.
 *
 * tmux's vocabulary is its own: `BSpace` not `Backspace`, `PPage` not `PageUp`, `DC` not `Delete`.
 * Every entry here was read from tmux's own key table rather than guessed, because a guess does not
 * fail — it gets typed into the session as text.
 */
const NAMED: Readonly<Record<string, string>> = {
  Enter: 'Enter',
  Escape: 'Escape',
  Tab: 'Tab',
  Backspace: 'BSpace',
  Delete: 'DC',
  Insert: 'IC',
  Home: 'Home',
  End: 'End',
  PageUp: 'PPage',
  PageDown: 'NPage',
  ArrowUp: 'Up',
  ArrowDown: 'Down',
  ArrowLeft: 'Left',
  ArrowRight: 'Right',
  ' ': 'Space',
}

/** `F1`…`F12`, which tmux names identically. */
const FUNCTION_KEY = /^F([1-9]|1[0-2])$/

/**
 * One key press → the name tmux understands, or `null` when there is none.
 *
 * Modifiers are deliberately narrow. `C-<letter>` and `M-<letter>` are the two forms every tmux
 * accepts and the two that matter (Ctrl-C above all). A combination outside that is refused rather
 * than approximated: sending `C-M-a` to a tmux that does not parse it puts the literal string into
 * the session, which is the failure this module exists to prevent.
 */
export function tmuxKeyName(press: FleetKeyPress): string | null {
  const { key } = press
  if (!key) return null
  const ctrl = press.ctrl === true
  const alt = press.alt === true

  if (ctrl && alt) return null

  if (ctrl) {
    // Ctrl with a single letter or digit. `Ctrl-Shift-C` is the editor's own copy shortcut and
    // never reaches here as an input key, so shift is simply ignored.
    if (/^[a-zA-Z0-9]$/.test(key)) return `C-${key.toLowerCase()}`
    if (key === '[') return 'C-['
    if (key === ' ') return 'C-Space'
    // A named key with Ctrl (Ctrl-Left, Ctrl-Enter) — tmux writes those as `C-Left`.
    const named = NAMED[key]
    return named ? `C-${named}` : null
  }

  if (alt) {
    if (/^[a-zA-Z0-9]$/.test(key)) return `M-${key}`
    const named = NAMED[key]
    return named ? `M-${named}` : null
  }

  // Shift-Tab is its own key in tmux, and it is the one shift combination that is not simply the
  // shifted character (which arrives as text).
  if (key === 'Tab' && press.shift === true) return 'BTab'

  const named = NAMED[key]
  if (named) return named
  if (FUNCTION_KEY.test(key)) return key
  return null
}

/**
 * Control characters have no business in literal text: each one IS a key, and the table above
 * names them. Written as escapes rather than as the bytes themselves — a literal control
 * character in source is invisible to a reader and is mangled by anything that touches the file.
 */
const CONTROL_CHARS = /[\x00-\x1f\x7f]/

function text(raw: unknown): string | undefined {
  return typeof raw === 'string' && raw.length > 0 ? raw : undefined
}

/**
 * Read one input request, or say why it cannot be honoured.
 *
 * Total: it never throws, whatever arrives, and it performs no I/O.
 */
export function planFleetInput(body: FleetInputBody): FleetInputDecision {
  const id = typeof body.id === 'string' ? body.id.trim() : ''
  if (!id) return { ok: false, reason: 'no_session' }

  const literal = text(body.text)
  if (literal !== undefined) {
    if (literal.length > MAX_INPUT_TEXT) return { ok: false, reason: 'too_long' }
    if (CONTROL_CHARS.test(literal)) return { ok: false, reason: 'control_in_text' }
    return { ok: true, plan: { kind: 'text', id, text: literal } }
  }

  const press = body.key
  if (press && typeof press === 'object' && typeof (press as FleetKeyPress).key === 'string') {
    const raw = press as FleetKeyPress
    // A plain printable character IS text, whichever field it arrived in. Refusing it would make
    // the client responsible for a distinction the server can simply make — and a client that got
    // it wrong would send `a` as a key name, which tmux would type anyway, by luck rather than by
    // design.
    if (!raw.ctrl && !raw.alt && raw.key.length === 1 && !CONTROL_CHARS.test(raw.key) && raw.key !== ' ') {
      return { ok: true, plan: { kind: 'text', id, text: raw.key } }
    }
    const name = tmuxKeyName(raw)
    if (!name) return { ok: false, reason: 'unknown_key', detail: describe(raw) }
    return { ok: true, plan: { kind: 'key', id, key: name } }
  }

  return { ok: false, reason: 'empty' }
}

/** The offending combination, in the words a person would use for it. */
function describe(press: FleetKeyPress): string {
  const parts: string[] = []
  if (press.ctrl) parts.push('Ctrl')
  if (press.alt) parts.push('Alt')
  if (press.shift) parts.push('Shift')
  parts.push(press.key === ' ' ? 'Space' : press.key)
  return parts.join('+')
}
