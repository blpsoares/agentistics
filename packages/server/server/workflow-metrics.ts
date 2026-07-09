import { join } from 'path'
import { readFile } from 'fs/promises'
import type { WorkflowRun, WorkflowAgent } from '@agentistics/core'
import { safeReadDir } from './utils'
import { parseWorkflowScript } from './workflow-script'
import { parseWorkflowUsage } from './workflow-usage'
import { aggregateWorkflowAgent } from './workflow-agent'

interface DiscoveredRun {
  runId: string
  name: string
  scriptPath?: string
  startedAt: string
  notificationText: string
}

/** Scan the main session JSONL for workflow launches and their task-notifications. */
export function discoverWorkflowLaunches(lines: string[]): DiscoveredRun[] {
  const byRunId = new Map<string, DiscoveredRun>()
  for (const raw of lines) {
    const line = raw.trim()
    if (!line) continue
    let e: Record<string, unknown>
    try { e = JSON.parse(line) } catch { continue }

    // Launch: user message envelope with toolUseResult.taskType === 'local_workflow'
    const tur = e.toolUseResult as Record<string, unknown> | undefined
    if (tur && tur.taskType === 'local_workflow' && typeof tur.runId === 'string') {
      byRunId.set(tur.runId, {
        runId: tur.runId,
        name: (tur.workflowName as string) ?? '',
        scriptPath: tur.scriptPath as string | undefined,
        startedAt: (e.timestamp as string) ?? '',
        notificationText: '',
      })
    }

    // NOTE: when a session launches >=2 workflows concurrently and a
    // task-notification lacks a parseable runId, we cannot safely attribute it,
    // so its usage is left empty for that run. Single-workflow sessions use the
    // unambiguous fallback below. This is an accepted limitation (rare case).
    // Completion notification: a message whose text contains <task-notification> with a runId.
    const text = extractText(e)
    if (text && text.includes('<task-notification>')) {
      const runId = text.match(/<run-?id>\s*([^<\s]+)\s*<\/run-?id>/)?.[1]
        ?? text.match(/runId["']?\s*[:=]\s*["']?(wf_[a-z0-9-]+)/i)?.[1]
      if (runId && byRunId.has(runId)) byRunId.get(runId)!.notificationText = text
      else if (!runId && byRunId.size === 1) {
        // Single workflow in the session — attach unambiguously.
        const only = [...byRunId.values()][0]!
        only.notificationText = text
      }
    }
  }
  return [...byRunId.values()]
}

/** Sort agent-<n>.jsonl files by their numeric index so agent-2 precedes agent-10.
 *  Files without a parseable index sort last, stably, by name. */
export function sortAgentFiles(files: string[]): string[] {
  const idx = (f: string): number => {
    const m = f.match(/agent-(\d+)/)
    return m ? parseInt(m[1]!, 10) : Number.POSITIVE_INFINITY
  }
  return [...files].sort((a, b) => {
    const d = idx(a) - idx(b)
    return d !== 0 ? d : a.localeCompare(b)
  })
}

function extractText(e: Record<string, unknown>): string {
  const msg = e.message as Record<string, unknown> | undefined
  const content = msg?.content
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content.map(c => {
      const item = c as Record<string, unknown>
      return typeof item.text === 'string' ? item.text : (typeof item.content === 'string' ? item.content : '')
    }).join('\n')
  }
  return ''
}

/** Assemble WorkflowRun[] for a session given its main JSONL lines and the workflows dir. */
export async function extractWorkflowRuns(
  sessionLines: string[],
  sessionId: string,
  workflowsDir: string,
): Promise<WorkflowRun[]> {
  const launches = discoverWorkflowLaunches(sessionLines)
  const runs: WorkflowRun[] = []

  for (const launch of launches) {
    const runDir = join(workflowsDir, launch.runId)
    const files = await safeReadDir(runDir)

    // Script: prefer scriptPath, else a *.js inside scripts/ or the runDir.
    let scriptText = ''
    if (launch.scriptPath) scriptText = await readFile(launch.scriptPath, 'utf-8').catch(() => '')
    if (!scriptText) {
      const scriptsDir = join(workflowsDir, 'scripts')
      const scriptFiles = (await safeReadDir(scriptsDir)).filter(f => f.includes(launch.runId) && f.endsWith('.js'))
      if (scriptFiles[0]) scriptText = await readFile(join(scriptsDir, scriptFiles[0]), 'utf-8').catch(() => '')
    }
    const parsed = parseWorkflowScript(scriptText)

    // Per-agent transcripts: agent-*.jsonl in the run dir.
    const agentFiles = sortAgentFiles(files.filter(f => /^agent-.*\.jsonl$/.test(f)))
    const agents: WorkflowAgent[] = []
    for (let i = 0; i < agentFiles.length; i++) {
      const content = await readFile(join(runDir, agentFiles[i]!), 'utf-8').catch(() => '')
      const agg = aggregateWorkflowAgent(content.split('\n'))
      const meta = parsed.agents[i] // best-effort positional match to planned agents
      agents.push({
        label: meta?.label ?? agentFiles[i]!.replace(/\.jsonl$/, ''),
        phase: meta?.phase ?? '',
        model: agg.model || (meta?.model ?? ''),
        // NOTE: per-agent status is a best-effort 'completed'. The available data
        // (journal.jsonl + the task-notification <usage> counts) reports how many
        // agents errored/were skipped, but not WHICH agent — so a specific agent's
        // failure cannot be reliably attributed here. Top-level run status still
        // reflects errors via parseWorkflowUsage.
        status: 'completed',
        tokensIn: agg.tokensIn, tokensOut: agg.tokensOut,
        cacheRead: agg.cacheRead, cacheWrite: agg.cacheWrite,
        costUSD: agg.costUSD,
      })
    }

    const usage = parseWorkflowUsage(launch.notificationText)
    const phases = parsed.phases.map(title => ({ title, agentCount: agents.filter(a => a.phase === title).length }))
    const status: WorkflowRun['status'] = usage
      ? (usage.agentsError > 0 ? (usage.agentsDone > 0 ? 'partial' : 'failed') : 'completed')
      : 'completed'

    runs.push({
      runId: launch.runId,
      name: parsed.name || launch.name || launch.runId,
      sessionId,
      status,
      startedAt: launch.startedAt,
      durationMs: usage?.durationMs ?? 0,
      phases,
      agents,
      totals: {
        // The real agent transcripts are the source of truth; the <usage> count can be
        // missing/0 for some runs, so never let it under-report the agents we actually found.
        agentCount: Math.max(agents.length, usage?.agentCount ?? 0),
        tokensIn: agents.reduce((s, a) => s + a.tokensIn, 0),
        tokensOut: agents.reduce((s, a) => s + a.tokensOut, 0),
        costUSD: agents.reduce((s, a) => s + a.costUSD, 0),
        durationMs: usage?.durationMs ?? 0,
        toolUses: usage?.toolUses ?? 0,
      },
    })
  }
  return runs
}
