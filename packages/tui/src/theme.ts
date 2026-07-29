/**
 * theme.ts — the terminal palette, mapped from the web dashboard's dark mode so the two
 * surfaces read as one product.
 *
 * Ink accepts hex colors and downsamples for terminals that cannot show them, so these are the
 * same values the web app uses rather than approximated 256-color indices.
 */

import type { HarnessId } from '@agentistics/core'

export const COLORS = {
  /** Primary accent (Anthropic amber, #f59e0b in the web app). */
  accent: '#f59e0b',
  secondary: '#6366f1',
  success: '#10b981',
  danger: '#f43f5e',
  info: '#38bdf8',
  text: '#ffffff',
  muted: 'gray',
  border: '#3f3f46',
} as const

/** Mirrors HARNESS_COLORS in packages/web/src/lib/harness.ts — keep the two in step. */
export const HARNESS_COLOR: Record<HarnessId, string> = {
  claude: '#D97706',
  codex: '#10a37f',
  gemini: '#4285f4',
  // Copilot's web grey (#6e7681) is unreadable against a dim terminal background, so the
  // terminal uses a lighter grey of the same hue. Every other harness matches the web exactly.
  copilot: '#9ca3af',
  antigravity: '#8b5cf6',
  kimi: '#e11d48',
}

export const HARNESS_LABEL: Record<HarnessId, string> = {
  claude: 'Claude',
  codex: 'Codex',
  gemini: 'Gemini',
  copilot: 'Copilot',
  antigravity: 'Antigravity',
  kimi: 'Kimi',
}
