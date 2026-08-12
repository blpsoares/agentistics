/**
 * cli-session.ts — the `agentop session …` handlers.
 *
 * Every decision is already made by a pure module: `parseSessionArgs` says what was asked,
 * `planSpawn` says what to run, `resolveSessionRef` says which session was meant, and
 * `reconcileSessions` says what exists. This file does I/O and prints.
 */

import { HARNESS_ORDER, type HarnessId } from '@agentistics/core'
import { parseSessionArgs, type SessionCommand } from './cli-parse'
import { SPAWN_SPECS, planSpawn } from './spawn-spec'
import { reconcileSessions, resolveSessionRef } from './session-ref'
import { addSession, newSessionId, patchSession, readRegistry, removeSession } from './registry'
import { resolveBackend } from './index'
import type { SessionBackend, SpawnPlanError } from './types'

/** Derived from the specs, never a second hand-written list — the two could not then disagree. */
const STARTABLE: HarnessId[] = HARNESS_ORDER.filter(h => SPAWN_SPECS[h] !== null)

const USAGE = `Usage:
  agentop session <harness> [-p "prompt"] [--bg] [--model <id>] [--effort <level>] [--cwd <path>] [--name "label"]
  agentop session list
  agentop session attach <id|name>
  agentop session kill   <id|name>
  agentop session rename <id|name> "label"
  agentop session note   <id|name> "text"

Harnesses that can be started: ${STARTABLE.join(', ')}`

function explainPlanError(e: SpawnPlanError): string {
  switch (e.code) {
    case 'unsupported-harness':
      return `${e.harness} cannot be started by agentop yet. Supported: ${STARTABLE.join(', ')}.`
    case 'model-unsupported':
      return `${e.harness} has no model flag, so --model cannot be applied.`
    case 'effort-unsupported':
      return `${e.harness} has no effort flag, so --effort cannot be applied.`
    case 'unknown-effort':
      return `${e.harness} does not accept effort "${e.value}". Accepted: ${e.accepted.join(', ')}.`
  }
}

export async function runSession(argv: string[]): Promise<number> {
  const cmd = parseSessionArgs(argv)
  if (cmd.kind === 'help') { console.log(USAGE); return 0 }
  if (cmd.kind === 'error') { console.error(cmd.message); console.error(`\n${USAGE}`); return 1 }

  const backend = await resolveBackend()
  const blocked = await backend.unavailable()
  if (blocked) { console.error(blocked); return 1 }

  switch (cmd.kind) {
    case 'start': return start(cmd, backend)
    case 'list': return list(backend)
    case 'attach': return attach(cmd.ref, backend)
    case 'kill': return kill(cmd.ref, backend)
    case 'rename': return patch(cmd.ref, { label: cmd.label }, 'renamed')
    case 'note': return patch(cmd.ref, { note: cmd.text }, 'annotated')
  }
}

async function start(
  cmd: Extract<SessionCommand, { kind: 'start' }>,
  backend: SessionBackend,
): Promise<number> {
  const cwd = cmd.cwd ?? process.cwd()
  const planned = planSpawn({
    harness: cmd.harness, cwd, prompt: cmd.prompt, model: cmd.model, effort: cmd.effort,
  })
  if (!planned.ok) { console.error(explainPlanError(planned.error)); return 1 }

  const id = newSessionId()
  try {
    await backend.spawn({ id, cwd, argv: planned.plan.argv, ...(planned.plan.sendKeys ? { sendKeys: planned.plan.sendKeys } : {}) })
  } catch (e) {
    console.error(`Could not start the session: ${e instanceof Error ? e.message : String(e)}`)
    return 1
  }

  await addSession({
    id,
    harness: cmd.harness,
    cwd,
    createdAt: new Date().toISOString(),
    ...(cmd.model ? { model: cmd.model } : {}),
    ...(cmd.effort ? { effort: cmd.effort } : {}),
    ...(cmd.label ? { label: cmd.label } : {}),
  })

  if (cmd.background) {
    console.log(`Started ${cmd.harness} session ${id}${cmd.label ? ` (${cmd.label})` : ''} in ${cwd}`)
    console.log(`Attach with: agentop session attach ${id}`)
    return 0
  }
  return execAttach(id, backend)
}

/**
 * Hand the terminal over. The detach key is READ from the backend and printed first — a user who
 * cannot get out is stranded in a buffer that hides their shell, and the key is not always Ctrl-b.
 */
async function execAttach(
  id: string,
  backend: SessionBackend,
): Promise<number> {
  const hint = await backend.detachHint()
  console.log(`Attaching to ${id}. To leave the session running and come back here, press ${hint}.`)
  const [bin, ...rest] = backend.attachCommand(id)
  const p = Bun.spawn([bin!, ...rest], { stdin: 'inherit', stdout: 'inherit', stderr: 'inherit' })
  return await p.exited
}

async function list(backend: SessionBackend): Promise<number> {
  const rows = reconcileSessions(await readRegistry(), await backend.list())
  if (rows.length === 0) { console.log('No sessions.'); return 0 }
  for (const r of rows) {
    const harness = r.managed?.harness ?? 'unknown'
    const name = r.managed?.label ?? ''
    const cwd = r.managed?.cwd ?? ''
    console.log(`${r.id}\t${r.status}\t${harness}\t${name}\t${cwd}`)
  }
  return 0
}

async function attach(ref: string, backend: SessionBackend): Promise<number> {
  const found = resolveSessionRef(await readRegistry(), ref)
  if (!found.ok) { console.error(refError(ref, found.reason, found.matches)); return 1 }
  return execAttach(found.session.id, backend)
}

async function kill(ref: string, backend: SessionBackend): Promise<number> {
  const found = resolveSessionRef(await readRegistry(), ref)
  if (!found.ok) { console.error(refError(ref, found.reason, found.matches)); return 1 }
  await backend.kill(found.session.id)
  await removeSession(found.session.id)
  console.log(`Killed ${found.session.id}.`)
  return 0
}

async function patch(
  ref: string,
  fields: { label?: string; note?: string },
  verb: string,
): Promise<number> {
  const registry = await readRegistry()
  const found = resolveSessionRef(registry, ref)
  if (!found.ok) { console.error(refError(ref, found.reason, found.matches)); return 1 }
  // The registry was read before this write, and writes are queued — a concurrent `kill` can
  // remove the session in between, so the patch itself is the only source of truth on success.
  const applied = await patchSession(found.session.id, fields)
  if (!applied) { console.error(refError(ref, 'not-found', [])); return 1 }
  console.log(`${found.session.id} ${verb}.`)
  return 0
}

function refError(ref: string, reason: 'not-found' | 'ambiguous', matches: string[]): string {
  return reason === 'not-found'
    ? `No session matches "${ref}". Run \`agentop session list\` to see them.`
    : `"${ref}" matches more than one session: ${matches.join(', ')}. Use a full id.`
}
