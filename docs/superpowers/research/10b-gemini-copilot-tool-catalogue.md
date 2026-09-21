# Gemini CLI and GitHub Copilot CLI — tool catalogue, editing model, sandbox and delegation

**Provenance:** produced by a research subagent on 2026-09-20 from official sources only — the
Gemini CLI docs (`geminicli.com/docs/**`, mirrored from `github.com/google-gemini/gemini-cli/docs`)
and GitHub's own Copilot CLI docs (`docs.github.com/en/copilot/**`), cross-checked against the
**locally installed CLIs' own `--help` / `help <topic>` output** (Gemini CLI 0.58.0, GitHub Copilot
CLI 1.0.85 — read-only; no interactive session or prompt was ever sent to either binary). No
leaked/deobfuscated proprietary source was read. Every claim below is sourced; anything not
confirmed against an official page or the local `--help` is flagged inline and re-listed under
"NOT VERIFIED".

---

# Part A — Gemini CLI

## 1. Tools exposed to the model

| Tool | Contract |
|---|---|
| `read_file` (ReadFile) | `file_path` (required), `offset` (0-based start line), `limit` (max lines). Reads text, images, audio and PDF. Exact truncation thresholds are undocumented. |
| `write_file` (WriteFile) | `file_path`, `content` — full overwrite/create. Requires manual confirmation. |
| `glob` (FindFiles) | `pattern`, `path` (default: root), `case_sensitive` (default `false`), `respect_git_ignore` (default `true`). Returns absolute paths, most-recently-modified first; ignores `node_modules`/`.git` by default. |
| `grep_search` / `search_file_content` (SearchText, `search_file_content` is a legacy alias) | `pattern` (regex), `path`, `include` (glob filter). Uses `git grep` inside a git repo for speed, else system `grep`, else a JS fallback. Returns matching lines with file + line number. |
| `replace` (Edit) | `file_path`, `instruction` (semantic description, shown to the user), `old_string`, `new_string`, `allow_multiple` (default `false` — requires exactly one match unless set). Requires "significant context" around `old_string` and manual confirmation. |
| `list_directory` (ReadFolder) | `dir_path`, `ignore` (glob array), `file_filtering_options` (`.gitignore`/`.geminiignore` compliance). Lists immediate children only. |
| `read_many_files` | triggered by the CLI's own `@path` syntax; batches multiple file reads into one call. |
| `run_shell_command` | see §3. |
| `google_web_search` | `query` (required). Returns a synthesized summary plus source URIs/titles ("grounding") — not raw HTML. |
| `web_fetch` | `prompt` (required) containing up to **20** URLs plus instructions; blocks private/reserved/loopback/internal-network destinations (RFC1918 etc.), pins the TCP connection to the resolved IP, and re-validates the IP on redirect. Uses the Gemini API's `urlContext` first, falls back to raw fetch (same IP checks) if that fails. Always asks for confirmation in Plan mode. |
| `save_memory` | appends durable facts to a `GEMINI.md` file (see §9/§11). |
| MCP tools | 1:1 bridge from configured MCP servers, FQN `mcp_{serverName}_{toolName}` (see §7). |
| subagent delegation | not a single "task" tool call in the classic sense — the orchestrator routes to named subagents (see §8). |

Sources: [File system tools reference](https://geminicli.com/docs/tools/file-system/) (accessed 2026-09-20), [Shell tool](https://geminicli.com/docs/tools/shell/) (2026-09-20), [web_fetch](https://geminicli.com/docs/tools/web-fetch/) (2026-09-20), [Memory files](https://geminicli.com/docs/tools/memory/) (2026-09-20), [MCP servers with Gemini CLI](https://geminicli.com/docs/tools/mcp-server/) (2026-09-20).

The CLI's own `--prompt`/`interactive` shortcuts (`@file` → `read_many_files`, `!cmd` → `run_shell_command`) are documented in the same file-system/shell pages above.

## 2. File editing — full write vs string replace vs patch

Two distinct tools, no unified patch grammar:

- **`write_file`** is a **full overwrite** — the whole file content is supplied by the model every time, no diff/patch format.
- **`replace`** is a **string-replace** tool: exact `old_string` → `new_string`, one match required by default (`allow_multiple` opts into replacing every occurrence). The docs explicitly ask for "significant context around `old_string`" — Gemini CLI leans on surrounding text rather than line numbers or a context-tier fallback (contrast Codex's `apply_patch`, which tries three decreasing whitespace-tolerance tiers).
- **No documented read-before-write / staleness check** was found (no equivalent of "the file must have been read in this turn before an edit is accepted"); both write tools instead force a manual confirmation dialog showing a diff, which is the human-in-the-loop substitute.
- **Checkpointing is the closest thing to a staleness safety net**: every approved file-modifying tool call is preceded by a commit into a **shadow git repository** at `~/.gemini/history/<project_hash>` (separate from the project's own `.git`), bundled with the conversation history and the specific tool call as JSON under `~/.gemini/tmp/<project_hash>/checkpoints`. `/restore` (no args) lists checkpoints; `/restore <file>` reverts the working tree *and* conversation to that point and re-proposes the original tool call for a fresh decision. **Disabled by default**, opt-in via `settings.json`. Source: [Checkpointing](https://geminicli.com/docs/cli/checkpointing/) (accessed 2026-09-20, content retrieved via search/fetch of the official page).

## 3. Shell

`run_shell_command` — one tool, three modes:

- **One-shot by default**: `bash -c` on Unix, `powershell.exe` on Windows.
- **Interactive/PTY**: `tools.shell.enableInteractiveShell` turns on a pseudo-terminal so interactive commands (pagers, prompts) work.
- **Background jobs**: an `is_background` argument; the call returns immediately and the response carries `Background PIDs` for processes left running.
- **Timeout**: `tools.shell.inactivityTimeout` (seconds) kills a process that stops producing output — an *inactivity* timeout, not a hard wall-clock cap.
- **Output**: response fields are `Stdout`, `Stderr`, `Exit Code`; no documented byte/line truncation limit (unlike Codex's `max_output_tokens`/`original_token_count`).
- **Confirmation/allowlisting**: `tools.core` allowlists specific commands (e.g. `run_shell_command(git)`); `tools.exclude` is a deprecated blocklist, both superseded by the Policy Engine (§10). Blocklist precedence wins over an allowlist entry.
- **Environment**: sets `GEMINI_CLI=1` so subprocesses can detect they're running under the agent.
- **Sandboxing** is a separate, opt-in layer (§10), not inherent to the shell tool itself.

Source: [Shell tool (`run_shell_command`)](https://geminicli.com/docs/tools/shell/) (accessed 2026-09-20).

## 4. Search

- `glob` (pattern matching) and `grep_search` (content search) are the two built-ins; no semantic/embedding-based search or persistent index is documented for the core CLI.
- `grep_search` prefers `git grep` when inside a repo (speed), else the system `grep`, else a JS fallback — a runtime capability cascade, not an index.
- The **Browser Agent subagent** (§8) can additionally read a live DOM/accessibility tree, which is a form of "search" over rendered content rather than files.

Source: [File system tools reference](https://geminicli.com/docs/tools/file-system/) (2026-09-20).

## 5. Git

- **No first-class git tool.** All git operations go through `run_shell_command`; the shell allowlist syntax (`run_shell_command(git)`) exists specifically because git/`gh` first-level subcommands are a common approval unit, but there is no dedicated `git_commit`/`git_diff` tool.
- **Worktrees are first-class at the CLI level, not the tool level**: `-w, --worktree [name]` starts the whole session inside a new git worktree (auto-named if omitted) — this is a session-launch flag from the top-level `--help`, confirmed locally (`gemini --help`, accessed 2026-09-20).
- **Checkpoints/undo**: see §2 — the shadow-git-repo `/restore` mechanism is the closest thing to git-based undo, and it is independent of the project's real git history.

## 6. Web / browser

- `google_web_search` (search + synthesized/grounded summary) and `web_fetch` (URL content, private-network-blocked, up to 20 URLs per call) are the built-in web tools — both are fetch/summarize, not a driven browser.
- **Real browser automation exists, but only via the built-in `browser_agent` subagent** (§8): it drives an actual Chrome instance (navigate, fill forms, click, read via the accessibility tree, optional vision-based coordinate clicking), requires **Chrome 144+**, and is **disabled by default**. This is a materially different capability from `web_fetch`/`google_web_search` and should not be conflated with them.

Sources: [web_fetch](https://geminicli.com/docs/tools/web-fetch/), [Subagents](https://geminicli.com/docs/core/subagents/) (both accessed 2026-09-20).

## 7. MCP

- **Full client support.** Config lives in `settings.json` under `mcpServers`, at two scopes: **project** (`.gemini/settings.json`) and **user** (`~/.gemini/settings.json`); `gemini mcp add/remove/list/enable/disable` manage entries from the CLI (confirmed locally via `gemini mcp --help` and `gemini mcp add --help`, 2026-09-20).
- **Transports**: `stdio` (`command`/`args`), `sse` (`url`), and streamable `http` (`httpUrl`, custom headers). `-t/--transport` on `gemini mcp add`.
- **Namespacing**: every MCP tool gets a fully-qualified name `mcp_{serverName}_{toolName}` (single underscore after `mcp_`) for the Policy Engine and tool registry; docs explicitly warn against underscores *inside* server names because the FQN parser splits on the **first** underscore after the `mcp_` prefix, which can silently break wildcard/deny rules. A **separate, double-underscore form** (`Server__Tool`) is used when referencing MCP tools inside subagent `tools:` lists.
- **Trust**: `--trust` on `mcp add` (or `trust: true` in config) bypasses all confirmation prompts for that server's tools; otherwise tool-level or server-level "always allow" choices are offered interactively. OAuth-protected servers get `/mcp auth`.
- `--include-tools`/`--exclude-tools` on `mcp add` filter which tools of a server are even registered.

Sources: [MCP servers with Gemini CLI](https://geminicli.com/docs/tools/mcp-server/), [Policy engine](https://geminicli.com/docs/reference/policy-engine/) (both 2026-09-20); local `gemini mcp --help` / `gemini mcp add --help` (2026-09-20).

## 8. Subagents / delegation

Shipped as **"Subagents"**, a first-class orchestration feature (not just an extension mechanism):

- **Definition**: Markdown + YAML frontmatter files at `.gemini/agents/*.md` (project) or `~/.gemini/agents/*.md` (user); the Markdown body is the subagent's system prompt.
- **Frontmatter fields**: `name` (required, unique, lowercase/digits/hyphen/underscore), `description` (required — used by the orchestrator to decide when to route to it), `model` (defaults to inheriting the parent session's model), `temperature` (0.0–2.0), `max_turns` (**default 30**), `timeout_mins` (**default 10**), `tools` (allowlist, supports `*`, `mcp_*`, `mcp_server_*` wildcards), `mcpServers` (inline MCP servers scoped to just that subagent), `kind` (`local` or `remote`).
- **Isolation**: each subagent has an independent conversation history and its own tool set, so its work does not bloat the parent's context.
- **Depth is hard-bounded at one level**: "subagents cannot call other subagents" — even a `*` tool wildcard does not expose the delegation mechanism recursively, so there is no runaway subagent tree.
- **Two invocation modes**: automatic (the orchestrating model routes based on `description`) and explicit (`@agent-name` in the user's prompt).
- **Four built-ins**: `generalist` (inherits the parent's full tool/model config; high-volume/multi-file work), `cli_help` (Gemini CLI's own docs/config expertise), `codebase_investigator` (architecture mapping, bug root-causing), `browser_agent` (real Chrome automation — see §6; session modes `persistent`/`isolated`/`existing`; default action rate limit **100/task**; domain restrictions and dangerous-URL-scheme blocking built in).
- **Policy Engine integration**: rules in `policy.toml` can carry a `subagent` field, so tool permissions can be scoped per-subagent without touching the global session policy.
- **Off switch**: `experimental.enableAgents: false` in `settings.json`.

Source: [Subagents](https://geminicli.com/docs/core/subagents/) (accessed 2026-09-20); announcement context: [Subagents have arrived in Gemini CLI](https://developers.googleblog.com/subagents-have-arrived-in-gemini-cli/) (2026-09-20).

## 9. Background / long-running work and daemon/server mode

- **`is_background` on `run_shell_command`** (§3) — the only per-call background primitive; the tool result carries the PID(s) and the model must poll/inspect separately (no dedicated `read_bash`-style output-streaming tool is documented for Gemini CLI, unlike Copilot's bash-session tools).
- **`--acp` / `--experimental-acp`**: starts Gemini CLI as an **Agent Client Protocol server** — this is Gemini CLI's IDE-embeddable daemon mode (confirmed locally via `gemini --help`, 2026-09-20).
- **`gemini gemma`**: a genuinely separate local daemon — `setup`/`start`/`stop`/`status`/`logs` for a local **LiteRT-LM server** that gives on-device Gemma model routing (confirmed locally via `gemini gemma --help`, 2026-09-20).
- **Session persistence**: `--resume [latest|index]`, `--session-file`, `--session-id`, `--list-sessions`, `--delete-session` — sessions are resumable across process restarts (local `--help`, 2026-09-20), separate from the daemon question but relevant to a "long-running work" design.
- **Sandboxed subprocess execution can itself run as a container** (Docker/Podman), which is adjacent to but not the same as a daemon mode — see §10.

## 10. Permission model

- **Approval modes** (`--approval-mode`, four discrete values, confirmed locally via `gemini --help`): `default` (prompt for approval), `auto_edit` (edits auto-approved, everything else prompts), `yolo` (everything auto-approved), `plan` (read-only — the model may not call any mutating tool). Also reachable via `-y/--yolo` shorthand.
- **Policy Engine** (the modern replacement for the old `tools.core`/`tools.exclude`/`--allowed-tools`): rules are **TOML**, matched on `toolName` (wildcards incl. `mcp_*`), `argsPattern` (regex over the JSON-encoded args), `commandPrefix`/`commandRegex` (shell-specific sugar), yielding a `decision` of `allow`/`deny`/`ask_user`, with a `priority` (0–999, higher wins), optional `modes` (restrict the rule to specific approval modes), `interactive` (restrict to interactive vs. headless), `denyMessage`, and (for subagents) a `subagent` scope field.
  - **Tiered files with fixed base priorities**: built-in defaults (1.0) < user `~/.gemini/policies/*.toml` (4.0) < admin (5.0; `/etc/gemini-cli/policies` on Linux, `/Library/Application Support/GeminiCli/policies` on macOS, `C:\ProgramData\gemini-cli\policies` on Windows, with ownership/permission checks). Final priority = `tier_base + toml_priority/1000`, so an admin rule always outranks a user rule regardless of its own `priority` value.
  - `--policy` / `--admin-policy` CLI flags load additional policy files/dirs (local `--help`, 2026-09-20).
- **Sandboxing** (separate from the Policy Engine, which only gates *tool calls*, not runtime isolation): `-s/--sandbox`, or `GEMINI_SANDBOX=true|docker|podman|sandbox-exec`. Backends: **macOS Seatbelt** (`sandbox-exec`, six built-in profiles — `permissive-open` (default), `permissive-proxied`, `restrictive-open`, `restrictive-proxied`, `strict-open`, `strict-proxied`), **Linux bubblewrap**, and **Docker/Podman** containers (default image `ghcr.io/google/gemini-cli:latest`, extra flags via `SANDBOX_FLAGS`). This is real OS-level isolation (namespaces/containers), materially stronger than Copilot's default (see Part B §10).
- `--allowed-mcp-server-names`, `--allowed-tools` (deprecated, superseded by the Policy Engine), `--skip-trust` (trust the current workspace for the session) round out the local `--help`.

Sources: [Policy engine](https://geminicli.com/docs/reference/policy-engine/) (2026-09-20); Sandboxing: [Sandboxing in Gemini CLI](https://geminicli.com/docs/cli/sandbox/) (2026-09-20, content via search summary of the official page — treat backend-list detail as high-confidence but not independently re-fetched verbatim); local `gemini --help` (2026-09-20).

## 11. Plan/TODO tooling

- **`plan` approval mode** (§10) is Gemini CLI's read-only "planning" posture — it restricts the *model's write access*, but the docs found do not describe a dedicated plan/TODO **tool** analogous to Claude's `TodoWrite` or Codex's `update_plan` that produces a structured, user-visible checklist object. This is a **gap relative to Codex** (which has an explicit `update_plan` tool) — flagged here rather than assumed.
- **`save_memory`** + hierarchical `GEMINI.md` files (global `~/.gemini/GEMINI.md`, project root `./GEMINI.md`, subdirectory `./src/GEMINI.md`) are Gemini CLI's persistent-instructions/memory mechanism — closer to a durable knowledge base than a per-task TODO list. `/memory show` prints the fully concatenated instructions actually sent to the model.

Sources: [Memory files](https://geminicli.com/docs/tools/memory/), [Provide context with GEMINI.md files](https://geminicli.com/docs/cli/gemini-md/) (both 2026-09-20).

## 12. Hooks / telemetry

**Hooks** — a full lifecycle hook system (note: `gemini hooks migrate` exists specifically to port hooks *from Claude Code*, confirmed locally via `gemini hooks --help`, 2026-09-20), configured in `settings.json` under `hooks` (or `hooks/hooks.json` inside an extension). Documented events, each with a JSON stdin payload and a JSON-on-stdout / exit-code protocol:

| Event | Purpose | Can block? |
|---|---|---|
| `SessionStart` | startup/resume/clear | no (flow-control fields ignored) |
| `SessionEnd` | exit/clear/logout | no; CLI does not wait for it |
| `BeforeAgent` | after user submits, before planning | yes (exit 2 blocks the turn, erases the prompt) |
| `AfterAgent` | after the model's final response | yes (exit 2 rejects the response; stderr becomes retry feedback) |
| `BeforeModel` | before an LLM call, SDK-agnostic request shape | yes (exit 2 skips the LLM call) |
| `AfterModel` | after an LLM response — redaction/PII filtering | yes (exit 2 discards the response, aborts the turn) |
| `BeforeToolSelection` | before the model picks tools — can restrict the toolset via `functionCallingConfig` (`AUTO`/`ANY`/`NONE` + `allowedFunctionNames`) | filters only, no `decision`/`continue` |
| `BeforeTool` | before a tool call — validation/param rewriting | yes (exit 2 blocks the tool; stderr is the rejection reason) |
| `AfterTool` | after a tool call — auditing/context injection | yes (exit 2 hides the result; stderr replaces the tool output) |
| `PreCompress` | before history summarization | no — fired asynchronously |
| `Notification` | CLI-emitted alerts, for external logging | no — observability only |

Common stdin fields: `session_id`, `transcript_path`, `cwd`, `hook_event_name`, `timestamp` (+ event-specific fields). Exit codes: `0` success (stdout parsed as JSON), `2` = hard block (stderr becomes the reason), any other non-zero = warning and the CLI continues. A hook script must print **only** the final JSON to stdout (logs go to stderr).

**Telemetry** — built-in OpenTelemetry support, off by default:
- Traces: a span tree per interaction — `invoke_agent` (root) → `plan` (plan-mode decomposition, itself containing `chat <model>` / `execute_tool <tool>` spans) → `chat <model>` / `execute_tool <tool>` for the main turn. Spans carry model name, token counts, duration, and error info; subagent invocations are linked into the same trace via context propagation.
- Metrics follow OTel GenAI semantic conventions, e.g. `gen_ai.client.token.usage`, `gen_ai.client.operation.duration`; trace attribute `gen_ai.operation.name` takes values `tool_call`, `llm_call`, `user_prompt`, `system_prompt`, `agent_call`, `schedule_tool_calls`.
- Configured via `.gemini/settings.json` telemetry block, overridable by env vars/flags; viewable via Genkit Developer UI, Jaeger, or a prebuilt Google Cloud Monitoring dashboard ("Gemini CLI Monitoring").

Sources: [Writing hooks for Gemini CLI](https://geminicli.com/docs/hooks/writing-hooks/), [Hooks reference](https://geminicli.com/docs/hooks/reference/) (both 2026-09-20); [Observability with OpenTelemetry](https://geminicli.com/docs/cli/telemetry/) (2026-09-20); local `gemini hooks --help` (2026-09-20).

---

# Part B — GitHub Copilot CLI

## 1. Tools exposed to the model

Confirmed built-ins, from official docs plus the local `--help`'s permission-pattern documentation (`copilot help permissions`, accessed 2026-09-20) and third-party technical summaries cross-referencing the same names:

| Tool | Contract (as documented) |
|---|---|
| `bash` | run a shell command (see §3); gated by the `shell(command:*?)` permission pattern. |
| `read_bash` / `write_bash` / `stop_bash` | manage a **persistent, backgroundable** bash session — read async output, send input to a running session, terminate it (see §3). Overridable handlers per the Copilot SDK issue tracker (`github/copilot-sdk#2692`), i.e. these are real, separately-invokable tool names, not an implementation detail. |
| `view` | read a file/directory; read-only, auto-approved inside the CWD, prompted outside it. |
| `edit` / `apply_patch` / `write` | file-modification tools (see §2); gated by the `write(path?)` permission pattern; always require confirmation unless an auto-approval mode is active. |
| `glob` | filename pattern matching; read-only. |
| `rg` | ripgrep-backed content search; read-only. Bundled ripgrep by default (`USE_BUILTIN_RIPGREP=false` switches to the PATH binary); an indexed alternative `tgrep` also exists (see §4). |
| `task` | subagent delegation (see §8). |
| `ask_user` | interactively asks the person a question; can be turned off entirely with `--no-ask-user` (agent then works fully autonomously). |
| `web-fetch` (`url(...)` permission kind applies to shell and web-fetch) | fetches a URL; explicitly **restricted from loopback/private addresses** per the DeepWiki permissions summary. |
| `<mcp-server-name>(tool)` | any tool from a configured MCP server, including the **built-in `github-mcp-server`** (see §5/§7). |
| `task_complete` | signals autopilot-mode task completion (referenced by the `stayInAutopilot` config setting: "the CLI remains in autopilot mode after the agent calls `task_complete`"). |

Kind-of-tool permission patterns documented verbatim by the local `copilot help permissions` (2026-09-20): `shell(command:*?)`, `write(path?)`, `<mcp-server-name>(tool-name?)`, `url(domain-or-url?)`.

Sources: [Allowing and denying tool use](https://docs.github.com/en/copilot/how-tos/copilot-cli/use-copilot-cli/allowing-tools) (2026-09-20), [Tool Execution & Permissions (DeepWiki, github/copilot-cli)](https://deepwiki.com/github/copilot-cli/3.5-tool-execution-and-permissions) (2026-09-20, third-party synthesis of the public repo — cross-checked against local `--help` where possible), local `copilot help permissions` (2026-09-20). **The exact JSON argument/result schema per tool was not found in an official reference page and is marked NOT VERIFIED below.**

## 2. File editing — full write vs string replace vs patch; staleness

- Copilot CLI exposes **at least two distinct file-modification tools**: `write` (implied full-file write, from the `write(path?)` permission-pattern docs, which describe it as matching "tools that create and modify files, except shell tool invocations") and `apply_patch`/`edit` (patch/string-replace style, named directly in the custom-agent `tools:` example `["bash", "edit", "view"]` and in the DeepWiki tool-permission table). The **exact wire contract (arguments, whether it's unified-diff, `old_string`/`new_string`, or line-anchored) is not documented on an official page found during this research** — see NOT VERIFIED.
- **`write(path?)` matching is by trailing path components**: `write(.env)` matches any `.env` file anywhere on the matched tail, not only one in the CWD; an absolute path scopes it exactly. This is a permission-pattern detail, not the tool's argument shape.
- **No explicit "read-before-write" staleness rule was found** in the official docs. The safety net is instead **`/rewind`** (alias `/undo`, also triggered by pressing **Esc twice** while idle): it rewinds conversation and/or restores files Copilot changed, and — critically — **"skips any file whose current contents no longer match what it last wrote, so your own later edits aren't overwritten"**, i.e. a staleness check exists at *rollback* time, not at *write* time. Rewinding is irreversible (later history is permanently discarded) and works even outside a git repository (it restores only the files Copilot itself touched, independent of git).
- **`/diff`** reviews the changes made in the current directory before/without rewinding.

Sources: [Rolling back changes made during a GitHub Copilot CLI session](https://docs.github.com/en/copilot/how-tos/copilot-cli/use-copilot-cli/roll-back-changes) (2026-09-20), [Canceling a GitHub Copilot CLI operation and rolling back changes](https://docs.github.com/en/copilot/concepts/agents/copilot-cli/cancel-and-roll-back) (2026-09-20), local `copilot help permissions` and `copilot --help` (2026-09-20).

## 3. Shell

Two tiers, confirmed locally via `copilot help permissions`/`--help` and corroborated by the Copilot SDK issue tracker:

- **One-shot**: `bash` runs a command and returns.
- **Persistent/session-based**: `write_bash` sends input to a running bash session, `read_bash` asynchronously reads its output, `stop_bash` terminates it — i.e. Copilot CLI models a **long-lived shell session explicitly as four separate tools** rather than one shell tool with a PTY flag (contrast Gemini's single `run_shell_command` with an `is_background` flag, or Codex's unified `exec_command`/`write_stdin` pair).
- **`--bash-env`/`--no-bash-env`** (`bashEnv` setting): opt-in `BASH_ENV` support for bash shells (off by default).
- **No documented per-call timeout or output-size/truncation limit** was found for `bash`/`read_bash` in the official docs surfaced by this research (contrast Gemini's `inactivityTimeout` and Codex's `yield_time_ms`/`max_output_tokens`) — flagged as NOT VERIFIED.
- **`--plain-diff` / `PLAIN_DIFF`**: disables rich (syntax-highlighted) diff rendering for shell/file output.
- **Command Sandboxing** (see §10) wraps `bash`'s OS-level execution when enabled — this is where filesystem/network restriction for shell actually lives, not the tool contract itself.

Sources: local `copilot --help`, `copilot help permissions`, `copilot help sandbox` (all 2026-09-20); [Tool Execution & Permissions (DeepWiki)](https://deepwiki.com/github/copilot-cli/3.5-tool-execution-and-permissions) (2026-09-20).

## 4. Search

- **`glob`** (filename patterns) and **`rg`** (ripgrep-backed content search) are the two built-in search tools, both read-only and generally auto-approved in the CWD.
- **`USE_BUILTIN_RIPGREP=false`** uses the system `rg` instead of the bundled binary.
- **`tgrep`** — an **indexed** search engine, a genuine differentiator from Gemini/Codex's plain grep: auto-enabled only inside a git repo, on a non-virtualized filesystem, above a **50,000-file** threshold on this platform, and never on a detected Windows cloud-sync folder. `USE_TGREP=true` forces it on (even outside a repo, on a virtualized/network FS, or on cloud-sync folders — the docs explicitly warn this can download cloud-only files); `USE_TGREP=false` disables it; `USE_TGREP_WARM_START=true` blocks CLI startup until the index is ready (only meaningful combined with `USE_TGREP=true`).
- No semantic/embedding-based search across the documented environment variables — `tgrep` appears to be a traditional (non-semantic) index, though its indexing algorithm itself is not documented in the pages found (NOT VERIFIED: whether tgrep is purely lexical/trigram or has any embedding component).

Source: local `copilot help environment` (2026-09-20).

## 5. Git

- **No dedicated `git_*` tool** in the always-present tool list; git operations go through `bash` like any other shell command, gated by the `shell(git:*)` permission-pattern convention documented for approvals (e.g. `--allow-tool='shell(git:*)' --deny-tool='shell(git push)'`).
- **But GitHub itself is quasi-first-class via a built-in MCP server**: `github-mcp-server` ships and is enabled by default (confirmed locally — `--disable-builtin-mcps` docstring names it explicitly: "Disable all built-in MCP servers (currently: github-mcp-server)"). Its toolset is curated down from the full GitHub MCP server by default; `--add-github-mcp-toolset <toolset>`, `--add-github-mcp-tool <tool>`, and `--enable-all-github-mcp-tools` widen it. This is how `/pr` (operate on pull requests), `/review` (code review agent), and `/delegate` (push the session to GitHub, which opens a PR) are implemented at the product level, even though the raw git plumbing (`commit`, `diff`, `log`) still runs through `bash`.
- **Worktrees are first-class at the interactive-command level**: `/worktree` creates a new git worktree from the configured base ref and switches into it (leaving uncommitted changes behind); `/worktree new [prompt]` starts a *separate conversation* in the new worktree. `/move` instead **moves the uncommitted changes themselves** into a new worktree/branch. Confirmed locally via `copilot help commands` (2026-09-20).
- **Checkpoints/undo**: see §2 (`/rewind`/`/undo`, Esc-Esc) — independent of git, restores only files Copilot itself wrote.
- **`includeCoAuthoredBy`** (default `true`): instructs the agent to add a `Co-authored-by` trailer to commits it makes.

Sources: local `copilot --help`, `copilot help commands`, `copilot help config` (all 2026-09-20).

## 6. Web / browser

- **`web-fetch`**-style URL access is gated by the `url(domain-or-url?)` permission kind (protocol-aware: approving `https://example.com` does not imply `http://example.com`); `--allow-url`/`--deny-url`/`--allow-all-urls` control it. Loopback/private destinations are documented as restricted per the DeepWiki tool-permission table.
- **`/research`**: "Run deep research investigation using GitHub search and web sources" — a higher-level research mode, not raw browser automation (local `copilot help commands`, 2026-09-20).
- **`/computer`**: "Show or toggle Computer Use" — this is the closest thing to real browser/desktop automation in Copilot CLI's command list, but **no official page describing its scope, safety model, or what "Computer Use" actually drives was found** — flagged NOT VERIFIED.
- No dedicated headless-browser tool comparable to Gemini's `browser_agent` was found documented for Copilot CLI as of this research.

Sources: local `copilot help commands` (2026-09-20); [Allowing and denying tool use](https://docs.github.com/en/copilot/how-tos/copilot-cli/use-copilot-cli/allowing-tools) (2026-09-20).

## 7. MCP

- **Full client support**, three config sources merged: **User** `~/.copilot/mcp-config.json`, **Workspace** `.mcp.json` or `.github/mcp.json`, and **Plugin**-bundled servers (`mcp.json` at the plugin root, supporting `${PLUGIN_ROOT}` placeholder expansion). Confirmed locally via `copilot mcp --help` (2026-09-20).
- **CLI management**: `copilot mcp list|get|add|remove|enable|disable` (local `--help`, 2026-09-20); interactively, `/mcp` lists and lets you select a server.
- **Transports**: local (stdio) processes and remote (HTTP/SSE) endpoints, per the `copilot mcp --help` description ("Servers can be local (stdio) processes or remote (HTTP/SSE) endpoints").
- **Namespacing**: tool permission strings use `'MCP_SERVER_NAME(tool_name)'` — the same `<name>(tool)` pattern used for the built-in GitHub server, e.g. `--deny-tool='MyMCP(denied_tool)' --allow-tool='MyMCP'` to allow a whole server except one tool.
- **A built-in server ships by default** (`github-mcp-server`, §5) and can be disabled wholesale with `--disable-builtin-mcps` or per-server with `--disable-mcp-server <name>`; `--enable-mcp-server <name>` re-enables one for a single run without persisting the change.
- **`--additional-mcp-config <json>`**: augments the user config for one session only, accepting a JSON string or an `@file`/`@~/path` reference.
- **Sandboxing interaction**: `sandboxMcpServers` (settings.json) decides whether **local (stdio)** MCP servers are also spawned inside the Command Sandbox; **remote (HTTP/SSE) MCP servers are never sandboxed** (§10).
- **`--allow-all-mcp-server-instructions`**: by default, only allowlisted servers' initialization instructions are folded into the system prompt; this flag includes all of them.
- **Org policy gap, stated in the docs**: "Copilot CLI can't currently support" org-level MCP Registry policies as of the page fetched.

Sources: local `copilot mcp --help` (2026-09-20); [About GitHub Copilot CLI](https://docs.github.com/copilot/concepts/agents/about-copilot-cli) (2026-09-20); `copilot help sandbox`/`copilot help permissions` (local, 2026-09-20).

## 8. Subagents / delegation

Two distinct mechanisms, easy to conflate:

**(a) `task` tool + custom agents** — the always-present `task` tool (§1) delegates to a **custom agent**, defined by its own instructions/tools/model in front-matter (the docs' example: `tools: ["bash", "edit", "view"]`), selectable interactively via `/agent [name]`, and per-agent model/effort/context-tier overrides are configurable via `/subagents` or `subagents.agents.<agent-name>` in settings (fields: model, `effortLevel`, `contextTier`, each settable to `"inherit"` to take the parent's value). `customAgents.defaultLocalOnly` restricts discovery to local-only custom agents (no remote org/enterprise ones) by default `false`.

**(b) `/fleet` mode** — parallel multi-subagent orchestration, invoked via the `/fleet` slash command or `--fleet` (combinable with `-i`/`-p`/piped stdin): a behind-the-scenes orchestrator decomposes the objective into independent work items with dependencies, dispatches multiple subagents in parallel for the items that can run concurrently, and the **main session acts as orchestrator, managing the workflow and dependencies between subtasks**.
  - **Model**: "By default, subagents use a low-cost AI model"; a specific custom agent can be targeted with `@CUSTOM-AGENT-NAME` syntax to override that.
  - **Budget**: no per-subagent AI-credit allocation is documented; the docs only note that `/fleet` "may consume more GitHub AI Credits due to multiple LLM interactions" — the session-wide `--max-ai-credits` soft cap (§10) is the only hard number found.
  - **Depth/recursion**: **not documented either way** — no statement found confirming or denying whether a fleet subagent can itself invoke `/fleet` — flagged NOT VERIFIED.
  - **Tool access per subagent**: not documented in the fleet-specific page found; presumably inherits from the custom-agent mechanism in (a), but this is inference, not a confirmed fact — flagged NOT VERIFIED.
  - Hook events **`subagentStart`**/**`subagentStop`** (§12) fire around each delegated unit and are the most concrete, code-level evidence of subagent lifecycle boundaries.
- **`/autopilot`**: a related but distinct mode — toggles autonomous continuation with an optional AI-credit ceiling (`--max-autopilot-continues`, default **5** continuation messages before pausing for confirmation) and an objective string; not multi-agent, but relevant to "how far can Copilot run unattended" for the same design question.

Sources: [Running tasks in parallel with the /fleet command](https://docs.github.com/en/copilot/concepts/agents/copilot-cli/fleet) (2026-09-20); local `copilot help commands`, `copilot help billing`, `copilot help config`, `copilot --help` (all 2026-09-20).

## 9. Background / long-running work and daemon/server mode

- **`--acp`**: starts Copilot CLI as an **Agent Client Protocol server** (same protocol family as Gemini's `--acp`), for IDE embedding (local `--help`, 2026-09-20).
- **`--remote`**: "Enable remote control of your session from GitHub web and mobile" — a genuinely persistent, network-reachable session, not just a local daemon. **`--remote-export`**: exports (shares) the session read-only to GitHub web/mobile without granting control. `/remote` is the interactive-mode equivalent.
- **`--connect [<sessionId>]`**: "Connect directly to a remote session" — implies sessions can run detached from the invoking terminal and be reattached.
- **`read_bash`/`write_bash`/`stop_bash`** (§3) give the model itself a way to manage long-running background shell work within one session.
- **`/keep-alive`** (`keepAlive` setting: `off`/`on`/`busy`) prevents system sleep while a session (or just its active turns) is running — relevant for long unattended jobs.
- **Session persistence across restarts**: `--resume`/`--continue`/`--session-id`, `/resume`, `/fork` (branch a session), `sessions import`/`memories import` subcommands (confirmed locally, `copilot sessions --help`/`copilot memories --help`, 2026-09-20) — sessions are durable, file/DB-backed objects (`~/.copilot/session-store.db`, observed locally), not purely in-memory.
- **`/restart`**: "Restart the CLI, restoring supported live sessions in this process" — an explicit statement that not all session state survives a restart ("supported" is qualified).

Sources: local `copilot --help`, `copilot help commands`, `copilot sessions --help`, `copilot memories --help` (all 2026-09-20).

## 10. Permission model

- **Modes** (`defaultPermissionMode` / `/permissions`): **`manual`** (default — writes and shell commands prompt, reads auto-approve), **`assisted`** (an LLM safety judge auto-approves what it judges safe and prompts otherwise; requires the experimental auto-approval feature or `enabledFeatureFlags.AUTO_APPROVAL`, and can be forced via `--assisted-approval`), **`allow-all`** (equivalent to `--allow-all` — everything auto-approved; can be disabled by org policy). `defaultMode` (session mode, separate from permission mode) is one of `interactive`/`plan`/`autopilot`.
- **Fine-grained flags**: `--allow-tool`/`--deny-tool` (deny always wins), `--available-tools`/`--excluded-tools` (filter which tools the *model can even see*, independent of approval), `--allow-url`/`--deny-url`/`--allow-all-urls`, `--allow-all-paths` (disables the default "CWD + subdirs + temp dir only" filesystem restriction), `--disallow-temp-dir`, `--allow-all`/`--yolo` (shortcut for all three "allow-all" flags at once). Interactively: `/permissions`, `/allow-all`, `/add-dir`, `/list-dirs`, `/reset-allowed-tools`.
- **Sandboxing** ("Command Sandboxing", experimental): OS-level isolation for **shell commands only** ("Built-in file edits aren't OS-sandboxed, but still follow the same policy on a best-effort basis") via **Microsoft Execution Containers (MXC)** — a genuinely cross-platform abstraction, not a bespoke per-OS implementation:
  - **macOS**: MXC Seatbelt backend (`sandbox-exec`).
  - **Linux**: MXC bubblewrap backend (needs `bwrap` ≥0.5.0), plus a **private network namespace per sandbox** (needs `slirp4netns`, util-linux ≥2.35, `iptables`/`ip6tables` incl. `-restore` binaries, `/dev/net/tun` access, and generally the `nf_tables` backend on unprivileged hosts).
  - **Windows**: MXC ProcessContainer with BaseContainer (version-gated).
  - **Disabled by default** — this is the single most important contrast with Gemini CLI, whose sandbox is likewise opt-in but backed by the same class of OS primitives (bubblewrap/Seatbelt/containers) once turned on. **When disabled** (default), shell commands run with the user's full local privileges and no injected credential isolation at all.
  - **Policy dimensions when enabled**: filesystem (`readwritePaths`/`readonlyPaths`/`deniedPaths`, defaults to CWD + PATH dirs + temp + user profile), network (`allowOutbound`/`allowLocalNetwork`, separately), credentials (`auth.git`/`auth.gh` — git/gh tokens are injected into the sandbox **only** when enabled and opted in; never leak into a disabled sandbox because there is no sandbox to leak into), subprocesses (`sandboxMcpServers`/`sandboxLspServers` — remote MCP is never sandboxed), macOS keychain (`userPolicy.seatbelt.keychainAccess`), and a per-command **bypass** escape hatch (`allowBypass`).
  - **`allowDevToolAccess`** (default on): auto-grants read access to common dev-tool config/registry locations (`~/.npmrc`, `~/.m2/settings.xml`, etc.) and read/write to shared build caches (Cargo registry, Go build cache, Gradle, `gh`'s own cache), scoped per command to the ecosystems that command's manifests imply — a deliberately-documented trade-off ("sandboxed commands can read those config files... and can write to caches shared with your other projects").
  - **Org policy can force sandboxing on** (a managed floor) and can additionally set `allowBypass: false` to make it mandatory with no escape hatch; a host that cannot run the sandbox then cannot run shell commands at all.
- **Path/URL/tool filters interact but are distinct layers**: `--available-tools`/`--excluded-tools` decide what the model *sees*; `--allow-tool`/`--deny-tool` decide what needs a prompt; `--allow-all-paths`/sandboxing decide what the OS actually *permits* — three independent gates, not one setting.

Sources: local `copilot help permissions`, `copilot help sandbox`, `copilot help config` (all 2026-09-20); [About cloud and local sandboxes](https://docs.github.com/en/copilot/concepts/about-cloud-and-local-sandboxes) (referenced by the local help text; not independently re-fetched — content above is from the local `--help`, which is a primary source).

## 11. Plan/TODO tooling

- **`/plan`** (also `--plan`, or Shift+Tab to cycle in/out interactively): Copilot "analyzes your request, asks clarifying questions..., and builds a structured implementation plan before writing any code," reviewable in a dedicated panel before implementation starts. Combinable with `--mode autopilot` to auto-approve the plan and implement it fully autonomously.
- **`/tasks`**: "View and manage tasks (subagents and shell commands)" — the interactive surface for **inspecting in-flight background work** (fleet subagents, backgrounded shell sessions), i.e. Copilot's closest analogue to a live task/TODO board, though it is a *monitoring* surface for tasks the agent already started rather than a tool the model calls to author a checklist (contrast Codex's `update_plan`, which is a model-callable structured-plan tool).
- **`task_complete`** (§1): the model-callable signal that ends an autopilot task; whether the CLI exposes a broader "write N ordered steps" tool to the model was **not found documented** — flagged NOT VERIFIED.
- **`/refine`**: rewrites a rough prompt into a clearer one — adjacent to planning but not a TODO tool.

Sources: local `copilot help commands`, `copilot help config` (both 2026-09-20); [GitHub Copilot CLI: Plan before you build, steer as you go](https://github.blog/changelog/2026-01-21-github-copilot-cli-plan-before-you-build-steer-as-you-go/) (2026-09-20, GitHub's own changelog).

## 12. Hooks / telemetry

**Hooks** — JSON-schema, version-1 `hooks.json` files at **repo** scope (`.github/hooks/*.json`, applies to any Copilot agent using that repo, CLI or coding-agent) and **personal** scope (`~/.copilot/hooks/*.json`, applies whenever *this person* uses Copilot CLI); `disableAllHooks` (settings.json) turns every hook off; `hooks` inline definitions in `config.json`/`settings.json` act as user-level (global config) or repo-level (repo settings.json) hooks with the same schema. Documented events (`copilot help commands` + the official hooks reference):

| Event | stdin fields (beyond common `sessionId`/`timestamp`/`cwd`) | stdout schema | Exit-code semantics |
|---|---|---|---|
| `sessionStart` | `source`, `initialPrompt?` | `additionalContext?` | 0 success / 2 warn / other skip |
| `sessionEnd` | `reason` | — (ignored) | 0/2/other all just proceed |
| `userPromptSubmitted` | `prompt` | `modifiedPrompt?` | 0/2/other |
| `userPromptTransformed` | `prompt`, `transformedPrompt` | `modifiedTransformedPrompt?` | 0/2/other |
| `preToolUse` | `toolName`, `toolArgs` | `permissionDecision` (`allow`/`deny`/`ask`), `permissionDecisionReason?`, `modifiedArgs?` | **0 success, 2 = deny, any other non-zero = deny (fail-closed)**; a timeout is the one exception and fails *open* |
| `postToolUse` | `toolName`, `toolArgs`, `toolResult` | `modifiedResult?`, `additionalContext?` | 0 success / 2 injects context / other skip |
| `postToolUseFailure` | `toolName`, `toolArgs`, `error` | `additionalContext?` | 0/2/other |
| `preCompact` | `transcriptPath`, `trigger`, `customInstructions` | — (ignored) | 0/2/other |
| `agentStop` | `transcriptPath`, `stopReason`, `stop_hook_active` | `decision` (`block`/`allow`), `reason` | 0/2/other |
| `subagentStart` | `transcriptPath`, `agentName`, `agentDisplayName?`, `agentDescription?` | `additionalContext?` | 0/2/other |
| `subagentStop` | `transcriptPath`, `agentId`, `agentType`, `agentName`, `response`, `stopReason` | `decision?`, `reason?`, `modifiedResponse?` | 0/2/other |
| `errorOccurred` | `error`, `errorContext`, `recoverable` | — (ignored) | 0/2/other |
| `permissionRequest` | `toolName`, `toolInput`, `requestSandboxBypass?` | `behavior` (`allow`/`deny`), `message?`, `interrupt?` (stops the agent if paired with `deny`) | 0/2 deny/other skip |
| `notification` | `message`, `title?`, `notification_type` | `additionalContext?` | fire-and-forget |

Global rule: **`preToolUse` is the one fail-closed hook** — any non-zero exit other than a timeout denies the tool call outright, unlike every other event, which fails open (warns and proceeds) on an unrecognized exit code.

**Telemetry** — OpenTelemetry, off by default, activated by `COPILOT_OTEL_ENABLED=true` **or** `OTEL_EXPORTER_OTLP_ENDPOINT` being set **or** `COPILOT_OTEL_FILE_EXPORTER_PATH` being set:
- **Traces**: `invoke_agent` (root span; all LLM calls + tool executions) → `plan` (plan-mode decomposition) → nested `chat <model>` / `execute_tool <tool>` spans; subagent invocations are linked into the same trace via context propagation.
- **Metrics** (histograms unless noted): `gen_ai.client.operation.duration`, `gen_ai.client.token.usage`, `gen_ai.client.operation.time_to_first_chunk`, `gen_ai.client.operation.time_per_output_chunk`, `gen_ai.invoke_agent.duration`, `gen_ai.invoke_workflow.duration`, `gen_ai.invoke_agent.inference_calls`, `gen_ai.invoke_agent.tool_calls`, `gen_ai.execute_tool.duration`, `github.copilot.tool.call.count` (counter), `github.copilot.tool.call.duration`, `github.copilot.agent.turn.count`, `github.copilot.mcp.server.connection.count` (counter), `github.copilot.code.lines_added` (counter), `github.copilot.code.lines_removed` (counter), `github.copilot.sandbox.operation.count` (counter, deduplicated — an unchanged policy resolution is not re-counted), `github.copilot.sandbox.spawn.duration`, `github.copilot.sandbox.policy.path.count`.
  - **Sandbox metrics are explicitly documented as never carrying file paths, commands, or proxy URLs as dimensions** — a deliberate privacy boundary distinct from content capture.
- **Content capture** is a separate opt-in (`OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT=true`): without it, only metadata is captured; with it, full prompt/response text, system instructions, tool-call arguments/results, and — specifically — the sandbox's effective filesystem rules and the sandbox's *decision* (denied resources, executable basenames) are captured. Notably, **the content-capture gate is applied before the internal session event is emitted**, so SDK/JSON/extension subscribers see the same redacted shape when capture is off, not just the OTLP exporter.
- **Exporters**: `otlp-http` (default; `http/json` or `http/protobuf`) or `file` (JSON-lines, auto-selected when `COPILOT_OTEL_FILE_EXPORTER_PATH` is set). mTLS supported (`OTEL_EXPORTER_OTLP_CLIENT_CERTIFICATE`/`_CLIENT_KEY`). **An `http://` endpoint (including the default `http://localhost:4318`) silently disables export rather than sending cleartext** — the CLI does not abort startup and only logs a warning to its log directory, so a misconfigured local collector can look like "OTel is on" while nothing is ever sent.

Sources: [GitHub Copilot hooks reference](https://docs.github.com/en/copilot/reference/hooks-reference) (2026-09-20); [About hooks for GitHub Copilot](https://docs.github.com/en/copilot/concepts/agents/hooks) (2026-09-20); local `copilot help commands`, `copilot help monitoring`, `copilot help environment` (all 2026-09-20).

---

## WORTH STEALING

1. **Gemini's Policy Engine tiering (`base_tier + rule_priority/1000`)** — a clean, auditable way to guarantee an admin policy file always outranks a user one regardless of the individual rule's own priority number, without needing a separate "admin override" code path. Agentistics' own session-manager approval work (`approval-spec.ts`) could adopt the same tiered-priority arithmetic instead of a flat allow/deny list.
2. **Copilot's fail-closed-by-default hook contract for `preToolUse`, fail-open for everything else** — a single, named exception (rather than "hooks generally fail open, except when the author remembers to check") makes the security-critical path the one everyone can reason about without re-reading every hook's semantics.
3. **Gemini's `browser_agent` as a bounded subagent, not a global capability** — real browser automation is opt-in, Chrome-version-gated, rate-limited (100 actions/task default), and confined to its own subagent rather than being a tool every session can reach; a native harness that wants browser automation should gate it exactly this way rather than exposing `computer_use`-style tools globally.
4. **Copilot's split of shell into `bash`/`read_bash`/`write_bash`/`stop_bash`** makes a backgrounded, interactive shell session a first-class, individually-permissionable object (each of the four verbs can be allow/deny-listed separately) rather than one shell tool with a background flag — useful if Agentistics ever wants per-verb auditing of what a session did to a long-lived shell.
5. **Gemini's subagent depth hard-stop ("subagents cannot call other subagents", enforced even under a `*` tool wildcard)** is a one-sentence rule that eliminates an entire class of runaway-recursion bugs; worth mirroring literally as an invariant if/when Agentistics' own session manager grows a delegation primitive.
6. **Copilot's OTel sandbox metrics being dimension-scrubbed by design** (`github.copilot.sandbox.*` never carries paths/commands/URLs) shows a workable middle ground between "no telemetry" and "telemetry that leaks the very secrets the sandbox exists to protect" — directly relevant to Agentistics' own stance that a metric may never smuggle chat content.
7. **Gemini's shadow-git checkpoint repo (`~/.gemini/history/<project_hash>`) bundled with the exact tool call being re-proposed on restore** is a stronger undo primitive than a plain git stash: restoring doesn't just revert files, it re-poses the original decision to the user, which is a genuinely different (and more honest) UX than "we reverted, now what."
8. **Both CLIs document their MCP tool-naming collision hazards explicitly in the docs** (Gemini's "don't use underscores in server names" / Copilot's `'MCP_SERVER_NAME(tool_name)'` pattern) — a reminder that Agentistics' own multi-harness `canonicalTool` mapping needs the same kind of documented collision rule if a native harness adds MCP support.

## NOT VERIFIED

- **Copilot's exact per-tool JSON argument/result schema** (for `bash`, `view`, `edit`/`apply_patch`/`write`, `glob`, `rg`, `task`, `ask_user`) — no official page enumerating these was found; the tool *names* and *permission categories* are confirmed (local `--help`, GitHub docs, DeepWiki), but field-level contracts are inferred/absent.
- **Whether Copilot's `apply_patch`/`edit` uses a unified-diff format, `old_string`/`new_string` replacement, or line-anchored patches** — named in examples but its exact grammar was not found documented.
- **Copilot `bash`/`read_bash` output size limits and per-call timeout** — no documented number found (contrast Gemini's `inactivityTimeout` and Codex's `max_output_tokens`).
- **Copilot `/fleet` subagent recursion depth** (can a fleet subagent itself call `/fleet`?) and **per-subagent tool/budget allocation** — not stated either way in the fleet doc page fetched.
- **Copilot `/computer` ("Computer Use")** — listed as an interactive command with no accompanying documentation page found describing scope, safety model, or underlying mechanism.
- **Whether Copilot exposes a model-callable structured multi-step plan/TODO tool** beyond `task_complete` and the `/tasks` monitoring view — not found documented; may not exist.
- **Gemini's Seatbelt/bubblewrap/Docker sandbox backend list** — retrieved via a search-engine synthesis of the official `geminicli.com/docs/cli/sandbox/` page rather than a direct, fully-rendered fetch of that page; the general shape (three backends, six Seatbelt profiles) is corroborated by an independent third-party mirror but the six profile names were not independently re-verified against the primary source in this session.
- **Gemini MCP tool FQN format** — two independently-returned search summaries agree on `mcp_{serverName}_{toolName}` (single underscore) as the Policy-Engine-facing name, with a separate `Server__Tool` (double underscore) form reportedly used inside subagent `tools:` lists; the coexistence of both forms was not confirmed against a single primary-source paragraph in this session.
- **Copilot's exact CI/offline auto-update default** and other environment-variable edge cases were taken directly from the local `--help`/`help <topic>` output (a primary source for the installed version, 1.0.85) but were not cross-checked against the GitHub docs site, since the CLI's own reference is authoritative for its own flags per version.
- All findings reflect **Gemini CLI 0.58.0** and **GitHub Copilot CLI 1.0.85**, the versions installed locally at research time (2026-09-20); both products ship frequently and flag/tool names have changed release-to-release in their own changelogs.
