import React, { useState, useEffect } from 'react'
import { useOutletContext } from 'react-router-dom'
import type { AppContext } from '../../lib/app-context'
import {
  getNotificationSettings,
  saveNotificationSettings,
  requestNotificationPermission,
  getBrowserNotificationPermission,
  playNotificationSound,
  triggerSessionNotification,
  type NotificationSettings,
  type SoundPreset,
} from '../../lib/sessionNotifications'
import { SectionHeader, Divider, PrefRow, Toggle } from './primitives'
import { Bell, Volume2, VolumeX, ShieldAlert, Sparkles, CheckCircle2, AlertCircle } from 'lucide-react'

export default function NotificationsSettings() {
  const ctx = useOutletContext<AppContext>()
  const pt = ctx.lang === 'pt'

  const [settings, setSettings] = useState<NotificationSettings>(getNotificationSettings)
  const [permission, setPermission] = useState<NotificationPermission>('default')

  useEffect(() => {
    setPermission(getBrowserNotificationPermission())
  }, [])

  function update(partial: Partial<NotificationSettings>) {
    const next = { ...settings, ...partial }
    setSettings(next)
    saveNotificationSettings(next)
  }

  function updateEvent(eventKey: keyof NotificationSettings['events'], value: boolean) {
    const nextEvents = { ...settings.events, [eventKey]: value }
    update({ events: nextEvents })
  }

  async function handleRequestPermission() {
    const res = await requestNotificationPermission()
    setPermission(res)
    if (res === 'granted') {
      update({ enabled: true })
      triggerSessionNotification({
        title: pt ? 'Notificações Ativadas' : 'Notifications Enabled',
        body: pt
          ? 'Você receberá alertas sonoros e notificações do navegador para suas Live Sessions.'
          : 'You will receive browser notifications and sound alerts for your Live Sessions.',
        soundEnabled: settings.soundEnabled,
        soundPreset: settings.soundPreset,
        soundVolume: settings.soundVolume,
      })
    }
  }

  function handleTestSoundAndNotification() {
    triggerSessionNotification({
      title: pt ? '🔔 Notificação de Teste' : '🔔 Test Notification',
      body: pt
        ? 'Isso é uma demonstração do alerta sonoro e visual das Live Sessions.'
        : 'This is a test of the Live Sessions visual and sound notification.',
      soundEnabled: true,
      soundPreset: settings.soundPreset,
      soundVolume: settings.soundVolume,
    })
  }

  const SOUND_PRESETS: { key: SoundPreset; labelPt: string; labelEn: string; descPt: string; descEn: string }[] = [
    { key: 'chime', labelPt: 'Chime Melódico', labelEn: 'Melodic Chime', descPt: 'Acorde suave triplo em C5', descEn: 'Soft triple chord in C5' },
    { key: 'soft', labelPt: 'Suave / Discreto', labelEn: 'Soft / Subtle', descPt: 'Pulso duplo de baixa frequência', descEn: 'Double low-frequency pulse' },
    { key: 'alert', labelPt: 'Alerta / Destaque', labelEn: 'Alert Tone', descPt: 'Tom triplo de atenção em E5', descEn: 'Triple attention tone in E5' },
    { key: 'ping', labelPt: 'Ping de Cristal', labelEn: 'Crystal Ping', descPt: 'Sino agudo de alta clareza', descEn: 'High clarity bell' },
  ]

  return (
    <div style={{ maxWidth: 720 }}>
      {/* Browser Permission Banner / Card */}
      <div
        style={{
          background: 'var(--bg-elevated)',
          border: '1px solid var(--border-subtle)',
          borderRadius: 12,
          padding: '16px 20px',
          marginBottom: 20,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 16,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div
            style={{
              width: 38,
              height: 38,
              borderRadius: 10,
              background: permission === 'granted' ? 'rgba(34,197,94,0.12)' : 'rgba(232,105,11,0.12)',
              color: permission === 'granted' ? '#22c55e' : 'var(--anthropic-orange)',
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
              {pt ? 'Permissão do Navegador' : 'Browser Permission'}
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-tertiary)', display: 'flex', alignItems: 'center', gap: 6 }}>
              {permission === 'granted' ? (
                <>
                  <CheckCircle2 size={12} style={{ color: '#22c55e' }} />
                  <span>{pt ? 'Permissão concedida no navegador' : 'Permission granted in browser'}</span>
                </>
              ) : permission === 'denied' ? (
                <>
                  <AlertCircle size={12} style={{ color: '#ef4444' }} />
                  <span>{pt ? 'Bloqueada nas configurações do navegador' : 'Blocked in browser settings'}</span>
                </>
              ) : (
                <>
                  <ShieldAlert size={12} style={{ color: 'var(--anthropic-orange)' }} />
                  <span>{pt ? 'Ainda não solicitada ao navegador' : 'Not requested yet'}</span>
                </>
              )}
            </div>
          </div>
        </div>

        {permission !== 'granted' && (
          <button
            onClick={handleRequestPermission}
            style={{
              padding: '8px 16px',
              borderRadius: 8,
              background: 'var(--anthropic-orange)',
              color: '#fff',
              border: 'none',
              fontSize: 12,
              fontWeight: 600,
              cursor: 'pointer',
              fontFamily: 'inherit',
              transition: 'opacity 0.15s',
              whiteSpace: 'nowrap',
            }}
            onMouseEnter={e => { e.currentTarget.style.opacity = '0.9' }}
            onMouseLeave={e => { e.currentTarget.style.opacity = '1' }}
          >
            {pt ? 'Autorizar Notificações' : 'Enable Notifications'}
          </button>
        )}
      </div>

      {/* Master Enable Toggle */}
      <PrefRow
        label={pt ? 'Ativar Notificações das Live Sessions' : 'Enable Live Session Notifications'}
        sub={
          pt
            ? 'Dispara alertas visuais e sonoros ao mudar de status (Central e Machine)'
            : 'Fires visual and sound alerts when session status changes (Central and Machine)'
        }
      >
        <Toggle on={settings.enabled} onToggle={() => update({ enabled: !settings.enabled })} />
      </PrefRow>

      <Divider />

      {/* Event Types / Filter Section */}
      <SectionHeader label={pt ? 'Eventos para Notificar' : 'Notification Events'} />
      <div style={{ fontSize: 12, color: 'var(--text-tertiary)', marginBottom: 14 }}>
        {pt
          ? 'Escolha em quais momentos das suas live sessions você deseja receber alertas:'
          : 'Choose when you want to be notified during live session progress:'}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 20 }}>
        {/* Waiting Approval */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '12px 14px',
            borderRadius: 8,
            border: '1px solid var(--border-subtle)',
            background: 'var(--bg-elevated)',
          }}
        >
          <div>
            <div style={{ fontSize: 13, fontWeight: 600, color: '#ef4444', display: 'flex', alignItems: 'center', gap: 6 }}>
              <span>🔴</span>
              <span>{pt ? 'Precisa de Aprovação' : 'Needs Approval'}</span>
              <span style={{ fontSize: 11, fontWeight: 400, color: 'var(--text-tertiary)', marginLeft: 4 }}>
                (waiting-approval)
              </span>
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 2 }}>
              {pt
                ? 'Quando a sessão é pausada aguardando confirmação ou autorização do usuário'
                : 'When session is paused waiting for user confirmation or tool authorization'}
            </div>
          </div>
          <Toggle
            on={settings.events['waiting-approval']}
            onToggle={() => updateEvent('waiting-approval', !settings.events['waiting-approval'])}
          />
        </div>

        {/* Waiting Input */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '12px 14px',
            borderRadius: 8,
            border: '1px solid var(--border-subtle)',
            background: 'var(--bg-elevated)',
          }}
        >
          <div>
            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--anthropic-orange)', display: 'flex', alignItems: 'center', gap: 6 }}>
              <span>🟡</span>
              <span>{pt ? 'Aguardando Resposta' : 'Waiting Response'}</span>
              <span style={{ fontSize: 11, fontWeight: 400, color: 'var(--text-tertiary)', marginLeft: 4 }}>
                (waiting)
              </span>
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 2 }}>
              {pt
                ? 'Quando a IA conclui a resposta e aguarda sua nova mensagem/comando'
                : 'When AI completes its turn and awaits your input/command'}
            </div>
          </div>
          <Toggle
            on={settings.events['waiting']}
            onToggle={() => updateEvent('waiting', !settings.events['waiting'])}
          />
        </div>

        {/* Working */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '12px 14px',
            borderRadius: 8,
            border: '1px solid var(--border-subtle)',
            background: 'var(--bg-elevated)',
          }}
        >
          <div>
            <div style={{ fontSize: 13, fontWeight: 600, color: '#22c55e', display: 'flex', alignItems: 'center', gap: 6 }}>
              <span>🟢</span>
              <span>{pt ? 'Trabalhando' : 'Working'}</span>
              <span style={{ fontSize: 11, fontWeight: 400, color: 'var(--text-tertiary)', marginLeft: 4 }}>
                (working)
              </span>
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 2 }}>
              {pt
                ? 'Quando a sessão retoma a execução / geração de código'
                : 'When session resumes execution / code generation'}
            </div>
          </div>
          <Toggle
            on={settings.events['working']}
            onToggle={() => updateEvent('working', !settings.events['working'])}
          />
        </div>

        {/* Exited */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '12px 14px',
            borderRadius: 8,
            border: '1px solid var(--border-subtle)',
            background: 'var(--bg-elevated)',
          }}
        >
          <div>
            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: 6 }}>
              <span>⚪</span>
              <span>{pt ? 'Sessão Encerrada' : 'Session Exited'}</span>
              <span style={{ fontSize: 11, fontWeight: 400, color: 'var(--text-tertiary)', marginLeft: 4 }}>
                (exited)
              </span>
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 2 }}>
              {pt
                ? 'Quando o processo de uma sessão ao vivo é finalizado'
                : 'When a live session process exits or terminates'}
            </div>
          </div>
          <Toggle
            on={settings.events['exited']}
            onToggle={() => updateEvent('exited', !settings.events['exited'])}
          />
        </div>
      </div>

      <Divider />

      {/* Sound Effects Section */}
      <SectionHeader label={pt ? 'Efeitos Sonoros' : 'Sound Effects'} />

      <PrefRow
        label={pt ? 'Tocar Som nas Notificações' : 'Play Sound on Notifications'}
        sub={pt ? 'Efeito sonoro synthesized sem arquivos externos' : 'Synthesized audio chime without external asset downloads'}
      >
        <Toggle on={settings.soundEnabled} onToggle={() => update({ soundEnabled: !settings.soundEnabled })} />
      </PrefRow>

      {settings.soundEnabled && (
        <>
          <div style={{ marginTop: 14, marginBottom: 14 }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 8 }}>
              {pt ? 'Estilo do Som' : 'Sound Style'}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 8 }}>
              {SOUND_PRESETS.map(preset => {
                const active = settings.soundPreset === preset.key
                return (
                  <button
                    key={preset.key}
                    onClick={() => {
                      update({ soundPreset: preset.key })
                      playNotificationSound(preset.key, settings.soundVolume)
                    }}
                    style={{
                      padding: '10px 12px',
                      borderRadius: 8,
                      border: active ? '1px solid var(--anthropic-orange)' : '1px solid var(--border-subtle)',
                      background: active ? 'rgba(232,105,11,0.1)' : 'var(--bg-elevated)',
                      color: active ? 'var(--anthropic-orange)' : 'var(--text-primary)',
                      textAlign: 'left',
                      cursor: 'pointer',
                      transition: 'all 0.15s',
                      fontFamily: 'inherit',
                    }}
                  >
                    <div style={{ fontSize: 12, fontWeight: 600 }}>{pt ? preset.labelPt : preset.labelEn}</div>
                    <div style={{ fontSize: 10, color: 'var(--text-tertiary)', marginTop: 2 }}>
                      {pt ? preset.descPt : preset.descEn}
                    </div>
                  </button>
                )
              })}
            </div>
          </div>

          <div style={{ marginBottom: 20 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: 6 }}>
                {settings.soundVolume > 0 ? <Volume2 size={14} /> : <VolumeX size={14} />}
                <span>{pt ? 'Volume do Som' : 'Sound Volume'}</span>
              </div>
              <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-tertiary)' }}>
                {Math.round(settings.soundVolume * 100)}%
              </span>
            </div>
            <input
              type="range"
              min="0"
              max="1"
              step="0.05"
              value={settings.soundVolume}
              onChange={e => {
                const vol = parseFloat(e.target.value)
                update({ soundVolume: vol })
              }}
              style={{
                width: '100%',
                accentColor: 'var(--anthropic-orange)',
                cursor: 'pointer',
              }}
            />
          </div>
        </>
      )}

      <Divider />

      {/* Test Sound & Notification Button */}
      <div style={{ display: 'flex', justifyContent: 'flex-start', paddingTop: 6 }}>
        <button
          onClick={handleTestSoundAndNotification}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '10px 18px',
            borderRadius: 8,
            border: '1px solid var(--border-subtle)',
            background: 'var(--bg-elevated)',
            color: 'var(--text-primary)',
            fontSize: 12,
            fontWeight: 600,
            cursor: 'pointer',
            transition: 'all 0.15s',
            fontFamily: 'inherit',
          }}
          onMouseEnter={e => {
            e.currentTarget.style.borderColor = 'var(--anthropic-orange)'
            e.currentTarget.style.color = 'var(--anthropic-orange)'
          }}
          onMouseLeave={e => {
            e.currentTarget.style.borderColor = 'var(--border-subtle)'
            e.currentTarget.style.color = 'var(--text-primary)'
          }}
        >
          <Sparkles size={14} style={{ color: 'var(--anthropic-orange)' }} />
          <span>{pt ? 'Testar Som e Notificação' : 'Test Sound & Notification'}</span>
        </button>
      </div>
    </div>
  )
}
