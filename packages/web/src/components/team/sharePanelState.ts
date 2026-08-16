import { NO_REPO_KEY, normalizeGitRemote } from '@agentistics/core'
import type { SessionMeta, ShareSource } from '@agentistics/core'
import { canonicalRepoKey, type ProjectTarget, type ShareTarget } from '../../lib/shareRepos'

/**
 * sharePanelState.ts — the pure decisions behind the two-tab picker (Plan 4 Tasks 6–7):
 * "Projetos" and "Repositórios" as two lenses over ONE rule list (`ShareSource[]` + `shareMode`),
 * plus the per-connection allowlist/denylist mode selector. Same seam as `repoPanelState.ts`
 * (which stays the repo-tab's own pure logic, unchanged): every decision that is substantive
 * rather than presentational lives here, unit-tested directly.
 *
 * The user's own words shaped this file's one hard rule: "repo + projeto são a mesma coisa — o
 * que muda é que o repo foi identificado pelo path do projeto pq tem .git". A repository is never
 * a second, independent rule from its projects — it is looked up by `ProjectTarget.repoKey` (built
 * in `shareRepos.ts` from the exact same path→repo index the repo tab itself uses), so blocking a
 * repository in one tab locks its projects in the other WITHOUT ever writing a duplicate rule for
 * each of that repository's paths (a repo can span many worktrees, per the user's own machine).
 */

export type ShareMode = 'denylist' | 'allowlist'
export type PickerTab = 'projects' | 'repos'

/** The picker opens on Projects — that is what the user asked to see ("a ideia é todos os
 *  projetos"), with Repositories as the second lens over the same rules. Trivial, but named and
 *  tested like every other UI decision in this seam rather than inlined as a literal default. */
export function resolveInitialTab(): PickerTab {
  return 'projects'
}

// --- sources (wire) <-> two per-dimension draft sets ------------------------------------------

/** Mirrors `share-rules.ts`'s `normalizeSources` for the repo dimension only: `repo` sources are
 *  re-canonicalized (defends against an older client's differently-cased/aliased spelling), and
 *  `none` always folds to the fixed `NO_REPO_KEY` sentinel regardless of its stored `value`. */
export function sourcesToRepoKeys(sources: readonly ShareSource[] | null | undefined): string[] {
  const out = new Set<string>()
  for (const raw of sources ?? []) {
    if (!raw) continue
    if (raw.type === 'none') { out.add(NO_REPO_KEY); continue }
    if (raw.type !== 'repo') continue
    const key = canonicalRepoKey(normalizeGitRemote(raw.value))
    if (key) out.add(key)
  }
  return [...out]
}

/** The project dimension of a stored source list — verbatim `project_path` values, deduped. */
export function sourcesToProjectPaths(sources: readonly ShareSource[] | null | undefined): string[] {
  const out = new Set<string>()
  for (const raw of sources ?? []) {
    if (raw && raw.type === 'project' && raw.value) out.add(raw.value)
  }
  return [...out]
}

/** The inverse of the two functions above: the two per-dimension draft sets → the typed
 *  `ShareSource[]` the wire (`POST`/`PATCH /api/team/connections`) expects. `NO_REPO_KEY` in
 *  `repoKeys` becomes the fixed `{type:'none', value:''}` entry; every other repo key becomes
 *  `{type:'repo', value}`; every project path becomes `{type:'project', value}`. */
export function buildSourcesFromDraft(
  repoKeys: ReadonlySet<string>,
  projectPaths: ReadonlySet<string>,
): ShareSource[] {
  const out: ShareSource[] = []
  for (const key of repoKeys) {
    out.push(key === NO_REPO_KEY ? { type: 'none', value: '' } : { type: 'repo', value: key })
  }
  for (const path of projectPaths) out.push({ type: 'project', value: path })
  return out
}

// --- project rows: locked-by-repo derivation (Task 6) ------------------------------------------

export interface EffectiveProjectRow {
  target: ProjectTarget
  /** Whether the DRAFT hides this project — directly (its own path is in `draftProjectPaths`) OR
   *  because its repository is currently denied in the OTHER tab's draft. Never the stored list —
   *  same rule `repoPanelState.ts`'s `EffectiveRow.denied` follows. */
  denied: boolean
  /** True only when `denied` is caused by the project's REPOSITORY, never by a direct project
   *  rule — this is what renders "blocked by repository X" and disables the row's own switch, so
   *  no contradictory pair (project shared, its repo blocked) can ever be created. */
  locked: boolean
}

/**
 * The repo-tab ROW a project belongs to. `ProjectTarget.repoKey` is `''` for a project with no
 * known remote, but that project's sessions are not in a nameless bucket on the server: with no
 * remote of their own and none learnable from their path, `share-rules.ts`'s `repoKeyOf` resolves
 * them to the `NO_REPO_KEY` sentinel — the repo tab's own "No repository" row. So the two tabs
 * only agree once that mapping is applied, and it must be applied in EVERY place that relates the
 * two dimensions (the lock below, and `partiallyDeniedRepoKeys`), or the disagreement reappears
 * with a different shape: blocking "No repository" left every remote-less project rendering ON,
 * and "Block all" in the Projects tab left `none:` on an allowlist, re-sharing exactly those
 * sessions through the repo dimension.
 */
export function projectRepoBucket(target: Pick<ProjectTarget, 'repoKey'>): string {
  return target.repoKey || NO_REPO_KEY
}

/** Whether a project row is locked by the repo tab's draft. The ONE definition — the panel and the
 *  add-central wizard both call it for their row toggles, so a project can never be togglable in
 *  one surface and locked in the other. */
export function isProjectLocked(
  target: Pick<ProjectTarget, 'repoKey'>,
  draftRepoKeys: ReadonlySet<string>,
): boolean {
  return draftRepoKeys.has(projectRepoBucket(target))
}

/**
 * `draftRepoKeys` is the SAME Set the repo tab's own draft holds — passing it through here (rather
 * than re-deriving it from a stored snapshot) is what makes a toggle in one tab show up as a lock
 * in the other on the very next render, with no extra plumbing.
 */
export function buildProjectRows(
  targets: readonly ProjectTarget[],
  draftProjectPaths: ReadonlySet<string>,
  draftRepoKeys: ReadonlySet<string>,
): EffectiveProjectRow[] {
  return targets.map(target => {
    const locked = isProjectLocked(target, draftRepoKeys)
    const denied = locked || draftProjectPaths.has(target.key)
    return { target, denied, locked }
  })
}

/** Every repo-tab row that has at least one DENIED project row under it — the repositories that
 *  are, at most, PARTLY shared. Includes a fully-denied repository (all of its project rows are
 *  locked, hence denied); callers that render the "partial" hint filter those out by their own
 *  `denied` flag, and the submit path excludes them either way. */
export function partiallyDeniedRepoKeys(projectRows: readonly EffectiveProjectRow[]): Set<string> {
  const out = new Set<string>()
  for (const row of projectRows) if (row.denied) out.add(projectRepoBucket(row.target))
  return out
}

// --- draft -> submitted sources (mode-aware conversion) -----------------------------------------

/**
 * `draftDenied` / `projectDraftDenied` (and every row's `denied` flag derived from them) always
 * mean the SAME thing to the user regardless of mode: "this switch is OFF, this will not be
 * shared" — that reading is mode-invariant by design, which is why `EditView`'s labels, counts and
 * the confirm impact estimate never branch on mode and stay correct in both.
 *
 * But the WIRE shape does not have that invariance: `shareMode: 'denylist'` stores exactly the
 * blocked set (`sources` = "share everything except these"), while `shareMode: 'allowlist'`
 * stores its OPPOSITE — the set of things TO share (`sources` = "share only these"). Submitting
 * the raw denied-set unchanged under `allowlist` would silently invert every rule the picker just
 * displayed: "Block all" (every switch OFF) would submit a `sources` list naming every repo, which
 * an allowlist reads as "share every one of these" — the exact opposite of the button just
 * pressed, and the one path (Plan 4 Task 7) that must instead trip `isEmptyAllowlist`'s refusal.
 *
 * These two functions are the ONLY place that conversion happens, so `attemptSave`'s empty-check
 * and `confirmApply`'s submitted `sources` always agree on what "the draft, in this mode" means.
 * Denylist mode returns the raw set untouched (today's behaviour, unchanged); allowlist mode
 * returns its complement over the known targets — which naturally excludes every locked repo (its
 * key is unconditionally a member of `draftDenied`, so it can never appear in the complement) and
 * every project locked by a denied repo (`EffectiveProjectRow.denied` already folds that in), so a
 * repo the user cannot toggle back on can never smuggle itself in as an allowed project either.
 */
export function resolveSubmittedRepoKeys(
  mode: ShareMode,
  targets: readonly ShareTarget[],
  draftDenied: ReadonlySet<string>,
  projectRows: readonly EffectiveProjectRow[],
): Set<string> {
  if (mode === 'denylist') return new Set(draftDenied)
  // The server evaluates the submitted sources with an OR (`matchesAnySource`). Under a DENYLIST
  // that OR means "deny wins", which is what makes two independent per-dimension complements
  // correct there. Under an ALLOWLIST the same OR means "share wins" — so a repository submitted
  // as allowed re-shares every project under it, and a project the user switched OFF in the other
  // tab is shared anyway. A repository may therefore only travel as a `repo` source when NO
  // project under it is denied; a partly-allowed one travels as its individual `project` sources
  // instead (which `resolveSubmittedProjectPaths` already produces).
  //
  // The cost is that a NEW worktree of a partly-allowed repository is not shared automatically —
  // the correct fail-closed reading of "share only…", and what the Repositories tab states on the
  // row (`COPY.repoPartialAllowSub`) so the two tabs never disagree in the other direction.
  const partial = partiallyDeniedRepoKeys(projectRows)
  return new Set(targets.filter(t => !draftDenied.has(t.key) && !partial.has(t.key)).map(t => t.key))
}

export function resolveSubmittedProjectPaths(
  mode: ShareMode,
  projectRows: readonly EffectiveProjectRow[],
  projectDraftDenied: ReadonlySet<string>,
): Set<string> {
  if (mode === 'denylist') return new Set(projectDraftDenied)
  return new Set(projectRows.filter(r => !r.denied).map(r => r.target.key))
}

export interface SubmittedRules {
  /** The project rows the two tabs render — also the input the repo conversion needs, so it is
   *  returned rather than rebuilt by the caller (rebuilding it from different drafts is precisely
   *  how the two dimensions drifted apart). */
  projectRows: EffectiveProjectRow[]
  repoKeys: Set<string>
  projectPaths: Set<string>
}

/**
 * The WHOLE draft → wire conversion, in one place: the two mode-invariant "switch is OFF" drafts
 * become the `sources` this mode actually stores. Every surface that submits rules — the
 * per-connection panel AND the add-central wizard — must go through this, and so must every test
 * that claims something about what a central will receive.
 *
 * This exists because the two halves were composed by hand at each call site: the panel composed
 * them correctly for one dimension and not across the two, and the wizard submitted the raw draft
 * unconverted, which under `allowlist` sent the central the one repository the user had HIDDEN and
 * nothing else. Both were invisible to per-function tests, because each function was right on its
 * own.
 */
export function resolveSubmittedRules(
  mode: ShareMode,
  targets: readonly ShareTarget[],
  projectTargets: readonly ProjectTarget[],
  repoDraftDenied: ReadonlySet<string>,
  projectDraftDenied: ReadonlySet<string>,
): SubmittedRules {
  const projectRows = buildProjectRows(projectTargets, projectDraftDenied, repoDraftDenied)
  return {
    projectRows,
    repoKeys: resolveSubmittedRepoKeys(mode, targets, repoDraftDenied, projectRows),
    projectPaths: resolveSubmittedProjectPaths(mode, projectRows, projectDraftDenied),
  }
}

/** A no-op on a locked row — its switch renders disabled, but a stray call must not silently
 *  unlock it (same defensive rule `repoPanelState.ts`'s `toggleTarget` follows). */
export function toggleProjectTarget(
  draft: ReadonlySet<string>,
  target: Pick<ProjectTarget, 'key'>,
  nextShared: boolean,
  locked: boolean,
): Set<string> {
  if (locked) return new Set(draft)
  const next = new Set(draft)
  if (nextShared) next.delete(target.key)
  else next.add(target.key)
  return next
}

/** Clears every DIRECT project rule — a project still locked by its repository stays hidden, but
 *  that comes from the repo-tab draft, never from this one. */
export function shareAllProjectsDraft(_targets: readonly ProjectTarget[]): Set<string> {
  return new Set()
}

/** Denies every project outright. */
export function blockAllProjectsDraft(targets: readonly ProjectTarget[]): Set<string> {
  return new Set(targets.map(t => t.key))
}

// --- grouping (mirrors repoPanelState.ts's groupRows, for the project dimension) ----------------

export interface GroupedProjectRows {
  blocked: EffectiveProjectRow[]
  shared: EffectiveProjectRow[]
  stale: EffectiveProjectRow[]
}

function matchesProjectSearch(t: ProjectTarget, search: string): boolean {
  const needle = search.trim().toLowerCase()
  if (!needle) return true
  return t.name.toLowerCase().includes(needle) || t.path.toLowerCase().includes(needle)
}

function byProjectSessionsDesc(a: EffectiveProjectRow, b: EffectiveProjectRow): number {
  return b.target.sessions - a.target.sessions || a.target.name.localeCompare(b.target.name)
}

export function groupProjectRows(
  rows: readonly EffectiveProjectRow[],
  search: string,
  keepVisible: ReadonlySet<string>,
): GroupedProjectRows {
  const blocked: EffectiveProjectRow[] = []
  const shared: EffectiveProjectRow[] = []
  const stale: EffectiveProjectRow[] = []
  for (const row of rows) {
    if (row.target.sessions === 0) {
      if (row.denied) stale.push(row)
      continue
    }
    if (!matchesProjectSearch(row.target, search) && !keepVisible.has(row.target.key)) continue
    ;(row.denied ? blocked : shared).push(row)
  }
  blocked.sort(byProjectSessionsDesc)
  shared.sort(byProjectSessionsDesc)
  stale.sort(byProjectSessionsDesc)
  return { blocked, shared, stale }
}

// --- the shared summary, common to both tabs (Task 6) -------------------------------------------

export interface SharedSummary {
  sharedCount: number
  totalLive: number
}

/**
 * The ONE summary line rendered above both tabs — computed directly from the raw session list
 * (not from either tab's per-row sums, which would double-count: a repo row and a project row can
 * describe the same sessions). Mirrors `share-rules.ts`'s `sessionShared` for the two dimensions
 * this picker edits (repo/none and project); it deliberately does NOT reproduce the server's
 * `conflictPaths` fail-closed check — that ambiguity is a repo-tab-only concept
 * (`repoPanelState.ts`'s `isLocked`), and the server's own `sessionShared` still enforces it
 * regardless of what this summary displays.
 */
export function computeSharedSummary(
  sessions: readonly Pick<SessionMeta, 'git_remote' | 'project_path'>[],
  projectTargets: readonly ProjectTarget[],
  mode: ShareMode,
  repoKeys: ReadonlySet<string>,
  projectPaths: ReadonlySet<string>,
): SharedSummary {
  const repoByPath = new Map(projectTargets.map(t => [t.path, t.repoKey]))
  let sharedCount = 0
  let totalLive = 0
  for (const s of sessions) {
    totalLive++
    const ownRepo = canonicalRepoKey(normalizeGitRemote(s.git_remote ?? ''))
    const repoKey = ownRepo || repoByPath.get(s.project_path) || NO_REPO_KEY
    const matchesRepo = repoKeys.has(repoKey)
    const matchesProject = Boolean(s.project_path) && projectPaths.has(s.project_path)
    const matches = matchesRepo || matchesProject
    const isShared = mode === 'allowlist' ? matches : !matches
    if (isShared) sharedCount++
  }
  return { sharedCount, totalLive }
}

// --- mode selector (Task 7) --------------------------------------------------------------------

/** An allowlist that names nothing on EITHER dimension shares nothing at all — the UI must refuse
 *  to save this silently (the plan's own words: "the opposite reading is the one that leaks"). */
export function isEmptyAllowlist(
  mode: ShareMode,
  repoKeys: ReadonlySet<string>,
  projectPaths: ReadonlySet<string>,
): boolean {
  return mode === 'allowlist' && repoKeys.size === 0 && projectPaths.size === 0
}

export function modeChanged(stored: ShareMode, draft: ShareMode): boolean {
  return stored !== draft
}

export type ModeConfirmVariant = 'toAllowlist' | 'toDenylist' | 'none'

/** Names the DIRECTION of a mode switch so the confirm modal can state its own consequence
 *  ("apenas" hides everything not listed — usually a large removal; "exceto" widens sharing back
 *  to everything not listed). `'none'` when the mode itself did not change this edit. */
export function resolveModeConfirmVariant(stored: ShareMode, draft: ShareMode): ModeConfirmVariant {
  if (stored === draft) return 'none'
  return draft === 'allowlist' ? 'toAllowlist' : 'toDenylist'
}
