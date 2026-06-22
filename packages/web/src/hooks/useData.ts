import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import type { AppData, Filters, DateRange, AgentInvocation, HarnessId } from '@agentistics/core'
import { calcCost, getModelPrice, MODEL_PRICING, HARNESS_CAPABILITIES } from '@agentistics/core'
import { subDays, isAfter, isBefore, parseISO, startOfDay, endOfDay, format, differenceInCalendarDays, addDays, getDay } from 'date-fns'

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

/**
 * Calcula o maior streak já atingido no histórico completo de datas ativas.
 */
export function calcLongestStreak(activeDates: Set<string>): number {
  if (activeDates.size === 0) return 0
  const sorted = Array.from(activeDates).sort()
  let longest = 1
  let current = 1
  for (let i = 1; i < sorted.length; i++) {
    const diff = differenceInCalendarDays(parseISO(sorted[i]!), parseISO(sorted[i - 1]!))
    if (diff === 1) {
      current++
      if (current > longest) longest = current
    } else {
      current = 1
    }
  }
  return longest
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

export function filterByHarness<T extends { harness?: HarnessId }>(sessions: T[], harness?: HarnessId): T[] {
  if (!harness) return sessions
  return sessions.filter(s => (s.harness ?? 'claude') === harness)
}

export interface HarnessSummary {
  sessions: number
  messages: number
  inputTokens: number
  outputTokens: number
  costUSD: number
  hourCounts: number[]       // length 24, index = hour-of-day (0-23)
  peakHour: number | null    // hour with max count, null if all zero
  dowCounts: number[]        // length 7, index 0=Sunday..6=Saturday
  peakDow: number | null     // index of max dowCounts, null if all zero
  dailyActivity: { date: string; sessions: number }[]  // sorted ascending
  peakTokenDay: { date: string; tokens: number } | null  // null if no token data
  peakSessionCost: number | null  // null if no cost data / claude
}

function peakIndex(arr: number[]): number | null {
  let maxVal = 0
  let maxIdx: number | null = null
  for (let i = 0; i < arr.length; i++) {
    if ((arr[i] ?? 0) > maxVal) {
      maxVal = arr[i]!
      maxIdx = i
    }
  }
  return maxIdx
}

/**
 * Compute per-harness summary totals — pure function, no hooks.
 *
 * For 'claude': sessions = statsCache.dailyActivity sum + gap days (days with Claude
 * sessions in data.sessions whose date is NOT already covered by statsCache.dailyActivity).
 * This mirrors the `allTimeTotalSessions` claude branch in useDerivedStats exactly so the
 * Compare page always matches the main dashboard SESSIONS KPI.
 *
 * For non-claude harnesses: pure per-session sums (statsCache has no data for them).
 *
 * Only harnesses present in data.harnesses are included in the output.
 */
export function computeHarnessSummaries(
  data: import('@agentistics/core').AppData,
): Record<HarnessId, HarnessSummary> {
  const result = {} as Record<HarnessId, HarnessSummary>

  for (const harness of data.harnesses) {
    if (harness === 'claude') {
      // ── Claude: use statsCache as canonical source (survives 30-day cleanup) ──
      const allDailyDates = new Set((data.statsCache.dailyActivity ?? []).map(d => d.date))
      const claudeBase = (data.statsCache.dailyActivity ?? []).reduce((s, d) => s + d.sessionCount, 0)
      const messageBase = (data.statsCache.dailyActivity ?? []).reduce((s, d) => s + d.messageCount, 0)

      // Gap days: Claude sessions in data.sessions whose date is NOT in statsCache.dailyActivity
      let claudeGapSessions = 0
      let claudeGapMessages = 0
      for (const s of data.sessions) {
        if ((s.harness ?? 'claude') !== 'claude') continue
        if (!s.start_time) continue
        const day = format(parseISO(s.start_time), 'yyyy-MM-dd')
        if (!allDailyDates.has(day)) {
          claudeGapSessions += 1
          claudeGapMessages += (s.user_message_count ?? 0) + (s.assistant_message_count ?? 0)
        }
      }

      // Tokens and cost from statsCache.modelUsage (all-time Claude totals)
      const modelUsage = data.statsCache.modelUsage ?? {}
      const inputTokens = Object.values(modelUsage).reduce((s, u) => s + (u.inputTokens ?? 0), 0)
      const outputTokens = Object.values(modelUsage).reduce((s, u) => s + (u.outputTokens ?? 0), 0)
      const costUSD = Object.entries(modelUsage).reduce((s, [modelId, u]) => s + calcCost(u, modelId), 0)

      // ── Claude: hour-of-day from statsCache.hourCounts ──
      const claudeHourCounts = Array.from({ length: 24 }, (_, i) => data.statsCache.hourCounts?.[String(i)] ?? 0)

      // ── Claude: dow from statsCache.dailyActivity ──
      const claudeDowCounts = Array.from({ length: 7 }, () => 0)
      for (const d of data.statsCache.dailyActivity ?? []) {
        const dow = getDay(parseISO(d.date))
        claudeDowCounts[dow] = (claudeDowCounts[dow] ?? 0) + d.sessionCount
      }

      // ── Claude: daily activity for sparkline ──
      const claudeDailyActivity = (data.statsCache.dailyActivity ?? [])
        .map(d => ({ date: d.date, sessions: d.sessionCount }))
        .sort((a, b) => a.date.localeCompare(b.date))

      // ── Claude: peak token day from statsCache.dailyModelTokens ──
      let claudePeakTokenDay: { date: string; tokens: number } | null = null
      for (const d of data.statsCache.dailyModelTokens ?? []) {
        const tokens = Object.values(d.tokensByModel).reduce((s, t) => s + t, 0)
        if (!claudePeakTokenDay || tokens > claudePeakTokenDay.tokens) {
          claudePeakTokenDay = { date: d.date, tokens }
        }
      }

      result['claude'] = {
        sessions: claudeBase + claudeGapSessions,
        messages: messageBase + claudeGapMessages,
        inputTokens,
        outputTokens,
        costUSD,
        hourCounts: claudeHourCounts,
        peakHour: peakIndex(claudeHourCounts),
        dowCounts: claudeDowCounts,
        peakDow: peakIndex(claudeDowCounts),
        dailyActivity: claudeDailyActivity,
        peakTokenDay: claudePeakTokenDay,
        peakSessionCost: null,  // statsCache has no per-session cost breakdown
      }
    } else {
      // ── Non-Claude: pure per-session sums ──
      const harnessSessions = data.sessions.filter(s => s.harness === harness)
      let sessions = harnessSessions.length
      let messages = 0
      let inputTokens = 0
      let outputTokens = 0
      let costUSD = 0

      const hourCounts = Array.from({ length: 24 }, () => 0)
      const dowCounts = Array.from({ length: 7 }, () => 0)
      const dailyMap: Record<string, number> = {}
      const tokensByDay: Record<string, number> = {}
      let peakSessionCost: number | null = null

      const hasCost = HARNESS_CAPABILITIES[harness].cost
      const hasTokens = HARNESS_CAPABILITIES[harness].tokens

      for (const s of harnessSessions) {
        messages += (s.user_message_count ?? 0) + (s.assistant_message_count ?? 0)
        inputTokens += s.input_tokens ?? 0
        outputTokens += s.output_tokens ?? 0

        // hour-of-day
        for (const h of s.message_hours ?? []) {
          if (h >= 0 && h <= 23) hourCounts[h] = (hourCounts[h] ?? 0) + 1
        }

        // day-of-week + daily activity
        if (s.start_time) {
          const dow = getDay(parseISO(s.start_time))
          dowCounts[dow] = (dowCounts[dow] ?? 0) + 1
          const day = format(parseISO(s.start_time), 'yyyy-MM-dd')
          dailyMap[day] = (dailyMap[day] ?? 0) + 1

          if (hasTokens) {
            const sessionTokens = (s.input_tokens ?? 0) + (s.output_tokens ?? 0)
            tokensByDay[day] = (tokensByDay[day] ?? 0) + sessionTokens
          }
        }

        // cost
        if (s.model && hasCost) {
          const sessionCost = calcCost({
            inputTokens: s.input_tokens ?? 0,
            outputTokens: s.output_tokens ?? 0,
            cacheReadInputTokens: s.cache_read_input_tokens ?? 0,
            cacheCreationInputTokens: s.cache_creation_input_tokens ?? 0,
            webSearchRequests: 0,
            costUSD: 0,
          }, s.model)
          costUSD += sessionCost
          if (peakSessionCost === null || sessionCost > peakSessionCost) {
            peakSessionCost = sessionCost
          }
        }
      }

      // daily activity sorted asc
      const dailyActivity = Object.entries(dailyMap)
        .map(([date, sessions]) => ({ date, sessions }))
        .sort((a, b) => a.date.localeCompare(b.date))

      // peak token day (only set when there is actual token data > 0)
      let peakTokenDay: { date: string; tokens: number } | null = null
      if (hasTokens) {
        for (const [date, tokens] of Object.entries(tokensByDay)) {
          if (tokens > 0 && (!peakTokenDay || tokens > peakTokenDay.tokens)) {
            peakTokenDay = { date, tokens }
          }
        }
      }

      result[harness] = {
        sessions,
        messages,
        inputTokens,
        outputTokens,
        costUSD,
        hourCounts,
        peakHour: peakIndex(hourCounts),
        dowCounts,
        peakDow: peakIndex(dowCounts),
        dailyActivity,
        peakTokenDay,
        peakSessionCost: hasCost ? peakSessionCost : null,
      }
    }
  }

  return result
}

export function useDerivedStats(data: AppData | null, filters: Filters) {
  return useMemo(() => {
    if (!data) return null

    const { start, end } = getDateRangeFilter(filters.dateRange, filters.customStart, filters.customEnd)
    const projects = filters.projects ?? []
    const projectFiltered = projects.length > 0
    const projectSet = new Set(projects)
    const modelSet = filters.models && filters.models.length > 0 ? new Set(filters.models) : null

    // ── Harness filter — applied first so all downstream filters compose on top ──
    const harnessSessions = filterByHarness(data.sessions, filters.harness)
    const harnessActive = filters.harness != null
    const nonClaudeHarness = harnessActive && filters.harness !== 'claude'

    // ── Filter daily activity (date-range only — no project granularity in statsCache) ──
    const filteredDailyActivity = (data.statsCache.dailyActivity ?? []).filter(d =>
      inRange(parseISO(d.date), start, end)
    )
    const filteredDailyModelTokens = (data.statsCache.dailyModelTokens ?? []).filter(d =>
      inRange(parseISO(d.date), start, end)
    )

    // ── Shared date predicate — reused for filteredSessions and nonClaudeInRange ──
    const inDateRange = (s: { start_time?: string }) =>
      !!s.start_time && inRange(parseISO(s.start_time), start, end)

    // ── Filter sessions (date + projects + model) ──
    const filteredSessions = harnessSessions.filter(s => {
      if (!inDateRange(s)) return false
      if (projectFiltered && !projectSet.has(s.project_path)) return false
      if (modelSet && (!s.model || !modelSet.has(s.model))) return false
      return true
    })

    // Non-Claude sessions in the active date range — used to supplement statsCache totals
    // in the unified view (no harness filter). When a harness filter is active OR there are
    // no non-Claude sessions, this is always empty so all addenda contribute +0.
    const nonClaudeInRange = !harnessActive
      ? data.sessions.filter(s => (s.harness ?? 'claude') !== 'claude' && inDateRange(s))
      : []

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
    // statsCache.dailyActivity is CLAUDE-ONLY. So:
    //  - non-Claude harness selected → pure per-session count of that harness
    //  - Claude harness selected → Claude statsCache history + Claude sessions on gap days
    //  - unified (no harness filter) → Claude history+gap PLUS all non-Claude sessions
    let allTimeTotalSessions: number
    if (nonClaudeHarness) {
      allTimeTotalSessions = harnessSessions.length
    } else {
      const allDailyDates = new Set((data.statsCache.dailyActivity ?? []).map(d => d.date))
      const claudeBase = (data.statsCache.dailyActivity ?? []).reduce((s, d) => s + d.sessionCount, 0)
      let claudeGap = 0
      for (const s of harnessSessions) {
        if ((s.harness ?? 'claude') !== 'claude') continue
        if (!s.start_time) continue
        const day = format(parseISO(s.start_time), 'yyyy-MM-dd')
        if (!allDailyDates.has(day)) claudeGap += 1
      }
      // Unified view adds ALL non-Claude sessions (statsCache contains none of them).
      const nonClaudeCount = harnessActive
        ? 0
        : harnessSessions.filter(s => (s.harness ?? 'claude') !== 'claude').length
      allTimeTotalSessions = claudeBase + claudeGap + nonClaudeCount
    }

    // ── Aggregate stats ──
    // Use filteredSessions when project/model/non-claude-harness filter is active
    // (statsCache has no per-project/model/harness granularity)
    const sessionFiltered = projectFiltered || modelSet !== null || nonClaudeHarness

    const totalMessages = sessionFiltered
      ? filteredSessions.reduce((s, sess) => s + (sess.user_message_count ?? 0) + (sess.assistant_message_count ?? 0), 0)
      : extendedDailyActivity.reduce((s, d) => s + d.messageCount, 0)
        + nonClaudeInRange.reduce((s, sess) => s + (sess.user_message_count ?? 0) + (sess.assistant_message_count ?? 0), 0)

    const totalSessions = sessionFiltered
      ? filteredSessions.length
      : extendedDailyActivity.reduce((s, d) => s + d.sessionCount, 0) + nonClaudeInRange.length

    const totalToolCalls = sessionFiltered
      ? filteredSessions.reduce((s, sess) => s + Object.values(sess.tool_counts ?? {}).reduce((a, b) => a + b, 0), 0)
      : extendedDailyActivity.reduce((s, d) => s + d.toolCallCount, 0)
        + nonClaudeInRange.reduce((s, sess) => s + Object.values(sess.tool_counts ?? {}).reduce((a, b) => a + b, 0), 0)

    // ── Streak ──
    // When project filter is active, derive active dates from filteredSessions only.
    // Otherwise, supplement stats-cache dates with all session start dates (fresher than stats-cache).
    // Session start_times are ISO UTC strings — format() normalises to local date.
    // Multi-day sessions: use user_message_timestamps when available (most accurate); otherwise
    // add both start_time and end_time so days beyond the first are not silently dropped.
    const activeDates = sessionFiltered
      ? (() => {
          const set = new Set<string>()
          for (const s of filteredSessions) {
            if (!s.start_time) continue
            if (s.user_message_timestamps?.length) {
              for (const ts of s.user_message_timestamps) {
                set.add(format(parseISO(ts), 'yyyy-MM-dd'))
              }
            } else {
              set.add(format(parseISO(s.start_time), 'yyyy-MM-dd'))
              if (s.end_time) set.add(format(parseISO(s.end_time), 'yyyy-MM-dd'))
            }
          }
          return set
        })()
      : new Set([
          ...(data.statsCache.dailyActivity ?? []).map(d => d.date),
          ...(harnessSessions ?? []).filter(s => s.start_time).map(s => format(parseISO(s.start_time), 'yyyy-MM-dd')),
        ])
    const streak = calcStreak(activeDates)
    const streakLastActiveDate = streak === 0 && activeDates.size > 0
      ? (Array.from(activeDates).sort().at(-1) ?? null)
      : null

    // ── Per-project streaks (for streak breakdown popup) ──
    // Uses all sessions (no date-range filter) to mirror the global streak, which also
    // ignores the date filter (it reads from statsCache.dailyActivity covering all history).
    // Model filter is preserved when active so per-project streaks remain consistent.
    // Project filter IS applied so the breakdown only shows projects in the active filter.
    const projectDateMap: Record<string, Set<string>> = {}
    for (const sess of harnessSessions) {
      if (!sess.project_path || !sess.start_time) continue
      if (projectFiltered && !projectSet.has(sess.project_path)) continue
      if (modelSet && (!sess.model || !modelSet.has(sess.model))) continue
      const dates = projectDateMap[sess.project_path] ?? (projectDateMap[sess.project_path] = new Set())
      if (sess.user_message_timestamps?.length) {
        for (const ts of sess.user_message_timestamps) {
          dates.add(format(parseISO(ts), 'yyyy-MM-dd'))
        }
      } else {
        dates.add(format(parseISO(sess.start_time), 'yyyy-MM-dd'))
        if (sess.end_time) dates.add(format(parseISO(sess.end_time), 'yyyy-MM-dd'))
      }
    }
    // ── Streak day breakdown: which projects were active on each day of the current streak ──
    const streakDayBreakdown: { date: string; projects: string[] }[] = []
    {
      const now = new Date()
      for (let i = 0; i <= 365; i++) {
        const dateStr = format(subDays(now, i), 'yyyy-MM-dd')
        if (!activeDates.has(dateStr)) { if (i > 0) break; continue }
        const projects = Object.entries(projectDateMap)
          .filter(([, dates]) => dates.has(dateStr))
          .map(([path]) => path)
          .sort()
        streakDayBreakdown.push({ date: dateStr, projects })
      }
    }

    // ── Longest streak ever (respects project/model/harness filter, ignores date range) ──
    const allTimeActiveDates = (() => {
      const set = new Set<string>()
      if (projectFiltered || modelSet !== null || nonClaudeHarness) {
        for (const s of harnessSessions) {
          if (!s.start_time) continue
          if (projectFiltered && !projectSet.has(s.project_path)) continue
          if (modelSet && (!s.model || !modelSet.has(s.model))) continue
          if (s.user_message_timestamps?.length) {
            for (const ts of s.user_message_timestamps) {
              set.add(format(parseISO(ts), 'yyyy-MM-dd'))
            }
          } else {
            set.add(format(parseISO(s.start_time), 'yyyy-MM-dd'))
            if (s.end_time) set.add(format(parseISO(s.end_time), 'yyyy-MM-dd'))
          }
        }
      } else {
        for (const d of data.statsCache.dailyActivity ?? []) set.add(d.date)
        for (const s of harnessSessions) {
          if (s.start_time) set.add(format(parseISO(s.start_time), 'yyyy-MM-dd'))
        }
      }
      return set
    })()
    const longestStreak = calcLongestStreak(allTimeActiveDates)

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
      const heatmapByDay: Record<string, { value: number; sessions: number; tools: number }> = {}
      for (const d of extendedDailyActivity) {
        heatmapByDay[d.date] = { value: d.messageCount, sessions: d.sessionCount, tools: d.toolCallCount }
      }
      for (const s of nonClaudeInRange) {
        if (!s.start_time) continue
        const day = format(parseISO(s.start_time), 'yyyy-MM-dd')
        if (!heatmapByDay[day]) heatmapByDay[day] = { value: 0, sessions: 0, tools: 0 }
        heatmapByDay[day].value += (s.user_message_count ?? 0) + (s.assistant_message_count ?? 0)
        heatmapByDay[day].sessions += 1
        heatmapByDay[day].tools += Object.values(s.tool_counts ?? {}).reduce((a, b) => a + b, 0)
      }
      heatmapData = Object.entries(heatmapByDay).map(([date, v]) => ({ date, ...v }))
    }
    heatmapData.sort((a, b) => a.date.localeCompare(b.date))

    // ── Model usage — respects date + model filters ──
    const globalModelUsage = data.statsCache.modelUsage ?? {}
    const dateFiltered = filters.dateRange !== 'all' || !!filters.customStart || !!filters.customEnd

    let filteredModelUsage: Record<string, import('@agentistics/core').ModelUsage>

    if (projectFiltered || nonClaudeHarness) {
      // Build per-model breakdown from sessions that have a model field.
      // Sessions without a model field are excluded from the per-model breakdown.
      // Also used when a non-Claude harness is selected (statsCache has no harness granularity).
      filteredModelUsage = {}
      for (const sess of filteredSessions) {
        const m = sess.model
        if (!m) continue
        if (modelSet && !modelSet.has(m)) continue
        if (!filteredModelUsage[m]) {
          filteredModelUsage[m] = {
            inputTokens: 0, outputTokens: 0,
            cacheReadInputTokens: 0, cacheCreationInputTokens: 0,
            webSearchRequests: 0, costUSD: 0,
          }
        }
        const entry = filteredModelUsage[m]!
        entry.inputTokens              += sess.input_tokens ?? 0
        entry.outputTokens             += sess.output_tokens ?? 0
        entry.cacheReadInputTokens     += sess.cache_read_input_tokens ?? 0
        entry.cacheCreationInputTokens += sess.cache_creation_input_tokens ?? 0
      }
    } else if (dateFiltered) {
      // Build approximate model usage from dailyModelTokens (date-filtered, Claude-only).
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
      // Supplement with non-Claude sessions in range (unified view, date-filtered)
      for (const sess of nonClaudeInRange) {
        const m = sess.model
        if (!m) continue
        if (modelSet && !modelSet.has(m)) continue
        if (!filteredModelUsage[m]) {
          filteredModelUsage[m] = {
            inputTokens: 0, outputTokens: 0,
            cacheReadInputTokens: 0, cacheCreationInputTokens: 0,
            webSearchRequests: 0, costUSD: 0,
          }
        }
        const entry = filteredModelUsage[m]!
        entry.inputTokens              += sess.input_tokens ?? 0
        entry.outputTokens             += sess.output_tokens ?? 0
        entry.cacheReadInputTokens     += sess.cache_read_input_tokens ?? 0
        entry.cacheCreationInputTokens += sess.cache_creation_input_tokens ?? 0
      }
    } else {
      // No date filter, no project filter, no harness filter — use global statsCache (Claude)
      // then supplement with non-Claude sessions (unified view).
      if (modelSet) {
        filteredModelUsage = {}
        for (const m of modelSet) {
          if (globalModelUsage[m]) filteredModelUsage[m] = { ...globalModelUsage[m] }
        }
      } else {
        filteredModelUsage = { ...globalModelUsage }
      }
      // Supplement with non-Claude sessions (unified view, no date filter)
      for (const sess of nonClaudeInRange) {
        const m = sess.model
        if (!m) continue
        if (modelSet && !modelSet.has(m)) continue
        if (!filteredModelUsage[m]) {
          filteredModelUsage[m] = {
            inputTokens: 0, outputTokens: 0,
            cacheReadInputTokens: 0, cacheCreationInputTokens: 0,
            webSearchRequests: 0, costUSD: 0,
          }
        }
        const entry = filteredModelUsage[m]!
        entry.inputTokens              += sess.input_tokens ?? 0
        entry.outputTokens             += sess.output_tokens ?? 0
        entry.cacheReadInputTokens     += sess.cache_read_input_tokens ?? 0
        entry.cacheCreationInputTokens += sess.cache_creation_input_tokens ?? 0
      }
    }

    // ── Cost calculation ──
    let totalCostUSD = 0
    if (projectFiltered || nonClaudeHarness) {
      // Use per-session calcCost with the session's model field (includes cache tokens).
      // Also used when a non-Claude harness is selected (statsCache lacks harness granularity).
      // Sessions without a model fall back to blended rate on input+output only.
      const blended = blendedCostPerToken(globalModelUsage)
      const modelSetFallback = modelSet?.size === 1 ? [...modelSet][0]! : undefined
      for (const sess of filteredSessions) {
        const m = sess.model ?? modelSetFallback
        if (m) {
          totalCostUSD += calcCost({
            inputTokens: sess.input_tokens ?? 0,
            outputTokens: sess.output_tokens ?? 0,
            cacheReadInputTokens: sess.cache_read_input_tokens ?? 0,
            cacheCreationInputTokens: sess.cache_creation_input_tokens ?? 0,
            webSearchRequests: 0, costUSD: 0,
          }, m)
        } else {
          totalCostUSD += ((sess.input_tokens ?? 0) / 1_000_000) * blended.input
                       + ((sess.output_tokens ?? 0) / 1_000_000) * blended.output
        }
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
    // When a project filter is active, prefer project-level git stats from data.projects
    // (computed via `git log --numstat` — captures ALL commits, not just those run through
    // Claude's Bash tool).  Session-level git_commits only counts commits that Claude
    // explicitly ran via the Bash tool, so projects where the user commits from the
    // terminal would always show 0 in the session-based path.
    //
    // For multi-project filters we sum the stats across all selected projects that have
    // git_stats.  We fall back to session-based aggregation only when no project in the
    // filter has git_stats (e.g. the project is not a git repo).
    let projectLevelGitStats: { commits: number; linesAdded: number; linesRemoved: number; filesModified: number } | undefined

    if (projectFiltered) {
      const matched = projects
        .map(path => data.projects.find(p => p.path === path)?.git_stats)
        .filter((gs): gs is NonNullable<typeof gs> => gs !== undefined)

      if (matched.length > 0) {
        projectLevelGitStats = matched.reduce(
          (acc, gs) => ({
            commits: acc.commits + gs.commits,
            linesAdded: acc.linesAdded + gs.lines_added,
            linesRemoved: acc.linesRemoved + gs.lines_removed,
            filesModified: acc.filesModified + gs.files_modified,
          }),
          { commits: 0, linesAdded: 0, linesRemoved: 0, filesModified: 0 },
        )
      }
    }

    // COMMITS: prefer project-level git stats (counts all commits, not just Claude bash ones)
    const gitCommits = projectLevelGitStats
      ? projectLevelGitStats.commits
      : filteredSessions.reduce((s, sess) => s + (sess.git_commits ?? 0), 0)
    const gitPushes = projectLevelGitStats
      ? 0  // not tracked at project level
      : filteredSessions.reduce((s, sess) => s + (sess.git_pushes ?? 0), 0)
    const linesAdded = projectLevelGitStats
      ? projectLevelGitStats.linesAdded
      : filteredSessions.reduce((s, sess) => s + (sess.lines_added ?? 0), 0)
    const linesRemoved = projectLevelGitStats
      ? projectLevelGitStats.linesRemoved
      : filteredSessions.reduce((s, sess) => s + (sess.lines_removed ?? 0), 0)
    // FILES: always use session-level count (Edit/Write/MultiEdit calls) — this captures files
    // Claude created in non-git directories, which project-level git stats cannot see.
    const sessionFilesModified = filteredSessions.reduce((s, sess) => s + (sess.files_modified ?? 0), 0)
    const filesModified = sessionFilesModified > 0
      ? sessionFilesModified
      : (projectLevelGitStats?.filesModified ?? 0)

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
      streakLastActiveDate,
      longestStreak,
      streakDayBreakdown,
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
