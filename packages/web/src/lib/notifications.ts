import { useSyncExternalStore } from 'react'

export type NotificationType = 'error' | 'warning' | 'info' | 'success'

export interface AppNotification {
  id: string
  type: NotificationType
  /** Localization code — when set, the title/message are resolved at render time
   *  from NOTIFICATION_TEXT so they follow the language toggle. */
  code?: string
  /** Interpolation values for the localized copy (e.g. an HTTP status). */
  meta?: Record<string, unknown>
  /** Raw pre-localized strings — used as a fallback when there is no `code`. */
  title?: string
  message?: string
  ts: number
  read: boolean
}

type Localized = { title: string; message?: string }

/** Localized copy for server- and client-emitted notification codes. Resolved at
 *  render time by resolveNotification so switching the language re-translates. */
export const NOTIFICATION_TEXT: Record<string, { pt: Localized; en: Localized }> = {
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
  'member.removed': {
    pt: { title: 'Removido da central', message: 'A central revogou o acesso desta máquina. O modo de time foi redefinido para individual — gere um novo token na central para reconectar.' },
    en: { title: 'Removed from the central', message: 'The central revoked this machine’s access. Team mode was reset to solo — mint a new token on the central to reconnect.' },
  },
  'central.connect_failed': {
    pt: { title: 'Falha ao conectar na central', message: 'Não foi possível conectar na central. Verifique o endereço e o token.' },
    en: { title: 'Failed to connect to the central', message: 'Couldn’t connect to the central. Check the endpoint and token.' },
  },
  'central.token_unrecognized': {
    pt: { title: 'Token não reconhecido', message: 'A central não reconheceu este token. Gere um token para esta máquina no Team Manager da central.' },
    en: { title: 'Token not recognized', message: "The central didn't recognize this token. Mint a token for this machine in the central's Team Manager." },
  },
  'central.member_connected': {
    pt: { title: 'Máquina conectada', message: '{user} conectou à central.' },
    en: { title: 'Machine connected', message: '{user} connected to the central.' },
  },
}

/** Resolve a notification to display strings in the CURRENT language. Localizes by
 *  `code` (interpolating `meta`, e.g. an HTTP status) and falls back to the raw
 *  title/message baked in at creation time. */
export function resolveNotification(n: AppNotification, lang: 'pt' | 'en'): Localized {
  const loc = n.code ? NOTIFICATION_TEXT[n.code]?.[lang] : undefined
  const title = loc?.title ?? n.title ?? ''
  let message = loc?.message ?? n.message
  // Interpolate {user} from meta (e.g. "{user} connected to the central").
  if (message && n.meta?.user) {
    message = message.replace('{user}', String(n.meta.user))
  }
  // Append the HTTP status to the auth-rejected message when the central provided one.
  if (n.code === 'member.auth_rejected' && n.meta?.status && message) {
    message = `${message} (HTTP ${n.meta.status})`
  }
  return { title, message }
}

const MAX_ITEMS = 50

// External store — a single immutable array reference that changes on every mutation,
// so useSyncExternalStore re-renders subscribers without extra bookkeeping.
let items: AppNotification[] = []
const listeners = new Set<() => void>()

function emit() {
  for (const l of listeners) l()
}

let seq = 0
function nextId(): string {
  seq += 1
  return `n${Date.now().toString(36)}-${seq}`
}

/** Add a notification (newest first). De-dupes an identical still-unread notification
 *  (same code+meta, or same raw title+message) so a repeating error doesn't stack —
 *  it just refreshes the timestamp. Pass a `code` for render-time i18n, or raw
 *  title/message for already-localized copy. */
export function pushNotification(n: {
  type: NotificationType
  code?: string
  meta?: Record<string, unknown>
  title?: string
  message?: string
}): void {
  const now = Date.now()
  const key = (x: { code?: string; meta?: Record<string, unknown>; title?: string; message?: string }) =>
    x.code
      ? `c:${x.code}:${JSON.stringify(x.meta ?? {})}`
      : `t:${x.title ?? ''}:${x.message ?? ''}`
  const nKey = key(n)
  const dupe = items.find(x => !x.read && key(x) === nKey)
  if (dupe) {
    items = [{ ...dupe, ts: now }, ...items.filter(x => x.id !== dupe.id)]
  } else {
    items = [{ id: nextId(), ts: now, read: false, ...n }, ...items].slice(0, MAX_ITEMS)
  }
  emit()
}

export function markAllRead(): void {
  if (!items.some(x => !x.read)) return
  items = items.map(x => (x.read ? x : { ...x, read: true }))
  emit()
}

export function dismissNotification(id: string): void {
  const next = items.filter(x => x.id !== id)
  if (next.length !== items.length) { items = next; emit() }
}

export function clearNotifications(): void {
  if (items.length === 0) return
  items = []
  emit()
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb)
  return () => listeners.delete(cb)
}

/** Reactive list of notifications (newest first). */
export function useNotifications(): AppNotification[] {
  return useSyncExternalStore(subscribe, () => items, () => items)
}
