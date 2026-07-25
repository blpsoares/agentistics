/**
 * tags-authority.ts — PURE enforcement of the two tag rules.
 *
 * Rule 1 — a principal may create or edit a tag only if it can already see EVERY one of its
 * sources. Without this a manager could compose a tag over another team's machines and grant it to
 * themselves — privilege escalation in two steps, since a grantee sees a tag's FULL numbers.
 *
 * Rule 2 — a tag response is aggregate-only. Rule 2 is about NUMBERS, but a breakdown also carries
 * KEYS (project paths, git remotes, machine ids), and those are identifying strings — a project
 * path routinely encodes a client name. So the numbers stay whole while any key the viewer cannot
 * see is collapsed into a single anonymous "other" bucket (redactBuckets / redactTopValue).
 *
 * Read access is re-derived on every request rather than trusted from the stored document
 * (canReadTag) — a creator who has since lost sight of the tag's sources must lose the tag too.
 *
 * The caller builds the visibility context from the DB; this module only decides.
 */
import type { Principal } from './iam-types'
import type { TagSource } from './tags-resolve'

export interface TagAuthorityContext {
  visibleTeamIds: Set<string>
  visibleMachineIds: Set<string>
  visibleAccountIds: Set<string>
  visibleRepos: Set<string>
  visibleProjects: Set<string>
  /** accountId → memberIds of every machine that account owns. An `account` source expands to all
   *  of them at resolution time, so seeing the account is NOT enough — see canSeeSource. */
  machinesByAccount: Record<string, string[]>
}

export function canSeeSource(p: Principal, src: TagSource, ctx: TagAuthorityContext): boolean {
  if (p.role === 'owner') return true
  switch (src.type) {
    case 'team': return ctx.visibleTeamIds.has(src.value)
    case 'machine': return ctx.visibleMachineIds.has(src.value)
    case 'account': {
      // Seeing the ACCOUNT is not enough. The source expands to every machine that account owns
      // (tags-resolve.ts), and account memberships and machine teams are independent — so a
      // manager could tag a teammate whose laptop lives in a team they cannot see, and read that
      // team's metrics. Require the whole expansion to be visible.
      if (!ctx.visibleAccountIds.has(src.value)) return false
      const machines = ctx.machinesByAccount[src.value] ?? []
      return machines.every(id => ctx.visibleMachineIds.has(id))
    }
    case 'repo': return ctx.visibleRepos.has(src.value)
    case 'project': return ctx.visibleProjects.has(src.value)
    default: return false
  }
}

export function canWriteTagSources(p: Principal, sources: TagSource[], ctx: TagAuthorityContext): boolean {
  return sources.every(src => canSeeSource(p, src, ctx))
}

/** What a read check needs from a tag — a structural subset of TagDoc, so tags-authority stays
 *  free of any Mongo type. */
export interface TagReadSubject {
  createdBy: string
  sharedWith: string[]
  sources: TagSource[]
}

/**
 * May this principal READ this tag's aggregates?
 *
 * Owners always may. For everyone else the two grounds are deliberately different in kind:
 *
 *  - `sharedWith` is an explicit, human act of sharing. It survives team changes on purpose —
 *    revoking it is also an explicit act.
 *  - Being the CREATOR is not a grant, it is a side effect of having had the authority to compose
 *    the tag. That authority is source-derived (Rule 1), so it has to be re-checked: a manager
 *    moved off a team otherwise keeps full aggregates over that team forever, through a tag they
 *    created while they still could.
 */
export function canReadTag(p: Principal, tag: TagReadSubject, ctx: TagAuthorityContext): boolean {
  if (p.role === 'owner') return true
  if (tag.sharedWith.includes(p.accountId)) return true
  if (tag.createdBy !== p.accountId) return false
  return canWriteTagSources(p, tag.sources, ctx)
}

/** The key of the bucket that absorbs everything the viewer may not see by name. Not a valid
 *  project path / remote / machine id, so it can never collide with a real key. */
export const OTHER_BUCKET_KEY = '__other__'

/** Stand-in for a source value the viewer may not see. Keeps the source COUNT and its TYPE (both
 *  harmless) while withholding the identifying string. */
export const HIDDEN_SOURCE_VALUE = '__hidden__'

/**
 * Redact a tag's own source list.
 *
 * Without this the bucket redaction is decorative: a response that collapses `/srv/acme/core` into
 * `__other__` inside `stats.projects` would hand the very same path back in `tag.sources`, because
 * the handler spreads the stored document. A grantee is promised the tag's NUMBERS, never the
 * identifying strings behind sources they cannot see.
 *
 * Replacing rather than dropping keeps the source count honest. It is also safe for the client-side
 * `tags` filter: a source the viewer cannot see is, by construction, one that matches none of the
 * sessions in their already-scoped `/api/data`, so hiding its value cannot change their filtered view.
 */
export function redactSources(p: Principal, sources: readonly TagSource[], ctx: TagAuthorityContext): TagSource[] {
  if (p.role === 'owner') return sources.map(s => ({ ...s }))
  return sources.map(s => (canSeeSource(p, s, ctx) ? { ...s } : { type: s.type, value: HIDDEN_SOURCE_VALUE }))
}

/** The shape redaction operates on — structurally the same as tags-detail's TagBucket, restated
 *  here so this module keeps depending on nothing. */
export interface TagVisibilityBucket {
  key: string
  sessions: number
  costUSD: number
  tokens: number
}

/**
 * Collapse every bucket whose key the viewer cannot see into one anonymous "other" bucket.
 *
 * Refusing the whole breakdown would be the wrong trade: a grantee is promised the tag's full
 * numbers. Merging instead preserves sessions/cost/tokens exactly — the totals still add up — while
 * disclosing no identifying string. Owners see every key.
 *
 * Ranking (cost desc, then sessions desc) is re-applied so "other" lands where its size puts it.
 */
export function redactBuckets(
  p: Principal,
  buckets: readonly TagVisibilityBucket[],
  visible: ReadonlySet<string>,
): TagVisibilityBucket[] {
  if (p.role === 'owner') return buckets.map(b => ({ ...b }))
  const kept: TagVisibilityBucket[] = []
  let other: TagVisibilityBucket | null = null
  for (const b of buckets) {
    if (visible.has(b.key)) { kept.push({ ...b }); continue }
    if (!other) other = { key: OTHER_BUCKET_KEY, sessions: 0, costUSD: 0, tokens: 0 }
    other.sessions += b.sessions
    other.costUSD += b.costUSD
    other.tokens += b.tokens
  }
  if (other) kept.push(other)
  return kept.sort((a, b) => b.costUSD - a.costUSD || b.sessions - a.sessions)
}

/** Same rule for a single headline string (`topProject`): show it only when the viewer could have
 *  seen that project anyway, otherwise null. A count is not identifying; a path is. */
export function redactTopValue(
  p: Principal,
  value: string | null | undefined,
  visible: ReadonlySet<string>,
): string | null {
  if (!value) return null
  if (p.role === 'owner') return value
  return visible.has(value) ? value : null
}
