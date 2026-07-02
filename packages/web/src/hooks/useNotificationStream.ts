import { useEffect } from 'react'
import { pushNotification, type NotificationType } from '../lib/notifications'

interface ServerNotification {
  type?: NotificationType
  code?: string
  meta?: Record<string, unknown>
  title?: string
  message?: string
}

// Localized text for server-emitted notification codes. Unknown codes fall back to
// the payload's raw title/message (if any).
const TEXT: Record<string, { pt: { title: string; message: string }; en: { title: string; message: string } }> = {
  'member.auth_rejected': {
    pt: { title: 'Central rejeitou esta máquina', message: 'A central respondeu não autorizado — o token pode ser inválido ou revogado. Gere um novo no Team Manager da central.' },
    en: { title: 'Central rejected this machine', message: 'The central returned unauthorized — the token may be invalid or revoked. Mint a new one in the central’s Team Manager.' },
  },
  'member.unreachable': {
    pt: { title: 'Sem conexão com a central', message: 'Não foi possível alcançar a central; tentando novamente em segundo plano.' },
    en: { title: 'Can’t reach the central', message: 'Couldn’t reach the central; retrying in the background.' },
  },
  'member.reconnected': {
    pt: { title: 'Conectado à central', message: 'Os envios voltaram a funcionar.' },
    en: { title: 'Connected to the central', message: 'Pushes are working again.' },
  },
}

/**
 * Subscribe to the server's SSE `notification` events and surface them via the store.
 * The member's uploader emits these on connection/auth errors (and recovery), localized
 * here by `code` so the person setting up the machine sees a toast + bell entry.
 */
export function useNotificationStream(lang: 'pt' | 'en'): void {
  useEffect(() => {
    const es = new EventSource('/api/events')
    const handler = (e: MessageEvent) => {
      let n: ServerNotification = {}
      try { n = JSON.parse(e.data) as ServerNotification } catch { return }

      const loc = n.code ? TEXT[n.code]?.[lang] : undefined
      const title = loc?.title ?? n.title
      if (!title) return
      let message = loc?.message ?? n.message
      // Interpolate a status code into the auth message when present.
      if (n.code === 'member.auth_rejected' && n.meta?.status) {
        message = `${message} (HTTP ${n.meta.status})`
      }
      pushNotification({ type: n.type ?? 'info', title, message })
    }
    es.addEventListener('notification', handler as EventListener)
    es.onerror = () => { /* browser auto-reconnects */ }
    return () => { es.removeEventListener('notification', handler as EventListener); es.close() }
  }, [lang])
}
