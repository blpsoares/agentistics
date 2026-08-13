/**
 * link-sessions.ts — PURE. Which recorded session is the one agentop started?
 *
 * The session manager knows a session by ITS id; the harness records the conversation under its own.
 * Nothing ties the two together on disk, so the link has to be inferred — and this is a metrics
 * store, which is the last place to be lucky.
 *
 * So the rule is: infer only when there is exactly ONE candidate, and stamp nothing otherwise. An
 * unlabelled session is a small, self-correcting disappointment. A label on the WRONG session is a
 * user reading someone else's work under a name they chose themselves, and they have no way to tell.
 */

import type { HarnessId, SessionMeta } from '@agentistics/core'
import { sessionAtCwd } from '../live-sessions'
import type { ManagedSession } from './types'

/**
 * How long after `agentop session start` a conversation may appear and still be attributed to it.
 *
 * Generous, because a harness writes its first record only once a turn completes — an assistant that
 * sat on its folder-trust dialog for ten minutes before anyone answered is still that session. It is
 * bounded at all only so that a session started days ago cannot claim a fresh conversation in the
 * same directory.
 */
export const LINK_WINDOW_MS = 6 * 60 * 60 * 1000

/**
 * Pair managed sessions with the conversations they produced.
 *
 * Returns `Map<session_id, ManagedSession>` — keyed by the HARNESS's id, because that is what the
 * caller is holding when it stamps.
 *
 * Ambiguity is refused in BOTH directions: a managed session matching two conversations links to
 * neither, and a conversation two managed sessions could claim is left alone. Both are the same
 * mistake — attributing on a coin flip — and both happen for real, because opening two assistants of
 * one harness in one repository is an ordinary thing to do.
 */
export function linkManagedSessions(
  managed: readonly ManagedSession[],
  sessions: readonly SessionMeta[],
  windowMs: number = LINK_WINDOW_MS,
): Map<string, ManagedSession> {
  // A managed session with no usable creation time cannot be bounded, so it is not linked at all.
  const withStart = managed
    .map(m => ({ m, startedMs: Date.parse(m.createdAt) }))
    .filter((x): x is { m: ManagedSession; startedMs: number } => Number.isFinite(x.startedMs))

  const claims = new Map<string, ManagedSession[]>()

  for (const { m, startedMs } of withStart) {
    const candidates = sessions.filter(s => {
      if (s.harness !== (m.harness as HarnessId)) return false
      // Both of the session's directories count, the same predicate the live panel uses: a session
      // that moved into a worktree records it as `current_cwd` while `project_path` stays at the
      // root, and the managed session holds only the one directory it was started in.
      if (!sessionAtCwd(s, m.cwd)) return false
      const at = Date.parse(s.start_time ?? '')
      if (!Number.isFinite(at)) return false
      // Strictly after, and inside the window. A conversation that predates the start is not it.
      return at >= startedMs && at - startedMs <= windowMs
    })

    // Two conversations this session could be — refuse rather than take the closest. "Closest" is a
    // coin flip dressed as a rule when two assistants were opened in one directory minutes apart.
    if (candidates.length !== 1) continue

    const id = candidates[0]!.session_id
    const list = claims.get(id)
    if (list) list.push(m)
    else claims.set(id, [m])
  }

  const out = new Map<string, ManagedSession>()
  for (const [id, list] of claims) {
    // The other direction of the same refusal.
    if (list.length === 1) out.set(id, list[0]!)
  }
  return out
}

/** Stamp the user's own label and note onto the sessions they belong to. Mutates in place, like the
 *  rest of the enrichment pipeline, and touches nothing it cannot attribute. */
export function applySessionLabels(
  sessions: SessionMeta[],
  links: ReadonlyMap<string, ManagedSession>,
): void {
  for (const s of sessions) {
    const m = links.get(s.session_id)
    if (!m) continue
    if (m.label) s.user_label = m.label
    if (m.note) s.user_note = m.note
  }
}
