/**
 * The fleet's confirmed activity (`attention-confirm.ts`) and the event channel (`event-plan.ts`)
 * must AGREE on the reported harm: neither may raise `waiting` from a single-frame blip. They use
 * different confirmation rules on purpose — the fleet clears attention a poll sooner than the
 * notification stream — so this pins the ONE thing they must never disagree about, and documents the
 * one thing they legitimately do.
 */
import { describe, expect, it } from 'bun:test'
import type { SessionActivity } from './types'
import { EMPTY_CONFIRM_MEMORY, confirmActivities, type ConfirmMemory } from './attention-confirm'
import { EMPTY_MEMORY, planEvents, type EventMemory } from '../events/event-plan'

/** Raw readings across a sequence of polls, for one session `a`. */
const BLIP: SessionActivity[] = ['waiting', 'waiting', 'working', 'waiting', 'waiting']

describe('fleet confirmation and the event channel agree on the reported harm', () => {
  it('neither believes `waiting` from a one-frame quiet after work', () => {
    // A session confirmed working, then exactly one poll reads quiet, then it moves again.
    const raw: SessionActivity[] = ['working', 'working', 'waiting', 'working']

    // Fleet: the single quiet frame never becomes the shown state.
    let fm: ConfirmMemory = EMPTY_CONFIRM_MEMORY
    const fleetStates = raw.map(a => {
      const r = confirmActivities(fm, new Map([['a', a]]))
      fm = r.memory
      return r.activities.get('a')
    })
    expect(fleetStates).not.toContain('waiting')

    // Events: no `waiting` event is ever emitted for that blip.
    let em: EventMemory = EMPTY_MEMORY
    const emitted: SessionActivity[] = []
    for (const a of raw) {
      const r = planEvents({ memory: em, sessions: [{ id: 'a', cwd: '/x', activity: a }], nowIso: '2026-08-28T00:00:00.000Z' })
      em = r.memory
      for (const e of r.events) emitted.push(e.kind as SessionActivity)
    }
    expect(emitted).not.toContain('waiting')
  })

  it('both raise `waiting` only after it holds for two consecutive polls', () => {
    // The genuine wait: a repaint blips `working` for one poll in the middle of a wait. Neither the
    // fleet nor the events channel should treat that blip as the wait ending and restarting.
    let fm: ConfirmMemory = EMPTY_CONFIRM_MEMORY
    let em: EventMemory = EMPTY_MEMORY
    let fleetWaitingCount = 0
    let waitingEvents = 0
    for (const a of BLIP) {
      const rf = confirmActivities(fm, new Map([['a', a]]))
      fm = rf.memory
      if (rf.activities.get('a') === 'waiting') fleetWaitingCount++

      const re = planEvents({ memory: em, sessions: [{ id: 'a', cwd: '/x', activity: a }], nowIso: '2026-08-28T00:00:00.000Z' })
      em = re.memory
      waitingEvents += re.events.filter(e => e.kind === 'waiting').length
    }
    // The fleet SHOWS waiting on the polls where it is confirmed (it seeds `waiting` as a first
    // sighting, holds through the blip, and re-confirms) — but it never spikes on the lone `working`.
    expect(fleetWaitingCount).toBeGreaterThan(0)
    // The event channel emits at most the single genuine `waiting` transition after the blip, never a
    // duplicate per twitch. (Seeded first sighting emits nothing; the blip is one frame; the return
    // to waiting is one confirmed transition.)
    expect(waitingEvents).toBeLessThanOrEqual(1)
  })
})
