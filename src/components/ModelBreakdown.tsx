import React from 'react'
import type { ModelUsage } from '../lib/types'
import { formatModel, calcCost, getModelColor } from '../lib/types'
import { useIsMobile } from '../hooks/useIsMobile'

interface Props {
  modelUsage: Record<string, ModelUsage>
  note?: string
  currency?: 'USD' | 'BRL'
  brlRate?: number
  fallbackInputTokens?: number
  fallbackOutputTokens?: number
  fallbackCostUSD?: number
}

function fmt(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`
  return String(n)
}

function fmtCost(usd: number, currency: 'USD' | 'BRL' = 'USD', rate = 1): string {
  if (currency === 'BRL') {
    const brl = usd * rate
    if (brl < 0.05) return '<R$0,05'
    const [intPart, decPart] = brl.toFixed(2).split('.')
    return `R$${(intPart ?? '0').replace(/\B(?=(\d{3})+$)/g, '.')},${decPart}`
  }
  if (usd < 0.01) return '<USD 0.01'
  return `USD ${usd.toFixed(2)}`
}

const COL: React.CSSProperties = { fontSize: 11, color: 'var(--text-tertiary)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em' }
const GRID = 'minmax(120px,1fr) 56px 64px 64px 64px 88px'
const GRID_MOBILE = 'minmax(100px,1fr) 56px 70px 88px'

export function ModelBreakdown({ modelUsage, note, currency = 'USD', brlRate = 1, fallbackInputTokens, fallbackOutputTokens, fallbackCostUSD }: Props) {
  const isMobile = useIsMobile()
  const entries = Object.entries(modelUsage).filter(([, u]) => u && (u.inputTokens + u.outputTokens) > 0)

  if (entries.length === 0) {
    const hasFallback = fallbackCostUSD !== undefined && (fallbackInputTokens ?? 0) + (fallbackOutputTokens ?? 0) > 0
    if (!hasFallback) {
      return (
        <div style={{ fontSize: 11, color: 'var(--text-tertiary)', fontStyle: 'italic', textAlign: 'center', padding: 24 }}>
          {note ?? 'No model data available'}
        </div>
      )
    }
    return (
      <div style={{ background: 'var(--bg-elevated)', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-subtle)', overflow: 'hidden' }}>
        <div style={{ display: 'grid', gridTemplateColumns: GRID, gap: 8, padding: '8px 14px', borderBottom: '1px solid var(--border-subtle)', background: 'var(--bg-card)' }}>
          <span style={COL}>Model</span>
          <span style={{ ...COL, textAlign: 'right' }}>Input</span>
          <span style={{ ...COL, textAlign: 'right' }}>Output</span>
          <span style={{ ...COL, textAlign: 'right' }}>C.Read</span>
          <span style={{ ...COL, textAlign: 'right' }}>C.Write</span>
          <span style={{ ...COL, textAlign: 'right' }}>Cost</span>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: GRID, gap: 8, padding: '10px 14px', alignItems: 'center' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
              <div style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--text-tertiary)', flexShrink: 0 }} />
              <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', lineHeight: 1 }}>
                All models (blended)
              </span>
            </div>
            <div style={{ height: 2, background: 'var(--bg-card)', borderRadius: 1 }}>
              <div style={{ height: '100%', width: '100%', background: 'linear-gradient(90deg, var(--text-tertiary), var(--text-tertiary)40)', borderRadius: 1 }} />
            </div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--accent-blue)' }}>{fmt(fallbackInputTokens ?? 0)}</span>
          </div>
          <div style={{ textAlign: 'right' }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--accent-green)' }}>{fmt(fallbackOutputTokens ?? 0)}</span>
          </div>
          <div style={{ textAlign: 'right' }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)' }}>—</span>
          </div>
          <div style={{ textAlign: 'right' }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)' }}>—</span>
          </div>
          <div style={{ textAlign: 'right' }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--anthropic-orange)', background: 'var(--anthropic-orange-dim)', padding: '2px 7px', borderRadius: 5, whiteSpace: 'nowrap' }}>
              {fmtCost(fallbackCostUSD!, currency, brlRate)}
            </span>
          </div>
        </div>
        <div style={{ fontSize: 11, color: 'var(--text-tertiary)', fontStyle: 'italic', textAlign: 'center', padding: '8px 14px', borderTop: '1px solid var(--border-subtle)' }}>
          {note ?? '* Cost and tokens estimated via blended rate — sessions do not record the model used individually.'}
        </div>
      </div>
    )
  }

  const totalCost = entries.reduce((s, [id, u]) => s + calcCost(u, id), 0)
  const totalTokens = entries.reduce((s, [, u]) => s + u.inputTokens + u.outputTokens + u.cacheReadInputTokens + u.cacheCreationInputTokens, 0)
  const totalInput = entries.reduce((s, [, u]) => s + u.inputTokens, 0)
  const totalOutput = entries.reduce((s, [, u]) => s + u.outputTokens, 0)
  const totalCacheRead = entries.reduce((s, [, u]) => s + u.cacheReadInputTokens, 0)
  const totalCacheWrite = entries.reduce((s, [, u]) => s + u.cacheCreationInputTokens, 0)

  return (
    <div style={{
      background: 'var(--bg-elevated)',
      borderRadius: 'var(--radius-md)',
      border: '1px solid var(--border-subtle)',
      overflow: 'hidden',
    }}>
      {/* Header */}
      <div style={{
        display: 'grid', gridTemplateColumns: isMobile ? GRID_MOBILE : GRID, gap: 8,
        padding: '8px 14px',
        borderBottom: '1px solid var(--border-subtle)',
        background: 'var(--bg-card)',
      }}>
        <span style={COL}>Model</span>
        <span style={{ ...COL, textAlign: 'right' }}>Input</span>
        <span style={{ ...COL, textAlign: 'right' }}>Output</span>
        {!isMobile && <span style={{ ...COL, textAlign: 'right' }}>C.Read</span>}
        {!isMobile && <span style={{ ...COL, textAlign: 'right' }}>C.Write</span>}
        <span style={{ ...COL, textAlign: 'right' }}>Cost</span>
      </div>

      {/* Rows */}
      {entries.map(([modelId, usage], i) => {
        const costUSD = calcCost(usage, modelId)
        const tokens = usage.inputTokens + usage.outputTokens + usage.cacheReadInputTokens + usage.cacheCreationInputTokens
        const pct = totalTokens > 0 ? tokens / totalTokens : 0
        const color = getModelColor(modelId)
        const isLast = i === entries.length - 1

        return (
          <div key={modelId} style={{
            display: 'grid', gridTemplateColumns: isMobile ? GRID_MOBILE : GRID, gap: 8,
            padding: '10px 14px',
            alignItems: 'center',
            borderBottom: isLast ? 'none' : '1px solid var(--border-subtle)',
          }}>
            {/* Model name + bar */}
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                <div style={{ width: 7, height: 7, borderRadius: '50%', background: color, flexShrink: 0 }} />
                <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary)', lineHeight: 1 }}>
                  {formatModel(modelId)}
                </span>
                <span style={{ fontSize: 10, color: 'var(--text-tertiary)', marginLeft: 'auto', flexShrink: 0 }}>
                  {(pct * 100).toFixed(0)}%
                </span>
              </div>
              <div style={{ height: 2, background: 'var(--bg-card)', borderRadius: 1, overflow: 'hidden' }}>
                <div style={{
                  height: '100%', width: `${pct * 100}%`,
                  background: `linear-gradient(90deg, ${color}, ${color}80)`,
                  borderRadius: 1, transition: 'width 0.6s ease',
                }} />
              </div>
            </div>

            {/* Token stats — compact, right-aligned */}
            {[
              { v: usage.inputTokens,              c: 'var(--accent-blue)',   show: true  },
              { v: usage.outputTokens,             c: 'var(--accent-green)',  show: true  },
              { v: usage.cacheReadInputTokens,     c: 'var(--accent-cyan)',   show: !isMobile },
              { v: usage.cacheCreationInputTokens, c: 'var(--accent-purple)', show: !isMobile },
            ].filter(x => x.show).map(({ v, c }, idx) => (
              <div key={idx} style={{ textAlign: 'right' }}>
                <span style={{ fontSize: 12, fontWeight: 600, color: c }}>{fmt(v)}</span>
              </div>
            ))}

            {/* Cost */}
            <div style={{ textAlign: 'right' }}>
              <span style={{
                fontSize: 12, fontWeight: 700,
                color: 'var(--anthropic-orange)',
                background: 'var(--anthropic-orange-dim)',
                padding: '2px 7px', borderRadius: 5,
                whiteSpace: 'nowrap',
              }}>
                {fmtCost(costUSD, currency, brlRate)}
              </span>
            </div>
          </div>
        )
      })}

      {/* Total row */}
      {entries.length > 1 && (
        <div style={{
          display: 'grid', gridTemplateColumns: isMobile ? GRID_MOBILE : GRID, gap: 8,
          padding: '9px 14px',
          borderTop: '1px solid var(--border-subtle)',
          background: 'var(--anthropic-orange-glow)',
          alignItems: 'center',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontSize: 11, color: 'var(--text-secondary)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
              Estimated Total
            </span>
            <span style={{ fontSize: 10, color: 'var(--text-tertiary)', marginLeft: 'auto', flexShrink: 0 }}>100%</span>
          </div>
          {[
            { v: totalInput,      c: 'var(--accent-blue)',   show: true       },
            { v: totalOutput,     c: 'var(--accent-green)',  show: true       },
            { v: totalCacheRead,  c: 'var(--accent-cyan)',   show: !isMobile  },
            { v: totalCacheWrite, c: 'var(--accent-purple)', show: !isMobile  },
          ].filter(x => x.show).map(({ v, c }, idx) => (
            <div key={idx} style={{ textAlign: 'right' }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: c }}>{fmt(v)}</span>
            </div>
          ))}
          <div style={{ textAlign: 'right' }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--anthropic-orange)' }}>
              {fmtCost(totalCost, currency, brlRate)}
            </span>
          </div>
        </div>
      )}

      {note && (
        <div style={{ fontSize: 11, color: 'var(--text-tertiary)', fontStyle: 'italic', textAlign: 'center', padding: '8px 14px' }}>
          {note}
        </div>
      )}
    </div>
  )
}
