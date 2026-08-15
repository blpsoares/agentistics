import { describe, expect, test } from 'bun:test'
import { cacheKey, cacheSlot, type FileStamp } from './parse-cache-key'

const stamp = (over: Partial<FileStamp> = {}): FileStamp => ({
  path: '/home/u/.claude/projects/-home-u-app/abc.jsonl',
  mtimeMs: 1_700_000_000_123,
  size: 4096,
  ...over,
})

describe('cacheSlot', () => {
  test('one slot per (kind, path, variant)', () => {
    expect(cacheSlot('session', '/a.jsonl')).toBe(cacheSlot('session', '/a.jsonl'))
  })

  test('the kind is part of the identity', () => {
    expect(cacheSlot('session', '/a.jsonl')).not.toBe(cacheSlot('enrich', '/a.jsonl'))
  })

  test('the variant is part of the identity', () => {
    // Two derivations of ONE file that differ by something outside the file's
    // bytes (the model id agent-metrics prices against) must not share a row.
    expect(cacheSlot('enrich', '/a.jsonl', 'claude-opus-4-6'))
      .not.toBe(cacheSlot('enrich', '/a.jsonl', 'claude-sonnet-4-6'))
  })

  test('an absent variant is the empty variant', () => {
    expect(cacheSlot('enrich', '/a.jsonl')).toBe(cacheSlot('enrich', '/a.jsonl', ''))
  })

  test('the separator cannot be forged out of a path and a variant', () => {
    // The failing case for ANY separator character: with a space, both of these
    // flatten to "session /a.jsonl b c" and two different files would share one row.
    // JSON array encoding quotes and escapes every field, so no crafted path — a
    // Windows "C:\\Users\\..." included — can reach across a field boundary.
    expect(cacheSlot('session', '/a.jsonl', 'b c')).not.toBe(cacheSlot('session', '/a.jsonl b', 'c'))
  })
})

describe('cacheKey', () => {
  test('the same file version yields the same key', () => {
    expect(cacheKey(stamp())).toBe(cacheKey(stamp()))
  })

  test('a changed mtime is a new version', () => {
    expect(cacheKey(stamp())).not.toBe(cacheKey(stamp({ mtimeMs: 1_700_000_000_124 })))
  })

  test('a changed size is a new version', () => {
    // Appending to a live transcript changes BOTH, but size alone must be enough:
    // a filesystem with coarse mtime granularity would otherwise serve stale bytes.
    expect(cacheKey(stamp())).not.toBe(cacheKey(stamp({ size: 4097 })))
  })

  test('sub-millisecond mtime jitter does not invent versions', () => {
    // stat() reports mtimeMs as a float. Two stats of one untouched file can differ
    // in the fraction, which would miss on every build and defeat the whole cache.
    expect(cacheKey(stamp({ mtimeMs: 1_700_000_000_123.4 })))
      .toBe(cacheKey(stamp({ mtimeMs: 1_700_000_000_123.9 })))
  })

  test('the key does not carry the path', () => {
    // The path already lives in the slot, which is the primary key. Repeating it
    // in the version column doubles the stored bytes for no added discrimination.
    expect(cacheKey(stamp())).toBe(cacheKey(stamp({ path: '/somewhere/else.jsonl' })))
  })
})
