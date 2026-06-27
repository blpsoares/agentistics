import React, { useMemo } from 'react'
import { useOutletContext } from 'react-router-dom'
import { GitCompare } from 'lucide-react'
import { format as formatDate } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import type { AppContext } from '../lib/app-context'
import type { HarnessId, Lang } from '@agentistics/core'
import { fmt, fmtCost, formatModel, t } from '@agentistics/core'
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

/** Format a raw date string (ISO or yyyy-MM-dd), localized by language. Returns '—' when invalid. */
function fmtDateLocalized(raw: string | null | undefined, lang: Lang): string {
  if (!raw) return '—'
  const d = new Date(raw)
  if (Number.isNaN(d.getTime())) return '—'
  return lang === 'pt'
    ? formatDate(d, 'dd MMM yyyy', { locale: ptBR })
    : formatDate(d, 'MMM d, yyyy')
}

function NACell({ lang }: { lang: Lang }) {
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
      {t('compare.na', lang)}
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
  lang: Lang
}

function MetricRow({ label, values, format: formatFn, colors, lang }: MetricRowProps) {
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
            <NACell lang={lang} />
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

const SPARK_BUCKETS = 60

/** Map a harness's active-day list onto a fixed number of buckets across a
 *  SHARED [minMs, maxMs] time axis, summing sessions per bucket. This lets every
 *  harness's sparkline share the same timeline, so a harness with only one or two
 *  active days renders as isolated thin bars instead of one giant block. */
function bucketize(
  daily: { date: string; sessions: number }[],
  minMs: number,
  maxMs: number,
  n: number,
): number[] {
  const buckets = new Array<number>(n).fill(0)
  if (daily.length === 0 || maxMs <= minMs) {
    // Degenerate range (no data, or all activity on a single day): drop each
    // active day into the first bucket so it's still represented.
    for (const d of daily) buckets[0] = (buckets[0] ?? 0) + d.sessions
    return buckets
  }
  const span = maxMs - minMs
  for (const d of daily) {
    const t = new Date(d.date).getTime()
    if (Number.isNaN(t)) continue
    let idx = Math.floor(((t - minMs) / span) * n)
    if (idx < 0) idx = 0
    if (idx >= n) idx = n - 1
    buckets[idx] = (buckets[idx] ?? 0) + d.sessions
  }
  return buckets
}

function SparklineChart({ buckets, color, height = 32, noDataLabel }: {
  buckets: number[]
  color: string
  height?: number
  noDataLabel: string
}) {
  const total = buckets.reduce((a, b) => a + b, 0)
  if (total === 0) {
    return (
      <div style={{ height, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <span style={{ fontSize: 10, color: 'var(--text-tertiary)' }}>{noDataLabel}</span>
      </div>
    )
  }
  const max = Math.max(...buckets, 1)
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 1, height, overflow: 'hidden' }}>
      {buckets.map((v, i) => {
        const pct = (v / max) * 100
        return (
          <div
            key={i}
            title={`${v} sessions`}
            style={{
              flex: 1,
              height: `${v > 0 ? Math.max(pct, 8) : 0}%`,
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
  const { data, currency, brlRate, lang } = useOutletContext<AppContext>()

  const summaries = useMemo(() => computeHarnessSummaries(data), [data])

  // Localized short day-of-week labels (Sunday-first to match getDay()).
  const dowLabels = useMemo(() => [
    t('compare.dow.sun', lang),
    t('compare.dow.mon', lang),
    t('compare.dow.tue', lang),
    t('compare.dow.wed', lang),
    t('compare.dow.thu', lang),
    t('compare.dow.fri', lang),
    t('compare.dow.sat', lang),
  ], [lang])

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

  // Shared time axis for the "Activity over time" sparklines, spanning the
  // earliest→latest active day across ALL harnesses so they are comparable.
  const { minMs, maxMs } = useMemo(() => {
    let mn = Infinity, mx = -Infinity
    for (const h of data.harnesses) {
      for (const d of summaries[h]?.dailyActivity ?? []) {
        const t = new Date(d.date).getTime()
        if (Number.isNaN(t)) continue
        if (t < mn) mn = t
        if (t > mx) mx = t
      }
    }
    return { minMs: mn === Infinity ? 0 : mn, maxMs: mx === -Infinity ? 0 : mx }
  }, [data.harnesses, summaries])

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

  // Cost per 1M tokens (blended) — null where not applicable. Used to highlight the cheapest.
  const costPerMValues = aggs.map(a => ({
    harness: a.harness,
    value: capable(a.harness, 'cost') && capable(a.harness, 'tokens')
      ? (summaries[a.harness]?.costPerMTokens ?? null)
      : null,
  }))
  const cheapestHarness = useMemo<HarnessId | null>(() => {
    let best: HarnessId | null = null
    let bestVal = Infinity
    for (const { harness, value } of costPerMValues) {
      if (value !== null && value > 0 && value < bestVal) {
        bestVal = value
        best = harness
      }
    }
    return best
  }, [costPerMValues])

  const fmtTokens = (v: number) => fmt(v)
  const fmtCostFn = (v: number) => fmtCost(v, currency, brlRate)
  const fmtCount = (v: number) => v.toLocaleString()
  const modelLabel = (model: string) =>
    model === 'unknown' ? t('compare.unknownModel', lang) : formatModel(model)

  return (
    <>
      {/* Page header */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 4 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 18, fontWeight: 700, color: 'var(--text-primary)' }}>
          <span style={{ color: 'var(--anthropic-orange)' }}><GitCompare size={16} /></span>
          {t('compare.title', lang)}
        </div>
        <div style={{ fontSize: 12, color: 'var(--text-tertiary)', lineHeight: 1.5 }}>
          {t('compare.subtitle', lang)}
        </div>
      </div>

      {/* Legend / harness header cards */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
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
              {t('compare.sessionsLower', lang)}
            </div>
            {a.lastActive && (
              <div style={{ fontSize: 10, color: 'var(--text-tertiary)', marginTop: 8 }}>
                {t('compare.lastActive', lang)}: {fmtDateLocalized(a.lastActive, lang)}
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
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: `${120 + aggs.length * 130}px` }}>
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
                {t('compare.metric', lang)}
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
            <MetricRow label={t('compare.sessions', lang)} values={sessionValues} format={fmtCount} colors={colors} lang={lang} />
            <MetricRow label={t('compare.messages', lang)} values={messageValues} format={fmtCount} colors={colors} lang={lang} />
            <MetricRow label={t('compare.totalTokens', lang)} values={tokensValues} format={fmtTokens} colors={colors} lang={lang} />
            <MetricRow
              label={t('compare.inputTokens', lang)}
              values={aggs.map(a => ({
                harness: a.harness,
                value: capable(a.harness, 'tokens') ? a.inputTokens : null,
              }))}
              format={fmtTokens}
              colors={colors}
              lang={lang}
            />
            <MetricRow
              label={t('compare.outputTokens', lang)}
              values={aggs.map(a => ({
                harness: a.harness,
                value: capable(a.harness, 'tokens') ? a.outputTokens : null,
              }))}
              format={fmtTokens}
              colors={colors}
              lang={lang}
            />
            <MetricRow label={t('compare.cost', lang)} values={costValues} format={fmtCostFn} colors={colors} lang={lang} />
          </tbody>
        </table>
      </div>

      {/* Cost per 1M tokens (blended) — highlights the cheapest harness */}
      <SectionCard title={t('compare.costPerMTokens', lang)}>
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
          gap: 12,
        }}>
          {costPerMValues.map(({ harness, value }) => {
            const isCheapest = harness === cheapestHarness && value !== null
            return (
              <div key={harness} style={{
                background: 'var(--bg-elevated)',
                border: isCheapest ? `1px solid ${colors[harness]}` : '1px solid var(--border)',
                borderRadius: 'var(--radius-md, 8px)',
                padding: '14px 16px',
              }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: colors[harness], marginBottom: 8 }}>
                  {HARNESS_LABELS[harness]}
                </div>
                {value === null ? (
                  <NACell lang={lang} />
                ) : (
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
                    <span style={{ fontSize: 18, fontWeight: 800, color: 'var(--text-primary)', fontVariantNumeric: 'tabular-nums' }}>
                      {fmtCost(value, currency, brlRate)}
                    </span>
                    {isCheapest && (
                      <span style={{
                        fontSize: 10,
                        fontWeight: 700,
                        color: colors[harness],
                        background: `${colors[harness]}22`,
                        borderRadius: 4,
                        padding: '2px 6px',
                        textTransform: 'uppercase',
                        letterSpacing: '0.04em',
                      }}>
                        {t('compare.cheapest', lang)}
                      </span>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </SectionCard>

      {/* Cost by model — per harness, listing each model's tokens + cost */}
      <SectionCard title={t('compare.costByModel', lang)}>
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
          gap: 16,
        }}>
          {aggs.map(a => {
            const s = summaries[a.harness]
            const showModels = capable(a.harness, 'cost') && capable(a.harness, 'model')
            const models = showModels ? (s?.models ?? []) : []
            return (
              <div key={a.harness}>
                <div style={{ fontSize: 11, fontWeight: 700, color: colors[a.harness], marginBottom: 8 }}>
                  {HARNESS_LABELS[a.harness]}
                </div>
                {!showModels ? (
                  <NACell lang={lang} />
                ) : models.length === 0 ? (
                  <span style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>{t('compare.noData', lang)}</span>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {models.map(m => {
                      const totalTok = m.inputTokens + m.outputTokens
                      const perM = totalTok > 0 ? m.costUSD / (totalTok / 1e6) : null
                      return (
                        <div key={m.model} style={{
                          display: 'flex',
                          flexDirection: 'column',
                          gap: 2,
                          paddingBottom: 8,
                          borderBottom: '1px solid var(--border)',
                        }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                            <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary)' }}>
                              {modelLabel(m.model)}
                            </span>
                            <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-secondary)', fontVariantNumeric: 'tabular-nums' }}>
                              {fmtCost(m.costUSD, currency, brlRate)}
                            </span>
                          </div>
                          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                            <span style={{ fontSize: 10, color: 'var(--text-tertiary)', fontVariantNumeric: 'tabular-nums' }}>
                              {fmt(totalTok)} {t('compare.totalTokens', lang).toLowerCase()}
                            </span>
                            <span style={{ fontSize: 10, color: 'var(--text-tertiary)', fontVariantNumeric: 'tabular-nums' }}>
                              {perM !== null ? `${fmtCost(perM, currency, brlRate)} / 1M` : '—'}
                            </span>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </SectionCard>

      {/* Per-harness activity bar */}
      <div style={{
        background: 'var(--bg-card)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius-lg)',
        padding: '20px 22px',
      }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 16 }}>
          {t('compare.sessionShare', lang)}
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
                      {a.sessions.toLocaleString()} {t('compare.sessionsLower', lang)}
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
      <SectionCard title={t('compare.usageByHourOfDay', lang)}>
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
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
                    <NACell lang={lang} />
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
                          ? `${t('compare.peak', lang)} ${String(s.peakHour).padStart(2, '0')}:00`
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
      <SectionCard title={t('compare.busiestDayOfWeek', lang)}>
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
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
                    <NACell lang={lang} />
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
                      {dowLabels.map((label, i) => (
                        <span
                          key={i}
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
                        {t('compare.peak', lang)}: {dowLabels[s.peakDow]}
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
      <SectionCard title={t('compare.activityOverTime', lang)}>
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
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
                  buckets={bucketize(s?.dailyActivity ?? [], minMs, maxMs, SPARK_BUCKETS)}
                  color={colors[a.harness]}
                  height={40}
                  noDataLabel={t('compare.noData', lang)}
                />
                <div style={{ fontSize: 10, color: 'var(--text-tertiary)', marginTop: 4 }}>
                  {s && s.dailyActivity.length > 0
                    ? `${fmtDateLocalized(s.dailyActivity[0]!.date, lang)} – ${fmtDateLocalized(s.dailyActivity[s.dailyActivity.length - 1]!.date, lang)}`
                    : t('compare.noData', lang)}
                </div>
              </div>
            )
          })}
        </div>
      </SectionCard>

      {/* Section 4: Peaks (token day + session cost) */}
      <SectionCard title={t('compare.peaks', lang)}>
        <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: `${120 + aggs.length * 130}px` }}>
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
                {t('compare.metric', lang)}
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
                {t('compare.peakTokenDay', lang)}
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
                      <NACell lang={lang} />
                    ) : ptd ? (
                      <div>
                        <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)', fontVariantNumeric: 'tabular-nums' }}>
                          {fmt(ptd.tokens)}
                        </div>
                        <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 2 }}>
                          {fmtDateLocalized(ptd.date, lang)}
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
                {t('compare.peakSessionCost', lang)}
              </td>
              {aggs.map(a => {
                const s = summaries[a.harness]
                const psc = capable(a.harness, 'cost') ? s?.peakSessionCost : null
                return (
                  <td key={a.harness} style={{ padding: '12px 16px' }}>
                    {!capable(a.harness, 'cost') ? (
                      <NACell lang={lang} />
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
        </div>
      </SectionCard>
    </>
  )
}
