/**
 * repo-facts.ts — which REPOSITORY a directory belongs to, and whether it is a linked worktree.
 *
 * A session is opened in a directory, but the thing a person thinks in is the repository: three
 * worktrees of `agentistics` are three places to work on ONE project, and a list that files them
 * under `session-monitor`, `billing-basis` and `agentistics` has taken the one grouping that
 * matches how the work is organised and split it into three.
 *
 * The identity is the git REMOTE wherever there is one, because that is the only key a worktree
 * provably shares with its main checkout — the directory names deliberately differ, and the
 * toplevel of a linked worktree is the worktree itself. With no remote it falls back to the
 * COMMON git dir's parent, which is the main checkout even when asked from inside a worktree.
 *
 * Every answer is CACHED for the life of the process. A directory does not change repository, and
 * the fleet poller runs every five seconds over every session — asking git four times per session
 * per tick is a hundred processes a minute to learn the same thing.
 */

import { basename, dirname } from 'node:path'
import { repoShortName, normalizeGitRemote } from '@agentistics/core'

export interface RepoFacts {
  /** `org/repo` from the remote, else the main checkout's folder name. Absent outside a repo. */
  repo?: string
  /**
   * The MAIN checkout's folder name — `agentistics` even when asked from inside one of its
   * worktrees. Absent outside a repository.
   *
   * Separate from `repo` because it is a different question: `repo` identifies the project across
   * machines and needs the remote, this one is what the project is CALLED here and exists whether
   * or not anything was ever pushed. It is what the "by project" grouping keys on — a worktree
   * grouped under its own directory name files three checkouts of one project as three projects,
   * which is the same split the repository dimension exists to avoid.
   */
  root?: string
  /** True only for a LINKED worktree — the main checkout of a repo is not one. */
  worktree: boolean
}

const NONE: RepoFacts = { worktree: false }

const cache = new Map<string, RepoFacts>()

/** Reset the memo. Tests only — a directory's repository does not change while agentop runs. */
export function forgetRepoFacts(): void {
  cache.clear()
}

/**
 * Decide the facts from what git printed — PURE, so the parsing is testable without a repository.
 *
 * `gitDir` and `commonDir` are what `--git-dir` / `--git-common-dir` gave; they DIFFER exactly when
 * the caller is inside a linked worktree, which is the canonical test and the only one that does
 * not depend on a path convention someone can rename.
 */
export function decideRepoFacts(o: {
  remote: string
  gitDir: string
  commonDir: string
}): RepoFacts {
  const inRepo = o.commonDir !== ''
  if (!inRepo) return NONE
  const worktree = o.gitDir !== '' && o.gitDir !== o.commonDir
  // The COMMON git dir's parent is the main checkout even when asked from a worktree, which is the
  // whole reason it is read instead of `--show-toplevel`. Computed always, not only as a fallback:
  // it is what the project is CALLED here, and a repository with no remote still has a name.
  const root = basename(dirname(o.commonDir.replace(/[/\\]+$/, '')))
  const named = normalizeGitRemote(o.remote)
  if (named) return { repo: repoShortName(named), worktree, ...(root ? { root } : {}) }
  return root ? { repo: root, root, worktree } : { worktree }
}

async function git(cwd: string, args: string[]): Promise<string> {
  try {
    const proc = Bun.spawn(['git', '-C', cwd, ...args], {
      stdout: 'pipe',
      stderr: 'ignore',
      // Never let git open a credential helper or an editor: this runs on a poll, behind a screen
      // the user is reading, and a prompt with nowhere to draw is a hang with no explanation.
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0' },
    })
    const out = await new Response(proc.stdout).text()
    return (await proc.exited) === 0 ? out.trim() : ''
  } catch {
    return ''
  }
}

/** The repository a directory belongs to. Memoized; never throws. */
export async function repoFacts(cwd: string): Promise<RepoFacts> {
  if (!cwd) return NONE
  const hit = cache.get(cwd)
  if (hit) return hit
  const [commonDir, gitDir, remote] = await Promise.all([
    git(cwd, ['rev-parse', '--path-format=absolute', '--git-common-dir']),
    git(cwd, ['rev-parse', '--path-format=absolute', '--git-dir']),
    git(cwd, ['config', '--get', 'remote.origin.url']),
  ])
  const facts = decideRepoFacts({ remote, gitDir, commonDir })
  cache.set(cwd, facts)
  return facts
}
