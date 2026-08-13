import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { useOutletContext } from 'react-router-dom'
import { Plus, Pencil, Trash2, Sparkles, AlertTriangle, Info } from 'lucide-react'
import {
  HARNESS_ORDER,
  billingReadiness,
  findPlan,
  plansForHarness,
  sortPeriods,
  validateTimeline,
  type BillingDetection,
  type BillingPeriod,
  type BillingCurrency,
  type BillingSettings as BillingSettingsShape,
  type BillingTimeline,
  type HarnessId,
} from '@agentistics/core'
import type { AppContext } from '../../lib/app-context'
import { HARNESS_LABELS } from '../../lib/harness'
import { useIsMobile } from '../../hooks/useIsMobile'
import { Drawer } from './Drawer'
import {
  Checkbox,
  ConfirmModal,
  FieldInput,
  RecordCard,
  RecordCardAction,
  SectionHeader,
  Select,
  TabSelect,
} from './primitives'
import {
  applyPlan,
  currencySymbol,
  formatAmountDisplay,
  parseAmountInput,
  describeError,
  draftFromPeriod,
  draftWantsPrice,
  emptyDraft,
  periodFromDraft,
  periodName,
  validateDraft,
  type PeriodDraft,
} from './billingForm'

/** The wire shape of `GET /api/billing/plan-prices`. Declared here rather than imported: the web
 *  bundle must never reach into `packages/server`. */
interface ScrapedPlanPrice {
  planId: string
  amount: number
  currency: BillingCurrency
  source: string
}

const newPeriodId = (): string =>
  `bp_${Math.random().toString(16).slice(2, 8)}${Date.now().toString(16).slice(-6)}`

/** `yyyy-MM-dd` for the native date input's max — nobody is billed for the future. */
const today = (): string => new Date().toISOString().slice(0, 10)

export default function BillingSettings() {
  const ctx = useOutletContext<AppContext>()
  const pt = ctx.lang === 'pt'
  const isMobile = useIsMobile()

  const harnesses: HarnessId[] = useMemo(() => {
    const present = (ctx.data.harnesses ?? []).filter(h => HARNESS_ORDER.includes(h))
    return present.length > 0 ? present : ['claude']
  }, [ctx.data.harnesses])

  const [harness, setHarness] = useState<HarnessId>(harnesses[0] ?? 'claude')
  useEffect(() => {
    if (!harnesses.includes(harness)) setHarness(harnesses[0] ?? 'claude')
  }, [harnesses, harness])

  const timeline: BillingTimeline = ctx.billing.profiles[harness] ?? { periods: [] }
  const periods = useMemo(() => sortPeriods(timeline.periods), [timeline.periods])
  const timelineErrors = useMemo(() => validateTimeline(timeline), [timeline])

  const [draft, setDraft] = useState<PeriodDraft | null>(null)
  // What the drawer opened WITH, so "unsaved changes" means changes — not merely "a drawer is
  // open". A confirm on every close is one people learn to dismiss without reading, which is
  // exactly when it stops protecting the edit it exists for.
  const [draftOrigin, setDraftOrigin] = useState<string>('')
  const openDraft = useCallback((next: PeriodDraft) => {
    setDraft(next)
    setDraftOrigin(JSON.stringify(next))
    // Each drawer starts clean: an error revealed on the last attempt must not greet the next one.
    setShowErrors(false)
  }, [])
  const draftDirty = draft !== null && JSON.stringify(draft) !== draftOrigin
  const [confirmDelete, setConfirmDelete] = useState<BillingPeriod | null>(null)
  const [detections, setDetections] = useState<BillingDetection[] | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [planPrices, setPlanPrices] = useState<ScrapedPlanPrice[]>([])

  // Live vendor prices. Best-effort by construction: the endpoint is anchored, so it returns
  // nothing rather than a wrong figure, and nothing simply means the built-in catalog stands.
  useEffect(() => {
    let cancelled = false
    fetch('/api/billing/plan-prices')
      .then(r => (r.ok ? r.json() : null))
      .then((body: { prices?: ScrapedPlanPrice[] } | null) => {
        if (!cancelled) setPlanPrices(body?.prices ?? [])
      })
      .catch(() => { /* the catalog is the floor; a failed fetch changes nothing */ })
    return () => { cancelled = true }
  }, [])

  // Detection is a convenience, fetched once. A failure is silent: the screen is fully usable by
  // hand, and an error banner for a feature the user did not ask for is noise.
  useEffect(() => {
    let cancelled = false
    fetch('/api/billing/detect')
      .then(r => (r.ok ? r.json() : null))
      .then((body: { detections?: BillingDetection[] } | null) => {
        if (!cancelled) setDetections(body?.detections ?? [])
      })
      .catch(() => { if (!cancelled) setDetections([]) })
    return () => { cancelled = true }
  }, [])

  const persist = useCallback(async (nextPeriods: BillingPeriod[]) => {
    const profiles = { ...ctx.billing.profiles }
    if (nextPeriods.length > 0) profiles[harness] = { periods: nextPeriods }
    else delete profiles[harness]
    const next: BillingSettingsShape = { ...ctx.billing, profiles }
    setSaveError(null)
    try {
      await ctx.saveBilling(next)
    } catch {
      setSaveError(pt ? 'Não foi possível salvar. Tente de novo.' : 'Could not save. Try again.')
    }
  }, [ctx, harness, pt])

  const draftErrors = useMemo(
    () => (draft ? validateDraft(draft, periods, newPeriodId) : []),
    [draft, periods],
  )
  // A blank form is not a form full of mistakes. Errors stay hidden until the user asks to save —
  // greeting someone with three red lines before they have typed anything reads as "this is
  // broken", not as "here is what I need".
  const [showErrors, setShowErrors] = useState(false)
  const errorFor = (codes: string[]): string | null => {
    if (!showErrors) return null
    const hit = draftErrors.find(e => codes.includes(e.code))
    if (!hit) return null
    const other = hit.code === 'overlap'
      ? periods.find(p => p.id === (hit as { withId: string }).withId)
      : undefined
    return describeError(hit, pt ? 'pt' : 'en', other ? periodName(other) : undefined)
  }

  const detection = detections?.find(d => d.harness === harness)
  const canUseDetection =
    detection !== undefined && detection.source !== 'none' && periods.length === 0

  const openNew = () => openDraft(emptyDraft())
  const openFromDetection = () => {
    if (!detection) return
    let next = emptyDraft()
    const entry = detection.planId ? findPlan(detection.planId) : undefined
    if (entry) next = applyPlan(next, entry)
    openDraft(next)
  }

  const saveDraft = async () => {
    if (!draft) return
    // The button is never disabled. A greyed-out control with nothing to explain it is the same
    // dead click as a toggle that does nothing — pressing it reveals what is missing instead.
    if (draftErrors.length > 0) { setShowErrors(true); return }
    const period = periodFromDraft(draft, newPeriodId)
    const rest = periods.filter(p => p.id !== period.id)
    await persist([...rest, period])
    setDraft(null)
  }

  // A live figure read from the vendor's page today beats the compiled-in one, which is only ever
  // as fresh as the last release. Both lose to whatever the user typed.
  const livePrice = useCallback(
    (planId: string) => planPrices.find(p => p.planId === planId) ?? null,
    [planPrices],
  )

  const catalogOptions = useMemo(() => plansForHarness(harness).map(entry => {
    const live = planPrices.find(p => p.planId === entry.id)
    const price = live ?? entry.monthly
    return {
      value: entry.id,
      label: entry.label,
      hint: price
        ? `${price.currency} ${price.amount}/${pt ? 'mês' : 'mo'}`
        : (pt ? 'sem valor publicado' : 'no published price'),
    }
  }), [harness, pt, planPrices])

  const selectedEntry = draft?.planId ? findPlan(draft.planId) : undefined
  const rangeLabel = (p: BillingPeriod) =>
    `${p.from} → ${p.to ?? (pt ? 'em curso' : 'ongoing')}`
  const priceLabel = (p: BillingPeriod) =>
    p.price
      ? `${p.price.currency} ${p.price.amount}/${pt ? 'mês' : 'mo'}`
      : p.mode === 'api'
        ? (pt ? 'por token' : 'per token')
        : '—'

  const readiness = billingReadiness(ctx.billing, harnesses)

  return (
    <div>
      <SectionHeader label={pt ? 'Como você é cobrado' : 'How you are billed'} />
      <p style={{ fontSize: 12.5, color: 'var(--text-tertiary)', lineHeight: 1.55, margin: '0 0 14px' }}>
        {pt
          ? 'Todo custo no app é uma estimativa de preço de API. Cadastre o que você realmente paga e o app passa a poder mostrar o custo do seu plano — e quanto de valor você extraiu dele. Tudo fica local, nada disso vai para uma central.'
          : 'Every cost in the app is an API-price estimate. Register what you actually pay and the app can show your plan cost instead — and how much value you got out of it. It all stays local; none of this travels to a central.'}
      </p>

      {harnesses.length > 1 && (
        <div style={{ marginBottom: 14, ...(isMobile ? { overflowX: 'auto' } : {}) }}>
          <TabSelect
            options={harnesses.map(h => ({ value: h, label: HARNESS_LABELS[h] ?? h }))}
            value={harness}
            onChange={setHarness}
          />
        </div>
      )}

      {canUseDetection && detection && (
        <div style={{ marginBottom: 14 }}>
          <RecordCard
            title={
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7 }}>
                <Sparkles size={14} style={{ color: 'var(--anthropic-orange)' }} />
                {pt ? 'Detectado nesta máquina' : 'Detected on this machine'}
              </span>
            }
            subtitle={pt ? detection.evidencePt : detection.evidenceEn}
            fields={[
              {
                label: pt ? 'Plano' : 'Plan',
                value: detection.planId ? (findPlan(detection.planId)?.label ?? detection.planId) : (pt ? 'não identificado' : 'not identified'),
              },
              {
                label: pt ? 'Falta' : 'Missing',
                // The one thing detection can never know, stated plainly so the button does not
                // look like it will finish the job on its own.
                value: pt ? 'a data em que você começou a pagar' : 'the date you started paying',
              },
            ]}
            actions={
              <RecordCardAction onClick={openFromDetection} label={pt ? 'Usar como base' : 'Use as a starting point'}>
                {pt ? 'Usar como base' : 'Use as a starting point'}
              </RecordCardAction>
            }
          />
        </div>
      )}

      {timelineErrors.size > 0 && (
        <div style={{
          display: 'flex', gap: 9, alignItems: 'flex-start', marginBottom: 14,
          padding: '10px 12px', borderRadius: 'var(--radius-lg)',
          border: '1px solid var(--accent-red)', background: 'var(--bg-card)',
        }}>
          <AlertTriangle size={15} style={{ color: 'var(--accent-red)', flexShrink: 0, marginTop: 1 }} />
          <div style={{ fontSize: 12.5, color: 'var(--text-secondary)', lineHeight: 1.5 }}>
            {pt
              ? 'Há períodos com problema nesta linha do tempo. Enquanto isso não for resolvido, o custo do plano não pode ser calculado para este harness — dois planos cobrindo o mesmo dia cobrariam esse dia duas vezes.'
              : 'Some periods on this timeline have problems. Until they are fixed the plan cost cannot be computed for this harness — two plans covering the same day would charge that day twice.'}
          </div>
        </div>
      )}

      {periods.length === 0 ? (
        <div style={{
          padding: '18px 16px', borderRadius: 'var(--radius-lg)',
          border: '1px dashed var(--border)', background: 'var(--bg-card)',
          fontSize: 12.5, color: 'var(--text-tertiary)', lineHeight: 1.55,
        }}>
          {pt
            ? 'Nenhum período cadastrado para este harness. Adicione um para começar — pode ser uma assinatura, ou "API — pago por uso" se você paga por token.'
            : 'No periods registered for this harness. Add one to begin — a subscription, or “API — pay as you go” if you pay per token.'}
        </div>
      ) : isMobile ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {periods.map(p => (
            <RecordCard
              key={p.id}
              title={periodName(p) || (pt ? 'Sem plano' : 'No plan')}
              subtitle={rangeLabel(p)}
              fields={[
                { label: pt ? 'Valor' : 'Amount', value: priceLabel(p) },
                { label: pt ? 'Cobrança' : 'Billing', value: modeLabel(p.mode, pt) },
              ]}
              actions={
                <>
                  <RecordCardAction onClick={() => openDraft(draftFromPeriod(p))} label={pt ? 'Editar' : 'Edit'}>
                    <Pencil size={14} />
                  </RecordCardAction>
                  <RecordCardAction onClick={() => setConfirmDelete(p)} danger label={pt ? 'Remover' : 'Remove'}>
                    <Trash2 size={14} />
                  </RecordCardAction>
                </>
              }
            />
          ))}
        </div>
      ) : (
        <div style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
            <thead>
              <tr style={{ background: 'var(--bg-hover)' }}>
                <Th>{pt ? 'Plano' : 'Plan'}</Th>
                <Th>{pt ? 'Período' : 'Period'}</Th>
                <Th>{pt ? 'Valor' : 'Amount'}</Th>
                <Th>{pt ? 'Cobrança' : 'Billing'}</Th>
                <Th align="right">{''}</Th>
              </tr>
            </thead>
            <tbody>
              {periods.map(p => {
                const bad = (timelineErrors.get(p.id) ?? []).length > 0
                return (
                  <tr key={p.id} style={{ borderTop: '1px solid var(--border)' }}>
                    <Td>
                      <span style={{ color: bad ? 'var(--accent-red)' : 'var(--text-primary)', fontWeight: 600 }}>
                        {periodName(p) || (pt ? 'Sem plano' : 'No plan')}
                      </span>
                    </Td>
                    <Td>{rangeLabel(p)}</Td>
                    <Td>{priceLabel(p)}</Td>
                    <Td>{modeLabel(p.mode, pt)}</Td>
                    <Td align="right">
                      <button onClick={() => openDraft(draftFromPeriod(p))} style={iconBtn} title={pt ? 'Editar' : 'Edit'}>
                        <Pencil size={14} />
                      </button>
                      <button onClick={() => setConfirmDelete(p)} style={{ ...iconBtn, color: 'var(--accent-red)' }} title={pt ? 'Remover' : 'Remove'}>
                        <Trash2 size={14} />
                      </button>
                    </Td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      <button onClick={openNew} style={{
        marginTop: 12, display: 'inline-flex', alignItems: 'center', gap: 7,
        padding: isMobile ? '12px 16px' : '8px 14px', width: isMobile ? '100%' : undefined,
        justifyContent: isMobile ? 'center' : undefined,
        borderRadius: 'var(--radius-lg)', border: '1px solid var(--border)',
        background: 'var(--bg-card)', color: 'var(--text-primary)',
        fontSize: 12.5, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
      }}>
        <Plus size={14} />
        {pt ? 'Adicionar período' : 'Add period'}
      </button>

      {saveError && (
        <div style={{ marginTop: 10, fontSize: 12, color: 'var(--accent-red)' }}>{saveError}</div>
      )}

      {!readiness.ready && periods.length > 0 && timelineErrors.size === 0 && (
        <p style={{ marginTop: 14, fontSize: 12, color: 'var(--text-tertiary)', lineHeight: 1.5 }}>
          <Info size={12} style={{ verticalAlign: -1, marginRight: 5 }} />
          {pt
            ? 'Ainda falta algo para calcular o custo do plano. Confira os períodos acima.'
            : 'Something is still missing before the plan cost can be computed. Check the periods above.'}
        </p>
      )}

      <Drawer
        open={draft !== null}
        title={draft?.id ? (pt ? 'Editar período' : 'Edit period') : (pt ? 'Novo período' : 'New period')}
        onClose={() => setDraft(null)}
        lang={pt ? 'pt' : 'en'}
        dirty={draftDirty}
        footer={
          <button
            onClick={saveDraft}
            style={{
              width: '100%', padding: '12px 16px', borderRadius: 'var(--radius-lg)',
              border: 'none', fontFamily: 'inherit', fontSize: 13, fontWeight: 600,
              background: 'var(--anthropic-orange)', color: '#fff', cursor: 'pointer',
            }}
          >
            {pt ? 'Salvar' : 'Save'}
          </button>
        }
      >
        {draft && (
          <div>
            <div style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 5 }}>
                {pt ? 'Plano' : 'Plan'}
              </div>
              <Select
                value={draft.planId}
                onChange={v => {
                  const entry = findPlan(v)
                  if (!entry) return
                  // A figure read from the vendor's page today supersedes the compiled-in one,
                  // which is only ever as fresh as the last release. `applyPlan` still refuses to
                  // overwrite anything the user has already typed.
                  const live = livePrice(v)
                  const withLive = live
                    ? { ...entry, monthly: { amount: live.amount, currency: live.currency, verifiedAt: today(), source: live.source } }
                    : entry
                  setDraft(d => (d ? applyPlan(d, withLive) : d))
                }}
                options={catalogOptions}
                placeholder={pt ? 'Escolha um plano' : 'Choose a plan'}
                searchable
              />
              <FieldError text={errorFor(['missing_plan'])} />
              {/* Provenance, always. A prefilled amount with no stated origin is indistinguishable
                  from one the app invented — and one of these two really is only as fresh as the
                  last release. */}
              {selectedEntry && livePrice(selectedEntry.id) && (
                <div style={{ fontSize: 11, color: 'var(--accent-green, #22c55e)', marginTop: 6, lineHeight: 1.5 }}>
                  {pt
                    ? `Valor lido hoje de ${livePrice(selectedEntry.id)!.source}. Confirme na sua fatura — cobrança anual, plano antigo ou imposto podem mudar o número.`
                    : `Read today from ${livePrice(selectedEntry.id)!.source}. Confirm against your invoice — annual billing, a grandfathered plan or tax can change it.`}
                </div>
              )}
              {selectedEntry && !livePrice(selectedEntry.id) && selectedEntry.monthly && (
                <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 6, lineHeight: 1.5 }}>
                  {pt
                    ? `Valor da tabela interna, conferido em ${selectedEntry.monthly.verifiedAt}. Não foi possível ler a página do fornecedor agora.`
                    : `From the built-in table, checked on ${selectedEntry.monthly.verifiedAt}. The vendor's page could not be read just now.`}
                </div>
              )}
              {selectedEntry && (pt ? selectedEntry.notePt : selectedEntry.noteEn) && (
                <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 6, lineHeight: 1.5 }}>
                  {pt ? selectedEntry.notePt : selectedEntry.noteEn}
                </div>
              )}
            </div>

            {draft.planId === 'other' && (
              <>
                <FieldInput
                  label={pt ? 'Nome do plano' : 'Plan name'}
                  value={draft.label}
                  onChange={v => setDraft(d => (d ? { ...d, label: v } : d))}
                  placeholder={pt ? 'Ex.: gateway da empresa' : 'e.g. company gateway'}
                />
                <FieldError text={errorFor(['missing_label'])} />
              </>
            )}

            {draftWantsPrice(draft) && (
              <>
                <MoneyField
                  label={pt ? 'Valor por mês' : 'Amount per month'}
                  sub={pt
                    ? 'O que aparece na sua fatura. O valor sugerido pelo catálogo é só um ponto de partida.'
                    : 'What your invoice says. The catalog’s suggestion is only a starting point.'}
                  amount={draft.amount}
                  currency={draft.currency}
                  monthSuffix={pt ? '/mês' : '/mo'}
                  onAmountChange={v => setDraft(d => (d ? { ...d, amount: v } : d))}
                  onCurrencyChange={c => setDraft(d => (d ? { ...d, currency: c } : d))}
                />
                <FieldError text={errorFor(['missing_price', 'non_positive_price', 'price_on_non_subscription'])} />
              </>
            )}

            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
              <DateField
                label={pt ? 'Começou em' : 'Started on'}
                value={draft.from}
                max={today()}
                onChange={v => setDraft(d => (d ? { ...d, from: v } : d))}
              />
              {!draft.ongoing && (
                <DateField
                  label={pt ? 'Terminou em' : 'Ended on'}
                  value={draft.to}
                  max={today()}
                  onChange={v => setDraft(d => (d ? { ...d, to: v } : d))}
                />
              )}
            </div>
            <FieldError text={errorFor(['missing_from', 'bad_day', 'inverted_range'])} />

            <div style={{ marginTop: 4, marginBottom: 12 }}>
              <Checkbox
                checked={draft.ongoing}
                onChange={v => setDraft(d => (d ? { ...d, ongoing: v } : d))}
                label={pt ? 'Ainda pago este plano' : 'I still pay for this plan'}
              />
            </div>

            <FieldError text={errorFor(['overlap'])} />
          </div>
        )}
      </Drawer>

      <ConfirmModal
        open={confirmDelete !== null}
        title={pt ? 'Remover período' : 'Remove period'}
        message={pt
          ? `Remover "${confirmDelete ? periodName(confirmDelete) : ''}"? Os dias que ele cobria deixam de contar para o custo do plano.`
          : `Remove “${confirmDelete ? periodName(confirmDelete) : ''}”? The days it covered will stop counting towards the plan cost.`}
        confirmLabel={pt ? 'Remover' : 'Remove'}
        cancelLabel={pt ? 'Cancelar' : 'Cancel'}
        onConfirm={async () => {
          if (confirmDelete) await persist(periods.filter(p => p.id !== confirmDelete.id))
          setConfirmDelete(null)
        }}
        onCancel={() => setConfirmDelete(null)}
      />
    </div>
  )
}

function modeLabel(mode: BillingPeriod['mode'], pt: boolean): string {
  switch (mode) {
    case 'subscription': return pt ? 'Assinatura' : 'Subscription'
    case 'api': return pt ? 'Por token' : 'Per token'
    case 'thirdparty': return pt ? 'Terceiro' : 'Third party'
    default: return pt ? 'Desconhecida' : 'Unknown'
  }
}

/**
 * Errors render inline under their field, never as a toast: on a phone this form is a full-screen
 * drawer, and a toast over it is read once and cannot be re-read.
 *
 * No negative margin. It had `marginTop: -8` tuned against `FieldInput`'s own bottom margin, which
 * the `Select` above it does not have — so the message landed on top of the control it was about.
 */
function FieldError({ text }: { text: string | null }) {
  if (!text) return null
  return (
    <div style={{ fontSize: 11.5, color: 'var(--accent-red)', margin: '-6px 0 12px', lineHeight: 1.45 }}>
      {text}
    </div>
  )
}

/**
 * The amount field: currency symbol inside the box, live grouping, currency picker attached.
 *
 * The symbol and the separators are part of the field rather than a label beside it, because the
 * question "am I typing dollars or reais" has to be answerable without looking away from what you
 * are typing — and the two are five-to-one apart, which is not a mistake anyone catches by
 * re-reading a total later.
 *
 * The stored value stays canonical (dot decimal, no grouping); only the display is formatted.
 * `parseAmountInput` is a fixed point over that display, so re-parsing what the field shows on
 * every keystroke is safe — see its test.
 */
function MoneyField({ label, sub, amount, currency, monthSuffix, onAmountChange, onCurrencyChange }: {
  label: string
  sub?: string
  amount: string
  currency: BillingCurrency
  /** "/mo" or "/mês" — this followed the currency instead of the language and read as Portuguese
   *  inside an English form. */
  monthSuffix: string
  onAmountChange: (v: string) => void
  onCurrencyChange: (c: BillingCurrency) => void
}) {
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 2 }}>{label}</div>
      {sub && <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginBottom: 5, lineHeight: 1.45 }}>{sub}</div>}
      <div style={{ display: 'flex', gap: 8, alignItems: 'stretch' }}>
        <div style={{
          flex: 1, display: 'flex', alignItems: 'center', gap: 6,
          border: '1px solid var(--border)', borderRadius: 'var(--radius-md)',
          background: 'var(--bg-input)', padding: '0 11px',
        }}>
          <span style={{ color: 'var(--text-tertiary)', fontWeight: 600, flexShrink: 0 }}>
            {currencySymbol(currency)}
          </span>
          <input
            inputMode="decimal"
            value={formatAmountDisplay(amount, currency)}
            onChange={e => onAmountChange(parseAmountInput(e.target.value))}
            placeholder={currency === 'BRL' ? '540,00' : '100.00'}
            // No inline fontSize — the global >=16px guard in index.css is what stops iOS Safari
            // zooming the viewport and breaking the sticky header.
            style={{
              flex: 1, minWidth: 0, padding: '9px 0', border: 'none', outline: 'none',
              background: 'transparent', color: 'var(--text-primary)', fontFamily: 'inherit',
            }}
          />
          <span style={{ fontSize: 11, color: 'var(--text-tertiary)', flexShrink: 0 }}>{monthSuffix}</span>
        </div>
        <div style={{ flexShrink: 0 }}>
          <TabSelect
            options={[{ value: 'USD', label: 'USD' }, { value: 'BRL', label: 'BRL' }]}
            value={currency}
            onChange={v => onCurrencyChange(v as BillingCurrency)}
          />
        </div>
      </div>
    </div>
  )
}

/** A native date picker. No inline `fontSize` — the global ≥16px guard in index.css is what stops
 *  iOS Safari zooming the viewport and breaking the sticky header. */
function DateField({ label, value, max, onChange }: {
  label: string
  value: string
  max: string
  onChange: (v: string) => void
}) {
  return (
    <div style={{ flex: '1 1 150px', marginBottom: 14 }}>
      <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 5 }}>{label}</div>
      <input
        type="date"
        value={value}
        max={max}
        onChange={e => onChange(e.target.value)}
        style={{
          width: '100%', padding: '9px 11px', borderRadius: 'var(--radius-md)',
          border: '1px solid var(--border)', background: 'var(--bg-input)',
          color: 'var(--text-primary)', fontFamily: 'inherit',
        }}
      />
    </div>
  )
}

const cellPad = { padding: '9px 12px', textAlign: 'left' as const }
const iconBtn: React.CSSProperties = {
  background: 'none', border: 'none', cursor: 'pointer', padding: 6,
  color: 'var(--text-tertiary)', display: 'inline-flex', alignItems: 'center',
}

function Th({ children, align }: { children: React.ReactNode; align?: 'right' }) {
  return (
    <th style={{ ...cellPad, textAlign: align ?? 'left', fontSize: 11, fontWeight: 600, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: 0.3 }}>
      {children}
    </th>
  )
}
function Td({ children, align }: { children: React.ReactNode; align?: 'right' }) {
  return <td style={{ ...cellPad, textAlign: align ?? 'left', color: 'var(--text-secondary)' }}>{children}</td>
}
