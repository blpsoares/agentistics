import { test, expect } from 'bun:test'
import { NO_REPO_KEY } from '@agentistics/core'
import { applyRulesSequence } from './ConnectionsPanel'
import { normalizeDenied } from './repoPanelState'

/**
 * ConnectionsPanel.test.ts — the rules write, asserted against the exported sequence rather than
 * rendered DOM (this project has no React-rendering test infrastructure; see the note at the top
 * of `ConnectionCard.test.tsx`).
 *
 * Critical review fix: the panel used to store WHAT IT SENT (`setConnections(… { ...c,
 * deniedRepos })`). The server does not persist that — `resolveDeniedRepos` applies
 * `withUnresolvedDenied` on the zero→non-zero transition and adds `NO_REPO_KEY`, and the PATCH
 * response carries only `{ ok, queued }`. The client state then diverged from the truth, and the
 * NEXT save (built from that stale draft, with `wasRestricted` now true so the server honours it
 * as-is) silently dropped `NO_REPO_KEY` — re-opening every unattributed session (remote-less
 * folders, and effectively every Codex/Gemini/Kimi/agy session) to that central.
 */

/** A stand-in for the server's own `resolveDeniedRepos` (`packages/server/server/
 *  team-connections.ts`) — web code may never import from `packages/server/*`, so the ONE rule
 *  that matters here (zero→non-zero adds the unresolved-denied sentinel; an already-restricted
 *  list is honoured as-is) is mirrored by hand. */
function makeServer(initial: readonly string[]) {
  let stored = [...initial]
  return {
    get stored() { return [...stored] },
    patch(requested: readonly string[]): Response {
      const wasRestricted = stored.length > 0
      stored = !wasRestricted && requested.length > 0 ? [...requested, NO_REPO_KEY] : [...requested]
      return new Response(JSON.stringify({ ok: true, queued: true }), { status: 200 })
    },
  }
}

test('a PATCH whose server-resolved list differs from what was sent leaves the client showing the SERVER list', async () => {
  const server = makeServer([])
  let client: string[] = []

  const outcome = await applyRulesSequence(
    () => Promise.resolve(server.patch(['github.com/acme/api'])),
    async () => { client = server.stored },
  )

  expect(outcome).toEqual({ ok: true, queued: true })
  // The client sent ONE key; the server persisted two. The panel must show the server's list.
  expect(server.stored).toEqual(['github.com/acme/api', NO_REPO_KEY])
  expect(client).toEqual(['github.com/acme/api', NO_REPO_KEY])
})

test('a second save built from the reloaded client state still carries NO_REPO_KEY', async () => {
  const server = makeServer([])
  let client: string[] = []
  const reload = async () => { client = server.stored }

  await applyRulesSequence(() => Promise.resolve(server.patch(['github.com/acme/api'])), reload)

  // The user blocks a second repository, starting from what the panel now holds — the same way
  // `buildInitialDraft` seeds the edit draft from `deniedRepos`.
  const draft = new Set([...normalizeDenied(client), 'github.com/acme/web'])
  let sent: string[] = []
  await applyRulesSequence(
    () => { sent = [...draft]; return Promise.resolve(server.patch(sent)) },
    reload,
  )

  expect(sent).toContain(NO_REPO_KEY)
  // …and the unattributed bucket is therefore still blocked on the server after the widening.
  expect(server.stored).toContain(NO_REPO_KEY)
  expect(client).toContain(NO_REPO_KEY)
  expect(client).toContain('github.com/acme/web')
})

test('a failed PATCH reports failure and never re-reads preferences', async () => {
  let reloads = 0
  const outcome = await applyRulesSequence(
    () => Promise.resolve(new Response('nope', { status: 500 })),
    async () => { reloads++ },
  )
  expect(outcome).toEqual({ ok: false })
  expect(reloads).toBe(0)
})

test('a transport failure (null response) reports failure instead of throwing', async () => {
  const outcome = await applyRulesSequence(() => Promise.resolve(null), async () => { /* unused */ })
  expect(outcome).toEqual({ ok: false })
})
