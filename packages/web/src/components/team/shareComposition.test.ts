import { test, expect } from 'bun:test'
import type { SessionMeta, ShareSource } from '@agentistics/core'
import { NO_REPO_KEY } from '@agentistics/core'
import { buildShareTargets, buildProjectTargets, type ServerProject } from '../../lib/shareRepos'
import { shareAllDraft, toggleTarget } from './repoPanelState'
import {
  buildProjectRows, buildSourcesFromDraft, blockAllProjectsDraft, isEmptyAllowlist,
  resolveSubmittedRepoKeys, resolveSubmittedProjectPaths, resolveSubmittedRules, type ShareMode,
} from './sharePanelState'
import { buildDefaultDraft, buildSubmitBody } from './addCentralState'
// Test-only import of the SERVER predicate. The web bundle may never import `packages/server/*`
// (Vite would bundle Bun APIs), but a test runs under Bun — and the whole point of this file is
// that every per-function unit test on this branch passed while the COMPOSITION leaked: each
// helper was correct in isolation. So every assertion here goes draft -> submitted sets ->
// `ShareSource[]` -> `sessionShared`, i.e. it asserts what the server concludes about a session,
// never what a helper returned.
import { shareRulesOf, sessionShared, buildPathRepoIndex } from '../../../../server/server/share-rules'

// --- fixture: two projects under ONE repository, plus one project with no remote --------------

const REMOTE = 'https://github.com/org/r'
const REPO_KEY = 'github.com/org/r'

function s(over: Partial<SessionMeta>): SessionMeta {
  return {
    session_id: 'x', project_path: '/p1', harness: 'claude',
    start_time: '2026-07-01T10:00:00.000Z', duration_minutes: 0,
    user_message_count: 0, assistant_message_count: 0,
    tool_counts: {}, tool_output_tokens: {}, agent_file_reads: {}, languages: [],
    git_commits: 0, git_pushes: 0, input_tokens: 0, output_tokens: 0,
    ...over,
  } as SessionMeta
}

const SESSIONS: SessionMeta[] = [
  s({ session_id: '1', project_path: '/p1', git_remote: REMOTE }),
  s({ session_id: '2', project_path: '/p2', git_remote: REMOTE }),
  s({ session_id: '3', project_path: '/solo' }),
]
const PROJECTS: ServerProject[] = [
  { path: '/p1', gitRemote: REMOTE },
  { path: '/p2', gitRemote: REMOTE },
  { path: '/solo' },
]

const TARGETS = buildShareTargets(SESSIONS, PROJECTS, [], { noRepo: 'No repository' })
const PROJECT_TARGETS = buildProjectTargets(SESSIONS, PROJECTS, [])
const INDEX = buildPathRepoIndex(SESSIONS, PROJECTS)

interface Verdict {
  sources: ShareSource[]
  /** session_id -> what the SERVER concludes. */
  shared: Record<string, boolean>
  emptyAllowlist: boolean
}

/** The panel's whole submit path, end to end: the two mode-invariant "switch is OFF" drafts →
 *  the submitted sets → `ShareSource[]` → `sessionShared`. */
function evaluate(mode: ShareMode, repoOff: Set<string>, projectOff: Set<string>): Verdict {
  const { repoKeys, projectPaths } = resolveSubmittedRules(mode, TARGETS, PROJECT_TARGETS, repoOff, projectOff)
  const sources = buildSourcesFromDraft(repoKeys, projectPaths)
  const rules = shareRulesOf(mode, sources)
  const shared: Record<string, boolean> = {}
  for (const sess of SESSIONS) shared[sess.session_id] = sessionShared(sess, rules, INDEX)
  return { sources, shared, emptyAllowlist: isEmptyAllowlist(mode, repoKeys, projectPaths) }
}

// --- CRITICAL 1: a project switched OFF under a repository that is ON --------------------------

test('allowlist: a project switched OFF is NOT shared, even though its repository is left ON', () => {
  const v = evaluate('allowlist', new Set(), new Set(['/p2']))
  expect(v.shared['2']).toBe(false)
  expect(v.shared['1']).toBe(true)
  // The repository may not travel as a `repo` source at all — an allowlisted repo would re-share
  // /p2 through the OR in `matchesAnySource`. Its still-allowed paths travel individually.
  expect(v.sources).not.toContainEqual({ type: 'repo', value: REPO_KEY })
  expect(v.sources).toContainEqual({ type: 'project', value: '/p1' })
})

test('allowlist: a repository whose projects are ALL still ON does travel as one repo source', () => {
  const v = evaluate('allowlist', new Set(), new Set())
  expect(v.sources).toContainEqual({ type: 'repo', value: REPO_KEY })
  expect(v.shared['1']).toBe(true)
  expect(v.shared['2']).toBe(true)
})

test('denylist (regression guard): switching /p2 OFF with its repository ON blocks only /p2', () => {
  const v = evaluate('denylist', new Set(), new Set(['/p2']))
  expect(v.shared['2']).toBe(false)
  expect(v.shared['1']).toBe(true)
  expect(v.shared['3']).toBe(true)
  expect(v.sources).toEqual([{ type: 'project', value: '/p2' }])
})

// --- CRITICAL 1 (worst path): "Block all" in Projects, Repositories untouched -------------------

test('allowlist: "Block all" in the Projects tab with the Repositories tab untouched shares NOTHING', () => {
  const v = evaluate('allowlist', new Set(), blockAllProjectsDraft(PROJECT_TARGETS))
  expect(v.shared['1']).toBe(false)
  expect(v.shared['2']).toBe(false)
  // Includes the remote-less session: a project with no remote lives in the `none` bucket, so
  // blocking it must keep `none:` out of the allowlist too, or /solo leaks through the repo tab.
  expect(v.shared['3']).toBe(false)
  expect(v.sources).toEqual([])
  // The choice this fix makes: the save is REFUSED by the existing empty-allowlist gate rather
  // than persisted as an allowlist that shares nothing.
  expect(v.emptyAllowlist).toBe(true)
})

test('denylist (regression guard): "Block all" in the Projects tab blocks every project', () => {
  const v = evaluate('denylist', new Set(), blockAllProjectsDraft(PROJECT_TARGETS))
  expect(v.shared['1']).toBe(false)
  expect(v.shared['2']).toBe(false)
  expect(v.shared['3']).toBe(false)
})

test('allowlist: blocking the "no repository" bucket in the Repositories tab hides the remote-less session', () => {
  const v = evaluate('allowlist', new Set([NO_REPO_KEY]), new Set())
  expect(v.shared['3']).toBe(false)
  expect(v.shared['1']).toBe(true)
})

// --- the edit view re-opens on exactly what it saved (the seed is the submit's inverse) --------

test('re-opening a saved allowlist reconstructs the SAME drafts, and re-saving produces the same sources', () => {
  const saved = evaluate('allowlist', new Set(), new Set(['/p2']))
  // `startEdit`'s seeding: the stored sources are read back as the "allowed" sets and run through
  // the very same conversion, which is its own inverse.
  const storedRepoKeys = new Set(
    saved.sources.filter(x => x.type === 'repo').map(x => `${x.value}`),
  )
  if (saved.sources.some(x => x.type === 'none')) storedRepoKeys.add(NO_REPO_KEY)
  const storedProjectPaths = new Set(saved.sources.filter(x => x.type === 'project').map(x => x.value))

  const storedRows = buildProjectRows(PROJECT_TARGETS, storedProjectPaths, storedRepoKeys)
  const seedRepoOff = resolveSubmittedRepoKeys('allowlist', TARGETS, storedRepoKeys, storedRows)
  const seedProjectOff = resolveSubmittedProjectPaths('allowlist', storedRows, storedProjectPaths)

  // The repository stays ON (it is only PARTLY allowed — /p1 yes, /p2 no); /p2 comes back OFF.
  expect(seedRepoOff.has(REPO_KEY)).toBe(false)
  expect(seedProjectOff.has('/p2')).toBe(true)
  expect(seedProjectOff.has('/p1')).toBe(false)

  const again = evaluate('allowlist', seedRepoOff, seedProjectOff)
  expect(again.shared).toEqual(saved.shared)
})

// --- CRITICAL 2: the add-central wizard --------------------------------------------------------

/** The wizard's own submit path — its two drafts through the SAME conversion the panel uses, then
 *  `buildSubmitBody`, then the server predicate. */
function evaluateWizard(mode: ShareMode, repoOff: Set<string>, projectOff: Set<string>) {
  const submitted = resolveSubmittedRules(mode, TARGETS, PROJECT_TARGETS, repoOff, projectOff)
  const body = buildSubmitBody({
    endpoint: 'https://central.example.com/', token: 't', org: 'o', mode, submitted,
  })
  const rules = shareRulesOf(body.shareMode, body.sources)
  const shared: Record<string, boolean> = {}
  for (const sess of SESSIONS) shared[sess.session_id] = sessionShared(sess, rules, INDEX)
  return { body, shared, emptyAllowlist: isEmptyAllowlist(mode, submitted.repoKeys, submitted.projectPaths) }
}

test('wizard, allowlist with ONE repository switched OFF: everything EXCEPT it is shared', () => {
  const off = toggleTarget(buildDefaultDraft(TARGETS), TARGETS.find(t => t.key === REPO_KEY)!, false)
  const v = evaluateWizard('allowlist', off, new Set())
  expect(v.shared['1']).toBe(false)
  expect(v.shared['2']).toBe(false)
  expect(v.shared['3']).toBe(true)
  expect(v.body.sources).not.toContainEqual({ type: 'repo', value: REPO_KEY })
})

test('wizard, allowlist with the default (untouched) draft shares everything it can attribute', () => {
  const v = evaluateWizard('allowlist', buildDefaultDraft(TARGETS), new Set())
  expect(v.shared['1']).toBe(true)
  expect(v.shared['2']).toBe(true)
  expect(v.shared['3']).toBe(true)
  expect(v.emptyAllowlist).toBe(false)
})

test('wizard, allowlist default draft with an AMBIGUOUS repository never submits an allowlist naming only it', () => {
  // A folder holding two repos is forced into `shareAllDraft` (locked) — under allowlist that used
  // to become `sources: [that one repo]`, i.e. "share ONLY the ambiguous repository".
  const mixedSessions: SessionMeta[] = [
    s({ session_id: 'm1', project_path: '/mixed', git_remote: REMOTE }),
    s({ session_id: 'm2', project_path: '/mixed', git_remote: 'https://github.com/org/other' }),
  ]
  const mixedProjects: ServerProject[] = [{ path: '/mixed', gitRemote: REMOTE }]
  const targets = buildShareTargets(mixedSessions, mixedProjects, [], { noRepo: 'No repository' })
  const projectTargets = buildProjectTargets(mixedSessions, mixedProjects, [])
  const index = buildPathRepoIndex(mixedSessions, mixedProjects)

  const repoOff = shareAllDraft(targets)
  expect(repoOff.size).toBeGreaterThan(0) // the ambiguous repo really is forced OFF
  const submitted = resolveSubmittedRules('allowlist', targets, projectTargets, repoOff, new Set())
  const body = buildSubmitBody({
    endpoint: 'https://c.example.com', token: 't', org: 'o', mode: 'allowlist', submitted,
  })
  const rules = shareRulesOf(body.shareMode, body.sources)
  // Whatever is listed, the ambiguous folder's sessions must NOT be shared by it.
  for (const sess of mixedSessions) expect(sessionShared(sess, rules, index)).toBe(false)
})

test('wizard, denylist (regression guard): one repository switched OFF blocks only that repository', () => {
  const off = toggleTarget(buildDefaultDraft(TARGETS), TARGETS.find(t => t.key === REPO_KEY)!, false)
  const v = evaluateWizard('denylist', off, new Set())
  expect(v.shared['1']).toBe(false)
  expect(v.shared['2']).toBe(false)
  // `withNoRepoWidening` folds the unattributed bucket in on the zero -> non-zero transition.
  expect(v.shared['3']).toBe(false)
  expect(v.body.sources).toContainEqual({ type: 'repo', value: REPO_KEY })
})

test('wizard, denylist (regression guard): the untouched default draft shares everything', () => {
  const v = evaluateWizard('denylist', buildDefaultDraft(TARGETS), new Set())
  expect(v.body.sources).toEqual([])
  expect(v.shared['1']).toBe(true)
  expect(v.shared['3']).toBe(true)
})
