/**
 * account-repos.ts — PURE. The two halves of the "another machine of mine still shares this
 * repository" warning: the CENTRAL's grouping of what it holds, and the MEMBER's local
 * intersection of that answer against its own rules.
 *
 * WHY THIS DISCLOSES NOTHING. The machine asks "what repositories do you hold for MY account",
 * never "do you hold repo X". The request carries no rule, no repository key and no hint of what
 * the machine cares about, so the question is identical whether the user just restricted
 * something, restricted nothing, or is merely refreshing a page. The answer is data the account
 * already owns and can already read through its own dashboard. The COMPARISON — the only step
 * that involves the machine's private rules — happens here, on the machine, against a response
 * that was computed without them. That is the whole reason this half of the feature needs no
 * cryptography: the rules never leave, not even in a form the central could infer them from.
 *
 * (The sealed envelope in `envelope-*.ts` is the other direction — telling the OTHER machines —
 * which genuinely cannot be done without something crossing the central, and so is encrypted.)
 *
 * No I/O, no Mongo, no preferences: everything here is unit-tested against fixtures.
 */

import { NO_REPO_KEY } from '@agentistics/core'
import { canonicalRepoKey, sessionShared, type ShareRules } from './share-rules'

/** One machine of the caller's account, as named by the central (the token's label). */
export interface AccountRepoMachine {
  /** The central's machine id (a token hash). Only ever the caller's own account's machines. */
  id: string
  /** Display name. Falls back to the id when the central has no label for it. */
  name: string
}

/** One repository the central holds for the account, and which machines pushed it. */
export interface AccountRepoEntry {
  /** Canonical repo key (`host/org/repo`), or `NO_REPO_KEY` for sessions with no linked repo. */
  remote: string
  machines: AccountRepoMachine[]
}

/**
 * Group the central's `(remote, memberId)` rows into one entry per repository. Keys are folded
 * with `canonicalRepoKey` — the same folding the member's own rules use — so a repo cloned over
 * SSH on one machine and over HTTPS on another is ONE row here, and a rule the user recognizes
 * cannot silently miss its alias.
 *
 * A missing/empty remote folds to `NO_REPO_KEY`, because "no linked repository" is a bucket the
 * user can restrict (`none:`) and therefore a bucket they must be able to be warned about.
 */
export function buildAccountRepoList(
  rows: readonly { remote?: string | null; memberId?: string | null }[],
  names: Readonly<Record<string, string>> = {},
): AccountRepoEntry[] {
  const byRepo = new Map<string, Map<string, string>>()
  for (const row of rows) {
    const memberId = (row.memberId ?? '').trim()
    if (!memberId) continue
    const folded = canonicalRepoKey((row.remote ?? '').trim())
    const remote = folded || NO_REPO_KEY
    let machines = byRepo.get(remote)
    if (!machines) {
      machines = new Map<string, string>()
      byRepo.set(remote, machines)
    }
    if (!machines.has(memberId)) machines.set(memberId, names[memberId] || memberId)
  }
  return [...byRepo.entries()]
    .map(([remote, machines]) => ({
      remote,
      machines: [...machines.entries()]
        .map(([id, name]) => ({ id, name }))
        .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id)),
    }))
    .sort((a, b) => a.remote.localeCompare(b.remote))
}

/** One repository this machine hides but another machine of the same account still sends. */
export interface ElsewhereRepo {
  /** Canonical repo key, or `NO_REPO_KEY`. */
  repo: string
  /** Names of the OTHER machines that still send it. Never includes this machine. */
  machines: string[]
}

/**
 * The local intersection. A repository is reported when THIS machine's rules would not share it
 * (`sessionShared` says no) and the central still holds it from a machine that is not this one.
 *
 * Self-exclusion is by machine id, not by name: this machine's own not-yet-forgotten sessions are
 * the retroactive-removal path (`pendingRules` / the resync strip), a different state with a
 * different remedy, and reporting it here would tell the user another machine is at fault when
 * none is.
 *
 * `project_path` is `''` because the central is asked for repositories only. A project-scoped rule
 * therefore cannot produce a warning — a narrower answer, never a wrong one.
 */
export function findStillShared(
  entries: readonly AccountRepoEntry[],
  rules: ShareRules,
  selfMachineId: string,
): ElsewhereRepo[] {
  const out: ElsewhereRepo[] = []
  for (const entry of entries) {
    const remote = entry.remote === NO_REPO_KEY ? '' : entry.remote
    if (sessionShared({ git_remote: remote, project_path: '' }, rules)) continue
    const others = entry.machines.filter(m => m.id !== selfMachineId)
    if (others.length === 0) continue
    out.push({ repo: entry.remote, machines: others.map(m => m.name) })
  }
  return out.sort((a, b) => a.repo.localeCompare(b.repo))
}

/**
 * Validate a central's `GET /api/team/account-repos` response. Total: junk yields an empty list
 * rather than throwing, because a central on an older build answers 404/HTML and that must read
 * as "no warning available", never as an error the user has to act on.
 */
export function parseAccountRepos(raw: unknown): AccountRepoEntry[] {
  if (!raw || typeof raw !== 'object') return []
  const repos = (raw as { repos?: unknown }).repos
  if (!Array.isArray(repos)) return []
  const out: AccountRepoEntry[] = []
  for (const item of repos) {
    if (!item || typeof item !== 'object') continue
    const remote = (item as { remote?: unknown }).remote
    const machines = (item as { machines?: unknown }).machines
    if (typeof remote !== 'string' || remote === '' || !Array.isArray(machines)) continue
    const parsedMachines: AccountRepoMachine[] = []
    for (const m of machines) {
      if (!m || typeof m !== 'object') continue
      const id = (m as { id?: unknown }).id
      const name = (m as { name?: unknown }).name
      if (typeof id !== 'string' || id === '') continue
      parsedMachines.push({ id, name: typeof name === 'string' && name ? name : id })
    }
    if (parsedMachines.length === 0) continue
    out.push({ remote, machines: parsedMachines })
  }
  return out
}
