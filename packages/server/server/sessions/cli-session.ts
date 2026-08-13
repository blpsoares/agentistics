/**
 * cli-session.ts — the `agentop session …` handlers.
 *
 * Every decision is already made beneath it: `parseSessionArgs` says what was asked,
 * `resolveSessionRef` says which session was meant, `reconcileSessions` says what exists, and
 * `verbs.ts` performs the start and the kill — the same code the control center's host runs, so
 * the two front ends can differ in what they SAY and never in what they do.
 *
 * This file does I/O and prints, in English. The control center is the surface that follows the
 * user's language.
 */

import { resolve } from 'node:path'
import { cliStrings, explainSpawnError } from '../cli-i18n'
import { parseSessionArgs, type SessionCommand } from './cli-parse'
import { STARTABLE_HARNESSES as STARTABLE } from './spawn-spec'
import { reconcileSessions, resolveSessionRef, type ReconciledSession, type RefCandidate } from './session-ref'
import { patchSession, readRegistry } from './registry'
import { killManagedSession, startManagedSession } from './verbs'
import { resolveBackend } from './index'
import type { SessionBackend } from './types'

/** This CLI speaks English; the control center is the surface that follows the user's language. */
const EN = cliStrings('en')

const USAGE = `Usage:
  agentop session <harness> [-p "prompt"] [--bg] [--model <id>] [--effort <level>] [--cwd <path>] [--name "label"]
  agentop session list
  agentop session attach <id|name>
  agentop session kill   <id|name>
  agentop session rename <id|name> "label"
  agentop session note   <id|name> "text"

Harnesses that can be started: ${STARTABLE.join(', ')}`

/**
 * A reconciled row as `resolveSessionRef` needs it. Unlike the registry alone, this includes
 * `unregistered` rows (the backend hosts them, the registry does not) — `attach`/`kill` resolve
 * against this so a session `list` shows is never one only `list` can name.
 */
const toRefCandidate = (r: ReconciledSession): RefCandidate => ({ id: r.id, label: r.managed?.label })

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
    case 'rename': return patch(cmd.ref, { label: cmd.label }, 'renamed', backend)
    case 'note': return patch(cmd.ref, { note: cmd.text }, 'annotated', backend)
  }
}

async function start(
  cmd: Extract<SessionCommand, { kind: 'start' }>,
  backend: SessionBackend,
): Promise<number> {
  // Resolved here as well as inside `startManagedSession` (which is idempotent on an absolute
  // path), because the confirmation line below prints it: a relative `--cwd` echoed back verbatim
  // is as meaningless in the terminal as it would be in the registry.
  const cwd = cmd.cwd ? resolve(cmd.cwd) : process.cwd()
  const started = await startManagedSession({
    harness: cmd.harness,
    cwd,
    ...(cmd.prompt ? { prompt: cmd.prompt } : {}),
    ...(cmd.model ? { model: cmd.model } : {}),
    ...(cmd.effort ? { effort: cmd.effort } : {}),
    ...(cmd.label ? { label: cmd.label } : {}),
  }, backend)
  if (!started.ok) {
    console.error(started.kind === 'plan'
      ? explainSpawnError(started.error, EN)
      : `Could not start the session: ${started.message}`)
    return 1
  }

  if (cmd.background) {
    console.log(`Started ${cmd.harness} session ${started.id}${cmd.label ? ` (${cmd.label})` : ''} in ${cwd}`)
    console.log(`Attach with: agentop session attach ${started.id}`)
    return 0
  }
  return execAttach(started.id, backend)
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
  const reconciled = reconcileSessions(await readRegistry(), await backend.list())
  const found = resolveSessionRef(reconciled.map(toRefCandidate), ref)
  if (!found.ok) { console.error(refError(ref, found.reason, found.matches)); return 1 }
  return execAttach(found.session.id, backend)
}

async function kill(ref: string, backend: SessionBackend): Promise<number> {
  const reconciled = reconcileSessions(await readRegistry(), await backend.list())
  const found = resolveSessionRef(reconciled.map(toRefCandidate), ref)
  if (!found.ok) { console.error(refError(ref, found.reason, found.matches)); return 1 }
  const { id } = found.session

  // The reconciled view above resolved the ref, so `not-found` here means the session went away
  // between that read and the kill — the same answer as an unmatched ref, and never a silent zero.
  switch (await killManagedSession(id, backend)) {
    case 'killed':
      console.log(`Killed ${id}.`)
      return 0
    case 'unconfirmed':
      console.error(`Could not confirm ${id} was killed — it may still be running. Its registry entry was kept.`)
      return 1
    case 'not-found':
      console.error(refError(ref, 'not-found', []))
      return 1
  }
}

async function patch(
  ref: string,
  fields: { label?: string; note?: string },
  verb: string,
  backend: SessionBackend,
): Promise<number> {
  const registry = await readRegistry()
  const found = resolveSessionRef(registry, ref)
  if (!found.ok) {
    // `rename`/`note` patch registry METADATA, so they only ever resolve against the registry —
    // an unregistered session has none to patch. But "not found" there is not the same claim as
    // "does not exist": check the reconciled view so the error says which one is actually true.
    if (found.reason === 'not-found') {
      const reconciled = reconcileSessions(registry, await backend.list())
      const inBackend = resolveSessionRef(reconciled.map(toRefCandidate), ref)
      if (inBackend.ok) {
        console.error(
          `${inBackend.session.id} is running but has no registry entry to update — it was not ` +
          'started as a managed session, or its record was lost. There is nothing to rename/note.',
        )
        return 1
      }
    }
    console.error(refError(ref, found.reason, found.matches))
    return 1
  }
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
