/**
 * events-frontier.test.ts — the boundary this channel may not cross, asserted.
 *
 * The event channel exists so a Claude session orchestrating other assistants knows what is
 * happening. The distance between "knows" and "acts on the user's behalf" is short, and the two
 * places it could be crossed are the SHAPE of an event (a field that carries an instruction) and
 * the WORDS of a notification (a fact written as an order). Both are checked here, and this file is
 * the review gate for anything added to the channel: a new field or a new sentence that fails these
 * assertions is a product decision, not a drive-by.
 *
 * The greps over module source are deliberate — the same technique `billing-detect.test.ts` uses to
 * pin what a module may name. A test that only exercised behaviour would pass the day somebody adds
 * an `action` field nothing reads yet.
 */

import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { serializeEvent } from './event-line'
import { EVENT_KINDS, EVENT_VERSION, type SessionEvent } from './event-types'
import { PEER_PREAMBLE, desktopText, eventHeadline, peerMessage, stateSentence } from './notify-text'
import type { Subscription } from './subscriptions'

const here = (f: string): string => readFileSync(join(import.meta.dir, f), 'utf8')

const ev = (o: Partial<SessionEvent>): SessionEvent => ({
  v: EVENT_VERSION, seq: 1, at: '2026-08-14T12:00:00.000Z', source: 'poll', kind: 'waiting',
  id: 's1', cwd: '/home/me/repo', ...o,
})

describe('an event carries facts and nothing else', () => {
  test('the SessionEvent type has no field that could carry an instruction', () => {
    const src = here('event-types.ts')
    // The interface body, so the prose above it is not what is being read.
    const body = src.slice(src.indexOf('export interface SessionEvent'))
    for (const forbidden of ['action', 'command', 'suggest', 'respondWith', 'reply', 'approve', 'answer', 'instruction']) {
      expect(body).not.toMatch(new RegExp(`^\\s*${forbidden}\\??:`, 'm'))
    }
  })

  test('a subscription can ask for DELIVERY, never for an action to be taken', () => {
    const src = here('subscriptions.ts')
    const body = src.slice(src.indexOf('export interface Subscription'), src.indexOf('export function newSubscriptionId'))
    for (const forbidden of ['run', 'exec', 'command', 'script', 'onEvent', 'approve', 'autoApprove', 'answer']) {
      expect(body).not.toMatch(new RegExp(`^\\s*${forbidden}\\??:`, 'm'))
    }
    // Stated positively too, so a reader of this test knows what the shape IS.
    const shape: Record<keyof Subscription, true> = {
      id: true, createdAt: true, task: true, session: true, kinds: true, notify: true,
      desktop: true, note: true,
    }
    expect(Object.keys(shape).sort()).toEqual(
      ['createdAt', 'desktop', 'id', 'kinds', 'note', 'notify', 'session', 'task'],
    )
  })

  test('a serialized event round-trips without acquiring an executable field', () => {
    const line = serializeEvent(ev({ kind: 'waiting-approval', lines: ['Do you want to proceed?'] }))
    const parsed = JSON.parse(line) as Record<string, unknown>
    expect(Object.keys(parsed).sort()).toEqual(['at', 'cwd', 'id', 'kind', 'lines', 'seq', 'source', 'v'])
  })
})

describe('a notification states, and never orders', () => {
  const IMPERATIVES = [
    /\bapprove\b/i, /\bplease\b/i, /\byou should\b/i, /\byou must\b/i, /\bgo ahead\b/i,
    /\brun\s+`/i, /\bpress\b/i, /\bconfirm\b/i, /\ballow it\b/i, /\bsay yes\b/i, /\baccept\b/i,
  ]

  const everySentence = (): string[] => {
    const events = EVENT_KINDS.map(kind => ev({ kind, task: 'canal', label: 'backend', harness: 'claude', lines: ['esc to interrupt'] }))
    return [
      PEER_PREAMBLE,
      peerMessage(events),
      ...events.map(stateSentence),
      ...events.map(eventHeadline),
      ...events.flatMap(e => [desktopText(e).title, desktopText(e).body]),
    ]
  }

  test('no sentence this channel can produce contains an instruction', () => {
    for (const s of everySentence()) {
      for (const bad of IMPERATIVES) {
        // The preamble is allowed to say what may NOT be done; it is the one sentence about the
        // boundary itself. Everything else is held to the plain rule.
        if (s === PEER_PREAMBLE) continue
        expect(s).not.toMatch(bad)
      }
    }
  })

  test('waiting-approval names WHO the prompt is for, and stops there', () => {
    const s = stateSentence(ev({ kind: 'waiting-approval' }))
    expect(s).toContain('permission prompt')
    expect(s).toContain('for a person to answer')
    expect(s).not.toMatch(/\byou\b/i)
  })

  test('the peer preamble states the channel is informational and disclaims approval', () => {
    expect(PEER_PREAMBLE).toContain('informational')
    expect(PEER_PREAMBLE).toContain('carries no instruction')
    expect(PEER_PREAMBLE).toContain('cannot answer a permission prompt')
  })

  test('the preamble travels on EVERY peer message — a compacted context loses a one-off rule', () => {
    expect(peerMessage([ev({})])).toContain(PEER_PREAMBLE)
    expect(peerMessage([ev({ kind: 'exited' }), ev({ kind: 'working' })])).toContain(PEER_PREAMBLE)
  })

  test('several events are ONE message — five sessions finishing interrupt once', () => {
    const msg = peerMessage([ev({ id: 'a' }), ev({ id: 'b' }), ev({ id: 'c' })])
    expect(msg.split(PEER_PREAMBLE)).toHaveLength(2)
  })
})

describe('the screen tail stays on this machine', () => {
  test('nothing in the events modules posts anywhere', () => {
    for (const f of ['event-store.ts', 'producer.ts', 'notifier.ts', 'peer-client.ts', 'desktop.ts']) {
      let src = ''
      try { src = here(f) } catch { continue }
      expect(src).not.toMatch(/\bfetch\s*\(/)
      expect(src).not.toMatch(/https?:\/\/(?!localhost)/)
    }
  })
})
