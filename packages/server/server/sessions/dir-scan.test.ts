import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { isWorktreeDir, scanDirectories } from './dir-scan'

/**
 * THE REPORTED BUG: a git worktree's own `.git` is a FILE (`gitdir: <main>/.git/worktrees/<name>`),
 * never a directory. The old check (`entries.some(e => e.name === '.git')`) only asked whether an
 * entry BY THAT NAME existed, so a worktree walked in came back `repo: true` — the walk's own way of
 * saying "this is a repository's main checkout" — and it went on to read as a repository throughout
 * the wizard.
 */
describe('scanDirectories — repo vs worktree, from the SAME readdir', () => {
  let root: string

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'dir-scan-'))
    // A real checkout: `.git` is a directory.
    await mkdir(join(root, 'main-checkout', '.git'), { recursive: true })
    // A linked worktree: `.git` is a FILE.
    await mkdir(join(root, 'a-worktree'), { recursive: true })
    await writeFile(join(root, 'a-worktree', '.git'), 'gitdir: /somewhere/.git/worktrees/a-worktree\n')
    // Neither.
    await mkdir(join(root, 'plain-folder'), { recursive: true })
  })
  afterAll(async () => { await rm(root, { recursive: true, force: true }) })

  it('flags a real checkout as repo, and NOT as a worktree', async () => {
    const out = await scanDirectories(root, 1)
    const main = out.find(d => d.name === 'main-checkout')
    expect(main).toMatchObject({ repo: true, worktree: false })
  })

  it('flags a linked worktree as worktree, and NEVER as repo', async () => {
    const out = await scanDirectories(root, 1)
    const wt = out.find(d => d.name === 'a-worktree')
    // THIS is the line that would have failed before the fix: the old code set `repo: true` here,
    // because it never looked past the entry's NAME.
    expect(wt).toMatchObject({ repo: false, worktree: true })
  })

  it('flags a plain folder as neither', async () => {
    const out = await scanDirectories(root, 1)
    const plain = out.find(d => d.name === 'plain-folder')
    expect(plain).toMatchObject({ repo: false, worktree: false })
  })
})

describe('isWorktreeDir — the same test, for a path the walk never visited', () => {
  let root: string

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'is-worktree-'))
    await mkdir(join(root, 'repo', '.git'), { recursive: true })
    await mkdir(join(root, 'worktree'), { recursive: true })
    await writeFile(join(root, 'worktree', '.git'), 'gitdir: /elsewhere\n')
  })
  afterAll(async () => { await rm(root, { recursive: true, force: true }) })

  it('is true only for a `.git` FILE', async () => {
    expect(await isWorktreeDir(join(root, 'worktree'))).toBe(true)
  })

  it('is false for a real checkout — its `.git` is a directory', async () => {
    expect(await isWorktreeDir(join(root, 'repo'))).toBe(false)
  })

  it('never throws on a directory with no `.git` at all', async () => {
    expect(await isWorktreeDir(root)).toBe(false)
  })

  it('never throws on a directory that does not exist', async () => {
    expect(await isWorktreeDir(join(root, 'gone'))).toBe(false)
  })
})
