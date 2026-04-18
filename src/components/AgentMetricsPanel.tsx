import React, { useState } from 'react'
import { CheckCircle, XCircle, ChevronDown, ChevronUp, Bot } from 'lucide-react'
import type { AgentInvocation } from '../lib/types'
import type { Lang } from '../lib/types'
import { useIsMobile } from '../hooks/useIsMobile'

interface AgentMetricsPanelProps {
  invocations: AgentInvocation[]
  agentTypeBreakdown: Record<string, { count: number; tokens: number; costUSD: number; durationMs: number }>
  totalInvocations: number
  totalTokens: number
  totalCostUSD: number
  totalDurationMs: number
  currency: 'USD' | 'BRL'
  brlRate: number
  lang: Lang
}

function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return String(n)
}

function fmtCost(usd: number, currency: 'USD' | 'BRL', rate: number): string {
  if (currency === 'BRL') {
    const brl = usd * rate
    if (brl < 0.005) return '<R$0,01'
    return `R$${brl.toFixed(2).replace('.', ',')}`
  }
  if (usd < 0.001) return '<USD 0.001'
  if (usd < 0.01) return `USD ${usd.toFixed(3)}`
  return `USD ${usd.toFixed(2)}`
}

function fmtDuration(ms: number): string {
  if (ms === 0) return '—'
  const s = Math.round(ms / 1000)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  const rem = s % 60
  return rem > 0 ? `${m}m ${rem}s` : `${m}m`
}

function AgentTypeBadge({ type }: { type: string }) {
  const colors: Record<string, { bg: string; text: string }> = {
    'general-purpose': { bg: 'rgba(99,102,241,0.15)', text: '#818cf8' },
    'Explore':         { bg: 'rgba(16,185,129,0.15)', text: '#34d399' },
    'Plan':            { bg: 'rgba(245,158,11,0.15)', text: '#fbbf24' },
    'claude-code-guide': { bg: 'rgba(6,182,212,0.15)', text: '#22d3ee' },
    'statusline-setup': { bg: 'rgba(139,92,246,0.15)', text: '#a78bfa' },
    'code-reviewer':   { bg: 'rgba(239,68,68,0.15)', text: '#f87171' },
  }
  const style = colors[type] ?? { bg: 'rgba(148,163,184,0.15)', text: 'var(--text-secondary)' }
  return (
    <span style={{
      display: 'inline-block',
      padding: '1px 7px',
      borderRadius: 10,
      fontSize: 10,
      fontWeight: 600,
      background: style.bg,
      color: style.text,
      whiteSpace: 'nowrap',
    }}>
      {type}
    </span>
  )
}

function SummaryCard({ label, value, sub, accent }: { label: string; value: string; sub: string; accent: string }) {
  return (
    <div style={{
      background: 'var(--bg-elevated)',
      border: '1px solid var(--border)',
      borderRadius: 10,
      padding: '12px 14px',
    }}>
      <div style={{ fontSize: 10, color: 'var(--text-tertiary)', fontWeight: 500, marginBottom: 5, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
        {label}
      </div>
      <div style={{ fontSize: 20, fontWeight: 700, color: accent, lineHeight: 1, marginBottom: 3 }}>
        {value}
      </div>
      <div style={{ fontSize: 10, color: 'var(--text-tertiary)' }}>{sub}</div>
    </div>
  )
}

export function AgentMetricsPanel({
  invocations,
  agentTypeBreakdown,
  totalInvocations,
  totalTokens,
  totalCostUSD,
  totalDurationMs,
  currency,
  brlRate,
  lang,
}: AgentMetricsPanelProps) {
  const [showAll, setShowAll] = useState(false)
  const pt = lang === 'pt'
  const isMobile = useIsMobile()

  if (totalInvocations === 0) {
    return (
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
        padding: '32px 0',
        color: 'var(--text-tertiary)',
        fontSize: 13,
      }}>
        <Bot size={16} style={{ opacity: 0.4 }} />
        {pt ? 'Nenhuma invocação de agente encontrada no período' : 'No agent invocations found in this period'}
      </div>
    )
  }

  const avgDurationMs = totalInvocations > 0 ? totalDurationMs / totalInvocations : 0
  const avgTokens = totalInvocations > 0 ? totalTokens / totalInvocations : 0

  // Sort breakdown by count descending
  const sortedTypes = Object.entries(agentTypeBreakdown)
    .sort((a, b) => b[1].count - a[1].count)
  const maxCount = sortedTypes[0]?.[1].count ?? 1

  const displayInvocations = showAll ? invocations : invocations.slice(0, 10)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* Summary cards */}
      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? 'repeat(2, 1fr)' : 'repeat(4, 1fr)', gap: 12 }}>
        <SummaryCard
          label={pt ? 'Invocações' : 'Invocations'}
          value={String(totalInvocations)}
          sub={pt ? 'total de agentes chamados' : 'total agent calls'}
          accent="var(--accent-purple)"
        />
        <SummaryCard
          label={pt ? 'Tokens de agentes' : 'Agent tokens'}
          value={fmtTokens(totalTokens)}
          sub={`avg ${fmtTokens(Math.round(avgTokens))} / ${pt ? 'chamada' : 'call'}`}
          accent="var(--accent-blue)"
        />
        <SummaryCard
          label={pt ? 'Custo dos agentes' : 'Agent cost'}
          value={fmtCost(totalCostUSD, currency, brlRate)}
          sub={`avg ${fmtCost(totalCostUSD / totalInvocations, currency, brlRate)} / ${pt ? 'chamada' : 'call'}`}
          accent="var(--anthropic-orange)"
        />
        <SummaryCard
          label={pt ? 'Duração total' : 'Total duration'}
          value={fmtDuration(totalDurationMs)}
          sub={`avg ${fmtDuration(Math.round(avgDurationMs))} / ${pt ? 'chamada' : 'call'}`}
          accent="var(--accent-green)"
        />
      </div>

      {/* Agent type breakdown */}
      {sortedTypes.length > 0 && (
        <div>
          <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 10 }}>
            {pt ? 'Por tipo de agente' : 'By agent type'}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {sortedTypes.map(([type, stats]) => (
              <div key={type} style={{ display: 'grid', gridTemplateColumns: isMobile ? 'minmax(0,1fr) 1fr 50px' : '160px 1fr 60px 80px 80px', gap: isMobile ? 8 : 10, alignItems: 'center', fontSize: 11 }}>
                <AgentTypeBadge type={type} />
                <div style={{ position: 'relative', height: 6, background: 'var(--bg-elevated)', borderRadius: 3, overflow: 'hidden' }}>
                  <div style={{
                    position: 'absolute', left: 0, top: 0, bottom: 0,
                    width: `${(stats.count / maxCount) * 100}%`,
                    background: 'var(--accent-purple)',
                    borderRadius: 3,
                    opacity: 0.7,
                  }} />
                </div>
                <span style={{ color: 'var(--text-primary)', fontWeight: 600, textAlign: 'right' }}>
                  {stats.count}×
                </span>
                {!isMobile && <span style={{ color: 'var(--text-secondary)', textAlign: 'right' }}>
                  {fmtTokens(stats.tokens)} tok
                </span>}
                {!isMobile && <span style={{ color: 'var(--anthropic-orange)', textAlign: 'right' }}>
                  {fmtCost(stats.costUSD, currency, brlRate)}
                </span>}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Per-invocation list */}
      <div>
        <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 10 }}>
          {pt ? 'Invocações recentes' : 'Recent invocations'}
          <span style={{ marginLeft: 6, fontWeight: 400, color: 'var(--text-tertiary)' }}>
            ({pt ? `exibindo ${displayInvocations.length} de ${totalInvocations}` : `showing ${displayInvocations.length} of ${totalInvocations}`})
          </span>
        </div>
        <div style={{ border: '1px solid var(--border)', borderRadius: 8, overflow: isMobile ? 'auto' : 'hidden', width: '100%' }}>
          <div style={{ minWidth: isMobile ? 480 : undefined }}>
          {/* Table header */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: '140px 1fr 60px 60px 60px 80px',
            gap: 10,
            padding: '7px 12px',
            background: 'var(--bg-elevated)',
            borderBottom: '1px solid var(--border)',
            fontSize: 10,
            fontWeight: 600,
            color: 'var(--text-tertiary)',
            textTransform: 'uppercase',
            letterSpacing: '0.04em',
          }}>
            <span>{pt ? 'Tipo' : 'Type'}</span>
            <span>{pt ? 'Descrição' : 'Description'}</span>
            <span style={{ textAlign: 'right' }}>Tokens</span>
            <span style={{ textAlign: 'right' }}>{pt ? 'Tools' : 'Tools'}</span>
            <span style={{ textAlign: 'right' }}>{pt ? 'Duração' : 'Duration'}</span>
            <span style={{ textAlign: 'right' }}>{pt ? 'Custo' : 'Cost'}</span>
          </div>
          {/* Rows */}
          {displayInvocations.map((inv, i) => (
            <div
              key={inv.toolUseId || i}
              style={{
                display: 'grid',
                gridTemplateColumns: '140px 1fr 60px 60px 60px 80px',
                gap: 10,
                padding: '8px 12px',
                alignItems: 'center',
                borderBottom: i < displayInvocations.length - 1 ? '1px solid var(--border)' : 'none',
                background: i % 2 === 0 ? 'transparent' : 'var(--bg-elevated)',
              }}
            >
              <AgentTypeBadge type={inv.agentType} />
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
                {inv.status === 'failed'
                  ? <XCircle size={11} color="var(--accent-red, #ef4444)" style={{ flexShrink: 0 }} />
                  : <CheckCircle size={11} color="var(--accent-green)" style={{ flexShrink: 0 }} />
                }
                <span style={{
                  fontSize: 11,
                  color: 'var(--text-secondary)',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}>
                  {inv.description || <em style={{ color: 'var(--text-tertiary)' }}>—</em>}
                </span>
              </div>
              <span style={{ fontSize: 11, color: 'var(--text-primary)', textAlign: 'right' }}>
                {fmtTokens(inv.totalTokens)}
              </span>
              <span style={{ fontSize: 11, color: 'var(--text-secondary)', textAlign: 'right' }}>
                {inv.totalToolUseCount}
              </span>
              <span style={{ fontSize: 11, color: 'var(--text-secondary)', textAlign: 'right' }}>
                {fmtDuration(inv.totalDurationMs)}
              </span>
              <span style={{ fontSize: 11, color: 'var(--anthropic-orange)', textAlign: 'right' }}>
                {fmtCost(inv.costUSD, currency, brlRate)}
              </span>
            </div>
          ))}
          </div>
        </div>

        {invocations.length > 10 && (
          <button
            onClick={() => setShowAll(v => !v)}
            style={{
              display: 'flex', alignItems: 'center', gap: 5,
              marginTop: 8,
              padding: '5px 10px',
              border: '1px solid var(--border)',
              borderRadius: 6,
              background: 'transparent',
              color: 'var(--text-secondary)',
              fontSize: 11,
              cursor: 'pointer',
              fontFamily: 'inherit',
            }}
          >
            {showAll
              ? <><ChevronUp size={12} /> {pt ? 'Mostrar menos' : 'Show less'}</>
              : <><ChevronDown size={12} /> {pt ? `Ver todas (${totalInvocations})` : `Show all (${totalInvocations})`}</>
            }
          </button>
        )}
      </div>
    </div>
  )
}
