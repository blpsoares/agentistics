# Team Mode — Phase 2a: Central Mongo source + ingestion API Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn an agentistics instance into a "central aggregator": it stores per-session metrics in MongoDB, accepts pushed sessions over `POST /api/team/ingest`, serves the dashboard sourced from Mongo (preserving the Phase 1 `user` dimension), and pushes live updates to the director's browser via a Mongo change-stream → the existing SSE channel.

**Architecture:** A thin lazy Mongo client (`mongo.ts`) plus pure doc-mapping helpers (`team-store.ts`) keep all Mongo specifics in two small modules. The ingest endpoint validates a JSON body and upserts session docs keyed by `org:user:harness:sessionId` (idempotent). When `AGENTISTICS_TEAM_CENTRAL=1`, `data.ts` reads team sessions from Mongo (via `fromTeamDoc`) instead of the Phase 1 folder. A change-stream watcher calls the existing `triggerSseNotification()` on any insert/update, with a polling fallback for Mongo deployments without a replica set. The Phase 1 folder transport and Solo mode are untouched.

**Tech Stack:** Bun, TypeScript (strict), `mongodb` official Node driver (works under Bun), `bun test`. Server package `@agentistics/server`.

## Global Constraints

- Everything in English: code, comments, commit messages.
- Conventional Commits; pre-commit hook runs `bun tsc --noEmit` + `bun test` — every commit must pass both.
- TypeScript strict — no `any` (the `mongodb` driver is fully typed; type the collection as `Collection<TeamSessionDoc>`).
- `packages/server/server/*` modules are server-only — never imported from `packages/web/src/`.
- Do NOT mock the filesystem or the database (project rule). Pure functions are unit-tested with `bun:test`; Mongo I/O paths are verified by the manual smoke tests in each task using a local Mongo (`docker run`), not by mocking.
- Reuse `@agentistics/core` helpers (`tagUser`); never inline pricing/calculations.
- Reuse the existing SSE primitive `triggerSseNotification()` from `sse.ts` — do NOT build a second broadcast path.
- Additive + backward-compatible: Solo mode and the Phase 1 folder transport (`AGENTISTICS_TEAM=1`) keep working unchanged. The new behavior is gated on `AGENTISTICS_TEAM_CENTRAL=1` / `MONGO_URL`.

---

## File Structure

**Created:**
- `packages/server/server/mongo.ts` — lazy Mongo client singleton + typed collection accessors (I/O; not unit-tested).
- `packages/server/server/team-store.ts` — pure doc-mapping + payload validation: `teamDocId`, `toTeamDoc`, `fromTeamDoc`, `parseIngestBody`, `TeamSessionDoc`, `IngestBody`.
- `packages/server/server/team-store.test.ts` — unit tests for the pure helpers above.
- `packages/server/server/team-ingest.ts` — `ingestSessions()` upsert (I/O) + the route handler body (`handleTeamIngest`).
- `packages/server/server/team-watch.ts` — `startTeamWatch()` change-stream → SSE, with polling fallback (I/O).

**Modified:**
- `packages/server/package.json` — add the `mongodb` dependency.
- `packages/server/server/config.ts` — add `MONGO_URL`, `MONGO_DB`, `TEAM_CENTRAL`, `TEAM_ORG`, `TEAM_INGEST_TOKEN`.
- `packages/server/server/team-source.ts` — add `loadTeamSessionsFromMongo()` (reads Mongo, maps `fromTeamDoc`).
- `packages/server/server/data.ts` — in the `if (TEAM_MODE)` area, read from Mongo when `TEAM_CENTRAL` (else keep the folder path), and fold team sessions into `statsCache` so unfiltered central totals are non-zero (Task 5).
- `packages/server/server/index.ts` — register `POST /api/team/ingest` (before the non-`/api` fallback at ~line 710); start `startTeamWatch()` on boot when `TEAM_CENTRAL`.

---

## Task 1: Mongo dependency, config, client, and pure doc helpers

**Files:**
- Modify: `packages/server/package.json`
- Modify: `packages/server/server/config.ts` (after line 33)
- Create: `packages/server/server/mongo.ts`
- Create: `packages/server/server/team-store.ts`
- Test: `packages/server/server/team-store.test.ts`

**Interfaces:**
- Consumes: `tagUser` from `@agentistics/core`; `SessionMeta` type.
- Produces:
  - Config: `MONGO_URL: string`, `MONGO_DB: string`, `TEAM_CENTRAL: boolean`, `TEAM_ORG: string`, `TEAM_INGEST_TOKEN: string | undefined`.
  - `TeamSessionDoc = SessionMeta & { _id: string; org: string; user: string }`
  - `teamDocId(org: string, user: string, harness: string, sessionId: string): string`
  - `toTeamDoc(session: SessionMeta, org: string, user: string): TeamSessionDoc`
  - `fromTeamDoc(doc: TeamSessionDoc): SessionMeta`
  - `IngestBody = { org: string; user: string; sessions: SessionMeta[] }`
  - `parseIngestBody(raw: unknown): { ok: true; body: IngestBody } | { ok: false; error: string }`
  - `mongo.ts`: `getMongoDb(): Promise<Db>`, `getTeamCollection(): Promise<Collection<TeamSessionDoc>>`, `closeMongo(): Promise<void>`

- [ ] **Step 1: Add the `mongodb` dependency**

In `packages/server/package.json`, add `mongodb` to `dependencies` (alongside `@agentistics/core`):

```json
  "dependencies": {
    "@agentistics/core": "workspace:*",
    "mongodb": "^6.12.0"
  }
```

Then install:

Run: `bun install`
Expected: `mongodb` added, no errors.

- [ ] **Step 2: Add config constants**

In `packages/server/server/config.ts`, after the Phase 1 team vars (line 33, `TEAM_DIR`), add:

```ts
// Phase 2 — central aggregator. When AGENTISTICS_TEAM_CENTRAL=1 the instance
// sources team sessions from MongoDB (not the folder) and accepts pushed
// sessions on POST /api/team/ingest. MONGO_URL/MONGO_DB point at the store;
// TEAM_ORG namespaces docs; TEAM_INGEST_TOKEN (optional) gates ingestion.
export const TEAM_CENTRAL = process.env.AGENTISTICS_TEAM_CENTRAL === '1'
export const MONGO_URL = process.env.MONGO_URL ?? 'mongodb://localhost:27017'
export const MONGO_DB = process.env.MONGO_DB ?? 'agentistics'
export const TEAM_ORG = process.env.AGENTISTICS_TEAM_ORG ?? 'default'
export const TEAM_INGEST_TOKEN = process.env.AGENTISTICS_TEAM_INGEST_TOKEN || undefined
```

- [ ] **Step 3: Write the failing test for the pure helpers**

Create `packages/server/server/team-store.test.ts`:

```ts
import { test, expect } from 'bun:test'
import type { SessionMeta } from '@agentistics/core'
import { teamDocId, toTeamDoc, fromTeamDoc, parseIngestBody } from './team-store'

function session(id: string, harness: SessionMeta['harness'] = 'claude'): SessionMeta {
  return {
    session_id: id, project_path: '/p', start_time: '2026-06-01T00:00:00Z',
    duration_minutes: 0, user_message_count: 0, assistant_message_count: 0,
    tool_counts: {}, tool_output_tokens: {}, agent_file_reads: {}, languages: [],
    git_commits: 0, git_pushes: 0, input_tokens: 0, output_tokens: 0,
    first_prompt: '', user_interruptions: 0, user_response_times: [],
    tool_errors: 0, tool_error_categories: {}, uses_task_agent: false,
    uses_mcp: false, uses_web_search: false, uses_web_fetch: false,
    lines_added: 0, lines_removed: 0, files_modified: 0, message_hours: [],
    user_message_timestamps: [], harness,
  }
}

test('teamDocId composes org:user:harness:sessionId', () => {
  expect(teamDocId('acme', 'devA', 'claude', 's1')).toBe('acme:devA:claude:s1')
})

test('toTeamDoc tags user, sets org and _id, does not mutate input', () => {
  const s = session('s1')
  const doc = toTeamDoc(s, 'acme', 'devA')
  expect(doc._id).toBe('acme:devA:claude:s1')
  expect(doc.org).toBe('acme')
  expect(doc.user).toBe('devA')
  expect(doc.session_id).toBe('s1')
  expect(s.user).toBeUndefined() // original untouched
})

test('fromTeamDoc strips _id/org but keeps user → a plain SessionMeta', () => {
  const doc = toTeamDoc(session('s1'), 'acme', 'devA')
  const meta = fromTeamDoc(doc)
  expect((meta as Record<string, unknown>)._id).toBeUndefined()
  expect((meta as Record<string, unknown>).org).toBeUndefined()
  expect(meta.user).toBe('devA')
  expect(meta.session_id).toBe('s1')
})

test('round-trip toTeamDoc→fromTeamDoc preserves the session fields', () => {
  const s = session('s1')
  const meta = fromTeamDoc(toTeamDoc(s, 'acme', 'devA'))
  expect(meta.session_id).toBe(s.session_id)
  expect(meta.harness).toBe(s.harness)
  expect(meta.project_path).toBe(s.project_path)
})

test('parseIngestBody accepts a valid body', () => {
  const raw = { org: 'acme', user: 'devA', sessions: [session('s1')] }
  const r = parseIngestBody(raw)
  expect(r.ok).toBe(true)
  if (r.ok) {
    expect(r.body.user).toBe('devA')
    expect(r.body.sessions).toHaveLength(1)
  }
})

test('parseIngestBody rejects missing user', () => {
  const r = parseIngestBody({ org: 'acme', sessions: [] })
  expect(r.ok).toBe(false)
})

test('parseIngestBody rejects a non-array sessions field', () => {
  const r = parseIngestBody({ org: 'acme', user: 'devA', sessions: 'nope' })
  expect(r.ok).toBe(false)
})

test('parseIngestBody rejects a session without a session_id', () => {
  const r = parseIngestBody({ org: 'acme', user: 'devA', sessions: [{ harness: 'claude' }] })
  expect(r.ok).toBe(false)
})
```

- [ ] **Step 4: Run the test to verify it fails**

Run: `bun test packages/server/server/team-store.test.ts`
Expected: FAIL — `Cannot find module './team-store'`.

- [ ] **Step 5: Implement the pure helpers**

Create `packages/server/server/team-store.ts`:

```ts
import type { SessionMeta } from '@agentistics/core'
import { tagUser } from '@agentistics/core'

/** A team session as stored in Mongo: the SessionMeta plus identity + a stable _id. */
export type TeamSessionDoc = SessionMeta & { _id: string; org: string; user: string }

export interface IngestBody {
  org: string
  user: string
  sessions: SessionMeta[]
}

/** Stable, collision-safe Mongo _id. Mirrors the data.ts dedup key shape. */
export function teamDocId(org: string, user: string, harness: string, sessionId: string): string {
  return `${org}:${user}:${harness}:${sessionId}`
}

/** Map a SessionMeta + identity to a Mongo doc. Pure — does not mutate the input. */
export function toTeamDoc(session: SessionMeta, org: string, user: string): TeamSessionDoc {
  const tagged = tagUser(session, user)
  return {
    ...tagged,
    org,
    _id: teamDocId(org, user, tagged.harness ?? 'claude', tagged.session_id),
  }
}

/** Map a Mongo doc back to a plain SessionMeta (drops _id/org, keeps user). Pure. */
export function fromTeamDoc(doc: TeamSessionDoc): SessionMeta {
  const { _id, org, ...rest } = doc
  void _id; void org
  return rest
}

/** Validate an untrusted ingest request body. Pure. */
export function parseIngestBody(raw: unknown):
  | { ok: true; body: IngestBody }
  | { ok: false; error: string } {
  if (typeof raw !== 'object' || raw === null) return { ok: false, error: 'body must be an object' }
  const r = raw as Record<string, unknown>
  if (typeof r.org !== 'string' || !r.org) return { ok: false, error: 'org is required' }
  if (typeof r.user !== 'string' || !r.user) return { ok: false, error: 'user is required' }
  if (!Array.isArray(r.sessions)) return { ok: false, error: 'sessions must be an array' }
  for (const s of r.sessions) {
    if (typeof s !== 'object' || s === null || typeof (s as Record<string, unknown>).session_id !== 'string') {
      return { ok: false, error: 'each session must have a session_id' }
    }
  }
  return { ok: true, body: { org: r.org, user: r.user, sessions: r.sessions as SessionMeta[] } }
}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `bun test packages/server/server/team-store.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 7: Implement the Mongo client**

Create `packages/server/server/mongo.ts`:

```ts
import { MongoClient, type Db, type Collection } from 'mongodb'
import { MONGO_URL, MONGO_DB } from './config'
import type { TeamSessionDoc } from './team-store'

let client: MongoClient | null = null
let db: Db | null = null

/** Lazy singleton Mongo connection. Reused across requests for the process lifetime. */
export async function getMongoDb(): Promise<Db> {
  if (db) return db
  client = new MongoClient(MONGO_URL)
  await client.connect()
  db = client.db(MONGO_DB)
  return db
}

/** The team sessions collection, typed. */
export async function getTeamCollection(): Promise<Collection<TeamSessionDoc>> {
  const database = await getMongoDb()
  return database.collection<TeamSessionDoc>('sessions')
}

/** Close the connection (tests / shutdown). Safe to call when never opened. */
export async function closeMongo(): Promise<void> {
  await client?.close()
  client = null
  db = null
}
```

- [ ] **Step 8: Typecheck**

Run: `bun tsc --noEmit`
Expected: no errors.

- [ ] **Step 9: Commit**

```bash
git add packages/server/package.json packages/server/server/config.ts packages/server/server/mongo.ts packages/server/server/team-store.ts packages/server/server/team-store.test.ts
git commit -m "feat(server): add mongo client, team doc helpers, and central config"
```

---

## Task 2: Ingestion endpoint `POST /api/team/ingest`

**Files:**
- Create: `packages/server/server/team-ingest.ts`
- Modify: `packages/server/server/index.ts` (add route guard before line 710)
- Test: covered by `team-store.test.ts` (validation is pure); upsert verified by manual smoke test

**Interfaces:**
- Consumes: `parseIngestBody`, `toTeamDoc`, `TeamSessionDoc` from `./team-store`; `getTeamCollection` from `./mongo`; `TEAM_INGEST_TOKEN` from `./config`; `CORS_HEADERS` (defined in `index.ts:85`).
- Produces:
  - `ingestSessions(org: string, user: string, sessions: SessionMeta[]): Promise<number>` — upserts each doc, returns the count written.
  - `handleTeamIngest(req: Request): Promise<Response>` — the full route handler (auth check + parse + ingest + JSON response).

- [ ] **Step 1: Implement the ingest module**

Create `packages/server/server/team-ingest.ts`:

```ts
import type { SessionMeta } from '@agentistics/core'
import { getTeamCollection } from './mongo'
import { parseIngestBody, toTeamDoc } from './team-store'
import { TEAM_INGEST_TOKEN } from './config'

// CORS headers are defined in index.ts; this module returns plain JSON and the
// caller in index.ts spreads CORS_HEADERS, so we only set Content-Type here.
const JSON_HEADERS = { 'Content-Type': 'application/json' }

/** Upsert every session as a team doc keyed by org:user:harness:sessionId.
 *  Idempotent: re-posting an identical session is a no-op write. Returns count. */
export async function ingestSessions(org: string, user: string, sessions: SessionMeta[]): Promise<number> {
  if (sessions.length === 0) return 0
  const col = await getTeamCollection()
  const ops = sessions.map(s => {
    const doc = toTeamDoc(s, org, user)
    return { replaceOne: { filter: { _id: doc._id }, replacement: doc, upsert: true } }
  })
  await col.bulkWrite(ops, { ordered: false })
  return ops.length
}

/** Route handler for POST /api/team/ingest. Validates an optional bearer token,
 *  parses the body, upserts, and returns { ok, count } or an error status. */
export async function handleTeamIngest(req: Request): Promise<Response> {
  // Optional shared-secret gate (Phase 3 replaces this with minted per-user tokens).
  if (TEAM_INGEST_TOKEN) {
    const auth = req.headers.get('authorization') ?? ''
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : ''
    if (token !== TEAM_INGEST_TOKEN) {
      return new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401, headers: JSON_HEADERS })
    }
  }
  let raw: unknown
  try {
    raw = await req.json()
  } catch {
    return new Response(JSON.stringify({ error: 'invalid JSON' }), { status: 400, headers: JSON_HEADERS })
  }
  const parsed = parseIngestBody(raw)
  if (!parsed.ok) {
    return new Response(JSON.stringify({ error: parsed.error }), { status: 400, headers: JSON_HEADERS })
  }
  try {
    const count = await ingestSessions(parsed.body.org, parsed.body.user, parsed.body.sessions)
    return new Response(JSON.stringify({ ok: true, count }), { status: 200, headers: JSON_HEADERS })
  } catch (e) {
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }), { status: 500, headers: JSON_HEADERS })
  }
}
```

- [ ] **Step 2: Register the route in index.ts**

In `packages/server/server/index.ts`, add a guard BEFORE the non-`/api` static fallback (currently line 710). Place it next to the other `/api/...` POST guards. The handler returns JSON with `Content-Type`; spread `CORS_HEADERS` onto the response. Insert:

```ts
    if (url.pathname === '/api/team/ingest' && req.method === 'POST') {
      const { handleTeamIngest } = await import('./team-ingest')
      const res = await handleTeamIngest(req)
      // Re-wrap to attach CORS headers (handler sets only Content-Type)
      const headers = new Headers(res.headers)
      for (const [k, v] of Object.entries(CORS_HEADERS)) headers.set(k, v)
      return new Response(res.body, { status: res.status, headers })
    }
```

(Confirm `CORS_HEADERS` is in scope here — it is defined at `index.ts:85` and used by sibling handlers. The dynamic `import('./team-ingest')` keeps the mongo driver out of the module graph until the first ingest request.)

- [ ] **Step 3: Typecheck + full suite**

Run: `bun tsc --noEmit`
Expected: no errors.

Run: `bun test`
Expected: all PASS (the pure validation is already covered in `team-store.test.ts`; no regression).

- [ ] **Step 4: Manual smoke test against a local Mongo**

Start a single-node replica-set Mongo (replica set is required for the Task 4 change stream; harmless here):

```bash
docker run -d --rm --name agentistics-mongo -p 27017:27017 mongo:7 --replSet rs0
sleep 3
docker exec agentistics-mongo mongosh --quiet --eval "rs.initiate()" || true
sleep 2
```

Start the central server and POST a session:

```bash
AGENTISTICS_TEAM_CENTRAL=1 MONGO_URL=mongodb://localhost:27017 bun run packages/server/server/index.ts &
sleep 3
curl -s -X POST http://localhost:47291/api/team/ingest \
  -H 'Content-Type: application/json' \
  -d '{"org":"acme","user":"devA","sessions":[{"session_id":"s1","harness":"claude","project_path":"/x","start_time":"2026-06-01T00:00:00Z","duration_minutes":1,"user_message_count":1,"assistant_message_count":1,"tool_counts":{},"tool_output_tokens":{},"agent_file_reads":{},"languages":[],"git_commits":0,"git_pushes":0,"input_tokens":10,"output_tokens":20,"first_prompt":"hi","user_interruptions":0,"user_response_times":[],"tool_errors":0,"tool_error_categories":{},"uses_task_agent":false,"uses_mcp":false,"uses_web_search":false,"uses_web_fetch":false,"lines_added":0,"lines_removed":0,"files_modified":0,"message_hours":[],"user_message_timestamps":[]}]}'
echo
# verify it was upserted
docker exec agentistics-mongo mongosh agentistics --quiet --eval "db.sessions.find({}, {_id:1, user:1}).toArray()"
```

Expected: the curl prints `{"ok":true,"count":1}`; the mongosh query shows one doc with `_id: "acme:devA:claude:s1"`, `user: "devA"`. Re-running the same curl still returns `count:1` and does NOT create a duplicate (idempotent upsert). Stop the server (`kill %1`) and keep the Mongo container running for Tasks 3-4 (or `docker stop agentistics-mongo` when done).

Paste the actual curl + mongosh output into your report.

- [ ] **Step 5: Commit**

```bash
git add packages/server/server/team-ingest.ts packages/server/server/index.ts
git commit -m "feat(server): add POST /api/team/ingest endpoint with upsert"
```

---

## Task 3: Source the dashboard from Mongo when central

**Files:**
- Modify: `packages/server/server/team-source.ts` (add `loadTeamSessionsFromMongo`)
- Modify: `packages/server/server/data.ts` (the `if (TEAM_MODE)` block ~line 653; import `TEAM_CENTRAL`)
- Test: pure mapping already covered (`fromTeamDoc` in `team-store.test.ts`); Mongo read verified by manual smoke test

**Interfaces:**
- Consumes: `getTeamCollection` from `./mongo`; `fromTeamDoc` from `./team-store`; `TEAM_CENTRAL` from `./config`.
- Produces: `loadTeamSessionsFromMongo(): Promise<SessionMeta[]>` — all team docs mapped back to `SessionMeta` (with `user` retained).

- [ ] **Step 1: Add the Mongo reader to team-source.ts**

In `packages/server/server/team-source.ts`, append a new exported function (keep the existing `loadTeamSessions` folder loader intact):

```ts
import { getTeamCollection } from './mongo'
import { fromTeamDoc } from './team-store'

/** Phase 2 central read: load every team session from Mongo, mapped back to
 *  plain SessionMeta (with `user` retained). Tolerates an unreachable DB. */
export async function loadTeamSessionsFromMongo(): Promise<SessionMeta[]> {
  const col = await getTeamCollection()
  const docs = await col.find({}).toArray()
  return docs.map(fromTeamDoc)
}
```

(Add the two imports at the top of the file alongside the existing imports.)

- [ ] **Step 2: Read from Mongo in data.ts when central**

In `packages/server/server/data.ts`, extend the config import on line 4 to add `TEAM_CENTRAL`:

```ts
import { PROJECTS_DIR, SESSION_META_DIR, ARCHIVE_PROJECTS_DIR, ARCHIVE_SESSION_META_DIR, STATS_CACHE_FILE, ARCHIVE_STATS_DIR, ARCHIVE_ENABLED, HOME_DIR, TEAM_MODE, TEAM_CENTRAL } from './config'
```

Then, in the `if (TEAM_MODE) {` block (currently ~line 653), change the source selection so a central instance reads Mongo, while the Phase 1 folder path remains for `AGENTISTICS_TEAM=1` without central. Replace the line that loads team sessions:

```ts
    // --- Team sessions: central reads Mongo (Phase 2); else folder union (Phase 1) ---
    if (TEAM_MODE || TEAM_CENTRAL) {
      let teamSessions: SessionMeta[] = []
      if (TEAM_CENTRAL) {
        const { loadTeamSessionsFromMongo } = await import('./team-source')
        teamSessions = await loadTeamSessionsFromMongo().catch(() => [] as SessionMeta[])
      } else {
        const { loadTeamSessions } = await import('./team-source')
        teamSessions = await loadTeamSessions().catch(() => [] as SessionMeta[])
      }
      for (const s of teamSessions) {
        sessions.push(s)
        harnessSet.add(s.harness)
        const existing = projects.find(p => p.path === s.project_path && p.path)
        if (existing) {
          existing.sessions.push({ sessionId: s.session_id, created: s.start_time })
        } else if (s.project_path) {
          projects.push({
            path: s.project_path,
            name: s.project_path.split('/').filter(Boolean).pop() ?? s.project_path,
            sessions: [{ sessionId: s.session_id, created: s.start_time }],
          })
        }
      }
    }
```

> This replaces the existing Phase 1 `if (TEAM_MODE) { ... }` block in place. The push/merge loop body is identical to Phase 1 — only the source selection (Mongo vs folder) is new. Read the current block first and replace exactly it, preserving surrounding code.

- [ ] **Step 3: Typecheck + full suite**

Run: `bun tsc --noEmit`
Expected: no errors.

Run: `bun test`
Expected: all PASS (no regression; the new path is gated on `TEAM_CENTRAL`).

- [ ] **Step 4: Manual smoke test — dashboard reads the ingested session**

With the Mongo container from Task 2 still holding the `acme:devA:claude:s1` doc, start the central server and hit `/api/data`:

```bash
AGENTISTICS_TEAM_CENTRAL=1 MONGO_URL=mongodb://localhost:27017 bun run packages/server/server/index.ts &
sleep 3
curl -s http://localhost:47291/api/data | bun -e "const d = await Bun.stdin.json(); console.log('users:', [...new Set(d.sessions.map(s=>s.user).filter(Boolean))]); console.log('has s1:', d.sessions.some(s=>s.session_id==='s1' && s.user==='devA'))"
kill %1
```

Expected: `users: [ "devA" ]` and `has s1: true` — the ingested Mongo session appears in the dashboard data with its `user` tag. Paste the output into your report.

- [ ] **Step 5: Commit**

```bash
git add packages/server/server/team-source.ts packages/server/server/data.ts
git commit -m "feat(server): source dashboard from mongo when running as central"
```

---

## Task 4: Mongo change-stream → SSE (with polling fallback)

**Files:**
- Create: `packages/server/server/team-watch.ts`
- Modify: `packages/server/server/index.ts` (start the watcher on boot when `TEAM_CENTRAL`, near the existing `void setupFileWatcher()` at line 75)
- Test: verified by manual smoke test (change-stream + fallback are I/O)

**Interfaces:**
- Consumes: `getTeamCollection` from `./mongo`; `triggerSseNotification` from `./sse`; `TEAM_CENTRAL` from `./config`.
- Produces: `startTeamWatch(): void` — idempotent; opens a change stream on the team collection and calls `triggerSseNotification()` on every change. If the change stream cannot open (e.g. Mongo not a replica set), logs once and falls back to polling the collection's document count every 5s, firing `triggerSseNotification()` when it changes.

- [ ] **Step 1: Implement the watcher**

Create `packages/server/server/team-watch.ts`:

```ts
import { getTeamCollection } from './mongo'
import { triggerSseNotification } from './sse'

let started = false

/** Watch the team collection and push SSE updates to connected dashboards.
 *  Prefers a Mongo change stream (requires a replica set); falls back to a
 *  5s count-poll when change streams are unavailable. Idempotent. */
export function startTeamWatch(): void {
  if (started) return
  started = true
  void run()
}

async function run(): Promise<void> {
  try {
    const col = await getTeamCollection()
    const stream = col.watch([], { fullDocument: 'updateLookup' })
    stream.on('change', () => triggerSseNotification())
    stream.on('error', (err: unknown) => {
      console.warn('[team-watch] change stream error, falling back to polling:', err instanceof Error ? err.message : err)
      void poll()
    })
    console.log('[team-watch] watching team collection via change stream')
  } catch (err) {
    console.warn('[team-watch] change stream unavailable, falling back to polling:', err instanceof Error ? err.message : err)
    void poll()
  }
}

async function poll(): Promise<void> {
  let last = -1
  // Simple count-based poll: any insert/replace changes the count or leaves it
  // equal on idempotent re-push (no spurious SSE). Good enough for a fallback.
  for (;;) {
    try {
      const col = await getTeamCollection()
      const n = await col.estimatedDocumentCount()
      if (last !== -1 && n !== last) triggerSseNotification()
      last = n
    } catch {
      // transient DB error — keep polling
    }
    await Bun.sleep(5000)
  }
}
```

> Note: the count-poll is a deliberately simple fallback — it catches new sessions (the common case), not in-place metric updates to an existing session. The change stream (the primary path, available on any replica-set Mongo incl. the Phase 4 Docker single-node RS) catches everything. This trade-off is acceptable for a fallback and is called out so it isn't mistaken for complete coverage.

- [ ] **Step 2: Start the watcher on boot when central**

In `packages/server/server/index.ts`, near the existing `void setupFileWatcher()` call (line 75), add a guarded start. First ensure `TEAM_CENTRAL` is imported from `./config` (add it to the existing config import). Then:

```ts
void setupFileWatcher()
if (TEAM_CENTRAL) {
  const { startTeamWatch } = await import('./team-watch')
  startTeamWatch()
}
```

> If the surrounding code at line 75 is not inside an `async` scope where top-level `await import` is allowed, use `import('./team-watch').then(m => m.startTeamWatch())` instead. Read the surrounding lines and match the existing style.

- [ ] **Step 3: Typecheck + full suite**

Run: `bun tsc --noEmit`
Expected: no errors.

Run: `bun test`
Expected: all PASS (no regression; watcher only starts when `TEAM_CENTRAL`).

- [ ] **Step 4: Manual smoke test — live SSE on ingest**

With the replica-set Mongo from Task 2 running:

```bash
AGENTISTICS_TEAM_CENTRAL=1 MONGO_URL=mongodb://localhost:27017 bun run packages/server/server/index.ts &
sleep 3
# subscribe to SSE in the background and capture events
( curl -s -N http://localhost:47291/api/events & echo $! > /tmp/sse.pid ) > /tmp/sse.out 2>&1 &
sleep 2
# ingest a new session — should trigger an SSE 'change' within ~2s (debounce)
curl -s -X POST http://localhost:47291/api/team/ingest -H 'Content-Type: application/json' \
  -d '{"org":"acme","user":"devB","sessions":[{"session_id":"s9","harness":"claude","project_path":"/y","start_time":"2026-06-02T00:00:00Z","duration_minutes":1,"user_message_count":1,"assistant_message_count":1,"tool_counts":{},"tool_output_tokens":{},"agent_file_reads":{},"languages":[],"git_commits":0,"git_pushes":0,"input_tokens":1,"output_tokens":1,"first_prompt":"x","user_interruptions":0,"user_response_times":[],"tool_errors":0,"tool_error_categories":{},"uses_task_agent":false,"uses_mcp":false,"uses_web_search":false,"uses_web_fetch":false,"lines_added":0,"lines_removed":0,"files_modified":0,"message_hours":[],"user_message_timestamps":[]}]}' > /dev/null
sleep 4
echo "=== SSE events captured ==="; cat /tmp/sse.out
kill "$(cat /tmp/sse.pid)" 2>/dev/null; kill %1 2>/dev/null
docker stop agentistics-mongo 2>/dev/null || true
```

Expected: `/tmp/sse.out` contains an `event: connected` line and at least one `event: change` line that arrived after the ingest (the change stream fired `triggerSseNotification()`). If Mongo were standalone (no RS), you'd instead see the `[team-watch] change stream unavailable, falling back to polling` log and a `change` event within ~5s. Paste the captured SSE output into your report.

- [ ] **Step 5: Commit**

```bash
git add packages/server/server/team-watch.ts packages/server/server/index.ts
git commit -m "feat(server): push live SSE updates from a mongo change stream"
```

---

## Task 5: Make the central team-total Cost/Tokens session-sourced (resolve the Phase 1 limitation)

**Files:**
- Modify: `packages/server/server/data.ts` (the `if (TEAM_MODE || TEAM_CENTRAL)` block from Task 3)
- Test: verified by the manual smoke test (cost card non-zero on an empty-statsCache central)

**Why:** The unfiltered (no user selected) Cost/Tokens KPIs read from `statsCache.modelUsage`. On a dedicated central `statsCache` is empty, so they show 0 even with team sessions present (the Phase 1 limitation we documented). `supplementStatsCache(statsCache, sessions)` (already in `data.ts:399`) aggregates `model`-bearing sessions into `dailyActivity`, `dailyModelTokens`, AND `modelUsage`. Running it over the team sessions on a central populates the cost/token aggregates from the team data.

**Safety:** This is safe specifically because a dedicated central has no local Claude sessions of its own to corrupt — its `statsCache` starts empty, so the team supplement is the only contributor. The existing local supplement at `data.ts:625` ran over the (empty) local session set; this adds a second supplement over the disjoint team set. The `day <= lastComputedDate` guard inside `supplementStatsCache` makes it a no-op on an already-computed day, so it cannot double-count.

**Interfaces:**
- Consumes: `supplementStatsCache` (local function in `data.ts`); `TEAM_CENTRAL`; the `teamSessions` array introduced in Task 3.
- Produces: on a central, `statsCache.modelUsage`/`dailyActivity`/`dailyModelTokens` include team sessions, so unfiltered Cost/Tokens are correct.

- [ ] **Step 1: Supplement statsCache from team sessions when central**

In `packages/server/server/data.ts`, inside the `if (TEAM_MODE || TEAM_CENTRAL) {` block from Task 3, AFTER the `for (const s of teamSessions) { ... }` merge loop closes and BEFORE the block's closing brace, add:

```ts
      // Central: fold team sessions into statsCache so the unfiltered (no user
      // selected) Cost/Tokens KPIs reflect the whole team. Safe on a dedicated
      // central (empty local statsCache → nothing to corrupt); the day<=lastComputed
      // guard inside supplementStatsCache prevents any double-count.
      if (TEAM_CENTRAL) supplementStatsCache(statsCache, teamSessions)
```

- [ ] **Step 2: Typecheck + full suite**

Run: `bun tsc --noEmit`
Expected: no errors.

Run: `bun test`
Expected: all PASS (no regression; gated on `TEAM_CENTRAL`).

- [ ] **Step 3: Manual smoke test — unfiltered team-total Cost/Tokens is non-zero**

With the replica-set Mongo from Task 2 running, ingest a session that carries a `model` and real tokens, then check that `statsCache.modelUsage` is populated:

```bash
AGENTISTICS_TEAM_CENTRAL=1 MONGO_URL=mongodb://localhost:27017 bun run packages/server/server/index.ts &
sleep 3
curl -s -X POST http://localhost:47291/api/team/ingest -H 'Content-Type: application/json' \
  -d '{"org":"acme","user":"devA","sessions":[{"session_id":"sc1","harness":"claude","model":"claude-sonnet-4-6","project_path":"/x","start_time":"2026-06-20T00:00:00Z","duration_minutes":1,"user_message_count":2,"assistant_message_count":2,"tool_counts":{},"tool_output_tokens":{},"agent_file_reads":{},"languages":[],"git_commits":0,"git_pushes":0,"input_tokens":100000,"output_tokens":50000,"first_prompt":"hi","user_interruptions":0,"user_response_times":[],"tool_errors":0,"tool_error_categories":{},"uses_task_agent":false,"uses_mcp":false,"uses_web_search":false,"uses_web_fetch":false,"lines_added":0,"lines_removed":0,"files_modified":0,"message_hours":[],"user_message_timestamps":[]}]}' > /dev/null
sleep 1
curl -s http://localhost:47291/api/data | bun -e "const d = await Bun.stdin.json(); console.log('modelUsage:', JSON.stringify(d.statsCache.modelUsage)); console.log('claude-sonnet-4-6 input:', d.statsCache.modelUsage?.['claude-sonnet-4-6']?.inputTokens)"
kill %1; docker stop agentistics-mongo 2>/dev/null || true
```

Expected: `modelUsage` includes a `claude-sonnet-4-6` entry with `inputTokens: 100000` (and output 50000). This is what makes the unfiltered Cost and Tokens cards non-zero on the central. Paste the output into your report.

- [ ] **Step 4: Commit**

```bash
git add packages/server/server/data.ts
git commit -m "feat(server): fold team sessions into statsCache so central totals are non-zero"
```

---

## Self-Review

**Spec coverage (Phase 2 server scope):**
- Central Mongo source → Task 3 (`loadTeamSessionsFromMongo` + data.ts swap), Task 1 (client + doc helpers).
- Ingestion API `POST /api/team/ingest` → Task 2 (`handleTeamIngest` + upsert + route).
- Change-stream SSE → Task 4 (`startTeamWatch`, reuses `triggerSseNotification`).
- Metrics-only, per-session grain, `_id = org:user:...:sessionId` (idempotent upsert) → Task 1/2.
- Resolves the documented Phase 1 limitation (empty-central team-total Cost/Tokens = 0) → Task 5: on a central, `supplementStatsCache` folds team sessions into `statsCache.modelUsage`/`dailyActivity`/`dailyModelTokens`, so the *unfiltered* Cost/Tokens are non-zero. Task 3 makes the sessions visible/sliceable; Task 5 makes the no-selection aggregate correct.
- Out of Phase 2a (later phases): local uploader + team-config UI (Phase 2b); minted per-user tokens + login + admin UI (Phase 3); autostart + Docker single-node-RS packaging (Phase 4).

**Placeholder scan:** No TBD/TODO; every code step has complete code; every command has expected output and real fixture JSON. The two "match the existing style" notes (index.ts route placement; watcher start syntax) point at concrete named anchors with the exact code to insert.

**Type consistency:** `TeamSessionDoc`, `teamDocId`, `toTeamDoc`, `fromTeamDoc`, `parseIngestBody`, `IngestBody` defined in Task 1 and used with matching signatures in Tasks 2-3. `ingestSessions`/`handleTeamIngest` (Task 2) and `loadTeamSessionsFromMongo` (Task 3) and `startTeamWatch` (Task 4) match their Interfaces blocks. `getTeamCollection`/`getMongoDb`/`closeMongo` consistent across Tasks 1-4.

**Phase 1 limitation closed by Task 5** — no open follow-up on the cost path. Remaining Phase-2-and-later items: same-session double-count if an operator is also ingested (data.ts dedup mitigates list-level; irrelevant on a dedicated empty central), and the `org` dimension is now in the Mongo `_id` (`org:user:harness:sessionId`) but not yet in the data.ts dedup key — additive when multi-org lands.
