import React from 'react'
import type { Filters, Lang, TokenBreakdown } from '@agentistics/core'
import {
  TOKEN_COLORS, TOKEN_PARTS, fmt, fmtFull, readTokens, tokenHelp, tokenLabel, tokenShares,
  totalTokens, totalTokensExplained,
} from '@agentistics/core'
import { scopeSentence } from '../lib/scopeSentence'
import { useIsMobile } from '../hooks/useIsMobile'
import { PrecisionToggle } from './PrecisionToggle'

interface Props {
  tokens: TokenBreakdown
  filters: Filters
  lang: Lang
}

/**
 * Every token counter this product has, with the arithmetic between them written out.
 *
 * ## Why a whole panel for four numbers
 *
 * The complaint that produced it: totals reach the billions, and a figure that large with no
 * account of what it contains does not inform anyone — it alarms them, and an alarming number
 * nobody can explain is one people stop trusting. The four counters are four different prices and
 * four different stories, and until they are laid out side by side, "8,7B tokens" and "R$ 300"
 * simply look like they cannot both be about the same month.
 *
 * So every row carries its own sentence, always visible rather than behind a hover — a tooltip is
 * not documentation on a phone — and the derived rows state their formula, because "read by the
 * model" and "total" differing by exactly the output is the fact that makes the cache legible.
 *
 * ## It follows the filters, and says so
 *
 * The header states the active scope (`scopeSentence`). A totals panel that silently answered a
 * different question from the chips above it would be the same class of bug this whole pass exists
 * to remove — two surfaces disagreeing with no way to tell which one is lying.
 */
export function TokenTotalsPanel({ tokens, filters, lang }: Props) {
  const pt = lang === 'pt'
  const isMobile = useIsMobile()
  const [full, setFull] = React.useState(false)
  const shares = tokenShares(tokens)
  const total = totalTokens(tokens)
  const read = readTokens(tokens)
  const conversation = tokens.input + tokens.output
  const n = (v: number) => (full ? fmtFull(v) : fmt(v))

  /** The four counters, then the readings derived from them. */
  const derived = [
    {
      key: 'read' as const,
      value: read,
      formula: pt ? 'entrada + leitura + escrita de cache' : 'input + cache read + cache write',
    },
    {
      key: 'conversation' as const,
      value: conversation,
      formula: pt ? 'entrada + saída' : 'input + output',
    },
  ]

  const cell: React.CSSProperties = {
    padding: isMobile ? '10px 8px' : '10px 12px',
    borderBottom: '1px solid var(--border-subtle)',
    verticalAlign: 'top',
  }
  const num: React.CSSProperties = {
    ...cell,
    textAlign: 'right',
    fontVariantNumeric: 'tabular-nums',
    fontWeight: 700,
    whiteSpace: 'nowrap',
  }

  return (
    <div>
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        gap: 10, flexWrap: 'wrap', marginBottom: 10,
      }}>
        <span style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>
          {pt ? 'Somando: ' : 'Summing: '}
          <strong style={{ color: 'var(--text-secondary)' }}>{scopeSentence(filters, lang)}</strong>
        </span>
        <PrecisionToggle full={full} accent="var(--anthropic-orange)" onToggle={() => setFull(v => !v)} lang={lang} />
      </div>

      {/* Wide content scrolls inside its own container — the page body must never scroll sideways. */}
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: isMobile ? 420 : undefined }}>
          <tbody>
            {TOKEN_PARTS.map(part => (
              <tr key={part}>
                <td style={{ ...cell, width: 4, padding: 0 }}>
                  <div style={{ width: 3, height: '100%', minHeight: 28, background: TOKEN_COLORS[part], borderRadius: 2 }} />
                </td>
                <td style={cell}>
                  <div style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--text-primary)' }}>
                    {tokenLabel(part, lang)}
                  </div>
                  <div style={{ fontSize: 10.5, lineHeight: 1.5, color: 'var(--text-tertiary)', marginTop: 2, maxWidth: 560 }}>
                    {tokenHelp(part, lang)}
                  </div>
                </td>
                <td style={{ ...num, color: 'var(--text-primary)' }}>{n(tokens[part])}</td>
                <td style={{ ...num, color: 'var(--text-tertiary)', fontWeight: 600, width: 56 }}>
                  {Math.round(shares[part] * 100)}%
                </td>
              </tr>
            ))}

            {/* The grand total, visually separated: it is the answer, the rows above are its parts. */}
            <tr>
              <td style={{ ...cell, padding: 0, borderBottom: 'none' }} />
              <td style={{ ...cell, borderBottom: 'none', paddingTop: 14 }}>
                <div style={{ fontSize: 13, fontWeight: 800, color: 'var(--text-primary)' }}>
                  {tokenLabel('total', lang)}
                </div>
                <div style={{ fontSize: 10.5, lineHeight: 1.5, color: 'var(--text-tertiary)', marginTop: 2, maxWidth: 560 }}>
                  {totalTokensExplained(tokens, lang)}
                </div>
              </td>
              <td style={{ ...num, borderBottom: 'none', paddingTop: 14, fontSize: 15, color: 'var(--anthropic-orange)' }}>
                {n(total)}
              </td>
              <td style={{ ...num, borderBottom: 'none', paddingTop: 14, color: 'var(--text-tertiary)', fontWeight: 600 }}>
                100%
              </td>
            </tr>

            {/* Readings derived from the same four numbers. Kept below the total and visibly
                secondary, because neither is what you are billed on and both are easy to mistake
                for it — `conversation` especially, which is what every broken surface was showing. */}
            {derived.map(d => (
              <tr key={d.key}>
                <td style={{ ...cell, padding: 0, borderBottom: 'none' }} />
                <td style={{ ...cell, borderBottom: 'none', paddingTop: 12 }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)' }}>
                    {tokenLabel(d.key, lang)}
                    <span style={{ fontSize: 10, fontWeight: 500, color: 'var(--text-tertiary)', marginLeft: 6 }}>
                      = {d.formula}
                    </span>
                  </div>
                  <div style={{ fontSize: 10.5, lineHeight: 1.5, color: 'var(--text-tertiary)', marginTop: 2, maxWidth: 560 }}>
                    {tokenHelp(d.key, lang)}
                  </div>
                </td>
                <td style={{ ...num, borderBottom: 'none', paddingTop: 12, color: 'var(--text-secondary)' }}>
                  {n(d.value)}
                </td>
                <td style={{ ...num, borderBottom: 'none', paddingTop: 12, color: 'var(--text-tertiary)', fontWeight: 600 }}>
                  {total > 0 ? `${Math.round((d.value / total) * 100)}%` : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
