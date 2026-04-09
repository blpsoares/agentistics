import React from 'react'
import { formatProjectName } from '../lib/types'

import { FolderOpen } from 'lucide-react'

interface Props {
  projectStats: Record<string, { sessions: number; messages: number; tools: number }>
  onFilter?: (project: string) => void
}

export function ProjectsList({ projectStats, onFilter }: Props) {
  const entries = Object.entries(projectStats)
    .sort((a, b) => b[1].sessions - a[1].sessions)
    .slice(0, 12)

  const maxSessions = Math.max(...entries.map(([, s]) => s.sessions), 1)

  if (entries.length === 0) {
    return (
      <div style={{ color: 'var(--text-tertiary)', fontSize: 13, textAlign: 'center', padding: 24 }}>
        No project data available
      </div>
    )
  }

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
      {entries.map(([path, stats]) => {
        const pct = stats.sessions / maxSessions
        return (
          <div
            key={path}
            onClick={() => onFilter?.(path)}
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 5,
              padding: '8px 10px',
              background: 'var(--bg-elevated)',
              borderRadius: 8,
              border: '1px solid var(--border-subtle)',
              cursor: onFilter ? 'pointer' : 'default',
              transition: 'border-color 0.15s, background 0.15s',
              minWidth: 0,
            }}
            onMouseEnter={e => {
              if (!onFilter) return
              ;(e.currentTarget as HTMLDivElement).style.borderColor = 'var(--anthropic-orange)40'
              ;(e.currentTarget as HTMLDivElement).style.background = 'var(--bg-card-hover)'
            }}
            onMouseLeave={e => {
              ;(e.currentTarget as HTMLDivElement).style.borderColor = 'var(--border-subtle)'
              ;(e.currentTarget as HTMLDivElement).style.background = 'var(--bg-elevated)'
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 5, minWidth: 0 }}>
              <FolderOpen size={11} color="var(--text-tertiary)" style={{ flexShrink: 0 }} />
              <span style={{
                fontSize: 11, fontWeight: 600, color: 'var(--text-primary)',
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              }}>
                {formatProjectName(path)}
              </span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
              <div style={{ flex: 1, height: 2, background: 'var(--bg-card)', borderRadius: 1, overflow: 'hidden' }}>
                <div style={{
                  height: '100%',
                  width: `${pct * 100}%`,
                  background: 'linear-gradient(90deg, var(--anthropic-orange), var(--anthropic-orange-light))',
                  borderRadius: 1,
                  transition: 'width 0.6s ease',
                }} />
              </div>
              <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--anthropic-orange)' }}>{stats.sessions}s</span>
                <span style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>{stats.messages}m</span>
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}
