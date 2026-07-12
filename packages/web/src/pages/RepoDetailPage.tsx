import React, { useMemo, useState } from 'react'
import { useOutletContext, useParams, useNavigate } from 'react-router-dom'
import {
  GitBranch, ArrowLeft, ExternalLink, Link2Off, Users, Zap, Workflow as WorkflowIcon,
  Clock, GitCommit,
} from 'lucide-react'
import type { AppContext } from '../lib/app-context'
import { repoShortName, fmt, fmtCost, formatProjectName } from '@agentistics/core'
import { useDerivedStats } from '../hooks/useData'
import { Section } from '../components/Section'
import { ModelBreakdown } from '../components/ModelBreakdown'
import { ActivityChart } from '../components/ActivityChart'
import { RecentSessions } from '../components/RecentSessions'

type Tab = 'overview' | 'members' | 'actions' | 'sessions' | 'workflows'

export default function RepoDetailPage() {
  const ctx = useOutletContext<AppContext>()
  const { data, filters, currency, brlRate, lang, theme, isCentral, setSelectedSession } = ctx
  const { id } = useParams()
  const navigate = useNavigate()
  const pt = lang === 'pt'

  // Route id → scope. A `folder:<path>` id is an unlinked project folder (scoped by its
  // project_path); anything else is a normalized remote (scoped by the repos filter).
  const rawId = id ?? ''
  const isFolder = rawId.startsWith('folder:')
  const folderPath = isFolder ? rawId.slice('folder:'.length) : ''
  const remote = isFolder ? '' : rawId
  const linked = !isFolder

  // Scope every metric to this repo/folder by overriding the relevant filter WITHOUT mutating
  // the global filter (so leaving the page leaves the FiltersBar untouched). All other active
  // filters (date/harness/models/users/presence) still compose because we spread `filters`.
  const scopedFilters = useMemo(
    () => (isFolder ? { ...filters, projects: [folderPath] } : { ...filters, repos: [remote] }),
    [filters, isFolder, folderPath, remote],
  )
  const scoped = useDerivedStats(data, scopedFilters)
  const [tab, setTab] = useState<Tab>('overview')
  // All hooks must run before any early return (rules of hooks); guard on scoped safely inside.
  const sessionIds = useMemo(
    () => new Set((scoped?.filteredSessions ?? []).map(s => s.session_id)),
    [scoped],
  )

  if (!scoped) return null

  const sessions = scoped.filteredSessions
  const ciSessions = sessions.filter(s => s.ci)
  const workflows = (data.workflows ?? []).filter(w => sessionIds.has(w.sessionId))

  const title = linked ? repoShortName(remote) : (folderPath.split('/').filter(Boolean).pop() || (pt ? 'Sem repositório' : 'No repository'))
  const host = linked ? remote.split('/')[0]! : ''

  const tabs: { id: Tab; label: string; icon: React.ReactNode; show: boolean; badge?: number }[] = [
    { id: 'overview', label: pt ? 'Visão geral' : 'Overview', icon: <GitBranch size={13} />, show: true },
    { id: 'members', label: pt ? 'Membros' : 'Members', icon: <Users size={13} />, show: isCentral, badge: scoped.repoStats[0]?.members.length },
    { id: 'actions', label: 'Actions', icon: <Zap size={13} />, show: true, badge: ciSessions.length || undefined },
    { id: 'sessions', label: pt ? 'Sessões' : 'Sessions', icon: <Clock size={13} />, show: true },
    { id: 'workflows', label: 'Workflows', icon: <WorkflowIcon size={13} />, show: workflows.length > 0, badge: workflows.length },
  ]

  return (
    <>
      {/* Header */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <button
          onClick={() => navigate('/repositories')}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 5, alignSelf: 'flex-start',
            fontSize: 12, color: 'var(--text-tertiary)', background: 'transparent', border: 'none',
            cursor: 'pointer', fontFamily: 'inherit', padding: 0,
          }}
        >
          <ArrowLeft size={13} /> {pt ? 'Repositórios' : 'Repositories'}
        </button>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <span style={{ color: linked ? 'var(--anthropic-orange)' : 'var(--text-tertiary)' }}>
            {linked ? <GitBranch size={18} /> : <Link2Off size={18} />}
          </span>
          <span style={{ fontSize: 19, fontWeight: 700, color: 'var(--text-primary)' }}>{title}</span>
          {host && (
            <a href={`https://${remote}`} target="_blank" rel="noreferrer" style={{
              display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11.5, fontWeight: 600,
              color: 'var(--text-secondary)', background: 'var(--bg-elevated)', border: '1px solid var(--border)',
              padding: '3px 8px', borderRadius: 6, textDecoration: 'none',
            }}>
              {remote} <ExternalLink size={11} />
            </a>
          )}
        </div>
        {/* Full folder path subtitle — shown for every repo/folder */}
        {(folderPath || scoped.repoStats[0]?.path) && (
          <span style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>
            {formatProjectName(folderPath || scoped.repoStats[0]!.path)}
          </span>
        )}
      </div>

      {/* KPI row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 10 }}>
        <StatTile label={pt ? 'Sessões' : 'Sessions'} value={String(scoped.totalSessions)} />
        <StatTile label={pt ? 'Custo' : 'Cost'} value={fmtCost(scoped.totalCostUSD, currency, brlRate)} accent />
        <StatTile label={pt ? 'Tokens in' : 'Tokens in'} value={fmt(scoped.inputTokens)} />
        <StatTile label={pt ? 'Tokens out' : 'Tokens out'} value={fmt(scoped.outputTokens)} />
        <StatTile label="Commits" value={String(scoped.gitCommits)} />
        <StatTile label={pt ? 'Linhas' : 'Lines'} value={`+${fmt(scoped.linesAdded)} −${fmt(scoped.linesRemoved)}`} />
        {isCentral && <StatTile label={pt ? 'Membros' : 'Members'} value={String(scoped.repoStats[0]?.members.length ?? 0)} />}
        <StatTile label="Agents" value={String(scoped.totalAgentInvocations)} />
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 4, borderBottom: '1px solid var(--border)', overflowX: 'auto' }}>
        {tabs.filter(t => t.show).map(t => {
          const active = tab === t.id
          return (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap',
                padding: '9px 13px', fontSize: 13, fontWeight: active ? 700 : 500, fontFamily: 'inherit',
                color: active ? 'var(--anthropic-orange)' : 'var(--text-secondary)',
                background: 'transparent', border: 'none', cursor: 'pointer',
                borderBottom: active ? '2px solid var(--anthropic-orange)' : '2px solid transparent',
                marginBottom: -1,
              }}
            >
              {t.icon} {t.label}
              {t.badge != null && t.badge > 0 && (
                <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-tertiary)', background: 'var(--bg-elevated)', borderRadius: 8, padding: '1px 6px' }}>{t.badge}</span>
              )}
            </button>
          )
        })}
      </div>

      {tab === 'overview' && (
        <>
          <Section title={<><Clock size={14} /> {pt ? 'Atividade ao longo do tempo' : 'Activity over time'}</>}>
            <ActivityChart data={scoped.heatmapData} height={200} theme={theme} />
          </Section>
          <Section title={pt ? 'Uso por modelo' : 'Model usage & cost'}>
            <ModelBreakdown
              modelUsage={scoped.modelUsage}
              currency={currency}
              brlRate={brlRate}
              fallbackInputTokens={scoped.inputTokens}
              fallbackOutputTokens={scoped.outputTokens}
              fallbackCostUSD={scoped.totalCostUSD}
            />
          </Section>
        </>
      )}

      {tab === 'members' && isCentral && (
        <Section title={<><Users size={14} /> {pt ? 'Quem trabalha neste repositório' : 'Who works on this repository'}</>}>
          <MembersTable sessions={sessions} lang={lang} currency={currency} brlRate={brlRate} />
        </Section>
      )}

      {tab === 'actions' && (
        <Section title={<><Zap size={14} /> {pt ? 'GitHub Actions (runners de CI)' : 'GitHub Actions (CI runners)'}</>}>
          {ciSessions.length === 0 ? (
            <div style={{ color: 'var(--text-tertiary)', fontSize: 13, padding: 20, textAlign: 'center', lineHeight: 1.6 }}>
              {pt
                ? 'Nenhum run de GitHub Actions registrado para este repositório ainda. Configure o workflow do agentistics para enviar as métricas do Claude Code Actions à central.'
                : 'No GitHub Actions runs recorded for this repository yet. Configure the agentistics workflow to push Claude Code Actions metrics to the central.'}
            </div>
          ) : (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 10, marginBottom: 14 }}>
                <StatTile label={pt ? 'Runs' : 'Runs'} value={String(ciSessions.length)} />
                <StatTile label={pt ? 'Tokens' : 'Tokens'} value={fmt(ciSessions.reduce((a, s) => a + (s.input_tokens ?? 0) + (s.output_tokens ?? 0), 0))} />
                <StatTile label="Commits" value={String(ciSessions.reduce((a, s) => a + (s.git_commits ?? 0), 0))} />
              </div>
              <RecentSessions sessions={ciSessions} lang={lang} onSelect={setSelectedSession} />
            </>
          )}
        </Section>
      )}

      {tab === 'sessions' && (
        <Section title={<><Clock size={14} /> {pt ? 'Sessões recentes' : 'Recent sessions'}</>}>
          <RecentSessions sessions={sessions} lang={lang} onSelect={setSelectedSession} />
        </Section>
      )}

      {tab === 'workflows' && (
        <Section title={<><WorkflowIcon size={14} /> Workflows</>}>
          <WorkflowsMini workflows={workflows} lang={lang} currency={currency} brlRate={brlRate} />
        </Section>
      )}
    </>
  )
}

function StatTile({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div style={{
      display: 'flex', flexDirection: 'column', gap: 3, padding: '12px 14px',
      background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)',
    }}>
      <span style={{ fontSize: 18, fontWeight: 700, color: accent ? 'var(--anthropic-orange)' : 'var(--text-primary)', whiteSpace: 'nowrap' }}>{value}</span>
      <span style={{ fontSize: 10.5, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{label}</span>
    </div>
  )
}

function MembersTable({ sessions, lang, currency, brlRate }: {
  sessions: import('@agentistics/core').SessionMeta[]
  lang: 'pt' | 'en'; currency: 'USD' | 'BRL'; brlRate: number
}) {
  const pt = lang === 'pt'
  const byUser: Record<string, { sessions: number; messages: number; tokens: number; commits: number }> = {}
  for (const s of sessions) {
    const u = s.user || (pt ? 'local' : 'local')
    if (!byUser[u]) byUser[u] = { sessions: 0, messages: 0, tokens: 0, commits: 0 }
    byUser[u].sessions++
    byUser[u].messages += s.user_message_count ?? 0
    byUser[u].tokens += (s.input_tokens ?? 0) + (s.output_tokens ?? 0)
    byUser[u].commits += s.git_commits ?? 0
  }
  const rows = Object.entries(byUser).sort((a, b) => b[1].tokens - a[1].tokens)
  if (rows.length === 0) return <div style={{ color: 'var(--text-tertiary)', fontSize: 13, padding: 16 }}>—</div>
  void currency; void brlRate
  const maxTok = Math.max(...rows.map(r => r[1].tokens), 1)
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {rows.map(([user, st], i) => (
        <div key={user} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', background: 'var(--bg-elevated)', borderRadius: 8, border: '1px solid var(--border-subtle)' }}>
          <span style={{ fontSize: 11, fontWeight: 700, color: i === 0 ? 'var(--anthropic-orange)' : 'var(--text-tertiary)', width: 18 }}>#{i + 1}</span>
          <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{user}</span>
          <div style={{ width: 90, height: 3, background: 'var(--bg-card)', borderRadius: 2, overflow: 'hidden' }}>
            <div style={{ height: '100%', width: `${(st.tokens / maxTok) * 100}%`, background: 'var(--anthropic-orange)', borderRadius: 2 }} />
          </div>
          <span style={{ fontSize: 12, color: 'var(--text-secondary)', width: 60, textAlign: 'right' }}>{st.sessions}s</span>
          <span style={{ fontSize: 12, color: 'var(--text-secondary)', width: 60, textAlign: 'right' }}>{fmt(st.tokens)}</span>
          <span style={{ fontSize: 12, color: 'var(--text-tertiary)', width: 60, textAlign: 'right', display: 'inline-flex', alignItems: 'center', gap: 3, justifyContent: 'flex-end' }}><GitCommit size={11} />{st.commits}</span>
        </div>
      ))}
    </div>
  )
}

function WorkflowsMini({ workflows, lang, currency, brlRate }: {
  workflows: import('@agentistics/core').WorkflowRun[]
  lang: 'pt' | 'en'; currency: 'USD' | 'BRL'; brlRate: number
}) {
  const pt = lang === 'pt'
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {workflows.map(w => (
        <div key={w.runId} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', background: 'var(--bg-elevated)', borderRadius: 8, border: '1px solid var(--border-subtle)' }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{w.name}</span>
          <span style={{ fontSize: 11.5, color: 'var(--text-tertiary)' }}>{w.totals.agentCount} {pt ? 'agentes' : 'agents'}</span>
          <span style={{ fontSize: 11.5, color: 'var(--text-tertiary)' }}>{fmt(w.totals.tokensIn + w.totals.tokensOut)} tok</span>
          <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--anthropic-orange)' }}>{fmtCost(w.totals.costUSD, currency, brlRate)}</span>
        </div>
      ))}
    </div>
  )
}
