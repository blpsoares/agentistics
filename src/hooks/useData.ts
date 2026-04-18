import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import type { AppData, Filters, DateRange, AgentInvocation } from '../lib/types'
import { calcCost, getModelPrice, MODEL_PRICING } from '../lib/types'
import { subDays, isAfter, isBefore, parseISO, startOfDay, endOfDay, format, differenceInCalendarDays } from 'date-fns'

export interface StageProgress {
  progress: number
  detail?: string
  status: 'pending' | 'active' | 'done'
}

export type LoadProgress = Record<string, StageProgress>

export const LIVE_INTERVAL_OPTIONS = [
  { label: '10s', value: 10 },
  { label: '30s', value: 30 },
  { label: '1m', value: 60 },
  { label: '5m', value: 300 },
]

export const LIVE_INTERVAL_OPTIONS_RISKY = [
  { label: '1s', value: 1 },
  { label: '2s', value: 2 },
  { label: '5s', value: 5 },
]

export function useData() {
  const [data, setData] = useState<AppData | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadProgress, setLoadProgress] = useState<LoadProgress>({})
  const [error, setError] = useState<string | null>(null)
  const [liveUpdates, setLiveUpdates] = useState(true)
  const [updateInterval, setUpdateInterval] = useState(30)
  const streamRef = useRef<EventSource | null>(null)

  // Silent background refresh — no loading screen, no progress bars
  const fetchData = useCallback(async () => {
    try {
      const res = await fetch('/api/data')
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      setData(await res.json())
    } catch { /* ignore silent update errors */ }
  }, [])

  const startStreamLoad = useCallback(() => {
    streamRef.current?.close()
    streamRef.current = null

    setLoading(true)
    setError(null)
    setLoadProgress({})

    const es = new EventSource('/api/data-stream')
    streamRef.current = es
    let settled = false

    const complete = async (isError?: string) => {
      if (settled) return
      settled = true
      es.close()
      streamRef.current = null
      try {
        const res = await fetch('/api/data')
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        setData(await res.json())
        if (isError) setError(null)
      } catch (err) {
        setError(String(err))
      } finally {
        setLoading(false)
      }
    }

    es.addEventListener('progress', (e: Event) => {
      const ev = JSON.parse((e as MessageEvent).data) as { stage: string; progress: number; detail?: string }
      setLoadProgress(prev => ({
        ...prev,
        [ev.stage]: {
          progress: ev.progress,
          detail: ev.detail,
          status: ev.progress >= 1 ? 'done' : 'active',
        },
      }))
    })

    es.addEventListener('done', () => { void complete() })
    es.onerror = () => { void complete('stream error') }
  }, [])

  useEffect(() => {
    startStreamLoad()
    return () => { streamRef.current?.close() }
  }, [startStreamLoad])

  // Subscribe to server-sent change events so the dashboard updates automatically
  // when Claude writes new session data to ~/.claude/.
  useEffect(() => {
    if (!liveUpdates) return
    const es = new EventSource('/api/events')
    es.addEventListener('change', () => { void fetchData() })
    return () => { es.close() }
  }, [liveUpdates, fetchData])

  // Fallback polling at the selected interval when live updates are enabled.
  useEffect(() => {
    if (!liveUpdates) return
    const id = setInterval(() => { void fetchData() }, updateInterval * 1000)
    return () => { clearInterval(id) }
  }, [liveUpdates, updateInterval, fetchData])

  const refetch = useCallback(() => startStreamLoad(), [startStreamLoad])

  return { data, loading, loadProgress, error, refetch, liveUpdates, setLiveUpdates, updateInterval, setUpdateInterval }
}

export function getDateRangeFilter(dateRange: DateRange, customStart?: string, customEnd?: string) {
  const now = endOfDay(new Date())
  if (dateRange === '7d') return { start: startOfDay(subDays(now, 7)), end: now }
  if (dateRange === '30d') return { start: startOfDay(subDays(now, 30)), end: now }
  if (dateRange === '90d') return { start: startOfDay(subDays(now, 90)), end: now }
  // 'all' sem datas customizadas → histórico completo
  if (dateRange === 'all' && !customStart && !customEnd) return { start: new Date(0), end: now }
  // 'all' com datas customizadas (ou qualquer outro caso) → aplica intervalo personalizado
  const start = customStart ? startOfDay(parseISO(customStart)) : new Date(0)
  const end = customEnd ? endOfDay(parseISO(customEnd)) : now
  return { start, end }
}

function inRange(date: Date, start: Date, end: Date) {
  return !isBefore(date, start) && !isAfter(date, end)
}

/**
 * Calcula streak de dias consecutivos de atividade.
 * Se hoje não tiver atividade, conta a partir de ontem (não penaliza quem ainda não trabalhou hoje).
 */
export function calcStreak(activeDates: Set<string>, today: Date = new Date()): number {
  let streak = 0
  for (let i = 0; i <= 365; i++) {
    const dateStr = format(subDays(today, i), 'yyyy-MM-dd')
    if (activeDates.has(dateStr)) streak++
    else if (i > 0) break
  }
  return streak
}

/** Blended cost per token using global model usage proportions */
export function blendedCostPerToken(modelUsage: Record<string, { inputTokens: number; outputTokens: number; cacheReadInputTokens: number; cacheCreationInputTokens: number }>) {
  let totalInput = 0, totalOutput = 0, totalCacheRead = 0, totalCacheWrite = 0
  let weightedInput = 0, weightedOutput = 0, weightedCacheRead = 0, weightedCacheWrite = 0

  for (const [modelId, u] of Object.entries(modelUsage)) {
    const price = getModelPrice(modelId)
    totalInput += u.inputTokens
    totalOutput += u.outputTokens
    totalCacheRead += u.cacheReadInputTokens
    totalCacheWrite += u.cacheCreationInputTokens
    weightedInput += u.inputTokens * price.input
    weightedOutput += u.outputTokens * price.output
    weightedCacheRead += u.cacheReadInputTokens * price.cacheRead
    weightedCacheWrite += u.cacheCreationInputTokens * price.cacheWrite
  }

  return {
    input: totalInput > 0 ? weightedInput / totalInput : 3,
    output: totalOutput > 0 ? weightedOutput / totalOutput : 15,
    cacheRead: totalCacheRead > 0 ? weightedCacheRead / totalCacheRead : 0.3,
    cacheWrite: totalCacheWrite > 0 ? weightedCacheWrite / totalCacheWrite : 3.75,
  }
}

export function useDerivedStats(data: AppData | null, filters: Filters) {
  return useMemo(() => {
    if (!data) return null

    const { start, end } = getDateRangeFilter(filters.dateRange, filters.customStart, filters.customEnd)
    const projects = filters.projects ?? []
    const projectFiltered = projects.length > 0
    const projectSet = new Set(projects)
    const modelSet = filters.models && filters.models.length > 0 ? new Set(filters.models) : null

    // ── Filter daily activity (date-range only — no project granularity in statsCache) ──
    const filteredDailyActivity = (data.statsCache.dailyActivity ?? []).filter(d =>
      inRange(parseISO(d.date), start, end)
    )
    const filteredDailyModelTokens = (data.statsCache.dailyModelTokens ?? []).filter(d =>
      inRange(parseISO(d.date), start, end)
    )

    // ── Filter sessions (date + projects + model) ──
    const filteredSessions = data.sessions.filter(s => {
      if (!s.start_time) return false
      if (!inRange(parseISO(s.start_time), start, end)) return false
      if (projectFiltered && !projectSet.has(s.project_path)) return false
      if (modelSet && (!s.model || !modelSet.has(s.model))) return false
      return true
    })

    // ── Extend dailyActivity with sessions on days not yet in statsCache ──
    // statsCache can be stale (lastComputedDate < today); sessions from JSONL cover the gap.
    // Only applies when NOT project-filtered (project filter already uses filteredSessions directly).
    const dailyActivityDates = new Set(filteredDailyActivity.map(d => d.date))
    const supplementByDay: Record<string, { messageCount: number; sessionCount: number; toolCallCount: number }> = {}
    for (const s of filteredSessions) {
      if (!s.start_time) continue
      const day = format(parseISO(s.start_time), 'yyyy-MM-dd')
      if (dailyActivityDates.has(day)) continue // already covered by statsCache
      if (!supplementByDay[day]) supplementByDay[day] = { messageCount: 0, sessionCount: 0, toolCallCount: 0 }
      supplementByDay[day].messageCount += (s.user_message_count ?? 0) + (s.assistant_message_count ?? 0)
      supplementByDay[day].sessionCount += 1
      supplementByDay[day].toolCallCount += Object.values(s.tool_counts ?? {}).reduce((a, b) => a + b, 0)
    }
    const extendedDailyActivity = [
      ...filteredDailyActivity,
      ...Object.entries(supplementByDay).map(([date, v]) => ({ date, ...v })),
    ]

    // ── All-time total sessions (no date/project filter) — used by the header ──
    // Mirrors extendedDailyActivity logic but without any date restriction.
    const allDailyDates = new Set((data.statsCache.dailyActivity ?? []).map(d => d.date))
    const allTimeSupplementByDay: Record<string, number> = {}
    for (const s of data.sessions) {
      if (!s.start_time) continue
      const day = format(parseISO(s.start_time), 'yyyy-MM-dd')
      if (!allDailyDates.has(day)) allTimeSupplementByDay[day] = (allTimeSupplementByDay[day] ?? 0) + 1
    }
    const allTimeTotalSessions =
      (data.statsCache.dailyActivity ?? []).reduce((s, d) => s + d.sessionCount, 0)
      + Object.values(allTimeSupplementByDay).reduce((s, c) => s + c, 0)

    // ── Aggregate stats ──
    // Use filteredSessions when project or model filter is active (statsCache has no per-project/model granularity)
    const sessionFiltered = projectFiltered || modelSet !== null

    const totalMessages = sessionFiltered
      ? filteredSessions.reduce((s, sess) => s + (sess.user_message_count ?? 0) + (sess.assistant_message_count ?? 0), 0)
      : extendedDailyActivity.reduce((s, d) => s + d.messageCount, 0)

    const totalSessions = sessionFiltered
      ? filteredSessions.length
      : extendedDailyActivity.reduce((s, d) => s + d.sessionCount, 0)

    const totalToolCalls = sessionFiltered
      ? filteredSessions.reduce((s, sess) => s + Object.values(sess.tool_counts ?? {}).reduce((a, b) => a + b, 0), 0)
      : extendedDailyActivity.reduce((s, d) => s + d.toolCallCount, 0)

    // ── Streak ──
    // When project filter is active, derive active dates from filteredSessions only.
    // Otherwise, supplement stats-cache dates with all session start dates (fresher than stats-cache).
    // Session start_times are ISO UTC strings — format() normalises to local date.
    const activeDates = sessionFiltered
      ? new Set(filteredSessions.filter(s => s.start_time).map(s => format(parseISO(s.start_time), 'yyyy-MM-dd')))
      : new Set([
          ...(data.statsCache.dailyActivity ?? []).map(d => d.date),
          ...(data.sessions ?? []).filter(s => s.start_time).map(s => format(parseISO(s.start_time), 'yyyy-MM-dd')),
        ])
    const streak = calcStreak(activeDates)

    // ── Per-project streaks (for streak breakdown popup) ──
    // Always computed from filteredSessions so it respects active filters.
    const projectDateMap: Record<string, Set<string>> = {}
    for (const sess of filteredSessions) {
      if (!sess.project_path || !sess.start_time) continue
      const day = format(parseISO(sess.start_time), 'yyyy-MM-dd')
      if (!projectDateMap[sess.project_path]) projectDateMap[sess.project_path] = new Set()
      projectDateMap[sess.project_path]!.add(day)
    }
    const projectStreaks = Object.entries(projectDateMap)
      .map(([path, dates]) => ({ path, streak: calcStreak(dates) }))
      .filter(p => p.streak > 0)
      .sort((a, b) => b.streak - a.streak)

    // ── Heatmap data ──
    let heatmapData: { date: string; value: number; sessions: number; tools: number }[]
    if (sessionFiltered) {
      const byDay: Record<string, { value: number; sessions: number; tools: number }> = {}
      for (const s of filteredSessions) {
        if (!s.start_time) continue
        const day = format(parseISO(s.start_time), 'yyyy-MM-dd')
        if (!byDay[day]) byDay[day] = { value: 0, sessions: 0, tools: 0 }
        byDay[day].value += (s.user_message_count ?? 0) + (s.assistant_message_count ?? 0)
        byDay[day].sessions += 1
        byDay[day].tools += Object.values(s.tool_counts ?? {}).reduce((a, b) => a + b, 0)
      }
      heatmapData = Object.entries(byDay).map(([date, v]) => ({ date, ...v }))
    } else {
      heatmapData = extendedDailyActivity.map(d => ({
        date: d.date,
        value: d.messageCount,
        sessions: d.sessionCount,
        tools: d.toolCallCount,
      }))
    }
    heatmapData.sort((a, b) => a.date.localeCompare(b.date))

    // ── Model usage — respects date + model filters ──
    const globalModelUsage = data.statsCache.modelUsage ?? {}
    const dateFiltered = filters.dateRange !== 'all' || !!filters.customStart || !!filters.customEnd

    let filteredModelUsage: Record<string, import('../lib/types').ModelUsage>

    if (projectFiltered) {
      // No per-model session data — model breakdown unavailable when filtering by project
      filteredModelUsage = {}
    } else if (dateFiltered) {
      // Build approximate model usage from dailyModelTokens (date-filtered).
      // We only have total tokens per model per day, so we split input/output using
      // global proportions from statsCache as an approximation.
      filteredModelUsage = {}
      for (const day of filteredDailyModelTokens) {
        for (const [model, totalTok] of Object.entries(day.tokensByModel)) {
          if (modelSet && !modelSet.has(model)) continue
          const g = globalModelUsage[model]
          const gTotal = g
            ? g.inputTokens + g.outputTokens + g.cacheReadInputTokens + g.cacheCreationInputTokens
            : 0
          if (!filteredModelUsage[model]) {
            filteredModelUsage[model] = {
              inputTokens: 0, outputTokens: 0,
              cacheReadInputTokens: 0, cacheCreationInputTokens: 0,
              webSearchRequests: 0, costUSD: 0,
            }
          }
          const entry = filteredModelUsage[model]
          if (g && gTotal > 0) {
            entry.inputTokens             += Math.round(totalTok * g.inputTokens / gTotal)
            entry.outputTokens            += Math.round(totalTok * g.outputTokens / gTotal)
            entry.cacheReadInputTokens    += Math.round(totalTok * g.cacheReadInputTokens / gTotal)
            entry.cacheCreationInputTokens += Math.round(totalTok * g.cacheCreationInputTokens / gTotal)
          } else {
            // Fallback: assume 70% input / 30% output
            entry.inputTokens  += Math.round(totalTok * 0.7)
            entry.outputTokens += Math.round(totalTok * 0.3)
          }
        }
      }
    } else {
      // No date filter, no project filter — use global statsCache
      if (modelSet) {
        filteredModelUsage = {}
        for (const m of modelSet) {
          if (globalModelUsage[m]) filteredModelUsage[m] = globalModelUsage[m]
        }
      } else {
        filteredModelUsage = globalModelUsage
      }
    }

    // ── Cost calculation ──
    let totalCostUSD = 0
    if (projectFiltered) {
      if (modelSet) {
        // Model filter is active — every session's model is known (it passed the model filter).
        // Use each session's actual model for per-session calcCost; fall back to the single
        // filtered model when the session has no model field.
        const fallbackModel = modelSet.size === 1 ? [...modelSet][0]! : undefined
        for (const sess of filteredSessions) {
          const m = sess.model ?? fallbackModel
          totalCostUSD += calcCost({
            inputTokens: sess.input_tokens ?? 0,
            outputTokens: sess.output_tokens ?? 0,
            cacheReadInputTokens: sess.cache_read_input_tokens ?? 0,
            cacheCreationInputTokens: sess.cache_creation_input_tokens ?? 0,
            webSearchRequests: 0, costUSD: 0,
          }, m ?? '')
        }
      } else {
        // No model filter — use blended rate as approximation (model unknown per session)
        const blended = blendedCostPerToken(globalModelUsage)
        const sessionInputTokens  = filteredSessions.reduce((s, sess) => s + (sess.input_tokens ?? 0), 0)
        const sessionOutputTokens = filteredSessions.reduce((s, sess) => s + (sess.output_tokens ?? 0), 0)
        totalCostUSD = (sessionInputTokens / 1_000_000) * blended.input
                     + (sessionOutputTokens / 1_000_000) * blended.output
      }
    } else {
      totalCostUSD = Object.entries(filteredModelUsage).reduce((s, [id, u]) => s + calcCost(u, id), 0)
    }

    // ── Model tokens by model (for date range) ──
    const modelTokensByDate: Record<string, number> = {}
    for (const day of filteredDailyModelTokens) {
      for (const [model, tokens] of Object.entries(day.tokensByModel)) {
        if (modelSet && !modelSet.has(model)) continue
        modelTokensByDate[model] = (modelTokensByDate[model] ?? 0) + tokens
      }
    }

    // ── Tools + Languages ──
    const toolCounts: Record<string, number> = {}
    const toolOutputTokens: Record<string, number> = {}
    const agentFileReads: Record<string, number> = {}
    const langCounts: Record<string, number> = {}
    for (const s of filteredSessions) {
      for (const [tool, count] of Object.entries(s.tool_counts ?? {})) {
        toolCounts[tool] = (toolCounts[tool] ?? 0) + count
      }
      for (const [tool, tokens] of Object.entries(s.tool_output_tokens ?? {})) {
        toolOutputTokens[tool] = (toolOutputTokens[tool] ?? 0) + tokens
      }
      for (const [file, count] of Object.entries(s.agent_file_reads ?? {})) {
        agentFileReads[file] = (agentFileReads[file] ?? 0) + count
      }
      for (const lang of s.languages ?? []) {
        langCounts[lang] = (langCounts[lang] ?? 0) + 1
      }
    }

    // ── Git / Files ──
    // When exactly one project is selected, use project-level git stats from the git repo
    // (more accurate than session-based — captures commits made from other cwds)
    const singleProjectGitStats = projects.length === 1
      ? data.projects.find(p => p.path === projects[0])?.git_stats
      : undefined

    const gitCommits = singleProjectGitStats
      ? singleProjectGitStats.commits
      : filteredSessions.reduce((s, sess) => s + (sess.git_commits ?? 0), 0)
    const gitPushes = singleProjectGitStats
      ? 0  // not tracked at project level
      : filteredSessions.reduce((s, sess) => s + (sess.git_pushes ?? 0), 0)
    const linesAdded = singleProjectGitStats
      ? singleProjectGitStats.lines_added
      : filteredSessions.reduce((s, sess) => s + (sess.lines_added ?? 0), 0)
    const linesRemoved = singleProjectGitStats
      ? singleProjectGitStats.lines_removed
      : filteredSessions.reduce((s, sess) => s + (sess.lines_removed ?? 0), 0)
    const filesModified = singleProjectGitStats
      ? singleProjectGitStats.files_modified
      : filteredSessions.reduce((s, sess) => s + (sess.files_modified ?? 0), 0)

    // ── Tokens from sessions ──
    const inputTokens = filteredSessions.reduce((s, sess) => s + (sess.input_tokens ?? 0), 0)
    const outputTokens = filteredSessions.reduce((s, sess) => s + (sess.output_tokens ?? 0), 0)

    // ── Hour distribution ──
    const hourCounts: Record<number, number> = {}
    for (const s of filteredSessions) {
      for (const h of s.message_hours ?? []) {
        hourCounts[h] = (hourCounts[h] ?? 0) + 1
      }
    }

    // ── Hour metadata: first/last timestamp per hour (for tooltip) ──
    const hourMeta: Record<number, { firstTs: string; lastTs: string }> = {}
    for (const s of filteredSessions) {
      for (const ts of s.user_message_timestamps ?? []) {
        try {
          const h = new Date(ts).getHours()
          if (!hourMeta[h]) {
            hourMeta[h] = { firstTs: ts, lastTs: ts }
          } else {
            if (ts < hourMeta[h].firstTs) hourMeta[h].firstTs = ts
            if (ts > hourMeta[h].lastTs) hourMeta[h].lastTs = ts
          }
        } catch { /* skip */ }
      }
    }

    // ── Project stats ──
    const projectStats: Record<string, { sessions: number; messages: number; tools: number }> = {}
    for (const s of filteredSessions) {
      const p = s.project_path || 'Unknown'
      if (!projectStats[p]) projectStats[p] = { sessions: 0, messages: 0, tools: 0 }
      projectStats[p].sessions++
      projectStats[p].messages += (s.user_message_count ?? 0)
      projectStats[p].tools += Object.values(s.tool_counts ?? {}).reduce((a, b) => a + b, 0)
    }

    // ── Agent metrics ──
    const agentInvocations: AgentInvocation[] = []
    const agentTypeBreakdown: Record<string, { count: number; tokens: number; costUSD: number; durationMs: number }> = {}

    for (const s of filteredSessions) {
      if (!s.agentMetrics?.invocations) continue
      for (const inv of s.agentMetrics.invocations) {
        agentInvocations.push(inv)
        const type = inv.agentType || 'unknown'
        if (!agentTypeBreakdown[type]) agentTypeBreakdown[type] = { count: 0, tokens: 0, costUSD: 0, durationMs: 0 }
        agentTypeBreakdown[type].count++
        agentTypeBreakdown[type].tokens += inv.totalTokens
        agentTypeBreakdown[type].costUSD += inv.costUSD
        agentTypeBreakdown[type].durationMs += inv.totalDurationMs
      }
    }

    const totalAgentInvocations = agentInvocations.length
    const totalAgentTokens = agentInvocations.reduce((s, i) => s + i.totalTokens, 0)
    const totalAgentCostUSD = agentInvocations.reduce((s, i) => s + i.costUSD, 0)
    const totalAgentDurationMs = agentInvocations.reduce((s, i) => s + i.totalDurationMs, 0)

    // ── Sessão mais longa (respeita filtros) ──
    const longestSession = filteredSessions.reduce<typeof filteredSessions[0] | null>((best, s) => {
      if (!best || (s.duration_minutes ?? 0) > (best.duration_minutes ?? 0)) return s
      return best
    }, null)

    // ── Cache efficiency (filter-aware, derived from filteredModelUsage) ──
    // hit rate = cacheRead / (input + cacheRead + cacheCreation).
    // cacheCreation tokens are included in the denominator because they ARE tokens sent to the
    // model — including them avoids artificially inflated rates that approach 100% for heavy
    // Claude Code users where cacheRead dwarfs uncached input by orders of magnitude.
    // Savings model: compare actual spend with what the same tokens would have cost as
    // plain input, then subtract the extra we paid for cache writes.
    const cacheTotals = Object.values(filteredModelUsage).reduce(
      (acc, u) => ({
        inputTokens: acc.inputTokens + (u.inputTokens ?? 0),
        cacheReadInputTokens: acc.cacheReadInputTokens + (u.cacheReadInputTokens ?? 0),
        cacheCreationInputTokens: acc.cacheCreationInputTokens + (u.cacheCreationInputTokens ?? 0),
      }),
      { inputTokens: 0, cacheReadInputTokens: 0, cacheCreationInputTokens: 0 },
    )
    const cacheDenominator = cacheTotals.inputTokens + cacheTotals.cacheReadInputTokens + cacheTotals.cacheCreationInputTokens
    const cacheHitRate = cacheDenominator > 0 ? cacheTotals.cacheReadInputTokens / cacheDenominator : 0

    const blended = blendedCostPerToken(globalModelUsage)
    // What cacheRead tokens would have cost as plain input
    const cacheHypotheticalInputUSD = (cacheTotals.cacheReadInputTokens / 1_000_000) * blended.input
    // What cacheRead tokens actually cost
    const cacheActualReadUSD = (cacheTotals.cacheReadInputTokens / 1_000_000) * blended.cacheRead
    // Gross savings vs paying as regular input
    const cacheGrossSavedUSD = cacheHypotheticalInputUSD - cacheActualReadUSD
    // Premium paid for cache writes (extra over regular input)
    const cacheWriteOverheadUSD = Math.max(
      0,
      (cacheTotals.cacheCreationInputTokens / 1_000_000) * (blended.cacheWrite - blended.input),
    )
    // Net savings
    const cacheNetSavedUSD = cacheGrossSavedUSD - cacheWriteOverheadUSD

    // Per-model hit rate (only for models with data)
    const cachePerModel: Record<string, { hitRate: number; cacheReadTokens: number; inputTokens: number }> = {}
    for (const [modelId, u] of Object.entries(filteredModelUsage)) {
      const denom = (u.inputTokens ?? 0) + (u.cacheReadInputTokens ?? 0) + (u.cacheCreationInputTokens ?? 0)
      if (denom === 0) continue
      cachePerModel[modelId] = {
        hitRate: (u.cacheReadInputTokens ?? 0) / denom,
        cacheReadTokens: u.cacheReadInputTokens ?? 0,
        inputTokens: u.inputTokens ?? 0,
      }
    }

    // ── Meta coverage range (commits/files only exist in meta sessions) ──
    const allMetaDates = (data.sessions ?? [])
      .filter(s => s._source === 'meta' && s.start_time)
      .map(s => s.start_time.slice(0, 10))
      .sort()
    const metaCoverageFrom = allMetaDates[0] ?? null
    const metaCoverageTo = allMetaDates[allMetaDates.length - 1] ?? null

    // ── Session date range (reactive to active filters) ──
    const sortedStartTimes = filteredSessions
      .filter(s => s.start_time)
      .map(s => s.start_time)
      .sort()
    const firstSessionDate = sortedStartTimes.length > 0 ? parseISO(sortedStartTimes[0]!) : null
    const lastSessionDate = sortedStartTimes.length > 0 ? parseISO(sortedStartTimes[sortedStartTimes.length - 1]!) : null
    const sessionSpanDays = firstSessionDate && lastSessionDate
      ? differenceInCalendarDays(lastSessionDate, firstSessionDate) + 1
      : filteredSessions.length > 0 ? 1 : 0

    return {
      totalMessages,
      totalSessions,
      allTimeTotalSessions,
      totalToolCalls,
      totalCostUSD,
      streak,
      projectStreaks,
      heatmapData,
      modelUsage: filteredModelUsage,
      modelTokensByDate,
      toolCounts,
      toolOutputTokens,
      agentFileReads,
      langCounts,
      gitCommits,
      gitPushes,
      linesAdded,
      linesRemoved,
      filesModified,
      inputTokens,
      outputTokens,
      hourCounts,
      hourMeta,
      projectStats,
      filteredSessions,
      filteredDailyActivity,
      longestSession,
      metaCoverageFrom,
      metaCoverageTo,
      agentInvocations,
      agentTypeBreakdown,
      totalAgentInvocations,
      totalAgentTokens,
      totalAgentCostUSD,
      totalAgentDurationMs,
      firstSessionDate,
      lastSessionDate,
      sessionSpanDays,
      cacheHitRate,
      cacheTotals,
      cacheGrossSavedUSD,
      cacheWriteOverheadUSD,
      cacheNetSavedUSD,
      cachePerModel,
    }
  }, [data, filters])
}
