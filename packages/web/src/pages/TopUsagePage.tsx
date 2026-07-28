import { useMemo, useState } from 'react'
import { useOutletContext } from 'react-router-dom'
import { Trophy, Cpu, Boxes, FolderOpen, GitBranch, Users, Monitor } from 'lucide-react'
import { fmt, fmtCost, formatProjectName, repoShortName } from '@agentistics/core'
import type { AppContext } from '../lib/app-context'
import { Section } from '../components/Section'
import { HARNESS_COLORS, HARNESS_LABELS } from '../lib/harness'
import { useIsMobile } from '../hooks/useIsMobile'
import { rankTop, rankTopFromCaches, cacheTotalsUsable, shareOf, type TopDimension, type TopMetric, type TopEntry } from '../lib/topUsage'
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
  const { data, derived, filters, lang, currency, brlRate, isCentral, machines } = useOutletContext<AppContext>()
  const pt = lang === 'pt'
  const isMobile = useIsMobile()
  const [metric, setMetric] = useState<TopMetric>('cost')

  const sessions = derived.filteredSessions

  // Person and machine are ranked from the per-member/-machine statsCaches, not from the sessions:
  // the caches hold the full history, the session documents only what has not been pruned. Summing
  // sessions made this page disagree with the dashboard for the same selection (R$58k here against
  // R$93k on Home) — and the dashboard was the one telling the truth. Every other dimension has no
  // cache to read and stays on the per-session sum.
  const cacheRank = useMemo(() => {
    if (!cacheTotalsUsable(filters)) return null
    return (dim: TopDimension) => {
      if (dim === 'user' && data?.userStatsCaches)
        return rankTopFromCaches(data.userStatsCaches, sessions, s => s.user ?? '', metric)
      if (dim === 'machine' && data?.machineStatsCaches)
        return rankTopFromCaches(data.machineStatsCaches, sessions, s => s.memberId ?? '', metric)
      return null
    }
  }, [data?.userStatsCaches, data?.machineStatsCaches, filters, sessions, metric])

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
          const result = cacheRank?.(dim.id) ?? rankTop(sessions, dim.id, metric)
          const Icon = dim.icon
          const totalLabel =
            metric === 'cost' ? fmtCost(result.total, currency, brlRate)
            : metric === 'tokens' ? `${fmt(result.total)} tok`
            : `${fmt(result.total)}`
          return (
            <Section
              key={dim.id}
              title={<><Icon size={14} /> {pt ? dim.pt : dim.en}</>}
              action={
                <span style={{ fontSize: 11.5, color: 'var(--text-tertiary)', whiteSpace: 'nowrap' }}>
                  {result.distinct > 0 && <>{result.distinct} · </>}{totalLabel}
                </span>
              }
            >
              {result.entries.length === 0 ? (
                <div style={{ fontSize: 12.5, color: 'var(--text-tertiary)' }}>
                  {pt ? 'Nada registrado nesta dimensão.' : 'Nothing recorded in this dimension.'}
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {result.entries.map((e, i) => {
                    const share = shareOf(e, result, metric)
                    const accent = colourFor(dim.id, e.key) ?? MEDALS[i] ?? 'var(--text-tertiary)'
                    const lead = i === 0
                    return (
                      // The row IS the bar: the fill sits behind the text at the entry's share of
                      // the dimension. A separate track below each row said the same thing twice and
                      // doubled the vertical space, which is what made the first version cramped.
                      <div key={e.key} style={{ position: 'relative', borderRadius: 8, overflow: 'hidden' }}>
                        <div aria-hidden style={{
                          position: 'absolute', inset: 0, width: `${Math.max(share * 100, 1.5)}%`,
                          background: `color-mix(in srgb, ${accent} ${lead ? 20 : 12}%, transparent)`,
                          borderRadius: 8, transition: 'width 0.25s ease',
                        }} />
                        <div style={{
                          position: 'relative', display: 'flex', alignItems: 'center', gap: 9,
                          padding: lead ? '9px 10px' : '7px 10px', minWidth: 0,
                        }}>
                          {/* Rank reads as a numeral in the medal's colour rather than a filled
                              disc — three saturated circles per card was the loudest thing on the
                              page and the least informative. */}
                          <span style={{
                            flexShrink: 0, width: 14, textAlign: 'center',
                            fontSize: lead ? 13 : 11.5, fontWeight: 700,
                            color: MEDALS[i] ?? 'var(--text-tertiary)',
                            fontVariantNumeric: 'tabular-nums',
                          }}>{i + 1}</span>
                          <span title={e.key} style={{
                            flex: 1, minWidth: 0,
                            fontSize: lead ? 13.5 : 12.5,
                            fontWeight: lead ? 600 : 400,
                            color: lead ? 'var(--text-primary)' : 'var(--text-secondary)',
                            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                          }}>{labelFor(dim.id, e.key)}</span>
                          <span style={{
                            flexShrink: 0, fontSize: 10.5, color: 'var(--text-tertiary)',
                            fontVariantNumeric: 'tabular-nums', minWidth: 30, textAlign: 'right',
                          }}>{(share * 100).toFixed(share < 0.095 ? 1 : 0)}%</span>
                          <span style={{
                            flexShrink: 0,
                            fontSize: lead ? 13 : 12.5,
                            fontWeight: lead ? 700 : 600,
                            color: 'var(--text-primary)',
                            fontVariantNumeric: 'tabular-nums',
                          }}>{valueLabel(e)}</span>
                        </div>
                      </div>
                    )
                  })}
                  {result.distinct > result.entries.length && (
                    <div style={{ fontSize: 11, color: 'var(--text-tertiary)', padding: '2px 10px 0' }}>
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
