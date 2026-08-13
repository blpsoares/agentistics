import React from 'react'
import { Receipt, TrendingUp, AlertTriangle } from 'lucide-react'
import { fmtCost, findPlan, type HarnessId, type Lang } from '@agentistics/core'
import type { PlanBasisView } from '../hooks/usePlanBasis'
import { formatMultiple } from '../lib/costBasis'
import { HARNESS_LABELS } from '../lib/harness'
import { useIsMobile } from '../hooks/useIsMobile'

/**
 * API estimate vs what the plan actually cost, over the same days.
 *
 * The whole feature in one panel: the two figures side by side, the multiple between them, and
 * the caveats that make the comparison honest. It renders ONLY when a plan cost could actually be
 * computed — an empty version inviting setup would be a second, competing prompt beside the
 * first-run modal and the disabled basis toggle, both of which already do that job.
 *
 * It does NOT follow the cost-basis toggle. This panel IS the comparison, so re-expressing one of
 * its two sides in terms of the other would collapse it into a single number and delete the point.
 */
export function PlanValuePanel({ planBasis, currency, brlRate, lang }: {
  planBasis: PlanBasisView
  currency: 'USD' | 'BRL'
  brlRate: number
  lang: Lang
}) {
  const pt = lang === 'pt'
  const isMobile = useIsMobile()
  const basis = planBasis.basis
  if (!basis || !basis.coverage.computable) return null

  const api = basis.apiCostUSD
  const plan = basis.planCostUSD
  const multiple = formatMultiple(basis.multiple, pt ? 'pt' : 'en')
  const worthIt = basis.multiple !== null && basis.multiple >= 1
  // Both bars share one scale, so their LENGTHS are the comparison — the multiple then says by
  // exactly how much. A bar per side on its own scale would make every plan look break-even.
  const max = Math.max(api, plan, 1)

  const plans = Object.entries(basis.perHarness)
    .flatMap(([h, b]) => (b?.coverage.computable ? b.segments : []).map(s => ({ harness: h as HarnessId, s })))
    .filter(x => x.s.covered && x.s.monthlyUSD !== null)
  const planNames = [...new Set(plans.map(x => {
    const name = x.s.label ?? (x.s.planId ? findPlan(x.s.planId)?.label ?? x.s.planId : null)
    return name ?? HARNESS_LABELS[x.harness] ?? x.harness
  }))]

  const cov = basis.coverage

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {/* The conclusion first. Someone who reads only one line of this panel should get the
          answer, not the inputs. */}
      <div style={{
        display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap',
      }}>
        <span style={{
          fontSize: 30, fontWeight: 800, lineHeight: 1,
          color: worthIt ? 'var(--accent-green, #22c55e)' : '#f59e0b',
          fontVariantNumeric: 'tabular-nums',
        }}>
          {multiple ?? '—'}
        </span>
        <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
          {multiple === null
            ? (pt ? 'sem múltiplo calculável neste período' : 'no multiple computable for this period')
            : worthIt
              ? (pt ? 'do que você pagou, em valor de API' : 'of what you paid, in API value')
              : (pt ? 'do que você pagou — o plano custou mais do que o uso vale em API' : 'of what you paid — the plan cost more than the usage is worth at API prices')}
        </span>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 11 }}>
        <Bar
          label={pt ? 'Valor de API do seu uso' : 'API value of your usage'}
          value={api}
          max={max}
          colour="var(--anthropic-orange)"
          currency={currency}
          brlRate={brlRate}
          icon={<TrendingUp size={12} />}
        />
        <Bar
          label={pt ? 'O que o plano custou' : 'What the plan cost'}
          value={plan}
          max={max}
          colour="var(--accent-blue, #3b82f6)"
          currency={currency}
          brlRate={brlRate}
          icon={<Receipt size={12} />}
          sub={planNames.length > 0 ? planNames.join(' + ') : undefined}
        />
      </div>

      {/* Everything that makes the two figures comparable. Stated here rather than in a tooltip:
          a caveat nobody sees is not a caveat. */}
      <div style={{ fontSize: 11.5, color: 'var(--text-tertiary)', lineHeight: 1.6, display: 'flex', flexDirection: 'column', gap: 3 }}>
        {planBasis.window && (
          <span>
            {pt
              ? `Medido de ${planBasis.window.from} a ${planBasis.window.to} — os dois lados sobre os mesmos dias.`
              : `Measured ${planBasis.window.from} → ${planBasis.window.to} — both sides over the same days.`}
          </span>
        )}
        {cov.uncoveredDays > 0 && (
          <span>
            {pt
              ? `${cov.uncoveredDays} dia${cov.uncoveredDays === 1 ? '' : 's'} sem plano cadastrado ficaram de fora dos dois lados (${fmtCost(cov.excludedApiCostUSD, currency, brlRate)} de valor de API).`
              : `${cov.uncoveredDays} day${cov.uncoveredDays === 1 ? '' : 's'} with no registered plan were excluded from both sides (${fmtCost(cov.excludedApiCostUSD, currency, brlRate)} of API value).`}
          </span>
        )}
        {cov.undatedApiCostUSD > 0 && (
          <span>
            {pt
              ? `${fmtCost(cov.undatedApiCostUSD, currency, brlRate)} de uso Claude mais antigo não tem registro diário e não entra nesta comparação.`
              : `${fmtCost(cov.undatedApiCostUSD, currency, brlRate)} of older Claude usage has no daily record and is not in this comparison.`}
          </span>
        )}
        {basis.uncoveredHarnesses.length > 0 && (
          <span style={{ display: 'inline-flex', alignItems: 'flex-start', gap: 5 }}>
            <AlertTriangle size={11} style={{ marginTop: 3, flexShrink: 0 }} />
            {pt
              ? `Sem plano cadastrado para ${basis.uncoveredHarnesses.map(h => HARNESS_LABELS[h] ?? h).join(', ')} — esse uso está fora da conta.`
              : `No plan registered for ${basis.uncoveredHarnesses.map(h => HARNESS_LABELS[h] ?? h).join(', ')} — that usage is not in this comparison.`}
          </span>
        )}
      </div>
    </div>
  )
}

function Bar({ label, value, max, colour, currency, brlRate, icon, sub }: {
  label: string
  value: number
  max: number
  colour: string
  currency: 'USD' | 'BRL'
  brlRate: number
  icon: React.ReactNode
  sub?: string
}) {
  const pct = max > 0 ? Math.max(1.5, (value / max) * 100) : 0
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 10, marginBottom: 5 }}>
        <span style={{ fontSize: 12, color: 'var(--text-secondary)', display: 'inline-flex', alignItems: 'center', gap: 5 }}>
          <span style={{ color: colour, display: 'inline-flex' }}>{icon}</span>
          {label}
          {sub && <span style={{ color: 'var(--text-tertiary)' }}>· {sub}</span>}
        </span>
        <span style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-primary)', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
          {fmtCost(value, currency, brlRate)}
        </span>
      </div>
      <div style={{ height: 8, background: 'var(--bg-elevated)', borderRadius: 4, overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${pct}%`, background: colour, opacity: 0.8, borderRadius: 4, transition: 'width 0.4s ease-out' }} />
      </div>
    </div>
  )
}
