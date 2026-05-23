export const CHAT_MODELS = [
  {
    id: 'claude-haiku-4-5',
    label: 'Haiku 4.5',
    badge: 'Fast',
    desc: 'Fastest responses, ideal for quick questions',
    inputPer1M: 0.80,
    outputPer1M: 4.00,
  },
  {
    id: 'claude-sonnet-4-6',
    label: 'Sonnet 4.6',
    badge: 'Balanced',
    desc: 'Best balance of speed and intelligence',
    inputPer1M: 3.00,
    outputPer1M: 15.00,
  },
  {
    id: 'claude-opus-4-7',
    label: 'Opus 4.7',
    badge: 'Powerful',
    desc: 'Most capable — ideal for deep analysis',
    inputPer1M: 15.00,
    outputPer1M: 75.00,
  },
] as const

export type ChatModelId = typeof CHAT_MODELS[number]['id']
export const DEFAULT_CHAT_MODEL: ChatModelId = 'claude-sonnet-4-6'
