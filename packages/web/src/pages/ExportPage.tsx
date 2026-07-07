import React, { useState, useMemo, useRef, useEffect } from 'react'
import { useOutletContext } from 'react-router-dom'
import { FileDown, Download, Sun, Moon, Check, Calendar, Cpu, FolderOpen, Users } from 'lucide-react'
import { format } from 'date-fns'
import type { AppContext } from '../lib/app-context'
import type { HarnessId, Filters, Lang } from '@agentistics/core'
import { t, formatModel, formatProjectName, distinctUsers } from '@agentistics/core'
import { useDerivedStats, blendedCostPerToken, computeHarnessSummaries } from '../hooks/useData'
import { useIsMobile } from '../hooks/useIsMobile'
import {
  runPDFCapture, PDFContent, COLORS, SECTIONS, SECTION_IDS, DATE_OPTIONS,
} from '../components/PDFExportModal'
import type { PDFTheme, SectionId, ChartMetric } from '../components/PDFExportModal'
import { HARNESS_LABELS, HARNESS_COLORS, capable } from '../lib/harness'

// ── Types ─────────────────────────────────────────────────────────────────────

type ExportScope = 'all' | HarnessId | 'compare'

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Distribute daily session counts into n equal-width time buckets over a shared
 *  [minMs, maxMs] axis so sparklines across harnesses are temporally comparable. */
function bucketize(
  daily: { date: string; sessions: number }[],
  minMs: number,
  maxMs: number,
  n: number,
): number[] {
  const buckets = new Array<number>(n).fill(0)
  if (daily.length === 0 || maxMs <= minMs) {
    for (const d of daily) buckets[0] = (buckets[0] ?? 0) + d.sessions
    return buckets
  }
  const span = maxMs - minMs
  for (const d of daily) {
    const ts = new Date(d.date).getTime()
    if (Number.isNaN(ts)) continue
    let idx = Math.floor(((ts - minMs) / span) * n)
    if (idx < 0) idx = 0
    if (idx >= n) idx = n - 1
    buckets[idx] = (buckets[idx] ?? 0) + d.sessions
  }
  return buckets
}

function fmtN(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return String(n)
}

// ── Compare PDF content — inline-styled A4 document ──────────────────────────

interface ComparePDFContentProps {
  summaries: ReturnType<typeof computeHarnessSummaries>
  harnesses: HarnessId[]
  pdfTheme: PDFTheme
  lang: Lang
  currency: 'USD' | 'BRL'
  brlRate: number
  logoDataUri: string
}

function ComparePDFContent({ summaries, harnesses, pdfTheme, lang, currency, brlRate, logoDataUri }: ComparePDFContentProps) {
  const c = COLORS[pdfTheme]
  const pt = lang === 'pt'

  const fmtCostInline = (usd: number): string => {
    if (currency === 'BRL') {
      const brl = usd * brlRate
      if (brl < 0.05) return '<R$0,05'
      return `R$${brl.toFixed(2).replace('.', ',')}`
    }
    if (usd < 0.01) return '<USD 0.01'
    return `USD ${usd.toFixed(2)}`
  }

  const fmtDate = (raw: string | null | undefined): string => {
    if (!raw) return '—'
    const d = new Date(raw)
    if (isNaN(d.getTime())) return '—'
    return format(d, pt ? 'dd/MM/yyyy' : 'MMM d, yyyy')
  }

  // Shared time axis for sparklines
  const { minMs, maxMs } = useMemo(() => {
    let mn = Infinity, mx = -Infinity
    for (const h of harnesses) {
      for (const d of summaries[h]?.dailyActivity ?? []) {
        const ts = new Date(d.date).getTime()
        if (Number.isNaN(ts)) continue
        if (ts < mn) mn = ts
        if (ts > mx) mx = ts
      }
    }
    return { minMs: mn === Infinity ? 0 : mn, maxMs: mx === -Infinity ? 0 : mx }
  }, [harnesses, summaries])

  // Per-harness bar chart SVG (inline, CSS-var-free for html2canvas)
  const renderMiniBar = (values: number[], color: string, peakIndex: number | null, svgWidth: number, height = 28) => {
    const max = Math.max(...values, 1)
    const n = values.length
    const bw = Math.max(1, Math.floor((svgWidth - n) / n))
    return (
      <svg width={svgWidth} height={height} style={{ display: 'block' }}>
        {values.map((v, i) => {
          const barH = max > 0 ? Math.max((v / max) * (height - 2), v > 0 ? 2 : 0) : 0
          const isPeak = i === peakIndex
          return (
            <rect
              key={i}
              x={i * (bw + 1)}
              y={height - barH}
              width={bw}
              height={barH}
              rx={1}
              fill={color}
              opacity={isPeak ? 1 : 0.4}
            />
          )
        })}
      </svg>
    )
  }

  const SectionTitle = ({ title }: { title: string }) => (
    <div style={{ fontSize: 12, fontWeight: 700, color: c.text, marginBottom: 12, paddingBottom: 6, borderBottom: `1px solid ${c.border}` }}>
      {title}
    </div>
  )

  // Content area: 794 - 2*48 = 698px
  const CONTENT_W = 698
  const colBarW = Math.floor((CONTENT_W - 16 * (harnesses.length - 1)) / harnesses.length)

  const dayLabels = pt
    ? ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb']
    : ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

  return (
    <div style={{
      width: 794,
      background: c.bg,
      fontFamily: 'Arial, "Helvetica Neue", Helvetica, sans-serif',
      padding: '40px 48px',
      boxSizing: 'border-box',
      color: c.text,
    }}>
      {/* Header */}
      <div style={{ marginBottom: 28, paddingBottom: 20, borderBottom: `2px solid ${c.orange}` }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <img src={logoDataUri} alt="agentistics" style={{ width: 36, height: 36, borderRadius: 10, flexShrink: 0, objectFit: 'contain' }} />
          <div>
            <div style={{ fontSize: 20, fontWeight: 700, color: c.text, lineHeight: 1 }}>agentistics</div>
            <div style={{ fontSize: 11, color: c.textSec, marginTop: 3 }}>
              {pt ? 'Relatório de comparação de harnesses' : 'Harness Comparison Report'}
            </div>
          </div>
          <div style={{ flex: 1 }} />
          <div style={{ textAlign: 'right', fontSize: 10, color: c.textTer }}>
            <div>{pt ? 'Gerado em' : 'Generated on'}</div>
            <div style={{ fontWeight: 600, color: c.textSec }}>{format(new Date(), 'dd/MM/yyyy HH:mm')}</div>
          </div>
        </div>
      </div>

      {/* Harness overview cards */}
      <div style={{ marginBottom: 24 }}>
        <SectionTitle title={pt ? 'Visão geral dos harnesses' : 'Harness Overview'} />
        <div style={{ display: 'grid', gridTemplateColumns: `repeat(${harnesses.length}, 1fr)`, gap: 12 }}>
          {harnesses.map(h => {
            const s = summaries[h]
            const hColor = HARNESS_COLORS[h]
            return (
              <div key={h} style={{
                background: c.bgCard, border: `1px solid ${c.border}`,
                borderRadius: 8, padding: '12px 14px', borderTop: `3px solid ${hColor}`,
              }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: hColor, marginBottom: 8 }}>
                  {HARNESS_LABELS[h]}
                </div>
                <div style={{ fontSize: 22, fontWeight: 800, color: c.text, lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>
                  {fmtN(s?.sessions ?? 0)}
                </div>
                <div style={{ fontSize: 9, color: c.textSec, marginTop: 2 }}>{pt ? 'sessões' : 'sessions'}</div>
                <div style={{ marginTop: 10, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
                  <div>
                    <div style={{ fontSize: 8, color: c.textTer, textTransform: 'uppercase', letterSpacing: '0.04em' }}>{pt ? 'Mensagens' : 'Messages'}</div>
                    <div style={{ fontSize: 12, fontWeight: 600, color: c.text }}>{fmtN(s?.messages ?? 0)}</div>
                  </div>
                  <div>
                    <div style={{ fontSize: 8, color: c.textTer, textTransform: 'uppercase', letterSpacing: '0.04em' }}>{pt ? 'Tokens' : 'Tokens'}</div>
                    <div style={{ fontSize: 12, fontWeight: 600, color: capable(h, 'tokens') ? c.blue : c.textTer }}>
                      {capable(h, 'tokens') ? fmtN((s?.inputTokens ?? 0) + (s?.outputTokens ?? 0)) : 'N/A'}
                    </div>
                  </div>
                  <div>
                    <div style={{ fontSize: 8, color: c.textTer, textTransform: 'uppercase', letterSpacing: '0.04em' }}>{pt ? 'Custo' : 'Cost'}</div>
                    <div style={{ fontSize: 12, fontWeight: 600, color: capable(h, 'cost') ? c.orange : c.textTer }}>
                      {capable(h, 'cost') ? fmtCostInline(s?.costUSD ?? 0) : 'N/A'}
                    </div>
                  </div>
                  <div>
                    <div style={{ fontSize: 8, color: c.textTer, textTransform: 'uppercase', letterSpacing: '0.04em' }}>{pt ? '/ 1M tok' : '/ 1M tok'}</div>
                    <div style={{ fontSize: 12, fontWeight: 600, color: (capable(h, 'cost') && capable(h, 'tokens')) ? c.green : c.textTer }}>
                      {(capable(h, 'cost') && capable(h, 'tokens') && s?.costPerMTokens != null)
                        ? fmtCostInline(s.costPerMTokens)
                        : 'N/A'}
                    </div>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* Comparison table */}
      <div style={{ marginBottom: 24 }}>
        <SectionTitle title={pt ? 'Tabela comparativa' : 'Comparison table'} />
        {[
          { label: pt ? 'Sessões' : 'Sessions', getValue: (h: HarnessId) => ({ val: fmtN(summaries[h]?.sessions ?? 0), na: false }) },
          { label: pt ? 'Mensagens' : 'Messages', getValue: (h: HarnessId) => ({ val: fmtN(summaries[h]?.messages ?? 0), na: false }) },
          { label: pt ? 'Total de tokens' : 'Total tokens', getValue: (h: HarnessId) => capable(h, 'tokens') ? { val: fmtN((summaries[h]?.inputTokens ?? 0) + (summaries[h]?.outputTokens ?? 0)), na: false } : { val: 'N/A', na: true } },
          { label: pt ? 'Custo estimado' : 'Estimated cost', getValue: (h: HarnessId) => capable(h, 'cost') ? { val: fmtCostInline(summaries[h]?.costUSD ?? 0), na: false } : { val: 'N/A', na: true } },
          { label: pt ? 'Custo / 1M tokens' : 'Cost / 1M tokens', getValue: (h: HarnessId) => (capable(h, 'cost') && capable(h, 'tokens') && summaries[h]?.costPerMTokens != null) ? { val: `${fmtCostInline(summaries[h]!.costPerMTokens!)}`, na: false } : { val: 'N/A', na: true } },
        ].map(row => (
          <div key={row.label} style={{
            display: 'grid',
            gridTemplateColumns: `140px ${harnesses.map(() => '1fr').join(' ')}`,
            gap: 8, padding: '8px 0', borderBottom: `1px solid ${c.border}40`,
          }}>
            <div style={{ fontSize: 10, fontWeight: 600, color: c.textSec }}>{row.label}</div>
            {harnesses.map(h => {
              const { val, na } = row.getValue(h)
              return (
                <div key={h} style={{ fontSize: 12, fontWeight: 700, color: na ? c.textTer : c.text }}>
                  {val}
                </div>
              )
            })}
          </div>
        ))}
      </div>

      {/* Usage by hour of day */}
      <div style={{ marginBottom: 24 }}>
        <SectionTitle title={pt ? 'Uso por hora do dia' : 'Usage by hour of day'} />
        <div style={{ display: 'grid', gridTemplateColumns: `repeat(${harnesses.length}, 1fr)`, gap: 16 }}>
          {harnesses.map(h => {
            const s = summaries[h]
            const hColor = HARNESS_COLORS[h]
            const totalMsgs = s?.hourCounts.reduce((a, v) => a + v, 0) ?? 0
            return (
              <div key={h}>
                <div style={{ fontSize: 9, fontWeight: 700, color: hColor, marginBottom: 6 }}>
                  {HARNESS_LABELS[h]}
                  {s?.peakHour != null && (
                    <span style={{ fontWeight: 400, color: c.textTer, marginLeft: 6 }}>
                      {pt ? `Pico ${String(s.peakHour).padStart(2, '0')}:00` : `Peak ${String(s.peakHour).padStart(2, '0')}:00`}
                    </span>
                  )}
                </div>
                {totalMsgs === 0 ? (
                  <div style={{ height: 28, display: 'flex', alignItems: 'center', fontSize: 9, color: c.textTer }}>N/A</div>
                ) : renderMiniBar(s?.hourCounts ?? Array(24).fill(0), hColor, s?.peakHour ?? null, colBarW, 28)}
                <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 3 }}>
                  <span style={{ fontSize: 7, color: c.textTer }}>0h</span>
                  <span style={{ fontSize: 7, color: c.textTer }}>12h</span>
                  <span style={{ fontSize: 7, color: c.textTer }}>23h</span>
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* Busiest day of week */}
      <div style={{ marginBottom: 24 }}>
        <SectionTitle title={pt ? 'Dia da semana mais movimentado' : 'Busiest day of week'} />
        <div style={{ display: 'grid', gridTemplateColumns: `repeat(${harnesses.length}, 1fr)`, gap: 16 }}>
          {harnesses.map(h => {
            const s = summaries[h]
            const hColor = HARNESS_COLORS[h]
            const hasData = s && s.dowCounts.some(v => v > 0)
            return (
              <div key={h}>
                <div style={{ fontSize: 9, fontWeight: 700, color: hColor, marginBottom: 6 }}>
                  {HARNESS_LABELS[h]}
                  {s?.peakDow != null && (
                    <span style={{ fontWeight: 400, color: c.textTer, marginLeft: 6 }}>
                      {pt ? `Pico: ${dayLabels[s.peakDow]}` : `Peak: ${dayLabels[s.peakDow]}`}
                    </span>
                  )}
                </div>
                {!hasData ? (
                  <div style={{ height: 28, display: 'flex', alignItems: 'center', fontSize: 9, color: c.textTer }}>N/A</div>
                ) : renderMiniBar(s?.dowCounts ?? Array(7).fill(0), hColor, s?.peakDow ?? null, colBarW, 28)}
                <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 3 }}>
                  {dayLabels.map((d, i) => (
                    <span key={i} style={{ fontSize: 7, color: i === s?.peakDow ? hColor : c.textTer, fontWeight: i === s?.peakDow ? 700 : 400 }}>
                      {d.slice(0, 1)}
                    </span>
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* Activity over time */}
      <div style={{ marginBottom: 24 }}>
        <SectionTitle title={pt ? 'Atividade ao longo do tempo' : 'Activity over time'} />
        <div style={{ display: 'grid', gridTemplateColumns: `repeat(${harnesses.length}, 1fr)`, gap: 16 }}>
          {harnesses.map(h => {
            const s = summaries[h]
            const hColor = HARNESS_COLORS[h]
            const daily = s?.dailyActivity ?? []
            const BUCKETS = 40
            const bkts = bucketize(daily, minMs, maxMs, BUCKETS)
            const bkMax = Math.max(...bkts, 1)
            const bw = Math.max(1, Math.floor((colBarW - BUCKETS) / BUCKETS))
            return (
              <div key={h}>
                <div style={{ fontSize: 9, fontWeight: 700, color: hColor, marginBottom: 6 }}>
                  {HARNESS_LABELS[h]}
                </div>
                {daily.length === 0 ? (
                  <div style={{ height: 28, display: 'flex', alignItems: 'center', fontSize: 9, color: c.textTer }}>
                    {pt ? 'Sem dados' : 'No data'}
                  </div>
                ) : (
                  <svg width={colBarW} height={28} style={{ display: 'block' }}>
                    {bkts.map((v, i) => {
                      const barH = v > 0 ? Math.max((v / bkMax) * 24, 3) : 0
                      return <rect key={i} x={i * (bw + 1)} y={28 - barH} width={bw} height={barH} rx={1} fill={hColor} opacity={0.75} />
                    })}
                  </svg>
                )}
                <div style={{ fontSize: 7, color: c.textTer, marginTop: 2 }}>
                  {daily.length > 0
                    ? `${fmtDate(daily[0]?.date)} – ${fmtDate(daily[daily.length - 1]?.date)}`
                    : ''}
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* Peaks table */}
      <div style={{ marginBottom: 24 }}>
        <SectionTitle title={pt ? 'Picos' : 'Peaks'} />
        {[
          {
            label: pt ? 'Dia de maior uso de tokens' : 'Busiest token day',
            getValue: (h: HarnessId) => {
              if (!capable(h, 'tokens')) return { val: 'N/A', na: true }
              const ptd = summaries[h]?.peakTokenDay
              if (!ptd) return { val: '—', na: false }
              return { val: `${fmtN(ptd.tokens)} (${fmtDate(ptd.date)})`, na: false }
            },
          },
          {
            label: pt ? 'Maior custo de sessão' : 'Peak session cost',
            getValue: (h: HarnessId) => {
              if (!capable(h, 'cost')) return { val: 'N/A', na: true }
              const psc = summaries[h]?.peakSessionCost
              if (psc == null) return { val: '—', na: false }
              return { val: fmtCostInline(psc), na: false }
            },
          },
        ].map(row => (
          <div key={row.label} style={{
            display: 'grid',
            gridTemplateColumns: `140px ${harnesses.map(() => '1fr').join(' ')}`,
            gap: 8, padding: '8px 0', borderBottom: `1px solid ${c.border}40`,
          }}>
            <div style={{ fontSize: 10, fontWeight: 600, color: c.textSec }}>{row.label}</div>
            {harnesses.map(h => {
              const { val, na } = row.getValue(h)
              return (
                <div key={h} style={{ fontSize: 12, fontWeight: 700, color: na ? c.textTer : c.text }}>
                  {val}
                </div>
              )
            })}
          </div>
        ))}
      </div>

      {/* Cost by model */}
      <div style={{ marginBottom: 24 }}>
        <SectionTitle title={pt ? 'Custo por modelo' : 'Cost by model'} />
        <div style={{ display: 'grid', gridTemplateColumns: `repeat(${harnesses.length}, 1fr)`, gap: 16 }}>
          {harnesses.map(h => {
            const hColor = HARNESS_COLORS[h]
            const s = summaries[h]
            const showModels = capable(h, 'cost') && capable(h, 'model')
            const models = showModels ? (s?.models ?? []).slice(0, 5) : []
            return (
              <div key={h}>
                <div style={{ fontSize: 9, fontWeight: 700, color: hColor, marginBottom: 6 }}>
                  {HARNESS_LABELS[h]}
                </div>
                {!showModels ? (
                  <div style={{ fontSize: 9, color: c.textTer }}>N/A</div>
                ) : models.length === 0 ? (
                  <div style={{ fontSize: 9, color: c.textTer }}>{pt ? 'Sem dados' : 'No data'}</div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {models.map(m => {
                      const totalTok = m.inputTokens + m.outputTokens
                      const maxTok = Math.max(...models.map(x => x.inputTokens + x.outputTokens), 1)
                      return (
                        <div key={m.model}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 2 }}>
                            <span style={{ fontSize: 8, fontWeight: 600, color: c.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '60%' }}>{formatModel(m.model)}</span>
                            <span style={{ fontSize: 8, color: c.orange, fontWeight: 600 }}>{fmtCostInline(m.costUSD)}</span>
                          </div>
                          <div style={{ height: 4, background: c.bgElevated, borderRadius: 2, overflow: 'hidden' }}>
                            <div style={{ height: '100%', width: `${Math.round((totalTok / maxTok) * 100)}%`, background: hColor, opacity: 0.6, borderRadius: 2 }} />
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
      </div>

      {/* Footer */}
      <div style={{ marginTop: 24, paddingTop: 14, borderTop: `1px solid ${c.border}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ fontSize: 8, color: c.textTer }}>agentistics · {pt ? 'Gerado automaticamente' : 'Auto-generated'}</div>
        <div style={{ fontSize: 8, color: c.textTer }}>{harnesses.length} harnesses</div>
      </div>
    </div>
  )
}

// ── Config label helper ────────────────────────────────────────────────────────

function ConfigLabel({ text }: { text: string }) {
  return (
    <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>
      {text}
    </div>
  )
}

// ── Export Page ────────────────────────────────────────────────────────────────

export default function ExportPage() {
  const { data, lang, currency, brlRate, filters: appFilters } = useOutletContext<AppContext>()
  const pt = lang === 'pt'
  const isMobile = useIsMobile()

  // Scope: 'all', a specific HarnessId, or 'compare'
  const [scope, setScope] = useState<ExportScope>('all')

  // PDF options
  const [pdfTheme, setPdfTheme] = useState<PDFTheme>(
    () => window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  )
  const [sectionOrder, setSectionOrder] = useState<SectionId[]>(
    ['summary', 'activity', 'heatmap', 'hours', 'models', 'projects', 'tools']
  )
  const [chartMetric, setChartMetric] = useState<ChartMetric>('messages')
  const [chartOverlay, setChartOverlay] = useState<ChartMetric | null>(null)
  const [chartOverlayAll, setChartOverlayAll] = useState(false)
  const [dateRange, setDateRange] = useState<Filters['dateRange']>(appFilters.dateRange)
  const [selectedModels, setSelectedModels] = useState<string[]>([])
  const [selectedProjects, setSelectedProjects] = useState<string[]>([])
  const [selectedUsers, setSelectedUsers] = useState<string[]>([])

  // Export state
  const [exporting, setExporting] = useState(false)
  const [exportSuccess, setExportSuccess] = useState(false)
  const contentRef = useRef<HTMLDivElement>(null)

  // Logo prefetch (same as modal — html2canvas needs base64 data URI)
  const [logoDataUri, setLogoDataUri] = useState('/logo.png')
  useEffect(() => {
    fetch('/logo.png')
      .then(r => r.blob())
      .then(blob => new Promise<string>(resolve => {
        const reader = new FileReader()
        reader.onloadend = () => resolve(reader.result as string)
        reader.readAsDataURL(blob)
      }))
      .then(setLogoDataUri)
      .catch(() => {})
  }, [])

  // Available scopes based on data
  const availableScopes = useMemo<ExportScope[]>(() => {
    const scopes: ExportScope[] = ['all', ...data.harnesses]
    if (data.harnesses.length > 1) scopes.push('compare')
    return scopes
  }, [data.harnesses])

  // Compute pdfFilters based on scope
  const pdfFilters = useMemo<Filters>(() => {
    const base: Filters = {
      dateRange,
      customStart: '',
      customEnd: '',
      projects: selectedProjects,
      users: selectedUsers,
      models: selectedModels,
    }
    if (scope === 'all' || scope === 'compare') return base
    return { ...base, harness: scope as HarnessId }
  }, [scope, dateRange, selectedModels, selectedProjects, selectedUsers])

  // Derive stats for All/harness scopes (unused for Compare scope, but harmless)
  const derived = useDerivedStats(data, pdfFilters)

  // Compare summaries (for Compare scope)
  const summaries = useMemo(() => computeHarnessSummaries(data), [data])

  // Blended rates for per-session cost fallback in PDFContent
  const blendedRates = useMemo(
    () => blendedCostPerToken(derived?.modelUsage ?? data.statsCache.modelUsage ?? {}),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [derived?.modelUsage, data.statsCache.modelUsage]
  )

  // Model groups — filtered to scope (or all harnesses for 'all'/'compare')
  const modelGroups = useMemo<{ harness: HarnessId; models: string[] }[]>(() => {
    const order: HarnessId[] = ['claude', 'codex', 'gemini', 'copilot']
    const byH: Partial<Record<HarnessId, Set<string>>> = {}
    const add = (h: HarnessId, m?: string) => { if (!m) return; (byH[h] ??= new Set<string>()).add(m) }
    for (const id of Object.keys(data.statsCache.modelUsage ?? {})) add('claude', id)
    for (const s of data.sessions) add((s.harness ?? 'claude') as HarnessId, s.model)
    const harnesses = (scope !== 'all' && scope !== 'compare') ? [scope as HarnessId] : order
    return harnesses
      .filter(h => byH[h] && byH[h]!.size > 0)
      .map(h => ({ harness: h, models: Array.from(byH[h]!).sort() }))
  }, [data, scope])

  // Members available to scope the export by — only populated on a central (solo
  // sessions carry no `user` tag). Sourced the same way the dashboard filter is.
  const availableUsers = useMemo(() => distinctUsers(data.sessions), [data])

  // Session count per project, used to order the project list (busiest first).
  const projectCounts = useMemo(() => {
    const m: Record<string, number> = {}
    for (const s of data.sessions) {
      if (s.project_path) m[s.project_path] = (m[s.project_path] ?? 0) + 1
    }
    return m
  }, [data])

  // Projects offered in the picker, scoped to the SELECTED members (empty = all
  // members) so on a central picking member X only lists X's projects, then sorted
  // by session count. Mirrors App.tsx's availableProjects.
  const availableProjects = useMemo(() => {
    const base = selectedUsers.length === 0
      ? data.projects
      : data.projects.filter(p => (p.users ?? []).some(u => selectedUsers.includes(u)))
    return [...base].sort((a, b) => (projectCounts[b.path] ?? 0) - (projectCounts[a.path] ?? 0))
  }, [data, selectedUsers, projectCounts])

  // Prune any selected project no longer available after a member-selection change.
  useEffect(() => {
    if (selectedProjects.length === 0) return
    const allowed = new Set(availableProjects.map(p => p.path))
    const pruned = selectedProjects.filter(p => allowed.has(p))
    if (pruned.length !== selectedProjects.length) setSelectedProjects(pruned)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [availableProjects])

  // Filename based on scope
  const pdfFilename = useMemo(() => {
    const dateStr = format(new Date(), 'yyyy-MM-dd')
    if (scope === 'compare') return `compare-${dateStr}.pdf`
    if (scope === 'all') return `agentistics-stats-${dateStr}.pdf`
    return `${scope}-stats-${dateStr}.pdf`
  }, [scope])

  const allSelected = sectionOrder.length === SECTIONS.length
  const toggleSection = (id: SectionId) =>
    setSectionOrder(prev => prev.includes(id) ? prev.filter(s => s !== id) : [...prev, id])
  const toggleAll = () =>
    setSectionOrder(allSelected ? [] : [...SECTION_IDS])

  const canExport = scope === 'compare' || sectionOrder.length > 0

  const handleExport = async () => {
    if (!contentRef.current || exporting) return
    setExporting(true)
    try {
      await runPDFCapture(contentRef.current, pdfTheme, pdfFilename)
      setExportSuccess(true)
      setTimeout(() => setExportSuccess(false), 2500)
    } catch (err) {
      console.error('PDF export failed:', err)
    } finally {
      setExporting(false)
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Page header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{
          width: 36, height: 36, borderRadius: 10,
          background: 'var(--anthropic-orange-dim)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <FileDown size={17} color="var(--anthropic-orange)" />
        </div>
        <div>
          <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--text-primary)' }}>
            {t('export.title', lang)}
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>
            {t('export.subtitle', lang)}
          </div>
        </div>
      </div>

      {/* Two-column layout: options sidebar + live preview (stacked on mobile) */}
      <div style={{ display: 'flex', flexDirection: isMobile ? 'column' : 'row', gap: 20, alignItems: 'flex-start' }}>

        {/* ── Left sidebar (top on mobile): options ───────────────────────────── */}
        <div style={{
          width: isMobile ? '100%' : 280, flexShrink: 0,
          display: 'flex', flexDirection: 'column', gap: 18,
          background: 'var(--bg-card)', border: '1px solid var(--border)',
          borderRadius: 'var(--radius-lg)', padding: '18px 16px',
          ...(isMobile ? {} : { position: 'sticky', top: 80, maxHeight: 'calc(100vh - 120px)', overflowY: 'auto' }),
          boxSizing: 'border-box',
        }}>

          {/* Scope selector */}
          <div>
            <ConfigLabel text={t('export.scope', lang)} />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {availableScopes.map(s => {
                const active = scope === s
                const hColor = (s !== 'all' && s !== 'compare') ? HARNESS_COLORS[s as HarnessId] : undefined
                const label = s === 'all'
                  ? t('export.scope.all', lang)
                  : s === 'compare'
                    ? t('export.scope.compare', lang)
                    : HARNESS_LABELS[s as HarnessId]
                return (
                  <button
                    key={s}
                    onClick={() => { setScope(s); setSelectedModels([]) }}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 8,
                      padding: '7px 10px', borderRadius: 8,
                      border: active
                        ? `1px solid ${hColor ? `${hColor}50` : 'var(--anthropic-orange)30'}`
                        : '1px solid var(--border)',
                      background: active
                        ? hColor ? `${hColor}15` : 'var(--anthropic-orange-dim)'
                        : 'transparent',
                      color: active ? (hColor ?? 'var(--anthropic-orange)') : 'var(--text-secondary)',
                      fontSize: 12, fontWeight: active ? 700 : 500,
                      fontFamily: 'inherit', cursor: 'pointer', textAlign: 'left',
                      transition: 'all 0.12s', width: '100%',
                    }}
                    onMouseEnter={e => { if (!active) { (e.currentTarget as HTMLButtonElement).style.background = 'var(--bg-elevated)' } }}
                    onMouseLeave={e => { if (!active) { (e.currentTarget as HTMLButtonElement).style.background = 'transparent' } }}
                  >
                    {hColor && (
                      <span style={{ width: 8, height: 8, borderRadius: '50%', background: hColor, flexShrink: 0, display: 'inline-block' }} />
                    )}
                    {label}
                  </button>
                )
              })}
            </div>
          </div>

          <div style={{ height: 1, background: 'var(--border)' }} />

          {/* PDF theme */}
          <div>
            <ConfigLabel text={t('export.pdf.theme', lang)} />
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              {(['light', 'dark'] as PDFTheme[]).map(thm => {
                const sel = pdfTheme === thm
                return (
                  <button key={thm} onClick={() => setPdfTheme(thm)} style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                    padding: '9px 8px', borderRadius: 8, cursor: 'pointer',
                    fontFamily: 'inherit', fontSize: 12, fontWeight: 600,
                    background: thm === 'light' ? '#f9fafb' : '#181b24',
                    color: thm === 'light' ? '#374151' : '#e8eaf0',
                    border: sel ? `2px solid var(--anthropic-orange)` : `1px solid ${thm === 'light' ? '#d1d5db' : '#374151'}`,
                    transition: 'all 0.12s',
                  }}>
                    {thm === 'light' ? <Sun size={13} color="#6b7280" /> : <Moon size={13} color="#94a3b8" />}
                    {thm === 'light' ? t('nav.light', lang) : t('nav.dark', lang)}
                    {sel && <Check size={11} color="var(--anthropic-orange)" />}
                  </button>
                )
              })}
            </div>
          </div>

          {/* Period filter — hidden for Compare scope */}
          {scope !== 'compare' && (
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
                <Calendar size={11} color="var(--text-tertiary)" />
                <ConfigLabel text={t('filter.period', lang)} />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: isMobile ? 'repeat(auto-fill, minmax(60px, 1fr))' : 'repeat(4, 1fr)', gap: 5 }}>
                {DATE_OPTIONS.map(opt => {
                  const sel = dateRange === opt.value
                  return (
                    <button key={opt.value} onClick={() => setDateRange(opt.value as Filters['dateRange'])} style={{
                      padding: '6px 4px', borderRadius: 6, cursor: 'pointer', fontFamily: 'inherit',
                      fontSize: 11, fontWeight: sel ? 700 : 500, textAlign: 'center',
                      background: sel ? 'var(--anthropic-orange-dim)' : 'transparent',
                      border: sel ? '1px solid var(--anthropic-orange)50' : '1px solid var(--border)',
                      color: sel ? 'var(--anthropic-orange)' : 'var(--text-secondary)',
                      transition: 'all 0.12s',
                    }}>
                      {pt ? opt.labelPt : opt.labelEn}
                    </button>
                  )
                })}
              </div>
              {derived && (
                <div style={{ fontSize: 10, color: 'var(--text-tertiary)', marginTop: 6 }}>
                  {fmtN(derived.totalMessages)} {t('export.msgs', lang)} · {fmtN(derived.totalSessions)} {t('compare.sessionsLower', lang)}
                </div>
              )}
            </div>
          )}

          {/* Model filter — hidden for Compare scope; groups by harness when scope=All */}
          {scope !== 'compare' && modelGroups.length > 0 && (
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
                <Cpu size={11} color="var(--text-tertiary)" />
                <ConfigLabel text={t('filter.model', lang)} />
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 200, overflowY: 'auto' }}>
                {modelGroups.map(group => (
                  <div key={group.harness}>
                    {/* Harness group header — only shown in unified (All) view */}
                    {modelGroups.length > 1 && (
                      <div style={{
                        fontSize: 9, fontWeight: 700,
                        color: HARNESS_COLORS[group.harness],
                        textTransform: 'uppercase', letterSpacing: '0.06em',
                        marginBottom: 4, paddingLeft: 4,
                      }}>
                        {HARNESS_LABELS[group.harness]}
                      </div>
                    )}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                      {group.models.map(m => {
                        const sel = selectedModels.includes(m)
                        return (
                          <button key={m} onClick={() => setSelectedModels(prev =>
                            prev.includes(m) ? prev.filter(x => x !== m) : [...prev, m]
                          )} style={{
                            display: 'flex', alignItems: 'center', gap: 8,
                            padding: '5px 8px', borderRadius: 6, cursor: 'pointer',
                            fontFamily: 'inherit', fontSize: 11, textAlign: 'left',
                            background: sel ? 'var(--anthropic-orange-dim)' : 'transparent',
                            border: sel ? '1px solid var(--anthropic-orange)30' : '1px solid transparent',
                            color: sel ? 'var(--text-primary)' : 'var(--text-secondary)',
                            fontWeight: sel ? 600 : 400, transition: 'all 0.12s',
                          }}>
                            <div style={{ width: 7, height: 7, borderRadius: '50%', background: sel ? 'var(--anthropic-orange)' : 'var(--border)', flexShrink: 0 }} />
                            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{formatModel(m)}</span>
                          </button>
                        )
                      })}
                    </div>
                  </div>
                ))}
                {selectedModels.length > 0 && (
                  <button onClick={() => setSelectedModels([])} style={{
                    fontSize: 10, color: 'var(--text-tertiary)', background: 'transparent',
                    border: 'none', cursor: 'pointer', fontFamily: 'inherit', padding: '3px 0', textAlign: 'left',
                  }}>
                    {t('export.clearSelection', lang)}
                  </button>
                )}
              </div>
            </div>
          )}

          {/* Member filter — central only (solo sessions carry no user tag); hidden for Compare */}
          {scope !== 'compare' && availableUsers.length > 0 && (
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
                <Users size={11} color="var(--text-tertiary)" />
                <ConfigLabel text={pt ? 'Membros' : 'Members'} />
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 3, maxHeight: 180, overflowY: 'auto' }}>
                {availableUsers.map(u => {
                  const sel = selectedUsers.includes(u)
                  return (
                    <button key={u} onClick={() => setSelectedUsers(prev =>
                      prev.includes(u) ? prev.filter(x => x !== u) : [...prev, u]
                    )} style={{
                      display: 'flex', alignItems: 'center', gap: 8,
                      padding: '5px 8px', borderRadius: 6, cursor: 'pointer',
                      fontFamily: 'inherit', fontSize: 11, textAlign: 'left',
                      background: sel ? 'var(--anthropic-orange-dim)' : 'transparent',
                      border: sel ? '1px solid var(--anthropic-orange)30' : '1px solid transparent',
                      color: sel ? 'var(--text-primary)' : 'var(--text-secondary)',
                      fontWeight: sel ? 600 : 400, transition: 'all 0.12s',
                    }}>
                      <div style={{ width: 7, height: 7, borderRadius: '50%', background: sel ? 'var(--anthropic-orange)' : 'var(--border)', flexShrink: 0 }} />
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{u}</span>
                    </button>
                  )
                })}
                {selectedUsers.length > 0 && (
                  <button onClick={() => setSelectedUsers([])} style={{
                    fontSize: 10, color: 'var(--text-tertiary)', background: 'transparent',
                    border: 'none', cursor: 'pointer', fontFamily: 'inherit', padding: '3px 0', textAlign: 'left',
                  }}>
                    {t('export.clearSelection', lang)}
                  </button>
                )}
              </div>
            </div>
          )}

          {/* Project filter — scope the report to specific projects; hidden for Compare */}
          {scope !== 'compare' && availableProjects.length > 0 && (
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
                <FolderOpen size={11} color="var(--text-tertiary)" />
                <ConfigLabel text={t('filter.project', lang)} />
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 3, maxHeight: 200, overflowY: 'auto' }}>
                {availableProjects.map(p => {
                  const sel = selectedProjects.includes(p.path)
                  return (
                    <button key={p.path} onClick={() => setSelectedProjects(prev =>
                      prev.includes(p.path) ? prev.filter(x => x !== p.path) : [...prev, p.path]
                    )} style={{
                      display: 'flex', alignItems: 'center', gap: 8,
                      padding: '5px 8px', borderRadius: 6, cursor: 'pointer',
                      fontFamily: 'inherit', fontSize: 11, textAlign: 'left',
                      background: sel ? 'var(--anthropic-orange-dim)' : 'transparent',
                      border: sel ? '1px solid var(--anthropic-orange)30' : '1px solid transparent',
                      color: sel ? 'var(--text-primary)' : 'var(--text-secondary)',
                      fontWeight: sel ? 600 : 400, transition: 'all 0.12s',
                    }} title={p.path}>
                      <div style={{ width: 7, height: 7, borderRadius: '50%', background: sel ? 'var(--anthropic-orange)' : 'var(--border)', flexShrink: 0 }} />
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{formatProjectName(p.path)}</span>
                    </button>
                  )
                })}
                {selectedProjects.length > 0 && (
                  <button onClick={() => setSelectedProjects([])} style={{
                    fontSize: 10, color: 'var(--text-tertiary)', background: 'transparent',
                    border: 'none', cursor: 'pointer', fontFamily: 'inherit', padding: '3px 0', textAlign: 'left',
                  }}>
                    {t('export.clearSelection', lang)}
                  </button>
                )}
              </div>
            </div>
          )}

          {/* Section picker — hidden for Compare scope */}
          {scope !== 'compare' && (
            <>
              <div style={{ height: 1, background: 'var(--border)' }} />
              <div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                  <ConfigLabel text={t('export.pdf.sections', lang)} />
                  <button onClick={toggleAll} style={{
                    background: 'transparent', border: 'none', cursor: 'pointer',
                    fontSize: 10, color: 'var(--text-tertiary)', fontFamily: 'inherit', padding: 0, marginTop: -8,
                  }}>
                    {allSelected ? t('export.deselectAll', lang) : t('export.selectAll', lang)}
                  </button>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
                  {SECTIONS.map(({ id, labelPt, labelEn, Icon }) => {
                    const on = sectionOrder.includes(id)
                    return (
                      <button key={id} onClick={() => toggleSection(id)} style={{
                        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                        gap: 6, padding: '12px 6px', borderRadius: 10, cursor: 'pointer', fontFamily: 'inherit',
                        background: on ? 'var(--anthropic-orange-dim)' : 'var(--bg-elevated)',
                        border: on ? '1.5px solid var(--anthropic-orange)70' : '1px solid var(--border)',
                        textAlign: 'center', transition: 'all 0.13s',
                        boxShadow: on ? '0 0 0 2px var(--anthropic-orange)18' : 'none',
                      }}>
                        <Icon size={17} color={on ? 'var(--anthropic-orange)' : 'var(--text-tertiary)'} strokeWidth={on ? 2.2 : 1.8} />
                        <span style={{ fontSize: 10, lineHeight: 1.25, color: on ? 'var(--anthropic-orange)' : 'var(--text-secondary)', fontWeight: on ? 700 : 400 }}>
                          {pt ? labelPt : labelEn}
                        </span>
                      </button>
                    )
                  })}
                </div>
              </div>

              {/* Activity chart options */}
              {sectionOrder.includes('activity') && (
                <>
                  <div style={{ height: 1, background: 'var(--border)' }} />
                  <div>
                    <ConfigLabel text={t('export.activityChart', lang)} />
                    <div style={{ fontSize: 10, color: 'var(--text-tertiary)', marginBottom: 5 }}>
                      {t('export.primaryLine', lang)}
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 5, marginBottom: 12 }}>
                      {(['messages', 'sessions', 'tools'] as ChartMetric[]).map(m => {
                        const chartLabels: Record<ChartMetric, string> = {
                          messages: t('export.chart.messages', lang),
                          sessions: t('export.chart.sessions', lang),
                          tools: t('export.chart.tools', lang),
                        }
                        const dotColors: Record<ChartMetric, string> = {
                          messages: 'var(--anthropic-orange)',
                          sessions: '#60a5fa',
                          tools: '#34d399',
                        }
                        const sel = chartMetric === m
                        return (
                          <button key={m} onClick={() => { setChartMetric(m); if (chartOverlay === m) setChartOverlay(null) }} style={{
                            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5,
                            padding: '6px 4px', borderRadius: 6, cursor: 'pointer', fontFamily: 'inherit',
                            fontSize: 10, fontWeight: sel ? 700 : 400,
                            background: sel ? 'var(--anthropic-orange-dim)' : 'transparent',
                            border: sel ? '1px solid var(--anthropic-orange)50' : '1px solid var(--border)',
                            color: sel ? 'var(--anthropic-orange)' : 'var(--text-secondary)',
                            transition: 'all 0.12s',
                          }}>
                            <div style={{ width: 6, height: 6, borderRadius: '50%', background: dotColors[m], flexShrink: 0 }} />
                            {chartLabels[m]}
                          </button>
                        )
                      })}
                    </div>
                    <div style={{ fontSize: 10, color: 'var(--text-tertiary)', marginBottom: 5 }}>
                      {t('export.overlay', lang)}
                    </div>
                    <button onClick={() => { setChartOverlayAll(v => !v); setChartOverlay(null) }} style={{
                      display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5,
                      padding: '6px 8px', borderRadius: 6, cursor: 'pointer', fontFamily: 'inherit',
                      fontSize: 10, fontWeight: chartOverlayAll ? 700 : 400, width: '100%', marginBottom: 5,
                      background: chartOverlayAll ? '#8b5cf620' : 'transparent',
                      border: chartOverlayAll ? '1px solid #8b5cf660' : '1px solid var(--border)',
                      color: chartOverlayAll ? '#a78bfa' : 'var(--text-secondary)',
                      transition: 'all 0.12s',
                    }}>
                      {t('export.overlayAll', lang)}
                    </button>
                    {!chartOverlayAll && (
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 5 }}>
                        {([null, 'messages', 'sessions', 'tools'] as (ChartMetric | null)[])
                          .filter(m => m !== chartMetric)
                          .map(m => {
                            const chartLabels: Record<string, string> = {
                              messages: t('export.chart.messages_abbr', lang),
                              sessions: t('export.chart.sessions_abbr', lang),
                              tools: t('export.chart.tools_abbr', lang),
                            }
                            const dotColors: Record<string, string> = {
                              messages: 'var(--anthropic-orange)',
                              sessions: '#60a5fa',
                              tools: '#34d399',
                            }
                            const sel = chartOverlay === m
                            return (
                              <button key={String(m)} onClick={() => setChartOverlay(m)} style={{
                                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5,
                                padding: '6px 4px', borderRadius: 6, cursor: 'pointer', fontFamily: 'inherit',
                                fontSize: 10, fontWeight: sel ? 700 : 400,
                                background: sel ? 'var(--bg-elevated)' : 'transparent',
                                border: '1px solid var(--border)',
                                color: sel ? 'var(--text-primary)' : 'var(--text-secondary)',
                                opacity: m === null && !sel ? 0.6 : 1,
                                transition: 'all 0.12s',
                              }}>
                                {m ? (
                                  <>
                                    <div style={{ width: 6, height: 6, borderRadius: '50%', background: dotColors[m]!, flexShrink: 0 }} />
                                    {chartLabels[m]}
                                  </>
                                ) : t('export.none', lang)}
                              </button>
                            )
                          })}
                      </div>
                    )}
                  </div>
                </>
              )}
            </>
          )}

          {/* Export button */}
          <button
            onClick={handleExport}
            disabled={exporting || !canExport}
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
              padding: '11px 16px', borderRadius: 10, border: 'none',
              cursor: !canExport ? 'not-allowed' : 'pointer',
              background: exportSuccess ? '#10b981' : !canExport ? 'var(--bg-elevated)' : 'var(--anthropic-orange)',
              color: (exportSuccess || canExport) ? '#fff' : 'var(--text-tertiary)',
              fontSize: 13, fontWeight: 700, fontFamily: 'inherit',
              transition: 'all 0.2s', opacity: exporting ? 0.8 : 1,
            }}
          >
            {exporting ? (
              <>
                <div style={{ width: 14, height: 14, borderRadius: '50%', border: '2px solid rgba(255,255,255,0.3)', borderTopColor: '#fff', animation: 'spin 0.7s linear infinite' }} />
                {t('export.generating', lang)}
              </>
            ) : exportSuccess ? (
              <><Check size={14} /> {t('export.saved', lang)}</>
            ) : (
              <><Download size={14} /> {t('export.download', lang)}</>
            )}
          </button>
          {!canExport && (
            <div style={{ fontSize: 10, color: 'var(--text-tertiary)', textAlign: 'center', marginTop: -12 }}>
              {t('export.noSections', lang)}
            </div>
          )}
        </div>

        {/* ── Right area: live preview ─────────────────────────────────────────── */}
        <div style={{
          flex: 1,
          minWidth: 0,
          background: 'var(--bg-base)',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius-lg)',
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
          minHeight: isMobile ? 400 : 600,
        }}>
          {/* Preview bar */}
          <div style={{
            padding: '8px 20px', borderBottom: '1px solid var(--border)', flexShrink: 0,
            display: 'flex', alignItems: 'center', gap: 10, background: 'var(--bg-surface)',
          }}>
            <div style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--accent-green)', flexShrink: 0 }} />
            <div style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>
              {t('export.preview', lang)}
            </div>
            {scope !== 'compare' && (
              <div style={{ fontSize: 10, color: 'var(--text-tertiary)', marginLeft: 'auto' }}>
                {sectionOrder.length} {t('export.sections', lang)}
              </div>
            )}
          </div>

          {/* Preview content — horizontally scrollable on mobile for A4 width */}
          <div style={{ padding: isMobile ? 12 : 24, display: 'flex', justifyContent: 'center', overflowX: 'auto', overflowY: 'auto', flex: 1 }}>
            <div
              ref={contentRef}
              style={{
                boxShadow: '0 4px 32px rgba(0,0,0,0.3)',
                borderRadius: 4,
                overflow: 'hidden',
                flexShrink: 0,
                alignSelf: 'flex-start',
                background: COLORS[pdfTheme].bg,
              }}
            >
              {scope === 'compare' ? (
                <ComparePDFContent
                  summaries={summaries}
                  harnesses={data.harnesses}
                  pdfTheme={pdfTheme}
                  lang={lang}
                  currency={currency}
                  brlRate={brlRate}
                  logoDataUri={logoDataUri}
                />
              ) : (
                <PDFContent
                  pdfTheme={pdfTheme}
                  sectionOrder={sectionOrder}
                  derived={derived}
                  pdfFilters={pdfFilters}
                  lang={lang}
                  currency={currency}
                  brlRate={brlRate}
                  blendedRates={blendedRates}
                  chartMetric={chartMetric}
                  chartOverlay={chartOverlay}
                  chartOverlayAll={chartOverlayAll}
                  logoDataUri={logoDataUri}
                />
              )}
            </div>
          </div>
        </div>
      </div>

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  )
}
