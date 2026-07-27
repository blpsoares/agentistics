import { test, expect } from 'bun:test'
import { join } from 'path'
import { tmpdir } from 'os'
import { mkdir, writeFile, readFile, readdir, stat } from 'node:fs/promises'
import { createLocalTagStore } from './tags-local-store'

// Tags used to be central-only because their only store was Mongo. A solo machine now persists them
// to ~/.agentistics/tags.json, so the file IS the behaviour under test — it runs against a real
// temp dir, never a mocked filesystem.

function tmpFile(): string {
  return join(tmpdir(), `agentistics-tags-${crypto.randomUUID()}`, 'tags.json')
}

test('starts empty when the file does not exist', async () => {
  const store = createLocalTagStore(tmpFile())
  expect(await store.listAllTags()).toEqual([])
  expect(await store.getTag('nope')).toBeNull()
})

test('create then read round-trips through the file', async () => {
  const file = tmpFile()
  const store = createLocalTagStore(file)
  const doc = await store.createTag({
    name: 'Client X', color: '#f59e0b',
    sources: [{ type: 'repo', value: 'github.com/org/repo' }],
    sharedWith: [], createdBy: 'local',
  })
  expect(doc._id).toMatch(/^[0-9a-f]{24}$/)

  // A SECOND store over the same path sees it — proof it went to disk, not just memory.
  const reopened = createLocalTagStore(file)
  const all = await reopened.listAllTags()
  expect(all).toHaveLength(1)
  expect(all[0]!.name).toBe('Client X')
  expect(all[0]!.sources).toEqual([{ type: 'repo', value: 'github.com/org/repo' }])
})

test('update patches only the given fields and bumps updatedAt', async () => {
  const store = createLocalTagStore(tmpFile())
  const doc = await store.createTag({
    name: 'A', color: '#ef4444', sources: [], sharedWith: ['acc1'], createdBy: 'local',
  })
  expect(await store.updateTag(doc._id, { name: 'B' })).toBe(true)
  const after = await store.getTag(doc._id)
  expect(after!.name).toBe('B')
  expect(after!.color).toBe('#ef4444')
  expect(after!.sharedWith).toEqual(['acc1'])
  expect(after!.createdAt).toBe(doc.createdAt)
  expect(Date.parse(after!.updatedAt)).toBeGreaterThanOrEqual(Date.parse(doc.updatedAt))
})

test('update of an unknown id reports false and changes nothing', async () => {
  const store = createLocalTagStore(tmpFile())
  await store.createTag({ name: 'A', sources: [], sharedWith: [], createdBy: 'local' })
  expect(await store.updateTag('missing', { name: 'B' })).toBe(false)
  expect((await store.listAllTags())[0]!.name).toBe('A')
})

test('delete removes the tag and is idempotent', async () => {
  const file = tmpFile()
  const store = createLocalTagStore(file)
  const doc = await store.createTag({ name: 'A', sources: [], sharedWith: [], createdBy: 'local' })
  expect(await store.deleteTag(doc._id)).toBe(true)
  expect(await store.deleteTag(doc._id)).toBe(false)
  expect(await createLocalTagStore(file).listAllTags()).toEqual([])
})

test('concurrent creates are serialised — none is lost', async () => {
  const file = tmpFile()
  const store = createLocalTagStore(file)
  await Promise.all(['a', 'b', 'c', 'd', 'e'].map(n =>
    store.createTag({ name: n, sources: [], sharedWith: [], createdBy: 'local' })))
  const all = await createLocalTagStore(file).listAllTags()
  expect(all.map(t => t.name)).toEqual(['a', 'b', 'c', 'd', 'e'])
})

test('a corrupt file reads as empty instead of throwing, and stays recoverable', async () => {
  const file = tmpFile()
  await mkdir(join(file, '..'), { recursive: true })
  await writeFile(file, '{ this is not json')
  const store = createLocalTagStore(file)
  expect(await store.listAllTags()).toEqual([])
  // The bad bytes are still on disk until something is written, so nothing is silently destroyed.
  expect(await readFile(file, 'utf8')).toBe('{ this is not json')
})

// Regression: reading a corrupt file empty and then writing over it destroyed every tag that was
// still in there. "Create a tag, see an empty list, create another" is exactly that path, so the
// first write after a parse failure must move the original bytes aside rather than replace them.
test('the first write after a parse failure preserves the corrupt bytes in a backup', async () => {
  const file = tmpFile()
  const dir = join(file, '..')
  await mkdir(dir, { recursive: true })
  await writeFile(file, '{ "version": 1, "tags": [ TRUNCATED')

  const store = createLocalTagStore(file)
  expect(await store.listAllTags()).toEqual([])
  await store.createTag({ name: 'New', sources: [], sharedWith: [], createdBy: 'local' })

  // The new tag landed...
  expect((await createLocalTagStore(file).listAllTags()).map(t => t.name)).toEqual(['New'])
  // ...and the unreadable original survives beside it, byte for byte.
  const backups = (await readdir(dir)).filter(f => f.startsWith('tags.json.corrupt-'))
  expect(backups).toHaveLength(1)
  expect(await readFile(join(dir, backups[0]!), 'utf8')).toBe('{ "version": 1, "tags": [ TRUNCATED')
})

// Regression: a mutation that matched nothing still rewrote the file, which on a corrupt store meant
// a no-op could destroy data. An unknown id must not touch the file at all.
test('update/delete of an unknown id does not rewrite the file', async () => {
  const file = tmpFile()
  const store = createLocalTagStore(file)
  await store.createTag({ name: 'A', sources: [], sharedWith: [], createdBy: 'local' })

  const before = await stat(file)
  // mtime has 1ms resolution at best; wait so a real write would be visible.
  await new Promise(r => setTimeout(r, 20))
  expect(await store.updateTag('missing', { name: 'B' })).toBe(false)
  expect(await store.deleteTag('missing')).toBe(false)

  const after = await stat(file)
  expect(after.mtimeMs).toBe(before.mtimeMs)
  expect((await createLocalTagStore(file).listAllTags()).map(t => t.name)).toEqual(['A'])
})

// A file that parses but whose `tags` is not a list is unrecognisable too — same protection.
test('a non-array tags field is treated as corrupt and backed up, not overwritten', async () => {
  const file = tmpFile()
  const dir = join(file, '..')
  await mkdir(dir, { recursive: true })
  await writeFile(file, '{"version":1,"tags":"oops"}')

  const store = createLocalTagStore(file)
  expect(await store.listAllTags()).toEqual([])
  await store.createTag({ name: 'New', sources: [], sharedWith: [], createdBy: 'local' })

  const backups = (await readdir(dir)).filter(f => f.startsWith('tags.json.corrupt-'))
  expect(backups).toHaveLength(1)
  expect(await readFile(join(dir, backups[0]!), 'utf8')).toBe('{"version":1,"tags":"oops"}')
})

// The quarantine must fire once, not on every subsequent write.
test('later writes after a recovery do not keep making backups', async () => {
  const file = tmpFile()
  const dir = join(file, '..')
  await mkdir(dir, { recursive: true })
  await writeFile(file, 'not json at all')

  const store = createLocalTagStore(file)
  await store.createTag({ name: 'A', sources: [], sharedWith: [], createdBy: 'local' })
  await store.createTag({ name: 'B', sources: [], sharedWith: [], createdBy: 'local' })
  await store.createTag({ name: 'C', sources: [], sharedWith: [], createdBy: 'local' })

  expect((await readdir(dir)).filter(f => f.startsWith('tags.json.corrupt-'))).toHaveLength(1)
  expect((await createLocalTagStore(file).listAllTags()).map(t => t.name)).toEqual(['A', 'B', 'C'])
})

test('an empty file reads as empty', async () => {
  const file = tmpFile()
  await mkdir(join(file, '..'), { recursive: true })
  await writeFile(file, '')
  expect(await createLocalTagStore(file).listAllTags()).toEqual([])
})

test('garbage entries are dropped, valid ones survive', async () => {
  const file = tmpFile()
  await mkdir(join(file, '..'), { recursive: true })
  await writeFile(file, JSON.stringify({
    version: 1,
    tags: [
      null,
      { name: 'no id' },
      { _id: 'x', name: 'Good', sources: [{ type: 'project', value: '/p' }, 'junk'], sharedWith: ['a', 2], createdBy: 'local', createdAt: 'c', updatedAt: 'u' },
    ],
  }))
  const all = await createLocalTagStore(file).listAllTags()
  expect(all).toHaveLength(1)
  expect(all[0]!.sources).toEqual([{ type: 'project', value: '/p' }])
  expect(all[0]!.sharedWith).toEqual(['a'])
})

test('visibleTagsFor applies the caller predicate', async () => {
  const store = createLocalTagStore(tmpFile())
  await store.createTag({ name: 'mine', sources: [], sharedWith: [], createdBy: 'local' })
  await store.createTag({ name: 'theirs', sources: [], sharedWith: [], createdBy: 'someone' })
  const visible = await store.visibleTagsFor(t => t.createdBy === 'local')
  expect(visible.map(t => t.name)).toEqual(['mine'])
})
