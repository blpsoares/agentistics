import type { HarnessId, HarnessCapabilities } from '@agentistics/core'
import { HARNESS_CAPABILITIES } from '@agentistics/core'

export const HARNESS_LABELS: Record<HarnessId, string> = {
  claude: 'Claude Code',
  codex: 'Codex CLI',
  gemini: 'Gemini CLI',
  copilot: 'Copilot CLI',
}

export const HARNESS_COLORS: Record<HarnessId, string> = {
  claude: '#D97706',
  codex: '#10a37f',
  gemini: '#4285f4',
  copilot: '#6e7681',
}

export function capable(harness: HarnessId, metric: keyof HarnessCapabilities): boolean {
  return HARNESS_CAPABILITIES[harness][metric]
}

export interface HarnessInfo {
  source: string[]
  contains: string[]
  missing: { item: string; why: string }[]
  note?: string
}

export const HARNESS_INFO: Record<HarnessId, HarnessInfo> = {
  claude: {
    source: [
      '~/.claude/stats-cache.json (aggregate history)',
      '~/.claude/projects/**/*.jsonl (transcripts)',
      '~/.claude/usage-data/session-meta/',
    ],
    contains: [
      'Tokens (input, output, cache read/write)',
      'Cost (USD)',
      'Model per session',
      'Tool usage',
      'Sub-agent metrics',
      'Git line counts',
      'Full session history',
    ],
    missing: [],
    note: 'The stats cache retains aggregate totals even after Claude Code deletes transcripts older than its cleanup window (default 30 days), so historical session/token/cost totals survive.',
  },
  codex: {
    source: [
      '~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl',
    ],
    contains: [
      'Tokens (input, cached, output)',
      'Cost (USD)',
      'Model (e.g. gpt-5.5)',
      'Tool usage (e.g. web search)',
      'Messages',
      'Project (working directory)',
    ],
    missing: [
      { item: 'Sub-agent metrics', why: 'Codex does not record per-subagent breakdowns in its transcripts.' },
      { item: 'Git line counts', why: 'Not present in Codex transcripts.' },
    ],
    note: 'Codex reports input_tokens including the cached portion; agentistics stores the non-cached input separately from cache reads so cost is not double-counted.',
  },
  gemini: {
    source: [
      '~/.gemini/tmp/<project>/chats/*.json (rich session format)',
      '~/.gemini/projects.json (project names)',
    ],
    contains: [
      'Sessions',
      'Projects',
      'Messages',
      'Tokens (input, output, cache)',
      'Cost (USD)',
      'Model per session',
      'Tool usage',
      'Activity (real-content sessions only)',
    ],
    missing: [
      { item: 'Sub-agent metrics', why: 'Gemini CLI does not record per-subagent breakdowns.' },
      { item: 'Git line counts', why: 'Not present in Gemini session files.' },
    ],
    note: 'Many local Gemini files are bootstrap-only stubs with no real conversation — only sessions containing genuine user messages are counted. Token/cost/model data comes from the rich ~/.gemini/tmp/<project>/chats/*.json format. Agent metrics and git line counts are N/A.',
  },
  copilot: {
    source: [
      '~/.copilot/session-state/<id>/events.jsonl',
      '~/.copilot/session-state/<id>/workspace.yaml',
    ],
    contains: [
      'Sessions',
      'Project / repository / branch',
      'Messages',
      'Assistant turns',
      'Tokens (input, output)',
      'Cost (USD)',
      'Model per session',
      'Git line counts',
      'MCP usage',
      'Activity',
    ],
    missing: [
      { item: 'Tool usage', why: 'Copilot CLI does not record per-tool call breakdowns.' },
      { item: 'Sub-agent metrics', why: 'Not available in Copilot local event logs.' },
    ],
    note: 'Token/cost/model/git-lines data is emitted in the session.shutdown event on clean exit only — sessions that crashed will show 0 for those fields.',
  },
}
