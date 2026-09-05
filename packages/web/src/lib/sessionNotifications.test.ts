import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import type { SessionMeta } from '@agentistics/core'
import {
  DEFAULT_NOTIFICATION_SETTINGS, handleSessionStateTransitions, notifyFleetTransitions,
  type SessionActivity,
} from './sessionNotifications'

/**
 * These tests exist because this module reaches the user through the OS: a browser notification and
 * a sound. A wrong number on a chart is read by someone who chose to look at the chart; a wrong
 * notification interrupts whatever they were doing instead. So the two failures pinned here are the
 * two that were live in production — one that fired alerts nobody asked for, and one that put a
 * Portuguese word inside an English sentence.
 */

const STORAGE_KEY = 'agentistics.notifications'

/** A minimal localStorage + Notification, so the module runs outside a browser. */
function installBrowser(): { notifications: Array<{ title: string; body: string }> } {
  const store = new Map<string, string>()
  const notifications: Array<{ title: string; body: string }> = []
  const g = globalThis as Record<string, unknown>
  g.localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => { store.set(k, v) },
    removeItem: (k: string) => { store.delete(k) },
  }
  g.window = g
  class FakeNotification {
    static permission = 'granted'
    constructor(title: string, opts?: { body?: string }) {
      notifications.push({ title, body: opts?.body ?? '' })
    }
  }
  g.Notification = FakeNotification
  // Sound is a no-op here: `playNotificationSound` swallows a missing AudioContext by design.
  store.set(STORAGE_KEY, JSON.stringify({
    ...DEFAULT_NOTIFICATION_SETTINGS,
    enabled: true,
    soundEnabled: false,
    events: { 'waiting-approval': true, waiting: true, working: true, exited: true },
  }))
  return { notifications }
}

const session = (id: string): SessionMeta => ({
  session_id: id,
  project_path: '/home/padawan/agentistics',
  harness: 'claude',
  first_prompt: 'the migration one',
} as SessionMeta)

let captured: Array<{ title: string; body: string }>

beforeEach(() => { captured = installBrowser().notifications })
afterEach(() => {
  const g = globalThis as Record<string, unknown>
  delete g.Notification
  delete g.localStorage
})

const map = new Map([['a', session('a')], ['b', session('b')]])

describe('what counts as news', () => {
  it('says nothing when a state has not changed', () => {
    const same: Record<string, SessionActivity> = { a: 'waiting' }
    handleSessionStateTransitions(same, same, map, 'en')
    expect(captured).toHaveLength(0)
  })

  it('reports a real transition', () => {
    handleSessionStateTransitions({ a: 'working' }, { a: 'waiting-approval' }, map, 'en')
    expect(captured).toHaveLength(1)
    expect(captured[0]!.title).toContain('Needs Approval')
  })

  it('would announce every running session against an EMPTY previous map', () => {
    // The production bug, pinned as the behaviour of this function rather than hidden: with no
    // previous state every session looks new. That is correct HERE — a session that appears really
    // is news — and catastrophic when the caller hands it a cold start, which is why the page now
    // takes a silent baseline on its first poll before it ever calls this. Both halves are needed:
    // if this ever stops firing for genuinely new sessions, the page's guard would hide it.
    handleSessionStateTransitions({}, { a: 'waiting', b: 'waiting-approval' }, map, 'en')
    expect(captured).toHaveLength(2)
  })
})

describe('the language of the sentence', () => {
  it('keeps an English notification entirely English', () => {
    // It read "Session … (CLAUDE CODE em agentistics) is waiting …" — one Portuguese connector in
    // the middle of an English sentence, on a surface people read at a glance.
    handleSessionStateTransitions({ a: 'working' }, { a: 'waiting' }, map, 'en')
    expect(captured[0]!.body).toContain(' in agentistics')
    expect(captured[0]!.body).not.toContain(' em ')
  })

  it('keeps a Portuguese notification Portuguese', () => {
    handleSessionStateTransitions({ a: 'working' }, { a: 'waiting' }, map, 'pt')
    expect(captured[0]!.body).toContain(' em agentistics')
  })
})


describe('the caller that was missing — the live fleet', () => {
  it('announces nothing on the FIRST snapshot, and returns the states to compare against', () => {
    // Opening a machine with nine blocked sessions must not greet the reader with nine toasts
    // about things that happened while they were away.
    const rows = [{ id: 'a', state: 'waiting-approval' }, { id: 'b', state: 'working' }]
    const out = notifyFleetTransitions(null, rows, 'en')
    expect(out).toEqual({ a: 'waiting-approval', b: 'working' })
    expect(captured).toHaveLength(0)
  })

  it('rings on a transition and stays quiet on the level', () => {
    const first = notifyFleetTransitions(null, [{ id: 'a', state: 'working' }], 'en')
    expect(captured).toHaveLength(0)
    const second = notifyFleetTransitions(first, [{ id: 'a', state: 'waiting' }], 'en')
    expect(captured).toHaveLength(1)
    notifyFleetTransitions(second, [{ id: 'a', state: 'waiting' }], 'en')
    expect(captured).toHaveLength(1)
  })

  it('has no words for what a row IS, so those are not events', () => {
    const out = notifyFleetTransitions(null, [
      { id: 'a', state: 'lost' }, { id: 'b', state: 'closed' }, { id: 'c', state: 'unknown' },
    ], 'en')
    expect(out).toEqual({})
  })

  it('names the session from the fleet ROW — it is not a transcript', () => {
    const first = notifyFleetTransitions(null, [
      { id: 'a', state: 'working', title: 'the migration one', cwd: '/home/padawan/agentistics', harness: 'claude' },
    ], 'en')
    notifyFleetTransitions(first, [
      { id: 'a', state: 'waiting', title: 'the migration one', cwd: '/home/padawan/agentistics', harness: 'claude' },
    ], 'en')
    expect(captured[0]?.title).toContain('the migration one')
    expect(captured[0]?.body).toContain('agentistics')
  })
})

describe('a row nobody watched arrive is not an event that happened', () => {
  /**
   * The report: "notificações de sessões FECHADAS estão disparando para sessões que já fecharam."
   *
   * `handleSessionStateTransitions` treats an id absent from the previous map as news, which is
   * correct for the raw diff and wrong for a fleet: rows JOIN and LEAVE this list for reasons that
   * are not the session changing state. A short-lived session can be born and finished inside one
   * poll interval; `collapseSupersededSessions` hides a retired predecessor and can show it again;
   * a row that reads `lost` for one poll leaves the activity map entirely (`lost` has no words
   * here) and returns to `exited` on the next. Every one of those arrives as an id with no
   * previous state, and every one of them rang "[Session Closed]".
   */
  it('does not announce a session first seen already finished', () => {
    const first = notifyFleetTransitions(null, [{ id: 'a', state: 'working' }], 'en')
    notifyFleetTransitions(first, [{ id: 'a', state: 'working' }, { id: 'b', state: 'exited' }], 'en')
    expect(captured).toHaveLength(0)
  })

  it('still announces a session it watched finish', () => {
    const first = notifyFleetTransitions(null, [{ id: 'a', state: 'working' }], 'en')
    notifyFleetTransitions(first, [{ id: 'a', state: 'exited' }], 'en')
    expect(captured).toHaveLength(1)
    expect(captured[0]!.title).toContain('Session Closed')
  })

  it('does not re-announce a finished row that left the list and came back', () => {
    // `lost` carries no words here, so the row drops out of the activity map and returns with no
    // previous state — which is exactly the flapping case, and it rang every time it came back.
    const s1 = notifyFleetTransitions(null, [{ id: 'a', state: 'working' }], 'en')
    const s2 = notifyFleetTransitions(s1, [{ id: 'a', state: 'exited' }], 'en')
    expect(captured).toHaveLength(1)
    const s3 = notifyFleetTransitions(s2, [{ id: 'a', state: 'lost' }], 'en')
    notifyFleetTransitions(s3, [{ id: 'a', state: 'exited' }], 'en')
    expect(captured).toHaveLength(1)
  })

  it('records a first-sighted row so its NEXT change is news', () => {
    const first = notifyFleetTransitions(null, [{ id: 'a', state: 'working' }], 'en')
    const second = notifyFleetTransitions(first, [{ id: 'a', state: 'working' }, { id: 'b', state: 'exited' }], 'en')
    expect(second).toEqual({ a: 'working', b: 'exited' })
  })

  it('makes the ONE exception for a session blocked on a person', () => {
    // Silence on `waiting-approval` costs the session itself: it stays blocked until somebody
    // answers, and there may never be another transition to ring on.
    const first = notifyFleetTransitions(null, [{ id: 'a', state: 'working' }], 'en')
    notifyFleetTransitions(first, [
      { id: 'a', state: 'working' }, { id: 'b', state: 'waiting-approval' },
    ], 'en')
    expect(captured).toHaveLength(1)
    expect(captured[0]!.title).toContain('Needs Approval')
  })
})
