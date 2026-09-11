import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { listChildren, readTreeFile, resolveSessionDirectory, writeTreeFile } from './editor-fs'
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
