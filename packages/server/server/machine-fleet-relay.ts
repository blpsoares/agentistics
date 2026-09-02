/**
 * machine-fleet-relay.ts — the CENTRAL side of asking one machine for its fleet.
 *
 * Everything on the reverse channel before this was one-directional and uncorrelated:
 * `notifyMember` pushes and forgets, and the member's own frames (`live-sessions`,
 * `remote-consent`) are unsolicited statements about the machine that sent them. A relay needs a
 * QUESTION and an answer that can be matched to it, which is the one piece of new mechanism this
 * feature adds — so it is deliberately the narrowest thing that works, and not a general RPC.
 *
 * The rules, each mirroring one this channel already follows:
 *
 *  - **One in flight per machine.** A central that can queue work on a member is a central that
 *    can wedge it. A second request while one is open joins the SAME promise rather than opening
 *    another: two dashboards polling the same machine is the normal case, not an abuse.
 *  - **A timeout, always.** A member that never answers (an older build with no handler, a wedged
 *    process) must resolve to a SENTENCE and not to a hung request. That timeout is the only
 *    signal distinguishing "silent" from "refused", so it is the reason `silent` exists as its own
 *    reason code.
 *  - **A reply with no matching in-flight request is DROPPED.** An unsolicited `fleet-reply` is
 *    not a fact about anything, and accepting one would let a member push a fleet nobody asked for
 *    into whatever read next.
 *  - **The machine id comes from the AUTHENTICATED SOCKET**, never from the frame — the same rule
 *    `recordMemberLive` and `recordMachineConsent` follow, so a member cannot answer for another
 *    machine. This module therefore keys pending requests by machine AND rid, and a reply is only
 *    accepted from the machine the question was sent to.
 *
 * Nothing here is persisted. A fleet is true for the next few seconds, exactly like `team-live`'s
 * snapshots, and a cached one would be a confident answer about a machine that has since gone.
 */

import type { MachineFleetReply } from '@agentistics/core'

/** How long a machine has to answer before the central reports it as silent. Generous next to the
 *  5s poll a cockpit runs, because the member builds a real fleet (a tmux round trip per session)
 *  and a timeout that fires while the answer is still coming would report a healthy machine as
 *  broken — the failure this whole reason code exists to avoid making. */
export const FLEET_REPLY_TIMEOUT_MS = 12_000

interface Pending {
  rid: string
  resolve: (reply: MachineFleetReply | null) => void
  timer: ReturnType<typeof setTimeout>
  /** Everyone waiting on THIS question. A second asker joins rather than opening a second one. */
  promise: Promise<MachineFleetReply | null>
}

const pending = new Map<string, Pending>()
let ridSeq = 0

function nextRid(): string {
  ridSeq += 1
  return `f${Date.now().toString(36)}${ridSeq.toString(36)}`
}

/**
 * Ask one machine for its fleet and wait for the answer.
 *
 * Resolves to `null` on a timeout — "this machine did not answer" — which the route turns into the
 * `silent` reason. It never throws: a relay that rejects would surface as a 500 on a route whose
 * whole job is to say, in words, why there is nothing to show.
 */
export function requestMachineFleet(
  machineId: string,
  send: (payload: Record<string, unknown>) => void,
  timeoutMs: number = FLEET_REPLY_TIMEOUT_MS,
): Promise<MachineFleetReply | null> {
  const existing = pending.get(machineId)
  // Two dashboards polling one machine is the normal case. Joining the open question costs the
  // member nothing; opening a second one asks it to build the same fleet twice.
  if (existing) return existing.promise

  const rid = nextRid()
  let settle: (reply: MachineFleetReply | null) => void = () => {}
  const promise = new Promise<MachineFleetReply | null>(res => { settle = res })

  const finish = (reply: MachineFleetReply | null) => {
    const p = pending.get(machineId)
    if (!p || p.rid !== rid) return
    clearTimeout(p.timer)
    pending.delete(machineId)
    p.resolve(reply)
  }

  const timer = setTimeout(() => finish(null), timeoutMs)
  timer.unref?.()
  pending.set(machineId, { rid, resolve: settle, timer, promise })

  try {
    send({ type: 'fleet-request', rid })
  } catch {
    // The socket died between the presence check and the send. Resolve as silence rather than
    // leaving the caller on the timeout — the answer is the same, sooner.
    finish(null)
  }
  return promise
}

/**
 * A machine answered. `machineId` MUST come from the authenticated socket.
 *
 * Returns whether the reply was matched, so the caller can tell an answer from noise; an unmatched
 * one is dropped rather than stored, because a reply nobody asked for is not a fact about anything.
 */
export function acceptMachineFleetReply(machineId: string, rid: unknown, reply: unknown): boolean {
  const p = pending.get(machineId)
  if (!p) return false
  if (typeof rid !== 'string' || rid !== p.rid) return false
  clearTimeout(p.timer)
  pending.delete(machineId)
  p.resolve(normalizeReply(reply))
  return true
}

/**
 * Trust nothing about the shape. The member is authenticated, not verified: a malformed reply must
 * degrade to an empty fleet with the counts it could establish, never crash the route or render as
 * `undefined` cells. A row list that is not an array is not "no sessions" — but there is nothing
 * else it can be reported as here, so `withheld` and `attention` are still carried through when
 * they are numbers, and the reason is the machine's own `unavailable` sentence when it sent one.
 */
function normalizeReply(raw: unknown): MachineFleetReply | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const r = raw as Record<string, unknown>
  return {
    rows: Array.isArray(r.rows) ? (r.rows as MachineFleetReply['rows']) : [],
    attention: typeof r.attention === 'number' && r.attention >= 0 ? r.attention : 0,
    withheld: typeof r.withheld === 'number' && r.withheld >= 0 ? r.withheld : 0,
    ...(typeof r.unavailable === 'string' && r.unavailable ? { unavailable: r.unavailable } : {}),
  }
}

/** A machine's socket dropped — nobody is going to answer. Resolves any open question at once
 *  instead of making its asker wait out the timeout for an answer that cannot come. */
export function abandonMachineFleet(machineId: string): void {
  const p = pending.get(machineId)
  if (!p) return
  clearTimeout(p.timer)
  pending.delete(machineId)
  p.resolve(null)
}

/** Test seam — the map is process-global, like every other registry on this channel. */
export function resetMachineFleetRelay(): void {
  for (const p of pending.values()) { clearTimeout(p.timer); p.resolve(null) }
  pending.clear()
}
