import { describe, expect, it } from 'bun:test'
import { QUIET_MS, attentionOf, digestFrame } from './attention'
import type { AttentionRules } from './types'

const NOW = 1_786_600_000_000

const rules: AttentionRules = {
  probed: 'test',
  approval: [/Enter to confirm/],
  working: [/esc to interrupt/],
}

/** Everything the function needs, with the session plainly quiet and unremarkable. */
const base = {
  alive: true,
  lastActivityMs: NOW - 60_000,
  nowMs: NOW,
  frame: ['idle'] as readonly string[],
  frameDigest: 'same',
  prevDigest: 'same',
}

describe('digestFrame', () => {
  it('is stable for the same frame', () => {
    expect(digestFrame(['a', 'b'])).toBe(digestFrame(['a', 'b']))
  })

  it('changes when the frame changes', () => {
    expect(digestFrame(['a', 'b'])).not.toBe(digestFrame(['a', 'c']))
  })

  it('does not collide across a line boundary shift', () => {
    // ['ab'] and ['a','b'] must differ: a digest that joined without a separator would call a
    // reflowed frame unchanged and report a working session as waiting.
    expect(digestFrame(['ab'])).not.toBe(digestFrame(['a', 'b']))
  })
})

describe('attentionOf', () => {
  it('reports a finished command as exited, whatever is on screen', () => {
    expect(attentionOf({ ...base, alive: false, frame: ['esc to interrupt'], rules })).toBe('exited')
  })

  it('reports an approval question even while the frame is moving', () => {
    // A blocked dialog outranks movement: nothing is running behind it, and a spinner elsewhere on
    // the screen must never hide the question.
    expect(attentionOf({
      ...base, frame: ['Enter to confirm · Esc to cancel'], frameDigest: 'new', rules,
    })).toBe('waiting-approval')
  })

  it('reports working from a proof marker even when the frame did not move', () => {
    expect(attentionOf({ ...base, frame: ['esc to interrupt'], rules })).toBe('working')
  })

  it('reports working when the frame changed since the last poll', () => {
    expect(attentionOf({ ...base, frameDigest: 'new', prevDigest: 'old', rules })).toBe('working')
  })

  it('reports working when the backend saw output inside the quiet window', () => {
    expect(attentionOf({ ...base, lastActivityMs: NOW - (QUIET_MS - 1), rules })).toBe('working')
  })

  it('reports waiting once the window has passed and nothing moved', () => {
    expect(attentionOf({ ...base, lastActivityMs: NOW - QUIET_MS, rules })).toBe('waiting')
  })

  it('still decides without any rules — movement alone is enough', () => {
    expect(attentionOf({ ...base, frameDigest: 'new', prevDigest: 'old' })).toBe('working')
    expect(attentionOf({ ...base })).toBe('waiting')
  })

  it('does not call a first sighting working just because there is no previous digest', () => {
    // The first poll of a long-quiet session has no prevDigest. Treating "unknown" as "changed"
    // would show every session as working for one interval after the cockpit opens.
    expect(attentionOf({ ...base, prevDigest: undefined })).toBe('waiting')
  })
})
