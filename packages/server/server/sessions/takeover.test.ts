import { describe, it, expect } from 'bun:test'
import { planTakeover } from './takeover'

const base = { conversationId: 'c1', harness: 'claude' as const, resumable: true }

describe('planTakeover', () => {
  it('takes over a conversation a live assistant is holding', () => {
    // The case that produced "abra ela por lá" — a sentence naming a place that, for a background
    // agent, does not exist. Closing the holder satisfies the one-assistant-per-conversation rule
    // exactly; refusing satisfies it by leaving the user with none.
    const plan = planTakeover({
      ...base,
      holder: { pid: 508665, cwd: '/repo/wt', label: 'MAIN' },
    })
    expect(plan).toEqual({
      kind: 'takeover',
      conversationId: 'c1',
      cwd: '/repo/wt',
      holder: { pid: 508665, cwd: '/repo/wt', label: 'MAIN' },
    })
  })

  it('leaves an unheld conversation to the ordinary reopen', () => {
    expect(planTakeover(base)).toEqual({ kind: 'free', conversationId: 'c1' })
  })

  it('refuses BEFORE the kill when the harness cannot resume by id', () => {
    // The ordering is the point. Ending a session and then discovering the conversation cannot be
    // reopened loses work for nothing — and it is exactly what a check written after the kill does.
    const plan = planTakeover({
      ...base, harness: 'gemini', resumable: false, holder: { pid: 1, cwd: '/repo' },
    })
    expect(plan).toEqual({ kind: 'refuse', reason: { code: 'resume-unsupported', harness: 'gemini' } })
  })

  it('refuses when the holder cannot be closed at all', () => {
    // Neither a row of ours nor a pid: nothing to act on. Saying so beats a verb that does nothing.
    const plan = planTakeover({ ...base, holder: { cwd: '/repo', label: 'somebody else' } })
    expect(plan).toEqual({ kind: 'refuse', reason: { code: 'holder-unreachable', label: 'somebody else' } })
  })

  it('refuses when there is nowhere to reopen', () => {
    // A removed worktree. Killing the holder would leave the conversation with no directory to come
    // back in, which is a worse state than the one it started in.
    expect(planTakeover({ ...base, holder: { pid: 1 } }))
      .toEqual({ kind: 'refuse', reason: { code: 'no-cwd' } })
  })

  it('closes one of ours through the BACKEND, not by signal', () => {
    // A managed row has a session to end; killing its pid would leave the backend holding a pane
    // for a process that is gone, which is the `lost` state arriving by our own hand.
    const plan = planTakeover({ ...base, holder: { sessionId: 'a1b2c', cwd: '/repo' } })
    expect(plan.kind).toBe('takeover')
    if (plan.kind !== 'takeover') throw new Error('unreachable')
    expect(plan.holder.sessionId).toBe('a1b2c')
    expect(plan.holder.pid).toBeUndefined()
  })
})
