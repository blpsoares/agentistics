import React, { useMemo } from 'react'
import { useOutletContext } from 'react-router-dom'
import { GitCompare } from 'lucide-react'
import type { AppContext } from '../lib/app-context'
import type { HarnessId } from '@agentistics/core'
import { calcCost, fmt, fmtCost } from '@agentistics/core'
import { HARNESS_LABELS, HARNESS_COLORS, capable } from '../lib/harness'

interface HarnessAgg {
  harness: HarnessId
  sessions: number
  messages: number
  inputTokens: number
  outputTokens: number
  costUSD: number
  lastActive: string | null
}

function NACell() {
  return (
    <span style={{
      display: 'inline-flex',
      alignItems: 'center',
      padding: '2px 8px',
      borderRadius: 5,
      background: 'var(--bg-elevated)',
      border: '1px solid var(--border)',
      fontSize: 11,
      fontWeight: 600,
      color: 'var(--text-tertiary)',
      letterSpacing: '0.03em',
    }}>
      N/A
    </span>
  )
}

function MetricBar({ value, max, color }: { value: number; max: number; color: string }) {
  const pct = max > 0 ? Math.round((value / max) * 100) : 0
  return (
    <div style={{ height: 4, background: 'var(--bg-elevated)', borderRadius: 2, overflow: 'hidden', marginTop: 6 }}>
      <div style={{
        height: '100%',
        width: `${pct}%`,
        background: color,
        borderRadius: 2,
        transition: 'width 0.4s ease-out',
        opacity: 0.75,
      }} />
    </div>
  )
}

interface MetricRowProps {
  label: string
  values: { harness: HarnessId; value: number | null }[]
  format: (v: number) => string
  colors: Record<HarnessId, string>
}

function MetricRow({ label, values, format: formatFn, colors }: MetricRowProps) {
  const maxVal = Math.max(...values.map(v => v.value ?? 0))
  return (
    <tr>
      <td style={{
        padding: '12px 16px 12px 0',
        fontSize: 12,
        fontWeight: 600,
        color: 'var(--text-secondary)',
        whiteSpace: 'nowrap',
        borderBottom: '1px solid var(--border)',
        verticalAlign: 'top',
      }}>
        {label}
      </td>
      {values.map(({ harness, value }) => (
        <td key={harness} style={{
          padding: '12px 16px',
          borderBottom: '1px solid var(--border)',
          verticalAlign: 'top',
        }}>
          {value === null ? (
            <NACell />
          ) : (
            <>
              <div style={{
                fontSize: 15,
                fontWeight: 700,
                color: 'var(--text-primary)',
                fontVariantNumeric: 'tabular-nums',
              }}>
                {formatFn(value)}
              </div>
              <MetricBar value={value} max={maxVal} color={colors[harness]} />
            </>
          )}
        </td>
      ))}
    </tr>
  )
}

export default function ComparePage() {
  const { data, currency, brlRate } = useOutletContext<AppContext>()

  const aggs = useMemo<HarnessAgg[]>(() => {
    return data.harnesses.map(harness => {
      const sessions = data.sessions.filter(s => s.harness === harness)
      let inputTokens = 0
      let outputTokens = 0
      let costUSD = 0
      let messages = 0
      let lastActive: string | null = null

      for (const s of sessions) {
        messages += (s.user_message_count ?? 0) + (s.assistant_message_count ?? 0)
        if (capable(harness, 'tokens')) {
          inputTokens += s.input_tokens ?? 0
          outputTokens += s.output_tokens ?? 0
        }
        if (capable(harness, 'cost') && s.model) {
          costUSD += calcCost(
            {
              inputTokens: s.input_tokens ?? 0,
              outputTokens: s.output_tokens ?? 0,
              cacheReadInputTokens: s.cache_read_input_tokens ?? 0,
              cacheCreationInputTokens: s.cache_creation_input_tokens ?? 0,
              webSearchRequests: 0,
              costUSD: 0,
            },
            s.model,
          )
        }
        const t = s.end_time ?? s.start_time
        if (t && (!lastActive || t > lastActive)) lastActive = t
      }

      return { harness, sessions: sessions.length, messages, inputTokens, outputTokens, costUSD, lastActive }
    })
  }, [data.sessions, data.harnesses])

  const colors = HARNESS_COLORS

  const tokensValues = aggs.map(a => ({
    harness: a.harness,
    value: capable(a.harness, 'tokens') ? a.inputTokens + a.outputTokens : null,
  }))
  const costValues = aggs.map(a => ({
    harness: a.harness,
    value: capable(a.harness, 'cost') ? a.costUSD : null,
  }))
  const sessionValues = aggs.map(a => ({ harness: a.harness, value: a.sessions }))
  const messageValues = aggs.map(a => ({ harness: a.harness, value: a.messages }))

  const fmtTokens = (v: number) => fmt(v)
  const fmtCostFn = (v: number) => fmtCost(v, currency, brlRate)
  const fmtCount = (v: number) => v.toLocaleString()

  return (
    <>
      {/* Page header */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 4 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 18, fontWeight: 700, color: 'var(--text-primary)' }}>
          <span style={{ color: 'var(--anthropic-orange)' }}><GitCompare size={16} /></span>
          Compare harnesses
        </div>
        <div style={{ fontSize: 12, color: 'var(--text-tertiary)', lineHeight: 1.5 }}>
          Side-by-side metrics for all AI coding assistants detected in your data.
          N/A means the harness does not report that metric.
        </div>
      </div>

      {/* Legend / harness header cards */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: `repeat(${aggs.length}, 1fr)`,
        gap: 12,
      }}>
        {aggs.map(a => (
          <div key={a.harness} style={{
            background: 'var(--bg-card)',
            border: `1px solid ${colors[a.harness]}40`,
            borderRadius: 'var(--radius-lg)',
            padding: '16px 18px',
            borderTop: `3px solid ${colors[a.harness]}`,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <span style={{
                display: 'inline-block',
                width: 10,
                height: 10,
                borderRadius: '50%',
                background: colors[a.harness],
                flexShrink: 0,
              }} />
              <span style={{ fontSize: 13, fontWeight: 700, color: colors[a.harness] }}>
                {HARNESS_LABELS[a.harness]}
              </span>
            </div>
            <div style={{ fontSize: 22, fontWeight: 800, color: 'var(--text-primary)', fontVariantNumeric: 'tabular-nums' }}>
              {a.sessions.toLocaleString()}
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 2 }}>
              sessions
            </div>
            {a.lastActive && (
              <div style={{ fontSize: 10, color: 'var(--text-tertiary)', marginTop: 8 }}>
                Last active: {a.lastActive.slice(0, 10)}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Comparison table */}
      <div style={{
        background: 'var(--bg-card)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius-lg)',
        padding: '20px 22px',
        overflowX: 'auto',
      }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th style={{
                padding: '0 16px 14px 0',
                textAlign: 'left',
                fontSize: 11,
                fontWeight: 600,
                color: 'var(--text-tertiary)',
                textTransform: 'uppercase',
                letterSpacing: '0.06em',
                borderBottom: '1px solid var(--border)',
              }}>
                Metric
              </th>
              {aggs.map(a => (
                <th key={a.harness} style={{
                  padding: '0 16px 14px',
                  textAlign: 'left',
                  fontSize: 11,
                  fontWeight: 700,
                  color: colors[a.harness],
                  textTransform: 'uppercase',
                  letterSpacing: '0.06em',
                  borderBottom: `2px solid ${colors[a.harness]}`,
                  whiteSpace: 'nowrap',
                }}>
                  {HARNESS_LABELS[a.harness]}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <MetricRow
              label="Sessions"
              values={sessionValues}
              format={fmtCount}
              colors={colors}
            />
            <MetricRow
              label="Messages"
              values={messageValues}
              format={fmtCount}
              colors={colors}
            />
            <MetricRow
              label="Total tokens"
              values={tokensValues}
              format={fmtTokens}
              colors={colors}
            />
            <MetricRow
              label="Input tokens"
              values={aggs.map(a => ({
                harness: a.harness,
                value: capable(a.harness, 'tokens') ? a.inputTokens : null,
              }))}
              format={fmtTokens}
              colors={colors}
            />
            <MetricRow
              label="Output tokens"
              values={aggs.map(a => ({
                harness: a.harness,
                value: capable(a.harness, 'tokens') ? a.outputTokens : null,
              }))}
              format={fmtTokens}
              colors={colors}
            />
            <MetricRow
              label="Estimated cost"
              values={costValues}
              format={fmtCostFn}
              colors={colors}
            />
          </tbody>
        </table>
      </div>

      {/* Per-harness activity bar */}
      <div style={{
        background: 'var(--bg-card)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius-lg)',
        padding: '20px 22px',
      }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 16 }}>
          Session share
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {aggs.map(a => {
            const totalSessions = aggs.reduce((s, x) => s + x.sessions, 0)
            const pct = totalSessions > 0 ? Math.round((a.sessions / totalSessions) * 100) : 0
            return (
              <div key={a.harness}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{
                      display: 'inline-block',
                      width: 8,
                      height: 8,
                      borderRadius: '50%',
                      background: colors[a.harness],
                    }} />
                    <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary)' }}>
                      {HARNESS_LABELS[a.harness]}
                    </span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span style={{ fontSize: 12, color: 'var(--text-secondary)', fontVariantNumeric: 'tabular-nums' }}>
                      {a.sessions.toLocaleString()} sessions
                    </span>
                    <span style={{ fontSize: 12, fontWeight: 700, color: colors[a.harness], minWidth: 36, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                      {pct}%
                    </span>
                  </div>
                </div>
                <div style={{ height: 6, background: 'var(--bg-elevated)', borderRadius: 3, overflow: 'hidden' }}>
                  <div style={{
                    height: '100%',
                    width: `${pct}%`,
                    background: colors[a.harness],
                    borderRadius: 3,
                    transition: 'width 0.4s ease-out',
                  }} />
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </>
  )
}
