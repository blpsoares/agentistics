/**
 * siblingRules.ts — PURE. What another machine of the same account has TESTIFIED about its own
 * sharing rules, and whether that testimony withholds a given repository or project.
 *
 * WHY THIS EXISTS, AND WHY IT MAY NOT BE DERIVED FROM THE CENTRAL. `account-repos.ts` answers the
 * FORWARD question — "I hid repo X here, and the central still holds X from another of my
 * machines" — from POSITIVE evidence: the central demonstrably has the data. The REVERSE question
 * ("I am about to start sharing X; does a sibling deliberately withhold it?") has no such evidence
 * available. If a sibling hides X the central simply lacks X from it, and absence is ambiguous:
 * the sibling may have restricted X, or may never have cloned it. Warning on absence would fire
 * constantly and falsely, and a sibling's rules deliberately never reach the central at all.
 *
 * The ONLY sound source is therefore the sibling's own encrypted testimony — the sealed envelope
 * (`envelope-*.ts`) it already sends through the central, which the central cannot read. This
 * module is the arithmetic over those decrypted announcements and NOTHING else.
 *
 * WHAT THIS CAN AND CANNOT SAY. A `SiblingRuleFact` is a full SNAPSHOT of one machine's rules for
 * one central, not a delta, so a later announcement from that machine SUPERSEDES the earlier one
 * entirely — which is exactly how a sibling that LIFTS a restriction retracts the fact. What the
 * channel cannot express is a machine that goes quiet: a decommissioned sibling's last
 * announcement stands forever, and a restriction applied before this channel existed was never
 * announced at all. The absence of a warning is therefore never proof that nobody restricts a
 * repository, and every surface that renders this must say so.
 *
 * THE PROJECT DIMENSION IS CORRELATED BY FOLDER NAME, AND ONLY HERE. The same project lives at a
 * different path on every machine — `/home/user/xpto/abc/projFicticio` on one,
 * `/home/user/projFicticio` on another — so comparing full `project_path` strings across machines
 * correlates almost nothing, and the warning would silently never fire for the case it exists for.
 * `projectNameKey` is therefore the cross-machine key: final folder name, separators unified, case
 * folded.
 *
 * THE LINE NOBODY MAY CROSS. `bucketSharedBy` stays EXACT and is what the cross-check holds to
 * `sessionShared`: the stored rules keep matching the exact `project_path` they always have. If a
 * local rule denying `/home/a/x/proj` started meaning "every project named proj", a live privacy
 * rule would silently widen into paths the user never named — far worse than the bug this fixes.
 * The basename is a CORRELATION key BETWEEN machines, never a rule semantic. `shareBucketKeys`
 * (exact) and `crossMachineKeys` (correlation) are separate for that reason, and they must stay
 * separate however tempting it looks to unify them.
 *
 * AND IT IS A HEURISTIC. `api`, `web`, `docs`, `backend` are not exotic names; two machines can
 * hold genuinely different projects under one folder name. A match is EVIDENCE, not proof, which
 * is why `siblingsWithholding` reports the sibling's own path when the announcement carries one,
 * and why the UI must say "a project with this name" rather than "this project".
 *
 * PURITY: no I/O, no dates read from the clock, no `preferences`. `siblingRules.test.ts` covers
 * the arithmetic; `share-rules.test.ts` (server) cross-checks `bucketSharedBy` against
 * `sessionShared`, which stays the single source of the sharing semantics.
 */
import { NO_REPO_KEY, type ShareSource } from './team'
import { normalizeGitRemote } from './types'

/**
 * One sibling machine's announced rules for one central, as decrypted from a sealed envelope.
 *
 * This is the FACT, and it is deliberately a different thing from the PROPOSAL the same envelope
 * produces (`Proposal` in `envelope-inbox.ts`). A proposal is an offer with a lifetime — the user
 * dismisses it and it is gone. The fact is knowledge, and dismissing "apply this here" must not
 * erase "the sibling restricts this". They are stored separately for that reason.
 */
export interface SiblingRuleFact {
  /** The sender's machine id, as the central's key directory named it. The supersede key. */
  machineId: string
  /** Display name at the time of the announcement. */
  machineName: string
  shareMode: 'denylist' | 'allowlist'
  sources: ShareSource[]
  /** When the sender applied it, per the SENDER's clock. Display only — never an ordering input. */
  at: string
  /** When this machine decrypted it. */
  receivedAt: string
}

/** The two rule fields a fact and a live connection have in common. */
export interface AnnouncedRules {
  shareMode: 'denylist' | 'allowlist'
  sources: readonly ShareSource[]
}

/**
 * A single repository / project bucket, as a picker row names it. Both fields are optional
 * because the two picker tabs name different halves: a repo row has only `repoKey`, a project row
 * has a path and (usually) the repo it resolves to.
 */
export interface ShareBucket {
  /** Canonical repo key (`host/org/repo`), or `NO_REPO_KEY` for the unattributed bucket. */
  repoKey?: string
  /** `project_path`. */
  projectPath?: string
}

/**
 * Case- and alias-folded repository key — the same folding `share-rules.ts` and `shareRepos.ts`
 * apply, so a repo cloned over SSH on one machine and over HTTPS on another is ONE bucket. Kept
 * local rather than imported so this module stays dependency-free; `share-rules.test.ts`
 * cross-checks the outcome against the server's own function.
 */
function foldRepoKey(key: string): string {
  const lower = (key ?? '').toLowerCase()
  if (!lower) return ''
  const slash = lower.indexOf('/')
  if (slash <= 0) return lower
  const host = lower.slice(0, slash).replace(/^(ssh|altssh)\./, '')
  return host + lower.slice(slash)
}

/**
 * A stored `ShareSource` → the canonical `${type}:${value}` key, or `null` for junk. Deliberately
 * identical to `sourceKey` in `share-rules.ts`, down to `normalizeGitRemote` running BEFORE the
 * fold and an unresolvable repo value being DROPPED rather than quietly collapsed into the `none:`
 * bucket — a source the server would ignore must not become a warning here.
 */
function sourceKeyOf(source: ShareSource): string | null {
  if (!source || typeof source.value !== 'string') return null
  if (source.type === 'none') return 'none:'
  if (source.type === 'repo') {
    const key = foldRepoKey(normalizeGitRemote(source.value))
    return key ? `repo:${key}` : null
  }
  if (source.type === 'project') return source.value ? `project:${source.value}` : null
  return null
}

/**
 * The canonical source keys a bucket occupies — at most one per dimension. `NO_REPO_KEY` keys as
 * the fixed `none:` bucket, never as `repo:__no_repo__`: "no linked repository" is its own
 * dimension, not a repository whose name happens to be the sentinel.
 */
export function shareBucketKeys(bucket: ShareBucket): string[] {
  const keys: string[] = []
  const raw = bucket.repoKey ?? ''
  // The sentinel is checked BEFORE normalization: `normalizeGitRemote('__no_repo__')` is '', so
  // normalizing first would silently drop the one bucket the user most often restricts.
  if (raw === NO_REPO_KEY) keys.push('none:')
  else {
    const repo = foldRepoKey(normalizeGitRemote(raw))
    if (repo) keys.push(`repo:${repo}`)
  }
  if (bucket.projectPath) keys.push(`project:${bucket.projectPath}`)
  return keys
}

/**
 * The CROSS-MACHINE correlation key for a project path: its final folder name, with `\\` unified
 * to `/`, trailing separators stripped, and case folded.
 *
 * Case folding is deliberate and is the one judgement call here: WSL and Windows machines share
 * these accounts, so `Projeto` and `projeto` are routinely the same project. The cost is that two
 * sibling directories differing only in case collide on one machine — acceptable for a key that is
 * already avowedly a heuristic, and the copy says so.
 *
 * Returns `''` for anything with no folder name (`''`, `/`, `C:\\`), and an empty key correlates
 * with nothing — silence, never a match on emptiness.
 */
export function projectNameKey(path: string | null | undefined): string {
  const unified = (path ?? '').trim().replace(/\\/g, '/')
  const trimmed = unified.replace(/\/+$/, '')
  const last = trimmed.slice(trimmed.lastIndexOf('/') + 1).trim()
  // `C:` is a drive, not a folder — a path that reduced to one names no project.
  if (!last || /^[A-Za-z]:$/.test(last)) return ''
  return last.toLowerCase()
}

/**
 * The bucket's keys for a CROSS-MACHINE comparison: the repo dimension unchanged (a normalized
 * remote is already path-independent, and stays the authority there) and the project dimension
 * keyed by folder name instead of by full path.
 */
function crossMachineKeys(bucket: ShareBucket): string[] {
  const keys: string[] = []
  const raw = bucket.repoKey ?? ''
  if (raw === NO_REPO_KEY) keys.push('none:')
  else {
    const repo = foldRepoKey(normalizeGitRemote(raw))
    if (repo) keys.push(`repo:${repo}`)
  }
  const name = projectNameKey(bucket.projectPath)
  if (name) keys.push(`projectname:${name}`)
  return keys
}

/** A source's key for the same comparison. `null` for junk, exactly as `sourceKeyOf`. */
function crossMachineSourceKey(source: ShareSource): string | null {
  if (source && source.type === 'project') {
    const name = projectNameKey(typeof source.value === 'string' ? source.value : '')
    return name ? `projectname:${name}` : null
  }
  return sourceKeyOf(source)
}

/**
 * Whether `rules` share the bucket. This is `sessionShared`'s decision restricted to a bucket the
 * caller names explicitly, so there is no ambiguous-directory case to fail closed on: deny wins
 * across dimensions in denylist mode, an allowlist shares only what it names, and an EMPTY
 * allowlist shares nothing (the strictest case, not the absence of a rule).
 *
 * A bucket that keys to nothing reads as SHARED — the caller could not name it, so nothing can be
 * concluded, and the only honest output of "I cannot tell" on this path is silence. Inventing a
 * warning here would make every warning less believable.
 */
export function bucketSharedBy(bucket: ShareBucket, rules: AnnouncedRules): boolean {
  return sharedUnder(bucket, rules, shareBucketKeys, sourceKeyOf).shared
}

/** The mode arithmetic, over whichever keying the caller chose. `matched` names the sources that
 *  produced the decision, so a caller can show the sibling's own path as evidence. */
function sharedUnder(
  bucket: ShareBucket,
  rules: AnnouncedRules,
  keysOf: (b: ShareBucket) => string[],
  keyOfSource: (s: ShareSource) => string | null,
): { shared: boolean; matched: ShareSource[] } {
  const keys = keysOf(bucket)
  if (keys.length === 0) return { shared: true, matched: [] }
  const declared = new Set<string>()
  const matched: ShareSource[] = []
  for (const s of rules.sources ?? []) {
    const key = keyOfSource(s)
    if (!key) continue
    declared.add(key)
    if (keys.includes(key)) matched.push(s)
  }
  const named = matched.length > 0
  const shared = rules.shareMode === 'allowlist' ? declared.size > 0 && named : !named
  return { shared, matched }
}

/** One sibling that withholds a bucket, and the evidence for saying so. */
export interface SiblingWithholding {
  machineId: string
  machineName: string
  /**
   * The sibling's OWN project paths that correlate with this bucket by folder name.
   *
   * Empty in two honest cases: a repo-dimension match (no folder-name guess was involved) and a
   * withholding by OMISSION — an allowlist that simply never names this project has no path to
   * offer. Never invented: if the announcement does not carry a path, none is shown.
   */
  paths: string[]
}

/**
 * The siblings whose announced rules WITHHOLD this bucket — the machines that would have to change
 * for the whole account to agree. Sorted by display name so a poll never reorders the list under
 * the user's cursor.
 *
 * This is the CROSS-MACHINE comparison, so the project dimension is correlated by folder name (see
 * this module's docstring). That cuts both ways and both are wanted: it finds a sibling hiding the
 * same project under a different path, and it stops reporting an allowlist sibling that shares that
 * project under its own path as though it were withholding it.
 */
export function siblingsWithholding(
  facts: readonly SiblingRuleFact[],
  bucket: ShareBucket,
): SiblingWithholding[] {
  const out: SiblingWithholding[] = []
  for (const f of facts) {
    const { shared, matched } = sharedUnder(bucket, f, crossMachineKeys, crossMachineSourceKey)
    if (shared) continue
    const paths: string[] = []
    for (const m of matched) {
      if (m.type === 'project' && typeof m.value === 'string' && m.value && !paths.includes(m.value)) {
        paths.push(m.value)
      }
    }
    out.push({ machineId: f.machineId, machineName: f.machineName, paths })
  }
  return out.sort((a, b) => a.machineName.localeCompare(b.machineName) || a.machineId.localeCompare(b.machineId))
}

/**
 * Fold freshly decrypted announcements into the stored facts, keyed by `machineId`: a machine's
 * newest announcement REPLACES its previous one rather than joining it, because each message is a
 * full snapshot of that machine's rules.
 *
 * `incoming` is in ARRIVAL order and later entries win. Ordering deliberately ignores `at`: that
 * is the sender's clock, display-only everywhere else in this channel, and a peer whose clock ran
 * backwards must not be able to make its stale rules outrank its current ones.
 */
export function mergeSiblingFacts(
  existing: readonly SiblingRuleFact[],
  incoming: readonly SiblingRuleFact[],
): SiblingRuleFact[] {
  const byMachine = new Map<string, SiblingRuleFact>()
  for (const f of existing) if (f.machineId) byMachine.set(f.machineId, f)
  for (const f of incoming) if (f.machineId) byMachine.set(f.machineId, f)
  return [...byMachine.values()].sort((a, b) => a.machineId.localeCompare(b.machineId))
}
