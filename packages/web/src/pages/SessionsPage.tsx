import React, { useEffect, useMemo, useState } from 'react'
import { useOutletContext } from 'react-router-dom'
import { Clock, Radio, Copy, Check } from 'lucide-react'
import type { SessionMeta } from '@agentistics/core'
import { sessionLabel } from '@agentistics/core'
import type { AppContext } from '../lib/app-context'
import { Section } from '../components/Section'
import { RecentSessions } from '../components/RecentSessions'
import { lastActivityMs } from '../lib/sessionLive'
import { resumeCommand } from '../lib/resumeCommand'

const LIVE_POLL_MS = 4000

export default function SessionsPage() {
  const ctx = useOutletContext<AppContext>()
  const { data, derived, lang, setSelectedSession, isCentral } = ctx
  const pt = lang === 'pt'

  // Real-time open-session detection. The full /api/data only refetches on file events, but
  // opening/closing a `claude` tab fires none — so poll the lightweight endpoint directly.
  const [liveIdList, setLiveIdList] = useState<string[]>(data.liveSessionIds ?? [])
  useEffect(() => {
    if (isCentral) return
    let alive = true
    const poll = async () => {
      try {
        const res = await fetch('/api/live-sessions')
        if (!res.ok) return
        const json = await res.json() as { liveSessionIds?: string[] }
        if (alive && Array.isArray(json.liveSessionIds)) setLiveIdList(json.liveSessionIds)
      } catch { /* transient — keep last known */ }
    }
    poll()
    const id = setInterval(poll, LIVE_POLL_MS)
    return () => { alive = false; clearInterval(id) }
  }, [isCentral])

  const liveIds = useMemo(() => new Set(liveIdList), [liveIdList])
  const sorted = useMemo(
    () => [...derived.filteredSessions].sort((a, b) => lastActivityMs(b) - lastActivityMs(a)),
    [derived.filteredSessions],
  )
  const live = useMemo(() => sorted.filter(s => liveIds.has(s.session_id)), [sorted, liveIds])

  return (
    <>
      <PageHead pt={pt} central={isCentral} />

      {/* "Open now" is real-time process detection on the local machine, so it only applies
          to this machine's own sessions — hidden on a central (member processes aren't visible). */}
      {!isCentral && (
        <Section flashId="live-sessions" title={<><Radio size={14} /> {pt ? 'Abertas agora' : 'Open now'} {live.length > 0 && <span style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>({live.length})</span>}</>}>
          {live.length === 0
            ? <div style={{ fontSize: 13, color: 'var(--text-tertiary)', padding: '8px 2px' }}>{pt ? 'Nenhuma sessão aberta agora.' : 'No sessions open right now.'}</div>
            : <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {live.map(s => <LiveCard key={s.session_id} s={s} pt={pt} onOpen={() => setSelectedSession(s)} />)}
              </div>}
        </Section>
      )}

      <Section flashId="recent-sessions" title={<><Clock size={14} /> {pt ? 'Últimas sessões' : 'Latest sessions'}</>}>
        <RecentSessions sessions={derived.filteredSessions} lang={lang} onSelect={setSelectedSession} pinnedIds={liveIds} />
      </Section>
    </>
  )
}

function PageHead({ pt, central }: { pt: boolean; central?: boolean }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 4 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 18, fontWeight: 700, color: 'var(--text-primary)' }}>
        <span style={{ color: 'var(--anthropic-orange)' }}><Clock size={16} /></span>
        {pt ? 'Sessões' : 'Sessions'}
      </div>
      <div style={{ fontSize: 12, color: 'var(--text-tertiary)', lineHeight: 1.5 }}>
        {central
          ? (pt
              ? 'Últimas sessões do time (metadados, sem chat) — reativo aos filtros, inclusive por membro.'
              : "The team's latest sessions (metadata, no chat) — reactive to the filters, including by member.")
          : (pt
              ? 'Sessões abertas agora (em tempo real) e as últimas sessões, com comando para retomar.'
              : 'Sessions open right now (real time) and your latest sessions, with a resume command.')}
      </div>
    </div>
  )
}

function LiveCard({ s, pt, onOpen }: { s: SessionMeta; pt: boolean; onOpen: () => void }) {
  const cmd = resumeCommand(s)
  const [copied, setCopied] = useState(false)
  const mins = Math.max(0, Math.round((Date.now() - lastActivityMs(s)) / 60_000))
  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: 10, padding: 12, background: 'var(--bg-card)' }}>
      <div onClick={onOpen} style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#22c55e', boxShadow: '0 0 6px rgba(34,197,94,0.6)', flexShrink: 0 }} />
        <span style={{ fontWeight: 600, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{sessionLabel(s)}</span>
        <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--text-tertiary)' }}>{pt ? `há ${mins} min` : `${mins} min ago`}</span>
      </div>
      <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 4 }}>{s.project_path}</div>
      {cmd
        ? <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8 }}>
            <code style={{ flex: 1, fontSize: 11, background: 'var(--bg-elevated)', padding: '6px 8px', borderRadius: 6, overflowX: 'auto', whiteSpace: 'nowrap' }}>{cmd}</code>
            <button onClick={() => { navigator.clipboard.writeText(cmd); setCopied(true); setTimeout(() => setCopied(false), 1500) }}
              title={pt ? 'Copiar' : 'Copy'}
              style={{ border: '1px solid var(--border)', background: 'var(--bg-elevated)', borderRadius: 6, padding: 6, cursor: 'pointer', color: 'var(--text-secondary)' }}>
              {copied ? <Check size={13} color="#22c55e" /> : <Copy size={13} />}
            </button>
          </div>
        : <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 6, fontStyle: 'italic' }}>{pt ? 'Retomar não disponível para este harness.' : 'Resume not available for this harness.'}</div>}
    </div>
  )
}
