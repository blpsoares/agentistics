import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createSessionRegistry, newSessionId } from './registry'

let dir = ''
let file = ''

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'agentistics-registry-'))
  file = join(dir, 'managed-sessions.json')
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

const session = (id: string) => ({
  id, harness: 'claude' as const, cwd: '/tmp', createdAt: '2026-08-12T10:00:00.000Z',
})

describe('createSessionRegistry', () => {
  it('starts empty and never throws on a missing file', async () => {
    expect(await createSessionRegistry(file).read()).toEqual([])
  })

  it('starts empty and never throws on a corrupt file', async () => {
    await writeFile(file, '{ this is not json', 'utf-8')
    expect(await createSessionRegistry(file).read()).toEqual([])
  })

  it('round-trips an added session', async () => {
    const r = createSessionRegistry(file)
    await r.add(session('a1'))
    expect(await r.read()).toEqual([session('a1')])
  })

  it('replaces rather than duplicates when the same id is added twice', async () => {
    const r = createSessionRegistry(file)
    await r.add(session('a1'))
    await r.add({ ...session('a1'), cwd: '/srv' })
    const list = await r.read()
    expect(list).toHaveLength(1)
    expect(list[0]!.cwd).toBe('/srv')
  })

  it('patches a label and a note without touching the rest', async () => {
    const r = createSessionRegistry(file)
    await r.add(session('a1'))
    expect(await r.patch('a1', { label: 'refactor auth', note: 'split the god object' })).toBe(true)
    const [s] = await r.read()
    expect(s!.label).toBe('refactor auth')
    expect(s!.note).toBe('split the god object')
    expect(s!.harness).toBe('claude')
  })

  it('reports a patch of an unknown id rather than silently succeeding', async () => {
    expect(await createSessionRegistry(file).patch('nope', { label: 'x' })).toBe(false)
  })

  it('removes a session', async () => {
    const r = createSessionRegistry(file)
    await r.add(session('a1'))
    await r.remove('a1')
    expect(await r.read()).toEqual([])
  })

  it('serializes concurrent adds so a read-modify-write race cannot drop one', async () => {
    const r = createSessionRegistry(file)
    const ids = Array.from({ length: 10 }, (_, i) => `c${i}`)
    await Promise.all(ids.map(id => r.add(session(id))))
    const list = await r.read()
    expect(list.map(s => s.id).sort()).toEqual([...ids].sort())
  })
})

describe('newSessionId', () => {
  it('mints ids that are unique and safe as a tmux session name', () => {
    const ids = new Set(Array.from({ length: 200 }, () => newSessionId()))
    expect(ids.size).toBe(200)
    // tmux treats `.` and `:` as target separators, so the id must contain neither.
    for (const id of ids) expect(id).toMatch(/^[a-z0-9]{10}$/)
  })
})
