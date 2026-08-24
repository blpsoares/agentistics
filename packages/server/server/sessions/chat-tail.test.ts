import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { mkdtemp, mkdir, rm, writeFile, utimes } from 'node:fs/promises'
import {
  forgetChatTailContent, forgetChatTailPaths, readRecentChatTurns, resolveChatTranscriptPath,
} from './chat-tail'

const SESSION_ID = 'a1b2c3d4-e5f6-4789-a0b1-c2d3e4f56789'

function line(obj: unknown): string {
  return JSON.stringify(obj)
}

const userTurn = (text: string) => line({ type: 'user', message: { content: text } })
const assistantTurn = (text: string) => line({
  type: 'assistant', message: { content: [{ type: 'text', text }] },
})
const toolResultTurn = () => line({
  type: 'user', message: { content: [{ type: 'tool_result', content: 'ok' }] },
})

describe('resolveChatTranscriptPath', () => {
  let root: string

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'chat-tail-'))
    forgetChatTailPaths()
  })
  afterEach(async () => { await rm(root, { recursive: true, force: true }) })

  test('finds the transcript at the directly encoded project path', async () => {
    const projectDir = join(root, '-home-user-my-project')
    await mkdir(projectDir, { recursive: true })
    const file = join(projectDir, `${SESSION_ID}.jsonl`)
    await writeFile(file, userTurn('hi') + '\n')

    const resolved = await resolveChatTranscriptPath('/home/user/my-project', SESSION_ID, root)
    expect(resolved).toBe(file)
  })

  test('falls back to a scan when the directly encoded path does not exist', async () => {
    // The naive encoding of this cwd would land on a directory that is not where Claude actually
    // put the file (an ambiguous-dash collision) — the scan is what finds it anyway, by filename.
    const realDir = join(root, 'some-other-directory-name')
    await mkdir(realDir, { recursive: true })
    const file = join(realDir, `${SESSION_ID}.jsonl`)
    await writeFile(file, userTurn('hi') + '\n')

    const resolved = await resolveChatTranscriptPath('/home/user/my-project', SESSION_ID, root)
    expect(resolved).toBe(file)
  })

  test('returns null and never throws when nothing matches', async () => {
    const resolved = await resolveChatTranscriptPath('/nowhere', SESSION_ID, root)
    expect(resolved).toBeNull()
  })

  test('rejects a non-UUID session id without touching the filesystem', async () => {
    const resolved = await resolveChatTranscriptPath('/nowhere', 'not-a-uuid', root)
    expect(resolved).toBeNull()
  })

  test('caches a miss so a second lookup does not re-scan', async () => {
    const first = await resolveChatTranscriptPath('/nowhere', SESSION_ID, root)
    expect(first).toBeNull()

    // Adding the file after the miss was cached must not change the cached answer.
    const lateDir = join(root, '-late')
    await mkdir(lateDir, { recursive: true })
    await writeFile(join(lateDir, `${SESSION_ID}.jsonl`), userTurn('hi') + '\n')

    const second = await resolveChatTranscriptPath('/nowhere', SESSION_ID, root)
    expect(second).toBeNull()
  })
})

describe('readRecentChatTurns', () => {
  let root: string
  let file: string

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'chat-tail-content-'))
    file = join(root, 'transcript.jsonl')
    forgetChatTailContent()
  })
  afterEach(async () => { await rm(root, { recursive: true, force: true }) })

  test('returns turns oldest-first with real roles', async () => {
    await writeFile(file, [
      userTurn('what does this do'),
      assistantTurn('it does the thing'),
    ].join('\n') + '\n')

    const turns = await readRecentChatTurns(file)
    expect(turns).toEqual([
      { role: 'user', text: 'what does this do' },
      { role: 'assistant', text: 'it does the thing' },
    ])
  })

  test('filters out tool-result-only user entries', async () => {
    await writeFile(file, [
      userTurn('do the thing'),
      assistantTurn('doing it'),
      toolResultTurn(),
      assistantTurn('done'),
    ].join('\n') + '\n')

    const turns = await readRecentChatTurns(file)
    expect(turns.map(t => t.role)).toEqual(['user', 'assistant', 'assistant'])
  })

  test('stops parsing once `max` turns are collected, from the end', async () => {
    const lines: string[] = []
    for (let i = 0; i < 20; i++) {
      lines.push(userTurn(`q${i}`))
      lines.push(assistantTurn(`a${i}`))
    }
    await writeFile(file, lines.join('\n') + '\n')

    const turns = await readRecentChatTurns(file, 2)
    expect(turns).toEqual([
      { role: 'user', text: 'q19' },
      { role: 'assistant', text: 'a19' },
    ])
  })

  test('skips malformed lines without throwing', async () => {
    await writeFile(file, [
      'not json at all',
      userTurn('hello'),
    ].join('\n') + '\n')

    const turns = await readRecentChatTurns(file)
    expect(turns).toEqual([{ role: 'user', text: 'hello' }])
  })

  test('returns empty for a missing file rather than throwing', async () => {
    const turns = await readRecentChatTurns(join(root, 'nope.jsonl'))
    expect(turns).toEqual([])
  })

  test('re-parses when the file changes and reuses the cache when it has not', async () => {
    await writeFile(file, userTurn('first') + '\n')
    const first = await readRecentChatTurns(file)
    expect(first).toEqual([{ role: 'user', text: 'first' }])

    // Unchanged mtime: appending nothing and re-reading must return the cached array instance.
    const cached = await readRecentChatTurns(file)
    expect(cached).toBe(first)

    // Bump mtime forward so the cache is invalidated even on filesystems with coarse resolution.
    const future = new Date(Date.now() + 5_000)
    await writeFile(file, userTurn('first') + '\n' + assistantTurn('second') + '\n')
    await utimes(file, future, future)

    const updated = await readRecentChatTurns(file)
    expect(updated).toEqual([
      { role: 'user', text: 'first' },
      { role: 'assistant', text: 'second' },
    ])
  })
})
