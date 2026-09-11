import { describe, expect, test } from 'bun:test'
import { capHits, matchNames, parseGrepOutput, SEARCH_LIMIT } from './editor-search'

describe('parseGrepOutput', () => {
  test('parses "path:line:text" per line, git grep -n\'s own shape', () => {
    const out = parseGrepOutput('src/a.ts:12:const x = 1\nsrc/b.ts:3:foo')
    expect(out).toEqual([
      { kind: 'content', path: 'src/a.ts', line: 12, text: 'const x = 1' },
      { kind: 'content', path: 'src/b.ts', line: 3, text: 'foo' },
    ])
  })
  test('a matched line whose TEXT contains a colon is still parsed correctly', () => {
    const out = parseGrepOutput('src/a.ts:5:const o = { a: 1 }')
    expect(out).toEqual([{ kind: 'content', path: 'src/a.ts', line: 5, text: 'const o = { a: 1 }' }])
  })
  test('blank lines are skipped', () => {
    expect(parseGrepOutput('\n\n')).toEqual([])
  })
  test('a line that does not match the shape is skipped rather than throwing', () => {
    expect(parseGrepOutput('not the right shape at all')).toEqual([])
  })
})

describe('matchNames', () => {
  test('matches by basename substring, case-insensitively', () => {
    const out = matchNames(['src/Widget.tsx', 'src/other.ts'], 'widget')
    expect(out).toEqual([{ kind: 'name', path: 'src/Widget.tsx' }])
  })
  test('an empty query matches nothing — this is a search box, not a full listing', () => {
    expect(matchNames(['a.ts', 'b.ts'], '   ')).toEqual([])
  })
})

describe('capHits', () => {
  test('under the limit, nothing is truncated', () => {
    const hits = [{ kind: 'name' as const, path: 'a.ts' }]
    expect(capHits(hits, 10)).toEqual({ hits, truncated: false })
  })
  test('over the limit, the list is cut and truncated is reported', () => {
    const hits = Array.from({ length: 5 }, (_, i) => ({ kind: 'name' as const, path: `${i}.ts` }))
    const out = capHits(hits, 3)
    expect(out.hits).toHaveLength(3)
    expect(out.truncated).toBe(true)
  })
  test('the default limit is SEARCH_LIMIT', () => {
    const hits = Array.from({ length: SEARCH_LIMIT + 1 }, (_, i) => ({ kind: 'name' as const, path: `${i}` }))
    const out = capHits(hits)
    expect(out.hits).toHaveLength(SEARCH_LIMIT)
    expect(out.truncated).toBe(true)
  })
})
