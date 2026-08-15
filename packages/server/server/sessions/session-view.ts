/**
 * session-view.ts — PURE. One list holding the whole fleet: the sessions agentop hosts, and the
 * assistants running beside it that it did not start.
 *
 * External processes are here because "one place to see everything" is the point of the monitor —
 * an assistant opened by hand in another terminal is exactly the one a user loses track of. They
 * are marked `external` and carry NO activity, because nothing about them is capturable: there is
 * no frame to read and no backend to ask. Rendering a state for them would be inventing one.
 */

import type { HarnessId } from '@agentistics/core'
import { type HarnessProcess, sessionAtCwd } from '../live-sessions'
import { rulesFor } from './attention-rules'
import type { DialogOption } from './dialog-choice'
import { chosenName, type HarnessSessionFile } from './harness-session-file'
import type { HarnessSessionIndex } from './harness-sessions'
import type { RepoFacts } from './repo-facts'
import type { ReconciledSession } from './session-ref'
import type { Conversation } from './conversations'
import { conversationForProcess } from './conversations'
import type { ManagedSession, SessionActivity } from './types'

/**
 * The registry's own record of when a session began, as epoch ms — PURE.
 *
 * `''` and anything unparseable yield nothing rather than 1970: a start time nobody can read is an
 * absence, and an absence rendered as "56 years ago" is worse than a blank.
 */
export function registryCreatedMs(iso: string | undefined): { createdMs?: number } {
  if (!iso) return {}
  const ms = Date.parse(iso)
  return Number.isFinite(ms) ? { createdMs: ms } : {}
}

export interface SessionView {
  id: string
  /**
   * ABSENT when it cannot be known.
   *
   * An `unregistered` row is one the backend hosts and the registry has forgotten — the harness it
   * runs is not recorded anywhere we can read. Defaulting it to `claude` would file a session under
   * a harness it may not be, in a list whose entire value is that it can be trusted.
   */
  harness?: HarnessId
  cwd: string
  /**
   * `external` — running, but agentop did not start it. `closed` — a conversation on this machine
   * that is not running at all.
   *
   * Neither can be attached to, and both can usually be REOPENED, which is what `resume` carries.
   * There is deliberately no second `managed` boolean saying the same thing as this field, which
   * could then disagree with it.
   */
  status: ReconciledSession['status'] | 'external' | 'closed'
  /** ABSENT for an external session — not capturable, so not knowable. */
  activity?: SessionActivity
  /**
   * The last few meaningful lines of this session's screen — what it is saying right now.
   *
   * Only ever present for a session agentop hosts: it comes from the frame that was captured to
   * decide the state, so it costs nothing extra, and there is no frame to read for anything else.
   */
  lastLines?: string[]
  /**
   * The BOTTOM of the screen verbatim, present only while this session is blocked on a dialog.
   *
   * A different reading of the same frame from `lastLines`, and it has to be: `frameTail` cuts the
   * input box and the status strip off, which for a session sitting on a dialog cuts the dialog off.
   * This is what the person answering actually needs to read — the options, which one is highlighted
   * and the footer naming the key — because the keystroke that answers cannot know which option it
   * is taking. See `approval-spec.ts` and `approvalTail`.
   */
  approvalLines?: string[]
  /**
   * The OPTIONS that dialog is offering, when they could be read with confidence.
   *
   * Present only alongside `approvalLines`, and empty rather than invented when the screen cannot be
   * parsed — see `dialog-choice.ts`. It is what makes answering a four-way question possible at all:
   * a keystroke that confirms the highlighted row is choosing on the user's behalf.
   */
  dialogOptions?: DialogOption[]
  /**
   * This session was taken by the machine along with the others, and is offered back with them.
   *
   * Decided by `crash-group.ts` over the whole registry, so it cannot be derived from this row: the
   * question "did these fall together" is about a set, and a per-row rule could only ever guess.
   */
  fell?: boolean
  label?: string
  /** When `label` was written, epoch ms — the recency side of the title contest. */
  labelSince?: number
  /**
   * The name the user gave this session FROM INSIDE IT, and when.
   *
   * Read from what the harness records about its own live sessions (`harness-sessions.ts`), matched
   * EXACTLY — by the tmux session for a row we host, by pid for one we merely observed. A name the
   * harness invented for itself is not carried here at all: `chosenName` drops it, because a
   * generated `agentistics-77` replacing a label somebody typed is the "reopen renamed the row back"
   * bug in a new costume.
   */
  harnessName?: string
  harnessNameSince?: number
  note?: string
  model?: string
  effort?: string
  /** The piece of work this session belongs to, when the user said. Groups the list. */
  task?: string
  /**
   * The harness's own conversation id this row drives, when it is known EXACTLY.
   *
   * Carried from `ManagedSession.conversationId`, so it is present only for a session that was
   * reopened from a conversation — we handed the id to the CLI, so there is nothing to guess. It is
   * deliberately NOT filled from the harness+directory inference behind `resume`: that guess is
   * good enough to offer a verb the user confirms by title, and not good enough to be the key the
   * event channel deduplicates on. Absent is absent.
   */
  conversationId?: string
  /**
   * The repository this row's directory was in when the session STARTED, as the registry recorded
   * it — carried so the caller that resolves `repo-facts.ts` can hand it over.
   *
   * It is here rather than resolved here because resolving means running git, and this module is
   * pure. Present only on a managed row written by a build that records it; `resolveRepoFacts`
   * treats absence as "nothing recorded", never as "no repository".
   */
  recordedRepo?: RepoFacts
  createdMs?: number
  attached: boolean
  /**
   * The conversation this row could REOPEN, when there is one.
   *
   * Present on an `external` row (the conversation it appears to be driving) and on a `closed` one
   * (itself). Absent when the harness cannot reopen by id — gemini takes "latest" or an index, never
   * an id — so the verb is simply not offered rather than offered and wrong.
   */
  resume?: { sessionId: string; title: string }
  /** Metrics of the conversation behind this row, when it has any. Absent is never zero. */
  tokens?: number
  costUSD?: number
  /** How full the context window was on the last turn, and out of how much. Both or neither. */
  contextTokens?: number
  contextWindow?: number
  /**
   * Whether this harness has probed approval rules at all.
   *
   * False means a session blocked on a permission prompt reads as plain `waiting` — still counted,
   * still surfaced, but the reason cannot be shown. The UI says so; this flag is where it learns it.
   */
  approvalDetection: boolean
  /**
   * Everything about this row worth searching, lowercased and joined.
   *
   * Composed HERE so the search reaches a closed conversation's OPENING PROMPT — which is what a
   * person actually remembers about something they closed ("the one where I asked about the
   * migration") — without the screen having to hold conversation text it never renders.
   */
  searchText: string
}

export function needsAttention(a?: SessionActivity): boolean {
  return a === 'waiting' || a === 'waiting-approval'
}

/** Sort key: what is waiting on a person first, then what is running, then what is finished, then
 *  the rows nothing can be done about. */
const RANK: Record<string, number> = {
  'waiting-approval': 0,
  waiting: 1,
  working: 2,
  exited: 3,
}

function rankOf(v: SessionView): number {
  // Closed conversations sit below everything running: they are history, and history must never
  // push a session that is waiting on someone further down the screen.
  if (v.status === 'closed') return 6
  if (v.status === 'external') return 5
  return RANK[v.activity ?? ''] ?? 4
}

/**
 * An id for an external process that is STABLE across polls and unique per process.
 *
 * The start time is what does both jobs: it distinguishes two assistants of the same harness open
 * in one directory (harness + cwd alone would collapse them into a single row), and unlike a list
 * index it does not change when an unrelated process appears or exits.
 */
export function externalId(p: HarnessProcess): string {
  return `external:${p.harness}:${p.cwd}:${p.startedMs ?? 0}`
}

/** Everything a row can be found by, in one lowercased blob. */
function searchTextOf(...parts: Array<string | undefined>): string {
  return parts.filter(Boolean).join(' ').toLowerCase()
}

/**
 * The rows matching what was typed — PURE, and the same predicate for every kind of row.
 *
 * One function rather than a filter per status: a search that quietly skipped closed conversations
 * would be a search that cannot find the thing it was most likely opened to find.
 */
export function filterSessions(views: readonly SessionView[], query: string): SessionView[] {
  const q = query.trim().toLowerCase()
  if (q === '') return [...views]
  return views.filter(v => v.searchText.includes(q))
}

export function buildSessionViews(o: {
  reconciled: readonly ReconciledSession[]
  activity: ReadonlyMap<string, SessionActivity>
  /** The tail of each hosted session's screen, keyed by session id. */
  tails?: ReadonlyMap<string, string[]>
  /** The DIALOG a blocked session is showing, keyed by session id — see `SessionView.approvalLines`. */
  approvals?: ReadonlyMap<string, string[]>
  /** The options that dialog offers, keyed by session id. Absent where they could not be read. */
  dialogOptions?: ReadonlyMap<string, DialogOption[]>
  /** The ids `crash-group.ts` decided fell together. A set, because the question is about a set. */
  fell?: ReadonlySet<string>
  /**
   * What each harness records about its OWN live sessions, indexed by the two exact keys — the tmux
   * session a managed row runs in, and the pid of a process found on the host.
   *
   * It is what makes this the one correlation in this file that is not a guess: a row matched here
   * knows its conversation id exactly, so `claimResume` never has to fall back to "some conversation
   * in this directory" — the fallback that once reopened three rows onto one conversation.
   */
  harnessSessions?: HarnessSessionIndex
  processes: readonly HarnessProcess[]
  /** Everything this machine has ever recorded, newest first. Used to name what an external process
   *  is driving, and to offer the conversations that are not running at all. */
  conversations?: readonly Conversation[]
  /**
   * How many closed conversations to offer.
   *
   * Small on purpose. A machine with hundreds of them must not drown the handful that are actually
   * running — the list is for what is happening, and SEARCH is how an older conversation is found.
   * Forty made the closed block longer than everything else on the screen put together.
   */
  closedLimit?: number
}): SessionView[] {
  /**
   * Conversations already spoken for, so ONE is never offered to two rows.
   *
   * `conversationForProcess` matches on harness and directory, which is all it can do for a process
   * it did not start — and every managed session in one directory therefore resolved to the SAME
   * conversation. After a crash left five rows `lost` in this repository, reopening them handed
   * three of them the same conversation and the fleet came back with one session listed three
   * times, all wearing the same name. Reported from a real machine.
   *
   * A row that RECORDED which conversation it drives is exact and claims that one. The rest fall
   * back to the directory guess, but only to a conversation nobody has taken.
   */
  const claimed = new Set<string>()
  const claimResume = (
    managed: ManagedSession | undefined,
    harness: HarnessId,
    /**
     * The conversation the HARNESS ITSELF says this row is driving.
     *
     * Outranks the registry's own record and the directory guess alike, because it is the only one
     * of the three that is a fact rather than a recollection or an inference: the harness wrote it
     * about the session it is running, and the row was matched to it by tmux session or by pid.
     */
    exactId?: string,
  ): { resume?: { sessionId: string; title: string } } => {
    const pool = o.conversations ?? []
    const knownId = exactId ?? managed?.conversationId
    const own = knownId ? pool.find(c => c.sessionId === knownId) : undefined
    // A row that KNOWS which conversation it drives never falls back to the guess — not even when
    // the store does not hold that conversation yet. Since the id is recorded at SPAWN (not only at
    // reopen), that gap is now ordinary: a session minutes old has an id and no transcript written
    // under it. "Not yet" and "some other conversation in this directory" are not the same answer,
    // and taking the second is the guess that handed three rows one conversation after a crash.
    if (knownId) {
      if (!own?.resumable) return {}
      claimed.add(own.sessionId)
      return { resume: { sessionId: own.sessionId, title: own.title } }
    }
    const conv = pool.find(c =>
      !claimed.has(c.sessionId)
      && c.harness === harness
      && sessionAtCwd({ current_cwd: c.cwd, project_path: c.cwd }, managed?.cwd ?? ''))
    if (!conv?.resumable) return {}
    claimed.add(conv.sessionId)
    return { resume: { sessionId: conv.sessionId, title: conv.title } }
  }

  /**
   * The conversation a RUNNING managed row is driving, for its metrics — a read, never a claim.
   *
   * Separate from `claimResume` on purpose. That one hands out a REOPEN target and must give each
   * conversation to at most one row, or a crash that left five rows in one directory offers the
   * same conversation five times. This one only wants numbers, and numbers are not scarce: two rows
   * reading the same conversation is a display question, while a row silently losing its metrics to
   * whichever row was mapped first is a wrong answer.
   *
   * Only the EXACT links are used — the harness's own record (`~/.claude/sessions/<pid>.json`,
   * matched by tmux session name) and the id the registry stored while the session was up. The
   * harness-and-directory inference `claimResume` falls back to is deliberately not accepted here:
   * for a reopen it is offered to a person who can recognise the title and decline, whereas a
   * context gauge is read at a glance and believed. Two sessions in one worktree would otherwise
   * both wear the older one's fill level with nothing on screen saying so.
   */
  const metricsOf = (
    managed: ManagedSession | undefined,
    exactId?: string,
  ): Conversation | undefined => {
    const pool = o.conversations ?? []
    const id = exactId ?? managed?.conversationId
    return id ? pool.find(c => c.sessionId === id) : undefined
  }

  const managed: SessionView[] = o.reconciled.map(r => {
    const harness = r.managed?.harness
    // What the harness says about ITSELF, matched by the tmux session it recorded — the one exact
    // link between its record and this row.
    const own: HarnessSessionFile | undefined = o.harnessSessions?.byManagedId.get(r.id)
    const ownName = chosenName(own)
    // A session the user FINISHED reports `exited` whatever the backend still holds: the row exists
    // to be reopened, and calling it `running` because a dead tmux pane lingers would put it back
    // among the things you can talk to.
    const finished = Boolean(r.managed?.endedAt)
    const activity = finished ? ('exited' as const) : o.activity.get(r.id)
    // A managed row carried no metrics at all until now — `external` and `closed` rows read them
    // from the store and this one did not, so on a machine whose whole fleet is agentop-started
    // (the normal case once the session manager is in use) the usage column was empty everywhere.
    const conv = metricsOf(r.managed, own?.sessionId)
    return {
      id: r.id,
      ...(harness ? { harness } : {}),
      cwd: r.managed?.cwd ?? '',
      status: finished ? ('exited' as const) : r.status,
      ...(activity ? { activity } : {}),
      ...((o.tails?.get(r.id)?.length ?? 0) > 0 ? { lastLines: o.tails!.get(r.id)! } : {}),
      // Only while it is genuinely asking. A dialog frame carried on a row that has moved on would
      // be shown under "what you are about to confirm" for a question that is no longer open.
      ...(activity === 'waiting-approval' && (o.approvals?.get(r.id)?.length ?? 0) > 0
        ? { approvalLines: o.approvals!.get(r.id)! }
        : {}),
      ...(activity === 'waiting-approval' && (o.dialogOptions?.get(r.id)?.length ?? 0) > 0
        ? { dialogOptions: o.dialogOptions!.get(r.id)! }
        : {}),
      ...(o.fell?.has(r.id) ? { fell: true as const } : {}),
      ...(r.managed?.label ? { label: r.managed.label } : {}),
      ...(r.managed?.labelSince !== undefined ? { labelSince: r.managed.labelSince } : {}),
      ...(ownName ? { harnessName: ownName } : {}),
      ...(ownName && own?.nameSince !== undefined ? { harnessNameSince: own.nameSince } : {}),
      ...(r.managed?.note ? { note: r.managed.note } : {}),
      ...(r.managed?.model ? { model: r.managed.model } : {}),
      ...(r.managed?.effort ? { effort: r.managed.effort } : {}),
      ...(r.managed?.task ? { task: r.managed.task } : {}),
      ...(r.managed?.conversationId ? { conversationId: r.managed.conversationId } : {}),
      ...(r.managed?.repo ? { recordedRepo: r.managed.repo } : {}),
      // The backend's clock when there is a backend, the REGISTRY's when there is not. A row the
      // machine lost has no tmux session left to ask, so it reported no start time at all — and a
      // session you are deciding whether to reopen is one whose age is most of the decision.
      ...(r.backend
        ? { createdMs: r.backend.createdMs }
        : registryCreatedMs(r.managed?.createdAt)),
      // Reopening a finished session is the whole reason its row is kept. Resolved the same way an
      // external process's conversation is — by harness and directory — and absent when nothing
      // can be resolved, rather than offering a verb with no target.
      // Reopening is offered for ANY managed row that is not running — one you finished, one whose
      // command exited, and one the backend no longer has at all. That last case is a REBOOT: tmux
      // is gone, every managed session is `lost`, and without this the sessions you were in the
      // middle of came back as rows with no verb on them. Resolved the same way an external
      // process's conversation is, and absent when nothing resolves rather than offering a verb
      // with no target.
      ...((finished || r.status === 'lost' || r.status === 'exited') && harness
        // `own?.sessionId` is only ever present for a row still ALIVE — the harness deletes its
        // record when the process goes — so on a `lost` row this is `undefined` and the registry's
        // own `conversationId` decides, exactly as before. That is not a gap: the id was recorded
        // into the registry while the session was up, by the branch below.
        ? claimResume(r.managed, harness, own?.sessionId)
        : {}),
      ...(conv?.tokens !== undefined ? { tokens: conv.tokens } : {}),
      ...(conv?.costUSD !== undefined ? { costUSD: conv.costUSD } : {}),
      ...(conv?.contextTokens !== undefined && conv.contextWindow !== undefined
        ? { contextTokens: conv.contextTokens, contextWindow: conv.contextWindow }
        : {}),
      attached: r.backend?.attached ?? false,
      approvalDetection: harness !== undefined && rulesFor(harness) !== undefined,
      // The harness's own name is searchable too: it is the name the person reading this screen may
      // well be the only one they remember, having typed it inside the session.
      searchText: searchTextOf(
        harness, r.managed?.cwd, r.managed?.label, ownName, r.managed?.note, r.managed?.task,
      ),
    }
  })

  // An assistant already accounted for by a managed row must not appear twice. Matched through the
  // same `sessionAtCwd` predicate the live panel uses, so the two surfaces cannot disagree about
  // whether one running assistant is one row or two.
  //
  // A row whose harness is unknown covers NOTHING: it might be that process or might not, and
  // silently swallowing an external session on a maybe is the worse of the two errors — a duplicate
  // row is visible and self-correcting, a missing one is not.
  // Only a row that is actually RUNNING can account for a running process. `!== 'lost'` was too
  // wide: an `exited` row accounts for a process that is GONE, and letting it cover swallows a live
  // session that happens to share its directory. Measured on this machine — three exited rows sat in
  // the worktree of a background agent that was alive, and the agent was hidden behind them and
  // listed as a closed conversation instead.
  const covered = (p: HarnessProcess): boolean => managed.some(m =>
    m.harness === p.harness &&
    (m.status === 'running' || m.status === 'unregistered') &&
    sessionAtCwd({ current_cwd: m.cwd, project_path: m.cwd }, p.cwd))

  const conversations = o.conversations ?? []

  /**
   * Sessions the harness's OWN records prove are running, which the `/proc` scan did not report.
   *
   * Synthesised as processes rather than special-cased downstream, deliberately: they then travel
   * the very same `external` path as a scanned one and inherit every rule already written there —
   * the `covered` de-duplication, the exact-name lookup, the resume target, the tokens and the
   * context gauge. A parallel branch would be a second set of rules for one kind of row.
   *
   * Two things had to be true before this was sound, and both now are: the record carries
   * `procStart`, so `alive` is a fact about THIS process and not about whoever inherited its pid;
   * and `alive` is `undefined` wherever nobody could tell, so a machine with no `/proc` synthesises
   * nothing and behaves exactly as it did.
   *
   * This is what stops a live session being listed as `closed`. Measured: a background agent alive
   * for 38 minutes — no tmux, missed by the scan — sat in the closed block under a title from
   * another week, offering to "reopen" a conversation that had never stopped.
   */
  const scannedPids = new Set(o.processes.map(p => p.pid).filter((v): v is number => v !== undefined))
  const fromRecords: HarnessProcess[] = [...(o.harnessSessions?.byConversation.values() ?? [])]
    .filter(f => f.alive === true && f.pid !== undefined && !scannedPids.has(f.pid)
      && f.cwd !== undefined && f.harness !== undefined)
    .map(f => ({
      harness: f.harness!,
      cwd: f.cwd!,
      pid: f.pid!,
      ...(f.sessionId ? { sessionId: f.sessionId } : {}),
    }))

  const external: SessionView[] = [...o.processes, ...fromRecords].filter(p => !covered(p)).map(p => {
    // What the harness says about ITSELF, keyed on the pid `/proc` reported. Exact where every other
    // reading of an external process is an inference from its directory.
    // By pid first — that is the key a SCANNED process arrives with. Falling back to the
    // conversation removes a hidden coupling rather than papering over one: a row synthesised from
    // a record already knows the conversation exactly, and making its name depend on a second
    // lookup succeeding would leave it correctly listed and anonymously labelled.
    const own = (p.pid !== undefined ? o.harnessSessions?.byPid.get(p.pid) : undefined)
      ?? (p.sessionId ? o.harnessSessions?.byConversation.get(p.sessionId) : undefined)
    const ownName = chosenName(own)
    // What this process appears to be driving. The harness's own `sessionId` outranks the argv one
    // and the directory guess alike: it is what the process is writing to, said by the process.
    const conv = conversationForProcess(conversations, {
      harness: p.harness,
      cwd: p.cwd,
      ...(own?.sessionId ?? p.sessionId ? { namedId: own?.sessionId ?? p.sessionId! } : {}),
    })
    return {
      id: externalId(p),
      harness: p.harness,
      cwd: p.cwd,
      status: 'external' as const,
      ...(ownName ? { harnessName: ownName } : {}),
      ...(ownName && own?.nameSince !== undefined ? { harnessNameSince: own.nameSince } : {}),
      ...(p.startedMs !== undefined ? { createdMs: p.startedMs } : {}),
      attached: false,
      approvalDetection: false,
      ...(conv?.resumable ? { resume: { sessionId: conv.sessionId, title: conv.title } } : {}),
      ...(conv?.tokens !== undefined ? { tokens: conv.tokens } : {}),
      ...(conv?.costUSD !== undefined ? { costUSD: conv.costUSD } : {}),
      ...(conv?.contextTokens !== undefined && conv.contextWindow !== undefined
        ? { contextTokens: conv.contextTokens, contextWindow: conv.contextWindow }
        : {}),
      searchText: searchTextOf(p.harness, p.cwd, ownName, conv?.title, conv?.firstPrompt),
    }
  })

  // Conversations that are not running at all — the ones you closed and want back. They are the
  // reason this screen can answer "what was I doing yesterday" as well as "what is running now".
  //
  // A conversation ALREADY on screen must not appear a second time as history, and it was: only the
  // external rows were excluded, so a session agentop is running right now was listed once as
  // `working` and again as `closed` — the same title, the same directory, twice. Every LIVE row
  // covers its conversation, whether that row is one we host or one we merely observed.
  const shown = new Set<string>()
  for (const v of external) if (v.resume) shown.add(v.resume.sessionId)
  //
  // A row that RECORDED its conversation covers exactly that one. The rest fall back to the
  // harness+directory inference, and it is CLAIMED — because that inference answers with the FIRST
  // conversation in the directory, so four live sessions in one repository all covered the same
  // one. The other three stayed in history as `closed` rows for conversations that were open, and
  // whichever conversation happened to be first vanished from history while it was the one nobody
  // was running. "Some sessions do not appear" and "some appear twice" were the same bug, seen
  // from its two ends.
  const coveredConv = new Set<string>()
  for (const r of o.reconciled) {
    const m = managed.find(v => v.id === r.id)
    // `exited` and `lost` rows cover nothing: their work IS over, and the conversation belongs in
    // history where it can be reopened.
    if (!m || (m.status !== 'running' && m.status !== 'unregistered')) continue
    const own = r.managed?.conversationId
    if (own) { shown.add(own); coveredConv.add(own); continue }
    if (!m.harness) continue
    const conv = conversations.find(c =>
      !coveredConv.has(c.sessionId)
      && c.harness === m.harness
      && sessionAtCwd({ current_cwd: c.cwd, project_path: c.cwd }, m.cwd))
    if (conv) { shown.add(conv.sessionId); coveredConv.add(conv.sessionId) }
  }

  const closed: SessionView[] = conversations
    .filter(c => !shown.has(c.sessionId))
    .slice(0, o.closedLimit ?? 12)
    .map(c => {
      /**
       * The name the SESSION gave itself, when its own record can be found by conversation id.
       *
       * `c.title` comes from the conversation store, which is written from the transcript and can be
       * days older than a `/rename`. Measured: a session renamed to `MAIN` was listed here under
       * `Build agentop harness cockpit with session management` — a title from a different week.
       *
       * This is the one lookup that needs nothing else to be true. `byManagedId` requires the
       * session to have been started under tmux and `byPid` requires the `/proc` scan to have
       * surfaced it; a background agent satisfies neither, and was therefore shown under whatever
       * the store last recorded with no way to correct it.
       *
       * `chosenName` still rejects a `derived` name, so a harness-invented `agentistics-84` never
       * displaces a real title.
       */
      const own = o.harnessSessions?.byConversation.get(c.sessionId)
      const named = chosenName(own)
      return {
      id: `closed:${c.sessionId}`,
      harness: c.harness,
      cwd: c.cwd,
      status: 'closed' as const,
      label: named ?? c.title,
      createdMs: c.lastActivityMs,
      attached: false,
      approvalDetection: false,
      ...(c.resumable ? { resume: { sessionId: c.sessionId, title: c.title } } : {}),
      ...(c.tokens !== undefined ? { tokens: c.tokens } : {}),
      ...(c.costUSD !== undefined ? { costUSD: c.costUSD } : {}),
      ...(c.contextTokens !== undefined && c.contextWindow !== undefined
        ? { contextTokens: c.contextTokens, contextWindow: c.contextWindow }
        : {}),
      // The typed name goes into the search text TOO, or the row is displayed under a name that
      // cannot be used to find it — which is the complaint arriving by the other door.
      searchText: searchTextOf(c.harness, c.cwd, named ?? c.title, c.firstPrompt)
        + (named && named !== c.title ? ` ${c.title.toLowerCase()}` : ''),
      }
    })

  return [...managed, ...external, ...closed].sort((a, b) => {
    const byRank = rankOf(a) - rankOf(b)
    if (byRank !== 0) return byRank
    return (b.createdMs ?? 0) - (a.createdMs ?? 0)
  })
}

export function attentionCount(views: readonly SessionView[]): number {
  return views.filter(v => needsAttention(v.activity)).length
}

/**
 * The ids that JUST entered a state needing an answer — what the caller rings the bell for.
 *
 * A transition rather than a level, so a session sitting on a question for ten minutes does not
 * beep every five seconds. Escalating from `waiting` to `waiting-approval` counts as a transition:
 * it is a different urgency, and the bell is the only signal this design ships.
 */
export function bellTransitions(
  prev: ReadonlyMap<string, SessionActivity>,
  next: readonly SessionView[],
): string[] {
  const out: string[] = []
  for (const v of next) {
    if (!needsAttention(v.activity)) continue
    const before = prev.get(v.id)
    if (before === v.activity) continue
    out.push(v.id)
  }
  return out
}
