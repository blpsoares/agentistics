import { describe, expect, test, afterEach, beforeEach } from 'bun:test'
import { mkdtemp, rm, writeFile, appendFile, truncate } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { claudeTranscriptState, resetTranscriptStates, retainedTranscriptStates } from './transcript-state'
import { finishClaudeSession, parseSessionJsonl } from './jsonl'
import { finishActiveTime } from '@agentistics/core'

const dirs: string[] = []
async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'agentistics-transcript-'))
  dirs.push(dir)
  return dir
}
beforeEach(() => resetTranscriptStates())
afterEach(async () => {
  resetTranscriptStates()
  await Promise.all(dirs.splice(0).map(d => rm(d, { recursive: true, force: true })))
})

/** One assistant turn, as Claude Code writes it. `id` keys the usage dedupe. */
const assistant = (id: string, ts: string, input: number, output: number) => JSON.stringify({
  type: 'assistant', timestamp: ts, cwd: '/w',
  message: { id, model: 'claude-opus-5', usage: { input_tokens: input, output_tokens: output }, content: [] },
}) + '\n'

const user = (ts: string, text: string) => JSON.stringify({
  type: 'user', timestamp: ts, cwd: '/w', message: { content: [{ type: 'text', text }] },
}) + '\n'

const TRANSCRIPT =
  user('2026-09-10T10:00:00.000Z', 'primeiro') +
  assistant('m1', '2026-09-10T10:00:05.000Z', 10, 20) +
  user('2026-09-10T10:05:00.000Z', 'segundo') +
  assistant('m2', '2026-09-10T10:05:09.000Z', 30, 40) +
  assistant('m3', '2026-09-10T10:06:00.000Z', 50, 60)

describe('claudeTranscriptState', () => {
  test('an unreadable file says nothing rather than reporting an empty transcript', async () => {
    expect(await claudeTranscriptState(join(await tempDir(), 'missing.jsonl'))).toBeNull()
  })

  test('the first read is a full one and names why', async () => {
    const f = join(await tempDir(), 's.jsonl')
    await writeFile(f, TRANSCRIPT)
    const r = await claudeTranscriptState(f)
    expect(r!.info).toMatchObject({ mode: 'full', reason: 'no-cursor', bytesRead: TRANSCRIPT.length })
    expect(r!.state.userMsgs).toBe(2)
    expect(r!.state.inputTokens).toBe(90)
  })

  test('a file that has not moved is not read again', async () => {
    const f = join(await tempDir(), 's.jsonl')
    await writeFile(f, TRANSCRIPT)
    await claudeTranscriptState(f)
    const again = await claudeTranscriptState(f)
    expect(again!.info).toEqual({ mode: 'unchanged', bytesRead: 0, fileBytes: TRANSCRIPT.length })
    expect(again!.state.userMsgs).toBe(2)
  })

  test('an appended turn costs the appended bytes, not the file', async () => {
    const f = join(await tempDir(), 's.jsonl')
    await writeFile(f, TRANSCRIPT)
    await claudeTranscriptState(f)
    const more = assistant('m4', '2026-09-10T10:07:00.000Z', 1, 2)
    await appendFile(f, more)
    const r = await claudeTranscriptState(f)
    expect(r!.info.mode).toBe('append')
    // The anchor region rides along with the new bytes — one read, and it is the only overhead.
    expect(r!.info.bytesRead).toBeLessThan(more.length + 300)
    expect(r!.info.bytesRead).toBeLessThan(r!.info.fileBytes)
    expect(r!.state.inputTokens).toBe(91)
    expect(r!.state.assistantMsgs).toBe(4)
  })

  test('growing a transcript byte by byte lands on the same state as reading it whole', async () => {
    const f = join(await tempDir(), 's.jsonl')
    const bytes = Buffer.from(TRANSCRIPT, 'utf-8')
    await writeFile(f, '')
    for (let i = 1; i <= bytes.length; i++) {
      await writeFile(f, bytes.subarray(0, i))
      await claudeTranscriptState(f)
    }
    const incr = await claudeTranscriptState(f)
    resetTranscriptStates()
    const whole = await claudeTranscriptState(f)
    expect(JSON.stringify(incr!.state.daily)).toBe(JSON.stringify(whole!.state.daily))
    expect(incr!.state.inputTokens).toBe(whole!.state.inputTokens)
    expect(incr!.state.userMsgs).toBe(whole!.state.userMsgs)
    expect(finishActiveTime(incr!.state.active)).toEqual(finishActiveTime(whole!.state.active))
  })

  test('a HALF-WRITTEN line is not counted until the write that finishes it', async () => {
    const f = join(await tempDir(), 's.jsonl')
    const complete = assistant('m9', '2026-09-10T11:00:00.000Z', 700, 800)
    await writeFile(f, TRANSCRIPT)
    await claudeTranscriptState(f)
    // The writer got halfway through the line. Counting it would be counting a line that does not
    // parse; worse, it would leave the cursor inside it.
    await appendFile(f, complete.slice(0, 40))
    const mid = await claudeTranscriptState(f)
    expect(mid!.state.assistantMsgs).toBe(3)
    expect(mid!.state.inputTokens).toBe(90)
    await appendFile(f, complete.slice(40))
    const done = await claudeTranscriptState(f)
    expect(done!.state.assistantMsgs).toBe(4)
    expect(done!.state.inputTokens).toBe(790)
  })

  test('a line finished across a multi-byte character is read once and read right', async () => {
    const f = join(await tempDir(), 's.jsonl')
    const line = user('2026-09-10T12:00:00.000Z', 'ação está começando — três')
    const bytes = Buffer.from(line, 'utf-8')
    await writeFile(f, TRANSCRIPT)
    await claudeTranscriptState(f)
    // Cut inside the 'ç'. A decoder run over this cut would produce a replacement character;
    // nothing decodes it, because nothing before the newline is consumed.
    const cut = bytes.indexOf(Buffer.from('ç', 'utf-8')) + 1
    await appendFile(f, bytes.subarray(0, cut))
    expect((await claudeTranscriptState(f))!.state.userMsgs).toBe(2)
    await appendFile(f, bytes.subarray(cut))
    const done = await claudeTranscriptState(f)
    expect(done!.state.userMsgs).toBe(3)
    expect(done!.state.firstPrompt).toBe('primeiro')
  })

  test('a TRUNCATED file is read whole again rather than resumed', async () => {
    const f = join(await tempDir(), 's.jsonl')
    await writeFile(f, TRANSCRIPT)
    await claudeTranscriptState(f)
    await truncate(f, TRANSCRIPT.indexOf('\n') + 1)
    const r = await claudeTranscriptState(f)
    expect(r!.info).toMatchObject({ mode: 'full', reason: 'shrank' })
    expect(r!.state.assistantMsgs).toBe(0)
    expect(r!.state.userMsgs).toBe(1)
  })

  test('a REWRITE that kept the byte length is caught by the mtime and read whole', async () => {
    const f = join(await tempDir(), 's.jsonl')
    await writeFile(f, TRANSCRIPT)
    await claudeTranscriptState(f)
    const swapped = TRANSCRIPT.replace('"primeiro"', '"PRIMEIRO"')
    expect(swapped.length).toBe(TRANSCRIPT.length)
    await new Promise(r => setTimeout(r, 12))
    await writeFile(f, swapped)
    const r = await claudeTranscriptState(f)
    expect(r!.info).toMatchObject({ mode: 'full', reason: 'rewritten' })
    expect(r!.state.firstPrompt).toBe('PRIMEIRO')
  })

  test('a rewrite that GREW the file is caught by the anchor and read whole', async () => {
    const f = join(await tempDir(), 's.jsonl')
    await writeFile(f, TRANSCRIPT)
    await claudeTranscriptState(f)
    // A compaction that rewrote history rather than appending to it: everything before the cursor
    // is different, and the file is bigger, so only the anchor can tell.
    await writeFile(f, user('2026-09-10T09:00:00.000Z', 'reescrito') + TRANSCRIPT)
    const r = await claudeTranscriptState(f)
    expect(r!.info).toMatchObject({ mode: 'full', reason: 'anchor-mismatch' })
    expect(r!.state.userMsgs).toBe(3)
    expect(r!.state.firstPrompt).toBe('reescrito')
  })

  test('an APPENDED compaction boundary is resumed, not reset — Claude Code appends', async () => {
    const f = join(await tempDir(), 's.jsonl')
    await writeFile(f, TRANSCRIPT)
    await claudeTranscriptState(f)
    await appendFile(f, JSON.stringify({
      type: 'system', subtype: 'compact_boundary', timestamp: '2026-09-10T10:10:00.000Z',
      compactMetadata: { durationMs: 900, cumulativeDroppedTokens: 4000 },
    }) + '\n')
    const r = await claudeTranscriptState(f)
    expect(r!.info.mode).toBe('append')
    expect(r!.state.compact).toEqual({ count: 1, ms: 900, dropped: 4000 })
    // The turns before the boundary are still counted — the file still holds them.
    expect(r!.state.inputTokens).toBe(90)
  })

  test('the finished session matches the one-shot parser, whichever way the file was read', async () => {
    const f = join(await tempDir(), 's.jsonl')
    await writeFile(f, TRANSCRIPT.slice(0, TRANSCRIPT.lastIndexOf('\n', TRANSCRIPT.length - 2) + 1))
    await claudeTranscriptState(f)
    await writeFile(f, TRANSCRIPT)
    const r = await claudeTranscriptState(f)
    expect(r!.info.mode).toBe('append')
    const incr = await finishClaudeSession(r!.state, f, 'sid', '/fallback', 'jsonl')
    const whole = await parseSessionJsonl(f, 'sid', '/fallback', 'jsonl')
    expect(incr).toEqual(whole)
  })

  test('an empty file is a real read and a real cursor, not a failure', async () => {
    const f = join(await tempDir(), 's.jsonl')
    await writeFile(f, '')
    const r = await claudeTranscriptState(f)
    expect(r!.info).toMatchObject({ mode: 'full', bytesRead: 0, fileBytes: 0 })
    expect(r!.state.userMsgs).toBe(0)
  })

  test('walks are kept per file and can be forgotten', async () => {
    const dir = await tempDir()
    for (const n of ['a', 'b']) await writeFile(join(dir, `${n}.jsonl`), TRANSCRIPT)
    await claudeTranscriptState(join(dir, 'a.jsonl'))
    await claudeTranscriptState(join(dir, 'b.jsonl'))
    expect(retainedTranscriptStates()).toBe(2)
    resetTranscriptStates()
    expect(retainedTranscriptStates()).toBe(0)
  })

  test('asking for a file REFRESHES its walk — an active session is never evicted under itself', async () => {
    const f = join(await tempDir(), 's.jsonl')
    await writeFile(f, TRANSCRIPT)
    const t0 = 1_000_000_000
    await claudeTranscriptState(f, t0)
    // Hours later, and still resumed: age is a memory bound, not a correctness one. Whether a
    // cursor may be trusted is decided by the file's size and its anchor, never by the clock.
    expect((await claudeTranscriptState(f, t0 + 60 * 60_000))!.info.mode).toBe('unchanged')
    expect(retainedTranscriptStates()).toBe(1)
  })

  test('a walk nobody has asked for is dropped when the next file comes along', async () => {
    const dir = await tempDir()
    const a = join(dir, 'a.jsonl'), b = join(dir, 'b.jsonl')
    await writeFile(a, TRANSCRIPT)
    await writeFile(b, TRANSCRIPT)
    const t0 = 1_000_000_000
    await claudeTranscriptState(a, t0)
    await claudeTranscriptState(b, t0 + 60 * 60_000)
    expect(retainedTranscriptStates()).toBe(1)
    // Dropping one costs exactly one re-read and never a number.
    const back = await claudeTranscriptState(a, t0 + 60 * 60_000)
    expect(back!.info).toMatchObject({ mode: 'full', reason: 'no-cursor' })
    expect(back!.state.inputTokens).toBe(90)
  })

  test('what a finish hands out is a SNAPSHOT — the walk goes on without touching it', async () => {
    const f = join(await tempDir(), 's.jsonl')
    await writeFile(f, TRANSCRIPT)
    const first = await finishClaudeSession((await claudeTranscriptState(f))!.state, f, 'sid', '/w', 'jsonl')
    const hoursBefore = [...first.message_hours]
    const toolsBefore = JSON.stringify(first.tool_counts)
    const dailyBefore = JSON.stringify(first.daily)

    await appendFile(f, assistant('m5', '2026-09-11T03:00:00.000Z', 5, 6))
    const second = await finishClaudeSession((await claudeTranscriptState(f))!.state, f, 'sid', '/w', 'jsonl')

    // The earlier answer must not have moved under its holder.
    expect(first.message_hours).toEqual(hoursBefore)
    expect(JSON.stringify(first.tool_counts)).toBe(toolsBefore)
    expect(JSON.stringify(first.daily)).toBe(dailyBefore)
    expect(second.message_hours.length).toBe(hoursBefore.length + 1)
    expect(second.daily!['2026-09-11']).toBeDefined()
    expect(first.daily!['2026-09-11']).toBeUndefined()
  })

  test('editing what a finish handed out cannot corrupt the next one', async () => {
    const f = join(await tempDir(), 's.jsonl')
    await writeFile(f, TRANSCRIPT)
    const first = await finishClaudeSession((await claudeTranscriptState(f))!.state, f, 'sid', '/w', 'jsonl')
    first.message_hours.push(23)
    first.tool_counts['Forged'] = 99
    const second = await finishClaudeSession((await claudeTranscriptState(f))!.state, f, 'sid', '/w', 'jsonl')
    expect(second.tool_counts['Forged']).toBeUndefined()
    expect(second.message_hours).not.toContain(23)
  })

  test('a second reader SHARES the read in flight rather than starting its own', async () => {
    const f = join(await tempDir(), 's.jsonl')
    await writeFile(f, TRANSCRIPT)
    await claudeTranscriptState(f)
    await appendFile(f, assistant('m7', '2026-09-10T10:30:00.000Z', 100, 200))
    // The mechanism, asserted directly: folding the same bytes twice would double this session's
    // tokens in silence, and nothing about that may rest on how a runtime happens to schedule fs
    // callbacks. See the note on `reading` in transcript-state.ts.
    const first = claudeTranscriptState(f)
    const second = claudeTranscriptState(f)
    expect(second).toBe(first)
    const [a, b] = await Promise.all([first, second])
    expect(a!.state.inputTokens).toBe(190)
    expect(b!.state.inputTokens).toBe(190)
    expect(a!.state.assistantMsgs).toBe(4)
    // And the share is released, so the next poll is a real read.
    const after = claudeTranscriptState(f)
    expect(after).not.toBe(first)
    await after
  })

  test('ten readers arriving at once fold once', async () => {
    const f = join(await tempDir(), 's.jsonl')
    await writeFile(f, TRANSCRIPT)
    await claudeTranscriptState(f)
    await appendFile(f, assistant('m8', '2026-09-10T10:40:00.000Z', 7, 8))
    const all = await Promise.all(Array.from({ length: 10 }, () => claudeTranscriptState(f)))
    for (const r of all) expect(r!.state.inputTokens).toBe(97)
  })
})
