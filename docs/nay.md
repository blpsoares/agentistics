# Nay — AI Chat Assistant

Nay is an AI chat assistant built into the agentistics dashboard. It connects directly to your usage data via MCP tools and can answer questions about your spending, projects, sessions, and layouts without you having to leave the dashboard.

## How it works

Nay runs as a floating chat panel (bottom-right corner of any page). When you send a message, the dashboard calls Claude Code CLI (`claude --print`) in a sandboxed workspace at `~/.agentistics/nay-chat/`. Claude has access to 12 MCP tools that talk directly to the agentistics API, so every answer is backed by your real data.

```
Your message
  → /api/chat-tty (POST)
    → claude --print --output-format stream-json
      → agentistics MCP tools → /api/data, /api/rates, etc.
    → streamed JSON events (text chunks + tool calls)
  → rendered in the chat panel
```

## Requirements

- **Claude Code CLI** installed and authenticated (`claude --version`)
- **agentistics server running** — Nay calls MCP tools that talk to the local API
- **Claude subscription** — Nay uses your Claude Code session quota (see [usage warning](#subscription-and-quota-usage) below)

## Subscription and quota usage

> **Important:** Every Nay conversation counts against your Claude Code subscription usage.
>
> Nay runs `claude --print` under the hood, which is the same Claude Code process used for coding. Each message sends your conversation history + tool results to the API, and this is billed/counted exactly like a regular Claude Code session.
>
> - **Claude Max / Pro subscribers**: usage comes out of your monthly session quota
> - **API key users**: each message is billed at standard Claude API rates for the selected model
>
> Prefer **Haiku 4.5** for quick data queries (cheapest). Use **Sonnet 4.6** for analysis and layout building. **Opus 4.7** for complex multi-step reasoning.

## Model selection

The first time you open Nay, a model picker screen appears. You can change the model at any time by starting a new conversation (clear chat → model picker reappears).

| Model | Speed | Best for | Input / Output |
|-------|-------|----------|----------------|
| Haiku 4.5 | Fastest | Quick data lookups | $0.80 / $4.00 per 1M |
| Sonnet 4.6 | Balanced | Analysis, layout building | $3.00 / $15.00 per 1M |
| Opus 4.7 | Most capable | Complex reasoning | $15.00 / $75.00 per 1M |

## What Nay can answer

| Question | What it calls |
|----------|--------------|
| "How much did I spend this month?" | `agentistics_summary`, `agentistics_costs` |
| "Which project cost the most?" | `agentistics_projects` |
| "What were my most expensive sessions?" | `agentistics_sessions` |
| "Build me a cost overview layout" | `agentistics_component_catalog`, `agentistics_build_layout` |
| "Show me my cache hit rate" | `agentistics_summary` |

## Navigation buttons

Nay always ends data responses with an orange action button that links to the relevant dashboard page. If the response is about a specific project, the link includes a `?projects=...` filter parameter so the dashboard automatically applies the filter when you click.

Examples:
- `→ Ver custos` → `/costs`
- `→ Ver projetos` → `/projects?projects=/home/user/my-project`

## Terminal commands

You can also run shell commands directly from Nay:

```
/run ls -la ~/.claude/
/bash git log --oneline -5
/sh df -h
```

Code blocks in Nay responses with bash/shell language tags include a **Run** button to execute the command inline.

## Workspace setup

On every server start, `ensureNayChat()` writes two files to `~/.agentistics/nay-chat/`:

| File | Purpose |
|------|---------|
| `CLAUDE.md` | Instructions for Nay: tool call protocol, response format, navigation buttons, behavior rules |
| `.claude/settings.json` | MCP server registration + permissions (allows all 12 agentistics tools without prompting) |

It also registers the agentistics MCP at user scope via `claude mcp add -s user` so that `claude --print` mode can find the tools. This registration is idempotent — it skips if the URL is already correct.

## Behavior rules (enforced via CLAUDE.md)

1. **Never answer from memory** — calls tools for every question, even follow-ups
2. **Never describe what it's about to do** — calls tools immediately, no "Let me check..."
3. **Never reference "the Nay agent"** — it has direct tool access, uses it
4. **Always includes a navigation button** — every data response ends with at least one `[→ Label](/route)` link

## See also

- [MCP tools reference](./mcp.md) — full list of tools Nay uses
- [Architecture](./architecture.md) — how `chat-tty.ts` streams Claude output
