import { test, expect } from 'bun:test'
import {
  capChats, createSessionScratch, draftKey, parseAttachments, MAX_CACHED_CHATS,
  type CachedChat, type ScratchStore,
} from './sessionScratch'

function fakeStore(opts: { throwOn?: 'get' | 'set' | 'remove' } = {}): ScratchStore & { data: Map<string, string> } {
  const data = new Map<string, string>()
  return {
    data,
    getItem(k) { if (opts.throwOn === 'get') throw new Error('blocked'); return data.get(k) ?? null },
    setItem(k, v) { if (opts.throwOn === 'set') throw new Error('quota'); data.set(k, v) },
    removeItem(k) { if (opts.throwOn === 'remove') throw new Error('blocked'); data.delete(k) },
  }
}

const chat = (n: number): CachedChat => ({ turns: Array.from({ length: n }, (_, i) => i), live: true })

test('a draft survives leaving the session and coming back', () => {
  const s = createSessionScratch(fakeStore())
  s.writeDraft('a', 'meio prompt escrito')
  expect(s.readDraft('a')).toBe('meio prompt escrito')
})

test('drafts never leak between sessions', () => {
  const s = createSessionScratch(fakeStore())
  s.writeDraft('a', 'for a')
  expect(s.readDraft('b')).toBe('')
})

test('an empty draft is REMOVED, so "cleared" and "never typed" stay one answer', () => {
  const store = fakeStore()
  const s = createSessionScratch(store)
  s.writeDraft('a', 'x')
  expect(store.data.has(draftKey('a'))).toBe(true)
  s.writeDraft('a', '')
  expect(store.data.has(draftKey('a'))).toBe(false)
  expect(s.readDraft('a')).toBe('')
})

test('storage that THROWS still keeps the draft across a navigation', () => {
  // The component unmounts and remounts; this module does not. Less durable than storage, never
  // a field that eats what was typed.
  for (const throwOn of ['get', 'set', 'remove'] as const) {
    const s = createSessionScratch(fakeStore({ throwOn }))
    s.writeDraft('a', 'sobrevive')
    expect(s.readDraft('a')).toBe('sobrevive')
  }
})

test('no storage at all still keeps the draft in memory', () => {
  const s = createSessionScratch(null)
  s.writeDraft('a', 'sem storage')
  expect(s.readDraft('a')).toBe('sem storage')
  s.clearDraft('a')
  expect(s.readDraft('a')).toBe('')
})

test('a cached conversation is returned for its OWN id and no other', () => {
  const s = createSessionScratch(fakeStore())
  s.writeChat('a', chat(3))
  expect(s.readChat('a')?.turns).toHaveLength(3)
  expect(s.readChat('b')).toBeNull()
})

test('conversations are capped, and the OLDEST TOUCHED is what goes', () => {
  let m = new Map<string, CachedChat>()
  for (let i = 0; i < MAX_CACHED_CHATS; i++) m = capChats(m, `s${i}`, chat(1))
  // Touch the oldest so it is no longer the oldest.
  m = capChats(m, 's0', chat(2))
  m = capChats(m, 'new', chat(1))
  expect(m.size).toBe(MAX_CACHED_CHATS)
  expect(m.has('s0')).toBe(true)   // re-inserted, so kept
  expect(m.has('s1')).toBe(false)  // now the least recently used
  expect(m.has('new')).toBe(true)
})

test('capChats never mutates what it was given', () => {
  const before = new Map<string, CachedChat>([['a', chat(1)]])
  const after = capChats(before, 'b', chat(1))
  expect(before.size).toBe(1)
  expect(after.size).toBe(2)
})

test('re-writing one id replaces it rather than growing the map', () => {
  let m = new Map<string, CachedChat>()
  m = capChats(m, 'a', chat(1))
  m = capChats(m, 'a', chat(9))
  expect(m.size).toBe(1)
  expect(m.get('a')?.turns).toHaveLength(9)
})

test('attachments survive with the draft — a half-restore is what was reported', () => {
  const s = createSessionScratch(fakeStore())
  s.writeDraft('a', 'olha essa imagem')
  s.writeAttachments('a', [{ name: 'print.png', path: '/tmp/print.png' }])
  expect(s.readDraft('a')).toBe('olha essa imagem')
  expect(s.readAttachments('a')).toEqual([{ name: 'print.png', path: '/tmp/print.png' }])
})

test('attachments never leak between sessions, and an empty list is removed', () => {
  const store = fakeStore()
  const s = createSessionScratch(store)
  s.writeAttachments('a', [{ name: 'x', path: '/x' }])
  expect(s.readAttachments('b')).toEqual([])
  s.writeAttachments('a', [])
  expect(s.readAttachments('a')).toEqual([])
  expect([...store.data.keys()].some(k => k.includes('attached'))).toBe(false)
})

test('a half-read stored entry is DROPPED, never offered as a path that resolves to nothing', () => {
  expect(parseAttachments(null)).toEqual([])
  expect(parseAttachments('not json')).toEqual([])
  expect(parseAttachments('{"not":"an array"}')).toEqual([])
  expect(parseAttachments('[{"name":"ok","path":"/p"},{"name":"no path"},{"path":"/q"},null,{"name":"","path":"/r"}]'))
    .toEqual([{ name: 'ok', path: '/p' }])
})

test('storage that throws still keeps attachments across a navigation', () => {
  for (const throwOn of ['get', 'set', 'remove'] as const) {
    const s = createSessionScratch(fakeStore({ throwOn }))
    s.writeAttachments('a', [{ name: 'n', path: '/p' }])
    expect(s.readAttachments('a')).toEqual([{ name: 'n', path: '/p' }])
  }
})
