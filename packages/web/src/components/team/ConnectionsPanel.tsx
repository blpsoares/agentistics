import React, { useEffect, useMemo, useState } from 'react'
import { Plus } from 'lucide-react'
import type { SessionMeta, TeamConnection, TeamConfig, ModelUsage } from '@agentistics/core'
import { readTeamConnections } from '@agentistics/core'
import type { ArchiveMode } from '../ArchiveConsentModal'
import { resolveArchiveChoice } from '../../lib/archive'
import { buildShareTargets, hostOf, type ServerProject } from '../../lib/shareRepos'
import { useIsMobile } from '../../hooks/useIsMobile'
import { COPY } from './copy'
import { ConnectionCard } from './ConnectionCard'
import type { TeamStatusResponse, ConnectionStatusEntry } from './statusTypes'

/** The two panel-level rows of the state table (§9.5) that are NOT per-card: an `/api/preferences`
 *  load failure shows the error panel and never renders the list at all (even if a previous poll
 *  had populated it), and a genuinely empty `connections[]` — as opposed to `null`, still loading —
 *  is the dashed empty state. Pure and exported so both are asserted directly, the same way
 *  `ConnectionCard.test.tsx` asserts the per-card rows. */
export type PanelBranch = 'error' | 'loading' | 'empty' | 'list'

export function resolvePanelBranch(loadErr: string | null, connections: TeamConnection[] | null): PanelBranch {
  if (loadErr) return 'error'
  if (connections === null) return 'loading'
  if (connections.length === 0) return 'empty'
  return 'list'
}

export interface ConnectionsPanelProps {
  sessions: SessionMeta[]
  /** MUST be the unfiltered project list — see `buildShareTargets`'s own docstring: a filtered
   *  derivative would silently shrink what this machine can even offer to block. */
  projects: ServerProject[]
  /** For the repository picker's impact estimate (`blendedCostPerToken`) — the app's global model
   *  usage, same source every other blended-cost consumer in the app uses. */
  modelUsage: Record<string, ModelUsage>
  lang: 'pt' | 'en'
}

/**
 * ConnectionsPanel — the member-mode replacement for the old `TeamSettings.tsx`'s single-form
 * connect UI: a card per connected central. Owns the one `/api/preferences` load, the one
 * `/api/team/status` poller shared by every card (never one poller per card), and the
 * `shareTargets` memo Task 11's picker will consume.
 */
export function ConnectionsPanel({ sessions, projects, modelUsage, lang }: ConnectionsPanelProps) {
  const isMobile = useIsMobile()
  const [connections, setConnections] = useState<TeamConnection[] | null>(null)
  const [archiveMode, setArchiveMode] = useState<ArchiveMode | null>(null)
  const [loadErr, setLoadErr] = useState<string | null>(null)
  const [statusResp, setStatusResp] = useState<TeamStatusResponse | null>(null)

  useEffect(() => {
    let alive = true
    fetch('/api/preferences')
      .then(r => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((prefs: { team?: TeamConfig; archiveMode?: ArchiveMode; archiveSessions?: boolean }) => {
        if (!alive) return
        // Defensive migration: `readTeamConnections` tolerates a missing/malformed `connections`
        // array instead of `.map`-ing `undefined` — an old server payload must never read as
        // "zero connections" through a crash.
        setConnections(readTeamConnections(prefs))
        setArchiveMode(resolveArchiveChoice(prefs))
      })
      .catch(err => { if (alive) setLoadErr(err instanceof Error ? err.message : String(err)) })
    return () => { alive = false }
  }, [])

  // ONE poller for the whole panel — N cards must never mean N intervals hitting the route.
  useEffect(() => {
    let alive = true
    const load = async () => {
      try {
        const r = await fetch('/api/team/status')
        if (!r.ok) return
        const data = (await r.json()) as TeamStatusResponse
        if (alive) setStatusResp(data)
      } catch { /* keep the last-known status; a card shows "checking" before the first response */ }
    }
    void load()
    const id = setInterval(load, 5_000)
    return () => { alive = false; clearInterval(id) }
  }, [])

  const statusById = useMemo(() => {
    const map: Record<string, ConnectionStatusEntry> = {}
    for (const e of statusResp?.connections ?? []) map[e.id] = e
    return map
  }, [statusResp])

  // Computed ONCE here from the UNFILTERED session/project lists — Task 11's picker consumes this
  // same array per card instead of rebuilding it per connection.
  const shareTargets = useMemo(
    () => buildShareTargets(sessions, projects, [], { noRepo: COPY.noRepoTitle[lang] }),
    [sessions, projects, lang],
  )

  // Two connections resolving to the same host promote the user name into the card's primary
  // label — see ConnectionCard's docstring.
  const duplicateHosts = useMemo(() => {
    const counts = new Map<string, number>()
    for (const c of connections ?? []) {
      const h = hostOf(c.endpoint)
      counts.set(h, (counts.get(h) ?? 0) + 1)
    }
    return counts
  }, [connections])

  async function handleRename(id: string, label: string) {
    await fetch(`/api/team/connections/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ label }),
    }).catch(() => { /* local-only rename; a failed PATCH just leaves the stored label as-is */ })
    setConnections(prev => (prev ?? []).map(c => (c.id === id ? { ...c, label: label || undefined } : c)))
  }

  async function handleDisconnect(id: string) {
    const res = await fetch(`/api/team/connections/${encodeURIComponent(id)}`, { method: 'DELETE' })
    if (res.ok) setConnections(prev => (prev ?? []).filter(c => c.id !== id))
  }

  /**
   * The ONE write the repository picker performs: `PATCH { deniedRepos }`, then stop — the server
   * owns the forget/push sequence from here, watched via the panel's existing `/api/team/status`
   * poll (`status.resync`). Never looped, never followed by a direct call to any forget endpoint.
   */
  async function handleApplyRules(id: string, deniedRepos: string[]): Promise<{ ok: true; queued: boolean } | { ok: false }> {
    const res = await fetch(`/api/team/connections/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deniedRepos }),
    }).catch(() => null)
    if (!res || !res.ok) return { ok: false }
    const body = await res.json().catch(() => ({ queued: false })) as { queued?: boolean }
    setConnections(prev => (prev ?? []).map(c => (c.id === id ? { ...c, deniedRepos } : c)))
    return { ok: true, queued: Boolean(body.queued) }
  }

  async function handleSyncNow(id: string) {
    await fetch('/api/team/push-now', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ connectionId: id }),
    }).catch(() => { /* the card's own status line reflects the outcome on the next poll */ })
  }

  const branch = resolvePanelBranch(loadErr, connections)

  if (branch === 'error') {
    return (
      <div style={{
        padding: '10px 14px', borderRadius: 8,
        background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)',
        fontSize: 12, color: '#ef4444',
      }}>
        {loadErr}
      </div>
    )
  }

  // `branch === 'loading'` iff `connections === null` (see `resolvePanelBranch`) — the explicit
  // `connections === null` check (redundant with `branch` at runtime) is what lets TypeScript
  // narrow `connections` to non-null for the rest of the render.
  if (branch === 'loading' || connections === null) {
    return <div style={{ minHeight: 80 }} />
  }

  return (
    <div style={{ maxWidth: 760 }}>
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10,
        marginBottom: 14, flexWrap: 'wrap',
      }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-secondary)' }}>
          {COPY.connectedCentrals[lang]} {connections.length > 0 && `(${connections.length})`}
        </div>
        {/* Inert until Task 12 lands the add wizard — intentionally has no onClick yet. */}
        <button
          type="button"
          disabled
          title={COPY.addCentral[lang]}
          style={{
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6,
            padding: isMobile ? '0 14px' : '7px 14px', minHeight: isMobile ? 44 : undefined,
            width: isMobile ? '100%' : undefined,
            borderRadius: 7, fontSize: 12.5, fontWeight: 700, fontFamily: 'inherit',
            border: '1px dashed var(--border)', background: 'transparent', color: 'var(--text-tertiary)',
            cursor: 'not-allowed', opacity: 0.6,
          }}
        >
          <Plus size={13} />
          {COPY.addCentral[lang]}
        </button>
      </div>

      {connections.length === 0 ? (
        <div style={{
          padding: '18px 16px', borderRadius: 10, border: '1px dashed var(--border)',
          textAlign: 'center', display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'center',
        }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-secondary)' }}>{COPY.emptyTitle[lang]}</div>
          <div style={{ fontSize: 12, color: 'var(--text-tertiary)', maxWidth: 420 }}>{COPY.emptyBody[lang]}</div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {connections.map(conn => (
            // One broken card cannot take the page down — see the class docstring on
            // `isBrokenEndpoint`/`hostOf`. Each card is its own render boundary in the same sense
            // (a thrown error inside one card would still need an ErrorBoundary to be fully
            // isolated; the per-card guards below are what keep a bad row from ever reaching render
            // in a state that could throw).
            <ConnectionCard
              key={conn.id}
              conn={conn}
              status={statusById[conn.id]}
              archiveMode={archiveMode}
              shareTargets={shareTargets}
              sessions={sessions}
              modelUsage={modelUsage}
              duplicateHost={(duplicateHosts.get(hostOf(conn.endpoint)) ?? 0) > 1}
              lang={lang}
              onRename={(id, label) => { void handleRename(id, label) }}
              onDisconnect={handleDisconnect}
              onSyncNow={handleSyncNow}
              onApplyRules={handleApplyRules}
            />
          ))}
        </div>
      )}
    </div>
  )
}
