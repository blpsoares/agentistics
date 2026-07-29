import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtemp, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  readNotificationsFrom, addNotificationTo, markAllReadIn, dismissNotificationIn,
  clearNotificationsIn, listNotificationsFor, localViewer, MAX_ITEMS, type Viewer,
} from './notifications-store'

/** A central account: per-account read/dismiss state. */
const account = (id: string, canSeeNames = true): Viewer => ({ id, canSeeNames, multiTenant: true })
const alice = account('acct-alice')
const bob = account('acct-bob')
/** A plain user on a central: may not see who else uses the instance. */
const plain = account('acct-plain', false)

let dir = ''
let file = ''

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'agentistics-notifications-'))
  file = join(dir, 'notifications.json')
})
afterEach(async () => { await rm(dir, { recursive: true, force: true }) })

describe('reading', () => {
  test('a missing file is an empty history, not an error', async () => {
    expect(await readNotificationsFrom(file)).toEqual([])
  })

  test('a corrupt file degrades to empty instead of throwing', async () => {
    await writeFile(file, '{not json')
    expect(await readNotificationsFrom(file)).toEqual([])
  })

  test('entries missing required fields are dropped, valid ones kept', async () => {
    await writeFile(file, JSON.stringify({
      version: 1,
      items: [
        { id: 'ok', ts: 2, type: 'info', code: 'a', read: false },
        { id: 'no-ts', type: 'info' },
        null,
        'garbage',
      ],
    }))
    expect((await readNotificationsFrom(file)).map(n => n.id)).toEqual(['ok'])
  })

  test('newest first, regardless of the order on disk', async () => {
    await writeFile(file, JSON.stringify({
      version: 1,
      items: [
        { id: 'old', ts: 1, type: 'info', read: false },
        { id: 'new', ts: 9, type: 'info', read: false },
      ],
    }))
    expect((await readNotificationsFrom(file)).map(n => n.id)).toEqual(['new', 'old'])
  })
})

describe('adding', () => {
  test('a notification survives being written and read back', async () => {
    await addNotificationTo(file, { type: 'error', code: 'member.removed' })
    const items = await readNotificationsFrom(file)
    expect(items).toHaveLength(1)
    expect(items[0]!.code).toBe('member.removed')
    expect(items[0]!.readBy).toEqual([])
  })

  test('only code+meta are stored — never rendered text, so the language stays switchable', async () => {
    await addNotificationTo(file, { type: 'info', code: 'member.reconnected' })
    const raw = await Bun.file(file).text()
    expect(raw).not.toContain('Conectado à central')
    expect(raw).not.toContain('Connected to the central')
    expect(raw).toContain('member.reconnected')
  })

  test('a repeat of something already in the history updates it instead of adding a copy', async () => {
    // app.update_available re-fires on every page load of an outdated machine, from every device.
    await addNotificationTo(file, { type: 'info', code: 'app.update_available', meta: { version: '1.2.3' } })
    await markAllReadIn(file)
    const after = await addNotificationTo(file, { type: 'info', code: 'app.update_available', meta: { version: '1.2.3' } })
    expect(after).toHaveLength(1)
    // A real re-occurrence is still surfaced: the row goes back to unread.
    expect(after[0]!.read).toBe(false)
  })

  test('different meta is a different notification', async () => {
    await addNotificationTo(file, { type: 'info', code: 'app.update_available', meta: { version: '1.2.3' } })
    const after = await addNotificationTo(file, { type: 'info', code: 'app.update_available', meta: { version: '1.2.4' } })
    expect(after).toHaveLength(2)
  })

  test('the history is capped so it cannot grow without limit', async () => {
    for (let i = 0; i < MAX_ITEMS + 15; i++) {
      await addNotificationTo(file, { type: 'info', code: `code-${i}` })
    }
    const items = await readNotificationsFrom(file)
    expect(items).toHaveLength(MAX_ITEMS)
    // The newest survive.
    expect(items[0]!.code).toBe(`code-${MAX_ITEMS + 14}`)
  })
})

describe('clearing', () => {
  test('dismissing one leaves the others', async () => {
    await addNotificationTo(file, { type: 'info', code: 'a' })
    await addNotificationTo(file, { type: 'info', code: 'b' })
    await addNotificationTo(file, { type: 'info', code: 'c' })
    const b = (await readNotificationsFrom(file)).find(n => n.code === 'b')!

    const after = await dismissNotificationIn(file, b.id)

    expect(after.map(n => n.code)).toEqual(['c', 'a'])
    expect((await readNotificationsFrom(file)).map(n => n.code)).toEqual(['c', 'a'])
  })

  test('dismissing an unknown id is a no-op — two devices may dismiss the same row', async () => {
    await addNotificationTo(file, { type: 'info', code: 'a' })
    const after = await dismissNotificationIn(file, 'does-not-exist')
    expect(after).toHaveLength(1)
  })

  test('clear-all empties the stored file', async () => {
    await addNotificationTo(file, { type: 'info', code: 'a' })
    await clearNotificationsIn(file)
    expect(await readNotificationsFrom(file)).toEqual([])
  })

  test('a cleared history stays cleared — nothing resurrects it', async () => {
    await addNotificationTo(file, { type: 'info', code: 'a' })
    await clearNotificationsIn(file)
    expect(await readNotificationsFrom(file)).toEqual([])
    expect(await readNotificationsFrom(file)).toEqual([])
  })

  test('mark-all-read persists', async () => {
    await addNotificationTo(file, { type: 'info', code: 'a' })
    await markAllReadIn(file)
    expect((await listNotificationsFor(file, localViewer))[0]!.read).toBe(true)
  })
})

describe('concurrency', () => {
  test('simultaneous adds all land — no read-modify-write loses one', async () => {
    await Promise.all(
      Array.from({ length: 12 }, (_, i) => addNotificationTo(file, { type: 'info', code: `c${i}` })),
    )
    expect(await readNotificationsFrom(file)).toHaveLength(12)
  })

  test('two devices dismissing different rows at the same time: both deletions stick', async () => {
    for (const code of ['a', 'b', 'c']) await addNotificationTo(file, { type: 'info', code })
    const items = await readNotificationsFrom(file)
    const a = items.find(n => n.code === 'a')!
    const b = items.find(n => n.code === 'b')!

    await Promise.all([dismissNotificationIn(file, a.id), dismissNotificationIn(file, b.id)])

    expect((await readNotificationsFrom(file)).map(n => n.code)).toEqual(['c'])
  })

  test('a clear racing an add leaves a consistent list, never a corrupt file', async () => {
    for (const code of ['a', 'b']) await addNotificationTo(file, { type: 'info', code })
    await Promise.all([clearNotificationsIn(file), addNotificationTo(file, { type: 'info', code: 'c' })])
    const items = await readNotificationsFrom(file)
    // Either order is acceptable; what must hold is that the file is readable and bounded.
    expect(items.length).toBeLessThanOrEqual(1)
  })
})

describe('read state is per account', () => {
  test('one account reading does not clear another account\'s badge', async () => {
    await addNotificationTo(file, { type: 'info', code: 'a' })

    await markAllReadIn(file, alice)

    expect((await listNotificationsFor(file, alice))[0]!.read).toBe(true)
    expect((await listNotificationsFor(file, bob))[0]!.read).toBe(false)
  })

  test('the event is stored ONCE — per-account state never duplicates the row', async () => {
    await addNotificationTo(file, { type: 'info', code: 'a' })
    await markAllReadIn(file, alice)
    await markAllReadIn(file, bob)
    expect(await readNotificationsFrom(file)).toHaveLength(1)
  })

  test('a re-occurrence goes back to unread for EVERYONE, not just the reporter', async () => {
    await addNotificationTo(file, { type: 'error', code: 'member.unreachable' })
    await markAllReadIn(file, alice)
    await markAllReadIn(file, bob)

    await addNotificationTo(file, { type: 'error', code: 'member.unreachable' })

    expect((await listNotificationsFor(file, alice))[0]!.read).toBe(false)
    expect((await listNotificationsFor(file, bob))[0]!.read).toBe(false)
  })

  test('a machine with no accounts keeps working exactly as before', async () => {
    await addNotificationTo(file, { type: 'info', code: 'a' })
    expect((await listNotificationsFor(file, localViewer))[0]!.read).toBe(false)
    await markAllReadIn(file, localViewer)
    expect((await listNotificationsFor(file, localViewer))[0]!.read).toBe(true)
  })

  test('a legacy file written with the old per-instance flag migrates to the local viewer', async () => {
    await writeFile(file, JSON.stringify({
      version: 1,
      items: [{ id: 'old', ts: 5, type: 'info', code: 'a', read: true }],
    }))
    // The local user had read it...
    expect((await listNotificationsFor(file, localViewer))[0]!.read).toBe(true)
    // ...which never means "every account on a central has read it".
    expect((await listNotificationsFor(file, alice))[0]!.read).toBe(false)
  })
})

describe('dismissing is per account on a central', () => {
  test('one account dismissing hides it for them and leaves it for everyone else', async () => {
    await addNotificationTo(file, { type: 'info', code: 'a' })
    const id = (await readNotificationsFrom(file))[0]!.id

    await dismissNotificationIn(file, id, alice)

    expect(await listNotificationsFor(file, alice)).toHaveLength(0)
    expect(await listNotificationsFor(file, bob)).toHaveLength(1)
    // The row itself is untouched — hidden, not deleted.
    expect(await readNotificationsFrom(file)).toHaveLength(1)
  })

  test('on a single-user machine dismissing really deletes', async () => {
    await addNotificationTo(file, { type: 'info', code: 'a' })
    const id = (await readNotificationsFrom(file))[0]!.id

    await dismissNotificationIn(file, id, localViewer)

    expect(await readNotificationsFrom(file)).toHaveLength(0)
  })

  test('clear-all on a central is scoped to the caller', async () => {
    await addNotificationTo(file, { type: 'info', code: 'a' })
    await addNotificationTo(file, { type: 'info', code: 'b' })

    await clearNotificationsIn(file, alice)

    expect(await listNotificationsFor(file, alice)).toHaveLength(0)
    expect(await listNotificationsFor(file, bob)).toHaveLength(2)
  })

  test('clear-all never touches rows the caller cannot even see', async () => {
    await addNotificationTo(file, { type: 'info', code: 'central.member_connected', meta: { user: 'ana' } })
    await addNotificationTo(file, { type: 'info', code: 'app.update_available', meta: { version: '1' } })

    await clearNotificationsIn(file, plain)

    // `plain` only ever saw the update notice, so only that one is hidden for them...
    expect(await listNotificationsFor(file, plain)).toHaveLength(0)
    // ...and a manager's bell is untouched — including the row `plain` could not see.
    expect((await listNotificationsFor(file, alice)).map(n => n.code).sort())
      .toEqual(['app.update_available', 'central.member_connected'])
  })

  test('a dismissed row comes back when the event happens again', async () => {
    await addNotificationTo(file, { type: 'error', code: 'member.unreachable' })
    const id = (await readNotificationsFrom(file))[0]!.id
    await dismissNotificationIn(file, id, alice)
    expect(await listNotificationsFor(file, alice)).toHaveLength(0)

    await addNotificationTo(file, { type: 'error', code: 'member.unreachable' })

    expect(await listNotificationsFor(file, alice)).toHaveLength(1)
  })
})

describe('notifications that name a person', () => {
  test('a plain user never receives one', async () => {
    await addNotificationTo(file, { type: 'info', code: 'central.member_connected', meta: { user: 'ana' } })
    expect(await listNotificationsFor(file, plain)).toHaveLength(0)
  })

  test('the payload is withheld entirely, not redacted — no trace of the colleague', async () => {
    await addNotificationTo(file, { type: 'info', code: 'central.member_connected', meta: { user: 'ana' } })
    const seen = JSON.stringify(await listNotificationsFor(file, plain))
    expect(seen).not.toContain('ana')
    expect(seen).not.toContain('central.member_connected')
  })

  test('a manager/owner does receive it', async () => {
    await addNotificationTo(file, { type: 'info', code: 'central.member_connected', meta: { user: 'ana' } })
    expect(await listNotificationsFor(file, alice)).toHaveLength(1)
  })

  test('the rule covers every code that names somebody, not just member_connected', async () => {
    await addNotificationTo(file, { type: 'info', code: 'machine.renamed', meta: { name: 'x', actor: 'ana' } })
    await addNotificationTo(file, { type: 'info', code: 'machine.reassigned', meta: { account: 'bob', actor: 'ana' } })
    expect(await listNotificationsFor(file, plain)).toHaveLength(0)
    expect(await listNotificationsFor(file, alice)).toHaveLength(2)
  })

  test('notifications that name nobody reach everyone', async () => {
    await addNotificationTo(file, { type: 'info', code: 'app.update_available', meta: { version: '1.2.3' } })
    await addNotificationTo(file, { type: 'error', code: 'member.unreachable' })
    expect(await listNotificationsFor(file, plain)).toHaveLength(2)
  })

  test('a machine (no accounts) sees everything — nothing to hide from its own user', async () => {
    await addNotificationTo(file, { type: 'info', code: 'machine.renamed', meta: { name: 'x', actor: 'ana' } })
    expect(await listNotificationsFor(file, localViewer)).toHaveLength(1)
  })

  test('a plain user marking all read cannot mark a hidden row as read', async () => {
    await addNotificationTo(file, { type: 'info', code: 'central.member_connected', meta: { user: 'ana' } })
    await markAllReadIn(file, plain)
    // The manager's badge is untouched by someone who never saw the row.
    expect((await listNotificationsFor(file, alice))[0]!.read).toBe(false)
  })
})
