/**
 * sessionNotifications.ts — Web Notifications & Sound Effects for Live Sessions
 */

import type { SessionMeta } from '@agentistics/core'

export type SessionActivity = 'working' | 'waiting' | 'waiting-approval' | 'exited'
export type SoundPreset = 'chime' | 'soft' | 'alert' | 'ping'

export interface NotificationSettings {
  enabled: boolean
  askedPrompt: boolean
  events: {
    'waiting-approval': boolean
    'waiting': boolean
    'working': boolean
    'exited': boolean
  }
  soundEnabled: boolean
  soundPreset: SoundPreset
  soundVolume: number // 0.0 to 1.0
}

const STORAGE_KEY = 'agentistics-notification-settings'

export const DEFAULT_NOTIFICATION_SETTINGS: NotificationSettings = {
  enabled: true,
  askedPrompt: false,
  events: {
    'waiting-approval': true,
    'waiting': true,
    'working': false,
    'exited': true,
  },
  soundEnabled: true,
  soundPreset: 'chime',
  soundVolume: 0.8,
}

export function getNotificationSettings(): NotificationSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return DEFAULT_NOTIFICATION_SETTINGS
    const parsed = JSON.parse(raw)
    return {
      ...DEFAULT_NOTIFICATION_SETTINGS,
      ...parsed,
      events: {
        ...DEFAULT_NOTIFICATION_SETTINGS.events,
        ...(parsed.events || {}),
      },
    }
  } catch {
    return DEFAULT_NOTIFICATION_SETTINGS
  }
}

export function saveNotificationSettings(settings: NotificationSettings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings))
    window.dispatchEvent(new CustomEvent('agentistics:notification-settings-changed', { detail: settings }))
  } catch {
    /* ignore quota/disabled */
  }
}

// ----------------------------------------------------------------------------
// Audio Synthesis Engine (Web Audio API)
// ----------------------------------------------------------------------------

let audioCtx: AudioContext | null = null

function getAudioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null
  if (!audioCtx) {
    const AudioContextClass = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
    if (AudioContextClass) {
      audioCtx = new AudioContextClass()
    }
  }
  if (audioCtx && audioCtx.state === 'suspended') {
    void audioCtx.resume().catch(() => {})
  }
  return audioCtx
}

export function playNotificationSound(preset: SoundPreset = 'chime', volume: number = 0.8): void {
  try {
    const ctx = getAudioContext()
    if (!ctx) return

    const now = ctx.currentTime
    const masterGain = ctx.createGain()
    masterGain.gain.setValueAtTime(Math.max(0, Math.min(1, volume)), now)
    masterGain.connect(ctx.destination)

    if (preset === 'chime') {
      // Warm dual-tone chord: C5 (523.25 Hz) -> E5 (659.25 Hz) -> G5 (783.99 Hz)
      const freqs = [523.25, 659.25, 783.99]
      freqs.forEach((freq, idx) => {
        const osc = ctx.createOscillator()
        const gain = ctx.createGain()
        osc.type = 'sine'
        osc.frequency.setValueAtTime(freq, now + idx * 0.08)

        gain.gain.setValueAtTime(0.01, now + idx * 0.08)
        gain.gain.exponentialRampToValueAtTime(0.3, now + idx * 0.08 + 0.03)
        gain.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.08 + 0.6)

        osc.connect(gain)
        gain.connect(masterGain)

        osc.start(now + idx * 0.08)
        osc.stop(now + idx * 0.08 + 0.65)
      })
    } else if (preset === 'soft') {
      // Gentle double pulse (A4 -> C#5)
      const freqs = [440, 554.37]
      freqs.forEach((freq, idx) => {
        const osc = ctx.createOscillator()
        const gain = ctx.createGain()
        osc.type = 'sine'
        osc.frequency.setValueAtTime(freq, now + idx * 0.12)

        gain.gain.setValueAtTime(0.01, now + idx * 0.12)
        gain.gain.exponentialRampToValueAtTime(0.2, now + idx * 0.12 + 0.02)
        gain.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.12 + 0.4)

        osc.connect(gain)
        gain.connect(masterGain)

        osc.start(now + idx * 0.12)
        osc.stop(now + idx * 0.12 + 0.45)
      })
    } else if (preset === 'alert') {
      // Triple ascending alert tone (E5 -> G#5 -> B5)
      const freqs = [659.25, 830.61, 987.77]
      freqs.forEach((freq, idx) => {
        const osc = ctx.createOscillator()
        const gain = ctx.createGain()
        osc.type = 'triangle'
        osc.frequency.setValueAtTime(freq, now + idx * 0.09)

        gain.gain.setValueAtTime(0.01, now + idx * 0.09)
        gain.gain.exponentialRampToValueAtTime(0.35, now + idx * 0.09 + 0.02)
        gain.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.09 + 0.4)

        osc.connect(gain)
        gain.connect(masterGain)

        osc.start(now + idx * 0.09)
        osc.stop(now + idx * 0.09 + 0.45)
      })
    } else if (preset === 'ping') {
      // High crystal bell (A5 -> A6)
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.type = 'sine'
      osc.frequency.setValueAtTime(880, now)
      osc.frequency.exponentialRampToValueAtTime(1760, now + 0.05)

      gain.gain.setValueAtTime(0.4, now)
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.5)

      osc.connect(gain)
      gain.connect(masterGain)

      osc.start(now)
      osc.stop(now + 0.55)
    }
  } catch {
    /* AudioContext blocked or unsupported */
  }
}

// ----------------------------------------------------------------------------
// Browser Notifications
// ----------------------------------------------------------------------------

export async function requestNotificationPermission(): Promise<NotificationPermission> {
  if (typeof window === 'undefined' || !('Notification' in window)) {
    return 'denied'
  }
  if (Notification.permission === 'granted') {
    return 'granted'
  }
  return await Notification.requestPermission()
}

export function getBrowserNotificationPermission(): NotificationPermission {
  if (typeof window === 'undefined' || !('Notification' in window)) {
    return 'denied'
  }
  return Notification.permission
}

export function triggerSessionNotification(options: {
  title: string
  body: string
  tag?: string
  soundPreset?: SoundPreset
  soundVolume?: number
  soundEnabled?: boolean
}): void {
  const settings = getNotificationSettings()
  if (!settings.enabled) return

  if (settings.soundEnabled && (options.soundEnabled ?? true)) {
    playNotificationSound(options.soundPreset ?? settings.soundPreset, options.soundVolume ?? settings.soundVolume)
  }

  if (typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'granted') {
    try {
      new Notification(options.title, {
        body: options.body,
        icon: '/favicon.ico',
        tag: options.tag,
      })
    } catch {
      /* ignore notification errors */
    }
  }
}

// ----------------------------------------------------------------------------
// Activity Transition Tracking
// ----------------------------------------------------------------------------

export function handleSessionStateTransitions(
  prevActivities: Record<string, SessionActivity>,
  nextActivities: Record<string, SessionActivity>,
  sessionsMap: Map<string, SessionMeta>,
  lang: 'pt' | 'en' = 'pt'
): void {
  const settings = getNotificationSettings()
  if (!settings.enabled) return

  for (const [id, nextState] of Object.entries(nextActivities)) {
    const prevState = prevActivities[id]
    if (prevState && prevState === nextState) continue

    // Check if this event type is enabled in settings
    if (!settings.events[nextState]) continue

    const session = sessionsMap.get(id)
    const sessionName = session?.title || (session?.project_path ? session.project_path.split('/').pop() : id) || id
    const harness = session?.harness ? `${session.harness.toUpperCase()} · ` : ''

    let title = ''
    let body = ''

    if (nextState === 'waiting-approval') {
      title = lang === 'pt' ? `⚠️ Precisa de Aprovação · ${harness}${sessionName}` : `⚠️ Needs Approval · ${harness}${sessionName}`
      body = lang === 'pt'
        ? `A sessão em "${session?.project_path || sessionName}" está aguardando sua aprovação para continuar.`
        : `Session in "${session?.project_path || sessionName}" is waiting for your approval to proceed.`
    } else if (nextState === 'waiting') {
      title = lang === 'pt' ? `💬 Aguardando Resposta · ${harness}${sessionName}` : `💬 Waiting Response · ${harness}${sessionName}`
      body = lang === 'pt'
        ? `A IA concluiu a resposta e está aguardando seu próximo comando.`
        : `The AI finished its turn and is waiting for your input.`
    } else if (nextState === 'working') {
      title = lang === 'pt' ? `⚡ Trabalhando · ${harness}${sessionName}` : `⚡ Working · ${harness}${sessionName}`
      body = lang === 'pt'
        ? `A sessão iniciou o processamento.`
        : `Session started working.`
    } else if (nextState === 'exited') {
      title = lang === 'pt' ? `⏹️ Sessão Finalizada · ${harness}${sessionName}` : `⏹️ Session Closed · ${harness}${sessionName}`
      body = lang === 'pt'
        ? `A sessão em "${session?.project_path || sessionName}" foi encerrada.`
        : `Session in "${session?.project_path || sessionName}" exited.`
    }

    if (title && body) {
      triggerSessionNotification({
        title,
        body,
        tag: `session-${id}`,
      })
    }
  }
}
