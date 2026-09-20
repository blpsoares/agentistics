# Codex CLI — tool catalogue, editing model, sandbox and delegation

**Provenance:** produced by a research subagent on 2026-09-19 from Codex's own public sources —
the Apache-2.0 Rust tree at `github.com/openai/codex` (`codex-rs/`), its `docs/`, and
`developers.openai.com` / `learn.chatgpt.com`. The parent research (a full cross-harness catalogue)
was **interrupted by a session rate limit**; this is the one harness it finished. Claude Code,
Gemini CLI, Copilot CLI, Kimi, agy, OpenCode and Cline are still to do.

No leaked/deobfuscated source of any product was read (the standing constraint).

---

## 1. Tools exposed to the model

Defined in `codex-rs/core/src/tools/handlers/*_spec.rs`:

| Tool | Contract |
|---|---|
| `exec_command` | the shell. Args: `cmd`, `workdir`, `tty` (allocate a PTY), `yield_time_ms` (250–30000, default 10000), `max_output_tokens` (default 10000), `shell`, `login`, `environment_id`, plus escalation args (`sandbox_permissions`, `justification`, `prefix_rule`, `additional_permissions`). Result: `chunk_id`, `wall_time_seconds`, `exit_code`, **`session_id` when the process is still running**, `original_token_count`, `output` |
| `write_stdin` | writes into a still-running `exec_command` session by `session_id` — interactive and background processes fall out of this pair |
| `apply_patch` | file editing, **a Freeform grammar tool**, not JSON (see §2) |
| `view_image` | `path` + `detail` → data URL |
| `update_plan` | the TODO tool (see §6) |
| `request_permissions` | asks for a filesystem/network permission profile mid-turn |
| `request_user_input` / `_async`, `send_message_to_user_async` | interactive Q&A and status push |
| `get_context_remaining`, `current_time`, `sleep`, `wait_for_environment`, `new_context_window` | utilities |
| `tool_search` | **a meta-tool: the model discovers other tools on demand** instead of loading the whole catalogue into context |
| `list_available_plugins_to_install`, `request_plugin_install` | the model can browse and request plugin installs mid-session |
| `multi_agents*` / `spawn_agent` | subagents (see §5) |
| hosted web search | via the Responses API's built-in tool; config types `WebSearchContextSize` / `WebSearchFilters` / `WebSearchUserLocation` |
| MCP tools | bridged 1:1 (see §7) |

**There is no grep/glob/find tool.** The model shells out (`rg`, `find`). A fast fuzzy file-search
crate exists (`codex-rs/file-search`, the `ignore` crate + `nucleo-matcher`) but it serves the
CLI/TUI's own `@file` picker, not the model. No codebase indexing or embeddings anywhere in the tree.

## 2. File editing — `apply_patch`, and why its shape matters

A custom format with an actual Lark grammar (`core/assets/tools/apply_patch.lark`):

```
start: begin_patch hunk+ end_patch
hunk: add_hunk | delete_hunk | update_hunk
add_hunk:    "*** Add File: " filename LF add_line+
delete_hunk: "*** Delete File: " filename LF
update_hunk: "*** Update File: " filename LF change_move? change?
change_move: "*** Move to: " filename LF
change: (change_context | change_line)+ eof_line?
```

- **No line numbers anywhere.** A hunk locates itself by CONTEXT (`@@` plus an optional locator such
  as a function signature, then ` ` / `-` / `+` lines), not by offset.
- **Rename is native** (`*** Move to:`).
- **Stale context is handled in three decreasing tiers** (`apply-patch/src/seek_sequence.rs`): exact
  match → ignoring trailing whitespace → ignoring leading+trailing whitespace; EOF-anchored hunks try
  the file's end first. A hunk whose context cannot be found fails the patch rather than guessing.
- **It is a Freeform tool** (`ToolSpec::Freeform`, `format.type = "grammar"`, `syntax = "lark"`): the
  model emits raw patch text, so multi-line edits never pay JSON escaping.

## 3. Shell — "unified exec"

One tool pair covers three things other harnesses split: run a command, run it in the background,
and attach a PTY and keep talking to it. A call that has not finished by `yield_time_ms` returns a
`session_id` instead of blocking; `write_stdin` drives it afterwards. Truncation reports
`original_token_count`, so the model knows how much it did not see.

## 4. Sandbox and permissions

- Modes: `read-only`, `workspace-write` (the default: writes and exec inside the workspace and
  `/tmp`; `.git`, `.agents`, `.codex` stay read-only even here; network off by default, with an
  optional domain allowlist where **deny always wins**), `danger-full-access` (`--yolo`).
- Implementation per OS: **macOS** Seatbelt (`.sbpl` policies); **Linux** bubblewrap + seccomp plus a
  separate Landlock path; **Windows** a genuinely first-class native sandbox (ACLs, deny-read-path
  resolver, AppContainer, Windows Filtering Platform for network, elevated helper, ConPTY).
- Approval policies: `on-request`, `never`, and a **`granular`** mode that keeps some prompt
  categories interactive while auto-rejecting others.
- **Per-call escalation with a reusable `prefix_rule`** (e.g. `["git","pull"]`) — one approval can
  cover a command prefix from then on.
- **Exec policy as code**: Starlark `.rules` files with `prefix_rule(pattern, decision,
  justification)` and `forbidden > prompt > allow` precedence, layered admin/user/project, and Codex
  may *propose* new rules from observed escalations.
- **Auto-review ("approve-for-me")**: boundary-crossing approvals can be routed to a **second Codex
  agent acting as reviewer** instead of a human — it sees a compact transcript and the exact request
  (not the requester's hidden reasoning) and checks for exfiltration, credential probing, security
  weakening and irreversible actions. The docs state plainly it is "not a deterministic security
  guarantee."
- **Hooks**: a full lifecycle system (`codex-rs/hooks`) with 12 named events — `PreToolUse`,
  `PermissionRequest`, `PostToolUse`, `PreCompact`, `PostCompact`, `SessionStart`, `SessionEnd`,
  `Stop`, `UserPromptSubmit`, `Interrupt` (+2) — plus MCP-backed hook handlers, and **per-hook trust
  hashes** (`hooks.state.<key>.trusted_hash`) set through an interactive review flow.

## 5. Subagents

A full multi-agent system with two protocol generations live side by side: `spawn_agent`,
`send_input`/`send_message`, `wait`/`wait_for_agent`, `close_agent`/`interrupt_agent`,
`resume_agent`, `list_agents`, `followup_task`. `spawn_agent` takes `agent_type` (override, or
inherit the parent with a full history fork), `model`/`reasoning_effort` overrides (inheriting the
parent's model by default) and a `task_name`. There is a **recursion guard**
(`exceeds_thread_spawn_depth_limit`) and a dedicated `agent-roles` crate. `codex review` is a
specialised read-only reviewer mode that never touches the working tree.

## 6. Plan/TODO

`update_plan` is a real model-facing tool, not prompt convention: `{explanation?, plan: [{step,
status: pending|in_progress|completed}]}`, **at most one step `in_progress`**, and it is explicitly
**refused inside Plan mode** ("update_plan is a TODO/checklist tool and is not allowed in Plan
mode"). It emits an event; no persistence beyond the turn was found.

## 7. MCP

Client (`codex mcp add|list|login`, stdio and streamable-HTTP servers, per-server `enabled_tools` /
`disabled_tools`, timeouts) and server (`codex mcp-server` runs Codex itself as an MCP server).
**Namespacing is `mcp__<server>__<tool>`** (`MCP_TOOL_NAME_DELIMITER = "__"`) — the same convention
Claude Code uses, which is what makes agentistics' `mcpServers` capability readable for both.
Plugin-bundled server descriptions are truncated to 1000 bytes before reaching the model.

## 8. Background, daemon and cloud

`codex exec` (non-interactive, JSONL, resumable); `codex queue --thread`; an experimental
**app-server daemon** (pidfile-backed, JSON-RPC, other clients attach — including a second CLI
invocation, desktop or mobile); and Codex Cloud, which runs a task in an OpenAI-hosted container and
returns a diff, with `codex apply <task_id>` bringing it back to a local checkout as a literal
`git apply`.

## 9. Git and recovery — two deliberately git-independent mechanisms

- Git itself is **not** a first-class tool; operations go through `exec_command`.
- A `worktree` crate manages `ManagedWorktree` records (root, cwd, source root/cwd, head sha,
  branch) with a retention count — each thread or cloud task can get its own isolated checkout.
- `/rewind` restores an earlier point (code + conversation, or either alone) and **never touches
  git**: it records only what `apply_patch` actually wrote, post-approval, under
  `CODEX_HOME/file-history`, with ~30-day cleanup. *(Secondary-sourced from issue/discussion
  threads, not read in the implementing module — UNVERIFIED.)*

---

## What Agentistics should take from this

1. **A patch format with no line numbers plus tiered fuzzy matching** is simpler to reason about
   than unified diff and tolerates drift; rename as a first-class hunk kind is worth copying.
2. **Emitting the patch as grammar-constrained freeform text rather than JSON** removes a whole
   class of escaping failure from multi-line edits.
3. **Unified exec** — one tool pair for foreground, background and PTY — against three tools.
4. **`tool_search`**: discover tools on demand so the catalogue can grow without taxing every turn.
5. **`prefix_rule` escalation and policy-as-code**: an approval that generalises, with
   forbidden > prompt > allow precedence and layered scopes.
6. **A reviewer agent for approvals**, stated honestly as a fatigue reducer and not a guarantee.
7. **Recovery that does not depend on git** (record what the editor wrote), beside worktree
   isolation that does.
8. **Per-hook trust hashes** — a stronger trust model than "run this shell hook".

## Not verified in this pass

- Live `codex --help` wording and values (read source and docs, not a binary).
- `/rewind` internals (secondary source).
- Whether `agent-roles` / `agent-identity` / `agent-graph-store` add delegation semantics beyond §5.
