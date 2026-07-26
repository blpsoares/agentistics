import React, { useMemo, useState } from 'react'
import { useOutletContext } from 'react-router-dom'
import { Users, Search, Monitor, User as UserIcon, GitBranch, FolderOpen, Cpu, Terminal } from 'lucide-react'
import type { AppContext } from '../lib/app-context'
import { fmt, fmtCost, formatModel, repoShortName, type HarnessId } from '@agentistics/core'
import { aggregateMemberMetrics, LOCAL_KEY, type MemberGroupBy, type MemberMetrics } from '../lib/member-metrics'
import { HARNESS_LABELS, HARNESS_COLORS } from '../lib/harness'
import { Section } from '../components/Section'
import { SortControl } from '../components/SortControl'
import { useIsMobile } from '../hooks/useIsMobile'

type MemberSortKey = 'cost' | 'sessions' | 'tokens' | 'lastActive' | 'name'

/**
 * B7 — per-member / per-machine metrics.
 *
 * A pure client of `/api/data` (`derived.filteredSessions`): the central already scopes that
 * payload to the signed-in principal, so a team-scoped user only ever sees their own members —
 * this page adds no endpoint and bypasses no scoping.
 */
export default function MembersPage() {
  const ctx = useOutletContext<AppContext>()
  const { derived, currency, brlRate, lang, machines } = ctx
  const pt = lang === 'pt'
  const isMobile = useIsMobile()

  const [groupBy, setGroupBy] = useState<MemberGroupBy>('machine')
  const [query, setQuery] = useState('')
  const [sortKey, setSortKey] = useState<MemberSortKey>('cost')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')

  const rows = useMemo(
    () => aggregateMemberMetrics(derived.filteredSessions, groupBy),
    [derived.filteredSessions, groupBy],
  )

  /** memberId → machine display name (the central names machines on the minted token). */
  const machineName = useMemo(() => {
    const m: Record<string, string> = {}
    for (const mc of machines) m[mc.id] = mc.name
    return m
  }, [machines])

  const titleOf = (r: MemberMetrics): string => {
    if (groupBy === 'machine') {
      if (r.key === LOCAL_KEY) return pt ? 'Esta máquina' : 'This machine'
      return machineName[r.key] || r.user || `${r.key.slice(0, 10)}…`
    }
    return r.key === LOCAL_KEY ? (pt ? 'Local' : 'Local') : r.key
  }

  const subtitleOf = (r: MemberMetrics): string => {
    if (groupBy === 'machine') return r.user || (pt ? 'sem usuário' : 'no user')
    const n = r.machineCount
    if (n === 0) return pt ? 'sem máquina' : 'no machine'
    return pt ? `${n} máquina${n === 1 ? '' : 's'}` : `${n} machine${n === 1 ? '' : 's'}`
  }

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return rows
    return rows.filter(r => `${titleOf(r)} ${r.user} ${r.topProject?.key ?? ''} ${r.topModel?.key ?? ''}`.toLowerCase().includes(q))
    // `titleOf` is re-created every render; its real inputs (machineName/groupBy/pt) are the deps.
  }, [rows, query, machineName, groupBy, pt])

  const sorted = useMemo(() => {
    const val = (r: MemberMetrics): number | string => {
      switch (sortKey) {
        case 'cost': return r.costUSD
        case 'sessions': return r.sessions
        case 'tokens': return r.totalTokens
        case 'lastActive': return r.lastActivity ? Date.parse(r.lastActivity) || 0 : 0
        case 'name': return titleOf(r).toLowerCase()
      }
    }
    const s = [...filtered].sort((a, b) => {
      const va = val(a), vb = val(b)
      if (typeof va === 'string' && typeof vb === 'string') return va.localeCompare(vb)
      return (va as number) - (vb as number)
    })
    return sortDir === 'desc' ? s.reverse() : s
    // Same as above: the 'name' sort reads `titleOf`, whose inputs are machineName/groupBy/pt.
  }, [filtered, sortKey, sortDir, machineName, groupBy, pt])

  const sortOptions: { key: MemberSortKey; label: string }[] = [
    { key: 'cost', label: pt ? 'Custo' : 'Cost' },
    { key: 'sessions', label: pt ? 'Sessões' : 'Sessions' },
    { key: 'tokens', label: 'Tokens' },
    { key: 'lastActive', label: pt ? 'Última atividade' : 'Last active' },
    { key: 'name', label: pt ? 'Nome' : 'Name' },
  ]

  const totalCost = rows.reduce((a, r) => a + r.costUSD, 0)
  const totalSessions = rows.reduce((a, r) => a + r.sessions, 0)
  const totalTokens = rows.reduce((a, r) => a + r.totalTokens, 0)
  const maxCost = Math.max(...rows.map(r => r.costUSD), 1e-9)

  const fmtDate = (iso: string | null): string => {
    if (!iso) return '—'
    const t = Date.parse(iso)
    if (!Number.isFinite(t)) return '—'
    return new Date(t).toLocaleDateString(pt ? 'pt-BR' : 'en-US', { day: '2-digit', month: 'short', year: '2-digit' })
  }

  const toggleBtn = (active: boolean): React.CSSProperties => ({
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 5,
    minHeight: 44, padding: '0 12px', flex: isMobile ? 1 : undefined,
    fontSize: 12, fontWeight: 600, fontFamily: 'inherit', cursor: 'pointer', borderRadius: 8,
    border: active ? '1px solid rgba(217,119,6,0.5)' : '1px solid var(--border)',
    background: active ? 'var(--anthropic-orange-dim)' : 'var(--bg-elevated)',
    color: active ? 'var(--anthropic-orange)' : 'var(--text-secondary)',
  })

  return (
    <>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 4 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 18, fontWeight: 700, color: 'var(--text-primary)' }}>
          <span style={{ color: 'var(--anthropic-orange)' }}><Users size={16} /></span>
          {pt ? 'Membros' : 'Members'}
        </div>
        <div style={{ fontSize: 12, color: 'var(--text-tertiary)', lineHeight: 1.5 }}>
          {pt
            ? 'Perfil de uso por membro e por máquina: onde mais trabalhou (repositório ou pasta, o que tiver mais sessões), modelo e harness mais usados, além de sessões, tokens e custo. Respeita os filtros ativos.'
            : 'Usage profile per member and per machine: where they worked the most (repository or folder, whichever has more sessions), most used model and harness, plus sessions, tokens and cost. Honors active filters.'}
        </div>
      </div>

      {/* Totals — same KPI grid utility used across the app */}
      <div className="ag-grid cols-4">
        <Kpi label={groupBy === 'machine' ? (pt ? 'Máquinas' : 'Machines') : (pt ? 'Membros' : 'Members')} value={String(rows.length)} />
        <Kpi label={pt ? 'Sessões' : 'Sessions'} value={fmt(totalSessions)} />
        <Kpi label="Tokens" value={fmt(totalTokens)} />
        <Kpi label={pt ? 'Custo' : 'Cost'} value={fmtCost(totalCost, currency, brlRate)} accent />
      </div>

      <Section
        flashId="members"
        title={<><Users size={14} /> {groupBy === 'machine'
          ? (pt ? `${sorted.length} máquina${sorted.length === 1 ? '' : 's'}` : `${sorted.length} machine${sorted.length === 1 ? '' : 's'}`)
          : (pt ? `${sorted.length} membro${sorted.length === 1 ? '' : 's'}` : `${sorted.length} member${sorted.length === 1 ? '' : 's'}`)}</>}
        action={
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            {rows.length > 1 && (
              <SortControl lang={lang} options={sortOptions} sortKey={sortKey} dir={sortDir}
                onKey={setSortKey} onDir={() => setSortDir(d => (d === 'desc' ? 'asc' : 'desc'))} />
            )}
            <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
              <Search size={13} color="var(--text-tertiary)" style={{ position: 'absolute', left: 8, pointerEvents: 'none' }} />
              <input
                value={query}
                onChange={e => setQuery(e.target.value)}
                placeholder={pt ? 'Buscar…' : 'Search…'}
                style={{
                  fontSize: 12, fontFamily: 'inherit', color: 'var(--text-primary)',
                  background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 7,
                  padding: '5px 8px 5px 26px', width: isMobile ? 120 : 140, outline: 'none', minHeight: 34,
                }}
              />
            </div>
          </div>
        }
      >
        {/* Grouping toggle — one row per machine, or machines folded into their owner */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
          <button onClick={() => setGroupBy('machine')} style={toggleBtn(groupBy === 'machine')}>
            <Monitor size={13} /> {pt ? 'Por máquina' : 'By machine'}
          </button>
          <button onClick={() => setGroupBy('user')} style={toggleBtn(groupBy === 'user')}>
            <UserIcon size={13} /> {pt ? 'Por membro' : 'By member'}
          </button>
        </div>

        {sorted.length === 0 ? (
          <div style={{ color: 'var(--text-tertiary)', fontSize: 13, padding: 24, textAlign: 'center', lineHeight: 1.6 }}>
            {pt
              ? 'Nenhuma sessão para os filtros atuais. Conecte máquinas à central (agentop member connect) para ver métricas por membro.'
              : 'No sessions for the current filters. Connect machines to the central (agentop member connect) to see per-member metrics.'}
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {sorted.map((r, i) => (
              <MemberCard
                key={r.key}
                rank={i + 1}
                row={r}
                title={titleOf(r)}
                subtitle={subtitleOf(r)}
                share={maxCost > 0 ? (r.costUSD / maxCost) * 100 : 0}
                pt={pt}
                isMobile={isMobile}
                currency={currency}
                brlRate={brlRate}
                fmtDate={fmtDate}
              />
            ))}
          </div>
        )}
      </Section>
    </>
  )
}

function Kpi({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div style={{
      background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)',
      padding: '14px 16px', minWidth: 0, boxSizing: 'border-box',
    }}>
      <div style={{ fontSize: 10.5, fontWeight: 600, letterSpacing: '0.05em', textTransform: 'uppercase', color: 'var(--text-tertiary)' }}>{label}</div>
      <div style={{
        marginTop: 6, fontSize: 19, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        color: accent ? 'var(--anthropic-orange)' : 'var(--text-primary)',
      }}>{value}</div>
    </div>
  )
}

function MemberCard({ rank, row, title, subtitle, share, pt, isMobile, currency, brlRate, fmtDate }: {
  rank: number
  row: MemberMetrics
  title: string
  subtitle: string
  share: number
  pt: boolean
  isMobile: boolean
  currency: 'USD' | 'BRL'
  brlRate: number
  fmtDate: (iso: string | null) => string
}) {
  const harness = row.topHarness?.key
  const harnessColor = harness ? (HARNESS_COLORS[harness as HarnessId] ?? 'var(--text-tertiary)') : 'var(--text-tertiary)'
  const projectLabel = row.topProject
    ? (row.topProject.kind === 'repo' ? repoShortName(row.topProject.key) : shortPath(row.topProject.key))
    : '—'

  return (
    <div style={{ background: 'var(--bg-elevated)', borderRadius: 10, border: '1px solid var(--border-subtle)', padding: isMobile ? '11px 12px' : '12px 14px', minWidth: 0 }}>
      {/* Identity row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
        <span style={{ fontSize: 12, fontWeight: 800, color: rank === 1 ? 'var(--anthropic-orange)' : 'var(--text-tertiary)', width: 22, flexShrink: 0 }}>#{rank}</span>
        <span style={{
          width: 30, height: 30, borderRadius: '50%', background: 'var(--bg-card)', border: '1px solid var(--border)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 700,
          color: 'var(--text-secondary)', textTransform: 'uppercase', flexShrink: 0,
        }}>{title.slice(0, 2)}</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13.5, fontWeight: 700, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{title}</div>
          <div style={{ fontSize: 11, color: 'var(--text-tertiary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{subtitle}</div>
        </div>
        <span style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--anthropic-orange)', flexShrink: 0, textAlign: 'right' }}>
          {fmtCost(row.costUSD, currency, brlRate)}
        </span>
      </div>

      {/* Cost share bar */}
      <div style={{ height: 4, background: 'var(--bg-card)', borderRadius: 2, overflow: 'hidden', margin: '8px 0 10px' }}>
        <div style={{ height: '100%', width: `${Math.min(100, share)}%`, background: 'var(--anthropic-orange)', borderRadius: 2 }} />
      </div>

      {/* Profile — the "what do they actually use" half */}
      <div className="ag-grid cols-3" style={{ gap: 8, marginBottom: 8 }}>
        <Fact
          icon={row.topProject?.kind === 'repo' ? <GitBranch size={11} /> : <FolderOpen size={11} />}
          label={row.topProject
            ? (row.topProject.kind === 'repo' ? (pt ? 'Repositório principal' : 'Top repository') : (pt ? 'Pasta principal' : 'Top folder'))
            : (pt ? 'Projeto principal' : 'Top project')}
          value={projectLabel}
          hint={row.topProject ? `${row.topProject.sessions} ${pt ? 'sessões' : 'sessions'}` : undefined}
          title={row.topProject?.key}
        />
        <Fact
          icon={<Cpu size={11} />}
          label={pt ? 'Modelo mais usado' : 'Most used model'}
          value={row.topModel ? formatModel(row.topModel.key) : (pt ? 'Sem dado' : 'No data')}
          hint={row.topModel ? `${row.topModel.sessions} ${pt ? 'sessões' : 'sessions'}` : undefined}
          title={row.topModel?.key}
          muted={!row.topModel}
        />
        <Fact
          icon={<Terminal size={11} />}
          label={pt ? 'Harness mais usado' : 'Most used harness'}
          value={harness ? (HARNESS_LABELS[harness as HarnessId] ?? harness) : (pt ? 'Sem dado' : 'No data')}
          hint={row.topHarness ? `${row.topHarness.sessions} ${pt ? 'sessões' : 'sessions'}` : undefined}
          color={harness ? harnessColor : undefined}
          muted={!harness}
        />
      </div>

      {/* Volume — the obvious counters */}
      <div className="ag-grid cols-5" style={{ gap: 8 }}>
        <Fact label={pt ? 'Sessões' : 'Sessions'} value={fmt(row.sessions)} />
        <Fact label="Tokens" value={fmt(row.totalTokens)} hint={`${fmt(row.inputTokens)} in · ${fmt(row.outputTokens)} out`} />
        <Fact label="Cache" value={fmt(row.cacheReadTokens + row.cacheWriteTokens)} hint={`${fmt(row.cacheReadTokens)} r · ${fmt(row.cacheWriteTokens)} w`} />
        <Fact label={pt ? 'Primeira' : 'First'} value={fmtDate(row.firstActivity)} />
        <Fact label={pt ? 'Última' : 'Last'} value={fmtDate(row.lastActivity)} />
      </div>
    </div>
  )
}

function Fact({ icon, label, value, hint, color, muted, title }: {
  icon?: React.ReactNode
  label: string
  value: string
  hint?: string
  color?: string
  muted?: boolean
  title?: string
}) {
  return (
    <div style={{ minWidth: 0, background: 'var(--bg-card)', border: '1px solid var(--border-subtle)', borderRadius: 8, padding: '7px 9px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 10, fontWeight: 600, letterSpacing: '0.03em', textTransform: 'uppercase', color: 'var(--text-tertiary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {icon}{label}
      </div>
      <div title={title} style={{
        marginTop: 3, fontSize: 12.5, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        color: muted ? 'var(--text-tertiary)' : (color ?? 'var(--text-primary)'),
      }}>{value}</div>
      {hint && (
        <div style={{ marginTop: 2, fontSize: 10.5, color: 'var(--text-tertiary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{hint}</div>
      )}
    </div>
  )
}

/** Last two path segments — a full project path never fits a card at 390px. */
function shortPath(p: string): string {
  const parts = p.split('/').filter(Boolean)
  return parts.length <= 2 ? p : `…/${parts.slice(-2).join('/')}`
}
