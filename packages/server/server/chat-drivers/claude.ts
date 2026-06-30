import { CHAT_MODELS, registerMcpGlobally, streamViaClaude } from '../chat-tty'
import type { ChatDriver } from './types'
import { findCli } from './cli-detect'

function claudeIsAvailable(): boolean {
  return findCli('claude')
}

export const claudeDriver: ChatDriver = {
  id: 'claude',
  label: 'Claude',

  isAvailable() {
    return claudeIsAvailable()
  },

  // Claude is the host CLI — auth is ready whenever the binary is present.
  authReady() {
    return claudeIsAvailable()
  },

  setup: {
    installCmd: 'npm i -g @anthropic-ai/claude-code',
    docUrl: 'https://docs.anthropic.com/en/docs/claude-code',
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
