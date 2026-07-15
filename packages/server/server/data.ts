import { join } from 'path'
import { readFile } from 'fs/promises'
import type { StatsCache, SessionMeta, ProjectGitStats, HealthIssue, HarnessId, WorkflowRun } from '@agentistics/core'
import { PROJECTS_DIR, SESSION_META_DIR, ARCHIVE_PROJECTS_DIR, ARCHIVE_SESSION_META_DIR, STATS_CACHE_FILE, ARCHIVE_STATS_DIR, ARCHIVE_ENABLED, HOME_DIR, TEAM_MODE, TEAM_CENTRAL, CENTRAL_USER } from './config'
import { getArchiveMode } from './preferences'
import { writeConsolidated, loadConsolidated } from './consolidate'
import { writeWorkflowRuns, loadWorkflowRuns } from './workflow-store'
import { createLimiter, safeReadDir, safeReadJson, safeStat } from './utils'
import { UUID_RE, decodeProjectDir, getProjectGitStats, getGitRemote } from './git'
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
  /** Normalized git remote (`host/org/repo`, no protocol) of this project's repo, when known. */
  gitRemote?: string
  /** Team/central only: display names of members who own sessions in this project. */
  users?: string[]
}

export interface ApiResponse {
  statsCache: StatsCache
  projects: ServerProject[]
  allSessions: []
  sessions: SessionMeta[]
  healthIssues: HealthIssue[]
  homeDir: string
  harnesses: HarnessId[]
  /** Team/central only: each member's own statsCache, keyed by resolved display name. */
  userStatsCaches?: Record<string, StatsCache>
  workflows?: WorkflowRun[]
}

export interface ScanResult {
  projects: ServerProject[]
  extraSessions: SessionMeta[]
  workflowRuns: WorkflowRun[]
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
            title: (data.title as string) ?? (data.summary as string) ?? undefined,
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
            harness: 'claude',
            git_remote: (data.git_remote as string) || undefined,
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
): Promise<{ project: ServerProject; extraSessions: SessionMeta[]; workflowRuns: WorkflowRun[] } | null> {
  // Fallback path (ambiguous for dir names that contain dashes)
  const fallbackPath = decodeProjectDir(projDir)

  const projectSessions: { sessionId: string; created: string }[] = []
  const extraSessions: SessionMeta[] = []
  const workflowRuns: WorkflowRun[] = []
  // Count CWD occurrences to pick the canonical project path (majority wins)
  const cwdCounts: Record<string, number> = { [fallbackPath]: 0 }
  // Dedup sessions across roots — a session present in the live root is never
  // re-processed from the archive root (roots are scanned live-first).
  const seen = new Set<string>()
  // Sibling dedup for workflow discovery, which (per the NOTE below) must run
  // BEFORE `seen` is checked/set for Format B — so it needs its own guard to
  // avoid re-reading + re-extracting the same session's workflows when its
  // `<id>/subagents/workflows/` dir is mirrored across both live and archive roots.
  const seenWorkflowSessions = new Set<string>()

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
    const subagentsDir = join(entryPath, 'subagents')

    // Discover workflow runs (superpowers-style local workflows) launched from this session.
    // Requires the main session JSONL (not the subagent files) to find launch/completion events.
    // NOTE: this must run BEFORE the `seen` dedup check below — a session commonly has BOTH
    // a `<id>.jsonl` (Format A, processed earlier in this same Promise.all) AND this `<id>/`
    // directory (Format B), and Format A already marks `sessionId` as seen. If workflow
    // discovery were gated on `seen`, it would silently never run for such sessions.
    if (!seenWorkflowSessions.has(sessionId)) {
      seenWorkflowSessions.add(sessionId)
      const workflowsDir = join(subagentsDir, 'workflows')
      const wfDirs = await safeReadDir(workflowsDir)
      if (wfDirs.length > 0) {
        const mainJsonl = join(projDirPath, `${sessionId}.jsonl`)
        const mainContent = await readFile(mainJsonl, 'utf-8').catch(() => '')
        if (mainContent) {
          const { extractWorkflowRuns } = await import('./workflow-metrics')
          const runs = await extractWorkflowRuns(mainContent.split('\n'), sessionId, workflowsDir)
          workflowRuns.push(...runs)
        }
      }
    }

    if (seen.has(sessionId)) return
    seen.add(sessionId)
    let created = ''

    // If we already have this session in meta, count its project_path as a CWD vote
    const metaEntry = metaMap.get(sessionId)
    if (metaEntry?.project_path) {
      cwdCounts[metaEntry.project_path] = (cwdCounts[metaEntry.project_path] ?? 0) + 1
    }

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
  // Resolve the repo's origin remote once per project. This is the local-machine source of
  // the group-by-repository key; it's stamped onto every session below so it survives being
  // pushed to a central (which has no filesystem access to the member's repos) and persisted
  // to the consolidate store.
  const gitRemote = await getGitRemote(projectPath)

  // Stamp the remote onto this project's sessions so the dimension travels with each session.
  if (gitRemote) {
    for (const s of extraSessions) s.git_remote = gitRemote
    for (const ps of projectSessions) {
      const meta = metaMap.get(ps.sessionId)
      if (meta && !meta.git_remote) meta.git_remote = gitRemote
    }
  }

  return {
    project: {
      path: projectPath,
      name: projectPath.split('/').filter(Boolean).pop() ?? projDir,
      sessions: projectSessions.sort((a, b) => b.created.localeCompare(a.created)),
      git_stats,
      gitRemote,
    },
    extraSessions,
    workflowRuns,
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
  const workflowRuns: WorkflowRun[] = []

  for (const result of results) {
    if (!result) continue
    projects.push(result.project)
    extraSessions.push(...result.extraSessions)
    workflowRuns.push(...result.workflowRuns)
  }

  // Sort projects by session count descending
  projects.sort((a, b) => b.sessions.length - a.sessions.length)

  return { projects, extraSessions, workflowRuns }
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
    const { projects, extraSessions, workflowRuns: collectedWorkflowRuns } = await scanProjects(
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
      // NOTE: this persists the Claude-only `sessions` array; non-Claude harness
      // sessions are merged in below, AFTER this call, and are intentionally NOT
      // written to the consolidate store yet. If you move this call below the merge,
      // you MUST keep the (harness, session_id) dedup at the end or codex double-counts.
      await writeConsolidated(sessions)
    }

    // Persist discovered workflow runs so they survive Claude's transcript cleanup,
    // then union with the store (live wins by runId) so revived runs from vanished
    // sessions still surface after the 30-day sweep. Gated on archive mode, same as
    // session consolidation above — 'off' means nothing is written or revived, but
    // live discovery (collectedWorkflowRuns, from scanProjects) always runs regardless.
    const liveWorkflows = collectedWorkflowRuns
    if (mode !== 'off') await writeWorkflowRuns(liveWorkflows)
    const storedWorkflows = mode !== 'off' ? await loadWorkflowRuns() : new Map<string, WorkflowRun>()
    const workflowsById = new Map(storedWorkflows)
    for (const r of liveWorkflows) workflowsById.set(r.runId, r)
    // `workflows` stays mutable — team/central workflow runs (from Mongo) are unioned in
    // below, after the team-sessions block, then a final sort is applied.
    // Hide empty runs (0 agents) — including any persisted before extraction started dropping
    // them — so the Dynamic Workflows view never shows "0 agents · nothing ran" skeletons.
    let workflows: WorkflowRun[] = [...workflowsById.values()].filter(r => r.agents.length > 0)
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
            gitRemote: s.git_remote || undefined,
          }
          projects.push(np)
          projByPath.set(s.project_path, np)
        }
      }
    }

    // Backfill git_remote onto remote-less sessions using the remote that ANY session (or project)
    // at the same path already carries. Members stamp git_remote at push time from their local
    // repo, but legacy pushes / older consolidated sessions lack it — without this an old
    // remote-less session at a now-linked repo shows as a duplicate "no linked repository" card.
    // The central has NO filesystem access to members' repos (so `project.gitRemote` is empty
    // there), which is why the remote is sourced from the sessions themselves, not a git scan.
    const pathToRemote = new Map<string, string>()
    for (const p of projects) if (p.gitRemote) pathToRemote.set(p.path, p.gitRemote)
    for (const s of sessions) {
      if (s.git_remote && s.project_path && !pathToRemote.has(s.project_path)) {
        pathToRemote.set(s.project_path, s.git_remote)
      }
    }
    let backfilled = 0
    if (pathToRemote.size > 0) {
      for (const s of sessions) {
        if (!s.git_remote && s.project_path) {
          const r = pathToRemote.get(s.project_path)
          if (r) { s.git_remote = r; backfilled++ }
        }
      }
      // Keep ServerProject in sync so any project-keyed consumer links too.
      for (const p of projects) {
        if (!p.gitRemote) {
          const r = pathToRemote.get(p.path)
          if (r) p.gitRemote = r
        }
      }
    }
    // On a MEMBER, persist the backfilled remotes to the consolidate store so the uploader pushes
    // them — the central can only group by git_remote, and cross-machine linking needs each member
    // to actually SEND it (a member's legacy store entries otherwise stay remote-less forever, and
    // the central has no filesystem to recover them). Skip on a central: its `sessions` include
    // team data from Mongo that must never be written into the local store.
    if (backfilled > 0 && !TEAM_CENTRAL && mode !== 'off') {
      await writeConsolidated(sessions).catch(err => console.warn('[repo] store git_remote heal failed:', String(err)))
    }

    // Sort sessions by start_time descending (most recent first)
    sessions.sort((a, b) => b.start_time.localeCompare(a.start_time))

    // Post-processing health checks based on session data (tool metrics)
    analyzeToolHealthIssues(sessions, healthIssues)

    // Staleness check runs BEFORE supplementation so the warning reflects the original cache state
    analyzeCacheStaleness(statsCache, sessions, healthIssues)
    // Supplement the cache with sessions newer than lastComputedDate so UI totals stay accurate
    supplementStatsCache(statsCache, sessions)

    // --- Other harnesses (Codex, …): append their normalized sessions ---
    // MUST run AFTER supplementStatsCache so non-Claude sessions never corrupt Claude totals.
    const { getEnabledAdapters } = await import('./adapters/types')
    const harnessSet = new Set<HarnessId>(['claude'])
    const extraHarnessSessions: SessionMeta[] = []
    for (const adapter of await getEnabledAdapters()) {
      if (adapter.id === 'claude') continue // already loaded above
      const extra = await adapter.loadSessions().catch(() => [] as SessionMeta[])
      for (const s of extra) {
        // Key by (harness, session_id) so IDs never collide across harnesses
        sessions.push(s)
        extraHarnessSessions.push(s)
        harnessSet.add(s.harness)
        // surface as a project too
        const existing = projects.find(p => p.path === s.project_path && p.path)
        if (existing) {
          existing.sessions.push({ sessionId: s.session_id, created: s.start_time })
          // Backfill the repo remote if the project was created from a session that lacked it.
          if (!existing.gitRemote && s.git_remote) existing.gitRemote = s.git_remote
        } else if (s.project_path) {
          projects.push({
            path: s.project_path,
            name: s.project_path.split('/').filter(Boolean).pop() ?? s.project_path,
            sessions: [{ sessionId: s.session_id, created: s.start_time }],
            gitRemote: s.git_remote || undefined,
          })
        }
      }
    }
    // Persist non-Claude sessions to the consolidate store too. The Claude-only
    // writeConsolidated() above runs before this merge, so without this the store
    // (and therefore the team uploader, which pushes loadConsolidated()) would only
    // ever carry Claude — a central would never receive Codex/Gemini/Copilot data.
    // The store is namespaced per harness and writeConsolidated dedups by
    // (harness, session_id), so this never collides with the Claude entries.
    if (mode !== 'off' && extraHarnessSessions.length > 0) {
      await writeConsolidated(extraHarnessSessions)
    }

    // --- Team sessions: central reads Mongo (Phase 2); else folder union (Phase 1) ---
    if (TEAM_MODE || TEAM_CENTRAL) {
      let teamSessions: SessionMeta[] = []
      if (TEAM_CENTRAL) {
        const { loadTeamSessionsFromMongo } = await import('./team-source')
        teamSessions = await loadTeamSessionsFromMongo().catch(() => [] as SessionMeta[])
      } else {
        const { loadTeamSessions } = await import('./team-source')
        teamSessions = await loadTeamSessions().catch(() => [] as SessionMeta[])
      }
      for (const s of teamSessions) {
        sessions.push(s)
        harnessSet.add(s.harness)
        const existing = projects.find(p => p.path === s.project_path && p.path)
        if (existing) {
          existing.sessions.push({ sessionId: s.session_id, created: s.start_time })
          // Backfill the repo remote if the project was created from a session that lacked it.
          if (!existing.gitRemote && s.git_remote) existing.gitRemote = s.git_remote
        } else if (s.project_path) {
          projects.push({
            path: s.project_path,
            name: s.project_path.split('/').filter(Boolean).pop() ?? s.project_path,
            sessions: [{ sessionId: s.session_id, created: s.start_time }],
            gitRemote: s.git_remote || undefined,
          })
        }
      }
      // Central: fold team sessions into statsCache so the unfiltered (no user
      // selected) Cost/Tokens KPIs reflect the whole team. Safe on a dedicated
      // central (empty local statsCache → nothing to corrupt); the day<=lastComputed
      // guard inside supplementStatsCache prevents any double-count.
      // NOTE: the central's own `statsCache` is NOT supplemented with team sessions here.
      // Each member's deep history is exposed separately via `userStatsCaches` (below) and
      // aggregated per-selected-member on the frontend, so the numbers match each machine
      // exactly. `statsCache` stays the central machine's own (used for CENTRAL_USER).
    }

    // Central self-contribution: the central machine's OWN local sessions have no `user`
    // (team sessions from Mongo always do). When AGENTISTICS_CENTRAL_USER is set, tag those
    // untagged sessions with it so the machine running the central also appears as a member
    // in the dashboard's user filter — one instance, both roles. No double-count: the
    // central never pushes itself to Mongo; it reads its own ~/.claude live.
    if (TEAM_CENTRAL && CENTRAL_USER) {
      for (const s of sessions) {
        if (!s.user) s.user = CENTRAL_USER
      }
    }

    // --- Team workflow runs: central reads Mongo, unioned with local runs ---
    // Mirrors the team-sessions block above: each member pushes its own local
    // WorkflowRun[] (computed metrics only — no chat/prompt text) to the central via
    // team-uploader.ts → POST /api/team/ingest, stored per (org, memberId, runId) in
    // team-workflows.ts. Keyed by runId here too, so a run pushed by its own member never
    // collides with the central's own local discovery of the same run.
    if (TEAM_CENTRAL) {
      const { loadTeamWorkflowsFromMongo } = await import('./team-source')
      const teamWorkflows = await loadTeamWorkflowsFromMongo().catch(() => [] as WorkflowRun[])
      const merged = new Map(workflows.map(w => [w.runId, w]))
      for (const w of teamWorkflows) merged.set(w.runId, w)
      workflows = [...merged.values()]
      // Same self-contribution as sessions: the central's own local runs have no `user` yet
      // (team runs from Mongo always do) — tag them with CENTRAL_USER so they surface under
      // the central machine's own member entry too.
      if (CENTRAL_USER) {
        workflows = workflows.map(w => (w.user ? w : { ...w, user: CENTRAL_USER }))
      }
    }
    workflows.sort((a, b) => (b.startedAt || '').localeCompare(a.startedAt || ''))

    // Per-member statsCaches: each member's authoritative aggregated history, keyed by the
    // member's CURRENT display name (resolved via the tokens table). The central's own
    // self-contribution is added under CENTRAL_USER. The frontend merges the selected
    // members' caches so KPIs match each machine exactly.
    let userStatsCaches: Record<string, StatsCache> | undefined
    if (TEAM_CENTRAL) {
      const { loadAllMemberStats } = await import('./team-stats')
      const { getMemberNameMap } = await import('./team-tokens')
      const [memberStats, nameMap] = await Promise.all([
        loadAllMemberStats().catch(() => [] as { memberId: string; user: string; statsCache: StatsCache }[]),
        getMemberNameMap().catch(() => ({} as Record<string, string>)),
      ])
      userStatsCaches = {}
      for (const m of memberStats) {
        userStatsCaches[nameMap[m.memberId] ?? m.user] = m.statsCache
      }
      if (CENTRAL_USER) userStatsCaches[CENTRAL_USER] = statsCache
    }

    sessions.sort((a, b) => b.start_time.localeCompare(a.start_time))

    // Final safety net: dedup by (harness, session_id). A no-op today (each session
    // is pushed once), but guarantees no double-count if non-Claude sessions ever get
    // revived from the consolidate store in addition to the live adapter merge.
    const seenHarnessKeys = new Set<string>()
    const dedupedSessions = sessions.filter(s => {
      const key = `${s.user ?? ''}:${s.harness ?? 'claude'}:${s.session_id}`
      if (seenHarnessKeys.has(key)) return false
      seenHarnessKeys.add(key)
      return true
    })

    // Tag each project with the set of members who own sessions in it, so the
    // frontend project filter can be scoped to the selected members deterministically
    // (no path re-matching, no fallback-to-all that leaks other members' projects).
    // Built from the final deduped session set, where every team/central session carries `user`.
    const pathToUsers = new Map<string, Set<string>>()
    for (const s of dedupedSessions) {
      if (!s.user || !s.project_path) continue
      let set = pathToUsers.get(s.project_path)
      if (!set) { set = new Set(); pathToUsers.set(s.project_path, set) }
      set.add(s.user)
    }
    for (const p of projects) {
      const set = pathToUsers.get(p.path)
      if (set && set.size > 0) p.users = Array.from(set)
    }

    const totalTokens = dedupedSessions.reduce((sum, s) => sum + (s.input_tokens ?? 0) + (s.output_tokens ?? 0), 0)
    onProgress('finalizing', 1, String(totalTokens))

    return { statsCache, projects, allSessions: [] as [], sessions: dedupedSessions, healthIssues, homeDir: HOME_DIR, harnesses: Array.from(harnessSet), userStatsCaches, workflows }
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

