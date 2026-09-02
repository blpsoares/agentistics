/**
 * machine-fleet.ts — the MEMBER side of relaying its fleet to a central.
 *
 * The machine is asked, over the reverse channel, for its own fleet; it answers with rows that
 * have been through two narrowings, in this order and never the other way round:
 *
 *  1. **The sharing rules.** A session in a repository or project this machine withholds from this
 *     central never becomes a row. The rule is `cwdShared` in `share-rules.ts` — the same one the
 *     live-session snapshot uses, so the two surfaces cannot disagree about one directory — and it
 *     is applied HERE, on the machine, because the machine is the only party that holds the rules
 *     and the only one whose application of them can be trusted.
 *  2. **The reduction.** `reduceMachineFleetRow` copies an allowlist of keys, so the screen, the
 *     conversation and the permission dialog cannot cross even by accident.
 *
 * Rules first, then reduce: reducing first would produce a row with no `cwd` to judge, and the
 * withheld count is a statement about SESSIONS, not about rows that happened to survive.
 *
 * The consent is re-read on every request rather than trusted from the caller. The central asking
 * is never the authority; the machine answering is, and a switch turned off half a second ago must
 * take effect on this frame rather than at the next handshake.
 */

import type { MachineFleetReply, MachineFleetRow, TeamConnection } from '@agentistics/core'
import { reduceMachineFleetRow, resolveRemoteConsent } from '@agentistics/core'
import type { CliLang } from '../cli-lang'

/** What `buildMachineFleetReply` needs from the world, so the decision itself stays testable. */
export interface MachineFleetDeps {
  readFleet: (lang: CliLang) => Promise<{
    rows: readonly Record<string, unknown>[]
    attention: number
    unavailable?: string
  }>
  /** The stored sessions + projects the repo index is built from — `buildApiResponse`'s output. */
  readIndexSources: () => Promise<{
    sessions: readonly { session_id: string; git_remote?: string; project_path: string }[]
    projects: readonly { path: string; gitRemote?: string }[]
  }>
}

/**
 * Build the reply for ONE connection's request.
 *
 * Returns `null` when this machine has not agreed — the caller sends nothing at all rather than an
 * empty list. An empty list is a statement about the fleet; silence is a statement about consent,
 * and the central already distinguishes them (`MachineFleetUnavailable`).
 */
export async function buildMachineFleetReply(
  conn: Pick<TeamConnection, 'allowRemoteSessions' | 'allowRemoteScreens' | 'shareMode' | 'sources'>,
  lang: CliLang,
  deps: MachineFleetDeps,
): Promise<MachineFleetReply | null> {
  const consent = resolveRemoteConsent(conn.allowRemoteSessions, conn.allowRemoteScreens)
  if (!consent.sessions) return null

  const shareRules = await import('../share-rules')
  const rules = shareRules.shareRulesOf(conn.shareMode, conn.sources)
  // An allowlist ALWAYS restricts (an empty one shares nothing), so the index cannot be gated on a
  // non-empty source set the way an unrestricted denylist's could — same clause as the live
  // snapshot's, and for the same reason.
  const restricted = rules.mode === 'allowlist' || rules.sources.size > 0

  const fleet = await deps.readFleet(lang)
  let index: import('../share-rules').PathRepoIndex | undefined
  if (restricted) {
    const src = await deps.readIndexSources()
    index = shareRules.buildPathRepoIndex(src.sessions as never, src.projects)
  }

  const rows: MachineFleetRow[] = []
  let withheld = 0
  for (const row of fleet.rows) {
    const cwd = typeof row.cwd === 'string' ? row.cwd : ''
    // A row with NO directory cannot be judged against a rule that names directories, so it is
    // withheld whenever any rule is in force. Sharing what cannot be checked is the fail-open
    // direction, and this channel is the sharpest one the product has.
    const shared = restricted ? (!!cwd && shareRules.cwdShared(cwd, rules, index)) : true
    if (!shared) { withheld++; continue }
    rows.push(reduceMachineFleetRow(row))
  }

  return {
    rows,
    // Counted by the MACHINE over its UNFILTERED fleet: it is the number the machine's own cockpit
    // shows, and recomputing it from the relayed rows would quietly answer a different question
    // ("how many of the ones you may see") under the same name.
    attention: fleet.attention,
    withheld,
    ...(fleet.unavailable ? { unavailable: fleet.unavailable } : {}),
  }
}
