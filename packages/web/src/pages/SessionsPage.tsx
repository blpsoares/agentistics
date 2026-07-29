import React, { useEffect, useMemo, useState } from 'react'
import { useOutletContext } from 'react-router-dom'
import { Clock, Radio, Copy, Check } from 'lucide-react'
import type { HarnessId, LiveProcess, SessionMeta } from '@agentistics/core'
import { sessionLabel } from '@agentistics/core'
import { HARNESS_COLORS, HARNESS_LABELS } from '../lib/harness'
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
  const [liveProcs, setLiveProcs] = useState<LiveProcess[]>(data.liveProcesses ?? [])
  // Polls on a central too: members report their own open assistants over the reverse channel and
  // the endpoint merges them in, so "Open now" is live for the whole team, not just this machine.
  useEffect(() => {
    let alive = true
    const poll = async () => {
      try {
        const res = await fetch('/api/live-sessions')
        if (!res.ok) return
        const json = await res.json() as { liveSessionIds?: string[]; liveProcesses?: LiveProcess[] }
        if (!alive) return
        if (Array.isArray(json.liveSessionIds)) setLiveIdList(json.liveSessionIds)
        // Always assign: an emptied list means the assistant finished starting up (or exited), and
        // keeping the previous one would leave a ghost "starting" row on screen forever.
        setLiveProcs(Array.isArray(json.liveProcesses) ? json.liveProcesses : [])
      } catch { /* transient — keep last known */ }
    }
    poll()
    const id = setInterval(poll, LIVE_POLL_MS)
    return () => { alive = false; clearInterval(id) }
  }, [isCentral])

  const liveIds = useMemo(() => new Set(liveIdList), [liveIdList])
  // Deliberately NOT the filtered set: "open now" is a fact about this machine right now, not a
  // slice of the dashboard. A long-running session that started outside the active date range (or
  // sits in a project the filter excludes) is still open, and dropping it here reported one open
  // session while three were on screen.
  const live = useMemo(
    () => data.sessions.filter(s => liveIds.has(s.session_id))
      .sort((a, b) => lastActivityMs(b) - lastActivityMs(a)),
    [data.sessions, liveIds],
  )
  const liveCount = live.length + liveProcs.length

  return (
    <>
      <PageHead pt={pt} central={isCentral} />

      {/* "Open now" is real-time process detection. On a solo machine that is this machine's own
          /proc; on a central it is the members' own reports arriving over the reverse channel,
          already scoped server-side to the members this principal may see. */}
      <Section flashId="live-sessions" title={<><Radio size={14} /> {pt ? 'Abertas agora' : 'Open now'} {liveCount > 0 && <span style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>({liveCount})</span>}</>}>
        {liveCount === 0
          ? <div style={{ fontSize: 13, color: 'var(--text-tertiary)', padding: '8px 2px' }}>{pt ? 'Nenhuma sessão aberta agora.' : 'No sessions open right now.'}</div>
          : <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {live.map(s => <LiveCard key={s.session_id} s={s} pt={pt} central={isCentral} onOpen={() => setSelectedSession(s)} />)}
              {liveProcs.map((p, i) => <StartingCard key={`${p.harness}-${p.cwd}-${i}`} p={p} pt={pt} />)}
            </div>}
      </Section>

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

function LiveCard({ s, pt, onOpen, central }: { s: SessionMeta; pt: boolean; onOpen: () => void; central?: boolean }) {
  // No resume command on a central: the session is open on somebody else's machine, so pasting
  // `claude --resume <id>` here would target a session id that does not exist locally.
  const cmd = central ? null : resumeCommand(s)
  const [copied, setCopied] = useState(false)
  const mins = Math.max(0, Math.round((Date.now() - lastActivityMs(s)) / 60_000))
  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: 10, padding: 12, background: 'var(--bg-card)' }}>
      <div onClick={onOpen} style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#22c55e', boxShadow: '0 0 6px rgba(34,197,94,0.6)', flexShrink: 0 }} />
        <span style={{ fontWeight: 600, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{sessionLabel(s)}</span>
        <HarnessBadge harness={s.harness} />
        <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--text-tertiary)', flexShrink: 0 }}>{pt ? `há ${mins} min` : `${mins} min ago`}</span>
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
        : central
          ? (s.user ? <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 6 }}>{s.user}</div> : null)
          : <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 6, fontStyle: 'italic' }}>{pt ? 'Retomar não disponível para este harness.' : 'Resume not available for this harness.'}</div>}
    </div>
  )
}

/** Which assistant a card belongs to. Without it two live sessions from different harnesses that
 *  happen to share a first prompt and a working directory are indistinguishable — they read as one
 *  duplicated row. */
function HarnessBadge({ harness }: { harness: HarnessId }) {
  const colour = HARNESS_COLORS[harness] ?? 'var(--text-tertiary)'
  return (
    <span style={{
      flexShrink: 0, fontSize: 10, fontWeight: 600, letterSpacing: 0.3, padding: '2px 6px',
      borderRadius: 999, color: colour, border: `1px solid ${colour}`, background: 'transparent',
      textTransform: 'uppercase', whiteSpace: 'nowrap',
    }}>{HARNESS_LABELS[harness] ?? harness}</span>
  )
}

/** A running assistant with nothing on disk yet. It gets a card of its own rather than being hidden:
 *  agy writes no conversation until its first turn completes, so an open one is genuinely live but
 *  has no session to link to. Deliberately shows no metrics — none exist yet. */
function StartingCard({ p, pt }: { p: LiveProcess; pt: boolean }) {
  const label = HARNESS_LABELS[p.harness] ?? p.harness
  const colour = HARNESS_COLORS[p.harness] ?? 'var(--text-tertiary)'
  return (
    <div style={{ border: '1px dashed var(--border)', borderRadius: 10, padding: 12, background: 'var(--bg-card)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ width: 8, height: 8, borderRadius: '50%', background: colour, flexShrink: 0, opacity: 0.7 }} />
        <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{label}</span>
        {/* On a central, say WHOSE machine this is — otherwise several members' starting processes
            are an indistinguishable stack of identical cards. */}
        {p.user && <span style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>· {p.user}</span>}
        <span style={{ fontSize: 11, color: 'var(--text-tertiary)', marginLeft: 'auto' }}>
          {pt ? 'sem conversa ainda' : 'no conversation yet'}
        </span>
      </div>
      <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.cwd}</div>
      <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 6, fontStyle: 'italic' }}>
        {pt
          ? 'Rodando agora. Aparece com métricas assim que o primeiro turno for gravado.'
          : 'Running now. It appears with metrics once its first turn is written.'}
      </div>
    </div>
  )
}
