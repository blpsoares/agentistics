/**
 * harness-install.ts — which of the harnesses agentop knows how to spawn can actually run HERE.
 *
 * `SPAWN_SPECS` answers a different question: "do we know this CLI's argv". That is the right rule
 * for whether agentop could EVER start a harness, and it says nothing about whether `spec.bin`
 * resolves on this machine's PATH. Offering a harness that is not installed produces a tmux session
 * that dies immediately on `command not found`, on a screen nobody is looking at — the wizard's
 * version of a confident `0` where the honest answer is that the thing is not there.
 *
 * So this is the ONE resolution both front doors consult — the cockpit's wizard, through
 * `ControlHost.startableHarnesses`, and `agentop session` — for the same reason `task-reopen.ts`
 * exists: one gesture implemented twice is two sets of rules that drift.
 *
 * `resolveStartable` is PURE over an injected probe; `binOnPath` is the only IO here, and it is
 * CACHED because the wizard, the fleet API and every spawn ask the same six questions. The cache
 * expires rather than being held for the life of the process: installing a CLI while the cockpit is
 * open is the plausible event, and a list that stays wrong until the app is restarted is the same
 * dishonesty in the other direction.
 */

import { HARNESS_ORDER, type HarnessId } from '@agentistics/core'
import { SPAWN_SPECS } from './spawn-spec'
import type { SpawnSpec } from './types'

/** A harness agentop can spawn AND whose CLI resolves here. */
export interface InstalledHarness {
  id: HarnessId
  bin: string
  spec: SpawnSpec
}

/** A harness agentop can spawn but whose CLI does not resolve here, and the command that would. */
export interface MissingHarness {
  id: HarnessId
  bin: string
}

export interface StartableHere {
  /** Offer these. In `HARNESS_ORDER`, like every other harness list in the product. */
  installed: InstalledHarness[]
  /**
   * Do NOT offer these — but NAME them when there is nothing to offer. A wizard that opens on an
   * empty list is indistinguishable from a broken one, and the bin is the only actionable fact
   * about the absence.
   */
  missing: MissingHarness[]
}

/**
 * PURE. Split the spawnable harnesses by whether their CLI resolves, given a probe.
 *
 * A harness with no spawn spec is in NEITHER list: "agentop does not know how to start it" is a
 * different sentence from "it is not installed here", and `planSpawn` already owns the first one.
 */
export function resolveStartable(onPath: (bin: string) => boolean): StartableHere {
  const installed: InstalledHarness[] = []
  const missing: MissingHarness[] = []
  for (const id of HARNESS_ORDER) {
    const spec = SPAWN_SPECS[id]
    if (!spec) continue
    if (onPath(spec.bin)) installed.push({ id, bin: spec.bin, spec })
    else missing.push({ id, bin: spec.bin })
  }
  return { installed, missing }
}

/** PURE. The bin this harness needs, or null when agentop cannot spawn it at all. */
export function harnessBin(id: HarnessId): string | null {
  return SPAWN_SPECS[id]?.bin ?? null
}

// ---------------------------------------------------------------------------
// The one piece of IO
// ---------------------------------------------------------------------------

/**
 * Short enough that installing a CLI is picked up without restarting the cockpit, long enough that
 * a burst of questions — the wizard mounting, then a spawn — costs one PATH walk per command.
 */
const PROBE_TTL_MS = 30_000

const probed = new Map<string, { at: number; found: boolean }>()

/** Does this command resolve on PATH? Cached, never throws — an error means "not found". */
export function binOnPath(bin: string, now = Date.now()): boolean {
  const hit = probed.get(bin)
  if (hit && now - hit.at < PROBE_TTL_MS) return hit.found
  let found = false
  try {
    found = Bun.which(bin) !== null
  } catch {
    found = false
  }
  probed.set(bin, { at: now, found })
  return found
}

/** Forget every probe. Exists for tests and for a caller that has just installed something. */
export function forgetProbes(): void {
  probed.clear()
}

/** What this machine can start right now. */
export function startableHere(): StartableHere {
  return resolveStartable(b => binOnPath(b))
}

/**
 * The missing command that stops this harness from starting here, or null when it can start.
 *
 * Null for a harness with no spawn spec too: that refusal belongs to `planSpawn`, which names it
 * exactly, and answering "not installed" over it would send someone to install a CLI that agentop
 * still would not drive.
 */
export function missingBin(id: HarnessId): string | null {
  const bin = harnessBin(id)
  if (!bin) return null
  return binOnPath(bin) ? null : bin
}
