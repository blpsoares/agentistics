/**
 * dialog-choice.ts — PURE. The OPTIONS a blocked session is offering, read off its screen.
 *
 * ## Why this exists
 *
 * `approval-spec.ts` shipped with one keystroke per harness and the honest warning that it
 * "confirms the highlighted option and is not approve". That warning turns out to describe a real
 * hole rather than a caveat, and a user found it: a session sitting on
 *
 *     ❯ 1. Só o meu fix, isolado
 *       2. Promover dev→main inteiro
 *       3. Parar em dev por enquanto
 *       4. Type something.
 *
 * has no "approve". Pressing a key called approve there picks, blind, between four things that do
 * different work on somebody's repository. It is the same class of mistake as the prompt that fell
 * into a dialog's filter and approved a command nobody had read — quieter, and just as bad.
 *
 * The fix is not a better keystroke, it is READING THE OPTIONS and letting a person choose one.
 * They are on the screen; the frame is already captured to decide the state.
 *
 * ## Why the discriminator is the options and not the footer
 *
 * The obvious design is to tell "yes/no" dialogs from "choose one of N" by their footers, the way
 * `attention-rules.ts` tells one claude dialog from another. It does not survive contact with the
 * data: claude's PERMISSION prompt is itself a numbered list —
 *
 *     ❯ 1. Yes
 *       2. Yes, allow all edits during this session (shift+tab)
 *       3. No
 *
 * — so there is no yes/no dialog to separate out. There is one select component whose options
 * differ, and "Yes" being first is a convention, not a guarantee. The footer answers "is a dialog
 * open"; only the options answer "what would I be choosing".
 *
 * ## Confidence, and what happens without it
 *
 * A list of numbers is easy to hallucinate: an assistant that printed `1. foo / 2. bar` in its
 * answer would look exactly like a menu. Three things bound that:
 *
 *  - This is only ever run on a frame `attention-rules.ts` has ALREADY matched as a dialog.
 *  - The scan runs BOTTOM-UP and stops at the first `1.` it meets, so it reads the last block on
 *    the screen — the dialog is drawn at the bottom.
 *  - The numbers must come out as exactly `1..n` with nothing missing and nothing repeated. A
 *    prose list that happens to sit at the bottom will usually fail this; when it cannot be shown
 *    to be a menu, the answer is NO options, and the caller says so instead of guessing.
 *
 * Verified against three real claude 2.1.232 dialogs on 2026-08-14 (a Bash permission prompt, a
 * Write permission prompt and an `AskUserQuestion`), all captured from live sessions.
 */

/** One option a dialog is offering. */
export interface DialogOption {
  /** The number the dialog printed, which is also what is typed to pick it. */
  number: number
  /** The option's own line, without its number and without the cursor. */
  label: string
  /** True for the one the dialog is currently highlighting. */
  selected: boolean
}

/**
 * A numbered option line.
 *
 * The cursor glyph is optional and is what marks the highlighted row. The label must start with a
 * non-space, so `1.` on its own is not an option — a bare number with no text is far more likely to
 * be an ordinal in prose than a menu entry.
 */
const OPTION = /^\s*(❯|>)?\s*(\d{1,2})\.\s+(\S.*?)\s*$/

/**
 * How far up the frame to look for the block.
 *
 * The dialog is at the bottom and the tallest real one measured is well inside this. A bound
 * matters because the scan is looking for a `1.` to stop at, and without one it would read the
 * whole scrollback on a frame that has no menu in it at all.
 */
const SCAN_LINES = 40

/**
 * The options on screen, in order — PURE, and EMPTY when they cannot be read with confidence.
 *
 * Empty is a real answer and the caller must treat it as one: it means "this is a dialog, and
 * agentop cannot tell you what it is offering". Inventing a list there is exactly the failure this
 * module was written to remove.
 */
export function parseDialogOptions(frame: readonly string[]): DialogOption[] {
  const from = Math.max(0, frame.length - SCAN_LINES)
  const found: DialogOption[] = []

  // Bottom-up, stopping at `1.` — the dialog is the last block on the screen, and its first option
  // is where that block begins.
  for (let i = frame.length - 1; i >= from; i--) {
    const m = OPTION.exec(frame[i] ?? '')
    if (!m) continue
    const number = Number(m[2])
    found.push({ number, label: m[3]!, selected: m[1] !== undefined })
    if (number === 1) break
  }

  found.reverse()

  // A menu is at least a choice. One option is a statement, and the caller confirms it instead.
  if (found.length < 2) return []
  // Exactly `1..n`, in order. A gap, a repeat or a wrong start means this was not read correctly —
  // and half-read options are worse than none, because they would be offered as if they were whole.
  if (found.some((o, i) => o.number !== i + 1)) return []
  // At most one highlighted row. Two cursors is a frame this parser does not understand.
  if (found.filter(o => o.selected).length > 1) return []

  return found
}

/**
 * Does this dialog need a CHOICE rather than a confirmation? — PURE.
 *
 * The question the UI asks before deciding whether it may send a bare confirm key. `false` for a
 * dialog with no readable options, which is the codex-shaped `Press enter to continue` case: there
 * really is nothing to choose between.
 */
export function needsChoice(options: readonly DialogOption[]): boolean {
  return options.length > 1
}
