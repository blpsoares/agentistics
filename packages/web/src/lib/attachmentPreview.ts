/**
 * attachmentPreview.ts — PURE. Which parts of a turn's text are image ATTACHMENTS, not prose.
 *
 * An attachment here is a PATH — see `attachment-web.ts`'s header: the composer types a line into a
 * tmux pane, so `send()` joins the quote, then one line per attachment's own path, then whatever was
 * typed. The transcript records exactly that, verbatim, so the same rule reads the same turn text
 * whether it is the client's own echo or the harness's own record — one rule, not two.
 *
 * The PATH rule itself (`isImagePath`, `splitImageAttachments`) now lives in `@agentistics/core` and
 * is re-exported here unchanged: the server reads a delivered message with it to record what that
 * message carried, and a second copy would let the record and the render disagree.
 */

import type { AttachmentMessage, AttachmentSend } from '@agentistics/core'

export { isImagePath, splitImageAttachments, type SplitAttachments } from '@agentistics/core'

/**
 * `[Image #4]` — what the HARNESS writes where an image was, and it is not prose.
 *
 * A separate rule from `splitImageAttachments` because it answers about a different kind of thing.
 * That one finds a PATH the composer typed, which names a file this product can open. This one
 * finds a MARKER Claude Code substituted into the turn it recorded: an ordinal and nothing else, so
 * there is no file behind it and never will be — the honest render is a chip saying which image it
 * was, not a thumbnail we cannot produce.
 *
 * It exists because of what a QUEUED prompt looks like on arrival. A harness that is mid-turn holds
 * what arrives and commits the queue as ONE turn (see `echoMatch.ts`), so two prompts sent a minute
 * apart come back merged, with every image of both collected at the front:
 *
 *     [Image #4] [Image #5] [Image #6]1. a visao geral...
 *
 * — markers running straight into the first word, which is how a message with three screenshots on
 * it read as a message beginning with square brackets. The merging itself is the harness's, not
 * ours, and cannot be undone from here; the markers are ours to draw properly.
 *
 * LEADING ONLY, like `splitMessage`, and for a stronger reason than symmetry: this repo's own
 * conversations quote these markers while discussing them, so a rule matching anywhere would eat a
 * line somebody actually wrote. Every marker measured on real transcripts sits at the very start.
 */
export interface SplitMarkers {
  /** The ordinals, in the order the harness numbered them. */
  markers: number[]
  /** What is left once the leading run is removed. */
  text: string
}

const LEADING_MARKER = /^\s*\[Image #(\d+)\]/

export function splitImageMarkers(text: string): SplitMarkers {
  const markers: number[] = []
  let rest = text
  for (;;) {
    const m = LEADING_MARKER.exec(rest)
    if (!m) break
    markers.push(Number(m[1]))
    rest = rest.slice(m[0].length)
  }
  return { markers, text: markers.length > 0 ? rest.trim() : text }
}


// --- a marker that CAN find its file ----------------------------------------

/**
 * How far back a turn may look for its own sends.
 *
 * Generous, because the whole point is the QUEUED case: the harness holds a message until its
 * current turn ends, which is minutes on a working session and occasionally much longer. Being
 * generous costs nothing — a window that catches a neighbouring message makes the count disagree,
 * and a disagreeing count resolves to nothing.
 */
export const SEND_WINDOW_MS = 60 * 60_000

/**
 * The files behind a turn's markers, in order — or `null` when it cannot be said.
 *
 * The comment above says a marker has no file behind it. That was WRONG, and this is the
 * correction: agentop wrote those files itself (185 of them on the machine this was measured on)
 * and knew the session it was typing them into. What was missing was never the file — it was the
 * record that we sent it, which `attachment-web.ts` now keeps.
 *
 * ALL-OR-NOTHING, deliberately. Drawing the WRONG image under a message is worse than drawing a
 * chip: a chip says "an image was here", which is true and useless, while a wrong thumbnail is
 * false and convincing. So markers resolve only when the record accounts for them EXACTLY — same
 * count, one file per marker — and every case that cannot be settled answers `null`.
 *
 * The ordinals are the harness's numbering across its WHOLE conversation, so they are a count here
 * and never an index into anything of ours.
 *
 * TWO RECORDS, and which one is asked is decided by WHEN the turn happened:
 *
 * - **Messages** (`AttachmentMessage`) — what each delivered message carried, read off the text at
 *   the moment it was typed. Once a conversation has ONE such record, this build is the one writing
 *   them and every message it delivers is recorded, so for every turn from then on they are the only
 *   evidence. The turn's markers must equal the images of the messages delivered AFTER the previous
 *   person's turn (`sinceMs`) and at or before this one: a harness commits its queue as one turn, so
 *   everything sent in that interval is this turn, and everything sent before the previous turn was
 *   that turn's. That bound is load-bearing — most messages arrive with their paths intact (185
 *   turns kept them against 34 that became markers on the machine this was measured on), and a
 *   message already SHOWN as paths in an earlier turn must never be offered to a later marker.
 * - **Uploads** (`AttachmentSend`) — the older record, stamped when a file was written rather than
 *   when it was sent. A turn from before the conversation's first message record is resolved exactly
 *   as it always was, by counting uploads in the window. That rule could not tell a previous
 *   message's files, or one removed from the composer, from this turn's: measured, a message with
 *   four markers sat in a window holding seven uploads, and it drew chips. It is kept for history,
 *   never extended.
 */
export function resolveMarkerPaths(input: {
  markers: readonly number[]
  turnAtMs: number
  sends: readonly AttachmentSend[]
  /** What delivered messages carried, for this turn's conversation. */
  messages?: readonly AttachmentMessage[]
  /** When the previous PERSON's turn was recorded — see `previousPersonTurnMs`. */
  sinceMs?: number | null
}): string[] | null {
  if (input.markers.length === 0) return null
  const messages = input.messages ?? []
  const firstMessageAt = messages.reduce((min, m) => Math.min(min, m.atMs), Number.POSITIVE_INFINITY)
  if (input.turnAtMs >= firstMessageAt) {
    return resolveFromMessages(input.markers.length, input.turnAtMs, messages, input.sinceMs ?? null)
  }
  const inWindow = input.sends
    .filter(s => s.atMs <= input.turnAtMs && input.turnAtMs - s.atMs <= SEND_WINDOW_MS)
    .sort((a, b) => a.atMs - b.atMs)
  if (inWindow.length !== input.markers.length) return null
  return inWindow.map(s => s.path)
}

function resolveFromMessages(
  count: number,
  turnAtMs: number,
  messages: readonly AttachmentMessage[],
  sinceMs: number | null,
): string[] | null {
  const mine = messages
    .filter(m => m.atMs <= turnAtMs && turnAtMs - m.atMs <= SEND_WINDOW_MS)
    .filter(m => sinceMs === null || m.atMs > sinceMs)
    .sort((a, b) => a.atMs - b.atMs)
  if (mine.length === 0) return null
  // A message that named an image this machine cannot serve is short, and a short message cannot be
  // accounted for — pairing around the gap would put a neighbour's file under the wrong marker.
  if (mine.some(m => m.paths.length !== m.images)) return null
  const paths = mine.flatMap(m => m.paths)
  return paths.length === count ? paths : null
}

/**
 * When the last turn a PERSON wrote before `index` was recorded, in ms — or `null` when there is
 * none in view.
 *
 * The lower bound of the messages a marker turn may be made of (see `resolveMarkerPaths`). A turn
 * the HARNESS wrote under the user's role — a system note, a background task line — is not a
 * message anybody sent, so it closes no interval. A person's turn with no timestamp closes it
 * without saying where, and that is answered with `Infinity`: nothing after an unknown boundary can
 * be proven to belong to this turn, so nothing resolves, and the chip stays.
 */
export function previousPersonTurnMs(
  turns: readonly { role: 'user' | 'assistant'; at?: string; system?: string; task?: unknown }[],
  index: number,
): number | null {
  for (let i = Math.min(index, turns.length) - 1; i >= 0; i--) {
    const t = turns[i]!
    if (t.role !== 'user' || t.system !== undefined || t.task !== undefined) continue
    const ms = t.at ? Date.parse(t.at) : Number.NaN
    return Number.isFinite(ms) ? ms : Number.POSITIVE_INFINITY
  }
  return null
}

/**
 * Which image the composer's lightbox is showing, or `null` for closed.
 *
 * The composer's attachment list is editable while the overlay is open, so the index it was opened
 * at can stop naming anything — and `AttachmentLightbox` renders nothing for a missing path, which
 * leaves a black overlay with no picture in it. This is the one place that decides, so the rule is
 * stated once rather than re-derived at the render.
 *
 * It CLOSES rather than clamps. Sliding to the last remaining image after the reader removed the
 * one they were looking at answers a question nobody asked, and it does it silently — the same
 * reason `parseDialogOptions` refuses a half-read option list instead of offering what it managed
 * to read.
 */
export function openComposerLightbox(open: number | null, count: number): number | null {
  if (open === null) return null
  if (!Number.isInteger(open) || open < 0) return null
  return open < count ? open : null
}
