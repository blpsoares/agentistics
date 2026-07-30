import { test, expect } from 'bun:test'
import type { TeamConnection } from '@agentistics/core'
import type { Preferences } from './preferences'
import { decideLeaveTarget, memberLeave, type MemberLeaveDeps } from './cli-member'
import { cliStrings } from './cli-i18n'

function conn(id: string, endpoint: string): TeamConnection {
  return { id, endpoint, org: 'default', user: 'u', token: 't', deniedRepos: [] }
}

// ---------------------------------------------------------------------------
// decideLeaveTarget — the 0/1/N × --endpoint/--all × TTY decision behind `agentop member leave`
// (spec §8). Never guesses `connections[0]` in the ambiguous case — a silent guess there is data
// loss, so this is exhaustively covered rather than only smoke-tested.
// ---------------------------------------------------------------------------

test('0 connections: nothing to leave, regardless of flags or TTY', () => {
  expect(decideLeaveTarget([], { isTTY: true })).toEqual({ type: 'none' })
  expect(decideLeaveTarget([], { isTTY: false })).toEqual({ type: 'none' })
  expect(decideLeaveTarget([], { all: true, isTTY: true })).toEqual({ type: 'none' })
})

test('1 connection, no flags: leaves it directly, no prompt — TTY does not matter', () => {
  const only = conn('c_aaaaaaaaaaaa', 'http://a:48080')
  expect(decideLeaveTarget([only], { isTTY: true })).toEqual({ type: 'single', conn: only })
  expect(decideLeaveTarget([only], { isTTY: false })).toEqual({ type: 'single', conn: only })
})

test('N connections, --all: leaves every one regardless of TTY', () => {
  const a = conn('c_aaaaaaaaaaaa', 'http://a:48080')
  const b = conn('c_bbbbbbbbbbbb', 'http://b:48080')
  expect(decideLeaveTarget([a, b], { all: true, isTTY: true })).toEqual({ type: 'all' })
  expect(decideLeaveTarget([a, b], { all: true, isTTY: false })).toEqual({ type: 'all' })
})

test('N connections, --endpoint matching one: leaves just that one', () => {
  const a = conn('c_aaaaaaaaaaaa', 'http://a:48080')
  const b = conn('c_bbbbbbbbbbbb', 'http://b:48080')
  expect(decideLeaveTarget([a, b], { endpoint: 'http://b:48080', isTTY: false })).toEqual({ type: 'single', conn: b })
})

test('--endpoint tolerates a trailing slash on either side', () => {
  const a = conn('c_aaaaaaaaaaaa', 'http://a:48080')
  expect(decideLeaveTarget([a], { endpoint: 'http://a:48080/', isTTY: false })).toEqual({ type: 'single', conn: a })
})

test('N connections, --endpoint matching none: not-found, never falls back to a guess', () => {
  const a = conn('c_aaaaaaaaaaaa', 'http://a:48080')
  const b = conn('c_bbbbbbbbbbbb', 'http://b:48080')
  expect(decideLeaveTarget([a, b], { endpoint: 'http://nope:1', isTTY: true })).toEqual({ type: 'not-found' })
})

test('N connections, no flag, TTY: prompts — never silently picks connections[0]', () => {
  const a = conn('c_aaaaaaaaaaaa', 'http://a:48080')
  const b = conn('c_bbbbbbbbbbbb', 'http://b:48080')
  expect(decideLeaveTarget([a, b], { isTTY: true })).toEqual({ type: 'prompt' })
})

test('N connections, no flag, non-TTY: ambiguous — refuses to guess, exit-1 territory', () => {
  const a = conn('c_aaaaaaaaaaaa', 'http://a:48080')
  const b = conn('c_bbbbbbbbbbbb', 'http://b:48080')
  const c = conn('c_cccccccccccc', 'http://c:48080')
  expect(decideLeaveTarget([a, b, c], { isTTY: false })).toEqual({ type: 'ambiguous' })
})

test('--endpoint wins over an implicit N-connection prompt even on a TTY', () => {
  const a = conn('c_aaaaaaaaaaaa', 'http://a:48080')
  const b = conn('c_bbbbbbbbbbbb', 'http://b:48080')
  expect(decideLeaveTarget([a, b], { endpoint: 'http://a:48080', isTTY: true })).toEqual({ type: 'single', conn: a })
})

test('--all wins over --endpoint when both are somehow set', () => {
  const a = conn('c_aaaaaaaaaaaa', 'http://a:48080')
  const b = conn('c_bbbbbbbbbbbb', 'http://b:48080')
  expect(decideLeaveTarget([a, b], { all: true, endpoint: 'http://a:48080', isTTY: false })).toEqual({ type: 'all' })
})

// review finding I3: --endpoint must match via the SAME identity rule `connect` uses
// (normalizeEndpointKey — host lowercased, default port folded), not a raw string compare. A
// case-variant endpoint used to report not-found here while updating the same connection in
// place via `connect` — a real inconsistency between the two commands, not just a cosmetic gap.
test('--endpoint matches case-insensitively and folds a default port, like connect does', () => {
  const a = conn('c_aaaaaaaaaaaa', 'https://central.example.com')
  expect(decideLeaveTarget([a], { endpoint: 'https://Central.example.com', isTTY: false })).toEqual({ type: 'single', conn: a })
  expect(decideLeaveTarget([a], { endpoint: 'https://central.example.com:443', isTTY: false })).toEqual({ type: 'single', conn: a })
})

// ---------------------------------------------------------------------------
// memberLeave — integration tests against REAL Bun.serve fixtures on ephemeral ports, using the
// injected `deps` seam (review finding I5). `readPreferences` is faked so these never touch the
// developer's real preferences file; `port` points at the fixture instead of the real local
// server. Exercises the riskiest, previously-untested path: the local-server-vs-direct-fallback
// CHOICE, and that a server ANSWER (not just a network failure) is reported honestly.
//
// TWO further seams are used on every call, deliberately, per review findings N1/N2:
//   - `isTTY: false` — `decideLeaveTarget`'s branching depends on it, and inferring it from
//     `process.stdin.isTTY` meant this suite silently changed behavior depending on whether it
//     ran under a pty (a developer's own terminal) or a pipe (CI, the git hook): under a REAL
//     tty the N-connection no-flag test hit the `'prompt'` branch instead of `'ambiguous'`,
//     drove the actual interactive `select()`, and consumed that terminal's stdin for 5s.
//   - `strings: EN` — `memberLeave` defaults to `cliStrings(await resolveLang())`, and
//     `resolveLang()` reads `~/.agentistics/preferences.json`'s `lang` field. Every assertion
//     below is a hardcoded English literal, so leaving this un-injected meant the whole suite
//     depended on the developer's real preferences file AND failed outright on any machine
//     actually configured for `pt` — the same "test coupled to real data" class of bug this plan
//     has now shipped four different ways across earlier rounds.
// ---------------------------------------------------------------------------

const EN = cliStrings('en')
const TTY_OFF: Pick<MemberLeaveDeps, 'isTTY' | 'strings'> = { isTTY: false, strings: EN }

function fakePrefs(connections: TeamConnection[]): () => Promise<Preferences> {
  return async () => ({ team: { schema: 2, mode: 'member', connections } }) as Preferences
}

/** Captures process.stdout/stderr writes for the duration of `fn`, then restores them —
 *  `memberLeave` writes directly to these (matching every other CLI command in this codebase),
 *  so this is the only way to assert on its output without changing its production signature. */
async function captureOutput(fn: () => Promise<number>): Promise<{ code: number; stdout: string; stderr: string }> {
  const origOut = process.stdout.write.bind(process.stdout)
  const origErr = process.stderr.write.bind(process.stderr)
  let stdout = ''
  let stderr = ''
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ;(process.stdout as any).write = (chunk: unknown) => { stdout += String(chunk); return true }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ;(process.stderr as any).write = (chunk: unknown) => { stderr += String(chunk); return true }
  try {
    const code = await fn()
    return { code, stdout, stderr }
  } finally {
    process.stdout.write = origOut
    process.stderr.write = origErr
  }
}

test('memberLeave: N connections, no flag (non-TTY under bun test) — exit 1, never guesses, nothing removed', async () => {
  const a = conn('c_aaaaaaaaaaaa', 'http://a:1')
  const b = conn('c_bbbbbbbbbbbb', 'http://b:1')
  let leaveDirectCalled = false
  const { code, stderr } = await captureOutput(() => memberLeave(
    {},
    { ...TTY_OFF, readPreferences: fakePrefs([a, b]), port: 1, leaveDirect: async () => { leaveDirectCalled = true; return { ok: true } } },
  ))
  expect(code).toBe(1)
  expect(stderr).toContain('2 centrals')
  expect(leaveDirectCalled).toBe(false) // refused before ever attempting to remove anything
})

test('memberLeave: a local-server 404 answer is reported as a failure, never printed as success (I1)', async () => {
  await using server = Bun.serve({
    port: 0,
    fetch: () => new Response(JSON.stringify({ error: 'unknown connection' }), { status: 404 }),
  })
  const a = conn('c_aaaaaaaaaaaa', 'http://a:1')
  let leaveDirectCalled = false
  const { code, stdout, stderr } = await captureOutput(() => memberLeave(
    {},
    { ...TTY_OFF, readPreferences: fakePrefs([a]), port: server.port!, leaveDirect: async () => { leaveDirectCalled = true; return { ok: true } } },
  ))
  expect(code).toBe(1)
  expect(stdout).not.toContain('left ')
  expect(stderr).toContain('unknown connection')
  // The server ANSWERED (404 is an answer, not a network failure) — must never silently bypass
  // it and fall back to the direct write, which is exactly what I1 found broken.
  expect(leaveDirectCalled).toBe(false)
})

test('memberLeave: local server unreachable — falls back to the injected direct sequence (the fallback CHOICE)', async () => {
  // Bind then immediately close a server to obtain a port nothing is listening on.
  const probe = Bun.serve({ port: 0, fetch: () => new Response('ok') })
  const deadPort = probe.port!
  probe.stop(true)

  const a = conn('c_aaaaaaaaaaaa', 'http://a:1')
  let leaveDirectCalledWith: string | null = null
  const { code, stdout } = await captureOutput(() => memberLeave(
    {},
    {
      ...TTY_OFF,
      readPreferences: fakePrefs([a]),
      port: deadPort,
      leaveDirect: async (connId) => { leaveDirectCalledWith = connId; return { ok: true } },
    },
  ))
  expect(code).toBe(0)
  expect(leaveDirectCalledWith as string | null).toBe('c_aaaaaaaaaaaa')
  expect(stdout).toContain('left http://a:1')
})

test('memberLeave: local server IS reachable — the direct fallback is never invoked (the other half of the CHOICE)', async () => {
  await using server = Bun.serve({ port: 0, fetch: () => new Response(JSON.stringify({ ok: true })) })
  const a = conn('c_aaaaaaaaaaaa', 'http://a:1')
  let leaveDirectCalled = false
  const { code } = await captureOutput(() => memberLeave(
    {},
    { ...TTY_OFF, readPreferences: fakePrefs([a]), port: server.port!, leaveDirect: async () => { leaveDirectCalled = true; return { ok: true } } },
  ))
  expect(code).toBe(0)
  expect(leaveDirectCalled).toBe(false)
})

test('memberLeave --all: one connection failing does not abort the others (allSettled, not Promise.all — I2)', async () => {
  await using server = Bun.serve({
    port: 0,
    fetch: (req) => {
      const url = new URL(req.url)
      if (url.pathname.endsWith('c_bbbbbbbbbbbb')) return new Response(JSON.stringify({ error: 'boom' }), { status: 500 })
      return new Response(JSON.stringify({ ok: true }))
    },
  })
  const a = conn('c_aaaaaaaaaaaa', 'http://a:1')
  const b = conn('c_bbbbbbbbbbbb', 'http://b:1')
  const { code, stdout, stderr } = await captureOutput(() => memberLeave(
    { all: true },
    { ...TTY_OFF, readPreferences: fakePrefs([a, b]), port: server.port!, leaveDirect: async () => ({ ok: true }) },
  ))
  expect(code).toBe(1) // partial failure — not a clean "left all"
  expect(stdout).toContain('left http://a:1') // the connection that succeeded is still reported
  expect(stderr).toContain('boom') // the one that failed is reported, not silently dropped
  expect(stdout).not.toContain('left all') // never claims full success when it was not
})
