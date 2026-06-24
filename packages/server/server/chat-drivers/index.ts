import type { HarnessId } from '@agentistics/core'
import type { ChatDriver, HarnessChatStatus } from './types'
import { claudeDriver } from './claude'
import { codexDriver } from './codex'
import { geminiDriver } from './gemini'
import { copilotDriver } from './copilot'

/**
 * Registry of all chat drivers in display order: claude, codex, gemini, copilot.
 */
export const ALL_DRIVERS: ChatDriver[] = [claudeDriver, codexDriver, geminiDriver, copilotDriver]

export function getChatDriver(harness: HarnessId): ChatDriver | undefined {
  return ALL_DRIVERS.find(d => d.id === harness)
}

/**
 * Returns status for ALL known drivers (installed or not), with per-field
 * install/auth/ready flags and setup guidance. Used by GET /api/chat-harnesses.
 */
export function chatHarnessStatus(): HarnessChatStatus[] {
  return ALL_DRIVERS.map(d => {
    const installed = d.isAvailable()
    const authReady = d.authReady()
    return {
      id: d.id,
      label: d.label,
      installed,
      authReady,
      ready: installed && authReady,
      models: d.models,
      defaultModel: d.defaultModel,
      setup: d.setup,
    }
  })
}
