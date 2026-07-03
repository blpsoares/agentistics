import { useEffect } from 'react'
import { pushNotification, type NotificationType } from '../lib/notifications'

interface ServerNotification {
  type?: NotificationType
  code?: string
  meta?: Record<string, unknown>
  title?: string
  message?: string
}

/**
 * Subscribe to the server's SSE `notification` events and surface them via the store.
 * The member's uploader emits these on connection/auth errors (and recovery). We push
 * the raw `{ type, code, meta }` — localization happens at RENDER time (resolveNotification)
 * so the text follows the language toggle even after the notification was created. Unknown
 * codes fall back to any raw title/message in the payload.
 */
export function useNotificationStream(_lang: 'pt' | 'en'): void {
  useEffect(() => {
    const es = new EventSource('/api/events')
    const handler = (e: MessageEvent) => {
      let n: ServerNotification = {}
      try { n = JSON.parse(e.data) as ServerNotification } catch { return }
      // Require either a code (localized at render) or a raw title.
      if (!n.code && !n.title) return
      pushNotification({ type: n.type ?? 'info', code: n.code, meta: n.meta, title: n.title, message: n.message })
    }
    es.addEventListener('notification', handler as EventListener)
    es.onerror = () => { /* browser auto-reconnects */ }
    return () => { es.removeEventListener('notification', handler as EventListener); es.close() }
  }, [])
}
