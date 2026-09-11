/**
 * editor-fs.ts — the IO around the repository explorer's PURE decisions.
 *
 * `resolveSessionDirectory` gathers the facts `editor-directory.ts`'s `planSessionDirectory`
 * needs (a live fleet row, a store record, a `stat`) and decides through it. Every other function
 * here takes an already-RESOLVED root directory and a client-given relative path, and re-checks
 * containment on the REAL (symlink-resolved) path before touching anything — `editor-path.ts`'s
 * `resolveTreePath` only catches a LEXICAL `..` escape; this is the other half, the one that
 * catches a symlink INSIDE the tree pointing outside it.
 */
import { readdir, realpath, stat } from 'node:fs/promises'
import type { StartHost } from '../cli-start'
import { planSessionDirectory, type SessionDirPlan } from './editor-directory'
import { containedInRoot, resolveTreePath } from './editor-path'
import { childrenFromDirents, collapseToChildren, type TreeChild } from './editor-list'

async function pathIsDirectory(p: string): Promise<boolean> {
  try { return (await stat(p)).isDirectory() } catch { return false }
}

export async function resolveSessionDirectory(host: StartHost, id: string): Promise<SessionDirPlan> {
  let sessionKnown = false
  let liveCwd: string | undefined
  if (host.sessions) {
    const fleet = await host.sessions()
    const row = fleet.sessions.find(r => r.id === id || r.conversationId === id)
    if (row) {
      sessionKnown = true
      liveCwd = row.cwd || undefined
    }
  }
  let storeDir: string | undefined
  if (!liveCwd) {
    const { loadConsolidated } = await import('../consolidate')
    const map = await loadConsolidated()
    const meta = map.get(id)
    if (meta) {
      sessionKnown = true
      storeDir = meta.current_cwd || meta.project_path || undefined
    }
  }
  const dir = liveCwd || storeDir
  const dirExists = dir ? await pathIsDirectory(dir) : false
  return planSessionDirectory({ sessionKnown, liveCwd, storeDir, dirExists })
}

/**
 * Everything this module's write/create/rename/delete/list/search functions can refuse with,
 * beyond a directory-resolution failure (which the caller in `editor-web.ts` handles separately,
 * before ever reaching here).
 */
export type EntryRefusal = 'escaped' | 'not-found' | 'not-a-directory'

export type ListPlan =
  | { ok: true; children: TreeChild[] }
  | { ok: false; reason: EntryRefusal }

/**
 * The REAL containment recheck. `resolveTreePath` already refused a lexical `..`; this catches a
 * symlink placed INSIDE the tree that points somewhere else — `realpath` follows every link on
 * both sides, and the containment test runs again on what it actually resolves to.
 *
 * Returns the real, resolved path on success. A target that does not exist YET (a create) has no
 * real path of its own — the caller checks its PARENT instead; see Task 9.
 */
async function realContained(root: string, abs: string): Promise<string | null> {
  try {
    const [realRoot, realAbs] = await Promise.all([realpath(root), realpath(abs)])
    return containedInRoot(realAbs, realRoot) ? realAbs : null
  } catch {
    return null
  }
}

export async function listChildren(root: string, requestedPath: string): Promise<ListPlan> {
  const planned = resolveTreePath(root, requestedPath)
  if (!planned.ok) return { ok: false, reason: 'escaped' }

  const real = await realContained(root, planned.abs)
  if (real === null) {
    // Either it does not exist, or it escaped via a symlink. Either way there is nothing to list.
    try {
      await stat(planned.abs)
    } catch {
      return { ok: false, reason: 'not-found' }
    }
    return { ok: false, reason: 'escaped' }
  }

  let st
  try {
    st = await stat(real)
  } catch {
    return { ok: false, reason: 'not-found' }
  }
  if (!st.isDirectory()) return { ok: false, reason: 'not-a-directory' }

  const realRoot = await realpath(root)
  const relDir = real === realRoot ? '' : real.slice(realRoot.length + 1)

  const git = await gitListRecursive(realRoot, relDir)
  if (git !== null) return { ok: true, children: collapseToChildren(git) }

  const entries = await readdir(real, { withFileTypes: true })
  return { ok: true, children: childrenFromDirents(entries) }
}

/**
 * The recursive, gitignore-aware file list under `relDir` (relative to `root`), with paths
 * returned relative to `relDir` itself. `null` when `root` is not a git work tree at all (the
 * command's own exit code says so — no separate "is this a repo" probe is needed).
 */
async function gitListRecursive(root: string, relDir: string): Promise<string[] | null> {
  const pathspec = relDir === '' ? '.' : relDir
  const res = await runGit(root, ['ls-files', '--cached', '--others', '--exclude-standard', '--', pathspec])
  if (!res.ok) return null
  const prefix = relDir === '' ? '' : `${relDir}/`
  return res.out.split('\n').filter(Boolean).map(p => (p.startsWith(prefix) ? p.slice(prefix.length) : p))
}

/** One `git` runner for this whole module — mirrors `shell-web.ts`'s own `tmux()` helper. */
async function runGit(cwd: string, args: string[]): Promise<{ ok: boolean; out: string }> {
  try {
    const p = Bun.spawn(['git', '-C', cwd, ...args], { stdout: 'pipe', stderr: 'pipe', stdin: 'ignore' })
    const out = await new Response(p.stdout).text()
    const code = await p.exited
    return { ok: code === 0, out }
  } catch {
    return { ok: false, out: '' }
  }
}
