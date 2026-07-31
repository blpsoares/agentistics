import { test, expect } from 'bun:test'
import { NO_REPO_KEY } from '@agentistics/core'
import type { ShareSource } from '@agentistics/core'
import type { SessionMeta } from '@agentistics/core'
import type { ProjectTarget, ShareTarget } from '../../lib/shareRepos'
import {
  resolveInitialTab, sourcesToRepoKeys, sourcesToProjectPaths, buildSourcesFromDraft,
  buildProjectRows, toggleProjectTarget, shareAllProjectsDraft, blockAllProjectsDraft,
  computeSharedSummary, isEmptyAllowlist, modeChanged, resolveModeConfirmVariant,
  groupProjectRows, resolveSubmittedRepoKeys, resolveSubmittedProjectPaths,
} from './sharePanelState'

function st(over: Partial<ShareTarget>): ShareTarget {
  return {
    key: 'github.com/org/repo', kind: 'repo', name: 'org/repo', host: 'github.com',
    sessions: 1, lastActive: '', orphan: false, conflictPaths: [],
    ...over,
  }
}

function pt(over: Partial<ProjectTarget>): ProjectTarget {
  return {
    key: '/p', kind: 'project', name: '/p', path: '/p', repoKey: '', sessions: 1, lastActive: '',
    locked: false, ...over,
  }
}

function s(over: Partial<SessionMeta>): SessionMeta {
  return {
    session_id: 'x', project_path: '/p', harness: 'claude',
    start_time: '', duration_minutes: 0, user_message_count: 0, assistant_message_count: 0,
    tool_counts: {}, tool_output_tokens: {}, agent_file_reads: {}, languages: [],
    git_commits: 0, git_pushes: 0, input_tokens: 0, output_tokens: 0,
    ...over,
  } as SessionMeta
}

// --- tab -----------------------------------------------------------------------------------

test('the picker opens on the Projects tab by default — that is what the user asked to see first', () => {
  expect(resolveInitialTab()).toBe('projects')
})

// --- sources <-> draft conversion ------------------------------------------------------------

test('sourcesToRepoKeys extracts repo + none sources, canonicalized; sourcesToProjectPaths extracts project sources', () => {
  const sources: ShareSource[] = [
    { type: 'repo', value: 'GitHub.com/Acme/API' },
    { type: 'none', value: '' },
    { type: 'project', value: '/home/user/app' },
  ]
  expect(sourcesToRepoKeys(sources).sort()).toEqual([NO_REPO_KEY, 'github.com/acme/api'].sort())
  expect(sourcesToProjectPaths(sources)).toEqual(['/home/user/app'])
})

test('buildSourcesFromDraft round-trips repo keys (incl. NO_REPO_KEY) and project paths into typed sources', () => {
  const sources = buildSourcesFromDraft(new Set(['github.com/acme/api', NO_REPO_KEY]), new Set(['/home/user/app']))
  expect(sources).toContainEqual({ type: 'repo', value: 'github.com/acme/api' })
  expect(sources).toContainEqual({ type: 'none', value: '' })
  expect(sources).toContainEqual({ type: 'project', value: '/home/user/app' })
  expect(sources.length).toBe(3)
})

test('an empty draft produces an empty sources array', () => {
  expect(buildSourcesFromDraft(new Set(), new Set())).toEqual([])
})

// --- project rows: locked-by-repo derivation --------------------------------------------------

test('a project locks the moment its repo is in the draft repo-key set — the same draft the repo tab edits', () => {
  const target = pt({ key: '/api', path: '/api', repoKey: 'github.com/acme/api' })
  const rows = buildProjectRows([target], new Set(), new Set(['github.com/acme/api']))
  expect(rows[0]!.locked).toBe(true)
  expect(rows[0]!.denied).toBe(true)
})

test('a toggle in the repo tab is reflected in the project tab\'s locks without touching the project draft', () => {
  const target = pt({ key: '/api', path: '/api', repoKey: 'github.com/acme/api' })
  const before = buildProjectRows([target], new Set(), new Set())
  expect(before[0]!.locked).toBe(false)
  expect(before[0]!.denied).toBe(false)

  // Simulate the repo tab blocking 'github.com/acme/api' — the SAME repo-key draft threaded in.
  const after = buildProjectRows([target], new Set(), new Set(['github.com/acme/api']))
  expect(after[0]!.locked).toBe(true)
  expect(after[0]!.denied).toBe(true)
})

test('a project with no repository is never locked, and toggles independently', () => {
  const target = pt({ key: '/solo', path: '/solo', repoKey: '' })
  const rows = buildProjectRows([target], new Set(['/solo']), new Set(['github.com/acme/other']))
  expect(rows[0]!.locked).toBe(false)
  expect(rows[0]!.denied).toBe(true) // directly denied via the project draft, not via a repo
})

test('toggleProjectTarget is a no-op on a locked row, and toggles freely on an unlocked one', () => {
  const locked = pt({ key: '/api', locked: true })
  const draft = new Set<string>()
  const stillEmpty = toggleProjectTarget(draft, locked, true, true)
  expect(stillEmpty.has('/api')).toBe(false)

  const unlocked = pt({ key: '/solo', locked: false })
  const denied = toggleProjectTarget(draft, unlocked, false, false)
  expect(denied.has('/solo')).toBe(true)
})

test('shareAllProjectsDraft empties the project draft; blockAllProjectsDraft denies every project key', () => {
  const targets = [pt({ key: '/a' }), pt({ key: '/b' })]
  expect([...shareAllProjectsDraft(targets)]).toEqual([])
  expect([...blockAllProjectsDraft(targets)].sort()).toEqual(['/a', '/b'])
})

test('groupProjectRows puts denied rows in blocked and the rest in shared, sessions-desc', () => {
  const targets = [pt({ key: 'a', name: 'a', sessions: 1 }), pt({ key: 'b', name: 'b', sessions: 5 })]
  const rows = buildProjectRows(targets, new Set(['a']), new Set())
  const grouped = groupProjectRows(rows, '', new Set())
  expect(grouped.blocked.map(r => r.target.key)).toEqual(['a'])
  expect(grouped.shared.map(r => r.target.key)).toEqual(['b'])
})

// --- shared summary, common to both tabs ------------------------------------------------------

test('computeSharedSummary in denylist mode: a session is shared unless its repo or its project is in the draft', () => {
  const sessions = [
    s({ session_id: '1', project_path: '/blocked-repo', git_remote: 'github.com/acme/api' }),
    s({ session_id: '2', project_path: '/blocked-project' }),
    s({ session_id: '3', project_path: '/fine' }),
  ]
  const projectTargets: ProjectTarget[] = [
    pt({ key: '/blocked-repo', path: '/blocked-repo', repoKey: 'github.com/acme/api' }),
    pt({ key: '/blocked-project', path: '/blocked-project', repoKey: '' }),
    pt({ key: '/fine', path: '/fine', repoKey: '' }),
  ]
  const summary = computeSharedSummary(
    sessions, projectTargets, 'denylist',
    new Set(['github.com/acme/api']), new Set(['/blocked-project']),
  )
  expect(summary.totalLive).toBe(3)
  expect(summary.sharedCount).toBe(1) // only '/fine'
})

test('computeSharedSummary in allowlist mode: a session is shared only when it matches a listed source', () => {
  const sessions = [
    s({ session_id: '1', project_path: '/allowed-project' }),
    s({ session_id: '2', project_path: '/not-listed' }),
  ]
  const projectTargets: ProjectTarget[] = [
    pt({ key: '/allowed-project', path: '/allowed-project', repoKey: '' }),
    pt({ key: '/not-listed', path: '/not-listed', repoKey: '' }),
  ]
  const summary = computeSharedSummary(sessions, projectTargets, 'allowlist', new Set(), new Set(['/allowed-project']))
  expect(summary.sharedCount).toBe(1)
  expect(summary.totalLive).toBe(2)
})

test('computeSharedSummary: an allowlist with nothing listed at all shares nothing', () => {
  const sessions = [s({ session_id: '1', project_path: '/x' })]
  const summary = computeSharedSummary(sessions, [], 'allowlist', new Set(), new Set())
  expect(summary.sharedCount).toBe(0)
  expect(summary.totalLive).toBe(1)
})

// --- mode (Task 7) ---------------------------------------------------------------------------

test('isEmptyAllowlist is true only for allowlist mode with nothing on either dimension', () => {
  expect(isEmptyAllowlist('allowlist', new Set(), new Set())).toBe(true)
  expect(isEmptyAllowlist('allowlist', new Set(['a']), new Set())).toBe(false)
  expect(isEmptyAllowlist('allowlist', new Set(), new Set(['/p']))).toBe(false)
  expect(isEmptyAllowlist('denylist', new Set(), new Set())).toBe(false)
})

test('modeChanged reports whether the draft mode differs from the stored one', () => {
  expect(modeChanged('denylist', 'denylist')).toBe(false)
  expect(modeChanged('denylist', 'allowlist')).toBe(true)
  expect(modeChanged('allowlist', 'denylist')).toBe(true)
})

test('resolveModeConfirmVariant names the direction of the switch so the confirm copy can state its own consequence', () => {
  expect(resolveModeConfirmVariant('denylist', 'allowlist')).toBe('toAllowlist')
  expect(resolveModeConfirmVariant('allowlist', 'denylist')).toBe('toDenylist')
  expect(resolveModeConfirmVariant('denylist', 'denylist')).toBe('none')
})

// --- resolveSubmittedRepoKeys / resolveSubmittedProjectPaths (mode-aware draft -> sources) -----

test('resolveSubmittedRepoKeys: denylist mode submits the raw denied set untouched', () => {
  const targets = [st({ key: 'a' }), st({ key: 'b' }), st({ key: 'c' })]
  const submitted = resolveSubmittedRepoKeys('denylist', targets, new Set(['a']))
  expect([...submitted]).toEqual(['a'])
})

test('resolveSubmittedRepoKeys: allowlist mode submits the COMPLEMENT — what is switched ON, not off', () => {
  const targets = [st({ key: 'a' }), st({ key: 'b' }), st({ key: 'c' })]
  // 'a' is OFF (denied) -> under allowlist, only 'b' and 'c' (the ON/shared ones) are submitted.
  const submitted = resolveSubmittedRepoKeys('allowlist', targets, new Set(['a']))
  expect([...submitted].sort()).toEqual(['b', 'c'])
})

test('resolveSubmittedRepoKeys: allowlist "block all" (everything OFF) submits an EMPTY set, never everything', () => {
  const targets = [st({ key: 'a' }), st({ key: 'b' })]
  const submitted = resolveSubmittedRepoKeys('allowlist', targets, new Set(['a', 'b']))
  expect(submitted.size).toBe(0)
})

test('resolveSubmittedRepoKeys: allowlist mode never submits a locked repo — it is always OFF, so never in the complement', () => {
  const targets = [st({ key: 'a', conflictPaths: ['/shared'] }), st({ key: 'b' })]
  // 'a' is locked (conflictPaths) and therefore always a member of draftDenied.
  const submitted = resolveSubmittedRepoKeys('allowlist', targets, new Set(['a']))
  expect([...submitted]).toEqual(['b'])
})

test('resolveSubmittedProjectPaths: denylist mode submits the raw project-denied set untouched, ignoring repo locks', () => {
  const rows = [
    { target: pt({ key: '/p1' }), denied: true, locked: false },
    { target: pt({ key: '/p2' }), denied: false, locked: false },
  ]
  const submitted = resolveSubmittedProjectPaths('denylist', rows, new Set(['/p1']))
  expect([...submitted]).toEqual(['/p1'])
})

test('resolveSubmittedProjectPaths: allowlist mode submits the complement, excluding rows locked by a denied repo', () => {
  const rows = [
    { target: pt({ key: '/p1' }), denied: false, locked: false }, // ON -> allowed
    { target: pt({ key: '/p2' }), denied: true, locked: true },   // locked by its repo -> never allowed
    { target: pt({ key: '/p3' }), denied: true, locked: false },  // direct project deny -> not allowed
  ]
  const submitted = resolveSubmittedProjectPaths('allowlist', rows, new Set(['/p3']))
  expect([...submitted]).toEqual(['/p1'])
})

test('resolveSubmittedRepoKeys/resolveSubmittedProjectPaths + isEmptyAllowlist: an allowlist "share all" with locked rows never widens into "share everything"', () => {
  // Locked repo 'a' is always a member of draftDenied (buildInitialDraft/shareAllDraft both force
  // it in) — the complement therefore correctly excludes it, and blocking everything ELSE leaves
  // the submitted set empty, tripping the refusal instead of silently allowing the locked repo.
  const targets = [st({ key: 'a', conflictPaths: ['/shared'] })]
  const submittedRepoKeys = resolveSubmittedRepoKeys('allowlist', targets, new Set(['a']))
  const submittedProjectPaths = resolveSubmittedProjectPaths('allowlist', [], new Set())
  expect(isEmptyAllowlist('allowlist', submittedRepoKeys, submittedProjectPaths)).toBe(true)
})
