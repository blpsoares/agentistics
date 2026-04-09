import React, { useState } from 'react'
import { FileText, ArrowDownWideNarrow } from 'lucide-react'
import type { Lang } from '../lib/types'

interface Props {
  toolCounts: Record<string, number>
  toolOutputTokens: Record<string, number>
  agentFileReads: Record<string, number>
  lang: Lang
}

type ViewMode = 'calls' | 'tokens'

function fmt(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return String(n)
}

export function ToolMetricsPanel({ toolCounts, toolOutputTokens, agentFileReads, lang }: Props) {
  const [viewMode, setViewMode] = useState<ViewMode>('calls')
  const pt = lang === 'pt'

  const data = viewMode === 'calls' ? toolCounts : toolOutputTokens
  const entries = Object.entries(data)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 15)

  const max = Math.max(...entries.map(([, v]) => v), 1)
  const total = entries.reduce((s, [, v]) => s + v, 0)

  const agentEntries = Object.entries(agentFileReads)
    .sort((a, b) => b[1] - a[1])
  const totalAgentReads = agentEntries.reduce((s, [, v]) => s + v, 0)

  const hasTokenData = Object.keys(toolOutputTokens).length > 0

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* View toggle */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2 }}>
        <button
          onClick={() => setViewMode('calls')}
          style={{
            padding: '4px 10px',
            borderRadius: 6,
            border: `1px solid ${viewMode === 'calls' ? 'var(--accent-green)' : 'var(--border)'}`,
            background: viewMode === 'calls' ? 'rgba(34,197,94,0.12)' : 'transparent',
            color: viewMode === 'calls' ? 'var(--accent-green)' : 'var(--text-tertiary)',
            cursor: 'pointer',
            fontSize: 11,
            fontWeight: 600,
            fontFamily: 'inherit',
            transition: 'all 0.15s',
          }}
        >
          {pt ? 'Por chamadas' : 'By calls'}
        </button>
        {hasTokenData && (
          <button
            onClick={() => setViewMode('tokens')}
            style={{
              padding: '4px 10px',
              borderRadius: 6,
              border: `1px solid ${viewMode === 'tokens' ? 'var(--anthropic-orange)' : 'var(--border)'}`,
              background: viewMode === 'tokens' ? 'rgba(217,119,6,0.12)' : 'transparent',
              color: viewMode === 'tokens' ? 'var(--anthropic-orange)' : 'var(--text-tertiary)',
              cursor: 'pointer',
              fontSize: 11,
              fontWeight: 600,
              fontFamily: 'inherit',
              transition: 'all 0.15s',
            }}
          >
            {pt ? 'Por tokens gastos' : 'By token spend'}
          </button>
        )}
        <span style={{ fontSize: 10, color: 'var(--text-tertiary)', marginLeft: 'auto' }}>
          Total: {fmt(total)}
          {viewMode === 'tokens' ? ' tokens' : ` ${pt ? 'chamadas' : 'calls'}`}
        </span>
      </div>

      {/* Ranked bar chart */}
      {entries.length === 0 ? (
        <div style={{ color: 'var(--text-tertiary)', fontSize: 13, textAlign: 'center', padding: 16 }}>
          {pt ? 'Sem dados' : 'No data'}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
          {entries.map(([name, value]) => {
            const pct = value / max
            const shareOfTotal = total > 0 ? value / total : 0
            const isVillain = shareOfTotal > 0.4 && entries.length > 2
            const accentColor = viewMode === 'tokens'
              ? (isVillain ? '#ef4444' : 'var(--anthropic-orange)')
              : 'var(--accent-green)'

            return (
              <div key={name} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <div style={{
                  width: 90,
                  fontSize: 11,
                  fontWeight: isVillain ? 700 : 500,
                  color: isVillain ? '#ef4444' : 'var(--text-secondary)',
                  textAlign: 'right',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  flexShrink: 0,
                }}>
                  {name}
                </div>
                <div style={{
                  flex: 1,
                  height: 16,
                  background: 'var(--bg-elevated)',
                  borderRadius: 4,
                  overflow: 'hidden',
                  position: 'relative',
                }}>
                  <div style={{
                    width: `${pct * 100}%`,
                    height: '100%',
                    background: isVillain
                      ? 'linear-gradient(90deg, #ef4444, #f97316)'
                      : `${accentColor}40`,
                    borderRadius: 4,
                    transition: 'width 0.3s ease',
                  }} />
                </div>
                <div style={{
                  width: 60,
                  fontSize: 10,
                  color: 'var(--text-tertiary)',
                  textAlign: 'right',
                  flexShrink: 0,
                  fontVariantNumeric: 'tabular-nums',
                }}>
                  {fmt(value)}
                  <span style={{ opacity: 0.6, marginLeft: 2 }}>
                    ({Math.round(shareOfTotal * 100)}%)
                  </span>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Agent file reads section */}
      {totalAgentReads > 0 && (
        <div style={{
          marginTop: 8,
          padding: '12px 14px',
          borderRadius: 8,
          background: 'rgba(99,102,241,0.06)',
          border: '1px solid rgba(99,102,241,0.15)',
        }}>
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            marginBottom: 10,
            fontSize: 11,
            fontWeight: 600,
            color: 'var(--text-primary)',
          }}>
            <FileText size={12} style={{ color: '#6366f1' }} />
            {pt ? 'Leituras de arquivos de instrução' : 'Agent instruction file reads'}
            <span style={{
              fontSize: 10,
              color: '#6366f1',
              background: 'rgba(99,102,241,0.12)',
              padding: '1px 6px',
              borderRadius: 10,
              fontWeight: 700,
              marginLeft: 4,
            }}>
              {totalAgentReads}
            </span>
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {agentEntries.map(([name, count]) => (
              <div
                key={name}
                style={{
                  padding: '3px 9px',
                  borderRadius: 16,
                  background: 'rgba(99,102,241,0.10)',
                  border: '1px solid rgba(99,102,241,0.20)',
                  fontSize: 11,
                  color: 'var(--text-secondary)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 5,
                }}
              >
                {name}
                <span style={{ opacity: 0.6, fontSize: 10, fontWeight: 600 }}>{count}</span>
              </div>
            ))}
          </div>
          {totalAgentReads > 20 && (
            <div style={{
              marginTop: 8,
              fontSize: 10,
              color: 'var(--text-tertiary)',
              lineHeight: 1.5,
            }}>
              <ArrowDownWideNarrow size={10} style={{ verticalAlign: 'middle', marginRight: 3 }} />
              {pt
                ? 'Dica: Cada leitura de arquivo de instrução adiciona tokens ao contexto. Consolide arquivos quando possível.'
                : 'Tip: Each instruction file read adds tokens to context. Consolidate files when possible.'}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
