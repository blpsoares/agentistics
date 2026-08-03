import React, { useMemo, useState } from 'react'
import type { ModelUsage } from '@agentistics/core'
import { formatModel, calcCost, getModelColor, fmtCost } from '@agentistics/core'
import { useIsMobile } from '../hooks/useIsMobile'
import { resolveProvider, providerOrder } from '@agentistics/core'

type SortKey = 'cost' | 'tokens' | 'model'

interface Props {
  modelUsage: Record<string, ModelUsage>
  note?: string
  currency?: 'USD' | 'BRL'
  brlRate?: number
  fallbackInputTokens?: number
  fallbackOutputTokens?: number
  fallbackCostUSD?: number
  lang?: 'en' | 'pt'
}

function fmt(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`
  return String(n)
}


const COL: React.CSSProperties = { fontSize: 11, color: 'var(--text-tertiary)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em' }
const GRID = 'minmax(120px,1fr) 56px 64px 64px 64px 88px'
const GRID_MOBILE = 'minmax(100px,1fr) 56px 70px 88px'

export function ModelBreakdown({ modelUsage, note, currency = 'USD', brlRate = 1, fallbackInputTokens, fallbackOutputTokens, fallbackCostUSD, lang = 'en' }: Props) {
  const isMobile = useIsMobile()
  const pt = lang === 'pt'
  const [query, setQuery] = useState('')
  const [sortKey, setSortKey] = useState<SortKey>('cost')
  const [byProvider, setByProvider] = useState(false)

  const allEntries = Object.entries(modelUsage).filter(([, u]) => u && (u.inputTokens + u.outputTokens) > 0)

  /** Search matches the model id or the company that bills it, so "opus" and "anthropic" both work.
   *  Sorting is by spend by default — the question this table is opened with. */
  const entries = useMemo(() => {
    const q = query.trim().toLowerCase()
    const filtered = q
      ? allEntries.filter(([id]) => id.toLowerCase().includes(q) || resolveProvider(id).label.toLowerCase().includes(q))
      : allEntries
    const tokensOf = (u: ModelUsage) => u.inputTokens + u.outputTokens + u.cacheReadInputTokens + u.cacheCreationInputTokens
    return [...filtered].sort(([aId, a], [bId, b]) =>
      sortKey === 'model' ? aId.localeCompare(bId)
      : sortKey === 'tokens' ? tokensOf(b) - tokensOf(a)
      : calcCost(b, bId) - calcCost(a, aId))
  }, [allEntries, query, sortKey])

  /** Grouping reorders rather than nesting: the table keeps one column grid, so a provider heading
   *  is just a row in the same flow. Within a provider the chosen sort still applies. */
  const ordered = useMemo(() => {
    if (!byProvider) return entries
    const rank = new Map(providerOrder().map((p, i) => [p.id, i]))
    return [...entries].sort(([a], [b]) => {
      const ra = rank.get(resolveProvider(a).id) ?? 99
      const rb = rank.get(resolveProvider(b).id) ?? 99
      return ra - rb || entries.findIndex(([m]) => m === a) - entries.findIndex(([m]) => m === b)
    })
  }, [entries, byProvider])

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

  const chip = (active: boolean): React.CSSProperties => ({
    padding: isMobile ? '0 11px' : '4px 10px',
    minHeight: isMobile ? 44 : undefined,
    borderRadius: 999, cursor: 'pointer', fontFamily: 'inherit', fontSize: 11.5,
    border: `1px solid ${active ? 'var(--anthropic-orange)' : 'var(--border)'}`,
    background: active ? 'var(--anthropic-orange-dim)' : 'var(--bg-card)',
    color: active ? 'var(--anthropic-orange)' : 'var(--text-secondary)',
    fontWeight: active ? 600 : 400,
  })

  return (
    <>
    {/* Controls sit OUTSIDE the table frame so the header row stays the table's own, and the
        toolbar does not inherit the grid that the columns depend on. */}
    <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, marginBottom: 10 }}>
      <input
        value={query}
        onChange={e => setQuery(e.target.value)}
        placeholder={pt ? 'Buscar modelo ou provedor…' : 'Search model or provider…'}
        style={{
          flex: '1 1 180px', minWidth: 0, boxSizing: 'border-box',
          padding: isMobile ? '11px 10px' : '5px 10px',
          minHeight: isMobile ? 44 : undefined,
          background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 8,
          fontSize: isMobile ? 16 : 12, color: 'var(--text-primary)', outline: 'none', fontFamily: 'inherit',
        }}
      />
      <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
        {([['cost', pt ? 'Custo' : 'Cost'], ['tokens', 'Tokens'], ['model', pt ? 'Nome' : 'Name']] as Array<[SortKey, string]>)
          .map(([k, label]) => (
            <button key={k} onClick={() => setSortKey(k)} style={chip(sortKey === k)}>{label}</button>
          ))}
        <button onClick={() => setByProvider(v => !v)} style={chip(byProvider)}>
          {pt ? 'Por provedor' : 'By provider'}
        </button>
      </div>
    </div>

    {entries.length === 0 ? (
      <div style={{ fontSize: 12, color: 'var(--text-tertiary)', padding: '10px 2px' }}>
        {pt ? `Nenhum modelo corresponde a "${query.trim()}".` : `No model matches "${query.trim()}".`}
      </div>
    ) : (
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
      {ordered.map(([modelId, usage], i) => {
        const provider = resolveProvider(modelId)
        const newGroup = byProvider && (i === 0 || resolveProvider(ordered[i - 1]![0]).id !== provider.id)
        const costUSD = calcCost(usage, modelId)
        const tokens = usage.inputTokens + usage.outputTokens + usage.cacheReadInputTokens + usage.cacheCreationInputTokens
        const pct = totalTokens > 0 ? tokens / totalTokens : 0
        const color = getModelColor(modelId)
        const isLast = i === ordered.length - 1

        return (
          <React.Fragment key={modelId}>
          {newGroup && (
            <div style={{
              padding: '7px 14px', background: 'var(--bg-card)',
              borderTop: i === 0 ? 'none' : '1px solid var(--border-subtle)',
              borderBottom: '1px solid var(--border-subtle)',
              fontSize: 11, fontWeight: 700, letterSpacing: 0.3,
              color: 'var(--text-secondary)', textTransform: 'uppercase',
            }}>{provider.label}</div>
          )}
          <div style={{
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
          </React.Fragment>
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
    )}
    </>
  )
}
