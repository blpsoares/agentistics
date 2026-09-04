import { test, expect } from 'bun:test'
import { mkdtemp, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { listExistingArtifacts, resolveArtifactPath } from './artifact-list'

test('a relative path resolves against the session directory', () => {
  // A shell write after a `cd` is recorded relative; without this it is listed and then refused,
  // because the read guard wants a path inside the session's own directory.
  expect(resolveArtifactPath('packages/web/x.ts', '/repo')).toBe('/repo/packages/web/x.ts')
})

test('an absolute path is left alone', () => {
  expect(resolveArtifactPath('/tmp/a.log', '/repo')).toBe('/tmp/a.log')
})

test('a tilde is REFUSED rather than expanded — it is the shell\'s home, not this process\'s', () => {
  expect(resolveArtifactPath('~/bin/agentop', '/repo')).toBeNull()
  expect(resolveArtifactPath('   ', '/repo')).toBeNull()
})

test('only files that exist, have content, and sit inside the session directory', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'artlist-'))
  await mkdir(join(dir, 'sub'), { recursive: true })
  await writeFile(join(dir, 'real.ts'), 'export const a = 1\n')
  await writeFile(join(dir, 'sub', 'deep.md'), '# doc\n')
  await writeFile(join(dir, 'empty.txt'), '')

  const out = await listExistingArtifacts(
    ['real.ts', 'sub/deep.md', 'empty.txt', 'gone.ts', '/etc/hostname'],
    dir,
  )
  expect(out.map(o => o.raw)).toEqual(['real.ts', 'sub/deep.md'])
  // An empty file opens onto nothing, which reads as the panel being broken rather than as the
  // file being empty; a deleted one has nothing to open; one outside the directory would be
  // refused by the read guard anyway.
  expect(out.every(o => o.bytes > 0)).toBe(true)
})

test('the transcript order survives, and one file is listed once', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'artlist2-'))
  await writeFile(join(dir, 'a.ts'), 'a')
  await writeFile(join(dir, 'b.ts'), 'b')
  const out = await listExistingArtifacts(['b.ts', 'a.ts', 'b.ts'], dir)
  expect(out.map(o => o.raw)).toEqual(['b.ts', 'a.ts'])
})
