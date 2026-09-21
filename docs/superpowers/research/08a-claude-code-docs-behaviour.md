# Claude Code — Behavioural Reference from Official Documentation

Built exclusively from Anthropic's own public documentation (code.claude.com/docs) and `claude --help`.
No leaked/deobfuscated source, forks, or reconstructions were consulted; where a search result pointed at
one (`openclaude`, "claude-code-source-code-deobfuscation", etc.) it was skipped — none were needed since
the official docs proved to be exhaustively detailed for every topic below.

All pages accessed **2026-09-20**. Version numbers below (`v2.1.xxx`) are as stated in the docs at that date.

---

## 0. Index of sources used

- https://code.claude.com/docs/llms.txt — full doc index
- https://code.claude.com/docs/en/tools-reference — every built-in tool + behavior
- https://code.claude.com/docs/en/hooks — hooks reference (events, payloads, exit-code semantics)
- https://code.claude.com/docs/en/permissions — permission rules, syntax, tool-specific rules
- https://code.claude.com/docs/en/permission-modes — modes, auto mode classifier, protected/critical paths
- https://code.claude.com/docs/en/memory — CLAUDE.md, AGENTS.md, `.claude/rules/`, auto memory
- https://code.claude.com/docs/en/context-window — startup context budget, compaction survival table
- https://code.claude.com/docs/en/checkpointing — checkpoints, `/rewind`, limitations
- https://code.claude.com/docs/en/sessions — resume, fork/branch, transcript storage
- https://code.claude.com/docs/en/sub-agents — subagent definition, isolation, budgets
- https://code.claude.com/docs/en/agents — the five ways to parallelize work
- https://code.claude.com/docs/en/skills — SKILL.md format, discovery, fork/background
- https://code.claude.com/docs/en/monitoring-usage — OTel metrics/events/traces
- https://code.claude.com/docs/en/statusline — statusline JSON schema
- https://code.claude.com/docs/en/agent-sdk/todo-tracking — Task tools lifecycle
- https://code.claude.com/docs/en/worktrees — worktree isolation mechanics
- https://code.claude.com/docs/en/cli-reference — CLI flags (pointer to SDK docs for stream-json shapes)
- https://code.claude.com/docs/en/agent-sdk/typescript — `SDKMessage` union, `HookInput`/`HookJSONOutput`,
  `PermissionResult`, `CanUseTool`, tool input/output schemas (raw markdown fetched via `curl`, since the
  page is too large for the summarizing fetcher to reach the type tables)
- `claude --help` (local CLI, v2.1.x) — flags, subcommands

---

## 1. Tools — every tool exposed to the model, and its documented contract

Source: `tools-reference.md`. The permission column is "requires a permission decision" (allow/ask/deny
resolution), not "requires a prompt every time".

| Tool | Permission required | Notes |
|---|---|---|
| `Bash` | Yes | see §3 |
| `PowerShell` | Yes | Windows-native alternative to Bash |
| `Read` | No | text/image/PDF/notebook |
| `Edit` | Yes | string-replacement, see §2 |
| `Write` | Yes | full overwrite |
| `NotebookEdit` | Yes | Jupyter cells |
| `Glob` | No | file pattern search |
| `Grep` | No | ripgrep-syntax content search |
| `WebFetch` | Yes | domain allow-listable |
| `WebSearch` | Yes | |
| `Agent` | No (subagent's own actions are separately gated) | spawns a subagent |
| `Monitor` | Yes | watches a background command or WebSocket |
| `TodoWrite` / `TaskCreate`/`TaskGet`/`TaskUpdate`/`TaskList`/`TaskOutput`/`TaskStop` | No | task tracking, see §11 |
| `AskUserQuestion` | No | multiple-choice, has an auto-continue timeout |
| `EnterPlanMode`/`ExitPlanMode` | ExitPlanMode: Yes | plan-mode transitions |
| `EnterWorktree`/`ExitWorktree` | EnterWorktree: Yes | git worktree isolation, see §8 |
| `LSP` | No | code-intelligence via language servers (jump-to-def, references, call hierarchy) |
| `Artifact` | Yes | publishes HTML/Markdown to claude.ai (Pro/Max/Team/Enterprise only) |
| `SendMessage`/`ListAgents` | No | cross-session messaging |
| `SubagentHandback` | No | delivers a subagent's report to its parent (auto mode only, v2.1.271+) |
| `CronCreate`/`CronDelete`/`CronList`/`ScheduleWakeup` | mixed | scheduled/looped prompts |
| `SendUserFile`/`SendFeedback`/`PushNotification` | mixed | host/device integration, several environments excluded |
| `ReportFindings` | No | structured code-review output |
| `Workflow` | Yes | dynamic-workflow runner |
| `EndConversation` | No, and **cannot be removed** while any other tool remains (see §4) | |
| `ListMcpResourcesTool`/`ReadMcpResourceTool`/`WaitForMcpServers` | No | MCP resource access |
| `ToolSearch` | No | loads deferred tool schemas on demand |
| `ShareOnboardingGuide` | Yes | |

### Per-tool contracts, as documented

- **Bash**: each command is a separate process; cwd persists within the session but env vars do not
  persist between calls; shell rc-file aliases/functions are available. Timeout default 2 min
  (`BASH_DEFAULT_TIMEOUT_MS`), max 10 min (`BASH_MAX_TIMEOUT_MS`); a command over the timeout is moved to
  background rather than killed. Output limits: streaming kill ceiling 5 GB; inline success ceiling
  ~30,000 chars (`bashOutputMaxChars`, up to 128,000); inline failure ceiling ~10,000 chars; read-back
  window 30,000 chars default (`BASH_MAX_OUTPUT_LENGTH`, up to 150,000) — output beyond the inline ceiling
  is saved to a session file with a preview, and a failure shows a head-and-tail excerpt. A fixed set of
  commands (`grep`, `rg`, `egrep`, `fgrep`, `find`, `diff`, `test`, `[`, `git diff`, `git grep`) treat exit
  code 1 as benign, not a failure. `run_in_background: true` detaches the command; if run from a
  foreground subagent it dies when the subagent finishes, otherwise it (main conversation or background
  subagent) persists. A memory limit (`CLAUDE_CODE_TOOL_MEMORY_LIMIT`, Linux/WSL only) is shared across
  all Bash/PowerShell/Monitor processes via a cgroup.
- **Read**: params `path`(absolute preferred)/`offset`/`limit`/`pages`(PDF ranges). Returns file content
  with `cat -n`-style line numbers. Empty file → explicit "file exists but contents are empty" notice.
  Offset past EOF → returns the file's line count. Exceeding the tool's token budget → returns a
  `PARTIAL view` notice (not silent truncation). Images are resized/recompressed for model limits. PDFs
  ≤10 pages are read whole; longer ones are read in ranges up to 20 pages per call. Notebooks: every cell
  returned, capped at 100 MB. **Directories are refused outright** — the model is told to use `ls` instead.
- **Edit**: params `path`, `old_string`, `new_string`, `replace_all`. Three checks, all enforced by the
  harness rather than the model: (1) **read-before-edit** is required (a prior `Read`, or a Bash read such
  as `cat`/`head`/`tail`/`grep`/`sed -n`, satisfies it); (2) `old_string` must match **exactly once**
  unless `replace_all` is set; (3) **staleness**: if the file changed on disk since the read, the edit
  still succeeds if `old_string` still matches uniquely against the *current* content — otherwise Claude
  must re-read first. There is no patch/diff format; string replacement is the only documented mechanism
  (a legacy `MultiEdit` tool exists but is explicitly deprecated in favor of `Edit`).
- **Write**: full-file overwrite; blocked outright by a `Read` deny rule on the same path (v2.1.228+),
  including creation of a new file there.
- **Glob**: `**` recursion; results sorted by mtime; **capped at 100 files** with a truncation flag;
  respects `.gitignore` by default. Not installed by default on macOS/Linux/WSL (must be restored via
  `--tools Glob`); default on Windows.
- **Grep**: ripgrep regex (not POSIX); `output_mode` = `files_with_matches` (default) / `content` /
  `count`; `head_limit` and `offset` for pagination; `multiline` flag for cross-line matches; respects
  `.gitignore`.
- **WebFetch**: `url`/`method`/`headers`/`body`; binary responses base64-encoded; large responses
  truncated with size info; permission granularity is `WebFetch(domain:example.com)`.
- **Monitor**: unifies "watch a background command" and "watch a WebSocket" under one tool. Command
  variant: `timeout_ms` (5 min default, max 30 min, capped at 10 min under `-p`). WebSocket variant:
  `ws.url`/`ws.protocols`; text messages become one stream event each, binary messages become a
  placeholder line, messages over 1 MiB end the watch, socket close ends the watch with its close code.
  Denies private/link-local/metadata addresses and configured deny-lists.
- **Task tools** (`TaskCreate`/`TaskGet`/`TaskUpdate`/`TaskList`/`TaskOutput`/`TaskStop`) vs `TodoWrite`:
  see §11.
- **Agent**: spawns a subagent with an isolated context window; independent tool calls not visible to the
  parent; only the final result returns. `maxTurns` caps iterations (marks the result partial rather than
  failing outright); `tools`/`disallowedTools` restrict its tool surface (`disallowedTools` wins if both
  set). Fork mode inherits the *full* parent conversation instead of starting fresh (see §6).

### Parallel tool calls

The docs state background-vs-foreground semantics for Bash (`run_in_background`), Monitor, and subagents,
but **do not document a general "N tool calls execute concurrently in one turn" contract** for ordinary
(non-backgrounded) tool calls — the `PostToolBatch` hook event ("fires once after every tool call in a
batch has resolved, before the next model call") is the only place the docs name a *batch* of tool calls
as a first-class concept, implying same-turn tool calls are dispatched and resolved together as a batch,
but the scheduling/concurrency model within that batch is not spelled out.

---

## 2. Editing — how file edits are expressed, and staleness rules

- **Mechanism**: exact **string replacement** (`Edit`) or **full overwrite** (`Write`). No unified-diff
  or patch-application tool is documented as a first-class mechanism; `NotebookEdit` uses a
  replace/insert/delete-by-cell-id model instead of text search-replace.
- **Read-before-write is enforced, not merely conventional**: Edit requires a prior read of the file in
  the same session (a Read call or a Bash command that displays the file's content qualifies).
- **Staleness handling**: a file changed externally between the read and the edit does not hard-fail the
  edit — Claude Code re-checks `old_string`'s uniqueness against the file's *current* on-disk content at
  edit time. If it still matches exactly once, the edit proceeds; if not, Claude must re-read.
- **Permission scoping**: `Edit(path-pattern)` rules govern Edit, Write, and NotebookEdit uniformly. A
  `Read` deny rule additionally blocks Edit/Write (not NotebookEdit) on the same path (v2.1.208+ edits,
  v2.1.228+ writes) — you cannot create a file where you cannot read.
- **Symlinks**: permission checks apply to both the symlink path and its resolved target; an allow rule
  needs both sides to match (else it falls back to prompting), a deny rule fires on either side matching.
- **Checkpointing != version control**: every prompt that starts a turn creates an automatic checkpoint of
  files Claude's own edit tools touched (kept for the 100 most recent per session); `/rewind` can restore
  code, conversation, or both to any earlier checkpoint, or "summarize" the conversation from/up to a
  point. Explicitly **not tracked**: files changed via Bash (`rm`/`mv`/`cp`), subagent edits (except a
  *foreground* forked skill), external edits from outside the session, edits from a message queued mid-turn,
  and symlinked/hard-linked paths (restore skips them with a warning).

---

## 3. Shell — timeouts, background execution, output limits

(See §1 Bash contract for the numbers.) Summary of the shell-specific behavioural rules:

- **Timeout escalation, not truncation-on-timeout**: a command that exceeds its timeout is **moved to
  background** rather than killed — the harness's own design choice for "long-running command handling".
- **Output is tiered**: full output can stream to 5 GB before a hard kill; only a bounded prefix (tens of
  KB, configurable) is inlined into the model's context; anything beyond that is written to a session file
  with a preview shown inline, and a **failed** command additionally gets a head-and-tail excerpt rather
  than a raw dump.
- **Compound-command awareness**: Claude Code parses shell operators (`&&`, `||`, `;`, `|`, `|&`, `&`,
  newlines) and evaluates permission rules **per subcommand**, including inside subshells, command
  substitution, and `for`-loop bodies. An unparseable command (>10,000 chars, or one the analysis can't
  fully trace) always prompts rather than being treated as safe.
- **Wrapper stripping before rule matching**: `timeout`, `time`, `nice`, `nohup`, `stdbuf`, the `command`/
  `builtin` builtins, and zsh's `noglob` are stripped before a Bash rule is matched, so a rule like
  `Bash(npm test *)` also matches `timeout 30 npm test`. A leading assignment of a *known-safe* env var is
  also stripped for allow-rule matching (`NODE_ENV=test npm test` matches `Bash(npm test *)`), but deny
  rules match past *any* leading assignment. Exec wrappers (`watch`, `setsid`, `ionice`, `flock`, `find
  -exec`/`-delete`) **cannot** be auto-approved by a prefix rule — always prompt in Manual mode.
- **A recognized read-only command set** (`ls`, `cat`, `echo`, `pwd`, `head`, `tail`, `grep`, `find`,
  `wc`, `which`, `diff`, `stat`, `du`, `cd`, read-only `git`) runs without a permission decision in
  **every mode**, including `bypassPermissions` — this set is not configurable except by adding an
  explicit `ask`/`deny` rule for one of them.
- **Redirections are checked as if the target were opened directly**: `>`/`>>`/`2>` are checked against
  Edit rules and protected paths; `<` against Read rules; `tee` targets against Edit rules too. Only
  `/dev/null`, fd-forms (`2>&1`), and heredocs are exempt.
- **Sandboxing is a separate, complementary layer** (`sandboxing.md`, not deep-dived here beyond what
  appears in permissions/permission-modes): OS-level filesystem/network isolation applied only to Bash,
  PowerShell, and Monitor and their children; combines with (but does not replace) the permission-rule
  system.

---

## 4. Permission model

Source: `permissions.md` + `permission-modes.md`, by far the most exhaustively documented subsystem.

### Modes (config value → label)

| Config value | Label | What runs without asking |
|---|---|---|
| `default` | Manual (also accepts alias `manual`, v2.1.200+) | Reads only |
| `acceptEdits` | Accept edits | Reads + file edits + common in-scope filesystem commands (`mkdir`,`touch`,`rm`,`rmdir`,`mv`,`cp`,`sed`, plus PowerShell `Set-Content`/`Add-Content`/`Clear-Content`/`Remove-Item` equivalents) |
| `plan` | Plan | Reads + (if auto mode available) classifier-approved shell commands; **never edits source** |
| `auto` | Auto | Everything, reviewed by a background classifier model instead of a human |
| `dontAsk` | — | Reads + pre-approved (`permissions.allow`) tools; **everything else is auto-**denied**, never prompted** |
| `bypassPermissions` | Bypass permissions | Everything except a fixed list of "no mode auto-approves" actions |

**Starting mode resolution order**: `--permission-mode`/`--dangerously-skip-permissions` flag →
`permissions.defaultMode` in the first settings file where it validly applies → built-in default. The
**built-in default is `auto`** on Pro/Max/Team plans in a terminal or VS Code (since v2.1.228 macOS/
Linux/WSL, v2.1.233 native Windows), and `default` (Manual) on Enterprise/API-key/`-p`/SDK/most
third-party-provider sessions. `auto`/`bypassPermissions` set in project or local settings files are
silently ignored for the *starting* mode (only from user or managed settings).

### Rule syntax and evaluation order

- Format: `Tool` (matches every use) or `Tool(specifier)`.
- **Evaluation order is fixed: deny → ask → allow**, first match wins; rule *specificity never
  reorders this* — a broad `deny` always beats a narrow `allow`.
- A bare tool-name `deny` **removes the tool from the model's context entirely** (it never sees the tool
  exists); a scoped `deny` (e.g. `Bash(rm *)`) leaves the tool available and blocks matching calls.
  `EndConversation` is the sole exception — it can never be removed while another tool remains.
- Bash/PowerShell rules: `*` wildcard, `Bash(x *)` also matches bare `x`; a Bash rule **matches the
  written command text only**, not other invocation forms (`/usr/bin/curl`, `sh -c 'curl ...'` bypass a
  `Bash(curl *)` deny) — the docs explicitly call this "not a security boundary around the program" and
  point to sandboxing/hooks for real enforcement.
- Read/Edit rules use gitignore-pattern syntax with four anchor forms (`//abs`, `~/home`, `/settings-root`,
  `relative`), `!`-negation carve-outs (same-source only), and depth rules that differ between allow vs
  deny/ask for single-segment directory patterns.
- WebFetch rules use `domain:` with wildcard rules requiring v2.1.172+; a **bare** `WebFetch` allow/deny
  differs semantically from `WebFetch(domain:*)` — only the `domain:` form also touches the sandbox's
  network allowlist.
- MCP rules: `mcp__server`, `mcp__server__*`, `mcp__server__tool`.
- `Agent(name)` rules control which subagents may be spawned.
- Parameter matching (`Tool(param:value)`) works for scalar top-level fields only, e.g.
  `Agent(model:opus)`, `Bash(run_in_background:true)` — never for a tool's primary content field
  (`command`, `file_path`, `url`, etc. are explicitly excluded — those would be trivially bypassable).
- **Precedence across settings scopes**: managed (org) > project/local > user, with a small documented set
  of security-sensitive keys exempted; deny always wins across scopes regardless of level.

### Auto mode (the classifier)

- A **second model** (Claude Sonnet 5 by default, server-configurable) reviews each action that isn't
  already resolved by an allow/deny/ask rule or a working-directory read/edit. Decision order per action:
  (1) explicit rules resolve immediately (with exceptions for protected-path writes, critical-path
  deletes, MCP tools marked `requiresUserInteraction`, and commands carrying per-command sandbox domain
  requests — all of which still route to the classifier or a prompt even if an allow rule matches);
  (2) in-working-directory reads/edits auto-approve (except the *first* out-of-directory read, which
  always asks once); (3) everything else → classifier; (4) a classifier block returns Claude a reason
  (usually a rule tag like `[Data Exfiltration]`) and Claude tries an alternative.
- The classifier sees user messages, non-read-only tool calls, and CLAUDE.md content — **tool results are
  stripped from what the classifier sees**, specifically so that hostile content encountered in a file or
  web page cannot manipulate the classifier.
- Extensive, versioned "blocked by default" / "allowed by default" catalogues are documented — e.g.
  blocked: `curl | bash`, force-push, `git reset --hard`/`git clean -fd` (presumed to discard uncommitted
  work — Claude Code runs `git status` itself first to show the classifier what's at stake), amending a
  pushed commit, committing/pushing content that would exfiltrate secrets or widen deploy exposure,
  production `terraform destroy`, writing to a secrets manager, merging Claude's own unapproved PR,
  printing a live credential into the transcript, launching an unattended agent with `--dangerously-skip-
  permissions`; allowed by default: local file ops, installing declared lockfile dependencies, reading
  `.env` and sending its values to the matching API, read-only HTTP, pushing to any branch of the working
  repo (including default) subject to content checks.
- **Conversational boundaries are soft**: a stated "don't push yet" is honored by the classifier as long as
  the message stays in context, but is **not a hard rule** — it can be lost to compaction, and for a
  guaranteed block you must add an explicit deny rule instead.
- **Fallback thresholds are fixed and non-configurable**: 3 consecutive blocks or 20 total blocks in a
  session pauses auto mode and reverts to prompting.
- Auto mode also reviews subagent work at three points: before spawn (task description), during
  (every action, subagent's own `permissionMode` frontmatter is ignored), and after (final report,
  prepended with a security warning if flagged).

### Protected paths / critical paths (mode-independent circuit breakers)

- A fixed list of directories (`.git`, `.claude` except `.claude/worktrees`, `.vscode`, `.idea`, `.husky`,
  `.cargo`, `.devcontainer`, `.yarn`, `.mvn`, `.config/git`) and files (`.gitconfig`, shell rc files,
  package-manager rc files, `.mcp.json`, `.claude.json`, etc.) are **never auto-approved** by any
  `permissions.allow` rule, in any mode except `bypassPermissions` — an allow rule for `.claude/**` in
  settings.json is silently ineffective against this check.
- `rm`/`rmdir` targeting a **critical path** (filesystem root, drive roots, home directory, cwd or its
  parents, or a glob directly under a shell variable) can **never** be approved by an allow rule or a
  `PreToolUse` hook returning `"allow"` — a genuine circuit breaker independent of every other permission
  mechanism, present even in `bypassPermissions` (which still *asks*).

---

## 5. Context — compaction, instruction files, injected context, reporting

### What fills the context window at startup (`context-window.md`)

Documented as: system prompt (always first, ~4.2k tokens in the example, never shown to the user) → auto
memory (`MEMORY.md`, first 200 lines/25 KB) → environment info (cwd, platform, shell, OS, git-repo flag;
git branch/status/recent commits load as a *separate block at the very end* of the system prompt) → MCP
tool names (schemas deferred by default via tool search, unless `ENABLE_TOOL_SEARCH=auto|false`) → CLAUDE.md
/ AGENTS.md → skill descriptions → (optionally) an output style or `--append-system-prompt` text.

### Instruction files

- **CLAUDE.md / CLAUDE.local.md**: loaded from the **current working directory and every directory above
  it** up to the filesystem root; all discovered files are **concatenated**, ordered root-first so the
  directory closest to the launch point is read *last* (i.e., most-specific instructions land latest in
  context); within one directory, `CLAUDE.local.md` is appended after `CLAUDE.md`. Nested-directory
  CLAUDE.md files (in subdirectories *below* cwd) are **not** loaded at launch — they load lazily when
  Claude reads a file in that subdirectory. Block-level HTML comments are stripped before injection
  (visible if you `Read` the file directly). Max size 4 MiB (larger files are skipped entirely).
- **AGENTS.md**: read on its own or alongside CLAUDE.md (an alternate/complementary format, doc covers
  precedence when both exist and how to migrate from other tools' AGENTS.md-only conventions).
- **`.claude/rules/*.md`**: modular instruction files; can carry `paths:` frontmatter to scope loading to
  matching file types — these only enter context when Claude touches a matching file, and are dropped by
  compaction unless the `paths:` scoping is removed (persistent global rules should live in the
  project-root CLAUDE.md instead).
- **Auto memory**: separate from CLAUDE.md, a self-written notes system. Four kinds (`user`, `feedback`,
  `project`, `reference`); stored per-project at `~/.claude/projects/<project>/memory/` (`MEMORY.md` index
  + one topic file per memory); only the first 200 lines / 25 KB of `MEMORY.md` load at session start;
  topic files load on demand via ordinary file reads; Claude Code proactively nudges Claude to shorten
  `MEMORY.md` when it nears the limit, and truncates ("drops") anything past it on the *next* load if it
  isn't shortened. Not shared with subagents except a *fork* (which inherits the whole parent context).

### Compaction

- **Trigger**: automatic as the window approaches its limit (threshold varies by model — Sonnet 5 has no
  `[1m]` variant and runs the 1M window natively; other 1M-capable models select via a `[1m]` model
  suffix); manual via `/compact [instructions]`; targeted via `/rewind` → "Summarize from/up to here".
- **What survives** (table, `context-window.md`): system prompt/output style — unaffected; project-root
  CLAUDE.md and unscoped rules — **re-injected from disk**, not carried in the summary; auto memory —
  re-injected from disk; the plan-mode plan — re-injected from disk; path-scoped rules and nested
  CLAUDE.md — reloaded lazily on next matching file read; up to 5 most-recently-touched files —
  **re-read** after compaction (files over 5,000 tokens come back as a bare path reference, not content);
  invoked skill bodies — re-injected, capped at 5,000 tokens/skill and 25,000 tokens total budget, oldest
  dropped first; background Bash commands and background subagents — **keep running**, and Claude Code
  reminds Claude which ones are still in flight so it doesn't re-launch a duplicate; hook-injected context
  — summarized away with the rest of the conversation (unless a `SessionStart` hook matching the
  `compact` source re-injects it).
- The summarization request itself inherits the session's extended-thinking setting (v2.1.198+).
- **`SessionStart` fires again after compaction** (matcher value `compact`) specifically so hooks can
  re-inject context that would otherwise be lost.

### Context-usage reporting

- `/context` gives a live, categorized breakdown with optimization suggestions (files loaded, CLAUDE.md/
  memory files that loaded, etc.).
- Programmatically: `SDKContextUsage` is attached to the assistant message that answers a `/context`
  request (`context_usage` field, structured form of the same report) — Agent SDK v0.3.232+.
- The statusline JSON (§10) separately reports `context_window.total_input_tokens` /
  `total_output_tokens` / `context_window_size` / `used_percentage` / `remaining_percentage` /
  `current_usage{input_tokens,output_tokens,cache_creation_input_tokens,cache_read_input_tokens}`, derived
  from the **most recent API response only** (a gauge, not a cumulative sum) — `used_percentage` is
  computed from input-side tokens only (input + cache-write + cache-read), excluding output tokens.
  `current_usage` is explicitly `null` before the first API call and again immediately after `/compact`
  until the next call repopulates it.

---

## 6. Subagents

Source: `sub-agents.md`, `agents.md`, plus SDK type tables.

### Built-in subagent types

| Agent | Purpose | Model | Tools |
|---|---|---|---|
| `Explore` | fast codebase search/analysis | inherits from main (capped at Opus on the Anthropic API) | read-only |
| `Plan` | research before presenting a plan | inherits from main | read-only |
| `general-purpose` | complex multi-step tasks | `CLAUDE_CODE_SUBAGENT_MODEL` env var, else main's model | full subagent tool set |

### Custom subagent definition

Markdown file with YAML frontmatter, discovered from `~/.claude/agents/` (user), `.claude/agents/`
(project), or the `--agents` CLI flag (session-only JSON). Frontmatter fields documented: `name`
(required), `description` (required — drives auto-delegation matching), `tools`/`disallowedTools`,
`model` (`sonnet`/`opus`/`haiku`/`fable`/`inherit`), `permissionMode`, `maxTurns`, `skills` (preload),
`mcpServers` (scoped MCP servers), `hooks` (frontmatter hooks, active only while the subagent runs),
`memory` (`user`/`project`/`local` — persistent cross-session memory scoped to the subagent, *separate*
from the parent's auto memory), `background` (default keep-in-background), `omitClaudeMd`, `isolation:
worktree`, `effort`, `color`, `initialPrompt`, `experimental.cacheTtl`.

### Dispatch

- **Automatic**: the model matches the task at hand against each subagent's `description`.
- **Explicit**: natural language, an `@"name (agent)"` mention, or `--agent name` / the `agent` setting to
  pin the *whole session* to one subagent persona.
- **Restricting spawnable subagents**: `tools: Agent(worker, researcher), ...` in a subagent's own
  frontmatter limits what it can itself spawn; global `Agent(name)` deny rules do the same at the
  session level.

### Isolation — what a subagent does and does not see

Documented explicitly under "What loads at startup" (non-fork subagents): they receive their **own**
system prompt (not Claude Code's), the delegation task message, the full CLAUDE.md hierarchy, a git
status snapshot, preloaded skills, and (if `SendMessage` is available) a sibling-agent roster. They
**do not** receive: conversation history, the output style, the parent's auto memory (though they may
have their own via `memory:`), or the parent's context-window size. A **fork** (`context: fork` on a
skill, or `/subtask`) is the opposite: it inherits the **full parent conversation** instead of starting
fresh.

### Worktree isolation for subagents

`isolation: worktree` in a subagent's frontmatter gives it its own git worktree, branched from the
default branch (or from `HEAD` if `worktree.baseRef: "head"`); Claude Code enforces this with **four
hard checks** on every tool call from an isolated session/subagent: file edits outside the worktree are
blocked; Bash/PowerShell/Monitor commands whose *working directory* resolves into the main checkout are
blocked; git redirects into the main checkout (`git -C`, `--git-dir`, `GIT_DIR`/`GIT_WORK_TREE`, or a
`cd` before `git`) are blocked; and any command whose git-target-safety **cannot be statically verified**
is blocked outright (with guidance on how to rewrite it) — this last check "can't be turned off."
Temporary subagent worktrees are auto-removed on finish if clean; ones with uncommitted work or unpushed
commits are kept and swept later by a retention job.

### Result shape and budgets

- **`maxTurns`**: caps agentic turns; the result is marked partial rather than erroring, and the subagent
  can be resumed to continue (`Continue the <name> subagent to ...`, via `SendMessage`, preserving full
  history and prompt cache).
- **Concurrency/nesting limits** (env-var configurable): default **20 concurrent subagents**
  (`CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS`), default **3 layers of nesting**
  (`CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH`, set to `1` to disable nesting entirely).
- **Result delivery**: `SubagentHandback` delivers the final report to the parent conversation (auto-mode
  sessions only, v2.1.271+); in the SDK, the structured result for the `Agent` tool arrives as
  `tool_use_result` typed `AgentOutput` on the paired `SDKUserMessage`, with the report text separated
  from the token/cost trailer Claude Code appends to the plain `tool_result` text.
- **Foreground vs background**: default is foreground-blocking in interactive sessions unless fork mode
  makes it background by default, or `background: true` forces it; a **backgrounded** subagent's
  permission prompts surface into the *parent* session rather than blocking silently.
- **Pricing**: the docs state each subagent invocation should be billed at *its own* model's rate (a
  design rule stated for the OTel/harness's own accounting, not the model doc per se, but confirmed by
  the `query_source: main|subagent|auxiliary` and `modelUsage: {[model]: ModelUsage}` breakdown in
  `SDKResultMessage`).

### "Five ways to run agents in parallel" (`agents.md`)

Subagents (in-session, isolated context, summarized result) vs **agent view** (`claude agents`, dispatch
+ monitor background *sessions*, not subagents) vs **agent teams** (experimental, disabled by default —
a lead session coordinates teammates with a shared task list and direct messaging) vs **projects**
(cloud, claude.ai/code — long-running "threads") vs **dynamic workflows** (a script drives many subagents
and cross-checks their findings, for work too large for one turn-by-turn conversation to coordinate).

---

## 7. Skills

Source: `skills.md`. Skills follow the public "Agent Skills" open standard (agentskills.io), so the format
is meant to be portable across tools, not Claude-Code-proprietary.

### Format

`SKILL.md` = YAML frontmatter + Markdown body. Frontmatter fields documented: `name`, `description`
(truncated at 1,536 combined chars with `when_to_use`), `when_to_use`, `argument-hint`, `arguments`,
`disable-model-invocation`, `user-invocable`, `allowed-tools`, `disallowed-tools`, `model`, `effort`,
`context: fork`, `agent` (subagent type when forked), `background` (default `true` for forked skills),
`hooks`, `paths` (glob-scoped auto-activation), `shell` (`bash`/`powershell` for `!` inline command
injection), `metadata`, `license`, `compatibility`.

### Discovery

Two-tier loading, explicitly for token economy: the `description` (+`when_to_use`) is **always** in
context so the model knows the skill exists; the **full body loads only on invocation** (manual `/name`,
or automatic when the prompt matches the description/trigger phrases, or when a `paths:` glob matches a
file Claude is working with). Location determines scope: personal (`~/.claude/skills/`, this machine, all
projects), project (`.claude/skills/`, committed, this repo), nested (`<subdir>/.claude/skills/`,
auto-loads only when Claude works under that subdirectory), enterprise (managed-settings-deployed),
`--add-dir`-scoped, plugin-provided (`/plugin:skill`), and claude.ai-account-synced (cloud/Cowork only).
Name collisions resolve enterprise > personal > project > bundled.

### What is recorded when a skill runs

- The **first invocation** injects the full rendered `SKILL.md` as a single conversation message — this
  is the closest thing to a per-invocation "record": it appears verbatim in the session transcript, and
  therefore in the OTel `tool_result`/`tool_decision` events (with `skill.name` as a metric attribute) and
  in the `claude_code.tool` trace span's `skill_name` attribute (gated by `OTEL_LOG_TOOL_DETAILS`).
  **The docs state explicitly: "no separate audit log beyond session transcript."**
- **Re-invocation dedup**: if the rendered content is unchanged since it last loaded, Claude Code injects
  a short note instead of the full body again.
- **`allowed-tools` pre-approval is turn-scoped**: it clears after the user's next message even though the
  skill's *content* persists in context across turns; a deny rule always overrides it; workspace trust
  does **not** gate it (a project skill's tool pre-approvals apply even before you've trusted the folder —
  called out explicitly as something to review before running an unfamiliar project's skill).
- **`context: fork`**: runs the skill body as the prompt to a fresh subagent (see §6 isolation rules);
  background by default since v2.1.218, forced foreground in `-p`/SDK runs, when
  `CLAUDE_CODE_DISABLE_BACKGROUND_TASKS=1`, when the same skill is invoked twice concurrently, or when a
  scheduled task uses the skill as its prompt. A background forked skill's edits **bypass checkpointing**
  (must be `git`-reverted, not `/rewind`-ed).

---

## 8. Sessions

Source: `sessions.md`, `checkpointing.md`, `worktrees.md`.

- **Session ID**: a UUID (`--session-id <uuid>` can pin one explicitly); every session persists to a
  local JSONL transcript at `~/.claude/projects/<project>/<session-id>.jsonl` (`<project>` = cwd path with
  non-alphanumerics replaced by `-`, truncated+hashed past 200 chars). **The entry format is explicitly
  called "internal... changes between versions"** — scripts should not parse it directly; use `/export`,
  `claude -p --output-format json|stream-json`, or the Agent SDK instead.
- **Resume**: `claude --continue` (most recent in cwd), `claude --resume [name|session-id|path]`,
  `/resume` (in-session picker), `--from-pr <number>`. A resume restores conversation history (including
  tool calls/results — a tool still running at crash time does **not** re-run), model (unless retired/
  disallowed/overridden), agent persona, **permission mode** (with a documented matrix of exceptions per
  entry point — e.g. the *session picker* never restores the stored mode, always using what a fresh
  session on that command line would start in), active goal (turn count/timer/token baseline reset), and
  non-expired scheduled tasks (background Bash/Monitor tasks are **not** restored). Flags like
  `--mcp-config`, `--settings`, `--plugin-dir`, `--fallback-model`, `--add-dir` are **not** restored and
  must be re-passed.
- **Fork** (`--fork-session`, combined with `--continue`/`--resume`): mints a **new session ID**, copies
  the transcript up to that point, and the original is left untouched and still resumable.
- **Branch** (`/branch [name]`, in-session): same copy-and-switch semantics as fork but interactive — the
  new branch **inherits** in-session ("for this session") permission grants, in-flight background
  subagents/Bash (their output routes to the *new* branch), and the Remote Control connection; a true
  `--fork-session` process restart does **not** inherit session-scoped permission grants (must re-approve).
- **Resume-from-summary dialog**: on Pro/Max, resuming a session idle >~1hr and over 100k tokens (i.e.
  the prompt cache has cooled) offers "resume from summary" (runs `/compact` immediately, then only sends
  the summary + recent exchanges + up to 5 recently-read files on future turns) vs "resume full session
  as-is" (reprocesses/re-caches everything, full detail retained) — an explicit token-cost-vs-fidelity
  tradeoff exposed to the user.
- **Naming**: `--name`/`-n` at launch, `/rename` in-session, or auto-generated title (a background
  small/fast-model summary of the first prompt, or the plan title on plan-accept). Only the custom name
  or generated title are valid resume handles — the auto-assigned "default display name" (e.g.
  `my-app-3f`) is **not**.
- **Checkpointing / `/rewind`** (see §2 for what's tracked): the rewind menu offers per-checkpoint
  **Restore code and conversation / Restore conversation / Restore code / Summarize from here / Summarize
  up to here**. Checkpoint snapshots are retained per the `cleanupPeriodDays` sweep (~30 days default);
  rewinding to a checkpoint whose snapshot files were swept fails with a named error. **Not a replacement
  for git** — stated explicitly.
- **Worktree isolation**: `--worktree`/`-w <name>` (or the model calling `EnterWorktree`) creates/enters a
  fresh git worktree under `.claude/worktrees/<name>/` on a new branch `worktree-<name>`; a resumed
  session returns to its bound worktree automatically (with safety re-verification against several
  documented refusal cases — e.g. it won't re-enter a directory whose git metadata resolves back into the
  main checkout). `.worktreeinclude` (gitignore syntax) copies otherwise-gitignored files (like `.env`)
  into every new worktree. Cleanup: unnamed sessions auto-remove a clean worktree on exit; named sessions
  and any worktree with uncommitted/unpushed work prompt or are swept later, never silently deleted while
  work exists in them.

---

## 9. Hooks — full event catalogue, payload fields, blocking semantics

Source: `hooks.md` (behavioural reference) + `agent-sdk/typescript.md` (`HookInput`/`HookJSONOutput`
exact TS shapes).

### `BaseHookInput` (every hook input extends this)

```typescript
type BaseHookInput = {
  session_id: string;
  transcript_path: string;
  cwd: string;
  prompt_id?: string;
  permission_mode?: string;
  effort?: { level: string };
  agent_id?: string;
  agent_type?: string;
};
```

### Full event list, matcher support, and blocking semantics

| Event | Fires | Matcher | Can block (exit 2 / JSON) |
|---|---|---|---|
| `SessionStart` | session begins/resumes | `startup`,`resume`,`clear`,`compact`,`fork` | No |
| `SessionEnd` | session terminates | `clear`,`resume`,`logout`,`prompt_input_exit`,`other` | No |
| `Setup` | `--init-only`, or `--init`/`--maintenance` in `-p` | `init`,`maintenance` | No (fires before MCP servers exist — `mcp_tool` hooks are skipped here) |
| `UserPromptSubmit` | prompt submitted, before processing | none | **Yes** — exit 2 erases the prompt |
| `UserPromptExpansion` | a slash command expands into a prompt | command name | **Yes** — blocks the expansion; can rewrite it |
| `Stop` | Claude finishes responding | none | **Yes** — exit 2 forces continuation |
| `StopFailure` | turn ends via API error | error type enum | No — exit 2 output discarded entirely |
| `PreToolUse` | before a tool call | tool name (regex) | **Yes** |
| `PostToolUse` | after a tool call succeeds | tool name | No (but exit 2 shows Claude a reason) |
| `PostToolUseFailure` | after a tool call fails | tool name | No (exit 2 shows Claude a reason) |
| `PermissionRequest` | a permission decision is needed | tool name | Decides via JSON `decision` field, not exit code |
| `PermissionDenied` | auto mode denies a call | tool name | No — JSON `retry: boolean` only |
| `PostToolBatch` | after a full parallel batch resolves, before next model call | none | No |
| `PreModelSwitch` | before a model switch applies | canonical model name (regex) | **Yes**, and a timeout also blocks (opposite of PreToolUse) |
| `PostModelSwitch` | after model changes (incl. server-initiated) | new model name | No |
| `PreCompact` | before compaction | `manual`,`auto` | No (compaction can't be blocked) |
| `PostCompact` | after compaction | `manual`,`auto` | No |
| `InstructionsLoaded` | a CLAUDE.md/rules file loads | `session_start`,`nested_traversal`,`path_glob_match`,`include`,`compact` | No |
| `ConfigChange` | a config file changes mid-session | `user_settings`,`project_settings`,`local_settings`,`policy_settings`,`skills` | No |
| `CwdChanged` | `cd` changes the working directory | none | No |
| `DirectoryAdded` | `/add-dir` or SDK `register_repo_root` | `slash_command`,`register_repo_root` | No |
| `FileChanged` | a watched file changes on disk | exact filenames only, `\|`-separated | No |
| `WorktreeCreate` | a worktree is being created | none | **Yes** — any nonzero exit aborts creation |
| `WorktreeRemove` | a worktree is being removed | none | **Yes** — any nonzero exit fails removal if dir still exists |
| `SubagentStart` | a subagent spawns | agent type (regex) | No |
| `SubagentStop` | a subagent finishes | agent type | **Yes** — prevents the subagent from stopping |
| `TaskCreated` | `TaskCreate` fires | none | No |
| `TaskCompleted` | a task is marked complete | none | No |
| `TeammateIdle` | an agent-team teammate is about to go idle | none | No |
| `Notification` | Claude Code sends a notification | notification-type enum (permission_prompt, idle_prompt, auth_success, elicitation_*, agent_needs_input, agent_completed, quota_auto_resume_*) | No |
| `MessageDisplay` | assistant text is being displayed (streaming) | none | No — display-only, can't modify the message |
| `Elicitation` | an MCP server requests user input | MCP server name | No — JSON `result` field supplies the response |
| `ElicitationResult` | after the user answers an elicitation, before it's sent back | MCP server name | No |

### Exit-code / JSON-output semantics

- **Exit 0**: JSON on stdout (if it parses per the event's schema) is honored; invalid-schema or non-JSON
  stdout is treated as plain text/non-blocking. Only `UserPromptSubmit`, `UserPromptExpansion`,
  `SessionStart`, and `PostModelSwitch` add their stdout as context Claude *sees*; other events' stdout
  goes only to the debug log.
- **Exit 2**: blocking, on the events marked **Yes** above. The blocking message comes from the JSON
  decision's reason field if present, else stderr. **Exit 2 always overrides even an "allow" in the JSON
  body.** `WorktreeCreate`/`WorktreeRemove` treat *any* nonzero exit (not just 2) as blocking.
  `StopFailure` discards output entirely regardless of exit code.
- **Other codes**: same JSON-parsing rules as exit 0, but any output is treated as non-blocking (never
  forces a block) — used for "advisory" annotations.
- **`hookSpecificOutput`** carries the event-specific decision payload — see the exact TypeScript union in
  §0's source for the full per-event shape (`permissionDecision: allow|deny|ask|defer`,
  `classifierContext` [2000-char cap, feeds the auto-mode classifier, "don't copy untrusted tool output
  into it"], `updatedInput`, `additionalContext`, `sessionTitle`, `watchPaths`, `reloadSkills`,
  `worktreePath`, `displayContent`, etc.).
- **Universal fields**: `systemMessage` (shown to Claude, discarded on `StopFailure`/`MessageDisplay`/
  `Notification`), `additionalContext`, `terminalSequence` (a whitelisted OSC/BEL escape sequence, e.g.
  desktop notification — only the interactive CLI emits it, the SDK ignores the field).
- **Handler types**: `command` (shell, stdin/stdout), `http` (POST, response body = decision), `mcp_tool`
  (calls a tool on a connected MCP server), `prompt` (sent to the model itself for evaluation, experimental
  in v2.1), `agent` (spawns a subagent to verify, experimental).
- **Deferred tool calls**: a `PreToolUse` hook can return `permissionDecision: "defer"`; the run's result
  then carries `stop_reason: "tool_deferred"` and `deferred_tool_use: {id,name,input}` so a host
  application can surface the pending call in its own UI and resume the same `session_id` later.
- **Matcher grammar**: bare/`*`/empty matches everything; a token made only of alphanumerics/`_`/`-`/
  spaces/`|`/`,` is an **exact-match list** (`Bash`, `Edit|Write`); anything else is an **unanchored
  regex** (`^Notebook`, `mcp__memory__.*`). `FileChanged` is the one exception — narrower exact-match-only
  set, `|` the sole separator.

---

## 10. Telemetry it emits

Source: `monitoring-usage.md` (OTel), `statusline.md`, `cli-reference.md`/SDK docs (stream-json).

### OpenTelemetry metrics (`OTEL_METRICS_EXPORTER`)

| Metric | Unit | Key attributes |
|---|---|---|
| `claude_code.session.count` | count | `start_type` (fresh/resume/continue/agents_view) |
| `claude_code.lines_of_code.count` | count | `type` (added/removed), `model` |
| `claude_code.pull_request.count` | count | — |
| `claude_code.commit.count` | count | — |
| `claude_code.cost.usage` | USD | `model`, `query_source` (main/subagent/auxiliary), `speed`, `effort`, `agent.name`, `skill.name`, `plugin.name`, `marketplace.name`, `mcp_server.name`, `mcp_tool.name` |
| `claude_code.token.usage` | tokens | `type` (input/output/cacheRead/cacheCreation), plus the same model/query_source/agent/skill/mcp attrs |
| `claude_code.code_edit_tool.decision` | count | `tool_name` (Edit/Write/NotebookEdit), `decision` (accept/reject), `source` (config/hook/user_permanent/user_temporary/user_abort/user_reject), `language` |
| `claude_code.active_time.total` | seconds | `type` (user/cli) |

Standard resource/attribute gates: `session.id`, `app.version`, `app.entrypoint`, `organization.id`,
`user.account_uuid`/`account_id`, `user.id`, `user.email`, `terminal.type`, `vcs.*` (repo identity,
v2.1.269+), custom `OTEL_RESOURCE_ATTRIBUTES` — each independently toggled by an `OTEL_METRICS_INCLUDE_*`
env var for cardinality/PII control.

### OTel log events (`OTEL_LOGS_EXPORTER`)

`claude_code.user_prompt`, `claude_code.assistant_response` (v2.1.193+), `claude_code.tool_result`,
`claude_code.tool_decision`, `claude_code.api_request`, `claude_code.api_error` — each with a documented
attribute table (see full fetch above); prompt/response bodies are redacted unless `OTEL_LOG_USER_PROMPTS`
/`OTEL_LOG_ASSISTANT_RESPONSES` are set, and tool parameter/command detail requires
`OTEL_LOG_TOOL_DETAILS`. Correlation: `prompt.id` (one per user prompt, matches hooks' `prompt_id`),
`event.sequence`, `message.uuid`, `client_request_id`.

### Distributed tracing (beta, `CLAUDE_CODE_ENHANCED_TELEMETRY_BETA=1`)

Span hierarchy: `claude_code.interaction` → `claude_code.llm_request` / `claude_code.hook` (detailed beta
only) / `claude_code.tool` → `claude_code.tool.blocked_on_user`, `claude_code.tool.execution`, nested
subagent spans. Each span's attribute table is fully documented (model, `gen_ai.system: "anthropic"`,
`query_source`, timing fields including `ttft_ms`/`duration_ms`, `agent_id`/`parent_agent_id`,
`workflow.run_id`/`workflow.name`, `bash_command_class`/`bash_argv0`, hook counts by outcome).

### stream-json message types (`--output-format stream-json`, Agent SDK `SDKMessage`)

`cli-reference.md` documents only the CLI *flags* that shape the stream (`--include-partial-messages`,
`--include-hook-events`, `--forward-subagent-text`, `--replay-user-messages`, `--prompt-suggestions`) and
defers the exact message shapes to the Agent SDK reference, which is the canonical source. The full
`SDKMessage` union (fetched raw, since the summarizing web-fetcher truncates before reaching it on this
very large page):

```typescript
type SDKMessage =
  | SDKAssistantMessage | SDKUserMessage | SDKUserMessageReplay | SDKResultMessage
  | SDKSystemMessage | SDKPartialAssistantMessage | SDKCompactBoundaryMessage
  | SDKStatusMessage | SDKLocalCommandOutputMessage | SDKHookStartedMessage
  | SDKHookProgressMessage | SDKHookResponseMessage | SDKPluginInstallMessage
  | SDKToolProgressMessage | SDKAuthStatusMessage | SDKTaskNotificationMessage
  | SDKTaskStartedMessage | SDKTaskProgressMessage | SDKTaskUpdatedMessage
  | SDKBackgroundTasksChangedMessage | SDKThinkingTokensMessage
  | SDKSessionStateChangedMessage | SDKWorkerShuttingDownMessage
  | SDKCommandsChangedMessage | SDKNotificationMessage | SDKFilesPersistedEvent
  | SDKToolUseSummaryMessage | SDKMemoryRecallMessage | SDKRateLimitEvent
  | SDKElicitationCompleteMessage | SDKPermissionDeniedMessage
  | SDKPromptSuggestionMessage | SDKAPIRetryMessage | SDKMirrorErrorMessage
  | SDKInformationalMessage | SDKConversationResetMessage;
```

Key documented shapes:
- **`SDKAssistantMessage`**: `{type:"assistant", uuid, session_id, message: BetaMessage, parent_tool_use_id,
  error?: SDKAssistantMessageError, aborted?: true, timestamp?, context_usage?: SDKContextUsage,
  user_message_uuid?, user_message_uuids?}`. `error` enum: `authentication_failed`,
  `oauth_org_not_allowed`, `account_on_hold`, `billing_error`, `rate_limit`, `overloaded`,
  `invalid_request`, `model_not_found`, `server_error`, `max_output_tokens`, `cloud_credential_error`,
  `unknown`.
- **`SDKUserMessage`**: `{type:"user", uuid?, session_id?, message: MessageParam, parent_tool_use_id,
  isSynthetic?, shouldQuery?, tool_use_result?: unknown, origin?: SDKMessageOrigin}`.
  `shouldQuery: false` appends to the transcript **without** triggering a turn (held and merged into the
  next real turn) — the documented way to inject out-of-band context cheaply.
- **`SDKResultMessage`**: a two-arm discriminated union on `subtype`. Success arm: `success` with
  `duration_ms`, `duration_api_ms`, `is_error`, `api_error_status?`, `num_turns`, `result`, `stop_reason`,
  `ttft_ms?`, `total_cost_usd`, `usage: NonNullableUsage`, `modelUsage: {[model]: ModelUsage}`,
  `permission_denials: SDKPermissionDenial[]`, `terminal_reason?`, `fast_mode_state?`, etc. Error arm:
  `subtype` ∈ `error_max_turns | error_during_execution | error_max_budget_usd |
  error_max_structured_output_retries`, with `errors: string[]` and optional
  `startup_failure_reason: SDKStartupFailureReason` (16-value enum covering org-pin conflicts, worktree
  refusals, missing shell tool on Windows, etc.). `terminal_reason` (both arms via a shared field pattern)
  is a 16-value enum: `completed, max_turns, tool_deferred, aborted_streaming, aborted_tools,
  hook_stopped, stop_hook_prevented, background_requested, blocking_limit, rapid_refill_breaker,
  prompt_too_long, image_error, model_error, api_error, malformed_tool_use_exhausted, budget_exhausted,
  structured_output_retry_exhausted, tool_deferred_unavailable, turn_setup_failed`.
- **`SDKSystemMessage`** (`subtype:"init"`): `{agents?, apiKeySource, betas?, claude_code_version, cwd,
  tools: string[], mcp_servers: [{name,status,source?}], model, permissionMode, slash_commands,
  terminal_slash_commands?, output_style, skills, plugins, fast_mode_state?, effort?, capabilities?:
  string[]}` — `capabilities` is an **open, feature-detectable set** (e.g. `interrupt_receipt_v1`,
  `interrupt_cancel_queued_v1`) rather than a version-gated fixed list.
- **`SDKPartialAssistantMessage`** (`type:"stream_event"`): raw Anthropic `BetaRawMessageStreamEvent`
  wrapper, only emitted with `includePartialMessages`; `parent_tool_use_id` is **always null** on this
  type (subagent streaming isn't attributed here — use complete messages or `forwardSubagentText`).
- **`SDKCompactBoundaryMessage`**: `{type:"system", subtype:"compact_boundary", compact_metadata:
  {trigger:"manual"|"auto", pre_tokens: number}}`.
- **`SDKPermissionDeniedMessage`**: `{tool_name, tool_use_id, agent_id?, decision_reason_type? ("rule"|
  "mode"|"classifier"|"asyncAgent"), decision_reason?, message}` — explicitly **best-effort**; the
  authoritative record is `permission_denials` on the result message.

### `HookInput` / `HookJSONOutput` — exact wire shapes

Fully reproduced in §9's source table; the TypeScript union types (`HookInput`, `BaseHookInput`, per-event
input interfaces, `HookJSONOutput = AsyncHookJSONOutput | SyncHookJSONOutput`, and the giant
`hookSpecificOutput` discriminated union) are the canonical machine-readable contract and were pulled
verbatim from `agent-sdk/typescript.md`.

### Statusline JSON (full field list)

`statusline.md`'s "Available data" table + full JSON schema accordion, verbatim structure:

```json
{
  "cwd": "...", "session_id": "...", "session_name": "...", "prompt_id": "...",
  "transcript_path": "...",
  "model": {"id":"...", "display_name":"..."},
  "workspace": {"current_dir":"...", "project_dir":"...", "added_dirs":[],
    "git_worktree":"...", "repo": {"host":"...","owner":"...","name":"..."}},
  "version": "...",
  "output_style": {"name":"..."},
  "cost": {"total_cost_usd":0, "total_duration_ms":0, "total_api_duration_ms":0,
    "total_lines_added":0, "total_lines_removed":0},
  "context_window": {"total_input_tokens":0, "total_output_tokens":0,
    "context_window_size":200000, "used_percentage":0, "remaining_percentage":0,
    "current_usage": {"input_tokens":0,"output_tokens":0,
      "cache_creation_input_tokens":0,"cache_read_input_tokens":0}},
  "exceeds_200k_tokens": false,
  "prompt_cache": {"warm":true,"caching_observed":true,"ttl":"1h","expires_at":0,
    "requests":0,"misses":0,"expected_rebuilds":0,"hit_ratio":0,
    "cache_write_tokens":0,"miss_recache_tokens":0,"last_miss_at":0,
    "last_miss_cause": {"causes":["tools_changed"],"tools_added":0,"tools_removed":0},
    "miss_causes": {"tools_changed":0}, "recache_tokens_if_cold":0},
  "fast_mode": false,
  "effort": {"level":"high"},
  "thinking": {"enabled": true},
  "rate_limits": {"five_hour": {"used_percentage":0,"resets_at":0},
    "seven_day": {"used_percentage":0,"resets_at":0},
    "spend_limit": {"used_percentage":0,"resets_at":0}},
  "vim": {"mode":"NORMAL"},
  "agent": {"name":"..."},
  "pr": {"number":0,"url":"...","review_state":"pending","kind":"mr"},
  "worktree": {"name":"...","path":"...","branch":"...",
    "original_cwd":"...","original_branch":"..."}
}
```

Notable rules: `used_percentage` is computed input-side only (`input + cache_creation + cache_read`,
excludes output); `current_usage` is `null` before the first API call and again right after `/compact`;
`session_name` is absent unless a custom name or AI title exists (never the auto default display name);
`rate_limits.*` requires Pro/Max or a gateway spend limit and appears only after the first API response;
`prompt_cache` requires v2.1.251+ and excludes subagent requests from its statistics.

---

## 11. Plan mode / TODO tooling / model-facing planning surfaces

### Plan mode (see §4 for the full permission table)

Read-and-explore-only; source edits are blocked until a plan is approved. With auto mode available during
planning (`useAutoModeDuringPlan`, on by default), shell commands during planning go through the
classifier instead of prompting; otherwise only the built-in read-only command set runs free. On plan
approval, three options are offered: **Yes, and use auto mode** / **Yes, manually approve edits** / **No,
keep planning** — approving switches the session's permission mode and gives it a generated title based
on the plan (unless already named). `Ctrl+G` opens the plan in the user's editor for direct editing before
acceptance.

### Task-tracking tools (`TodoWrite` vs `TaskCreate`/`TaskGet`/`TaskUpdate`/`TaskList`/`TaskOutput`/
`TaskStop`)

- **Model-gated by default**: the four `Task*` tools + `TodoWrite` are provided by default **only** on a
  fixed list of models (Claude 3.x, Opus 4–4.7, Sonnet 4–4.6, Haiku 4.5) — "newer models track multi-step
  work without a written todo list" and get nothing here unless the caller opts in via `allowedTools`,
  `tools`, or `CLAUDE_CODE_ENABLE_TODO_TOOLS=1`/`CLAUDE_CODE_ENABLE_TASKS`.
- **Lifecycle** (documented as exactly four states): `pending` (created) → `in_progress` (activated) →
  `completed`, or removed via `TaskUpdate {status:"deleted"}`.
  Claude creates todos for: 3+-step tasks, user-provided multi-item lists, long operations, and explicit
  "organize this into a todo list" requests; it may skip todos for short/single-step requests.
  `TaskCreate` returns an object under `tool_use_result.task.id` — the ID is **not** present on the
  streamed `tool_use` input, so a host application must pair `TaskCreate`'s `tool_use_id` against the
  following `tool_result` to learn the assigned ID (documented gotcha, with example code).
  **Field-name repair**: Claude Code silently repairs close-but-wrong key names the model emits
  (`id`/`task_id`→`taskId`, `active_form`→`activeForm`) before executing the tool call, but this repair is
  **not reflected in the streamed `tool_use` block itself** — consumers must read fields defensively
  (check all three spellings).
- **`TaskNotificationMessage`** (SDK) is the channel for background-task progress (backgrounded commands
  and subagents), separate from the in-band `tool_use`/`tool_result` stream of Task-tool calls.

### Other model-facing planning surfaces

- **`AskUserQuestion`**: multiple-choice with an optional free-text "Other" row; auto-continues after a
  configurable timeout (`askUserQuestionTimeout`: 60s/5m/10m) submitting whatever was selected, with a
  visible countdown in the final 20 seconds.
- **`EnterPlanMode`/`ExitPlanMode`**: explicit tool-level entry/exit from plan mode (in addition to the
  `Shift+Tab` interactive cycle and `/plan` prefix).
- **Dynamic Workflows** (`Workflow` tool, `workflows.md`, not deep-dived above): a script-driven
  orchestration layer explicitly positioned *above* subagents/skills for work "too big to coordinate one
  turn at a time," with cross-checking of multiple subagents' findings against each other.

---

## REQUIREMENTS FOR OUR HARNESS

1. **Gate Edit on a prior read of the exact file, and re-validate uniqueness against live disk content at
   apply time** — Claude Code's `Edit` tool enforces read-before-write and re-checks `old_string`
   uniqueness against current disk content rather than the content at read time (`tools-reference.md`,
   Edit Tool Behavior).
2. **Never silently truncate a large Read; return an explicit partial-view marker instead** — the docs
   describe a `PARTIAL view` notice when a read exceeds the tool's token budget, and a distinct explicit
   notice for an empty file, rather than truncating without saying so (`tools-reference.md`, Read Tool
   Behavior).
3. **Treat a Bash timeout as "move to background," not "kill"** — a command exceeding its timeout is
   moved to a background execution slot rather than terminated, preserving in-flight work
   (`tools-reference.md`, Bash Tool Behavior: Timeouts).
4. **Tier Bash output into inline/preview/full-file, with a distinct smaller ceiling for failures** —
   documented ceilings (~30k chars success inline, ~10k chars failure inline, output beyond that saved to
   a side file with a preview) keep a single noisy command from flooding context while still making the
   full log recoverable (`tools-reference.md`, Bash Tool Behavior: Output Limits).
5. **Split compound shell commands on shell operators and evaluate permission rules per-subcommand,
   including inside subshells/substitution** — a permission model that matches only the whole command
   string is bypassable by `safe && evil`; Claude Code explicitly parses `&&`,`||`,`;`,`|`,`|&`,`&`, and
   newlines and checks each piece (`permissions.md`, Compound commands).
6. **Never let an allow rule or an auto-approving hook override a `rm`/`rmdir` targeting a critical
   filesystem path** — a hard circuit breaker independent of the rest of the permission system, present
   in every mode including full bypass (`permission-modes.md`, Critical paths).
7. **Keep a fixed, non-configurable read-only command allowlist (`ls`,`cat`,`grep`,`find`,`git log`,
   etc.) that never prompts in any mode** — this is what makes exploration free of friction without
   weakening the edit/write boundary (`permissions.md`, Read-only commands).
8. **Evaluate permission rules in a fixed deny → ask → allow order, independent of rule specificity** — a
   narrow allow can never carve an exception out of a broader deny; this must be a structural property of
   the evaluator, not an emergent one (`permissions.md`, Manage permissions).
9. **Make a bare tool-name deny remove the tool from the model's visible toolset entirely**, distinct from
   a scoped deny that leaves the tool listed but blocks matching calls — the model should never see (and
   thus never attempt) a tool it categorically cannot use (`permissions.md`, Manage permissions).
10. **Protect a fixed set of self-configuration and VCS-internal paths (`.git`,`.claude`, shell rc files,
    package-manager rc files) from ever being auto-approved by a settings-file allow rule**, requiring an
    explicit interactive or classifier decision even in otherwise-permissive modes
    (`permission-modes.md`, Protected paths).
11. **Snapshot every file our own edit tools touch before each user turn, keep N most recent, and offer
    restore of code, conversation, or both independently** — checkpointing decoupled from git gives cheap
    per-turn undo without requiring the user to have committed anything (`checkpointing.md`, How
    checkpoints work).
12. **Explicitly exclude Bash-driven file mutations and non-foreground-subagent edits from
    checkpoint tracking, and say so to the user** — an undo feature that silently fails to cover some
    edits is worse than one that states its own boundary (`checkpointing.md`, Limitations).
13. **Load instruction files bottom-up by directory depth, concatenating rather than overriding, with the
    most path-specific file's content injected last** — deterministic instruction-precedence without
    losing broader project-level context (`memory.md`, How CLAUDE.md files load).
14. **Cap an auto-generated "memory index" at a hard line/byte budget and proactively prompt for
    self-shortening as it approaches that budget**, with detail split into on-demand topic files —
    bounds the fixed per-session cost of persistent memory while keeping it effectively unbounded in
    total size (`memory.md`, Auto memory: How it works).
15. **On compaction, re-inject project-level instructions and memory from disk rather than trusting the
    summary to have preserved them, and re-read a small number of the most recently touched files** —
    the summarization model is not trusted to losslessly retain operational context
    (`context-window.md`, What survives compaction).
16. **Re-run a `SessionStart`-equivalent hook after compaction** so integrations that inject
    context (env probes, ticket state, etc.) get a chance to refresh it — a one-time-at-launch injection
    would go stale across a long session (`hooks.md`, SessionStart: matcher `compact`).
17. **Give subagents an isolated context by default (no parent history, no parent auto-memory) but a full
    copy of project instructions**, and offer an explicit "fork" mode for the opposite (full parent
    context, no isolation) as a distinct, opt-in shape — conflating the two loses either the
    cost-savings or the continuity guarantee (`sub-agents.md`, What Loads at Startup).
18. **Enforce worktree isolation as four independent, non-bypassable checks (file-edit path, command cwd,
    git-target redirection, and "can't statically verify" fail-closed)** rather than a single
    working-directory heuristic — each check catches a different escape (`worktrees.md`, How Claude Code
    enforces isolation).
19. **Cap subagent concurrency and nesting depth via two independent, explicit limits** (not one implicit
    resource ceiling) — a runaway fan-out and a runaway recursion are different failure modes needing
    different limits (`sub-agents.md`, Limits and Budgets).
20. **Load a "skill"'s trigger description into every turn's context but defer its full body until
    invocation, and dedupe re-injection of unchanged content on re-invocation** — this is the mechanism
    that lets a large skill library exist without a large fixed context tax (`skills.md`, Discovery
    Mechanism; Recording & Context Lifecycle).
21. **Scope a skill's tool pre-approval to the single turn it invoked in, clearing on the next user
    message even though the skill's injected content persists** — a temporary capability grant should not
    silently outlive the reason it was granted (`skills.md`, allowed-tools Frontmatter: Behavior).
22. **Emit a permission-decision record (accept/deny + source: rule/hook/user-once/user-permanent) for
    every tool call, independent of any other logging**, so downstream tooling can audit *why* a call was
    or wasn't approved without re-deriving it from raw transcripts (`monitoring-usage.md`,
    `claude_code.tool_decision`, `code_edit_tool.decision`).
23. **Give the final turn/session result a closed, versioned enum of "why did the loop end" reasons**
    (completed / max_turns / hook_stopped / budget_exhausted / api_error / …) rather than a single
    success/failure boolean — callers building on top of the harness need to distinguish these programmatically
    (`agent-sdk/typescript.md`, `SDKResultMessage.terminal_reason`).
24. **Make cost/token accounting per-model and per-invocation-source (main loop vs subagent vs auxiliary
    call), not a single session total**, because subagents commonly run cheaper models than their parent
    and a flat total misattributes spend (`agent-sdk/typescript.md`, `SDKResultMessage.modelUsage`;
    `monitoring-usage.md`, `query_source` attribute).
25. **Treat "task list" tooling as a lifecycle state machine with exactly four states and a documented
    field-repair layer for near-miss key names**, and make the created item's ID retrievable only via the
    paired tool-result (not the tool-call input) — this shape should be copied deliberately rather than
    reinvented, since Anthropic's own docs flag it as a common integration gotcha
    (`agent-sdk/todo-tracking.md`, Todo lifecycle; Display progress in real time).

---

## What the documentation does NOT state

- **The exact scheduling/concurrency model for multiple tool calls issued within a single model turn** —
  `PostToolBatch` names the concept of a "batch" resolving before the next model call, but no page states
  whether tool calls within a batch run concurrently, in what order, or with what per-batch limits.
- **The full byte-for-byte transcript JSONL schema** — `sessions.md` explicitly disclaims this ("internal
  to Claude Code and changes between versions... scripts that parse these files directly can break on any
  release") and directs integrators to `/export` or the Agent SDK message stream instead.
- **The system prompt's actual text** — its token cost is given as an example figure (~4,200 tokens) but
  the content is stated as never shown to the user; only `--system-prompt`/`--append-system-prompt`
  override points are documented, not the default's contents.
- **Exact numeric auto-compaction thresholds per model** — `context-window.md` defers to a separate
  "Default auto-compact thresholds" reference in `model-config.md` for the precise percentage/token
  boundary per model, which was not independently verified in this pass.
- **The classifier model's full decision algorithm** — the "blocked by default"/"allowed by default"
  catalogues are extensive rule *lists*, but the underlying classifier is a model call, not a fully
  specified deterministic rule engine; false-positive/negative behavior is inherently probabilistic and
  undocumented beyond "3 consecutive or 20 total blocks triggers fallback to prompting."
  documentation.
- **A general, tool-agnostic definition of "parallel tool call"** independent of the Bash-specific
  `run_in_background` flag and the Monitor/subagent-specific background semantics.
- **The precise heuristics a skill's `description` match or a subagent's auto-delegation match uses** —
  both are described as "Claude reads the description and decides," not as a scored/threshold algorithm.
- **Full internal reasoning-token accounting for "effort" levels** — `effort.level` is exposed
  (`low|medium|high|xhigh|max`) but how each level maps to a thinking-token budget or latency/cost
  multiplier is not given in the pages reviewed.
- **Whether/how the auto-mode classifier's own token cost is included in the visible session cost** on
  non-Enterprise/non-API-key providers — the docs say classifier calls "count toward your token usage" on
  Enterprise/API-key/cloud-provider accounts but are ambiguous for the default Pro/Max path where a
  server-side review may substitute for a separate classifier call.
