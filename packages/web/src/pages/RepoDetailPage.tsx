import React, { useMemo, useState } from 'react'
import { useOutletContext, useParams, useNavigate } from 'react-router-dom'
import {
  GitBranch, ArrowLeft, ExternalLink, Link2Off, Users, Zap, Workflow as WorkflowIcon,
  Clock, GitCommit, ChevronDown, DollarSign, Cpu, Wrench, Bot, FileCode, MessageSquare, Database, AlertTriangle,
} from 'lucide-react'
import type { AppContext, } from '../lib/app-context'
import type { SessionMeta, MemberPresence, HarnessId, WorkflowRun } from '@agentistics/core'
import { repoShortName, fmt, fmtCost, fmtDuration, formatProjectName, formatModel, calcCost } from '@agentistics/core'
import { capable, HARNESS_LABELS, HARNESS_COLORS } from '../lib/harness'
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
  const sessionByIdWf = useMemo(
    () => new Map((data.sessions ?? []).map(s => [s.session_id, s] as [string, SessionMeta])),
    [data.sessions],
  )

  if (!scoped) return null

  const sessions = scoped.filteredSessions
  const ciSessions = sessions.filter(s => s.ci)
  const workflows = (data.workflows ?? []).filter(w => sessionIds.has(w.sessionId))
  const harnessOf = (w: WorkflowRun): HarnessId => sessionByIdWf.get(w.sessionId)?.harness ?? 'claude'

  const title = linked ? repoShortName(remote) : (folderPath.split('/').filter(Boolean).pop() || (pt ? 'Sem repositório' : 'No repository'))
  const host = linked ? remote.split('/')[0]! : ''

  const tabs: { id: Tab; label: string; icon: React.ReactNode; show: boolean; badge?: number }[] = [
    { id: 'overview', label: pt ? 'Visão geral' : 'Overview', icon: <GitBranch size={13} />, show: true },
    { id: 'members', label: pt ? 'Membros' : 'Members', icon: <Users size={13} />, show: isCentral, badge: scoped.repoStats[0]?.members.length },
    { id: 'actions', label: 'Actions', icon: <Zap size={13} />, show: ciSessions.length > 0, badge: ciSessions.length || undefined },
    { id: 'sessions', label: pt ? 'Sessões' : 'Sessions', icon: <Clock size={13} />, show: true },
    { id: 'workflows', label: 'Dynamic Workflows', icon: <WorkflowIcon size={13} />, show: workflows.length > 0 && workflows.some(w => capable(harnessOf(w), 'dynamicWorkflows')), badge: workflows.length },
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
      <div className="tabscroll" style={{ display: 'flex', gap: 4, borderBottom: '1px solid var(--border)', overflowX: 'auto' }}>
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
          <MembersTable sessions={sessions} presence={data.presence} lang={lang} currency={currency} brlRate={brlRate} />
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
        <Section title={<><WorkflowIcon size={14} /> Dynamic Workflows</>}>
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

interface MemberAgg {
  user: string
  sessions: number; messages: number; toolCalls: number
  cost: number; inTok: number; outTok: number; cacheRead: number; cacheWrite: number
  commits: number; linesAdded: number; linesRemoved: number; files: number
  agents: number; durationMin: number; interruptions: number; errors: number
  models: Set<string>; firstActive: string; lastActive: string
  byDay: Record<string, number>; byHour: Record<number, number>
}

/** Cost of a single session — calcCost with its model (Sonnet fallback via '' when unknown). */
function sessCost(s: SessionMeta): number {
  return calcCost({
    inputTokens: s.input_tokens ?? 0, outputTokens: s.output_tokens ?? 0,
    cacheReadInputTokens: s.cache_read_input_tokens ?? 0, cacheCreationInputTokens: s.cache_creation_input_tokens ?? 0,
    webSearchRequests: 0, costUSD: 0,
  }, s.model ?? '')
}

function MembersTable({ sessions, presence, lang, currency, brlRate }: {
  sessions: SessionMeta[]
  presence?: Record<string, MemberPresence>
  lang: 'pt' | 'en'; currency: 'USD' | 'BRL'; brlRate: number
}) {
  const pt = lang === 'pt'
  const [openUser, setOpenUser] = useState<string | null>(null)

  const rows = useMemo(() => {
    const byUser: Record<string, MemberAgg> = {}
    for (const s of sessions) {
      const u = s.user || 'local'
      let m = byUser[u]
      if (!m) {
        m = byUser[u] = {
          user: u, sessions: 0, messages: 0, toolCalls: 0, cost: 0, inTok: 0, outTok: 0,
          cacheRead: 0, cacheWrite: 0, commits: 0, linesAdded: 0, linesRemoved: 0, files: 0,
          agents: 0, durationMin: 0, interruptions: 0, errors: 0,
          models: new Set(), firstActive: '', lastActive: '', byDay: {}, byHour: {},
        }
      }
      m.sessions++
      m.messages += (s.user_message_count ?? 0) + (s.assistant_message_count ?? 0)
      m.toolCalls += Object.values(s.tool_counts ?? {}).reduce((a, b) => a + b, 0)
      m.cost += sessCost(s)
      m.inTok += s.input_tokens ?? 0
      m.outTok += s.output_tokens ?? 0
      m.cacheRead += s.cache_read_input_tokens ?? 0
      m.cacheWrite += s.cache_creation_input_tokens ?? 0
      m.commits += s.git_commits ?? 0
      m.linesAdded += s.lines_added ?? 0
      m.linesRemoved += s.lines_removed ?? 0
      m.files += s.files_modified ?? 0
      m.agents += s.agentMetrics?.totalInvocations ?? 0
      m.durationMin += s.duration_minutes ?? 0
      m.interruptions += s.user_interruptions ?? 0
      m.errors += s.tool_errors ?? 0
      if (s.model) m.models.add(s.model)
      if (s.start_time) {
        if (!m.firstActive || s.start_time < m.firstActive) m.firstActive = s.start_time
        if (!m.lastActive || s.start_time > m.lastActive) m.lastActive = s.start_time
        m.byDay[s.start_time.slice(0, 10)] = (m.byDay[s.start_time.slice(0, 10)] ?? 0) + 1
      }
      for (const h of s.message_hours ?? []) m.byHour[h] = (m.byHour[h] ?? 0) + 1
    }
    return Object.values(byUser).sort((a, b) => b.cost - a.cost || b.inTok + b.outTok - (a.inTok + a.outTok))
  }, [sessions])

  if (rows.length === 0) return <div style={{ color: 'var(--text-tertiary)', fontSize: 13, padding: 16 }}>—</div>

  const totalCost = rows.reduce((a, r) => a + r.cost, 0)
  const maxCost = Math.max(...rows.map(r => r.cost), 1e-9)
  const fc = (usd: number) => fmtCost(usd, currency, brlRate)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {/* Descriptive intro — what this ranking means */}
      <div style={{ fontSize: 12, color: 'var(--text-tertiary)', lineHeight: 1.6, marginBottom: 2 }}>
        {pt
          ? <>Ranking dos membros por <strong style={{ color: 'var(--text-secondary)' }}>custo estimado</strong> neste repositório (respeitando os filtros ativos). Clique num membro para ver todas as métricas core — tokens, cache, commits, agentes e atividade.</>
          : <>Members ranked by <strong style={{ color: 'var(--text-secondary)' }}>estimated cost</strong> in this repository (honoring active filters). Click a member to see every core metric — tokens, cache, commits, agents, and activity.</>}
      </div>

      {rows.map((m, i) => {
        const open = openUser === m.user
        const online = presence?.[m.user]?.online
        const share = totalCost > 0 ? (m.cost / totalCost) * 100 : 0
        return (
          <div key={m.user} style={{ background: 'var(--bg-elevated)', borderRadius: 10, border: `1px solid ${open ? 'var(--anthropic-orange)55' : 'var(--border-subtle)'}`, overflow: 'hidden', transition: 'border-color 0.15s' }}>
            {/* Row header (click to expand) */}
            <div
              onClick={() => setOpenUser(open ? null : m.user)}
              style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '11px 13px', cursor: 'pointer' }}
            >
              <span style={{ fontSize: 12, fontWeight: 800, color: i === 0 ? 'var(--anthropic-orange)' : 'var(--text-tertiary)', width: 22, flexShrink: 0 }}>#{i + 1}</span>
              {/* Avatar initial + presence dot */}
              <div style={{ position: 'relative', flexShrink: 0 }}>
                <div style={{ width: 30, height: 30, borderRadius: '50%', background: 'var(--bg-card)', border: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase' }}>{m.user.slice(0, 2)}</div>
                {presence && m.user !== 'local' && (
                  <span style={{ position: 'absolute', right: -1, bottom: -1, width: 9, height: 9, borderRadius: '50%', background: online ? '#22c55e' : 'var(--text-tertiary)', border: '2px solid var(--bg-elevated)' }} />
                )}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13.5, fontWeight: 700, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.user}</div>
                {/* Cost-share bar */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
                  <div style={{ flex: 1, maxWidth: 200, height: 4, background: 'var(--bg-card)', borderRadius: 2, overflow: 'hidden' }}>
                    <div style={{ height: '100%', width: `${(m.cost / maxCost) * 100}%`, background: 'var(--anthropic-orange)', borderRadius: 2 }} />
                  </div>
                  <span style={{ fontSize: 10.5, color: 'var(--text-tertiary)' }}>{share.toFixed(0)}% {pt ? 'do custo' : 'of cost'}</span>
                </div>
              </div>
              {/* Compact headline metrics */}
              <div style={{ display: 'flex', gap: 16, alignItems: 'center', flexShrink: 0 }}>
                <Head label={pt ? 'sessões' : 'sessions'} value={String(m.sessions)} />
                <Head label="tokens" value={fmt(m.inTok + m.outTok)} />
                <Head label={pt ? 'custo' : 'cost'} value={fc(m.cost)} accent />
                <ChevronDown size={16} color="var(--text-tertiary)" style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s', flexShrink: 0 }} />
              </div>
            </div>

            {/* Expanded detail — every core metric, with a one-line explanation each */}
            <div style={{ display: 'grid', gridTemplateRows: open ? '1fr' : '0fr', transition: 'grid-template-rows 0.25s cubic-bezier(0.22,1,0.36,1)' }}>
              <div style={{ overflow: 'hidden', minHeight: 0 }}>
                <div style={{ padding: '4px 13px 14px', borderTop: '1px solid var(--border-subtle)' }}>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 8, marginTop: 12 }}>
                    <MetricCard icon={<DollarSign size={12} />} label={pt ? 'Custo estimado' : 'Estimated cost'} value={fc(m.cost)} hint={pt ? 'Gasto do membro neste repo (preço por modelo).' : "Member's spend in this repo (per-model pricing)."} accent />
                    <MetricCard icon={<Cpu size={12} />} label={pt ? 'Tokens (in / out)' : 'Tokens (in / out)'} value={`${fmt(m.inTok)} / ${fmt(m.outTok)}`} hint={pt ? 'Enviados ao modelo / gerados pelo modelo.' : 'Sent to / generated by the model.'} />
                    <MetricCard icon={<Database size={12} />} label={pt ? 'Cache lido' : 'Cache read'} value={fmt(m.cacheRead)} hint={pt ? 'Tokens servidos do cache — mais barato que input.' : 'Tokens served from cache — cheaper than input.'} />
                    <MetricCard icon={<Clock size={12} />} label={pt ? 'Sessões' : 'Sessions'} value={String(m.sessions)} hint={pt ? `${Math.round(m.durationMin)}m no total · ${fmtDuration((m.durationMin / Math.max(m.sessions, 1)) * 60000)} em média.` : `${Math.round(m.durationMin)}m total · ${fmtDuration((m.durationMin / Math.max(m.sessions, 1)) * 60000)} avg.`} />
                    <MetricCard icon={<MessageSquare size={12} />} label={pt ? 'Mensagens' : 'Messages'} value={fmt(m.messages)} hint={pt ? 'Turnos de conversa (usuário + assistente).' : 'Conversation turns (user + assistant).'} />
                    <MetricCard icon={<Wrench size={12} />} label={pt ? 'Chamadas de tools' : 'Tool calls'} value={fmt(m.toolCalls)} hint={pt ? 'Total de ferramentas executadas (Bash, Edit…).' : 'Total tools executed (Bash, Edit…).'} />
                    <MetricCard icon={<GitCommit size={12} />} label="Commits" value={String(m.commits)} hint={pt ? `+${fmt(m.linesAdded)} / −${fmt(m.linesRemoved)} linhas · ${m.files} arquivos.` : `+${fmt(m.linesAdded)} / −${fmt(m.linesRemoved)} lines · ${m.files} files.`} />
                    <MetricCard icon={<Bot size={12} />} label="Agents" value={String(m.agents)} hint={pt ? 'Subagentes disparados via Task/Agent.' : 'Subagents launched via Task/Agent.'} />
                    <MetricCard icon={<AlertTriangle size={12} />} label={pt ? 'Erros de tool' : 'Tool errors'} value={String(m.errors)} hint={pt ? `${m.interruptions} interrupções do usuário.` : `${m.interruptions} user interruptions.`} />
                  </div>

                  {/* Models used + active range */}
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, marginTop: 14, alignItems: 'center' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                      <span style={{ fontSize: 10.5, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{pt ? 'Modelos' : 'Models'}:</span>
                      {m.models.size === 0
                        ? <span style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>—</span>
                        : [...m.models].map(mod => (
                          <span key={mod} style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)', background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 5, padding: '2px 7px' }}>{formatModel(mod)}</span>
                        ))}
                    </div>
                    {m.firstActive && (
                      <span style={{ fontSize: 11.5, color: 'var(--text-tertiary)', display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                        <Clock size={11} /> {pt ? 'Ativo de' : 'Active'} {m.firstActive.slice(0, 10)} → {m.lastActive.slice(0, 10)}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}

function Head({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', minWidth: 46 }}>
      <span style={{ fontSize: 13, fontWeight: 700, color: accent ? 'var(--anthropic-orange)' : 'var(--text-primary)', whiteSpace: 'nowrap' }}>{value}</span>
      <span style={{ fontSize: 9, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{label}</span>
    </div>
  )
}

function MetricCard({ icon, label, value, hint, accent }: { icon: React.ReactNode; label: string; value: string; hint: string; accent?: boolean }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, padding: '10px 12px', background: 'var(--bg-card)', border: '1px solid var(--border-subtle)', borderRadius: 9 }}>
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 10, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
        <span style={{ color: accent ? 'var(--anthropic-orange)' : 'var(--text-tertiary)', display: 'flex' }}>{icon}</span>{label}
      </span>
      <span style={{ fontSize: 17, fontWeight: 700, color: accent ? 'var(--anthropic-orange)' : 'var(--text-primary)', whiteSpace: 'nowrap' }}>{value}</span>
      <span style={{ fontSize: 10.5, color: 'var(--text-tertiary)', lineHeight: 1.4 }}>{hint}</span>
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
