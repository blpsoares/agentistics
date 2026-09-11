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
import { mkdir, readFile, readdir, realpath, rename, rm, stat, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { StartHost } from '../cli-start'
import { gitEnv } from '../backup/repo-probe'
import { planSessionDirectory, type SessionDirPlan } from './editor-directory'
import { containedInRoot, resolveTreePath } from './editor-path'
import { childrenFromDirents, collapseToChildren, type TreeChild } from './editor-list'
import { looksBinary } from './artifact-web'
import { planFileWrite } from './editor-conflict'
import {
  capHits, decideGitGrepOutcome, matchNames, parseGrepOutput, SEARCH_LIMIT,
  type ContentHit, type SearchResult,
} from './editor-search'

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
    // Dynamic: this branch only runs when the session has no live cwd, so the common (live)
    // path never pays for loading the consolidate store. Verified there is no require-cycle to
    // avoid here — `../consolidate` and everything it imports (`./config`, `./utils`) never
    // reach back into `../cli-start` or this module, static or dynamic.
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

/**
 * `-C <cwd>` does NOT override `GIT_DIR` for repository discovery — an ambient `GIT_DIR` /
 * `GIT_WORK_TREE` / `GIT_INDEX_FILE` / `GIT_PREFIX` / `GIT_COMMON_DIR` (exactly what this repo's
 * own pre-commit hook exports while running from a linked worktree, and what any parent process
 * spawning the server could equally set) silently redirects `git -C <cwd> ls-files` onto whatever
 * repository those variables name instead of `cwd` — measured here: without stripping them, this
 * module listed the OUTER checkout's files for a request scoped to an unrelated temp directory.
 * Reuses `backup/repo-probe.ts`'s own `gitEnv()` rather than reimplementing the strip — same rule,
 * same variable set, one place to keep it right.
 */

/**
 * One `git` runner for this whole module — mirrors `shell-web.ts`'s own `tmux()` helper.
 * `code` is the real exit code; a spawn that threw before git ever ran (the binary missing, a
 * permission error) has no exit code of its own and is given the sentinel `-1`, which must read
 * the same as any other non-0/non-1 failure to a caller deciding whether to fall back.
 */
async function runGit(cwd: string, args: string[]): Promise<{ ok: boolean; out: string; code: number }> {
  try {
    const p = Bun.spawn(['git', '-C', cwd, ...args], {
      stdout: 'pipe', stderr: 'pipe', stdin: 'ignore', env: gitEnv(),
    })
    const out = await new Response(p.stdout).text()
    const code = await p.exited
    return { ok: code === 0, out, code }
  } catch {
    return { ok: false, out: '', code: -1 }
  }
}

export type ReadFileRefusal = EntryRefusal | 'not-a-file'

export type ReadFilePlan =
  | { ok: true; content: string; mtimeMs: number; binary?: false }
  | { ok: true; binary: true; name: string; size: number }
  | { ok: false; reason: ReadFileRefusal }

export async function readTreeFile(root: string, requestedPath: string): Promise<ReadFilePlan> {
  const planned = resolveTreePath(root, requestedPath)
  if (!planned.ok) return { ok: false, reason: 'escaped' }
  const real = await realContained(root, planned.abs)
  if (real === null) return { ok: false, reason: 'not-found' }

  let st
  try {
    st = await stat(real)
  } catch {
    return { ok: false, reason: 'not-found' }
  }
  if (!st.isFile()) return { ok: false, reason: 'not-a-file' }

  const buf = await readFile(real)
  if (looksBinary(buf)) {
    return { ok: true, binary: true, name: real.split('/').pop() ?? real, size: st.size }
  }
  return { ok: true, content: buf.toString('utf8'), mtimeMs: st.mtimeMs }
}

export type WriteFileRefusal = EntryRefusal | 'not-a-file'

export type WriteFilePlan =
  | { ok: true; mtimeMs: number }
  | { ok: false; reason: 'conflict'; content: string; mtimeMs: number }
  | { ok: false; reason: WriteFileRefusal }

export async function writeTreeFile(
  root: string, requestedPath: string, content: string, expectedMtimeMs: number,
): Promise<WriteFilePlan> {
  const planned = resolveTreePath(root, requestedPath)
  if (!planned.ok) return { ok: false, reason: 'escaped' }
  const real = await realContained(root, planned.abs)
  if (real === null) return { ok: false, reason: 'not-found' }

  let st
  try {
    st = await stat(real)
  } catch {
    return { ok: false, reason: 'not-found' }
  }
  if (!st.isFile()) return { ok: false, reason: 'not-a-file' }

  const plan = planFileWrite({ expectedMtimeMs, diskMtimeMs: st.mtimeMs })
  if (!plan.ok) {
    // The write is refused BEFORE it happens. What comes back is the CURRENT disk content, read
    // fresh — the caller's editor shows it, and nothing here has touched the file.
    const buf = await readFile(real)
    return { ok: false, reason: 'conflict', content: buf.toString('utf8'), mtimeMs: plan.diskMtimeMs }
  }

  await writeFile(real, content, 'utf8')
  const after = await stat(real)
  return { ok: true, mtimeMs: after.mtimeMs }
}

/**
 * A CREATE target has no real path of its own yet — `realContained` alone cannot check it, because
 * `realpath` throws on something that does not exist. So the PARENT is checked instead: it must
 * exist, be a real directory, and be contained in the real root. This is the one place in this
 * module where "does not exist yet" is the SUCCESS case rather than a refusal.
 */
async function realContainedParent(root: string, abs: string): Promise<string | null> {
  const parent = dirname(abs)
  const realParent = await realContained(root, parent)
  if (realParent === null) return null
  // Recompose with the (still unresolved) basename — the child itself is not real yet.
  return `${realParent}/${abs.slice(parent.length + 1)}`
}

export type CreateRefusal = 'escaped' | 'not-found' | 'already-exists'
export type CreatePlan = { ok: true } | { ok: false; reason: CreateRefusal }

export async function createTreeEntry(
  root: string, requestedPath: string, kind: 'file' | 'dir',
): Promise<CreatePlan> {
  const planned = resolveTreePath(root, requestedPath)
  if (!planned.ok) return { ok: false, reason: 'escaped' }
  const target = await realContainedParent(root, planned.abs)
  if (target === null) return { ok: false, reason: 'not-found' }

  try {
    await stat(target)
    return { ok: false, reason: 'already-exists' }
  } catch {
    // Good — it must not exist yet.
  }

  if (kind === 'dir') await mkdir(target)
  else await writeFile(target, '', 'utf8')
  return { ok: true }
}

export type RenameRefusal = 'escaped' | 'not-found' | 'already-exists'
export type RenamePlan = { ok: true } | { ok: false; reason: RenameRefusal }

export async function renameTreeEntry(root: string, fromPath: string, toPath: string): Promise<RenamePlan> {
  const from = resolveTreePath(root, fromPath)
  if (!from.ok) return { ok: false, reason: 'escaped' }
  const to = resolveTreePath(root, toPath)
  if (!to.ok) return { ok: false, reason: 'escaped' }

  const realFrom = await realContained(root, from.abs)
  if (realFrom === null) return { ok: false, reason: 'not-found' }

  const realToTarget = await realContainedParent(root, to.abs)
  if (realToTarget === null) return { ok: false, reason: 'escaped' }

  try {
    await stat(realToTarget)
    return { ok: false, reason: 'already-exists' }
  } catch {
    // Good — the destination must be free.
  }

  await rename(realFrom, realToTarget)
  return { ok: true }
}

export type DeleteRefusal = 'escaped' | 'not-found' | 'not-empty'
export type DeletePlan = { ok: true } | { ok: false; reason: DeleteRefusal }

export async function deleteTreeEntry(
  root: string, requestedPath: string, recursive: boolean,
): Promise<DeletePlan> {
  const planned = resolveTreePath(root, requestedPath)
  if (!planned.ok) return { ok: false, reason: 'escaped' }
  const real = await realContained(root, planned.abs)
  if (real === null) return { ok: false, reason: 'not-found' }

  let st
  try {
    st = await stat(real)
  } catch {
    return { ok: false, reason: 'not-found' }
  }

  if (st.isDirectory() && !recursive) {
    const entries = await readdir(real)
    if (entries.length > 0) return { ok: false, reason: 'not-empty' }
  }

  await rm(real, { recursive: true, force: false })
  return { ok: true }
}

export type { SearchResult }

/**
 * Filename matches always run (fast, no process). Content matches run through `git grep` in a git
 * repo; a NON-git directory gets a bounded plain walk instead — capped by FILE COUNT, not depth,
 * so a huge `node_modules`-shaped folder with no git repo behind it cannot make this hang, which
 * is the exact risk the spec calls out.
 */
export async function searchTree(root: string, q: string): Promise<SearchResult> {
  const query = q.trim()
  if (!query) return { hits: [], truncated: false }

  const files = await gitListRecursive(root, '')
  // The git path must never walk: `walkPlain` only runs when `root` is not a git work tree at
  // all. Walking once here and handing the SAME list to both the name match and (on fallback,
  // below) the content grep is what fixes the double-walk this search used to do.
  const walked = files === null ? await walkPlain(root) : null
  const nameHits = matchNames(files ?? walked!, query)

  let contentHits: ContentHit[]
  if (files !== null) {
    const gitHits = await gitGrepContent(root, query)
    // `null` means `git grep` itself failed for a real reason (not "no matches") — fall back to
    // a plain read of the very file list `git ls-files` already gave us, no second walk needed.
    contentHits = gitHits ?? await grepPlain(root, files, query)
  } else {
    contentHits = await grepPlain(root, walked!, query)
  }

  return capHits([...nameHits, ...contentHits])
}

/**
 * `null` signals the caller must fall back to a plain content read — see `decideGitGrepOutcome`
 * for the exit-code reasoning. Exit 1 ("ran fine, found nothing") is answered with `[]` directly,
 * never treated as a fallback case.
 */
async function gitGrepContent(root: string, query: string): Promise<ContentHit[] | null> {
  const res = await runGit(root, ['grep', '-n', '--untracked', '-I', '-e', query, '--', '.'])
  const outcome = decideGitGrepOutcome(res.code)
  if (outcome === 'none') return []
  if (outcome === 'fallback') return null
  return parseGrepOutput(res.out)
}

/** Bounded so a directory with no `.gitignore` to lean on cannot make search feel like it hangs. */
const PLAIN_WALK_FILE_LIMIT = 5000
/**
 * Independent of the file cap above: `out.length` only grows when a FILE is pushed, so a tree of
 * thousands of nested near-empty subdirectories would never trip `PLAIN_WALK_FILE_LIMIT` and
 * `readdir` would run once per directory forever — exactly the hang this search must never
 * produce. Same magnitude as the file cap, for the identical reason.
 */
const PLAIN_WALK_DIR_LIMIT = 5000

/**
 * Exported, and the caps are overridable, only so tests can prove the directory cap terminates
 * the walk without needing to build thousands of real directories on disk — every production
 * caller relies on the two module-level defaults above.
 */
export async function walkPlain(
  root: string,
  limits: { fileLimit?: number; dirLimit?: number } = {},
): Promise<string[]> {
  const fileLimit = limits.fileLimit ?? PLAIN_WALK_FILE_LIMIT
  const dirLimit = limits.dirLimit ?? PLAIN_WALK_DIR_LIMIT
  const out: string[] = []
  const stack = ['']
  let dirsVisited = 0
  while (stack.length > 0 && out.length < fileLimit && dirsVisited < dirLimit) {
    const rel = stack.pop()!
    const abs = rel === '' ? root : `${root}/${rel}`
    dirsVisited++
    let entries
    try {
      entries = await readdir(abs, { withFileTypes: true })
    } catch {
      continue
    }
    for (const e of entries) {
      const childRel = rel === '' ? e.name : `${rel}/${e.name}`
      if (e.isDirectory()) stack.push(childRel)
      else out.push(childRel)
      if (out.length >= fileLimit) break
    }
  }
  return out
}

/**
 * A file above this size is skipped BEFORE it is ever read whole into memory — the same "search
 * must never hang or exhaust memory" guarantee the walk's own caps exist for, applied to one huge
 * file rather than a huge tree. 1 MiB comfortably covers any real source file while refusing a
 * stray multi-megabyte log or data dump sitting in a directory with no git index to exclude it.
 * A `stat` that throws skips the file too, the same posture the existing `readFile` catch takes.
 */
const GREP_MAX_FILE_BYTES = 1024 * 1024

async function grepPlain(root: string, files: readonly string[], query: string): Promise<ContentHit[]> {
  const needle = query.toLowerCase()
  const hits: ContentHit[] = []
  for (const rel of files) {
    if (hits.length >= SEARCH_LIMIT) break
    const abs = `${root}/${rel}`
    let size: number
    try {
      size = (await stat(abs)).size
    } catch {
      continue
    }
    if (size > GREP_MAX_FILE_BYTES) continue
    let buf
    try {
      buf = await readFile(abs)
    } catch {
      continue
    }
    if (looksBinary(buf)) continue
    const lines = buf.toString('utf8').split('\n')
    for (let i = 0; i < lines.length; i++) {
      if (lines[i]!.toLowerCase().includes(needle)) {
        hits.push({ kind: 'content', path: rel, line: i + 1, text: lines[i]! })
      }
    }
  }
  return hits
}
