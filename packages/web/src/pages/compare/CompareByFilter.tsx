import React, { useMemo, useState } from 'react'
import { fmt, fmtCost, type Filters, type HarnessId } from '@agentistics/core'
import type { AppContext } from '../../lib/app-context'
import { useDerivedStats } from '../../hooks/useData'
import { computePlanBasisView } from '../../hooks/usePlanBasis'
import { buildCompareRows, describeFilters, type CompareRow, type CompareSide } from '../../lib/compareMetrics'
import { formatMultiple } from '../../lib/costBasis'
import { FiltersBar } from '../../components/FiltersBar'
import { useIsMobile } from '../../hooks/useIsMobile'
import { HARNESS_LABELS } from '../../lib/harness'

const COLOUR_A = 'var(--anthropic-orange)'
const COLOUR_B = 'var(--accent-blue, #3b82f6)'

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

  const harnessLabel = (id: string) => HARNESS_LABELS[id as HarnessId] ?? id
  const describeA = describeFilters(filtersA, pt ? 'pt' : 'en', harnessLabel)
  const describeB = describeFilters(filtersB, pt ? 'pt' : 'en', harnessLabel)
  // Comparing a scope with itself yields a column of zeros. Detected on the DESCRIPTION rather
  // than by deep-comparing the objects: two filter sets that read the same to the user are the
  // same comparison, whatever their key order.
  const identical = describeA === describeB

  /** One-click ways into a comparison that actually shows something. */
  const presets = useMemo(() => {
    const all: Filters = { dateRange: 'all', customStart: '', customEnd: '', projects: [], models: [] }
    const out: { label: string; apply: () => void }[] = [
      {
        label: pt ? '30 dias vs. todo o período' : 'Last 30 days vs all time',
        apply: () => { setFiltersA({ ...all, dateRange: '30d' }); setFiltersB(all) },
      },
      {
        label: pt ? '7 dias vs. 30 dias' : 'Last 7 days vs last 30',
        apply: () => { setFiltersA({ ...all, dateRange: '7d' }); setFiltersB({ ...all, dateRange: '30d' }) },
      },
    ]
    const hs = ctx.harnesses ?? []
    if (hs.length > 1) {
      out.push({
        label: `${harnessLabel(hs[0]!)} vs. ${harnessLabel(hs[1]!)}`,
        apply: () => {
          setFiltersA({ ...all, harnesses: [hs[0]!] })
          setFiltersB({ ...all, harnesses: [hs[1]!] })
        },
      })
    }
    return out
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctx.harnesses, pt])

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
          <SideCard
            label={editing.toUpperCase()}
            colour={editing === 'a' ? COLOUR_A : COLOUR_B}
            description={editing === 'a' ? describeA : describeB}
          >
            <FiltersBar
              {...barProps}
              filters={editing === 'a' ? filtersA : filtersB}
              onChange={editing === 'a' ? setFiltersA : setFiltersB}
            />
          </SideCard>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 12 }}>
          <SideCard label="A" colour={COLOUR_A} description={describeA}>
            <FiltersBar {...barProps} filters={filtersA} onChange={setFiltersA} />
          </SideCard>
          <SideCard label="B" colour={COLOUR_B} description={describeB}>
            <FiltersBar {...barProps} filters={filtersB} onChange={setFiltersB} />
          </SideCard>
        </div>
      )}

      {identical && (
        // The page opens with both sides on the same scope, which produces a table of zeros and
        // reads as broken rather than as "you have not chosen anything yet". Saying so, with the
        // one-click ways out, is the difference between an empty state and a bug.
        <div style={{
          display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap',
          padding: '10px 13px', borderRadius: 'var(--radius-lg)',
          border: '1px dashed var(--border)', background: 'var(--bg-card)',
        }}>
          <span style={{ fontSize: 12.5, color: 'var(--text-tertiary)' }}>
            {pt ? 'Os dois lados estão iguais. Comece por:' : 'Both sides are the same. Start with:'}
          </span>
          {presets.map(p => (
            <button
              key={p.label}
              onClick={p.apply}
              style={{
                padding: '5px 11px', borderRadius: 999, cursor: 'pointer', fontFamily: 'inherit',
                fontSize: 12, border: '1px solid var(--border)', background: 'var(--bg-elevated)',
                color: 'var(--text-secondary)',
              }}
            >
              {p.label}
            </button>
          ))}
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
      return { costUSD: null, planCostUSD: null, planMultiple: null, tokens: null, sessions: null, messages: null, cacheHitRate: null }
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
      tokens: derived.inputTokens + derived.outputTokens,
      sessions: derived.totalSessions,
      messages: derived.totalMessages,
      cacheHitRate: derived.cacheHitRate,
    }
  }, [ctx.billing, ctx.brlRate, derived, filters])
}

/**
 * One side's box.
 *
 * The colour is the SAME one the side's bars use in the table below, so "which column is this"
 * needs no legend, and the description says in words what the filter bar says in chips — the
 * table is read at a distance from the controls that produced it.
 */
function SideCard({ label, colour, description, children }: {
  label: string
  colour: string
  description: string
  children: React.ReactNode
}) {
  return (
    <div style={{
      border: `1px solid ${colour}`, borderRadius: 'var(--radius-lg)',
      background: 'var(--bg-card)', padding: '12px 12px 4px', position: 'relative',
    }}>
      <div style={{
        position: 'absolute', top: -9, left: 12, padding: '0 6px', background: 'var(--bg-base)',
        fontSize: 10, fontWeight: 800, letterSpacing: '0.08em', color: colour,
      }}>
        {label}
      </div>
      <div style={{
        fontSize: 12, color: 'var(--text-secondary)', marginBottom: 9, lineHeight: 1.4,
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
      }}>
        {description}
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

/**
 * The comparison, in the visual language the by-harness mode already uses: a big number with a
 * proportional bar under it.
 *
 * A four-column grid of bare numerals made the reader do the comparison themselves — work the bar
 * does at a glance. The bar is scaled to the larger of the two sides, so "which is bigger, and by
 * roughly how much" is answered before anyone reads a digit, and the Δ column then says exactly
 * how much.
 */
function MetricTable({ rows, ctx }: { rows: CompareRow[]; ctx: AppContext }) {
  const pt = ctx.lang === 'pt'
  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', overflow: 'hidden' }}>
      {rows.map((row, i) => {
        const max = Math.max(row.a ?? 0, row.b ?? 0)
        return (
          <div
            key={row.metric.key}
            style={{
              display: 'grid',
              gridTemplateColumns: 'minmax(150px, 1.1fr) 1fr 1fr minmax(120px, 0.8fr)',
              gap: 16, alignItems: 'center', padding: '13px 16px',
              borderTop: i === 0 ? 'none' : '1px solid var(--border)',
            }}
          >
            <div style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--text-secondary)' }}>
              {pt ? row.metric.labelPt : row.metric.labelEn}
              {row.basis === 'plan' && <BasisTag pt={pt} />}
            </div>
            <SideValue row={row} value={row.a} max={max} ctx={ctx} accent="var(--anthropic-orange)" />
            <SideValue row={row} value={row.b} max={max} ctx={ctx} accent="var(--accent-blue, #3b82f6)" />
            <div style={{ textAlign: 'right' }}><DeltaCell row={row} ctx={ctx} /></div>
          </div>
        )
      })}
    </div>
  )
}

/** One side's figure: the number, then a bar scaled against the other side. */
function SideValue({ row, value, max, ctx, accent }: {
  row: CompareRow
  value: number | null
  max: number
  ctx: AppContext
  accent: string
}) {
  const pct = value !== null && max > 0 ? Math.max(2, Math.round((value / max) * 100)) : 0
  return (
    <div style={{ minWidth: 0 }}>
      <div style={{
        fontSize: 15, fontWeight: 700, fontVariantNumeric: 'tabular-nums',
        color: value === null ? 'var(--text-tertiary)' : 'var(--text-primary)',
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
      }}>
        {formatValue(row, value, ctx)}
      </div>
      <div style={{ height: 4, background: 'var(--bg-elevated)', borderRadius: 2, marginTop: 6, overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${pct}%`, background: accent, opacity: 0.75, borderRadius: 2, transition: 'width 0.35s ease-out' }} />
      </div>
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
