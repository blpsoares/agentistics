/**
 * terminal-stream.ts — PURE. The shape of what the terminal channel puts on the wire, and the two
 * decisions that can be silently wrong if written by feel: whether a new capture is worth sending
 * (dedup) and how the pane's own facts become an honest frame.
 *
 * The transport is SSE (see `docs/terminal-channel.md` for the why), and the whole feature is a
 * SNAPSHOT model: each frame is a complete, self-contained picture of the pane as it renders RIGHT
 * NOW — colours and all — so a reader that joins late or reconnects needs no replay, and a
 * line-rewrite or a spinner is already resolved to its final glyph by tmux before we ever see it.
 * That is the same discipline `attention-rules.ts:5` states: what we show is what the pane really
 * rendered, never a reconstruction from memory of what a CLI prints.
 */

import type { PaneInfo } from './types'

/**
 * How many lines of scrollback+screen each frame carries.
 *
 * A screenful plus a margin: enough that a fast burst between two polls is not lost and the browser
 * has some history to scroll, bounded so a changed frame is tens of KB and not the whole 50k
 * backlog. The frame SAYS when there is more above it (`truncated`), so this is a shipping budget,
 * not a claim that this is all there is.
 */
export const TERMINAL_VIEW_LINES = 200

/** Default cadence of the shared capture loop. Snappy enough to feel live, slow enough that one
 *  watched session is two tmux reads a second and no more. Overridable for the real hub / tests. */
export const TERMINAL_POLL_MS = 500

/** One complete, self-contained picture of a pane. */
export interface TerminalFrame {
  /** Monotonic within one stream. A client can spot a gap, and a newcomer's first frame is its own
   *  seq so "did anything change" is answerable without diffing content. */
  seq: number
  /** The rendered pane, `\n`-joined, WITH SGR escape sequences intact. */
  content: string
  cols: number
  rows: number
  /** Where the block cursor sits — `null` once the pane is dead, because a cursor on a frozen frame
   *  is the frozen-but-looks-alive lie this channel exists to avoid. */
  cursor: { x: number; y: number } | null
  /** False once the hosted command has exited. The last frame stays readable; it is just marked. */
  alive: boolean
  /** How many lines `content` carries — the honest "you are seeing N lines" number. */
  lines: number
  /** The scrollback ceiling tmux keeps, so the UI can say "showing last N of up to M". */
  historyLimit: number
  /** True when there is more scrollback above than this frame carries. */
  truncated: boolean
}

/** Why a stream ended. `gone` = the session is no longer in tmux; `not-found` = it was never a
 *  session this machine manages (scope refusal); `error` = the backend could not be read. */
export type TerminalEndReason = 'gone' | 'not-found' | 'error'

/**
 * A cheap, total fingerprint of a capture — content plus every fact a frame carries EXCEPT `seq`
 * (which is derived from change) and `historyLimit`/`truncated` (which are derived from the rest).
 * Two captures with the same digest render identically, so the second is not worth a frame.
 *
 * `historySize` is deliberately included: the screen can look unchanged while a line has scrolled
 * off the top into history, and a reader watching the tail wants to know the pane moved.
 */
export function captureDigest(lines: string[], info: PaneInfo): string {
  return [
    info.cols, info.rows, info.cursorX, info.cursorY,
    info.alive ? 1 : 0, info.historySize, lines.length,
  ].join(',') + '\n' + lines.join('\n')
}

/**
 * Shape a raw capture into a frame.
 *
 * `truncated` is honest about the one thing this snapshot cannot show: scrollback beyond the window
 * we ship. We capture at most `viewLines` lines of history (`capture-pane -S -viewLines`), so there
 * is more above the fold precisely when the pane holds MORE history than that. `historyLimit` is the
 * ceiling tmux would ever keep, for the "showing last N of up to M" line.
 */
export function buildFrame(
  seq: number,
  lines: string[],
  info: PaneInfo,
  historyLimit: number,
  viewLines: number,
): TerminalFrame {
  return {
    seq,
    content: lines.join('\n'),
    cols: info.cols,
    rows: info.rows,
    cursor: info.alive ? { x: info.cursorX, y: info.cursorY } : null,
    alive: info.alive,
    lines: lines.length,
    historyLimit,
    truncated: info.historySize > viewLines,
  }
}

/** Encode one SSE event. Kept here, pure and tested, because a stray newline in the framing breaks
 *  the whole protocol and is exactly the kind of thing that is invisible until a client parses it. */
export function encodeSse(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
}
