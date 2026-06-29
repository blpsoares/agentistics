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
// Team mode (Phase 1: folder union). When AGENTISTICS_TEAM=1 the server unions
// per-user consolidated SessionMeta JSONs from TEAM_DIR/<user>/sessions/*.json
// and tags each session with its owning user. Off by default (Solo behavior).
// ---------------------------------------------------------------------------
export const TEAM_MODE = process.env.AGENTISTICS_TEAM === '1'
export const TEAM_DIR = process.env.AGENTISTICS_TEAM_DIR ?? join(HOME_DIR, '.agentistics', 'team')

// ---------------------------------------------------------------------------
// Phase 2 — central aggregator. When AGENTISTICS_TEAM_CENTRAL=1 the instance
// sources team sessions from MongoDB (not the folder) and accepts pushed
// sessions on POST /api/team/ingest. MONGO_URL/MONGO_DB point at the store;
// TEAM_ORG namespaces docs; TEAM_INGEST_TOKEN (optional) gates ingestion.
// ---------------------------------------------------------------------------
export const TEAM_CENTRAL = process.env.AGENTISTICS_TEAM_CENTRAL === '1'
export const MONGO_URL = process.env.MONGO_URL ?? 'mongodb://localhost:27017'
export const MONGO_DB = process.env.MONGO_DB ?? 'agentistics'
export const TEAM_ORG = process.env.AGENTISTICS_TEAM_ORG ?? 'default'
export const TEAM_INGEST_TOKEN = process.env.AGENTISTICS_TEAM_INGEST_TOKEN || undefined

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
