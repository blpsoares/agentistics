/**
 * verbs.ts — what STARTING and KILLING a managed session DO, with nothing said out loud.
 *
 * Two front ends perform these verbs: `cli-session.ts`, which prints in English, and the control
 * center's host (`cli-start.ts`), which returns an already-localized `ActionResult`. Everything
 * they share is here and everything they say is theirs — so the outcome each reports is a wording
 * choice and never a second implementation.
 *
 * The subtleties this exists to state once:
 *  - a relative `cwd` is resolved against the CALLER's directory, before it can reach a backend
 *    that would read it against its own;
 *  - a plan error and a spawn failure are different answers, and neither is a thrown exception;
 *  - an unconfirmed kill clears the registry only for a session the reconciled view already knew
 *    was not running, so a live session is never turned into one nothing can name again.
 */

import { resolve } from 'node:path'
import { addSession, newSessionId, readRegistry, removeSession } from './registry'
import { reconcileSessions } from './session-ref'
import { planSpawn } from './spawn-spec'
import type { SessionBackend, SpawnPlanError, SpawnRequest } from './types'

export type SessionStartResult =
  | { ok: true; id: string }
  /** The request itself cannot be honoured — an unsupported harness, a flag the CLI does not have. */
  | { ok: false; kind: 'plan'; error: SpawnPlanError }
  /** The backend refused. `message` is the backend's own words, which are not localizable. */
  | { ok: false; kind: 'spawn'; message: string }

/**
 * Plan, spawn and register — in that order, because each step's failure means something different.
 *
 * The session is registered only after the backend confirms it exists: a registry entry for a
 * session that never started is a row the user cannot attach to, kill or explain.
 */
export async function startManagedSession(
  req: SpawnRequest,
  backend: SessionBackend,
): Promise<SessionStartResult> {
  // A relative cwd must resolve against the CALLER's directory: passed through unresolved it
  // reaches `tmux new-session -c` and is interpreted by the tmux SERVER's own cwd instead, and it
  // is written verbatim into the registry, where it would read back meaningless from anywhere else.
  const cwd = resolve(req.cwd)
  const planned = planSpawn({ ...req, cwd })
  if (!planned.ok) return { ok: false, kind: 'plan', error: planned.error }

  const id = newSessionId()
  try {
    await backend.spawn({
      id,
      cwd,
      argv: planned.plan.argv,
      ...(planned.plan.sendKeys ? { sendKeys: planned.plan.sendKeys } : {}),
    })
  } catch (e) {
    return { ok: false, kind: 'spawn', message: e instanceof Error ? e.message : String(e) }
  }

  await addSession({
    id,
    harness: req.harness,
    cwd,
    createdAt: new Date().toISOString(),
    ...(req.model ? { model: req.model } : {}),
    ...(req.effort ? { effort: req.effort } : {}),
    ...(req.label ? { label: req.label } : {}),
  })
  return { ok: true, id }
}

export type SessionKillResult =
  /** Gone, and its registry entry with it. */
  | 'killed'
  /** The backend would not confirm it is gone, so the registry entry was KEPT. */
  | 'unconfirmed'
  /** Neither the registry nor the backend has ever heard of this id. */
  | 'not-found'

/**
 * Kill a session and forget it.
 *
 * The reconciled status is read BEFORE the kill because it is what makes an unconfirmed answer
 * safe to act on: a session that was already `lost` (the backend has nothing by this id — there was
 * never anything for `kill` to do) or `exited` (the hosted command already finished) can have its
 * entry cleared on a report we cannot trust, because we knew nothing was running. That is the
 * fallback, not the common path — an ordinary kill still relies on the backend's confirmation, so
 * a real failure never gets papered over.
 */
export async function killManagedSession(
  id: string,
  backend: SessionBackend,
): Promise<SessionKillResult> {
  const reconciled = reconcileSessions(await readRegistry(), await backend.list())
  const before = reconciled.find(r => r.id === id)?.status
  if (before === undefined) return 'not-found'

  const confirmed = await backend.kill(id)
  if (!confirmed && before !== 'lost' && before !== 'exited') return 'unconfirmed'

  await removeSession(id)
  return 'killed'
}
