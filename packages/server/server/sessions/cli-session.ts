/**
 * cli-session.ts — the `agentop session …` handlers.
 *
 * Every decision is already made by a pure module: `parseSessionArgs` says what was asked,
 * `planSpawn` says what to run, `resolveSessionRef` says which session was meant, and
 * `reconcileSessions` says what exists. This file does I/O and prints.
 */

import { resolve } from 'node:path'
import { HARNESS_ORDER, type HarnessId } from '@agentistics/core'
import { parseSessionArgs, type SessionCommand } from './cli-parse'
import { SPAWN_SPECS, planSpawn } from './spawn-spec'
import { reconcileSessions, resolveSessionRef, type ReconciledSession, type RefCandidate } from './session-ref'
import { addSession, newSessionId, patchSession, readRegistry, removeSession } from './registry'
import { conversationForProcess, loadConversations } from './conversations'
import { resolveBackend } from './index'
import { scanProcesses } from '../live-sessions'
import { createSessionsPoller } from './sessions-host'
import { needsAttention, type SessionView } from './session-view'
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

Orchestrating several at once — the form an assistant should use:

  agentop session batch --task "<name>" [--cwd <path>] [--model <id>] [--effort <level>] \\
                       --session "<harness>[@<cwd>]: <prompt>" [--session "..."] [--json]
  agentop session open  "<task>" [--json]
  agentop session list  [--json]

  \`batch\` starts every session detached and files them all under one task, so \`open\` brings the
  whole task back later and the cockpit groups them together. \`--cwd\`/\`--model\`/\`--effort\` given
  before the sessions apply to all of them; a \`@<cwd>\` on a session overrides it. \`--json\` prints
  the started ids as data.

  Example — three assistants on one repository, in parallel:

    agentop session batch --task "auth-refactor" --cwd ~/app --json \\
      --session "claude: refactor the token store" \\
      --session "codex: port the tests" \\
      --session "gemini: review the migration"

Harnesses that can be started: ${STARTABLE.join(', ')}`

/**
 * A reconciled row as `resolveSessionRef` needs it. Unlike the registry alone, this includes
 * `unregistered` rows (the backend hosts them, the registry does not) — `attach`/`kill` resolve
 * against this so a session `list` shows is never one only `list` can name.
 */
const toRefCandidate = (r: ReconciledSession): RefCandidate => ({ id: r.id, label: r.managed?.label })

function explainPlanError(e: SpawnPlanError): string {
  switch (e.code) {
    case 'unsupported-harness':
      return `${e.harness} cannot be started by agentop yet. Supported: ${STARTABLE.join(', ')}.`
    case 'resume-unsupported':
      return `${e.harness} cannot reopen a conversation by id, so it cannot be resumed.`
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
    case 'batch': return batch(cmd, backend)
    case 'open': return openTask(cmd.task, cmd.json ?? false, backend)
    case 'list': return list(backend, cmd.json ?? false)
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
  // A relative --cwd must resolve against the CALLER's directory: passed through unresolved it
  // reaches `tmux new-session -c` and is interpreted by the tmux SERVER's own cwd instead, and it
  // is written verbatim into the registry, where `list` would print it back meaningless from
  // anywhere else.
  const cwd = cmd.cwd ? resolve(cmd.cwd) : process.cwd()
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
    ...(cmd.task ? { task: cmd.task } : {}),
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

/** The word each state wears. `external` says outright that this row is not ours to drive. */
function stateWord(v: SessionView): string {
  if (v.status === 'external') return 'external'
  if (v.status === 'lost') return 'lost'
  switch (v.activity) {
    case 'waiting-approval': return 'NEEDS APPROVAL'
    case 'waiting': return 'waiting'
    case 'working': return 'working'
    case 'exited': return 'exited'
    default: return v.status
  }
}

/**
 * `agentop session batch` — start several sessions at once, all filed under one task.
 *
 * The command an ASSISTANT drives. Every session is started detached, because a batch by definition
 * has no single terminal to hand over, and the result is printed as JSON on request so the caller
 * gets the ids back as data rather than having to parse prose it did not write.
 *
 * A failure does not abort the rest: with five sessions requested, four that started are four that
 * are running, and pretending otherwise would leave them orphaned. Every outcome is reported.
 */
async function batch(
  cmd: Extract<SessionCommand, { kind: 'batch' }>,
  backend: SessionBackend,
): Promise<number> {
  const started: Array<{ id: string; harness: string; cwd: string }> = []
  const failed: Array<{ harness: string; reason: string }> = []

  for (const spec of cmd.specs) {
    const cwd = spec.cwd ? resolve(spec.cwd) : process.cwd()
    const planned = planSpawn({
      harness: spec.harness,
      cwd,
      ...(spec.prompt ? { prompt: spec.prompt } : {}),
      ...(spec.model ? { model: spec.model } : {}),
      ...(spec.effort ? { effort: spec.effort } : {}),
    })
    if (!planned.ok) { failed.push({ harness: spec.harness, reason: explainPlanError(planned.error) }); continue }

    const id = newSessionId()
    try {
      await backend.spawn({
        id, cwd, argv: planned.plan.argv,
        ...(planned.plan.sendKeys ? { sendKeys: planned.plan.sendKeys } : {}),
      })
    } catch (e) {
      failed.push({ harness: spec.harness, reason: e instanceof Error ? e.message : String(e) })
      continue
    }
    await addSession({
      id,
      harness: spec.harness,
      cwd,
      createdAt: new Date().toISOString(),
      task: cmd.task,
      ...(spec.model ? { model: spec.model } : {}),
      ...(spec.effort ? { effort: spec.effort } : {}),
      ...(spec.name ? { label: spec.name } : {}),
    })
    started.push({ id, harness: spec.harness, cwd })
  }

  if (cmd.json) {
    console.log(JSON.stringify({ task: cmd.task, started, failed }, null, 2))
  } else {
    for (const st of started) console.log(`${st.id}\t${st.harness}\t${st.cwd}`)
    for (const f of failed) console.error(`failed\t${f.harness}\t${f.reason}`)
    console.log(`\n${started.length} started under task "${cmd.task}"${failed.length ? `, ${failed.length} failed` : ''}.`)
    if (started.length > 0) console.log(`Attach to any with: agentop session attach <id>`)
  }
  return failed.length > 0 && started.length === 0 ? 1 : 0
}

/** `agentop session open "<task>"` — reopen every session of a task, detached. */
async function openTask(task: string, json: boolean, backend: SessionBackend): Promise<number> {
  const wanted = (await readRegistry()).filter(m => m.task === task)
  if (wanted.length === 0) {
    console.error(`No sessions are filed under "${task}".`)
    return 1
  }
  const conversations = await loadConversations()
  const started: string[] = []
  const skipped: string[] = []

  for (const m of wanted) {
    const conv = conversationForProcess(conversations, { harness: m.harness, cwd: m.cwd })
    if (!conv?.resumable) { skipped.push(m.id); continue }
    const planned = planSpawn({ harness: m.harness, cwd: m.cwd, resumeId: conv.sessionId })
    if (!planned.ok) { skipped.push(m.id); continue }
    const id = newSessionId()
    try {
      await backend.spawn({ id, cwd: m.cwd, argv: planned.plan.argv })
    } catch { skipped.push(m.id); continue }
    await addSession({
      id, harness: m.harness, cwd: m.cwd, createdAt: new Date().toISOString(), task,
      ...(m.label ? { label: m.label } : {}),
    })
    started.push(id)
  }

  if (json) {
    console.log(JSON.stringify({ task, started, skipped }, null, 2))
  } else {
    for (const id of started) console.log(id)
    // Reported, never silent: a partial reopen presented as a success leaves someone believing they
    // have their whole task back.
    console.log(`\n${started.length} reopened${skipped.length ? `, ${skipped.length} could not be` : ''}.`)
  }
  return started.length === 0 ? 1 : 0
}

async function list(backend: SessionBackend, json = false): Promise<number> {
  const poller = createSessionsPoller({ backend, readRegistry, scanProcesses, loadConversations })
  const snap = await poller.poll()

  // Machine-readable on request, so an assistant orchestrating sessions reads its own fleet as data
  // rather than parsing a table meant for a person.
  if (json) {
    console.log(JSON.stringify({
      sessions: snap.sessions.map(v => ({
        id: v.id,
        status: v.status,
        activity: v.activity ?? null,
        harness: v.harness ?? null,
        cwd: v.cwd,
        label: v.label ?? null,
        task: v.task ?? null,
        resumeId: v.resume?.sessionId ?? null,
      })),
      attention: snap.attention,
      unavailable: snap.unavailable ?? null,
    }, null, 2))
    return 0
  }

  if (snap.unavailable) console.error(snap.unavailable)
  if (snap.sessions.length === 0) {
    // Only claim "nothing is running" when the poll actually succeeded — an unavailable backend has
    // not established that, and saying so would be a confident zero.
    if (!snap.unavailable) console.log('No sessions.')
    return snap.unavailable ? 1 : 0
  }

  for (const v of snap.sessions) {
    const id = v.status === 'external' ? '-' : v.id
    // `?` rather than a guessed harness: an unregistered session's harness is genuinely unrecorded.
    console.log(`${id}\t${stateWord(v)}\t${v.harness ?? '?'}\t${v.label ?? ''}\t${v.cwd}`)
  }

  const waiting = snap.sessions.filter(v => needsAttention(v.activity))
  if (waiting.length > 0) {
    console.log(`\n${waiting.length} session(s) waiting on you: ${waiting.map(v => v.label ?? v.id).join(', ')}`)
  }

  // A harness with no probed rules cannot distinguish a permission prompt from an ordinary pause.
  // Saying so is the difference between a gap and a wrong answer.
  // Only rows we actually HOST can have their approval detected, so only they can lack it. A closed
  // conversation and a foreign process have no screen to read at all — including them here named
  // claude, kimi and codex as undetectable when all three are probed.
  const blind = [...new Set(
    snap.sessions
      .filter(v => v.status !== 'external' && v.status !== 'closed' && !v.approvalDetection)
      .map(v => v.harness)
      .filter((h): h is NonNullable<typeof h> => h !== undefined),
  )]
  if (blind.length > 0) {
    console.log(`Approval detection is not available for: ${blind.join(', ')} — those sessions show as "waiting" either way.`)
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
  const registry = await readRegistry()
  const reconciled = reconcileSessions(registry, await backend.list())
  const found = resolveSessionRef(reconciled.map(toRefCandidate), ref)
  if (!found.ok) { console.error(refError(ref, found.reason, found.matches)); return 1 }
  const { id } = found.session
  const statusBefore = reconciled.find(r => r.id === id)?.status

  const confirmed = await backend.kill(id)
  // A session that was already `lost` (the backend has nothing by this id — there was never
  // anything for `kill` to do) or `exited` (the hosted command already finished) is safe to clear
  // even on a backend report we cannot trust, because the reconciled view established BEFORE this
  // call already knew nothing was running. This is the fallback, not the common path: an ordinary
  // kill still relies on `confirmed`, so a real failure never gets papered over.
  if (!confirmed && statusBefore !== 'lost' && statusBefore !== 'exited') {
    console.error(`Could not confirm ${id} was killed — it may still be running. Its registry entry was kept.`)
    return 1
  }
  await removeSession(id)
  console.log(`Killed ${id}.`)
  return 0
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
