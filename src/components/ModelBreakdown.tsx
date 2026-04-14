import React from 'react'
import type { ModelUsage } from '../lib/types'
import { formatModel, calcCost, getModelColor } from '../lib/types'

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

export function ModelBreakdown({ modelUsage, note, currency = 'USD', brlRate = 1, fallbackInputTokens, fallbackOutputTokens, fallbackCostUSD }: Props) {
  const entries = Object.entries(modelUsage).filter(([, u]) => u && (u.inputTokens + u.outputTokens) > 0)

  if (entries.length === 0) {
    const hasFallback = fallbackCostUSD !== undefined && (fallbackInputTokens ?? 0) + (fallbackOutputTokens ?? 0) > 0
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {hasFallback && (
          <div style={{
            background: 'var(--bg-elevated)',
            borderRadius: 'var(--radius-md)',
            padding: '14px 16px',
            border: '1px solid var(--border-subtle)',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
              <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)' }}>
                All models (blended)
              </span>
              <span style={{
                fontSize: 13, fontWeight: 700,
                color: 'var(--anthropic-orange)',
                background: 'var(--anthropic-orange-dim)',
                padding: '2px 8px',
                borderRadius: 6,
              }}>
                {fmtCost(fallbackCostUSD!, currency, brlRate)}
              </span>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              {[
                { label: 'Input', value: fmt(fallbackInputTokens ?? 0), color: 'var(--accent-blue)' },
                { label: 'Output', value: fmt(fallbackOutputTokens ?? 0), color: 'var(--accent-green)' },
              ].map(({ label, value, color: c }) => (
                <div key={label} style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: c }}>{value}</div>
                  <div style={{ fontSize: 10, color: 'var(--text-tertiary)', marginTop: 1 }}>{label}</div>
                </div>
              ))}
            </div>
          </div>
        )}
        <div style={{ fontSize: 11, color: 'var(--text-tertiary)', fontStyle: 'italic', textAlign: 'center', padding: hasFallback ? '0 0 8px' : 24 }}>
          {note ?? 'No model data available'}
        </div>
      </div>
    )
  }

  const totalCost = entries.reduce((s, [id, u]) => s + calcCost(u, id), 0)
  const totalTokens = entries.reduce((s, [, u]) => s + u.inputTokens + u.outputTokens + u.cacheReadInputTokens + u.cacheCreationInputTokens, 0)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {entries.map(([modelId, usage]) => {
        const costUSD = calcCost(usage, modelId)
        const tokens = usage.inputTokens + usage.outputTokens + usage.cacheReadInputTokens + usage.cacheCreationInputTokens
        const pct = totalTokens > 0 ? tokens / totalTokens : 0
        const color = getModelColor(modelId)

        return (
          <div key={modelId} style={{
            background: 'var(--bg-elevated)',
            borderRadius: 'var(--radius-md)',
            padding: '14px 16px',
            border: '1px solid var(--border-subtle)',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <div style={{ width: 8, height: 8, borderRadius: '50%', background: color, flexShrink: 0 }} />
                <span style={{ fontWeight: 600, color: 'var(--text-primary)', fontSize: 13 }}>
                  {formatModel(modelId)}
                </span>
              </div>
              <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                <span style={{
                  fontSize: 13, fontWeight: 700,
                  color: 'var(--anthropic-orange)',
                  background: 'var(--anthropic-orange-dim)',
                  padding: '2px 8px',
                  borderRadius: 6,
                }}>
                  {fmtCost(costUSD, currency, brlRate)}
                </span>
              </div>
            </div>

            {/* Progress bar */}
            <div style={{ height: 3, background: 'var(--bg-card)', borderRadius: 2, marginBottom: 10, overflow: 'hidden' }}>
              <div style={{
                height: '100%',
                width: `${pct * 100}%`,
                background: `linear-gradient(90deg, ${color}, ${color}80)`,
                borderRadius: 2,
                transition: 'width 0.6s ease',
              }} />
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8 }}>
              {[
                { label: 'Input', value: fmt(usage.inputTokens), color: 'var(--accent-blue)' },
                { label: 'Output', value: fmt(usage.outputTokens), color: 'var(--accent-green)' },
                { label: 'Cache Read', value: fmt(usage.cacheReadInputTokens), color: 'var(--accent-cyan)' },
                { label: 'Cache Write', value: fmt(usage.cacheCreationInputTokens), color: 'var(--accent-purple)' },
              ].map(({ label, value, color: c }) => (
                <div key={label} style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: c }}>{value}</div>
                  <div style={{ fontSize: 10, color: 'var(--text-tertiary)', marginTop: 1 }}>{label}</div>
                </div>
              ))}
            </div>
          </div>
        )
      })}

      {entries.length > 1 && (
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '10px 14px',
          background: 'var(--anthropic-orange-glow)',
          border: '1px solid var(--anthropic-orange-dim)',
          borderRadius: 'var(--radius-md)',
        }}>
          <span style={{ fontSize: 12, color: 'var(--text-secondary)', fontWeight: 500 }}>Estimated Total Cost</span>
          <span style={{ fontSize: 16, fontWeight: 700, color: 'var(--anthropic-orange)' }}>
            {fmtCost(totalCost, currency, brlRate)}
          </span>
        </div>
      )}
      {note && (
        <div style={{ fontSize: 11, color: 'var(--text-tertiary)', fontStyle: 'italic', textAlign: 'center', marginTop: 4 }}>
          {note}
        </div>
      )}
    </div>
  )
}
