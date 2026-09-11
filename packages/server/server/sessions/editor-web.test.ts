import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { handleEditorTreeRoute } from './editor-web'
import type { StartHost } from '../cli-start'

// Same reason repo-probe.test.ts / editor-fs.test.ts strip these: a pre-commit hook running from a
// linked worktree exports GIT_DIR / GIT_INDEX_FILE pointing at the OUTER checkout, and `-C`/`cwd`
// do not override GIT_DIR for repository discovery.
const git = (cwd: string, ...args: string[]) => {
  const env: NodeJS.ProcessEnv = { ...process.env, GIT_TERMINAL_PROMPT: '0' }
  delete env.GIT_DIR
  delete env.GIT_WORK_TREE
  delete env.GIT_INDEX_FILE
  delete env.GIT_PREFIX
  return execFileSync('git', args, { cwd, encoding: 'utf8', env })
}

let root = ''
let repo = ''

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'agentistics-editor-web-'))
  repo = join(root, 'repo')
  mkdirSync(repo)
  git(repo, 'init', '-q', '-b', 'main')
  git(repo, 'config', 'user.email', 't@t')
  git(repo, 'config', 'user.name', 't')
  writeFileSync(join(repo, 'a.ts'), 'export const a = 1\n')
  git(repo, 'add', 'a.ts')
  git(repo, 'commit', '-q', '-m', 'init')
})

afterAll(() => { rmSync(root, { recursive: true, force: true }) })

// `StartHost` (via `ControlHost`) carries many members no route here calls — the same posture
// `editor-fs.test.ts` and `shell-web.test.ts` already take for a host that is never driven beyond
// what `resolveSessionDirectory` reads (`host.sessions`). `ControlSessions` requires `sessions`,
// `attention` and `rang`; the mock supplies exactly those three and nothing more.
const noHost = {} as StartHost
const hostWith = (id: string, cwd: string): StartHost => ({
  ...noHost,
  sessions: async () => ({
    sessions: [{ id, conversationId: `${id}-conv`, cwd } as never],
    attention: 0,
    rang: [],
  }),
})

async function call(req: Request, host: StartHost) {
  const url = new URL(req.url)
  const res = await handleEditorTreeRoute(req, url, host, 'en')
  expect(res).not.toBeNull()
  return { status: res!.status, body: await res!.json() }
}

describe('handleEditorTreeRoute', () => {
  test('an unknown route under the prefix falls through as null, so index.ts can keep looking', async () => {
    const req = new Request('http://x/api/fleet/tree/not-a-real-subroute')
    const res = await handleEditorTreeRoute(req, new URL(req.url), noHost, 'en')
    expect(res).toBeNull()
  })

  test('GET /api/fleet/tree with an unknown session id refuses with a sentence', async () => {
    const req = new Request('http://x/api/fleet/tree?id=nope&path=')
    const { body } = await call(req, noHost)
    expect(body.ok).toBe(false)
    expect(body.reason).toBe('unknown-session')
    expect(typeof body.message).toBe('string')
    expect(body.message.length).toBeGreaterThan(0)
  })

  test('GET /api/fleet/tree lists the root', async () => {
    const req = new Request('http://x/api/fleet/tree?id=s1&path=')
    const { body } = await call(req, hostWith('s1', repo))
    expect(body).toEqual({ ok: true, children: [{ name: 'a.ts', kind: 'file' }] })
  })

  test('GET /api/fleet/tree/file reads a file', async () => {
    const req = new Request('http://x/api/fleet/tree/file?id=s1&path=a.ts')
    const { body } = await call(req, hostWith('s1', repo))
    expect(body.ok).toBe(true)
    expect(body.content).toBe('export const a = 1\n')
    expect(typeof body.mtimeMs).toBe('number')
  })

  test('PUT /api/fleet/tree/file writes, then a stale write is refused as a conflict', async () => {
    const read = await call(new Request('http://x/api/fleet/tree/file?id=s1&path=a.ts'), hostWith('s1', repo))
    const put1 = await call(new Request('http://x/api/fleet/tree/file?id=s1&path=a.ts', {
      method: 'PUT', body: JSON.stringify({ content: 'export const a = 2\n', mtimeMs: read.body.mtimeMs }),
    }), hostWith('s1', repo))
    expect(put1.body.ok).toBe(true)

    const put2 = await call(new Request('http://x/api/fleet/tree/file?id=s1&path=a.ts', {
      method: 'PUT', body: JSON.stringify({ content: 'export const a = 3\n', mtimeMs: read.body.mtimeMs }),
    }), hostWith('s1', repo))
    expect(put2.status).toBe(409)
    expect(put2.body).toMatchObject({ ok: false, reason: 'conflict', content: 'export const a = 2\n' })
  })

  test('POST /api/fleet/tree/entry creates a file, GET /api/fleet/tree/search finds it by name', async () => {
    const post = await call(new Request('http://x/api/fleet/tree/entry', {
      method: 'POST', body: JSON.stringify({ id: 's1', path: 'brand-new.md', kind: 'file' }),
    }), hostWith('s1', repo))
    expect(post.body).toEqual({ ok: true })

    const search = await call(new Request('http://x/api/fleet/tree/search?id=s1&q=brand-new'), hostWith('s1', repo))
    expect(search.body.hits).toContainEqual({ kind: 'name', path: 'brand-new.md' })
  })

  test('PATCH /api/fleet/tree/entry renames', async () => {
    const patch = await call(new Request('http://x/api/fleet/tree/entry', {
      method: 'PATCH', body: JSON.stringify({ id: 's1', from: 'brand-new.md', to: 'renamed.md' }),
    }), hostWith('s1', repo))
    expect(patch.body).toEqual({ ok: true })
  })

  test('DELETE /api/fleet/tree/entry deletes', async () => {
    const del = await call(new Request('http://x/api/fleet/tree/entry?id=s1&path=renamed.md', {
      method: 'DELETE',
    }), hostWith('s1', repo))
    expect(del.body).toEqual({ ok: true })
  })

  test('a well-formed request with a missing required parameter is a 400, never a 500', async () => {
    const req = new Request('http://x/api/fleet/tree?path=x')
    const { status, body } = await call(req, hostWith('s1', repo))
    expect(status).toBe(400)
    expect(body.ok).toBe(false)
  })

  describe('containment/not-found refusals are 404 on every route, state conflicts are 409', () => {
    test('POST /api/fleet/tree/entry with an escaping path is 404, not 409', async () => {
      const req = new Request('http://x/api/fleet/tree/entry', {
        method: 'POST', body: JSON.stringify({ id: 's1', path: '../escape.txt', kind: 'file' }),
      })
      const { status, body } = await call(req, hostWith('s1', repo))
      expect(status).toBe(404)
      expect(body).toMatchObject({ ok: false, reason: 'escaped' })
    })

    test('POST /api/fleet/tree/entry over an existing path is 409 (a real state conflict)', async () => {
      const req = new Request('http://x/api/fleet/tree/entry', {
        method: 'POST', body: JSON.stringify({ id: 's1', path: 'a.ts', kind: 'file' }),
      })
      const { status, body } = await call(req, hostWith('s1', repo))
      expect(status).toBe(409)
      expect(body).toMatchObject({ ok: false, reason: 'already-exists' })
    })

    test('PATCH /api/fleet/tree/entry renaming from an escaping path is 404, not 409', async () => {
      const req = new Request('http://x/api/fleet/tree/entry', {
        method: 'PATCH', body: JSON.stringify({ id: 's1', from: '../escape.txt', to: 'x.ts' }),
      })
      const { status, body } = await call(req, hostWith('s1', repo))
      expect(status).toBe(404)
      expect(body).toMatchObject({ ok: false, reason: 'escaped' })
    })

    test('PATCH /api/fleet/tree/entry onto an existing destination is 409 (a real state conflict)', async () => {
      const req = new Request('http://x/api/fleet/tree/entry', {
        method: 'PATCH', body: JSON.stringify({ id: 's1', from: 'a.ts', to: 'a.ts' }),
      })
      const { status, body } = await call(req, hostWith('s1', repo))
      expect(status).toBe(409)
      expect(body).toMatchObject({ ok: false, reason: 'already-exists' })
    })

    test('DELETE /api/fleet/tree/entry with an escaping path is 404, not 409', async () => {
      const req = new Request('http://x/api/fleet/tree/entry?id=s1&path=../escape.txt', { method: 'DELETE' })
      const { status, body } = await call(req, hostWith('s1', repo))
      expect(status).toBe(404)
      expect(body).toMatchObject({ ok: false, reason: 'escaped' })
    })

    test('DELETE /api/fleet/tree/entry on a non-empty folder without ?recursive=1 is 409 (a real state conflict)', async () => {
      const dirReq = new Request('http://x/api/fleet/tree/entry', {
        method: 'POST', body: JSON.stringify({ id: 's1', path: 'nonempty', kind: 'dir' }),
      })
      await call(dirReq, hostWith('s1', repo))
      const fileReq = new Request('http://x/api/fleet/tree/entry', {
        method: 'POST', body: JSON.stringify({ id: 's1', path: 'nonempty/inside.txt', kind: 'file' }),
      })
      await call(fileReq, hostWith('s1', repo))

      const del = await call(
        new Request('http://x/api/fleet/tree/entry?id=s1&path=nonempty', { method: 'DELETE' }),
        hostWith('s1', repo),
      )
      expect(del.status).toBe(409)
      expect(del.body).toMatchObject({ ok: false, reason: 'not-empty' })
    })
  })

  test('a missing required parameter is localized, like every other refusal in this module', async () => {
    const req = new Request('http://x/api/fleet/tree?path=x')
    const res = await handleEditorTreeRoute(req, new URL(req.url), hostWith('s1', repo), 'pt')
    expect(res).not.toBeNull()
    const body = await res!.json()
    expect(res!.status).toBe(400)
    expect(body.message).not.toBe('id is required')
    expect(typeof body.message).toBe('string')
    expect(body.message.length).toBeGreaterThan(0)
  })
})
