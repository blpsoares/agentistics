/**
 * OpenTelemetry metrics definitions for Claude Stats.
 *
 * This module defines the OTLP metrics that the watcher/daemon exports.
 * All metrics use the "claude_stats" namespace and are designed to integrate
 * with any OpenTelemetry-compatible backend (Grafana, Datadog, New Relic, etc.).
 */

/** Shape of the gauge snapshot the watcher computes periodically. */
export interface OtelSnapshot {
  // Counters (cumulative totals)
  totalMessages: number
  totalSessions: number
  totalToolCalls: number
  totalInputTokens: number
  totalOutputTokens: number
  totalCostUsd: number
  totalGitCommits: number
  totalGitPushes: number
  totalLinesAdded: number
  totalLinesRemoved: number
  totalFilesModified: number

  // Gauges (current / point-in-time)
  streak: number
  longestSessionMinutes: number
  activeProjects: number

  // Per-model token breakdowns (attributes on metrics)
  modelTokens: Record<string, { input: number; output: number }>

  // Per-tool call counts
  toolCounts: Record<string, number>
}

/** Metric descriptor used for documentation / README generation. */
export interface MetricDescriptor {
  name: string
  description: string
  unit: string
  type: 'counter' | 'gauge'
}

export const METRIC_DESCRIPTORS: MetricDescriptor[] = [
  { name: 'claude_stats.messages.total',         description: 'Total messages (user + assistant)',      unit: '{messages}', type: 'counter' },
  { name: 'claude_stats.sessions.total',         description: 'Total sessions',                        unit: '{sessions}', type: 'counter' },
  { name: 'claude_stats.tool_calls.total',       description: 'Total tool calls',                      unit: '{calls}',    type: 'counter' },
  { name: 'claude_stats.tokens.input',           description: 'Total input tokens',                    unit: '{tokens}',   type: 'counter' },
  { name: 'claude_stats.tokens.output',          description: 'Total output tokens',                   unit: '{tokens}',   type: 'counter' },
  { name: 'claude_stats.cost.usd',               description: 'Estimated total cost in USD',           unit: 'USD',        type: 'counter' },
  { name: 'claude_stats.git.commits',            description: 'Total git commits via Claude',          unit: '{commits}',  type: 'counter' },
  { name: 'claude_stats.git.pushes',             description: 'Total git pushes via Claude',           unit: '{pushes}',   type: 'counter' },
  { name: 'claude_stats.git.lines_added',        description: 'Total lines added',                     unit: '{lines}',    type: 'counter' },
  { name: 'claude_stats.git.lines_removed',      description: 'Total lines removed',                   unit: '{lines}',    type: 'counter' },
  { name: 'claude_stats.git.files_modified',     description: 'Total files modified',                  unit: '{files}',    type: 'counter' },
  { name: 'claude_stats.streak',                 description: 'Current streak (consecutive active days)', unit: '{days}',  type: 'gauge'   },
  { name: 'claude_stats.longest_session',        description: 'Longest session duration',              unit: 'min',        type: 'gauge'   },
  { name: 'claude_stats.active_projects',        description: 'Number of active projects',             unit: '{projects}', type: 'gauge'   },
  { name: 'claude_stats.tokens.by_model.input',  description: 'Input tokens by model (model attribute)',  unit: '{tokens}', type: 'counter' },
  { name: 'claude_stats.tokens.by_model.output', description: 'Output tokens by model (model attribute)', unit: '{tokens}', type: 'counter' },
  { name: 'claude_stats.tool_calls.by_tool',     description: 'Tool calls by tool name (tool attribute)', unit: '{calls}',  type: 'counter' },
]
