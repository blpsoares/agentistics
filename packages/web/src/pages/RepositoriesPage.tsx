import React, { useMemo, useState } from 'react'
import { useOutletContext, useNavigate } from 'react-router-dom'
import { GitBranch, Search, Zap, ArrowUp, ArrowDown } from 'lucide-react'
import type { AppContext } from '../lib/app-context'
import type { RepoStat, RepoSortKey } from '../hooks/useData'
import { sortRepos } from '../hooks/useData'
import { Section } from '../components/Section'
import { RepositoriesList } from '../components/RepositoriesList'

export default function RepositoriesPage() {
  const ctx = useOutletContext<AppContext>()
  const { derived, currency, brlRate, lang, isCentral } = ctx
  const navigate = useNavigate()
  const pt = lang === 'pt'
  const [query, setQuery] = useState('')
  const [sortKey, setSortKey] = useState<RepoSortKey>('cost')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')

  const repos = derived.repoStats
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return repos
    return repos.filter(r =>
      `${r.name} ${r.remote} ${r.path}`.toLowerCase().includes(q),
    )
  }, [repos, query])
  const sorted = useMemo(() => sortRepos(filtered, sortKey, sortDir), [filtered, sortKey, sortDir])

  const sortLabels: Record<RepoSortKey, string> = {
    cost: pt ? 'Custo' : 'Cost',
    sessions: pt ? 'Sessões' : 'Sessions',
    tokens: 'Tokens',
    commits: 'Commits',
    lastActive: pt ? 'Atividade' : 'Activity',
    name: pt ? 'Nome' : 'Name',
  }

  const linkedCount = repos.filter(r => r.linked).length
  const ciTotal = repos.reduce((a, r) => a + r.ciSessions, 0)

  const openRepo = (r: RepoStat) => {
    navigate(`/repo/${encodeURIComponent(r.id)}`)
  }

  return (
    <>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 4 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 18, fontWeight: 700, color: 'var(--text-primary)' }}>
          <span style={{ color: 'var(--anthropic-orange)' }}><GitBranch size={16} /></span>
          {pt ? 'Repositórios' : 'Repositories'}
        </div>
        <div style={{ fontSize: 12, color: 'var(--text-tertiary)', lineHeight: 1.5 }}>
          {pt
            ? 'Métricas agrupadas por remote do git — independente do caminho local ou da máquina. Clique num repositório para ver o detalhamento completo.'
            : 'Metrics grouped by git remote — regardless of local path or machine. Click a repository for the full breakdown.'}
        </div>
      </div>

      <Section
        flashId="repositories"
        title={<><GitBranch size={14} /> {pt ? `${linkedCount} repositório${linkedCount === 1 ? '' : 's'}` : `${linkedCount} repositor${linkedCount === 1 ? 'y' : 'ies'}`}</>}
        action={
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            {ciTotal > 0 && (
              <button
                onClick={() => navigate('/repositories/actions')}
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11.5, fontWeight: 600,
                  color: 'var(--accent-blue)', background: 'var(--bg-elevated)', border: '1px solid var(--border)',
                  borderRadius: 7, padding: '5px 9px', cursor: 'pointer', fontFamily: 'inherit',
                }}
                title="GitHub Actions"
              >
                <Zap size={12} /> Actions{ciTotal > 0 ? ` · ${ciTotal}` : ''}
              </button>
            )}
            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <span style={{ fontSize: 11, color: 'var(--text-tertiary)', marginRight: 2 }}>{pt ? 'Ordenar:' : 'Sort:'}</span>
              {(['cost', 'sessions', 'tokens', 'commits', 'lastActive', 'name'] as RepoSortKey[]).map(k => {
                const active = sortKey === k
                return (
                  <button
                    key={k}
                    onClick={() => setSortKey(k)}
                    style={{
                      padding: '4px 9px', borderRadius: 7, fontSize: 11, cursor: 'pointer', fontFamily: 'inherit',
                      border: '1px solid var(--border)',
                      background: active ? 'var(--anthropic-orange-dim, rgba(205,93,56,0.12))' : 'var(--bg-elevated)',
                      color: active ? 'var(--anthropic-orange, #cd5d38)' : 'var(--text-secondary)',
                      fontWeight: active ? 600 : 500,
                    }}
                  >{sortLabels[k]}</button>
                )
              })}
              <button
                onClick={() => setSortDir(d => (d === 'desc' ? 'asc' : 'desc'))}
                title={sortDir === 'desc' ? (pt ? 'Decrescente' : 'Descending') : (pt ? 'Crescente' : 'Ascending')}
                style={{
                  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                  width: 26, height: 26, borderRadius: 7, cursor: 'pointer', fontFamily: 'inherit',
                  border: '1px solid var(--border)', background: 'var(--bg-elevated)', color: 'var(--text-secondary)',
                }}
              >{sortDir === 'desc' ? <ArrowDown size={13} /> : <ArrowUp size={13} />}</button>
            </div>
            <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
              <Search size={13} color="var(--text-tertiary)" style={{ position: 'absolute', left: 8, pointerEvents: 'none' }} />
              <input
                value={query}
                onChange={e => setQuery(e.target.value)}
                placeholder={pt ? 'Buscar…' : 'Search…'}
                style={{
                  fontSize: 12, fontFamily: 'inherit', color: 'var(--text-primary)',
                  background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 7,
                  padding: '5px 8px 5px 26px', width: 130, outline: 'none',
                }}
              />
            </div>
          </div>
        }
      >
        <RepositoriesList
          repos={sorted}
          isCentral={isCentral}
          currency={currency}
          brlRate={brlRate}
          lang={lang}
          onOpen={openRepo}
        />
      </Section>
    </>
  )
}
