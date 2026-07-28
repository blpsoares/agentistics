/**
 * machineTeams.ts — the single, pure answer to "which teams does this machine belong to?".
 *
 * THE PROBLEM THIS FIXES: team membership used to be readable ONLY off the machine document
 * (`teamIds`). Accounts join a team through their own `memberships`, so adding account A to team T
 * did nothing for A's machines: filtering by T silently skipped every session those machines
 * produced. A team with three accounts and no explicitly-attached machine reported ZERO.
 *
 * THE MODEL: a machine's teams are DERIVED, with exceptions —
 *
 *     teams(machine) = (explicit ∪ inherited-from-owner-accounts) − excluded
 *
 * so there are three states, not two:
 *   - inherited — came in with an owner account. Cannot be "added" again (it is already there);
 *     the UI shows it as a member of the team, tagged with the account it came from.
 *   - excluded — inherited (or explicit) and then deliberately unchecked. This is why the
 *     exclusion list has to be STORED: without it, unchecking an inherited team has nowhere to be
 *     recorded and the machine reappears on the next read.
 *   - explicit — attached to the team directly, independent of any account.
 *
 * SCOPE OF THIS FUNCTION — aggregation and filtering ONLY. Deliberately NOT wired into
 * `canManageMachine`: inheritance would silently widen a team manager's authority to every machine
 * of every account in their teams. Authority keeps reading the stored `teamIds`; if that widening
 * is ever wanted it should be its own reviewed change, not a side effect of a filter fix.
 */

/** The machine fields this resolution reads. Matches both the Mongo token doc and MachineInfo. */
export interface MachineTeamRefs {
  /** Teams attached directly to the machine (legacy single `teamId` still honored). */
  teamIds?: string[]
  teamId?: string
  /** Owner accounts (legacy single `accountId` still honored). */
  accountIds?: string[]
  accountId?: string
  /** Teams this machine is held OUT of, even though it would otherwise inherit or carry them. */
  excludedTeamIds?: string[]
}

export interface ResolvedMachineTeams {
  /** The effective set — what every filter, aggregate and cache scope must use. */
  teams: string[]
  /** Effective teams that came from an owner account rather than from the machine itself. */
  inherited: string[]
  /** Teams held out by an explicit exclusion (a subset of what would otherwise be effective). */
  excluded: string[]
  /** Teams attached directly to the machine and not excluded. */
  explicit: string[]
}

const uniq = (xs: string[]): string[] => [...new Set(xs.filter(Boolean))]

/** Canonical team list of a machine document, tolerating the legacy single-value field. */
export function ownTeamIds(m: MachineTeamRefs): string[] {
  if (m.teamIds && m.teamIds.length) return uniq(m.teamIds)
  return m.teamId ? [m.teamId] : []
}

/** Canonical owner-account list of a machine document, tolerating the legacy single-value field. */
export function ownerAccountIds(m: MachineTeamRefs): string[] {
  if (m.accountIds && m.accountIds.length) return uniq(m.accountIds)
  return m.accountId ? [m.accountId] : []
}

/**
 * Resolve one machine's effective teams.
 *
 * `accountTeams` maps accountId → the teams that account belongs to (built from each account's
 * `memberships`). An account missing from the map simply contributes nothing — a deleted account
 * can never resurrect a team.
 */
export function resolveMachineTeams(
  machine: MachineTeamRefs,
  accountTeams: Record<string, string[]>,
): ResolvedMachineTeams {
  const own = ownTeamIds(machine)
  const excludedSet = new Set(machine.excludedTeamIds ?? [])

  const inheritedAll = uniq(
    ownerAccountIds(machine).flatMap(id => accountTeams[id] ?? []),
  ).filter(t => !own.includes(t))

  const explicit = own.filter(t => !excludedSet.has(t))
  const inherited = inheritedAll.filter(t => !excludedSet.has(t))
  // Only report an exclusion that actually holds something back; a stale id for a team the machine
  // would not be in anyway is noise, and would render as a phantom unchecked row in the UI.
  const excluded = uniq([...own, ...inheritedAll]).filter(t => excludedSet.has(t))

  return { teams: uniq([...explicit, ...inherited]), inherited, excluded, explicit }
}

/** accountId → teamIds, from the accounts collection. Pure; the shape both callers need. */
export function accountTeamsMap(
  accounts: { _id: string; memberships?: { teamId: string }[] }[],
): Record<string, string[]> {
  const out: Record<string, string[]> = {}
  for (const a of accounts) out[a._id] = uniq((a.memberships ?? []).map(m => m.teamId))
  return out
}

/**
 * Effective teams for MANY machines at once — machineId → teams. The form the session filter
 * (`getMemberTeamsMap`) and the per-machine aggregates both consume, so the two can never diverge.
 */
export function resolveMachineTeamsMap<T extends MachineTeamRefs & { id?: string; _id?: string }>(
  machines: T[],
  accountTeams: Record<string, string[]>,
): Record<string, string[]> {
  const out: Record<string, string[]> = {}
  for (const m of machines) {
    const key = m.id ?? m._id
    if (key) out[key] = resolveMachineTeams(m, accountTeams).teams
  }
  return out
}
