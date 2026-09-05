/**
 * chat-web.test.ts — "not YET" against "no LONGER", which is the whole usability of a new session.
 *
 * A harness writes its transcript when the conversation first says something, so a session agentop
 * has just started has no file on disk for as long as nobody has spoken to it. Reporting that as
 * `unavailable` made the chat view draw its refusal INSTEAD of the composer — so the one act that
 * would create the transcript, sending the first message, was the one act the view withheld, and a
 * session created from the workspace stayed un-chattable for its whole life.
 */

import { test, expect } from 'bun:test'
import { readSessionChat } from './chat-web'

/** A cwd that is not a project on any machine, so no transcript can ever resolve for it. */
const NO_PROJECT = '/nonexistent/agentistics-chat-web-test'

function hostWith(state: string, harness = 'claude') {
  const row = {
    id: 'sess1',
    harness,
    cwd: NO_PROJECT,
    conversationId: '00000000-0000-4000-8000-000000000000',
    state,
  }
  return { sessions: async () => ({ sessions: [row] }) } as never
}

test('a RUNNING session with no transcript yet is an EMPTY conversation, not an unavailable one', async () => {
  const out = await readSessionChat(hostWith('waiting'), 'en', 'sess1')
  expect(out.turns).toEqual([])
  expect(out.live).toBe(true)
  // The absence of `unavailable` is what lets the composer render — it is the assertion that matters.
  expect(out.unavailable).toBeUndefined()
})

test('a working session is treated the same — it has simply not spoken yet', async () => {
  const out = await readSessionChat(hostWith('working'), 'pt', 'sess1')
  expect(out.unavailable).toBeUndefined()
  expect(out.live).toBe(true)
})

test('a session that is NOT running keeps the refusal — there the transcript is genuinely gone', async () => {
  const out = await readSessionChat(hostWith('exited'), 'en', 'sess1')
  expect(out.live).toBe(false)
  expect(out.unavailable).toContain('was not found')
})

test('an unknown id still reports that the session left this machine, never an empty chat', async () => {
  const out = await readSessionChat(hostWith('waiting'), 'en', 'other')
  expect(out.unavailable).toBeTruthy()
})

/**
 * The SECOND limit — the transcript FORMAT, which used to be tangled up with the first one.
 *
 * Measured 2026-09-05 on a live antigravity session carrying a perfectly exact conversation link
 * (`/proc/<pid>/cmdline` was `agy --conversation 01d0814f-…`): the request ran into the Claude-only
 * path resolver, found nothing, took the live branch above and answered `{turns: [], live: true}`.
 * `SessionChat.tsx` draws "no messages yet" only when `live === null`, so the result was a blank
 * pane with no sentence on it. The link was never the problem; there was no reader.
 */
test('a harness nobody has written a reader for is refused in words, and NAMED', async () => {
  const out = await readSessionChat(hostWith('waiting', 'codex'), 'en', 'sess1')
  expect(out.turns).toEqual([])
  expect(out.unavailable).toContain('codex')
})

test('a harness that HAS a reader falls through to the transcript rules, not to that refusal', async () => {
  // antigravity resolves against `brain/<conversation-id>/…`, which does not exist for this id —
  // so it must land on the live/not-yet branch, exactly as claude does, and NOT on "no reader".
  const out = await readSessionChat(hostWith('waiting', 'antigravity'), 'en', 'sess1')
  expect(out.unavailable).toBeUndefined()
  expect(out.live).toBe(true)
})

test('a row whose harness the registry has forgotten says THAT, not "we cannot read \'\'"', async () => {
  const out = await readSessionChat(hostWith('waiting', ''), 'en', 'sess1')
  expect(out.unavailable).toContain('which assistant')
})
