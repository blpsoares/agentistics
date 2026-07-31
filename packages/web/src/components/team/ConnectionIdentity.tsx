import React, { useEffect, useRef, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { COPY } from './copy'

export interface ProbedIdentity {
  ok: boolean
  user?: string
  org?: string
  /** The name the CENTRAL gave this machine (the token's label) — forwarded by
   *  `handleProbeConnection` (Plan 4 Task 1, fix 6). Distinct from `user`, the account this token
   *  authenticates as, and from the connection's purely-local nickname (`conn.label`). */
  machineName?: string
  latencyMs?: number
  error?: string
}

/**
 * ConnectionIdentity — read-only rows for one connection, fed by ONE
 * `POST /api/team/connections/:id/probe`, fired on EXPAND (never on mount for all N cards — an
 * offline central would otherwise block the whole list behind N timeouts).
 *
 * Endpoint and token are deliberately not editable here: rotating either is Disconnect-and-Add,
 * or `agentop member connect` for a token rotation on the machine itself. This is what let Task 10
 * delete the old `editing`/`userTouched`/`editingInitialized` ref machinery from `TeamSettings.tsx`
 * — there is no in-place edit state to guard here at all.
 *
 * `identity.machineName` is what `ConnectionCard.tsx`'s title prefers over `identity.org` (a
 * fixed org constant, not machine-specific) — it is "the name the central gave the machine" the
 * user actually expects to see there.
 */
export function ConnectionIdentity({
  connId, endpoint, expanded, lang, onResolved,
}: {
  connId: string
  endpoint: string
  expanded: boolean
  lang: 'pt' | 'en'
  /** Lets the parent card cache the resolved org for its own header label. */
  onResolved?: (identity: ProbedIdentity) => void
}) {
  const [identity, setIdentity] = useState<ProbedIdentity | null>(null)
  const [loading, setLoading] = useState(false)
  const fetchedFor = useRef<string | null>(null)

  useEffect(() => {
    if (!expanded) return
    if (fetchedFor.current === connId) return // fetched once per expand session, not on every re-render
    fetchedFor.current = connId
    setLoading(true)
    fetch(`/api/team/connections/${encodeURIComponent(connId)}/probe`, { method: 'POST' })
      .then(r => r.json() as Promise<ProbedIdentity>)
      .then(data => {
        setIdentity(data)
        onResolved?.(data)
      })
      .catch(() => {
        setIdentity({ ok: false, error: COPY.networkError[lang] })
      })
      .finally(() => setLoading(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expanded, connId])

  function retry() {
    fetchedFor.current = null
    setLoading(true)
    fetch(`/api/team/connections/${encodeURIComponent(connId)}/probe`, { method: 'POST' })
      .then(r => r.json() as Promise<ProbedIdentity>)
      .then(data => { setIdentity(data); onResolved?.(data); fetchedFor.current = connId })
      .catch(() => { setIdentity({ ok: false, error: COPY.networkError[lang] }) })
      .finally(() => setLoading(false))
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 12 }}>
      <Row label={COPY.identityUrl[lang]} value={<span style={{ wordBreak: 'break-all' }}>{endpoint}</span>} />
      <Row label={COPY.identityToken[lang]} value="••••••••" />
      {loading && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--text-tertiary)' }}>
          <Loader2 size={12} style={{ animation: 'spin 1s linear infinite' }} />
          {COPY.checking[lang]}
        </div>
      )}
      {!loading && identity?.ok && (
        <>
          {identity.machineName && <Row label={COPY.identityMachineName[lang]} value={identity.machineName} />}
          <Row label={COPY.identityUser[lang]} value={identity.user || '—'} />
          <Row label={COPY.identityOrg[lang]} value={identity.org || '—'} />
          {identity.latencyMs != null && <Row label={COPY.identityLatency[lang]} value={`${identity.latencyMs}ms`} />}
        </>
      )}
      {!loading && identity && !identity.ok && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: '#ef4444' }}>
          <span>{identity.error ?? COPY.couldNotIdentify[lang]}</span>
          <button
            type="button"
            onClick={retry}
            style={{
              padding: '3px 9px', borderRadius: 6, border: '1px solid var(--border)',
              background: 'transparent', color: 'var(--text-secondary)', fontSize: 11.5,
              fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
            }}
          >
            {COPY.retry[lang]}
          </button>
        </div>
      )}
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  )
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, fontSize: 12 }}>
      <span style={{ color: 'var(--text-tertiary)', flexShrink: 0, minWidth: 70 }}>{label}</span>
      <span style={{ color: 'var(--text-secondary)', minWidth: 0, flex: 1 }}>{value}</span>
    </div>
  )
}
