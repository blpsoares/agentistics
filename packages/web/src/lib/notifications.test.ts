import { beforeEach, describe, expect, test } from 'bun:test'
import type { AppNotification } from './notifications'

/**
 * The client store is a CACHE over /api/notifications — the server owns the history. These tests
 * stub `fetch` to assert the wire contract and the optimistic updates. No localStorage is involved
 * BY DESIGN: a per-browser store shows an empty bell when the same user opens the dashboard on
 * their phone, which is the bug this store exists to avoid.
 *
 * The module is re-imported per test (cache-busting query) so its module-level cache starts clean.
 */
interface Call { url: string; method: string; body?: unknown }

let calls: Call[] = []
let respond: (c: Call) => unknown = () => []

function stubFetch() {
  calls = []
  ;(globalThis as unknown as { fetch: unknown }).fetch = async (url: string, init?: RequestInit) => {
    const call: Call = {
      url: String(url),
      method: init?.method ?? 'GET',
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    }
    calls.push(call)
    return { ok: true, json: async () => respond(call) } as unknown as Response
  }
}

let bust = 0
async function freshStore() {
  bust += 1
  return await import(`./notifications?t=${bust}`) as typeof import('./notifications')
}

const note = (id: string, over: Partial<AppNotification> = {}): AppNotification => ({
  id, type: 'info', code: `code-${id}`, ts: 1000, read: false, ...over,
})

beforeEach(() => { stubFetch(); respond = () => [] })

describe('loading from the server', () => {
  test('refresh pulls the history and fills the cache', async () => {
    respond = () => [note('a'), note('b')]
    const s = await freshStore()
    await s.refreshNotifications()
    expect(s.readNotifications().map(n => n.id)).toEqual(['a', 'b'])
    expect(calls[0]).toMatchObject({ url: '/api/notifications', method: 'GET' })
  })

  test('the same history reaches any device — nothing is browser-local', async () => {
    respond = () => [note('shared')]
    const desktop = await freshStore()
    const phone = await freshStore()
    await desktop.refreshNotifications()
    await phone.refreshNotifications()
    expect(desktop.readNotifications()[0]!.id).toBe('shared')
    expect(phone.readNotifications()[0]!.id).toBe('shared')
  })

  test('a malformed server payload is ignored rather than rendered', async () => {
    respond = () => ({ oops: true })
    const s = await freshStore()
    await s.refreshNotifications()
    expect(s.readNotifications()).toEqual([])
  })

  test('entries missing required fields are dropped', async () => {
    respond = () => [note('ok'), { id: 'bad' }, null]
    const s = await freshStore()
    await s.refreshNotifications()
    expect(s.readNotifications().map(n => n.id)).toEqual(['ok'])
  })

  test('a server that is down leaves the cache intact instead of throwing', async () => {
    respond = () => [note('a')]
    const s = await freshStore()
    await s.refreshNotifications()
    ;(globalThis as unknown as { fetch: unknown }).fetch = async () => { throw new Error('offline') }
    await s.refreshNotifications()
    expect(s.readNotifications().map(n => n.id)).toEqual(['a'])
  })
})

describe('writing through to the server', () => {
  test('pushing POSTs code+meta — never rendered text', async () => {
    const s = await freshStore()
    s.pushNotification({ type: 'info', code: 'app.update_available', meta: { version: '1.2.3' } })
    await Bun.sleep(1)
    expect(calls[0]).toMatchObject({
      url: '/api/notifications',
      method: 'POST',
      body: { type: 'info', code: 'app.update_available', meta: { version: '1.2.3' } },
    })
    expect(JSON.stringify(calls[0]!.body)).not.toContain('Atualização disponível')
  })

  test('the cache is replaced by the server response, so ids come from the server', async () => {
    respond = c => (c.method === 'POST' ? [note('server-minted')] : [])
    const s = await freshStore()
    s.pushNotification({ type: 'info', code: 'x' })
    await Bun.sleep(1)
    expect(s.readNotifications().map(n => n.id)).toEqual(['server-minted'])
  })

  test('dismissing one sends its id and drops it locally right away', async () => {
    respond = () => [note('a'), note('b')]
    const s = await freshStore()
    await s.refreshNotifications()

    respond = () => [note('b')]
    s.dismissNotification('a')
    // Optimistic: gone before the response lands.
    expect(s.readNotifications().map(n => n.id)).toEqual(['b'])
    await Bun.sleep(1)
    expect(calls.at(-1)).toMatchObject({ url: '/api/notifications?id=a', method: 'DELETE' })
    expect(s.readNotifications().map(n => n.id)).toEqual(['b'])
  })

  test('clear-all sends a DELETE with no id and empties the cache', async () => {
    respond = () => [note('a'), note('b')]
    const s = await freshStore()
    await s.refreshNotifications()

    respond = () => []
    s.clearNotifications()
    expect(s.readNotifications()).toEqual([])
    await Bun.sleep(1)
    expect(calls.at(-1)).toMatchObject({ url: '/api/notifications', method: 'DELETE' })
  })

  test('opening the bell PATCHes read state and clears the badge immediately', async () => {
    respond = () => [note('a'), note('b')]
    const s = await freshStore()
    await s.refreshNotifications()

    respond = () => [note('a', { read: true }), note('b', { read: true })]
    s.markAllRead()
    expect(s.readNotifications().every(n => n.read)).toBe(true)
    await Bun.sleep(1)
    expect(calls.at(-1)).toMatchObject({ url: '/api/notifications', method: 'PATCH' })
  })

  test('mark-all-read with nothing unread does not call the server', async () => {
    respond = () => [note('a', { read: true })]
    const s = await freshStore()
    await s.refreshNotifications()
    const before = calls.length
    s.markAllRead()
    await Bun.sleep(1)
    expect(calls.length).toBe(before)
  })
})

describe('localization', () => {
  test('a stored code+meta still resolves in the current language', async () => {
    const s = await freshStore()
    const n = note('a', { code: 'member.reconnected' })
    expect(s.resolveNotification(n, 'pt').title).toBe('Conectado à central')
    expect(s.resolveNotification(n, 'en').title).toBe('Connected to the central')
  })
})
