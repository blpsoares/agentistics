import React from 'react'
import { GitBranch, Users, Zap, GitCommit, Clock, Link2Off } from 'lucide-react'
import { repoShortName, fmt, fmtCost } from '@agentistics/core'
import type { RepoStat } from '../hooks/useData'

interface Props {
  repos: RepoStat[]
  isCentral?: boolean
  currency?: 'USD' | 'BRL'
  brlRate?: number
  lang: 'pt' | 'en'
  onOpen: (repo: RepoStat) => void
}

/** Reserved route id for the "no linked repository" bucket (remote === ''). */
export const NO_REPO_ID = '__none__'

/** Colour a host chip by its provider so github / gitlab / bitbucket read at a glance. */
function hostColor(host: string): string {
  if (host.includes('github')) return '#8b95a5'
  if (host.includes('gitlab')) return '#fc6d26'
  if (host.includes('bitbucket')) return '#2684ff'
  return 'var(--text-tertiary)'
}

function relativeTime(iso: string, lang: 'pt' | 'en'): string {
  if (!iso) return '—'
  const then = new Date(iso).getTime()
  if (!Number.isFinite(then)) return '—'
  const diffMs = Date.now() - then
  const day = 86_400_000
  const days = Math.floor(diffMs / day)
  if (days <= 0) return lang === 'pt' ? 'hoje' : 'today'
  if (days === 1) return lang === 'pt' ? 'ontem' : 'yesterday'
  if (days < 30) return lang === 'pt' ? `há ${days}d` : `${days}d ago`
  const months = Math.floor(days / 30)
  if (months < 12) return lang === 'pt' ? `há ${months}mes` : `${months}mo ago`
  return lang === 'pt' ? `há ${Math.floor(months / 12)}a` : `${Math.floor(months / 12)}y ago`
}

/** Tiny inline SVG sparkline of activity-by-day, no external deps. */
function Sparkline({ byDay, color }: { byDay: Record<string, number>; color: string }) {
  const days = Object.keys(byDay).sort()
  if (days.length < 2) return <div style={{ height: 22 }} />
  const vals = days.map(d => byDay[d] ?? 0)
  const max = Math.max(...vals, 1)
  const W = 100, H = 22
  const step = W / (vals.length - 1)
  const pts = vals.map((v, i) => `${(i * step).toFixed(1)},${(H - (v / max) * (H - 2) - 1).toFixed(1)}`).join(' ')
  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ width: '100%', height: 22, display: 'block' }}>
      <polyline points={pts} fill="none" stroke={color} strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" opacity={0.85} />
    </svg>
  )
}

function Metric({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 1, minWidth: 0 }}>
      <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{value}</span>
      <span style={{ fontSize: 9.5, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{label}</span>
    </div>
  )
}

export function RepositoriesList({ repos, isCentral, currency = 'USD', brlRate = 1, lang, onOpen }: Props) {
  const pt = lang === 'pt'
  if (repos.length === 0) {
    return (
      <div style={{ color: 'var(--text-tertiary)', fontSize: 13, textAlign: 'center', padding: 32 }}>
        {pt ? 'Nenhum repositório no período/filtros selecionados.' : 'No repositories for the selected period/filters.'}
      </div>
    )
  }
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 12 }}>
      {repos.map(r => {
        const host = r.linked ? r.remote.split('/')[0]! : ''
        const title = r.linked ? repoShortName(r.remote) : (pt ? 'Sem repositório vinculado' : 'No linked repository')
        const accent = r.linked ? 'var(--anthropic-orange)' : 'var(--text-tertiary)'
        return (
          <div
            key={r.remote || NO_REPO_ID}
            onClick={() => onOpen(r)}
            role="button"
            tabIndex={0}
            onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen(r) } }}
            style={{
              display: 'flex', flexDirection: 'column', gap: 10,
              padding: '14px 15px',
              background: 'var(--bg-card)',
              borderRadius: 'var(--radius-lg)',
              border: r.linked ? '1px solid var(--border)' : '1px dashed var(--border)',
              cursor: 'pointer', transition: 'border-color 0.15s, transform 0.1s',
              minWidth: 0,
            }}
            onMouseEnter={e => { (e.currentTarget as HTMLDivElement).style.borderColor = accent + '80' }}
            onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.borderColor = r.linked ? 'var(--border)' : 'var(--border)' }}
          >
            {/* Header: icon + title + host chip */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
              {r.linked
                ? <GitBranch size={15} color={accent} style={{ flexShrink: 0 }} />
                : <Link2Off size={15} color={accent} style={{ flexShrink: 0 }} />}
              <span title={r.linked ? r.remote : undefined} style={{
                fontSize: 13.5, fontWeight: 700, color: 'var(--text-primary)',
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0,
              }}>{title}</span>
              {host && (
                <span style={{
                  marginLeft: 'auto', flexShrink: 0, fontSize: 9.5, fontWeight: 600,
                  color: hostColor(host), background: 'var(--bg-elevated)',
                  padding: '2px 6px', borderRadius: 5, whiteSpace: 'nowrap',
                }}>{host}</span>
              )}
            </div>

            {/* Sparkline */}
            <Sparkline byDay={r.activityByDay} color={accent} />

            {/* Primary metrics */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
              <Metric label={pt ? 'sessões' : 'sessions'} value={r.sessions} />
              <Metric label={pt ? 'custo' : 'cost'} value={fmtCost(r.costUSD, currency, brlRate)} />
              <Metric label="tokens" value={fmt(r.inputTokens + r.outputTokens)} />
            </div>

            {/* Footer chips: commits, members (central), actions, last active */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', fontSize: 11, color: 'var(--text-tertiary)' }}>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }} title={pt ? 'commits' : 'commits'}>
                <GitCommit size={11} /> {r.gitCommits}
              </span>
              {isCentral && (
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }} title={pt ? 'membros' : 'members'}>
                  <Users size={11} /> {r.members.length}
                </span>
              )}
              {r.ciSessions > 0 && (
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, color: 'var(--accent-blue)' }} title="GitHub Actions">
                  <Zap size={11} /> {r.ciSessions}
                </span>
              )}
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, marginLeft: 'auto' }}>
                <Clock size={11} /> {relativeTime(r.lastActive, lang)}
              </span>
            </div>
          </div>
        )
      })}
    </div>
  )
}
