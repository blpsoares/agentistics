/**
 * HarnessMark — the assistant's mark beside its messages.
 *
 * WHAT IS AND IS NOT A LOGO HERE. This repository ships exactly one vendor asset,
 * `public/claudeLogo.png`, and that is the one used for Claude Code. For the other five there is no
 * asset in the tree, so they get a MONOGRAM in the harness's own brand colour — a letter, plainly a
 * placeholder. That is deliberate: drawing an approximation of somebody's mark and presenting it as
 * their logo is worse than obviously not being one, because a reader has no way to tell it is wrong.
 *
 * To ship a real mark, drop the file in `public/` and add it to `MARK_FILE`. Nothing else changes.
 */

import { HARNESS_COLORS, HARNESS_LABELS } from '../../lib/harness'

/** Vendor assets present in this repository. A harness absent here falls back to its monogram. */
const MARK_FILE: Record<string, string> = {
  claude: '/claudeLogo.png',
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
