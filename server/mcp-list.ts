import path from 'node:path'
import { HOME_DIR } from './config'

export type McpServerInfo = {
  name: string
  command: string
  args: string[]
  env?: Record<string, string>
  cwd?: string
  scope: 'user' | 'project'
}

async function readMcpFromFile(filePath: string, scope: 'user' | 'project'): Promise<McpServerInfo[]> {
  try {
    const raw = await Bun.file(filePath).text()
    const json = JSON.parse(raw) as {
      mcpServers?: Record<string, { command?: string; args?: string[]; env?: Record<string, string>; cwd?: string }>
    }
    return Object.entries(json.mcpServers ?? {}).map(([name, cfg]) => ({
      name,
      command: cfg.command ?? '',
      args: cfg.args ?? [],
      env: cfg.env,
      cwd: cfg.cwd,
      scope,
    }))
  } catch {
    return []
  }
}

export async function listMcpServers(projectPath?: string | null): Promise<McpServerInfo[]> {
  // User-scope MCPs from ~/.claude.json (registered via `claude mcp add -s user`)
  const userServers = await readMcpFromFile(path.join(HOME_DIR, '.claude.json'), 'user')
  // Also check ~/.claude/settings.json for legacy format
  const globalSettingsServers = await readMcpFromFile(path.join(HOME_DIR, '.claude', 'settings.json'), 'user')

  const seen = new Set<string>()
  const result: McpServerInfo[] = []

  for (const s of [...userServers, ...globalSettingsServers]) {
    if (!seen.has(s.name)) {
      seen.add(s.name)
      result.push(s)
    }
  }

  // Project-scope MCPs from <project>/.claude/settings.json
  if (projectPath) {
    const projectServers = await readMcpFromFile(
      path.join(projectPath, '.claude', 'settings.json'),
      'project',
    )
    for (const s of projectServers) {
      if (!seen.has(s.name)) {
        seen.add(s.name)
        result.push(s)
      }
    }
  }

  return result
}
