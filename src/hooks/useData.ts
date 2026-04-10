import { useState, useEffect, useCallback, useMemo } from 'react'
import type { AppData, Filters, DateRange } from '../lib/types'
import { calcCost, getModelPrice, MODEL_PRICING } from '../lib/types'
import { subDays, isAfter, isBefore, parseISO, startOfDay, endOfDay, format } from 'date-fns'

export function useData() {
  const [data, setData] = useState<AppData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchData = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/data')
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const json = await res.json()
      setData(json)
    } catch (err) {
      setError(String(err))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchData()
  }, [fetchData])

  // Subscribe to server-sent change events so the dashboard updates automatically
  // when Claude writes new session data to ~/.claude/.
  // fetchData is stable (useCallback with no deps), so this effect runs once per mount.
  useEffect(() => {
    const es = new EventSource('/api/events')
    es.addEventListener('change', () => { fetchData() })
    es.onerror = () => {
      // EventSource reconnects automatically; no action needed
    }
    return () => { es.close() }
  }, [fetchData])

  return { data, loading, error, refetch: fetchData }
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
    const dateStr = subDays(today, i).toISOString().slice(0, 10)
    if (activeDates.has(dateStr)) streak++
    else if (i > 0) break
  }
  return streak
}

/** Blended cost per token using global model usage proportions */
function blendedCostPerToken(modelUsage: Record<string, { inputTokens: number; outputTokens: number; cacheReadInputTokens: number; cacheCreationInputTokens: number }>) {
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

    // ── Filter daily activity (date-range only — no project granularity in statsCache) ──
    const filteredDailyActivity = (data.statsCache.dailyActivity ?? []).filter(d =>
      inRange(parseISO(d.date), start, end)
    )
    const filteredDailyModelTokens = (data.statsCache.dailyModelTokens ?? []).filter(d =>
      inRange(parseISO(d.date), start, end)
    )

    // ── Filter sessions (date + projects) ──
    const filteredSessions = data.sessions.filter(s => {
      if (!s.start_time) return false
      if (!inRange(parseISO(s.start_time), start, end)) return false
      if (projectFiltered && !projectSet.has(s.project_path)) return false
      return true
    })

    // ── Aggregate stats ──
    // When project filter active, rebuild from sessions (no per-project data in statsCache)
    const totalMessages = projectFiltered
      ? filteredSessions.reduce((s, sess) => s + (sess.user_message_count ?? 0) + (sess.assistant_message_count ?? 0), 0)
      : filteredDailyActivity.reduce((s, d) => s + d.messageCount, 0)

    const totalSessions = projectFiltered
      ? filteredSessions.length
      : filteredDailyActivity.reduce((s, d) => s + d.sessionCount, 0)

    const totalToolCalls = projectFiltered
      ? filteredSessions.reduce((s, sess) => s + Object.values(sess.tool_counts ?? {}).reduce((a, b) => a + b, 0), 0)
      : filteredDailyActivity.reduce((s, d) => s + d.toolCallCount, 0)

    // ── Streak (always global) ──
    const activeDates = new Set((data.statsCache.dailyActivity ?? []).map(d => d.date))
    const streak = calcStreak(activeDates)

    // ── Heatmap data ──
    let heatmapData: { date: string; value: number; sessions: number; tools: number }[]
    if (projectFiltered) {
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
      heatmapData = filteredDailyActivity.map(d => ({
        date: d.date,
        value: d.messageCount,
        sessions: d.sessionCount,
        tools: d.toolCallCount,
      }))
    }

    // ── Model usage — respects date + model filters ──
    const globalModelUsage = data.statsCache.modelUsage ?? {}
    const dateFiltered = filters.dateRange !== 'all' || !!filters.customStart || !!filters.customEnd
    const modelFilter = filters.model && filters.model !== 'all' ? filters.model : null

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
          if (modelFilter && model !== modelFilter) continue
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
      if (modelFilter) {
        filteredModelUsage = globalModelUsage[modelFilter]
          ? { [modelFilter]: globalModelUsage[modelFilter] }
          : {}
      } else {
        filteredModelUsage = globalModelUsage
      }
    }

    // ── Cost calculation ──
    let totalCostUSD = 0
    if (projectFiltered) {
      // Blended rate on session-level input/output tokens
      const blended = blendedCostPerToken(globalModelUsage)
      const sessionInputTokens  = filteredSessions.reduce((s, sess) => s + (sess.input_tokens ?? 0), 0)
      const sessionOutputTokens = filteredSessions.reduce((s, sess) => s + (sess.output_tokens ?? 0), 0)
      totalCostUSD = (sessionInputTokens / 1_000_000) * blended.input
                   + (sessionOutputTokens / 1_000_000) * blended.output
    } else {
      totalCostUSD = Object.entries(filteredModelUsage).reduce((s, [id, u]) => s + calcCost(u, id), 0)
    }

    // ── Model tokens by model (for date range) ──
    const modelTokensByDate: Record<string, number> = {}
    for (const day of filteredDailyModelTokens) {
      for (const [model, tokens] of Object.entries(day.tokensByModel)) {
        if (filters.model && filters.model !== 'all' && model !== filters.model) continue
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

    // ── Sessão mais longa (respeita filtros) ──
    const longestSession = filteredSessions.reduce<typeof filteredSessions[0] | null>((best, s) => {
      if (!best || (s.duration_minutes ?? 0) > (best.duration_minutes ?? 0)) return s
      return best
    }, null)

    // ── Meta coverage range (commits/files only exist in meta sessions) ──
    const allMetaDates = (data.sessions ?? [])
      .filter(s => s._source === 'meta' && s.start_time)
      .map(s => s.start_time.slice(0, 10))
      .sort()
    const metaCoverageFrom = allMetaDates[0] ?? null
    const metaCoverageTo = allMetaDates[allMetaDates.length - 1] ?? null

    return {
      totalMessages,
      totalSessions,
      totalToolCalls,
      totalCostUSD,
      streak,
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
    }
  }, [data, filters])
}
