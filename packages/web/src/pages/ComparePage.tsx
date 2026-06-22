import React, { useMemo } from 'react'
import { useOutletContext } from 'react-router-dom'
import { GitCompare } from 'lucide-react'
import type { AppContext } from '../lib/app-context'
import type { HarnessId } from '@agentistics/core'
import { fmt, fmtCost } from '@agentistics/core'
import { HARNESS_LABELS, HARNESS_COLORS, capable } from '../lib/harness'
import { computeHarnessSummaries } from '../hooks/useData'

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

const DOW_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

function MiniBarChart({ values, color, peakIndex: peak, height = 40 }: {
  values: number[]
  color: string
  peakIndex: number | null
  height?: number
}) {
  const max = Math.max(...values, 1)
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 1, height }}>
      {values.map((v, i) => {
        const pct = Math.round((v / max) * 100)
        const isPeak = i === peak
        return (
          <div
            key={i}
            title={`${v}`}
            style={{
              flex: 1,
              height: `${Math.max(pct, v > 0 ? 4 : 0)}%`,
              background: isPeak ? color : `${color}55`,
              borderRadius: '2px 2px 0 0',
              minWidth: 2,
              transition: 'height 0.3s ease-out',
            }}
          />
        )
      })}
    </div>
  )
}

function SparklineChart({ data, color, height = 32 }: {
  data: { date: string; sessions: number }[]
  color: string
  height?: number
}) {
  if (data.length === 0) {
    return (
      <div style={{ height, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <span style={{ fontSize: 10, color: 'var(--text-tertiary)' }}>No data</span>
      </div>
    )
  }
  const max = Math.max(...data.map(d => d.sessions), 1)
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 1, height, overflow: 'hidden' }}>
      {data.map((d, i) => {
        const pct = Math.round((d.sessions / max) * 100)
        return (
          <div
            key={i}
            title={`${d.date}: ${d.sessions} sessions`}
            style={{
              flex: 1,
              height: `${Math.max(pct, d.sessions > 0 ? 4 : 0)}%`,
              background: `${color}99`,
              borderRadius: '1px 1px 0 0',
              minWidth: 1,
            }}
          />
        )
      })}
    </div>
  )
}

function SectionCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{
      background: 'var(--bg-card)',
      border: '1px solid var(--border)',
      borderRadius: 'var(--radius-lg)',
      padding: '20px 22px',
    }}>
      <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 16 }}>
        {title}
      </div>
      {children}
    </div>
  )
}

export default function ComparePage() {
  const { data, currency, brlRate } = useOutletContext<AppContext>()

  const summaries = useMemo(() => computeHarnessSummaries(data), [data])

  const aggs = useMemo<HarnessAgg[]>(() => {
    return data.harnesses.map(harness => {
      const s = summaries[harness] ?? { sessions: 0, messages: 0, inputTokens: 0, outputTokens: 0, costUSD: 0 }
      // lastActive is still derived from raw sessions (per-session field, no statsCache equivalent)
      const lastActive = data.sessions
        .filter(sess => (sess.harness ?? 'claude') === harness)
        .reduce<string | null>((best, sess) => {
          const t = sess.end_time ?? sess.start_time
          return t && (!best || t > best) ? t : best
        }, null)
      return {
        harness,
        sessions: s.sessions,
        messages: s.messages,
        inputTokens: capable(harness, 'tokens') ? s.inputTokens : 0,
        outputTokens: capable(harness, 'tokens') ? s.outputTokens : 0,
        costUSD: capable(harness, 'cost') ? s.costUSD : 0,
        lastActive,
      }
    })
  }, [data, summaries])

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

      {/* Section 1: Usage by hour of day */}
      <SectionCard title="Usage by hour of day">
        <div style={{
          display: 'grid',
          gridTemplateColumns: `repeat(${aggs.length}, 1fr)`,
          gap: 16,
        }}>
          {aggs.map(a => {
            const s = summaries[a.harness]
            const totalMsgs = s?.hourCounts.reduce((acc, v) => acc + v, 0) ?? 0
            return (
              <div key={a.harness}>
                <div style={{ fontSize: 11, fontWeight: 700, color: colors[a.harness], marginBottom: 8 }}>
                  {HARNESS_LABELS[a.harness]}
                </div>
                {totalMsgs === 0 ? (
                  <div style={{ height: 40, display: 'flex', alignItems: 'center' }}>
                    <NACell />
                  </div>
                ) : (
                  <>
                    <MiniBarChart
                      values={s?.hourCounts ?? Array(24).fill(0)}
                      color={colors[a.harness]}
                      peakIndex={s?.peakHour ?? null}
                      height={40}
                    />
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4 }}>
                      <span style={{ fontSize: 9, color: 'var(--text-tertiary)' }}>0h</span>
                      <span style={{ fontSize: 10, color: colors[a.harness], fontWeight: 600 }}>
                        {s?.peakHour !== null && s?.peakHour !== undefined
                          ? `Peak ${String(s.peakHour).padStart(2, '0')}:00`
                          : ''}
                      </span>
                      <span style={{ fontSize: 9, color: 'var(--text-tertiary)' }}>23h</span>
                    </div>
                  </>
                )}
              </div>
            )
          })}
        </div>
      </SectionCard>

      {/* Section 2: Busiest day of week */}
      <SectionCard title="Busiest day of week">
        <div style={{
          display: 'grid',
          gridTemplateColumns: `repeat(${aggs.length}, 1fr)`,
          gap: 16,
        }}>
          {aggs.map(a => {
            const s = summaries[a.harness]
            const hasData = s && s.dowCounts.some(v => v > 0)
            return (
              <div key={a.harness}>
                <div style={{ fontSize: 11, fontWeight: 700, color: colors[a.harness], marginBottom: 8 }}>
                  {HARNESS_LABELS[a.harness]}
                </div>
                {!hasData ? (
                  <div style={{ height: 40, display: 'flex', alignItems: 'center' }}>
                    <NACell />
                  </div>
                ) : (
                  <>
                    <MiniBarChart
                      values={s.dowCounts}
                      color={colors[a.harness]}
                      peakIndex={s.peakDow}
                      height={40}
                    />
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4 }}>
                      {DOW_LABELS.map((label, i) => (
                        <span
                          key={label}
                          style={{
                            fontSize: 9,
                            color: i === s.peakDow ? colors[a.harness] : 'var(--text-tertiary)',
                            fontWeight: i === s.peakDow ? 700 : 400,
                            flex: 1,
                            textAlign: 'center',
                          }}
                        >
                          {label.slice(0, 1)}
                        </span>
                      ))}
                    </div>
                    {s.peakDow !== null && (
                      <div style={{ fontSize: 11, color: colors[a.harness], fontWeight: 600, marginTop: 6 }}>
                        Peak: {DOW_LABELS[s.peakDow]}
                      </div>
                    )}
                  </>
                )}
              </div>
            )
          })}
        </div>
      </SectionCard>

      {/* Section 3: Activity over time */}
      <SectionCard title="Activity over time">
        <div style={{
          display: 'grid',
          gridTemplateColumns: `repeat(${aggs.length}, 1fr)`,
          gap: 16,
        }}>
          {aggs.map(a => {
            const s = summaries[a.harness]
            return (
              <div key={a.harness}>
                <div style={{ fontSize: 11, fontWeight: 700, color: colors[a.harness], marginBottom: 8 }}>
                  {HARNESS_LABELS[a.harness]}
                </div>
                <SparklineChart
                  data={s?.dailyActivity ?? []}
                  color={colors[a.harness]}
                  height={40}
                />
                <div style={{ fontSize: 10, color: 'var(--text-tertiary)', marginTop: 4 }}>
                  {s && s.dailyActivity.length > 0
                    ? `${s.dailyActivity[0]!.date.slice(0, 10)} – ${s.dailyActivity[s.dailyActivity.length - 1]!.date.slice(0, 10)}`
                    : 'No data'}
                </div>
              </div>
            )
          })}
        </div>
      </SectionCard>

      {/* Section 4: Peaks (token day + session cost) */}
      <SectionCard title="Peaks">
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th style={{
                padding: '0 16px 10px 0',
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
                  padding: '0 16px 10px',
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
            <tr>
              <td style={{
                padding: '12px 16px 12px 0',
                fontSize: 12,
                fontWeight: 600,
                color: 'var(--text-secondary)',
                whiteSpace: 'nowrap',
                borderBottom: '1px solid var(--border)',
              }}>
                Busiest token day
              </td>
              {aggs.map(a => {
                const s = summaries[a.harness]
                const ptd = capable(a.harness, 'tokens') ? s?.peakTokenDay : null
                return (
                  <td key={a.harness} style={{
                    padding: '12px 16px',
                    borderBottom: '1px solid var(--border)',
                  }}>
                    {!capable(a.harness, 'tokens') ? (
                      <NACell />
                    ) : ptd ? (
                      <div>
                        <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)', fontVariantNumeric: 'tabular-nums' }}>
                          {fmt(ptd.tokens)}
                        </div>
                        <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 2 }}>
                          {ptd.date}
                        </div>
                      </div>
                    ) : (
                      <span style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>—</span>
                    )}
                  </td>
                )
              })}
            </tr>
            <tr>
              <td style={{
                padding: '12px 16px 12px 0',
                fontSize: 12,
                fontWeight: 600,
                color: 'var(--text-secondary)',
                whiteSpace: 'nowrap',
              }}>
                Peak session cost
              </td>
              {aggs.map(a => {
                const s = summaries[a.harness]
                const psc = capable(a.harness, 'cost') ? s?.peakSessionCost : null
                return (
                  <td key={a.harness} style={{ padding: '12px 16px' }}>
                    {!capable(a.harness, 'cost') ? (
                      <NACell />
                    ) : psc !== null && psc !== undefined ? (
                      <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)', fontVariantNumeric: 'tabular-nums' }}>
                        {fmtCost(psc, currency, brlRate)}
                      </div>
                    ) : (
                      <span style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>—</span>
                    )}
                  </td>
                )
              })}
            </tr>
          </tbody>
        </table>
      </SectionCard>
    </>
  )
}
