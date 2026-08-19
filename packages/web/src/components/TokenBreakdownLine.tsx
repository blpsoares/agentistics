import React from 'react'
import type { Lang, TokenBreakdown } from '@agentistics/core'
import {
  TOKEN_COLORS, TOKEN_PARTS, fmt, tokenHelp, tokenLabel, tokenSharePct, totalTokens,
} from '@agentistics/core'

/**
 * The four billed counters as one wrapping line, for a surface whose tiles are already spoken for.
 *
 * ## Why a line and not more tiles
 *
 * The first attempt put each counter in its own tile beside the total. On a summary strip that is
 * wrong, and provably so: those grids are `repeat(auto-fit, minmax(120px, 1fr))`, which fits
 * `floor((W + gap) / 130)` columns — ten at ~1400px. Taking the repo strip from eight tiles to
 * eleven left the eleventh stranded alone on a second row, which is exactly the hole a card layout
 * must never produce.
 *
 * A line has no cell count, so it cannot strand anything. It wraps at any width, it costs one row
 * instead of three, and it reads as what it is: the composition OF the total above it, rather than
 * five figures competing with the sessions and cost beside them.
 *
 * The KPI grid on Home is the other case and keeps its composite CARD — there the tokens cell is
 * one of ten equals, and a card spanning two of them holds the count exactly.
 *
 * Every counter carries its name, its share and its sentence (`tokenHelp`), because a label may not
 * exist without its explanation — the rule `TOKEN_KINDS` is built around.
 */
interface Props {
  tokens: TokenBreakdown
  lang: Lang
  /** Prefix naming what the counters belong to. Omitted where the heading above already says it. */
  label?: string
}

export function TokenBreakdownLine({ tokens, lang, label }: Props) {
  const total = totalTokens(tokens)
  return (
    <div
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'baseline',
        gap: '4px 14px',
        marginTop: 8,
        fontSize: 11,
        color: 'var(--text-tertiary)',
        lineHeight: 1.6,
      }}
    >
      {label && <span style={{ fontWeight: 600 }}>{label}</span>}
      {TOKEN_PARTS.map(part => (
        <span
          key={part}
          title={tokenHelp(part, lang)}
          style={{ display: 'inline-flex', alignItems: 'baseline', gap: 5, minWidth: 0 }}
        >
          <span
            aria-hidden
            style={{
              width: 6, height: 6, borderRadius: 2, alignSelf: 'center',
              background: TOKEN_COLORS[part], flexShrink: 0,
            }}
          />
          <span>{tokenLabel(part, lang)}</span>
          <strong style={{ color: 'var(--text-secondary)', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
            {fmt(tokens[part])}
          </strong>
          <span style={{ opacity: 0.7 }}>{tokenSharePct(tokens[part], total)}</span>
        </span>
      ))}
    </div>
  )
}
