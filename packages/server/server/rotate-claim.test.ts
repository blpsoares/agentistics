/**
 * rotate-claim.test.ts — a token rotation must produce ONE machine, whatever the click count.
 *
 * The regression: `rotateToken` read the old token doc, migrated everything, and only THEN wrote
 * the new doc and deleted the old one. Two rotations of the same machine overlapping (the Rotate
 * button had no confirm and no in-flight guard, so a double-click sent two) both found the old doc
 * and both inserted their own replacement — one machine became two, and the extra one owned no
 * sessions and no token anybody held. Twenty clicks, twenty machines.
 *
 * `claimRotation` moves the id swap to the FRONT and makes it a race exactly one caller can win.
 */

import { describe, expect, test } from 'bun:test'
import { claimRotation, type RotationClaimStore } from './rotate-claim'

interface Doc { _id: string; label: string; teamIds?: string[] }

/** An in-memory stand-in for the tokens collection. Every method awaits before touching the map,
 *  so two concurrent claims genuinely interleave — and `takeIfPresent`'s read+delete run in one
 *  synchronous step afterwards, which is the atomicity Mongo's `findOneAndDelete` provides. */
function fakeStore(initial: Doc[]) {
  const docs = new Map(initial.map(d => [d._id, d]))
  const store: RotationClaimStore<Doc> = {
    async findOne(id) { await Promise.resolve(); return docs.get(id) ?? null },
    async insert(doc) {
      await Promise.resolve()
      if (docs.has(doc._id)) throw new Error(`duplicate key: ${doc._id}`)
      docs.set(doc._id, doc)
    },
    async takeIfPresent(id) {
      await Promise.resolve()
      const found = docs.get(id)
      if (!found) return null
      docs.delete(id)
      return found
    },
    async remove(id) { await Promise.resolve(); docs.delete(id) },
  }
  return { store, docs }
}

const MACHINE: Doc = { _id: 'old', label: "Alice's laptop", teamIds: ['t1'] }

describe('claimRotation', () => {
  test('a single rotation replaces the doc under the new id, keeping its metadata', async () => {
    const { store, docs } = fakeStore([MACHINE])
    const claim = await claimRotation(store, 'old', 'new')
    expect(claim.won).toBe(true)
    if (!claim.won) return
    expect(claim.doc).toEqual({ _id: 'new', label: "Alice's laptop", teamIds: ['t1'] })
    expect([...docs.keys()]).toEqual(['new'])
  })

  test('TWO concurrent rotations of the same machine leave exactly ONE machine', async () => {
    const { store, docs } = fakeStore([MACHINE])
    const [a, b] = await Promise.all([
      claimRotation(store, 'old', 'newA'),
      claimRotation(store, 'old', 'newB'),
    ])
    expect([a.won, b.won].filter(Boolean)).toHaveLength(1)
    expect(docs.size).toBe(1)
    const winner = a.won ? 'newA' : 'newB'
    expect([...docs.keys()]).toEqual([winner])
  })

  test('twenty concurrent rotations still leave exactly one machine — the reported symptom', async () => {
    const { store, docs } = fakeStore([MACHINE])
    const claims = await Promise.all(
      Array.from({ length: 20 }, (_, i) => claimRotation(store, 'old', `new${i}`)),
    )
    expect(claims.filter(c => c.won)).toHaveLength(1)
    expect(docs.size).toBe(1)
  })

  test('the loser leaves NOTHING behind — its own replacement is rolled back', async () => {
    const { store, docs } = fakeStore([MACHINE])
    const [a, b] = await Promise.all([
      claimRotation(store, 'old', 'newA'),
      claimRotation(store, 'old', 'newB'),
    ])
    const loser = a.won ? 'newB' : 'newA'
    expect(docs.has(loser)).toBe(false)
  })

  test('rotating an id that no longer exists loses, and writes nothing', async () => {
    const { store, docs } = fakeStore([MACHINE])
    const claim = await claimRotation(store, 'gone', 'new')
    expect(claim.won).toBe(false)
    expect([...docs.keys()]).toEqual(['old'])
  })

  test('a second, SEQUENTIAL rotation of an already-rotated id loses — the stale row in a list', async () => {
    const { store, docs } = fakeStore([MACHINE])
    await claimRotation(store, 'old', 'new1')
    const again = await claimRotation(store, 'old', 'new2')
    expect(again.won).toBe(false)
    expect([...docs.keys()]).toEqual(['new1'])
  })

  test('the machine is never absent between the two writes — a crash cannot lose it', async () => {
    // The insert happens BEFORE the old doc is taken, so at every observable moment at least one
    // row exists for this machine. The opposite order (take, then insert) has a window where a
    // crash leaves a machine with no token doc at all — unrecoverable, where a duplicate is not.
    const { store, docs } = fakeStore([MACHINE])
    const seen: number[] = []
    const watched: RotationClaimStore<Doc> = {
      findOne: id => store.findOne(id),
      async insert(doc) { await store.insert(doc); seen.push(docs.size) },
      async takeIfPresent(id) { const r = await store.takeIfPresent(id); seen.push(docs.size); return r },
      remove: id => store.remove(id),
    }
    await claimRotation(watched, 'old', 'new')
    expect(seen.every(n => n >= 1)).toBe(true)
  })
})
