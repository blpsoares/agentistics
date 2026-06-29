# Read-only HarnessChat Browser — Implementation Report

## What was created / removed

### Created
- `packages/web/src/components/HarnessChat.tsx` — read-only transcript browser for all harnesses

### Modified
- `packages/web/src/components/TtyChat.tsx`:
  - Replaced `ClaudeChat` import with `HarnessChat`
  - Removed `ClaudeChatMessage` import; inlined the type in props
  - Added `pendingHarnessSessionId` state for harness deep-links
  - Simplified claude open-chat handler (no pre-fetch)
  - Simplified non-claude open-chat handler (sets pending session ID, switches tab)
  - Replaced `<ClaudeChat ...>` with `<HarnessChat harness="claude" ...>`
  - Replaced ad-hoc viewer div with `<HarnessChat harness={activeTab} ...>`

## Per-harness data flow

### Claude
- Projects: `GET /api/projects-list` → `{name, path, encodedDir, sessionCount}[]`
- Sessions: `GET /api/claude-sessions?encodedDir=<encodedDir>` → `{id, title, createdAt, messageCount, model}[]`
- Transcript: `GET /api/claude-sessions/:id?encodedDir=<encodedDir>` → `TranscriptMessage[]`

### Codex / Gemini / Copilot
- All sessions: `GET /api/<harness>-sessions` → `{id, title, project, startTime, messageCount}[]`
- Projects: derived by grouping sessions by `session.project`
- Transcript: `GET /api/<harness>-sessions/:id` (id URL-encoded, may contain `/`)

## Deep-link behavior

When `initialSessionId` is provided to `HarnessChat`:
- **claude + initialProject**: fetches transcript directly, skips project picker and session list
- **non-claude**: fetches transcript directly via `/api/<harness>-sessions/:id`
- In both cases, `view` is set to `'transcript'` on mount

When `initialProject` only (no sessionId):
- Sets selectedProject and jumps to session list view

`TtyChat.tsx` passes `pendingHarnessSessionId` as `initialSessionId` for non-claude harnesses when deep-linking from `agentistics:open-chat` events.

## Three views

1. **Project picker** (`view='projects'`): searchable list of projects with session counts
2. **Session list** (`view='sessions'`): sessions for selected project with date and message count
3. **Transcript** (`view='transcript'`): read-only message bubbles with ReactMarkdown rendering, collapsible tools section

## tsc / test / build results

- `bun tsc --noEmit`: no errors
- `bun test`: 128 pass, 0 fail
- `bun run build`: success (✓ built in 1.47s)

## Commit hashes

- `0aabff2` — feat(web): read-only HarnessChat browser for all harnesses
- `74e2947` — refactor(web): remove interactive Claude floating window from App

## Concerns

- `messages`, `historyLoading`, `sessionId` state in TtyChat remain (used by nay tab); they are now unused for other harnesses but removing them would require a larger refactor
- `ClaudeChat.tsx` remains in the codebase but is no longer imported by anything (TtyChat and App.tsx have been cleaned). It can be safely deleted in a follow-up, or kept if the file's markdown/chat helpers are useful as reference
- The claude tab in TtyChat still shows an "ExternalLink / Detach" button for claude (at TtyChat.tsx line ~1607), which calls `onDetachClaude?.()` — since App.tsx no longer passes that prop it is a silent no-op. The button could be removed in a follow-up cosmetic cleanup
- `HARNESS_COLORS` and `HARNESS_LABELS` in TtyChat are still used in the tab bar and header, so no unused-import issue
