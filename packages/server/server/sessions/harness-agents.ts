/**
 * harness-agents.ts — PURE parsing of what the harness says about its OWN live sessions.
 *
 * ## Why this exists, and why it outranks everything beside it
 *
 * agentop has been INFERRING which conversations are alive: reading `/proc`, matching pids against
 * `~/.claude/sessions/<pid>.json`, comparing directories, probing `procStart` so a recycled pid
 * cannot lie. Every one of those is a workaround for not being able to ask.
 *
 * `claude agents --json` is the tool answering directly, and it answers with more than the
 * inference ever recovered. Measured on this machine on 2026-08-15:
 *
 * ```json
 * {"pid":508665,"id":"581deab7","cwd":"…/worktrees/session-monitor","kind":"background",
 *  "startedAt":1786762198260,"sessionId":"581deab7-…","name":"MAIN",
 *  "status":"busy","state":"working"}
 * ```
 *
 * That single record carries the conversation id, the pid, the directory, **the name the user
 * typed**, and the ACTIVITY — the last of which agentop derives by capturing the pane and matching
 * screen markers. It also includes BACKGROUND agents, which have no tty and no tmux and were
 * therefore the sessions the whole inference chain could never see.
 *
 * It does not replace the screen probe: `state` here is what the harness knows about itself, and
 * `waiting-approval` — a session blocked on a permission dialog — is a fact about the SCREEN that
 * only the screen shows. The two are complementary, and where they disagree the screen wins on the
 * question it can answer and this wins on identity.
 *
 * ## Read like someone else's format, because it is
 *
 * Same discipline as `harness-session-file.ts` and `antigravity-protobuf.ts`: every field checked,
 * a missing or wrong-typed one yields "not known" rather than a throw, and a record that will not
 * parse is skipped rather than taking the list with it. The command is a CLI whose output shape is
 * not ours to depend on.
 */

/** One live session, as the harness describes it. */
export interface HarnessAgent {
  /** The conversation id — the exact key everything else here correlates on. */
  sessionId: string
  /** OS pid, when stated. */
  pid?: number
  cwd?: string
  /** `background` for an agent with no terminal; absent or something else for an interactive one. */
  kind?: string
  /** The name the user gave the session. Absent when it has none. */
  name?: string
  /** What the harness says it is doing (`working`, `idle`, …). Never a screen reading. */
  state?: string
  startedAt?: number
}

/**
 * Parse `claude agents --json` — PURE, total, never a throw.
 *
 * A record with no `sessionId` is dropped: it is the only field every consumer keys on, and a row
 * that cannot be correlated is worse than absent — it would appear as a session nothing can act on.
 */
export function parseHarnessAgents(raw: string): HarnessAgent[] {
  let data: unknown
  try {
    data = JSON.parse(raw)
  } catch {
    return []
  }
  if (!Array.isArray(data)) return []

  const str = (v: unknown): string | undefined =>
    typeof v === 'string' && v !== '' ? v : undefined
  const num = (v: unknown): number | undefined =>
    typeof v === 'number' && Number.isFinite(v) ? v : undefined

  const out: HarnessAgent[] = []
  for (const item of data) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue
    const o = item as Record<string, unknown>
    const sessionId = str(o.sessionId)
    if (!sessionId) continue
    out.push({
      sessionId,
      ...(num(o.pid) !== undefined ? { pid: num(o.pid)! } : {}),
      ...(str(o.cwd) ? { cwd: str(o.cwd)! } : {}),
      ...(str(o.kind) ? { kind: str(o.kind)! } : {}),
      ...(str(o.name) ? { name: str(o.name)! } : {}),
      ...(str(o.state) ? { state: str(o.state)! } : {}),
      ...(num(o.startedAt) !== undefined ? { startedAt: num(o.startedAt)! } : {}),
    })
  }
  return out
}

/** Indexed by conversation id — the one key every other source can be matched against. */
export function indexAgents(agents: readonly HarnessAgent[]): Map<string, HarnessAgent> {
  const byConversation = new Map<string, HarnessAgent>()
  // Later wins: the list is the harness's own and holds one entry per live session, so a repeat
  // would be a format surprise rather than history. Taking the last is the same rule the other
  // readers use, and it is stated so nobody has to guess which.
  for (const a of agents) byConversation.set(a.sessionId, a)
  return byConversation
}

/**
 * Is this conversation actually HELD by a running assistant?
 *
 * **Being in the list is not being alive, and that distinction is the whole bug.** Measured on this
 * machine on 2026-08-15: `claude agents --json` returned 8 records and only **2** carried a pid.
 * The other six were `kind: background, state: blocked` with no process at all — conversations the
 * daemon still knows about and nothing is running.
 *
 * Treating presence in the list as "alive" is what made the cockpit refuse to reopen a conversation
 * that nothing was holding, and answer with "open it where it already is" — a place that did not
 * exist, because there was no process to be anywhere. Those six are precisely the sessions REOPEN
 * is for.
 *
 * So a conversation is held only when the harness names a pid for it. The caller supplies `running`
 * to confirm that pid still exists, because a record can outlive its process and this decision
 * blocks a verb the user is asking for.
 */
export function agentHeld(
  index: ReadonlyMap<string, HarnessAgent>,
  conversationId: string,
  running: (pid: number) => boolean,
): boolean {
  const pid = index.get(conversationId)?.pid
  return pid !== undefined && running(pid)
}

/**
 * Whether this live session can be reached only through the harness's own agent view.
 *
 * A BACKGROUND agent has no tty and no tmux: there is no terminal to attach to and no second copy
 * that may be started. `claude agents` is the tool's supported way in, and it is the answer the
 * cockpit must offer instead of a sentence telling someone to "open it where it already is" — which
 * is exactly the dead end this replaces, because there is no "where".
 */
export function needsAgentView(agent: HarnessAgent | undefined): boolean {
  return agent?.kind === 'background'
}
