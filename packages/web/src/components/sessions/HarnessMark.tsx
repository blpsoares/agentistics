/**
 * HarnessMark — the assistant's mark beside its messages.
 *
 * These are the vendors' own marks, sourced in `public/harness/SOURCES.md` — a file with no
 * recorded source may not be committed. A harness absent from `MARK_FILE` falls back to a MONOGRAM
 * in the harness's own brand colour — a letter, plainly a placeholder — which STAYS as the fallback
 * for the next harness added before its mark is found. Deleting it would render a broken image.
 *
 * To ship a real mark, drop the file in `public/harness/`, record its source in `SOURCES.md`, and
 * add it here. Nothing else changes.
 */

import { HARNESS_COLORS, HARNESS_LABELS } from '../../lib/harness'

/**
 * Vendor assets present in this repository, with their provenance in
 * `public/harness/SOURCES.md`. A harness absent here falls back to its monogram — which STAYS,
 * for the next harness added before its mark is found. Deleting it would render a broken image.
 */
const MARK_FILE: Record<string, string> = {
  claude: '/harness/claude.svg',
  codex: '/harness/codex.svg',
  gemini: '/harness/gemini.svg',
  copilot: '/harness/copilot.svg',
  antigravity: '/harness/antigravity.png',
  kimi: '/harness/kimi.png',
}

/** The letter a monogram carries. First letter of the product name, which is what people say. */
function monogram(harness: string): string {
  const label = (HARNESS_LABELS as Record<string, string>)[harness] ?? harness
  return (label.trim()[0] ?? '?').toUpperCase()
}

export interface HarnessMarkProps {
  harness: string
  size?: number
}

export function HarnessMark({ harness, size = 26 }: HarnessMarkProps) {
  const color = (HARNESS_COLORS as Record<string, string>)[harness] ?? 'var(--text-secondary)'
  const name = (HARNESS_LABELS as Record<string, string>)[harness] ?? harness
  const file = MARK_FILE[harness]

  if (file) {
    return (
      <img
        src={file}
        alt={name}
        title={name}
        style={{
          width: size, height: size, flexShrink: 0, borderRadius: 7,
          objectFit: 'contain', background: 'var(--bg-elevated)',
        }}
      />
    )
  }

  return (
    <span
      aria-label={name}
      title={name}
      style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
        width: size, height: size, borderRadius: 7,
        background: `color-mix(in srgb, ${color} 16%, transparent)`,
        border: `1px solid color-mix(in srgb, ${color} 42%, transparent)`,
        color, fontSize: Math.round(size * 0.46), fontWeight: 800, lineHeight: 1,
      }}
    >
      {monogram(harness)}
    </span>
  )
}
