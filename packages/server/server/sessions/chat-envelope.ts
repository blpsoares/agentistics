/**
 * chat-envelope.ts — PURE: is a `type: 'user'` transcript entry something the PERSON said?
 *
 * Claude Code writes several kinds of entry under the `user` role that no person typed. They are
 * the harness talking to itself in the one channel the transcript has for input: a background task
 * reporting back, a hook's output, a reminder injected before a turn, the stdout of a `!` command.
 * `isHumanUserEntry` (jsonl.ts) does not separate them — it only excludes a pure `tool_result` —
 * so the chat pane rendered every one of them in the user's own bubble, over their avatar.
 *
 * Reported by the user, who circled a `<task-notification>` block and said "I didn't send that
 * message." They were right, and it is the same class of defect as `sessionLabel()` stripping
 * `<local-command-caveat>` out of a title: the transcript's raw text is a wire format, and putting
 * it on screen attributes the harness's plumbing to a human being.
 *
 * MEASURED on this machine, over the 40 most recently touched transcripts — 715 user entries
 * carrying text, of which 116 (16%) were an envelope:
 *
 *   54  <task-notification>      a background task finished        SYSTEM
 *   24  <system-reminder>        injected context for the turn     SYSTEM
 *   11  <local-command-caveat>   "the messages below were…"        SYSTEM
 *   11  <command-name>           a slash command the user ran      PERSON (unwrapped)
 *    5  <local-command-stdout>   that command's output             SYSTEM
 *    5  <bash-input>             a `!` line the user ran           PERSON (unwrapped)
 *    5  <bash-stdout>            that line's output                SYSTEM
 *    1  <command-message>        the slash command's own text      PERSON (unwrapped)
 *
 * The split is not cosmetic. `<command-name>` and `<bash-input>` ARE the person acting — dropping
 * them would erase a turn that happened — so they are UNWRAPPED to the thing they typed (`/foo`,
 * `!ls`) rather than shown as XML or hidden. Everything else is the harness, and is reported as a
 * one-line note naming WHAT it was, never its body: a `<system-reminder>` can be the whole of
 * CLAUDE.md, and a pane that renders it has stopped being a conversation.
 *
 * The list is a matched pair with the measurement above and nothing more — an envelope nobody has
 * seen is not in it. An UNRECOGNISED entry is therefore treated as the person's, which is the safe
 * direction: a real message wrongly hidden is gone, while a new envelope wrongly shown is the
 * behaviour that already shipped.
 */

/** What a `user` entry turns out to be. */
export type UserEntry =
  /** The person typed this. `text` is theirs, verbatim. */
  | { kind: 'person'; text: string }
  /**
   * The harness wrote this under the user role. `note` names the kind in one short phrase; the
   * BODY is deliberately absent — see the header.
   */
  | { kind: 'system'; note: string }

/**
 * Envelopes the harness writes, and what each one is.
 *
 * `unwrap` marks the ones the person really did perform: the tag is stripped and what is inside is
 * their action. The rest carry the words the pane shows in their place.
 */
const ENVELOPES: Array<{ tag: string; unwrap: boolean; note: string }> = [
  { tag: 'task-notification', unwrap: false, note: 'background task reported back' },
  { tag: 'system-reminder', unwrap: false, note: 'system reminder' },
  { tag: 'local-command-caveat', unwrap: false, note: 'local-command caveat' },
  { tag: 'local-command-stdout', unwrap: false, note: 'command output' },
  { tag: 'bash-stdout', unwrap: false, note: 'command output' },
  { tag: 'bash-stderr', unwrap: false, note: 'command output' },
  { tag: 'command-name', unwrap: true, note: 'slash command' },
  { tag: 'command-message', unwrap: true, note: 'slash command' },
  { tag: 'command-args', unwrap: true, note: 'slash command' },
  { tag: 'bash-input', unwrap: true, note: 'shell command' },
]

/** `<tag>…</tag>` (or a self-closing / unterminated one), anchored at the start. */
function leadingTag(text: string): string | null {
  const m = /^<([a-zA-Z][\w-]*)/.exec(text)
  return m ? m[1]!.toLowerCase() : null
}

/** Strip every known envelope tag, keeping what was inside. */
function unwrapAll(text: string): string {
  let out = text
  for (const { tag } of ENVELOPES) {
    out = out
      .replace(new RegExp(`</?${tag}>`, 'gi'), '\n')
  }
  return out.replace(/\n{3,}/g, '\n\n').trim()
}

/**
 * Classify one user entry's text.
 *
 * Empty or whitespace-only input is `system` with an empty note, so a caller can drop it — an
 * empty bubble under someone's avatar is the same false attribution in a smaller size.
 */
export function classifyUserText(text: string): UserEntry {
  const trimmed = text.trim()
  if (trimmed === '') return { kind: 'system', note: '' }

  const tag = leadingTag(trimmed)
  if (tag === null) return { kind: 'person', text: trimmed }

  const env = ENVELOPES.find(e => e.tag === tag)
  // An unrecognised tag is left alone: a message that merely STARTS with `<` (a diff, a snippet,
  // "<Foo /> renders twice") is the person's, and hiding it would be the expensive mistake.
  if (env === undefined) return { kind: 'person', text: trimmed }

  if (!env.unwrap) return { kind: 'system', note: env.note }

  const inner = unwrapAll(trimmed)
  // An envelope the person performed but which unwraps to nothing has no text to show and is still
  // not a message — the note names what it was.
  return inner === '' ? { kind: 'system', note: env.note } : { kind: 'person', text: inner }
}
