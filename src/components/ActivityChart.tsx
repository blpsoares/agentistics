import React, { useState } from 'react'
import {
  AreaChart, Area, XAxis, YAxis, Tooltip,
  ResponsiveContainer, CartesianGrid,
} from 'recharts'
import { format, parseISO } from 'date-fns'

interface Props {
  data: {
    date: string
    value: number
    sessions: number
    tools: number
  }[]
  height?: number
  theme?: 'dark' | 'light'
}

type Metric = 'value' | 'sessions' | 'tools' | 'overlay'

function getMetrics(theme?: 'dark' | 'light'): { key: Metric; label: string; color: string }[] {
  const messagesColor = theme === 'light' ? '#f97316' : '#D97706'
  return [
    { key: 'value', label: 'Messages', color: messagesColor },
    { key: 'sessions', label: 'Sessions', color: '#6366f1' },
    { key: 'tools', label: 'Tool Calls', color: '#10b981' },
    { key: 'overlay', label: 'Overlay', color: '#8b5cf6' },
  ]
}

// DATA_METRICS computed per render inside the component

const CustomTooltip = ({ active, payload, label, isOverlay, rawData }: any) => {
  if (!active || !payload?.length) return null
  const raw = rawData?.find((d: any) => d.date === label)
  return (
    <div style={{
      background: 'var(--bg-elevated)',
      border: '1px solid var(--border)',
      borderRadius: 10,
      padding: '10px 14px',
      fontSize: 12,
      boxShadow: 'var(--shadow-elevated)',
    }}>
      <div style={{ fontWeight: 600, color: 'var(--text-primary)', marginBottom: 6 }}>
        {label ? format(parseISO(label), 'MMM d, yyyy') : ''}
      </div>
      {payload.map((p: any) => {
        // In overlay mode show actual values, not normalized %
        const metricKey = p.dataKey.replace('_norm', '') as 'value' | 'sessions' | 'tools'
        const actualValue = isOverlay && raw ? raw[metricKey] : p.value
        return (
          <div key={p.dataKey} style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--text-secondary)', marginTop: 2 }}>
            <div style={{ width: 6, height: 6, borderRadius: '50%', background: p.color }} />
            <span>{p.name}: </span>
            <span style={{ color: 'var(--text-primary)', fontWeight: 600 }}>{actualValue}</span>
          </div>
        )
      })}
    </div>
  )
}

function ToggleBtn({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: '3px 8px',
        borderRadius: 4,
        border: `1px solid ${active ? 'var(--border)' : 'transparent'}`,
        background: active ? 'var(--bg-elevated)' : 'transparent',
        color: active ? 'var(--text-secondary)' : 'var(--text-tertiary)',
        fontSize: 10,
        fontWeight: 600,
        cursor: 'pointer',
        fontFamily: 'inherit',
        transition: 'all 0.15s',
      }}
    >
      {children}
    </button>
  )
}

export function ActivityChart({ data, height = 180, theme }: Props) {
  const [metric, setMetric] = useState<Metric>('value')
  const [showAxes, setShowAxes] = useState(true)
  const [showLegend, setShowLegend] = useState(true)
  const isOverlay = metric === 'overlay'
  const METRICS = getMetrics(theme)
  const DATA_METRICS = METRICS.filter(m => m.key !== 'overlay') as { key: 'value'|'sessions'|'tools'; label: string; color: string }[]

  const maxValues = {
    value: Math.max(...data.map(d => d.value), 1),
    sessions: Math.max(...data.map(d => d.sessions), 1),
    tools: Math.max(...data.map(d => d.tools), 1),
  }

  const chartData = data.map(d => ({
    ...d,
    displayDate: d.date,
    value_norm: Math.round((d.value / maxValues.value) * 100),
    sessions_norm: Math.round((d.sessions / maxValues.sessions) * 100),
    tools_norm: Math.round((d.tools / maxValues.tools) * 100),
  }))

  const activeLegendItems = isOverlay
    ? DATA_METRICS
    : DATA_METRICS.filter(m => m.key === metric)

  return (
    <div>
      {/* Top bar: metric selector + toggles */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 12, flexWrap: 'wrap', alignItems: 'center' }}>
        {METRICS.map(m => (
          <button
            key={m.key}
            onClick={() => setMetric(m.key)}
            style={{
              padding: '5px 12px',
              borderRadius: 20,
              border: metric === m.key ? `1px solid ${m.color}60` : '1px solid var(--border)',
              background: metric === m.key ? `${m.color}18` : 'transparent',
              color: metric === m.key ? m.color : 'var(--text-secondary)',
              fontSize: 11,
              fontWeight: 600,
              cursor: 'pointer',
              transition: 'all 0.15s',
              fontFamily: 'inherit',
            }}
          >
            {m.label}
          </button>
        ))}
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 4, alignItems: 'center' }}>
          <ToggleBtn active={showAxes} onClick={() => setShowAxes(v => !v)}>Axes</ToggleBtn>
          <ToggleBtn active={showLegend} onClick={() => setShowLegend(v => !v)}>Legend</ToggleBtn>
        </div>
      </div>

      {/* Legend */}
      {showLegend && (
        <div style={{ display: 'flex', gap: 14, marginBottom: 10, flexWrap: 'wrap' }}>
          {activeLegendItems.map(m => (
            <div key={m.key} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
              <div style={{ width: 20, height: 2, borderRadius: 1, background: m.color }} />
              <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>{m.label}</span>
              {isOverlay && (
                <span style={{ fontSize: 10, color: 'var(--text-tertiary)' }}>
                  (max {m.key === 'value' ? maxValues.value : m.key === 'sessions' ? maxValues.sessions : maxValues.tools})
                </span>
              )}
            </div>
          ))}
        </div>
      )}

      {data.length === 0 ? (
        <div style={{ height: 180, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-tertiary)', fontSize: 13 }}>
          No data for this period
        </div>
      ) : (
        <ResponsiveContainer width="100%" height={height}>
          <AreaChart data={chartData} margin={{ left: -10, right: 4 }}>
            <defs>
              {DATA_METRICS.map(m => (
                <linearGradient key={m.key} id={`grad-${m.key}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={m.color} stopOpacity={isOverlay ? 0.12 : 0.3} />
                  <stop offset="100%" stopColor={m.color} stopOpacity={0} />
                </linearGradient>
              ))}
            </defs>
            <CartesianGrid stroke="var(--border)" strokeDasharray="0" vertical={false} />
            {showAxes ? (
              <XAxis
                dataKey="displayDate"
                tick={{ fill: 'var(--text-tertiary)', fontSize: 10 }}
                axisLine={false}
                tickLine={false}
                tickFormatter={v => {
                  try { return format(parseISO(v), 'MMM d') } catch { return v }
                }}
                interval="preserveStartEnd"
              />
            ) : (
              <XAxis dataKey="displayDate" hide />
            )}
            <YAxis hide />
            <Tooltip content={<CustomTooltip isOverlay={isOverlay} rawData={data} />} />
            {isOverlay
              ? DATA_METRICS.map(m => (
                  <Area
                    key={m.key}
                    type="monotone"
                    dataKey={`${m.key}_norm`}
                    stroke={m.color}
                    strokeWidth={1.5}
                    fill={`url(#grad-${m.key})`}
                    dot={false}
                    activeDot={{ r: 3, fill: m.color, stroke: 'var(--bg-base)', strokeWidth: 2 }}
                    name={m.label}
                  />
                ))
              : (() => {
                  const m = DATA_METRICS.find(x => x.key === metric) ?? DATA_METRICS[0]
                  if (!m) return null
                  return (
                    <Area
                      type="monotone"
                      dataKey={m.key}
                      stroke={m.color}
                      strokeWidth={2}
                      fill={`url(#grad-${m.key})`}
                      dot={false}
                      activeDot={{ r: 4, fill: m.color, stroke: 'var(--bg-base)', strokeWidth: 2 }}
                      name={m.label}
                    />
                  )
                })()
            }
          </AreaChart>
        </ResponsiveContainer>
      )}
    </div>
  )
}
