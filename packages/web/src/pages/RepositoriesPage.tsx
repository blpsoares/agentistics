import React, { useMemo, useState } from 'react'
import { useOutletContext, useNavigate } from 'react-router-dom'
import { GitBranch, Search, Zap } from 'lucide-react'
import type { AppContext } from '../lib/app-context'
import type { RepoStat, RepoSortKey } from '../hooks/useData'
import { sortRepos } from '../hooks/useData'
import { Section } from '../components/Section'
import { RepositoriesList } from '../components/RepositoriesList'
import { SortControl } from '../components/SortControl'

export default function RepositoriesPage() {
  const ctx = useOutletContext<AppContext>()
  const { derived, currency, brlRate, lang, isCentral } = ctx
  const navigate = useNavigate()
  const pt = lang === 'pt'
  const [query, setQuery] = useState('')
  const [sortKey, setSortKey] = useState<RepoSortKey>('cost')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')
  // Repositories are git remotes. Sessions without a remote can't be attributed to a repo (and
  // split the same repo's metrics across machines with different local paths), so hide them by
  // default; a toggle brings the "no repository" folder cards back.
  const [showUnlinked, setShowUnlinked] = useState(false)

  const repos = derived.repoStats
  const scoped = useMemo(() => (showUnlinked ? repos : repos.filter(r => r.linked)), [repos, showUnlinked])
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return scoped
    return scoped.filter(r =>
      `${r.name} ${r.remote} ${r.path}`.toLowerCase().includes(q),
    )
  }, [scoped, query])
  const sorted = useMemo(() => sortRepos(filtered, sortKey, sortDir), [filtered, sortKey, sortDir])

  const sortOptions: { key: RepoSortKey; label: string }[] = [
    { key: 'cost', label: pt ? 'Custo' : 'Cost' },
    { key: 'sessions', label: pt ? 'Sessões' : 'Sessions' },
    { key: 'tokens', label: 'Tokens' },
    { key: 'commits', label: 'Commits' },
    { key: 'lastActive', label: pt ? 'Data' : 'Date' },
    { key: 'name', label: pt ? 'Nome' : 'Name' },
    { key: 'linked', label: pt ? 'Com/sem repo' : 'Linked/unlinked' },
  ]

  const linkedCount = repos.filter(r => r.linked).length
  const unlinkedCount = repos.length - linkedCount
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
            ? 'Métricas agrupadas por remote do git — independente do caminho local ou da máquina, unificando o mesmo repo entre devs. Só repositórios com remote; habilite "sem repo" para ver sessões sem remote.'
            : 'Metrics grouped by git remote — regardless of local path or machine, unifying the same repo across devs. Only repos with a remote; enable "unlinked" to see remote-less sessions.'}
        </div>
      </div>

      <Section
        flashId="repositories"
        title={<><GitBranch size={14} /> {(() => { const n = sorted.length; return pt ? `${n} repositório${n === 1 ? '' : 's'}` : `${n} repositor${n === 1 ? 'y' : 'ies'}` })()}</>}
        action={
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            {unlinkedCount > 0 && (
              <button
                onClick={() => setShowUnlinked(v => !v)}
                title={pt ? 'Mostrar/ocultar sessões sem repositório (sem remote)' : 'Show/hide sessions without a repository (no remote)'}
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11.5, fontWeight: 600,
                  borderRadius: 7, padding: '5px 9px', cursor: 'pointer', fontFamily: 'inherit',
                  border: showUnlinked ? '1px solid rgba(217,119,6,0.5)' : '1px solid var(--border)',
                  background: showUnlinked ? 'var(--anthropic-orange-dim)' : 'var(--bg-elevated)',
                  color: showUnlinked ? 'var(--anthropic-orange)' : 'var(--text-secondary)',
                }}
              >
                <GitBranch size={12} /> {pt ? 'Sem repo' : 'Unlinked'} · {unlinkedCount}
              </button>
            )}
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
            <SortControl
              lang={lang}
              options={sortOptions}
              sortKey={sortKey}
              dir={sortDir}
              onKey={setSortKey}
              onDir={() => setSortDir(d => (d === 'desc' ? 'asc' : 'desc'))}
            />
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
