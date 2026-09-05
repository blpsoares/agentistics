import { expect, test } from 'bun:test'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * The registry, written by SEVERAL PROCESSES at once.
 *
 * This is the test that did not exist, and its absence is why the bug shipped: every existing
 * registry test runs in ONE process, where the promise chain already serialised everything. agentop
 * is not one process — it is the systemd server, the cockpit, and every one-shot `agentop session
 * …` — and a promise chain does not reach across them.
 *
 * So this spawns real processes. It is slower than the rest of the suite and it is the only shape
 * that can fail when the lock is removed.
 */

const WRITER = `
const { createSessionRegistry } = await import(process.argv[2])
const file = process.argv[3]
const id = process.argv[4]
const reg = createSessionRegistry(file)
await reg.add({
  id, harness: 'claude', cwd: '/tmp/x',
  createdAt: new Date().toISOString(),
  label: 'label-' + id,
})
`

async function runWriters(file: string, ids: string[]): Promise<void> {
  const regPath = join(import.meta.dir, 'registry.ts')
  const script = join(await mkdtemp(join(tmpdir(), 'agentop-writer-')), 'w.ts')
  await Bun.write(script, WRITER)
  await Promise.all(ids.map(async id => {
    const p = Bun.spawn(['bun', script, regPath, file, id], { stdout: 'pipe', stderr: 'pipe' })
    await p.exited
  }))
}

test('a record written by one process is not erased by another', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'agentop-registry-'))
  const file = join(dir, 'managed-sessions.json')
  try {
    const ids = ['aaa1', 'bbb2', 'ccc3', 'ddd4', 'eee5', 'fff6']
    await runWriters(file, ids)
    const list = JSON.parse(await readFile(file, 'utf-8')) as { id: string; label?: string }[]
    // EVERY id, and every label. Before the cross-process lock this lost records whenever two
    // writers overlapped — which is exactly what a spawn racing the server's heartbeat does.
    expect(list.map(r => r.id).sort()).toEqual([...ids].sort())
    expect(list.every(r => r.label === `label-${r.id}`)).toBe(true)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}, 30_000)
