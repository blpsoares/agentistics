import React, { useMemo, useState } from 'react'
import { useOutletContext } from 'react-router-dom'
import { format, parseISO } from 'date-fns'
import { GitBranch, ChevronRight, CheckCircle, XCircle, FolderOpen, Bot } from 'lucide-react'
import { fmt, formatProjectName } from '@agentistics/core'
import type { SessionMeta } from '@agentistics/core'
import type { AppContext } from '../lib/app-context'
import { useIsMobile } from '../hooks/useIsMobile'
import { capable } from '../lib/harness'
import { NAtag } from '../components/NAtag'

interface ProjectGroup {
  path: string
  sessions: SessionMeta[]
  totalInvocations: number
  totalTokens: number
  totalCostUSD: number
}

const AGENT_TYPE_COLORS: Record<string, { bg: string; text: string }> = {
  'general-purpose': { bg: 'rgba(99,102,241,0.15)', text: '#818cf8' },
  'Explore': { bg: 'rgba(16,185,129,0.15)', text: '#34d399' },
  'Plan': { bg: 'rgba(245,158,11,0.15)', text: '#fbbf24' },
  'claude-code-guide': { bg: 'rgba(6,182,212,0.15)', text: '#22d3ee' },
  'statusline-setup': { bg: 'rgba(139,92,246,0.15)', text: '#a78bfa' },
  'code-reviewer': { bg: 'rgba(239,68,68,0.15)', text: '#f87171' },
}

function AgentTypeBadge({ type }: { type: string }) {
  const style = AGENT_TYPE_COLORS[type] ?? { bg: 'rgba(148,163,184,0.15)', text: 'var(--text-secondary)' }
  return (
    <span style={{
      display: 'inline-block',
      padding: '1px 7px',
      borderRadius: 10,
      fontSize: 10,
      fontWeight: 600,
      background: style.bg,
      color: style.text,
      whiteSpace: 'nowrap',
    }}>
      {type}
    </span>
  )
}

function fmtInvocationCost(usd: number, currency: 'USD' | 'BRL', rate: number): string {
  if (currency === 'BRL') {
    const brl = usd * rate
    if (brl < 0.005) return '<R$0,01'
    return `R$${brl.toFixed(2).replace('.', ',')}`
  }
  if (usd < 0.001) return '<USD 0.001'
  if (usd < 0.01) return `USD ${usd.toFixed(3)}`
  return `USD ${usd.toFixed(2)}`
}

function fmtInvocationDuration(ms: number): string {
  if (ms === 0) return '—'
  const s = Math.round(ms / 1000)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  const rem = s % 60
  return rem > 0 ? `${m}m ${rem}s` : `${m}m`
}

export default function TracesPage() {
  const ctx = useOutletContext<AppContext>()
  const { derived, lang, currency, brlRate, filters } = ctx
  const pt = lang === 'pt'
  const isMobile = useIsMobile()

  const [selectedProject, setSelectedProject] = useState<string | null>(null)
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null)

  const projectGroups = useMemo<ProjectGroup[]>(() => {
    const map = new Map<string, ProjectGroup>()
    for (const s of derived.filteredSessions) {
      const invocations = s.agentMetrics?.invocations
      if (!invocations || invocations.length === 0) continue
      const key = s.project_path || 'Unknown'
      let group = map.get(key)
      if (!group) {
        group = { path: key, sessions: [], totalInvocations: 0, totalTokens: 0, totalCostUSD: 0 }
        map.set(key, group)
      }
      group.sessions.push(s)
      group.totalInvocations += invocations.length
      group.totalTokens += s.agentMetrics?.totalTokens ?? 0
      group.totalCostUSD += s.agentMetrics?.totalCostUSD ?? 0
    }
    return Array.from(map.values())
      .map(g => ({ ...g, sessions: [...g.sessions].sort((a, b) => b.start_time.localeCompare(a.start_time)) }))
      .sort((a, b) => b.totalInvocations - a.totalInvocations)
  }, [derived.filteredSessions])

  const selectedGroup = projectGroups.find(g => g.path === selectedProject) ?? null
  const selectedSession = selectedGroup?.sessions.find(s => s.session_id === selectedSessionId) ?? null

  const subtitle = pt
    ? 'Quais subagents o Claude Code invocou, agrupados por projeto e sessão.'
    : 'Which subagents Claude Code spawned, grouped by project and session.'

  const breadcrumbItems = [pt ? 'Todos os projetos' : 'All projects']
  if (selectedGroup) breadcrumbItems.push(formatProjectName(selectedGroup.path))
  if (selectedSession) breadcrumbItems.push(format(parseISO(selectedSession.start_time), 'MMM d, HH:mm'))

  const navigateTo = (depth: number) => {
    if (depth === 0) { setSelectedProject(null); setSelectedSessionId(null) }
    else if (depth === 1) setSelectedSessionId(null)
  }

  if (filters.harness && !capable(filters.harness, 'agents')) {
    return (
      <>
        <PageHeader icon={<GitBranch size={16} />} title="Pipelines" subtitle={subtitle} />
        <div style={{ marginTop: 16, background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)' }}>
          <NAtag harness={filters.harness} label={pt ? 'Métricas de agentes' : 'Agent metrics'} />
        </div>
      </>
    )
  }

  return (
    <>
      <PageHeader icon={<GitBranch size={16} />} title="Pipelines" subtitle={subtitle} />

      <Breadcrumb items={breadcrumbItems} onNavigate={navigateTo} />

      {!selectedGroup && (
        projectGroups.length === 0 ? (
          <EmptyState lang={lang} />
        ) : (
          <div style={{
            display: 'grid',
            gridTemplateColumns: isMobile ? '1fr' : 'repeat(auto-fill, minmax(260px, 1fr))',
            gap: 12,
          }}>
            {projectGroups.map(g => (
              <ProjectCard key={g.path} group={g} onClick={() => setSelectedProject(g.path)} lang={lang} currency={currency} brlRate={brlRate} />
            ))}
          </div>
        )
      )}

      {selectedGroup && !selectedSession && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {selectedGroup.sessions.map(s => (
            <SessionRow key={s.session_id} session={s} onClick={() => setSelectedSessionId(s.session_id)} lang={lang} currency={currency} brlRate={brlRate} />
          ))}
        </div>
      )}

      {selectedSession && (
        <InvocationTable invocations={selectedSession.agentMetrics?.invocations ?? []} lang={lang} currency={currency} brlRate={brlRate} isMobile={isMobile} />
      )}
    </>
  )
}

function Breadcrumb({ items, onNavigate }: { items: string[]; onNavigate: (depth: number) => void }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--text-tertiary)', margin: '16px 0 12px', flexWrap: 'wrap' }}>
      {items.map((label, i) => (
        <React.Fragment key={i}>
          {i > 0 && <ChevronRight size={12} />}
          {i === items.length - 1 ? (
            <span style={{ color: 'var(--text-primary)', fontWeight: 600 }}>{label}</span>
          ) : (
            <button
              onClick={() => onNavigate(i)}
              style={{ background: 'none', border: 'none', padding: 0, color: 'var(--text-tertiary)', cursor: 'pointer', fontSize: 12, fontFamily: 'inherit' }}
            >
              {label}
            </button>
          )}
        </React.Fragment>
      ))}
    </div>
  )
}

function EmptyState({ lang }: { lang: 'pt' | 'en' }) {
  const pt = lang === 'pt'
  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
      padding: '48px 0',
      color: 'var(--text-tertiary)',
      fontSize: 13,
      background: 'var(--bg-card)',
      border: '1px solid var(--border)',
      borderRadius: 'var(--radius-lg)',
    }}>
      <Bot size={16} style={{ opacity: 0.4 }} />
      {pt ? 'Nenhuma invocação de subagent encontrada no período' : 'No subagent invocations found in this period'}
    </div>
  )
}

function ProjectCard({ group, onClick, lang, currency, brlRate }: {
  group: ProjectGroup
  onClick: () => void
  lang: 'pt' | 'en'
  currency: 'USD' | 'BRL'
  brlRate: number
}) {
  const pt = lang === 'pt'
  return (
    <div
      onClick={onClick}
      style={{
        cursor: 'pointer',
        background: 'var(--bg-card)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius-lg)',
        padding: '14px 16px',
        transition: 'border-color 0.15s',
      }}
      onMouseEnter={e => { (e.currentTarget as HTMLDivElement).style.borderColor = 'var(--anthropic-orange)' }}
      onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.borderColor = 'var(--border)' }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 8 }}>
        <FolderOpen size={13} color="var(--text-tertiary)" style={{ flexShrink: 0 }} />
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{formatProjectName(group.path)}</span>
      </div>
      <div style={{ display: 'flex', gap: 14, fontSize: 11, color: 'var(--text-secondary)', flexWrap: 'wrap' }}>
        <span><b style={{ color: 'var(--anthropic-orange)' }}>{group.totalInvocations}</b> {pt ? 'invocações' : 'invocations'}</span>
        <span>{group.sessions.length} {pt ? 'sessões' : 'sessions'}</span>
        <span>{fmt(group.totalTokens)} tok</span>
        <span>{fmtInvocationCost(group.totalCostUSD, currency, brlRate)}</span>
      </div>
    </div>
  )
}

function SessionRow({ session, onClick, lang, currency, brlRate }: {
  session: SessionMeta
  onClick: () => void
  lang: 'pt' | 'en'
  currency: 'USD' | 'BRL'
  brlRate: number
}) {
  const pt = lang === 'pt'
  const invocations = session.agentMetrics?.invocations ?? []
  return (
    <div
      onClick={onClick}
      style={{
        cursor: 'pointer',
        background: 'var(--bg-elevated)',
        border: '1px solid var(--border)',
        borderRadius: 10,
        padding: '10px 14px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 12,
      }}
      onMouseEnter={e => { (e.currentTarget as HTMLDivElement).style.borderColor = 'var(--anthropic-orange)' }}
      onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.borderColor = 'var(--border)' }}
    >
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ fontSize: 12, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {session.first_prompt || <em style={{ color: 'var(--text-tertiary)' }}>—</em>}
        </div>
        <div style={{ fontSize: 10, color: 'var(--text-tertiary)', marginTop: 2 }}>
          {format(parseISO(session.start_time), 'MMM d, HH:mm')}
        </div>
      </div>
      <div style={{ display: 'flex', gap: 12, fontSize: 11, color: 'var(--text-secondary)', flexShrink: 0 }}>
        <span>{invocations.length} {pt ? 'agentes' : 'agents'}</span>
        <span>{fmt(session.agentMetrics?.totalTokens ?? 0)} tok</span>
        <span style={{ color: 'var(--anthropic-orange)' }}>{fmtInvocationCost(session.agentMetrics?.totalCostUSD ?? 0, currency, brlRate)}</span>
      </div>
      <ChevronRight size={14} color="var(--text-tertiary)" style={{ flexShrink: 0 }} />
    </div>
  )
}

function InvocationTable({ invocations, lang, currency, brlRate, isMobile }: {
  invocations: import('@agentistics/core').AgentInvocation[]
  lang: 'pt' | 'en'
  currency: 'USD' | 'BRL'
  brlRate: number
  isMobile: boolean
}) {
  const pt = lang === 'pt'

  if (invocations.length === 0) return <EmptyState lang={lang} />

  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: 8, overflow: isMobile ? 'auto' : 'hidden', width: '100%' }}>
      <div style={{ minWidth: isMobile ? 480 : undefined }}>
        <div style={{
          display: 'grid',
          gridTemplateColumns: '140px 1fr 60px 60px 60px 80px',
          gap: 10,
          padding: '7px 12px',
          background: 'var(--bg-elevated)',
          borderBottom: '1px solid var(--border)',
          fontSize: 10,
          fontWeight: 600,
          color: 'var(--text-tertiary)',
          textTransform: 'uppercase',
          letterSpacing: '0.04em',
        }}>
          <span>{pt ? 'Tipo' : 'Type'}</span>
          <span>{pt ? 'Descrição' : 'Description'}</span>
          <span style={{ textAlign: 'right' }}>Tokens</span>
          <span style={{ textAlign: 'right' }}>Tools</span>
          <span style={{ textAlign: 'right' }}>{pt ? 'Duração' : 'Duration'}</span>
          <span style={{ textAlign: 'right' }}>{pt ? 'Custo' : 'Cost'}</span>
        </div>
        {invocations.map((inv, i) => (
          <div
            key={inv.toolUseId || i}
            style={{
              display: 'grid',
              gridTemplateColumns: '140px 1fr 60px 60px 60px 80px',
              gap: 10,
              padding: '8px 12px',
              alignItems: 'center',
              borderBottom: i < invocations.length - 1 ? '1px solid var(--border)' : 'none',
              background: i % 2 === 0 ? 'transparent' : 'var(--bg-elevated)',
            }}
          >
            <AgentTypeBadge type={inv.agentType} />
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
              {inv.status === 'failed'
                ? <XCircle size={11} color="var(--accent-red, #ef4444)" style={{ flexShrink: 0 }} />
                : <CheckCircle size={11} color="var(--accent-green)" style={{ flexShrink: 0 }} />
              }
              <span style={{ fontSize: 11, color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {inv.description || <em style={{ color: 'var(--text-tertiary)' }}>—</em>}
              </span>
            </div>
            <span style={{ fontSize: 11, color: 'var(--text-primary)', textAlign: 'right' }}>{fmt(inv.totalTokens)}</span>
            <span style={{ fontSize: 11, color: 'var(--text-secondary)', textAlign: 'right' }}>{inv.totalToolUseCount}</span>
            <span style={{ fontSize: 11, color: 'var(--text-secondary)', textAlign: 'right' }}>{fmtInvocationDuration(inv.totalDurationMs)}</span>
            <span style={{ fontSize: 11, color: 'var(--anthropic-orange)', textAlign: 'right' }}>{fmtInvocationCost(inv.costUSD, currency, brlRate)}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

function PageHeader({ icon, title, subtitle }: { icon: React.ReactNode; title: string; subtitle: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 4 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 18, fontWeight: 700, color: 'var(--text-primary)' }}>
        <span style={{ color: 'var(--anthropic-orange)' }}>{icon}</span>
        {title}
      </div>
      <div style={{ fontSize: 12, color: 'var(--text-tertiary)', lineHeight: 1.5 }}>{subtitle}</div>
    </div>
  )
}
