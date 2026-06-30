# Team Mode — Phase 7: On-demand session chat (member ↔ central reverse channel)

> Executed via a parallel **Workflow** (server ∥ web), integrated + verified. Lets the central view a remote member's session conversation on demand — fetched live from the member's machine over a persistent WebSocket the member holds open — without ever storing chat text in the central.

**Goal:** On the central dashboard, clicking a session that belongs to a remote member fetches that session's chat from the member's machine on demand (the member only sends metrics by default). Works through NAT because the member initiates the connection.

**Architecture:** Each member opens a persistent **WebSocket** to the central (`/api/team/agent`, authenticated by its ingest token). The central keeps a `user → socket(s)` registry. When the dashboard requests a session's chat (`GET /api/team/session-chat`), the central: serves it locally if it owns the file (its own self-contributed session), else sends a `fetch-chat` request over the owning member's socket, awaits the `chat-result`, and returns it. A 404/"member offline" is returned when no socket is connected. Nothing is persisted.

**Tech Stack:** Bun (`Bun.serve` websocket + `new WebSocket` client), TypeScript (strict), React, `bun test`.

## Global Constraints
- Everything in English; user-facing copy bilingual pt/en. TypeScript strict — no `any`. Conventional Commits; pre-commit runs `bun tsc --noEmit` + `bun test`.
- `packages/server/server/*` server-only. Reuse the per-harness chat readers (`getClaudeSessionMessages`, `getCodexSessionMessages`, `getGeminiSessionMessages`, `getCopilotSessionMessages` from the `*-sessions.ts` modules) and `validateIngestToken` (auth).
- Additive: nothing changes Solo mode. The WS client only runs in member mode; the WS server only matters on a central.
- Never log tokens. Time out remote fetches (10s) so a slow/dead member can't hang the request.

---

## THE CONTRACT (seam)

### Shared message types — `packages/core/src/team.ts` (export from barrel)
```ts
export type AgentRequest  = { id: string; type: 'fetch-chat'; sessionId: string; harness: string }
export type AgentResponse = { id: string; type: 'chat-result'; ok: boolean; messages?: unknown[]; error?: string }
```
(`messages` is the harness chat-message array; type it as `unknown[]` at the protocol layer — the web renders it with the existing chat renderer.)

### WebSocket endpoint (central) — `GET /api/team/agent`
- The member connects with header `Authorization: Bearer <token>` (Bun's `new WebSocket(url, { headers })` supports this). The central validates via `validateIngestToken` in the upgrade step; on success `server.upgrade(req, { data: { user } })`, else respond 401 (do not upgrade).
- Registry: `Map<string, Set<ServerWebSocket>>` keyed by user. Add on `open`, remove on `close`.
- On `message` (a JSON `AgentResponse`): resolve the pending request by `id`.

### HTTP endpoint (central) — `GET /api/team/session-chat?user=&sessionId=&harness=`
- ADMIN-gated (central + valid session). Returns `{ ok: true, messages }` or `{ ok: false, error }` (status 200; or 404 with `{ error: 'member offline' }` when no socket).
- Behavior: if the central can read the session locally (its own self-contributed session — try the harness reader), return that. Else look up a socket for `user`; if none → 404 "member offline"; else send `{ id, type:'fetch-chat', sessionId, harness }`, await the matching `chat-result` (10s timeout), return its `messages` (or the error / a timeout error).

### Member WS client
- Started when `team.mode === 'member'` and configured (endpoint+user+token). Opens `new WebSocket(`${endpoint.replace(/^http/,'ws')}/api/team/agent`, { headers: { Authorization: 'Bearer '+token } })`. Reconnects with backoff on close. On `fetch-chat`, reads the local chat for `(sessionId, harness)` via the matching `get<Harness>SessionMessages`, replies `{ id, type:'chat-result', ok, messages }` (or `ok:false, error`).

### Web
- The session-detail modal, when running on a central (`central === true`) and the selected session has a `user`, fetches chat via `GET /api/team/session-chat?user=&sessionId=&harness=` and renders it with the existing chat renderer. While loading show a spinner; on `member offline` / error show a clear bilingual message.

---

## TRACK A — Server (files: `packages/core/src/team.ts` + barrel; `packages/server/server/team-agent.ts` [new — central WS registry + correlation + session-chat handler]; `packages/server/server/team-agent-client.ts` [new — member WS client]; `packages/server/server/index.ts` [Bun.serve websocket handler + upgrade for /api/team/agent + the /api/team/session-chat route + start the member client])

**A1 core:** add `AgentRequest`/`AgentResponse` types to `team.ts`, export from `index.ts` barrel.

**A2 `team-agent.ts` (central):**
- `registerAgent(user: string, ws: ServerWebSocket): void` / `unregisterAgent(user, ws)` — maintain `Map<string, Set<ServerWebSocket>>`.
- `onAgentMessage(ws, raw: string): void` — parse `AgentResponse`, resolve pending by id.
- `requestChat(user: string, sessionId: string, harness: string): Promise<{ ok: boolean; messages?: unknown[]; error?: string }>` — pick a socket for user (else `{ ok:false, error:'member offline' }`), generate an id (a module counter — Math.random is unavailable in workflow scripts but FINE in server code; use `crypto.randomUUID()`), send the request, store `{resolve}` in `Map<id, resolve>`, await with a 10s timeout (reject→`{ok:false,error:'timeout'}`).
- `handleSessionChat(req: Request): Promise<Response>` — parse `user`/`sessionId`/`harness` from the query; FIRST try reading locally via the right `get<Harness>SessionMessages` (the central's own session) and return it if found; else `await requestChat(...)`; return JSON `{ ok, messages, error }` (200), or 404 when `error === 'member offline'`.

**A3 `team-agent-client.ts` (member):**
- `startAgentClient(): void` — idempotent; reads preferences each (re)connect; when member+configured, connect the WS with the Bearer header. On `message` (`fetch-chat`): read local chat via the harness reader, send `chat-result`. On `close`/`error`: reconnect with backoff (e.g., 3s, capped). Never throw.

**A4 `index.ts`:**
- Add a `websocket` handler to `Bun.serve({ ... })` with `open`/`message`/`close` delegating to `team-agent` (the upgraded socket's `data.user` identifies the member).
- In `fetch(req, server)` (capture the `server` arg): for `url.pathname === '/api/team/agent'`, validate the Bearer token via `validateIngestToken`; if ok `return server.upgrade(req, { data: { user } }) ? undefined : new Response('upgrade failed', { status: 500 })`; else 401. Place BEFORE the auth gate / static fallback. Add `/api/team/agent` to AUTH_PUBLIC (it does its own token check).
- Add `GET /api/team/session-chat` → ADMIN-gated → `handleSessionChat(req)` (CORS-wrapped). Add `/api/team/session-chat` to `ADMIN_PATHS`.
- Start the member client on boot: `import('./team-agent-client').then(m => m.startAgentClient())` near the uploader start.

## TRACK B — Web (files: the session-detail modal component — find it via the `selectedSession` usage in `App.tsx`/`AppContext`; likely `SessionModal.tsx` or similar)

**B1:** When the modal opens for a session and `central === true` (thread the central flag via context/props — it already exists on the team session check) and the session has a `user`, fetch `GET /api/team/session-chat?user=${user}&sessionId=${session_id}&harness=${harness}`. Render the returned `messages` with the SAME chat renderer the modal already uses for local sessions. Show a spinner while loading; on `{ok:false}` / 404 show a bilingual notice ("Member offline — chat unavailable" / "Membro offline — chat indisponível"). For non-central or sessions without a user, keep the existing local behavior unchanged.

---

## Integration seam checklist
- `AgentRequest`/`AgentResponse` shapes identical in central + member.
- `/api/team/session-chat` query + response shapes match between `team-agent.ts` and the web modal.
- The WS URL derivation (`http→ws`, `https→wss`) is correct on the member.
- `bun tsc --noEmit` + `bun run build` + `bun test` green.

## Testing
- The protocol/registry pure-ish bits (id correlation) covered by a small unit test if extractable; otherwise verified by the manual e2e below.
- **Manual e2e (controller):** start a central + a member (`bun run dev` connecting to the central with a minted token); confirm the member's WS connects (central logs the registration); `GET /api/team/session-chat?user=&sessionId=&harness=claude` for a real member session returns the chat; with the member stopped it returns "member offline".

## Out of scope (later)
- Caching fetched chats; streaming long chats; multi-connection load balancing beyond "pick one".
