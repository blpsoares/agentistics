# agentistics — CLAUDE.md

Local analytics dashboard for AI coding assistants. Visualizes tokens, costs, activity, projects, and agent metrics based on data from `~/.claude/`.

## Language convention

**Everything in this project is in English**: code, comments, commit messages, PR titles and descriptions, documentation, and this file.

## Monorepo structure

```
packages/
  core/     (@agentistics/core)   — shared types, pricing, formatters, i18n, otel helpers
  server/   (@agentistics/server) — Bun HTTP server, CLI (agentop), otel-watcher, scripts
  web/      (@agentistics/web)    — React + Vite frontend
  mcp/      (@agentistics/mcp)    — MCP server, publishable to npm standalone
  tui/      (@agentistics/tui)    — Ink (React) terminal dashboard + the `agentop` control center
  desktop/                        — Tauri v2 Windows installer (spawns agentop as sidecar)
```

## Architecture

```
packages/server/bin/cli.ts  (binary entry point — agentop)
  ├── agentop (bare) / start → server/cli-start.ts → @agentistics/tui/control (the full-screen control center: Services / Setup / Logs / Cheat sheet / Help / Contribute; EN default + pt-BR toggle; opens on Setup when the machine is unconfigured). Non-TTY stdin falls through to `server`; without a terminal bare `agentop` prints the help instead
  ├── agentop setup        → server/cli-setup.ts (the same solo/central/member wizard, non-interactively scriptable and as the control center's Setup tab)
  ├── agentop server       → server/index.ts + server/otel-watcher.ts (always together)
  ├── agentop restart …    → bounce a mode's service (`server`/`watch` → systemd; `central` → central.sh restart; `--all` → cli-start.ts restartAllServices over every running service). `--rebuild` rebuilds before restarting instead of just bouncing (`central` → `up`; machine → `compose up -d --build`; `server`/`watch` → `rebuildNativeBinary()`, i.e. `bun run bin`, which needs the repo checkout — outside one it says so and restarts the existing build)
  ├── agentop tui          → @agentistics/tui (Ink dashboard; language resolved via cli-lang.ts)
  ├── agentop watch        → server/otel-watcher.ts (daemon only)
  ├── agentop central …    → server/cli-central.ts (wraps central.sh: up/init/down/logs/status/restart/pull)
  ├── agentop member …     → server/cli-member.ts (connect/leave/status; whoami-verified, no browser)
  ├── agentop ci-push      → server/ci-push.ts (one-shot GitHub Actions runner → central push; env AGENTISTICS_CENTRAL_URL/AGENTISTICS_CI_TOKEN)
  ├── agentop autostart …  → server/autostart.ts (systemd user service + linger + ~/.bashrc + ~/.zshrc update-check hook)
  ├── agentop upgrade      → server/upgrade.ts
  └── agentop check-update → server/version.ts (prints a banner only when outdated; silent otherwise)

packages/server/server/index.ts (Bun, port 47291) — thin entry point
  └── delegates to server/ modules (see below)

packages/server/server/          — server-side modules (never bundled by Vite)
  ├── config.ts            → path constants + PORT (api+mcp, 47291) + WEB_PORT (dashboard, PORT+1=47292); binary mode binds BOTH
  ├── utils.ts             → createLimiter, safeReadJson, safeReadDir, safeStat
  ├── git.ts               → decodeProjectDir, getGitFileStats, getProjectGitStats
  ├── jsonl.ts             → parseSessionJsonl, makeEmptySession, classifyAgentFile, EXT_TO_LANG
  ├── health.ts            → runHealthChecks, analyzeToolHealthIssues
  ├── rates.ts             → pricing scraper + BRL rate cache
  ├── sse.ts               → SSE clients, chokidar watcher, serveStatic, maybeSpawnWatcher
  ├── archive.ts           → mirrorFile, fullSync, snapshotStatsCache ('full' mode: raw transcript mirror → ~/.agentistics/archive)
  ├── consolidate.ts       → writeConsolidated, loadConsolidated ('consolidate' mode: per-session metrics → ~/.agentistics/sessions/<harness>/<id>.json; legacy flat files load as claude)
  ├── data.ts              → loadSessionMetas, scanProjects, buildApiResponse (main orchestrator)
  ├── agent-metrics.ts     → extractAgentMetrics (parses Agent tool_use from JSONL)
  ├── otel-watcher.ts      → chokidar file watcher + OTLP metrics export daemon
  ├── preferences.ts       → ~/.agentistics prefs incl. team config (mode/endpoint/token/user)
  ├── version.ts           → getVersionInfo (current vs latest); drives update banners/notifications
  ├── autostart.ts         → systemd user service + loginctl linger + ~/.bashrc + ~/.zshrc update-check hook
  ├── cli-setup.ts / cli-central.ts / cli-member.ts → the agentop setup/central/member command handlers
  ├── cli-start.ts         → the control center's HOST (`ControlHost`): service detection, start/stop/restart, connect/disconnect, boot service, archive consent, language — every action returns an already-localized `ActionResult` instead of printing
  ├── cli-stream.ts        → the control center's OUTPUT CHANNEL: subscribers + `streamCommand` (both pipes captured, never `inherit`) → lines via the pure `@agentistics/tui/control/stream`
  ├── cli-ui.ts            → dependency-free arrow-key select/confirm/input/pause + clearScreen (bundles clean into the binary; no node_modules to resolve)
  ├── cli-i18n.ts          → EN/PT strings the HOST produces (CLI is English by default; language follows --lang / preferences.lang / the in-app toggle). The control center's own chrome strings live in tui/src/control/i18n.ts
  ├── team-tokens.ts       → mint / rotate / revoke / validate tokens (stored as sha256 hashes only)
  ├── mongo-dates.ts       → **the date boundary**: BSON `Date` in Mongo, ISO string on the wire. Pure toBsonDate/fromBsonDate(+OrNull)/toBsonDates/fromBsonDates + `DATE_FIELDS` (every stored timestamp, by collection) + `migrateStringDatesToBson()` (idempotent, runs at boot; also `scripts/migrate-mongo-dates.ts`)
  ├── team-store.ts / team-stats.ts → Mongo team-session doc shape + per-member statsCache store
  ├── team-ingest.ts       → POST /api/team/ingest → upsert + triggerSseNotification (real-time central)
  ├── team-source.ts / team-admin.ts → central-side team read for buildApiResponse + members-panel admin routes
  ├── team-uploader.ts     → member→central push: sent-state, sync-signature auto-reconcile, push-on-change (notifyDataChanged), auto-reset on revoke, /api/team/status pill
  ├── account-repos.ts     → **pure**: buildAccountRepoList (central grouping) + findStillShared (the MACHINE-side intersection). A machine asks the central what repositories it holds FOR ITS ACCOUNT (`GET /api/team/account-repos`, team-account-repos.ts) — a question naming no repository and carrying no rule — and compares locally, so it learns a sibling still shares a repo it hid without disclosing anything
  ├── team-elsewhere.ts    → member side of that: TTL-throttled fetch + cache → ConnectionStatusEntry.elsewhere (same-origin) → the orange banner on the connection card
  ├── (core) siblingRules.ts → **pure** `@agentistics/core`: the REVERSE warning's arithmetic — `bucketSharedBy` (is this repo/project bucket shared by these announced rules?) + `siblingsRestricting` + `mergeSiblingFacts`. It may **never** be derived from the central: a sibling that hides a repo simply leaves the central without it, and absence is ambiguous between "restricted" and "never cloned", so the ONLY sound source is the sealed envelope inbox. `bucketSharedBy` is a second implementation of a privacy rule, so `share-rules.test.ts` cross-checks it against `sessionShared` over every mode x dimension x bucket combination — `share-rules.ts` stays the single source of the semantics. **Projects correlate across machines by FOLDER NAME** (`projectNameKey`: `\`→`/`, trailing separators stripped, final segment, case folded — case because WSL/Windows machines share these accounts), because the same project sits at a different path on every machine and full-`project_path` comparison correlates almost nothing. **That is the CROSS-MACHINE key only**: `bucketSharedBy` and the stored rules stay EXACT, or a local rule denying `/home/a/x/proj` would silently widen to every project named `proj` — `shareBucketKeys` (exact) and `crossMachineKeys` (correlation) must stay separate, and a test fails if the exact predicate is widened. It is a heuristic (`api`, `web`, `docs` collide), so `siblingsWithholding` reports the sibling's OWN path when the announcement carries one, and the UI says "a project with this name"
  ├── (core) proposalApply.ts → **pure** `@agentistics/core`: `planProposalApply` — applying a sibling's proposal may only ever NARROW what this machine shares. It composes the two rule sets as their INTERSECTION per mode pair (denylist+denylist → union of denials; anything with an allowlist → an allowlist), never replacing the recipient's rules with the sender's snapshot: that lifted every restriction the sender did not happen to hold, which is the button that hides things starting to share hidden ones. The denylist+allowlist pair has NO single-rule-set intersection ("share only P, except D"), so the merge keeps only the sources that provably cannot overlap a local denial — denial wins across dimensions, and a bare repo allow would re-open a session sitting in a denied project. `share-rules.test.ts` cross-checks the whole table against `sessionShared`, THROUGH the ambiguous-directory (`conflicts`) clause the plan deliberately does not model — it only ever removes sharing. **A source names a bucket on ONE dimension while `sessionShared` decides on BOTH**, so the plan's `stopsSharing` is held to the joint reading (nothing of the row ships afterwards, something did before) and rows the rules alone cannot settle are demoted to `partlyRestricts`, which the UI may only render as "no longer listed" — deciding it by membership once named a project that kept shipping through its repository, a false sentence in the REASSURING direction at the moment of the decision. `proposalAddsNothing` is the same arithmetic read as a question: **an announcement that would add nothing to the recipient's rules is not a proposal** and raises no card and no `member.rules_proposed` — otherwise applying one announces back and the two machines offer each other the same rules forever. It suppresses the OFFER only; the FACT still lands in `siblingRules`
  ├── envelope-crypto.ts   → **pure** sealed envelope: X25519 (ephemeral + static-static DH) → HKDF-SHA256 → AES-256-GCM, whole header as AAD. **Binding is only half the job — `open` REQUIRES the caller to state the sender the transport claimed, this machine's id and the connection's instanceId, and refuses any disagreement with the sealed header BEFORE any key agreement**; it also bounds `createdAt` and refuses a sender key that differs from the PINNED one. Those checks, not the cipher, are what make an invented identity or a substituted key visible. The pin is looked up by the id INSIDE the seal, never the one beside it
  ├── envelope-message.ts  → **pure**: the one message kind (a restriction proposal) + decidePin (trust on first use)
  ├── envelope-keys.ts     → this machine's keypair (0600, never logged/audited/returned) + per-connection peer pins
  ├── envelope-store.ts / envelope-routes.ts → central `machineKeys` + `envelopes` collections and /api/team/keys + /api/team/envelopes. Sender stamped from the token; recipient must be a machine of the caller's own ACCOUNT (`allowedRecipients`)
  ├── envelope-client.ts   → member: publish key, pin peers, seal on a rules change, collect + decrypt. Never applies anything. **A sender absent from the key directory is refused even when unpinned** (omitting a machine is the cheaper twin of fabricating one — no pin means no pin-comparison and no notification), and **every first-time pin is announced** (`member.peer_pinned`) — a central need not substitute a key, it can INVENT a machine under one it holds, so trust may be automatic but never silent. One unusable directory key is skipped and counted, never thrown (an unguarded `seal` in the peer loop was a free, silent off-switch for the whole channel)
  ├── envelope-inbox.ts / envelope-proposals.ts → decrypted, NOT-YET-APPLIED proposals + GET/DELETE /api/team/proposals (capability-guarded: it returns a sibling's full source list). **There is deliberately no apply path**: applying is the ordinary PATCH /api/team/connections/:id a user's click performs. `openedDigests` (sha256 of ciphertext+tag, NOT the central-minted id) is the replay memory and **survives dismissal** — otherwise a permissive pre-restriction envelope could be replayed as a one-click downgrade. The inbox also holds `siblingRules` — the **FACT** each envelope carries (what that machine announced about its OWN rules), stored apart from the **PROPOSAL** because they have different lifetimes: dismissing "apply this here" must not erase "the sibling withholds this". Superseded per `machineId` (each message is a full snapshot, which is how a sibling that LIFTS a restriction retracts the fact); a machine that goes QUIET never retracts, and rules applied before the channel existed were never announced
  ├── team-watch.ts        → central watches the team collection → SSE refresh (fallback)
  ├── team-repos.ts        → central repo registry (`repos` collection): registerRepo (mints a repo-bound CI token + records name/remote; re-register rotates), listRepos, unregisterRepo
  ├── ci-push.ts           → `agentop ci-push`: one-shot push of an ephemeral GitHub Actions runner's ~/.claude metrics to a central; prefers keyless OIDC (fetches the runner's id-token), falls back to a static token; never fails the CI job on a push error
  ├── team-oidc.ts         → verifies GitHub Actions OIDC JWTs (jose createRemoteJWKSet + jwtVerify; issuer/audience/expiry) for keyless CI ingest; pure helpers pickCiClaims/looksLikeJwt/ciMemberId
  ├── team-agent.ts / team-agent-client.ts → reverse-channel WebSocket: WS-authoritative presence signals, ping/pong latency, on-demand chat fetch
  ├── team-presence.ts     → computePresence (WS-authoritative online/offline + latency; heartbeat only for pure-HTTP members)
  ├── tags-store.ts        → Mongo CRUD for the `tags` collection (TagDoc: name/color/sources/sharedWith/createdBy) + visibleTagsFor(canRead)
  ├── tags-resolve.ts      → **pure**: sessionMatchesTag / resolveTagSessions / sessionInWindow — a tag's sources (`repo` | `project` | `machine` | `team` | `account`) resolve to a deduped session SET (union/OR, counted once)
  ├── tags-aggregate.ts    → **pure**: aggregateSessions() → headline numbers (costUSD via calcCost, sessions, tokens, top project/model/harness)
  ├── tags-detail.ts       → **pure**: aggregateTagDetail() → distributions (projects/models/harnesses/repos/members), daily series, activity window, distinct member/machine counts — counts and sums only
  ├── tags-authority.ts    → **pure** gates: canSeeSource / canWriteTagSources (Rule 1) / canReadTag + redactBuckets / redactTopValue / **redactSources** (any key OR source value the viewer cannot see is collapsed into `__other__` / `__hidden__` — without redacting the source list the bucket redaction is bypassable by reading `tag.sources`)
  ├── tags-handlers.ts     → GET/POST/PATCH/DELETE /api/tags and GET /api/tags/:id; the only tags module touching Mongo or auth (`tags:write` required on every write; unknown tag → 404, never 403)
  ├── central-config.ts    → Mongo central config: instanceId + pushIntervalSec + includeOfflineData
  ├── adapters/types.ts    → HarnessAdapter contract + getEnabledAdapters() (async, memoized) registry + harnessEnabled(id)
  ├── adapters/claude.ts   → wraps the existing Claude pipeline behind the HarnessAdapter contract (zero behavior change)
  ├── adapters/codex.ts    → Codex CLI reader (~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl)
  ├── adapters/codex-parse.ts → pure parser for the Codex envelope format → SessionMeta (harness: 'codex')
  ├── adapters/gemini.ts   → Gemini CLI reader (~/.gemini/tmp/<project>/chats/*.jsonl + projects.json)
  ├── adapters/gemini-parse.ts → pure parser; only counts chats with genuine content (a real user message or model response), dropping bootstrap-only stub files; session_id is unique per chat file
  ├── adapters/copilot.ts  → Copilot CLI reader (~/.copilot/session-state/<id>/events.jsonl + workspace.yaml)
  ├── adapters/copilot-parse.ts → pure parser (session.start context, user.message, assistant turns, MCP, activity hours)
  ├── adapters/kimi.ts     → Kimi Code CLI reader (~/.kimi-code/sessions/<ws>/session_<id>/ + session_index.jsonl)
  ├── adapters/kimi-parse.ts → pure parser; counts tokens from `usage.record` ONLY (the nested `step.end` events repeat the same usage byte-for-byte), strips the provider prefix from the model alias, folds every agent of a session into it
  ├── adapters/antigravity.ts → Antigravity CLI (agy) reader (brain/<conv>/.system_generated/logs/transcript_full.jsonl + the global history.jsonl + READ-ONLY bun:sqlite reads of conversations/<conv>.db `gen_metadata` and the optional conversation_summaries.db)
  ├── adapters/antigravity-parse.ts → pure parser; skips replayed CONVERSATION_HISTORY steps and dedupes by step_index (no double counting), never treats a slash command as the first prompt, counts ERROR_MESSAGE steps, derives files/lines from the edit payloads, and drops a conversation only when it is a proven invoke_subagent child
  └── adapters/antigravity-protobuf.ts → **pure**, dependency-free protobuf wire reader for the gen_metadata blobs (tokens + model id); never throws — malformed input yields null

packages/web/src/ (React + Vite, port 47292 in dev)
  ├── lib/
  │   ├── app-context.ts        → AppContext interface (React context type shared by all pages)
  │   ├── componentCatalog.tsx  → catalog of all components available in the custom layout builder
  │   ├── chatModels.ts         → web-only model list
  │   ├── chatSounds.ts         → 5 synthesized notification sounds via Web Audio API (Ping, Chime, Soft, Bell, Pop)
  │   ├── notifications.ts      → notification store (useSyncExternalStore) + render-time pt/en i18n (NOTIFICATION_TEXT keyed by code, interpolates meta)
  │   └── harness.ts            → HARNESS_LABELS, HARNESS_COLORS, capable(harness, metric), HARNESS_INFO (data-source/contains/missing/note metadata for HarnessInfoPanel)
  ├── hooks/
  │   ├── useData.ts            → fetches /api/data + SSE subscription + useDerivedStats() + computeHarnessSummaries()
  │   └── useCustomLayout.ts    → custom layout state: named layouts, pinned projects, persistence
  ├── pages/
  │   ├── HomePage.tsx          → main dashboard (KPIs, charts, sessions)
  │   ├── CustomPage.tsx        → custom layout builder (/custom route)
  │   ├── CostsPage.tsx         → cost deep-dive page
  │   ├── ProjectsPage.tsx      → projects overview page
  │   ├── RepositoriesPage.tsx  → repositories overview (/repositories): cards grouped by normalized git remote (RepositoriesList) so the same repo unifies across devs/paths/machines. **Only repos WITH a remote are shown by default** — remote-less sessions can't be attributed to a repo (and would split the same repo's metrics across machines), so they're hidden behind an "Unlinked · N" toggle. Links to /repo/:id
  │   ├── RepoDetailPage.tsx    → per-repo detail (/repo/:id): scopes a repo via an overridden `repos` filter (no global filter mutation) + tabs Overview/Members/Actions/Sessions/Dynamic Workflows. The "Actions" tab shows only when the repo has CI sessions; the "Dynamic Workflows" tab shows only when the repo has workflow runs from a `dynamicWorkflows`-capable harness, and renders each run as a step-by-step timeline (phases → agents) with a harness badge, and offers an "All / By session" view toggle that groups runs per session (see `lib/workflowSteps.ts` `buildWorkflowSteps` + `groupRunsBySession`)
  │   ├── ActionsPage.tsx       → /repositories/actions: all CI-runner sessions (SessionMeta.ci) grouped by repo — the GitHub Actions submenu of Repositories
  │   ├── TagsPage.tsx        → tags overview (/tags): a card per visible tag (GET /api/tags, aggregate-only) in a **grid or list** layout (persisted; grid ~6 metrics, list ~10), plus a create/edit drawer for principals with `tags:write` (source picker adds on pick, with a bulk checkbox mode beside it; searchable share-with). Clicking a tag navigates to /tags/:id
  │   ├── TagDetailPage.tsx   → per-tag detail (/tags/:id) fed by GET /api/tags/:id: KPI row (cost, sessions, tokens, **distinct members + machines**), activity chart, ranked distributions (projects/repos/models/harnesses/machines), per-source breakdown, and a **Who has access** panel split by category — owners / creator / shared-with, each stating its own permission. Pencil + trash (ConfirmModal) when the viewer may edit
  │   ├── ToolsPage.tsx         → tools breakdown page
  │   ├── HarnessPage.tsx       → generic per-harness dashboard at /h/:harness (validates param; sets harness filter; tab bar: "Overview" = dashboard, "Data & sources" = HarnessInfoPanel); replaced the old hardcoded CodexPage
  │   └── ComparePage.tsx       → unified side-by-side comparison at /compare (per-harness colors; N/A for incapable metrics; sessions/messages/tokens/cost + comparatives: usage-by-hour with peak hour, busiest day-of-week, activity-over-time sparkline, peak token day / peak session cost)
  └── components/               → UI (charts, cards, heatmap, modals, PDF export)
      ├── HarnessInfoPanel.tsx  → inline panel explaining each harness's data sources / what's captured / what's missing (and why) / caveats; driven by HARNESS_INFO in lib/harness.ts
      ├── PreferencesModal.tsx  → unified Settings modal with tabs: Preferences / Live / Install (Environment tab removed)
      ├── TeamLogin.tsx / TeamMembers.tsx / TeamSettings.tsx → central: password login, members panel (mint/rotate/revoke/rename + presence), team settings (interval/express, offline-data policy)
  ├── TeamRepos.tsx         → central admin panel rendered in its own **"GitHub Repositories"** Settings tab (central-only, separate from the Team tab): register/unregister repos (POST/DELETE /api/team/repos) + generates a ready-to-paste GitHub Actions workflow snippet + `gh` setup commands with the minted CI token
      ├── team/siblingWarnings.ts + SiblingWithheldBadge.tsx → the REVERSE sharing warning at the point of decision, in the rules picker: a per-row badge naming the sibling machines that withhold a row (readable BEFORE the switch is flipped) plus a `role="status"` block listing exactly the rows this edit STARTS sharing (the draft's was-off-now-on set). It **warns, never blocks**, and it always renders the best-effort caveat beside the list — this machine knows only what siblings announced to it, so **an absent warning is never proof that no machine restricts a repository**. The projects tab additionally carries the folder-name caveat and shows the sibling's own path, and its copy says **"a project with this name"** — never "this project", which would assert an identity a basename match never established
      ├── DeployCentral.tsx / PresenceFilter.tsx / MemberConnectionStatus.tsx → central deploy help, online/offline member filter, member-side connection pill
      └── NotificationToasts.tsx / NotificationBell.tsx / UpdateModal.tsx → auto-dismiss toasts, header bell (history + unread badge), mode-aware upgrade modal

packages/core/src/              — shared across server + web + mcp (import as @agentistics/core)
  ├── types.ts              → all shared types + pricing functions (single source of truth)
  ├── format.ts             → shared display helpers: fmt(), fmtCost(), fmtDuration()
  ├── i18n.ts               → PT/EN translations
  ├── otel.ts               → OpenTelemetry helpers
  ├── chatUtils.ts          → TOOL_LABELS, formatToolName, etc.
  └── index.ts              → barrel re-export of everything above

packages/server/scripts/embed-dist.ts
  └── Reads packages/web/dist/ after vite build and generates
      packages/server/server/embedded-dist.generated.ts
      (assets embedded as strings/base64 for the compiled binary)
```

## Multi-harness tracking

Agentistics tracks sessions from multiple AI coding assistants (harnesses), not just Claude Code.

### Harness model

- `SessionMeta.harness: HarnessId` tags every session with its origin (`'claude' | 'codex' | 'gemini' | 'copilot' | 'antigravity' | 'kimi'`). Missing/legacy sessions default to `'claude'`.
- `AppData.harnesses: HarnessId[]` lists which harnesses have data present, used by the frontend to decide whether to show the harness selector in the nav (shown only when >1 harness is active). Selecting "All" yields the unified view.
- Each harness is implemented as a `HarnessAdapter` module under `server/adapters/` — never a separate package. `getEnabledAdapters()` lazily resolves and memoizes available adapters; individual adapters can be disabled via `AGENTISTICS_HARNESS_<ID>=0`.

### The harness contract — read `docs/harness-contract.md`

`docs/harness-contract.md` defines what each metric MUST MEAN across every harness (time, cost,
tokens, capabilities, filters, timestamps, purity). The checklist below is the mechanical half —
which files to touch. Do both: a harness that compiles and reports a metric computed its own way
is a bug, not a variation.

### Adding a harness — the complete checklist

Every point below is load-bearing; skipping one has, historically, produced a harness that compiles
clean and is then silently missing from half the product.

1. **`HarnessId`** (`packages/core/src/types.ts`) — add the id. This is what makes the compiler find
   most of the rest for you.
2. **`HARNESS_CAPABILITIES`** — a `Record<HarnessId, …>`, so the build fails until you declare it.
   Be honest: a capability set to `true` that the harness cannot actually produce renders a
   confident `0`, which is worse than `N/A`.
3. **`HARNESS_SORT`** (same file) — the Record behind `HARNESS_ORDER`. **Never hardcode a harness
   list anywhere else.** Five places used to, as plain arrays, and TypeScript accepts an array
   literal with a member missing: a new harness vanished from the Compare page, the filter bar, the
   data-source list and the consolidate store while the build stayed green.
4. **Adapter** — `packages/server/server/adapters/<id>.ts` (I/O) plus `<id>-parse.ts` (pure), and
   register it in `adapters/types.ts`. Add a data-dir constant to `config.ts` following the existing
   env-override pattern.
5. **Pricing** — usually nothing to do. Report the **bare model id** (strip any `provider/` prefix,
   as `kimi-parse.ts` does) and the shared table prices it. Only if the harness introduces a new
   vendor, add it to `PROVIDERS` (`packages/core/src/providers.ts`, which documents this) and its
   models to `MODEL_PRICING` with **verified rates and a dated source comment**. Never guess a rate:
   a wrong price is worse than a missing one, and a missing one is visible — Settings → Pricing
   lists any model of yours that no source can price.
6. **Live sessions** (`live-sessions.ts`) — add the process name to `PROCESS_HARNESS`; if the CLI
   keeps its session file open, add a pattern to `FD_SESSION_PATTERNS` for exact identity; if it
   resumes by id, add the flag to `ID_FLAGS` and the command to `RESUME_BY_HARNESS`
   (`web/src/lib/resumeCommand.ts`) — verified from the tool's own `--help`, never guessed.
7. **Frontend** — `HARNESS_LABELS`, `HARNESS_COLORS`, `HARNESS_PROVIDERS` and a full `HARNESS_INFO`
   entry (EN + PT) in `web/src/lib/harness.ts`.
8. **Timestamps** — bucket activity hours on the **local** clock (`getHours()`), like every other
   adapter. Reading a UTC timestamp as local put the peak-usage chart hours off for four harnesses.
9. **Time** — emit `TurnEvent[]` and call `activeMinutesOf()` (`packages/core/src/activeTime.ts`)
   for `SessionMeta.active_minutes`; never compute duration in the adapter. Prefer a duration the
   harness measured itself, reconstruct from timestamps otherwise, and set `activeTime: false` only
   when the transcript has no usable timing at all. See `docs/harness-contract.md` § 1 — in
   particular, do NOT add an idle-gap threshold.
10. **Docs** — this file, `docs/harness-contract.md`, plus any `docs/` page enumerating harnesses.

### Pricing — three layered sources, and the built-in table is the floor

Costs come from `MODEL_PRICING` (compiled in), the LiteLLM community dataset, and the vendors' own
pages (Anthropic in `rates.ts`; OpenAI and Google in `pricing-official.ts`), merged in that order of
trust by `rates.ts` — so a source that fails or returns junk costs
freshness, never the ability to price anything. Every community row is validated first
(`pricing-community.ts`): non-positive costs, missing pairs, values implying a unit change, and
prices more than tenfold from the built-in figure are dropped. That dataset really does publish a
model at a cost of ZERO, which imported verbatim would make those sessions free.

Scraping a vendor page is **anchored**: OpenAI publishes every model four times (Standard / Batch at
half price / Flex / Priority at double) and Google repeats a table block per tier, with nothing in
the markup that reliably marks the standard one. A parsed block is adopted only if a model whose
rate was verified by hand comes out at the expected figure, so a page redesign yields NOTHING and
falls back, instead of yielding numbers that look right and are half wrong. Read cells positionally,
never by counting dollar signs — OpenAI writes "-" for no cache-write charge, and counting amounts
then reads output out of the wrong column.

Each model carries its origin (`official` / `community` / `builtin`), surfaced per row in
**Settings → Pricing**, which lists **only models this machine has actually used** — a new one joins
the list by itself the first time it appears in a session, with no code change. Group headings come
from `resolveProvider`, because a provider is a billing entity and a harness is not: Codex and
Copilot both run OpenAI models, Antigravity runs Google's and Anthropic's.

### N/A vs real 0 — `HARNESS_CAPABILITIES`

`HARNESS_CAPABILITIES` in `@agentistics/core` (`packages/core/src/types.ts`) is the single source of truth for which metrics each harness can produce. When a capability flag is `false`, the frontend renders "N/A" via the `NAtag` component + `capable(harness, metric)` helper (re-exported from `lib/harness.ts`), rather than showing a misleading 0. Current limitations: Codex and Gemini do not produce agent metrics or git line counts. **Antigravity produces `tokens`/`cost`/`model`** (decoded from the `gen_metadata` protobuf in `~/.gemini/antigravity-cli/conversations/<id>.db`, cost via the standard pricing table) and `gitLines` (edit deltas computed from the transcript's edit payloads, not `git diff`); it has `agents: false` because an `invoke_subagent` child is its own conversation, not an agent invocation on the parent. `dynamicWorkflows` (runs of the multi-agent orchestration Workflow tool) is `true` only for `claude` — it gates the repo-detail "Dynamic Workflows" tab.

### Aggregation — stats-cache.json is Claude-only

`stats-cache.json`, `dailyModelTokens`, and `modelUsage` inside it are populated exclusively by Claude Code and must never be used to aggregate non-Claude data. In `useDerivedStats`, a non-Claude harness is aggregated purely from per-session data. The unified view = Claude statsCache totals + per-session sums of non-Claude sessions. Non-Claude sessions are merged in `data.ts` **after** `supplementStatsCache` runs so Claude totals are never corrupted.

### Codex envelope format

Codex JSONL files wrap events in `event_msg` / `response_item` envelopes; the semantic event type lives at `payload.type`. Token usage is at `payload.info.total_token_usage` (cumulative — last seen wins). Codex `input_tokens` includes the cached portion, so the parser stores non-cached input (`totalInput - cached`) in `input_tokens` and the cached portion in `cache_read_input_tokens` separately.

### Antigravity (agy) — shares ~/.gemini, but is a separate harness

Antigravity lives at `~/.gemini/antigravity-cli` (inside the Gemini CLI home) while the Gemini
adapter reads only `~/.gemini/tmp` — the two never overlap or double-count. Per-conversation
transcripts are step-based JSONL at
`brain/<conversation-id>/.system_generated/logs/transcript_full.jsonl` (`transcript.jsonl` is the
truncated fallback); the project path (`workspace`) and the raw prompts live in a single GLOBAL
`history.jsonl`. Parser rules: `CONVERSATION_HISTORY` steps are replays and are skipped, steps are
deduped by `step_index`, `type: 'slash_command'` / `/foo` prompts never become `first_prompt`, and
a conversation with no genuine user turn is dropped (same principle as the Gemini stub filter).

**Tokens / model / cost are REAL for agy.** They come from `conversations/<conversation-id>.db`
(SQLite), table `gen_metadata`, column `data` — a protobuf blob per LLM call, decoded by the pure,
dependency-free `adapters/antigravity-protobuf.ts`. Verified wire layout:
`1.4.1` input, `1.4.2` cache read, `1.4.3` output, `1.4.5` context-size gauge, `1.4.9` thinking,
`1.4.10` completion, `1.19` technical model id, `1.21` display name. Rules:
- **`1.4.3` already includes `1.4.9`** — never add thinking on top of output.
- **`1.4.5` is a gauge, never a sum** — it is the context size at that call.
- agy records **no cache-write** counter, so `cache_creation_input_tokens` stays 0.
- `model` is the dominant `1.19` across the conversation's rows (e.g. `gemini-3.6-flash`; agy can
  also drive Claude models, e.g. `claude-opus-4-6-thinking`). **Cost is `calcCost()` only** —
  `MODEL_PRICING` must resolve the id or the Sonnet fallback would report wrong money.
- The DB is opened **read-only** via `bun:sqlite` in the (impure) adapter; `antigravity-parse.ts`
  stays pure and receives the decoded totals. Missing / locked / corrupt DB → zero tokens, never a
  throw.

**Subagent children are detected intrinsically, never from `history.jsonl`.** `history.jsonl` is a
CLI prompt history that rotates and can be cleared, so it is only a hint (first prompt + workspace)
— it must never be the reason a conversation with a real transcript is dropped. A conversation is
excluded only when it appears in `buildAntigravityChildSet()`, built from (a) the parent's own
`INVOKE_SUBAGENT` step, whose content lists each child's `conversationId`, and (b)
`conversation_summaries.db` rows with `parent_conversation_id` / `nesting_depth > 0` when that table
has rows (it is frequently empty). Children are never rolled up into the parent — each has its own
DB and would double-count.

**Errors and edits.** Every agy step carries `status: "DONE"` even when it failed, so the dedicated
`type: "ERROR_MESSAGE"` step (with `error` / `error_code`) is the primary error signal; the
ERROR_MESSAGE / non-zero `exit_code` / `status ERROR|FAILED` checks are **mutually exclusive** so one
failed step can never increment `tool_errors` twice. `files_modified` is the count of DISTINCT
`TargetFile` paths from the write tools (`write_to_file`, `replace_file_content`,
`multi_replace_file_content`, …) plus the `file://` path named by a `CODE_ACTION` step, and
`lines_added` / `lines_removed` are newline counts of `CodeContent` / `ReplacementContent` vs
`TargetContent` (hence `gitLines: true` — these are edit deltas, not `git diff`; agy stores no git
metadata).

**No chat driver.** `chat-drivers/` spawns a CLI in non-interactive *streaming* mode and needs a
machine-readable event stream (`-o stream-json`), a session id and MCP registration. `agy` offers
`--print` but no structured output format, no session-id emission and no documented MCP config, so a
driver cannot be written that is trivially correct — reading `transcript_full.jsonl` after the fact
is a different (and racy) contract. Deliberately not added.

### Kimi Code (agy's neighbour in spirit, not on disk)

Kimi Code CLI lives at `~/.kimi-code`. Each session is a directory
`sessions/<workspaceId>/session_<uuid>/` holding `state.json` (title, `workDir`, `createdAt`,
`updatedAt`, the agent tree) and one `agents/<agentId>/wire.jsonl` event stream per agent — every
agent of a session folds into that one session, so sub-agent work is never dropped.

**Double-counting trap:** token counts appear TWICE in the wire — once as a top-level
`usage.record` and again inside the nested `context.append_loop_event → step.end`, byte-for-byte
identical (verified pairwise on real data). Only `usage.record` is counted. Records are per-turn
increments, not a running total (unlike Codex, where the last one wins).

Kimi ROUTES to other providers and stamps that provider's model on every usage record
(`google/gemini-3.5-flash-lite`), so `cost` is `true` and is a real calculation through the shared
pricing table — the adapter strips the provider prefix so the table can key on it. Kimi's own
`kimi-*` ids are not in `MODEL_PRICING` yet and would take the shared fallback rate like any unknown
id; add them when verified rates are published.

### Gemini caveat — bootstrap stubs vs. real sessions

Gemini CLI writes `~/.gemini/tmp/<project>/chats/*.jsonl` files but many are bootstrap-only stubs with no real conversation content. The Gemini parser (`adapters/gemini-parse.ts`) filters these out — only chats containing a genuine user message or model response are counted. Gemini's local files do not carry token/cost data; real Gemini token metrics would require OTel integration (Phase 3).

### Compare page — `computeHarnessSummaries`

`computeHarnessSummaries(data)` is an exported pure function in `hooks/useData.ts` that computes per-harness totals and comparatives (usage-by-hour, busiest day-of-week, activity-over-time, peak token day, peak session cost). Claude totals come from `statsCache` (full history); non-Claude totals are computed from per-session sums — so Compare page Claude numbers always match the main dashboard.

### Consolidate store namespacing

The consolidate store is namespaced by harness: `~/.agentistics/sessions/<harness>/<id>.json`. Legacy flat files at the root are read and treated as `claude`.

### Future phases

- **Phase 3** (planned): Gemini OTel integration for real token/cost data.

See `docs/superpowers/specs/2026-06-19-multi-harness-tracking-design.md` for the full design.

---

## Repository dimension (group by git remote)

Metrics can be grouped **by repository** (git remote) independent of the local path or which
machine produced them — so a repo's usage aggregates across all devs and CI agents. See
`docs/github-actions.md` for the GitHub Actions half.

### The key — `normalizeGitRemote` (single source of truth)

`normalizeGitRemote(url)` in `@agentistics/core` (`packages/core/src/types.ts`) collapses any
remote form (https / ssh / scp / git, with or without credentials/port/`.git`) into a stable,
**protocol-less** key `host/org/repo` (e.g. `github.com/org/repo`). Host is lowercased, path case
preserved. Returns `''` for local paths / `file://` / junk. **Never key repos by anything else.**
`repoShortName(remote)` drops the host for display (`org/repo`).

### How it's captured and threaded

- `git.ts getGitRemote(projectPath)` reads `remote.origin.url` (same Windows/WSL + no-prompt guards
  as the stats helpers) and normalizes it.
- `data.ts scanProjectDir` resolves the remote once per project and **stamps `SessionMeta.git_remote`
  onto every session** (+ `ServerProject.gitRemote`). Because it lives on the session, the remote
  travels into the consolidate store → team uploader → Mongo — the central has no filesystem access
  to members' repos, so per-session is the only place it can live.
- Frontend: `useDerivedStats` builds `repoStats` (per-remote aggregate; `remote === ''` = the
  "no linked repository" bucket, never hidden) and honors a `Filters.repos` filter (scopes cost/
  tokens session-side like a project filter). `RepoStat` is exported from `hooks/useData.ts`.

### GitHub Actions — `SessionMeta.ci` + repo-bound tokens

An ephemeral Claude Code Actions runner pushes its metrics via `agentop ci-push` →
`POST /api/team/ingest`. Auth is **keyless GitHub OIDC** (preferred): the runner presents a
short-lived GitHub-signed JWT, the central verifies it against GitHub's JWKS (`team-oidc.ts`, uses
`jose`) and checks the `repository` claim against the **registered repos allowlist** — no secret is
stored. A **repo-bound static token** (minted by `POST /api/team/repos`) is the fallback. Either
way the central **authoritatively stamps** `git_remote` + `ci: true` + `user = github-actions` (via
`stampCiSessions`) — a runner cannot mis-report its repo. CI sessions are keyed by `ciMemberId`
(`repo:<remote>`). `ci === true` sessions power the **Repositories → Actions** view. Enable OIDC by
setting `AGENTISTICS_OIDC_AUDIENCE` on the central (the workflow requests that same audience).

Cloud runners need the central reachable without exposing the dashboard. `AGENTISTICS_INGEST_ONLY=1`
(config.ts) makes a central serve **only** `POST /api/team/ingest` (404 for everything else, checked
right after the OPTIONS handler in `index.ts`) — run it as a public ingest instance sharing Mongo
with a separate private dashboard instance. See `docs/github-actions.md`.

### Repository rules

- **`normalizeGitRemote` is the only way to key a repo** — never parse `project_path` strings.
- **`git_remote` lives on the session** (not only the project) so it reaches the central.
- **CI attribution is server-authoritative** — stamped from the repo token, never trusted from the
  runner's payload.
- **`stats-cache.json` stays Claude-only** — repo/CI aggregates come from per-session sums, same as
  every non-Claude dimension.

---

## Team mode

One machine ("central") aggregates coding-assistant usage metrics from many machines ("members"). Members push **computed metrics only** (session/agent/token/cost aggregates + their statsCache) — **never chat** (raw chat is fetched on demand over a reverse WebSocket, never stored centrally). The central runs as a Docker service (`central.sh` at the repo root, default port `48080`, Mongo **not** published to the host). See `docs/architecture.md` for the full write-up.

### Roles — `preferences.team.mode`

- **solo** — local only, nothing leaves the machine (default).
- **central** — the aggregator; serves the team dashboard behind a password.
- **member** — pushes computed metrics to a central's `/api/team/ingest`.

### Push model — central owns the cadence

The **central owns the interval** (`central-config.ts`, `pushIntervalSec`; normal floor 15s, default 30s, express down to 5s = `EXPRESS_MIN_SEC`). Members read it from `GET /api/team/policy` and can only follow it — no member-side override that goes faster. Plus **push-on-change**: the file watcher calls `notifyDataChanged()` in `team-uploader.ts` → a debounced push floored by the central's interval. Members push their **supplemented** statsCache (the one the local dashboard shows, gap-filled past the stale `lastComputedDate`), never the raw `~/.claude/stats-cache.json`, so central totals match the member exactly. A member push triggers `triggerSseNotification()` on the central → dashboards refresh live, which is why the **"Live" toggle is hidden on a central**.

### Member identity

The display **name is set by the central** on the minted token — there is no name field on the machine; the member resolves it via `GET /api/team/whoami`. Sessions are keyed centrally by a stable `memberId` (token sha256 hash), so renames preserve history. `agentop member connect` never writes a half-config on a bad token.

### Presence — WebSocket-authoritative

`team-presence.ts` computes online/offline from the reverse-channel WS registry in `team-agent.ts`: online while the socket is live, **offline within ~8s** of a kill (`SOCKET_GRACE_MS`); once a member has ever held a socket that signal is trusted; a heartbeat window is only the fallback for pure-HTTP members. Latency comes from WS ping/pong RTT.

### Auto-reconciliation (self-healing sync)

`team-uploader.ts` fingerprints the target as `sha256(endpoint \0 token \0 instanceId)`. When it changes — central DB wiped (`down -v` → new `instanceId`), token revoked+re-added, or endpoint changed — the member clears its sent-state and **re-pushes its full history** (idempotent upserts, no double-count). No manual `team-sent.json` deletion. A persistent 401/403 (revoked token) auto-resets the member back to **solo** and fires a "removed from central" notification. A `null` instanceId (old/unreachable central) never triggers a spurious reset.

### Notifications

`web/src/lib/notifications.ts` is an external store rendered by `NotificationToasts` (auto-dismiss) + `NotificationBell` (history + unread badge). Notifications carry a `code` (+ `meta`) and are localized **at render time** (`NOTIFICATION_TEXT`, pt/en). The server emits them over SSE via `broadcastNotification()`.

### Team-mode rules

- **Members never push chat** — only computed metrics + statsCache; raw chat is on-demand over the WebSocket. The ONE exception is `first_prompt` / `title`, which are chat-derived and DO travel; they are scrubbed by `redactSecrets` (`@agentistics/core`, `redact.ts`) at **two** boundaries: `selectDeltas` on the member (so a pasted credential never crosses the wire) and `toTeamDoc` on the central (because a central cannot assume its members run current code — in a mixed-version fleet the machine on the old build is exactly the one that leaks). The redactor is deliberately PRECISE, not exhaustive: `first_prompt` labels every session in the UI, so a rule that also ate `input_tokens=123` would make labels useless and get switched off. Generic `key=value` rules are guarded by a value-shape test; when in doubt it leaves text alone. It is a safety net for the accidental paste — **never a substitute for rotating a leaked credential**.
- **Tokens are stored only as sha256 hashes** (`team-tokens.ts`) and never logged; the central's session-cookie secret is **separate** from the dashboard password; auth compares are constant-time.
- **Non-Claude team metrics still come from per-session sums** — `stats-cache.json` remains Claude-only, on the central too (Compare-page Claude totals match the dashboard).
- **The member's deep Claude history exists ONLY aggregated** (`AppData.userStatsCaches`, keyed by
  display name) — the individual session docs cover a fraction of it. Any filter that cannot be
  expressed against those caches must NOT silently fall back to summing sessions, or the same scope
  reports a fraction of itself. `userStatsCaches` sums a member's machines under one name, so the
  **machine and team filters are served by `AppData.machineStatsCaches`** (the same caches keyed by
  machine id) via the pure `resolveMachineCacheScope()` in `@agentistics/core`. It returns `null` —
  meaning "fall back to the per-session sum" — whenever the caches cannot serve the scope exactly
  (unknown machine, missing cache), so precision is added, never invented. Project / repo / tag /
  model / date genuinely have no cache granularity and stay cache-blind (`cacheBlindScope`).
- **The central is the sole authority on the push interval** — members clamp to `max(central, EXPRESS_MIN_SEC)`; there is no faster member override.
- **`agentop central` runs from anywhere** — in a repo checkout it wraps `central.sh` (which does `build: .`); from the standalone binary (no repo) `cli-central.ts` falls back to a Docker-image path: it materializes a compose that pulls `ghcr.io/blpsoares/agentistics:<version>` + generates `central.env` into `~/.agentistics/central/` and drives `docker compose` directly. The image is published to GHCR by the `publish-image` job in `release.yml`. Override the image with `AGENTISTICS_IMAGE`.
- **Per-connection sharing rules — projects and repositories, denylist or allowlist, never on the
  wire.** A connection restricts what it receives across two dimensions (`repo`/`project`, plus
  the fixed `none` bucket for sessions with no resolvable repo) under one of two modes:
  `shareMode: 'denylist'` (share everything except `sources` — the default) or `'allowlist'`
  (share only `sources`). **`share-rules.ts` is the only place these semantics live** —
  `sessionShared(session, rules, index)` where `rules = { mode, sources }`; nothing downstream
  re-derives them. **Deny wins across dimensions in denylist mode**: matching a blocked repo denies
  a session even if its project is not listed. **`shareMode` absent reads as `'denylist'`** —
  every pre-existing config is one, and treating absence as anything else would silently invert
  live rules; `migrateTeamConfig` (`@agentistics/core/team.ts`) derives `{shareMode:'denylist',
  sources}` from a legacy `deniedRepos: string[]`, deterministically and idempotently, in the same
  read path Plan 1's migration already used. **`deniedRepos` is derived-on-write only, from Task 2
  onward** — it is kept solely as a read-migration source; any code that still *writes* it directly
  is a bug. The typed rules live only in `preferences.json`, the in-memory `TeamConnection`, and the
  browser tab on the machine's own origin; `IngestBody` gains no field for them, and
  `GET /api/team/status` exposes only `shareMode` + a per-dimension **count**
  (`deniedRepos`/`deniedProjects`, or `allowedCount` in allowlist mode) — never the values,
  same-origin only. The restricted statsCache (`buildSplitStatsCache`, `share-rules.ts`) is
  selected by the **declared** rule — `sourcesRestrict(conn.shareMode, conn.sources)`, where
  allowlist mode is ALWAYS a restriction (even an empty allowlist, the strictest case) and
  denylist mode is one only once it names a source — never by comparing a filtered count against
  an unfiltered one; a count comparison fails open on a cold consolidate store. **There is no
  fallback to the unsplit cache on the restricted path, ever** — when the split cannot be built
  faithfully, the push omits `statsCache` entirely rather than shipping the real one.
  **Allowlist mode still ships the prehistory rollup**: days at or before Claude's own
  `lastComputedDate` watermark cannot be decomposed by repository or project by anyone, so that
  block travels as unattributed daily volume in both modes — "share only X" narrows the
  decomposable window, not that rollup. The retroactive-removal trigger (`planRulesReconcile`,
  `team-rules.ts`) is **denial, never absence** — a session merely missing from a short store read
  is never treated as newly denied, which would ask the central to delete perfectly valid sessions
  and drop them from the sent-state forever. `stats-cache.json` stays Claude-only here too — the
  split's synthetic and rebuilt halves are both accumulated from Claude sessions only
  (`accumulateClaudeSessions`).
  See [docs/architecture.md](docs/architecture.md#per-connection-repository-sharing) and
  [docs/security.md](docs/security.md#8-per-connection-sharing-rules--the-guarantee-stated-precisely).

---

## Calculation functions — single source of truth

**All layers** use the same functions from `packages/core/src/types.ts` via `@agentistics/core`. Never inline pricing calculations.

### `MODEL_PRICING` — pricing table (USD per 1M tokens)

```
packages/core/src/types.ts
```

Update here when Anthropic changes prices or releases new models. Fallback (Sonnet 4.6: $3/$15) is the return value of `getModelPrice` when no match is found.

### `getModelPrice(modelId)` — resolves price by model ID

```
packages/core/src/types.ts
```

Tries exact match, then partial match via `startsWith` in both directions. Returns Sonnet 4.6 fallback if no match.

### `calcCost(usage, modelId)` — total cost from a usage record

```
packages/core/src/types.ts
```

Takes a `ModelUsage` object (input, output, cacheRead, cacheWrite in tokens) and returns cost in USD.

### `blendedCostPerToken(modelUsage)` — weighted average rate across models

```
packages/web/src/hooks/useData.ts
```

Used when there is no per-session model ID (project filter active, or per-session cost in PDF export). Weights each model's rate by its token volume in global usage.

### `serveStatic(pathname)` — serves embedded frontend assets

```
packages/server/server/sse.ts
```

Only active when `SERVE_STATIC=1` (set by `cli.ts` for the `server` subcommand). Reads from `embeddedDist` (generated at compile time). Returns `null` in dev mode.

---

## Where each layer calculates cost

| Layer | What it calculates | How |
|-------|--------------------|-----|
| `useData.ts / useDerivedStats` | Filtered `totalCostUSD` | `calcCost()` per model; `blendedCostPerToken()` when project or model filter is active and per-session breakdown is needed |
| `ModelBreakdown.tsx` | Per-model cost in the UI | `calcCost()` |
| `PDFExportModal.tsx` | Per-model cost in PDF | `calcCost()` |
| `PDFExportModal.tsx` | Per-session cost in PDF | `blendedCostPerToken(statsCache.modelUsage)` — sessions have no individual model field |
| `otel-watcher.ts` | Total cost exported via OTel | `calcCost()` from `@agentistics/core` |
| `packages/tui` | Cost in terminal output | `calcCost()` via the pure `selectors.ts` |
| `server/agent-metrics.ts` | Per-agent-invocation cost | `calcCost()` with per-invocation token breakdown |
| `server/rates.ts` | — | Does not calculate cost; only fetches/caches the external pricing table (`/api/rates`) |

---

## Agent metrics

Agent metrics are extracted from raw JSONL files by `server/agent-metrics.ts`. They are available in the `agentMetrics` field of each `SessionMeta`.

### Data available per Agent invocation

| Field | Source |
|---|---|
| `agentType` | `toolUseResult.agentType` in the JSONL message envelope |
| `description` | `tool_use.input.description` |
| `totalTokens` | `toolUseResult.totalTokens` |
| `totalDurationMs` | `toolUseResult.totalDurationMs` |
| `totalToolUseCount` | `toolUseResult.totalToolUseCount` |
| `inputTokens / outputTokens / cacheReadTokens / cacheWriteTokens` | `toolUseResult.usage.*` |
| `toolStats` (reads, searches, bash, edits, lines changed) | `toolUseResult.toolStats` |
| `costUSD` | Calculated via `calcCost()` |
| `status` | `toolUseResult.status` (`completed` / `failed`) |

### What is NOT available for Skills and Tasks

- **Skills** (`/commit`, `/review-pr`, etc.) are not recorded as individual tool_use events in the JSONL — only a `skill_listing` attachment appears. Skill invocations can only be inferred indirectly from subsequent tool calls.
- **Tasks** (`TaskCreate`/`TaskUpdate`) have subject/description/status but no token or duration data.

---

## Data flow

```
~/.claude/
  ├── stats-cache.json          → aggregated data (tokens/day, model, activity)
  ├── usage-data/session-meta/  → enriched sessions (preferred source)
  └── projects/**/*.jsonl       → raw files (fallback + agent metrics source)
         ↓
    packages/server/server/data.ts (buildApiResponse — main orchestrator)
    packages/server/server/agent-metrics.ts (extractAgentMetrics — parses Agent tool_use from JSONL)
         ↓
    /api/data → useData() → useDerivedStats() → React components
```

## Archive mirror (survives Claude's 30-day cleanup)

Claude Code deletes session transcripts (`~/.claude/projects/**/*.jsonl`) older than `cleanupPeriodDays` (default 30) on every startup, taking per-session detail + agent metrics + chat content with them (the `stats-cache.json` aggregates survive). Official docs: https://code.claude.com/docs/en/settings.

**Three modes**, persisted as `preferences.archiveMode` (`undefined` = not chosen → the consent gate blocks the app). `resolveArchiveMode()` / `getArchiveMode()` in `preferences.ts` migrate the legacy `archiveSessions` boolean (true→'full', false→'off'):
- **`consolidate`** *(recommended default)*: `data.ts` persists each computed `SessionMeta` (+agentMetrics) to `~/.agentistics/sessions/<id>.json` (~KB each, skip-if-identical), then on read **gap-fills** — sessions/projects no longer present live are revived from the store. No raw files duplicated. Trade-off: loses the raw chat text of deleted sessions and future recompute.
- **`full`** *(opt-in "archivist")*: additionally `archive.ts` mirrors raw transcripts into `~/.agentistics/archive/` (copy-if-newer; `archiveEnabled()` = mode==='full') and `data.ts` reads the union live+archive roots + `applyArchivedStats()` (per-date fill + per-field `max`, never additive). Heavy + grows unbounded; preserves everything incl. raw chat.
- **`off`**: nothing — uses `~/.claude` exclusively.

- **Consent gate**: `ArchiveConsentModal.tsx` blocks first load (links the official doc) — primary Yes(consolidate)/No(off) + an "Advanced" expander revealing full-copy. `App.tsx` early-returns the modal when `archiveChoice === null`; `chooseArchive(mode)` PUTs `archiveMode`. Env `AGENTISTICS_ARCHIVE=0` hard-disables everything; `AGENTISTICS_ARCHIVE_DIR` overrides the archive path.
- **No false metrics**: dedup by `session_id` (live always wins) + the `supplementStatsCache` guard (`day <= lastComputedDate` skip) mean revived old sessions show in lists/agent-metrics but never inflate aggregate totals. Boot + the PUT `/api/preferences` handler warm a build (persists the store) and `full` also runs `fullSync()`.

## Security rules

A central can be published on the internet. The model is documented in **`docs/security.md`**
(threat model, trust boundaries, request pipeline, limits of each control) and the deployment
runbook in `docs/exposure.md`. These rules are what keep it safe; each exists because its
absence was a real finding.

- **`exposure.ts` is the only place that decides what a profile may do.** `PROFILE` is
  `local` | `lan` | `public`, and `CAPS` derives from it. Never re-derive a capability from env
  vars at a call site, and never add an opt-in that re-enables host power on `public`.
- **Any new route that touches the host** — spawns a process, reads `~/.claude`, writes a
  dotfile — must be registered in `capability-guard.ts`. A route that is not registered is
  assumed harmless, so a missed registration is a vulnerability, not an oversight. The guard
  runs *before* the auth gate on purpose.
- **Any new `/api` route is authenticated by default.** Adding one to `AUTH_PUBLIC`
  (`index-routes.ts`) requires updating `authz-gate.test.ts`, which asserts the exact contents
  of that Set — that test IS the review gate.
- **Never return internal error text to a client** — use `safeError` (`errors.ts`). The client
  gets a code plus a correlation ref; the message goes to the log.
- **Never `await req.json()` on an unauthenticated route** — use `readJsonLimited` (`limits.ts`),
  which abandons an oversized body mid-stream instead of buffering it first.
- **Every authentication and admin action writes an audit event** (`audit.ts`). The pure builder
  redacts secret-shaped fields; never add a field that carries a credential.
- **The session secret is never derived from the dashboard password**, and cookies are
  `__Host-` prefixed + `SameSite=Strict` whenever they are Secure.
- **Rate-limit anything that can be guessed.** `rate-limit.ts` keys hard blocks per IP and soft
  backoff per account — per-account lockout must stay soft, or it becomes a DoS against a
  colleague.
- **Destructive operations require step-up.** Anything that deletes an account or team, edits an
  account (role and memberships live there) or mints/rotates/revokes a credential must be listed
  in `stepup.ts`; the web side calls `stepUpFetch`, never bare `fetch`. Reads stay on `fetch`.
- **`agentop doctor --exposed` must pass before exposing anything.** A check that could not be
  verified reports `fail`, never a reassuring `pass`.
## Terminal UI (`packages/tui`)

`agentop tui` is an [Ink](https://term.ink) (React for CLIs) application; bare `agentop` and
`agentop start` open the **control center**, a second Ink app in the same package. It replaced a
single 938-line hand-rolled ANSI file.

```
packages/tui/src/
  index.tsx          entry — runTui({ lang, port }); refuses non-TTY stdin with a message
  App.tsx            screen router, keybindings, overlays, applyHarnessFilter
  selectors.ts       PURE AppData -> view model (the tested core)
  i18n.ts            EN/PT terminal strings
  theme.ts           palette mirroring the web dark mode + HARNESS_COLOR
  useTerminalSize.ts columns/rows that follow SIGWINCH
  data/              useAppData (fetch + SSE), ensureApi (auto-spawn the server)
  components/        Primitives (Kpi/Bar/DataTable/fitColumns), Sparkline
  screens/           Overview, Projects, Sessions, Costs, Harnesses
  overlays/          help + harness filter
  control/           the control center — the `agentop` front door
    index.ts         runControlCenter({ lang, host, tab }) → ControlExit; the ONLY server import
    types.ts         ControlHost / ControlStatus / TabId — the presentation ↔ logic contract
    altScreen.ts     the alternate buffer + `suspend` + `writeFrame` (the gate Ink draws through)
                     + the signal guard
    stream.ts        PURE: a command's raw bytes → pane-safe lines (\r progress collapsed, ANSI
                     stripped, chunk/escape boundaries buffered, ring-bounded); tested
    ControlCenter.tsx  the one mounted component: screen router, global keys, shared chrome state
    nav.ts chrome.ts  PURE key/focus/scroll reducers and PURE layout arithmetic — `headerLayout`
                     (block art vs the compact mark), the tab bar and its underline, the header tag,
                     `cockpitLayout`'s band/detail geometry, `detailContent` + `fitDetailLines`, the
                     services and action row fits (both tested)
    surface.ts       PURE arithmetic for the LINEAR screens and the questions: section rules, menu
                     and prompt cells, word wrap, `logSources` (the Logs screen's source list,
                     DERIVED from ControlStatus.services), the selector's fit, and the `staticRows`
                     / `setupRows` row budgets (tested in surface.test.ts)
    i18n.ts lang.ts content.ts  EN/PT chrome strings; the CliLang type; the Help / Cheat sheet / Contribute copy
    Pane.tsx         the ONE containment style: rounded frame, title in the border, accent when focused
    Chrome.tsx Surface.tsx Menu.tsx Prompt.tsx ArchiveChoice.tsx   shared primitives (cockpit / linear / questions)
    Output.tsx       the pane a streaming task owns — the detail region, auto-following its tail
    tabs/            Services (the cockpit), Setup, Logs, Static (Help / Cheat sheet / Contribute)
  stubs/react-devtools-core/   REQUIRED for the binary build — see below
packages/tui/scripts/preview.tsx   dev tool: render ONE control-center frame to stdout at a chosen
                                   size/lang/mode, with `--keys` to drive it into a question first
                                   and `--task running|done` to stream a fake build into the pane
```
(`stubs/` sits at the package root, `packages/tui/stubs/`, not under `src/`.)

### Rules

- **`stubs/react-devtools-core` is load-bearing — never delete it.** Ink guards its devtools
  bridge behind `DEV=true` but reaches it through `await import('./devtools.js')`, whose
  top-level `import ... from 'react-devtools-core'` Bun's bundler resolves **statically**. Without
  the stub `bun run build:binary` fails outright. `--external` compiles and then dies at binary
  startup; `--define process.env.DEV='"false"'` does nothing, because resolution precedes
  dead-code elimination.
- **Verify TUI work against the COMPILED BINARY**, not just `bun run`. The devtools problem above
  is invisible under `bun run` and only appears at compile time.
- **Screens receive a `width` and must fit it.** `DataTable` drops columns from the right via
  `fitColumns` and `Overview` drops KPIs via `fitKpis`; declare columns most-important-first. A
  row wider than the terminal wraps and misaligns everything below it. `App` passes
  `columns - 2` because the shell Box has `paddingX={1}`.
- **The control center owns no logic.** `cli-start.ts` decides what the state is and performs
  every action behind the `ControlHost` interface; `packages/tui/src/control` renders and reports
  intents. `cli-ui.ts` stays as the non-TTY fallback — do not delete it.
- **Nothing may print while the alternate buffer is live.** An Ink frame erases the lines above
  itself, so a stray `process.stdout.write` lands in a buffer Ink is repainting. Host actions run
  under one of three wrappers, chosen by what the action SAYS: `captureOutput` (it prints a
  sentence — the last line becomes the status-line message), `streamOutput` (its output is the
  point — the child is spawned with BOTH pipes captured and every line is published on
  `ControlHost.onOutput`, which the cockpit draws into the detail region), or `suspend` (it asks a
  QUESTION, so it needs the real tty; `central.sh init` is the whole of that list). A child on a
  streamed path also gets NO stdin — Ink owns the keyboard — and the streamed paths carry no
  `tty()` / `pauseForEnter` call. Ink itself draws through `altScreen.writeFrame`, NOT
  `process.stdout.write`: a frame written through a capture vanishes (the screen freezes for the
  length of the action) and a frame written through the streaming diversion is fed into the pane
  that is drawing it — a pane full of its own borders. `writeFrame` is also what drops frames while
  a command is suspended, and it must stay a faithful `write`: Ink's teardown passes a callback and
  waits for it, so a gate that swallowed the callback turned `q` into a hang. The same ordering rule applies
  to teardown: **unmount Ink BEFORE leaving the buffer**. Restore first and Ink's own exit handler
  repaints the whole frame onto the primary screen, prefixed with a clear-scrollback — which is
  why signals route through `onAltScreenSignal` instead of `process.exit`.
- **A screen that overflows its `height` is composited, not clipped.** Ink draws the extra rows on
  top of the ones below, so a miscount reads as a corrupted frame. Budget against the `height`
  prop (`cockpitLayout`, `staticRows` and `setupRows` are the worked examples), keep
  `flexShrink={0}` on every screen's root Box — a Box that shrinks blends its rows instead of
  letting the parent cut them — and keep `overflowY="hidden"` on the body as the backstop.
  `Math.max(1, height - chrome)` is the shape of the bug, not the fix: it hands out a row that does
  not exist. Give up a PIECE the screen can afford to lose (the intro, a section header) instead.
- **A list that can outgrow its pane must scroll with `windowOffset`.** Slicing from zero leaves the
  cursor below the fold — invisible, and still the thing `enter` acts on. The config pane once ran
  the language toggle from a row nobody could see.
- **The services list is one row per LOGICAL service, and a runtime is not a service.**
  `agentistics` run natively and the same program in a container are `RuntimeId`s of ONE
  `ServiceId`, never two rows — listing them separately is what made the screen offer to start a
  Docker copy of a server that was already running. A running service therefore offers NO start at
  all (the host hands over an empty `startOptions`; the offer is unreachable rather than refused)
  and offers instead the `restartOptions` it composed — the plain bounce, plus a `Rebuild & restart`
  for each running runtime whose rebuild could actually work here (a repo checkout for `bun run
  bin`, a compose file for the machine image); a rebuild that cannot work is ABSENT, never present
  and failing. A stopped one keeps its row DIMMED, has no restart at all, and its action row becomes
  exactly the starts this box can perform. A service running under BOTH runtimes says so — `ControlService.conflict`, named on
  the row in `COLORS.danger` with a glyph and a word, spelled out in the detail pane, with
  per-runtime `Stop (native)` / `Stop (docker)` and `Rebuild & restart (native|docker)` verbs —
  "rebuild it" has no single meaning while the same program is running twice. Never normalise a conflict away by showing
  one of the two: they read the same files and fight over the same port. Under width pressure
  `serviceCells` gives up the NAME first, then the runtime cell, and the state WORD last — the word
  is the cell nothing else repeats, while the runtimes are said again by the detail pane's badge and
  by the conflict sentence that leads its facts. A row reduced to a coloured glyph is a conflict
  announced in colour alone, which is the one thing this model exists to prevent.
- **The Services screen is a cockpit, and its panes relate.** The services list is the selection;
  the detail pane is a view OF it, so moving the cursor repaints it. Actions are focus-scoped —
  with a service focused they act on THAT service (which is why there is no "stop which?" submenu),
  with the config pane focused they are the config ones. There are three focusable panes
  (`PANE_ORDER`: services → config → actions) and **no log pane**: logs belong to the Logs screen,
  and a tailing viewer squeezed into six rows was a worse copy of a full screen one keypress away.
- **A long action's output goes into the DETAIL region, and nothing else moves.** `docker compose up
  --build`, `central.sh up` and `bun run bin` stream into a pane titled with the VERB the user
  pressed, while the services list and the config pane stay standing beside it — the output is a view
  of what you acted on, so it has to be readable next to WHAT you acted on. It opens on the first
  line (a stop says one sentence and never takes the region), auto-follows the tail through
  `windowOffset` — slicing from zero would leave a build's live edge below the fold — keeps the
  output with its outcome when it finishes, and `esc` puts the facts back. While it is up it reports
  `capture`, exactly as a question does: the global keys stand down (a keypress must not act on a
  service the user cannot see), and `cockpitHints` names the only three keys that work.
- **The detail pane earns the height it has.** It states every RUNTIME the service could run under
  and the state of each — with the localized reason when one cannot be run here at all, which is
  the answer to "why does this offer me nothing" — the pid and uptime of the one that is serving,
  the web and api addresses, and, under a `MACHINE` rule, whether it starts at boot plus the archive
  mode and (in member mode) the endpoint. **Boot is `ControlService.boot?: 'on' | 'off'` and is
  ABSENT when the host cannot tell** (`parseBootState` maps only the words systemd actually prints;
  macOS/Windows are never asked), and an absent boot draws no row — the same N/A-versus-real-0 rule
  the dashboard applies to harness capabilities. `fitDetailLines` cuts from the bottom and then
  drops a trailing rule or blank, so a short pane never spends a row heading nothing.
- **Screens change with `←`/`→` and nothing else.** The tab bar is at the TOP, under the title, with
  an accent rule under the active cell (`tabUnderline`), so the reading order is title, where-am-I,
  content, keys. There are no digit shortcuts for screens: the numbered bottom strip is gone, and
  with it the double-booking that made `2` on the log viewer switch the source AND leave the screen.
  The digits belong to whatever list draws them (the log sources, a numbered `Menu`). `tab` /
  `shift+tab` cycle the cockpit's PANES, and the one claim left is `ScreenChrome.claimArrows`, taken
  by the action row because it is a horizontal list — the footer stops saying `←→ screens` for
  exactly as long as that is true, and `esc` is the way back out. A key answered by the screen AND by
  the shell does two things at once, which is the same class of bug as a footer hint for a key that
  does nothing.
- **The cockpit is a BAND over a full-width DETAIL pane, and no region may be dead.**
  `cockpitLayout` puts the services list beside the config pane in a band as tall as the taller of
  the two and no taller, and gives everything below it to the detail pane at the full terminal
  width — which is what stops its URLs and its reasons being truncated by a column that was never
  wide enough for them. The detail region is reserved BEFORE the band on a short terminal (it holds
  the verbs, and a question needs `QUESTION_ROWS`), so the config pane scrolls rather than the
  actions disappearing. Surplus width goes to the CONFIG pane, which can spend it: `fitValue` shows
  the mode sentence and the whole endpoint URL as soon as the column holds them whole. Air under a
  pane is a fault; air inside one is a pane.
- **The header is the block wordmark when the row can carry it, the compact mark when it cannot.**
  `headerLayout` derives the threshold from the MEASURED art (`WORDMARK_ART`) plus the MEASURED tag
  (`headerMetaWidth`), never a column count — the tag grows with the mode word, the version and the
  update dot. It is all-or-nothing: taking the art must not cost the version. The tag is
  right-aligned on the art's LAST line so the two share a baseline. The header's height is therefore
  NOT a constant, and `bodyHeight(rows, headerRows)` is what every screen's budget goes through.
- **The Logs screen's sources are DERIVED from `ControlStatus.services`, never a constant.**
  `logSources` returns one entry per LOGICAL service under the service's own already-localized
  label (`1 agentistics   2 agentistics central`), and expands a service into its running runtimes
  ONLY in the conflict case, where they genuinely are two different logs. The screen used to hold
  `['local', 'central', 'machine'] as const` and print those internal ids, so it offered the native
  process and the container of the same service as two things long after the model had merged them
  — the same class of bug CLAUDE.md forbids for a hardcoded harness list, failing the same way.
- **Every scrolling surface answers the same keys, through the same pure reducer.**
  `resolveScrollKey` (↑↓ / j k, page up/down, home/end and g/G) CLAMPS at the ends — a document is
  not a ring, unlike `resolveListKey`'s menus — and `resolveTailKey` layers the Logs screen's
  follow state on it, unpinning the tail on any movement. The static screens' positions live in the
  shell's `scroll` record and the Logs viewport in one `TailState`, so a driver that is not the
  keyboard has one setter per surface to call.
- **Every framed region goes through `Pane`.** One containment style is what makes six screens read
  as one application; the shell frames the non-cockpit screens itself so they cannot disagree about
  it. Pane titles are the SHORT lowercase names, the same words the tab bar prints.
- **The footer must describe the keys that work in the CURRENT focus.** `cockpitHints` is the only
  place that decides this, and a hint for a key that does nothing here is a bug, not a cosmetic
  issue — the footer is the only documentation this screen has.
- **Order footer hints most-important-first** — `footerHints` drops from the RIGHT, so `q quit`
  and the tab keys lead. A narrow terminal that hides how to leave strands the user in a buffer
  that hides their shell.
- **`stats-cache.json` stays Claude-only here too.** `selectors.ts` reads Claude totals from the
  cache and every other harness from per-session sums; `applyHarnessFilter` blanks the cache when
  a non-Claude harness is selected, or Claude's numbers would survive the filter.
- **Capability-gated metrics render `N/A`** (`HARNESS_CAPABILITIES`), never a confident `0`.
- **The TUI does not read preferences.** The dependency direction is `server -> tui`: `cli.ts`
  resolves the language via `server/cli-lang.ts` and passes it in.

## Important rules

- **EVERY new screen and EVERY layout fix MUST also deliver its mobile version — no exceptions.**
  A change is not done when it looks right at 1440px. Before calling any UI work complete:
  - Build the mobile branch *in the same change*, not as a follow-up. A "we'll do mobile later" pass
    is how the whole governance area shipped desktop-only and needed the C4 rescue.
  - Follow the existing conventions rather than inventing new ones — `useIsMobile()` (768px),
    `MobileBottomNav` + the "More" sheet, full-screen drawers/modals, the `.ag-grid cols-N` utility,
    tables collapsing into `RecordCard` lists, `MultiPicker`/`Select` popovers that flip up.
  - **Touch targets ≥ 44px on mobile** — and 44px is the *mobile* number: applying it on desktop
    too turns a segmented control into a row of buttons.
  - **Any `<input>` visible on mobile computes to ≥ 16px** or iOS Safari zooms the viewport and
    breaks the sticky header. `index.css` has a global guard; do not override it with an inline
    `font-size` on the field.
  - **Verify at 390px, do not assume**: `document.documentElement.scrollWidth <= window.innerWidth`
    must hold on every page. Wide tables and code blocks scroll inside their own container, never
    the page body.
  - New pages need their nav entry in **both** the desktop `SideNav` `items` array **and** the
    `MobileBottomNav` `navTiles` array in `App.tsx` — adding only the first hides the page on a phone.
- **A tag may be pinned to a PERIOD** (`TagDoc.window`, inclusive `yyyy-MM-dd`, each end independently
  optional) — that is what makes a tag answer "I ran harness X on this project from the 4th to the
  18th; what did it cost?" instead of only "these sources, all time". It is an AND on top of the
  source union, so like `filters` it can only ever narrow. Two rules:
  **(a) the day rule is `tagSessionDay` (`start_time.slice(0,10)`)**, the same one `tags-detail.ts`
  uses for the daily series — a local-clock day would be more correct in isolation and wrong here,
  since at UTC-3 a 23:00 session would sit inside the window while being plotted on the next day's
  bar of the tag's own chart; **(b) `packages/web/src/lib/tagMatch.ts` mirrors the rule by hand**
  (the web bundle cannot import `packages/server/*`), so the window must land in BOTH or the tag's
  card and the tag FILTER disagree — `tagMatch.test.ts` has a cross-check that fails when only one
  side is updated. Because the period is per tag, `makeTagFilter` evaluates tag by tag; the old
  flattened source union cannot express it.
- **Tags are aggregate-only and explicitly shared** — a tag's visibility is the explicit `sharedWith` account list (plus its creator and every owner) and is **never** derived from teams; **anyone signed in may create a tag** — the role difference is REACH, not permission: writing requires that the principal can already see **every** one of its sources (`canWriteTagSources`, re-checked on edit), so an owner reaches anything, a manager what their teams reach, and a plain user only what their own account owns, otherwise a tag becomes a privilege-escalation path; and tag responses return **only counts and sums** — never session rows, transcripts or agent metrics — with keys the viewer cannot see collapsed into an "other" bucket. Tag math runs server-side against the unscoped session set, per-session (never from `stats-cache.json`).
- **A date is NEVER stored as a string in Mongo.** Every persisted timestamp is a BSON `Date`;
  the WIRE shape stays an ISO string (JSON has no date type and the frontend does `parseISO`), so
  the conversion lives at the persistence boundary and nowhere else — `mongo-dates.ts`. Rules:
  - Doc types (`TeamSessionDoc`, `TokenDoc`, `AccountDoc`, `TeamDoc`, `TagDoc`, `RepoDoc`,
    `BootstrapDoc`, `TeamWorkflowDoc`, memberStats) declare `Date`; the API types they map to
    (`MemberInfo`, `MachineInfo`, `RepoInfo`, `PublicAccount`, `SessionMeta`, `WorkflowRun`)
    declare `string`. Write with `new Date()`, never `new Date().toISOString()`.
  - **Reads must tolerate both shapes** — always go through `fromBsonDate`. A doc written by an
    older central in a mixed-version fleet still holds a string, and rendering it as
    "Invalid Date" is a regression the type checker cannot catch.
  - **`''` is not a date.** An adapter that could not read a start time reports `''`; it is stored
    as `null` and reads back as `''`. Storing `''` as a pseudo-date is the bug this replaced.
  - **Add every new timestamp field to `DATE_FIELDS`** and bump `DATE_MIGRATION_VERSION`, or it
    stays a string in the database forever while the writing code looks perfectly correct.
  - Date-shaped map KEYS (`statsCache.dailyTokens`'s `YYYY-MM-DD`) stay strings — a BSON key must
    be one. So do the local JSON stores (`tags-local-store.ts`, `preferences.ts`,
    `~/.agentistics/sessions/*.json`), where ISO strings are the correct representation; the local
    tag store revives them into `Date`s on read so the shared `TagDoc` contract holds in memory.
- **`stats-cache.json` is Claude-only** — never aggregate non-Claude harness metrics from it; use per-session sums for all other harnesses (see "Multi-harness tracking" above)
- **Harness adapters are modules, not packages** — all adapters live under `packages/server/server/adapters/`; never create a separate package per harness
- **`stats-cache.json`** has no project-level granularity — project filters are computed by summing individual sessions
- **Tokens per model/day**: `dailyModelTokens` only stores totals; input/output split uses global statsCache proportions as an approximation when filtering by date
- **Sessions have an optional `model` field** — extracted from the JSONL file by `server/data.ts` when not already present in session-meta. Use `blendedCostPerToken` as fallback when `model` is unknown (e.g. per-session cost column in PDF export)
- **Sessions have an optional `title` field** — the Claude-generated session title, parsed from the transcript's `ai-title` line (or legacy `summary`) by `server/jsonl.ts`. The UI displays it via the shared `sessionLabel()` helper (`@agentistics/core`), which falls back to `first_prompt` with `<local-command-caveat>`/`<command-name>` wrappers stripped — never render `first_prompt` raw as a title
- **Agent metrics** are only available for sessions whose JSONL files are accessible; `_source: 'meta'`-only sessions won't have them
- **Streak**: counts backwards from today; if today has no activity, starts from yesterday — intentional behavior so users are not penalized for not having worked yet today
- **BRL costs**: conversion via `/api/rates` (fetches live exchange rate); falls back to a fixed rate if the API fails
- **Session sources**: `_source: 'meta'` sessions are the most complete; `'jsonl'` and `'subdir'` are fallbacks with partial data (no git line counts, no cache tokens)
- **Binary mode**: `agentop server` sets `SERVE_STATIC=1`; `index.ts` then binds **two ports with one shared request handler** — `PORT` (47291) is the api + mcp endpoint, `WEB_PORT` (47292) serves the web dashboard (the URL you open). Same handler → the SPA on 47292 makes same-origin `/api/*` calls that resolve locally, so 91 stays api+mcp and 92 is the dashboard. The startup log lists `web` (92) above `api` (91)
- **Machine in Docker**: `docker-compose.machine.yml` (repo root) runs a solo/member machine in a container — reuses the central image (minus Mongo/central mode), mounts the host harness dirs read-only + `~/.agentistics` read-write, host networking. Offered as the `docker` option in the control center's Services tab. Run the machine in Docker **or** natively, never both
- **`packages/server/server/embedded-dist.generated.ts`** is in `.gitignore` — auto-generated, never commit it
- **`packages/server/` modules** are server-only — never import them from `packages/web/src/` (Vite would try to bundle them and fail on Node/Bun APIs)
- **`@agentistics/core`** is the shared package — import types, pricing, and formatters from there; never duplicate them inline
- **Custom layout persistence**: `useCustomLayout` saves `{ layouts, activeLayout, pinnedProjects }` to `/api/preferences`. Layouts open **locked** by default; edit mode requires clicking "Edit". When all layouts are deleted, `active` is `''` (empty string) — CustomPage shows an empty state in this case
- **`componentCatalog.tsx`** is the single source of truth for what can be placed on the custom page — every component has a `render(ctx: AppContext)` function; to add a new component, add it there
- **`app-context.ts`** defines `AppContext` — the shape of the outlet context passed from `App.tsx` to all pages via `useOutletContext<AppContext>()`. Add new global state here when it must be accessible from any page or from custom layout components
- **`format.ts`** contains shared display helpers (`fmt`, `fmtCost`, `fmtDuration`, `fmtFull`) — never duplicate these inline
- **`chatSounds.ts`** (`packages/web/src/lib/chatSounds.ts`) defines `CHAT_SOUNDS` (5 sounds: ping, chime, soft, bell, pop), all synthesized via Web Audio API — no audio files needed. `chatSoundId` preference is wired through App.tsx → TtyChat.tsx
- **`PreferencesModal.tsx`** is the single Settings modal — it replaced 3 separate modals with one tabbed interface (Preferences / Live / Install / Environment tabs). Do not add separate settings modals.
- **Per-harness pages live at `/h/:harness`** via the generic `HarnessPage` — never create one page per harness. Harness data-source info is shown via the page's "Data & sources" tab (powered by `HarnessInfoPanel` + `HARNESS_INFO` in `lib/harness.ts`); do not add per-harness info icons or modals elsewhere.
- **A harness appears in the selector and Compare page** only when `AppData.harnesses` includes it (i.e., it contributes at least one real session). Gemini bootstrap-only stub files do not count.
- **PWA**: `vite-plugin-pwa` is configured in `packages/web/vite.config.ts` with `devOptions: { enabled: true }`. Icons are in `packages/web/public/icons/`. The Install tab in PreferencesModal handles both web PWA install and desktop app download.
- **A central installs as its own app** — same bundle, so the identity has to be applied when the
  files are SERVED, not at build time (`TEAM_CENTRAL` is a runtime mode). `serveStatic` runs
  `centralManifest()` / `centralHtml()` from `central-branding.ts` (pure, total — bad input is
  returned untouched) over `/manifest.webmanifest` and `/index.html`, swapping in the **teal**
  icon set, the name "Agentistics Central" and the teal `theme_color`. Regenerate the teal assets
  with `packages/web/scripts/gen-central-icons.py` if the artwork changes — hue, not a badge: at
  32px in a dock a corner badge is invisible. Both files are served `no-store`; **the app shell
  must never get the year-long immutable cache** the hashed assets get, or a rebuild is pinned to
  its old bundle. Anything the server rewrites must also be embedded as TEXT — `.webmanifest` was
  missing from `embed-dist.ts`'s `TEXT_EXTS`, arrived base64 and skipped the rewrite in silence.
- **Mobile / responsive UI** — the whole dashboard is responsive; gate mobile-only branches on the `useIsMobile()` hook (`packages/web/src/hooks/useIsMobile.ts`, `MOBILE_BREAKPOINT = 768`). Conventions:
  - **Sticky header** holds everything needed for interaction. On mobile the header shows only the logo; the lang/theme/export/settings/health/live/refresh controls are **not** in the top row — they live in the bottom-nav "More" sheet (see below). Desktop keeps the full action row.
  - **`MobileBottomNav`** (in `App.tsx`) is the only mobile chrome: 4 primary tabs (Home/Costs/Projects/Tools) + a **"More" bottom sheet rendered as a 3-column grid of square tiles** (Custom / Export / Compare when >1 harness, plus the moved actions: Live toggle w/ interval badge, Refresh, Settings, Warnings w/ issue count). The More button shows a dot when health warnings exist. The sheet slides in via a `transform` transition. Do not move these actions back into the top header on mobile, and keep the tiles compact (no square `aspect-ratio`).
  - **Collapsible filter bar**: on mobile the full `FiltersBar` (harness chips + date/projects/models) sits in the sticky header and can be minimized to a slim "Filters" row (with an active-filter count badge) via `filtersCollapsed`. The open/close is animated with a `grid-template-rows: 0fr↔1fr` transition. The animation wrapper needs `overflow: hidden`, which would clip the Models popover — so it's only clipped while animating/collapsed (`filtersClip` + `onTransitionEnd`), then switches to `visible`.
  - **`FiltersBar` `compact` prop** (used on mobile): hides the vestigial vertical dividers and tightens padding. On mobile the controls also stretch to fill each row (date presets `flex:1`, custom range full-width, the ＋ Filtro button full-width).
  - **`FiltersBar` "＋ Filtro" model**: the top bar shows only the date presets + custom range + a single dashed **＋ Filtro** button (with an active-dimension count badge). It opens a menu of the *available* dimensions (Members/Harnesses/Presence shown only on central-with-data; Repos only when a repo dimension exists; Projects/Models when present); picking one opens that dimension's inline value picker (Projects opens the full `ProjectsModal`). The selected values are NOT shown in the top bar — they render in the animated per-category chip rows below (`AnimatedRow`/`ChipRow`/`FilterChip`, one row per dimension incl. Presence). Do not re-add always-visible dimension dropdowns to the top bar.
  - **Full-screen modals on mobile**: ProjectsModal, SessionDrilldownModal, PreferencesModal, the transcript viewer, etc. render full-screen (overlay padding 0, width/height 100%, `borderRadius: 0`) — iOS Safari pushes centered fixed-width modals off-screen when the page overflows horizontally.
  - **iOS sticky fix**: mobile `html, body, #root` use `overflow-x: clip` (NOT `hidden`) in `index.css` — `hidden` forces `overflow-y` to compute to `auto`, creating a scroll container that breaks `position: sticky`. `clip` clips without that side effect.
  - **iOS install/PWA**: iOS has no `beforeinstallprompt`; InstallModal/Install tab detect iOS and show Add-to-Home-Screen steps instead of an install button. The data cache in `useData.ts` (`agentistics-data-cache-v1` in localStorage) gives instant reopen over plain HTTP (service worker needs HTTPS/localhost).
- **`files_modified` counting** (`packages/server/server/jsonl.ts`): tracks unique file paths from Edit/Write/MultiEdit tool calls (`claudeFilesModified` Set), then takes `Math.max(gitFileStats.filesModified, claudeFilesModified.size)` — whichever is higher. This captures files Claude edited in non-git directories.
- **`getProjectGitStats`** (`packages/server/server/git.ts`): first tries the project path as a single git repo; if that fails (not a git repo), falls back to scanning one level of subdirectories and aggregating stats across all git repos found there (handles workspace folders like `~/zuke`).
- **FILES KPI** (`packages/web/src/hooks/useData.ts`): always uses session-level `files_modified` count first (Edit/Write/MultiEdit calls); falls back to project-level `git_stats.files_modified` only if sessions show 0. This is different from commits/lines which prefer project-level git stats when a project filter is active.

## Concurrent work — one worktree per session, never the shared checkout

Several agents/sessions routinely run against this repo at the same time. A checkout can only be
on ONE branch and every session sees the same files, so sharing the main checkout is not "slightly
risky", it silently corrupts work. All four of these happened in a single afternoon:

- **A commit landed on the wrong branch.** Another session ran `git checkout` mid-session; the next
  commit went onto ITS branch, on top of an unrelated stack.
- **`git add -A` swept another session's in-progress files** into an unrelated commit. Always stage
  explicit paths, and read `git status` before every commit — the diff is not only yours.
- **`bun test` measured a tree someone else was mutating.** The count moved 656 → 842 mid-run: a red
  test may not be yours, and a green one may prove nothing about your change.
- **Two agents edited the same file minutes apart.** A "the tree is clean, nobody is working" check
  is a snapshot, not a lock — it was clean because the other agent was between reads and writes.

So: **work in `.claude/worktrees/<name>/` on your own branch** (the `EnterWorktree` tool, or
`git worktree add`). A fresh worktree needs `bun install` plus
`bun run packages/server/scripts/ensure-type-stub.ts` — without the stub `tsc` fails on the
gitignored `embedded-dist.generated.ts`. Base it on `origin/dev`, not `origin/main`.

**Never rebase or reset a branch another session is committing to** — leave a stray commit where it
is and land your own copy on the target branch. A cherry-picked duplicate resolves itself on merge
(same patch, no conflict); a rebase under a live session destroys work.

## Development

```bash
bun run dev            # API (47291) + UI (47292) in parallel
bun run watch          # OpenTelemetry daemon (optional)
bun run watch:cli      # Terminal TUI (Ink)
bun test               # Unit tests for pure functions

# Build the binary
bun run build          # Generates packages/web/dist/ (Vite)
bun run build:assets   # Generates packages/server/server/embedded-dist.generated.ts
bun run build:binary   # Full pipeline → release/agentop
```

## Tests

Unit tests cover the critical pure functions:

- `packages/core/src/types.test.ts` → `calcCost()`, `getModelPrice()`
- `packages/core/src/chatUtils.test.ts` → tool label helpers
- `packages/web/src/hooks/useData.test.ts` → `calcStreak()`, `getDateRangeFilter()`
- `packages/server/server/chat-tty.test.ts` → chat TTY parsing

Do not mock the filesystem — the tested functions are pure and have no side effects.

## Git hooks (husky)

- **pre-commit**: `bun tsc --noEmit` + `bun test`
- **commit-msg**: commitlint enforces Conventional Commits (`feat:`, `fix:`, `chore:`, etc.)
