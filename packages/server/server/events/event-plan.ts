/**
 * event-plan.ts — PURE. Which transitions become events, and what those events say.
 *
 * ## A transition, never a level
 *
 * The rule is `bellTransitions`' rule, applied to a wider set of states: an event is written when a
 * session's state is DIFFERENT from what it was, and never because it is still what it was. The
 * poll runs every five seconds; a session sitting on a permission prompt for ten minutes is one
 * event, not a hundred and twenty.
 *
 * ## A state that lasted one frame is a flicker, not a state
 *
 * This is the rule the rest of the module is shaped around, and it was written after watching the
 * channel get it wrong on a real fleet. A session that had finished answering reported `waiting` at
 * 13:12:20 and again at 13:12:30. In between, its pane repainted — a tmux advisory line appeared at
 * the bottom — and a frame that MOVED is the only universal proof of work there is, so
 * `attention.ts` correctly read the repaint as `working` and the next frame as `waiting` again.
 * Nothing about the session had changed. It happened again forty-five seconds later when a plugin
 * printed a notice into the same pane.
 *
 * For the cockpit that is a badge flickering for five seconds and nobody minds. For a channel that
 * interrupts a person and another assistant, it is the failure this whole feature is judged on: a
 * duplicate notification is how people learn to ignore notifications.
 *
 * The fix is NOT a time window. The first attempt was one, and the second flicker landed outside
 * it — a wall clock cannot separate "the screen twitched" from "a short turn happened", and any
 * window wide enough to catch the twitch also swallows a genuine follow-up turn, which is the
 * primary thing this channel exists to report. So the rule uses the signal itself: **a state counts
 * only once it has been observed on two consecutive polls.** A cosmetic repaint is one frame and is
 * never confirmed; real work holds the screen for longer than one five-second interval. Events are
 * compared against the last CONFIRMED state, so `waiting → (blip) → waiting` is not a transition at
 * all, while `waiting → working → waiting` across several polls is two.
 *
 * What it costs, stated plainly: a turn that begins and ends inside a single poll interval is
 * invisible to this source. That is precisely the case the Claude `Stop` hook covers exactly, which
 * is a large part of why the hook exists — and for the other five harnesses, a sub-five-second turn
 * is not something a five-second poll was ever going to see.
 *
 * It is deliberately not a change to `attention.ts`. "The screen moved, so it is working" is the
 * right rule for the fleet monitor and the only signal several harnesses give; narrowing it there
 * would blind the cockpit to real work in order to quieten a notification.
 *
 * ## Why the first sighting is not an event
 *
 * A producer that has just come up has no previous state for anyone, so nothing can be said to have
 * changed. Emitting on first sighting would mean every restart replays the whole fleet into the
 * inbox — the reader would see five sessions "start waiting" at the moment a daemon was bounced,
 * which is a lie about the world told by a fact about the process. `seedMemory` exists for exactly
 * this: a producer records where everyone IS, and reports only what happens next.
 */

import type { SessionActivity } from '../sessions/types'
import {
  EVENT_VERSION,
  type EventCandidate,
  type EventKind,
  type SessionEvent,
} from './event-types'

/**
 * What the producer carries between polls.
 *
 * Two maps, because they answer two different questions. `lastSeen` is the raw reading of the
 * previous poll and exists only to decide whether the current reading is CONFIRMED. `confirmed` is
 * the state the channel currently believes the session is in, and is what a new reading is compared
 * against.
 */
export interface EventMemory {
  lastSeen: ReadonlyMap<string, SessionActivity>
  confirmed: ReadonlyMap<string, SessionActivity>
}

export const EMPTY_MEMORY: EventMemory = { lastSeen: new Map(), confirmed: new Map() }

/** An activity is an event kind of the same name. Separate types, one mapping, stated once. */
function kindOf(a: SessionActivity): EventKind {
  return a
}

export interface PlanResult {
  /** The events this poll produces. `seq` is left at 0 — the inbox stamps it on append. */
  events: SessionEvent[]
  /** What to carry into the next poll. */
  memory: EventMemory
}

/**
 * The events this poll produces, and the memory for the next one — PURE.
 *
 * `kinds` narrows what is WRITTEN, never what is tracked: the memory advances on every confirmed
 * change whether or not anybody subscribed to it, or a `working` nobody asked for would leave the
 * channel believing the session is still `waiting` and swallow the real `waiting` that follows.
 */
export function planEvents(o: {
  memory: EventMemory
  sessions: readonly EventCandidate[]
  nowIso: string
  /** Only these kinds are written. Defaults to everything. */
  kinds?: readonly EventKind[]
}): PlanResult {
  const wanted = o.kinds
  const events: SessionEvent[] = []
  const lastSeen = new Map<string, SessionActivity>()
  const confirmed = new Map<string, SessionActivity>()

  for (const s of o.sessions) {
    if (!s.activity) continue
    lastSeen.set(s.id, s.activity)

    const was = o.memory.confirmed.get(s.id)
    // Sessions the producer has never confirmed anything about carry nothing forward until they
    // are confirmed — an unconfirmed reading is not yet a state, so it is not yet a belief either.
    if (was !== undefined) confirmed.set(s.id, was)

    // Not yet held for two polls: a flicker, and nothing is said or believed about it.
    if (o.memory.lastSeen.get(s.id) !== s.activity) continue

    // Confirmed. Advance what the channel believes, whatever the kind filter goes on to do.
    confirmed.set(s.id, s.activity)
    if (was === undefined) continue // first confirmation — see the header
    if (was === s.activity) continue

    const kind = kindOf(s.activity)
    if (wanted && !wanted.includes(kind)) continue

    events.push({
      v: EVENT_VERSION,
      seq: 0,
      at: o.nowIso,
      source: 'poll',
      kind,
      from: was,
      id: s.id,
      ...(s.harness ? { harness: s.harness } : {}),
      cwd: s.cwd,
      ...(s.task ? { task: s.task } : {}),
      ...(s.label ? { label: s.label } : {}),
      ...(s.conversationId ? { conversationId: s.conversationId } : {}),
      ...(s.lines && s.lines.length > 0 ? { lines: s.lines } : {}),
    })
  }

  // Only sessions still on screen are carried, so the memory cannot grow with every session the
  // machine has ever hosted.
  return { events, memory: { lastSeen, confirmed } }
}

/**
 * Where the fleet is right now, as a producer's opening belief.
 *
 * Both maps are filled from one reading: the point of seeding is that these states are already
 * true and must not be reported, so they are treated as confirmed even though they have been seen
 * once. Sessions with no activity are omitted rather than stored as undefined — an external row
 * carries no activity at all (nothing about it is capturable), and remembering "it was nothing"
 * would make its first real reading look like a transition the moment it acquired one.
 */
export function seedMemory(sessions: readonly EventCandidate[]): EventMemory {
  const m = new Map<string, SessionActivity>()
  for (const s of sessions) if (s.activity) m.set(s.id, s.activity)
  return { lastSeen: m, confirmed: new Map(m) }
}
