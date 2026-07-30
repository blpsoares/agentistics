import React, { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { computeMemberPillState, type PillConnection } from './memberPillState'

interface Status {
  mode: string
  connections?: PillConnection[]
}

/**
 * Member-side connection pill: aggregates every connected central (worst-status-wins — see
 * `memberPillState.ts`, the pure reducer this component defers to) and shows whether this machine
 * is currently syncing. Polls /api/team/status every 5s. Renders nothing unless this instance is
 * configured as a team member, or it has no connections (yet).
 *
 * With exactly one central this renders the same text it always has — the aggregate collapses to
 * the single-connection case by construction (see `memberPillState.test.ts`).
 */
export function MemberConnectionStatus({ lang, compact }: { lang: 'pt' | 'en'; compact?: boolean }) {
  const [st, setSt] = useState<Status | null>(null)
  const navigate = useNavigate()
  // Re-render on a ticker so the relative "last sync" time stays fresh between polls.
  const [, setTick] = useState(0)

  useEffect(() => {
    let alive = true
    const load = async () => {
      try {
        const r = await fetch('/api/team/status')
        if (!r.ok) return
        const data = (await r.json()) as Status
        if (alive) setSt(data)
      } catch { /* offline UI itself; ignore */ }
    }
    void load()
    const poll = setInterval(load, 5_000)
    const tick = setInterval(() => setTick(t => t + 1), 1_000)
    return () => { alive = false; clearInterval(poll); clearInterval(tick) }
  }, [])

  if (!st || st.mode !== 'member') return null

  const pill = computeMemberPillState(st.connections ?? [], lang)
  if (!pill) return null
  const { dot, label, sub } = pill
  const color = dot

  const goToConnections = () => navigate('/settings/connection')

  const glow = dot === '#22c55e' // steady green — the only state worth a glow, same as before
  const commonProps = {
    role: 'button' as const,
    tabIndex: 0,
    onClick: goToConnections,
    onKeyDown: (e: React.KeyboardEvent) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); goToConnections() } },
  }

  if (compact) {
    // Slim variant for the sidebar aside: dot + label + sub on one tight line.
    return (
      <div
        {...commonProps}
        style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 4, fontSize: 10.5, lineHeight: 1.4, minWidth: 0, cursor: 'pointer' }}
      >
        <span style={{
          width: 7, height: 7, borderRadius: '50%', flexShrink: 0, background: dot,
          boxShadow: glow ? `0 0 5px ${dot}` : 'none',
        }} />
        <span style={{ fontWeight: 600, color, whiteSpace: 'nowrap' }}>{label}</span>
        {sub && <span style={{ color: 'var(--text-tertiary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>· {sub}</span>}
      </div>
    )
  }

  return (
    <div
      {...commonProps}
      style={{
        display: 'flex', alignItems: 'center', gap: 9,
        padding: '9px 12px', borderRadius: 8, marginBottom: 14, cursor: 'pointer',
        border: '1px solid var(--border)', background: 'var(--bg-secondary)',
      }}
    >
      <span style={{
        width: 9, height: 9, borderRadius: '50%', flexShrink: 0, background: dot,
        boxShadow: glow ? `0 0 6px ${dot}` : 'none',
      }} />
      <div style={{ minWidth: 0 }}>
        <span style={{ fontSize: 12.5, fontWeight: 600, color }}>{label}</span>
        {sub && <span style={{ fontSize: 12, color: 'var(--text-tertiary)' }}> · {sub}</span>}
      </div>
    </div>
  )
}
