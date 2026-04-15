import React, { useRef, useState, useMemo, useEffect } from 'react'
import {
  X, Download, Sun, Moon, Check, Calendar, Cpu, Search,
  BarChart2, TrendingUp, Clock, Wrench, FolderOpen, List, LayoutGrid, Trophy, Bot,
} from 'lucide-react'
import { format, parseISO, subDays } from 'date-fns'
import type { AppData, Filters, Lang, ModelUsage, SessionMeta } from '../lib/types'
import { formatModel, formatProjectName, calcCost } from '../lib/types'
import { useDerivedStats, blendedCostPerToken } from '../hooks/useData'

// ── Types ─────────────────────────────────────────────────────────────────────

type PDFTheme = 'light' | 'dark'

const SECTION_IDS = ['summary', 'activity', 'heatmap', 'hours', 'models', 'projects', 'tools', 'sessions', 'highlights', 'agents'] as const
type SectionId = typeof SECTION_IDS[number]

interface Colors {
  bg: string; bgCard: string; bgElevated: string; border: string
  text: string; textSec: string; textTer: string
  orange: string; blue: string; green: string; purple: string; cyan: string; red: string
}

interface HeatmapDay { date: string; value: number; sessions: number; tools: number }

interface PDFExportModalProps {
  data: AppData
  filters: Filters        // current app filters — used as initial value only
  lang: Lang
  currency: 'USD' | 'BRL'
  brlRate: number
  onClose: () => void
}

// ── Constants ──────────────────────────────────────────────────────────────────

const COLORS: Record<PDFTheme, Colors> = {
  light: {
    bg: '#ffffff', bgCard: '#f9fafb', bgElevated: '#f3f4f6', border: '#e5e7eb',
    text: '#111827', textSec: '#6b7280', textTer: '#9ca3af',
    orange: '#D97706', blue: '#3b82f6', green: '#10b981', purple: '#8b5cf6', cyan: '#06b6d4', red: '#ef4444',
  },
  dark: {
    bg: '#0f1117', bgCard: '#181b24', bgElevated: '#1e2230', border: '#2a2e3f',
    text: '#e8eaf0', textSec: '#8892a4', textTer: '#586070',
    orange: '#f59e0b', blue: '#60a5fa', green: '#34d399', purple: '#a78bfa', cyan: '#22d3ee', red: '#f87171',
  },
}

// Fixed UI colors (independent of app theme)
const UI_THEME_BTNS: Record<PDFTheme, { bg: string; text: string; icon: string }> = {
  light: { bg: '#f9fafb', text: '#374151', icon: '#6b7280' },
  dark:  { bg: '#181b24', text: '#e8eaf0', icon: '#94a3b8' },
}

const SECTIONS: { id: SectionId; labelPt: string; labelEn: string; Icon: React.ElementType }[] = [
  { id: 'summary',    labelPt: 'Resumo',       labelEn: 'Summary',    Icon: BarChart2   },
  { id: 'activity',   labelPt: 'Atividade',    labelEn: 'Activity',   Icon: TrendingUp  },
  { id: 'heatmap',    labelPt: 'Mapa calor',   labelEn: 'Heatmap',    Icon: LayoutGrid  },
  { id: 'hours',      labelPt: 'Por hora',     labelEn: 'By hour',    Icon: Clock       },
  { id: 'models',     labelPt: 'Modelos',      labelEn: 'Models',     Icon: Cpu         },
  { id: 'projects',   labelPt: 'Projetos',     labelEn: 'Projects',   Icon: FolderOpen  },
  { id: 'tools',      labelPt: 'Ferramentas',  labelEn: 'Tools',      Icon: Wrench      },
  { id: 'sessions',   labelPt: 'Sessões',      labelEn: 'Sessions',   Icon: List        },
  { id: 'highlights', labelPt: 'Recordes',     labelEn: 'Highlights', Icon: Trophy      },
  { id: 'agents',     labelPt: 'Agentes',      labelEn: 'Agents',     Icon: Bot         },
]

const DATE_OPTIONS = [
  { value: 'all',  labelPt: 'Tudo',      labelEn: 'All' },
  { value: '7d',   labelPt: '7 dias',    labelEn: '7 days' },
  { value: '30d',  labelPt: '30 dias',   labelEn: '30 days' },
  { value: '90d',  labelPt: '90 dias',   labelEn: '90 days' },
] as const

// ── Helper formatters ──────────────────────────────────────────────────────────

function fmtN(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return String(n)
}

function fmtCostStr(usd: number, currency: 'USD' | 'BRL', rate: number): string {
  if (currency === 'BRL') {
    const brl = usd * rate
    if (brl < 0.05) return '<R$0,05'
    return `R$${brl.toFixed(2).replace('.', ',')}`
  }
  if (usd < 0.01) return '<USD 0.01'
  return `USD ${usd.toFixed(2)}`
}

function fmtDur(min: number): string {
  const h = Math.floor(min / 60)
  const m = Math.round(min % 60)
  if (h > 0) return `${h}h ${m}m`
  return `${m}m`
}

// ── Mini chart components (all use inline styles + actual hex colors) ──────────

function SectionTitle({ title, c }: { title: string; c: Colors }) {
  return (
    <div style={{
      fontSize: 12, fontWeight: 700, color: c.text, marginBottom: 12,
      paddingBottom: 6, borderBottom: `1px solid ${c.border}`,
    }}>
      {title}
    </div>
  )
}

function KPICard({ label, value, sub, accent, c }: {
  label: string; value: string | number; sub: string; accent: string; c: Colors
}) {
  return (
    <div style={{ background: c.bgCard, border: `1px solid ${c.border}`, borderRadius: 8, padding: '10px 12px' }}>
      <div style={{ fontSize: 9, color: c.textSec, fontWeight: 500, marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
        {label}
      </div>
      <div style={{ fontSize: 18, fontWeight: 700, color: accent, lineHeight: 1 }}>{value}</div>
      {sub && <div style={{ fontSize: 9, color: c.textTer, marginTop: 4 }}>{sub}</div>}
    </div>
  )
}

type ChartMetric = 'messages' | 'sessions' | 'tools'

const METRIC_META: Record<ChartMetric, { label: string; getVal: (d: HeatmapDay) => number; colorKey: keyof Colors }> = {
  messages: { label: 'Messages', getVal: d => d.value,    colorKey: 'orange' },
  sessions: { label: 'Sessions', getVal: d => d.sessions, colorKey: 'blue'   },
  tools:    { label: 'Tool calls', getVal: d => d.tools,  colorKey: 'green'  },
}

function MiniLineChart({ data, c, metric = 'messages', overlay = null, overlayAll = false }: {
  data: HeatmapDay[]; c: Colors; metric?: ChartMetric; overlay?: ChartMetric | null; overlayAll?: boolean
}) {
  const sorted = [...data].sort((a, b) => a.date.localeCompare(b.date)).slice(-60)
  if (sorted.length < 2) {
    return <div style={{ height: 128, display: 'flex', alignItems: 'center', justifyContent: 'center', color: c.textTer, fontSize: 11 }}>No data</div>
  }

  const LEGEND_H = 18
  const W = 698, H = 110 + LEGEND_H, padL = 36, padR = 8, padT = LEGEND_H + 8, padB = 24
  const innerW = W - padL - padR, innerH = H - padT - padB

  const step = Math.max(1, Math.floor(sorted.length / 6))
  const xLabels = sorted.map((d, i) => ({ d, i })).filter(({ i }) => i % step === 0 || i === sorted.length - 1)

  if (overlayAll) {
    // Show all 3 lines normalized to 0-100% (own scale each)
    const allMetrics = Object.values(METRIC_META) as (typeof METRIC_META)[keyof typeof METRIC_META][]
    const allKeys = (Object.keys(METRIC_META) as ChartMetric[])
    const maxes = allKeys.map(k => Math.max(...sorted.map(d => METRIC_META[k].getVal(d)), 1))

    return (
      <svg width={W} height={H} style={{ display: 'block', overflow: 'visible' }}>
        {/* Legend */}
        {allKeys.map((k, ki) => {
          const color = c[METRIC_META[k].colorKey] as string
          return (
            <g key={k}>
              <circle cx={padL + ki * 110} cy={LEGEND_H / 2} r={3} fill={color} />
              <line x1={padL + ki * 110 + 6} y1={LEGEND_H / 2} x2={padL + ki * 110 + 18} y2={LEGEND_H / 2} stroke={color} strokeWidth={1.5} strokeDasharray={ki > 0 ? '4,2' : ''} />
              <text x={padL + ki * 110 + 22} y={LEGEND_H / 2 + 3.5} fontSize={8} fill={c.textSec} fontWeight="600">{METRIC_META[k].label}</text>
            </g>
          )
        })}
        <text x={padL + 350} y={LEGEND_H / 2 + 3.5} fontSize={7} fill={c.textTer}>(normalized 0–100%)</text>

        {/* Grid */}
        {[0, 0.25, 0.5, 0.75, 1].map(pct => {
          const y = padT + (1 - pct) * innerH
          return (
            <g key={pct}>
              <line x1={padL} y1={y} x2={padL + innerW} y2={y} stroke={c.border} strokeWidth={0.5} strokeDasharray="2,2" />
              <text x={padL - 4} y={y + 3.5} fontSize={8} fill={c.textTer} textAnchor="end">{Math.round(pct * 100)}%</text>
            </g>
          )
        })}

        {/* Lines */}
        {allKeys.map((k, ki) => {
          const color = c[METRIC_META[k].colorKey] as string
          const mx = maxes[ki] ?? 1
          const pts = sorted.map((d, i) => {
            const x = padL + (i / (sorted.length - 1)) * innerW
            const y = padT + (1 - METRIC_META[k].getVal(d) / mx) * innerH
            return `${x.toFixed(1)},${y.toFixed(1)}`
          }).join(' ')
          return (
            <polyline key={k} points={pts} fill="none" stroke={color} strokeWidth={1.5}
              strokeLinejoin="round" strokeDasharray={ki > 0 ? '5,2' : ''} />
          )
        })}

        {/* X labels */}
        {xLabels.map(({ d, i }) => {
          const x = padL + (i / (sorted.length - 1)) * innerW
          return (
            <text key={d.date} x={x} y={H - 4} fontSize={8} fill={c.textTer} textAnchor="middle">
              {d.date.slice(5)}
            </text>
          )
        })}
      </svg>
    )
  }

  const meta = METRIC_META[metric]
  const overlayMeta = overlay ? METRIC_META[overlay] : null

  const primaryColor = c[meta.colorKey] as string
  const max = Math.max(...sorted.map(d => meta.getVal(d)), 1)

  const pts = sorted.map((d, i) => {
    const x = padL + (i / (sorted.length - 1)) * innerW
    const y = padT + (1 - meta.getVal(d) / max) * innerH
    return [x, y] as [number, number]
  })
  const lineStr = pts.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ')
  const areaStr = `${padL},${padT + innerH} ${lineStr} ${padL + innerW},${padT + innerH}`

  let overlayStr = ''
  let overlayColor = ''
  if (overlayMeta) {
    overlayColor = c[overlayMeta.colorKey] as string
    const overlayMax = Math.max(...sorted.map(d => overlayMeta.getVal(d)), 1)
    overlayStr = sorted.map((d, i) => {
      const x = padL + (i / (sorted.length - 1)) * innerW
      const y = padT + (1 - overlayMeta.getVal(d) / overlayMax) * innerH
      return `${x.toFixed(1)},${y.toFixed(1)}`
    }).join(' ')
  }

  return (
    <svg width={W} height={H} style={{ display: 'block', overflow: 'visible' }}>
      {/* Legend */}
      <circle cx={padL} cy={LEGEND_H / 2} r={4} fill={primaryColor} />
      <text x={padL + 9} y={LEGEND_H / 2 + 3.5} fontSize={8} fill={c.textSec} fontWeight="600">{meta.label}</text>
      {overlayMeta && (
        <>
          <circle cx={padL + 90} cy={LEGEND_H / 2} r={3} fill={overlayColor} />
          <line x1={padL + 96} y1={LEGEND_H / 2} x2={padL + 108} y2={LEGEND_H / 2} stroke={overlayColor} strokeWidth={1.5} strokeDasharray="3,2" />
          <text x={padL + 112} y={LEGEND_H / 2 + 3.5} fontSize={8} fill={c.textSec} fontWeight="600">{overlayMeta.label}</text>
          <text x={padL + 112 + 55} y={LEGEND_H / 2 + 3.5} fontSize={7} fill={c.textTer}>(scaled)</text>
        </>
      )}

      {/* Grid */}
      {[0, 0.25, 0.5, 0.75, 1].map(pct => {
        const y = padT + (1 - pct) * innerH
        return (
          <g key={pct}>
            <line x1={padL} y1={y} x2={padL + innerW} y2={y} stroke={c.border} strokeWidth={0.5} strokeDasharray="2,2" />
            <text x={padL - 4} y={y + 3.5} fontSize={8} fill={c.textTer} textAnchor="end">{Math.round(pct * max)}</text>
          </g>
        )
      })}

      {/* Area + primary line */}
      <polygon points={areaStr} fill={`${primaryColor}25`} />
      <polyline points={lineStr} fill="none" stroke={primaryColor} strokeWidth={1.5} strokeLinejoin="round" />

      {/* Overlay line (dashed, own scale) */}
      {overlayStr && (
        <polyline points={overlayStr} fill="none" stroke={overlayColor} strokeWidth={1.5} strokeLinejoin="round" strokeDasharray="4,2" />
      )}

      {/* X labels */}
      {xLabels.map(({ d, i }) => {
        const x = padL + (i / (sorted.length - 1)) * innerW
        return (
          <text key={d.date} x={x} y={H - 4} fontSize={8} fill={c.textTer} textAnchor="middle">
            {d.date.slice(5)}
          </text>
        )
      })}
    </svg>
  )
}

function MiniHeatmap({ data, c }: { data: HeatmapDay[]; c: Colors }) {
  // Size cells to fill the full 698px content area
  // 698px - 20px (day labels) = 678px / 26 weeks ≈ 26px/week → cell=22, gap=4
  const cell = 22, gap = 4, weeks = 26
  const slotW = cell + gap  // 26px per week
  const dateMap = new Map(data.map(d => [d.date, d.value]))
  const max = Math.max(...data.map(d => d.value), 1)
  const today = new Date()
  const labelW = 20
  const svgW = labelW + weeks * slotW  // 20 + 676 = 696px
  const svgH = 7 * slotW + 18          // day cells + month label row

  const cells: { x: number; y: number; intensity: number }[] = []
  for (let w = weeks - 1; w >= 0; w--) {
    for (let dow = 0; dow < 7; dow++) {
      const date = subDays(today, w * 7 + (6 - dow))
      const dateStr = format(date, 'yyyy-MM-dd')
      const v = dateMap.get(dateStr) ?? 0
      cells.push({
        x: labelW + (weeks - 1 - w) * slotW,
        y: dow * slotW,
        intensity: v / max,
      })
    }
  }

  const dayLabels = ['D', 'S', 'T', 'Q', 'Q', 'S', 'S']

  // Month labels
  const monthLabels: { x: number; label: string }[] = []
  let lastMonth = ''
  for (let w = 0; w < weeks; w++) {
    const date = subDays(today, (weeks - 1 - w) * 7)
    const m = format(date, 'MMM')
    if (m !== lastMonth) {
      monthLabels.push({ x: labelW + w * slotW, label: m })
      lastMonth = m
    }
  }

  return (
    <svg width={svgW} height={svgH} style={{ display: 'block' }}>
      {/* Day labels */}
      {[1, 3, 5].map(dow => (
        <text key={dow} x={labelW - 3} y={dow * slotW + cell - 4}
          fontSize={8} fill={c.textTer} textAnchor="end">
          {dayLabels[dow]}
        </text>
      ))}
      {/* Cells */}
      {cells.map((cl, i) => (
        <rect key={i} x={cl.x} y={cl.y} width={cell} height={cell} rx={3}
          fill={cl.intensity > 0 ? c.orange : c.bgElevated}
          opacity={cl.intensity > 0 ? 0.2 + cl.intensity * 0.8 : 1}
        />
      ))}
      {/* Month labels */}
      {monthLabels.map(({ x, label }) => (
        <text key={label + x} x={x} y={svgH - 3} fontSize={8} fill={c.textTer}>{label}</text>
      ))}
    </svg>
  )
}

function MiniBarChart({ hourCounts, c }: { hourCounts: Record<number, number>; c: Colors }) {
  const hours = Array.from({ length: 24 }, (_, i) => ({ h: i, v: hourCounts[i] ?? 0 }))
  const max = Math.max(...hours.map(h => h.v), 1)
  const W = 698, H = 90, padB = 18, barArea = H - padB
  const bw = Math.floor((W - 23) / 24)

  return (
    <svg width={W} height={H} style={{ display: 'block' }}>
      {[0.5, 1].map(pct => (
        <line key={pct} x1={0} y1={barArea * (1 - pct)} x2={W} y2={barArea * (1 - pct)}
          stroke={c.border} strokeWidth={0.5} strokeDasharray="2,2" />
      ))}
      {hours.map(({ h, v }) => {
        const barH = (v / max) * (barArea - 2)
        const x = h * (bw + 1)
        return (
          <g key={h}>
            <rect x={x} y={barArea - barH} width={bw} height={Math.max(barH, 0)} rx={2}
              fill={c.orange} opacity={v > 0 ? 0.35 + (v / max) * 0.65 : 0.08} />
            {h % 6 === 0 && (
              <text x={x + bw / 2} y={H - 3} fontSize={8} fill={c.textTer} textAnchor="middle">{h}h</text>
            )}
          </g>
        )
      })}
    </svg>
  )
}

function MiniModelBars({ modelUsage, c, currency, brlRate }: {
  modelUsage: Record<string, ModelUsage>; c: Colors; currency: 'USD' | 'BRL'; brlRate: number
}) {
  const entries = Object.entries(modelUsage)
    .map(([id, u]) => ({ id, cost: calcCost(u, id), tokens: u.inputTokens + u.outputTokens + u.cacheReadInputTokens + u.cacheCreationInputTokens }))
    .sort((a, b) => b.cost - a.cost).slice(0, 6)

  if (entries.length === 0) {
    return <div style={{ color: c.textTer, fontSize: 11, padding: '12px 0' }}>No model data</div>
  }
  const maxCost = Math.max(...entries.map(e => e.cost), 0.001)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {entries.map(({ id, cost, tokens }) => (
        <div key={id}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 4 }}>
            <span style={{ fontSize: 11, fontWeight: 600, color: c.text }}>{formatModel(id)}</span>
            <span style={{ fontSize: 10, color: c.textSec }}>{fmtCostStr(cost, currency, brlRate)} · {fmtN(tokens)} tokens</span>
          </div>
          <div style={{ height: 7, background: c.bgElevated, borderRadius: 4, overflow: 'hidden' }}>
            <div style={{ height: '100%', width: `${(cost / maxCost) * 100}%`, background: c.orange, borderRadius: 4 }} />
          </div>
        </div>
      ))}
    </div>
  )
}

function MiniTagCloud({ data, color, c }: { data: Record<string, number>; color: string; c: Colors }) {
  const entries = Object.entries(data).sort((a, b) => b[1] - a[1]).slice(0, 15)
  const max = Math.max(...entries.map(([, v]) => v), 1)
  if (entries.length === 0) return <div style={{ color: c.textTer, fontSize: 11 }}>No data</div>
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
      {entries.map(([name, count]) => {
        const pct = count / max
        return (
          <div key={name} style={{
            padding: '3px 8px', borderRadius: 20,
            background: `${color}18`,
            border: `1px solid ${color}${Math.round((0.2 + pct * 0.4) * 255).toString(16).padStart(2, '0')}`,
            fontSize: 9 + pct * 2, fontWeight: pct > 0.5 ? 600 : 400, color: c.textSec,
            display: 'flex', alignItems: 'center', gap: 4,
          }}>
            {name}<span style={{ opacity: 0.5, fontSize: 8 }}>{count}</span>
          </div>
        )
      })}
    </div>
  )
}

function MiniProjectsList({ projectStats, c, lang }: {
  projectStats: Record<string, { sessions: number; messages: number; tools: number }>
  c: Colors; lang: Lang
}) {
  const entries = Object.entries(projectStats).sort((a, b) => b[1].sessions - a[1].sessions).slice(0, 8)
  if (entries.length === 0) return <div style={{ color: c.textTer, fontSize: 11 }}>No data</div>
  const maxS = Math.max(...entries.map(([, v]) => v.sessions), 1)
  const cols = '1fr 60px 70px 60px'

  return (
    <div style={{ fontSize: 10 }}>
      <div style={{ display: 'grid', gridTemplateColumns: cols, gap: 8, paddingBottom: 5, borderBottom: `1px solid ${c.border}`, marginBottom: 6 }}>
        {['Projeto', lang === 'pt' ? 'Sessões' : 'Sessions', lang === 'pt' ? 'Mensagens' : 'Messages', 'Tools'].map(h => (
          <div key={h} style={{ fontSize: 8, fontWeight: 600, color: c.textTer, textTransform: 'uppercase' }}>{h}</div>
        ))}
      </div>
      {entries.map(([path, stats]) => (
        <div key={path} style={{ marginBottom: 8 }}>
          <div style={{ display: 'grid', gridTemplateColumns: cols, gap: 8, alignItems: 'center', marginBottom: 3 }}>
            <div style={{ color: c.text, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {formatProjectName(path)}
            </div>
            <div style={{ color: c.orange, fontWeight: 600 }}>{stats.sessions}</div>
            <div style={{ color: c.textSec }}>{fmtN(stats.messages)}</div>
            <div style={{ color: c.textSec }}>{fmtN(stats.tools)}</div>
          </div>
          <div style={{ height: 3, background: c.bgElevated, borderRadius: 2, overflow: 'hidden' }}>
            <div style={{ height: '100%', width: `${(stats.sessions / maxS) * 100}%`, background: c.orange, opacity: 0.5, borderRadius: 2 }} />
          </div>
        </div>
      ))}
    </div>
  )
}

function MiniSessionsTable({ sessions, c, lang, currency, brlRate, blendedRates }: {
  sessions: SessionMeta[]; c: Colors; lang: Lang; currency: 'USD' | 'BRL'; brlRate: number
  blendedRates: { input: number; output: number }
}) {
  const cols = '90px 1fr 48px 40px 40px 62px'
  const headers = [lang === 'pt' ? 'Data' : 'Date', lang === 'pt' ? 'Projeto' : 'Project',
    lang === 'pt' ? 'Dur.' : 'Dur.', 'Msgs', 'Tools', lang === 'pt' ? 'Custo' : 'Cost']
  return (
    <div style={{ fontSize: 10 }}>
      <div style={{ display: 'grid', gridTemplateColumns: cols, gap: 6, paddingBottom: 5, borderBottom: `1px solid ${c.border}`, marginBottom: 4 }}>
        {headers.map(h => <div key={h} style={{ fontWeight: 600, color: c.textTer, fontSize: 8, textTransform: 'uppercase' }}>{h}</div>)}
      </div>
      {sessions.slice(0, 12).map((s, i) => {
        const msgs = (s.user_message_count ?? 0) + (s.assistant_message_count ?? 0)
        const tools = Object.values(s.tool_counts ?? {}).reduce((a, b) => a + b, 0)
        const costUSD = ((s.input_tokens ?? 0) / 1_000_000) * blendedRates.input + ((s.output_tokens ?? 0) / 1_000_000) * blendedRates.output
        return (
          <div key={i} style={{ display: 'grid', gridTemplateColumns: cols, gap: 6, padding: '4px 0', borderBottom: `1px solid ${c.border}40`, alignItems: 'center' }}>
            <div style={{ color: c.textSec }}>{s.start_time ? format(parseISO(s.start_time), 'MM/dd HH:mm') : '—'}</div>
            <div style={{ color: c.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{formatProjectName(s.project_path || '')}</div>
            <div style={{ color: c.textSec }}>{s.duration_minutes ? fmtDur(s.duration_minutes) : '—'}</div>
            <div style={{ color: c.orange, fontWeight: 600 }}>{msgs}</div>
            <div style={{ color: c.textSec }}>{tools}</div>
            <div style={{ color: c.textSec }}>{fmtCostStr(costUSD, currency, brlRate)}</div>
          </div>
        )
      })}
    </div>
  )
}

function MiniHighlightsSection({ sessions, c, lang }: {
  sessions: SessionMeta[]; c: Colors; lang: Lang
}) {
  const pt = lang === 'pt'
  if (sessions.length === 0) return null

  function fmtDuration(minutes: number): string {
    const h = Math.floor(minutes / 60)
    const m = Math.round(minutes % 60)
    if (h > 0) return `${h}h ${m}m`
    return `${m}m`
  }

  function avg(arr: number[]): number {
    if (arr.length === 0) return 0
    return arr.reduce((a, b) => a + b, 0) / arr.length
  }

  function multiplier(value: number, mean: number): string | null {
    if (mean === 0 || value === 0) return null
    const x = value / mean
    if (x < 1.5) return null
    return `${x.toFixed(1)}× avg`
  }

  // sessions[0] is guaranteed defined because of the sessions.length === 0 guard above
  const firstSession = sessions[0]!
  const longestSession = sessions.reduce((b, s) =>
    (s.duration_minutes ?? 0) > (b.duration_minutes ?? 0) ? s : b, firstSession)
  const mostInputTokens = sessions.reduce((b, s) =>
    (s.input_tokens ?? 0) > (b.input_tokens ?? 0) ? s : b, firstSession)
  const mostOutputTokens = sessions.reduce((b, s) =>
    (s.output_tokens ?? 0) > (b.output_tokens ?? 0) ? s : b, firstSession)
  const mostMessages = sessions.reduce((b, s) => {
    const v = (s.user_message_count ?? 0) + (s.assistant_message_count ?? 0)
    const bv = (b.user_message_count ?? 0) + (b.assistant_message_count ?? 0)
    return v > bv ? s : b
  }, firstSession)
  const mostToolCalls = sessions.reduce((b, s) => {
    const v = Object.values(s.tool_counts ?? {}).reduce((a, x) => a + x, 0)
    const bv = Object.values(b.tool_counts ?? {}).reduce((a, x) => a + x, 0)
    return v > bv ? s : b
  }, firstSession)

  const projectSessionCounts: Record<string, number> = {}
  for (const s of sessions) {
    if (s.project_path) projectSessionCounts[s.project_path] = (projectSessionCounts[s.project_path] ?? 0) + 1
  }
  const topProjectEntry = Object.entries(projectSessionCounts).sort((a, b) => b[1] - a[1])[0]

  const avgDuration = avg(sessions.map(s => s.duration_minutes ?? 0).filter(v => v > 0))
  const avgInput    = avg(sessions.map(s => s.input_tokens ?? 0).filter(v => v > 0))
  const avgOutput   = avg(sessions.map(s => s.output_tokens ?? 0).filter(v => v > 0))
  const avgMessages = avg(sessions.map(s => (s.user_message_count ?? 0) + (s.assistant_message_count ?? 0)).filter(v => v > 0))
  const avgTools    = avg(sessions.map(s => Object.values(s.tool_counts ?? {}).reduce((a, b) => a + b, 0)).filter(v => v > 0))

  function truncate(str: string | undefined, len: number) {
    if (!str) return pt ? 'Sem título' : 'Untitled'
    return str.length > len ? str.slice(0, len) + '…' : str
  }

  const records = [
    {
      label: pt ? 'Sessão mais longa' : 'Longest session',
      value: fmtDuration(longestSession.duration_minutes ?? 0),
      badge: multiplier(longestSession.duration_minutes ?? 0, avgDuration),
      prompt: truncate(longestSession.first_prompt, 80),
      project: formatProjectName(longestSession.project_path ?? ''),
      accent: '#a855f7',
    },
    {
      label: pt ? 'Mais tokens de entrada' : 'Most input tokens',
      value: fmtN(mostInputTokens.input_tokens ?? 0),
      badge: multiplier(mostInputTokens.input_tokens ?? 0, avgInput),
      prompt: truncate(mostInputTokens.first_prompt, 80),
      project: formatProjectName(mostInputTokens.project_path ?? ''),
      accent: '#3b82f6',
    },
    {
      label: pt ? 'Mais tokens de saída' : 'Most output tokens',
      value: fmtN(mostOutputTokens.output_tokens ?? 0),
      badge: multiplier(mostOutputTokens.output_tokens ?? 0, avgOutput),
      prompt: truncate(mostOutputTokens.first_prompt, 80),
      project: formatProjectName(mostOutputTokens.project_path ?? ''),
      accent: '#8b5cf6',
    },
    {
      label: pt ? 'Mais mensagens' : 'Most messages',
      value: fmtN((mostMessages.user_message_count ?? 0) + (mostMessages.assistant_message_count ?? 0)),
      badge: multiplier((mostMessages.user_message_count ?? 0) + (mostMessages.assistant_message_count ?? 0), avgMessages),
      prompt: truncate(mostMessages.first_prompt, 80),
      project: formatProjectName(mostMessages.project_path ?? ''),
      accent: '#e8690b',
    },
    {
      label: pt ? 'Mais chamadas de ferramentas' : 'Most tool calls',
      value: fmtN(Object.values(mostToolCalls.tool_counts ?? {}).reduce((a, b) => a + b, 0)),
      badge: multiplier(Object.values(mostToolCalls.tool_counts ?? {}).reduce((a, b) => a + b, 0), avgTools),
      prompt: truncate(mostToolCalls.first_prompt, 80),
      project: formatProjectName(mostToolCalls.project_path ?? ''),
      accent: '#10b981',
    },
    ...(topProjectEntry ? [{
      label: pt ? 'Projeto mais ativo' : 'Most active project',
      value: `${topProjectEntry[1]} ${pt ? 'sessões' : 'sessions'}`,
      badge: `${Math.round((topProjectEntry[1] / sessions.length) * 100)}% ${pt ? 'do período' : 'of period'}`,
      prompt: formatProjectName(topProjectEntry[0]),
      project: topProjectEntry[0],
      accent: '#06b6d4',
    }] : []),
  ]

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
      {records.map((r, i) => (
        <div key={i} style={{
          background: c.bgCard,
          border: `1px solid ${c.border}`,
          borderRadius: 8,
          padding: '12px 14px',
          borderLeft: `3px solid ${r.accent}`,
          position: 'relative',
          overflow: 'hidden',
        }}>
          <div style={{ fontSize: 8, fontWeight: 700, color: c.textTer, textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 6 }}>
            {r.label}
          </div>
          <div style={{ fontSize: 24, fontWeight: 800, color: r.accent, lineHeight: 1, letterSpacing: '-0.02em', marginBottom: 4 }}>
            {r.value}
          </div>
          {r.badge && (
            <div style={{
              display: 'inline-flex', alignItems: 'center',
              fontSize: 8, fontWeight: 600, color: r.accent,
              background: `${r.accent}18`, border: `1px solid ${r.accent}30`,
              borderRadius: 20, padding: '2px 6px', marginBottom: 8,
            }}>
              {r.badge}
            </div>
          )}
          {!r.badge && <div style={{ marginBottom: 8 }} />}
          <div style={{ height: 1, background: c.border, marginBottom: 8 }} />
          <div style={{ fontSize: 9, color: c.textSec, fontStyle: 'italic', overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' } as React.CSSProperties}>
            "{r.prompt}"
          </div>
          <div style={{ fontSize: 9, color: c.textTer, marginTop: 5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {r.project}
          </div>
        </div>
      ))}
    </div>
  )
}

// ── PDF Content (the exportable A4 page, 794px wide) ─────────────────────────

interface PDFContentProps {
  pdfTheme: PDFTheme
  sectionOrder: SectionId[]
  derived: ReturnType<typeof useDerivedStats>
  pdfFilters: Filters
  lang: Lang
  currency: 'USD' | 'BRL'
  brlRate: number
  blendedRates: { input: number; output: number }
  chartMetric: ChartMetric
  chartOverlay: ChartMetric | null
  chartOverlayAll: boolean
  logoDataUri: string
}

function PDFContent({ pdfTheme, sectionOrder, derived, pdfFilters, lang, currency, brlRate, blendedRates, chartMetric, chartOverlay, chartOverlayAll, logoDataUri }: PDFContentProps) {
  if (!derived) return null
  const c = COLORS[pdfTheme]
  const pt = lang === 'pt'

  const periodLabel = (() => {
    if (pdfFilters.dateRange === 'all') return pt ? 'Todos os dados' : 'All time'
    if (pdfFilters.dateRange === '7d') return pt ? 'Últimos 7 dias' : 'Last 7 days'
    if (pdfFilters.dateRange === '30d') return pt ? 'Últimos 30 dias' : 'Last 30 days'
    if (pdfFilters.dateRange === '90d') return pt ? 'Últimos 90 dias' : 'Last 90 days'
    return `${pdfFilters.customStart} → ${pdfFilters.customEnd}`
  })()

  const modelLabel = pdfFilters.models && pdfFilters.models.length > 0
    ? pdfFilters.models.length === 1 ? formatModel(pdfFilters.models[0]!) : `${pdfFilters.models.length} models`
    : null

  return (
    <div style={{
      width: 794, background: c.bg,
      fontFamily: 'Arial, "Helvetica Neue", Helvetica, sans-serif',
      padding: '40px 48px', boxSizing: 'border-box', color: c.text,
    }}>
      {/* Header */}
      <div style={{ marginBottom: 28, paddingBottom: 20, borderBottom: `2px solid ${c.orange}` }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 4 }}>
          <img
            src={logoDataUri}
            alt="agentistics"
            style={{ width: 36, height: 36, borderRadius: 10, flexShrink: 0, objectFit: 'contain' }}
          />
          <div>
            <div style={{ fontSize: 20, fontWeight: 700, color: c.text, lineHeight: 1 }}>Claude Stats</div>
            <div style={{ fontSize: 11, color: c.textSec, marginTop: 3 }}>
              {pt ? 'Relatório de uso' : 'Usage Report'} · {periodLabel}
              {modelLabel && ` · ${modelLabel}`}
            </div>
          </div>
          <div style={{ flex: 1 }} />
          <div style={{ textAlign: 'right', fontSize: 10, color: c.textTer }}>
            <div>{pt ? 'Gerado em' : 'Generated on'}</div>
            <div style={{ fontWeight: 600, color: c.textSec }}>{format(new Date(), 'dd/MM/yyyy HH:mm')}</div>
          </div>
        </div>
      </div>

      {sectionOrder.map(id => {
        switch (id) {
          case 'summary': return (
            <div key="summary" style={{ marginBottom: 28 }}>
              <SectionTitle title={pt ? 'Resumo' : 'Summary'} c={c} />
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10, marginBottom: 10 }}>
                <KPICard label={pt ? 'Mensagens' : 'Messages'} value={fmtN(derived.totalMessages)} sub={pt ? 'no período' : 'in period'} accent={c.orange} c={c} />
                <KPICard label={pt ? 'Sessões' : 'Sessions'} value={fmtN(derived.totalSessions)} sub={`avg ${derived.totalSessions > 0 ? Math.round(derived.totalMessages / derived.totalSessions) : 0} msgs`} accent={c.blue} c={c} />
                <KPICard label="Tool calls" value={fmtN(derived.totalToolCalls)} sub={pt ? 'execuções' : 'executions'} accent={c.green} c={c} />
                <KPICard label={pt ? 'Custo est.' : 'Est. cost'} value={fmtCostStr(derived.totalCostUSD, currency, brlRate)} sub="Anthropic pricing" accent={c.orange} c={c} />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10 }}>
                <KPICard label={pt ? 'Sequência' : 'Streak'} value={`${derived.streak}d`} sub={pt ? 'dias consec.' : 'consecutive'} accent={c.red} c={c} />
                <KPICard label={pt ? 'Sessão mais longa' : 'Longest session'} value={derived.longestSession?.duration_minutes ? fmtDur(derived.longestSession.duration_minutes) : '—'} sub="" accent={c.purple} c={c} />
                <KPICard label="Commits" value={String(derived.gitCommits)} sub={derived.gitPushes > 0 ? `${derived.gitPushes} pushes` : pt ? 'via Claude' : 'via Claude'} accent={c.cyan} c={c} />
                <KPICard label={pt ? 'Arquivos' : 'Files'} value={String(derived.filesModified)} sub={`+${fmtN(derived.linesAdded)} / -${fmtN(derived.linesRemoved)}`} accent={c.green} c={c} />
              </div>
            </div>
          )
          case 'activity': return (
            <div key="activity" style={{ marginBottom: 28 }}>
              <SectionTitle title={pt ? 'Atividade ao longo do tempo' : 'Activity over time'} c={c} />
              <MiniLineChart data={derived.heatmapData} c={c} metric={chartMetric} overlay={chartOverlayAll ? null : chartOverlay} overlayAll={chartOverlayAll} />
            </div>
          )
          case 'heatmap': return (
            <div key="heatmap" style={{ marginBottom: 28 }}>
              <SectionTitle title={pt ? 'Mapa de calor (26 semanas)' : 'Activity heatmap (26 weeks)'} c={c} />
              <MiniHeatmap data={derived.heatmapData} c={c} />
            </div>
          )
          case 'hours': return (
            <div key="hours" style={{ marginBottom: 28 }}>
              <SectionTitle title={pt ? 'Uso por hora do dia' : 'Usage by hour of day'} c={c} />
              <MiniBarChart hourCounts={derived.hourCounts} c={c} />
            </div>
          )
          case 'models': return (
            <div key="models" style={{ marginBottom: 28 }}>
              <SectionTitle title={pt ? 'Uso por modelo' : 'Model usage & cost'} c={c} />
              <MiniModelBars modelUsage={derived.modelUsage} c={c} currency={currency} brlRate={brlRate} />
            </div>
          )
          case 'projects': return (
            <div key="projects" style={{ marginBottom: 28 }}>
              <SectionTitle title={pt ? 'Principais projetos' : 'Top projects'} c={c} />
              <MiniProjectsList projectStats={derived.projectStats} c={c} lang={lang} />
            </div>
          )
          case 'tools': return (
            <div key="tools" style={{ marginBottom: 28 }}>
              <SectionTitle title={pt ? 'Ferramentas e linguagens' : 'Tools & languages'} c={c} />
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
                <div>
                  <div style={{ fontSize: 10, fontWeight: 600, color: c.textSec, marginBottom: 8 }}>{pt ? 'Ferramentas mais usadas' : 'Most used tools'}</div>
                  <MiniTagCloud data={derived.toolCounts} color={c.green} c={c} />
                </div>
                <div>
                  <div style={{ fontSize: 10, fontWeight: 600, color: c.textSec, marginBottom: 8 }}>{pt ? 'Linguagens' : 'Languages'}</div>
                  <MiniTagCloud data={derived.langCounts} color={c.blue} c={c} />
                </div>
              </div>
            </div>
          )
          case 'sessions': return (
            <div key="sessions" style={{ marginBottom: 28 }}>
              <SectionTitle title={pt ? 'Sessões recentes (top 12)' : 'Recent sessions (top 12)'} c={c} />
              <MiniSessionsTable
                sessions={[...derived.filteredSessions].sort((a, b) => (b.start_time ?? '').localeCompare(a.start_time ?? '')).slice(0, 12)}
                c={c} lang={lang} currency={currency} brlRate={brlRate}
                blendedRates={blendedRates}
              />
            </div>
          )
          case 'highlights': return (
            <div key="highlights" style={{ marginBottom: 28 }}>
              <SectionTitle title={pt ? 'Recordes do período' : 'Period highlights'} c={c} />
              <MiniHighlightsSection sessions={derived.filteredSessions} c={c} lang={lang} />
            </div>
          )
          case 'agents': return (
            <div key="agents" style={{ marginBottom: 28 }}>
              <SectionTitle title={pt ? 'Métricas de agentes' : 'Agent metrics'} c={c} />
              {derived.totalAgentInvocations === 0 ? (
                <div style={{ fontSize: 10, color: c.textTer, fontStyle: 'italic', padding: '12px 0' }}>
                  {pt ? 'Nenhuma invocação de agente encontrada no período.' : 'No agent invocations found in this period.'}
                </div>
              ) : (
                <>
                  {/* Summary KPI row */}
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10, marginBottom: 16 }}>
                    <KPICard label={pt ? 'Invocações' : 'Invocations'} value={String(derived.totalAgentInvocations)} sub={pt ? 'total de agentes' : 'total agent calls'} accent={c.purple} c={c} />
                    <KPICard label={pt ? 'Tokens agentes' : 'Agent tokens'} value={(() => { const n = derived.totalAgentTokens; return n >= 1e6 ? `${(n/1e6).toFixed(1)}M` : n >= 1000 ? `${(n/1000).toFixed(1)}K` : String(n) })()} sub={`avg ${(() => { const a = Math.round(derived.totalAgentTokens / Math.max(1, derived.totalAgentInvocations)); return a >= 1000 ? `${(a/1000).toFixed(1)}K` : String(a) })()} / call`} accent={c.blue} c={c} />
                    <KPICard label={pt ? 'Custo agentes' : 'Agent cost'} value={currency === 'BRL' ? `R$${(derived.totalAgentCostUSD * brlRate).toFixed(2).replace('.', ',')}` : `$${derived.totalAgentCostUSD.toFixed(3)}`} sub="Anthropic pricing" accent={c.orange} c={c} />
                    <KPICard label={pt ? 'Dur. média' : 'Avg duration'} value={(() => { const ms = derived.totalAgentDurationMs / Math.max(1, derived.totalAgentInvocations); const s = Math.round(ms/1000); return s < 60 ? `${s}s` : `${Math.floor(s/60)}m ${s%60}s` })()} sub={pt ? 'por invocação' : 'per invocation'} accent={c.green} c={c} />
                  </div>
                  {/* Agent type breakdown */}
                  {Object.keys(derived.agentTypeBreakdown).length > 0 && (
                    <div style={{ marginBottom: 12 }}>
                      <div style={{ fontSize: 9, fontWeight: 700, color: c.textSec, marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                        {pt ? 'Por tipo de agente' : 'By agent type'}
                      </div>
                      {Object.entries(derived.agentTypeBreakdown)
                        .sort((a, b) => b[1].count - a[1].count)
                        .map(([type, stats]) => {
                          const maxC = Math.max(...Object.values(derived.agentTypeBreakdown).map(s => s.count))
                          return (
                            <div key={type} style={{ display: 'grid', gridTemplateColumns: '160px 1fr 50px 80px 80px', gap: 8, alignItems: 'center', marginBottom: 5 }}>
                              <div style={{ fontSize: 9, fontWeight: 600, color: c.purple, background: `${c.purple}20`, borderRadius: 8, padding: '2px 7px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                {type}
                              </div>
                              <div style={{ position: 'relative', height: 5, background: c.bgElevated, borderRadius: 3, overflow: 'hidden' }}>
                                <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: `${(stats.count / maxC) * 100}%`, background: c.purple, borderRadius: 3, opacity: 0.6 }} />
                              </div>
                              <span style={{ fontSize: 9, color: c.text, fontWeight: 700, textAlign: 'right' }}>{stats.count}×</span>
                              <span style={{ fontSize: 9, color: c.textSec, textAlign: 'right' }}>{stats.tokens >= 1000 ? `${(stats.tokens/1000).toFixed(1)}K` : stats.tokens} tok</span>
                              <span style={{ fontSize: 9, color: c.orange, textAlign: 'right' }}>{currency === 'BRL' ? `R$${(stats.costUSD * brlRate).toFixed(2).replace('.', ',')}` : `$${stats.costUSD.toFixed(3)}`}</span>
                            </div>
                          )
                        })}
                    </div>
                  )}
                  {/* Top 8 invocations */}
                  <div style={{ fontSize: 9, fontWeight: 700, color: c.textSec, marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                    {pt ? 'Invocações recentes (top 8)' : 'Recent invocations (top 8)'}
                  </div>
                  <div style={{ border: `1px solid ${c.border}`, borderRadius: 6, overflow: 'hidden' }}>
                    <div style={{ display: 'grid', gridTemplateColumns: '130px 1fr 55px 55px 70px', gap: 8, padding: '5px 10px', background: c.bgElevated, fontSize: 8, fontWeight: 700, color: c.textTer, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                      <span>{pt ? 'Tipo' : 'Type'}</span><span>{pt ? 'Descrição' : 'Description'}</span>
                      <span style={{ textAlign: 'right' }}>Tokens</span>
                      <span style={{ textAlign: 'right' }}>{pt ? 'Dur.' : 'Dur.'}</span>
                      <span style={{ textAlign: 'right' }}>{pt ? 'Custo' : 'Cost'}</span>
                    </div>
                    {derived.agentInvocations.slice(0, 8).map((inv, i) => (
                      <div key={inv.toolUseId || i} style={{ display: 'grid', gridTemplateColumns: '130px 1fr 55px 55px 70px', gap: 8, padding: '5px 10px', borderTop: `1px solid ${c.border}`, background: i % 2 === 0 ? 'transparent' : c.bgCard }}>
                        <span style={{ fontSize: 8, fontWeight: 600, color: c.purple, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{inv.agentType}</span>
                        <span style={{ fontSize: 8, color: c.textSec, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{inv.description || '—'}</span>
                        <span style={{ fontSize: 8, color: c.text, textAlign: 'right' }}>{inv.totalTokens >= 1000 ? `${(inv.totalTokens/1000).toFixed(1)}K` : inv.totalTokens}</span>
                        <span style={{ fontSize: 8, color: c.textSec, textAlign: 'right' }}>{(() => { const s = Math.round(inv.totalDurationMs/1000); return s < 60 ? `${s}s` : `${Math.floor(s/60)}m` })()} </span>
                        <span style={{ fontSize: 8, color: c.orange, textAlign: 'right' }}>{currency === 'BRL' ? `R$${(inv.costUSD * brlRate).toFixed(2).replace('.', ',')}` : `$${inv.costUSD.toFixed(3)}`}</span>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>
          )
          default: return null
        }
      })}

      <div style={{ marginTop: 24, paddingTop: 14, borderTop: `1px solid ${c.border}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ fontSize: 8, color: c.textTer }}>Claude Stats · Gerado automaticamente</div>
        <div style={{ fontSize: 8, color: c.textTer }}>
          {derived.totalSessions.toLocaleString()} {pt ? 'sessões analisadas' : 'sessions analyzed'}
        </div>
      </div>
    </div>
  )
}

// ── Modal Shell ────────────────────────────────────────────────────────────────

export function PDFExportModal({ data, filters, lang, currency, brlRate, onClose }: PDFExportModalProps) {
  const pt = lang === 'pt'

  // Local filter state — independent from the app, initialized from current app filters
  const [pdfFilters, setPdfFilters] = useState<Filters>({
    dateRange: filters.dateRange,
    customStart: filters.customStart,
    customEnd: filters.customEnd,
    projects: filters.projects,
    models: filters.models,
  })

  const [pdfTheme, setPdfTheme] = useState<PDFTheme>(
    () => window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  )
  const [sectionOrder, setSectionOrder] = useState<SectionId[]>(
    ['summary', 'activity', 'heatmap', 'hours', 'models', 'projects', 'tools']
  )
  const [chartMetric, setChartMetric] = useState<ChartMetric>('messages')
  const [chartOverlay, setChartOverlay] = useState<ChartMetric | null>(null)
  const [chartOverlayAll, setChartOverlayAll] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [exportSuccess, setExportSuccess] = useState(false)
  const [logoDataUri, setLogoDataUri] = useState<string>('/logo.png')
  const contentRef = useRef<HTMLDivElement>(null)

  // Pre-fetch logo as base64 data URI so html2canvas can render it in the off-screen clone
  useEffect(() => {
    fetch('/logo.png')
      .then(r => r.blob())
      .then(blob => new Promise<string>(resolve => {
        const reader = new FileReader()
        reader.onloadend = () => resolve(reader.result as string)
        reader.readAsDataURL(blob)
      }))
      .then(dataUri => setLogoDataUri(dataUri))
      .catch(() => { /* keep the relative path as fallback */ })
  }, [])

  // Derive stats using the LOCAL PDF filters (not the app's filters)
  const derived = useDerivedStats(data, pdfFilters)

  const availableModels = useMemo(() => Object.keys(data.statsCache.modelUsage ?? {}), [data])

  const sortedProjects = useMemo(() =>
    [...data.projects].sort((a, b) => b.sessions.length - a.sessions.length),
    [data.projects]
  )

  const [projectQuery, setProjectQuery] = useState('')

  const toggleProject = (path: string) => {
    setPdfFilters(f => ({
      ...f,
      projects: f.projects.includes(path)
        ? f.projects.filter(p => p !== path)
        : [...f.projects, path],
    }))
  }

  const toggleSection = (id: SectionId) => {
    setSectionOrder(prev =>
      prev.includes(id) ? prev.filter(s => s !== id) : [...prev, id]
    )
  }

  const allSelected = sectionOrder.length === SECTIONS.length
  const toggleAll = () => {
    if (allSelected) setSectionOrder([])
    else setSectionOrder([...SECTION_IDS])
  }

  const blendedRates = useMemo(
    () => blendedCostPerToken(data.statsCache.modelUsage ?? {}),
    [data.statsCache.modelUsage]
  )

  const handleExport = async () => {
    if (!contentRef.current || exporting) return
    setExporting(true)
    try {
      const html2canvas = (await import('html2canvas')).default
      const { jsPDF } = await import('jspdf')

      const el = contentRef.current
      // Clone into an isolated off-screen container at the top of <body> so
      // html2canvas captures the full element with no scroll-offset or
      // overflow-clipping from the modal's scroll containers.
      const offscreen = document.createElement('div')
      // Background ensures any sub-pixel overflow rows captured by html2canvas
      // match the theme — the body background would be white otherwise.
      offscreen.style.cssText = `position:fixed;left:-9999px;top:0;width:794px;background:${COLORS[pdfTheme].bg};pointer-events:none;z-index:-1;`
      const clone = el.cloneNode(true) as HTMLElement
      offscreen.appendChild(clone)
      document.body.appendChild(offscreen)

      const canvas = await html2canvas(clone, {
        scale: 2, useCORS: true, logging: false,
        backgroundColor: COLORS[pdfTheme].bg,
        windowWidth: 794,
      })

      document.body.removeChild(offscreen)

      const A4_W = 210, A4_H = 297 // mm
      // pxPerMm uses the canvas width as truth — canvas is always 794*scale px wide
      const pxPerMm = canvas.width / A4_W
      const totalH_mm = canvas.height / pxPerMm

      if (totalH_mm <= A4_H) {
        // Single page — trim to exact content height, no whitespace
        const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: [A4_W, totalH_mm] })
        pdf.addImage(canvas.toDataURL('image/png'), 'PNG', 0, 0, A4_W, totalH_mm)
        pdf.save(`claude-stats-${format(new Date(), 'yyyy-MM-dd')}.pdf`)
      } else {
        // Multi-page: slice the canvas per page — no negative-offset hack, no float drift
        const pageH_px = Math.round(A4_H * pxPerMm)
        const totalPages = Math.ceil(canvas.height / pageH_px)
        const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })

        for (let page = 0; page < totalPages; page++) {
          const startY = page * pageH_px
          const sliceH_px = Math.min(pageH_px, canvas.height - startY)
          const sliceH_mm = sliceH_px / pxPerMm

          // Slice the canvas for this page
          const slice = document.createElement('canvas')
          slice.width = canvas.width
          slice.height = sliceH_px
          const ctx = slice.getContext('2d')!
          // Fill background so partial last slice has no transparent/white area
          ctx.fillStyle = COLORS[pdfTheme].bg
          ctx.fillRect(0, 0, slice.width, slice.height)
          ctx.drawImage(canvas, 0, startY, canvas.width, sliceH_px, 0, 0, canvas.width, sliceH_px)

          if (page > 0) pdf.addPage()

          if (sliceH_mm < A4_H) {
            // Pad last page to full A4 with theme background so viewers
            // don't show a white gap below a short custom-height page.
            const padded = document.createElement('canvas')
            padded.width = canvas.width
            padded.height = pageH_px
            const pCtx = padded.getContext('2d')!
            pCtx.fillStyle = COLORS[pdfTheme].bg
            pCtx.fillRect(0, 0, padded.width, padded.height)
            pCtx.drawImage(slice, 0, 0)
            pdf.addImage(padded.toDataURL('image/png'), 'PNG', 0, 0, A4_W, A4_H)
          } else {
            pdf.addImage(slice.toDataURL('image/png'), 'PNG', 0, 0, A4_W, sliceH_mm)
          }
        }
        pdf.save(`claude-stats-${format(new Date(), 'yyyy-MM-dd')}.pdf`)
      }
      setExportSuccess(true)
      setTimeout(() => setExportSuccess(false), 2500)
    } catch (err) {
      console.error('PDF export failed:', err)
    } finally {
      setExporting(false)
    }
  }

  // ── Section label helper ─────────────────────────────────────────────────────

  const configSectionLabel = (txt: string) => (
    <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>
      {txt}
    </div>
  )

  return (
    <div
      style={{ position: 'fixed', inset: 0, zIndex: 500, background: 'rgba(0,0,0,0.65)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}
      onClick={e => e.target === e.currentTarget && onClose()}
    >
      <div style={{
        background: 'var(--bg-surface)', border: '1px solid var(--border)',
        borderRadius: 'var(--radius-xl)', boxShadow: 'var(--shadow-elevated)',
        width: '90vw', maxWidth: 1300, height: '90vh',
        display: 'flex', flexDirection: 'column', overflow: 'hidden',
      }}>
        {/* Modal header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 20px', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ width: 32, height: 32, borderRadius: 8, background: 'var(--anthropic-orange-dim)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Download size={15} color="var(--anthropic-orange)" />
            </div>
            <div>
              <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)' }}>
                {pt ? 'Exportar relatório PDF' : 'Export PDF report'}
              </div>
              <div style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>
                {pt ? 'Configure, filtre e visualize antes de exportar' : 'Configure, filter and preview before exporting'}
              </div>
            </div>
          </div>
          <button onClick={onClose} style={{ display: 'flex', alignItems: 'center', padding: '6px 8px', borderRadius: 8, border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-tertiary)', cursor: 'pointer' }}>
            <X size={16} />
          </button>
        </div>

        {/* Two-panel body */}
        <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>

          {/* ── Left panel: config ───────────────────────────────────────────── */}
          <div style={{ width: 288, flexShrink: 0, borderRight: '1px solid var(--border)', overflowY: 'auto', padding: '18px 16px', display: 'flex', flexDirection: 'column', gap: 18 }}>

            {/* PDF Theme */}
            <div>
              {configSectionLabel(pt ? 'Tema do PDF' : 'PDF theme')}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                {(['light', 'dark'] as PDFTheme[]).map(t => {
                  const sel = pdfTheme === t
                  const ui = UI_THEME_BTNS[t]
                  return (
                    <button key={t} onClick={() => setPdfTheme(t)} style={{
                      display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                      padding: '9px 8px', borderRadius: 8, cursor: 'pointer',
                      fontFamily: 'inherit', fontSize: 12, fontWeight: 600,
                      background: ui.bg,
                      color: ui.text,
                      border: sel ? `2px solid var(--anthropic-orange)` : `1px solid ${t === 'light' ? '#d1d5db' : '#374151'}`,
                      boxShadow: sel ? '0 0 0 1px var(--anthropic-orange)30' : 'none',
                      transition: 'all 0.12s',
                    }}>
                      {t === 'light'
                        ? <Sun size={13} color={ui.icon} />
                        : <Moon size={13} color={ui.icon} />}
                      {t === 'light' ? (pt ? 'Claro' : 'Light') : (pt ? 'Escuro' : 'Dark')}
                      {sel && <Check size={11} color="var(--anthropic-orange)" />}
                    </button>
                  )
                })}
              </div>
            </div>

            {/* Divider */}
            <div style={{ height: 1, background: 'var(--border)' }} />

            {/* Period filter */}
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
                <Calendar size={11} color="var(--text-tertiary)" />
                {configSectionLabel(pt ? 'Período' : 'Period')}
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 5 }}>
                {DATE_OPTIONS.map(opt => {
                  const sel = pdfFilters.dateRange === opt.value
                  return (
                    <button key={opt.value} onClick={() => setPdfFilters(f => ({ ...f, dateRange: opt.value as Filters['dateRange'], customStart: '', customEnd: '' }))} style={{
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
                  {fmtN(derived.totalMessages)} {pt ? 'mensagens' : 'msgs'} · {fmtN(derived.totalSessions)} {pt ? 'sessões' : 'sessions'}
                </div>
              )}
            </div>

            {/* Model filter */}
            {availableModels.length > 1 && (
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
                  <Cpu size={11} color="var(--text-tertiary)" />
                  {configSectionLabel(pt ? 'Modelo' : 'Model')}
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {availableModels.map(m => {
                    const sel = (pdfFilters.models ?? []).includes(m)
                    return (
                      <button key={m} onClick={() => setPdfFilters(f => {
                        const cur = f.models ?? []
                        return { ...f, models: cur.includes(m) ? cur.filter(x => x !== m) : [...cur, m] }
                      })} style={{
                        display: 'flex', alignItems: 'center', gap: 8,
                        padding: '6px 10px', borderRadius: 6, cursor: 'pointer',
                        fontFamily: 'inherit', fontSize: 11, textAlign: 'left',
                        background: sel ? 'var(--anthropic-orange-dim)' : 'transparent',
                        border: sel ? '1px solid var(--anthropic-orange)30' : '1px solid transparent',
                        color: sel ? 'var(--text-primary)' : 'var(--text-secondary)',
                        fontWeight: sel ? 600 : 400,
                        transition: 'all 0.12s',
                      }}>
                        <div style={{ width: 8, height: 8, borderRadius: '50%', background: sel ? 'var(--anthropic-orange)' : 'var(--border)', flexShrink: 0 }} />
                        {formatModel(m)}
                      </button>
                    )
                  })}
                </div>
              </div>
            )}

            {/* Project filter */}
            {sortedProjects.length > 1 && (
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
                  <FolderOpen size={11} color="var(--text-tertiary)" />
                  {configSectionLabel(pt ? 'Projetos' : 'Projects')}
                </div>
                {/* Search */}
                <div style={{
                  display: 'flex', alignItems: 'center', gap: 6,
                  background: 'var(--bg-elevated)', border: '1px solid var(--border)',
                  borderRadius: 6, padding: '5px 8px', marginBottom: 6,
                }}>
                  <Search size={11} color="var(--text-tertiary)" style={{ flexShrink: 0 }} />
                  <input
                    value={projectQuery}
                    onChange={e => setProjectQuery(e.target.value)}
                    placeholder={pt ? 'Buscar...' : 'Search...'}
                    style={{
                      flex: 1, background: 'transparent', border: 'none', outline: 'none',
                      color: 'var(--text-primary)', fontSize: 11, fontFamily: 'inherit',
                    }}
                  />
                  {projectQuery && (
                    <button onClick={() => setProjectQuery('')} style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--text-tertiary)', display: 'flex', padding: 0 }}>
                      <X size={10} />
                    </button>
                  )}
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 3, maxHeight: 176, overflowY: 'auto' }}>
                  {/* All projects — only show when no search */}
                  {!projectQuery && (
                    <button
                      onClick={() => setPdfFilters(f => ({ ...f, projects: [] }))}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 8, padding: '5px 8px',
                        borderRadius: 6, cursor: 'pointer', fontFamily: 'inherit', fontSize: 11, textAlign: 'left',
                        background: pdfFilters.projects.length === 0 ? 'var(--anthropic-orange-dim)' : 'transparent',
                        border: pdfFilters.projects.length === 0 ? '1px solid var(--anthropic-orange)30' : '1px solid transparent',
                        color: pdfFilters.projects.length === 0 ? 'var(--text-primary)' : 'var(--text-secondary)',
                        fontWeight: pdfFilters.projects.length === 0 ? 600 : 400, transition: 'all 0.1s',
                      }}
                    >
                      <div style={{ width: 8, height: 8, borderRadius: '50%', flexShrink: 0, background: pdfFilters.projects.length === 0 ? 'var(--anthropic-orange)' : 'var(--border)' }} />
                      {pt ? 'Todos os projetos' : 'All projects'}
                    </button>
                  )}
                  {/* Individual projects — filtered by search query */}
                  {sortedProjects
                    .filter(p => p.path.toLowerCase().includes(projectQuery.toLowerCase()))
                    .map(proj => {
                      const sel = pdfFilters.projects.includes(proj.path)
                      return (
                        <button key={proj.path} onClick={() => toggleProject(proj.path)} style={{
                          display: 'flex', alignItems: 'center', gap: 8, padding: '5px 8px',
                          borderRadius: 6, cursor: 'pointer', fontFamily: 'inherit', fontSize: 11, textAlign: 'left',
                          background: sel ? 'var(--anthropic-orange-dim)' : 'transparent',
                          border: sel ? '1px solid var(--anthropic-orange)30' : '1px solid transparent',
                          color: sel ? 'var(--text-primary)' : 'var(--text-secondary)',
                          fontWeight: sel ? 600 : 400, transition: 'all 0.1s',
                        }}>
                          <div style={{ width: 8, height: 8, borderRadius: '50%', flexShrink: 0, background: sel ? 'var(--anthropic-orange)' : 'var(--border)' }} />
                          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {formatProjectName(proj.path)}
                          </span>
                          <span style={{ marginLeft: 'auto', fontSize: 9, color: 'var(--text-tertiary)', flexShrink: 0 }}>
                            {proj.sessions.length}
                          </span>
                        </button>
                      )
                    })
                  }
                </div>
                {pdfFilters.projects.length > 0 && (
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 5 }}>
                    <span style={{ fontSize: 10, color: 'var(--anthropic-orange)', fontWeight: 500 }}>
                      {pdfFilters.projects.length} {pt ? 'selecionado(s)' : 'selected'}
                    </span>
                    <button
                      onClick={() => setPdfFilters(f => ({ ...f, projects: [] }))}
                      style={{ fontSize: 10, color: 'var(--text-tertiary)', background: 'transparent', border: 'none', cursor: 'pointer', fontFamily: 'inherit', padding: 0 }}
                    >
                      {pt ? 'Limpar' : 'Clear'}
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* Divider */}
            <div style={{ height: 1, background: 'var(--border)' }} />

            {/* Sections */}
            <div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                {configSectionLabel(pt ? 'Seções do PDF' : 'PDF sections')}
                <button onClick={toggleAll} style={{ background: 'transparent', border: 'none', cursor: 'pointer', fontSize: 10, color: 'var(--text-tertiary)', fontFamily: 'inherit', padding: 0, marginTop: -8 }}>
                  {allSelected ? (pt ? 'Desmarcar tudo' : 'Deselect all') : (pt ? 'Selecionar tudo' : 'Select all')}
                </button>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
                {SECTIONS.map(({ id, labelPt, labelEn, Icon }) => {
                  const on = sectionOrder.includes(id)
                  return (
                    <button key={id} onClick={() => toggleSection(id)} style={{
                      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                      gap: 6, padding: '12px 6px', borderRadius: 10, cursor: 'pointer', fontFamily: 'inherit',
                      background: on ? 'var(--anthropic-orange-dim)' : 'var(--bg-card)',
                      border: on ? '1.5px solid var(--anthropic-orange)70' : '1px solid var(--border)',
                      textAlign: 'center', transition: 'all 0.13s',
                      boxShadow: on ? '0 0 0 2px var(--anthropic-orange)18' : 'none',
                    }}>
                      <Icon
                        size={17}
                        color={on ? 'var(--anthropic-orange)' : 'var(--text-tertiary)'}
                        strokeWidth={on ? 2.2 : 1.8}
                      />
                      <span style={{
                        fontSize: 10, lineHeight: 1.25,
                        color: on ? 'var(--anthropic-orange)' : 'var(--text-secondary)',
                        fontWeight: on ? 700 : 400,
                      }}>
                        {pt ? labelPt : labelEn}
                      </span>
                    </button>
                  )
                })}
              </div>
            </div>

            {/* Activity chart options — only relevant when 'activity' section is active */}
            {sectionOrder.includes('activity') && (
              <>
                <div style={{ height: 1, background: 'var(--border)' }} />
                <div>
                  {configSectionLabel(pt ? 'Gráfico de atividade' : 'Activity chart')}

                  {/* Primary metric */}
                  <div style={{ fontSize: 10, color: 'var(--text-tertiary)', marginBottom: 5 }}>
                    {pt ? 'Linha principal' : 'Primary line'}
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 5, marginBottom: 12 }}>
                    {(['messages', 'sessions', 'tools'] as ChartMetric[]).map(m => {
                      const labels: Record<ChartMetric, { en: string; pt: string }> = {
                        messages: { en: 'Messages', pt: 'Msgs' },
                        sessions: { en: 'Sessions', pt: 'Sessões' },
                        tools:    { en: 'Tools', pt: 'Tools' },
                      }
                      const dotColors: Record<ChartMetric, string> = {
                        messages: 'var(--anthropic-orange)',
                        sessions: '#60a5fa',
                        tools:    '#34d399',
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
                          {pt ? labels[m].pt : labels[m].en}
                        </button>
                      )
                    })}
                  </div>

                  {/* Overlay */}
                  <div style={{ fontSize: 10, color: 'var(--text-tertiary)', marginBottom: 5 }}>
                    {pt ? 'Overlay (opcional)' : 'Overlay (optional)'}
                  </div>
                  {/* Overlay All toggle */}
                  <button
                    onClick={() => { setChartOverlayAll(v => !v); setChartOverlay(null) }}
                    style={{
                      display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5,
                      padding: '6px 8px', borderRadius: 6, cursor: 'pointer', fontFamily: 'inherit',
                      fontSize: 10, fontWeight: chartOverlayAll ? 700 : 400, width: '100%', marginBottom: 5,
                      background: chartOverlayAll ? '#8b5cf620' : 'transparent',
                      border: chartOverlayAll ? '1px solid #8b5cf660' : '1px solid var(--border)',
                      color: chartOverlayAll ? '#a78bfa' : 'var(--text-secondary)',
                      transition: 'all 0.12s',
                    }}
                  >
                    {pt ? '⊞ Overlay todas as linhas' : '⊞ Overlay all lines'}
                  </button>
                  {!chartOverlayAll && (
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 5 }}>
                      {([null, 'messages', 'sessions', 'tools'] as (ChartMetric | null)[])
                        .filter(m => m !== chartMetric)
                        .map(m => {
                          const labels: Record<string, { en: string; pt: string }> = {
                            messages: { en: 'Messages', pt: 'Msgs' },
                            sessions: { en: 'Sessions', pt: 'Sessões' },
                            tools:    { en: 'Tools', pt: 'Tools' },
                          }
                          const dotColors: Record<string, string> = {
                            messages: 'var(--anthropic-orange)',
                            sessions: '#60a5fa',
                            tools:    '#34d399',
                          }
                          const sel = chartOverlay === m
                          return (
                            <button key={String(m)} onClick={() => setChartOverlay(m)} style={{
                              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5,
                              padding: '6px 4px', borderRadius: 6, cursor: 'pointer', fontFamily: 'inherit',
                              fontSize: 10, fontWeight: sel ? 700 : 400,
                              background: sel ? (m ? 'color-mix(in srgb, var(--border) 60%, transparent)' : 'var(--bg-card)') : 'transparent',
                              border: sel ? '1px solid var(--border)' : '1px solid var(--border)',
                              color: sel ? 'var(--text-primary)' : 'var(--text-secondary)',
                              opacity: m === null && !sel ? 0.6 : 1,
                              transition: 'all 0.12s',
                            }}>
                              {m ? (
                                <>
                                  <div style={{ width: 6, height: 6, borderRadius: '50%', background: dotColors[m]!, flexShrink: 0 }} />
                                  {pt ? labels[m]!.pt : labels[m]!.en}
                                </>
                              ) : (pt ? 'Nenhum' : 'None')}
                            </button>
                          )
                        })}
                    </div>
                  )}
                </div>
              </>
            )}

            {/* Spacer */}
            <div style={{ flex: 1 }} />

            {/* Export button */}
            <button
              onClick={handleExport}
              disabled={exporting || sectionOrder.length === 0}
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                padding: '11px 16px', borderRadius: 10, border: 'none',
                cursor: sectionOrder.length === 0 ? 'not-allowed' : 'pointer',
                background: exportSuccess ? '#10b981' : sectionOrder.length === 0 ? 'var(--bg-elevated)' : 'var(--anthropic-orange)',
                color: exportSuccess || sectionOrder.length > 0 ? '#fff' : 'var(--text-tertiary)',
                fontSize: 13, fontWeight: 700, fontFamily: 'inherit',
                transition: 'all 0.2s', opacity: exporting ? 0.8 : 1,
              }}
            >
              {exporting ? (
                <>
                  <div style={{ width: 14, height: 14, borderRadius: '50%', border: '2px solid rgba(255,255,255,0.3)', borderTopColor: '#fff', animation: 'spin 0.7s linear infinite' }} />
                  {pt ? 'Gerando PDF...' : 'Generating PDF...'}
                </>
              ) : exportSuccess ? (
                <><Check size={14} /> {pt ? 'PDF salvo!' : 'PDF saved!'}</>
              ) : (
                <><Download size={14} /> {pt ? 'Exportar PDF' : 'Export PDF'}</>
              )}
            </button>
            {sectionOrder.length === 0 && (
              <div style={{ fontSize: 10, color: 'var(--text-tertiary)', textAlign: 'center', marginTop: -12 }}>
                {pt ? 'Selecione pelo menos uma seção' : 'Select at least one section'}
              </div>
            )}
          </div>

          {/* ── Right panel: live preview ────────────────────────────────────── */}
          <div style={{ flex: 1, overflow: 'auto', background: 'var(--bg-base)', display: 'flex', flexDirection: 'column' }}>
            {/* Preview bar */}
            <div style={{ padding: '8px 20px', borderBottom: '1px solid var(--border)', flexShrink: 0, display: 'flex', alignItems: 'center', gap: 10, background: 'var(--bg-surface)' }}>
              <div style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--accent-green)', flexShrink: 0 }} />
              <div style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>
                {pt ? 'Prévia em tempo real' : 'Live preview'} · 794px (A4)
              </div>
              <div style={{ fontSize: 10, color: 'var(--text-tertiary)', marginLeft: 'auto' }}>
                {sectionOrder.length} {pt ? 'seção(ões)' : 'section(s)'}
              </div>
            </div>

            {/* Preview content */}
            <div style={{ padding: '24px', display: 'flex', justifyContent: 'center' }}>
              <div ref={contentRef} style={{ boxShadow: '0 4px 32px rgba(0,0,0,0.3)', borderRadius: 4, overflow: 'hidden', flexShrink: 0, alignSelf: 'flex-start', background: COLORS[pdfTheme].bg }}>
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
              </div>
            </div>
          </div>
        </div>
      </div>

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  )
}
