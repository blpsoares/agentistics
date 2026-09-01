import { describe, expect, it } from 'bun:test'
import {
  INITIAL_CHANNEL,
  canSend,
  channelReducer,
  pendingCount,
  type ChannelState,
} from './terminalChannel'

const open: ChannelState = { ...INITIAL_CHANNEL, armed: true, phase: 'open' }

/** Drive a sequence of actions from a start state. */
function run(start: ChannelState, ...actions: Parameters<typeof channelReducer>[1][]): ChannelState {
  return actions.reduce((s, a) => channelReducer(s, a), start)
}

describe('consent (mirrors #269) — raw typing is an explicit, revocable opt-in', () => {
  it('starts disarmed, idle, with nothing pending', () => {
    expect(INITIAL_CHANNEL).toEqual({ armed: false, phase: 'idle', pending: [], nextId: 1, error: null, undelivered: false })
    expect(canSend(INITIAL_CHANNEL)).toBe(false)
  })

  it('cannot send while disarmed even if a channel were open', () => {
    const s = channelReducer({ ...INITIAL_CHANNEL, phase: 'open' }, { type: 'send' })
    expect(pendingCount(s)).toBe(0)
    expect(canSend(s)).toBe(false)
  })

  it('disarm revokes consent and drops everything (a session you stopped driving keeps nothing)', () => {
    const busy = run(open, { type: 'send' }, { type: 'send' })
    expect(pendingCount(busy)).toBe(2)
    expect(channelReducer(busy, { type: 'disarm' })).toEqual(INITIAL_CHANNEL)
  })
})

describe('channel lifecycle', () => {
  it('can only send while armed AND open', () => {
    expect(canSend({ ...INITIAL_CHANNEL, armed: true, phase: 'connecting' })).toBe(false)
    expect(canSend({ ...INITIAL_CHANNEL, armed: true, phase: 'closed' })).toBe(false)
    expect(canSend(open)).toBe(true)
  })
})

describe('honest delivery (A6) — a key is never accounted delivered until its ack lands', () => {
  it('send adds one pending keystroke, in order, each with a rising id', () => {
    const s = run(open, { type: 'send' }, { type: 'send' })
    expect(s.pending).toEqual([1, 2])
    expect(s.nextId).toBe(3)
  })

  it('an OK ack pops the oldest pending (FIFO — order is guaranteed by the single ordered channel)', () => {
    const s = run(open, { type: 'send' }, { type: 'send' }, { type: 'ack', ok: true })
    expect(s.pending).toEqual([2])
    expect(s.undelivered).toBe(false)
    expect(s.error).toBeNull()
  })

  it('a FAILED ack pops the key and surfaces the verbatim reason, marking undelivered', () => {
    const s = run(open, { type: 'send' }, { type: 'ack', ok: false, reason: 'session gone' })
    expect(s.pending).toEqual([])
    expect(s.undelivered).toBe(true)
    expect(s.error).toBe('session gone')
  })

  it('the channel dropping WITH keys in flight is an honest failure, not silence (A6)', () => {
    const s = run(open, { type: 'send' }, { type: 'send' }, { type: 'closed', reason: 'network lost' })
    expect(s.phase).toBe('closed')
    expect(s.undelivered).toBe(true)
    expect(s.error).toBe('network lost')
    // The in-flight keys are known-not-delivered; they are not left looking pending forever.
    expect(s.pending).toEqual([])
  })

  it('the channel dropping with NOTHING in flight is a clean close, no false alarm', () => {
    const s = run(open, { type: 'send' }, { type: 'ack', ok: true }, { type: 'closed' })
    expect(s.phase).toBe('closed')
    expect(s.undelivered).toBe(false)
    expect(s.error).toBeNull()
  })

  it('reopening the channel clears a prior failure so a fresh attempt starts honest', () => {
    const dropped = run(open, { type: 'send' }, { type: 'closed', reason: 'network lost' })
    const back = run(dropped, { type: 'connecting' }, { type: 'open' })
    expect(back.phase).toBe('open')
    expect(back.undelivered).toBe(false)
    expect(back.error).toBeNull()
    expect(canSend(back)).toBe(true)
  })

  it('a late ack arriving after the channel closed cannot resurrect send-ability', () => {
    const s = run(open, { type: 'send' }, { type: 'closed', reason: 'x' }, { type: 'ack', ok: true })
    expect(canSend(s)).toBe(false)
    expect(s.phase).toBe('closed')
  })
})
