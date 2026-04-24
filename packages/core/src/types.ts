export interface DailyActivity {
  date: string
  messageCount: number
  sessionCount: number
  toolCallCount: number
}

export interface DailyModelTokens {
  date: string
  tokensByModel: Record<string, number>
}

export interface ModelUsage {
  inputTokens: number
  outputTokens: number
  cacheReadInputTokens: number
  cacheCreationInputTokens: number
  webSearchRequests: number
  costUSD: number
}

export interface LongestSession {
  sessionId: string
  duration: number
  messageCount: number
  timestamp: string
}

export interface StatsCache {
  version: number
  lastComputedDate: string
  dailyActivity: DailyActivity[]
  dailyModelTokens: DailyModelTokens[]
  modelUsage: Record<string, ModelUsage>
  totalSessions: number
  totalMessages: number
  longestSession: LongestSession
  firstSessionDate: string
  hourCounts: Record<string, number>
  totalSpeculationTimeSavedMs: number
}

export interface SessionMeta {
  session_id: string
  project_path: string
  start_time: string
  end_time?: string
  duration_minutes: number
  user_message_count: number
  assistant_message_count: number
  tool_counts: Record<string, number>
  tool_output_tokens: Record<string, number>
  agent_file_reads: Record<string, number>
  languages: string[]
  git_commits: number
  git_pushes: number
  input_tokens: number
  output_tokens: number
  /** Only populated for `_source: 'jsonl' | 'subdir'` — parsed directly from JSONL usage. */
  cache_read_input_tokens?: number
  cache_creation_input_tokens?: number
  first_prompt: string
  user_interruptions: number
  user_response_times: number[]
  tool_errors: number
  tool_error_categories: Record<string, number>
  uses_task_agent: boolean
  uses_mcp: boolean
  uses_web_search: boolean
  uses_web_fetch: boolean
  lines_added: number
  lines_removed: number
  files_modified: number
  message_hours: number[]
  user_message_timestamps: string[]
  model?: string
  _source?: 'meta' | 'jsonl' | 'subdir'
  agentMetrics?: SessionAgentMetrics
}

export interface AgentInvocation {
  toolUseId: string
  agentType: string
  description: string
  status: 'completed' | 'failed'
  totalTokens: number
  totalDurationMs: number
  totalToolUseCount: number
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  toolStats: {
    readCount: number
    searchCount: number
    bashCount: number
    editFileCount: number
    linesAdded: number
    linesRemoved: number
    otherToolCount: number
  }
  costUSD: number
}

export interface SessionAgentMetrics {
  invocations: AgentInvocation[]
  totalInvocations: number
  totalTokens: number
  totalDurationMs: number
  totalCostUSD: number
}

export interface PriceEntry {
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
}

export interface RatesCache {
  fetchedAt: number
  brlRate: number
  pricing: Record<string, PriceEntry>
  pricingSource: 'live' | 'fallback'
}

export interface SessionIndex {
  sessionId: string
  fullPath: string
  fileMtime: number
  firstPrompt: string
  summary: string
  messageCount: number
  created: string
  modified: string
  gitBranch: string
  projectPath: string
  isSidechain: boolean
}

export interface ProjectGitStats {
  commits: number
  lines_added: number
  lines_removed: number
  files_modified: number
  since: string
}

export interface Project {
  path: string
  name: string
  sessions: SessionIndex[]
  git_stats?: ProjectGitStats
}

export interface HealthIssue {
  id: string
  severity: 'error' | 'warning' | 'info'
  title: string
  description: string
  guide?: string
  auto_fixed?: boolean
}

export interface AppData {
  statsCache: StatsCache
  sessions: SessionMeta[]
  projects: Project[]
  allSessions: SessionIndex[]
  healthIssues?: HealthIssue[]
  homeDir?: string
}

export type DateRange = '7d' | '30d' | '90d' | 'all'

export interface Filters {
  dateRange: DateRange
  customStart: string
  customEnd: string
  projects: string[]   // empty = all projects
  models: string[]     // empty = all models
}

export type Lang = 'pt' | 'en'
export type Theme = 'dark' | 'light'

export const MODEL_PRICING: Record<string, { input: number; output: number; cacheRead: number; cacheWrite: number }> = {
  // Current models
  'claude-opus-4-7':            { input: 5,    output: 25,   cacheRead: 0.50, cacheWrite: 6.25  },
  'claude-opus-4-6':            { input: 5,    output: 25,   cacheRead: 0.50, cacheWrite: 6.25  },
  'claude-sonnet-4-6':          { input: 3,    output: 15,   cacheRead: 0.30, cacheWrite: 3.75  },
  'claude-haiku-4-5-20251001':  { input: 1,    output: 5,    cacheRead: 0.10, cacheWrite: 1.25  },
  // Legacy models
  'claude-opus-4-5-20251101':   { input: 5,    output: 25,   cacheRead: 0.50, cacheWrite: 6.25  },
  'claude-opus-4-1-20250805':   { input: 15,   output: 75,   cacheRead: 1.50, cacheWrite: 18.75 },
  'claude-opus-4-20250514':     { input: 15,   output: 75,   cacheRead: 1.50, cacheWrite: 18.75 },
  'claude-sonnet-4-5-20250929': { input: 3,    output: 15,   cacheRead: 0.30, cacheWrite: 3.75  },
  'claude-sonnet-4-20250514':   { input: 3,    output: 15,   cacheRead: 0.30, cacheWrite: 3.75  },
  'claude-haiku-3-5-20241022':  { input: 0.80, output: 4,    cacheRead: 0.08, cacheWrite: 1.00  },
  'claude-3-haiku-20240307':    { input: 0.25, output: 1.25, cacheRead: 0.03, cacheWrite: 0.30  },
}

export function getModelPrice(modelId: string) {
  if (MODEL_PRICING[modelId]) return MODEL_PRICING[modelId]
  for (const [key, price] of Object.entries(MODEL_PRICING)) {
    if (modelId.startsWith(key) || key.startsWith(modelId)) return price
  }
  return { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 }
}

export function calcCost(usage: ModelUsage, modelId: string): number {
  const price = getModelPrice(modelId)
  return (
    (usage.inputTokens / 1_000_000) * price.input +
    (usage.outputTokens / 1_000_000) * price.output +
    (usage.cacheReadInputTokens / 1_000_000) * price.cacheRead +
    (usage.cacheCreationInputTokens / 1_000_000) * price.cacheWrite
  )
}

export function formatModel(modelId: string): string {
  const map: Record<string, string> = {
    'claude-opus-4-7': 'Opus 4.7',
    'claude-opus-4-6': 'Opus 4.6',
    'claude-opus-4-5-20251101': 'Opus 4.5',
    'claude-sonnet-4-6': 'Sonnet 4.6',
    'claude-sonnet-4-5-20250929': 'Sonnet 4.5',
    'claude-haiku-4-5-20251001': 'Haiku 4.5',
  }
  return map[modelId] ?? modelId
}

let _homeDir = ''

export function setHomeDir(dir: string) {
  _homeDir = dir
}

export function formatProjectName(projectPath: string): string {
  if (!projectPath) return 'Unknown'
  const normalized = projectPath.replace(/\\/g, '/')
  if (_homeDir) {
    if (normalized === _homeDir) return '~ (home)'
    if (normalized.startsWith(_homeDir + '/')) return '~/' + normalized.slice(_homeDir.length + 1)
  }
  return normalized
}

export function getModelColor(modelId: string): string {
  if (modelId.includes('opus')) return '#D97706'
  if (modelId.includes('sonnet')) return '#6366f1'
  if (modelId.includes('haiku')) return '#10b981'
  return '#8b5cf6'
}
