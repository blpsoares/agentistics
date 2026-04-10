import { readdir, readFile, stat, unlink } from 'fs/promises'
import { watch as fsWatch } from 'fs'
import { join } from 'path'
import { exec, spawn } from 'child_process'
import { promisify } from 'util'

const execAsync = promisify(exec)

const HOME_DIR = process.env.HOME ?? process.env.USERPROFILE ?? ''
const CLAUDE_DIR = join(HOME_DIR, '.claude')
const PROJECTS_DIR = join(CLAUDE_DIR, 'projects')
const SESSION_META_DIR = join(CLAUDE_DIR, 'usage-data', 'session-meta')
const STATS_CACHE_FILE = join(CLAUDE_DIR, 'stats-cache.json')
const PORT = 3001

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface StatsCache {
  [key: string]: unknown
}

interface ProjectGitStats {
  commits: number
  lines_added: number
  lines_removed: number
  files_modified: number
  since: string   // earliest commit date found
}

interface Project {
  path: string
  name: string
  sessions: { sessionId: string; created: string }[]
  git_stats?: ProjectGitStats
}

interface SessionMeta {
  session_id: string
  project_path: string
  start_time: string
  duration_minutes: number
  user_message_count: number
  assistant_message_count: number
  tool_counts: Record<string, number>
  languages: string[]
  git_commits: number
  git_pushes: number
  input_tokens: number
  output_tokens: number
  first_prompt: string
  user_interruptions: number
  user_response_times: number[]
  tool_errors: number
  tool_error_categories: Record<string, number>
  uses_task_agent: boolean
  uses_mcp: boolean
  uses_web_search: boolean
  uses_web_fetch: boolean
  lines_added: number
  lines_removed: number
  files_modified: number
  message_hours: number[]
  user_message_timestamps: string[]
  _source: 'meta' | 'jsonl' | 'subdir'
}

interface HealthIssue {
  id: string
  severity: 'error' | 'warning' | 'info'
  title: string
  description: string
  guide?: string
  auto_fixed?: boolean
}

interface ApiResponse {
  statsCache: StatsCache
  projects: Project[]
  allSessions: []
  sessions: SessionMeta[]
  healthIssues: HealthIssue[]
  homeDir: string
}

// ---------------------------------------------------------------------------
// Concurrency limiter
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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

function makeEmptySession(
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
async function parseSessionJsonl(
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

  let cwd = '', startTime = '', lastTime = '', firstPrompt = ''
  let userMsgs = 0, assistantMsgs = 0, inputTokens = 0, outputTokens = 0
  let gitCommits = 0, gitPushes = 0
  let toolErrors = 0, userInterruptions = 0
  let hasMcp = false
  const toolCounts: Record<string, number> = {}
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
      if (msg?.usage) {
        const u = msg.usage as Record<string, number>
        inputTokens  += u.input_tokens ?? 0
        outputTokens += u.output_tokens ?? 0
      }
      if (Array.isArray(msg?.content)) {
        for (const p of msg!.content as Record<string, unknown>[]) {
          if (p.type === 'tool_use' && typeof p.name === 'string') {
            const toolName = p.name as string
            toolCounts[toolName] = (toolCounts[toolName] ?? 0) + 1

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

            // Detect language from file-based tool calls
            if (['Read', 'Edit', 'Write', 'MultiEdit'].includes(toolName)) {
              const inp = p.input as Record<string, string> | undefined
              const fp = inp?.file_path ?? inp?.path ?? ''
              if (fp) {
                const ext = fp.split('.').pop()?.toLowerCase() ?? ''
                const lang = EXT_TO_LANG[ext]
                if (lang) languageSet.add(lang)
              }
            }
          }
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

  return {
    session_id: sessionId,
    project_path: projectPath,
    start_time: startTime,
    duration_minutes: durationMinutes,
    user_message_count: userMsgs,
    assistant_message_count: assistantMsgs,
    tool_counts: toolCounts,
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
  }
}

async function getGitFileStats(
  projectPath: string,
  afterIso: string,
  beforeIso: string
): Promise<{ linesAdded: number; linesRemoved: number; filesModified: number }> {
  const empty = { linesAdded: 0, linesRemoved: 0, filesModified: 0 }
  if (!projectPath || !afterIso || !beforeIso) return empty
  try {
    // add 1 minute buffer on each side so the commits made during the session are included
    const after = new Date(new Date(afterIso).getTime() - 60_000).toISOString()
    const before = new Date(new Date(beforeIso).getTime() + 60_000).toISOString()
    const { stdout } = await execAsync(
      `git -C "${projectPath}" log --numstat --after="${after}" --before="${before}" --format=""`,
      { timeout: 5000 }
    )
    let linesAdded = 0, linesRemoved = 0
    const filesSeen = new Set<string>()
    for (const line of stdout.split('\n')) {
      const m = line.match(/^(\d+)\s+(\d+)\s+(.+)$/)
      if (m) {
        linesAdded += parseInt(m[1], 10)
        linesRemoved += parseInt(m[2], 10)
        filesSeen.add(m[3])
      }
    }
    return { linesAdded, linesRemoved, filesModified: filesSeen.size }
  } catch {
    return empty
  }
}

async function getProjectGitStats(projectPath: string): Promise<ProjectGitStats | undefined> {
  try {
    // Check if it's a git repo
    await execAsync(`git -C "${projectPath}" rev-parse --git-dir`, { timeout: 3000 })
  } catch {
    return undefined
  }
  try {
    const { stdout } = await execAsync(
      `git -C "${projectPath}" log --numstat --format="COMMIT %H %ai" HEAD`,
      { timeout: 10000 }
    )
    let commits = 0, linesAdded = 0, linesRemoved = 0
    const filesSeen = new Set<string>()
    let since = ''
    for (const line of stdout.split('\n')) {
      if (line.startsWith('COMMIT ')) {
        commits++
        const date = line.split(' ')[2]
        if (date && (!since || date < since)) since = date
      } else {
        const m = line.match(/^(\d+)\s+(\d+)\s+(.+)$/)
        if (m) {
          linesAdded += parseInt(m[1], 10)
          linesRemoved += parseInt(m[2], 10)
          filesSeen.add(m[3])
        }
      }
    }
    if (commits === 0) return undefined
    return { commits, lines_added: linesAdded, lines_removed: linesRemoved, files_modified: filesSeen.size, since }
  } catch {
    return undefined
  }
}

// UUID regex: 8-4-4-4-12 hex groups
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// File extension → language name (used when session-meta is absent)
const EXT_TO_LANG: Record<string, string> = {
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

// ---------------------------------------------------------------------------
// Load session-meta files (rich data, recent sessions only)
// ---------------------------------------------------------------------------

async function loadSessionMetas(): Promise<Map<string, SessionMeta>> {
  const map = new Map<string, SessionMeta>()
  const files = await safeReadDir(SESSION_META_DIR)
  const limit = createLimiter(20)

  await Promise.all(
    files
      .filter(f => f.endsWith('.json'))
      .map(f =>
        limit(async () => {
          const data = await safeReadJson<Record<string, unknown>>(join(SESSION_META_DIR, f))
          if (!data) return

          const sessionId = (data.session_id as string) ?? f.replace(/\.json$/, '')
          if (!sessionId) return

          // Normalise languages: may arrive as Record<string,number> or string[]
          let languages: string[] = []
          if (Array.isArray(data.languages)) {
            languages = data.languages as string[]
          } else if (data.languages && typeof data.languages === 'object') {
            languages = Object.keys(data.languages as object)
          }

          const meta: SessionMeta = {
            session_id: sessionId,
            project_path: (data.project_path as string) ?? '',
            start_time: (data.start_time as string) ?? '',
            duration_minutes: (data.duration_minutes as number) ?? 0,
            user_message_count: (data.user_message_count as number) ?? 0,
            assistant_message_count: (data.assistant_message_count as number) ?? 0,
            tool_counts: (data.tool_counts as Record<string, number>) ?? {},
            languages,
            git_commits: (data.git_commits as number) ?? 0,
            git_pushes: (data.git_pushes as number) ?? 0,
            input_tokens: (data.input_tokens as number) ?? 0,
            output_tokens: (data.output_tokens as number) ?? 0,
            first_prompt: (data.first_prompt as string) ?? '',
            user_interruptions: (data.user_interruptions as number) ?? 0,
            user_response_times: (data.user_response_times as number[]) ?? [],
            tool_errors: (data.tool_errors as number) ?? 0,
            tool_error_categories: (data.tool_error_categories as Record<string, number>) ?? {},
            uses_task_agent: (data.uses_task_agent as boolean) ?? false,
            uses_mcp: (data.uses_mcp as boolean) ?? false,
            uses_web_search: (data.uses_web_search as boolean) ?? false,
            uses_web_fetch: (data.uses_web_fetch as boolean) ?? false,
            lines_added: (data.lines_added as number) ?? 0,
            lines_removed: (data.lines_removed as number) ?? 0,
            files_modified: (data.files_modified as number) ?? 0,
            message_hours: (() => {
              const timestamps = (data.user_message_timestamps as string[]) ?? []
              if (timestamps.length > 0) {
                return timestamps.flatMap(ts => {
                  try { return [new Date(ts).getHours()] } catch { return [] }
                })
              }
              return (data.message_hours as number[]) ?? []
            })(),
            user_message_timestamps: (data.user_message_timestamps as string[]) ?? [],
            _source: 'meta',
          }

          map.set(sessionId, meta)
        })
      )
  )

  return map
}

// ---------------------------------------------------------------------------
// Decode project directory name → filesystem path
// ---------------------------------------------------------------------------

function decodeProjectDir(dirName: string): string {
  // Claude encodes absolute paths by replacing every '/' with '-'
  // The leading '-' corresponds to the leading '/' of an absolute path
  if (dirName.startsWith('-')) {
    return dirName.replace(/-/g, '/')
  }
  // Relative or unknown — just return as-is prefixed with /
  return '/' + dirName.replace(/-/g, '/')
}

// ---------------------------------------------------------------------------
// Scan all project directories for Format A (direct .jsonl) and
// Format B (UUID subdir with subagents/) sessions
// ---------------------------------------------------------------------------

interface ScanResult {
  projects: Project[]
  extraSessions: SessionMeta[]
}

async function scanProjectDir(
  projDir: string,
  knownIds: Set<string>,
  metaMap: Map<string, SessionMeta>,
  fileLimit: ReturnType<typeof createLimiter>
): Promise<{ project: Project; extraSessions: SessionMeta[] } | null> {
  const projDirPath = join(PROJECTS_DIR, projDir)
  const dirStat = await safeStat(projDirPath)
  if (!dirStat?.isDirectory()) return null

  // Fallback path (ambiguous for dir names that contain dashes)
  const fallbackPath = decodeProjectDir(projDir)
  const entries = await safeReadDir(projDirPath)

  const projectSessions: { sessionId: string; created: string }[] = []
  const extraSessions: SessionMeta[] = []
  // Count CWD occurrences to pick the canonical project path (majority wins)
  const cwdCounts: Record<string, number> = { [fallbackPath]: 0 }

  // Process all entries in this project dir in parallel (no shared limit with outer)
  await Promise.all(entries.map(async entry => {
    // ----------------------------------------------------------
    // Format A: <session-uuid>.jsonl — direct JSONL file
    // ----------------------------------------------------------
    if (entry.endsWith('.jsonl')) {
      const sessionId = entry.replace(/\.jsonl$/, '')
      const filePath = join(projDirPath, entry)

      projectSessions.push({ sessionId, created: '' })

      // If we already have this session in meta, count its project_path as a CWD vote
      const metaEntry = metaMap.get(sessionId)
      if (metaEntry?.project_path) {
        cwdCounts[metaEntry.project_path] = (cwdCounts[metaEntry.project_path] ?? 0) + 1
      }

      if (!knownIds.has(sessionId)) {
        const session = await fileLimit(() => parseSessionJsonl(filePath, sessionId, fallbackPath, 'jsonl'))
        cwdCounts[session.project_path] = (cwdCounts[session.project_path] ?? 0) + 1
        extraSessions.push(session)
      }
      return
    }

    // ----------------------------------------------------------
    // Format B: <uuid>/ directory with subagents/ inside
    // ----------------------------------------------------------
    if (!UUID_RE.test(entry)) return
    const entryPath = join(projDirPath, entry)
    const entryStat = await safeStat(entryPath)
    if (!entryStat?.isDirectory()) return

    const sessionId = entry
    let created = ''

    // If we already have this session in meta, count its project_path as a CWD vote
    const metaEntry = metaMap.get(sessionId)
    if (metaEntry?.project_path) {
      cwdCounts[metaEntry.project_path] = (cwdCounts[metaEntry.project_path] ?? 0) + 1
    }

    const subagentsDir = join(entryPath, 'subagents')
    // Read only the FIRST agent file to get cwd/timestamp
    const agentFiles = (await safeReadDir(subagentsDir))
      .filter(f => f.endsWith('.jsonl'))
      .sort()

    if (agentFiles.length > 0) {
      const agentFilePath = join(subagentsDir, agentFiles[0])
      if (!knownIds.has(sessionId)) {
        const session = await fileLimit(() => parseSessionJsonl(agentFilePath, sessionId, fallbackPath, 'subdir'))
        created = session.start_time
        cwdCounts[session.project_path] = (cwdCounts[session.project_path] ?? 0) + 1
        extraSessions.push(session)
      } else {
        // Already in meta — just grab the timestamp cheaply
        const metaCwdEntry = metaMap.get(sessionId)
        created = metaCwdEntry?.start_time ?? ''
      }
    }

    projectSessions.push({ sessionId, created })
  }))

  if (projectSessions.length === 0) return null

  // Use most-common CWD as canonical project path (majority-vote resolves dash-ambiguity
  // and prevents rogue subagent CWDs from hijacking the project path)
  const projectPath = Object.entries(cwdCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || fallbackPath

  // Normalize all extra sessions to the canonical project path
  for (const s of extraSessions) s.project_path = projectPath

  const git_stats = await getProjectGitStats(projectPath)

  return {
    project: {
      path: projectPath,
      name: projectPath.split('/').filter(Boolean).pop() ?? projDir,
      sessions: projectSessions.sort((a, b) => b.created.localeCompare(a.created)),
      git_stats,
    },
    extraSessions,
  }
}

async function scanProjects(knownIds: Set<string>, metaMap: Map<string, SessionMeta>): Promise<ScanResult> {
  // Separate limiter just for file reads (not project dir traversal)
  const fileLimit = createLimiter(30)
  const projectDirs = await safeReadDir(PROJECTS_DIR)

  // Process project dirs in parallel (they mostly do readdirs + parallel file reads)
  const results = await Promise.all(
    projectDirs.map(projDir => scanProjectDir(projDir, knownIds, metaMap, fileLimit))
  )

  const projects: Project[] = []
  const extraSessions: SessionMeta[] = []

  for (const result of results) {
    if (!result) continue
    projects.push(result.project)
    extraSessions.push(...result.extraSessions)
  }

  // Sort projects by session count descending
  projects.sort((a, b) => b.sessions.length - a.sessions.length)

  return { projects, extraSessions }
}

// ---------------------------------------------------------------------------
// Enrich project session `created` from meta map where missing
// ---------------------------------------------------------------------------

function enrichProjectSessions(projects: Project[], metaMap: Map<string, SessionMeta>): void {
  for (const project of projects) {
    for (const s of project.sessions) {
      if (!s.created) {
        const meta = metaMap.get(s.sessionId)
        if (meta?.start_time) s.created = meta.start_time
      }
    }
    // Re-sort after enrichment
    project.sessions.sort((a, b) => b.created.localeCompare(a.created))
  }
}

// ---------------------------------------------------------------------------
// Health checks — run on every request, auto-fix what's possible silently
// ---------------------------------------------------------------------------

async function runHealthChecks(): Promise<HealthIssue[]> {
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
    const cacheData = await safeReadJson<StatsCache>(STATS_CACHE_FILE)
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

// ---------------------------------------------------------------------------
// Main data loader
// ---------------------------------------------------------------------------

async function buildApiResponse(): Promise<ApiResponse> {
  const timeoutMs = 25000

  const buildPromise = async () => {
    const [statsCache, metaMap, healthIssues] = await Promise.all([
      safeReadJson<StatsCache>(STATS_CACHE_FILE).then(v => v ?? {}),
      loadSessionMetas(),
      runHealthChecks(),
    ])

    const knownIds = new Set(metaMap.keys())
    const { projects, extraSessions } = await scanProjects(knownIds, metaMap)

    // Enrich project session created timestamps from meta where possible
    enrichProjectSessions(projects, metaMap)

    const metaSessions = Array.from(metaMap.values())
    const allSessionsRaw: SessionMeta[] = [...metaSessions, ...extraSessions]

    // Deduplicate by session_id — same UUID can appear as both .jsonl AND UUID subdir
    // Prefer: meta > jsonl > subdir
    const sourceRank: Record<string, number> = { meta: 0, jsonl: 1, subdir: 2 }
    const sessionMap = new Map<string, SessionMeta>()
    for (const s of allSessionsRaw) {
      const existing = sessionMap.get(s.session_id)
      if (!existing || sourceRank[s._source] < sourceRank[existing._source]) {
        sessionMap.set(s.session_id, s)
      }
    }
    const sessions = Array.from(sessionMap.values())

    // Sort sessions by start_time descending (most recent first)
    sessions.sort((a, b) => b.start_time.localeCompare(a.start_time))

    return { statsCache, projects, allSessions: [] as [], sessions, healthIssues, homeDir: HOME_DIR }
  }

  return Promise.race([
    buildPromise(),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Request timed out after 9.5s')), timeoutMs)
    ),
  ])
}

// ---------------------------------------------------------------------------
// Live rates: BRL/USD + Anthropic pricing
// ---------------------------------------------------------------------------

interface PriceEntry { input: number; output: number; cacheRead: number; cacheWrite: number }

const FALLBACK_PRICING: Record<string, PriceEntry> = {
  'claude-opus-4-6':            { input: 5,    output: 25,   cacheRead: 0.50, cacheWrite: 6.25  },
  'claude-sonnet-4-6':          { input: 3,    output: 15,   cacheRead: 0.30, cacheWrite: 3.75  },
  'claude-haiku-4-5-20251001':  { input: 1,    output: 5,    cacheRead: 0.10, cacheWrite: 1.25  },
  'claude-opus-4-5-20251101':   { input: 5,    output: 25,   cacheRead: 0.50, cacheWrite: 6.25  },
  'claude-opus-4-1-20250805':   { input: 15,   output: 75,   cacheRead: 1.50, cacheWrite: 18.75 },
  'claude-opus-4-20250514':     { input: 15,   output: 75,   cacheRead: 1.50, cacheWrite: 18.75 },
  'claude-sonnet-4-5-20250929': { input: 3,    output: 15,   cacheRead: 0.30, cacheWrite: 3.75  },
  'claude-sonnet-4-20250514':   { input: 3,    output: 15,   cacheRead: 0.30, cacheWrite: 3.75  },
  'claude-haiku-3-5-20241022':  { input: 0.80, output: 4,    cacheRead: 0.08, cacheWrite: 1.00  },
  'claude-3-haiku-20240307':    { input: 0.25, output: 1.25, cacheRead: 0.03, cacheWrite: 0.30  },
}

interface RatesCache {
  fetchedAt: number
  brlRate: number
  pricing: Record<string, PriceEntry>
  pricingSource: 'live' | 'fallback'
}

let ratesCache: RatesCache | null = null
const RATES_TTL_MS = 30 * 60 * 1000 // 30 minutes

async function fetchBrlRate(): Promise<number> {
  try {
    const res = await fetch('https://economia.awesomeapi.com.br/json/last/USD-BRL', {
      signal: AbortSignal.timeout(5000),
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const json = await res.json() as Record<string, { bid: string }>
    const rate = parseFloat(json?.USDBRL?.bid ?? '')
    if (!isNaN(rate) && rate > 1 && rate < 20) return rate
  } catch (err) {
    console.warn('[rates] BRL fetch failed:', String(err))
  }
  return 5.70 // fallback
}

/** Model name (as shown in pricing table) → canonical model ID */
const PRICING_PAGE_MODEL_MAP: Record<string, string> = {
  'opus 4.6':   'claude-opus-4-6',
  'opus 4.5':   'claude-opus-4-5-20251101',
  'opus 4.1':   'claude-opus-4-1-20250805',
  'opus 4':     'claude-opus-4-20250514',
  'sonnet 4.6': 'claude-sonnet-4-6',
  'sonnet 4.5': 'claude-sonnet-4-5-20250929',
  'sonnet 4':   'claude-sonnet-4-20250514',
  'haiku 4.5':  'claude-haiku-4-5-20251001',
  'haiku 3.5':  'claude-haiku-3-5-20241022',
  'haiku 3':    'claude-3-haiku-20240307',
}

function parseAnthropicPricing(html: string): Record<string, PriceEntry> | null {
  const pricing: Record<string, PriceEntry> = {}

  // The pricing table has rows like:
  // <tr><td>Claude Opus 4.6</td><td>$5 / MTok</td><td>$6.25 / MTok</td><td>$10 / MTok</td><td>$0.50 / MTok</td><td>$25 / MTok</td></tr>
  // Columns: Model | Base Input | 5m Cache Write | 1h Cache Write | Cache Read | Output
  const rowRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi
  let rowMatch: RegExpExecArray | null

  while ((rowMatch = rowRe.exec(html)) !== null) {
    const row = rowMatch[1]
    const cells: string[] = []
    const cellRe = /<td[^>]*>([\s\S]*?)<\/td>/gi
    let cellMatch: RegExpExecArray | null
    while ((cellMatch = cellRe.exec(row)) !== null) {
      cells.push(cellMatch[1].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim())
    }
    if (cells.length < 5) continue

    const nameCell = cells[0].toLowerCase()
    if (!nameCell.includes('claude')) continue

    let modelId: string | null = null
    // Longer keys first so "opus 4.6" matches before "opus 4"
    const keys = Object.keys(PRICING_PAGE_MODEL_MAP).sort((a, b) => b.length - a.length)
    for (const key of keys) {
      if (nameCell.includes(key)) {
        modelId = PRICING_PAGE_MODEL_MAP[key]
        break
      }
    }
    if (!modelId) continue

    const price = (s: string) => parseFloat(s.replace(/[^0-9.]/g, ''))
    const input      = price(cells[1]) // Base Input
    const cacheWrite = price(cells[2]) // 5m Cache Write
    // cells[3] = 1h Cache Write (skip)
    const cacheRead  = price(cells[4]) // Cache Read
    const output     = price(cells[5] ?? '') // Output (may be cells[4] if table only has 5 cols)

    if (!isNaN(input) && input > 0) {
      pricing[modelId] = {
        input,
        output:     isNaN(output)     ? input * 5  : output,
        cacheRead:  isNaN(cacheRead)  ? input * 0.1  : cacheRead,
        cacheWrite: isNaN(cacheWrite) ? input * 1.25 : cacheWrite,
      }
    }
  }

  return Object.keys(pricing).length >= 3 ? pricing : null
}

async function fetchAnthropicPricing(): Promise<{ pricing: Record<string, PriceEntry>; source: 'live' | 'fallback' }> {
  try {
    const res = await fetch('https://platform.claude.com/docs/en/about-claude/pricing', {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; claude-stats/1.0; +https://github.com)' },
      signal: AbortSignal.timeout(8000),
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const html = await res.text()
    const parsed = parseAnthropicPricing(html)
    if (parsed) {
      console.log('[rates] Anthropic pricing fetched live:', Object.keys(parsed).join(', '))
      return { pricing: { ...FALLBACK_PRICING, ...parsed }, source: 'live' }
    }
    console.warn('[rates] Anthropic pricing parse returned no results, using fallback')
  } catch (err) {
    console.warn('[rates] Anthropic pricing fetch failed:', String(err))
  }
  return { pricing: FALLBACK_PRICING, source: 'fallback' }
}

async function getRates(): Promise<RatesCache> {
  const now = Date.now()
  if (ratesCache && now - ratesCache.fetchedAt < RATES_TTL_MS) return ratesCache

  const [brlRate, { pricing, source: pricingSource }] = await Promise.all([
    fetchBrlRate(),
    fetchAnthropicPricing(),
  ])

  ratesCache = { fetchedAt: now, brlRate, pricing, pricingSource }
  console.log(`[rates] BRL=${brlRate.toFixed(2)} pricing=${pricingSource}`)
  return ratesCache
}

// ---------------------------------------------------------------------------
// Bun HTTP server
// ---------------------------------------------------------------------------

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
}

// ---------------------------------------------------------------------------
// SSE — real-time file-change notifications for the dashboard
// ---------------------------------------------------------------------------

type SseController = ReadableStreamDefaultController<Uint8Array>

const sseClients = new Set<SseController>()
const sseEncoder = new TextEncoder()

function notifySseClients() {
  const payload = sseEncoder.encode('event: change\ndata: {}\n\n')
  for (const ctrl of [...sseClients]) {
    try {
      ctrl.enqueue(payload)
    } catch {
      sseClients.delete(ctrl)
    }
  }
}

let sseDebounce: ReturnType<typeof setTimeout> | null = null

function triggerSseNotification() {
  if (sseDebounce) clearTimeout(sseDebounce)
  sseDebounce = setTimeout(notifySseClients, 2000)
}

function setupFileWatcher() {
  // NOTE: `{ recursive: true }` is not supported on Linux (silently ignored).
  // SESSION_META_DIR files are written directly in the directory — a
  // non-recursive watch is sufficient. PROJECTS_DIR is watched for top-level
  // directory creation; the periodic poll in watcher.ts covers subdirectory
  // changes on Linux.
  const watch = (dir: string) => {
    try {
      fsWatch(dir, triggerSseNotification)
      console.log(`[watcher] Watching ${dir}`)
    } catch (err) {
      console.warn(`[watcher] Could not watch ${dir}:`, String(err))
    }
  }
  watch(SESSION_META_DIR)
  watch(PROJECTS_DIR)
}

// ---------------------------------------------------------------------------
// Optional: spawn watcher.ts as a child process when OTel env vars are set
// ---------------------------------------------------------------------------

function maybeSpawnWatcher() {
  if (!process.env.OTEL_EXPORTER_OTLP_ENDPOINT) return

  const watcherPath = join(import.meta.dir, 'watcher.ts')
  console.log('[server] OTEL_EXPORTER_OTLP_ENDPOINT is set — spawning watcher daemon...')

  const child = spawn('bun', ['run', watcherPath], {
    stdio: 'inherit',
    env: process.env,
  })

  child.on('error', (err) => {
    console.error('[watcher] Failed to spawn:', err.message)
  })

  child.on('exit', (code, signal) => {
    if (code !== 0 || signal) {
      console.warn(`[watcher] OTel watcher daemon exited unexpectedly (code=${code} signal=${signal}). OTel metrics export has stopped.`)
    }
  })

  const killChild = () => {
    process.removeListener('exit', killChild)
    process.removeListener('SIGINT', killChild)
    process.removeListener('SIGTERM', killChild)
    if (!child.killed) child.kill()
  }
  process.once('exit', killChild)
  process.once('SIGINT', killChild)
  process.once('SIGTERM', killChild)

  // If the child exits naturally, clean up the process-level handlers too
  child.on('exit', () => {
    process.removeListener('exit', killChild)
    process.removeListener('SIGINT', killChild)
    process.removeListener('SIGTERM', killChild)
  })
}

// Start file watching and optionally spawn the OTel watcher daemon
setupFileWatcher()
maybeSpawnWatcher()

Bun.serve({
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url)

    if (req.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS })
    }

    if (url.pathname === '/api/events' && req.method === 'GET') {
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          sseClients.add(controller)
          controller.enqueue(sseEncoder.encode('event: connected\ndata: {}\n\n'))

          req.signal.addEventListener('abort', () => {
            sseClients.delete(controller)
            try { controller.close() } catch { /* already closed */ }
          })
        },
      })

      return new Response(stream, {
        status: 200,
        headers: {
          ...CORS_HEADERS,
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
          'X-Accel-Buffering': 'no',
        },
      })
    }

    if (url.pathname === '/api/rates' && req.method === 'GET') {
      try {
        const rates = await getRates()
        return new Response(JSON.stringify({
          brlRate: rates.brlRate,
          pricing: rates.pricing,
          pricingSource: rates.pricingSource,
          fetchedAt: rates.fetchedAt,
        }), {
          status: 200,
          headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
        })
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        return new Response(JSON.stringify({ error: message }), {
          status: 500,
          headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
        })
      }
    }

    if (url.pathname === '/api/data' && req.method === 'GET') {
      try {
        const data = await buildApiResponse()
        return new Response(JSON.stringify(data), {
          status: 200,
          headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
        })
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        console.error('[/api/data error]', message)
        return new Response(JSON.stringify({ error: message }), {
          status: 500,
          headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
        })
      }
    }

    return new Response(JSON.stringify({ error: 'Not Found' }), {
      status: 404,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    })
  },
})

console.log(`Claude Stats API running at http://localhost:${PORT}`)
