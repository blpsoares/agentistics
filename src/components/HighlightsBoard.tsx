import React from 'react'
import { Clock, Download, Upload, MessageSquare, Wrench, FolderOpen, Trophy } from 'lucide-react'
import type { SessionMeta, Project } from '../lib/types'
import { formatProjectName } from '../lib/types'

function fmt(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return String(n)
}

function fmtDuration(minutes: number): string {
  const h = Math.floor(minutes / 60)
  const m = Math.round(minutes % 60)
  if (h > 0) return `${h}h ${m}m`
  return `${m}m`
}

interface HighlightsBoardProps {
  sessions: SessionMeta[]
  projects: Project[]
  lang: 'pt' | 'en'
}

export function HighlightsBoard({ sessions, projects, lang }: HighlightsBoardProps) {
  const pt = lang === 'pt'

  if (sessions.length === 0) {
    return (
      <div style={{ color: 'var(--text-tertiary)', fontSize: 13, textAlign: 'center', padding: 24 }}>
        {pt ? 'Sem dados de sessão disponíveis' : 'No session data available'}
      </div>
    )
  }

  // 1. Longest session
  const longestSession = sessions.reduce((best, s) =>
    (s.duration_minutes ?? 0) > (best.duration_minutes ?? 0) ? s : best, sessions[0])

  // 2. Most input tokens
  const mostInputTokens = sessions.reduce((best, s) =>
    (s.input_tokens ?? 0) > (best.input_tokens ?? 0) ? s : best, sessions[0])

  // 3. Most output tokens
  const mostOutputTokens = sessions.reduce((best, s) =>
    (s.output_tokens ?? 0) > (best.output_tokens ?? 0) ? s : best, sessions[0])

  // 4. Most messages
  const mostMessages = sessions.reduce((best, s) => {
    const msgs = (s.user_message_count ?? 0) + (s.assistant_message_count ?? 0)
    const bestMsgs = (best.user_message_count ?? 0) + (best.assistant_message_count ?? 0)
    return msgs > bestMsgs ? s : best
  }, sessions[0])

  // 5. Most tool calls
  const mostToolCalls = sessions.reduce((best, s) => {
    const tools = Object.values(s.tool_counts ?? {}).reduce((a, b) => a + b, 0)
    const bestTools = Object.values(best.tool_counts ?? {}).reduce((a, b) => a + b, 0)
    return tools > bestTools ? s : best
  }, sessions[0])

  // 6. Project with most sessions (count from filtered sessions list)
  const projectSessionCounts: Record<string, number> = {}
  for (const s of sessions) {
    if (s.project_path) {
      projectSessionCounts[s.project_path] = (projectSessionCounts[s.project_path] ?? 0) + 1
    }
  }
  const topProjectEntry = Object.entries(projectSessionCounts).sort((a, b) => b[1] - a[1])[0]

  // Helper: get session id (first 8 chars)
  function shortId(id: string | undefined) {
    return id ? id.slice(0, 8) : '—'
  }

  // Helper: truncate prompt
  function truncate(str: string | undefined, len: number) {
    if (!str) return pt ? 'Sem título' : 'Untitled'
    return str.length > len ? str.slice(0, len) + '…' : str
  }

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>

      {/* Longest session */}
      <HighlightCard
        label={pt ? 'Sessão mais longa' : 'Longest session'}
        icon={<Clock size={15} />}
        accent="var(--accent-purple)"
        value={fmtDuration(longestSession.duration_minutes ?? 0)}
        sessionId={shortId(longestSession.session_id)}
        sessionName={truncate(longestSession.first_prompt, 60)}
        project={formatProjectName(longestSession.project_path ?? '')}
      />

      {/* Most input tokens */}
      <HighlightCard
        label={pt ? 'Mais tokens de entrada' : 'Most input tokens'}
        icon={<Download size={15} />}
        accent="var(--accent-blue)"
        value={fmt(mostInputTokens.input_tokens ?? 0)}
        sessionId={shortId(mostInputTokens.session_id)}
        sessionName={truncate(mostInputTokens.first_prompt, 60)}
        project={formatProjectName(mostInputTokens.project_path ?? '')}
      />

      {/* Most output tokens */}
      <HighlightCard
        label={pt ? 'Mais tokens de saída' : 'Most output tokens'}
        icon={<Upload size={15} />}
        accent="var(--accent-purple)"
        value={fmt(mostOutputTokens.output_tokens ?? 0)}
        sessionId={shortId(mostOutputTokens.session_id)}
        sessionName={truncate(mostOutputTokens.first_prompt, 60)}
        project={formatProjectName(mostOutputTokens.project_path ?? '')}
      />

      {/* Most messages */}
      <HighlightCard
        label={pt ? 'Mais mensagens' : 'Most messages'}
        icon={<MessageSquare size={15} />}
        accent="var(--anthropic-orange)"
        value={fmt((mostMessages.user_message_count ?? 0) + (mostMessages.assistant_message_count ?? 0))}
        sessionId={shortId(mostMessages.session_id)}
        sessionName={truncate(mostMessages.first_prompt, 60)}
        project={formatProjectName(mostMessages.project_path ?? '')}
      />

      {/* Most tool calls */}
      <HighlightCard
        label={pt ? 'Mais chamadas de ferramentas' : 'Most tool calls'}
        icon={<Wrench size={15} />}
        accent="var(--accent-green)"
        value={fmt(Object.values(mostToolCalls.tool_counts ?? {}).reduce((a, b) => a + b, 0))}
        sessionId={shortId(mostToolCalls.session_id)}
        sessionName={truncate(mostToolCalls.first_prompt, 60)}
        project={formatProjectName(mostToolCalls.project_path ?? '')}
      />

      {/* Project with most sessions */}
      {topProjectEntry && (
        <HighlightCard
          label={pt ? 'Projeto mais ativo' : 'Most active project'}
          icon={<FolderOpen size={15} />}
          accent="var(--accent-cyan)"
          value={String(topProjectEntry[1])}
          valueSub={pt ? 'sessões' : 'sessions'}
          sessionId={topProjectEntry[0].split('/').pop() ?? '—'}
          sessionName={formatProjectName(topProjectEntry[0])}
          project={`${topProjectEntry[1]} ${pt ? 'sessões no período' : 'sessions in period'}`}
        />
      )}
    </div>
  )
}

function HighlightCard({
  label, icon, accent, value, valueSub, sessionId, sessionName, project,
}: {
  label: string
  icon: React.ReactNode
  accent: string
  value: string
  valueSub?: string
  sessionId?: string
  sessionName?: string
  project?: string
}) {
  return (
    <div
      style={{
        background: 'var(--bg-card)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius-lg)',
        padding: '16px 18px',
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
        position: 'relative',
        overflow: 'hidden',
        transition: 'border-color 0.2s, background 0.2s',
      }}
      onMouseEnter={e => {
        const el = e.currentTarget as HTMLDivElement
        el.style.borderColor = `${accent}40`
        el.style.background = 'var(--bg-card-hover)'
      }}
      onMouseLeave={e => {
        const el = e.currentTarget as HTMLDivElement
        el.style.borderColor = 'var(--border)'
        el.style.background = 'var(--bg-card)'
      }}
    >
      {/* Top accent line */}
      <div style={{
        position: 'absolute', top: 0, left: 0, right: 0, height: 2,
        background: `linear-gradient(90deg, ${accent}60, ${accent}10, transparent)`,
      }} />

      {/* Header row */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{
          fontSize: 11, fontWeight: 500, color: 'var(--text-secondary)',
          letterSpacing: '0.05em', textTransform: 'uppercase',
        }}>
          {label}
        </span>
        <span style={{
          width: 28, height: 28, borderRadius: 7,
          background: `${accent}18`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: accent, flexShrink: 0,
        }}>
          {icon}
        </span>
      </div>

      {/* Value */}
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 5 }}>
        <div style={{ fontSize: 26, fontWeight: 700, color: 'var(--text-primary)', lineHeight: 1.1 }}>
          {value}
        </div>
        {valueSub && (
          <div style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>{valueSub}</div>
        )}
      </div>

      {/* Session / project details */}
      <div style={{
        borderTop: '1px solid var(--border)',
        paddingTop: 8,
        display: 'flex',
        flexDirection: 'column',
        gap: 4,
      }}>
        {sessionId && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <Trophy size={10} style={{ color: accent, flexShrink: 0 }} />
            <code style={{
              fontSize: 10, color: 'var(--text-tertiary)',
              background: 'var(--bg-elevated)',
              padding: '1px 5px', borderRadius: 3,
              letterSpacing: '0.03em',
            }}>
              {sessionId}
            </code>
          </div>
        )}
        {sessionName && (
          <div
            title={sessionName}
            style={{
              fontSize: 12, color: 'var(--text-secondary)',
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}
          >
            {sessionName}
          </div>
        )}
        {project && (
          <div
            title={project}
            style={{
              fontSize: 11, color: 'var(--text-tertiary)',
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}
          >
            {project}
          </div>
        )}
      </div>
    </div>
  )
}
