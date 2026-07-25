/**
 * tags-handlers.ts — /api/tags routes for B5.
 *
 * Two invariants from the spec, enforced here and nowhere else:
 *   Rule 1 — a principal may create/edit a tag only if it can see EVERY source (canWriteTagSources).
 *   Rule 2 — responses carry AGGREGATES ONLY. The session rows behind a tag are never returned,
 *            which is what lets a grantee see full numbers for sources outside their team scope
 *            without that becoming a way to read those sessions.
 *
 * Aggregation runs against the UNSCOPED session set on purpose: /api/data is team-scoped, so a
 * browser-side computation could not produce a grantee's full numbers without being sent rows it
 * must not see.
 */
import { getPrincipal } from './auth'
import { can } from './iam-caps'
import { listMachines } from './team-tokens'
import { listAccounts } from './accounts'
import { listTeams } from './teams'
import { visibleTagsFor, getTag, createTag, updateTag, deleteTag, type TagDoc } from './tags-store'
import { resolveTagSessions, type TagSource, type TagSourceType, type TagLookups } from './tags-resolve'
import { aggregateSessions, type TagAggregate } from './tags-aggregate'
import { canWriteTagSources, type TagAuthorityContext } from './tags-authority'
import { loadTeamSessionsFromMongo } from './team-source'
import type { Principal } from './iam-types'
import type { SessionMeta } from '@agentistics/core'

const JSON_CT = { 'Content-Type': 'application/json' } as const
function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_CT })
}

const SOURCE_TYPES = new Set<TagSourceType>(['repo', 'project', 'machine', 'team', 'account'])

/** Build the account→machines map the resolver needs, plus the visibility context Rule 1 uses.
 *  `sessions` is the unscoped set; repo/project visibility is derived from the subset the caller
 *  can already see, so a manager may tag their own repos and folders but not someone else's. */
async function buildContext(p: Principal, sessions: SessionMeta[]): Promise<{ lookups: TagLookups; authority: TagAuthorityContext }> {
  const [machines, accounts, teams] = await Promise.all([listMachines(), listAccounts(), listTeams()])

  const machinesByAccount: Record<string, string[]> = {}
  for (const m of machines) {
    for (const accId of m.accountIds) {
      (machinesByAccount[accId] ??= []).push(m.id)
    }
  }

  const myTeamIds = new Set(p.memberships.map(m => m.teamId))
  const visibleMachineIds = new Set(
    machines
      .filter(m => m.teamIds.some(t => myTeamIds.has(t)) || m.accountIds.includes(p.accountId))
      .map(m => m.id),
  )
  const visibleAccountIds = new Set(
    accounts.filter(a => a.memberships.some(m => myTeamIds.has(m.teamId)) || a._id === p.accountId).map(a => a._id),
  )

  // Repos and projects have no ownership record of their own — a caller "can see" one when it
  // appears in a session they can already see. An owner short-circuits in canSeeSource, so these
  // sets only ever gate non-owners.
  const visibleRepos = new Set<string>()
  const visibleProjects = new Set<string>()
  for (const s of sessions) {
    const sessionTeams = s.teamIds ?? (s.teamId ? [s.teamId] : [])
    const inScope = (!!s.memberId && visibleMachineIds.has(s.memberId))
      || sessionTeams.some(t => myTeamIds.has(t))
    if (!inScope) continue
    if (s.git_remote) visibleRepos.add(s.git_remote)
    if (s.project_path) visibleProjects.add(s.project_path)
  }

  return {
    lookups: { machinesByAccount },
    authority: {
      visibleTeamIds: new Set(teams.filter(t => myTeamIds.has(t._id)).map(t => t._id)),
      visibleMachineIds,
      visibleAccountIds,
      visibleRepos,
      visibleProjects,
      machinesByAccount,
    },
  }
}

/** All central sessions, unscoped. Aggregates are computed here and only numbers leave. */
async function loadAllSessions(): Promise<SessionMeta[]> {
  return loadTeamSessionsFromMongo()
}

function withAggregate(tag: TagDoc, sessions: SessionMeta[], lookups: TagLookups): TagDoc & { aggregate: TagAggregate } {
  return { ...tag, aggregate: aggregateSessions(resolveTagSessions(sessions, tag.sources, lookups)) }
}

function parseSources(raw: unknown): TagSource[] {
  if (!Array.isArray(raw)) return []
  return raw
    .filter((x): x is { type: string; value: string } =>
      !!x && typeof x === 'object' && typeof (x as { type?: unknown }).type === 'string'
      && typeof (x as { value?: unknown }).value === 'string')
    .filter(x => SOURCE_TYPES.has(x.type as TagSourceType) && x.value.length > 0)
    .map(x => ({ type: x.type as TagSourceType, value: x.value }))
}

function parseStringList(raw: unknown): string[] {
  return Array.isArray(raw) ? raw.filter((x): x is string => typeof x === 'string') : []
}

export async function handleTags(req: Request): Promise<Response> {
  const principal = await getPrincipal(req)
  if (!principal) return json({ error: 'unauthorized' }, 401)
  const isOwner = principal.role === 'owner'

  const url = new URL(req.url)
  const idFromPath = url.pathname.startsWith('/api/tags/')
    ? decodeURIComponent(url.pathname.slice('/api/tags/'.length))
    : ''

  // GET /api/tags/:id — one tag with its aggregate AND a per-source breakdown. Still
  // aggregate-only (Rule 2): each source reports its own totals, never its sessions.
  if (req.method === 'GET' && idFromPath) {
    const tag = await getTag(idFromPath)
    // 404 rather than 403 for a non-viewer: a stranger must not learn the tag exists.
    if (!tag) return json({ error: 'tag not found' }, 404)
    const mayRead = isOwner || tag.createdBy === principal.accountId || tag.sharedWith.includes(principal.accountId)
    if (!mayRead) return json({ error: 'tag not found' }, 404)
    const sessions = await loadAllSessions()
    const { lookups } = await buildContext(principal, sessions)
    const breakdown = tag.sources.map(src => ({
      source: src,
      aggregate: aggregateSessions(resolveTagSessions(sessions, [src], lookups)),
    }))
    return json({ tag: withAggregate(tag, sessions, lookups), breakdown })
  }

  if (req.method === 'GET') {
    const tags = await visibleTagsFor(principal.accountId, isOwner)
    const sessions = await loadAllSessions()
    const { lookups } = await buildContext(principal, sessions)
    return json({ tags: tags.map(t => withAggregate(t, sessions, lookups)) })
  }

  const body = await req.json().catch(() => null) as Record<string, unknown> | null
  if (!body) return json({ error: 'invalid body' }, 400)

  if (req.method === 'POST') {
    if (!can(principal, 'tags:write')) return json({ error: 'forbidden' }, 403)
    const name = typeof body.name === 'string' ? body.name.trim() : ''
    if (!name) return json({ error: 'name is required' }, 400)
    const sources = parseSources(body.sources)
    const sessions = await loadAllSessions()
    const { authority, lookups } = await buildContext(principal, sessions)
    if (!canWriteTagSources(principal, sources, authority)) return json({ error: 'forbidden' }, 403)
    const doc = await createTag({
      name,
      color: typeof body.color === 'string' ? body.color : undefined,
      sources,
      sharedWith: parseStringList(body.sharedWith),
      createdBy: principal.accountId,
    })
    return json({ tag: withAggregate(doc, sessions, lookups) })
  }

  if (req.method === 'PATCH') {
    const id = typeof body.id === 'string' ? body.id : ''
    if (!id) return json({ error: 'id is required' }, 400)
    const existing = await getTag(id)
    if (!existing) return json({ error: 'tag not found' }, 404)
    if (!isOwner && existing.createdBy !== principal.accountId) return json({ error: 'forbidden' }, 403)
    const { authority } = await buildContext(principal, await loadAllSessions())
    // Re-validate on edit: the source list may be changing to something out of scope.
    const nextSources = body.sources !== undefined ? parseSources(body.sources) : existing.sources
    if (!canWriteTagSources(principal, nextSources, authority)) return json({ error: 'forbidden' }, 403)
    await updateTag(id, {
      name: typeof body.name === 'string' ? body.name.trim() : undefined,
      color: typeof body.color === 'string' ? body.color : undefined,
      sources: body.sources !== undefined ? nextSources : undefined,
      sharedWith: body.sharedWith !== undefined ? parseStringList(body.sharedWith) : undefined,
    })
    return json({ ok: true })
  }

  if (req.method === 'DELETE') {
    const id = typeof body.id === 'string' ? body.id : ''
    if (!id) return json({ error: 'id is required' }, 400)
    const existing = await getTag(id)
    if (!existing) return json({ error: 'tag not found' }, 404)
    if (!isOwner && existing.createdBy !== principal.accountId) return json({ error: 'forbidden' }, 403)
    await deleteTag(id)
    return json({ ok: true })
  }

  return json({ error: 'method not allowed' }, 405)
}
