import { describe, expect, test, afterEach } from 'bun:test'
import { mkdtemp, rm, writeFile, utimes, stat } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { openParseCache } from './parse-cache'
import { cachedParseSession, cachedEnrich } from './parse-cache-jsonl'
import { parseSessionJsonl, activeMinutesFromClaudeJsonl } from './jsonl'

const dirs: string[] = []
async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'agentistics-parse-jsonl-'))
  dirs.push(dir)
  return dir
}
afterEach(async () => {
  await Promise.all(dirs.splice(0).map(d => rm(d, { recursive: true, force: true })))
})

/** A minimal but REAL Claude transcript: a user turn, an assistant turn with usage,
 *  and a tool call — enough that the parser produces non-trivial counters to compare. */
const TRANSCRIPT = [
  JSON.stringify({ type: 'user', cwd: '/home/u/app', timestamp: '2026-08-01T10:00:00.000Z', message: { role: 'user', content: 'hello there' } }),
  JSON.stringify({ type: 'assistant', timestamp: '2026-08-01T10:00:05.000Z', message: { role: 'assistant', model: 'claude-opus-4-6', usage: { input_tokens: 10, output_tokens: 20, cache_read_input_tokens: 5, cache_creation_input_tokens: 2 }, content: [{ type: 'tool_use', name: 'Read', input: { file_path: '/home/u/app/a.ts' } }] } }),
  JSON.stringify({ type: 'user', cwd: '/home/u/app', timestamp: '2026-08-01T10:00:09.000Z', message: { role: 'user', content: 'thanks' } }),
].join('\n')

async function fixture(): Promise<{ dir: string; file: string }> {
  const dir = await tempDir()
  const file = join(dir, 'sess-1.jsonl')
  await writeFile(file, TRANSCRIPT)
  return { dir, file }
}

describe('cachedParseSession', () => {
  test('a hit reproduces the uncached parse exactly', async () => {
    const { dir, file } = await fixture()
    const cache = await openParseCache(join(dir, 'cache.db'))

    const direct = await parseSessionJsonl(file, 'sess-1', '/fallback', 'jsonl')
    const cold = await cachedParseSession(cache, file, 'sess-1', '/fallback', 'jsonl')
    const warm = await cachedParseSession(cache, file, 'sess-1', '/fallback', 'jsonl')

    expect(cold).toEqual(direct)
    expect(warm).toEqual(direct)
    // The whole point: byte-identical, not merely "close enough".
    expect(JSON.stringify(warm)).toBe(JSON.stringify(direct))
    expect(cache.stats()).toMatchObject({ hits: 1, misses: 1, writes: 1 })
    cache.close()
  })

  test('a hit does not read the file', async () => {
    const { dir, file } = await fixture()
    const cache = await openParseCache(join(dir, 'cache.db'))
    await cachedParseSession(cache, file, 'sess-1', '/fallback', 'jsonl')

    // Overwrite the CONTENT with garbage of the same byte length, then restore the
    // original mtime exactly. The version key is (truncated mtimeMs, size), so the
    // stored row still matches this "new" version — a genuine hit answers from the
    // database alone and returns the real counters; a re-read would return garbage
    // (or crash the parser) instead.
    const before = await stat(file)
    await writeFile(file, 'x'.repeat(TRANSCRIPT.length))
    await utimes(file, before.atime, before.mtime)

    const warm = await cachedParseSession(cache, file, 'sess-1', '/fallback', 'jsonl')
    expect(warm.user_message_count).toBe(2)
    expect(warm.input_tokens).toBe(10)
    expect(cache.stats().hits).toBe(1)
    cache.close()
  })

  test('an appended transcript is reparsed, not served stale', async () => {
    const { dir, file } = await fixture()
    const cache = await openParseCache(join(dir, 'cache.db'))
    const before = await cachedParseSession(cache, file, 'sess-1', '/fallback', 'jsonl')

    await writeFile(file, TRANSCRIPT + '\n' + JSON.stringify({
      type: 'user', cwd: '/home/u/app', timestamp: '2026-08-01T10:01:00.000Z',
      message: { role: 'user', content: 'one more' },
    }))
    const after = await cachedParseSession(cache, file, 'sess-1', '/fallback', 'jsonl')

    expect(after.user_message_count).toBe(before.user_message_count + 1)
    cache.close()
  })

  test('the caller returns to the live parser when the file cannot be stat-ed', async () => {
    // A vanished file has no version, so there is nothing to key on. The wrapper must
    // fall through to the parser (which answers with an empty session) rather than throw.
    const dir = await tempDir()
    const cache = await openParseCache(join(dir, 'cache.db'))
    const s = await cachedParseSession(cache, join(dir, 'missing.jsonl'), 'nope', '/fallback', 'jsonl')
    expect(s.session_id).toBe('nope')
    expect(s.project_path).toBe('/fallback')
    expect(cache.rowCount()).toBe(0)
    cache.close()
  })

  test('two sources of one path do not share a row', async () => {
    // `source` changes the SessionMeta the parser produces, and Format A and Format B
    // can name the same transcript. It has to be part of the identity.
    const { dir, file } = await fixture()
    const cache = await openParseCache(join(dir, 'cache.db'))
    const a = await cachedParseSession(cache, file, 'sess-1', '/fallback', 'jsonl')
    const b = await cachedParseSession(cache, file, 'sess-1', '/fallback', 'subdir')
    expect(a._source).toBe('jsonl')
    expect(b._source).toBe('subdir')
    cache.close()
  })
})

describe('cachedEnrich', () => {
  test('derives the model from the transcript when the caller has none', async () => {
    const { dir, file } = await fixture()
    const cache = await openParseCache(join(dir, 'cache.db'))
    const r = await cachedEnrich(cache, file, '')
    expect(r?.model).toBe('claude-opus-4-6')
    cache.close()
  })

  test('active minutes match the live computation', async () => {
    const { dir, file } = await fixture()
    const cache = await openParseCache(join(dir, 'cache.db'))
    const r = await cachedEnrich(cache, file, '')
    expect(r?.activeMinutes).toBe(activeMinutesFromClaudeJsonl(TRANSCRIPT.split('\n')) ?? null)
    cache.close()
  })

  test('a hit reproduces the cold result exactly and reads no file', async () => {
    // A cache lookup still needs to `stat()` the file to build the FileStamp (exactly
    // like cachedParseSession) — a deleted file has no version to check freshness
    // against and correctly falls into the "missing" path tested below. What this test
    // proves is the "does not read no file CONTENT" half: overwrite the bytes with
    // garbage of the same length, then restore the original mtime exactly, so the
    // stored row still matches this "new" version. A genuine hit answers from the
    // database alone; a re-read would derive from the garbage content instead.
    const { dir, file } = await fixture()
    const cache = await openParseCache(join(dir, 'cache.db'))
    const cold = await cachedEnrich(cache, file, '')

    const before = await stat(file)
    await writeFile(file, 'x'.repeat(TRANSCRIPT.length))
    await utimes(file, before.atime, before.mtime)

    const warm = await cachedEnrich(cache, file, '')
    expect(JSON.stringify(warm)).toBe(JSON.stringify(cold))
    cache.close()
  })

  test('the caller-supplied model is part of the identity', async () => {
    // extractAgentMetrics PRICES against the model id the caller passes. Two callers
    // with different ids must not read each other's row, or a session is costed with
    // another session's rate.
    const { dir, file } = await fixture()
    const cache = await openParseCache(join(dir, 'cache.db'))
    await cachedEnrich(cache, file, 'claude-opus-4-6')
    await cachedEnrich(cache, file, 'claude-haiku-4-5-20251001')
    expect(cache.rowCount()).toBe(2)
    cache.close()
  })

  test('a missing file yields null rather than an invented result', async () => {
    const dir = await tempDir()
    const cache = await openParseCache(join(dir, 'cache.db'))
    expect(await cachedEnrich(cache, join(dir, 'missing.jsonl'), '')).toBeNull()
    cache.close()
  })

  test('an empty file yields null', async () => {
    const dir = await tempDir()
    const file = join(dir, 'empty.jsonl')
    await writeFile(file, '')
    const cache = await openParseCache(join(dir, 'cache.db'))
    expect(await cachedEnrich(cache, file, '')).toBeNull()
    cache.close()
  })
})
