import { existsSync } from 'node:fs'
import { CHAT_MODELS, registerMcpGlobally, streamViaClaude } from '../chat-tty'
import type { ChatDriver } from './types'

function claudeIsAvailable(): boolean {
  // Try common binary paths; fall back to PATH via `which`
  if (existsSync('/usr/local/bin/claude')) return true
  if (existsSync('/usr/bin/claude')) return true
  try {
    const proc = Bun.spawnSync(['which', 'claude'], { stdout: 'pipe', stderr: 'pipe' })
    return proc.exitCode === 0
  } catch {
    return false
  }
}

export const claudeDriver: ChatDriver = {
  id: 'claude',
  label: 'Claude',

  isAvailable() {
    return claudeIsAvailable()
  },

  // Expose all Claude models defined in chat-tty (mutable copy for the interface)
  models: CHAT_MODELS.map(m => ({ ...m })),

  // Default to the second entry (Sonnet)
  defaultModel: CHAT_MODELS[1].id,

  async ensureMcp(port: number) {
    await registerMcpGlobally(port)
  },

  async stream(message, history, model, cb, resumeSessionId, opts) {
    await streamViaClaude(
      message,
      history,
      model as typeof CHAT_MODELS[number]['id'],
      cb.onChunk,
      cb.onTool,
      cb.onDone,
      cb.onError,
      cb.onSessionId,
      resumeSessionId,
      opts,
    )
  },
}
