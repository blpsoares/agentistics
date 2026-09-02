/**
 * liveTurn.ts — PURE. The turn that is being written RIGHT NOW, read off the terminal frame.
 *
 * Why this exists at all: the transcript is the truth but it arrives per TURN, because Claude writes
 * a message to its JSONL once the message is finished. The terminal frame is the opposite — it is
 * captured twice a second and shows the text as it appears — but it is a rendered TUI, wrapped to
 * the pane width with a status strip and an input box in it.
 *
 * So the two are used for what each is good at: completed turns are bubbles from the transcript,
 * and the in-flight one is drawn from the frame and REPLACED by the transcript's version the moment
 * that turn lands. This module is the second half, and it is deliberately conservative — everything
 * it produces is marked provisional by the caller and may never become history. A wrong reading of
 * the screen is corrected within seconds; a wrong reading kept in the transcript would be forever.
 */

/**
 * Lines that are chrome rather than speech.
 *
 * Matched at the START of a trimmed line, and only for shapes that cannot begin a sentence: a box
 * rule, a prompt caret, a spinner frame, or the status strip's own bracketed hints. Anything more
 * eager starts eating the assistant's actual words, which is the failure that matters here — a
 * missing line reads as a stall, and stalls are what this view exists to make visible.
 */
const CHROME = [
  /^[─━═╌┄┈▁▔▂▃▄▅▆▇█]/,
  /^[│┃║╎┆┊]\s*$/,
  /^[╭╮╰╯┌┐└┘├┤┬┴┼╔╗╚╝]/,
  // `(\s|$)`: the line is trimmed before matching, so a bare prompt arrives as `>` with the
  // space already gone — requiring whitespace after it let the caret through as speech.
  /^[>❯➜»](\s|$)/,
  /^[⠁-⣿](\s|$)/,
  /^\s*\((?:esc|ctrl|shift|tab|enter)\b/i,
  /^\s*\[(?:y\/n|yes|no)\]/i,
]

/** A line that is only box drawing, punctuation or whitespace says nothing. */
const NOTHING = /^[\s─━═│┃║╭╮╰╯┌┐└┘├┤┬┴┼·•.]*$/

export interface LiveTurnInput {
  /** The frame's lines, top to bottom, already stripped of ANSI by the terminal channel. */
  lines: readonly string[]
  /** The last COMPLETED assistant turn's text, so an unchanged screen is not shown twice. */
  lastCommitted?: string
  /** False when the session is not working — a still screen is not an in-flight turn. */
  working: boolean
}

/**
 * The text the assistant appears to be producing right now, or `null`.
 *
 * `null` — not an empty string — whenever there is nothing to show, so the caller renders no bubble
 * rather than an empty one. Four cases yield it: the session is not working, the frame is chrome
 * only, the frame says nothing the transcript has not already committed, or the frame is empty.
 */
export function liveTurnText(input: LiveTurnInput): string | null {
  if (!input.working) return null

  const kept: string[] = []
  for (const raw of input.lines) {
    const line = raw.replace(/\s+$/, '')
    const trimmed = line.trim()
    if (trimmed === '' || NOTHING.test(trimmed)) {
      // A blank line INSIDE the kept text is a paragraph break and is preserved; leading ones are
      // the empty top of a terminal and are not.
      if (kept.length > 0) kept.push('')
      continue
    }
    if (CHROME.some(re => re.test(trimmed))) continue
    kept.push(line)
  }

  while (kept.length > 0 && kept[kept.length - 1] === '') kept.pop()
  const text = kept.join('\n').trim()
  if (text === '') return null

  // The screen still showing the last committed turn is not a new one. Compared on collapsed
  // whitespace because the frame wraps at the pane width and the transcript does not: the same
  // paragraph differs only by where its newlines fell.
  if (input.lastCommitted && collapse(text) === collapse(input.lastCommitted)) return null

  // A screen that merely ENDS with the committed turn is that turn plus chrome we failed to strip.
  if (input.lastCommitted && collapse(input.lastCommitted).endsWith(collapse(text))) return null

  return text
}

function collapse(s: string): string {
  return s.replace(/\s+/g, ' ').trim()
}
