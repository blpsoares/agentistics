/**
 * live-claims.ts — the I/O behind `conversation-claim.ts`: which conversations this machine is
 * driving RIGHT NOW.
 *
 * It lives in its own module, and is used by both `cli-start.ts` (the cockpit) and `cli-session.ts`
 * (the command line), for the reason `task-reopen.ts` was extracted: those two are the SAME gesture
 * written twice, and every time a rule has been added to one of them it has been missing from the
 * other. A lock with a second unlocked entrance is not a lock.
 *
 * The DECISION — what counts as driving a conversation — is the pure `conversationsInUse`. This only
 * gathers the evidence, and only the EXACT kinds of it. See that module's header for why a
 * harness-and-directory guess may never be admitted here.
 */

import { scanProcesses } from '../live-sessions'
import { conversationsInUse, type ClaimingSession, type ConversationHolder } from './conversation-claim'
import { emptyHarnessSessionIndex, loadHarnessSessions } from './harness-sessions'
import { readRegistry } from './registry'
import { externalId } from './session-view'
import type { ManagedSession, SessionBackend } from './types'

/**
 * Conversation id → the live session driving it.
 *
 * Three reads, each contributing something the others cannot:
 *
 *  - the BACKEND says which managed rows are alive. Nothing else does: a harness record OUTLIVES its
 *    process (53 files on this machine against about a dozen live ones), so "there is a record" is
 *    not "it is running" — locking on the records alone would refuse to reopen anything that had
 *    ever run, which is every row this verb exists for.
 *  - the HARNESS's own files say which conversation a live session drives, matched by tmux session
 *    name for one we host and by pid for one we merely see. It is the only source that is a fact
 *    rather than a recollection, and the only one that can see an assistant started OUTSIDE agentop
 *    sitting in the very conversation someone is about to reopen.
 *  - the REGISTRY's `conversationId` covers a live row whose harness record cannot be read.
 *
 * Every read is best-effort and every failure degrades to "we do not know", never to a refusal: this
 * guard exists to prevent lost work, not to become a new way of losing the verb.
 */
export async function liveConversationHolders(
  backend: SessionBackend,
): Promise<Map<string, ConversationHolder>> {
  const [registry, backendSessions, harnessSessions, procs] = await Promise.all([
    readRegistry().catch(() => [] as ManagedSession[]),
    backend.list().catch(() => []),
    loadHarnessSessions().catch(() => emptyHarnessSessionIndex()),
    scanProcesses().then(r => r.procs).catch(() => []),
  ])
  const alive = new Set(backendSessions.filter(b => b.alive).map(b => b.id))

  const claims: ClaimingSession[] = []
  for (const m of registry) {
    // A retired row drives nothing, whatever pane the backend still holds for it.
    if (m.endedAt) continue
    const exact = harnessSessions.byManagedId.get(m.id)?.sessionId
    const conversationId = exact ?? m.conversationId
    if (!conversationId) continue
    claims.push({
      id: m.id,
      alive: alive.has(m.id),
      conversationId,
      ...(m.label ? { label: m.label } : {}),
    })
  }
  // An assistant running BESIDE agentop holds its conversation just as hard as one we started, and
  // it is the case the registry is blind to by construction. `/proc` only reports processes that
  // exist, so these are alive by definition.
  for (const p of procs) {
    const conversationId = p.pid !== undefined
      ? harnessSessions.byPid.get(p.pid)?.sessionId
      : undefined
    if (!conversationId) continue
    claims.push({ id: externalId(p), alive: true, conversationId, label: p.cwd })
  }
  return conversationsInUse(claims)
}
