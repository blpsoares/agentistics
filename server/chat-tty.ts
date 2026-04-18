import path from 'node:path'
import { mkdir, writeFile } from 'node:fs/promises'
import { HOME_DIR } from './config'

const AGENTISTICS_ROOT = path.resolve(import.meta.dir, '..')
export const NAY_CHAT_DIR = path.join(HOME_DIR, '.agentistics', 'nay-chat')
export const CLAUDE_CHAT_DIR = path.join(HOME_DIR, '.agentistics', 'claude-chat')

export type ChatMessage = { role: 'user' | 'assistant'; content: string }

export const CHAT_MODELS = [
  { id: 'claude-haiku-4-5',   label: 'Haiku 4.5',   badge: 'Fast',     desc: 'Fastest responses, great for quick questions',    inputPer1M: 0.80,  outputPer1M: 4.00  },
  { id: 'claude-sonnet-4-6',  label: 'Sonnet 4.6',  badge: 'Balanced', desc: 'Best balance of speed and intelligence',          inputPer1M: 3.00,  outputPer1M: 15.00 },
  { id: 'claude-opus-4-7',    label: 'Opus 4.7',    badge: 'Powerful', desc: 'Most capable — ideal for complex analysis',       inputPer1M: 15.00, outputPer1M: 75.00 },
] as const

export type ChatModelId = typeof CHAT_MODELS[number]['id']

// Written to ~/.agentistics/nay-chat/CLAUDE.md on every server start
// so git pull + restart always gets the latest instructions.
const NAY_CLAUDE_MD = `# agentistics — project context

This workspace connects to the agentistics analytics dashboard via MCP tools.
The agentistics server must be running at http://localhost:47291.

---

## CRITICAL behavior rules — read these first

**Rule 1 — Never answer from memory or from the conversation history.**
For EVERY question, regardless of what was discussed before, call the relevant tools to get fresh data.
Even if a prior message mentions "embark was the most expensive", call agentistics_projects again to answer a follow-up question about tokens.

**Rule 2 — Never describe what you are about to do. Never ask for permission.**
Call tools immediately. Do not write "I will analyze...", "Let me check...", "Aguarde...", "Com base no relatório acima...". Just call the tool and respond with the actual result.
All tools in this workspace are pre-approved — never ask "may I", "please confirm", "preciso de sua permissão", or any similar phrasing. Just act.

**Rule 3 — Never reference "the Nay agent" or "the report above" as a source.**
You have direct tool access. Use it. If you need data, call the tool.

**Rule 4 — Always include a navigation button when you mention a specific result.**
If you mention a project, cost, session, or layout — end the response with the matching button.

**When the result is about a SPECIFIC project, include the project path as a query param so the dashboard filter is applied automatically:**
- Mentioned costs for a specific project → [→ Ver custos](/costs?projects=PROJECT_PATH)
- Mentioned sessions for a specific project → [→ Ver projetos](/projects?projects=PROJECT_PATH)
- Mentioned multiple specific projects → [→ Ver custos](/costs?projects=PATH1|PATH2)
- Generic costs/spending (no specific project) → [→ Ver custos](/costs)
- Generic projects (no specific project) → [→ Ver projetos](/projects)
- Mentioned a layout → [→ Abrir layout](/custom)
- Mentioned home stats → [→ Dashboard](/)

The PROJECT_PATH must be the exact \`path\` field returned by agentistics_projects (e.g. /home/user/projects/my-app). Use | to separate multiple paths. This is not optional. Every response with a data result must have at least one button.

---

## Tool call protocol

| Question type | Tools to call |
|--------------|--------------|
| Any metrics question | agentistics_summary first, then specific tool |
| "Which project spent most tokens/money?" | agentistics_projects |
| "Most expensive session?" | agentistics_sessions |
| "Cost breakdown by model?" | agentistics_costs |
| "Build a layout" | agentistics_component_catalog then agentistics_build_layout |
| "Generate/export a PDF report" | agentistics_export_pdf |
| Any follow-up question | Call tools again — never rely on prior conversation |

---

## Available MCP tools

| Tool | Purpose |
|------|---------|
| agentistics_summary | All-time totals: tokens, cost, sessions, streak, cache hit rate |
| agentistics_projects | Per-project breakdown with token/cost/session counts |
| agentistics_sessions | Recent sessions with duration, model, cost |
| agentistics_costs | Model pricing breakdown and cache savings |
| agentistics_component_catalog | Available dashboard components and their IDs |
| agentistics_get_layouts | Current custom page layouts |
| agentistics_build_layout | Create a complete layout with ordered components |
| agentistics_add_component | Add a single component to an existing layout |
| agentistics_remove_component | Remove a component by its instance ID |
| agentistics_create_layout | Create a new empty named layout |
| agentistics_set_active_layout | Switch which layout is shown on /custom |
| agentistics_delete_layout | Delete a layout permanently |
| agentistics_export_pdf | Generate a PDF report URL — returns a link that auto-opens the export modal |

---

## Layout building rules

The custom page uses a 12-column grid:
- KPI cards: w=3, h=2 (4 per row)
- Wide charts: w=12, h=4
- Medium panels: w=6, h=3–4

Always call agentistics_component_catalog before building any layout.

---

## Response format

- Bold key numbers. Use tables for comparisons. Always include units ($, k tokens, %).
- Under 200 words unless a detailed breakdown is explicitly requested.
- Match the language the user writes in (Portuguese or English).
- Never fabricate numbers — if a tool returns no data, say so.
- End every data response with at least one [→ Label](/route) button (Rule 4).

Available routes: / (home), /projects, /costs, /tools, /custom

Filter query params (append to route when result is project-specific):
- ?projects=PATH — filter by one project path (exact value from agentistics_projects)
- ?projects=PATH1|PATH2 — filter by multiple projects (pipe-separated)
`

// MCP settings written dynamically so the cwd path and port are always correct.
export function buildNaySettings(port: number) {
  return {
    mcpServers: {
      agentistics: {
        command: 'bun',
        args: ['run', 'mcp/agentistics-mcp.ts'],
        cwd: AGENTISTICS_ROOT,
        env: { AGENTISTICS_API: `http://localhost:${port}` },
      },
    },
    permissions: {
      allow: [
        'WebFetch(domain:localhost)',
        // Allow all agentistics MCP tools without prompting (non-interactive --print mode)
        'mcp__agentistics__agentistics_summary',
        'mcp__agentistics__agentistics_projects',
        'mcp__agentistics__agentistics_sessions',
        'mcp__agentistics__agentistics_costs',
        'mcp__agentistics__agentistics_component_catalog',
        'mcp__agentistics__agentistics_get_layouts',
        'mcp__agentistics__agentistics_build_layout',
        'mcp__agentistics__agentistics_add_component',
        'mcp__agentistics__agentistics_remove_component',
        'mcp__agentistics__agentistics_create_layout',
        'mcp__agentistics__agentistics_set_active_layout',
        'mcp__agentistics__agentistics_delete_layout',
        'mcp__agentistics__agentistics_export_pdf',
      ],
    },
  }
}

// Called at server startup — idempotent, safe to run on every restart.
// Creates the general-purpose Claude chat working directory.
export async function ensureClaudeChat(): Promise<void> {
  await mkdir(CLAUDE_CHAT_DIR, { recursive: true })
}

export async function ensureNayChat(port: number): Promise<void> {
  const claudeMd = NAY_CLAUDE_MD.replace(
    /http:\/\/localhost:\d+/g,
    `http://localhost:${port}`,
  )
  const dotClaude = path.join(NAY_CHAT_DIR, '.claude')
  await mkdir(dotClaude, { recursive: true })
  await writeFile(path.join(NAY_CHAT_DIR, 'CLAUDE.md'), claudeMd)
  await writeFile(
    path.join(dotClaude, 'settings.json'),
    JSON.stringify(buildNaySettings(port), null, 2),
  )
  await registerMcpGlobally(port)
}

// Registers the agentistics MCP via `claude mcp add -s user` so that
// claude --print mode (which reads ~/.claude.json user scope) can find the tools.
// Safe to call on every restart — skips if already registered with the same port.
async function registerMcpGlobally(port: number): Promise<void> {
  const apiUrl = `http://localhost:${port}`
  const mcpScript = path.join(AGENTISTICS_ROOT, 'mcp', 'agentistics-mcp.ts')

  // Check if already registered with the correct URL
  try {
    const dotClaudeJson = path.join(HOME_DIR, '.claude.json')
    const raw = await Bun.file(dotClaudeJson).text()
    const json = JSON.parse(raw) as Record<string, unknown>
    const servers = json['mcpServers'] as Record<string, { env?: Record<string, string> }> | undefined
    const existing = servers?.['agentistics']
    if (existing?.env?.['AGENTISTICS_API'] === apiUrl) return // already up to date
  } catch { /* read or parse failed — proceed with registration */ }

  // Use the official CLI to register at user scope
  const proc = Bun.spawn(
    ['claude', 'mcp', 'add', '-s', 'user', 'agentistics',
      '-e', `AGENTISTICS_API=${apiUrl}`,
      '--', 'bun', 'run', mcpScript],
    { stdout: 'pipe', stderr: 'pipe' },
  )
  await proc.exited
}

export interface StreamViaClaudioOpts {
  cwd?: string
  thinkingBudget?: number
}

export async function streamViaClaude(
  message: string,
  history: ChatMessage[],
  model: ChatModelId,
  onChunk: (text: string) => void,
  onTool: (name: string) => void,
  onDone: () => void,
  onError: (err: string) => void,
  onSessionId?: (id: string) => void,
  resumeSessionId?: string | null,
  opts?: StreamViaClaudioOpts,
): Promise<void> {
  // When resuming a session, just pass the new message — history is in the JSONL
  // When starting a new session, fall back to the old inline-history approach
  let prompt: string
  const args = ['claude', '--print', '--output-format', 'stream-json', '--verbose']

  if (opts?.thinkingBudget && opts.thinkingBudget > 0) {
    args.push('--budget-tokens', String(opts.thinkingBudget))
  }

  args.push('--model', model)

  if (resumeSessionId) {
    args.push('--resume', resumeSessionId)
    prompt = message
  } else {
    const recent = history.filter(h => h.content.trim()).slice(-8)
    prompt = ''
    for (const h of recent) {
      prompt += `${h.role === 'user' ? 'User' : 'Assistant'}: ${h.content}\n\n`
    }
    prompt += message.length > 0 && recent.length > 0 ? `User: ${message}` : message
  }

  const cwd = opts?.cwd ?? NAY_CHAT_DIR

  try {
    const proc = Bun.spawn(args, { stdout: 'pipe', stderr: 'pipe', stdin: 'pipe', cwd })
    proc.stdin.write(prompt)
    proc.stdin.end()

    const decoder = new TextDecoder()
    let lineBuffer = ''
    let emittedLength = 0
    let gotResult = false
    const seenTools = new Set<string>()

    for await (const raw of proc.stdout as unknown as AsyncIterable<Uint8Array>) {
      lineBuffer += decoder.decode(raw, { stream: true })
      const lines = lineBuffer.split('\n')
      lineBuffer = lines.pop() ?? ''

      for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed) continue
        try {
          const event = JSON.parse(trimmed) as Record<string, unknown>
          if (event.type === 'assistant') {
            const msg = event.message as { content?: Array<{ type: string; text?: string; name?: string }> } | undefined
            for (const block of msg?.content ?? []) {
              if (block.type === 'text' && typeof block.text === 'string') {
                const delta = block.text.slice(emittedLength)
                if (delta) { onChunk(delta); emittedLength = block.text.length }
              } else if (block.type === 'tool_use' && typeof block.name === 'string') {
                if (!seenTools.has(block.name)) {
                  seenTools.add(block.name)
                  onTool(block.name)
                }
              }
            }
          } else if (event.type === 'result') {
            gotResult = true
            const ev = event as { subtype?: string; error?: unknown; session_id?: string }
            if (ev.subtype === 'error') {
              onError(String(ev.error ?? 'claude CLI error'))
              return
            }
            if (ev.session_id && onSessionId) onSessionId(ev.session_id)
          }
        } catch { /* ignore malformed lines */ }
      }
    }

    const exit = await proc.exited
    if (exit !== 0 && !gotResult) {
      const errText = await new Response(proc.stderr).text()
      onError(`claude CLI exited with code ${exit}: ${errText.slice(0, 300)}`)
      return
    }
    onDone()
  } catch (err) {
    onError(`claude not found or failed to start: ${err instanceof Error ? err.message : String(err)}`)
  }
}

export async function execCommand(
  command: string,
  onChunk: (text: string, isStderr: boolean) => void,
  onDone: (exitCode: number) => void,
  onError: (err: string) => void,
): Promise<void> {
  try {
    const proc = Bun.spawn(['bash', '-c', command], {
      stdout: 'pipe',
      stderr: 'pipe',
      stdin: 'inherit',
    })

    const decoder = new TextDecoder()

    void (async () => {
      for await (const chunk of proc.stdout as unknown as AsyncIterable<Uint8Array>) {
        onChunk(decoder.decode(chunk, { stream: true }), false)
      }
    })()

    void (async () => {
      for await (const chunk of proc.stderr as unknown as AsyncIterable<Uint8Array>) {
        onChunk(decoder.decode(chunk, { stream: true }), true)
      }
    })()

    const code = await proc.exited
    onDone(code)
  } catch (err) {
    onError(err instanceof Error ? err.message : String(err))
  }
}
