/**
 * artifact-file.ts — PURE: may this file be read for this session?
 *
 * The most powerful thing in the artifacts panel is that it reads the disk, so the rule is written
 * once, here, with no IO in it. The caller resolves both paths with `realpath` FIRST and hands the
 * results in — which is what makes `..` and an escaping symlink ordinary inputs to this function
 * rather than string patterns it would have to recognise.
 *
 * TWO GATES, IN THIS ORDER:
 *
 *  1. **The session must have touched it.** The reachable set is a consequence of what the session
 *     did, not a rule about directories — `/home/u/proj/.env` is in the project and has nothing to
 *     do with this conversation. Checked FIRST, so a path nobody asked about is refused without
 *     the answer confirming anything about where the cwd is.
 *  2. **It must resolve inside the session's cwd.** By path SEGMENT, never by string prefix:
 *     `/home/u/proj-secrets` starts with `/home/u/proj` and is a different directory.
 *
 * REFUSE, NEVER REPAIR. A path that needed fixing is a path nobody meant to send, and a sanitiser
 * is a place for the next bug to hide. The codes are language-free; the caller renders the words.
 */

export type ArtifactRefusal =
  /** Not in this session's artifact list. */
  | 'not-touched'
  /** Resolved outside the session's working directory. */
  | 'outside-cwd'
  /** A directory, or something that is not a regular file. */
  | 'not-a-file'
  /** Not text — a NUL byte in the first chunk. */
  | 'binary'
  /** Present in the list and gone, or unreadable, at the moment it was asked for. */
  | 'unreadable'

export interface ArtifactReadRequest {
  /** The already-resolved absolute path being asked for. */
  path: string
  /** The already-resolved absolute working directory of the session. */
  cwd: string
  /** The already-resolved absolute paths this session touched. */
  allowed: readonly string[]
}

export type ArtifactReadPlan =
  | { ok: true; path: string }
  | { ok: false; reason: ArtifactRefusal }

/** Is `path` inside `dir`, by SEGMENT? `dir` itself is not "inside" itself. */
export function withinDirectory(path: string, dir: string): boolean {
  if (path === dir) return false
  const base = dir.endsWith('/') ? dir : `${dir}/`
  return path.startsWith(base)
}

export function planArtifactRead({ path, cwd, allowed }: ArtifactReadRequest): ArtifactReadPlan {
  if (path === '' || !allowed.includes(path)) return { ok: false, reason: 'not-touched' }
  if (path === cwd) return { ok: false, reason: 'not-a-file' }
  if (!withinDirectory(path, cwd)) return { ok: false, reason: 'outside-cwd' }
  return { ok: true, path }
}
