import * as path from 'path'
import { readFileSync, writeFileSync, copyFileSync, existsSync } from 'node:fs'

export const PROJECT_ROOT = path.resolve(import.meta.dir, '..')
export const ENV_CONFIG_FILE = path.join(PROJECT_ROOT, '.env.config')
export const ENV_CONFIG_BAK_FILE = path.join(PROJECT_ROOT, '.env.config.bak')

export const CONFIG_FIELDS: { key: string; default: string; description: string }[] = [
  { key: 'PORT', default: '47291', description: 'API server port' },
  { key: 'VITE_PORT', default: '47292', description: 'Vite dev server port' },
]

/**
 * Parse a .env-style file into a key→value map.
 * Lines starting with # are comments. Empty lines are ignored.
 */
function parseEnvFile(content: string): Record<string, string> {
  const result: Record<string, string> = {}
  for (const line of content.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eqIdx = trimmed.indexOf('=')
    if (eqIdx < 0) continue
    const key = trimmed.slice(0, eqIdx).trim()
    const value = trimmed.slice(eqIdx + 1).trim()
    if (key) result[key] = value
  }
  return result
}

/**
 * Read .env.config and set process.env for any key NOT already set in the environment.
 * This gives lower priority than actual env vars (e.g. from the shell or .env).
 */
export function loadEnvConfig(): void {
  if (!existsSync(ENV_CONFIG_FILE)) return
  try {
    const content = readFileSync(ENV_CONFIG_FILE, 'utf8')
    const parsed = parseEnvFile(content)
    for (const [key, value] of Object.entries(parsed)) {
      if (process.env[key] === undefined) {
        process.env[key] = value
      }
    }
  } catch {
    // Silently ignore read errors — server will fall back to hardcoded defaults
  }
}

/**
 * Read current values from .env.config (with fallback to CONFIG_FIELDS defaults).
 */
export function readEnvConfig(): Record<string, string> {
  const defaults = Object.fromEntries(CONFIG_FIELDS.map(f => [f.key, f.default]))
  if (!existsSync(ENV_CONFIG_FILE)) return { ...defaults }
  try {
    const content = readFileSync(ENV_CONFIG_FILE, 'utf8')
    const parsed = parseEnvFile(content)
    return { ...defaults, ...parsed }
  } catch {
    return { ...defaults }
  }
}

/**
 * Back up current .env.config to .env.config.bak, then write a new .env.config with the
 * provided values (preserving comment header).
 */
export function writeEnvConfig(values: Record<string, string>): void {
  // Back up existing file if it exists
  if (existsSync(ENV_CONFIG_FILE)) {
    copyFileSync(ENV_CONFIG_FILE, ENV_CONFIG_BAK_FILE)
  }

  const lines: string[] = [
    '# agentistics dev config',
    '# Edit via the </> menu in the dashboard, or directly in this file.',
    '# Changes take effect after restarting the server (bun run dev).',
    '',
  ]

  for (const field of CONFIG_FIELDS) {
    lines.push(`# ${field.description}`)
    const value = values[field.key] ?? field.default
    lines.push(`${field.key}=${value}`)
    lines.push('')
  }

  writeFileSync(ENV_CONFIG_FILE, lines.join('\n'), 'utf8')
}

/**
 * Read .env.config.bak and return its parsed values, or null if the backup does not exist.
 */
export function readEnvConfigBackup(): Record<string, string> | null {
  if (!existsSync(ENV_CONFIG_BAK_FILE)) return null
  try {
    const content = readFileSync(ENV_CONFIG_BAK_FILE, 'utf8')
    const defaults = Object.fromEntries(CONFIG_FIELDS.map(f => [f.key, f.default]))
    const parsed = parseEnvFile(content)
    return { ...defaults, ...parsed }
  } catch {
    return null
  }
}

/**
 * Copy .env.config.bak → .env.config.
 * Returns false if no backup exists, true on success.
 */
export function restoreEnvConfig(): boolean {
  if (!existsSync(ENV_CONFIG_BAK_FILE)) return false
  try {
    copyFileSync(ENV_CONFIG_BAK_FILE, ENV_CONFIG_FILE)
    return true
  } catch {
    return false
  }
}
