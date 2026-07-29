import { useEffect } from 'react'
import { refreshNotifications, type NotificationType } from '../lib/notifications'

interface ServerNotification {
  type?: NotificationType
  code?: string
  meta?: Record<string, unknown>
  title?: string
  message?: string
}

/**
 * Loads the notification history from the server on mount, then subscribes to the SSE
 * `notification` events and re-reads it whenever one arrives.
 *
 * The client does NOT write what it receives here: `broadcastNotification` already persisted the
 * notification server-side before emitting it, so re-posting it from every open tab would be a
 * duplicate write and would mint ids the other devices don't share. Reading back keeps one row
 * per event, with the server's id, dismissible from any device.
 *
 * Localization still happens at RENDER time (resolveNotification) from the stored `code` + `meta`,
 * so the text follows the language toggle even for notifications received long ago.
 */
export function useNotificationStream(_lang: 'pt' | 'en'): void {
  useEffect(() => {
    void refreshNotifications()
    const es = new EventSource('/api/events')
    const handler = (e: MessageEvent) => {
      let n: ServerNotification = {}
      try { n = JSON.parse(e.data) as ServerNotification } catch { return }
      // Require either a code (localized at render) or a raw title.
      if (!n.code && !n.title) return
      void refreshNotifications()
    }
    es.addEventListener('notification', handler as EventListener)
    es.onerror = () => { /* browser auto-reconnects */ }
    return () => { es.removeEventListener('notification', handler as EventListener); es.close() }
  }, [])
}
