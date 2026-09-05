/**
 * chat-turn.ts — what ONE turn of a conversation is, whatever harness wrote it.
 *
 * It lived inside `chat-tail.ts`, the CLAUDE transcript reader, for as long as Claude was the only
 * harness whose conversation could be read at all. It is now the shape every reader in
 * `harness-transcript.ts` produces, and a second harness importing the first one's module to learn
 * what a turn is would make Claude's reader the thing the others are defined against rather than
 * one of them.
 *
 * Nothing here is Claude-specific. Where a field only ever applies to one harness that is said on
 * the field, not enforced by which module owns it.
 */

export interface ChatTurn {
  /**
   * When the transcript recorded this turn, ISO.
   *
   * Optional because an older transcript may not carry one, and a turn with no time is shown
   * without one rather than given a made-up "now" — a feed whose ordering is the whole point cannot
   * afford an invented timestamp.
   */
  at?: string
  role: 'user' | 'assistant'
  text: string
  /**
   * The tools this turn INVOKED, with the first line of each call's own input.
   *
   * The chat view renders these as the actions the assistant took, the way the terminal shows
   * `Running 1 shell command…` with the command under it. Without them a conversation reads as
   * the assistant talking to itself between long silences, when what happened in the silence is
   * most of the work.
   */
  tools?: Array<{
    name: string
    detail?: string
    /**
     * For a SHELL call, the paths that command writes — read by the pure `shell-writes.ts`.
     *
     * `detail` is only the command's first LINE, which is where the artifacts panel went blind: a
     * session that writes through heredocs showed 263 shell calls and no files. The paths are
     * computed here rather than by shipping whole multi-line commands to the browser, which is a
     * chat bubble's worth of shell script per turn.
     */
    writes?: string[]
    /**
     * The command wrote through something that cannot be read off the command line — an interpreter
     * fed a program on stdin. The panel says so rather than claiming nothing was written.
     */
    opaqueWrite?: boolean
  }>
  /**
   * The assistant's extended thinking, when the transcript carries it.
   *
   * Kept apart from `text` rather than concatenated: it is reasoning, not an answer, and the UI
   * shows it collapsed. Merging the two would put paragraphs of deliberation above every reply
   * with nothing marking where one ends.
   */
  thinking?: string
  /**
   * This is not something the assistant SAID — it is a synthesized note that a tool call has been
   * written to the transcript and no text has followed it yet, which is exactly the window where a
   * session is visibly busy and the pane would otherwise show nothing (or a stale turn from before
   * the tool call). Rendered dim, like every other status line in this pane, never in the role
   * colours — it is not a message either side wrote.
   */
  pending?: boolean
  /**
   * A background TASK this turn started, by the label the assistant gave it.
   *
   * Rendered as a status line and never as a message: nobody said it. `running` is true while no
   * `<task-notification>` has come back for it yet — which is what makes a watcher visible WHILE
   * it is the thing you are waiting on, rather than only once it is over.
   */
  task?: { label: string; running: boolean }
  /**
   * This entry sat under the `user` role and NO PERSON WROTE IT — a background task reporting
   * back, an injected reminder, a `!` command's stdout. The value is a short phrase naming which,
   * never the body: a `<system-reminder>` can be the whole of CLAUDE.md.
   *
   * It is a turn rather than a drop so the conversation stays legible — an assistant reply with
   * nothing above it reads as the assistant talking to itself — and it is rendered unattributed,
   * like `pending`, because the one thing it may never do is appear over the user's avatar. See
   * `chat-envelope.ts` for the measured list and why two of those envelopes are the person's.
   */
  system?: string
}
