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

import type { MachineActionReply, MachineFleetReply, MachineFleetRow, TeamConnection } from '@agentistics/core'
import { reduceMachineFleetRow, remoteActionAllowed, resolveRemoteConsent } from '@agentistics/core'
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
    // Narrowed to what may be driven from a central BEFORE the reduction, so a verb this machine
    // will refuse never even appears on the row. Offering one and refusing it on the click is the
    // control-that-reads-as-broken this codebase keeps arguing against.
    const verbs = Array.isArray(row.verbs)
      ? (row.verbs as { action?: unknown }[]).filter(v => typeof v?.action === 'string' && remoteActionAllowed(v.action, consent))
      : undefined
    rows.push(reduceMachineFleetRow({ ...row, ...(verbs ? { verbs } : {}) }))
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

/**
 * Perform one verb asked for by a central.
 *
 * THE MACHINE IS THE AUTHORITY, and this function is where that stops being a slogan. The consent
 * is re-read from preferences on every request rather than trusted from the asker, and the verb is
 * checked against `remoteActionAllowed` HERE as well as on the central — a central is the party
 * whose behaviour this machine cannot verify, so a check that runs only there is not a check.
 *
 * `approve` and `prompt` are refused with a sentence naming WHY: they need the session's screen,
 * which does not travel. A refusal that says nothing is indistinguishable from a broken control —
 * the same rule `fleet-row.ts` states for a verb a row cannot take.
 *
 * The refusal wording is this machine's, in this machine's language, because every other refusal
 * the user meets already is.
 */
export async function performMachineAction(
  conn: Pick<TeamConnection, 'allowRemoteSessions' | 'allowRemoteScreens'>,
  lang: CliLang,
  req: { action: string; id: string; text?: string },
  deps: { runAction: (lang: CliLang, req: { id: string; action: string; text?: string }) => Promise<MachineActionReply> },
): Promise<MachineActionReply> {
  const pt = lang === 'pt'
  const consent = resolveRemoteConsent(conn.allowRemoteSessions, conn.allowRemoteScreens)
  if (!consent.sessions) {
    return {
      ok: false,
      message: pt
        ? 'Esta máquina não permite gerenciar sessões a partir de uma central.'
        : 'This machine does not allow session management from a central.',
    }
  }
  if (!req.id) {
    return { ok: false, message: pt ? 'Nenhuma sessão indicada.' : 'No session named.' }
  }
  if (!remoteActionAllowed(req.action, consent)) {
    // Named rather than generic: "not allowed" would read the same for a verb that needs the
    // screen and for one that does not exist, and they are different problems.
    const needsScreen = req.action === 'approve' || req.action === 'prompt'
    return {
      ok: false,
      message: needsScreen
        ? (pt
          ? 'Responder a uma sessão exige ver a tela dela, e a tela não sai desta máquina.'
          : 'Answering a session needs to read its screen, and the screen does not leave this machine.')
        : (pt
          ? 'Esta ação não pode ser feita a partir de uma central.'
          : 'This action cannot be performed from a central.'),
    }
  }
  return await deps.runAction(lang, { id: req.id, action: req.action, text: req.text })
}
