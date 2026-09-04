import { test, expect } from 'bun:test'
import { isDoc, liveEvents } from './artifactTabs'

test('a document is decided by extension or by a known name', () => {
  for (const p of ['docs/spec.md', 'a/b/NOTES.txt', 'README', 'CHANGELOG.md', 'x/plan.mdx']) {
    expect(isDoc(p), p).toBe(true)
  }
})

test('code is not a document, however its path reads', () => {
  // Deciding "is this a spec" from a path's WORDS would file this under documentation.
  for (const p of ['packages/server/spec-runner.ts', 'src/readme.tsx', 'a/docs.ts', 'x.json']) {
    expect(isDoc(p), p).toBe(false)
  }
})

test('the feed names the KIND of each thing, in the transcript order', () => {
  const out = liveEvents([
    { role: 'assistant', thinking: 'weighing two options\nmore', tools: [
      { name: 'Read', detail: 'src/a.ts' },
      { name: 'Bash', detail: 'bun test', writes: ['out.log'] },
      { name: 'Edit', detail: 'src/b.ts' },
      { name: 'Agent', detail: 'review the diff' },
    ], text: 'Doing the thing.' },
  ])
  // The Bash call is TWO events: it ran, and then its file appeared. Collapsing them would lose
  // either what was run or what it produced.
  expect(out.map(e => e.kind)).toEqual(['thought', 'read', 'ran', 'wrote', 'wrote', 'delegated', 'said'])
  expect(out[0]!.text).toBe('weighing two options')
})

test('a subagent is DELEGATED, never "ran" — it starts work somewhere else', () => {
  const out = liveEvents([{ tools: [{ name: 'Agent', detail: 'audit the routes' }] }])
  expect(out).toEqual([{ kind: 'delegated', text: 'audit the routes', live: false }])
})

test('the pending turn is marked live, so the panel can say what is happening NOW', () => {
  const out = liveEvents([{ pending: true, tools: [{ name: 'Bash', detail: 'bun run build' }] }])
  expect(out[0]).toMatchObject({ kind: 'ran', live: true })
})

test("the person's own messages are not the session's activity", () => {
  const out = liveEvents([{ role: 'user', text: 'do the thing' }])
  expect(out).toEqual([])
})

test('an empty conversation produces an empty feed rather than a placeholder row', () => {
  expect(liveEvents([])).toEqual([])
  expect(liveEvents([{ role: 'assistant', text: '   ' }])).toEqual([])
})
