import { expect, test } from 'bun:test'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * The write side of §F's subtask-group HIERARCHY (supersedes §B's shared-bucket model) —
 * docs/superpowers/specs/2026-09-11-alm-session-linking-ux.md §F:
 *
 *  - `addSubtask`'s `isGroup` option creates a GROUP.
 *  - `patchSubtask`'s `parentGroupId` joins/leaves one, refusing an invalid reference
 *    (`invalid_group`) rather than silently dropping it.
 *  - `attachSession` (via `task-attach.ts`'s `planAttach`) refuses filing a session on a group
 *    MEMBER (`subtask_in_group`) and succeeds filing on the group itself.
 *
 * Out-of-process for the same reason `task-done-needs-session.test.ts`/`subtask-groupid-patch.test.ts`
 * are: `loadTaskWorld()` reads the module-level `TASKS_FILE`/`MANAGED_SESSIONS_FILE` computed once
 * at `config.ts` load, so each scenario needs its own `AGENTISTICS_DIR` in its own process.
 */

const SESSIONS_DIR = import.meta.dir

async function run(body: string): Promise<unknown> {
  const dir = await mkdtemp(join(tmpdir(), 'agentop-subtask-group-hierarchy-'))
  const script = `
    const cfg = await import(${JSON.stringify(join(SESSIONS_DIR, '..', 'config.ts'))})
    const { createTaskStore } = await import(${JSON.stringify(join(SESSIONS_DIR, 'task-store.ts'))})
    const { createSessionRegistry } = await import(${JSON.stringify(join(SESSIONS_DIR, 'registry.ts'))})
    const web = await import(${JSON.stringify(join(SESSIONS_DIR, 'task-web.ts'))})
    const store = createTaskStore(cfg.TASKS_FILE)
    const registry = createSessionRegistry(cfg.MANAGED_SESSIONS_FILE)
    ${body}
  `
  const proc = Bun.spawn([process.execPath, '-e', script], {
    env: { ...process.env, AGENTISTICS_DIR: dir },
    stdout: 'pipe',
    stderr: 'pipe',
  })
  const out = await new Response(proc.stdout).text()
  const err = await new Response(proc.stderr).text()
  const code = await proc.exited
  if (code !== 0) {
    throw new Error(`script failed (${code}): ${err.trim().split('\n').slice(-8).join(' | ')}`)
  }
  const line = out.trim().split('\n').filter(Boolean).at(-1) ?? '{}'
  return JSON.parse(line)
}

const task = (id: string, over = '') => `
  await store.upsertTask({
    id: '${id}', title: '${id}', status: 'todo',
    createdAt: '2026-09-17T10:00:00.000Z', updatedAt: '2026-09-17T10:00:00.000Z',
    ${over}
  })
`
const subtask = (id: string, taskId: string, over = '') => `
  await store.upsertSubtask({
    id: '${id}', taskId: '${taskId}', title: '${id}', status: 'todo', done: false,
    createdAt: '2026-09-17T10:00:00.000Z', updatedAt: '2026-09-17T10:00:00.000Z',
    ${over}
  })
`
const session = (id: string, over = '') => `
  await registry.add({
    id: '${id}', harness: 'claude', cwd: '/tmp/x',
    createdAt: '2026-09-17T10:00:00.000Z',
    ${over}
  })
`

test('addSubtask with isGroup:true creates a GROUP', async () => {
  const out = await run(`
    ${task('t1')}
    await web.addSubtask('t1', 'guarda-chuva', { isGroup: true })
    const after = await store.read()
    console.log(JSON.stringify({ isGroup: after.subtasks[0].isGroup ?? false }))
  `)
  expect(out).toEqual({ isGroup: true })
})

test('addSubtask with no option (or isGroup:false) creates an ordinary, loose subtask', async () => {
  const out = await run(`
    ${task('t1')}
    await web.addSubtask('t1', 'peça normal')
    const after = await store.read()
    console.log(JSON.stringify({ hasKey: 'isGroup' in after.subtasks[0] }))
  `)
  expect(out).toEqual({ hasKey: false })
})

test('patchSubtask joins a subtask to an existing group of the SAME task', async () => {
  const out = await run(`
    ${task('t1')}
    ${subtask('g1', 't1', 'isGroup: true,')}
    ${subtask('m1', 't1')}
    const result = await web.patchSubtask('m1', { parentGroupId: 'g1' })
    const after = await store.read()
    const row = after.subtasks.find(s => s.id === 'm1')
    console.log(JSON.stringify({ result, parentGroupId: row.parentGroupId ?? null }))
  `)
  expect(out).toEqual({ result: { ok: true }, parentGroupId: 'g1' })
})

test('patchSubtask refuses `invalid_group` when the id names no subtask', async () => {
  const out = await run(`
    ${task('t1')}
    ${subtask('m1', 't1')}
    const result = await web.patchSubtask('m1', { parentGroupId: 'gone' })
    const after = await store.read()
    const row = after.subtasks.find(s => s.id === 'm1')
    console.log(JSON.stringify({ result, parentGroupId: row.parentGroupId ?? null }))
  `)
  expect(out).toEqual({ result: { ok: false, message: 'invalid_group' }, parentGroupId: null })
})

test('patchSubtask refuses `invalid_group` when the target is not actually a group', async () => {
  const out = await run(`
    ${task('t1')}
    ${subtask('s1', 't1')}
    ${subtask('m1', 't1')}
    const result = await web.patchSubtask('m1', { parentGroupId: 's1' })
    console.log(JSON.stringify({ result }))
  `)
  expect(out).toEqual({ result: { ok: false, message: 'invalid_group' } })
})

test('patchSubtask refuses `invalid_group` when the group belongs to a DIFFERENT task', async () => {
  const out = await run(`
    ${task('t1')}
    ${task('t2')}
    ${subtask('g1', 't2', 'isGroup: true,')}
    ${subtask('m1', 't1')}
    const result = await web.patchSubtask('m1', { parentGroupId: 'g1' })
    console.log(JSON.stringify({ result }))
  `)
  expect(out).toEqual({ result: { ok: false, message: 'invalid_group' } })
})

test('patchSubtask refuses `invalid_group` when the subtask being patched is itself a group', async () => {
  const out = await run(`
    ${task('t1')}
    ${subtask('g1', 't1', 'isGroup: true,')}
    ${subtask('g2', 't1', 'isGroup: true,')}
    const result = await web.patchSubtask('g2', { parentGroupId: 'g1' })
    console.log(JSON.stringify({ result }))
  `)
  expect(out).toEqual({ result: { ok: false, message: 'invalid_group' } })
})

test('an empty string LEAVES the group — the key is gone from the record, not written empty', async () => {
  const out = await run(`
    ${task('t1')}
    ${subtask('g1', 't1', 'isGroup: true,')}
    ${subtask('m1', 't1', "parentGroupId: 'g1',")}
    const result = await web.patchSubtask('m1', { parentGroupId: '' })
    const after = await store.read()
    const row = after.subtasks.find(s => s.id === 'm1')
    console.log(JSON.stringify({ result, hasKey: 'parentGroupId' in row }))
  `)
  expect(out).toEqual({ result: { ok: true }, hasKey: false })
})

test('`null` LEAVES the group too', async () => {
  const out = await run(`
    ${task('t1')}
    ${subtask('g1', 't1', 'isGroup: true,')}
    ${subtask('m1', 't1', "parentGroupId: 'g1',")}
    const result = await web.patchSubtask('m1', { parentGroupId: null })
    const after = await store.read()
    const row = after.subtasks.find(s => s.id === 'm1')
    console.log(JSON.stringify({ result, hasKey: 'parentGroupId' in row }))
  `)
  expect(out).toEqual({ result: { ok: true }, hasKey: false })
})

test('attachSession REFUSES filing on a group MEMBER — subtask_in_group', async () => {
  const out = await run(`
    ${task('t1')}
    ${subtask('g1', 't1', 'isGroup: true,')}
    ${subtask('m1', 't1', "parentGroupId: 'g1',")}
    ${session('sess1')}
    const result = await web.attachSession('t1', 'sess1', { subtaskId: 'm1' })
    console.log(JSON.stringify({ result }))
  `)
  expect(out).toEqual({ result: { ok: false, reason: 'subtask_in_group' } })
})

test('attachSession SUCCEEDS filing directly on the GROUP itself, exactly like any other subtask', async () => {
  const out = await run(`
    ${task('t1')}
    ${subtask('g1', 't1', 'isGroup: true,')}
    ${subtask('m1', 't1', "parentGroupId: 'g1',")}
    ${session('sess1')}
    const result = await web.attachSession('t1', 'sess1', { subtaskId: 'g1' })
    const after = await store.read()
    console.log(JSON.stringify({ result }))
  `)
  expect(out).toEqual({ result: { ok: true } })
})
