/**
 * SessionsPage — the one surface that owns sessions.
 *
 * It is ONE control surface, not two stacked cards. The page header used to be its own rounded box
 * (title, subtitle, a List/Grid segmented control and the Notifications button) with the whole
 * grouping/filter/sort/search block floating in a second box below it — and the second box carried
 * its OWN list/grid pair, so the same control appeared twice on one screen. `RecentSessions` has
 * always accepted `title` / `subtitle` / `topActions` and renders them inside its control card, so
 * the header moved in there and the duplicate toggle went with it. The surviving toggle is the one
 * in the controls row, beside the search, the sort and the grouping it belongs with.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { useOutletContext, useNavigate } from 'react-router-dom'
import { Bell, BellOff, Clock, Settings, Sparkles } from 'lucide-react'
import type { SessionMeta } from '@agentistics/core'
import type { AppContext } from '../lib/app-context'
import { RecentSessions } from '../components/RecentSessions'
import { useFleet, useFleetIndex } from '../lib/fleet'
import { useIsMobile } from '../hooks/useIsMobile'
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
  const { data, derived, lang, theme, setSelectedSession, isCentral } = ctx
  const pt = lang === 'pt'
  const navigate = useNavigate()
  const isMobile = useIsMobile()

  // Real-time open-session detection: which stored conversations have a live process behind them,
  // and what each of those is doing.
  const [liveIdList, setLiveIdList] = useState<string[]>(data.liveSessionIds ?? [])
  const [liveActivities, setLiveActivities] = useState<Record<string, SessionActivity>>({})

  const [notifSettings, setNotifSettings] = useState<NotificationSettings>(getNotificationSettings)
  const prevActivitiesRef = useRef<Record<string, SessionActivity>>({})
  /**
   * Has this mount taken its SILENT BASELINE yet? — the fix for the false notifications.
   *
   * `handleSessionStateTransitions` announces anything it has no previous state for, and that is
   * right for what it is: a session that appears really is news. What was wrong is what this page
   * handed it. `prevActivitiesRef` starts EMPTY and the first poll called straight into it, so
   * every live session looked new at once — and this poller lives inside a page component, so its
   * memory is wiped by every remount: navigating away and back, a language toggle, a dev reload.
   * The user's report is that burst, for sessions that had been in the same state for an hour.
   *
   * So the first answer is RECORDED and not announced. `sessionNotifications.test.ts` pins the
   * other half deliberately — if the module ever stops firing for genuinely new sessions, this
   * guard would hide it, so the two must stay separate.
   *
   * The cost, stated: a session already waiting when the page opens is not announced. That is the
   * right trade — it is on screen, marked and counted, while a notification is for the thing that
   * happened while you were looking somewhere else.
   */
  const baselineTakenRef = useRef(false)

  const sessionsMap = useMemo(() => {
    const map = new Map<string, SessionMeta>()
    for (const s of data.sessions) map.set(s.session_id, s)
    return map
  }, [data.sessions])

  useEffect(() => {
    let alive = true
    const poll = async () => {
      try {
        const res = await fetch('/api/live-sessions')
        if (!res.ok) return
        const json = await res.json() as {
          liveSessionIds?: string[]
          liveSessionActivities?: Record<string, SessionActivity>
        }
        if (!alive) return
        if (Array.isArray(json.liveSessionIds)) setLiveIdList(json.liveSessionIds)

        const activities = json.liveSessionActivities || {}
        setLiveActivities(activities)
        // The first answer of this mount is the BASELINE: recorded, never announced. Everything
        // after it is a genuine transition. See `baselineTakenRef`.
        if (baselineTakenRef.current) {
          handleSessionStateTransitions(prevActivitiesRef.current, activities, sessionsMap, pt ? 'pt' : 'en')
        }
        prevActivitiesRef.current = activities
        baselineTakenRef.current = true
      } catch { /* transient — keep last known */ }
    }
    void poll()
    const id = setInterval(poll, LIVE_POLL_MS)
    return () => { alive = false; clearInterval(id) }
  }, [isCentral, sessionsMap, pt])

  const liveIds = useMemo(() => new Set(liveIdList), [liveIdList])

  // The LIVE fleet — what agentop hosts on THIS machine, and what each row may be asked to do.
  // Never on a central: it aggregates many machines and hosts none of their sessions, so the only
  // fleet it could read is its own box's, drawn under someone else's rows.
  const { fleet, unsupported: fleetUnsupported, act } = useFleet(pt ? 'pt' : 'en', !isCentral)
  const fleetIdx = useFleetIndex(fleet.sessions)

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

  const btn: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    justifyContent: isMobile ? 'center' : 'flex-start',
    gap: 6,
    padding: '8px 12px',
    borderRadius: 8,
    border: '1px solid var(--border-subtle)',
    background: 'transparent',
    color: 'var(--text-secondary)',
    fontSize: 12,
    fontWeight: 500,
    cursor: 'pointer',
    fontFamily: 'inherit',
    minHeight: isMobile ? 44 : undefined,
  }

  return (
    <>
      {/* Notification permission prompt. Above the card because it is a one-off question about the
          browser, not a control of this list. */}
      {showPromptBanner && (
        <div
          style={{
            background: 'var(--bg-elevated)',
            border: '1px solid var(--anthropic-orange-dim, rgba(232,105,11,0.3))',
            borderRadius: 12,
            padding: '16px 20px',
            marginBottom: 12,
            display: 'flex',
            flexDirection: isMobile ? 'column' : 'row',
            alignItems: isMobile ? 'stretch' : 'center',
            justifyContent: 'space-between',
            gap: 16,
            flexWrap: 'wrap',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flex: 1, minWidth: 260 }}>
            <div
              style={{
                width: 38, height: 38, borderRadius: 10, flexShrink: 0,
                background: 'rgba(232,105,11,0.12)', color: 'var(--anthropic-orange)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
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
              <div style={{ fontSize: 12, color: 'var(--text-tertiary)', lineHeight: 1.5 }}>
                {pt
                  ? 'Só quando uma sessão MUDA de estado — passa a precisar de você, termina o turno ou encerra. O que já estava esperando quando você abriu a página não dispara nada.'
                  : 'Only when a session CHANGES state — starts needing you, finishes its turn, or exits. Anything already waiting when you opened the page announces nothing.'}
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: isMobile ? 'column' : 'row', alignItems: isMobile ? 'stretch' : 'center', gap: 8, flexShrink: 0, flexWrap: 'wrap', width: isMobile ? '100%' : undefined }}>
            <button
              onClick={handleEnableNotifications}
              style={{ ...btn, background: 'var(--anthropic-orange)', color: '#fff', border: 'none', fontWeight: 600 }}
            >
              <Sparkles size={14} />
              <span>{pt ? 'Sim, ativar notificações' : 'Yes, enable notifications'}</span>
            </button>
            <button onClick={() => navigate('/settings/notifications')} style={btn}>
              <Settings size={13} />
              <span>{pt ? 'Configurar' : 'Configure'}</span>
            </button>
            <button onClick={handleDismissPrompt} style={{ ...btn, color: 'var(--text-tertiary)' }}>
              {pt ? 'Agora não' : 'Not now'}
            </button>
          </div>
        </div>
      )}

      {/* Why the rows below may carry no verbs. Said in words rather than left as a bar that never
          appears: "nothing is running" and "this machine cannot tell" are different facts. */}
      {!isCentral && (fleetUnsupported || fleet.unavailable) && (
        <div
          role="status"
          style={{
            fontSize: 12,
            lineHeight: 1.5,
            color: 'var(--text-tertiary)',
            border: '1px solid var(--border-subtle)',
            borderRadius: 10,
            padding: '10px 14px',
            marginBottom: 12,
          }}
        >
          {fleetUnsupported
            ? (pt
                ? 'O controle de sessões não está disponível nesta instalação, então as sessões abaixo aparecem só como histórico.'
                : 'Session control is not available on this install, so the sessions below are listed as history only.')
            : fleet.unavailable}
        </div>
      )}

      <RecentSessions
        sessions={derived.filteredSessions}
        lang={lang}
        theme={theme}
        onSelect={setSelectedSession}
        pinnedIds={liveIds}
        activities={liveActivities}
        fleet={fleetIdx}
        onFleetAction={act}
        // Who a prompt is attributed to in the write-channel audit: the IAM display name where the
        // dashboard has a login, else the browser's own operator id (resolved in promptAudit).
        authorName={ctx.me?.name}
        // The live terminal now lives INSIDE each session's card (expand a row to watch it), so the
        // machine's live work is what you see first: grouped by repo, only the active sessions.
        defaultGrouping="repo"
        defaultStatus="active"
        title={<>
          <span style={{ color: 'var(--anthropic-orange)', display: 'inline-flex' }}><Clock size={18} /></span>
          {pt ? 'Sessões' : 'Sessions'}
        </>}
        subtitle={isCentral
          ? (pt
              ? 'Últimas sessões do time (metadados, sem chat) — reativo aos filtros, inclusive por membro.'
              : "The team's latest sessions (metadata, no chat) — reactive to the filters, including by member.")
          : (pt
              ? 'Sessões abertas agora (em tempo real) e as últimas sessões, com o que dá para fazer com cada uma.'
              : 'Sessions open right now (real time) and your latest ones, with what can be done to each.')}
        topActions={
          <button
            onClick={() => navigate('/settings/notifications')}
            title={pt ? 'Configurar Notificações' : 'Configure Notifications'}
            style={{ ...btn, background: 'var(--bg-elevated)' }}
          >
            {notifSettings.enabled ? <Bell size={13} style={{ color: 'var(--anthropic-orange)' }} /> : <BellOff size={13} />}
            <span>{pt ? 'Notificações' : 'Notifications'}</span>
          </button>
        }
      />
    </>
  )
}
