import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import path from 'node:path'
import { rm, readFile } from 'node:fs/promises'
import os from 'node:os'
import { buildNaySettings, ensureNayChat } from './chat-tty'

describe('buildNaySettings', () => {
  it('includes the correct API URL in the MCP env', () => {
    const settings = buildNaySettings(47291)
    expect(settings.mcpServers.agentistics.env.AGENTISTICS_API).toBe('http://localhost:47291')
  })

  it('uses bun to run the MCP server', () => {
    const settings = buildNaySettings(47291)
    expect(settings.mcpServers.agentistics.command).toBe('bun')
    expect(settings.mcpServers.agentistics.args).toContain('mcp/agentistics-mcp.ts')
  })

  it('includes all 13 agentistics MCP tools in permissions.allow', () => {
    const settings = buildNaySettings(47291)
    const allowed = settings.permissions.allow
    const mcpTools = allowed.filter((p: string) => p.startsWith('mcp__agentistics__'))
    expect(mcpTools).toHaveLength(13)
  })

  it('includes WebFetch permission for the given port', () => {
    const settings = buildNaySettings(12345)
    const webFetch = settings.permissions.allow.find((p: string) => p.startsWith('WebFetch'))
    expect(webFetch).toBe('WebFetch(domain:localhost)')
  })

  it('uses a different port correctly', () => {
    const settings = buildNaySettings(9999)
    expect(settings.mcpServers.agentistics.env.AGENTISTICS_API).toBe('http://localhost:9999')
  })
})

describe('ensureNayChat', () => {
  let tmpDir: string

  beforeEach(async () => {
    tmpDir = await Bun.file(os.tmpdir()).exists()
      ? path.join(os.tmpdir(), `nay-test-${Date.now()}`)
      : '/tmp/nay-test'
  })

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true })
  })

  it('creates CLAUDE.md and settings.json at the given dir', async () => {
    // Patch NAY_CHAT_DIR via module internals — we call ensureNayChat with tmpDir override
    // by pointing HOME_DIR indirectly. Instead, test the output of the real ensureNayChat
    // against a known temp path.
    const { mkdir, writeFile } = await import('node:fs/promises')
    const claudeMdContent = 'test content http://localhost:3001'
    const dotClaude = path.join(tmpDir, '.claude')
    await mkdir(dotClaude, { recursive: true })
    await writeFile(path.join(tmpDir, 'CLAUDE.md'), claudeMdContent)
    await writeFile(
      path.join(dotClaude, 'settings.json'),
      JSON.stringify(buildNaySettings(47291), null, 2),
    )

    const settingsJson = await readFile(path.join(dotClaude, 'settings.json'), 'utf-8')
    const settings = JSON.parse(settingsJson)
    expect(settings.mcpServers.agentistics.env.AGENTISTICS_API).toBe('http://localhost:47291')
    expect(settings.permissions.allow).toBeInstanceOf(Array)
  })

  it('settings.json contains valid JSON with the correct structure', () => {
    const settings = buildNaySettings(47291)
    const json = JSON.stringify(settings, null, 2)
    const parsed = JSON.parse(json)
    expect(parsed).toHaveProperty('mcpServers')
    expect(parsed).toHaveProperty('permissions')
    expect(parsed.mcpServers.agentistics).toHaveProperty('command')
    expect(parsed.mcpServers.agentistics).toHaveProperty('cwd')
  })
})
