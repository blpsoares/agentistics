import React, { useMemo, useState } from 'react'
import { Plus, Trash2, Save, Home as HomeIcon, X } from 'lucide-react'
import {
  MAX_COMPARISON_SIDES,
  MIN_COMPARISON_SIDES,
  removeComparison,
  upsertComparison,
  type ComparisonSide,
  type CostBasis,
  type Filters,
  type HarnessId,
  type SavedComparison,
} from '@agentistics/core'
import type { AppContext } from '../../lib/app-context'
import { buildCompareRows, describeFilters } from '../../lib/compareMetrics'
import { FiltersBar } from '../../components/FiltersBar'
import { useIsMobile } from '../../hooks/useIsMobile'
import { HARNESS_LABELS } from '../../lib/harness'
import { ComparisonTable, sideColour, type TableSide } from './ComparisonTable'
import { useComparisonSides } from './useComparisonSides'

const newId = (p: string) => `${p}_${Math.random().toString(16).slice(2, 8)}${Date.now().toString(16).slice(-5)}`
const blankFilters = (): Filters => ({ dateRange: 'all', customStart: '', customEnd: '', projects: [], models: [] })

/**
 * The comparison editor: N independent scopes, measured against the first.
 *
 * A comparison is a QUESTION, so it can be named, saved and pinned to Home — the recurring ones
 * ("is Codex cheaper for me", "did this month cost more than last") are worth asking once and
 * reading forever.
 *
 * The BASIS belongs to the comparison rather than to the page. "API vs plan" is frequently the
 * whole question, and a saved comparison that silently followed a global toggle would answer a
 * different one each time it was opened.
 */
export function CompareByFilter({ ctx }: { ctx: AppContext }) {
  const pt = ctx.lang === 'pt'
  const isMobile = useIsMobile()

  const [sides, setSides] = useState<ComparisonSide[]>(() => [
    { id: newId('s'), filters: { ...ctx.filters } },
    { id: newId('s'), filters: blankFilters() },
  ])
  const [basis, setBasis] = useState<CostBasis>(ctx.costBasis)
  const [name, setName] = useState('')
  /** The saved comparison currently loaded, so Save updates it instead of duplicating it. */
  const [loadedId, setLoadedId] = useState<string | null>(null)
  const [onHome, setOnHome] = useState(false)
  /** Mobile mounts ONE filter bar; this is the side it edits. */
  const [editing, setEditing] = useState(0)

  const derivedSides = useComparisonSides({
    data: ctx.data,
    sides,
    billing: ctx.billing,
    brlRate: ctx.brlRate,
    tags: ctx.tags,
  })
  const rows = useMemo(() => buildCompareRows(derivedSides, basis), [derivedSides, basis])

  const harnessLabel = (id: string) => HARNESS_LABELS[id as HarnessId] ?? id
  const describe = (s: ComparisonSide) => describeFilters(s.filters, pt ? 'pt' : 'en', harnessLabel)
  const sideLabel = (s: ComparisonSide, i: number) => s.label?.trim() || `${String.fromCharCode(65 + i)}`

  const tableSides: TableSide[] = sides.map((s, i) => ({
    id: s.id,
    label: sideLabel(s, i),
    description: describe(s),
  }))

  const setSideFilters = (id: string, f: Filters) =>
    setSides(list => list.map(s => (s.id === id ? { ...s, filters: f } : s)))
  const addSide = () =>
    setSides(list => (list.length >= MAX_COMPARISON_SIDES ? list : [...list, { id: newId('s'), filters: blankFilters() }]))
  const dropSide = (id: string) =>
    setSides(list => {
      if (list.length <= MIN_COMPARISON_SIDES) return list
      const next = list.filter(s => s.id !== id)
      setEditing(e => Math.min(e, next.length - 1))
      return next
    })

  const save = async () => {
    const trimmed = name.trim()
    if (!trimmed) return
    const comparison: SavedComparison = {
      id: loadedId ?? newId('cmp'),
      name: trimmed,
      sides,
      basis,
      ...(onHome ? { onHome: true } : {}),
    }
    setLoadedId(comparison.id)
    await ctx.saveComparisons(upsertComparison(ctx.comparisons, comparison))
  }

  const load = (c: SavedComparison) => {
    setSides(c.sides)
    setBasis(c.basis)
    setName(c.name)
    setLoadedId(c.id)
    setOnHome(c.onHome === true)
    setEditing(0)
  }

  const drop = async (id: string) => {
    if (loadedId === id) { setLoadedId(null); setName(''); setOnHome(false) }
    await ctx.saveComparisons(removeComparison(ctx.comparisons, id))
  }

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
      {/* Saved comparisons — the reason this page is worth returning to. */}
      {ctx.comparisons.length > 0 && (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <span style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>{pt ? 'Salvos:' : 'Saved:'}</span>
          {ctx.comparisons.map(c => (
            <span key={c.id} style={{
              display: 'inline-flex', alignItems: 'center', gap: 2,
              border: `1px solid ${loadedId === c.id ? 'var(--anthropic-orange)' : 'var(--border)'}`,
              borderRadius: 999, background: loadedId === c.id ? 'var(--anthropic-orange-dim)' : 'var(--bg-elevated)',
              paddingLeft: 10,
            }}>
              <button
                onClick={() => load(c)}
                style={{
                  border: 'none', background: 'none', cursor: 'pointer', fontFamily: 'inherit',
                  fontSize: 12, padding: '5px 2px 5px 0',
                  color: loadedId === c.id ? 'var(--anthropic-orange)' : 'var(--text-secondary)',
                }}
              >
                {c.name}
                {c.onHome && <HomeIcon size={10} style={{ marginLeft: 5, verticalAlign: -1 }} />}
              </button>
              <button
                onClick={() => void drop(c.id)}
                aria-label={pt ? `Remover ${c.name}` : `Remove ${c.name}`}
                style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--text-tertiary)', padding: '5px 8px 5px 4px', lineHeight: 0 }}
              >
                <X size={11} />
              </button>
            </span>
          ))}
        </div>
      )}

      {/* Toolbar: what this comparison is called, which basis it asks in, and where it shows. */}
      <div style={{
        display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap',
        padding: '10px 12px', border: '1px solid var(--border)',
        borderRadius: 'var(--radius-lg)', background: 'var(--bg-card)',
      }}>
        <input
          value={name}
          onChange={e => setName(e.target.value)}
          placeholder={pt ? 'Nome da comparação' : 'Comparison name'}
          style={{
            flex: '1 1 200px', minWidth: 0, padding: '8px 11px', borderRadius: 'var(--radius-md)',
            border: '1px solid var(--border)', background: 'var(--bg-input)',
            color: 'var(--text-primary)', fontFamily: 'inherit',
          }}
        />
        {/* The basis is part of the comparison, not the page — see the header. */}
        <div style={{ display: 'inline-flex', border: '1px solid var(--border)', borderRadius: 6, overflow: 'hidden', flexShrink: 0 }}>
          {(['api', 'plan'] as const).map(b => {
            const active = basis === b
            const usable = b === 'api' || (ctx.billingReady.ready && ctx.planBasis.basis !== null)
            return (
              <button
                key={b}
                onClick={() => (usable ? setBasis(b) : ctx.openBillingSetup())}
                title={!usable ? (pt ? 'Cadastre seu plano para comparar em custo real' : 'Register your plan to compare in real cost') : undefined}
                style={{
                  padding: '7px 13px', border: 'none', fontFamily: 'inherit', fontSize: 12,
                  fontWeight: active ? 600 : 400, cursor: 'pointer', opacity: usable ? 1 : 0.55,
                  background: active ? 'var(--anthropic-orange-dim)' : 'var(--bg-elevated)',
                  color: active ? 'var(--anthropic-orange)' : 'var(--text-secondary)',
                }}
              >
                {b === 'api' ? 'API' : (pt ? 'Plano' : 'Plan')}
              </button>
            )
          })}
        </div>
        <button
          onClick={() => setOnHome(v => !v)}
          title={pt ? 'Exibir esta comparação na Home' : 'Show this comparison on Home'}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 6, padding: '7px 12px',
            borderRadius: 'var(--radius-md)', cursor: 'pointer', fontFamily: 'inherit', fontSize: 12,
            border: `1px solid ${onHome ? 'var(--anthropic-orange)' : 'var(--border)'}`,
            background: onHome ? 'var(--anthropic-orange-dim)' : 'var(--bg-elevated)',
            color: onHome ? 'var(--anthropic-orange)' : 'var(--text-secondary)',
          }}
        >
          <HomeIcon size={13} />
          {pt ? 'Na Home' : 'On Home'}
        </button>
        <button
          onClick={() => void save()}
          disabled={name.trim() === ''}
          title={name.trim() === '' ? (pt ? 'Dê um nome para salvar' : 'Name it to save') : undefined}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 6, padding: '7px 14px',
            borderRadius: 'var(--radius-md)', border: 'none', fontFamily: 'inherit', fontSize: 12,
            fontWeight: 600, cursor: name.trim() === '' ? 'default' : 'pointer',
            background: name.trim() === '' ? 'var(--bg-hover)' : 'var(--anthropic-orange)',
            color: name.trim() === '' ? 'var(--text-tertiary)' : '#fff',
          }}
        >
          <Save size={13} />
          {loadedId ? (pt ? 'Atualizar' : 'Update') : (pt ? 'Salvar' : 'Save')}
        </button>
      </div>

      {/* The sides. On a phone one bar is mounted and a switch chooses which side it edits — both
          sides' filters stay described above, so nothing the user set is ever hidden. */}
      {isMobile ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ display: 'flex', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', overflow: 'hidden' }}>
            {sides.map((s, i) => (
              <button
                key={s.id}
                onClick={() => setEditing(i)}
                style={{
                  flex: 1, minHeight: 44, border: 'none', fontFamily: 'inherit', fontSize: 13, fontWeight: 700,
                  background: editing === i ? 'var(--anthropic-orange-dim)' : 'transparent',
                  color: editing === i ? sideColour(i) : 'var(--text-tertiary)', cursor: 'pointer',
                }}
              >
                {sideLabel(s, i)}
              </button>
            ))}
          </div>
          {sides[editing] && (
            <SideCard
              index={editing}
              label={sideLabel(sides[editing]!, editing)}
              description={describe(sides[editing]!)}
              onRemove={sides.length > MIN_COMPARISON_SIDES ? () => dropSide(sides[editing]!.id) : undefined}
              removeLabel={pt ? 'Remover lado' : 'Remove side'}
            >
              <FiltersBar {...barProps} filters={sides[editing]!.filters} onChange={f => setSideFilters(sides[editing]!.id, f)} />
            </SideCard>
          )}
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 12 }}>
          {sides.map((s, i) => (
            <SideCard
              key={s.id}
              index={i}
              label={sideLabel(s, i)}
              description={describe(s)}
              onRemove={sides.length > MIN_COMPARISON_SIDES ? () => dropSide(s.id) : undefined}
              removeLabel={pt ? 'Remover lado' : 'Remove side'}
            >
              <FiltersBar {...barProps} filters={s.filters} onChange={f => setSideFilters(s.id, f)} />
            </SideCard>
          ))}
        </div>
      )}

      {sides.length < MAX_COMPARISON_SIDES && (
        <button
          onClick={addSide}
          style={{
            alignSelf: 'flex-start', display: 'inline-flex', alignItems: 'center', gap: 7,
            padding: isMobile ? '12px 16px' : '8px 14px', width: isMobile ? '100%' : undefined,
            justifyContent: isMobile ? 'center' : undefined,
            borderRadius: 'var(--radius-lg)', border: '1px dashed var(--border)',
            background: 'transparent', color: 'var(--text-secondary)',
            fontSize: 12.5, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
          }}
        >
          <Plus size={14} />
          {pt ? 'Adicionar lado' : 'Add side'}
        </button>
      )}

      <ComparisonTable rows={rows} sides={tableSides} currency={ctx.currency} brlRate={ctx.brlRate} lang={ctx.lang} />

      <p style={{ fontSize: 11.5, color: 'var(--text-tertiary)', lineHeight: 1.55, margin: 0 }}>
        {pt
          ? `Cada variação é medida contra ${sideLabel(sides[0]!, 0)}, o lado de base. Um crescimento a partir de zero não tem porcentagem — aparece só como valor absoluto, porque uma porcentagem ali seria um denominador inventado.`
          : `Every change is measured against ${sideLabel(sides[0]!, 0)}, the baseline. Growth from zero has no percentage — only the absolute figure is shown, because a percentage there would be an invented denominator.`}
      </p>
    </div>
  )
}

function SideCard({ index, label, description, onRemove, removeLabel, children }: {
  index: number
  label: string
  description: string
  onRemove?: () => void
  removeLabel: string
  children: React.ReactNode
}) {
  const colour = sideColour(index)
  return (
    <div style={{
      border: `1px solid ${colour}`, borderRadius: 'var(--radius-lg)',
      background: 'var(--bg-card)', padding: '12px 12px 4px', position: 'relative',
    }}>
      <div style={{
        position: 'absolute', top: -9, left: 12, padding: '0 6px', background: 'var(--bg-base)',
        fontSize: 10, fontWeight: 800, letterSpacing: '0.08em', color: colour,
      }}>
        {label}{index === 0 && ' · base'}
      </div>
      {onRemove && (
        <button
          onClick={onRemove}
          aria-label={removeLabel}
          title={removeLabel}
          style={{
            position: 'absolute', top: 6, right: 6, border: 'none', background: 'none',
            cursor: 'pointer', color: 'var(--text-tertiary)', padding: 6, lineHeight: 0,
          }}
        >
          <Trash2 size={13} />
        </button>
      )}
      <div style={{
        fontSize: 12, color: 'var(--text-secondary)', marginBottom: 9, lineHeight: 1.4,
        paddingRight: onRemove ? 24 : 0,
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
      }}>
        {description}
      </div>
      {children}
    </div>
  )
}
