import React, { useEffect, useMemo, useRef, useState } from 'react'
import { useOutletContext, useNavigate } from 'react-router-dom'
import { Clock, Radio, Copy, Check, Bell, BellOff, Settings, Sparkles, Folder, User, Terminal } from 'lucide-react'
import type { HarnessId, LiveProcess, LiveUnavailableReason, SessionMeta } from '@agentistics/core'
import { sessionLabel } from '@agentistics/core'
import { HARNESS_COLORS, HARNESS_LABELS } from '../lib/harness'
import type { AppContext } from '../lib/app-context'
import { Section } from '../components/Section'
import { RecentSessions } from '../components/RecentSessions'
import { lastActivityMs, liveEmptyNotice } from '../lib/sessionLive'
import { resumeCommand } from '../lib/resumeCommand'
import {
  getNotificationSettings,
  saveNotificationSettings,
  requestNotificationPermission,
  getBrowserNotificationPermission,
  handleSessionStateTransitions,
  triggerSessionNotification,
  type SessionActivity,
  type NotificationSettings,
} from '../lib/sessionNotifications'

const LIVE_POLL_MS = 4000

export default function SessionsPage() {
  const ctx = useOutletContext<AppContext>()
  const { data, derived, lang, setSelectedSession, isCentral } = ctx
  const pt = lang === 'pt'
  const navigate = useNavigate()

  // Real-time open-session detection.
  const [liveIdList, setLiveIdList] = useState<string[]>(data.liveSessionIds ?? [])
  const [liveProcs, setLiveProcs] = useState<LiveProcess[]>(data.liveProcesses ?? [])
  const [liveUnavailable, setLiveUnavailable] =
    useState<LiveUnavailableReason | undefined>(data.liveUnavailable)
  const [liveActivities, setLiveActivities] = useState<Record<string, SessionActivity>>({})

  // Notification settings state & prompt banner
  const [notifSettings, setNotifSettings] = useState<NotificationSettings>(getNotificationSettings)
  const prevActivitiesRef = useRef<Record<string, SessionActivity>>({})

  // Sessions map lookup helper
  const sessionsMap = useMemo(() => {
    const map = new Map<string, SessionMeta>()
    for (const s of data.sessions) {
      map.set(s.session_id, s)
    }
    return map
  }, [data.sessions])

  // Poll live sessions
  useEffect(() => {
    let alive = true
    const poll = async () => {
      try {
        const res = await fetch('/api/live-sessions')
        if (!res.ok) return
        const json = await res.json() as {
          liveSessionIds?: string[]
          liveProcesses?: LiveProcess[]
          liveUnavailable?: LiveUnavailableReason
          liveSessionActivities?: Record<string, SessionActivity>
        }
        if (!alive) return
        if (Array.isArray(json.liveSessionIds)) setLiveIdList(json.liveSessionIds)
        setLiveProcs(Array.isArray(json.liveProcesses) ? json.liveProcesses : [])
        setLiveUnavailable(json.liveUnavailable)

        const activities = json.liveSessionActivities || {}
        setLiveActivities(activities)

        // Check state transitions for notifications
        handleSessionStateTransitions(prevActivitiesRef.current, activities, sessionsMap, pt ? 'pt' : 'en')
        prevActivitiesRef.current = activities
      } catch { /* transient — keep last known */ }
    }
    poll()
    const id = setInterval(poll, LIVE_POLL_MS)
    return () => { alive = false; clearInterval(id) }
  }, [isCentral, sessionsMap, pt])

  const liveIds = useMemo(() => new Set(liveIdList), [liveIdList])
  const live = useMemo(
    () => data.sessions.filter(s => liveIds.has(s.session_id))
      .sort((a, b) => lastActivityMs(b) - lastActivityMs(a)),
    [data.sessions, liveIds],
  )
  const liveCount = live.length + liveProcs.length
  const notice = liveEmptyNotice({ count: liveCount, central: isCentral, unavailable: liveUnavailable, lang: pt ? 'pt' : 'en' })

  // Handle enabling notifications from prompt banner
  async function handleEnableNotifications() {
    const perm = await requestNotificationPermission()
    const next = { ...notifSettings, enabled: true, askedPrompt: true }
    setNotifSettings(next)
    saveNotificationSettings(next)

    if (perm === 'granted') {
      triggerSessionNotification({
        title: pt ? 'Notificações Ativadas' : 'Notifications Enabled',
        body: pt
          ? 'Você receberá alertas em tempo real sobre o andamento das suas live sessions.'
          : 'You will receive real-time alerts on your live sessions progress.',
      })
    }
  }

  function handleDismissPrompt() {
    const next = { ...notifSettings, askedPrompt: true }
    setNotifSettings(next)
    saveNotificationSettings(next)
  }

  const showPromptBanner = !notifSettings.askedPrompt && getBrowserNotificationPermission() !== 'granted'

  return (
    <>
      <PageHead pt={pt} central={isCentral} />

      {/* Notification Permission Prompt Banner */}
      {showPromptBanner && (
        <div
          style={{
            background: 'var(--bg-elevated)',
            border: '1px solid var(--anthropic-orange-dim, rgba(232,105,11,0.3))',
            borderRadius: 12,
            padding: '16px 20px',
            marginBottom: 16,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 16,
            flexWrap: 'wrap',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flex: 1, minWidth: 280 }}>
            <div
              style={{
                width: 38,
                height: 38,
                borderRadius: 10,
                background: 'rgba(232,105,11,0.12)',
                color: 'var(--anthropic-orange)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
              }}
            >
              <Bell size={20} />
            </div>
            <div>
              <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 2 }}>
                {pt
                  ? 'Deseja receber notificações sobre os andamentos de suas live sessions?'
                  : 'Would you like to receive notifications for your live sessions?'}
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>
                {pt
                  ? 'Receba alertas visuais e sonoros detalhados quando uma sessão precisar de aprovação, aguardar resposta ou encerrar.'
                  : 'Receive detailed visual and sound alerts when a session needs approval, waits for response, or exits.'}
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
            <button
              onClick={handleEnableNotifications}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                padding: '8px 16px',
                borderRadius: 8,
                background: 'var(--anthropic-orange)',
                color: '#fff',
                border: 'none',
                fontSize: 12,
                fontWeight: 600,
                cursor: 'pointer',
                fontFamily: 'inherit',
              }}
            >
              <Sparkles size={14} />
              <span>{pt ? 'Sim, ativar notificações' : 'Yes, enable notifications'}</span>
            </button>
            <button
              onClick={() => navigate('/settings/notifications')}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 4,
                padding: '8px 12px',
                borderRadius: 8,
                border: '1px solid var(--border-subtle)',
                background: 'transparent',
                color: 'var(--text-secondary)',
                fontSize: 12,
                fontWeight: 500,
                cursor: 'pointer',
                fontFamily: 'inherit',
              }}
            >
              <Settings size={13} />
              <span>{pt ? 'Configurar' : 'Configure'}</span>
            </button>
            <button
              onClick={handleDismissPrompt}
              style={{
                padding: '8px 12px',
                borderRadius: 8,
                border: '1px solid var(--border-subtle)',
                background: 'transparent',
                color: 'var(--text-tertiary)',
                fontSize: 12,
                cursor: 'pointer',
                fontFamily: 'inherit',
              }}
            >
              {pt ? 'Agora não' : 'Not now'}
            </button>
          </div>
        </div>
      )}

      {/* "Open now" real-time process detection */}
      <Section
        flashId="live-sessions"
        title={
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <Radio size={14} />
              <span>{pt ? 'Abertas agora' : 'Open now'}</span>
              {liveCount > 0 && (
                <span style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>({liveCount})</span>
              )}
            </div>

            <button
              onClick={() => navigate('/settings/notifications')}
              title={pt ? 'Configurar Notificações' : 'Configure Notifications'}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 4,
                fontSize: 11,
                padding: '3px 8px',
                borderRadius: 6,
                border: '1px solid var(--border-subtle)',
                background: 'transparent',
                color: 'var(--text-tertiary)',
                cursor: 'pointer',
                fontFamily: 'inherit',
              }}
            >
              {notifSettings.enabled ? <Bell size={12} style={{ color: 'var(--anthropic-orange)' }} /> : <BellOff size={12} />}
              <span>{pt ? 'Notificações' : 'Notifications'}</span>
            </button>
          </div>
        }
      >
        {notice
          ? <div style={{ fontSize: 13, color: 'var(--text-tertiary)', padding: '8px 2px', display: 'flex', flexDirection: 'column', gap: 5 }}>
              <span>{notice.title}</span>
              {notice.detail && <span style={{ fontSize: 12, lineHeight: 1.5, maxWidth: '68ch' }}>{notice.detail}</span>}
            </div>
          : <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {live.map(s => (
                <LiveCard
                  key={s.session_id}
                  s={s}
                  pt={pt}
                  central={isCentral}
                  activity={liveActivities[s.session_id]}
                  onOpen={() => setSelectedSession(s)}
                />
              ))}
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

function StatusBadge({ activity, pt }: { activity?: SessionActivity; pt: boolean }) {
  const act = activity || 'working'
  const config = {
    'working': {
      labelPt: 'trabalhando',
      labelEn: 'working',
      color: '#22c55e',
      bg: 'rgba(34, 197, 94, 0.12)',
      border: 'rgba(34, 197, 94, 0.3)',
    },
    'waiting': {
      labelPt: 'aguardando resposta',
      labelEn: 'waiting input',
      color: '#f59e0b',
      bg: 'rgba(245, 158, 11, 0.12)',
      border: 'rgba(245, 158, 11, 0.3)',
    },
    'waiting-approval': {
      labelPt: 'precisa de aprovação',
      labelEn: 'needs approval',
      color: '#ef4444',
      bg: 'rgba(239, 68, 68, 0.12)',
      border: 'rgba(239, 68, 68, 0.3)',
    },
    'exited': {
      labelPt: 'encerrada',
      labelEn: 'exited',
      color: '#9ca3af',
      bg: 'rgba(156, 163, 175, 0.12)',
      border: 'rgba(156, 163, 175, 0.3)',
    },
  }[act] || {
    labelPt: 'trabalhando',
    labelEn: 'working',
    color: '#22c55e',
    bg: 'rgba(34, 197, 94, 0.12)',
    border: 'rgba(34, 197, 94, 0.3)',
  }

  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 5,
        padding: '2px 8px',
        borderRadius: 999,
        fontSize: 10,
        fontWeight: 600,
        color: config.color,
        background: config.bg,
        border: `1px solid ${config.border}`,
        whiteSpace: 'nowrap',
        flexShrink: 0,
      }}
    >
      <span
        style={{
          width: 6,
          height: 6,
          borderRadius: '50%',
          background: config.color,
          boxShadow: `0 0 6px ${config.color}`,
        }}
      />
      {pt ? config.labelPt : config.labelEn}
    </span>
  )
}

function LiveCard({
  s,
  pt,
  onOpen,
  central,
  activity,
}: {
  s: SessionMeta
  pt: boolean
  onOpen: () => void
  central?: boolean
  activity?: SessionActivity
}) {
  const cmd = central ? null : resumeCommand(s)
  const [copied, setCopied] = useState(false)
  const mins = Math.max(0, Math.round((Date.now() - lastActivityMs(s)) / 60_000))
  const title = sessionLabel(s) || (s.project_path ? (s.project_path.split('/').filter(Boolean).pop() || '') : '') || s.session_id.slice(0, 8)

  return (
    <div
      style={{
        border: '1px solid var(--border)',
        borderRadius: 12,
        padding: '16px 18px',
        background: 'var(--bg-card)',
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
        boxShadow: '0 1px 3px rgba(0,0,0,0.03)',
      }}
    >
      {/* Header Row */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12,
          flexWrap: 'wrap',
        }}
      >
        {/* Title & Harness */}
        <div
          onClick={onOpen}
          style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 10, minWidth: 0, flex: 1 }}
        >
          <span
            style={{
              fontSize: 15,
              fontWeight: 600,
              color: 'var(--text-primary)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {title}
          </span>
          <HarnessBadge harness={s.harness} />
        </div>

        {/* Status Badge & Elapsed Time */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
          <StatusBadge activity={activity} pt={pt} />
          <span style={{ fontSize: 11, color: 'var(--text-tertiary)', display: 'flex', alignItems: 'center', gap: 4 }}>
            <Clock size={12} />
            <span>{pt ? `há ${mins} min` : `${mins} min ago`}</span>
          </span>
        </div>
      </div>

      {/* Context Details (Project Path / Member) */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, fontSize: 12, color: 'var(--text-tertiary)' }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            minWidth: 0,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
          title={s.project_path}
        >
          <Folder size={13} style={{ flexShrink: 0, color: 'var(--text-tertiary)' }} />
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{s.project_path}</span>
        </div>

        {central && s.user && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0, color: 'var(--text-secondary)' }}>
            <User size={13} />
            <span>{s.user}</span>
          </div>
        )}
      </div>

      {/* Command Box */}
      {cmd ? (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 12,
            padding: '8px 12px',
            borderRadius: 8,
            background: 'var(--bg-elevated)',
            border: '1px solid var(--border-subtle)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0, flex: 1 }}>
            <Terminal size={13} style={{ color: 'var(--anthropic-orange)', flexShrink: 0 }} />
            <code
              style={{
                fontSize: 11,
                fontFamily: 'var(--font-mono, monospace)',
                color: 'var(--text-primary)',
                overflowX: 'auto',
                whiteSpace: 'nowrap',
                scrollbarWidth: 'none',
              }}
            >
              {cmd}
            </code>
          </div>

          <button
            onClick={() => {
              navigator.clipboard.writeText(cmd)
              setCopied(true)
              setTimeout(() => setCopied(false), 1800)
            }}
            title={pt ? 'Copiar comando para o terminal' : 'Copy command to terminal'}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              padding: '5px 10px',
              borderRadius: 6,
              border: copied ? '1px solid rgba(34, 197, 94, 0.4)' : '1px solid var(--border)',
              background: copied ? 'rgba(34, 197, 94, 0.1)' : 'var(--bg-card)',
              color: copied ? '#22c55e' : 'var(--text-secondary)',
              fontSize: 11,
              fontWeight: 500,
              cursor: 'pointer',
              flexShrink: 0,
              transition: 'all 0.15s ease',
              fontFamily: 'inherit',
            }}
          >
            {copied ? (
              <>
                <Check size={12} color="#22c55e" />
                <span>{pt ? 'Copiado!' : 'Copied!'}</span>
              </>
            ) : (
              <>
                <Copy size={12} />
                <span>{pt ? 'Copiar' : 'Copy'}</span>
              </>
            )}
          </button>
        </div>
      ) : central ? null : (
        <div style={{ fontSize: 11, color: 'var(--text-tertiary)', fontStyle: 'italic' }}>
          {pt ? 'Retomar não disponível para este harness.' : 'Resume not available for this harness.'}
        </div>
      )}
    </div>
  )
}

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

function StartingCard({ p, pt }: { p: LiveProcess; pt: boolean }) {
  const label = HARNESS_LABELS[p.harness] ?? p.harness
  const colour = HARNESS_COLORS[p.harness] ?? 'var(--text-tertiary)'
  return (
    <div style={{ border: '1px dashed var(--border)', borderRadius: 10, padding: 12, background: 'var(--bg-card)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ width: 8, height: 8, borderRadius: '50%', background: colour, flexShrink: 0, opacity: 0.7 }} />
        <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{label}</span>
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
