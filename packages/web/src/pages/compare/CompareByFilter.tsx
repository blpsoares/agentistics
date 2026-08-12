import React, { useMemo, useState } from 'react'
import { ArrowRight } from 'lucide-react'
import { fmt, fmtCost, planAllocation, type Filters } from '@agentistics/core'
import type { AppContext } from '../../lib/app-context'
import { useDerivedStats } from '../../hooks/useData'
import { computePlanBasisView } from '../../hooks/usePlanBasis'
import { buildCompareRows, type CompareRow, type CompareSide } from '../../lib/compareMetrics'
import { formatMultiple } from '../../lib/costBasis'
import { FiltersBar } from '../../components/FiltersBar'
import { useIsMobile } from '../../hooks/useIsMobile'

/**
 * Two independent filter sets, side by side, with a curated A / B / Δ table.
 *
 * `useDerivedStats` is a single `useMemo` that reads every dimension off its ARGUMENT and touches
 * no context — so calling it twice at the top level of one component is legal and already
 * precedented (RepoDetailPage scopes a second call the same way). Both `Filters` objects are
 * memoized and both calls receive `ctx.tags`, the stable array: the `tags = []` default would
 * hand each call a fresh identity and recompute the whole dashboard on every keystroke.
 */
export function CompareByFilter({ ctx }: { ctx: AppContext }) {
  const pt = ctx.lang === 'pt'
  const isMobile = useIsMobile()

  // A starts as whatever the user was already looking at; B starts unfiltered. Starting both
  // identical would show a table of zeros and teach nothing about what the page does.
  const [filtersA, setFiltersA] = useState<Filters>(() => ({ ...ctx.filters }))
  const [filtersB, setFiltersB] = useState<Filters>(() => ({
    dateRange: 'all', customStart: '', customEnd: '', projects: [], models: [],
  }))
  /** Mobile mounts ONE bar; this is which side it edits. Both sides stay visible either way. */
  const [editing, setEditing] = useState<'a' | 'b'>('a')

  const derivedA = useDerivedStats(ctx.data, filtersA, ctx.tags)
  const derivedB = useDerivedStats(ctx.data, filtersB, ctx.tags)

  const sideA = useSide(ctx, filtersA, derivedA)
  const sideB = useSide(ctx, filtersB, derivedB)

  const rows = useMemo(
    () => buildCompareRows(sideA, sideB, ctx.costBasis),
    [sideA, sideB, ctx.costBasis],
  )

  const barProps = {
    projects: ctx.data.projects ?? [],
    sessionCountByProject: ctx.sessionCountByProject,
    models: ctx.models,
    modelGroups: ctx.modelGroups,
    modelsInProject: ctx.modelsInProject,
    users: ctx.users,
    harnesses: ctx.harnesses,
    teams: ctx.teams,
    machines: ctx.machines,
    tags: ctx.tags,
    lang: ctx.lang,
    compact: true,
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {isMobile ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {/* One bar at 390px — two side by side is not a layout, it is a wish. The switch changes
              which side it EDITS; both sides' active filters stay listed below, so nothing the
              user set is ever hidden, only temporarily un-editable. */}
          <div style={{ display: 'flex', gap: 0, border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', overflow: 'hidden' }}>
            {(['a', 'b'] as const).map(sideKey => (
              <button
                key={sideKey}
                onClick={() => setEditing(sideKey)}
                style={{
                  flex: 1, minHeight: 44, border: 'none', fontFamily: 'inherit', fontSize: 13, fontWeight: 700,
                  background: editing === sideKey ? 'var(--anthropic-orange-dim)' : 'transparent',
                  color: editing === sideKey ? 'var(--anthropic-orange)' : 'var(--text-tertiary)',
                  cursor: 'pointer',
                }}
              >
                {sideKey.toUpperCase()}
              </button>
            ))}
          </div>
          <SideCard label={editing.toUpperCase()} accent>
            <FiltersBar
              {...barProps}
              filters={editing === 'a' ? filtersA : filtersB}
              onChange={editing === 'a' ? setFiltersA : setFiltersB}
            />
          </SideCard>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 12 }}>
          <SideCard label="A" accent>
            <FiltersBar {...barProps} filters={filtersA} onChange={setFiltersA} />
          </SideCard>
          <SideCard label="B">
            <FiltersBar {...barProps} filters={filtersB} onChange={setFiltersB} />
          </SideCard>
        </div>
      )}

      {isMobile
        ? <MetricCards rows={rows} ctx={ctx} />
        : <MetricTable rows={rows} ctx={ctx} />}

      <p style={{ fontSize: 11.5, color: 'var(--text-tertiary)', lineHeight: 1.55, margin: 0 }}>
        {pt
          ? 'Δ é B menos A. Um crescimento a partir de zero não tem porcentagem — aparece só como valor absoluto, porque uma porcentagem ali seria um denominador inventado.'
          : 'Δ is B minus A. Growth from zero has no percentage — only the absolute figure is shown, because a percentage there would be an invented denominator.'}
      </p>
    </div>
  )
}

/** One side's numbers, including its OWN plan basis — each filter has its own window, so the two
 *  sides cannot share the app-level one. */
function useSide(
  ctx: AppContext,
  filters: Filters,
  derived: ReturnType<typeof useDerivedStats>,
): CompareSide {
  return useMemo(() => {
    if (!derived) {
      return { costUSD: null, planCostUSD: null, planMultiple: null, effectiveCostPerMTokens: null, tokens: null, sessions: null, messages: null, cacheHitRate: null }
    }
    const view = computePlanBasisView({
      apiCostByDay: derived.apiCostByDay,
      billing: ctx.billing,
      brlRate: ctx.brlRate,
      filters,
    })
    const usable = view.basis?.coverage.computable ? view.basis : null
    return {
      costUSD: derived.totalCostUSD,
      planCostUSD: usable ? usable.planCostUSD : null,
      planMultiple: usable?.multiple ?? null,
      effectiveCostPerMTokens: usable?.effectiveCostPerMTokens ?? null,
      tokens: derived.inputTokens + derived.outputTokens,
      sessions: derived.totalSessions,
      messages: derived.totalMessages,
      cacheHitRate: derived.cacheHitRate,
    }
  }, [ctx.billing, ctx.brlRate, derived, filters])
}

function SideCard({ label, accent, children }: { label: string; accent?: boolean; children: React.ReactNode }) {
  return (
    <div style={{
      border: `1px solid ${accent ? 'var(--anthropic-orange)' : 'var(--border)'}`,
      borderRadius: 'var(--radius-lg)', background: 'var(--bg-card)', padding: '10px 12px 4px',
      position: 'relative',
    }}>
      <div style={{
        position: 'absolute', top: -9, left: 12, padding: '0 6px', background: 'var(--bg-base)',
        fontSize: 10, fontWeight: 800, letterSpacing: '0.08em',
        color: accent ? 'var(--anthropic-orange)' : 'var(--text-tertiary)',
      }}>
        {label}
      </div>
      {children}
    </div>
  )
}

function formatValue(row: CompareRow, value: number | null, ctx: AppContext): string {
  if (value === null) return '—'
  switch (row.metric.format) {
    case 'cost': return fmtCost(value, ctx.currency, ctx.brlRate)
    case 'rate': return fmtCost(value, ctx.currency, ctx.brlRate)
    case 'percent': return `${Math.round(value * 100)}%`
    case 'multiple': return formatMultiple(value, ctx.lang === 'pt' ? 'pt' : 'en') ?? '—'
    case 'tokens':
    case 'count':
    default: return fmt(Math.round(value))
  }
}

const TONE_COLOR: Record<string, string> = {
  good: 'var(--accent-green)',
  bad: '#ef4444',
  flat: 'var(--text-tertiary)',
  na: 'var(--text-tertiary)',
}

function DeltaCell({ row, ctx }: { row: CompareRow; ctx: AppContext }) {
  if (row.delta === null) return <span style={{ color: 'var(--text-tertiary)' }}>—</span>
  const sign = row.delta > 0 ? '+' : ''
  const pct = row.deltaPct === null ? null : `${sign}${Math.round(row.deltaPct * 100)}%`
  return (
    <span style={{ color: TONE_COLOR[row.tone], fontWeight: 600, whiteSpace: 'nowrap' }}>
      {sign}{formatValue(row, Math.abs(row.delta) === row.delta ? row.delta : row.delta, ctx).replace(/^-/, '−')}
      {pct && <span style={{ fontWeight: 500, opacity: 0.8 }}> ({pct})</span>}
    </span>
  )
}

function MetricTable({ rows, ctx }: { rows: CompareRow[]; ctx: AppContext }) {
  const pt = ctx.lang === 'pt'
  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
        <thead>
          <tr style={{ background: 'var(--bg-hover)' }}>
            <th style={{ ...TH, textAlign: 'left' }}>{pt ? 'Métrica' : 'Metric'}</th>
            <th style={TH}>A</th>
            <th style={TH}>B</th>
            <th style={TH}>Δ</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(row => (
            <tr key={row.metric.key} style={{ borderTop: '1px solid var(--border)' }}>
              <td style={{ ...TD, textAlign: 'left', color: 'var(--text-primary)' }}>
                {pt ? row.metric.labelPt : row.metric.labelEn}
                {row.basis === 'plan' && <BasisTag pt={pt} />}
              </td>
              <td style={TD}>{formatValue(row, row.a, ctx)}</td>
              <td style={TD}>{formatValue(row, row.b, ctx)}</td>
              <td style={TD}><DeltaCell row={row} ctx={ctx} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/** At 390px the table becomes a stack of cards — three labelled lines each. A four-column table
 *  there would scroll the page body sideways, which the repo's layout rule forbids outright. */
function MetricCards({ rows, ctx }: { rows: CompareRow[]; ctx: AppContext }) {
  const pt = ctx.lang === 'pt'
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {rows.map(row => (
        <div key={row.metric.key} style={{
          border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)',
          background: 'var(--bg-card)', padding: '11px 13px',
        }}>
          <div style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 7 }}>
            {pt ? row.metric.labelPt : row.metric.labelEn}
            {row.basis === 'plan' && <BasisTag pt={pt} />}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '4px 10px', fontSize: 13 }}>
            <span style={LBL}>A</span><span style={{ color: 'var(--text-secondary)' }}>{formatValue(row, row.a, ctx)}</span>
            <span style={LBL}>B</span><span style={{ color: 'var(--text-secondary)' }}>{formatValue(row, row.b, ctx)}</span>
            <span style={LBL}>Δ</span><span><DeltaCell row={row} ctx={ctx} /></span>
          </div>
        </div>
      ))}
    </div>
  )
}

function BasisTag({ pt }: { pt: boolean }) {
  return (
    <span style={{
      marginLeft: 7, fontSize: 9.5, fontWeight: 700, letterSpacing: '0.04em',
      color: 'var(--anthropic-orange)', border: '1px solid var(--anthropic-orange)',
      padding: '1px 5px', borderRadius: 8, verticalAlign: 1,
    }}>
      {pt ? 'PLANO' : 'PLAN'}
    </span>
  )
}

const TH: React.CSSProperties = { padding: '9px 12px', textAlign: 'right', fontSize: 11, fontWeight: 600, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: 0.3 }
const TD: React.CSSProperties = { padding: '9px 12px', textAlign: 'right', color: 'var(--text-secondary)' }
const LBL: React.CSSProperties = { fontSize: 10, fontWeight: 800, color: 'var(--text-tertiary)', letterSpacing: '0.06em' }
