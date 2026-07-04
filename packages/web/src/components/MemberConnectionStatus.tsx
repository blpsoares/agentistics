import React, { useEffect, useState } from 'react'

interface Status {
  mode: string
  lastSuccessAt: number | null
  errKind: 'auth' | 'net' | null
}

function relTime(ts: number, pt: boolean): string {
  const s = Math.floor((Date.now() - ts) / 1000)
  if (s < 5) return pt ? 'agora' : 'now'
  if (s < 60) return pt ? `há ${s}s` : `${s}s ago`
  const m = Math.floor(s / 60)
  if (m < 60) return pt ? `há ${m}min` : `${m}min ago`
  const h = Math.floor(m / 60)
  if (h < 24) return pt ? `há ${h}h` : `${h}h ago`
  return pt ? `há ${Math.floor(h / 24)}d` : `${Math.floor(h / 24)}d ago`
}

/**
 * Member-side connection pill: shows whether this machine is currently syncing to the
 * central and when it last succeeded. Polls /api/team/status every 5s. Renders nothing
 * unless this instance is configured as a team member.
 */
export function MemberConnectionStatus({ lang }: { lang: 'pt' | 'en' }) {
  const pt = lang === 'pt'
  const [st, setSt] = useState<Status | null>(null)
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

  let color: string, dot: string, label: string, sub: string
  if (st.errKind === 'auth') {
    color = '#ef4444'; dot = '#ef4444'
    label = pt ? 'Não autorizado' : 'Unauthorized'
    sub = pt ? 'a central rejeitou o token desta máquina' : 'the central rejected this machine’s token'
  } else if (st.errKind === 'net') {
    color = '#f59e0b'; dot = '#f59e0b'
    label = pt ? 'Reconectando…' : 'Reconnecting…'
    sub = st.lastSuccessAt
      ? (pt ? `sem contato — último envio ${relTime(st.lastSuccessAt, true)}` : `no contact — last sync ${relTime(st.lastSuccessAt, false)}`)
      : (pt ? 'ainda não conectou à central' : 'not connected to the central yet')
  } else if (st.lastSuccessAt) {
    color = '#22c55e'; dot = '#22c55e'
    label = pt ? 'Conectado' : 'Connected'
    sub = pt ? `último envio ${relTime(st.lastSuccessAt, true)}` : `last sync ${relTime(st.lastSuccessAt, false)}`
  } else {
    color = 'var(--text-tertiary)'; dot = 'var(--text-tertiary)'
    label = pt ? 'Conectando…' : 'Connecting…'
    sub = pt ? 'primeiro envio em instantes' : 'first sync shortly'
  }

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 9,
      padding: '9px 12px', borderRadius: 8, marginBottom: 14,
      border: '1px solid var(--border)', background: 'var(--bg-secondary)',
    }}>
      <span style={{
        width: 9, height: 9, borderRadius: '50%', flexShrink: 0, background: dot,
        boxShadow: st.errKind === null && st.lastSuccessAt ? `0 0 6px ${dot}` : 'none',
      }} />
      <div style={{ minWidth: 0 }}>
        <span style={{ fontSize: 12.5, fontWeight: 600, color }}>{label}</span>
        <span style={{ fontSize: 12, color: 'var(--text-tertiary)' }}> · {sub}</span>
      </div>
    </div>
  )
}
