import type { HarnessId } from '@agentistics/core'
import type { ChatMessage, StreamViaClaudioOpts } from '../chat-tty'

export interface ChatStreamCallbacks {
  onChunk: (t: string) => void
  onTool: (n: string) => void
  onDone: () => void
  onError: (e: string) => void
  onSessionId?: (id: string) => void
}

export interface ChatDriverModel {
  id: string
  label: string
  badge?: string
  desc?: string
  inputPer1M?: number
  outputPer1M?: number
}

export interface ChatDriver {
  id: HarnessId
  label: string
  isAvailable(): boolean
  models: ChatDriverModel[]
  defaultModel: string
  ensureMcp(port: number): Promise<void>
  stream(
    message: string,
    history: ChatMessage[],
    model: string,
    cb: ChatStreamCallbacks,
    resumeSessionId?: string | null,
    opts?: StreamViaClaudioOpts,
  ): Promise<void>
}
