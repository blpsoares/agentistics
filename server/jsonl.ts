import { readFile } from 'fs/promises'
import type { SessionMeta } from '../src/lib/types'
import { getGitFileStats } from './git'
import { extractAgentMetrics } from './agent-metrics'

// File extension → language name (used when session-meta is absent)
export const EXT_TO_LANG: Record<string, string> = {
  ts: 'TypeScript', tsx: 'TypeScript', js: 'JavaScript', jsx: 'JavaScript',
  mjs: 'JavaScript', cjs: 'JavaScript',
  py: 'Python', rb: 'Ruby', go: 'Go', rs: 'Rust', java: 'Java',
  cs: 'C#', cpp: 'C++', cc: 'C++', cxx: 'C++', c: 'C', h: 'C', hpp: 'C++',
  php: 'PHP', swift: 'Swift', kt: 'Kotlin', scala: 'Scala',
  sh: 'Shell', bash: 'Shell', zsh: 'Shell',
  sql: 'SQL', html: 'HTML', css: 'CSS', scss: 'CSS', sass: 'CSS',
  json: 'JSON', yaml: 'YAML', yml: 'YAML', toml: 'TOML', xml: 'XML',
  md: 'Markdown', mdx: 'Markdown',
  r: 'R', lua: 'Lua', dart: 'Dart', ex: 'Elixir', exs: 'Elixir',
  clj: 'Clojure', hs: 'Haskell', ml: 'OCaml', fs: 'F#',
  vue: 'Vue', svelte: 'Svelte',
}

// Agent-like instruction file patterns (basename matching)
export const AGENT_FILE_CATEGORY: Map<string, string> = new Map([
  ['claude.md', 'CLAUDE.md'],
  ['claude_instructions.md', 'CLAUDE.md'],
  ['agents.md', 'AGENTS.md'],
  ['codex.md', 'CODEX.md'],
  ['.cursorrules', '.cursorrules'],
  ['.cursorignore', 'cursor-config'],
  ['conventions.md', 'CONVENTIONS.md'],
  ['copilot-instructions.md', 'copilot-instructions'],
  ['.copilot-instructions.md', 'copilot-instructions'],
  ['.windsurfrules', '.windsurfrules'],
])

// Agent-like instruction file path patterns (directory-based matching)
// Use (^|\/) to match both absolute and relative paths
export const AGENT_PATH_PATTERNS: [RegExp, string][] = [
  [/(^|\/)\.claude\//i, '.claude/*'],
  [/(^|\/)\.github\/copilot-instructions/i, 'copilot-instructions'],
  [/(^|\/)\.cursor\//i, '.cursorrules'],
  [/(^|\/)\.windsurf\//i, '.windsurfrules'],
  [/(^|\/)AGENTS\.md$/i, 'AGENTS.md'],
  [/(^|\/)CLAUDE\.md$/i, 'CLAUDE.md'],
]

/** Classify a file path as an agent instruction file category or null */
export function classifyAgentFile(filePath: string): string | null {
  if (!filePath) return null
  const normalized = filePath.replace(/\\/g, '/')
  const basename = normalized.split('/').pop()?.toLowerCase() ?? ''

  const category = AGENT_FILE_CATEGORY.get(basename)
  if (category) return category

  for (const [pattern, cat] of AGENT_PATH_PATTERNS) {
    if (pattern.test(normalized)) return cat
  }

  return null
}

export function makeEmptySession(
  sessionId: string,
  projectPath: string,
  startTime: string,
  firstPrompt: string,
  source: 'jsonl' | 'subdir'
): SessionMeta {
  return {
    session_id: sessionId,
    project_path: projectPath,
    start_time: startTime,
    duration_minutes: 0,
    user_message_count: 0,
    assistant_message_count: 0,
    tool_counts: {},
    tool_output_tokens: {},
    agent_file_reads: {},
    languages: [],
    git_commits: 0,
    git_pushes: 0,
    input_tokens: 0,
    output_tokens: 0,
    first_prompt: firstPrompt,
    user_interruptions: 0,
    user_response_times: [],
    tool_errors: 0,
    tool_error_categories: {},
    uses_task_agent: false,
    uses_mcp: false,
    uses_web_search: false,
    uses_web_fetch: false,
    lines_added: 0,
    lines_removed: 0,
    files_modified: 0,
    message_hours: [],
    user_message_timestamps: [],
    _source: source,
  }
}

/** Parse an entire JSONL session file and extract full metrics. */
export async function parseSessionJsonl(
  filePath: string,
  sessionId: string,
  fallbackPath: string,
  source: 'jsonl' | 'subdir'
): Promise<SessionMeta> {
  let content: string
  try {
    content = await readFile(filePath, 'utf-8')
  } catch {
    return makeEmptySession(sessionId, fallbackPath, '', '', source)
  }

  let cwd = '', startTime = '', lastTime = '', firstPrompt = '', modelId = ''
  let userMsgs = 0, assistantMsgs = 0, inputTokens = 0, outputTokens = 0
  let gitCommits = 0, gitPushes = 0
  let toolErrors = 0, userInterruptions = 0
  let hasMcp = false
  const toolCounts: Record<string, number> = {}
  const toolOutputTokens: Record<string, number> = {}
  const agentFileReads: Record<string, number> = {}
  const toolErrorCategories: Record<string, number> = {}
  const messageHours: number[] = []
  const userMessageTimestamps: string[] = []
  const userResponseTimes: number[] = []
  const languageSet = new Set<string>()
  // Maps tool_use_id → tool name for error attribution
  const toolUseIdToName = new Map<string, string>()
  let lastAssistantTs = ''

  for (const raw of content.split('\n')) {
    const line = raw.trim()
    if (!line) continue
    let e: Record<string, unknown>
    try { e = JSON.parse(line) } catch { continue }

    if (!cwd && e.cwd) cwd = e.cwd as string
    const ts = e.timestamp as string | undefined
    if (ts) {
      if (!startTime) startTime = ts
      lastTime = ts
      try { messageHours.push(new Date(ts).getHours()) } catch { /* skip */ }
    }

    if (e.type === 'user') {
      const msgContent = (e.message as Record<string, unknown> | undefined)?.content
      const contentArr = Array.isArray(msgContent) ? msgContent as Record<string, unknown>[] : null

      // Tool result messages: content is an array where every item is type='tool_result'
      const isPureToolResult = contentArr !== null && contentArr.length > 0 &&
        contentArr.every(p => p.type === 'tool_result')

      if (isPureToolResult) {
        // Count tool errors and attribute them to the originating tool
        for (const p of contentArr!) {
          if (p.is_error === true) {
            toolErrors++
            const toolName = toolUseIdToName.get(p.tool_use_id as string) ?? 'unknown'
            toolErrorCategories[toolName] = (toolErrorCategories[toolName] ?? 0) + 1
          }
        }
      } else {
        // Real human message (initial prompt or interruption)
        userMsgs++
        if (ts) {
          userMessageTimestamps.push(ts)
          // Response time: how long since the last assistant message
          if (lastAssistantTs) {
            const delta = (new Date(ts).getTime() - new Date(lastAssistantTs).getTime()) / 1000
            if (delta >= 0 && delta < 3600) userResponseTimes.push(Math.round(delta))
          }
        }
        // All messages after the first count as interruptions
        if (userMsgs > 1) userInterruptions++

        if (!firstPrompt && contentArr) {
          for (const p of contentArr) {
            if (p.type === 'text' && typeof p.text === 'string') {
              firstPrompt = (p.text as string).slice(0, 200)
              break
            }
          }
        } else if (!firstPrompt && typeof msgContent === 'string') {
          firstPrompt = msgContent.slice(0, 200)
        }
      }
    } else if (e.type === 'assistant') {
      assistantMsgs++
      if (ts) lastAssistantTs = ts
      const msg = e.message as Record<string, unknown> | undefined
      if (!modelId && typeof msg?.model === 'string') modelId = msg.model
      const msgOutputTokens = (msg?.usage as Record<string, number> | undefined)?.output_tokens ?? 0
      if (msg?.usage) {
        const u = msg.usage as Record<string, number>
        inputTokens  += u.input_tokens ?? 0
        outputTokens += u.output_tokens ?? 0
      }
      // Collect tool names in this message for token attribution
      const toolsInMessage: string[] = []
      if (Array.isArray(msg?.content)) {
        for (const p of msg!.content as Record<string, unknown>[]) {
          if (p.type === 'tool_use' && typeof p.name === 'string') {
            const toolName = p.name as string
            toolCounts[toolName] = (toolCounts[toolName] ?? 0) + 1
            toolsInMessage.push(toolName)

            // Track id→name for error attribution
            if (typeof p.id === 'string') toolUseIdToName.set(p.id, toolName)

            if (toolName.startsWith('mcp__')) hasMcp = true

            // Count git commits/pushes from Bash tool calls
            if (toolName === 'Bash') {
              const cmd = (p.input as Record<string, string> | undefined)?.command ?? ''
              for (const seg of cmd.split(/&&|\|\||;|\n/)) {
                const s = seg.trim()
                if (/^(cd\s+\S+\s+&&\s+)?git\s+commit\b/.test(s)) gitCommits++
                if (/^(cd\s+\S+\s+&&\s+)?git\s+push\b/.test(s)) gitPushes++
              }
            }

            // Detect language and agent files from file-based tool calls
            if (['Read', 'Edit', 'Write', 'MultiEdit'].includes(toolName)) {
              const inp = p.input as Record<string, string> | undefined
              const fp = inp?.file_path ?? inp?.path ?? ''
              if (fp) {
                const ext = fp.split('.').pop()?.toLowerCase() ?? ''
                const lang = EXT_TO_LANG[ext]
                if (lang) languageSet.add(lang)

                // Detect agent instruction file reads (Read tool only — Glob/Grep/Search
                // operate on patterns/queries rather than file paths, so they are excluded
                // to avoid false positives)
                if (toolName === 'Read') {
                  const agentCategory = classifyAgentFile(fp)
                  if (agentCategory) {
                    agentFileReads[agentCategory] = (agentFileReads[agentCategory] ?? 0) + 1
                  }
                }
              }
            }

          }
        }
      }
      // Attribute output tokens evenly among tools in this message
      if (toolsInMessage.length > 0 && msgOutputTokens > 0) {
        const share = Math.floor(msgOutputTokens / toolsInMessage.length)
        const remainder = msgOutputTokens % toolsInMessage.length
        for (let i = 0; i < toolsInMessage.length; i++) {
          const tn = toolsInMessage[i]
          if (tn === undefined) continue
          toolOutputTokens[tn] = (toolOutputTokens[tn] ?? 0) + share + (i < remainder ? 1 : 0)
        }
      }
    }
  }

  const durationMinutes = (startTime && lastTime)
    ? Math.max(0, Math.round((new Date(lastTime).getTime() - new Date(startTime).getTime()) / 60000))
    : 0

  const projectPath = cwd || fallbackPath
  const gitFileStats = gitCommits > 0
    ? await getGitFileStats(projectPath, startTime, lastTime)
    : { linesAdded: 0, linesRemoved: 0, filesModified: 0 }

  // Extract agent metrics if this session used the Agent tool
  const agentMetrics = toolCounts['Agent']
    ? extractAgentMetrics(content.split('\n'), modelId)
    : undefined

  return {
    session_id: sessionId,
    project_path: projectPath,
    start_time: startTime,
    duration_minutes: durationMinutes,
    user_message_count: userMsgs,
    assistant_message_count: assistantMsgs,
    tool_counts: toolCounts,
    tool_output_tokens: toolOutputTokens,
    agent_file_reads: agentFileReads,
    languages: Array.from(languageSet),
    git_commits: gitCommits,
    git_pushes: gitPushes,
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    first_prompt: firstPrompt,
    user_interruptions: userInterruptions,
    user_response_times: userResponseTimes,
    tool_errors: toolErrors,
    tool_error_categories: toolErrorCategories,
    uses_task_agent: 'Task' in toolCounts || 'Agent' in toolCounts,
    uses_mcp: hasMcp,
    uses_web_search: 'WebSearch' in toolCounts,
    uses_web_fetch: 'WebFetch' in toolCounts,
    lines_added: gitFileStats.linesAdded,
    lines_removed: gitFileStats.linesRemoved,
    files_modified: gitFileStats.filesModified,
    message_hours: messageHours,
    user_message_timestamps: userMessageTimestamps,
    _source: source,
    agentMetrics,
  }
}
