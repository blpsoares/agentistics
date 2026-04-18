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

export type McpPluginInfo = {
  id: string       // e.g. "playwright@claude-plugins-official"
  name: string     // e.g. "playwright"
  registry: string // e.g. "claude-plugins-official"
  enabled: boolean
}

export type McpListResult = {
  servers: McpServerInfo[]
  plugins: McpPluginInfo[]
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

async function readPlugins(): Promise<McpPluginInfo[]> {
  try {
    const raw = await Bun.file(path.join(HOME_DIR, '.claude', 'settings.json')).text()
    const json = JSON.parse(raw) as { enabledPlugins?: Record<string, boolean> }
    return Object.entries(json.enabledPlugins ?? {}).map(([id, enabled]) => {
      const [name = id, registry = ''] = id.split('@')
      return { id, name, registry, enabled }
    })
  } catch {
    return []
  }
}

export async function listMcpServers(projectPath?: string | null): Promise<McpListResult> {
  // User-scope MCPs from ~/.claude.json (registered via `claude mcp add -s user`)
  const userServers = await readMcpFromFile(path.join(HOME_DIR, '.claude.json'), 'user')
  // Also check ~/.claude/settings.json for legacy format
  const globalSettingsServers = await readMcpFromFile(path.join(HOME_DIR, '.claude', 'settings.json'), 'user')

  const seen = new Set<string>()
  const servers: McpServerInfo[] = []

  for (const s of [...userServers, ...globalSettingsServers]) {
    if (!seen.has(s.name)) {
      seen.add(s.name)
      servers.push(s)
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
        servers.push(s)
      }
    }
  }

  const plugins = await readPlugins()

  return { servers, plugins }
}

// Remove an MCP server from user scope config
export async function removeMcpServer(name: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const proc = Bun.spawn(
      ['claude', 'mcp', 'remove', '-s', 'user', name],
      { stdout: 'pipe', stderr: 'pipe' },
    )
    await proc.exited
    if (proc.exitCode !== 0) {
      const err = await new Response(proc.stderr).text()
      return { ok: false, error: err.trim() }
    }
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}
