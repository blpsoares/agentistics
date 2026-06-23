import type { HarnessId } from '@agentistics/core'
import type { ChatDriver } from './types'
import { claudeDriver } from './claude'

/**
 * Registry of all chat drivers.
 * Only claudeDriver is registered here. The codex/gemini/copilot drivers are
 * appended in the Wire phase (each parallel agent imports this and pushes its driver).
 * // codex/gemini/copilot appended in Wire phase
 */
export const ALL_DRIVERS: ChatDriver[] = [claudeDriver]

export function getChatDriver(harness: HarnessId): ChatDriver | undefined {
  return ALL_DRIVERS.find(d => d.id === harness)
}

export function availableChatDrivers(): { id: HarnessId; label: string; models: ChatDriver['models']; defaultModel: string }[] {
  return ALL_DRIVERS
    .filter(d => d.isAvailable())
    .map(d => ({ id: d.id, label: d.label, models: d.models, defaultModel: d.defaultModel }))
}
