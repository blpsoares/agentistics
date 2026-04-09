import React, { useRef, useState, useEffect } from 'react'
import { format, eachDayOfInterval, subDays, getDay } from 'date-fns'

interface HeatmapDay {
  date: string
  value: number
  sessions: number
  tools: number
}

interface Props {
  data: HeatmapDay[]
  weeks?: number
}

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

function getIntensity(value: number, max: number): number {
  if (value === 0 || max === 0) return 0
  return Math.max(0.1, Math.min(1, value / max))
}

export function ActivityHeatmap({ data, weeks = 26 }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [containerW, setContainerW] = useState(0)
  const [tooltip, setTooltip] = useState<{ x: number; y: number; day: HeatmapDay & { dateObj: Date } } | null>(null)
  const [animKey, setAnimKey] = useState(0)

  useEffect(() => {
    if (!containerRef.current) return
    const ro = new ResizeObserver(entries => {
      setContainerW(entries[0].contentRect.width)
    })
    ro.observe(containerRef.current)
    return () => ro.disconnect()
  }, [])

  // Re-trigger animation when data changes
  useEffect(() => {
    setAnimKey(k => k + 1)
  }, [data])

  const dataMap = new Map(data.map(d => [d.date, d]))
  const today = new Date()
  const startDate = subDays(today, weeks * 7 - 1)
  const allDays = eachDayOfInterval({ start: startDate, end: today })
  const max = Math.max(...data.map(d => d.value), 1)

  // Group by week columns
  const startDow = getDay(startDate)
  const cols: (Date | null)[][] = []
  let col: (Date | null)[] = Array(startDow).fill(null)
  for (const day of allDays) {
    col.push(day)
    if (col.length === 7) { cols.push(col); col = [] }
  }
  if (col.length > 0) {
    while (col.length < 7) col.push(null)
    cols.push(col)
  }

  // Month labels
  const monthLabels: { col: number; label: string }[] = []
  let lastMonth = -1
  cols.forEach((c, ci) => {
    const firstDay = c.find(d => d !== null)
    if (firstDay) {
      const m = firstDay.getMonth()
      if (m !== lastMonth) { monthLabels.push({ col: ci, label: MONTHS[m] }); lastMonth = m }
    }
  })

  // Layout constants (logical units for viewBox)
  const dayLabelW = 26
  const monthLabelH = 18
  const gap = 2.5
  const numCols = cols.length
  // cellSize derived from: dayLabelW + numCols*(cell+gap) = totalW, solve for cell
  // We use a fixed logical width and derive cellSize so the SVG fills container
  const logicalW = 700
  const cellSize = Math.floor((logicalW - dayLabelW - gap * numCols) / numCols)
  const totalH = monthLabelH + 7 * (cellSize + gap)

  const svgH = containerW > 0
    ? Math.round(containerW * totalH / logicalW)
    : undefined

  return (
    <div ref={containerRef} style={{ position: 'relative', width: '100%' }}>
      <style>{`
        @keyframes heatmap-fade-in {
          from { opacity: 0; transform: scale(0.6); }
          to   { opacity: 1; transform: scale(1); }
        }
      `}</style>

      <svg
        width="100%"
        height={svgH}
        viewBox={`0 0 ${logicalW} ${totalH}`}
        preserveAspectRatio="xMidYMid meet"
        style={{ display: 'block' }}
      >
        {/* Day labels */}
        {[1, 3, 5].map(di => (
          <text
            key={di}
            x={dayLabelW - 3}
            y={monthLabelH + di * (cellSize + gap) + cellSize / 2 + 3}
            textAnchor="end"
            fontSize={9}
            fill="var(--text-tertiary)"
            fontFamily="Inter, sans-serif"
          >
            {DAYS[di]}
          </text>
        ))}

        {/* Month labels */}
        {monthLabels.map(({ col: ci, label }) => (
          <text
            key={`${ci}-${label}`}
            x={dayLabelW + ci * (cellSize + gap)}
            y={monthLabelH - 4}
            fontSize={9}
            fill="var(--text-tertiary)"
            fontFamily="Inter, sans-serif"
          >
            {label}
          </text>
        ))}

        {/* Cells */}
        {cols.map((col, ci) =>
          col.map((day, di) => {
            if (!day) return null
            const dateStr = format(day, 'yyyy-MM-dd')
            const d = dataMap.get(dateStr)
            const intensity = d ? getIntensity(d.value, max) : 0
            const x = dayLabelW + ci * (cellSize + gap)
            const y = monthLabelH + di * (cellSize + gap)
            const delay = (ci * 0.012).toFixed(3)

            return (
              <rect
                key={`${animKey}-${dateStr}`}
                x={x}
                y={y}
                width={cellSize}
                height={cellSize}
                rx={2}
                fill={intensity === 0 ? 'var(--heatmap-empty)' : `rgba(217, 119, 6, ${intensity})`}
                style={{
                  cursor: d ? 'pointer' : 'default',
                  transformOrigin: `${x + cellSize / 2}px ${y + cellSize / 2}px`,
                  animation: `heatmap-fade-in 0.3s ease ${delay}s both`,
                }}
                onMouseEnter={e => {
                  if (!d) return
                  const rect = (e.target as SVGRectElement).getBoundingClientRect()
                  setTooltip({ x: rect.left + rect.width / 2, y: rect.top, day: { ...d, dateObj: day } })
                }}
                onMouseLeave={() => setTooltip(null)}
              />
            )
          })
        )}
      </svg>

      {/* Legend */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 8, justifyContent: 'flex-end' }}>
        <span style={{ fontSize: 10, color: 'var(--text-tertiary)' }}>Less</span>
        {[0, 0.15, 0.35, 0.6, 1].map(v => (
          <div key={v} style={{
            width: 10, height: 10, borderRadius: 2,
            background: v === 0 ? 'var(--heatmap-empty)' : `rgba(217, 119, 6, ${v})`,
          }} />
        ))}
        <span style={{ fontSize: 10, color: 'var(--text-tertiary)' }}>More</span>
      </div>

      {/* Tooltip */}
      {tooltip && (
        <div style={{
          position: 'fixed',
          left: tooltip.x,
          top: tooltip.y - 8,
          transform: 'translateX(-50%) translateY(-100%)',
          background: 'var(--bg-elevated)',
          border: '1px solid var(--border)',
          borderRadius: 8,
          padding: '8px 12px',
          fontSize: 12,
          pointerEvents: 'none',
          zIndex: 1000,
          whiteSpace: 'nowrap',
          boxShadow: 'var(--shadow-elevated)',
        }}>
          <div style={{ fontWeight: 600, color: 'var(--text-primary)', marginBottom: 4 }}>
            {format(tooltip.day.dateObj, 'MMM d, yyyy')}
          </div>
          <div style={{ color: 'var(--text-secondary)' }}>{tooltip.day.value} messages</div>
          <div style={{ color: 'var(--text-secondary)' }}>{tooltip.day.sessions} sessions</div>
          <div style={{ color: 'var(--text-secondary)' }}>{tooltip.day.tools} tool calls</div>
        </div>
      )}
    </div>
  )
}
