/**
 * RemoteSessionsBlock.tsx — the connection card's "let this central manage my sessions" block.
 *
 * TWO SWITCHES, and the split is the point (see `remoteSessions.ts` in `@agentistics/core`). The
 * first grants the fleet and the verbs that carry no screen; the second additionally lets the
 * session's TERMINAL travel, and it is what `approve` and `prompt` would need. They are separate
 * because "let me rename a session from my phone" is not informed consent to "stream my terminal to
 * the central" — the reverse channel had on-demand chat retrieval REMOVED for exactly that reason.
 *
 * Every decision is `remoteSessionsState.ts`; this file draws it.
 */

import { useState } from 'react'
import { Loader2, MonitorSmartphone, Terminal } from 'lucide-react'
import { useIsMobile } from '../../hooks/useIsMobile'
import { remotePanelView, consentPatchFor } from './remoteSessionsState'
import type { ConnectionStatusEntry } from './statusTypes'

type Lang = 'en' | 'pt'

const COPY = {
  title: { en: 'Sessions from this central', pt: 'Sessões a partir desta central' },
  intro: {
    en: 'Off by default. Only the account that owns this machine can use it — not the central’s owner just for being the owner.',
    pt: 'Desligado por padrão. Só a conta dona desta máquina pode usar — não o dono da central só por ser o dono.',
  },
  sessionsLabel: { en: 'Manage my sessions', pt: 'Gerenciar minhas sessões' },
  sessionsHelp: {
    en: 'The session list, and renaming, notes, tasks, interrupting, killing and reopening. No terminal is sent.',
    pt: 'A lista de sessões, e renomear, notas, tarefas, interromper, encerrar e reabrir. Nenhum terminal é enviado.',
  },
  screensLabel: { en: 'Also send the session screen', pt: 'Enviar também a tela da sessão' },
  screensHelp: {
    en: 'The terminal itself and the permission dialogs. This is what answering a prompt would need — and it is your conversation, so it is asked separately.',
    pt: 'O terminal em si e os diálogos de permissão. É o que responder a um prompt exigiria — e é a sua conversa, então é perguntado à parte.',
  },
  screensLocked: {
    en: 'Available once the switch above is on.',
    pt: 'Disponível quando a chave acima estiver ligada.',
  },
  pending: {
    en: 'This machine is not reaching the central right now, so it has not been told yet. It is announced on the next connection.',
    pt: 'Esta máquina não está alcançando a central agora, então ela ainda não foi avisada. O aviso vai na próxima conexão.',
  },
  // Stated rather than implied. The instance owner can already re-assign this machine's account, so
  // promising more than this would be a promise the product cannot keep.
  limit: {
    en: 'Whoever runs the central administers machines and could re-assign this one. This switch is what stops session access being on without you choosing it.',
    pt: 'Quem opera a central administra máquinas e poderia reatribuir esta. Esta chave é o que impede o acesso às sessões estar ligado sem você ter escolhido.',
  },
  notYet: {
    en: 'Nothing is relayed yet — this records your answer. The central shows it to you and to nobody else.',
    pt: 'Nada é retransmitido ainda — isto registra sua resposta. A central mostra ela pra você e pra mais ninguém.',
  },
} as const

export interface RemoteSessionsBlockProps {
  connId: string
  status: ConnectionStatusEntry | undefined
  lang: Lang
  /** Disabled for the same reasons the card's other writes are — a rules apply in flight, a
   *  disconnect running. A switch that writes during one of those races the server's own sequence. */
  disabled?: boolean
  onPatch: (connId: string, body: { allowRemoteSessions: boolean; allowRemoteScreens: boolean }) => Promise<void>
}

export function RemoteSessionsBlock({ connId, status, lang, disabled = false, onPatch }: RemoteSessionsBlockProps) {
  const isMobile = useIsMobile()
  const [busy, setBusy] = useState<'sessions' | 'screens' | null>(null)
  const view = remotePanelView(status)

  async function toggle(which: 'sessions' | 'screens') {
    if (busy || disabled) return
    setBusy(which)
    try {
      await onPatch(connId, consentPatchFor(view, which))
    } finally {
      setBusy(null)
    }
  }

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', gap: 10,
      padding: '12px 14px', borderRadius: 8,
      border: '1px solid var(--border)', background: 'var(--bg-secondary)',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
        <MonitorSmartphone size={14} style={{ color: 'var(--text-secondary)', flexShrink: 0 }} />
        <strong style={{ fontSize: 12.5 }}>{COPY.title[lang]}</strong>
      </div>
      <p style={{ margin: 0, fontSize: 11.5, lineHeight: 1.5, color: 'var(--text-secondary)' }}>
        {COPY.intro[lang]}
      </p>

      <SwitchRow
        icon={<MonitorSmartphone size={13} />}
        label={COPY.sessionsLabel[lang]}
        help={COPY.sessionsHelp[lang]}
        on={view.level !== 'off'}
        busy={busy === 'sessions'}
        disabled={disabled || busy !== null}
        isMobile={isMobile}
        onToggle={() => { void toggle('sessions') }}
      />

      <SwitchRow
        icon={<Terminal size={13} />}
        label={COPY.screensLabel[lang]}
        help={view.screensAvailable ? COPY.screensHelp[lang] : COPY.screensLocked[lang]}
        on={view.level === 'screens'}
        busy={busy === 'screens'}
        // Not hidden: a control that vanishes says nothing about why. Disabled with its own
        // sentence is the same call `fleet-row.ts` makes for a verb a row cannot take.
        disabled={disabled || busy !== null || !view.screensAvailable}
        isMobile={isMobile}
        onToggle={() => { void toggle('screens') }}
      />

      {view.announcementPending && (
        <div role="status" style={{
          padding: '8px 10px', borderRadius: 7, fontSize: 11, lineHeight: 1.5,
          color: 'var(--anthropic-orange)',
          background: 'color-mix(in srgb, var(--anthropic-orange) 10%, transparent)',
        }}>
          {COPY.pending[lang]}
        </div>
      )}

      <p style={{ margin: 0, fontSize: 10.5, lineHeight: 1.5, color: 'var(--text-secondary)' }}>
        {COPY.notYet[lang]}
      </p>
      <p style={{ margin: 0, fontSize: 10.5, lineHeight: 1.5, color: 'var(--text-secondary)' }}>
        {COPY.limit[lang]}
      </p>
    </div>
  )
}

function SwitchRow({ icon, label, help, on, busy, disabled, isMobile, onToggle }: {
  icon: React.ReactNode
  label: string
  help: string
  on: boolean
  busy: boolean
  disabled: boolean
  isMobile: boolean
  onToggle: () => void
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={disabled}
      onClick={onToggle}
      style={{
        display: 'flex', alignItems: 'flex-start', gap: 10, width: '100%', textAlign: 'left',
        // 44px is the MOBILE number — applying it on desktop turns a settings row into a slab.
        minHeight: isMobile ? 44 : 34,
        padding: isMobile ? '10px 12px' : '8px 10px',
        borderRadius: 7, fontFamily: 'inherit', cursor: disabled ? 'default' : 'pointer',
        border: `1px solid ${on ? 'var(--accent-green)' : 'var(--border)'}`,
        background: on ? 'color-mix(in srgb, var(--accent-green) 10%, transparent)' : 'transparent',
        color: 'var(--text-primary)',
        opacity: disabled ? 0.55 : 1,
      }}
    >
      <span style={{ display: 'flex', alignItems: 'center', flexShrink: 0, marginTop: 1, color: on ? 'var(--accent-green)' : 'var(--text-secondary)' }}>
        {busy ? <Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }} /> : icon}
      </span>
      <span style={{ display: 'flex', flexDirection: 'column', gap: 3, minWidth: 0, flex: 1 }}>
        <span style={{ fontSize: 12, fontWeight: 600 }}>{label}</span>
        <span style={{ fontSize: 10.5, lineHeight: 1.45, color: 'var(--text-secondary)', overflowWrap: 'anywhere' }}>
          {help}
        </span>
      </span>
      <Pill on={on} />
    </button>
  )
}

/** The state in a WORD as well as in colour — a row whose only signal is a green tint is a row
 *  nobody colour-blind can read, and this one grants access to a machine. */
function Pill({ on }: { on: boolean }) {
  return (
    <span style={{
      flexShrink: 0, alignSelf: 'center',
      padding: '2px 8px', borderRadius: 999, fontSize: 10, fontWeight: 700,
      border: `1px solid ${on ? 'var(--accent-green)' : 'var(--border)'}`,
      color: on ? 'var(--accent-green)' : 'var(--text-secondary)',
    }}>
      {on ? 'ON' : 'OFF'}
    </span>
  )
}
