/**
 * team-account-repos.ts — GET /api/team/account-repos (CENTRAL side): the distinct repositories
 * this central holds for the AUTHENTICATED TOKEN'S ACCOUNT, and which of that account's machines
 * pushed each one.
 *
 * The question a machine asks here carries no rule and names no repository — it is "what do you
 * hold for my account", identical whether the caller just restricted something or nothing. The
 * intersection against the caller's private rules happens on the caller (`account-repos.ts`,
 * `findStillShared`), which is why this route lets a machine detect that a sibling still shares a
 * repo it just hid WITHOUT disclosing its rules to the central. See `account-repos.ts`.
 *
 * MINTED TOKEN ONLY, and scoped by the token's owner ACCOUNTS (`listSiblingMachines`), never by
 * team and never globally: the response must contain nothing about a machine the caller's account
 * does not own. A token with no owner account sees only itself.
 */
import { getTeamCollection } from './mongo'
import { validateIngestToken, listSiblingMachines } from './team-tokens'
import { buildAccountRepoList, type AccountRepoEntry } from './account-repos'
import { safeError } from './errors'
import { PROFILE } from './exposure'

const JSON_HEADERS = { 'Content-Type': 'application/json' } as const

/**
 * The distinct `(git_remote, memberId)` pairs held for the given machines. Aggregated in Mongo
 * rather than fetched and grouped here: an account's full session set is unbounded, and this route
 * only ever needs the pairs.
 */
export async function accountRepoEntries(machines: readonly { id: string; name: string }[]): Promise<AccountRepoEntry[]> {
  if (machines.length === 0) return []
  const names: Record<string, string> = {}
  for (const m of machines) names[m.id] = m.name
  const col = await getTeamCollection()
  const rows = await col
    .aggregate<{ _id: { memberId: string; remote?: string | null } }>([
      { $match: { memberId: { $in: machines.map(m => m.id) } } },
      { $group: { _id: { memberId: '$memberId', remote: '$git_remote' } } },
    ])
    .toArray()
  return buildAccountRepoList(rows.map(r => ({ memberId: r._id.memberId, remote: r._id.remote })), names)
}

export async function handleAccountRepos(req: Request): Promise<Response> {
  const authHeader = req.headers.get('authorization') ?? ''
  const bearer = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null
  const minted = await validateIngestToken(bearer)
  if (!minted.ok) {
    return new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401, headers: JSON_HEADERS })
  }
  try {
    const machines = await listSiblingMachines(minted.memberId)
    const repos = await accountRepoEntries(machines)
    return new Response(JSON.stringify({ ok: true, repos }), { status: 200, headers: JSON_HEADERS })
  } catch (err) {
    const safe = safeError(err, { verbose: PROFILE === 'local' })
    console.warn('[team-account-repos]', safe.logLine)
    return new Response(JSON.stringify(safe.body), { status: 500, headers: JSON_HEADERS })
  }
}
