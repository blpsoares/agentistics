import React from 'react'
import { useNavigate } from 'react-router-dom'
import { GitCompare, ExternalLink } from 'lucide-react'
import { comparisonsOnHome, type SavedComparison } from '@agentistics/core'
import type { AppContext } from '../lib/app-context'
import { buildCompareRows, describeFilters } from '../lib/compareMetrics'
import { ComparisonTable, type TableSide } from '../pages/compare/ComparisonTable'
import { useComparisonSides } from '../pages/compare/useComparisonSides'
import { HARNESS_LABELS } from '../lib/harness'
import { Section } from './Section'

/**
 * The comparisons the user pinned, on the Home page.
 *
 * Renders through exactly the same `ComparisonTable` the compare page uses — a second renderer
 * would eventually disagree with the first about what a delta means, and the whole point of
 * pinning is that the answer here is the answer there.
 *
 * Each pinned comparison keeps ITS OWN basis and ITS OWN filters. It deliberately ignores the
 * page's filter bar: a comparison is a fixed question, and silently re-scoping it to whatever the
 * dashboard is currently filtered to would answer something else under the same name.
 */
export function HomeComparisons({ ctx }: { ctx: AppContext }) {
  const pinned = comparisonsOnHome(ctx.comparisons)
  if (pinned.length === 0) return null
  return (
    <>
      {pinned.map(c => (
        <PinnedComparison key={c.id} comparison={c} ctx={ctx} />
      ))}
    </>
  )
}

function PinnedComparison({ comparison, ctx }: { comparison: SavedComparison; ctx: AppContext }) {
  const navigate = useNavigate()
  const pt = ctx.lang === 'pt'

  const derived = useComparisonSides({
    data: ctx.data,
    sides: comparison.sides,
    billing: ctx.billing,
    brlRate: ctx.brlRate,
    tags: ctx.tags,
  })
  const rows = buildCompareRows(derived, comparison.sides.map(s => s.basis ?? 'api'))

  const sides: TableSide[] = comparison.sides.map((s, i) => ({
    id: s.id,
    label: s.label?.trim() || String.fromCharCode(65 + i),
    description: describeFilters(s.filters, pt ? 'pt' : 'en', id => HARNESS_LABELS[id as never] ?? id),
    basis: s.basis ?? 'api',
  }))

  return (
    <Section
      flashId={`comparison-${comparison.id}`}
      title={
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7 }}>
          <GitCompare size={14} />
          {comparison.name}
          {comparison.sides.some(s => s.basis === 'plan') && (
            <span style={{
              fontSize: 9.5, fontWeight: 700, letterSpacing: '0.04em',
              color: 'var(--anthropic-orange)', border: '1px solid var(--anthropic-orange)',
              padding: '1px 5px', borderRadius: 8,
            }}>
              {pt ? 'PLANO' : 'PLAN'}
            </span>
          )}
        </span>
      }
      action={
        <button
          onClick={() => navigate('/compare?mode=filter')}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 5, border: 'none',
            background: 'none', cursor: 'pointer', fontFamily: 'inherit', fontSize: 11.5,
            color: 'var(--text-tertiary)',
          }}
        >
          {pt ? 'Editar' : 'Edit'}
          <ExternalLink size={11} />
        </button>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <ComparisonTable rows={rows} sides={sides} currency={ctx.currency} brlRate={ctx.brlRate} lang={ctx.lang} />
        {/* A pinned comparison does not follow the page's filters, and saying so is the difference
            between a fixed question and a number that looks wrong. */}
        <span style={{ fontSize: 11, color: 'var(--text-tertiary)', lineHeight: 1.5 }}>
          {pt
            ? 'Esta comparação usa os filtros salvos com ela, não os filtros do topo da página.'
            : 'This comparison uses the filters saved with it, not the ones at the top of the page.'}
        </span>
      </div>
    </Section>
  )
}
