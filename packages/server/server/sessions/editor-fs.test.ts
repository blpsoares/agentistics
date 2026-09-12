import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  createTreeEntry, deleteTreeEntry, listChildren, readTreeFile, renameTreeEntry, resolveSessionDirectory,
  readTreeMedia, searchTree, walkPlain, writeTreeFile,
} from './editor-fs'
import { MEDIA_VIEW_LIMITS } from './editor-media'
import type { StartHost } from '../cli-start'

// Same reason repo-probe.test.ts strips these: a pre-commit hook running from a linked worktree
// exports GIT_DIR / GIT_INDEX_FILE pointing at the OUTER checkout, and `-C`/`cwd` do not override
// GIT_DIR for repository discovery.
const git = (cwd: string, ...args: string[]) => {
  const env: NodeJS.ProcessEnv = { ...process.env, GIT_TERMINAL_PROMPT: '0' }
  delete env.GIT_DIR
  delete env.GIT_WORK_TREE
  delete env.GIT_INDEX_FILE
  delete env.GIT_PREFIX
  return execFileSync('git', args, { cwd, encoding: 'utf8', env })
}

let root = ''
let gitRepo = ''
let plainDir = ''

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'agentistics-editor-'))

  gitRepo = join(root, 'gitrepo')
  mkdirSync(gitRepo)
  git(gitRepo, 'init', '-q', '-b', 'main')
  git(gitRepo, 'config', 'user.email', 't@t')
  git(gitRepo, 'config', 'user.name', 't')
  mkdirSync(join(gitRepo, 'src'))
  writeFileSync(join(gitRepo, 'src', 'a.ts'), 'export const a = 1\n')
  writeFileSync(join(gitRepo, 'README.md'), '# hi\n')
  writeFileSync(join(gitRepo, '.gitignore'), 'ignored.log\n')
  writeFileSync(join(gitRepo, 'ignored.log'), 'should not appear\n')
  git(gitRepo, 'add', 'src/a.ts', 'README.md', '.gitignore')
  git(gitRepo, 'commit', '-q', '-m', 'init')
  writeFileSync(join(gitRepo, 'src', 'untracked.ts'), 'export const b = 2\n')

  plainDir = join(root, 'plain')
  mkdirSync(plainDir)
  writeFileSync(join(plainDir, 'x.txt'), 'x\n')
  mkdirSync(join(plainDir, 'sub'))
})

afterAll(() => { rmSync(root, { recursive: true, force: true }) })

// `StartHost` (via `ControlHost`) carries many members no test here calls — the same posture
// `shell-web.test.ts`'s own `{} as StartHost` already takes for a host that is never driven
// beyond what `resolveSessionDirectory` reads (`host.sessions`). `withSessions` overrides just
// that one method, so each test states only the fleet row it is testing.
const noHost = {} as StartHost
const withSessions = (sessions: NonNullable<StartHost['sessions']>): StartHost => ({ ...noHost, sessions })

describe('resolveSessionDirectory', () => {
  test('an unknown id refuses unknown-session', async () => {
    const r = await resolveSessionDirectory(noHost, 'nope')
    expect(r).toEqual({ ok: false, reason: 'unknown-session' })
  })

  test('a live fleet row wins, and its cwd is checked for existence', async () => {
    const host = withSessions(async () => ({
      sessions: [{ id: 's1', conversationId: 'c1', cwd: gitRepo } as never],
      attention: 0,
      rang: [],
    }))
    const r = await resolveSessionDirectory(host, 's1')
    expect(r).toEqual({ ok: true, dir: gitRepo })
  })

  test('a live row naming a directory that does not exist refuses cwd-missing', async () => {
    const host = withSessions(async () => ({
      sessions: [{ id: 's2', conversationId: 'c2', cwd: join(root, 'gone') } as never],
      attention: 0,
      rang: [],
    }))
    const r = await resolveSessionDirectory(host, 's2')
    expect(r).toEqual({ ok: false, reason: 'cwd-missing' })
  })
})

describe('listChildren', () => {
  test('a git repo lists tracked + untracked-not-ignored, never the gitignored file', async () => {
    const r = await listChildren(gitRepo, '')
    // `.gitignore` itself was `git add`ed in beforeAll (so its own rule takes effect from the
    // commit, not merely from being present on disk) and is therefore a TRACKED file like any
    // other — it belongs in the listing. `ignored.log` is the one this test's name is about: it
    // matches `.gitignore`'s own pattern and must never appear.
    expect(r).toEqual({
      ok: true,
      children: [
        { name: 'src', kind: 'dir' },
        { name: '.gitignore', kind: 'file' },
        { name: 'README.md', kind: 'file' },
      ],
    })
  })

  test('listing a subdirectory of a git repo strips the parent prefix', async () => {
    const r = await listChildren(gitRepo, 'src')
    expect(r).toEqual({
      ok: true,
      children: [
        { name: 'a.ts', kind: 'file' },
        { name: 'untracked.ts', kind: 'file' },
      ],
    })
  })

  test('a plain (non-git) directory falls back to a bare readdir', async () => {
    const r = await listChildren(plainDir, '')
    expect(r).toEqual({
      ok: true,
      children: [
        { name: 'sub', kind: 'dir' },
        { name: 'x.txt', kind: 'file' },
      ],
    })
  })

  test('a path that does not exist on disk refuses not-found', async () => {
    const r = await listChildren(gitRepo, 'nope')
    expect(r).toEqual({ ok: false, reason: 'not-found' })
  })

  test('a path that names a FILE, not a directory, refuses not-a-directory', async () => {
    const r = await listChildren(gitRepo, 'README.md')
    expect(r).toEqual({ ok: false, reason: 'not-a-directory' })
  })

  test('a .. escape is refused before anything is read', async () => {
    const r = await listChildren(gitRepo, '../../etc')
    expect(r).toEqual({ ok: false, reason: 'escaped' })
  })

  test('a symlink INSIDE the tree pointing outside it is refused, not followed', async () => {
    const outside = join(root, 'outside')
    mkdirSync(outside)
    writeFileSync(join(outside, 'secret.txt'), 'nope\n')
    symlinkSync(outside, join(plainDir, 'escape-link'))
    const r = await listChildren(plainDir, 'escape-link')
    expect(r).toEqual({ ok: false, reason: 'escaped' })
  })
})

describe('readTreeFile', () => {
  test('reads text content and the file\'s current mtime', async () => {
    const r = await readTreeFile(gitRepo, 'README.md')
    expect(r.ok).toBe(true)
    if (r.ok && !r.binary) {
      expect(r.content).toBe('# hi\n')
      expect(r.mtimeMs).toBe(statSync(join(gitRepo, 'README.md')).mtimeMs)
    }
  })

  test('a binary file is reported as such, never sent as text', async () => {
    const binPath = join(plainDir, 'image.bin')
    writeFileSync(binPath, Buffer.from([0, 1, 2, 3, 0, 5]))
    const r = await readTreeFile(plainDir, 'image.bin')
    expect(r).toEqual({ ok: true, binary: true, name: 'image.bin', size: 6 })
  })

  test('a directory is refused as not-a-file', async () => {
    const r = await readTreeFile(gitRepo, 'src')
    expect(r).toEqual({ ok: false, reason: 'not-a-file' })
  })

  test('a missing file is refused as not-found', async () => {
    const r = await readTreeFile(gitRepo, 'nope.ts')
    expect(r).toEqual({ ok: false, reason: 'not-found' })
  })

  test('an image says WHICH kind it is, so the pane can render it instead of refusing it', async () => {
    writeFileSync(join(plainDir, 'shot.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]))
    const r = await readTreeFile(plainDir, 'shot.png')
    expect(r).toEqual({ ok: true, binary: true, name: 'shot.png', size: 4, media: 'image' })
  })

  test('a file whose extension is on the table is NEVER read for the binary sniff', async () => {
    // The sniff needs the bytes in memory, and this feature is what makes a half-gigabyte video
    // reachable through this route. A PNG holding plain ASCII proves the decision was the
    // extension's: `looksBinary` would have said text, and the answer is still `media: 'image'`.
    writeFileSync(join(plainDir, 'textual.png'), 'not actually a png at all\n')
    const r = await readTreeFile(plainDir, 'textual.png')
    expect(r).toEqual({ ok: true, binary: true, name: 'textual.png', size: 26, media: 'image' })
  })

  test('an SVG opens as TEXT — it is media-shaped and deliberately off the table', async () => {
    writeFileSync(join(plainDir, 'd.svg'), '<svg></svg>\n')
    const r = await readTreeFile(plainDir, 'd.svg')
    expect(r.ok).toBe(true)
    if (r.ok && !r.binary) expect(r.content).toBe('<svg></svg>\n')
  })

  test('over the ceiling it is a binary with the LIMIT named, not a media file', async () => {
    const big = join(plainDir, 'big.png')
    writeFileSync(big, Buffer.alloc(MEDIA_VIEW_LIMITS.image + 1))
    const r = await readTreeFile(plainDir, 'big.png')
    expect(r).toEqual({
      ok: true, binary: true, name: 'big.png', size: MEDIA_VIEW_LIMITS.image + 1,
      mediaOverLimit: { media: 'image', limit: MEDIA_VIEW_LIMITS.image },
    })
    if (r.ok && r.binary) expect(r.media).toBeUndefined()
    rmSync(big)
  })
})

describe('readTreeMedia', () => {
  test('answers the REAL path to stream, plus the type the closed table declares', async () => {
    writeFileSync(join(plainDir, 'ok.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]))
    const r = await readTreeMedia(plainDir, 'ok.png')
    expect(r).toEqual({
      ok: true, real: join(plainDir, 'ok.png'), name: 'ok.png', size: 4,
      mime: 'image/png', media: 'image',
    })
  })

  test('a lexical escape is refused — the same first half every function here applies', async () => {
    expect(await readTreeMedia(plainDir, '../gitrepo/README.md')).toEqual({ ok: false, reason: 'escaped' })
    expect(await readTreeMedia(plainDir, '/etc/hostname')).toEqual({ ok: false, reason: 'escaped' })
  })

  test('a symlink OUT of the tree is refused — the second half, on the resolved path', async () => {
    // The lexical check cannot see this one: the path is inside the root and the LINK is not.
    const outside = join(root, 'outside.png')
    writeFileSync(outside, Buffer.from([0x89, 0x50]))
    const link = join(plainDir, 'escape.png')
    if (!existsSync(link)) symlinkSync(outside, link)
    expect(await readTreeMedia(plainDir, 'escape.png')).toEqual({ ok: false, reason: 'not-found' })
  })

  test('a file that is not on the table is refused as not-media, never as octet-stream', async () => {
    writeFileSync(join(plainDir, 'blob.bin'), Buffer.from([0, 1, 2]))
    expect(await readTreeMedia(plainDir, 'blob.bin')).toEqual({ ok: false, reason: 'not-media' })
    writeFileSync(join(plainDir, 'd2.svg'), '<svg></svg>')
    expect(await readTreeMedia(plainDir, 'd2.svg')).toEqual({ ok: false, reason: 'not-media' })
  })

  test('the ceiling is re-applied HERE, not taken on trust from the read that preceded it', async () => {
    const big = join(plainDir, 'big2.png')
    writeFileSync(big, Buffer.alloc(MEDIA_VIEW_LIMITS.image + 1))
    expect(await readTreeMedia(plainDir, 'big2.png')).toEqual({
      ok: false, reason: 'too-big', limit: MEDIA_VIEW_LIMITS.image,
    })
    rmSync(big)
  })

  test('a directory and a missing file keep their own refusals', async () => {
    expect(await readTreeMedia(plainDir, 'sub')).toEqual({ ok: false, reason: 'not-a-file' })
    expect(await readTreeMedia(plainDir, 'nope.png')).toEqual({ ok: false, reason: 'not-found' })
  })
})

describe('writeTreeFile', () => {
  test('a matching mtime writes, and returns the NEW mtime', async () => {
    const before = statSync(join(gitRepo, 'README.md')).mtimeMs
    const out = await writeTreeFile(gitRepo, 'README.md', '# updated\n', before)
    expect(out.ok).toBe(true)
    expect(readFileSync(join(gitRepo, 'README.md'), 'utf8')).toBe('# updated\n')
    if (out.ok) expect(out.mtimeMs).toBeGreaterThanOrEqual(before)
  })

  test('a stale mtime is refused as a conflict, and the CURRENT disk content is returned', async () => {
    const target = join(gitRepo, 'README.md')
    const current = statSync(target).mtimeMs
    const out = await writeTreeFile(gitRepo, 'README.md', '# my edit\n', current - 999999)
    expect(out).toMatchObject({ ok: false, reason: 'conflict' })
    if (!out.ok && out.reason === 'conflict') {
      expect(out.content).toBe('# updated\n')
    }
    // The file on disk must be UNTOUCHED — this is the whole safety guarantee.
    expect(readFileSync(target, 'utf8')).toBe('# updated\n')
  })

  test('writing a new file under a path that does not exist yet fails not-found — this route never creates', async () => {
    const out = await writeTreeFile(gitRepo, 'brand-new.ts', 'x', 0)
    expect(out).toEqual({ ok: false, reason: 'not-found' })
  })

  test('a .. escape is refused before any write is attempted', async () => {
    const out = await writeTreeFile(gitRepo, '../../etc/passwd', 'x', 0)
    expect(out).toEqual({ ok: false, reason: 'escaped' })
  })
})

describe('createTreeEntry', () => {
  test('creates an empty file', async () => {
    const out = await createTreeEntry(plainDir, 'created.txt', 'file')
    expect(out).toEqual({ ok: true })
    expect(existsSync(join(plainDir, 'created.txt'))).toBe(true)
  })

  test('creates a folder', async () => {
    const out = await createTreeEntry(plainDir, 'created-dir', 'dir')
    expect(out).toEqual({ ok: true })
    expect(statSync(join(plainDir, 'created-dir')).isDirectory()).toBe(true)
  })

  test('refuses to overwrite something that already exists', async () => {
    const out = await createTreeEntry(plainDir, 'x.txt', 'file')
    expect(out).toEqual({ ok: false, reason: 'already-exists' })
  })

  test('a .. escape is refused', async () => {
    const out = await createTreeEntry(plainDir, '../escaped.txt', 'file')
    expect(out).toEqual({ ok: false, reason: 'escaped' })
  })

  test('creating inside a directory that does not exist yet fails not-found — no implicit mkdir -p', async () => {
    const out = await createTreeEntry(plainDir, 'nosuch/child.txt', 'file')
    expect(out).toEqual({ ok: false, reason: 'not-found' })
  })
})

describe('renameTreeEntry', () => {
  test('renames a file within the tree', async () => {
    writeFileSync(join(plainDir, 'to-rename.txt'), 'x')
    const out = await renameTreeEntry(plainDir, 'to-rename.txt', 'renamed.txt')
    expect(out).toEqual({ ok: true })
    expect(existsSync(join(plainDir, 'renamed.txt'))).toBe(true)
    expect(existsSync(join(plainDir, 'to-rename.txt'))).toBe(false)
  })

  test('refuses when the source does not exist', async () => {
    const out = await renameTreeEntry(plainDir, 'nope.txt', 'somewhere.txt')
    expect(out).toEqual({ ok: false, reason: 'not-found' })
  })

  test('refuses when the destination already exists', async () => {
    writeFileSync(join(plainDir, 'src-a.txt'), 'a')
    writeFileSync(join(plainDir, 'dst-b.txt'), 'b')
    const out = await renameTreeEntry(plainDir, 'src-a.txt', 'dst-b.txt')
    expect(out).toEqual({ ok: false, reason: 'already-exists' })
  })

  test('an escape on EITHER end is refused', async () => {
    writeFileSync(join(plainDir, 'src-c.txt'), 'c')
    expect(await renameTreeEntry(plainDir, 'src-c.txt', '../out.txt')).toEqual({ ok: false, reason: 'escaped' })
    expect(await renameTreeEntry(plainDir, '../out.txt', 'src-c.txt')).toEqual({ ok: false, reason: 'escaped' })
  })
})

describe('deleteTreeEntry', () => {
  test('deletes a file', async () => {
    writeFileSync(join(plainDir, 'to-delete.txt'), 'x')
    const out = await deleteTreeEntry(plainDir, 'to-delete.txt', false)
    expect(out).toEqual({ ok: true })
    expect(existsSync(join(plainDir, 'to-delete.txt'))).toBe(false)
  })

  test('deletes an empty folder without needing recursive', async () => {
    mkdirSync(join(plainDir, 'empty-to-delete'))
    const out = await deleteTreeEntry(plainDir, 'empty-to-delete', false)
    expect(out).toEqual({ ok: true })
  })

  test('refuses a non-empty folder without recursive', async () => {
    mkdirSync(join(plainDir, 'full-to-delete'))
    writeFileSync(join(plainDir, 'full-to-delete', 'inner.txt'), 'x')
    const out = await deleteTreeEntry(plainDir, 'full-to-delete', false)
    expect(out).toEqual({ ok: false, reason: 'not-empty' })
    expect(existsSync(join(plainDir, 'full-to-delete', 'inner.txt'))).toBe(true)
  })

  test('recursive:true deletes a non-empty folder', async () => {
    mkdirSync(join(plainDir, 'full-to-delete-2'))
    writeFileSync(join(plainDir, 'full-to-delete-2', 'inner.txt'), 'x')
    const out = await deleteTreeEntry(plainDir, 'full-to-delete-2', true)
    expect(out).toEqual({ ok: true })
    expect(existsSync(join(plainDir, 'full-to-delete-2'))).toBe(false)
  })

  test('refuses when the target does not exist', async () => {
    const out = await deleteTreeEntry(plainDir, 'nope', false)
    expect(out).toEqual({ ok: false, reason: 'not-found' })
  })

  test('an escape is refused before any delete is attempted', async () => {
    // NOTE: not `'../plain'` as in the original brief — `plainDir` is `<root>/plain`, so
    // `resolve(plainDir, '../plain')` collapses back to `plainDir` itself (a coincidence of this
    // fixture's own directory name) rather than escaping it, and would have masqueraded as
    // `not-empty` given the leftover fixtures from earlier tests. `../secret.txt` is genuinely
    // outside `plainDir`, matching the non-colliding names every sibling escape test already uses
    // (`'../escaped.txt'`, `'../out.txt'`, `'../../etc'`).
    const out = await deleteTreeEntry(plainDir, '../secret.txt', false)
    expect(out).toEqual({ ok: false, reason: 'escaped' })
  })
})

describe('searchTree', () => {
  test('finds a filename match', async () => {
    const out = await searchTree(gitRepo, 'README')
    expect(out.hits).toContainEqual({ kind: 'name', path: 'README.md' })
  })

  test('finds a content match inside a git repo, and NEVER inside the gitignored file', async () => {
    const out = await searchTree(gitRepo, 'should not appear')
    expect(out.hits.some(h => h.kind === 'content')).toBe(false)
  })

  test('finds a content match in a TRACKED file', async () => {
    const out = await searchTree(gitRepo, 'export const a')
    expect(out.hits).toContainEqual({ kind: 'content', path: 'src/a.ts', line: 1, text: 'export const a = 1' })
  })

  test('finds a content match in an UNTRACKED (but not ignored) file too', async () => {
    const out = await searchTree(gitRepo, 'export const b')
    expect(out.hits).toContainEqual({ kind: 'content', path: 'src/untracked.ts', line: 1, text: 'export const b = 2' })
  })

  test('an empty query returns nothing rather than the whole tree', async () => {
    const out = await searchTree(gitRepo, '  ')
    expect(out.hits).toEqual([])
  })

  test('search works in a non-git directory too, bounded, without hanging', async () => {
    const out = await searchTree(plainDir, 'x')
    expect(out.hits.some(h => h.kind === 'name' && h.path === 'x.txt')).toBe(true)
  })

  test('a file above the plain-grep size cap is skipped, a smaller sibling still matches', async () => {
    const heavyDir = join(plainDir, 'heavyfile')
    mkdirSync(heavyDir)
    // Comfortably above the module's 1 MiB cap regardless of its exact value.
    writeFileSync(join(heavyDir, 'big.txt'), `${'x'.repeat(2_000_000)}findme-big\n`)
    writeFileSync(join(heavyDir, 'small.txt'), 'findme-small\n')

    const out = await searchTree(heavyDir, 'findme')
    expect(out.hits.some(h => h.kind === 'content' && h.path === 'small.txt')).toBe(true)
    expect(out.hits.some(h => h.kind === 'content' && h.path === 'big.txt')).toBe(false)
  })

  test('a genuine git grep failure falls back to a plain content read instead of reporting no matches', async () => {
    // `[` is an invalid regex to `git grep -e` (unbalanced bracket) and exits >1 with empty
    // stdout — a real failure, not the exit-1 "ran fine, found nothing" case. The plain fallback
    // matches it as a literal substring instead.
    mkdirSync(join(gitRepo, 'brackets'))
    writeFileSync(join(gitRepo, 'brackets', 'arr.ts'), 'export const arr = [1, 2]\n')
    git(gitRepo, 'add', 'brackets/arr.ts')
    git(gitRepo, 'commit', '-q', '-m', 'add brackets fixture')

    const out = await searchTree(gitRepo, '[')
    expect(out.hits).toContainEqual({ kind: 'content', path: 'brackets/arr.ts', line: 1, text: 'export const arr = [1, 2]' })
  })

  test('exit 1 ("ran fine, no matches") is answered with no content hits, never a fallback', async () => {
    // Reuses the existing gitignored-file fixture: `git grep` genuinely finds nothing for this
    // query (the only file containing it is excluded by `.gitignore`), which is exit 1 — the
    // plain fallback must NOT kick in and surface the ignored file's content.
    const out = await searchTree(gitRepo, 'should not appear')
    expect(out.hits.some(h => h.kind === 'content')).toBe(false)
  })
})

describe('walkPlain', () => {
  test('a directory-heavy, nearly file-free tree stops once the directory cap is hit', async () => {
    const heavyRoot = join(root, 'dirheavy')
    mkdirSync(heavyRoot)
    const totalDirs = 12
    for (let i = 0; i < totalDirs; i++) {
      const d = join(heavyRoot, `d${i}`)
      mkdirSync(d)
      writeFileSync(join(d, 'marker.txt'), String(i))
    }

    const dirLimit = 5
    const files = await walkPlain(heavyRoot, { dirLimit })

    // The root itself is the first directory visited, leaving `dirLimit - 1` children walked —
    // deterministic regardless of `readdir`'s own ordering, since every child holds exactly one
    // file. This is the proof the FILE cap alone could never give: none of these directories
    // holds more than one file each, so `PLAIN_WALK_FILE_LIMIT` (5000) would never fire here —
    // only the independent directory cap stops the walk.
    expect(files.length).toBe(dirLimit - 1)
    expect(files.length).toBeLessThan(totalDirs)
  })

  test('a tree smaller than the directory cap is walked completely', async () => {
    const smallRoot = join(root, 'dirsmall')
    mkdirSync(smallRoot)
    for (let i = 0; i < 3; i++) {
      const d = join(smallRoot, `d${i}`)
      mkdirSync(d)
      writeFileSync(join(d, 'marker.txt'), String(i))
    }
    const files = await walkPlain(smallRoot, { dirLimit: 5 })
    expect(files).toHaveLength(3)
  })
})
