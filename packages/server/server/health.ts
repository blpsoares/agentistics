import { readFile, unlink } from 'fs/promises'
import { join } from 'path'
import { exec } from 'child_process'
import { promisify } from 'util'
import type { HealthIssue, SessionMeta, StatsCache } from '@agentistics/core'
import { PROJECTS_DIR, STATS_CACHE_FILE } from './config'
import { safeReadDir, safeStat, safeReadJson } from './utils'
import { getEnabledAdapters } from './adapters/types'

const execAsync = promisify(exec)

export async function runHealthChecks(): Promise<HealthIssue[]> {
  const issues: HealthIssue[] = []

  // Determine which harnesses are active so Claude-specific checks can be
  // skipped when only non-Claude harnesses are present.
  const enabledAdapters = await getEnabledAdapters()
  const enabledIds = new Set(enabledAdapters.map(a => a.id))
  const claudeEnabled = enabledIds.has('claude')

  // 1a. Claude-specific: projects directory
  if (claudeEnabled) {
    const projDirStat = await safeStat(PROJECTS_DIR)
    if (!projDirStat?.isDirectory()) {
      issues.push({
        id: 'projects-dir-missing',
        severity: 'error',
        title: 'Claude projects directory not found',
        description: `~/.claude/projects/ was not found (looked at: ${PROJECTS_DIR}).`,
        guide: [
          'Make sure Claude Code is installed:',
          '  npm install -g @anthropic-ai/claude-code',
          '',
          'Then use it at least once inside a project directory.',
          'Also verify that the HOME environment variable is set correctly.',
        ].join('\n'),
      })
      // Only bail out early if Claude is the sole harness; other harnesses may
      // still have data worth reporting.
      if (enabledIds.size === 1) return issues
    } else {
      // 1b. Check for any JSONL sessions and sample one for format checks
      const projectDirs = await safeReadDir(PROJECTS_DIR)
      let totalJsonl = 0
      let sampleJsonlPath: string | null = null

      for (const dir of projectDirs) {
        const entries = await safeReadDir(join(PROJECTS_DIR, dir))
        for (const entry of entries) {
          if (entry.endsWith('.jsonl')) {
            totalJsonl++
            if (!sampleJsonlPath) sampleJsonlPath = join(PROJECTS_DIR, dir, entry)
          }
        }
        if (totalJsonl >= 5 && sampleJsonlPath) break
      }

      if (totalJsonl === 0) {
        issues.push({
          id: 'no-sessions',
          severity: 'warning',
          title: 'No Claude session files found',
          description: 'No JSONL session files were found in ~/.claude/projects/.',
          guide: [
            'Open a project in VS Code or a terminal and start a Claude Code session.',
            'Session files are created automatically when you first use Claude Code.',
          ].join('\n'),
        })
      }

      // 2. Check JSONL timestamp presence (old Claude Code versions didn't include it)
      if (sampleJsonlPath) {
        let hasTimestamp = false
        try {
          const content = await readFile(sampleJsonlPath, 'utf-8')
          for (const line of content.split('\n').slice(0, 30)) {
            const t = line.trim()
            if (!t) continue
            try {
              const obj = JSON.parse(t) as Record<string, unknown>
              if (obj.timestamp) { hasTimestamp = true; break }
            } catch { continue }
          }
        } catch { /* ignore */ }

        if (!hasTimestamp) {
          issues.push({
            id: 'jsonl-no-timestamps',
            severity: 'warning',
            title: 'Claude session files missing timestamps',
            description: 'JSONL files do not contain the "timestamp" field. Duration, hourly activity, and response-time metrics will be unavailable.',
            guide: 'Update Claude Code to the latest version:\n  npm install -g @anthropic-ai/claude-code',
          })
        }
      }
    }

    // 3. Auto-fix: stats-cache.json corrupt (Claude-only file).
    // Runs unconditionally when Claude is enabled — even when projects dir is
    // missing, a corrupt cache file should still be removed so Claude Code can
    // rebuild it on its next startup.
    const cacheStat = await safeStat(STATS_CACHE_FILE)
    if (cacheStat !== null) {
      const cacheData = await safeReadJson<Record<string, unknown>>(STATS_CACHE_FILE)
      if (cacheData === null) {
        try {
          await unlink(STATS_CACHE_FILE)
          console.log('[health] Deleted corrupt stats-cache.json')
          issues.push({
            id: 'stats-cache-reset',
            severity: 'info',
            title: 'Stats cache was corrupt — auto-fixed',
            description: 'stats-cache.json was corrupt and has been automatically removed. Token counts and model breakdowns will be recalculated on the next Claude Code session.',
            auto_fixed: true,
          })
        } catch { /* ignore */ }
      }
    }
  }

  // 4. Light data-root check for each non-Claude enabled adapter
  for (const adapter of enabledAdapters) {
    if (adapter.id === 'claude') continue
    const rootStat = await safeStat(adapter.dataRoot)
    if (!rootStat?.isDirectory()) {
      issues.push({
        id: `harness-dir-missing-${adapter.id}`,
        severity: 'info',
        title: `${adapter.id} data directory not found`,
        description: `The ${adapter.id} harness is enabled but its data directory does not exist yet (${adapter.dataRoot}).`,
        guide: `Use ${adapter.id} at least once to generate session data, or disable the harness with AGENTISTICS_HARNESS_${adapter.id.toUpperCase()}=0.`,
      })
    }
  }

  // 5. Check git availability
  try {
    await execAsync('git --version', { timeout: 3000 })
  } catch {
    issues.push({
      id: 'git-unavailable',
      severity: 'info',
      title: 'git not found in PATH',
      description: 'Commit counts and line-change metrics will be zero because the git binary is unavailable.',
      guide: 'Install git:\n  https://git-scm.com/downloads\n\nOn Debian/Ubuntu:\n  sudo apt install git',
    })
  }

  return issues
}

/** Warn when ~/.claude/stats-cache.json is outdated relative to the most recent JSONL session.
 *  Claude Code normally refreshes this cache; when it lags, agentistics supplements from
 *  JSONL (see `supplementStatsCache` in server/data.ts) but the user should still be informed.
 *  Only Claude sessions are compared — statsCache is Claude-only. */
export function analyzeCacheStaleness(
  statsCache: StatsCache,
  sessions: SessionMeta[],
  issues: HealthIssue[],
): void {
  const lastComputed = statsCache.lastComputedDate
  if (!lastComputed || sessions.length === 0) return

  // Filter to Claude sessions only — statsCache is Claude-only and comparing
  // non-Claude session dates against it would produce false staleness warnings.
  const claudeSessions = sessions.filter(s => !s.harness || s.harness === 'claude')
  if (claudeSessions.length === 0) return

  let mostRecentDay = ''
  for (const s of claudeSessions) {
    if (!s.start_time) continue
    const day = s.start_time.slice(0, 10)
    if (day > mostRecentDay) mostRecentDay = day
  }
  if (!mostRecentDay || mostRecentDay <= lastComputed) return

  const daysBehind = Math.max(1, Math.round(
    (Date.parse(mostRecentDay + 'T00:00:00Z') - Date.parse(lastComputed + 'T00:00:00Z')) / 86_400_000,
  ))
  issues.push({
    id: 'stats-cache-stale',
    severity: 'warning',
    title: `Stats cache outdated by ${daysBehind} day${daysBehind === 1 ? '' : 's'}`,
    description: `~/.claude/stats-cache.json was last computed on ${lastComputed} but sessions exist through ${mostRecentDay}. Recent activity has been supplemented from JSONL files so charts remain accurate.`,
    guide: [
      'Claude Code normally refreshes this cache automatically.',
      'If the warning persists across launches, delete the file to force a rebuild:',
      '  rm ~/.claude/stats-cache.json',
    ].join('\n'),
  })
}

/** Analyze tool metrics from sessions and add health alerts for outliers */
export function analyzeToolHealthIssues(sessions: SessionMeta[], issues: HealthIssue[]): void {
  if (sessions.length === 0) return

  // Aggregate tool output tokens across all sessions
  const toolTokens: Record<string, number> = {}
  const agentReads: Record<string, number> = {}
  let totalToolOutputTokens = 0

  for (const s of sessions) {
    for (const [tool, tokens] of Object.entries(s.tool_output_tokens ?? {})) {
      toolTokens[tool] = (toolTokens[tool] ?? 0) + tokens
      totalToolOutputTokens += tokens
    }
    for (const [file, count] of Object.entries(s.agent_file_reads ?? {})) {
      agentReads[file] = (agentReads[file] ?? 0) + count
    }
  }

  // Alert: single tool consuming >60% of total output tokens
  // Require a minimum of 10K tokens to avoid noisy alerts on small data sets
  if (totalToolOutputTokens > 10000) {
    const sorted = Object.entries(toolTokens).sort((a, b) => b[1] - a[1])
    const top = sorted[0]
    if (top && top[1] / totalToolOutputTokens > 0.6) {
      const pct = Math.round(top[1] / totalToolOutputTokens * 100)
      issues.push({
        id: 'tool-token-villain',
        severity: 'info',
        title: `Tool "${top[0]}" dominates token spend (${pct}%)`,
        description: `The "${top[0]}" tool accounts for ${pct}% of all tool-related output tokens. Consider if this tool is being used efficiently.`,
        guide: [
          `Top tools by output tokens:`,
          ...sorted.slice(0, 5).map(([name, tokens]) =>
            `  ${name}: ${(tokens / 1000).toFixed(1)}K tokens (${Math.round(tokens / totalToolOutputTokens * 100)}%)`
          ),
        ].join('\n'),
      })
    }
  }

  // Alert: high agent file read frequency
  const totalAgentReads = Object.values(agentReads).reduce((a, b) => a + b, 0)
  if (totalAgentReads > 50) {
    const sorted = Object.entries(agentReads).sort((a, b) => b[1] - a[1])
    issues.push({
      id: 'agent-file-reads-high',
      severity: 'info',
      title: `Agent instruction files read ${totalAgentReads} times`,
      description: `Agent-like files (CLAUDE.md, AGENTS.md, etc.) have been read ${totalAgentReads} times across sessions. Each read adds to context and token consumption.`,
      guide: [
        `Reads by file type:`,
        ...sorted.map(([name, count]) => `  ${name}: ${count} reads`),
        '',
        'Tip: Keep instruction files concise to reduce token overhead.',
        'Consider consolidating multiple instruction files into one.',
      ].join('\n'),
    })
  }
}
