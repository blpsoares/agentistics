# Claude Code transcript measurements — for native-harness design

**Date:** 2026-09-20
**Method:** read-only shell aggregation (`jq`/`awk`/`grep`/`sort`) over the sample below. No transcript
was ever loaded into the analyzing agent's context; every command's output is already a count,
histogram or percentile. No prompt text, file contents, paths, or verbatim conversation appears
below — only counts and classified categories.

## Sample

The 15 largest `.jsonl` transcripts (by file size) modified in the last 30 days under
`~/.claude/projects/**/*.jsonl`, excluding files under any `subagents/` directory (those are
subagent transcripts, analyzed separately in §6).

```
\find ~/.claude/projects -name "*.jsonl" -mtime -30 -printf '%s %p\n' \
  | grep -v '/subagents/' | sort -rn | head -15
```
(15 rows captured to a scratch file; paths omitted here.)

**Caveat on representativeness:** sampling by size means this is intentionally the *heaviest tail*
of real usage (long-running, multi-day, high-tool-count sessions), not a random/typical session.
For a native harness meant to sustain serious work, this tail is arguably the more informative
population — but session-length and turn-count numbers should not be read as "the median Claude
Code session."

## 1. Transcript sizes and line counts (n=15)

```
awk '{s+=$1} END{print s}' top15.txt                       # total bytes
sort -n <(awk '{print $1}' top15.txt) | awk '{a[NR]=$1} END{print a[int((NR+1)/2)]}'  # median
while IFS= read -r f; do wc -l < "$f"; done < files.txt     # lines per file
```

| metric | value |
|---|---|
| files | 15 |
| total size | 387,200,189 bytes (~387 MB) |
| median size | 22,879,769 bytes (~21.8 MB) |
| max size | 71,425,069 bytes (~68 MB) |
| total lines | 104,752 |
| median lines | 6,515 |
| max lines | 23,291 |

## 2. `tool_use` names — top 30 by count and share of all tool calls

```
jq -r 'select(.type=="assistant") | .message.content[]? | select(.type=="tool_use") | .name' "$f" \
  >> tool_names.txt   # (looped over all 15 files)
sort tool_names.txt | uniq -c | sort -rn
```

Total tool calls: **16,197**. Distinct tool names: **64**.

| count | share | tool |
|---|---|---|
| 12,397 | 76.54% | Bash |
| 977 | 6.03% | Read |
| 454 | 2.80% | Edit |
| 267 | 1.65% | mcp\_\_playwright\_\_browser_evaluate |
| 213 | 1.32% | mcp\_\_agentistics\_\_agentistics_task_subtask |
| 192 | 1.19% | mcp\_\_playwright\_\_browser_click |
| 156 | 0.96% | mcp\_\_playwright\_\_browser_take_screenshot |
| 155 | 0.96% | Agent |
| 133 | 0.82% | Write |
| 102 | 0.63% | mcp\_\_claude-in-chrome\_\_computer |
| 98 | 0.61% | mcp\_\_playwright\_\_browser_navigate |
| 88 | 0.54% | ToolSearch |
| 88 | 0.54% | SendMessage |
| 86 | 0.53% | mcp\_\_claude-in-chrome\_\_browser_batch |
| 80 | 0.49% | mcp\_\_agentistics\_\_agentistics_task_session |
| 75 | 0.46% | mcp\_\_playwright\_\_browser_snapshot |
| 64 | 0.40% | ScheduleWakeup |
| 58 | 0.36% | mcp\_\_agentistics\_\_agentistics_task |
| 46 | 0.28% | mcp\_\_playwright\_\_browser_resize |
| 45 | 0.28% | AskUserQuestion |
| 43 | 0.27% | mcp\_\_agentistics\_\_agentistics_task_comment |
| 41 | 0.25% | ListAgents |
| 36 | 0.22% | mcp\_\_playwright\_\_browser_press_key |
| 35 | 0.22% | mcp\_\_claude-in-chrome\_\_javascript_tool |
| 26 | 0.16% | mcp\_\_claude-in-chrome\_\_navigate |
| 26 | 0.16% | SendUserFile |
| 21 | 0.13% | Skill |
| 18 | 0.11% | mcp\_\_playwright\_\_browser_type |
| 18 | 0.11% | mcp\_\_playwright\_\_browser_console_messages |
| 17 | 0.10% | mcp\_\_claude-in-chrome\_\_tabs_context_mcp |
| (34 more, each <0.1%) | | |

Bash alone is over three-quarters of all tool calls; the next 63 tool names split the remaining ~23%.

## 3. Edits: Edit vs Write vs MultiEdit, and per-session distribution

```
grep -wE 'Edit|Write|MultiEdit' tool_counts.txt
```

| tool | count | share of edit-type calls |
|---|---|---|
| Edit | 454 | 77.3% |
| Write | 133 | 22.7% |
| MultiEdit | 0 | 0.0% |

**MultiEdit was never called once** across 16,197 tool calls / 15 heavy sessions.

Per-session count of (Edit+Write+MultiEdit) calls, n=15:
`39, 8, 116, 2, 12, 30, 28, 9, 4, 0, 89, 22, 145, 81, 2`

| stat | value |
|---|---|
| median | 22 |
| mean | 39.1 |
| min | 0 |
| max | 145 |

## 4. Shell (Bash) command shape (n=12,397 Bash calls)

Commands were extracted with `jq -c '... | .input.command'` (JSON-encoded, one call per line —
critical: `jq -r` on multi-line heredoc commands splits one call across many lines and silently
corrupts every downstream count). Patterns were grep-counted against this file; the raw commands
were never printed or read by the analyzing agent.

```
grep -cE '&&|;' bash_commands_json.txt                     # chains
grep -cE '^"cd ' bash_commands_json.txt                     # starts with cd
grep -ciE 'npm (run )?(build|install|test|watch)|bun ...' bash_commands_json.txt  # long-running-ish
grep -c '|' bash_commands_json.txt                          # pipe
grep -cE '>|>>' bash_commands_json.txt                      # redirect
```

| pattern | count | share of Bash calls |
|---|---|---|
| chain (`&&` or `;`) | 6,904 | 55.69% |
| starts with `cd ` | 5,702 | 45.99% |
| pipe (`\|`) | 9,533 | 76.90% |
| redirect (`>` / `>>`) | 7,843 | 63.27% |
| long-running keyword (build/install/test/watch/docker/make) | 1,859 | 15.00% |

## 5. Turn shape — tool calls per assistant turn, and parallelism

**Correction found mid-measurement:** Claude Code writes one logical assistant turn as *multiple*
JSONL lines when the turn has several content blocks (text + tool_use, or several tool_use blocks),
all sharing the same `message.id` (this matches the usage-dedupe rule already documented in
CLAUDE.md for token counting). Naively counting tool_use per JSONL *line* found 28,771 "turns" with
never more than 1 tool call per line (max=1) — an artifact of the line-splitting, not the real turn
shape. Grouping by `message.id` instead gives 17,046 real turns.

```
jq -r 'select(.type=="assistant") | .message.id as $id
  | ([.message.content[]? | select(.type=="tool_use")] | length) as $n
  | "\($id)\t\($n)"' "$f" >> turn_tool_by_id.txt
awk -F'\t' '{s[$1]+=$2} END{for(k in s) print s[k]}' turn_tool_by_id.txt > tools_per_real_turn.txt
```

Distribution of tool calls per real turn (n=17,046 turns):

| tool calls in turn | count of turns |
|---|---|
| 0 | 1,223 |
| 1 | 15,559 |
| 2 | 216 |
| 3 | 30 |
| 4 | 7 |
| 5 | 3 |
| 6 | 2 |
| 7 | 1 |
| 8 | 1 |
| 9 | 1 |
| 10 | 2 |
| 17 | 1 |

| stat (tool-using turns only, n=15,823) | value |
|---|---|
| mean | 1.02 |
| median | 1 |
| p90 | 1 |
| max | 17 |

**Parallelism:** of 15,823 tool-using turns, 264 (**1.67%**) called more than one tool in the same
turn. Parallel tool calling is real but rare in this sample.

## 6. Subagents

```
grep -wE 'Task|Agent' tool_counts.txt
```

- `Task` tool: 0 occurrences (not used as a tool name in this sample — Claude Code names it `Agent`).
- `Agent` tool: **155** occurrences.
- `subagent_type` distribution (155 calls): `general-purpose` 149, `unknown` 4 (interrupted/no
  result before completion), `fork` 2.

Nested/background subagents (`subagents/*.jsonl` directory next to each sampled session, counted by
file, never read):

| session (size rank) | `Agent` tool_use calls | subagent transcript files on disk |
|---|---|---|
| 1 | 0 | 1 |
| 2 | 5 | 5 |
| 3 | 0 | 0 |
| 4 | 119 | 128 |
| 5 | 28 | 37 |
| 6–7 | 0 | 0 |
| 8 | 3 | 3 |
| 9–15 | 0 | 0 |

Total subagent transcript files across the sample: **174**, vs 155 top-level `Agent` tool_use calls
— every session with any subagents shows *more* transcript files than tracked `Agent` calls (one
even has 1 file with 0 tracked calls), consistent with the documented fact that background/forked
subagents and recovered-from-meta invocations are not all visible as a parent `Agent` tool_use.

## 7. Compaction

```
grep -n '"compact_boundary"' "$f" | head -1   # first occurrence line, per file
```

**11 of 15 sessions (73%)** contain at least one `compact_boundary`. First-occurrence position
(line number / % through the transcript) for those 11:

| first line | % through transcript |
|---|---|
| 2,762 | 34.8% |
| 2,804 | 57.9% |
| 2,853 | 31.2% |
| 2,985 | 12.8% |
| 3,305 | 38.7% |
| 3,404 | 96.2% |
| 3,458 | 41.5% |
| 3,644 | 48.1% |
| 3,680 | 56.5% |
| 4,330 | 67.8% |
| 5,510 | 66.0% |

Median first-compaction line ≈ **3,404**; median position ≈ **48%** through the transcript (highly
variable: 12.8%–96.2%).

## 8. Errors

```
jq -r '... | select(.type=="tool_result") | (.is_error // false)' >> tool_results_flags.txt
grep -c '^true$' tool_results_flags.txt
```

| metric | value |
|---|---|
| total tool_result entries | 16,190 |
| flagged `is_error: true` | 440 |
| error share | **2.72%** |

Cheap keyword classifier over the 440 error result bodies (counts of results *containing* each
keyword — categories overlap, bodies never printed):

| pattern | matching results | share of errors |
|---|---|---|
| "No such file" | 38 | 8.6% |
| "timeout" | 20 | 4.5% |
| "timed out" | 11 | 2.5% |
| "not found" | 11 | 2.5% |
| "cannot find" | 5 | 1.1% |
| "ENOENT" | 5 | 1.1% |
| "unable to" | 3 | 0.7% |
| "interrupted" | 1 | 0.2% |
| "permission denied" | 0 | 0% |
| "command not found" | 0 | 0% |

Union of all patterns matched only **83 of 440 (18.9%)** of error results — over 4 in 5 tool errors
are NOT explained by these generic OS/filesystem keywords (they are presumably tool-specific:
lint/type errors, test-assertion failures, git errors, MCP-specific error shapes, etc.).

## 9. Interruptions

```
grep -oE '\[Request interrupted by user[^"]*\]|"interrupted by the user"|user_interrupt' "$f" | wc -l
```

Per-session counts (n=15): `12, 0, 20, 8, 6, 1, 14, 7, 2, 12, 2, 2, 4, 0, 2`
**Total: 92** interrupt markers, present in **13 of 15 (87%)** sessions — roughly **0.57%** of all
16,197 tool calls were interrupted by the user.

## 10. Skills

```
grep -w 'Skill' tool_counts.txt
jq -r '... | select(.name=="Skill") | .input.skill' >> skill_names.txt
```

**21** `Skill` tool uses across the sample, **9** distinct skills invoked:

| count | skill |
|---|---|
| 5 | artifact-design |
| 3 | superpowers:brainstorming |
| 3 | code-review |
| 3 | claude-code-notifications:ccn |
| 2 | superpowers:writing-plans |
| 2 | agentop-parallel-sessions |
| 1 | superpowers:test-driven-development |
| 1 | superpowers:subagent-driven-development |
| 1 | security-review |

## 11. Session length

"Human user turn" = a `type:"user"` entry that is not `isMeta`, not `isCompactSummary`, carries no
`toolUseResult` (i.e. is not a tool-result envelope), and has genuine text content — the same
`isHumanUserEntry` rule this codebase's own parser applies.

```
jq -r 'select(.type=="user" and (.isMeta // false)==false and (.isCompactSummary // false)==false
  and (.toolUseResult == null) and ((.message.content|type)=="string"
  or ((.message.content|type)=="array" and ([.message.content[]? | select(.type=="text")]|length)>0)))
  | .uuid' "$f" | wc -l
```

Human user turns per session (n=15): `266, 95, 45, 272, 111, 37, 25, 108, 1, 48, 88, 2, 1, 1, 70`

| stat | value |
|---|---|
| median | 48 |
| p90 | 111 |
| max | 272 |
| min | 1 |
| mean | 78 |

Wall-clock span (first-to-last `timestamp` in the transcript, includes any multi-day idle/resume
gaps — this is *not* active time):

| stat | value |
|---|---|
| median | 29.4 hours |
| p90 | 219.7 hours (~9.2 days) |
| max | 233.7 hours (~9.7 days) |
| min | 1.05 hours |

Several of the largest sessions were evidently kept open and resumed across many days rather than
run in one sitting — consistent with this being an agentic-orchestration-heavy workflow (worktrees,
long-lived per-feature sessions).

---

## WHAT THIS IMPLIES FOR A NATIVE HARNESS

- **Bash is 76.5% of all tool calls** → the shell tool is not "one tool among many," it is the
  primary interface to the world; it must be fast, low-latency, and given first-class engineering
  attention (streaming output, robust timeout handling), not treated as a generic sandboxed-exec
  afterthought.
- **55.7% of Bash calls chain commands with `&&`/`;`** → a harness that only supports single argv
  execution (like some sandboxed tool-call APIs) will force the model to split chains into many
  round-trips; the shell tool must run through a real shell and give honest per-segment
  success/failure attribution (a chain's exit code hides which segment failed).
- **76.9% of Bash calls contain a pipe and 63.3% a redirect** → real shell semantics (pipes,
  redirection, subshells) are baseline expectations, not edge cases; an argv-array-only "exec" tool
  would break the large majority of real commands.
- **46.0% of Bash calls start with `cd `** → sessions constantly need to operate in a different
  directory than their default cwd. A native harness should offer an explicit per-call `cwd`
  parameter (as this codebase's own `resolveRepoFacts`/worktree conventions already push for)
  rather than relying on `cd && cmd` chaining, which is fragile and this repo's own CLAUDE.md
  explicitly warns against for compound `git` commands.
- **15.0% of Bash calls match build/install/test/watch/docker keywords** → a meaningful minority of
  shell calls are long-running; the harness needs async/background execution with output streaming
  and a timeout budget well above a "quick command" default, plus a way to poll/attach later.
- **MultiEdit was used 0 times out of 587 edit-type calls (Edit 77%, Write 23%)** → in this sample
  MultiEdit is dead weight; a native harness can likely ship a single `Edit` primitive (or an
  `Edit`+`Write`) rather than reproducing three overlapping file-editing tools.
- **Real turn-level parallelism is only 1.67%** (grouping by `message.id`, since Claude Code itself
  splits one logical turn across multiple JSONL lines) → optimize the common path for one tool call
  per turn; parallel tool dispatch must still be supported (max observed: 17 calls in one turn) but
  is the exception, not the rule — don't pay a coordination-overhead tax on every single-tool turn.
- **73% of sampled (heavy) sessions hit at least one compaction**, at a median of ~48% through the
  transcript (range 13%–96%) → compaction/context-window management is not a rare edge case for a
  harness meant to sustain real work; it needs a first-class, tested compaction strategy from day
  one, not a bolt-on triggered only in emergencies.
- **Tool error rate is low (2.7%) but only 18.9% of errors match generic OS/filesystem keywords**
  → a harness cannot rely on regex/keyword sniffing to classify tool failures; it needs each tool to
  report a structured error type/category itself (exit code, timeout-vs-crash-vs-not-found) rather
  than pushing text-classification onto the orchestrator.
- **User interruption is common** (87% of sampled sessions, ~0.57% of all tool calls) → cancel/
  interrupt must be a cheap, always-on, low-latency primitive available mid-tool-call, not a
  heavyweight or best-effort operation — users routinely cut off a running command or agent.
- **Subagent fan-out is lumpy and under-counted by the parent's own tool_use log** (one session
  showed 128 subagent transcripts against 119 tracked `Agent` calls) → a native harness's subagent
  accounting must be driven by an authoritative directory/registry of what actually ran, not solely
  by replaying the parent's own tool_use/tool_result pairs, which miss backgrounded/forked/
  interrupted invocations.
- **Skills are invoked sparingly** (21 times across 15 heavy sessions, 9 distinct names) → skill
  content should be loaded on-demand by description match, not preloaded into every session's
  context — consistent with how this product's own SessionStart hook is already designed.
- **Session wall-clock spans routinely exceed a single sitting** (median 29 hours, several sessions
  spanning 9+ days) with per-session human turns ranging 1–272 → a native harness needs durable,
  resumable session state (cwd, branch, env) that survives being reopened days later, not just an
  in-memory conversation loop.
