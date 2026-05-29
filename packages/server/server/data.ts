import { join } from 'path'
import { readFile } from 'fs/promises'
import type { StatsCache, SessionMeta, ProjectGitStats, HealthIssue } from '@agentistics/core'
import { PROJECTS_DIR, SESSION_META_DIR, ARCHIVE_PROJECTS_DIR, ARCHIVE_SESSION_META_DIR, STATS_CACHE_FILE, ARCHIVE_STATS_DIR, ARCHIVE_ENABLED, HOME_DIR } from './config'
import { getArchiveMode } from './preferences'
import { writeConsolidated, loadConsolidated } from './consolidate'
import { createLimiter, safeReadDir, safeReadJson, safeStat } from './utils'
import { UUID_RE, decodeProjectDir, getProjectGitStats } from './git'
import { parseSessionJsonl } from './jsonl'
import { runHealthChecks, analyzeToolHealthIssues, analyzeCacheStaleness } from './health'
import { extractAgentMetricsFromFile } from './agent-metrics'

/** Extract the model ID from a JSONL file by reading only the first assistant message.
 *  Skips `<synthetic>` — Claude Code sentinel for system-generated turns, not a real model. */
async function extractModelFromJsonl(filePath: string): Promise<string | undefined> {
  try {
    const content = await readFile(filePath, 'utf-8')
    for (const raw of content.split('\n').slice(0, 200)) {
      const line = raw.trim()
      if (!line) continue
      try {
        const e = JSON.parse(line)
        const m = e.message?.model
        if (e.type === 'assistant' && typeof m === 'string' && m && m.startsWith('claude-')) {
          return m as string
        }
      } catch { /* skip */ }
    }
  } catch { /* skip */ }
  return undefined
}

/** Server-side project shape — sessions carry only the subset the API needs */
export interface ServerProject {
  path: string
  name: string
  sessions: { sessionId: string; created: string }[]
  git_stats?: ProjectGitStats
}

export interface ApiResponse {
  statsCache: StatsCache
  projects: ServerProject[]
  allSessions: []
  sessions: SessionMeta[]
  healthIssues: HealthIssue[]
  homeDir: string
}

export interface ScanResult {
  projects: ServerProject[]
  extraSessions: SessionMeta[]
}

export async function loadSessionMetas(roots: string[] = [SESSION_META_DIR]): Promise<Map<string, SessionMeta>> {
  const map = new Map<string, SessionMeta>()
  const limit = createLimiter(20)

  // Roots are in priority order (live first). A session already loaded from a
  // higher-priority root is never overwritten by the archive copy.
  for (const dir of roots) {
    const files = await safeReadDir(dir)
    await Promise.all(
      files
        .filter(f => f.endsWith('.json'))
        .map(f =>
          limit(async () => {
          const data = await safeReadJson<Record<string, unknown>>(join(dir, f))
          if (!data) return

          const sessionId = (data.session_id as string) ?? f.replace(/\.json$/, '')
          if (!sessionId) return
          if (map.has(sessionId)) return

          // Normalise languages: may arrive as Record<string,number> or string[]
          let languages: string[] = []
          if (Array.isArray(data.languages)) {
            languages = data.languages as string[]
          } else if (data.languages && typeof data.languages === 'object') {
            languages = Object.keys(data.languages as object)
          }

          const meta: SessionMeta = {
            session_id: sessionId,
            project_path: (data.project_path as string) ?? '',
            start_time: (data.start_time as string) ?? '',
            duration_minutes: (data.duration_minutes as number) ?? 0,
            user_message_count: (data.user_message_count as number) ?? 0,
            assistant_message_count: (data.assistant_message_count as number) ?? 0,
            tool_counts: (data.tool_counts as Record<string, number>) ?? {},
            tool_output_tokens: (data.tool_output_tokens as Record<string, number>) ?? {},
            agent_file_reads: (data.agent_file_reads as Record<string, number>) ?? {},
            languages,
            git_commits: (data.git_commits as number) ?? 0,
            git_pushes: (data.git_pushes as number) ?? 0,
            input_tokens: (data.input_tokens as number) ?? 0,
            output_tokens: (data.output_tokens as number) ?? 0,
            first_prompt: (data.first_prompt as string) ?? '',
            user_interruptions: (data.user_interruptions as number) ?? 0,
            user_response_times: (data.user_response_times as number[]) ?? [],
            tool_errors: (data.tool_errors as number) ?? 0,
            tool_error_categories: (data.tool_error_categories as Record<string, number>) ?? {},
            uses_task_agent: (data.uses_task_agent as boolean) ?? false,
            uses_mcp: (data.uses_mcp as boolean) ?? false,
            uses_web_search: (data.uses_web_search as boolean) ?? false,
            uses_web_fetch: (data.uses_web_fetch as boolean) ?? false,
            lines_added: (data.lines_added as number) ?? 0,
            lines_removed: (data.lines_removed as number) ?? 0,
            files_modified: (data.files_modified as number) ?? 0,
            message_hours: (() => {
              const timestamps = (data.user_message_timestamps as string[]) ?? []
              if (timestamps.length > 0) {
                return timestamps.flatMap(ts => {
                  try { return [new Date(ts).getHours()] } catch { return [] }
                })
              }
              return (data.message_hours as number[]) ?? []
            })(),
            user_message_timestamps: (data.user_message_timestamps as string[]) ?? [],
            _source: 'meta',
          }

          map.set(sessionId, meta)
        })
        )
    )
  }

  return map
}

async function scanProjectDir(
  projDir: string,
  rootDirPaths: string[],
  knownIds: Set<string>,
  metaMap: Map<string, SessionMeta>,
  fileLimit: ReturnType<typeof createLimiter>
): Promise<{ project: ServerProject; extraSessions: SessionMeta[] } | null> {
  // Fallback path (ambiguous for dir names that contain dashes)
  const fallbackPath = decodeProjectDir(projDir)

  const projectSessions: { sessionId: string; created: string }[] = []
  const extraSessions: SessionMeta[] = []
  // Count CWD occurrences to pick the canonical project path (majority wins)
  const cwdCounts: Record<string, number> = { [fallbackPath]: 0 }
  // Dedup sessions across roots — a session present in the live root is never
  // re-processed from the archive root (roots are scanned live-first).
  const seen = new Set<string>()

  // rootDirPaths is this encoded dir resolved across PROJECTS_ROOTS, live first.
  for (const projDirPath of rootDirPaths) {
    const dirStat = await safeStat(projDirPath)
    if (!dirStat?.isDirectory()) continue
    const entries = await safeReadDir(projDirPath)

    // Process all entries in this project dir in parallel (no shared limit with outer)
    await Promise.all(entries.map(async entry => {
    // ----------------------------------------------------------
    // Format A: <session-uuid>.jsonl — direct JSONL file
    // ----------------------------------------------------------
    if (entry.endsWith('.jsonl')) {
      const sessionId = entry.replace(/\.jsonl$/, '')
      if (seen.has(sessionId)) return
      seen.add(sessionId)
      const filePath = join(projDirPath, entry)

      projectSessions.push({ sessionId, created: '' })

      // If we already have this session in meta, count its project_path as a CWD vote
      const metaEntry = metaMap.get(sessionId)
      if (metaEntry?.project_path) {
        cwdCounts[metaEntry.project_path] = (cwdCounts[metaEntry.project_path] ?? 0) + 1
      }

      if (!knownIds.has(sessionId)) {
        const session = await fileLimit(() => parseSessionJsonl(filePath, sessionId, fallbackPath, 'jsonl'))
        cwdCounts[session.project_path] = (cwdCounts[session.project_path] ?? 0) + 1
        extraSessions.push(session)
      } else if (metaEntry && (!metaEntry.model || (metaEntry.uses_task_agent && !metaEntry.agentMetrics))) {
        // Meta session — extract model and/or agent metrics from the JSONL (single read)
        await fileLimit(async () => {
          const needsModel = !metaEntry.model
          const needsAgentMetrics = metaEntry.uses_task_agent && !metaEntry.agentMetrics
          if (!needsModel && !needsAgentMetrics) return

          const content = await readFile(filePath, 'utf-8').catch(() => '')
          if (!content) return

          if (needsModel) {
            for (const raw of content.split('\n').slice(0, 200)) {
              const line = raw.trim()
              if (!line) continue
              try {
                const e = JSON.parse(line)
                const m = e.message?.model
                if (e.type === 'assistant' && typeof m === 'string' && m && m.startsWith('claude-')) {
                  metaEntry.model = m as string
                  break
                }
              } catch { /* skip */ }
            }
          }

          if (needsAgentMetrics) {
            const { extractAgentMetrics } = await import('./agent-metrics')
            const metrics = extractAgentMetrics(content.split('\n'), metaEntry.model ?? '')
            if (metrics.totalInvocations > 0) metaEntry.agentMetrics = metrics
          }
        })
      }
      return
    }

    // ----------------------------------------------------------
    // Format B: <uuid>/ directory with subagents/ inside
    // ----------------------------------------------------------
    if (!UUID_RE.test(entry)) return
    const entryPath = join(projDirPath, entry)
    const entryStat = await safeStat(entryPath)
    if (!entryStat?.isDirectory()) return

    const sessionId = entry
    if (seen.has(sessionId)) return
    seen.add(sessionId)
    let created = ''

    // If we already have this session in meta, count its project_path as a CWD vote
    const metaEntry = metaMap.get(sessionId)
    if (metaEntry?.project_path) {
      cwdCounts[metaEntry.project_path] = (cwdCounts[metaEntry.project_path] ?? 0) + 1
    }

    const subagentsDir = join(entryPath, 'subagents')
    // Read only the FIRST agent file to get cwd/timestamp
    const agentFiles = (await safeReadDir(subagentsDir))
      .filter(f => f.endsWith('.jsonl'))
      .sort()

    if (agentFiles.length > 0) {
      const agentFilePath = join(subagentsDir, agentFiles[0]!)
      if (!knownIds.has(sessionId)) {
        const session = await fileLimit(() => parseSessionJsonl(agentFilePath, sessionId, fallbackPath, 'subdir'))
        created = session.start_time
        cwdCounts[session.project_path] = (cwdCounts[session.project_path] ?? 0) + 1
        extraSessions.push(session)
      } else {
        // Already in meta — just grab the timestamp cheaply
        const metaCwdEntry = metaMap.get(sessionId)
        created = metaCwdEntry?.start_time ?? ''
      }
    }

    projectSessions.push({ sessionId, created })
  }))
  }

  if (projectSessions.length === 0) return null

  // Use most-common CWD as canonical project path (majority-vote resolves dash-ambiguity
  // and prevents rogue subagent CWDs from hijacking the project path)
  const projectPath = Object.entries(cwdCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || fallbackPath

  // Normalize all extra sessions to the canonical project path
  for (const s of extraSessions) s.project_path = projectPath

  // Scope git stats to the period of Claude usage (earliest session date)
  const sessionDates = projectSessions
    .map(s => s.created || metaMap.get(s.sessionId)?.start_time || '')
    .filter(Boolean)
  const earliestSession = sessionDates.length > 0
    ? sessionDates.reduce((a, b) => a < b ? a : b)
    : undefined
  const git_stats = await getProjectGitStats(projectPath, earliestSession)

  return {
    project: {
      path: projectPath,
      name: projectPath.split('/').filter(Boolean).pop() ?? projDir,
      sessions: projectSessions.sort((a, b) => b.created.localeCompare(a.created)),
      git_stats,
    },
    extraSessions,
  }
}

export async function scanProjects(
  knownIds: Set<string>,
  metaMap: Map<string, SessionMeta>,
  roots: string[] = [PROJECTS_DIR],
  onProjectComplete?: (completed: number, total: number) => void,
): Promise<ScanResult> {
  // Separate limiter just for file reads (not project dir traversal)
  const fileLimit = createLimiter(30)

  // Union encoded project dirs across all roots (live + archive). Each maps to
  // the list of absolute paths that contain it, in root priority order (live first).
  const dirToRoots = new Map<string, string[]>()
  for (const root of roots) {
    for (const d of await safeReadDir(root)) {
      const arr = dirToRoots.get(d) ?? []
      arr.push(join(root, d))
      dirToRoots.set(d, arr)
    }
  }
  const dirEntries = [...dirToRoots.entries()]
  let completed = 0
  const total = dirEntries.length

  // Process project dirs in parallel (they mostly do readdirs + parallel file reads)
  const results = await Promise.all(
    dirEntries.map(([projDir, rootDirPaths]) =>
      scanProjectDir(projDir, rootDirPaths, knownIds, metaMap, fileLimit).then(r => {
        completed++
        onProjectComplete?.(completed, total)
        return r
      })
    )
  )

  const projects: ServerProject[] = []
  const extraSessions: SessionMeta[] = []

  for (const result of results) {
    if (!result) continue
    projects.push(result.project)
    extraSessions.push(...result.extraSessions)
  }

  // Sort projects by session count descending
  projects.sort((a, b) => b.sessions.length - a.sessions.length)

  return { projects, extraSessions }
}

export function enrichProjectSessions(projects: ServerProject[], metaMap: Map<string, SessionMeta>): void {
  for (const project of projects) {
    for (const s of project.sessions) {
      if (!s.created) {
        const meta = metaMap.get(s.sessionId)
        if (meta?.start_time) s.created = meta.start_time
      }
    }
    // Re-sort after enrichment
    project.sessions.sort((a, b) => b.created.localeCompare(a.created))
  }
}

// ---------------------------------------------------------------------------
// In-memory cache — shared Promise so concurrent requests join the same
// computation instead of spawning separate ones.
//
// State machine:
//   'idle'      → no computation, next request starts one
//   'computing' → in-flight; all requests (including invalidation) wait for it
//   'done'      → resolved; served from cache until TTL expires or invalidated
//
// invalidateCache() transitions 'done' → 'idle' so the next request recomputes.
// While 'computing', invalidations are no-ops — the current computation is used.
// ---------------------------------------------------------------------------

const CACHE_TTL_MS = 30_000

type CacheStatus = 'idle' | 'computing' | 'done'

let _status: CacheStatus = 'idle'
let _promise: Promise<ApiResponse> | null = null
let _resolvedAt = 0

export function invalidateCache(): void {
  if (_status === 'done') _status = 'idle'
  // 'computing': no-op — let the in-flight computation finish
}

export async function buildApiResponse(): Promise<ApiResponse> {
  if (_status === 'computing') return _promise!
  if (_status === 'done' && Date.now() - _resolvedAt < CACHE_TTL_MS) return _promise!

  _status = 'computing'
  _promise = _buildApiResponse()
    .then(result => {
      _status = 'done'
      _resolvedAt = Date.now()
      return result
    })
    .catch(err => {
      _status = 'idle'
      _promise = null
      throw err
    })
  return _promise
}

/** Merge sessions newer than `statsCache.lastComputedDate` into the cache in-place.
 *  Fills gaps left by Claude Code's own stats-cache updater (e.g. activity from today
 *  that hasn't been rolled into ~/.claude/stats-cache.json yet). Only sessions whose
 *  model starts with `claude-` are counted (skips `<synthetic>` and other sentinels). */
function supplementStatsCache(statsCache: StatsCache, sessions: SessionMeta[]): void {
  if (sessions.length === 0) return
  const lastComputed = statsCache.lastComputedDate ?? ''

  const dailyModel = new Map<string, Map<string, number>>()
  const modelTotals = new Map<string, { input: number; output: number; cacheRead: number; cacheWrite: number }>()
  const dailyActivity = new Map<string, { messageCount: number; sessionCount: number; toolCallCount: number }>()

  for (const s of sessions) {
    if (!s.start_time) continue
    const day = s.start_time.slice(0, 10)
    if (lastComputed && day <= lastComputed) continue

    const da = dailyActivity.get(day) ?? { messageCount: 0, sessionCount: 0, toolCallCount: 0 }
    da.messageCount += (s.user_message_count ?? 0) + (s.assistant_message_count ?? 0)
    da.sessionCount += 1
    da.toolCallCount += Object.values(s.tool_counts ?? {}).reduce((a, b) => a + b, 0)
    dailyActivity.set(day, da)

    const model = s.model
    if (!model || !model.startsWith('claude-')) continue
    const inp = s.input_tokens ?? 0
    const out = s.output_tokens ?? 0
    const cr  = s.cache_read_input_tokens ?? 0
    const cw  = s.cache_creation_input_tokens ?? 0
    const total = inp + out + cr + cw
    if (total === 0) continue

    const byModel = dailyModel.get(day) ?? new Map<string, number>()
    byModel.set(model, (byModel.get(model) ?? 0) + total)
    dailyModel.set(day, byModel)

    const mt = modelTotals.get(model) ?? { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }
    mt.input     += inp
    mt.output    += out
    mt.cacheRead += cr
    mt.cacheWrite += cw
    modelTotals.set(model, mt)
  }

  if (dailyActivity.size === 0 && dailyModel.size === 0 && modelTotals.size === 0) return

  // dailyActivity — upsert by date, then sort
  statsCache.dailyActivity = statsCache.dailyActivity ?? []
  const daIndex = new Map(statsCache.dailyActivity.map((d, i) => [d.date, i]))
  for (const [date, v] of dailyActivity) {
    const idx = daIndex.get(date)
    if (idx !== undefined) statsCache.dailyActivity[idx] = { date, ...v }
    else statsCache.dailyActivity.push({ date, ...v })
  }
  statsCache.dailyActivity.sort((a, b) => a.date.localeCompare(b.date))

  // dailyModelTokens — upsert by date
  statsCache.dailyModelTokens = statsCache.dailyModelTokens ?? []
  const dmtIndex = new Map(statsCache.dailyModelTokens.map((d, i) => [d.date, i]))
  for (const [date, byModel] of dailyModel) {
    const tokensByModel: Record<string, number> = {}
    for (const [m, t] of byModel) tokensByModel[m] = t
    const idx = dmtIndex.get(date)
    if (idx !== undefined) statsCache.dailyModelTokens[idx] = { date, tokensByModel }
    else statsCache.dailyModelTokens.push({ date, tokensByModel })
  }
  statsCache.dailyModelTokens.sort((a, b) => a.date.localeCompare(b.date))

  // modelUsage — increment existing entries or create new ones
  statsCache.modelUsage = statsCache.modelUsage ?? {}
  for (const [model, t] of modelTotals) {
    const existing = statsCache.modelUsage[model]
    if (existing) {
      existing.inputTokens             += t.input
      existing.outputTokens            += t.output
      existing.cacheReadInputTokens    += t.cacheRead
      existing.cacheCreationInputTokens += t.cacheWrite
    } else {
      statsCache.modelUsage[model] = {
        inputTokens: t.input,
        outputTokens: t.output,
        cacheReadInputTokens: t.cacheRead,
        cacheCreationInputTokens: t.cacheWrite,
        webSearchRequests: 0,
        costUSD: 0,
      }
    }
  }
}

/** Recover history from the latest archive snapshot WITHOUT double-counting.
 *  Daily arrays: add only dates the live cache no longer has. Model totals:
 *  take the per-field max (monotonic — normally a no-op, restores any shrinkage
 *  if Claude ever recomputes a smaller cache after deleting sessions). */
async function mergeArchivedStatsCache(statsCache: StatsCache, enabled: boolean): Promise<void> {
  if (!enabled) return
  const snap = await safeReadJson<StatsCache>(join(ARCHIVE_STATS_DIR, 'latest.json'))
  if (!snap) return
  applyArchivedStats(statsCache, snap)
}

export function applyArchivedStats(statsCache: StatsCache, snap: StatsCache): void {
  statsCache.dailyActivity = statsCache.dailyActivity ?? []
  const haveDA = new Set(statsCache.dailyActivity.map(d => d.date))
  for (const d of snap.dailyActivity ?? []) {
    if (!haveDA.has(d.date)) statsCache.dailyActivity.push(d)
  }
  statsCache.dailyActivity.sort((a, b) => a.date.localeCompare(b.date))

  statsCache.dailyModelTokens = statsCache.dailyModelTokens ?? []
  const haveDMT = new Set(statsCache.dailyModelTokens.map(d => d.date))
  for (const d of snap.dailyModelTokens ?? []) {
    if (!haveDMT.has(d.date)) statsCache.dailyModelTokens.push(d)
  }
  statsCache.dailyModelTokens.sort((a, b) => a.date.localeCompare(b.date))

  statsCache.modelUsage = statsCache.modelUsage ?? {}
  for (const [model, snapU] of Object.entries(snap.modelUsage ?? {})) {
    const live = statsCache.modelUsage[model]
    if (!live) { statsCache.modelUsage[model] = snapU; continue }
    live.inputTokens = Math.max(live.inputTokens, snapU.inputTokens)
    live.outputTokens = Math.max(live.outputTokens, snapU.outputTokens)
    live.cacheReadInputTokens = Math.max(live.cacheReadInputTokens, snapU.cacheReadInputTokens)
    live.cacheCreationInputTokens = Math.max(live.cacheCreationInputTokens, snapU.cacheCreationInputTokens)
    live.webSearchRequests = Math.max(live.webSearchRequests ?? 0, snapU.webSearchRequests ?? 0)
  }
}

type ProgressFn = (stage: string, progress: number, detail?: string) => void

async function _buildApiResponseCore(onProgress: ProgressFn): Promise<ApiResponse> {
  const timeoutMs = 300_000 // 5 minutes

  const buildPromise = async () => {
    onProgress('statsCache', 0)
    onProgress('sessions', 0)
    onProgress('health', 0)

    // Resolve archive mode. 'full' reads the raw mirror (union live+archive);
    // 'consolidate' reads live only and gap-fills from the metrics store later.
    const mode = (ARCHIVE_ENABLED ? await getArchiveMode() : 'off') ?? 'off'
    const fullMode = mode === 'full'
    const metaRoots = fullMode ? [SESSION_META_DIR, ARCHIVE_SESSION_META_DIR] : [SESSION_META_DIR]
    const projectRoots = fullMode ? [PROJECTS_DIR, ARCHIVE_PROJECTS_DIR] : [PROJECTS_DIR]

    const [statsCache, metaMap, healthIssues] = await Promise.all([
      safeReadJson<StatsCache>(STATS_CACHE_FILE)
        .then(async v => {
          const sc = v ?? ({} as StatsCache)
          await mergeArchivedStatsCache(sc, fullMode)
          onProgress('statsCache', 1)
          return sc
        }),
      loadSessionMetas(metaRoots)
        .then(v => { onProgress('sessions', 1, String(v.size)); return v }),
      runHealthChecks()
        .then(v => { onProgress('health', 1); return v }),
    ])

    onProgress('projects', 0)
    const knownIds = new Set(metaMap.keys())
    const { projects, extraSessions } = await scanProjects(
      knownIds,
      metaMap,
      projectRoots,
      (done, total) => onProgress('projects', total > 0 ? done / total : 1),
    )
    onProgress('projects', 1, String(projects.length))

    // Enrich project session created timestamps from meta where possible
    enrichProjectSessions(projects, metaMap)

    onProgress('finalizing', 0)

    const metaSessions = Array.from(metaMap.values())
    const allSessionsRaw: SessionMeta[] = [...metaSessions, ...extraSessions]

    // Deduplicate by session_id — same UUID can appear as both .jsonl AND UUID subdir
    // Prefer: meta > jsonl > subdir
    const sourceRank: Record<string, number> = { meta: 0, jsonl: 1, subdir: 2 }
    const sessionMap = new Map<string, SessionMeta>()
    for (const s of allSessionsRaw) {
      const existing = sessionMap.get(s.session_id)
      if (!existing || (sourceRank[s._source ?? 'subdir'] ?? Infinity) < (sourceRank[existing._source ?? 'subdir'] ?? Infinity)) {
        sessionMap.set(s.session_id, s)
      }
    }
    const sessions = Array.from(sessionMap.values())

    // Persist current per-session metrics so they survive Claude's cleanup, then
    // (consolidate mode) revive sessions that already vanished from disk. Gap-fill
    // adds only ids no longer present live — never double-counts existing sessions.
    if (mode !== 'off') {
      await writeConsolidated(sessions)
    }
    if (mode === 'consolidate') {
      const stored = await loadConsolidated()
      const liveIds = new Set(sessions.map(s => s.session_id))
      const projByPath = new Map(projects.map(p => [p.path, p]))
      for (const [id, s] of stored) {
        if (liveIds.has(id)) continue
        sessions.push(s)
        const existing = projByPath.get(s.project_path)
        if (existing) {
          existing.sessions.push({ sessionId: id, created: s.start_time })
        } else if (s.project_path) {
          const np: ServerProject = {
            path: s.project_path,
            name: s.project_path.split('/').filter(Boolean).pop() ?? s.project_path,
            sessions: [{ sessionId: id, created: s.start_time }],
          }
          projects.push(np)
          projByPath.set(s.project_path, np)
        }
      }
    }

    // Sort sessions by start_time descending (most recent first)
    sessions.sort((a, b) => b.start_time.localeCompare(a.start_time))

    // Post-processing health checks based on session data (tool metrics)
    analyzeToolHealthIssues(sessions, healthIssues)

    // Staleness check runs BEFORE supplementation so the warning reflects the original cache state
    analyzeCacheStaleness(statsCache, sessions, healthIssues)
    // Supplement the cache with sessions newer than lastComputedDate so UI totals stay accurate
    supplementStatsCache(statsCache, sessions)

    const totalTokens = sessions.reduce((sum, s) => sum + (s.input_tokens ?? 0) + (s.output_tokens ?? 0), 0)
    onProgress('finalizing', 1, String(totalTokens))

    return { statsCache, projects, allSessions: [] as [], sessions, healthIssues, homeDir: HOME_DIR }
  }

  return Promise.race([
    buildPromise(),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Request timed out after 5 minutes')), timeoutMs)
    ),
  ])
}

async function _buildApiResponse(): Promise<ApiResponse> {
  return _buildApiResponseCore(() => {})
}

// Pub/sub: multiple concurrent stream requests (e.g. React Strict Mode double-firing effects)
// share one real computation instead of fake progress timers.
const _progressListeners = new Set<ProgressFn>()
const _progressSnapshot: Record<string, { progress: number; detail?: string }> = {}

function _broadcastProgress(stage: string, progress: number, detail?: string) {
  _progressSnapshot[stage] = { progress, detail }
  for (const fn of _progressListeners) {
    try { fn(stage, progress, detail) } catch { /* subscriber disconnected */ }
  }
}

/** Streams a build with real per-stage progress. Concurrent callers share one computation. */
export async function buildApiResponseStream(onProgress: ProgressFn): Promise<ApiResponse> {
  const STAGES = ['statsCache', 'sessions', 'health', 'projects', 'finalizing'] as const

  // Cache is fresh — all stages done instantly
  if (_status === 'done' && Date.now() - _resolvedAt < CACHE_TTL_MS) {
    for (const s of STAGES) onProgress(s, 1)
    return _promise!
  }

  // Computation in flight — subscribe to real progress. Replay snapshot for already-done stages.
  if (_status === 'computing' && _promise) {
    for (const [stage, snap] of Object.entries(_progressSnapshot)) {
      onProgress(stage, snap.progress, snap.detail)
    }
    _progressListeners.add(onProgress)
    try {
      return await _promise
    } finally {
      _progressListeners.delete(onProgress)
    }
  }

  // Fresh computation — broadcast real progress to all subscribers
  _progressListeners.clear()
  for (const k of Object.keys(_progressSnapshot)) delete _progressSnapshot[k]
  _progressListeners.add(onProgress)

  _status = 'computing'
  _promise = _buildApiResponseCore(_broadcastProgress)
    .then(result => {
      _status = 'done'
      _resolvedAt = Date.now()
      _progressListeners.clear()
      return result
    })
    .catch(err => {
      _status = 'idle'
      _promise = null
      _progressListeners.clear()
      throw err
    })
  return _promise
}

