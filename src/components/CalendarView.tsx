import React, { useState, useMemo } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import type { SessionMeta, Lang } from '../lib/types'
import { calcCost } from '../lib/types'
import { fmt, fmtCost } from '../lib/format'
import {
  format, startOfMonth, endOfMonth, eachDayOfInterval,
  getDay, addMonths, subMonths,
} from 'date-fns'

type Metric = 'sessions' | 'messages' | 'tokens' | 'cost'

interface DayData {
  messages: number
  sessions: number
  tools: number
  cost: number
  tokens: number
}

export interface CalendarViewProps {
  heatmapData: { date: string; value: number; sessions: number; tools: number }[]
  sessions: SessionMeta[]
  streakDayBreakdown: { date: string; projects: string[] }[]
  lang: Lang
  currency: 'USD' | 'BRL'
  brlRate: number
}

const METRICS: { key: Metric; pt: string; en: string }[] = [
  { key: 'sessions',  pt: 'Sessões',   en: 'Sessions'  },
  { key: 'messages',  pt: 'Mensagens', en: 'Messages'  },
  { key: 'tokens',    pt: 'Tokens',    en: 'Tokens'    },
  { key: 'cost',      pt: 'Custo',     en: 'Cost'      },
]

const NAV_BTN: React.CSSProperties = {
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  width: 24, height: 24, borderRadius: 5,
  border: '1px solid var(--border)', background: 'var(--bg-elevated)',
  color: 'var(--text-secondary)', cursor: 'pointer', padding: 0,
  fontFamily: 'inherit',
}

export function CalendarView({ heatmapData, sessions, streakDayBreakdown, lang, currency, brlRate }: CalendarViewProps) {
  const [month, setMonth] = useState(() => {
    if (heatmapData.length > 0) {
      const last = heatmapData[heatmapData.length - 1]!
      return startOfMonth(new Date(last.date + 'T12:00:00'))
    }
    return startOfMonth(new Date())
  })
  const [metric, setMetric] = useState<Metric>('sessions')
  const [hovered, setHovered] = useState<string | null>(null)

  const streakDates = useMemo(
    () => new Set(streakDayBreakdown.map(d => d.date)),
    [streakDayBreakdown],
  )

  // Build per-day cost + tokens from filtered sessions
  const dailyExtra = useMemo(() => {
    const map: Record<string, { cost: number; tokens: number }> = {}
    for (const sess of sessions) {
      const date = sess.start_time.slice(0, 10)
      const cost = calcCost({
        inputTokens: sess.input_tokens ?? 0,
        outputTokens: sess.output_tokens ?? 0,
        cacheReadInputTokens: sess.cache_read_input_tokens ?? 0,
        cacheCreationInputTokens: sess.cache_creation_input_tokens ?? 0,
        webSearchRequests: 0, costUSD: 0,
      }, sess.model ?? '')
      const tokens = (sess.input_tokens ?? 0) + (sess.output_tokens ?? 0)
      if (!map[date]) map[date] = { cost: 0, tokens: 0 }
      map[date]!.cost += cost
      map[date]!.tokens += tokens
    }
    return map
  }, [sessions])

  // Merge heatmap + extra into a single per-day map
  const dayMap = useMemo(() => {
    const map: Record<string, DayData> = {}
    for (const d of heatmapData) {
      const ex = dailyExtra[d.date] ?? { cost: 0, tokens: 0 }
      map[d.date] = {
        messages: d.value,
        sessions: d.sessions,
        tools: d.tools,
        cost: ex.cost,
        tokens: ex.tokens,
      }
    }
    return map
  }, [heatmapData, dailyExtra])

  // Max values for intensity normalization (across all data, not just current month)
  const maxVal = useMemo(() => {
    const vals = Object.values(dayMap)
    return {
      sessions: Math.max(1, ...vals.map(d => d.sessions)),
      messages: Math.max(1, ...vals.map(d => d.messages)),
      tokens:   Math.max(1, ...vals.map(d => d.tokens)),
      cost:     Math.max(0.001, ...vals.map(d => d.cost)),
    }
  }, [dayMap])

  const getIntensity = (dateStr: string): number => {
    const d = dayMap[dateStr]
    if (!d) return 0
    return Math.pow(d[metric] / maxVal[metric], 0.6)
  }

  const fmtVal = (d: DayData): string => {
    if (metric === 'cost') return fmtCost(d.cost, currency, brlRate)
    if (metric === 'tokens') return fmt(d.tokens)
    if (metric === 'sessions') return String(d.sessions)
    return fmt(d.messages)
  }

  const { days, startOffset } = useMemo(() => ({
    days: eachDayOfInterval({ start: startOfMonth(month), end: endOfMonth(month) }),
    startOffset: getDay(startOfMonth(month)),
  }), [month])

  const today = format(new Date(), 'yyyy-MM-dd')
  const L = lang === 'pt'
  const WD = L
    ? ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb']
    : ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>

      {/* Controls row */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
        {/* Month navigation */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <button onClick={() => setMonth(m => subMonths(m, 1))} style={NAV_BTN}>
            <ChevronLeft size={13} />
          </button>
          <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary)', minWidth: 115, textAlign: 'center', textTransform: 'capitalize' }}>
            {format(month, 'MMMM yyyy')}
          </span>
          <button onClick={() => setMonth(m => addMonths(m, 1))} style={NAV_BTN}>
            <ChevronRight size={13} />
          </button>
        </div>

        {/* Metric selector */}
        <div style={{ display: 'flex', gap: 3 }}>
          {METRICS.map(m => (
            <button
              key={m.key}
              onClick={() => setMetric(m.key)}
              style={{
                fontSize: 11, fontWeight: metric === m.key ? 600 : 400,
                padding: '3px 8px', borderRadius: 5, cursor: 'pointer',
                fontFamily: 'inherit',
                border: metric === m.key ? '1px solid rgba(217,119,6,0.5)' : '1px solid var(--border)',
                background: metric === m.key ? 'var(--anthropic-orange-dim)' : 'var(--bg-elevated)',
                color: metric === m.key ? 'var(--anthropic-orange)' : 'var(--text-secondary)',
              }}
            >
              {L ? m.pt : m.en}
            </button>
          ))}
        </div>
      </div>

      {/* Calendar grid */}
      <div>
        {/* Weekday headers */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 2, marginBottom: 2 }}>
          {WD.map(w => (
            <div key={w} style={{ textAlign: 'center', fontSize: 9, fontWeight: 600, color: 'var(--text-tertiary)', letterSpacing: '0.05em', textTransform: 'uppercase', padding: '2px 0' }}>
              {w}
            </div>
          ))}
        </div>

        {/* Day cells */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 2 }}>
          {Array.from({ length: startOffset }).map((_, i) => <div key={`off-${i}`} />)}

          {days.map((day, idx) => {
            const col       = (startOffset + idx) % 7
            const dateStr   = format(day, 'yyyy-MM-dd')
            const d         = dayMap[dateStr]
            const intensity = getIntensity(dateStr)
            const isStreak  = streakDates.has(dateStr)
            const isToday   = dateStr === today
            const isHov     = hovered === dateStr
            const hasData   = !!d && d[metric] > 0

            // Flip tooltip horizontally on the rightmost 2 columns
            const tipLeft = col >= 5
            // Show tooltip below for cells in the first 2 rows (rough heuristic)
            const tipBelow = idx < 7

            return (
              <div
                key={dateStr}
                onMouseEnter={() => setHovered(dateStr)}
                onMouseLeave={() => setHovered(null)}
                style={{
                  position: 'relative',
                  aspectRatio: '1',
                  borderRadius: 5,
                  background: hasData
                    ? `rgba(var(--heatmap-active-color), ${0.12 + intensity * 0.78})`
                    : 'var(--heatmap-empty)',
                  border: isToday
                    ? '1.5px solid var(--anthropic-orange)'
                    : isStreak
                      ? '1.5px solid rgba(217,119,6,0.38)'
                      : '1px solid transparent',
                  transition: 'transform 0.1s',
                  transform: isHov && d ? 'scale(1.06)' : 'scale(1)',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  overflow: 'visible',
                  cursor: d ? 'default' : 'default',
                }}
              >
                {/* Day number */}
                <span style={{
                  fontSize: 10,
                  fontWeight: isToday ? 700 : hasData ? 500 : 400,
                  color: isToday
                    ? 'var(--anthropic-orange)'
                    : hasData
                      ? 'var(--text-primary)'
                      : 'var(--text-tertiary)',
                  lineHeight: 1,
                }}>
                  {format(day, 'd')}
                </span>

                {/* Streak indicator dot */}
                {isStreak && (
                  <div style={{
                    position: 'absolute',
                    bottom: 2, right: 2,
                    width: 3, height: 3,
                    borderRadius: '50%',
                    background: 'var(--anthropic-orange)',
                    opacity: 0.8,
                  }} />
                )}

                {/* Hover tooltip */}
                {isHov && d && (
                  <div style={{
                    position: 'absolute',
                    [tipBelow ? 'top' : 'bottom']: 'calc(100% + 5px)',
                    [tipLeft ? 'right' : 'left']: 0,
                    background: 'var(--bg-elevated)',
                    border: '1px solid var(--border)',
                    borderRadius: 8,
                    padding: '8px 10px',
                    boxShadow: '0 6px 20px rgba(0,0,0,0.3)',
                    zIndex: 200,
                    width: 160,
                    pointerEvents: 'none',
                  }}>
                    <div style={{
                      fontSize: 11, fontWeight: 700, color: 'var(--text-primary)',
                      marginBottom: 5, paddingBottom: 5,
                      borderBottom: '1px solid var(--border-subtle)',
                      display: 'flex', alignItems: 'center', gap: 5,
                    }}>
                      <span>{format(day, L ? 'dd/MM/yyyy' : 'MMM d, yyyy')}</span>
                      {isStreak && (
                        <span style={{ fontSize: 9, color: 'var(--anthropic-orange)', fontWeight: 600, background: 'var(--anthropic-orange-dim)', padding: '1px 5px', borderRadius: 3 }}>
                          streak
                        </span>
                      )}
                    </div>
                    {([
                      [L ? 'Sessões'    : 'Sessions', String(d.sessions)],
                      [L ? 'Mensagens'  : 'Messages', fmt(d.messages)],
                      [L ? 'Tokens'     : 'Tokens',   fmt(d.tokens)],
                      [L ? 'Custo'      : 'Cost',      fmtCost(d.cost, currency, brlRate)],
                      [L ? 'Ferramentas': 'Tools',     fmt(d.tools)],
                    ] as [string, string][]).map(([label, value]) => (
                      <div key={label} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 11, padding: '1px 0' }}>
                        <span style={{ color: 'var(--text-tertiary)' }}>{label}</span>
                        <span style={{ color: 'var(--text-primary)', fontWeight: 600 }}>{value}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>

      {/* Legend */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 5 }}>
        <span style={{ fontSize: 9, color: 'var(--text-tertiary)' }}>{L ? 'Menos' : 'Less'}</span>
        {[0.1, 0.35, 0.6, 0.8, 1.0].map(v => (
          <div key={v} style={{ width: 9, height: 9, borderRadius: 2, background: `rgba(var(--heatmap-active-color), ${0.12 + v * 0.78})` }} />
        ))}
        <span style={{ fontSize: 9, color: 'var(--text-tertiary)' }}>{L ? 'Mais' : 'More'}</span>
      </div>
    </div>
  )
}
