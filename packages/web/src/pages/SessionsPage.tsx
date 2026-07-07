import React, { useMemo, useState } from 'react'
import { useOutletContext } from 'react-router-dom'
import { Clock, Radio, Copy, Check } from 'lucide-react'
import type { SessionMeta } from '@agentistics/core'
import { sessionLabel } from '@agentistics/core'
import type { AppContext } from '../lib/app-context'
import { Section } from '../components/Section'
import { RecentSessions } from '../components/RecentSessions'
import { isLive, lastActivityMs, LIVE_THRESHOLD_MIN } from '../lib/sessionLive'
import { resumeCommand } from '../lib/resumeCommand'

const COUNT_OPTIONS = [5, 10, 20, 50] as const
const COUNT_KEY = 'agentistics-sessions-recent-count'

export default function SessionsPage() {
  const ctx = useOutletContext<AppContext>()
  const { derived, lang, setSelectedSession, isCentral } = ctx
  const pt = lang === 'pt'

  const [count, setCount] = useState<number>(() => {
    const raw = Number(localStorage.getItem(COUNT_KEY))
    return COUNT_OPTIONS.includes(raw as 5) ? raw : 5
  })
  function pickCount(n: number) { setCount(n); localStorage.setItem(COUNT_KEY, String(n)) }

  const nowMs = Date.now()
  const sorted = useMemo(
    () => [...derived.filteredSessions].sort((a, b) => lastActivityMs(b) - lastActivityMs(a)),
    [derived.filteredSessions],
  )
  const live = useMemo(() => sorted.filter(s => isLive(s, nowMs, LIVE_THRESHOLD_MIN)), [sorted, nowMs])
  // Recent excludes the ones already shown as live (no duplication).
  const liveIds = new Set(live.map(s => s.session_id))
  const recent = useMemo(
    () => sorted.filter(s => !liveIds.has(s.session_id)).slice(0, count),
    [sorted, count],
  )

  if (isCentral) {
    return (
      <>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 4 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 18, fontWeight: 700, color: 'var(--text-primary)' }}>
            <span style={{ color: 'var(--anthropic-orange)' }}><Clock size={16} /></span>
            {pt ? 'Sessões' : 'Sessions'}
          </div>
        </div>
        <Section flashId="sessions-central-empty" title={<><Clock size={14} /> {pt ? 'Sessões' : 'Sessions'}</>}>
          <div style={{ fontSize: 13, color: 'var(--text-tertiary)', padding: '8px 2px' }}>
            {pt
              ? 'A aba Sessões é local a cada máquina e não é exibida em um central.'
              : 'The Sessions tab is local to each machine and is not shown on a central.'}
          </div>
        </Section>
      </>
    )
  }

  return (
    <>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 4 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 18, fontWeight: 700, color: 'var(--text-primary)' }}>
          <span style={{ color: 'var(--anthropic-orange)' }}><Clock size={16} /></span>
          {pt ? 'Sessões' : 'Sessions'}
        </div>
        <div style={{ fontSize: 12, color: 'var(--text-tertiary)', lineHeight: 1.5 }}>
          {pt
            ? `Sessões ao vivo (ativas nos últimos ${LIVE_THRESHOLD_MIN} min) e as mais recentes, com comando para retomar.`
            : `Live sessions (active in the last ${LIVE_THRESHOLD_MIN} min) and your most recent ones, with a resume command.`}
        </div>
      </div>

      <Section flashId="live-sessions" title={<><Radio size={14} /> {pt ? 'Ao vivo' : 'Live'} {live.length > 0 && <span style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>({live.length})</span>}</>}>
        {live.length === 0
          ? <div style={{ fontSize: 13, color: 'var(--text-tertiary)', padding: '8px 2px' }}>{pt ? 'Nenhuma sessão ativa agora.' : 'No active sessions right now.'}</div>
          : <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {live.map(s => <LiveCard key={s.session_id} s={s} pt={pt} onOpen={() => setSelectedSession(s)} />)}
            </div>}
      </Section>

      <Section
        flashId="recent-sessions"
        title={<><Clock size={14} /> {pt ? 'Recentes' : 'Recent'}</>}
        action={
          <div style={{ display: 'flex', gap: 4 }}>
            {COUNT_OPTIONS.map(n => (
              <button key={n} onClick={() => pickCount(n)} style={{
                padding: '3px 8px', borderRadius: 6, fontSize: 11, cursor: 'pointer', fontFamily: 'inherit',
                border: '1px solid var(--border)',
                background: count === n ? 'var(--anthropic-orange-dim, rgba(205,93,56,0.12))' : 'var(--bg-elevated)',
                color: count === n ? 'var(--anthropic-orange, #cd5d38)' : 'var(--text-secondary)',
              }}>{n}</button>
            ))}
          </div>
        }
      >
        <RecentSessions sessions={recent} lang={lang} onSelect={setSelectedSession} />
      </Section>
    </>
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
