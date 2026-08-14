import { describe, expect, test, afterEach } from 'bun:test'
import { mkdtemp, rm, writeFile, utimes, stat } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { openParseCache } from './parse-cache'
import { cachedParseSession } from './parse-cache-jsonl'
import { parseSessionJsonl } from './jsonl'

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
