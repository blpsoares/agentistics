# /update-docs

Update all documentation in this project to reflect the current state of the codebase.

## What to do

1. Read every markdown file listed below
2. Read the actual source files they reference to verify what's still true
3. Rewrite only what's outdated — preserve accurate content and existing structure
4. Run `bun tsc --noEmit` at the end to confirm nothing broke

## Files to update (in priority order)

| File | Covers |
|---|---|
| `CLAUDE.md` | Developer instructions for AI assistants — most critical |
| `README.md` | Project overview, features, install steps |
| `docs/architecture.md` | System architecture and data flow |
| `docs/data-sources.md` | Data sources and processing logic |
| `docs/metrics.md` | Metrics tracked and how they're calculated |
| `docs/mcp.md` | MCP server tools and usage |
| `docs/nay.md` | Nay agent documentation |
| `docs/opentelemetry.md` | OpenTelemetry export |
| `packages/mcp/README.md` | MCP package standalone readme |

## Key things to check

- **Monorepo structure**: does the doc list all packages (`core`, `server`, `web`, `mcp`, `desktop`)?
- **Calculation functions**: are `calcCost`, `getModelPrice`, `MODEL_PRICING` correctly attributed to `@agentistics/core`?
- **`files_modified`**: is it documented that this now counts Edit/Write/MultiEdit tool calls (not just git)?
- **`git.ts` workspace fallback**: documented that non-git project dirs scan subdirs?
- **PWA**: mentioned in features/architecture?
- **Settings modal**: unified tabbed modal (Preferences / Live / Install / Environment)?
- **Chat sounds**: `chatSounds.ts` with 5 synthesized tones?
- **MCP tools**: all 11 tools listed and accurately described?

## Rules

- CLAUDE.md must be kept precise — it's read by AI assistants on every session
- Don't add content that isn't true yet (e.g. desktop app is in-progress, not shipped)
- Don't change tone or add emojis
- When in doubt about whether something changed, read the source file
