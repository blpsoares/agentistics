/**
 * repoDrag.ts — PURE: the ONE MIME a tree row's drag carries, what the WRITER puts on it, and a
 * READER hostile payloads cannot fool.
 *
 * This is the contract §6 (references into the conversation, a later package) consumes too: a row
 * dragged onto the composer reads through this exact module rather than a second copy of the shape
 * — defined once, here, so the writer and every reader agree on what a drag actually carries.
 *
 * `readRepoDrag` is the one function worth distrusting input into: a `DataTransfer` can carry
 * anything a page ever wrote to it (another origin's drag, a stale payload replayed by a test, a
 * handcrafted one), so every field is checked rather than cast. **A payload naming a DIFFERENT
 * session is refused exactly like a malformed one** — the caller's own `sessionId` is required and
 * compared here, never trusted from the payload, because a forged or simply stale cross-session
 * payload would otherwise ask the server to move a file in session A using session B's tree.
 */

export const REPO_DRAG_MIME = 'application/x-agentistics-repo-entry'

export interface RepoDragPayload {
  sessionId: string
  path: string
  kind: 'file' | 'dir'
}

/**
 * `dragstart` sets TWO representations of one drag: the structured payload under this feature's
 * own MIME, and the plain relative path under `text/plain` — so dropping a tree row into ANY other
 * text field (a terminal, another application, an address bar) gets the path rather than nothing.
 */
export function writeRepoDrag(dataTransfer: DataTransfer, payload: RepoDragPayload): void {
  dataTransfer.setData(REPO_DRAG_MIME, JSON.stringify(payload))
  dataTransfer.setData('text/plain', payload.path)
}

/**
 * `null` for anything this feature did not itself write: absent, unreadable, malformed JSON, a
 * shape missing a field, an unrecognised `kind`, an empty path, or a payload naming a session other
 * than the caller's own. A failed read is indistinguishable from "nothing of ours was dropped here"
 * on purpose — the caller's only correct response to either is to ignore the drop.
 */
export function readRepoDrag(dataTransfer: DataTransfer, sessionId: string): RepoDragPayload | null {
  let raw: string
  try {
    raw = dataTransfer.getData(REPO_DRAG_MIME)
  } catch {
    return null
  }
  if (typeof raw !== 'string' || raw === '') return null

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null

  const { sessionId: sid, path, kind } = parsed as Record<string, unknown>
  if (typeof sid !== 'string' || sid === '') return null
  if (typeof path !== 'string' || path === '') return null
  if (kind !== 'file' && kind !== 'dir') return null
  if (sid !== sessionId) return null

  return { sessionId: sid, path, kind }
}
