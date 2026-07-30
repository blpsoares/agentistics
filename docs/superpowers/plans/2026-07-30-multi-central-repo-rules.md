# Per-connection repository sharing rules — Implementation Plan (Plan 3)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `TeamConnection.deniedRepos` actually mean something end to end — a repository blocked on one central is never pushed there, is retroactively deleted from it by a journalled `POST /api/team/forget` sequence, and is editable from a mobile-correct Settings UI.

**Architecture:** The pure decision layer already exists (`share-rules.ts`, Plan 1) and the per-connection runtime already exists (Plan 2). This plan is wiring, in three layers. **(A) The central** gains one additive field on `GET /api/team/policy` (`capabilities`) and one new minted-token-only route (`POST /api/team/forget`). **(B) The machine's push path** filters sessions before `selectDeltas`, swaps the real statsCache for `buildSplitStatsCache` whenever the connection *declares* a restriction, fails closed on workflow runs, and runs a per-cycle denial-based shrink detector whose payload is journalled to disk before the first batch leaves. **(C) The web UI** dissolves `TeamSettings.tsx` into a per-connection card list with the denylist editor, and the add wizard makes "block before the first push" the default path.

**Tech Stack:** Bun, TypeScript, React 18 + Vite, MongoDB (central only), `bun test`.

**Spec:** `docs/superpowers/specs/2026-07-28-multi-central-and-repo-sharing-design.md`. Section references below (§4.2, §5.3, …) point into it and are **normative** — when this plan and the spec disagree, the spec wins and you stop and ask.

## Global Constraints

- **Everything in English**: code, comments, commit messages, docs (project CLAUDE.md).
- **The pre-commit hook must pass on every commit** (`bun tsc --noEmit` + `bun test`). **Never `--no-verify`.** If the hook fails, fix the cause.
- **No test may read `~/.claude` or `~/.agentistics`.** This leaked four times during Plan 2, a different mechanism each time (a real `buildApiResponse` inside a test, an unrestored `TEAM_CONN_DIR`, `resolveLang()` reading real preferences, a real `readPreferences` default in a deps bag). Every new impure function gets an injectable deps bag; every test that needs a directory uses a tmp dir and restores the module global in `afterAll`.
- **No test may depend on the developer's locale.** Inject `strings`/`lang`, never call `resolveLang()`.
- **`share-rules.ts` stays pure** — no I/O, no `preferences`, no `config` import. Only `@agentistics/core` types plus `normalizeGitRemote` / `emptyStatsCache`.
- **`stats-cache.json` is Claude-only.** Every synthetic/split cache path is Claude-gated (`harness ?? 'claude'`).
- **Nothing about the denylist goes on the wire to a central.** `IngestBody` gains no field; `StatsCache` gains no field. The only new outbound body is `{ sessionIds }` on `POST /api/team/forget`.
- **`attributionBoundary` returns `string | null`** and the three states are distinct and load-bearing: `''` = Claude rolled up nothing (everything decomposable), `'YYYY-MM-DD'` = the first decomposable day, `null` = a watermark exists but could not be parsed → **refuse** (`buildSplitStatsCache` returns `null`, the cycle pushes no cache). Never collapse `null` into `''`.
- **On the restricted path there is no fallback to the unsplit cache, ever** (§4.4). `null` from `buildSplitStatsCache` means "omit `statsCache` from this push".
- **The split is selected by `hasRestrictions(conn.deniedRepos)`** — the declared rule — never by a count comparison (R3).
- **Every new `/api` route is authenticated by default.** Adding one to `AUTH_PUBLIC` (`index-routes.ts`) requires updating `authz-gate.test.ts`, which asserts that Set's exact contents.
- **Never return internal error text to a client** — use `safeError` (`errors.ts`).
- **Never `await req.json()` on an unauthenticated route** — use `readJsonLimited` (`limits.ts`).
- **Mobile is part of the deliverable, not a follow-up** (CLAUDE.md): 44px touch targets on mobile only, every mobile-visible `<input>` ≥16px, and `document.documentElement.scrollWidth <= window.innerWidth` at 390px. Phase B tasks are not complete without their mobile branch.
- **One implementer per worktree at a time.** Work in `.claude/worktrees/<name>/` on a branch off `origin/dev`; a fresh worktree needs `bun install` plus `bun run packages/server/scripts/ensure-type-stub.ts`.
- **Stage explicit paths** (`git add <paths>`), never `git add -A` — other sessions share this repo.

## Phase order

**Phase A (Tasks 1–7)** is the whole feature minus the UI, verifiable with `curl` + `agentop member status` against two mock centrals. **Phase B (Tasks 8–14)** is the UI. Phase A must be green and merged before Phase B starts: the UI's contract is `PATCH /api/team/connections/:id { deniedRepos }` plus the new `/api/team/status` fields, and building the UI against an unbuilt contract is what makes a UI that cannot be reviewed.

Until the UI ships, a rule can be set with:

```bash
curl -s -X PATCH localhost:47291/api/team/connections/<connId> \
  -H 'Content-Type: application/json' -d '{"deniedRepos":["github.com/org/repo"]}'
```

## File structure

| File | Responsibility | Task |
|---|---|---|
| `packages/server/server/team-uploader.ts` (modify) | `sessionHash` → sha256; denylist bites in `pushOnceDetailed`; quiet-push suppression + jitter | 1, 3 |
| `packages/server/server/team-forget.ts` (create) | **Central side.** `POST /api/team/forget` — body validation (pure) + the scoped delete | 2 |
| `packages/server/server/index.ts` (modify) | Route wiring for `/api/team/forget`; `capabilities` on `/api/team/policy` | 2 |
| `packages/server/server/index-routes.ts` (modify) | `/api/team/forget` in `AUTH_PUBLIC` | 2 |
| `packages/server/server/team-capabilities.ts` (create) | `CENTRAL_CAPABILITIES` + the pure member-side `parseCapabilities` / `canForget` reader | 2 |
| `packages/server/server/team-rules.ts` (create) | **Machine side, pure + IO split.** The per-connection rules file: read/write `{rulesHash, sharedIds, boundary, sealed, pending}`, and the pure `planRulesReconcile()` that decides forget/seal/persist from local facts only | 4 |
| `packages/server/server/team-forget-client.ts` (create) | The removal SEQUENCE: journal, whoami precondition, batched POSTs, per-ack sent-state advance, boot replay. Pure `planForgetBatches()` + `decideJournalResume()` beside the IO | 5 |
| `packages/server/server/team-connections.ts` (modify) | `PATCH { deniedRepos }`, `POST { deniedRepos }`, the new `/api/team/status` fields | 6 |
| `packages/web/src/lib/shareRepos.ts` (create) | Pure presentation projection: `buildShareTargets`, `countDenied`, `hostOf`, `plural` | 8 |
| `packages/web/src/components/team/*` (create) | The card list, the denylist editor, the add wizard, the pill | 10–12 |
| `packages/web/src/components/TeamSettings.tsx` (delete) | Dissolved (§9.1) | 10 |
| `packages/web/src/pages/settings/primitives.tsx` (modify) | `FieldInput` (16px mobile), `RowSwitch`, `StatusDot` | 9 |
| `packages/web/src/components/team/copy.ts` (create) | The EN/PT table, verbatim from §9.8 | 9 |
| `docs/architecture.md`, `docs/security.md`, `CLAUDE.md` (modify) | The feature, its guarantee, and the invariants | 7, 14 |

---

# PHASE A — the machine and the central

---

### Task 1: `sessionHash` becomes a real digest

The migration already converts v1 sent-state values to `sha256(value)` (`team-migrate.ts` `convertSentStateV1`, landed in Plan 2), but `sessionHash` still returns `JSON.stringify(s)`. So today, the first boot after upgrading converts every hash and then **mismatches every one of them** — a full re-push of the entire history for every member, exactly what §5.4 promised would cost zero. It also leaves the sent-state file the size of the consolidate store (R34).

**Files:**
- Modify: `packages/server/server/team-uploader.ts:299-301`
- Test: `packages/server/server/team-uploader.test.ts`

**Interfaces:**
- Consumes: `convertSentStateV1(raw)` from `team-migrate.ts` (already exported).
- Produces: `sessionHash(s: SessionMeta): string` — a 64-char lowercase hex sha256 of `JSON.stringify(s)`. Tasks 3 and 5 rely on it being the same digest the migration writes.

- [ ] **Step 1: Write the failing tests**

```ts
// packages/server/server/team-uploader.test.ts — append
import { convertSentStateV1 } from './team-migrate'

describe('sessionHash', () => {
  const s = (over: Partial<SessionMeta> = {}): SessionMeta => ({
    session_id: 's1', project_path: '/p', start_time: '2026-07-01T10:00:00.000Z',
    ...over,
  } as SessionMeta)

  it('is a 64-char lowercase hex digest', () => {
    expect(sessionHash(s())).toMatch(/^[a-f0-9]{64}$/)
  })

  it('is stable for equal inputs and differs for a changed field', () => {
    expect(sessionHash(s())).toBe(sessionHash(s()))
    expect(sessionHash(s({ project_path: '/q' }))).not.toBe(sessionHash(s()))
  })

  // THE property the v1->v2 migration depends on: the v1 stored value IS JSON.stringify(session),
  // so sha256 of that value must equal the new digest of the same session. Without this, every
  // migrated member re-pushes its whole history on the first boot after upgrading.
  it('equals sha256 of the v1 stored value for the same session', () => {
    const session = s()
    const v1 = { s1: JSON.stringify(session) }
    const converted = convertSentStateV1(v1)
    expect(converted?.hashes.s1).toBe(sessionHash(session))
  })
})
```

- [ ] **Step 2: Run and watch it fail**

Run: `bun test packages/server/server/team-uploader.test.ts -t sessionHash`
Expected: FAIL — the digest test fails on a JSON string, and the conversion test shows two different values.

- [ ] **Step 3: Implement**

```ts
/**
 * The sent-state key for one session.
 *
 * A real digest, not the serialized session: the v1 format stored `JSON.stringify(session)` as its
 * value, which made `team-sent.json` roughly the size of the consolidate store and re-parsed it
 * inside the batch loop — N copies on disk with N connections. `createHash` over that exact same
 * string is what lets `convertSentStateV1` upgrade an existing file offline and EXACTLY, so the
 * migration costs zero re-pushes (§5.4). Do not change what is fed to the hash without changing
 * that converter: they are two halves of one identity.
 */
export function sessionHash(s: SessionMeta): string {
  return createHash('sha256').update(JSON.stringify(s)).digest('hex')
}
```

- [ ] **Step 4: Run the full suite**

Run: `bun test`
Expected: PASS. If a sent-state test asserted a JSON payload, update the assertion — do not weaken the digest.

- [ ] **Step 5: Commit**

```bash
git add packages/server/server/team-uploader.ts packages/server/server/team-uploader.test.ts
git commit -m "fix(team): make sessionHash the digest the sent-state migration already assumes"
```

---

### Task 2: the central — `POST /api/team/forget` and `capabilities` on the policy route

**Files:**
- Create: `packages/server/server/team-forget.ts`
- Create: `packages/server/server/team-capabilities.ts`
- Create: `packages/server/server/team-forget.test.ts`
- Create: `packages/server/server/team-capabilities.test.ts`
- Modify: `packages/server/server/index.ts` (the `/api/team/policy` handler at ~1681; new route beside `/api/team/leave` at ~1606)
- Modify: `packages/server/server/index-routes.ts` (`AUTH_PUBLIC`)
- Modify: `packages/server/server/authz-gate.test.ts` (the Set's exact contents)

**Interfaces:**
- Consumes: `validateIngestToken(bearer)` (`team-tokens.ts`, returns `{ok:true,memberId,user,…} | {ok:false}`), `getTeamCollection()` (`team-store.ts`), `deleteMemberWorkflows` (`team-workflows.ts`), `readJsonLimited` + `LIMITS` (`limits.ts`), `safeError` (`errors.ts`), `triggerSseNotification()` (`team-ingest.ts` uses it — same import).
- Produces:
  - `parseForgetBody(raw: unknown): { ok: true; sessionIds: string[] } | { ok: false; error: string }` — pure, max 500 ids.
  - `handleTeamForget(req: Request): Promise<Response>` — `{ ok: true, deleted: number, deletedRuns: number }`.
  - `CENTRAL_CAPABILITIES: readonly string[]` = `['leave','leave.stats','leave.workflows','forget.sessions']`.
  - `parseCapabilities(raw: unknown): string[]` and `centralCanForget(caps: string[]): boolean` — pure, used by Task 4 on the member side.

- [ ] **Step 1: Write the failing pure tests**

```ts
// packages/server/server/team-forget.test.ts
import { describe, it, expect } from 'bun:test'
import { parseForgetBody, MAX_FORGET_IDS } from './team-forget'

describe('parseForgetBody', () => {
  it('accepts a list of string ids', () => {
    expect(parseForgetBody({ sessionIds: ['a', 'b'] })).toEqual({ ok: true, sessionIds: ['a', 'b'] })
  })

  it('rejects a non-object, a missing array and a non-array', () => {
    for (const raw of [null, 'x', 42, {}, { sessionIds: 'a' }]) {
      expect(parseForgetBody(raw).ok).toBe(false)
    }
  })

  // A malformed body is 400, NEVER a partial delete: dropping the junk and deleting the rest
  // would make the member's journal believe a batch was acked that was only half applied.
  it('rejects a list containing a non-string or an empty string', () => {
    expect(parseForgetBody({ sessionIds: ['a', 7] }).ok).toBe(false)
    expect(parseForgetBody({ sessionIds: ['a', ''] }).ok).toBe(false)
  })

  it('rejects more than MAX_FORGET_IDS ids', () => {
    const ids = Array.from({ length: MAX_FORGET_IDS + 1 }, (_, i) => `s${i}`)
    expect(parseForgetBody({ sessionIds: ids }).ok).toBe(false)
    expect(parseForgetBody({ sessionIds: ids.slice(0, MAX_FORGET_IDS) }).ok).toBe(true)
  })

  it('accepts an empty list as a no-op', () => {
    expect(parseForgetBody({ sessionIds: [] })).toEqual({ ok: true, sessionIds: [] })
  })

  it('de-duplicates ids', () => {
    expect(parseForgetBody({ sessionIds: ['a', 'a', 'b'] })).toEqual({ ok: true, sessionIds: ['a', 'b'] })
  })
})
```

```ts
// packages/server/server/team-capabilities.test.ts
import { describe, it, expect } from 'bun:test'
import { CENTRAL_CAPABILITIES, parseCapabilities, centralCanForget } from './team-capabilities'

describe('capabilities', () => {
  it('advertises forget.sessions', () => {
    expect(CENTRAL_CAPABILITIES).toContain('forget.sessions')
  })

  // An older central has no `capabilities` field at all. That is not "no capabilities available"
  // as a guess — it is exactly the state that must produce canForget=false and a DISABLED editor,
  // never a fallback to the destructive full purge (§7).
  it('reads a missing, wrong-typed or junk field as no capabilities', () => {
    for (const raw of [undefined, null, 'forget.sessions', 42, { a: 1 }, [1, 2]]) {
      expect(parseCapabilities(raw)).toEqual([])
    }
  })

  it('keeps only string entries', () => {
    expect(parseCapabilities(['leave', 7, 'forget.sessions'])).toEqual(['leave', 'forget.sessions'])
  })

  it('centralCanForget is true only when forget.sessions is present', () => {
    expect(centralCanForget(['leave', 'forget.sessions'])).toBe(true)
    expect(centralCanForget(['leave', 'leave.workflows'])).toBe(false)
    expect(centralCanForget([])).toBe(false)
  })
})
```

- [ ] **Step 2: Run and watch both fail**

Run: `bun test packages/server/server/team-forget.test.ts packages/server/server/team-capabilities.test.ts`
Expected: FAIL — modules do not exist.

- [ ] **Step 3: Implement `team-capabilities.ts`**

```ts
/**
 * team-capabilities.ts — what a central can do, advertised on GET /api/team/policy.
 *
 * The removal primitive was assembled across releases (`/api/team/leave` + deleteMemberStats in
 * v1.6.6, deleteMemberWorkflows only in v1.7.3, `forget` here), so a member cannot infer a
 * central's vintage from its version string alone and must not try. Additive by design: an older
 * member ignores the field, and an older CENTRAL omits it — which is why the reader below treats
 * absence as "no capabilities" rather than assuming any.
 */

/** What THIS central advertises. Add a string here the same release the route ships, never before. */
export const CENTRAL_CAPABILITIES: readonly string[] = [
  'leave',
  'leave.stats',
  'leave.workflows',
  'forget.sessions',
]

/** Pure, total: any shape that is not an array of strings reads as no capabilities. */
export function parseCapabilities(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  return raw.filter((v): v is string => typeof v === 'string')
}

/** The one capability this feature gates on. `false` DISABLES the rules editor (§7) — it never
 *  selects a fallback: emptying a machine's history to withdraw a handful of sessions is not an
 *  acceptable substitute for a precise delete the central cannot perform. */
export function centralCanForget(caps: readonly string[]): boolean {
  return caps.includes('forget.sessions')
}
```

- [ ] **Step 4: Implement `team-forget.ts`**

```ts
/**
 * team-forget.ts — POST /api/team/forget (CENTRAL side): delete NAMED sessions of the
 * authenticated member.
 *
 * This is the retroactive half of per-connection repository rules. A member whose denylist grows
 * posts the ids it has already pushed and may no longer share; the central deletes exactly those
 * and their workflow runs, scoped to the memberId the TOKEN proves.
 *
 * MINTED TOKEN ONLY. No legacy `{org,user}` branch, no shared-secret path, no open fallback — and
 * that is not symmetry with `handleTeamLeave` being overlooked, it is a correction of it.
 * `handleTeamLeave` deletes by `memberId` on its minted branch and by `{org,user}` on its legacy
 * one and returns `{ok:true,deleted:N}` from BOTH, so a member cannot tell which identity acted;
 * on a central whose DB was wiped or restored, one machine's rules change would delete every
 * machine of the same person. A route that DELETES must never be reachable by an identity the
 * caller cannot prove.
 *
 * The `memberStats` document is deliberately NOT touched: the member replaces it in the same
 * cycle, which is what keeps `machineStatsCaches[memberId]` continuous and every other machine's
 * machine/team filter honest while this runs (§6.2). Deleting it here would reintroduce exactly
 * the window the scoped route exists to remove.
 *
 * Idempotent: deleting an unknown or already-deleted id is a no-op returning `deleted: 0`, which
 * is what makes the member's crash journal safely replayable.
 */
import { getTeamCollection } from './team-store'
import { validateIngestToken } from './team-tokens'
import { readJsonLimited, LIMITS } from './limits'
import { safeError } from './errors'

const JSON_HEADERS = { 'Content-Type': 'application/json' } as const

/** One request's cap. The member batches; a bigger body is a client bug, not a reason to
 *  truncate — truncating silently would make the member's journal record ids as acked that were
 *  never deleted. */
export const MAX_FORGET_IDS = 500

export function parseForgetBody(
  raw: unknown,
): { ok: true; sessionIds: string[] } | { ok: false; error: string } {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, error: 'invalid body' }
  const ids = (raw as { sessionIds?: unknown }).sessionIds
  if (!Array.isArray(ids)) return { ok: false, error: 'sessionIds must be an array' }
  if (ids.length > MAX_FORGET_IDS) return { ok: false, error: `at most ${MAX_FORGET_IDS} sessionIds per request` }
  const out: string[] = []
  const seen = new Set<string>()
  for (const id of ids) {
    if (typeof id !== 'string' || id === '') return { ok: false, error: 'sessionIds must be non-empty strings' }
    if (seen.has(id)) continue
    seen.add(id)
    out.push(id)
  }
  return { ok: true, sessionIds: out }
}

export async function handleTeamForget(req: Request): Promise<Response> {
  const authHeader = req.headers.get('authorization') ?? ''
  const bearer = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null
  const minted = await validateIngestToken(bearer)
  if (!minted.ok) {
    return new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401, headers: JSON_HEADERS })
  }

  // readJsonLimited, not req.json(): the route is Bearer-authenticated inside the handler, so it
  // is in AUTH_PUBLIC and the body arrives before any cookie check — an oversized body must be
  // abandoned mid-stream rather than buffered first. `bodyBytes` (1 MiB) is the right cap: 500
  // session ids is ~20 KB, and `ingestBodyBytes` exists for a full-history push, not for this.
  const raw = await readJsonLimited<unknown>(req, LIMITS.bodyBytes)
  if (!raw.ok) return new Response(JSON.stringify({ error: 'invalid body' }), { status: 400, headers: JSON_HEADERS })
  const parsed = parseForgetBody(raw.value)
  if (!parsed.ok) return new Response(JSON.stringify({ error: parsed.error }), { status: 400, headers: JSON_HEADERS })
  if (parsed.sessionIds.length === 0) {
    return new Response(JSON.stringify({ ok: true, deleted: 0, deletedRuns: 0 }), { status: 200, headers: JSON_HEADERS })
  }

  try {
    const col = await getTeamCollection()
    const res = await col.deleteMany({ memberId: minted.memberId, session_id: { $in: parsed.sessionIds } })
    const { deleteMemberWorkflowsBySession } = await import('./team-workflows')
    const deletedRuns = await deleteMemberWorkflowsBySession(minted.memberId, parsed.sessionIds)
    const { triggerSseNotification } = await import('./sse')
    triggerSseNotification()
    return new Response(
      JSON.stringify({ ok: true, deleted: res.deletedCount ?? 0, deletedRuns }),
      { status: 200, headers: JSON_HEADERS },
    )
  } catch (err) {
    // safeError returns { body, logLine } — it is NOT a Response. The client gets a code plus a
    // correlation ref; the message goes to the log and never to the wire.
    const safe = safeError(err, { verbose: PROFILE === 'local' })
    console.warn('[team-forget]', safe.logLine)
    return new Response(JSON.stringify(safe.body), { status: 500, headers: JSON_HEADERS })
  }
}
```

`PROFILE` comes from `./exposure`, the same import every other `safeError` call site in `index.ts` uses.

Check two things against the real code before you write this and adjust rather than guess:
1. **The session id field name in `TeamSessionDoc`** — read `team-store.ts` `toTeamDoc`. If the stored field is not `session_id`, use the stored name. Getting this wrong makes the route return `deleted: 0` forever while reporting success, which the member records as a completed removal.
2. **`triggerSseNotification`'s module** — `team-ingest.ts` already imports it; copy that import exactly.

- [ ] **Step 5: Add `deleteMemberWorkflowsBySession` to `team-workflows.ts`**

Model it on the existing `deleteMemberWorkflows(memberId)` (line ~93) and scope it by both fields — never by `sessionId` alone, or one member's rules change deletes another's runs:

```ts
/** Delete this member's workflow runs for the named sessions. Scoped by memberId AND sessionId:
 *  a run is identified by `org:memberId:runId`, so an unscoped sessionId delete would reach
 *  another member's runs for a session id that happens to collide. Returns the count deleted. */
export async function deleteMemberWorkflowsBySession(memberId: string, sessionIds: string[]): Promise<number> {
  if (sessionIds.length === 0) return 0
  const col = await getWorkflowCollection()
  const res = await col.deleteMany({ memberId, sessionId: { $in: sessionIds } })
  return res.deletedCount ?? 0
}
```

Use the real collection getter and the real field name from that file.

- [ ] **Step 6: Wire the route and the capabilities field**

In `index.ts`, beside the `/api/team/leave` block (~1606):

```ts
    // POST /api/team/forget — a member deletes NAMED sessions of its own (repository sharing
    // rules, §7). Minted-token-only, inside the handler; see team-forget.ts for why there is no
    // legacy branch. Central-only, like every other team ingest route.
    if (url.pathname === '/api/team/forget' && req.method === 'POST') {
      if (!TEAM_CENTRAL) return new Response('Not found', { status: 404, headers: CORS_HEADERS })
      const { handleTeamForget } = await import('./team-forget')
      const res = await handleTeamForget(req)
      return new Response(res.body, { status: res.status, headers: { ...CORS_HEADERS, ...Object.fromEntries(res.headers) } })
    }
```

Copy the exact `TEAM_CENTRAL` guard, CORS spreading and response-rewrapping style from the `/api/team/leave` block immediately above — do not invent a different shape. **Also check `AGENTISTICS_INGEST_ONLY`**: an ingest-only central serves only `POST /api/team/ingest` and 404s everything else. `forget` must be allowed there too, or a machine pushing to a public ingest instance can never withdraw anything; add it to the ingest-only allowlist in `index.ts` right where that check lives, and say so in a comment.

In the `/api/team/policy` handler (~1681), add the field:

```ts
      const { CENTRAL_CAPABILITIES } = await import('./team-capabilities')
      return new Response(JSON.stringify({
        pushIntervalSec: config.pushIntervalSec,
        instanceId,
        capabilities: CENTRAL_CAPABILITIES,
      }), { … })
```

- [ ] **Step 7: `AUTH_PUBLIC` + the gate test**

Add `'/api/team/forget'` to `AUTH_PUBLIC` in `index-routes.ts`, in the "Machine/CI traffic" group, with a one-line comment saying it is Bearer-authenticated inside the handler. Then update the exact-contents assertion in `authz-gate.test.ts`. That test IS the review gate — if it does not fail before you edit it, you added the route to the wrong Set.

- [ ] **Step 8: Run the suite**

Run: `bun test && bun tsc --noEmit`
Expected: PASS.

- [ ] **Step 9: Verify against a real central manually**

Bring up a central (`agentop central up`, or the compose file), mint a machine token in its Machines panel, then:

```bash
# unauthorized without a token
curl -si -X POST localhost:48080/api/team/forget -d '{"sessionIds":["x"]}' | head -1   # expect 401
# authorized, unknown id → idempotent no-op
curl -s -X POST localhost:48080/api/team/forget -H "Authorization: Bearer $TOK" \
  -H 'Content-Type: application/json' -d '{"sessionIds":["does-not-exist"]}'          # {"ok":true,"deleted":0,"deletedRuns":0}
curl -s localhost:48080/api/team/policy                                               # capabilities includes forget.sessions
```

Then push a real session from a member, confirm it is on the central, forget its id, and confirm it is gone **and that the member's `memberStats` document still exists** (that is the §6.2 invariant, and the whole reason the route does not touch it).

- [ ] **Step 10: Commit**

```bash
git add packages/server/server/team-forget.ts packages/server/server/team-forget.test.ts \
        packages/server/server/team-capabilities.ts packages/server/server/team-capabilities.test.ts \
        packages/server/server/team-workflows.ts packages/server/server/index.ts \
        packages/server/server/index-routes.ts packages/server/server/authz-gate.test.ts
git commit -m "feat(central): POST /api/team/forget and advertise capabilities on the policy route"
```

---

### Task 3: the denylist bites on the push path

**Files:**
- Modify: `packages/server/server/team-uploader.ts` (`pushOnceDetailed` ~571; `PushCycleContext` ~388 gains `index`)
- Test: `packages/server/server/team-uploader.test.ts`

**Interfaces:**
- Consumes from `share-rules.ts`: `normalizeDenied`, `hasRestrictions`, `buildPathRepoIndex`, `filterShared`, `sharedSessionIds`, `filterSharedWorkflows`, `attributionBoundary`, `buildSplitStatsCache`; from Task 4 (implemented after this task, so **stub it in this task as an argument**, not an import): the seal ledger.
- Produces: `PushCycleContext.index: PathRepoIndex`; `pushOnceDetailed(conn, ctx, deps)` honouring `conn.deniedRepos`, where `deps.sealed?: DeniedLedger` defaults to `{}`.

**Order inside `pushOnceDetailed` is the whole task.** `filterShared` runs **before** `selectDeltas`. Filtering after would let a denied session into `nextSent`, and a later un-block would then never re-push it — its hash is already recorded as sent (§5.3.1).

- [ ] **Step 1: Write the failing tests**

```ts
// packages/server/server/team-uploader.test.ts — append.
// A local ingest fixture, in the style the rest of this file already uses (real Bun.serve on port
// 0, never a fetch monkey-patch): it records every body it receives so the assertions can be made
// about what actually crossed the wire.
function ingestFixture(): { port: number; bodies: IngestBody[]; stop: () => void } {
  const bodies: IngestBody[] = []
  const server = Bun.serve({
    port: 0,
    async fetch(req) {
      if (new URL(req.url).pathname === '/api/team/policy') {
        return Response.json({ pushIntervalSec: 30, instanceId: 'inst-1', capabilities: ['forget.sessions'] })
      }
      bodies.push(await req.json() as IngestBody)
      return Response.json({ ok: true, count: 0 })
    },
  })
  return { port: server.port, bodies, stop: () => server.stop(true) }
}

describe('pushOnceDetailed with a denylist', () => {
  const claudeSession = (id: string, remote: string, path = `/p/${id}`) =>
    makeSession(id, { git_remote: remote, project_path: path, harness: 'claude' })

  // THE assertion of this task: a denied session must not reach the wire AND must not enter the
  // sent-state. Had it entered, un-blocking the repo later would never re-push it — its hash
  // would already be recorded as sent, and nothing re-derives that.
  it('never sends a denied session and never records it as sent', async () => {
    const fx = ingestFixture()
    const id = randomConnId()
    try {
      const ctx = makeCtx({
        storedSessions: [
          claudeSession('keep', 'github.com/org/pub'),
          claudeSession('hide', 'github.com/org/secret'),
        ],
      })
      await pushOnceDetailed(fakeConn(id, fx.port, { deniedRepos: ['github.com/org/secret'] }), ctx)
      const sentIds = fx.bodies.flatMap(b => b.sessions.map(s => s.session_id))
      expect(sentIds).toEqual(['keep'])
      expect(Object.keys(await loadSentState(id))).toEqual(['keep'])
    } finally {
      fx.stop()
    }
  })

  it('pushes the real statsCache byte-for-byte when the denylist is empty', async () => {
    const fx = ingestFixture()
    const id = randomConnId()
    try {
      const real = { lastComputedDate: '2026-07-01', dailyActivity: [], totalSessions: 0, hourCounts: {} } as unknown as StatsCache
      const ctx = makeCtx({ realStatsCache: real, storedSessions: [claudeSession('a', 'github.com/org/pub')] })
      await pushOnceDetailed(fakeConn(id, fx.port), ctx)
      expect(fx.bodies[0]!.statsCache).toEqual(real)
    } finally {
      fx.stop()
    }
  })

  // hasRestrictions, not a count comparison (R3): a repo blocked before any session exists in it
  // must switch the cache the moment the rule is declared, not when the first session lands.
  // Nothing here is filtered, and the pushed cache must STILL be the split one.
  it('pushes a split statsCache whenever restrictions are declared, even with nothing filtered', async () => {
    const fx = ingestFixture()
    const id = randomConnId()
    try {
      const live = [claudeSession('a', 'github.com/org/pub')]
      const real = buildRealCacheFor(live) // helper: a cache consistent with `live`, watermark in the past
      const ctx = makeCtx({ realStatsCache: real, liveSessions: live, storedSessions: live })
      await pushOnceDetailed(fakeConn(id, fx.port, { deniedRepos: ['github.com/org/never-seen'] }), ctx)
      // With nothing actually denied the split is a NO-OP, so it deep-equals `real` — that is the
      // anchor invariant of buildSplitStatsCache, asserted here on the wire rather than assumed.
      expect(fx.bodies[0]!.statsCache).toEqual(real)
    } finally {
      fx.stop()
    }
  })

  // The refusal path. A missing cache is recoverable; a leaked one is not.
  it('omits statsCache entirely when the split refuses', async () => {
    const fx = ingestFixture()
    const id = randomConnId()
    try {
      // Cold-store signature: a populated cache while the store yields no Claude session.
      const real = { lastComputedDate: '2026-07-01', dailyActivity: [{ date: '2026-06-30', sessionCount: 9, messageCount: 20, toolCallCount: 3 }], totalSessions: 9, hourCounts: { '9': 9 } } as unknown as StatsCache
      const ctx = makeCtx({ realStatsCache: real, liveSessions: [], storedSessions: [] })
      await pushOnceDetailed(fakeConn(id, fx.port, { deniedRepos: ['github.com/org/secret'] }), ctx)
      // Either nothing was pushed at all, or what was pushed carries NO statsCache — never the
      // unsplit one.
      for (const b of fx.bodies) expect(b.statsCache).toBeUndefined()
    } finally {
      fx.stop()
    }
  })

  it('drops a workflow run whose session is denied, and one whose session is unknown locally', async () => {
    const fx = ingestFixture()
    const id = randomConnId()
    try {
      const ctx = makeCtx({
        storedSessions: [claudeSession('keep', 'github.com/org/pub'), claudeSession('hide', 'github.com/org/secret')],
        workflows: [
          { runId: 'r1', sessionId: 'keep', name: 'ok' } as WorkflowRun,
          { runId: 'r2', sessionId: 'hide', name: 'secret-work' } as WorkflowRun,
          { runId: 'r3', sessionId: 'unknown-to-this-machine', name: 'orphan' } as WorkflowRun,
        ],
      })
      await pushOnceDetailed(fakeConn(id, fx.port, { deniedRepos: ['github.com/org/secret'] }), ctx)
      const runIds = fx.bodies.flatMap(b => (b.workflows ?? []).map(r => r.runId))
      expect(runIds).toEqual(['r1'])
    } finally {
      fx.stop()
    }
  })

  // The index is what covers non-Claude sessions: only copilot sets git_remote, so a Codex session
  // in the blocked repo's own directory has no remote of its own to match on.
  it('drops a remote-less session sitting in a denied repo directory', async () => {
    const fx = ingestFixture()
    const id = randomConnId()
    try {
      const ctx = makeCtx({
        storedSessions: [
          makeSession('claude-one', { git_remote: 'github.com/org/secret', project_path: '/work/secret', harness: 'claude' }),
          makeSession('codex-one', { git_remote: '', project_path: '/work/secret', harness: 'codex' }),
        ],
        projects: [{ path: '/work/secret', gitRemote: 'github.com/org/secret' } as ServerProject],
      })
      ctx.index = buildPathRepoIndex(ctx.storedSessions, ctx.projects)
      await pushOnceDetailed(fakeConn(id, fx.port, { deniedRepos: ['github.com/org/secret'] }), ctx)
      expect(fx.bodies.flatMap(b => b.sessions.map(s => s.session_id))).toEqual([])
    } finally {
      fx.stop()
    }
  })
})
```

`buildRealCacheFor(live)` is a new helper you write in this file: build a `StatsCache` whose `dailyActivity` / `dailyModelTokens` / `modelUsage` / `totalSessions` / `hourCounts` are consistent with the sessions passed in and whose `lastComputedDate` precedes their days — i.e. a cache the split treats as fully decomposable. Read `buildSplitStatsCache`'s refusal list in `share-rules.ts` before writing it: an inconsistent fixture makes every one of these tests pass for the wrong reason (a refusal, rather than a correct split).

Write the elided bodies out in full — a `/* … */` in a committed test is a test that asserts nothing. Use the helpers that already exist in that file: `makeSession(id, extra)`, `fakeConn(id, port, extra)`, `makeCtx(overrides)`, `fakeReadPreferences(conn)`, `randomConnId()`, and the file-level `beforeAll`/`afterAll` that point `TEAM_CONN_DIR` at a tmp dir via `__setTeamConnDirForTests` and restore `_origConnDir` afterwards. The existing suite drives real `Bun.serve` fixtures on port 0 rather than stubbing `fetch` — follow that, and do not add a `fetch` monkey-patch beside it. If a helper is missing, add it there; it must not touch the real `~/.agentistics` or `~/.claude`.

- [ ] **Step 2: Run and watch them fail**

Run: `bun test packages/server/server/team-uploader.test.ts -t denylist`
Expected: FAIL — denied sessions currently push.

- [ ] **Step 3: Add `index` to the push context**

In `buildPushContext`, after `projects` is resolved:

```ts
  // Learned from BOTH sources on purpose: only copilot.ts among the non-Claude adapters sets
  // git_remote, and data.ts's backfill runs against the Claude-only array before the harness
  // merge — so the store carries every Codex/Gemini/Kimi/agy session with no remote, permanently.
  // A directory used exclusively by a non-Claude harness has no session to learn from; the
  // project record does. Anything still unresolved lands in NO_REPO_KEY, which is fail-closed.
  const index = buildPathRepoIndex([...liveSessions, ...storedSessions], projects)
```

- [ ] **Step 4: Implement the three filter points in `pushOnceDetailed`**

```ts
    const denied = normalizeDenied(conn.deniedRepos)
    const restricted = hasRestrictions(conn.deniedRepos)

    // BEFORE selectDeltas — see the class doc. A denied session that reached nextSent would be
    // invisible to every later push, so un-blocking the repo would never send it.
    const shared = restricted ? filterShared(ctx.storedSessions, denied, ctx.index) : ctx.storedSessions
    const sent = await loadSentState(conn.id)
    const { toSend, nextSent } = selectDeltas(shared, sent)

    // The DECLARED rule selects the cache, never a count comparison (R3): `filtered.length <
    // all.length` is false on a cold or empty store and would push the real full-history cache
    // with the denied repo's recent days in it.
    let statsCache: StatsCache | undefined
    if (!restricted) {
      statsCache = ctx.realStatsCache ?? undefined
    } else if (ctx.realStatsCache) {
      const boundary = attributionBoundary(ctx.realStatsCache)
      // `liveSessions`, not storedSessions: buildSplitStatsCache requires that `real` was
      // supplemented from the SAME array passed as allStored. Passing the store makes the split
      // refuse and the machine push no cache at all.
      const split = buildSplitStatsCache({
        real: ctx.realStatsCache,
        allStored: ctx.liveSessions,
        shared: restricted ? filterShared(ctx.liveSessions, denied, ctx.index) : ctx.liveSessions,
        boundary,
        sealed: deps.sealed ?? {},
      })
      // null = the split cannot be made faithfully. Push NO cache — never the unsplit one. A
      // missing cache is recoverable; a leaked one is not (§4.4).
      statsCache = split ?? undefined
    }

    // Fail closed: a run whose session is not in the shared set is dropped, INCLUDING one whose
    // session is simply unknown locally. WorkflowRun carries name, phases, agents[].label and
    // totals — task descriptions and cost from the blocked repo.
    const workflows = restricted
      ? filterSharedWorkflows(ctx.workflows, sharedSessionIds(shared))
      : ctx.workflows
```

- [ ] **Step 5: Suppress the activity heartbeat on a restricted connection (§5.3.4)**

An empty-delta cycle today still POSTs, and `notifyDataChanged()` fires on any local session write — including inside a denied repo — so the central gets a request at ~2s resolution every time the user works on hidden work, and `validateIngestToken` stamps `lastSeenAt` on each. Session boundaries, working hours and intensity of the hidden work are reconstructable from request timing alone.

Three changes, each with a comment naming this reason:
1. In `scheduleOnChangeTrigger` (~966): a connection with `hasRestrictions` does not fan out on change.
2. In `pushOnceDetailed`: when `toSend.length === 0`, skip the POST if the statsCache and the filtered workflow set are byte-identical to the last ones pushed for this connection (keep a per-connection `Map<connId, string>` of `sha256` over `JSON.stringify({statsCache, workflows})`; only for restricted connections).
3. In `scheduleConnectionCycle`: ±20% jitter on a restricted connection's periodic delay.

Add a test for (1) and (2) — for (2), two consecutive pushes with nothing changed must produce exactly one POST.

- [ ] **Step 6: Run**

Run: `bun test && bun tsc --noEmit`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/server/server/team-uploader.ts packages/server/server/team-uploader.test.ts
git commit -m "feat(team): filter sessions, workflows and the statsCache per connection denylist"
```

---

### Task 4: rules state, the shrink detector and the seal ledger

**Files:**
- Create: `packages/server/server/team-rules.ts`
- Create: `packages/server/server/team-rules.test.ts`
- Modify: `packages/server/server/team-uploader.ts` (`runConnectionPushCycle` ~823, `fetchCentralPolicy` ~724)

**Interfaces:**
- Consumes: `deniedSessionIds`, `denialSignature`, `deniedDeltaByDay`, `advanceSeal`, `attributionBoundary`, `sharedSessionIds` (`share-rules.ts`); `teamRulesFile(connId)` (`config.ts`); `parseCapabilities`, `centralCanForget` (Task 2).
- Produces:

```ts
export interface RulesState {
  rulesHash: string
  sharedIds: string[]
  boundary: string | null
  sealed: DeniedLedger
  pending: DeniedLedger
}
export function emptyRulesState(): RulesState
export async function loadRulesState(connId: string): Promise<RulesState>
export async function saveRulesState(connId: string, state: RulesState): Promise<void>

export interface RulesPlan {
  /** ids the central holds and may no longer have — the forget payload. Never "absent" ids. */
  forgetIds: string[]
  forgetRuns: string[]
  /** what to persist AFTER a successful push. */
  next: RulesState
  /** true when the denylist changed since the last persisted state. */
  rulesChanged: boolean
}
export function planRulesReconcile(input: {
  deniedRepos: readonly string[] | undefined
  sentHashes: Readonly<Record<string, string>>
  sentRunIds: readonly string[]
  storedSessions: readonly SessionMeta[]
  liveSessions: readonly SessionMeta[]
  workflows: readonly WorkflowRun[]
  index?: PathRepoIndex
  real: StatsCache | null
  prev: RulesState
}): RulesPlan
```

`planRulesReconcile` is **pure** and is the whole decision. Two rules it must encode, both of which cost real data if inverted:

1. **The trigger is DENIAL, never ABSENCE.** `forgetIds = keys(sentHashes) ∩ deniedSessionIds(...)`. An earlier draft used "sent keys not in sharedIds", which reads "the session is no longer in the store" as "the session became denied" — and `loadConsolidated` swallows every error and returns empty. That version asks the central to delete valid sessions and drops them from the sent-state: silent, permanent, one-directional loss. As a second belt, **return an empty plan whenever `storedSessions.length === 0`.**
2. **A missing `rulesHash` counts as `denialSignature([])`.** Treating `undefined !== denialSignature([])` as a change makes the whole fleet run a removal against its central on upgrade day, simultaneously.

- [ ] **Step 1: Write the failing tests**

```ts
// packages/server/server/team-rules.test.ts
import { describe, it, expect } from 'bun:test'
import { planRulesReconcile, emptyRulesState } from './team-rules'
import { denialSignature } from './share-rules'

const s = (id: string, remote: string): SessionMeta => ({
  session_id: id, project_path: `/p/${id}`, git_remote: remote,
  start_time: '2026-07-20T10:00:00.000Z', harness: 'claude',
} as SessionMeta)

const base = {
  sentRunIds: [] as string[], workflows: [] as WorkflowRun[],
  real: { lastComputedDate: '2026-07-01', dailyActivity: [], totalSessions: 0, hourCounts: {} } as unknown as StatsCache,
  prev: emptyRulesState(),
}

describe('planRulesReconcile', () => {
  it('asks to forget exactly the sessions that are BOTH sent and denied', () => {
    const sessions = [s('a', 'github.com/o/pub'), s('b', 'github.com/o/secret')]
    const plan = planRulesReconcile({
      ...base, deniedRepos: ['github.com/o/secret'],
      sentHashes: { a: 'h1', b: 'h2' }, storedSessions: sessions, liveSessions: sessions,
    })
    expect(plan.forgetIds).toEqual(['b'])
  })

  // R4, the one that costs data: a session missing from the store is NOT a denied session.
  it('never asks to forget a session that is merely absent from the store', () => {
    const plan = planRulesReconcile({
      ...base, deniedRepos: ['github.com/o/secret'],
      sentHashes: { a: 'h1', gone: 'h2' },
      storedSessions: [s('a', 'github.com/o/pub')], liveSessions: [s('a', 'github.com/o/pub')],
    })
    expect(plan.forgetIds).toEqual([])
  })

  it('returns an empty plan when the store is empty, whatever the denylist says', () => {
    const plan = planRulesReconcile({
      ...base, deniedRepos: ['github.com/o/secret'],
      sentHashes: { a: 'h1' }, storedSessions: [], liveSessions: [],
    })
    expect(plan.forgetIds).toEqual([])
    expect(plan.forgetRuns).toEqual([])
  })

  // R19: upgrade day must not become a fleet-wide removal.
  it('treats a missing rulesHash as "no restrictions", not as a change', () => {
    const plan = planRulesReconcile({
      ...base, deniedRepos: [], sentHashes: {}, storedSessions: [s('a', 'github.com/o/pub')],
      liveSessions: [s('a', 'github.com/o/pub')], prev: { ...emptyRulesState(), rulesHash: '' },
    })
    expect(plan.rulesChanged).toBe(false)
    expect(plan.next.rulesHash).toBe(denialSignature([]))
  })

  it('reports rulesChanged when the denylist changed, and not on a reorder or case variant', () => { /* … */ })

  it('drops a workflow run whose session became denied, from sentRunIds', () => { /* … */ })

  it('seals a day that has crossed the watermark and never re-seals it', () => { /* … */ })
})
```

- [ ] **Step 2: Run and watch it fail.** `bun test packages/server/server/team-rules.test.ts` → module missing.

- [ ] **Step 3: Implement `team-rules.ts`.** Keep `planRulesReconcile` pure; `loadRulesState`/`saveRulesState` are the only impure functions and take the `connId` only. `loadRulesState` uses `safeReadJson` and returns `emptyRulesState()` for anything unreadable — with the same "missing hash means no restrictions" rule.

Why this file is separate from the sent-state and the sync signature: the sig path clears the sent-state on a token rotation or a wiped central. If `rulesHash` and the last shared-id set lived in either file, a rotation coinciding with a rules change would erase the evidence of the change, the detector would evaluate against an empty set, the removal would never run, and previously-pushed denied sessions would stay on a central that was never wiped. Put that paragraph in the module doc.

- [ ] **Step 4: Learn `capabilities` in `fetchCentralPolicy`**

Return `capabilities: string[]` alongside `intervalSec`/`instanceId`/`latencyMs`, via `parseCapabilities`. Store it per connection in a `Map<connId, string[]>` and expose `connectionCanForget(connId): boolean` for Task 6's status route. A failed fetch must **not** clear a previously learned value (same rule the latency cache already follows) — otherwise one flap disables the user's rules editor.

- [ ] **Step 5: Call the reconcile in the cycle, BEFORE the instanceId guard**

In `runConnectionPushCycle`, between `fetchCentralPolicy` and `reconcileSyncState`:

```ts
    // Rules and shrink are LOCAL facts and are evaluated unconditionally, before anything that
    // depends on the central's identity. `reconcileSyncState` opens with `if (!instanceId) return`
    // and `fetchCentralPolicy` reports a null instanceId for every non-OK response, parse failure,
    // timeout and every AGENTISTICS_INGEST_ONLY central (which 404s /api/team/policy by
    // construction) — so putting the rules check behind that guard would let a user on an older or
    // flaky central block a repo, see a green pill, and have the removal never run (R18).
    const rulesPlan = await reconcileRulesFor(conn, ctx)
```

In this task `reconcileRulesFor` only computes, persists the seal, and returns the plan; **Task 5** performs the removal. Log a single line when `forgetIds.length > 0` naming the connection and the count, so the sequence is observable before its implementation lands.

- [ ] **Step 6: Run.** `bun test && bun tsc --noEmit` → PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/server/server/team-rules.ts packages/server/server/team-rules.test.ts \
        packages/server/server/team-uploader.ts
git commit -m "feat(team): per-connection rules state, the denial-based shrink detector and the seal ledger"
```

---

### Task 5: the removal sequence and its journal

**Files:**
- Create: `packages/server/server/team-forget-client.ts`
- Create: `packages/server/server/team-forget-client.test.ts`
- Modify: `packages/server/server/team-uploader.ts` (call it from the cycle; boot replay in `startUploader`)

**Interfaces:**
- Produces:

```ts
export interface ForgetJournal {
  state: 'forgetting'
  ids: string[]
  runIds: string[]
  rulesHash: string
  startedAt: string
}
/** Pure: split into ≤500-id batches. */
export function planForgetBatches(ids: readonly string[], size?: number): string[][]
/** Pure: what a journal found at boot means. */
export function decideJournalResume(raw: unknown): { resume: true; journal: ForgetJournal } | { resume: false }
/** The sequence. Returns how many ids the central acknowledged deleting. */
export async function runForgetSequence(
  conn: TeamConnection,
  plan: { forgetIds: string[]; forgetRuns: string[]; rulesHash: string },
  deps?: ForgetDeps,
): Promise<{ ok: boolean; deleted: number; error?: string }>
```

`ForgetDeps` injects `fetch`, `loadSentState`/`saveSentState` and the journal path so the whole sequence is testable without a central and without touching the real state dir.

**The five steps and why their order is load-bearing** (§6.1) — put this in the module doc:

```
0. capability + identity: connectionCanForget(conn.id) AND GET /api/team/whoami == ok
1. ids from the plan (already computed by Task 4 as deniedSessionIds ∩ sent)
2. write the journal FIRST
3. POST /api/team/forget in batches of 500, Bearer <token>
   → require 200 AND body.ok === true; drop each ACKED batch from the sent-state
4. push the rebuilt split statsCache in the SAME cycle
5. delete the journal; write the sync + rules files
```

- **whoami before the forget.** `handleTeamLeave`'s two branches both answer `{ok:true,deleted:N}`, so a member cannot tell which identity a central acted on; on a wiped or restored central, one machine's rules change could delete every machine of the same person. `whoami` is minted-token-only, so an `ok` immediately before the call is the member-side proof. Anything else aborts with `pendingRules: true`.
- **Assert on the body, not on `res.ok`.** A reverse proxy in front of a central can turn a JSON 404 into a 200 HTML page, which the journal would read as a successful delete.
- **Journal before the first batch.** A process dying mid-sequence leaves some ids deleted and some not, and nothing else would notice — the sig did not change, so no re-push is triggered.
- **Advance the sent-state per ACK, never up front.** An id dropped before the central confirmed would be re-pushed by the next delta pass and silently restored.
- **Hold the per-connection push lock for the whole sequence,** with `pendingTrigger` so events arriving during it are deferred, not dropped. Without it, a `notifyDataChanged`-debounced push already in flight can land after the delete and re-insert exactly the documents just removed — and since they are no longer in the sent-state, nothing would ever remove them again (R27, the worst race in the design).
- **401/403 → `removeConnection(connId, 'revoked')`. Never widen the delete.**

- [ ] **Step 1: Write the failing tests**

```ts
describe('planForgetBatches', () => {
  it('splits into batches of at most 500 and preserves order', () => { /* 1200 ids → [500,500,200] */ })
  it('returns [] for no ids', () => { expect(planForgetBatches([])).toEqual([]) })
})

describe('runForgetSequence', () => {
  it('writes the journal BEFORE the first POST', async () => { /* record the order of journal-write vs fetch */ })

  it('drops only ACKED batches from the sent-state', async () => {
    // batch 1 → {ok:true}; batch 2 → network error.
    // Expect: batch 1's ids gone from the sent-state, batch 2's ids STILL there, journal still open.
  })

  // A proxy answering 200 with HTML must not read as a successful delete.
  it('treats a 200 whose body is not {ok:true} as a failure', async () => { /* … */ })

  it('aborts without deleting anything when whoami fails', async () => { /* zero forget POSTs */ })

  it('removes the connection on 401 and does not widen the delete', async () => { /* … */ })

  it('deletes the journal only after the sequence completes', async () => { /* … */ })
})

describe('decideJournalResume', () => {
  it('resumes a well-formed forgetting journal', () => { /* … */ })
  it('refuses junk, a wrong state and a non-array ids field', () => { /* … */ })
})
```

- [ ] **Step 2: Run and watch it fail.**

- [ ] **Step 3: Implement `team-forget-client.ts`.**

- [ ] **Step 4: Call it from the cycle.** In `runConnectionPushCycle`, when `rulesPlan.forgetIds.length > 0 || rulesPlan.forgetRuns.length > 0`, run the sequence before the push, then let the normal `pushOnceDetailed` deliver the rebuilt cache in the same cycle. Persist `rulesPlan.next` **only after** the push succeeds.

- [ ] **Step 5: Boot replay.** In `startUploader()`, for each connection, read the journal via `decideJournalResume` and queue a resume. Deleting an already-deleted id returns `deleted: 0`, so a replay is a no-op — say that in the comment so nobody "optimizes" the replay away.

- [ ] **Step 5b: a sig mismatch on a RESTRICTED connection runs the forget FIRST (§5.5b)**

`reconcileSyncState` clears the sent-state on a sig change and lets the next push re-send everything. On a restricted connection that order is destructive: a token rotation changes the sig **without deleting anything on the central**, and the sent-state is the only record of what was pushed — clearing it first strands every already-pushed denied session there with no way left to name it.

So: when `hasRestrictions(conn.deniedRepos)` and the sig differs, run the removal sequence against the **current** sent-state before clearing it. Against a genuinely wiped central that same forget is a harmless no-op (`deleted: 0`), which is why one order is safe in both cases and the code never has to distinguish a rotation from a wipe. Add a test: sig changed + a denied session in the sent-state → a forget POST is issued **before** the sent-state is cleared.

- [ ] **Step 6: Expose progress for the UI.** A `Map<connId, {phase:'forget'|'push'; done:number; total:number}>` plus `getResyncProgress(connId)`, consumed by Task 6's status route. Emit `member.resync_started` / `member.resync_done` notifications with `meta: { central, count, connectionId }`.

- [ ] **Step 7: Run.** `bun test && bun tsc --noEmit` → PASS.

- [ ] **Step 8: Commit**

```bash
git add packages/server/server/team-forget-client.ts packages/server/server/team-forget-client.test.ts \
        packages/server/server/team-uploader.ts
git commit -m "feat(team): the journalled retroactive removal sequence"
```

---

### Task 6: the routes the UI will talk to

**Files:**
- Modify: `packages/server/server/team-connections.ts` (`PatchBody` ~70, `handlePatchConnection` ~314, `ConnectionBody` ~45, `handleAddConnection` ~296, `ConnectionStatusEntry` ~450, `handleTeamStatus` ~503)
- Test: `packages/server/server/team-connections.test.ts`

**Interfaces:**
- `PatchBody` gains `deniedRepos?: string[]`; `ConnectionBody` gains `deniedRepos?: string[]`.
- `ConnectionStatusEntry` gains `deniedCount: number`, `restricted: boolean`, `boundary: string | null`, `prehistorySessions: number | null`, `canForget: boolean`, `centralTooOld: boolean`, `resync: {phase,done,total} | null`, `pendingRules: boolean`.

Rules:
- **`withUnresolvedDenied` is applied on the zero→non-zero transition** and the result is what gets **persisted** — `NO_REPO_KEY` is written into the list, rendered pre-blocked, and only an explicit user toggle removes it. The persisted list stays the single authority on behaviour; no hidden runtime rule may contradict what the card shows (§4.2).
- **`deniedRepos` never leaves the machine.** The status route exposes `deniedCount` only; the full list comes from `GET /api/preferences`, same-origin.
- **`POST /api/team/connections` accepts `deniedRepos` and does not start the timer, the socket or a push until that body is committed** (R10) — otherwise adding a central pushes the entire unfiltered history before the user can restrict anything, turning §6.4's strong guarantee into its weak one for every user.
- A `deniedRepos` PATCH returns `{ ok, queued? }` and triggers the cycle; it must never orchestrate the delete from the browser (a tab closing mid-sequence would leave the journal with no client to resume it).

- [ ] **Step 1: Write the failing tests** for the pure body validation (`deniedRepos` must be an array of strings; junk → 400; the zero→non-zero transition adds `NO_REPO_KEY`; applying it twice is idempotent; an explicit list without `NO_REPO_KEY` on an already-restricted connection is honoured as-is) and for the status entry shape (a connection with no cycle yet reports `restricted` from its stored list, not from uploader state).
- [ ] **Step 2: Run and watch them fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `bun test && bun tsc --noEmit`.
- [ ] **Step 5: Manual verification against two mock centrals** — the §12 integration checks 5, 6, 7, 7a, 9, 9a, 10, 11, 12, 13. In particular **7 (crash replay)**: `kill -9` between two acked batches, restart, and confirm the journal replays the remainder, the already-deleted ids answer `deleted: 0`, and the connection ends in the same state as an uninterrupted run; **7a (no window)**: while a removal runs on a central with several machines, poll a *different* machine's machine-filter totals every 200 ms and confirm they never change and `machineStatsCaches` never loses an entry; **9 (old central)**: point a connection at a central without `forget.sessions` and confirm `centralTooOld`, no purge attempted, and no sent-state clearing loop. Then the rest: block a repo on B only and confirm A's totals are untouched while B loses exactly that repo's sessions and its totals drop by exactly its attributable contribution; add C with a repo blocked in the body and confirm the central never receives one document from it; block while B is stopped and confirm `pendingRules` rather than a false success; un-block and confirm **no** forget is issued; make `loadConsolidated` return empty for one cycle and confirm no forget and no zero cache.
- [ ] **Step 6: Commit**

```bash
git add packages/server/server/team-connections.ts packages/server/server/team-connections.test.ts
git commit -m "feat(team): deniedRepos on the connection routes and the honesty markers on status"
```

---

### Task 7: Phase A documentation

**Files:** `docs/architecture.md`, `docs/security.md`, `CLAUDE.md`, `docs/superpowers/plans/…/progress.md`

- [ ] **Step 1:** Document the feature in `docs/architecture.md` (the three layers, the attribution split, the forget sequence) and the **guarantee, stated precisely** in `docs/security.md` — verbatim from §6.4, including all five non-guarantees. A privacy feature whose limits are only in a spec file is a privacy feature users will misread.
- [ ] **Step 2:** Add to `CLAUDE.md`'s team-mode rules: the denylist never goes on the wire; the split is selected by the declared rule; no fallback to the unsplit cache; the forget trigger is denial, never absence; `stats-cache.json` stays Claude-only here too.
- [ ] **Step 3:** Commit `docs(team): per-connection repository sharing rules`.

---

# PHASE B — the web UI

Phase B is not started until Phase A is merged to `dev`. Every task here carries its mobile branch; a task without it is not complete (CLAUDE.md).

**Phase B tasks below are specified at contract level, not step level, and that is deliberate.** Their behaviour is fully pinned by spec §9.1–§9.8 (component list, per-card state table, copy table, mobile gate) and by Task 8's pure module, but the component code cannot be written honestly in advance of the primitives it composes. **Each Phase B task gets its own full brief — failing test first, code, mobile check — written immediately before it is dispatched**, the same way Plan 2's tasks were. A subagent must not be handed Task 10 as it stands here.

---

### Task 8: `lib/shareRepos.ts` — the pure projection

**Files:** Create `packages/web/src/lib/shareRepos.ts` + `shareRepos.test.ts`.

**Interfaces:** exactly the block in §9.3 — `ShareTarget`, `buildShareTargets(sessions, projects, deniedKeys)`, `countDenied`, `hostOf`, `plural`.

The source is **`ctx.data.sessions` (unfiltered) plus `ctx.data.projects`**, never `ctx.derived.repoStats`: that map is built from `filteredSessions`, so an active date or project filter would silently shrink the list of things you can block — a privacy control whose shape changes with a dashboard filter is a bug.

- [ ] **Step 1:** Write the failing tests — §12's items 55–63, verbatim as behaviours: one `kind:'none'` entry regardless of how many remote-less folders exist; case/alias variants collapse into one row whose `sessions` is the sum; sorted sessions-desc then name with the none bucket obeying the same rule; a denied key with zero sessions is `orphan: true`; a `kind:'none'` entry with zero sessions and not denied is omitted; a path seen with two remotes surfaces as `conflictPaths` on both rows; `hostOf` returns the host for a URL, the raw string for junk and `'—'` for `''` and **never throws**; `plural` picks `one` at 1 and `other` at 0 and 2 in both languages.
- [ ] **Step 2:** Run, watch fail. **Step 3:** Implement. **Step 4:** Run, pass.
- [ ] **Step 5:** Commit `feat(web): pure share-target projection for the repo rules picker`.

---

### Task 9: primitives and copy

**Files:** Modify `packages/web/src/pages/settings/primitives.tsx`; create `packages/web/src/components/team/copy.ts`; modify `packages/web/src/index.css`.

- [ ] **Step 1:** Move `FieldInput` into `primitives.tsx` and give it `fontSize: isMobile ? 16 : 13`. Its current hardcoded 13 zooms iOS Safari on focus and breaks the sticky settings header.
- [ ] **Step 2:** Add `RowSwitch` — the **row** is the only `<button>` (`minHeight: 48`, `width: 100%`, `role="switch"`, `aria-checked`, `aria-label`), the switch visual is a `<span aria-hidden>`. Reason, in a comment: `.ag-settings button { min-height: 44px }` deforms the existing `Toggle` (34×20 with a knob at `top:3`) into 34×44 with the knob in the top third, and "the whole row is the tap target" plus a nested `Toggle` would be a `<button>` inside a `<button>`.
- [ ] **Step 3:** Add `.ag-settings button.ag-switch { min-height: 0 }` to `index.css` and the `ag-switch` class to the existing `Toggle`, un-deforming `LiveSettings` / `PreferencesSettings`.
- [ ] **Step 4:** Create `copy.ts` with the EN/PT table **copied verbatim from spec §9.8** (all 60+ keys) plus the two-line `plural()` helper. `{one, other}` entries exist because a naive `{n}` template reads "1 bloqueados" / "1 sessões" throughout PT.
- [ ] **Step 5:** Commit `feat(web): settings primitives and copy for the connection panel`.

---

### Task 10: the card list — `ConnectionsPanel`, `ConnectionCard`, `ConnectionIdentity`, `CentralAdminPanel`

**Files:** create `packages/web/src/components/team/{ConnectionsPanel,ConnectionCard,ConnectionIdentity,CentralAdminPanel,ConnectionStatusPill}.tsx`; rewrite `packages/web/src/pages/settings/ConnectionSettings.tsx`; **delete** `packages/web/src/components/TeamSettings.tsx`; fix its second call site in `MachinesSettings.tsx` (`SoloMemberMachinesView` — the easily-missed one).

Contracts are §9.2 exactly. The load-bearing details:
- **One** `GET /api/team/status` poll every 5s for the whole panel, sliced per card — N cards must not mean N pollers.
- `hostOf` everywhere, never a bare `new URL()` in a `.map`: one hand-edited endpoint would take down the whole page including the Disconnect that fixes it. A connection whose endpoint will not parse renders a `brokenConn` card offering only Disconnect.
- `ConnectionIdentity` probes **on expand**, not on mount for all N — an offline central would otherwise block the list behind N timeouts.
- Endpoint and token are **not editable in place**; this is what deletes the `editing`/`userTouched`/`editingInitialized` ref machinery, the most fragile part of the old file.
- Two connections resolving to the same host promote `identity.user` into the label (`acme:48080 · lucas`).
- Mobile: card list is a plain vertical stack (`gap: 10`), **not** `.ag-grid` — a 2-col grid of expanding accordions reflows the neighbour. Header `flex-wrap`s to a second line; chevron 20px inside a 44px hit box.

- [ ] Steps: render tests for the per-card state table (§9.5, all twelve rows) → implement → delete `TeamSettings.tsx` and fix both call sites → verify at 390px → commit `feat(web): per-connection settings cards`.

---

### Task 11: `SharedReposPanel` — the denylist editor

Per §9.4 and §9.7. Non-negotiables: one polarity (shared-positive) everywhere except the card's `{n} hidden` pill, which carries an explicit verb and an `EyeOff` icon; **explicit Save, never per-toggle** (each apply is a delete round-trip plus a cache push against a live central); the live `applyImpact` line above Save and repeated in the confirm; `applyConfirmStats` (and `applyConfirmStatsProven` when the store proves a blocked repo has pre-boundary sessions) shown **before** the commit; **one** `PATCH` call and no client-side orchestration; the progress strip driven by `status.resync` with `applyingSafeToLeave`; an error keeps the draft in edit mode; `applyQueued` on an offline apply — never a success.

Also rendered by this panel, because a rule the user believes covers everything must say where it does not: `ciNote` whenever any repo is blocked (a machine denylist does not hide a repo that also pushes from GitHub Actions — CI sessions are stamped server-side under a different `memberId`), and `otelWarn` when OTel export is on and any repo is blocked (the exporter sends unfiltered totals and no denylist covers it; the export itself is unchanged — §5.3.7).

Mobile: the `maxHeight: 360, overflowY: auto` list cap is **desktop only**; on mobile the list grows and the page scrolls, capped by a `showAllRepos` disclosure after 12 rows.

- [ ] Steps: tests for the pure bits (grouping, search, the impact number, the confirm-variant choice) → implement → 390px verification → commit.

---

### Task 12: `AddCentralDrawer` — rules are step 2

Per §9.2. **The wizard's second step is the repo rules, and the connection is not created until that body is committed** — deferring the picker to after the connection exists would push the entire unfiltered history of every repo first, converting the safe case into the weak one for every user. Pass `dirty={!!token || !!endpoint || rulesTouched}` to the existing `Drawer` so a backdrop tap on a full-screen mobile drawer cannot silently discard a pasted 200-char token.

- [ ] Steps: tests → implement → 390px (both steps) → commit.

---

### Task 13: beyond Settings — repo badges, the aggregate pill, notifications

Per §9.6. `deniedRepos` is local and same-origin, so the web app reads it for free: lift `Map<repoKey, connectionLabel[]>` into `AppContext` beside `isMember`, and render the `hiddenFromN` `EyeOff` badge on `RepositoriesList` cards and the `RepoDetailPage` header, linking to `/settings/connection`. Make `MemberConnectionStatus` an aggregate over `status.connections`, worst-status-wins — 1 connection keeps today's exact string. Add `member.resync_started` / `member.resync_done` to `NOTIFICATION_TEXT` (EN+PT) and **include `meta.connectionId` in the store's dedupe key**, or "central A unreachable" and "central B unreachable" collapse into one toast and A's recovery clears B's badge.

- [ ] Steps: tests for the aggregate reducer and the dedupe key → implement → mobile check on the repo cards (one extra `fields` row on the existing `RecordCard`) → commit.

---

### Task 14: the mobile verification gate and the docs

- [ ] **Step 1:** Walk §9.7's seven states at 390px on `/settings/connection` and assert `document.documentElement.scrollWidth <= window.innerWidth` in each: (a) 0 connections; (b) 3 connections, one expanded; (c) the repo panel in edit mode with a 60-char remote; (d) the drawer on step 1 and step 2; (e) the read view with 5 blocked repos, longest remote 60 chars; (f) the resync strip active; (g) the Disconnect confirm with `requireText` open. Plus a real-device check that no input zooms on focus and that the repo list scrolls the page, not a nested container.
- [ ] **Step 2:** Document the UI and the two product caveats that are copy, not code — a machine denylist does **not** hide a repo that also pushes via GitHub Actions (`ciNote`), and presence cannot be filtered.
- [ ] **Step 3:** Commit.

---

## Self-review notes (gaps deliberately left)

- **§5.4's `runIds` in the sent-state** is written by Task 5 and read by Task 4's `forgetRuns`. `saveSentState` already preserves the field (Plan 2), so no migration is needed.
- **§9.1's file-size targets** (`~190`, `~210`…) are indicative, not requirements.
- **`/api/preferences` token redaction and origin-echo CORS (§5.8, R24)** are NOT in this plan: they landed in Plan 2. Verify before Task 6 that `GET /api/preferences` still redacts `connections[].token`; if it does not, that is a security regression and it takes priority over everything here.
- **The `data.ts` `backfillGitRemote` reorder** stays out of scope (§13) — `buildPathRepoIndex` seeded from projects plus the fail-closed unattributed bucket closes the leak from the push side. It is the first thing to do after this ships.
