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

describe('one planner, both entrances', () => {
  // `cli-session.ts` (the command line) and `cli-start.ts` (the cockpit) are the SAME gesture
  // written twice, which is the drift `task-reopen.ts` was extracted to end. The cockpit grew its
  // own inline copy of this decision, and the copy was worse: it killed the holder and THEN tried
  // to resume, so a harness that cannot reopen by id would have had its assistant closed for
  // nothing. This pins that both surfaces reach the pure planner.
  const CALLERS = [
    'packages/server/server/sessions/cli-session.ts',
    'packages/server/server/cli-start.ts',
  ]

  it('is reached by every surface that can take a conversation over', async () => {
    const root = new URL('../../../../', import.meta.url).pathname
    for (const rel of CALLERS) {
      const src = await Bun.file(root + rel).text()
      // Phrased so a failure NAMES the file that stopped using it.
      expect(`${rel}: ${src.includes('planTakeover(')}`).toBe(`${rel}: true`)
    }
  })

  it('refuses before signalling, which is the only ordering that cannot lose work', () => {
    // Restated beside the caller check, because the two facts together are the guarantee: one
    // decision, and that decision happens before anything is killed.
    const plan = planTakeover({
      conversationId: 'c1',
      harness: 'gemini',
      resumable: false,
      holder: { pid: 999, cwd: '/repo' },
    })
    expect(plan.kind).toBe('refuse')
  })
})
