import { useMemo, useState } from 'react'
import { useOutletContext } from 'react-router-dom'
import { Trophy, Cpu, Boxes, FolderOpen, GitBranch, Users, Monitor } from 'lucide-react'
import { fmt, fmtCost, formatProjectName, repoShortName } from '@agentistics/core'
import type { AppContext } from '../lib/app-context'
import { Section } from '../components/Section'
import { HARNESS_COLORS, HARNESS_LABELS } from '../lib/harness'
import { useIsMobile } from '../hooks/useIsMobile'
import { rankTop, shareOf, type TopDimension, type TopMetric, type TopEntry } from '../lib/topUsage'
import type { HarnessId } from '@agentistics/core'

const METRICS: Array<{ id: TopMetric; en: string; pt: string }> = [
  { id: 'cost', en: 'Cost', pt: 'Custo' },
  { id: 'tokens', en: 'Tokens', pt: 'Tokens' },
  { id: 'sessions', en: 'Sessions', pt: 'Sessões' },
]

/** Podium colours: gold, silver, bronze. Rank is the point of the page, so it is carried by the
 *  medal rather than only by list position. */
const MEDALS = ['#eab308', '#94a3b8', '#b45309']

export default function TopUsagePage() {
  const { derived, lang, currency, brlRate, isCentral, machines } = useOutletContext<AppContext>()
  const pt = lang === 'pt'
  const isMobile = useIsMobile()
  const [metric, setMetric] = useState<TopMetric>('cost')

  const sessions = derived.filteredSessions

  /** Machine and person only exist where there is more than one of each. On a solo machine they
   *  would be a podium of one, which says nothing. */
  const dimensions = useMemo(() => {
    const base: Array<{ id: TopDimension; en: string; pt: string; icon: typeof Cpu }> = [
      { id: 'harness', en: 'Harness', pt: 'Harness', icon: Boxes },
      { id: 'model', en: 'Model', pt: 'Modelo', icon: Cpu },
      { id: 'project', en: 'Project', pt: 'Projeto', icon: FolderOpen },
      { id: 'repo', en: 'Repository', pt: 'Repositório', icon: GitBranch },
    ]
    if (isCentral) {
      base.push({ id: 'user', en: 'Person', pt: 'Pessoa', icon: Users })
      base.push({ id: 'machine', en: 'Machine', pt: 'Máquina', icon: Monitor })
    }
    return base
  }, [isCentral])

  const machineName = useMemo(() => {
    const map = new Map((machines ?? []).map(m => [m.id, m.name]))
    return (id: string) => map.get(id) ?? id
  }, [machines])

  const labelFor = (dim: TopDimension, key: string): string => {
    switch (dim) {
      case 'harness': return HARNESS_LABELS[key as HarnessId] ?? key
      case 'project': return formatProjectName(key)
      case 'repo': return repoShortName(key)
      case 'machine': return machineName(key)
      default: return key
    }
  }

  const colourFor = (dim: TopDimension, key: string): string | null =>
    dim === 'harness' ? (HARNESS_COLORS[key as HarnessId] ?? null) : null

  const valueLabel = (e: TopEntry): string =>
    metric === 'cost' ? fmtCost(e.cost, currency, brlRate)
    : metric === 'tokens' ? `${fmt(e.tokens)} tok`
    : `${fmt(e.sessions)} ${e.sessions === 1 ? (pt ? 'sessão' : 'session') : (pt ? 'sessões' : 'sessions')}`

  return (
    <>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 4 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 18, fontWeight: 700, color: 'var(--text-primary)' }}>
          <span style={{ color: 'var(--anthropic-orange)' }}><Trophy size={16} /></span>
          {pt ? 'Top de uso' : 'Top usage'}
        </div>
        <div style={{ fontSize: 12, color: 'var(--text-tertiary)', lineHeight: 1.5 }}>
          {pt
            ? 'O pódio de cada dimensão, respeitando os filtros do topo da página. Trocar a métrica normalmente troca o vencedor — é justamente isso que ela mostra.'
            : "Each dimension's podium, honouring the filters at the top of the page. Changing the metric usually changes the winner — that is the point of offering the choice."}
        </div>
      </div>

      {/* Metric picker. Cost, tokens and sessions rank the same data differently: one heavy session
          can outspend fifty light ones, so "most used" has no single honest definition. */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', margin: '4px 0 2px' }}>
        <span style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>{pt ? 'Ordenar por' : 'Rank by'}</span>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {METRICS.map(m => (
            <button
              key={m.id}
              onClick={() => setMetric(m.id)}
              style={{
                padding: isMobile ? '0 12px' : '5px 11px',
                minHeight: isMobile ? 44 : undefined,
                borderRadius: 999, cursor: 'pointer', fontFamily: 'inherit', fontSize: 12,
                border: `1px solid ${metric === m.id ? 'var(--anthropic-orange)' : 'var(--border)'}`,
                background: metric === m.id ? 'var(--anthropic-orange-dim)' : 'var(--bg-elevated)',
                color: metric === m.id ? 'var(--anthropic-orange)' : 'var(--text-secondary)',
                fontWeight: metric === m.id ? 600 : 400,
              }}>{pt ? m.pt : m.en}</button>
          ))}
        </div>
      </div>

      <div className="ag-grid cols-2">
        {dimensions.map(dim => {
          const result = rankTop(sessions, dim.id, metric)
          const Icon = dim.icon
          return (
            <Section key={dim.id} title={<><Icon size={14} /> {pt ? dim.pt : dim.en}</>}>
              {result.entries.length === 0 ? (
                <div style={{ fontSize: 12.5, color: 'var(--text-tertiary)' }}>
                  {pt ? 'Nada registrado nesta dimensão.' : 'Nothing recorded in this dimension.'}
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {result.entries.map((e, i) => {
                    const share = shareOf(e, result, metric)
                    const accent = colourFor(dim.id, e.key) ?? MEDALS[i] ?? 'var(--text-tertiary)'
                    return (
                      <div key={e.key}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                          <span style={{
                            flexShrink: 0, width: 20, height: 20, borderRadius: '50%',
                            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                            fontSize: 11, fontWeight: 700, color: '#fff',
                            background: MEDALS[i] ?? 'var(--text-tertiary)',
                          }}>{i + 1}</span>
                          <span title={e.key} style={{
                            flex: 1, minWidth: 0, fontSize: 13, color: 'var(--text-primary)',
                            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                          }}>{labelFor(dim.id, e.key)}</span>
                          <span style={{ flexShrink: 0, fontSize: 12.5, fontWeight: 600, color: 'var(--text-primary)' }}>
                            {valueLabel(e)}
                          </span>
                        </div>
                        {/* The bar is share of the WHOLE dimension, not of first place — otherwise
                            the leader is always full and the reader learns nothing about spread. */}
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4, paddingLeft: 28 }}>
                          <div style={{ flex: 1, height: 4, borderRadius: 999, background: 'var(--bg-elevated)', overflow: 'hidden' }}>
                            <div style={{ width: `${Math.round(share * 100)}%`, height: '100%', background: accent, borderRadius: 999 }} />
                          </div>
                          <span style={{ flexShrink: 0, fontSize: 10.5, color: 'var(--text-tertiary)', minWidth: 32, textAlign: 'right' }}>
                            {(share * 100).toFixed(share < 0.1 ? 1 : 0)}%
                          </span>
                        </div>
                      </div>
                    )
                  })}
                  {result.distinct > result.entries.length && (
                    <div style={{ fontSize: 11, color: 'var(--text-tertiary)', paddingTop: 2 }}>
                      {pt
                        ? `+${result.distinct - result.entries.length} fora do pódio`
                        : `+${result.distinct - result.entries.length} outside the podium`}
                    </div>
                  )}
                </div>
              )}
            </Section>
          )
        })}
      </div>
    </>
  )
}
