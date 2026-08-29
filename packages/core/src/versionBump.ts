/**
 * Version-bump calculation for the release workflow — the ONE tested place the
 * conventional-commit → semver rule lives, extracted from `.github/workflows/release.yml`.
 *
 * Why this module exists at all: the workflow computed the bump inline in bash and NOTHING
 * exercised it, so a defect was only ever observed in production, one release at a time. v1.23.1
 * shipped as a PATCH for a range whose only `feat` was the oldest commit — a feature published as
 * a correction. Two independent defects combined:
 *
 *   1. THE READ. `git log --pretty=format:` omits the terminal newline on the LAST record, and a
 *      `while IFS= read -r` loop silently drops a final line that has no newline. So the oldest
 *      commit in every range was never classified. When that oldest commit was the only `feat`
 *      (or the only commit), zero subjects were read. Fixed in the YAML with `--pretty=tformat:`.
 *   2. THE SILENT FLOOR. The bash default was `patch`, so a read that returned NOTHING quietly
 *      became a patch release instead of failing. That floor is what let the wrong number ship.
 *
 * This module answers (2): {@link bumpFromCommits} THROWS on an empty commit list, because a
 * release range that HAS commits (COMMIT_COUNT > 0) yet yields zero to classify is a reading
 * defect, not a patch. A noisy failure aborts the release; a silent patch publishes a lie. A
 * NON-empty list of only non-conventional commits (merges, hand-written reverts) is a different
 * thing — the read worked, there simply is nothing to bump — and is a legitimate `patch`.
 *
 * Pure: no I/O. The workflow reads the commits and calls in; this file never shells out to git.
 */

export type SemverBump = 'major' | 'minor' | 'patch'

export interface Commit {
  /** The commit subject line (git `%s`). */
  subject: string
  /** The commit body (git `%b`), optional; scanned for a `BREAKING CHANGE` footer. */
  body?: string
}

/** A `BREAKING CHANGE` / `BREAKING-CHANGE` marker, per the Conventional Commits spec. */
const BREAKING = /BREAKING[ -]CHANGE/i
/**
 * `type` or `type(scope)`, an optional `!`, then the mandatory `:` — matches `feat:`, `feat(web):`,
 * `feat!:`, `feat(web)!:`. Group 1 is the type; group 2 is the bang (present only when breaking).
 */
const CONVENTIONAL = /^([a-zA-Z]+)(?:\([^)]*\))?(!)?:/

/**
 * Classify a SINGLE commit into the bump it forces on its own, or `null` when the subject is not a
 * conventional commit at all (a raw `Merge pull request …`, a bare revert, an empty subject). A
 * `null` contributes nothing to the aggregate — it is neither a defect nor a bump.
 */
export function classifyCommit(commit: Commit): SemverBump | null {
  const subject = (commit.subject ?? '').trim()
  const body = commit.body ?? ''
  const m = CONVENTIONAL.exec(subject)
  // A `!` before the colon marks a breaking change regardless of type (`feat!:`, `chore(x)!:`).
  if (m && m[2] === '!') return 'major'
  // A `BREAKING CHANGE` marker in the subject or body is breaking too (the spec's footer form).
  if (BREAKING.test(subject) || BREAKING.test(body)) return 'major'
  if (m && m[1]!.toLowerCase() === 'feat') return 'minor'
  // A recognised conventional commit that is not a feature (fix, chore, docs, …) is a patch.
  if (m) return 'patch'
  // Not conventional at all.
  return null
}

/**
 * Aggregate the bump across a range's commits. `major` outranks `minor` outranks `patch`.
 *
 * THROWS on an empty list. The caller must invoke this only once it knows the range HAS commits
 * (COMMIT_COUNT > 0); an empty list there means the subjects could not be read — the exact defect
 * that shipped v1.23.1 — and a loud throw keeps the wrong number from being published.
 */
export function bumpFromCommits(commits: Commit[]): SemverBump {
  if (commits.length === 0) {
    throw new Error(
      'bumpFromCommits: no commits to classify — the range has commits but none were read. ' +
        'This is a reading defect, not a patch release; refusing to guess a bump.',
    )
  }
  let bump: SemverBump = 'patch'
  for (const commit of commits) {
    const c = classifyCommit(commit)
    if (c === 'major') return 'major'
    if (c === 'minor') bump = 'minor'
  }
  return bump
}

/**
 * Apply a bump to a `MAJOR.MINOR.PATCH` version. Pure semver arithmetic; a leading `v` and any
 * pre-release/build suffix are tolerated on parse. Throws on a version it cannot parse rather than
 * emitting a malformed tag.
 */
export function nextVersion(current: string, bump: SemverBump): string {
  const m = /^v?(\d+)\.(\d+)\.(\d+)/.exec(current.trim())
  if (!m) throw new Error(`nextVersion: cannot parse version '${current}'`)
  const major = Number(m[1]),
    minor = Number(m[2]),
    patch = Number(m[3])
  switch (bump) {
    case 'major':
      return `${major + 1}.0.0`
    case 'minor':
      return `${major}.${minor + 1}.0`
    case 'patch':
      return `${major}.${minor}.${patch + 1}`
  }
}
