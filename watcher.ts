/**
 * Claude Stats — Watcher / Daemon mode with optional OpenTelemetry export.
 *
 * This module watches ~/.claude/ for file changes and periodically recomputes
 * metrics. When OTEL_EXPORTER_OTLP_ENDPOINT is set, it exports metrics via
 * the OpenTelemetry OTLP/HTTP protocol.
 *
 * The watcher is fully optional — the main dashboard (`bun run dev`) works
 * without it. Run `bun run watch` only when you want OTLP metrics export.
 *
 * Usage:
 *   OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318 bun run watch
 *
 * Environment variables:
 *   OTEL_EXPORTER_OTLP_ENDPOINT  — OTLP collector endpoint (required for export)
 *   OTEL_EXPORTER_OTLP_HEADERS   — Extra headers (e.g. "Authorization=Bearer tok")
 *   OTEL_SERVICE_NAME             — Service name (default: "claude-stats")
 *   CLAUDE_STATS_WATCH_INTERVAL   — Polling interval in seconds (default: 30, min: 5)
 */

import { readdir, readFile, stat } from 'fs/promises'
import { watch as fsWatch } from 'fs'
import { join } from 'path'

// ── OpenTelemetry imports ──────────────────────────────────────────────────

import { metrics, ValueType } from '@opentelemetry/api'
import { MeterProvider, PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics'
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-http'
import { Resource } from '@opentelemetry/resources'
import { ATTR_SERVICE_NAME } from '@opentelemetry/semantic-conventions'

// ── Shared imports from the main codebase ──────────────────────────────────

import { getModelPrice, calcCost } from './src/lib/types'
import type { ModelUsage } from './src/lib/types'
import type { OtelSnapshot } from './src/lib/otel'

// ── Configuration ──────────────────────────────────────────────────────────

const HOME_DIR = process.env.HOME ?? process.env.USERPROFILE ?? ''
const CLAUDE_DIR = join(HOME_DIR, '.claude')
const PROJECTS_DIR = join(CLAUDE_DIR, 'projects')
const SESSION_META_DIR = join(CLAUDE_DIR, 'usage-data', 'session-meta')
const STATS_CACHE_FILE = join(CLAUDE_DIR, 'stats-cache.json')

const MIN_INTERVAL_SEC = 5
const rawInterval = parseInt(process.env.CLAUDE_STATS_WATCH_INTERVAL ?? '30', 10)
const WATCH_INTERVAL_SEC = (!Number.isFinite(rawInterval) || rawInterval < MIN_INTERVAL_SEC)
  ? (() => {
      if (process.env.CLAUDE_STATS_WATCH_INTERVAL) {
        console.warn(`[config] Invalid CLAUDE_STATS_WATCH_INTERVAL="${process.env.CLAUDE_STATS_WATCH_INTERVAL}", using default 30s`)
      }
      return 30
    })()
  : rawInterval

const SERVICE_NAME = process.env.OTEL_SERVICE_NAME ?? 'claude-stats'
const OTLP_ENDPOINT = process.env.OTEL_EXPORTER_OTLP_ENDPOINT ?? ''
const OTLP_HEADERS = process.env.OTEL_EXPORTER_OTLP_HEADERS ?? ''

// ── Helpers ────────────────────────────────────────────────────────────────

async function safeReadJson<T>(filePath: string): Promise<T | null> {
  try {
    const content = await readFile(filePath, 'utf-8')
    return JSON.parse(content) as T
  } catch {
    return null
  }
}

async function safeReadDir(dirPath: string): Promise<string[]> {
  try {
    return await readdir(dirPath)
  } catch {
    return []
  }
}

async function safeStat(filePath: string) {
  try {
    return await stat(filePath)
  } catch {
    return null
  }
}

// ── Concurrency limiter (same pattern as server.ts) ───────────────────────

function createLimiter(concurrency: number) {
  let running = 0
  const queue: Array<() => void> = []

  return function limit<T>(fn: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const run = () => {
        running++
        fn()
          .then(resolve, reject)
          .finally(() => {
            running--
            if (queue.length > 0) {
              const next = queue.shift()!
              next()
            }
          })
      }

      if (running < concurrency) {
        run()
      } else {
        queue.push(run)
      }
    })
  }
}

// ── Snapshot builder ──────────────────────────────────────────────────────

interface StatsCache {
  dailyActivity?: Array<{ date: string; messageCount: number; sessionCount: number; toolCallCount: number }>
  modelUsage?: Record<string, ModelUsage>
  longestSession?: { duration: number }
}

interface SessionMetaLight {
  session_id: string
  project_path: string
  tool_counts: Record<string, number>
  git_commits: number
  git_pushes: number
  lines_added: number
  lines_removed: number
  files_modified: number
}

async function buildSnapshot(): Promise<OtelSnapshot> {
  const statsCache = await safeReadJson<StatsCache>(STATS_CACHE_FILE) ?? {}

  // Load session-meta files in parallel with concurrency limit
  const metaFiles = (await safeReadDir(SESSION_META_DIR)).filter(f => f.endsWith('.json'))
  const limit = createLimiter(20)
  const sessions: SessionMetaLight[] = []

  await Promise.all(
    metaFiles.map(f =>
      limit(async () => {
        const data = await safeReadJson<SessionMetaLight>(join(SESSION_META_DIR, f))
        if (data) sessions.push(data)
      })
    )
  )

  // Aggregate from stats-cache (preferred for totals)
  const dailyActivity = statsCache.dailyActivity ?? []
  const totalMessages = dailyActivity.reduce((s, d) => s + d.messageCount, 0)
  const totalSessions = dailyActivity.reduce((s, d) => s + d.sessionCount, 0)
  const totalToolCalls = dailyActivity.reduce((s, d) => s + d.toolCallCount, 0)

  // Streak
  const activeDates = new Set(dailyActivity.map(d => d.date))
  const today = new Date()
  let streak = 0
  for (let i = 0; i <= 365; i++) {
    const d = new Date(today)
    d.setDate(d.getDate() - i)
    const dateStr = d.toISOString().slice(0, 10)
    if (activeDates.has(dateStr)) streak++
    else if (i > 0) break
  }

  // Model tokens — use shared calcCost from types.ts
  const modelUsage = statsCache.modelUsage ?? {}
  const modelTokens: Record<string, { input: number; output: number }> = {}
  let totalCostUsd = 0
  let totalInputTokens = 0
  let totalOutputTokens = 0

  for (const [modelId, u] of Object.entries(modelUsage)) {
    const inp = u.inputTokens + (u.cacheReadInputTokens ?? 0) + (u.cacheCreationInputTokens ?? 0)
    const out = u.outputTokens
    modelTokens[modelId] = { input: inp, output: out }
    totalInputTokens += inp
    totalOutputTokens += out
    totalCostUsd += calcCost(u, modelId)
  }

  // From sessions
  const toolCounts: Record<string, number> = {}
  let totalGitCommits = 0
  let totalGitPushes = 0
  let totalLinesAdded = 0
  let totalLinesRemoved = 0
  let totalFilesModified = 0
  const projectPaths = new Set<string>()

  for (const s of sessions) {
    totalGitCommits += s.git_commits ?? 0
    totalGitPushes += s.git_pushes ?? 0
    totalLinesAdded += s.lines_added ?? 0
    totalLinesRemoved += s.lines_removed ?? 0
    totalFilesModified += s.files_modified ?? 0
    if (s.project_path) projectPaths.add(s.project_path)

    for (const [tool, count] of Object.entries(s.tool_counts ?? {})) {
      toolCounts[tool] = (toolCounts[tool] ?? 0) + count
    }
  }

  return {
    totalMessages,
    totalSessions,
    totalToolCalls,
    totalInputTokens,
    totalOutputTokens,
    totalCostUsd,
    totalGitCommits,
    totalGitPushes,
    totalLinesAdded,
    totalLinesRemoved,
    totalFilesModified,
    streak,
    longestSessionMinutes: statsCache.longestSession?.duration ?? 0,
    activeProjects: projectPaths.size,
    modelTokens,
    toolCounts,
  }
}

// ── OpenTelemetry setup ──────────────────────────────────────────────────

function parseOtlpHeaders(raw: string): Record<string, string> {
  const headers: Record<string, string> = {}
  if (!raw) return headers
  for (const pair of raw.split(',')) {
    const idx = pair.indexOf('=')
    if (idx > 0) {
      headers[pair.slice(0, idx).trim()] = pair.slice(idx + 1).trim()
    }
  }
  return headers
}

function buildOtlpUrl(endpoint: string): string {
  const base = endpoint.replace(/\/$/, '')
  // Don't append /v1/metrics if the user already included it
  if (base.endsWith('/v1/metrics')) return base
  return base + '/v1/metrics'
}

let latestSnapshot: OtelSnapshot | null = null

function setupOtel(): { shutdown: () => Promise<void> } | null {
  if (!OTLP_ENDPOINT) {
    console.log('[otel] No OTEL_EXPORTER_OTLP_ENDPOINT set — metrics export disabled')
    return null
  }

  const exporter = new OTLPMetricExporter({
    url: buildOtlpUrl(OTLP_ENDPOINT),
    headers: parseOtlpHeaders(OTLP_HEADERS),
  })

  const reader = new PeriodicExportingMetricReader({
    exporter,
    exportIntervalMillis: WATCH_INTERVAL_SEC * 1000,
  })

  const resource = new Resource({
    [ATTR_SERVICE_NAME]: SERVICE_NAME,
  })

  const meterProvider = new MeterProvider({
    resource,
    readers: [reader],
  })

  metrics.setGlobalMeterProvider(meterProvider)

  const meter = metrics.getMeter('claude-stats', '1.0.0')

  // ── Define instruments (all observable gauges — point-in-time snapshots) ──

  const messagesTotal = meter.createObservableGauge('claude_stats.messages.total', {
    description: 'Total messages (user + assistant)',
    unit: '{messages}',
    valueType: ValueType.INT,
  })
  messagesTotal.addCallback(obs => {
    if (latestSnapshot) obs.observe(latestSnapshot.totalMessages)
  })

  const sessionsTotal = meter.createObservableGauge('claude_stats.sessions.total', {
    description: 'Total sessions',
    unit: '{sessions}',
    valueType: ValueType.INT,
  })
  sessionsTotal.addCallback(obs => {
    if (latestSnapshot) obs.observe(latestSnapshot.totalSessions)
  })

  const toolCallsTotal = meter.createObservableGauge('claude_stats.tool_calls.total', {
    description: 'Total tool calls',
    unit: '{calls}',
    valueType: ValueType.INT,
  })
  toolCallsTotal.addCallback(obs => {
    if (latestSnapshot) obs.observe(latestSnapshot.totalToolCalls)
  })

  const inputTokens = meter.createObservableGauge('claude_stats.tokens.input', {
    description: 'Total input tokens',
    unit: '{tokens}',
    valueType: ValueType.INT,
  })
  inputTokens.addCallback(obs => {
    if (latestSnapshot) obs.observe(latestSnapshot.totalInputTokens)
  })

  const outputTokens = meter.createObservableGauge('claude_stats.tokens.output', {
    description: 'Total output tokens',
    unit: '{tokens}',
    valueType: ValueType.INT,
  })
  outputTokens.addCallback(obs => {
    if (latestSnapshot) obs.observe(latestSnapshot.totalOutputTokens)
  })

  const costUsd = meter.createObservableGauge('claude_stats.cost.usd', {
    description: 'Estimated total cost in USD',
    unit: 'USD',
    valueType: ValueType.DOUBLE,
  })
  costUsd.addCallback(obs => {
    if (latestSnapshot) obs.observe(latestSnapshot.totalCostUsd)
  })

  const gitCommits = meter.createObservableGauge('claude_stats.git.commits', {
    description: 'Total git commits via Claude',
    unit: '{commits}',
    valueType: ValueType.INT,
  })
  gitCommits.addCallback(obs => {
    if (latestSnapshot) obs.observe(latestSnapshot.totalGitCommits)
  })

  const gitPushes = meter.createObservableGauge('claude_stats.git.pushes', {
    description: 'Total git pushes via Claude',
    unit: '{pushes}',
    valueType: ValueType.INT,
  })
  gitPushes.addCallback(obs => {
    if (latestSnapshot) obs.observe(latestSnapshot.totalGitPushes)
  })

  const linesAdded = meter.createObservableGauge('claude_stats.git.lines_added', {
    description: 'Total lines added',
    unit: '{lines}',
    valueType: ValueType.INT,
  })
  linesAdded.addCallback(obs => {
    if (latestSnapshot) obs.observe(latestSnapshot.totalLinesAdded)
  })

  const linesRemoved = meter.createObservableGauge('claude_stats.git.lines_removed', {
    description: 'Total lines removed',
    unit: '{lines}',
    valueType: ValueType.INT,
  })
  linesRemoved.addCallback(obs => {
    if (latestSnapshot) obs.observe(latestSnapshot.totalLinesRemoved)
  })

  const filesModified = meter.createObservableGauge('claude_stats.git.files_modified', {
    description: 'Total files modified',
    unit: '{files}',
    valueType: ValueType.INT,
  })
  filesModified.addCallback(obs => {
    if (latestSnapshot) obs.observe(latestSnapshot.totalFilesModified)
  })

  const streakGauge = meter.createObservableGauge('claude_stats.streak', {
    description: 'Current streak (consecutive active days)',
    unit: '{days}',
    valueType: ValueType.INT,
  })
  streakGauge.addCallback(obs => {
    if (latestSnapshot) obs.observe(latestSnapshot.streak)
  })

  const longestSessionGauge = meter.createObservableGauge('claude_stats.longest_session', {
    description: 'Longest session duration',
    unit: 'min',
    valueType: ValueType.INT,
  })
  longestSessionGauge.addCallback(obs => {
    if (latestSnapshot) obs.observe(latestSnapshot.longestSessionMinutes)
  })

  const activeProjectsGauge = meter.createObservableGauge('claude_stats.active_projects', {
    description: 'Number of active projects',
    unit: '{projects}',
    valueType: ValueType.INT,
  })
  activeProjectsGauge.addCallback(obs => {
    if (latestSnapshot) obs.observe(latestSnapshot.activeProjects)
  })

  // Per-model token gauges
  const modelInputTokens = meter.createObservableGauge('claude_stats.tokens.by_model.input', {
    description: 'Input tokens by model',
    unit: '{tokens}',
    valueType: ValueType.INT,
  })
  modelInputTokens.addCallback(obs => {
    if (!latestSnapshot) return
    for (const [model, t] of Object.entries(latestSnapshot.modelTokens)) {
      obs.observe(t.input, { model })
    }
  })

  const modelOutputTokens = meter.createObservableGauge('claude_stats.tokens.by_model.output', {
    description: 'Output tokens by model',
    unit: '{tokens}',
    valueType: ValueType.INT,
  })
  modelOutputTokens.addCallback(obs => {
    if (!latestSnapshot) return
    for (const [model, t] of Object.entries(latestSnapshot.modelTokens)) {
      obs.observe(t.output, { model })
    }
  })

  // Per-tool call gauge
  const toolCallsByTool = meter.createObservableGauge('claude_stats.tool_calls.by_tool', {
    description: 'Tool calls by tool name',
    unit: '{calls}',
    valueType: ValueType.INT,
  })
  toolCallsByTool.addCallback(obs => {
    if (!latestSnapshot) return
    for (const [tool, count] of Object.entries(latestSnapshot.toolCounts)) {
      obs.observe(count, { tool })
    }
  })

  console.log(`[otel] Exporting metrics to ${OTLP_ENDPOINT} every ${WATCH_INTERVAL_SEC}s (service.name="${SERVICE_NAME}")`)

  return {
    shutdown: () => meterProvider.shutdown(),
  }
}

// ── File watcher ──────────────────────────────────────────────────────────

async function watchDirectory(dir: string, onChange: () => void): Promise<void> {
  const dirStat = await safeStat(dir)
  if (!dirStat?.isDirectory()) {
    console.warn(`[watcher] Directory not found: ${dir}`)
    return
  }

  try {
    fsWatch(dir, { recursive: true }, () => {
      onChange()
    })
    console.log(`[watcher] Watching ${dir}`)
  } catch (err) {
    console.warn(`[watcher] Failed to watch ${dir}:`, String(err))
  }
}

// ── Snapshot rebuild serialization ────────────────────────────────────────

let snapshotInFlight = false
let snapshotPending = false

async function rebuildSnapshot(): Promise<void> {
  if (snapshotInFlight) {
    // Another rebuild is running — schedule a follow-up after it finishes
    snapshotPending = true
    return
  }

  snapshotInFlight = true
  try {
    latestSnapshot = await buildSnapshot()
    console.log(`[snapshot] Messages=${latestSnapshot.totalMessages} Sessions=${latestSnapshot.totalSessions} Cost=$${latestSnapshot.totalCostUsd.toFixed(2)} Streak=${latestSnapshot.streak}d Projects=${latestSnapshot.activeProjects}`)
  } catch (err) {
    console.error('[snapshot] Error:', String(err))
  } finally {
    snapshotInFlight = false
    // If another trigger came in while we were building, run again
    if (snapshotPending) {
      snapshotPending = false
      void rebuildSnapshot()
    }
  }
}

// ── Main ─────────────────────────────────────────────────────────────────

async function main() {
  console.log('╔══════════════════════════════════════════════╗')
  console.log('║       Claude Stats — Watcher / Daemon       ║')
  console.log('╚══════════════════════════════════════════════╝')
  console.log()
  console.log(`  Home:       ${HOME_DIR}`)
  console.log(`  Claude dir: ${CLAUDE_DIR}`)
  console.log(`  Interval:   ${WATCH_INTERVAL_SEC}s`)
  console.log(`  OTLP:       ${OTLP_ENDPOINT || '(disabled)'}`)
  console.log()

  // Initial snapshot
  await rebuildSnapshot()

  // Setup OpenTelemetry export
  const otel = setupOtel()

  // Debounce: after a file change, wait a short delay before rebuilding
  let debounceTimer: ReturnType<typeof setTimeout> | null = null
  const DEBOUNCE_MS = 2000

  const triggerUpdate = () => {
    if (debounceTimer) clearTimeout(debounceTimer)
    debounceTimer = setTimeout(() => rebuildSnapshot(), DEBOUNCE_MS)
  }

  // Watch directories for changes
  await Promise.all([
    watchDirectory(SESSION_META_DIR, triggerUpdate),
    watchDirectory(PROJECTS_DIR, triggerUpdate),
  ])

  // Also do periodic polling as a fallback (fs.watch can miss events)
  setInterval(() => rebuildSnapshot(), WATCH_INTERVAL_SEC * 1000)

  console.log('[watcher] Running — use `bun run dev` in a separate terminal for the dashboard UI')

  // Graceful shutdown
  const shutdown = async () => {
    console.log('\n[watcher] Shutting down...')
    if (otel) await otel.shutdown()
    process.exit(0)
  }

  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
}

main().catch(err => {
  console.error('Fatal error:', err)
  process.exit(1)
})
