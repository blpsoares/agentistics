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

export type HarnessId = 'claude' | 'codex' | 'gemini' | 'copilot'

export interface HarnessCapabilities {
  tokens: boolean
  cost: boolean
  model: boolean
  tools: boolean
  agents: boolean
  gitLines: boolean
}

/** Single source of truth for which metrics each harness can produce.
 *  Drives "N/A vs real 0" rendering and what the unified view aggregates. */
export const HARNESS_CAPABILITIES: Record<HarnessId, HarnessCapabilities> = {
  claude:  { tokens: true,  cost: true,  model: true,  tools: true,  agents: true,  gitLines: true },
  codex:   { tokens: true,  cost: true,  model: true,  tools: true,  agents: false, gitLines: false },
  gemini:  { tokens: true,  cost: true,  model: true,  tools: true,  agents: false, gitLines: false },
  copilot: { tokens: true,  cost: true,  model: true,  tools: false, agents: false, gitLines: true },
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
  harness: HarnessId
  /** Owning user in team mode. Undefined for local/Solo sessions. */
  user?: string
  _source?: 'meta' | 'jsonl' | 'subdir'
  agentMetrics?: SessionAgentMetrics
  /** Number of MCP tool calls recorded in this session (Copilot adapter). */
  mcp_tool_call_count?: number
  /** Unique MCP tool names called in this session (Copilot adapter). */
  mcp_tool_names?: string[]
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
  /** Team/central only: display names of the members who own sessions in this project.
   *  Lets the frontend scope the project filter to the selected members deterministically,
   *  instead of re-matching paths against user-filtered sessions. Absent/empty on solo. */
  users?: string[]
}

export interface HealthIssue {
  id: string
  severity: 'error' | 'warning' | 'info'
  title: string
  description: string
  guide?: string
  auto_fixed?: boolean
}

/** Team/central only: a member's live connection status, keyed by resolved display name. */
export interface MemberPresence {
  /** True when the member has a live reverse-channel socket OR a recent heartbeat push. */
  online: boolean
  /** ISO timestamp of the member's last contact (push/whoami), or null if never seen. */
  lastSeenAt: string | null
  /** Round-trip latency in ms from the last WebSocket ping/pong, or null when no live socket. */
  latencyMs: number | null
}

export interface AppData {
  statsCache: StatsCache
  sessions: SessionMeta[]
  projects: Project[]
  allSessions: SessionIndex[]
  healthIssues?: HealthIssue[]
  homeDir?: string
  harnesses: HarnessId[]
  /** Team/central only: each member's own raw statsCache, keyed by resolved display name.
   *  Lets the central reproduce the member's authoritative totals (deep Claude history that
   *  only exists aggregated in statsCache, never as individual sessions). Absent on solo. */
  userStatsCaches?: Record<string, StatsCache>
  /** Team/central only: live presence per member (resolved display name → status). */
  presence?: Record<string, MemberPresence>
  /** Team/central only: central policy — whether offline members' data is shown by default. */
  includeOfflineData?: boolean
}

/** An empty statsCache with all zero/neutral fields. Pure. */
export function emptyStatsCache(): StatsCache {
  return {
    version: 1,
    lastComputedDate: '',
    dailyActivity: [],
    dailyModelTokens: [],
    modelUsage: {},
    totalSessions: 0,
    totalMessages: 0,
    longestSession: { sessionId: '', duration: 0, messageCount: 0, timestamp: '' },
    firstSessionDate: '',
    hourCounts: {},
    totalSpeculationTimeSavedMs: 0,
  }
}

/**
 * Merge (sum) several statsCaches into one. Pure. Used by the central to combine the
 * selected members' per-member statsCaches so KPIs match each machine exactly.
 * - dailyActivity / dailyModelTokens / modelUsage / hourCounts: summed by key
 * - totals: summed; longestSession: max by duration
 * - firstSessionDate: earliest non-empty; lastComputedDate: latest
 */
export function mergeStatsCaches(caches: StatsCache[]): StatsCache {
  const out = emptyStatsCache()
  const daily = new Map<string, DailyActivity>()
  const dmt = new Map<string, Record<string, number>>()

  for (const c of caches) {
    if (!c) continue
    for (const d of c.dailyActivity ?? []) {
      const cur = daily.get(d.date) ?? { date: d.date, messageCount: 0, sessionCount: 0, toolCallCount: 0 }
      cur.messageCount += d.messageCount ?? 0
      cur.sessionCount += d.sessionCount ?? 0
      cur.toolCallCount += d.toolCallCount ?? 0
      daily.set(d.date, cur)
    }
    for (const d of c.dailyModelTokens ?? []) {
      const cur = dmt.get(d.date) ?? {}
      for (const [m, t] of Object.entries(d.tokensByModel ?? {})) cur[m] = (cur[m] ?? 0) + t
      dmt.set(d.date, cur)
    }
    for (const [m, u] of Object.entries(c.modelUsage ?? {})) {
      const cur = out.modelUsage[m] ?? { inputTokens: 0, outputTokens: 0, cacheReadInputTokens: 0, cacheCreationInputTokens: 0, webSearchRequests: 0, costUSD: 0 }
      cur.inputTokens += u.inputTokens ?? 0
      cur.outputTokens += u.outputTokens ?? 0
      cur.cacheReadInputTokens += u.cacheReadInputTokens ?? 0
      cur.cacheCreationInputTokens += u.cacheCreationInputTokens ?? 0
      cur.webSearchRequests += u.webSearchRequests ?? 0
      cur.costUSD += u.costUSD ?? 0
      out.modelUsage[m] = cur
    }
    for (const [h, n] of Object.entries(c.hourCounts ?? {})) out.hourCounts[h] = (out.hourCounts[h] ?? 0) + n
    out.totalSessions += c.totalSessions ?? 0
    out.totalMessages += c.totalMessages ?? 0
    out.totalSpeculationTimeSavedMs += c.totalSpeculationTimeSavedMs ?? 0
    if ((c.longestSession?.duration ?? 0) > out.longestSession.duration) out.longestSession = c.longestSession
    if (c.firstSessionDate && (!out.firstSessionDate || c.firstSessionDate < out.firstSessionDate)) out.firstSessionDate = c.firstSessionDate
    if (c.lastComputedDate && c.lastComputedDate > out.lastComputedDate) out.lastComputedDate = c.lastComputedDate
    out.version = Math.max(out.version, c.version ?? 1)
  }

  out.dailyActivity = Array.from(daily.values()).sort((a, b) => a.date.localeCompare(b.date))
  out.dailyModelTokens = Array.from(dmt.entries()).map(([date, tokensByModel]) => ({ date, tokensByModel })).sort((a, b) => a.date.localeCompare(b.date))
  return out
}

export type DateRange = '7d' | '30d' | '90d' | 'all'

export interface Filters {
  dateRange: DateRange
  customStart: string
  customEnd: string
  projects: string[]   // empty = all projects
  users?: string[]     // empty/undefined = all users
  models: string[]     // empty = all models
  harness?: HarnessId
  harnesses?: HarnessId[]  // multi-select harness filter; empty/undefined = all harnesses
  presence?: 'online' | 'offline'  // team/central: filter members by live status; undefined = policy default
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
  // Google (Gemini CLI) — verified from ai.google.dev/gemini-api/docs/pricing, 2026-06-22.
  // Gemini has no separate cache-write charge; cacheWrite is set to the input rate
  // and is unused in practice.
  'gemini-3.5-flash':       { input: 1.5, output: 9,   cacheRead: 0.15, cacheWrite: 1.5  },
  'gemini-3.1-pro':         { input: 2,   output: 12,  cacheRead: 0.20, cacheWrite: 2    },
  'gemini-3-flash-preview': { input: 0.5, output: 3,   cacheRead: 0.05, cacheWrite: 0.5  },
  'gemini-3-flash':         { input: 0.5, output: 3,   cacheRead: 0.05, cacheWrite: 0.5  },
  'gemini-2.5-flash':       { input: 0.3, output: 2.5, cacheRead: 0.03, cacheWrite: 0.3  },
  // OpenAI (Codex CLI) — verified from OpenAI API pricing page, 2026-06-20.
  // OpenAI has no separate cache-write charge; cacheWrite is set to the input rate
  // and is unused in practice (the Codex parser always sets cache_creation tokens to 0).
  'gpt-5.5':        { input: 5,    output: 30, cacheRead: 0.50,  cacheWrite: 5    },
  'gpt-5.4-mini':   { input: 0.75, output: 4.5, cacheRead: 0.075, cacheWrite: 0.75 },
  'gpt-5.4':        { input: 2.5,  output: 15, cacheRead: 0.25,  cacheWrite: 2.5  },
  'gpt-5-mini':     { input: 0.25, output: 2,  cacheRead: 0.025, cacheWrite: 0.25 },
  'gpt-5':          { input: 1.25, output: 10, cacheRead: 0.125, cacheWrite: 1.25 },
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
    'gpt-5.5': 'GPT-5.5',
    'gpt-5.4': 'GPT-5.4',
    'gpt-5.4-mini': 'GPT-5.4 mini',
    'gpt-5': 'GPT-5',
    'gpt-5-mini': 'GPT-5 mini',
    'gemini-3.5-flash': 'Gemini 3.5 Flash',
    'gemini-3.1-pro': 'Gemini 3.1 Pro',
    'gemini-3-flash-preview': 'Gemini 3 Flash',
    'gemini-3-flash': 'Gemini 3 Flash',
    'gemini-2.5-flash': 'Gemini 2.5 Flash',
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
  if (modelId.startsWith('gpt-')) return '#10a37f' // OpenAI green
  if (modelId.startsWith('gemini')) return '#4285f4' // Google blue
  return '#8b5cf6'
}
