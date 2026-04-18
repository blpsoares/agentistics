import { join } from 'path'

export const HOME_DIR = process.env.HOME ?? process.env.USERPROFILE ?? ''
export const CLAUDE_DIR = join(HOME_DIR, '.claude')
export const PROJECTS_DIR = join(CLAUDE_DIR, 'projects')
export const SESSION_META_DIR = join(CLAUDE_DIR, 'usage-data', 'session-meta')
export const STATS_CACHE_FILE = join(CLAUDE_DIR, 'stats-cache.json')
export const PORT = parseInt(process.env.PORT ?? '47291', 10)
