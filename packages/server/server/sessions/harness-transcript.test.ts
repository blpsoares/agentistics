import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  HARNESS_TRANSCRIPTS, forgetCodexTranscriptPaths, resolveAntigravityTranscript,
  resolveCodexTranscript, transcriptReaderFor,
} from './harness-transcript'

const CONV = '01d0814f-ef39-4838-8461-c50e540e552a'

/** One agy step, in the shape measured on the live transcript. */
const step = (idx: number, o: Record<string, unknown>): string => JSON.stringify({
  step_index: idx, status: 'DONE', created_at: '2026-09-05T17:22:28Z', ...o,
})

describe('the reader registry', () => {
  it('names every harness, so adding one is a decision here rather than a lookup miss', () => {
    expect(Object.keys(HARNESS_TRANSCRIPTS).sort())
      .toEqual(['antigravity', 'claude', 'codex', 'copilot', 'gemini', 'kimi'])
  })

  it('a harness with no reader is ABSENT — the caller turns that into a sentence', () => {
    expect(transcriptReaderFor('kimi')).toBeNull()
    expect(transcriptReaderFor('copilot')).toBeNull()
    expect(transcriptReaderFor('gemini')).toBeNull()
  })

  it("a row whose harness the registry forgot ('') resolves to nothing rather than throwing", () => {
    expect(transcriptReaderFor('')).toBeNull()
    expect(transcriptReaderFor(undefined)).toBeNull()
    expect(transcriptReaderFor('a-harness-from-a-newer-build')).toBeNull()
  })
})

describe('the antigravity reader', () => {
  let brain: string
  let logs: string

  beforeAll(async () => {
    brain = await mkdtemp(join(tmpdir(), 'agy-brain-'))
    logs = join(brain, CONV, '.system_generated', 'logs')
    await mkdir(logs, { recursive: true })
  })
  afterAll(async () => { await rm(brain, { recursive: true, force: true }) })

  it('prefers transcript_full.jsonl — transcript.jsonl is the truncated copy of it', async () => {
    await writeFile(join(logs, 'transcript.jsonl'), '')
    expect(await resolveAntigravityTranscript({ conversationId: CONV }, brain))
      .toBe(join(logs, 'transcript.jsonl'))
    await writeFile(join(logs, 'transcript_full.jsonl'), '')
    expect(await resolveAntigravityTranscript({ conversationId: CONV }, brain))
      .toBe(join(logs, 'transcript_full.jsonl'))
  })

  it('a conversation id that is not a UUID resolves to nothing, and reaches no filesystem', async () => {
    expect(await resolveAntigravityTranscript({ conversationId: '../../etc' }, brain)).toBeNull()
  })

  it('an unknown conversation resolves to nothing rather than to a path that does not exist', async () => {
    const other = '11111111-2222-4333-8444-555555555555'
    expect(await resolveAntigravityTranscript({ conversationId: other }, brain)).toBeNull()
  })

  it('reads the whole conversation, and the TAIL reads only its end', async () => {
    const lines: string[] = []
    for (let i = 0; i < 300; i++) {
      lines.push(step(i, { source: 'MODEL', type: 'PLANNER_RESPONSE', content: `m${i}` }))
    }
    const path = join(logs, 'transcript_full.jsonl')
    await writeFile(path, `${lines.join('\n')}\n`)

    const reader = HARNESS_TRANSCRIPTS.antigravity!
    const all = await reader.read(path, 400)
    expect(all).toHaveLength(300)
    expect(all[0]!.text).toBe('m0')
    expect(all[299]!.text).toBe('m299')

    // The 5s poll's budget: the last few turns, off the end of the file.
    const tail = await reader.readRecent(path, 6)
    expect(tail.map(t => t.text)).toEqual(['m294', 'm295', 'm296', 'm297', 'm298', 'm299'])
  })

  it('the tail WIDENS its window rather than returning fewer turns than asked for', async () => {
    // One turn, then padding far larger than the 256 KB first window, so a fixed window would
    // reach the end of the file and find nothing — the answer would be silently short.
    const pad = Array.from({ length: 4000 }, (_, i) =>
      step(i + 1, { source: 'MODEL', type: 'VIEW_FILE', content: 'x'.repeat(200) }))
    const path = join(logs, 'wide.jsonl')
    await writeFile(path, [
      step(0, { source: 'USER_EXPLICIT', type: 'USER_INPUT', content: '<USER_REQUEST>\noi\n</USER_REQUEST>' }),
      ...pad,
    ].join('\n'))

    const tail = await HARNESS_TRANSCRIPTS.antigravity!.readRecent(path, 1)
    expect(tail).toEqual([{ role: 'user', text: 'oi', at: '2026-09-05T17:22:28Z' }])
  })

  it('an unreadable file is an empty conversation, never a throw', async () => {
    const reader = HARNESS_TRANSCRIPTS.antigravity!
    expect(await reader.read(join(logs, 'nope.jsonl'), 10)).toEqual([])
    expect(await reader.readRecent(join(logs, 'nope.jsonl'), 10)).toEqual([])
  })
})

describe('the codex reader', () => {
  const ID = '019f3e9a-43b1-7391-b8a2-19fcdfeb88b0'
  let root: string

  beforeAll(async () => {
    forgetCodexTranscriptPaths()
    root = await mkdtemp(join(tmpdir(), 'codex-sessions-'))
    await mkdir(join(root, '2026', '07', '07'), { recursive: true })
    await writeFile(
      join(root, '2026', '07', '07', `rollout-2026-07-07T19-02-05-${ID}.jsonl`),
      [
        JSON.stringify({ timestamp: '2026-07-07T22:02:11Z', type: 'session_meta', payload: { id: ID } }),
        JSON.stringify({
          timestamp: '2026-07-07T22:02:40Z',
          type: 'response_item',
          payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'Salve' }] },
        }),
        // The duplicate copy, which must not be read.
        JSON.stringify({
          timestamp: '2026-07-07T22:02:40Z', type: 'event_msg',
          payload: { type: 'user_message', message: 'Salve' },
        }),
      ].join('\n'),
    )
  })
  afterAll(async () => { await rm(root, { recursive: true, force: true }) })

  it('finds the rollout by the conversation id in its FILENAME, across the day tree', async () => {
    expect(await resolveCodexTranscript({ conversationId: ID }, root))
      .toBe(join(root, '2026', '07', '07', `rollout-2026-07-07T19-02-05-${ID}.jsonl`))
  })

  it('an id that is not a UUID resolves to nothing and reaches no filesystem', async () => {
    expect(await resolveCodexTranscript({ conversationId: '../../etc/passwd' }, root)).toBeNull()
  })

  it('an unknown conversation resolves to nothing — and the MISS is memoized', async () => {
    const other = '11111111-2222-4333-8444-555555555555'
    expect(await resolveCodexTranscript({ conversationId: other }, root)).toBeNull()
    // A machine keeps a directory per day forever; a miss must cost one scan, not one per poll.
    expect(await resolveCodexTranscript({ conversationId: other }, root)).toBeNull()
  })

  it('reads the conversation, taking exactly one copy of the duplicated message', async () => {
    const path = join(root, '2026', '07', '07', `rollout-2026-07-07T19-02-05-${ID}.jsonl`)
    const turns = await HARNESS_TRANSCRIPTS.codex!.read(path, 400)
    expect(turns).toEqual([
      { role: 'user', text: 'Salve', at: '2026-07-07T22:02:40Z' },
    ])
    expect(await HARNESS_TRANSCRIPTS.codex!.readRecent(path, 6)).toEqual(turns)
  })
})
