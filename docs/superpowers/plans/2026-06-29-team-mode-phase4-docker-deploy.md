# Team Mode — Phase 4: Docker Packaging + Deploy Wizard Implementation Plan

> Executed via a parallel **Workflow** (infra/server ∥ web), integrated, then the Docker stack is verified by a real `docker compose up`.

**Goal:** The central is born from one command. `docker compose up -d` brings up the app + a Mongo single-node replica set (auto-initialised, so change streams work out of the box), and a UI "Deploy" panel generates the `.env` + the exact command + the OS autostart snippet to copy.

**Architecture:** A multi-stage `Dockerfile` builds the web + embeds assets + runs the server. `docker-compose.yml` wires the app to a `mongo:7 --replSet rs0` whose healthcheck idempotently runs `rs.initiate({ members:[{ host:'mongo:27017' }] })` — so the RS member host matches the service name the app connects to (`mongodb://mongo:27017/?replicaSet=rs0`), avoiding any hostname-reconfig dance. A pure `deploy.ts` generates the `.env` body and per-OS autostart snippets; a `GET /api/team/deploy` route exposes a generated `.env` to the UI panel. Disjoint files; the contract is the seam.

**Tech Stack:** Docker + Compose, Bun, TypeScript (strict), React, `bun test`. No new npm deps.

## Global Constraints

- Everything in English. TypeScript strict — no `any`. Conventional Commits; pre-commit runs `bun tsc --noEmit` + `bun test`.
- `packages/server/server/*` server-only. Reuse `CORS_HEADERS`.
- Additive: none of this changes Solo / existing run modes. The Docker artifacts are new files; the deploy route is gated to central.
- Never bake secrets into the image or commit a real `.env` (only `.env.example` with placeholders). The generated password/secret are random, shown to the operator, never logged.
- The compose Mongo must NOT publish 27017 to the host by default (internal network only) to avoid clashing with any local Mongo.

---

## THE CONTRACT (fixed seam)

### Pure generator (server, `deploy.ts`)
```ts
export interface DeployOpts {
  org: string            // default 'default'
  password: string       // team login password (operator-provided or generated)
  sessionSecret: string  // 32-byte hex
  port: number           // host port for the app, default 47291
}
/** Produce the .env file body for docker-compose (KEY=VALUE lines). Pure. */
export function generateEnvFile(opts: DeployOpts): string
/** Per-OS autostart snippet to keep a LOCAL dev's agentop running (team member).
 *  platform: 'linux' (systemd user) | 'macos' (launchd) | 'windows' (schtasks). Pure. */
export function autostartSnippet(platform: 'linux' | 'macos' | 'windows', execPath: string): string
```

### Deploy route (server, behind the central + auth gate when a password is set)
- `GET /api/team/deploy?org=&port=` → `{ env: string, command: string }`
  - `env` = `generateEnvFile({...})` with a freshly generated `password` + `sessionSecret` (the UI shows these ONCE).
  - `command` = `'docker compose up -d'`.

---

## TRACK A — Infra + server (files: `Dockerfile` [new], `.dockerignore` [new], `docker-compose.yml` [new], `.env.example` [new], `docs/DEPLOY.md` [new], `packages/server/server/deploy.ts` [new], `packages/server/server/deploy.test.ts` [new], `packages/server/server/index.ts`)

**A1 `Dockerfile`** (multi-stage):
```dockerfile
# build stage
FROM oven/bun:1 AS build
WORKDIR /app
COPY . .
RUN bun install --frozen-lockfile || bun install
RUN bun run build && bun run build:assets
# runtime stage
FROM oven/bun:1-slim
WORKDIR /app
COPY --from=build /app /app
ENV SERVE_STATIC=1 AGENTISTICS_TEAM_CENTRAL=1 PORT=47291
EXPOSE 47291
CMD ["bun","run","packages/server/server/index.ts"]
```
(Confirm the build scripts exist in the root package.json — they do: `build`, `build:assets`. If `oven/bun:1-slim` lacks needed tooling, fall back to `oven/bun:1`.)

**A2 `.dockerignore`** — exclude `node_modules`, `.git`, `.claude`, `dist`, `**/embedded-dist.generated.ts`, `docs/superpowers`, `*.log`, `.env` (keep the build context small + never ship secrets).

**A3 `docker-compose.yml`**:
```yaml
services:
  mongo:
    image: mongo:7
    command: ["--replSet","rs0","--bind_ip_all"]
    volumes: ["mongodata:/data/db"]
    healthcheck:
      test: ["CMD-SHELL","mongosh --quiet --eval \"try{rs.status().ok}catch(e){rs.initiate({_id:'rs0',members:[{_id:0,host:'mongo:27017'}]}).ok}\""]
      interval: 10s
      timeout: 10s
      retries: 12
      start_period: 20s
  app:
    build: .
    environment:
      AGENTISTICS_TEAM_CENTRAL: "1"
      SERVE_STATIC: "1"
      PORT: "47291"
      MONGO_URL: "mongodb://mongo:27017/?replicaSet=rs0"
      AGENTISTICS_TEAM_PASSWORD: "${AGENTISTICS_TEAM_PASSWORD}"
      AGENTISTICS_TEAM_SESSION_SECRET: "${AGENTISTICS_TEAM_SESSION_SECRET}"
      AGENTISTICS_TEAM_ORG: "${AGENTISTICS_TEAM_ORG:-default}"
    depends_on:
      mongo:
        condition: service_healthy
    ports: ["${APP_PORT:-47291}:47291"]
volumes:
  mongodata:
```
(The healthcheck is idempotent — first run initiates the single-node RS with `host:'mongo:27017'`, later runs just check `rs.status().ok`.)

**A4 `.env.example`** — placeholders:
```
AGENTISTICS_TEAM_PASSWORD=change-me
AGENTISTICS_TEAM_SESSION_SECRET=generate-with-openssl-rand-hex-32
AGENTISTICS_TEAM_ORG=default
APP_PORT=47291
```

**A5 `docs/DEPLOY.md`** — concise: prerequisites (Docker), `cp .env.example .env` + fill, `docker compose up -d`, where to open it, how the RS auto-init works, and the **autostart** section (systemd-user / launchd / schtasks snippets for keeping a *member's* local agentop running — generated by `autostartSnippet`, shown as copy-paste; explicitly note this is opt-in and the live toggle is a follow-up).

**A6 `deploy.ts` + `deploy.test.ts`** — implement + TDD the two pure generators: `generateEnvFile` (contains each key, escapes nothing weird, deterministic given opts), `autostartSnippet` (linux output contains `[Unit]`/`systemctl --user`; macos contains `launchctl`/`plist`; windows contains `schtasks`).

**A7 `index.ts`** — add `GET /api/team/deploy` (central-gated; behind auth when password set, same as admin routes): generate `password`/`sessionSecret` via `crypto.randomBytes(…).toString('hex')`, return `{ env, command }`.

## TRACK B — Web (files: `DeployCentral.tsx` [new], `PreferencesModal.tsx`)

**B1 `DeployCentral.tsx`** — a "Deploy a central" panel: inputs for `org` + `port`; a "Generate" button → `GET /api/team/deploy?org=&port=` → shows the generated `.env` in a copyable block (with a "contains a one-time password/secret — save it" warning) and the `docker compose up -d` command; plus an OS picker that shows the matching autostart snippet. Bilingual.

**B2 `PreferencesModal.tsx`** — surface `<DeployCentral/>` in the existing **Install** tab (or the Team tab) as a "Deploy a team central" section. Reuse the tab; no new modal.

---

## Integration seam checklist
- `/api/team/deploy` response `{ env, command }` matches between `index.ts` and `DeployCentral.tsx`.
- `bun tsc --noEmit` + `bun run build` + `bun test` green.

## Testing
- Pure unit tests (TDD): `generateEnvFile`, `autostartSnippet`.
- **Infra (verified by the controller, not the workflow):** `docker compose build` + `docker compose up -d` → wait for healthy → POST a session to `/api/team/ingest` → `GET /api/data` shows it → `docker compose down -v`. This proves the one-command central + RS auto-init.

## Out of scope (the remaining polish, post-Phase-4)
- Live OS autostart **installation** toggle (this phase generates + displays the snippet/command; actually enabling the service per-OS, incl. the Tauri desktop autostart plugin, is the final follow-up).
- Per-user RBAC beyond the single team login.
