/**
 * siblingWarnings.ts — PURE. The picker's half of the REVERSE sharing warning: which rows this
 * edit is about to start sharing that another machine of the same account deliberately withholds.
 *
 * It is the mirror of the forward warning on the connection card (`cardState.ts`'s
 * `showsElsewhereWarning`), and its evidence is the opposite kind. The forward warning is built
 * from what the central HOLDS — positive proof. This one cannot be: a sibling that hides a
 * repository simply leaves the central without it, and absence is ambiguous between "restricted"
 * and "never cloned there". So the only input here is `SiblingRuleFact[]` — the sibling's own
 * sealed, decrypted testimony — and the decision itself is `bucketSharedBy` from
 * `@agentistics/core`, cross-checked against the server's `sessionShared` in
 * `share-rules.test.ts`. Nothing in this file re-derives the sharing semantics.
 *
 * PROJECTS CORRELATE BY FOLDER NAME, NOT BY PATH. The same project sits at
 * `/home/user/xpto/abc/projFicticio` here and `/home/user/projFicticio` there, so comparing full
 * paths across machines would make this warning silently never fire for projects. `@agentistics/
 * core`'s `siblingsWithholding` keys the project dimension by folder name for the cross-machine
 * comparison ONLY — the stored rules, and `sessionShared`, still match the exact path they always
 * have. It is also a HEURISTIC (`api`, `web`, `docs` collide routinely), which is why each machine
 * carries the sibling's OWN path when the announcement names one, and why the copy says "a project
 * with this name".
 *
 * TWO THINGS THIS DELIBERATELY DOES NOT DO. It never blocks: it produces rows for the UI to state,
 * and the user decides. And it never treats an empty result as a guarantee — this machine knows
 * only what siblings announced to it, and only since the channel began, which is why every surface
 * that renders these rows also prints the best-effort caveat.
 */
import { siblingsWithholding, type ShareBucket, type SiblingRuleFact } from '@agentistics/core'
import type { ShareTarget, ProjectTarget } from '../../lib/shareRepos'

/** One sibling that withholds a row, with whatever evidence the announcement carried. */
export interface WithholdingMachine {
  name: string
  /** The sibling's OWN project paths that correlate with this row by folder name. Empty when the
   *  match was on the repo dimension, or when the sibling withholds by omission (an allowlist has
   *  no path to offer). Never invented. */
  paths: string[]
}

/** One row the user is about to start sharing, and who withholds it. `machines` is never empty. */
export interface SiblingWarning {
  /** The picker row's key — a canonical repo key / `NO_REPO_KEY`, or a `project_path`. */
  key: string
  /** The row's display name, as the picker already prints it. */
  name: string
  /** The withholding siblings, deduplicated by name and sorted. */
  machines: WithholdingMachine[]
}

/** A repo-tab row names one dimension: its own bucket (`NO_REPO_KEY` included — that bucket is
 *  restrictable, so it is warnable). */
export function repoBucket(t: ShareTarget): ShareBucket {
  return { repoKey: t.key }
}

/**
 * A project-tab row names BOTH dimensions, so a sibling that denies the repository is reported on
 * the project row too — the same "deny wins across dimensions" reading the uploader applies.
 *
 * `repoKey` is `''` for a project with no resolvable remote and is omitted in that case rather
 * than passed through: `''` is not the unattributed bucket (`NO_REPO_KEY` is, and it belongs to
 * the repo tab), so forwarding it would compare against the wrong row.
 */
export function projectBucket(t: ProjectTarget): ShareBucket {
  return t.repoKey ? { repoKey: t.repoKey, projectPath: t.path } : { projectPath: t.path }
}

/**
 * The sibling machines whose announced rules withhold this bucket, by display name — deduplicated
 * (a machine that announced twice is one voice) and sorted (a poll must not reorder a row's badge).
 * An absent fact list yields nothing, which is the honest reading of "nobody has told me anything".
 */
export function machinesWithholding(
  facts: readonly SiblingRuleFact[] | undefined,
  bucket: ShareBucket,
): WithholdingMachine[] {
  // Deduplicated by display NAME (two machine ids can carry one label), merging their evidence
  // rather than dropping one of them — the paths are the whole point of showing them.
  const byName = new Map<string, Set<string>>()
  for (const w of siblingsWithholding(facts ?? [], bucket)) {
    const paths = byName.get(w.machineName) ?? new Set<string>()
    for (const p of w.paths) paths.add(p)
    byName.set(w.machineName, paths)
  }
  return [...byName.entries()]
    .map(([name, paths]) => ({ name, paths: [...paths].sort((a, b) => a.localeCompare(b)) }))
    .sort((a, b) => a.name.localeCompare(b.name))
}

/**
 * The warnings for one tab: every row whose key is in `startsSharing` — the draft's
 * "was off, is now on" set — that at least one sibling withholds.
 *
 * Scoped to that set on purpose. A row a sibling withholds and which this edit does not touch is
 * not a decision the user is making right now, and warning about it would turn the point-of-
 * decision signal into wallpaper. A key with no matching row is dropped rather than rendered under
 * its raw key, which would name a repository the user cannot see in the list.
 */
export function siblingWarningsFor<T extends { key: string; name: string }>(
  facts: readonly SiblingRuleFact[] | undefined,
  rows: readonly T[],
  bucketOf: (row: T) => ShareBucket,
  startsSharing: ReadonlySet<string>,
): SiblingWarning[] {
  const out: SiblingWarning[] = []
  for (const row of rows) {
    if (!startsSharing.has(row.key)) continue
    const machines = machinesWithholding(facts, bucketOf(row))
    if (machines.length === 0) continue
    out.push({ key: row.key, name: row.name, machines })
  }
  return out.sort((a, b) => a.name.localeCompare(b.name) || a.key.localeCompare(b.key))
}

/** Whether the warning block has anything to say. */
export function hasSiblingWarnings(warnings: readonly SiblingWarning[]): boolean {
  return warnings.length > 0
}

/**
 * The per-row badge input: row key → the siblings withholding it, for EVERY row rather than only
 * the ones the draft touches. The badge exists to be readable before the switch is flipped, which
 * is the difference between warning someone and telling them afterwards; `siblingWarningsFor` is
 * the after-the-decision summary and is scoped to the change set instead.
 *
 * Rows nobody withholds are absent from the map, not present with an empty array — a lookup that
 * returns nothing is the "say nothing" case, and it should be impossible to render a badge from it.
 */
export function withholdMap<T extends { key: string }>(
  facts: readonly SiblingRuleFact[] | undefined,
  rows: readonly T[],
  bucketOf: (row: T) => ShareBucket,
): Map<string, WithholdingMachine[]> {
  const map = new Map<string, WithholdingMachine[]>()
  if (!facts || facts.length === 0) return map
  for (const row of rows) {
    const machines = machinesWithholding(facts, bucketOf(row))
    if (machines.length > 0) map.set(row.key, machines)
  }
  return map
}
