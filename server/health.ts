import { readFile, unlink } from 'fs/promises'
import { join } from 'path'
import { exec } from 'child_process'
import { promisify } from 'util'
import type { HealthIssue, SessionMeta } from '../src/lib/types'
import { PROJECTS_DIR, STATS_CACHE_FILE } from './config'
import { safeReadDir, safeStat, safeReadJson } from './utils'

const execAsync = promisify(exec)

export async function runHealthChecks(): Promise<HealthIssue[]> {
  const issues: HealthIssue[] = []

  // 1. Check projects dir
  const projDirStat = await safeStat(PROJECTS_DIR)
  if (!projDirStat?.isDirectory()) {
    issues.push({
      id: 'projects-dir-missing',
      severity: 'error',
      title: 'Projects directory not found',
      description: `~/.claude/projects/ was not found (looked at: ${PROJECTS_DIR}).`,
      guide: [
        'Make sure Claude Code is installed:',
        '  npm install -g @anthropic-ai/claude-code',
        '',
        'Then use it at least once inside a project directory.',
        'Also verify that the HOME environment variable is set correctly.',
      ].join('\n'),
    })
    return issues
  }

  // 2. Check for any JSONL sessions and sample one for format checks
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
      title: 'No session files found',
      description: 'No JSONL session files were found in ~/.claude/projects/.',
      guide: [
        'Open a project in VS Code or a terminal and start a Claude Code session.',
        'Session files are created automatically when you first use Claude Code.',
      ].join('\n'),
    })
  }

  // 3. Check JSONL timestamp presence (old Claude Code versions didn't include it)
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
        title: 'Session files missing timestamps',
        description: 'JSONL files do not contain the "timestamp" field. Duration, hourly activity, and response-time metrics will be unavailable.',
        guide: 'Update Claude Code to the latest version:\n  npm install -g @anthropic-ai/claude-code',
      })
    }
  }

  // 4. Check git availability
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

  // 5. Auto-fix: stats-cache.json corrupt
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

  return issues
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
