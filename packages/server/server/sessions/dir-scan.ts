/**
 * dir-scan.ts — the directories on this machine a session could be started in.
 *
 * The wizard used to offer only places that already had history, which made it useless for the most
 * ordinary case there is: a repository cloned five minutes ago. **Any directory should be startable**,
 * so this walks the home directory and indexes what it finds.
 *
 * Measured before choosing the strategy rather than guessed: a depth-4 walk of a real home directory
 * with the prune list below visits ~4,900 directories in ~220ms. That is cheap enough to do once and
 * cache, which is what makes the search instant on every keystroke afterwards.
 */

import { readdir, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

/**
 * Directories never worth descending into.
 *
 * Note what is NOT here: hidden directories in general. `.claude/worktrees/<name>` is where this
 * project's own concurrent work lives, and skipping dotted directories wholesale would hide exactly
 * the places a user of this tool works in most.
 */
const PRUNE = new Set([
  'node_modules', '.git', '.cache', '.npm', '.bun', '.cargo', '.rustup', '.nvm', '.pnpm-store',
  '.venv', 'venv', '__pycache__', '.mypy_cache', '.pytest_cache', '.ruff_cache',
  'target', 'dist', 'build', 'out', '.next', '.nuxt', '.turbo', '.svelte-kit', '.gradle',
  'vendor', 'Library', 'snap', '.local', '.rbenv', '.pyenv', '.docker', '.vscode-server',
  '.Trash', '.trash', 'AppData',
])

export const SCAN_DEPTH = Number(process.env.AGENTISTICS_SCAN_DEPTH) > 0
  ? Number(process.env.AGENTISTICS_SCAN_DEPTH)
  : 4

/** A hard backstop, so a pathological home directory cannot hang the wizard. */
const MAX_ENTRIES = 40_000

export interface ScannedDir {
  path: string
  /** The last segment — what the row is named and what the search ranks against. */
  name: string
  /** True when the directory itself holds a `.git` DIRECTORY — a repository's MAIN checkout. */
  repo: boolean
  /**
   * True when the directory's own `.git` is a FILE rather than a directory — the marker of a
   * LINKED worktree (its content is `gitdir: <main-checkout>/.git/worktrees/<name>`, never read
   * here). Free: `readdir(withFileTypes: true)` already hands back a `Dirent` per entry, so telling
   * a `.git` file from a `.git` directory costs nothing this walk was not already paying — no
   * extra `stat`, and never a `git` process spawned per candidate (the walk visits thousands).
   */
  worktree: boolean
}

/**
 * Walk `root` breadth-first to `depth`, pruning the junk above.
 *
 * Breadth-first on purpose: with a cap, the entries kept should be the ones NEAREST the home
 * directory, which are the ones a person actually works in. A depth-first walk that hit the cap
 * would spend the whole budget inside the first subtree it happened to enter.
 */
export async function scanDirectories(
  root: string = homedir(),
  depth: number = SCAN_DEPTH,
): Promise<ScannedDir[]> {
  const out: ScannedDir[] = []
  let frontier: string[] = [root]

  for (let level = 0; level <= depth && frontier.length > 0; level++) {
    const next: string[] = []
    // Bounded fan-out per level rather than one promise per directory: a level of a wide home
    // directory is thousands of `readdir`s, and issuing them all at once is how a walk turns into a
    // spike of open file descriptors.
    for (let i = 0; i < frontier.length; i += 64) {
      const batch = frontier.slice(i, i + 64)
      const results = await Promise.all(batch.map(async dir => {
        try {
          return { dir, entries: await readdir(dir, { withFileTypes: true }) }
        } catch {
          // Unreadable (permissions, a broken mount, a race with a delete). Not an error worth
          // reporting: it is one directory the user cannot start a session in either.
          return { dir, entries: [] }
        }
      }))

      for (const { dir, entries } of results) {
        // `.git` is a DIRECTORY for a repository's own checkout and a FILE for a linked worktree
        // — both are "there is a `.git` entry", which is all the OLD check asked, so a worktree
        // walked in read as a repository and its main checkout's icon and tab.
        const gitEntry = entries.find(e => e.name === '.git')
        const hasGit = gitEntry?.isDirectory() ?? false
        const isWorktree = gitEntry?.isFile() ?? false
        // The root itself is a legitimate place to work, but it is offered by `cwd`/history rather
        // than by the walk, so only descendants are recorded.
        if (dir !== root) {
          out.push({ path: dir, name: baseName(dir), repo: hasGit, worktree: isWorktree })
        }
        if (out.length >= MAX_ENTRIES) return out
        // A repository's own subdirectories are still worth offering — a monorepo package is a real
        // place to start — so a `.git` does not stop the descent. Only the prune list does.
        for (const e of entries) {
          if (!e.isDirectory() || PRUNE.has(e.name)) continue
          next.push(join(dir, e.name))
        }
      }
    }
    frontier = next
  }

  return out
}

/** Is this an existing directory? The escape hatch for a path typed in full. */
export async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory()
  } catch {
    return false
  }
}

/**
 * Is `path` itself a linked git worktree — the same `.git`-file-vs-directory test the walk gets
 * for free, spent here as one `stat` for a path the walk never visited (a history entry outside
 * the scan depth or outside `$HOME`, the current directory, a typed path). Still never a `git`
 * process: `git rev-parse --git-dir` would answer the same question at the cost of spawning one
 * per candidate, and the caller (`project-source.ts`) may run this over every distinct directory
 * this machine has ever worked in.
 */
export async function isWorktreeDir(path: string): Promise<boolean> {
  try {
    return (await stat(join(path, '.git'))).isFile()
  } catch {
    return false
  }
}

function baseName(path: string): string {
  const parts = path.replace(/\\/g, '/').replace(/\/+$/, '').split('/')
  return parts[parts.length - 1] ?? path
}
