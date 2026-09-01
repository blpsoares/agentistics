import { describe, expect, it } from 'bun:test'
import {
  INITIAL_COMPOSER,
  canEdit,
  canSubmit,
  composerReducer,
  interactionBlock,
  type ComposerState,
} from './terminalInput'

const armed: ComposerState = { armed: true, draft: '', status: 'idle', error: null }

describe('consent (decision 1) — explicit, per-session, revocable', () => {
  it('starts disarmed and empty', () => {
    expect(INITIAL_COMPOSER).toEqual({ armed: false, draft: '', status: 'idle', error: null })
  })

  it('refuses to edit or submit while disarmed', () => {
    // A viewer who never armed the session cannot type into it, even by dispatching directly.
    expect(canEdit(INITIAL_COMPOSER)).toBe(false)
    expect(canSubmit(INITIAL_COMPOSER)).toBe(false)
    expect(composerReducer(INITIAL_COMPOSER, { type: 'edit', draft: 'ls' })).toEqual(INITIAL_COMPOSER)
    expect(composerReducer(INITIAL_COMPOSER, { type: 'submit' })).toEqual(INITIAL_COMPOSER)
  })

  it('arm turns typing on and starts from a clean line', () => {
    expect(composerReducer(INITIAL_COMPOSER, { type: 'arm' })).toEqual(armed)
    expect(canEdit(armed)).toBe(true)
  })

  it('arm never wipes a line already in progress', () => {
    const typing: ComposerState = { armed: true, draft: 'half a command', status: 'idle', error: null }
    expect(composerReducer(typing, { type: 'arm' })).toEqual(typing)
  })

  it('disarm revokes consent and drops the draft (a revoked session keeps no pending line)', () => {
    const typing: ComposerState = { armed: true, draft: 'rm -rf', status: 'failed', error: 'nope' }
    expect(composerReducer(typing, { type: 'disarm' })).toEqual(INITIAL_COMPOSER)
  })
})

describe('batched-to-a-line + lock (decision 2) — one atomic send, never mid-flight', () => {
  it('will not submit an empty or whitespace-only line', () => {
    expect(canSubmit(armed)).toBe(false)
    expect(canSubmit({ ...armed, draft: '   ' })).toBe(false)
    expect(canSubmit({ ...armed, draft: 'echo hi' })).toBe(true)
  })

  it('locks editing and submitting while a send is in flight (no reorder, no race)', () => {
    const sending: ComposerState = { armed: true, draft: 'echo hi', status: 'sending', error: null }
    expect(canEdit(sending)).toBe(false)
    expect(canSubmit(sending)).toBe(false)
    expect(composerReducer(sending, { type: 'edit', draft: 'echo hi more' })).toEqual(sending)
    expect(composerReducer(sending, { type: 'submit' })).toEqual(sending)
  })

  it('submit moves a non-empty line into the sending state', () => {
    const ready: ComposerState = { ...armed, draft: 'echo hi' }
    expect(composerReducer(ready, { type: 'submit' })).toEqual({ ...ready, status: 'sending', error: null })
  })
})

describe('honest delivery (decision 3) — a key is never accepted-then-lost', () => {
  it('a delivered line clears the draft and stays armed for the next line', () => {
    const sending: ComposerState = { armed: true, draft: 'echo hi', status: 'sending', error: null }
    expect(composerReducer(sending, { type: 'sent', ok: true, message: 'delivered' })).toEqual({
      armed: true, draft: '', status: 'idle', error: null,
    })
  })

  it('a FAILED line is preserved verbatim and marked failed with the reason (never silently dropped)', () => {
    const sending: ComposerState = { armed: true, draft: 'echo hi', status: 'sending', error: null }
    expect(composerReducer(sending, { type: 'sent', ok: false, message: 'session is not running' })).toEqual({
      armed: true, draft: 'echo hi', status: 'failed', error: 'session is not running',
    })
  })

  it('editing after a failure clears the failed marker (a fresh attempt), keeping the text', () => {
    const failed: ComposerState = { armed: true, draft: 'echo hi', status: 'failed', error: 'boom' }
    expect(composerReducer(failed, { type: 'edit', draft: 'echo hi!' })).toEqual({
      armed: true, draft: 'echo hi!', status: 'idle', error: null,
    })
    // a failed line can be re-submitted as-is
    expect(canSubmit(failed)).toBe(true)
  })

  it('a send result that lands after the user disarmed is ignored (no resurrection)', () => {
    const disarmedMidFlight = INITIAL_COMPOSER
    expect(composerReducer(disarmedMidFlight, { type: 'sent', ok: true, message: 'delivered' })).toEqual(INITIAL_COMPOSER)
    expect(composerReducer(disarmedMidFlight, { type: 'sent', ok: false, message: 'boom' })).toEqual(INITIAL_COMPOSER)
  })

  it('a result only lands while a send is actually in flight', () => {
    // An 'idle' armed composer (nothing sending) ignores a stray result.
    expect(composerReducer(armed, { type: 'sent', ok: false, message: 'boom' })).toEqual(armed)
  })
})

describe('interactionBlock — when the row cannot be typed into', () => {
  it('maps each fleet state to its block reason (or null when typable)', () => {
    expect(interactionBlock('working')).toBe(null)
    expect(interactionBlock('waiting')).toBe(null)
    expect(interactionBlock('waiting-approval')).toBe('awaiting-approval')
    expect(interactionBlock('exited')).toBe('not-running')
    expect(interactionBlock('lost')).toBe('not-running')
    expect(interactionBlock('closed')).toBe('not-running')
    expect(interactionBlock('unknown')).toBe('external')
  })
})
