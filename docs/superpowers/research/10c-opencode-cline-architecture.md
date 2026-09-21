# OpenCode and Cline — architecture and tool catalogue (for a native Agentistics harness)

Research date: 2026-09-20. OpenCode was researched from a real, current git checkout of the
public repository (`/tmp/opencode-src`, remote `https://github.com/anomalyco/opencode.git`,
commit `83abc64a5c4e0e0a5157f2c4435d34131009a404`, dated 2026-09-19; `packages/opencode/package.json`
reports version `1.18.31` while the locally-installed CLI binary reports `1.17.9` — noted as version
drift between the checkout and the installed binary, not investigated further). This is genuine
public MIT-licensed source, not leaked/deobfuscated proprietary code. Cline was researched via
WebSearch/WebFetch against `github.com/cline/cline`, `docs.cline.bot`, and `cline.bot/blog`
(no local checkout was available), because a licensing/architecture correction surfaced mid-research
that changes the premise of the brief — see the flag immediately below.

**HEADLINE CORRECTION on Cline's licence — read before anything else.** The brief describes Cline as
MIT-licensed. That was true only from Cline's first commit (2024-07-10) until 2024-10-09, when the
`LICENSE` file was changed to **Apache License 2.0** (commit `e5e890d`, "Update LICENSE to Apache
2.0"). The current `LICENSE` file, fetched fresh today, is Apache-2.0, copyright "Cline Bot Inc.
2026." [github.com/cline/cline/blob/main/LICENSE](https://github.com/cline/cline/blob/main/LICENSE)
— accessed 2026-09-20. Apache-2.0 is still permissive and still usable as a basis to borrow from (it
adds a patent grant and a NOTICE-file attribution requirement that MIT does not have), but any patch
or module vendored from Cline must carry Apache-2.0 attribution, not MIT attribution. **Second
headline finding**: Cline underwent a full architecture rewrite in 2026 ("Cline SDK 2.0" / "the
harness upgrade"), 100% rolled out to the stable VS Code extension as of 2026-08-23. Most existing
tutorials, blog posts, and comparison articles about Cline (essentially everything written before
mid-2026) describe the **legacy** architecture, which has been materially replaced. Both generations
are documented below, clearly labeled, because the legacy names are still what nearly all secondary
literature uses.

---

# PART 1 — OpenCode

## 1. Licence, language, runtime, distribution

- **Licence**: MIT, `LICENSE`: "Copyright (c) 2025 opencode".
- **Language/runtime**: TypeScript, Bun-first. `packages/opencode/package.json` is `"type": "module"`,
  ships a `bunfig.toml`, and its `bin/opencode` entry is run via Bun. **Effect-TS is the core
  framework** — the whole server/tool/session layer is written as Effect generators/services, not
  plain async/await, which is a substantial conceptual commitment (see §12). A Node fallback exists
  for storage specifically: `packages/opencode/package.json`'s `imports["#db"]` maps to
  `storage/db.bun.ts` under Bun and `storage/db.node.ts` under Node/default, so the binary is Bun-first
  but not Bun-exclusive at that one seam.
- **Build/distribution**: `packages/opencode/script/build.ts` (each package — opencode, containers,
  http-recorder, cli, client, sdk/js — has its own `script/build.ts`). The `Dockerfile` copies
  prebuilt per-platform binaries (`dist/opencode-linux-x64-baseline-musl`,
  `dist/opencode-linux-arm64-musl`, etc.) into an Alpine base with `ripgrep` installed — i.e.
  **compiled standalone binaries, one per platform**, in the same spirit as Agentistics' own
  `agentop` single-binary build. `.github/workflows/` includes `containers.yml`, `deploy.yml`,
  `publish.yml`, `release-github-action.yml`, `publish-github-action.yml`, `publish-vscode.yml`, and a
  scheduled `models-snapshot.yml` that refreshes a models.dev pricing/catalogue snapshot. Distribution
  channels (inferred from the workflow names): direct binary, Docker image, npm, a GitHub Action, and
  a VS Code extension.

## 2. Architecture

**Genuine client/server split.** `server/server.ts` boots an HTTP server (Effect's
`HttpRouter`/`HttpServer`/`NodeHttpServer` over `node:http`). `opencode serve` starts it headless,
`opencode web` starts it and opens a browser UI, bare `opencode` starts the TUI (itself a client), and
`opencode attach <url>` attaches an external client to an already-running server. This is the single
most important structural fact about OpenCode: **the backend is a standalone process and every
surface — TUI, web, VS Code, ACP editors, the SDK — is a client of it**, mirroring the
`agentop server`/`cli-start.ts` separation Agentistics already has, but pushed one step further (the
TUI itself is just another HTTP+SSE client rather than an in-process consumer).

**Routes.** `server/routes/instance/httpapi/groups/*.ts` (OpenAPI schema definitions) paired with
`.../handlers/*.ts` (implementations). Route groups: `config`, `control-plane`, `control`, `event`,
`experimental`, `file`, `global`, `instance`, `mcp`, `metadata`, `permission`, `project-copy`,
`project`, `provider`, `pty`, `query`, `question`, `session`, `sync`, `tui`, `workspace`.
`server.ts` exposes an `openapi()` endpoint that generates the full OpenAPI spec from these route
definitions — the API is self-documenting by construction.

Session routes (`groups/session.ts`, root `/session`) are the richest group: `GET /session` (list),
`GET /session/status`, `GET /session/:id`, `GET /session/:id/children` (forked children),
`GET /session/:id/todo`, `GET /session/:id/diff`, `GET /session/:id/message` (paginated,
`limit`/`before`), `GET /session/:id/message/:messageID`, `POST /session` (create),
`DELETE /session/:id`, `PATCH /session/:id` (title/metadata/permission/archived),
`POST /session/:id/fork`, `POST /session/:id/abort`, `POST /session/:id/init` (writes AGENTS.md),
`POST`/`DELETE /session/:id/share`, `POST /session/:id/summarize`, `POST /session/:id/message`
(send, streams the response), `POST /session/:id/prompt_async` (fire-and-forget),
`POST /session/:id/command`, `POST /session/:id/shell`, `POST /session/:id/revert`/`unrevert`,
`POST /session/:id/permissions/:id` (explicitly annotated `deprecated: true` in the OpenAPI spec),
plus message/part delete and patch routes.

**Event stream.** `groups/event.ts` exposes a single `GET /event` returning
`Schema.String.pipe(HttpApiSchema.asText({contentType:"text/event-stream"}))` — plain SSE, scoped
per-project instance via `WorkspaceRoutingMiddleware`/`InstanceContextMiddleware` (not a single
global stream). The exact event catalogue lives in `bus/bus-event.ts`, which was **not opened
directly**; the description commonly repeated in secondary sources (server sends `server.connected`
on connect, subscribes to all bus events and forwards them, 30s heartbeats, closes on instance
disposal) is corroborated only by a Medium write-up and GitHub issue #11616, and should be treated as
**unverified** until read from source.

A separate `pty` route group (`groups/pty.ts`, `shared/pty-ticket.ts`) provides a **ticketed PTY-over-
HTTP** channel for the web/TUI terminal feature — architecturally distinct from the shell tool the
model calls (§7).

**Client attachment / multi-client sharing.** `opencode attach <url>` attaches any client to a running
server; `@opencode-ai/sdk` (workspace package, `createOpencodeClient`) is the typed HTTP client used
internally by plugins too, and a standalone `opencode-sdk-js` npm package exists. Because everything
is addressed by `sessionID` over HTTP+SSE, multiple clients (TUI, web, VS Code, a second `attach`) can
watch or act on **one session concurrently** — `session.share`/`unshare` explicitly hands out a
shareable link for exactly this. `SessionBusyError` is raised on `shell`/`revert`/`unrevert`/
`deleteMessage` when a session already has an operation in flight, which reads as **single-flight
execution serialization**, not single-client ownership — there is no lock preventing two different
clients from prompting the same session, only from doing so simultaneously.

**ACP.** `opencode acp` implements the `Agent` interface from `@agentclientprotocol/sdk` in
`src/acp/` (`agent.ts`, `session.ts`, `permission.ts`, `tool.ts`, `content.ts`, `error.ts`,
`event.ts`, `profile.ts`, `service.ts`, `usage.ts`) — a **separate transport**, not an HTTP route,
purpose-built for ACP-native editors (Zed and similar) to drive OpenCode as their backend agent.

## 3. Provider abstraction

**Vercel AI SDK**, not a bespoke client layer. `provider/provider.ts` dynamically imports
`@ai-sdk/anthropic`, `openai`, `openai-compatible`, `google(-vertex[/anthropic])`, `azure`,
`amazon-bedrock(/mantle)`, `xai`, `mistral`, `groq`, `deepinfra`, `cerebras`, `cohere`, `gateway`,
`togetherai`, `perplexity`, `vercel`, `alibaba`, `github-copilot`, plus first-party vendor plugin
wrappers (`plugin/azure.ts`, `cerebras.ts`, `cloudflare.ts`, `digitalocean.ts`, `modal/`, `openai/`,
`snowflake-cortex.ts`, `xai.ts`, `github-copilot/`). It imports `type { LanguageModelV3 } from
"@ai-sdk/provider"`.

**Model/pricing catalogue**: `@opencode-ai/core/models-dev` (models.dev), kept fresh by the scheduled
`.github/workflows/models-snapshot.yml`.

**Local/custom endpoints**: an explicit `baseURL`/`endpoint` override
(`providerConfig?.options?.endpoint ?? providerConfig?.options?.baseURL`) routed through
`@ai-sdk/openai-compatible` — the same generic path a self-hosted or Ollama OpenAI-compatible
endpoint would use, plus code comments referencing corporate proxy/gateway routing and a Cloudflare AI
Gateway client against `https://api.cloudflare.com/.../ai/v1`. The literal string "ollama" was **not
found** in the files opened — local-model support via this generic mechanism is confirmed in
principle, Ollama-as-a-named-integration is not directly confirmed.

**Cost/usage**: `Model["cost"]` is built from `ModelsDev.Model["cost"]`, and a model documented at
`$0` is explicitly skipped when merging pricing data (`if (value.cost.input === 0) continue`) — a
defensive rule almost identical in spirit to Agentistics' own community-pricing-dataset validation
(`pricing-community.ts`, which drops non-positive costs). `Session.Info` carries `cost?: number` and
`tokens?: {input, output, reasoning, cache:{read,write}}` as first-class fields, computed and stored
per session rather than derived on read.

## 4. Session/state model

`session/session.ts`'s `Info` type (read directly):
```
id, slug, projectID, workspaceID?, directory, path?, parentID?
summary?: {additions, deletions, files, diffs?}
cost?: number
tokens?: {input, output, reasoning, cache:{read, write}}
share?: {url}
title, agent?, model?: {id, providerID, variant?}, version
metadata?: Record<string,any>
time: {created, updated, compacting?, archived?}
permission?: PermissionV1.Ruleset
revert?: {messageID, partID?, snapshot?, diff?}
```
`GlobalInfo` = `Info` + `project: ProjectInfo|null`. Messages/parts are fetched separately via
`GET /session/:id/message`, not embedded in `Info`.

**Persistence**: `storage/storage.ts` is a generic key→JSON-file store (`file(dir,key) =
path.join(dir,...key)+".json"`). The root is resolved via `xdg-basedir` in `packages/core/src/
global.ts`: data under `~/.local/share/opencode`, config under `~/.config/opencode` (this matches the
config location observed locally: `~/.config/opencode/opencode.json(c)`), plus separate cache/state/
tmp roots. Storage is **flat JSON files, not a database** for what was directly read; `drizzle-orm` is
a devDependency but was not confirmed to back any part of session storage. `storage.ts` carries a
`MIGRATIONS` array that upgrades an older on-disk layout (`project/<id>/storage/session/message/*/
*.json`) on read — the on-disk schema has changed across releases and self-migrates, the same
philosophy Agentistics applies with `mongo-dates.ts`'s `DATE_MIGRATION_VERSION`.

**Resume/fork**: CLI flags `--continue`/`-c`, `--session`/`-s`, `--fork` (usable with either) — fork
is explicitly a distinct operation from resume, not resume-with-a-flag. Server-side:
`POST /session/:id/fork` creates a new session from an existing one; `GET /session/:id/children`
lists forked children via a `parentID` back-reference. This is a genuine first-class branch/fork
model, closer to git branching than to Agentistics' current session model (which has no fork concept
at all — every reopen mints a new id for the *same* conversation rather than branching it).

**Compaction**: `session/compaction.ts` (read in full). Constants: `PRUNE_MINIMUM=20,000` tokens,
`PRUNE_PROTECT=40,000` tokens, `TOOL_OUTPUT_MAX_CHARS=2,000`, `PRUNE_PROTECTED_TOOLS=["skill"]`,
`MIN_PRESERVE_RECENT_TOKENS=2,000`, `MAX_PRESERVE_RECENT_TOKENS=15,000`. It is an **LLM-driven
summarization pass** (`buildPrompt` + a dedicated `agent/prompt/compaction.txt` template run through
the model itself), gated by `session/overflow.ts`'s `isOverflow`/`usable` checks, which protects skill
tool output from being pruned and keeps a sliding window of recent tokens un-summarized. Also
user-triggerable directly: `POST /session/:id/summarize {providerID, modelID, auto?}`.

**Revert**: `session/revert.ts` plus `Info.revert` and `POST /session/:id/revert`/`unrevert` restore
prior file state via a `snapshot`/`diff`, and the operation is reversible in both directions — backed
by `src/snapshot/` (git-based, per file naming; not read in depth).

## 5. Tool catalogue

**Dispatch mechanism** (`tool/tool.ts`, read in full): `Tool.Def{id, description, parameters:
Schema.Decoder, jsonSchema?, execute(args,ctx), formatValidationError?}`. `Tool.define()` wraps every
tool's `execute` to (a) validate arguments and turn a validation failure into an
`InvalidArgumentsError` whose message tells the model exactly what to fix and re-emit ("Please
rewrite the input so it satisfies the expected schema"), (b) post-truncate output via a shared
`Truncate.Service` unless already marked truncated, and (c) wrap the call in an OpenTelemetry span
tagged with `tool.name`/`session.id`/`message.id`/`tool.call_id` — **tool calls are OTel spans by
construction**, not an afterthought.

`tool/registry.ts` assembles: built-ins (`Invalid`, `Task`, `Read`, `Question`, `TodoWrite`, `Lsp`,
`PlanExit`, `WebFetch`, `WebSearch`, `Shell`, `Glob`, `Write`, `Edit`, `Grep`, `ApplyPatch`, `Skill`)
+ MCP-derived tools + plugin-registered tools (via `fromPlugin()`, which bridges a plugin's
promise-based `ask()` into the host's Effect-based permission gate through an `EffectBridge`) +
an optional feature-flagged `code-mode` tool. `Interface.tools({providerID, modelID, agent,
permission})` returns a **per-call, per-agent, per-model** tool list — the tool surface is not
static, it is computed fresh for the exact agent/model pairing in play. `webSearchEnabled` gates the
built-in websearch tool to OpenCode's own hosted provider or an Exa/Parallel feature flag.

Per tool (argument shape from the `.ts` schema, description from the paired `.txt` prompt file):

| Tool | Purpose | Notes / limits |
|---|---|---|
| `read` | Read a file | `filePath`, `offset` (1-indexed); default 2000-line cap, any line >2000 chars truncated; directories list one entry per line with a trailing `/`; images/PDFs come back as attachments |
| `write` | Create/overwrite a whole file | Description says the file must have been `read` first — **not enforced in code** (§6) |
| `edit` | Search-replace a section of a file | Exact string replace with a large fuzzy-match fallback chain (§6) — the single most notable design choice in the tool catalogue |
| `apply_patch` | Apply a whole-envelope patch | OpenAI/Codex-style `*** Begin Patch`/`Add File:`/`Update File:`[+`Move to:`]/`Delete File:`/`*** End Patch`, `@@`/`+`/`-` hunks — offered **alongside** `edit`, not instead of it |
| `grep` / `glob` | ripgrep-backed regex search / glob filename match | — |
| `task` | Spawn a subagent | §9 |
| `todowrite` | Track a todo list | `pending\|in_progress\|completed\|cancelled`; prompt text states "exactly one in_progress" |
| `plan` | Switch the active agent between Plan and Build | Modeled as an agent switch triggered by the model's own tool call, not a UI-only toggle (`plan-enter.txt`/`plan-exit.txt`) |
| `question` | Ask the user a multiple-choice question | Auto-adds "Type your own answer" unless `custom` is disabled; supports `multiple: true` |
| `skill` | Load named skill instructions | Backed by `src/skill/`, not read in depth |
| `webfetch` | URL → markdown/text/html | http→https upgrade; may summarize large content |
| `websearch` | Web search | `fast`/`deep`/`auto` search types, `fallback`/`preferred` crawl modes, gated by `webSearchEnabled()`; a separate `mcp-websearch.ts` provides an MCP-backed variant alongside the native one |
| `lsp` | Unified LSP operations | goToDefinition, findReferences, hover, documentSymbol, workspaceSymbol, goToImplementation, prepareCallHierarchy, incomingCalls, outgoingCalls; 1-based line/character |
| `code-mode` | Alternate tool-calling mode | Feature-flagged, not read in depth |
| `external-directory` | Gate access outside the project/worktree | Shared by both `edit.ts` and `shell.ts` (`assertExternalDirectoryEffect`) — a path outside the project boundary requires explicit permission regardless of which tool touches it |

**Truncation limits** (`tool/truncate.ts`, read in full): `MAX_LINES=2000`, `MAX_BYTES=50*1024`, both
overridable via `opencode.json` (`tool_output.max_lines`/`tool_output.max_bytes`) and per-agent.

## 6. Editing model

**Two coexisting edit tools**, a deliberate design choice worth calling out on its own:

1. **`edit`** — search-replace with a **cascading fuzzy-match fallback chain**. The file header (lines
   1-4 of `tool/edit.ts`) explicitly cites its lineage: `github.com/cline/cline/blob/main/evals/
   diff-edits/diff-apply/diff-06-23-25.ts` and `diff-06-26-25.ts`, plus Google's `gemini-cli`
   `editCorrector.ts`. **OpenCode directly ported Cline's own fuzzy-diff-apply algorithm.** The
   replacer chain, in order: `SimpleReplacer` (exact match) → `LineTrimmedReplacer` (per-line
   whitespace trim) → `BlockAnchorReplacer` (anchor line + similarity scoring, threshold `0.65`, a
   hand-rolled Levenshtein distance implemented in-file) → `WhitespaceNormalizedReplacer` →
   `IndentationFlexibleReplacer` → `EscapeNormalizedReplacer` (handles literal `\n`/`\t` mismatches
   between what the model wrote and what's on disk) → `MultiOccurrenceReplacer` →
   `TrimmedBoundaryReplacer` → `ContextAwareReplacer`. Diff/preview generation uses
   `createTwoFilesPatch`/`diffLines` from the npm `diff` package.
2. **`apply_patch`** — a whole-envelope unified-patch format (OpenAI/Codex style), offered as an
   alternative to `edit` rather than a replacement for it.
3. **`write`** — whole-file overwrite.

**Staleness handling — explicitly searched and not found.** A repo-wide grep for
`mtime|hasBeenRead|fileTimes|FileTime|readTimestamp` across all of `src/` returned no hits relevant
to edit/write/read. `edit.ts` reads the file fresh at execute time with no comparison against a prior
`read`'s snapshot. **Conclusion: the "must Read before Edit/Write" instruction in the tool
descriptions is not code-enforced** — it is prompt-only guidance, the same pattern Claude Code's own
tool prompts use. A per-file `Semaphore` map (`locks: Map<string, Semaphore.Semaphore>`) does exist,
but it serializes *concurrent* edits to the same file within one running instance; it is a
concurrency-safety mechanism, not a staleness detector.

## 7. Shell model

`tool/shell.ts` + `shell/id.ts` + `shell/prompt.ts` (read substantially). **One-shot process spawn per
call, not a persistent PTY** — `ChildProcessSpawner`/`ChildProcess.make` (Effect's process module,
backed by `cross-spawn`) is fresh on every call. There is no cross-call cwd persistence: each call
resolves `cwd` from `params.workdir` if supplied, otherwise the project root
(`instanceCtx.directory`). **This directly contradicts the tool's own prompt text** (`shell/prompt.ts`
line 259: *"Executes a given bash command in a persistent shell session with optional timeout..."*) —
the description says "persistent," the implementation is stateless-per-call with an explicit
`workdir` parameter instead of a remembered working directory. The tool's own id stays `"bash"` even
when it dispatches to `pwsh`/`powershell`/`cmd`, explicitly for backward compatibility (an in-file
comment reads "Rename with opencode 2.0").

Cross-platform command handling is genuinely sophisticated: commands are parsed via `web-tree-sitter`
with `tree-sitter-bash`/`tree-sitter-powershell` grammars, and the resulting **AST is scanned** for
filesystem-touching operations (a `FILES` set: `rm`, `cp`, `mv`, `mkdir`, `chmod`, `chown`, `cat` +
PowerShell equivalents; a `CWD` set: `cd`, `chdir`, `popd`, `pushd`) — so permission prompts can be
scoped to the exact paths/patterns a command touches instead of asking a blanket "run this shell
command?" question. This is the most interesting single idea in the whole codebase for a permission
UX (§8).

Timeouts: `params.timeout` in ms, defaulting to `defaultTimeoutMs`; on expiry the tool appends a
`<shell_metadata>` block noting the timeout and suggesting a retry with a larger value, and separately
tracks whether the call was `aborted`. Output truncation reuses the same `Truncate` service as every
other tool (tail-cut, overflow spilled to a file). **No dedicated background-execution parameter was
found in `shell.ts` itself** — unlike `task.ts`, which has an explicit `background: true` flag. A
top-level `src/background/`/`BackgroundJob` module exists and is used by `task.ts`; whether it also
backs arbitrary shell commands was **not confirmed**.

A genuinely separate **PTY subsystem** exists for the interactive terminal in web/TUI clients
(`server/routes/instance/httpapi/groups/pty.ts`, `shared/pty-ticket.ts`) — architecturally distinct
from the shell tool the model calls, not read in depth.

## 8. Permissions/sandbox

`permission/index.ts` (read in full), `evaluate.ts` (a one-line re-export), `arity.ts` (read in full).

**Model**: a `Ruleset = {action:"allow"|"ask"|"deny", permission, pattern}[]`. `evaluate()`:
`rulesets.flat().findLast(rule => Wildcard.match(permission, rule.permission) &&
Wildcard.match(pattern, rule.pattern)) ?? {action:"ask", permission, pattern:"*"}` — **the
last matching rule wins**, and both the `permission` (tool/kind) and the `pattern` (path/command glob)
are wildcard-matched independently. This is a clean, small, testable evaluator — a good candidate
to imitate directly.

`Service.ask()` evaluates against a session-scoped `ruleset` plus an in-memory `approved` list that
accumulates prior interactive approvals (instance-scoped only; a shutdown finalizer rejects every
still-pending ask via `Deferred.fail(item.deferred, new PermissionV1.RejectedError())`, so nothing is
left hanging across a restart). `deny` throws a `DeniedError` immediately; `allow` continues; anything
else blocks on a `Deferred` until answered. A `PermissionV1.CorrectedError` type exists, suggesting a
response can carry a *correction* rather than a flat allow/deny — not read further.

Tools call `ctx.ask({permission, patterns, always, metadata})` directly — e.g. `edit.ts` asks with
`{permission:"edit", patterns:[relativePath], always:["*"], metadata:{filepath, diff}}`, so the diff
itself rides along as metadata for the approval UI to render. `shell.ts`'s AST-derived pattern sets
feed the same mechanism with several fine-grained patterns per command (§7).

`arity.ts` is a large, explicitly LLM-generated table (the file header documents the exact generation
prompt used) mapping CLI-command prefixes to a token count — `cd`:1, `bun`:2, `"bun run"`:3, `aws`:3,
`cargo`:2, `"cargo add"`:3, etc. — which collapses a full command line into a stable "permission
subject" prefix (`git checkout main` → `git checkout`) instead of treating every distinct full command
line as its own unique permission pattern. This is a small, self-contained, genuinely reusable idea
independent of the rest of OpenCode's architecture.

**Sandbox**: no bubblewrap, Seatbelt, Docker-as-sandbox, proot, gVisor, or firejail references were
found in `permission/*` or `tool/shell*` (not exhaustively grepped across the whole repo). Permission
here is a pure **confirmation-gate model** — allow/ask/deny plus a human in the loop — never process
or filesystem isolation.

## 9. Subagents/delegation

`tool/task.ts` (read substantially) is OpenCode's equivalent of Claude Code's Task tool. Arguments:
`description` (3-5 words), `prompt`, `subagent_type` (resolved via `Agent.Service.get()`, throwing
`Unknown agent type: {x}...` if invalid), `task_id` (optional — **resumes a prior task's subagent
session** rather than always starting fresh, documented directly in the schema), `command` (optional,
records the triggering slash-command), `background` (optional boolean).

**Background subagents are first-class**, with dedicated prompt strings read verbatim from the
source: `BACKGROUND_DESCRIPTION` ("background=true launches...returns immediately...notified
automatically when it finishes"), `BACKGROUND_STARTED` ("DO NOT sleep, poll for progress, ask the
task for status, or duplicate this task's work..."), `BACKGROUND_UPDATED` (the same guidance, for
sending more context to an already-running background task). Title format:
`"${description} (@${next.name} subagent)"`.

Subagent sessions are literal **child sessions** via the same fork/`parentID` mechanism used for
session forking generally (§4) — not a separate concept bolted on. `deriveSubagentSessionPermission`
(`agent/subagent-permissions.ts`) computes the permission ruleset a spawned subagent session inherits,
deliberately computed rather than blindly inherited from the parent.

**Named agents/personas**: `agent/agent.ts`'s `Agent.Info`:
`{name, description?, mode:"subagent"|"primary"|"all", native?, hidden?, topP?, temperature?, color?,
permission: Ruleset, model?:{modelID,providerID}, variant?, prompt?, options: Record<string,unknown>,
steps?}`. An agent definition can override the model, sampling parameters, its own system prompt, its
own permission ruleset, and a step limit; `mode` scopes where it can be selected (subagent-only,
primary-only, or both). `Agent.Service.generate()` **LLM-generates a new agent definition from a
natural-language description** (producing `{identifier, whenToUse, systemPrompt}` via a dedicated
`agent/generate.txt` template) — this backs `opencode agent create`.

## 10. MCP support

`mcp/index.ts` (key sections read), `catalog.ts`, `auth.ts`, `oauth-provider.ts`, `oauth-callback.ts`,
`browser.ts`.

Uses the official `@modelcontextprotocol/sdk` directly (`SSEClientTransport`, `StdioClientTransport`).
Two transport modes, discriminated by config: `type:"remote"` (SSE, `connectRemote()`) and
`type:"local"` (stdio, `connectLocal()`).

**Namespacing**: `catalog.ts`'s `toolName = (clientName, name) => sanitize(clientName) + "_" +
sanitize(name)` — underscore-joined, sanitized-server-key-prefixed tool names. Simpler/flatter than
Claude Code's double-underscore `mcp__server__tool` convention, but solving the identical
collision-avoidance problem.

**OAuth**: gated by `mcpConfig.type==="remote" && mcpConfig.oauth!==false`; a local callback server is
spun up at `http://127.0.0.1:{port}{OAUTH_CALLBACK_PATH}`. CLI verbs (confirmed via `--help`):
`opencode mcp auth [name]`, `opencode mcp logout [name]`, `opencode mcp debug <name>`; `mcp list`
surfaces the namespaced tool names per configured server; a `not_authenticated` status is part of a
documented enum.

A separate `mcp-websearch.ts` tool wraps an MCP-backed web search alongside the native `websearch.ts`
— OpenCode composes multiple web-search backends behind visually similar tool surfaces rather than
picking one implementation.

## 11. Extension points

**Plugin contract** (`packages/plugin/src/index.ts`, type surface read in full):
`Plugin = (input: PluginInput, options?) => Promise<Hooks>` — a factory function invoked once per
instance. `PluginInput = {client (a full typed HTTP client back into the running server, via
createOpencodeClient), project, directory, worktree, experimental_workspace:{register(type,
adapter)}, serverUrl, $ (Bun's own shell helper, exposed directly to plugin code)}`.

Only the `AuthHook` variant of the `Hooks` union was read in full (the full union was not
enumerated — flagged as partially verified): `AuthHook = {provider, loader?,
methods:[{type:"oauth", label, prompts?:[{type:"text"|"select", key, message, ..., when?/
condition?}], authorize(inputs?)=>Promise<AuthOAuthResult>}]}` — plugins can register **entirely new
auth providers**, including declarative, conditional interactive credential-collection flows, not
just a bare API-key field.

`ToolDefinition` (`plugin/src/tool.ts`) lets a plugin register a custom tool with either a Zod schema
or a legacy plain-object schema; `registry.ts`'s `fromPlugin()` normalizes either shape into the
internal `Tool.Def` and bridges the plugin's promise-based `ctx.ask()` into the host's Effect-based
permission gate via `EffectBridge` — **plugin-registered tools get identical permission-gating to
built-in tools**, which is the right invariant for this kind of extension point.

`WorkspaceAdapter` (`configure`/`create`/`remove`/`target`, where `target` returns
`{type:"local",directory}` or `{type:"remote",url,headers?}`) is a plugin-registrable abstraction for
*where a session's working directory lives*, explicitly marked experimental.

`opencode plugin <module>` (CLI, confirmed via `--help`) installs a plugin and updates config
(`-g/--global`, `-f/--force`); plugins are ordinary npm packages. Notably, **OpenCode's own bundled
vendor integrations are themselves built as plugins using this exact contract**
(`plugin/azure.ts`, `cerebras.ts`, `cloudflare.ts`, `digitalocean.ts`, `snowflake-cortex.ts`,
`xai.ts`, plus `github-copilot/`, `modal/`, `openai/`, `tui/` subdirectories) — the plugin API is
load-bearing infrastructure, not a vestigial add-on surface.

ACP (§2) is the other genuine extension point: a full alternate protocol, not an HTTP route, letting
ACP-native editors (Zed and similar) drive OpenCode as their backend agent with its own permission/
tool/content adaptation layer.

## 12. Reusable as a dependency vs. reimplement, given Bun/single-binary/our-own-journal/our-own-ALM

- **Reusable as a dependency, directly**: the Vercel AI SDK provider layer pattern (§3) — Agentistics
  could adopt `ai` + the official `@ai-sdk/*` provider packages rather than hand-rolling per-vendor
  HTTP clients; it is MIT-compatible, actively maintained by Vercel, and OpenCode's own choice
  validates it at scale across a dozen+ vendors including local/OpenAI-compatible endpoints. The
  `@modelcontextprotocol/sdk` for MCP client transport (§10) is likewise a direct, uncontroversial
  dependency rather than something to reimplement.
- **Imitate the pattern, do not depend on the code**: the whole Effect-TS-based server/session/tool
  architecture is **not** something to depend on or vendor — it is a full paradigm commitment
  (generators, services, Effect's own error/resource model) that would fight Agentistics' existing
  Bun-idiomatic, non-Effect codebase at every seam. The *shape* (HTTP server + SSE event stream +
  every UI as a client of it, OpenAPI-generated routes, per-tool OTel spans) is worth imitating in
  plain TypeScript/Bun; the Effect runtime itself is not worth adopting.
  Same verdict for the flat-JSON-file-per-key storage layer (`storage/storage.ts`) — Agentistics
  already has an equivalent (`~/.agentistics/sessions/<harness>/<id>.json`) and gains nothing by
  swapping it for OpenCode's, but the **self-migrating `MIGRATIONS` array pattern on read** is worth
  copying as an idiom (Agentistics already does something structurally similar with
  `DATE_MIGRATION_VERSION`).
- **Vendor with attribution, small and self-contained**: the `edit.ts` fuzzy-match replacer chain
  (SimpleReplacer → LineTrimmedReplacer → BlockAnchorReplacer → ... → ContextAwareReplacer) is a
  well-tested, self-contained ~700-line algorithm solving exactly the "the model's SEARCH block
  doesn't match byte-for-byte" problem that plagues every diff-based edit tool (including, per the
  Cline research below, Cline's own legacy `replace_in_file`). OpenCode itself vendored this from
  Cline's evals code with attribution in the file header — Agentistics could do the same (from either
  OpenCode's MIT-licensed port or Cline's own Apache-2.0 original, crediting whichever is used), which
  is far cheaper than re-deriving the fuzzy-match thresholds from scratch. The `arity.ts` command-
  prefix-to-token-count table (for collapsing `git checkout main` into a stable `git checkout`
  permission subject) is similarly small and directly portable.
- **Reimplement, informed by the design**: the permission evaluator (`permission/evaluate.ts`'s
  last-matching-rule-wins over independently-wildcarded `permission`+`pattern`) is simple enough
  (~20 lines) that reimplementing it in Agentistics' own idiom is cheaper and safer than depending on
  or vendoring OpenCode's version, but the *design* — ask/allow/deny with metadata (a diff, patterns)
  riding along on the ask — is worth reusing as-is. The tree-sitter-based shell-command AST scanning
  for scoped permission patterns (§7) is the single most valuable *idea* in the whole shell/permission
  stack and should be reimplemented rather than depended on, since Agentistics' own session-manager
  shell integration (tmux-based, `tmux-cli.ts`) has entirely different plumbing.
- **Do not adopt**: the shell tool's "one-shot spawn per call despite claiming to be persistent" design
  (§7) is a documented inconsistency in OpenCode itself (the prompt text lies about persistence) and
  should not be copied; Agentistics' own persistent-tmux-session shell model is already more honest
  about what it is.

---

# PART 2 — Cline

## 1. Licence, language, runtime, distribution

- **Licence**: **Apache License 2.0**, not MIT (see the headline correction above) — verify at
  [github.com/cline/cline/blob/main/LICENSE](https://github.com/cline/cline/blob/main/LICENSE),
  accessed 2026-09-20.
- **Repo shape**: `github.com/cline/cline` is now a Bun-based monorepo with **no top-level `src/`**
  (the old monolith layout is gone): `apps/` (`cli`, `vscode`, `vscode-rollout`, `cline-hub`,
  `examples`), `sdk/` (packages `core`, `agents`, `llms`, `shared`, `ui`, `sdk`), `docs/`, `.kanban/` —
  accessed 2026-09-20.
- **Language/runtime**: TypeScript throughout. The VS Code extension (`apps/vscode`) still runs inside
  VS Code's Node.js extension host. The new "Cline Core" runtime (`sdk/packages/core`) runs as "a
  simple node process, exposing a gRPC API" per the official blog
  [Cline CLI & My Undying Love of Cline Core](https://cline.bot/blog/cline-cli-my-undying-love-of-cline-core)
  — accessed 2026-09-20.
- **Standalone CLI/SDK**: confirmed. `npm install -g cline` (or `cline@nightly`) auto-resolves a
  platform binary, "requiring no runtime dependencies at installation"
  ([apps/cli/README.md](https://github.com/cline/cline/blob/main/apps/cli/README.md)). The SDK is
  `npm install @cline/sdk`, Apache-2.0, described as "the same agent runtime that powers Cline's VS
  Code extension, CLI, and Kanban"
  ([Introducing Cline SDK](https://cline.bot/blog/introducing-cline-sdk-the-upgraded-agent-runtime),
  published ~2026-05-13).
- **Distribution channels**: VS Code Marketplace (historical extension id
  `saoudrizwan.claude-dev`), JetBrains Marketplace (plugin id `28247-cline`, "runs natively... using a
  headless core daemon" — secondary source, not independently confirmed), npm (CLI + SDK), and a *new*
  **Cline Desktop** standalone native app (macOS signed/notarized, Windows in beta, no Linux build),
  announced 2026-09-14 — six days before this research. Desktop's vendor-stated differentiator: it can
  **import in-progress tasks from other coding agents (Claude Code, OpenAI Codex)** to continue with a
  Cline-configured (often open-weight) model — stated by the vendor, not independently verified.

## 2. Architecture

Two architectural eras.

**2a. Legacy (essentially everything written about Cline before mid-2026).** A monolithic VS Code
extension-host process containing the whole agent loop (a `Task` class) talking to a React webview.
Communication was **gRPC-over-postMessage**: every call wrapped in a gRPC envelope, `.proto` files
under `src/shared/proto/cline/` compiled to TypeScript via `ts-proto`, with service clients
(`UiServiceClient`, `StateServiceClient`, `ModelsServiceClient`, `McpServiceClient`, ...) on the
webview side talking to matching `*ServiceImpl` classes on the extension side. This is corroborated
both by a DeepWiki write-up (secondary) and by the official blog's own statement that "the original
extension used gRPC with a messaging system between the core and React webview GUI." No dedicated
"we migrated from JSON-RPC to gRPC" post was found — the gRPC bridge appears to have existed quite
early rather than being introduced in one documented event.

**2b. Current (Cline SDK 2.0 / "the harness upgrade," fully rolled out as of today).** Confirmed
directly from the live repo tree: `apps/vscode/proto/cline/*.proto` (UI-facing service definitions:
account, browser, checkpoints, commands, common, file, hooks, marketplace, mcp, models, oca_account,
remote_config, slash, state, task, ui, web, worktree) and `apps/vscode/proto/host/*.proto` (the
**Host Provider / "HostBridge"** capabilities Core needs from whatever embeds it: core_connection,
diff, env, testing, window, workspace). Official **three-layer model**: **Presentation Layer**
(webview UI, JetBrains UI, CLI TUI — "connects as a gRPC client to Cline Core and tells him what to
do") → **Cline Core** (a plain Node process exposing a gRPC API; orchestrates plan/act, checkpoints,
terminal execution, headless browser use; can serve multiple simultaneous frontends) → **Host Provider
Layer** (a gRPC client back out to the embedding environment for host-specific capabilities, e.g.
asking VS Code for linter output). Standalone/CLI mode reportedly exposes a gRPC ProtoBus server on
port 26040 per one secondary source — **not independently verified**.

The **newer SDK layering** (`sdk/ARCHITECTURE.md`, fetched raw, primary source) is a stricter 4-package
stack with one-way dependencies: `@cline/shared` (types/schemas/hook engine, transport-agnostic) →
`@cline/llms` (provider/model catalogs, gateway — §3) → `@cline/agents` (the **stateless** agent turn
loop and tool orchestration, no persistence) → `@cline/core` (**stateful** orchestration: sessions,
storage, settings, plugin discovery, telemetry, and a "Hub" server/client). `@cline/core` exposes one
`RuntimeHost` abstraction with `LocalRuntimeHost`/`HubRuntimeHost`/`RemoteRuntimeHost` implementations
— a Hub process can serve multiple attached clients (CLI, Desktop, VS Code) over WebSocket, brokering
sessions/events/approvals, distinct from the VS Code webview's internal gRPC bus. Local hub discovery
uses a per-process auth token with owner-only file permissions and constant-time comparison.
`sdk/ARCHITECTURE.md` also documents a file/SQLite "Agenda task" automation system
(`~/.cline/tasks/*.task.md` + `tasks.db`) and a cron/event automation system (`~/.cline/cron/` +
`cron.db`) that did not exist in legacy Cline at all.

**Migration status is itself a notable data point** (from `CHANGELOG.md` and the official blog):
first SDK-backed stable release shipped 2026-06-26 (v4.0.0), was **rolled back two days later**
(2026-06-28, v4.0.1) after regressions, relaunched 2026-07-31 (v4.1.0) as a **combined A/B package**
(one VSIX containing both the legacy and new extension, a ~46 KB loader activating exactly one per
window via a PostHog feature flag, with automatic fallback to legacy if the new bundle fails to
activate), held at a genuine 50/50 split "for over a week," and reached 100% rollout by 2026-08-23.
This entire migration story is detailed further in §12 because it is the single most instructive
piece of primary-source material found in this research.

## 3. Provider abstraction

**Legacy**: hand-rolled provider handler classes historically under `src/api/providers/` (Anthropic,
OpenAI, Bedrock, Vertex, Ollama, LM Studio, OpenRouter, etc., one class per vendor implementing a
common `ApiHandler` interface). This directory no longer exists in the current tree — exact legacy
filenames could not be independently re-confirmed today (GitHub's tree view for the old paths 404s
after the monorepo restructuring).

**Current**: Cline's provider layer is now built **on top of the Vercel AI SDK**, confirmed by
fetching `sdk/packages/llms/package.json` directly — dependencies include `"ai": "^7.0.58"` plus
official `@ai-sdk/*` packages (anthropic, amazon-bedrock, google, google-vertex, mistral, openai,
openai-compatible, gateway, otel) plus `@openrouter/ai-sdk-provider`, `ollama-ai-provider-v2`,
`dify-ai-provider`, `ai-sdk-provider-opencode-sdk`, and optional peer deps
`ai-sdk-provider-claude-code`/`ai-sdk-provider-codex-cli` (for driving the actual Claude Code/Codex
CLIs as "providers" — a notable cross-pollination point given this research's own subject matter).
On top of AI SDK, `sdk/packages/llms/src/providers/vendors/` holds thin per-vendor normalization
wrappers (`anthropic.ts`, `bedrock.ts`, `cline.ts` — Cline's own gateway/"ClinePass", `google.ts`,
`minimax-thinking.ts`, `mistral.ts`, `ollama.ts`, `openai-compatible.ts`, `openai.ts`, `vertex.ts`,
`community.ts`), plus `gateway.ts`, `model-registry.ts`, `model-capabilities.ts`, `model-facts.ts`,
generated provider/model catalogs, `billing.ts`, and a `routing/` directory. **The answer is "both": AI
SDK as the transport/provider-interface layer, wrapped in Cline's own catalog/gateway/normalization
code** — structurally the same layering choice OpenCode made independently (§3 above), which is
itself a signal that this is close to the industry-consensus shape for this problem.

**Local models**: confirmed yes — Ollama via `ollama-ai-provider-v2`, plus LM Studio and "any
OpenAI-compatible API" per the README. Cline Desktop is explicitly billed as "an open source app for
open weight models," reinforcing a local/open-weight-first positioning for that specific surface.

**Usage/cost**: shown live in the task header (secondary sources, not independently re-verified
against a live install); task history can be sorted by cost or token usage per official docs. A
dedicated blog post ("Cline's Context Window Explained") reportedly describes context-budget tracking
that triggers compaction or a new-task suggestion around ~50% usage — not fetched directly, treat as
paraphrased/secondary.

## 4. Session/state model

**Terminology**: Cline calls a unit of work a **"task,"** not a session — "a self-contained work
session initiated when you submit a prompt... every interaction with Cline happens within a task."
Each task has a unique id, a dedicated storage directory, full conversation history, token/cost/
duration tracking, git-based checkpoint snapshots, and can be suspended/resumed across editor
sessions.

**Storage — legacy**: VS Code's own `globalStorage` under the original extension id
`saoudrizwan.claude-dev` (`~/Library/Application Support/Code/User/globalStorage/...` on macOS,
equivalent paths on Windows/Linux): `state/taskHistory.json` (the task index) plus
`tasks/<task-id>/{api_conversation_history.json, ui_messages.json, task_metadata.json,
checkpoints/}`. This layout is community-sourced (consistent across multiple independent GitHub issue
reporters), not from an official docs page.

**Storage — current SDK/Hub runtime**: a unified `~/.cline/` directory (confirmed from
`sdk/ARCHITECTURE.md`, primary source): `~/.cline/data/workspaces/chat` (default hub-side chat
workspace, seeded with `AGENTS.md`), `~/.cline/tasks/*.task.md` (Agenda tasks) + `tasks.db` (SQLite),
`~/.cline/cron/` + `events/*.event.md` + `cron.db`, and MCP config at `~/.cline/mcp.json`. This is a
**materially different persistence model** from the legacy flat-JSON-per-task layout: Markdown specs
(user-editable, "canonical" description) plus SQLite (operational state/history) plus a Hub server
owning the canonical task manager, rather than flat JSON files owned by whichever process happens to
be running.

**Checkpoints ("shadow git")** — confirmed via official docs: Cline maintains a **separate shadow git
repository**, distinct from the project's real one, and commits the current state of all files
(including files the project's own `.gitignore` excludes) after every tool use. The user's real git
history is never touched. Restore has **three modes**: "Restore Files" (revert files, keep chat),
"Restore Task Only" (revert conversation, keep file changes — useful for rephrasing a request without
losing code already written), "Restore Files & Task" (both). Enabled by default, persists across
editor sessions. A stated performance caveat ("checkpoints may create significant storage demands and
slow operations on large repositories") is independently corroborated by a real CHANGELOG fix:
"Checkpoints no longer re-hash every untracked file on each message... a persistent per-task index now
lets git skip files it has already seen." The current gRPC contract
(`apps/vscode/proto/cline/checkpoints.proto`, fetched raw): `checkpointRestore(metadata, number,
restore_type, optional offset)`, `checkpointViewLatestChanges()` (opens a multi-file diff of
everything since the latest checkpoint), `checkpointLatestChangesCount()` (used purely to decide
whether to enable the "View Changes" button).

**History browsing**: sidebar "History" panel, fuzzy search across prompts/responses/code/filenames,
sortable by date/tokens/cost/relevance/favorites, tasks can be starred against deletion.

## 5. Tool catalogue

This is the area most affected by the 2026 rewrite; both generations are given because nearly all
existing secondary literature describes the legacy set.

**5a. Legacy tool set** (compiled from official "System Prompt" blog chapters plus a widely-circulated
community-captured system-prompt gist, cross-checked against hundreds of consistent GitHub issue
references):

| Tool | Purpose | Argument contract |
|---|---|---|
| `execute_command` | Run a CLI command | `command` + `requires_approval` (boolean — **the model itself** judges whether a command is destructive) |
| `read_file` | Read a file's contents | file path |
| `write_to_file` | Create or overwrite an **entire** file | `path`, `content` (the complete file, no placeholders) |
| `replace_in_file` | Targeted edit without rewriting the whole file | one or more SEARCH/REPLACE blocks (§6) |
| `search_files` | Regex search across a directory, with context | pattern + directory |
| `list_files` | List files/directories | path (+ recursive) |
| `list_code_definition_names` | Top-level classes/functions in a directory | directory path |
| `browser_action` | Puppeteer-driven headless browser (launch/click/type/scroll/close) | per-action params; default 1280×720 viewport |
| `use_mcp_tool` | Invoke an MCP server's tool | server, tool, JSON args |
| `access_mcp_resource` | Fetch an MCP resource (data, not an action) | server, resource URI |
| `ask_followup_question` | Ask the user a clarifying question | question (+ optional suggested answers) |
| `attempt_completion` | Signal task completion and present the result | result (+ optional demo command) |
| `new_task` | Start a fresh task, preloading a context summary, when the context window fills | context to preload |
| `plan_mode_respond` | Reply conversationally while in Plan Mode | response text |

Reported (not officially spec'd) limits, from GitHub issue reports of observed behavior: files above
~50 KB truncated on read; a single write/edit call capped around ~6,000 characters of new text
("Editor input too large..."); large diffs truncated to roughly the first 200 lines; internal env-var
knobs (`maxFileContentChars`, `maxAssistantTextChars`, `maxAssistantToolMarkupChars`) not yet exposed
as first-class settings.

**5b. Current tool set** — directly quoted from `docs/tools-reference/all-cline-tools.mdx` (fetched
raw, primary source):

> "The system provides seven core executable functions: `bash` (execute shell commands), `editor`
> (view and edit files), `read_files` (batch read multiple files), `apply_patch` (apply unified diffs
> to files), `search` (ripgrep-powered codebase search), `fetch_web` (HTTP requests with HTML-to-
> markdown conversion), `ask_question` (ask the user for input)... Older documentation references
> `read_file`, `replace_in_file`, and `execute_command`; current runtimes use the names listed above."

Groupings per the same doc: *code manipulation* = editor, read_files, apply_patch, search; *runtime
operations* = bash; *remote data* = fetch_web; *user interaction* = ask_question. The doc also states
explicitly: "The `Agent` class from `@cline/agents` does not include built-ins automatically — you
must supply tools explicitly," i.e. the seven tools are ClineCore's *default catalogue*, not something
hard-baked into the stateless agent loop itself. A separate SDK-generic docs page lists a slightly
different set (`read_files, search_codebase, run_commands, fetch_web_content, apply_patch, editor,
skills, ask_question, submit_and_exit`), suggesting some drift between SDK-generic and
product-specific naming; `submit_and_exit` is the functional successor to legacy `attempt_completion`.

**Browser tool status changed materially**: the legacy built-in `browser_action`/Puppeteer tool does
not appear in the new default set. Browser automation moved to an optional **plugin**
(`jev-browser`, Playwright-based, using a small specialized model to pick DOM-snapshot targets rather
than raw coordinates, requiring an `AI_GATEWAY_API_KEY`) — installed via
`cline plugin install jev-browser`, apparently opt-in rather than bundled by default.

**MCP tools** (`use_mcp_tool`/`access_mcp_resource`) likewise don't appear as named entries in the new
seven-tool list — MCP-provided tools are presumably surfaced dynamically per configured server as
"extended tools" rather than through one generic dispatcher tool, consistent with the general shift
toward native per-tool function-calling (§12) — **not fully verified**.

## 6. Editing model

**Legacy `replace_in_file` contract** (format confirmed via community capture, cross-checked against
dozens of GitHub issues quoting identical markers):
```
<<<<<<< SEARCH
[exact existing content to find]
=======
[new content to replace it with]
>>>>>>> REPLACE
```
Rules: the SEARCH block must match the file exactly, character for character (whitespace/indentation/
line endings included); a block replaces only the *first* occurrence; multiple blocks must be listed
in file order; each line must be complete (no mid-line truncation); deletion = empty REPLACE section;
moving code = a delete block plus an insert block.

**This flakiness is real and extensively documented**, not a rumor — dozens of GitHub issues
(#973, #1195, #1511, #3183, #3513, #4011, #4067, #4216, #4384 as a tracking issue, #7600, #8779)
describe "Diff Edit Failed" errors when the SEARCH block doesn't match exactly, often from invisible
whitespace/line-ending drift between what the model remembers and the real file. Reported failure
modes: infinite retry loops on repeated mismatch, out-of-order SEARCH/REPLACE blocks silently failing,
and — most seriously — a documented case (#3183) of a **fallback to `write_to_file` that corrupted a
file** by writing back placeholder/truncated content instead of the complete file. This history is
directly why OpenCode ported Cline's own later fuzzy-diff-apply eval code (§6 in Part 1) — Cline's
public evals repository (`evals/diff-edits/diff-apply/diff-06-23-25.ts`,
`diff-06-26-25.ts`) is itself evidence Cline's team was actively iterating on exactly this problem.

**Current contract, `apply_patch`**: "Apply unified diffs to files" — the model now emits a standard
unified diff (`---`/`+++`/`@@` hunks) rather than the bespoke SEARCH/REPLACE marker syntax. This is a
direct, stated response to the diagnosis in the migration blog (§12): the legacy harness's marker-
based formats were scaffolding for 2024-era models that needed heavy guidance to emit well-formed tool
calls; 2026 models are natively RL-trained for tool calling, so the new formats need less compensatory
parsing/retry logic. The CHANGELOG documents ongoing hardening — `apply_patch` no longer silently
overwrites an existing file on a mistaken "Add File" against a path that already exists, and now
preserves a file's existing CRLF line endings — concrete evidence the tool is actively used and
actively being made more robust. Whether `apply_patch` has fully eliminated the class of bugs
`replace_in_file` had is **not directly verified**; the blog's headline ~10x drop in
`task.mistake_limit_reached` is presented as covering tool-format failures broadly, which would
include diff-application failures, but no isolated before/after number for diff-apply specifically was
found.

The `editor` tool separately handles whole-file "view and edit," functionally absorbing legacy
`read_file` (view) and `write_to_file` (create/overwrite) into one tool surface — **inferred** from
the docs' grouping rather than an explicit statement.

## 7. Shell model

**Legacy `execute_command`**: ran inside a **reused VS Code integrated terminal** (not one-shot per
call) via VS Code's shell-integration API, with well-documented reliability problems: commands timing
out at ~30 seconds while the real process kept running in the background terminal; shell-integration
API failures causing Cline to receive no output at all; pager-using processes hanging forever because
they never emit an EOF Cline recognizes. The official fix post ["We Fixed the Terminal"](
https://cline.bot/blog/cline-v3-18-1-4-we-fixed-the-terminal) describes adding a fallback to reading
the terminal's raw content directly when structured shell-integration capture fails.

**Current `bash`/`run_commands`**: per the CHANGELOG, "no longer hangs until its timeout after a
command that backgrounds a child process. The command had finished, but the backgrounded process held
the output pipes open" — confirming (a) a timeout mechanism exists and (b) **backgrounded/detached
processes are explicitly reasoned about**. `sdk/ARCHITECTURE.md` documents a deliberate "Detached
Process Management" design: a shell advertises detachability after spawning and registering with the
host command controller; a client can send `run.proceed_while_running` to detach from a still-running
command while it continues server-side; detached logs are size-capped, retained for a bounded
inspection window, then removed; active-command identity is tracked via a `(PID, generation token)`
pair specifically to avoid PID-reuse bugs. This is materially more deliberate than the legacy
terminal-reuse approach, and directly comparable to Agentistics' own tmux-based `SessionBackend`
design.

Output capture/truncation: default truncation of large tool outputs, capped assistant text, bounded
media budgets (per CHANGELOG); exact numeric limits are not published in official docs. A concrete
fixed bug worth noting: commands that succeed silently (`git add -A` on a clean tree) were previously
misreported as a shell-integration *failure*; now correctly reported as empty successful output.

## 8. Permissions/sandbox

**Auto-Approve** is evaluated per tool call against a **model-assigned `requires_approval` flag**
rather than a fixed command allowlist — the model itself judges whether e.g. `npm run build` (commonly
safe) vs `rm -rf <path>` (commonly requires approval) is destructive, and the user's settings decide
whether that category auto-proceeds. Categories (from `docs/features/auto-approve.mdx`, primary
source): read project files / read all files, edit project files / edit all files, execute safe
commands / execute all commands, use the browser, use MCP servers, enable notifications.

**"YOLO Mode"**: historically a single toggle that auto-approves everything — file changes anywhere,
all commands, browser, MCP, even Plan→Act transitions — with an explicit in-docs danger warning.
Notably, the CHANGELOG documents this being **removed as a distinct toggle**: "Make the auto-approve
menu the single source of truth for unattended runs and remove the Yolo Mode toggle, which was
cosmetic: nothing in the approval path read it. Setups that had Yolo Mode... turned on are migrated to
auto-approving every action." This is a real, primary-source UX simplification; the still-live docs
page describing a "YOLO Mode" checkbox may be slightly stale relative to this change, or describes a
still-marketed concept now implemented as the natural extreme of the granular menu — **an open,
unreconciled discrepancy between two primary sources**.

**Sandboxing beyond VS Code's own**: none documented for the model's own tool calls — the docs frame
safety procedurally (isolated environments, throwaway projects, keeping version control handy) plus
Checkpoints as the rollback safety net, not process isolation. One genuine counter-datapoint: per
`sdk/ARCHITECTURE.md`, "Sandboxed plugin subprocesses are session-local but lazily recreatable. Core
reclaims a sandbox after 30 minutes without an in-flight RPC call" — so **plugin code specifically**
does run in an isolated subprocess with an idle-timeout reclaim policy, but this is a boundary around
plugin code, not around the model's own bash/editor/apply_patch calls, which still run with the full
privileges of the host user account. A real, concrete illustration of the lack of sandboxing: a fixed
Windows security bug where opening a repository containing a file literally named `rg.exe`, `git.exe`,
or `powershell.exe` would run *that* file instead of the real program (fixed via Windows'
`NoDefaultCurrentDirectoryInExePath` at startup) — evidence of ad hoc hardening against specific
discovered vulnerabilities, not systematic sandboxing.

## 9. Subagents/delegation

Native subagents shipped in the legacy codebase at v3.58.0 ("spin up sub-tasks that run in parallel,
each with their own context"), were **temporarily disabled during the SDK migration** (v4.0.0
CHANGELOG: "Temporarily disable... in the VS Code extension while the SDK-backed experience is
stabilized"), and were brought back in the current architecture.

**Current documented behavior** (`docs/features/subagents.mdx`): subagents are "focused research
agents spawned by Cline to explore codebases in parallel," each with its own prompt and context
window, auto-deployed when useful or explicitly requested, run genuinely in parallel ("launched
simultaneously"), with cost tracked separately per subagent and rolled up into the task total.
**Allowed tools** (documented using legacy names, possibly not yet updated to the new tool table):
`read_file`, `list_files`, `search_files`, `list_code_definition_names`, `execute_command`
(read-only only), `use_skill`. **Explicitly prohibited**: file editing, browser access, MCP servers,
nested subagent spawning (no subagent-of-a-subagent), and system-state modification. A subagent
returns a report (file paths + findings) to the parent rather than mutating shared state directly.

A merged PR ([#14197](https://github.com/cline/cline/pull/14197)) fixed a real concurrency bug where
parallel tool calls (including subagent launches) were being *prepared* sequentially despite being
meant to *execute* in parallel — each tool call now gets its own concurrent prepare→execute chain,
"allowing approvals, hooks, and delegated-agent startup to proceed independently while preserving
result order." This is primary-source confirmation that true parallel subagent execution is an active
engineering concern, not just a marketing claim.

**Beyond simple subagents**: `sdk/ARCHITECTURE.md` and the SDK announcement blog describe native
**"agent teams"** — "a session can delegate to specialists, track progress, and exchange handoff
notes, all inside the same core runtime" — with a `mode: "team"` value alongside `user`/`automation`/
`subagent` for `StartSessionInput.mode`, and language distinguishing generic subagents from
"teammates." No dedicated feature page distinct from `subagents.mdx` was found — this may be CLI/
Kanban/SDK-only at present, **flagged as partially documented / in progress**.

**Multiple concurrent top-level tasks** (distinct from subagents-within-a-task): Cline Desktop
explicitly supports running multiple sessions in parallel; the CLI's `--zen` flag "dispatches tasks to
a background daemon, allowing you to exit immediately while work continues asynchronously."

## 10. MCP support

Cline was an early, prominent MCP adopter. Configuration: current SDK/CLI runtime uses
`~/.cline/mcp.json`; the legacy VS Code extension used `cline_mcp_settings.json` inside its own
`globalStorage` settings folder, now consolidated ("Migrate legacy MCP files and formats into the
shared settings file and protect MCP settings writes with safer locking/atomic updates" — CHANGELOG,
v4.0.0). Server types: local **stdio** (`command`+`args`) and remote **Streamable HTTP** and **SSE**
(`url` + optional headers, described as suited to "hosted endpoint, centralized deployment, multi-
client usage"). Config supports `disabled` and `autoApprove` (an array of tool names) per server. CLI
tooling: an interactive `cline mcp` wizard plus scriptable `cline config mcp`/`cline config mcp
--json`.

**Namespacing**: no explicit documented convention (e.g. no stated `server.tool` string format) was
found — standard MCP-client behavior is assumed but not confirmed with a Cline-specific citation.

**Resources vs. tools**: the legacy split (`use_mcp_tool` for actions, `access_mcp_resource` for data)
matches the underlying MCP spec's own tools/resources distinction; the current SDK-era docs do not
re-state this split explicitly, and it's unclear whether it survives in the new native-tool-calling
model or MCP tools are now each registered as their own native function-call target — **not
verified**.

**MCP Marketplace**: folded into a broader **"Customize" marketplace** covering Skills, MCP servers,
and Plugins together, confirmed structurally by `apps/vscode/proto/cline/marketplace.proto`'s generic
`MarketplaceService` (getMarketplaceCatalog, list/install/uninstall/toggle entries) alongside a
separate, more specific `McpService` (`toggleMcpServer`, `updateMcpTimeout`, `addRemoteMcpServer`,
`restartMcpServer`, `deleteMcpServer`, `toggleToolAutoApprove`, `openMcpSettings`,
`authenticateMcpServer` — confirming OAuth support for MCP servers, `getLatestMcpServers`,
`subscribeToMcpServers` — a streaming subscription for live server-state updates). No current, direct
evidence was found of a dedicated "MCP builder wizard" (a well-known historical Cline capability for
scaffolding a new MCP server on request) — likely superseded by the general Plugin system rather than
confirmed removed.

## 11. Extension points

**`.clinerules`**: workspace rules at `.clinerules/` or `.cline/rules/` (Markdown, optional numeric
prefixes for ordering, committed to version control); global/personal rules at
`~/Documents/Cline/Rules` (macOS/Linux) or the Windows equivalent, with fallback paths also checked.
Cline's Rules panel additionally recognizes and can toggle **other tools' rule files directly** —
`.cursorrules` (Cursor), `.windsurfrules` (Windsurf), and `AGENTS.md`/`~/.agents/AGENTS.md` (the
emerging cross-tool convention) — individually toggleable. Format: Markdown body with optional YAML
frontmatter for conditional activation (e.g. a `paths:` glob scoping a rule to matching files); a rule
with no frontmatter is always active; invalid YAML "fails open" (shows raw content rather than
silently erroring). Workspace rules override global rules on conflict. No first-party "Memory Bank"
concept was found — that appears to be a community convention built atop `.clinerules`, not an
official feature.

**Skills**: a first-class current concept distinct from rules, invoked as a tool (`use_skill` in
legacy/subagent-facing docs, `skills` in the newer SDK tool table), distributed via the Customize
Marketplace, and can be bundled inside a Plugin. A `skills-lock.json` file exists in the repo,
implying a package-manager-style lockfile for pinned skill versions.

**Plugins**: the broadest current extension point (introduced v4.0.0) — "extend Cline with custom
tools, workflows, skills, and MCP-powered capabilities tailored to your team or project," installed
from the Customize marketplace. This is how `jev-browser` (§5b) is delivered. Plugin loading/
sandboxing lives under `@cline/core`'s `extensions/plugin` module, sandboxed with the 30-minute
idle-timeout reclaim policy noted in §8.

**Custom tools via SDK**: `docs/sdk/guides/creating-custom-tools.md` documents a path for fully
custom, type-safe tools ("Define, register, and test custom tools with type-safe schemas") — this is
explicitly **SDK/CLI/Kanban-only today** ("VSCode and JetBrains extensions excluded for now"),
distinct from the end-user-facing Rules/Skills/Plugins/MCP surfaces.

**Workflows**: referenced repeatedly in the CHANGELOG as an adjacent concept to Rules/Skills/MCP/
Plugins (slash-command-driven, e.g. a `/deep-planning` command cited by a secondary source), but no
dedicated current docs page fully specifying the Workflows authoring format was found — flagged as a
real feature whose exact contract could not be pinned down today. The boundary between Skills,
Workflows, and Rules is genuinely fuzzy in current docs, plausibly reflecting these concepts still
settling post-rewrite.

## 12. Reusable as a dependency vs. reimplement, given Bun/single-binary/our-own-journal/our-own-ALM

- **Reusable as a dependency, directly**: same conclusion as OpenCode — `@cline/sdk` itself wraps the
  Vercel AI SDK, so if Agentistics adopts AI SDK for its provider layer (recommended above), that
  choice is validated independently by both projects rather than being Cline-specific. `@cline/sdk`
  as a whole package is **not** recommended as a dependency: it is a large, opinionated runtime
  (sessions, Hub/WebSocket brokering, Agenda tasks, cron automation) built for Cline's own product
  shape, and adopting it would mean adopting its session model, storage layout, and Hub protocol
  wholesale rather than composing pieces.
- **Imitate the pattern, do not depend on the code**: the **three-layer Presentation / Core / Host-
  Provider split** (§2) is a genuinely good architectural pattern independent of Cline's specific
  protobuf choices — it maps closely onto what Agentistics already does with `agentop server` as the
  host and the TUI/web/VS-Code-extension as clients, and validates that direction rather than
  suggesting a change. The **checkpoints-as-shadow-git** design (§4) is directly comparable to and
  worth comparing against Agentistics' own `src/snapshot/`-style revert mechanism in OpenCode and to
  whatever Agentistics eventually builds for "restore file state without touching the user's real git
  history" — the three-mode restore (files-only / task-only / both) is a clean UX split worth copying
  verbatim as a design, regardless of implementation.
- **The single most valuable piece of writing to imitate, not vendor**: the migration blog post itself
  (§ below) as an internal engineering discipline — instrument the legacy path with the same
  telemetry as the new one *before* comparing them, pick one hard metric (their
  `task.mistake_limit_reached`), and use a real held A/B split rather than a staged rollout alone. This
  is a process lesson, not code, but it is exactly the kind of lesson Agentistics would need if it ever
  replaces a core piece of its own session/tool machinery.
- **Vendor with attribution, small and self-contained**: Cline's `evals/diff-edits/diff-apply/
  diff-06-23-25.ts` and `diff-06-26-25.ts` fuzzy-diff-apply algorithms are the **original** of what
  OpenCode ported (see Part 1 §6/§12) — if Agentistics builds a diff-based edit tool, going to Cline's
  own eval code directly (Apache-2.0, so attribution + a NOTICE mention is required) is at least as
  good a starting point as OpenCode's MIT port, and arguably better since it's the source rather than
  a derivative.
- **Reimplement, informed by the design**: the **detached/background process model** (§7 —
  `run.proceed_while_running`, size-capped detached logs with a bounded inspection window, `(PID,
  generation token)` identity to survive PID reuse) is a well-thought-out design worth reimplementing
  against Agentistics' own tmux-based shell/session backend rather than depending on Cline's Node-
  process implementation, which assumes a very different process model. The **model-assigned
  `requires_approval` flag** for auto-approve categories (§8) is a genuinely different idea from
  OpenCode's static ruleset-plus-wildcard-pattern approach — worth evaluating on its own merits (the
  model judging its own command's destructiveness is a softer, more flexible signal than a fixed
  pattern table, but also a signal that can be wrong or manipulated) rather than either vendoring or
  dismissing outright.
- **Do not adopt**: the legacy `replace_in_file` SEARCH/REPLACE marker format itself is the thing Cline
  moved *away* from and documented extensively why (§6, §12) — it should be treated as a cautionary
  example, not a pattern to copy, precisely because both Cline's own post-mortem and OpenCode's
  independent fuzzy-match workaround exist because of its fragility.

---

# WHAT WE SHOULD BORROW

Ranked by confidence and concreteness; "depend" = add as an npm/Bun dependency, "vendor" = copy the
code in-tree with attribution (both projects are permissive-but-attribution-bearing: MIT for
OpenCode, Apache-2.0 for Cline — an Apache-2.0 vendor needs a NOTICE mention, not just a licence
copy), "imitate" = reproduce the design in Agentistics' own idiom without copying code.

1. **Depend on the Vercel AI SDK (`ai` + `@ai-sdk/*`) for the provider layer.** Both OpenCode and
   Cline independently converged on this after starting with bespoke per-vendor clients. It already
   covers Anthropic, OpenAI, Bedrock, Vertex, Google, Mistral, xAI, Groq, Cerebras, OpenRouter, and
   OpenAI-compatible/local endpoints (Ollama et al. via community `ai-sdk-provider-*` packages) —
   directly matches Agentistics' own `MODEL_PRICING`/multi-harness provider-resolution needs without
   reimplementing a client per vendor. Module: `ai` + selected `@ai-sdk/*` packages.
2. **Depend on `@modelcontextprotocol/sdk`** for MCP client transport (stdio + SSE/Streamable HTTP),
   rather than hand-rolling the MCP wire protocol. Both projects use the official SDK directly.
3. **Imitate OpenCode's client/server + SSE shape, in plain Bun/TypeScript, not Effect-TS.** An HTTP
   server with OpenAPI-generated routes, a single project-scoped SSE `/event` stream, and every UI
   (TUI/web/editor) as a client of it — this validates and extends the direction `agentop server` /
   `cli-start.ts` already takes. Do not adopt Effect-TS itself; the shape is separable from the
   framework.
4. **Vendor (with attribution) a diff-apply fuzzy-match algorithm** for a native edit tool — either
   from Cline's own `evals/diff-edits/diff-apply/diff-06-26-25.ts` (Apache-2.0, the original) or
   OpenCode's port in `tool/edit.ts` (MIT, a derivative with its own refinements: the replacer chain,
   the anchor+similarity scoring, the escape-normalization step). This directly avoids re-deriving a
   ~700-line algorithm and its thresholds from scratch, and both projects' extensive GitHub issue
   histories (Cline's flakiness reports, OpenCode's port) document exactly which edge cases it needs
   to survive.
5. **Imitate OpenCode's permission evaluator shape**: `Ruleset = {action, permission, pattern}[]`,
   last-matching-rule-wins, both dimensions independently wildcard-matched, with the ask carrying
   free-form `metadata` (a diff, the touched patterns) for the approval UI to render. Small enough
   (~20 lines) to reimplement rather than vendor.
6. **Imitate OpenCode's tree-sitter-based shell-command AST scanning** for scoped permission patterns
   (extracting which files/directories a shell command actually touches, rather than asking a blanket
   "run this command?" question) — the single most valuable idea in either project's permission
   stack, worth reimplementing against Agentistics' own tmux-based shell backend.
7. **Vendor OpenCode's `arity.ts` idea** (a small, LLM-generated command-prefix → token-count table
   collapsing `git checkout main` into a stable `git checkout` permission subject) — self-contained
   and directly portable regardless of which shell backend is used.
8. **Imitate Cline's three-mode checkpoint restore UX** (files-only / task-only / both) as the design
   for whatever "undo what an agent did without touching the user's real git history" feature
   Agentistics builds — a clean, well-tested UX split independent of Cline's shadow-git implementation
   details.
9. **Imitate Cline's detached-process model** (`run.proceed_while_running`, size-capped detached logs
   with a bounded inspection window, `(PID, generation token)` identity to survive PID reuse) for
   background shell execution — reimplement against tmux rather than depend on Cline's code.
10. **Imitate — as an engineering-process lesson, not code — Cline's migration methodology**:
    instrument the old path with the same telemetry as the new one before comparing, pick one hard
    regression metric, hold a real A/B split long enough for statistical confidence, and build an
    automatic-fallback mechanism into the rollout itself. Directly applicable the next time
    Agentistics replaces a load-bearing subsystem (e.g. the session manager, the shell backend).
11. **Do not adopt**: OpenCode's shell tool (one-shot spawn despite a "persistent" prompt claim — a
    documented inconsistency, not a pattern to copy) and Cline's legacy `replace_in_file` marker
    format (the thing both projects' own evidence shows was worth escaping).

---

# NOT VERIFIED

Flagged inline throughout, collected here for visibility:

**OpenCode**
- The exact SSE event catalogue in `bus/bus-event.ts` — not opened directly; the commonly-repeated
  description (`server.connected`, 30s heartbeats, full bus forwarding) comes from a Medium write-up
  and GitHub issue #11616 only.
- Whether `drizzle-orm` (a devDependency) backs any part of session storage — the storage code
  actually read (`storage/storage.ts`) is flat JSON files.
- Ollama specifically as a named integration — the generic OpenAI-compatible `baseURL` override
  mechanism is confirmed; the literal string "ollama" was not found in the files opened.
- The full `Hooks` union a plugin can return — only the `AuthHook` variant was read in detail.
- Whether the shell tool's `background` execution goes through the same `BackgroundJob` module
  `task.ts` uses — no `background` parameter was found in `shell.ts` itself.
- What the `code-mode.ts` experimental alternate tool-calling mode actually does — not read in depth.
- The replacement route for the deprecated `POST /session/:id/permissions/:id` endpoint.

**Cline**
- Exact legacy `src/api/providers/` filenames — the old paths 404 after the monorepo restructuring;
  reconstructed from community knowledge rather than fetched directly today.
- The precise date gRPC-over-postMessage was introduced in the legacy webview bridge — no dedicated
  migration post was found; it appears to predate searchable blog archives.
- The reported port 26040 for the standalone/CLI gRPC ProtoBus server — one secondary source only.
- Whether the MCP resources-vs-tools distinction (`use_mcp_tool`/`access_mcp_resource`) survives
  under the new native-tool-calling model, or each MCP tool is now a native function-call target.
- Cline's MCP tool namespacing convention — no explicit statement found either way.
- Whether a dedicated "MCP builder" wizard still exists distinct from the general Plugin system.
- The exact Workflows authoring format — referenced repeatedly in the CHANGELOG but no dedicated
  current spec page was found.
- Whether `jev-browser` is bundled by default or purely opt-in as of today (evidence points to
  opt-in, via a separate `cline plugin install` step, but this is not a direct confirmation).
- The current state of the "YOLO Mode" UI — an open discrepancy between the still-live docs page
  (describing a standalone toggle) and a CHANGELOG entry stating the toggle was removed and folded
  into the granular auto-approve menu.
- JetBrains plugin architecture details ("headless core daemon") — one secondary source
  (plugins.jetbrains.com listing), not cross-checked against JetBrains' own changelog.
- Whether Cline Desktop's cross-agent task import (from Claude Code / OpenAI Codex) works as
  described — vendor's own claim only, not independently tested.
- "Agent teams" (`mode: "team"` in `StartSessionInput`) as a feature distinct from ordinary
  subagents — mentioned in `sdk/ARCHITECTURE.md` and the SDK blog but no dedicated feature page found;
  may be CLI/Kanban/SDK-only today.
