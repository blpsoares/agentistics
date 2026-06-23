import type { HarnessId } from '@agentistics/core'
import type { ChatDriver } from './types'
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

export function availableChatDrivers(): { id: HarnessId; label: string; models: ChatDriver['models']; defaultModel: string }[] {
  return ALL_DRIVERS
    .filter(d => d.isAvailable())
    .map(d => ({ id: d.id, label: d.label, models: d.models, defaultModel: d.defaultModel }))
}
