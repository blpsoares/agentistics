import { join } from 'path'
import { loadEnvConfig } from './env-config'

loadEnvConfig()

export const HOME_DIR = process.env.HOME ?? process.env.USERPROFILE ?? ''
export const CLAUDE_DIR = process.env.CLAUDE_DIR ?? join(HOME_DIR, '.claude')
export const PROJECTS_DIR = join(CLAUDE_DIR, 'projects')
export const SESSION_META_DIR = join(CLAUDE_DIR, 'usage-data', 'session-meta')
export const STATS_CACHE_FILE = join(CLAUDE_DIR, 'stats-cache.json')
export const PORT = parseInt(process.env.PORT ?? '47291', 10)

// ---------------------------------------------------------------------------
// Archive mirror — Claude Code silently deletes session transcripts older than
// `cleanupPeriodDays` (default 30) on every startup. We mirror the raw source
// files into AGENTISTICS_ARCHIVE_DIR so the full lifecycle is never lost.
// Reads union live + archive (live always wins); set AGENTISTICS_ARCHIVE=0 to disable.
// ---------------------------------------------------------------------------
export const ARCHIVE_ENABLED = process.env.AGENTISTICS_ARCHIVE !== '0'
export const ARCHIVE_DIR = process.env.AGENTISTICS_ARCHIVE_DIR ?? join(HOME_DIR, '.agentistics', 'archive')
export const ARCHIVE_PROJECTS_DIR = join(ARCHIVE_DIR, 'projects')
export const ARCHIVE_SESSION_META_DIR = join(ARCHIVE_DIR, 'usage-data', 'session-meta')
export const ARCHIVE_STATS_DIR = join(ARCHIVE_DIR, 'stats-cache')
// Consolidated per-session metrics (mode 'consolidate'): ~/.agentistics/sessions/<id>.json
export const CONSOLIDATED_DIR = join(HOME_DIR, '.agentistics', 'sessions')

// ---------------------------------------------------------------------------
// Other harnesses (Phase 1: Codex). Each adapter checks its own root.
// Override with CODEX_DIR; disable with AGENTISTICS_HARNESS_CODEX=0.
// ---------------------------------------------------------------------------
export const CODEX_DIR = process.env.CODEX_DIR ?? join(HOME_DIR, '.codex')
export const CODEX_SESSIONS_DIR = join(CODEX_DIR, 'sessions')

// ---------------------------------------------------------------------------
// Gemini CLI harness. Override with GEMINI_DIR; disable with AGENTISTICS_HARNESS_GEMINI=0.
// ---------------------------------------------------------------------------
export const GEMINI_DIR = process.env.GEMINI_DIR ?? join(HOME_DIR, '.gemini')

// ---------------------------------------------------------------------------
// GitHub Copilot CLI harness. Override with COPILOT_DIR; disable with
// AGENTISTICS_HARNESS_COPILOT=0.
// ---------------------------------------------------------------------------
export const COPILOT_DIR = process.env.COPILOT_DIR ?? join(HOME_DIR, '.copilot')
