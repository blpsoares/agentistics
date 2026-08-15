/**
 * conversation-claim.ts — PURE. Which conversations are being driven RIGHT NOW, and by what.
 *
 * This exists because of the worst thing the session manager has done: it opened the SAME
 * CONVERSATION in two terminals at once. Measured on this machine on 2026-08-14 — five conversations
 * were recorded against two to four not-ended registry rows each, one of them four times:
 *
 *   cd118e71…  44d649269a  .../worktrees/parse-cache-sqlite
 *              1da098e5cb  /home/mithrandir/agentistics
 *   03fa293a…  1ec25fc3d1  .../worktrees/cockpit-remount-flash
 *              e477d4e628  /home/mithrandir/agentistics
 *
 * Reading the two screens side by side showed identical text: one conversation, two assistants
 * typing into it. Claude Code itself notices and says so —
 *
 *   Remote Control not started here · another Claude Code on this machine
 *   (started 16s ago) already has Remote Control for this conversation
 *
 * — so the HARNESS knew and agentop, which started both, did not. It is not a display problem: the
 * two write to one transcript and to one working tree. The parse-cache session stopped itself, wrote
 * that somebody else was editing the same files, and declined to dispatch its next agent. It was
 * right, and the somebody was its own twin.
 *
 * ## Only EXACT evidence counts, and that is the whole design
 *
 * There are three ways to say which conversation a row drives, and they are not interchangeable:
 *
 *  1. the harness's own record (`~/.claude/sessions/<pid>.json`, matched by tmux session name or by
 *     pid) — a FACT, written by the process about itself;
 *  2. the id the registry stored while the session was up — a recollection, but an exact one;
 *  3. harness-and-directory inference — a GUESS, and the one that cannot tell two sessions of one
 *     repository apart.
 *
 * A lock built on (3) is a lock that jams: every session in a repository resolves to the same
 * conversation, so the second reopen in any repo would be refused forever, and people would learn to
 * work around the door rather than through it. So only (1) and (2) are ever admitted here — the same
 * line `session-view.ts` already draws between `metricsOf` (exact only) and `claimResume` (may
 * guess). The cost is stated plainly: a twin created without either kind of record is invisible to
 * this module and is not prevented. Refusing on a guess would be worse.
 *
 * ## Alive, not merely known
 *
 * The harness's records OUTLIVE their processes — 53 files on this machine against about a dozen live
 * ones. A conversation is therefore in use only when the row holding it is ALIVE, and the caller says
 * which those are. Reading the records alone would refuse to reopen anything that ever ran.
 */

/** A live session, as much of it as a refusal needs to name. */
export interface ClaimingSession {
  /** The row id — a managed session id, or an external row's id. */
  id: string
  /**
   * Whether this session is running NOW.
   *
   * Load-bearing: a harness record left behind by a finished process would otherwise lock its
   * conversation out of ever being reopened, which is the one thing the reopen verb is for.
   */
  alive: boolean
  /**
   * The conversation it drives, from an EXACT source only — the harness's own record, or the id the
   * registry stored. Never a harness-and-directory inference. See the module header.
   */
  conversationId?: string
  /** What to call it when refusing, already display-ready. */
  label?: string
}

/** Who is holding a conversation. */
export interface ConversationHolder {
  /** The live row driving it. */
  id: string
  /** Its name, or its id when it has none — a refusal that names nothing cannot be acted on. */
  label: string
}

/**
 * Conversation id → the live session driving it — PURE.
 *
 * FIRST alive holder wins, so the map is stable regardless of how many twins already exist: the
 * point is to name ONE session the user can go and look at, not to enumerate a mess.
 */
export function conversationsInUse(
  sessions: readonly ClaimingSession[],
): Map<string, ConversationHolder> {
  const held = new Map<string, ConversationHolder>()
  for (const s of sessions) {
    if (!s.alive || !s.conversationId) continue
    if (held.has(s.conversationId)) continue
    held.set(s.conversationId, { id: s.id, label: s.label?.trim() || s.id })
  }
  return held
}

/**
 * The live session already driving `conversationId`, or `undefined` — PURE.
 *
 * `exclude` is the row being replaced. Reopening a row onto its own conversation is the ordinary
 * case and must never be refused by the row itself: it is normally not alive at that point (that is
 * why it is being reopened), but a finished row can keep a lingering backend pane, and a lock that
 * refuses the very gesture it exists to protect is a lock nobody keeps.
 */
export function conversationHeldBy(
  held: ReadonlyMap<string, ConversationHolder>,
  conversationId: string | undefined,
  exclude?: string,
): ConversationHolder | undefined {
  if (!conversationId) return undefined
  const holder = held.get(conversationId)
  if (!holder || holder.id === exclude) return undefined
  return holder
}

/**
 * Conversations this machine is driving from more than one live session — PURE.
 *
 * Not used by the lock, which only ever asks about one conversation. This answers the OTHER half of
 * the same fact: the fleet that already has twins, from before the door was locked. Sorted by
 * conversation id so a report of it is stable between reads.
 */
export function duplicateConversations(
  sessions: readonly ClaimingSession[],
): { conversationId: string; holders: ConversationHolder[] }[] {
  const byConv = new Map<string, ConversationHolder[]>()
  for (const s of sessions) {
    if (!s.alive || !s.conversationId) continue
    const list = byConv.get(s.conversationId) ?? []
    list.push({ id: s.id, label: s.label?.trim() || s.id })
    byConv.set(s.conversationId, list)
  }
  return [...byConv.entries()]
    .filter(([, holders]) => holders.length > 1)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([conversationId, holders]) => ({ conversationId, holders }))
}
