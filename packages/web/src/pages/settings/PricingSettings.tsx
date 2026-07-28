import { useEffect, useMemo, useState } from 'react'
import { useOutletContext } from 'react-router-dom'
import { ExternalLink, AlertTriangle } from 'lucide-react'
import { resolveProvider, providerOrder, type ProviderId } from '@agentistics/core'
import type { AppContext } from '../../lib/app-context'
import { HARNESS_COLORS, HARNESS_LABELS } from '../../lib/harness'
import { useIsMobile } from '../../hooks/useIsMobile'
import type { HarnessId } from '@agentistics/core'

type Origin = 'official' | 'community' | 'builtin'

interface PricedRow {
  id: string
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
  origin: Origin
}

interface PricingResponse {
  models: PricedRow[]
  fetchedAt: number
  communityOk: boolean
  sources: Record<'official' | 'community', { label: string; url: string }>
}

const ORIGIN: Record<Origin, { color: string; en: string; pt: string; whyEn: string; whyPt: string }> = {
  official: {
    color: '#22c55e', en: 'Official', pt: 'Oficial',
    whyEn: "Read from the vendor's own pricing page.",
    whyPt: 'Lido da página de preços do próprio fabricante.',
  },
  community: {
    color: '#3b82f6', en: 'Community', pt: 'Comunidade',
    whyEn: 'From the LiteLLM dataset, validated before use.',
    whyPt: 'Do dataset LiteLLM, validado antes de usar.',
  },
  builtin: {
    color: '#a1a1aa', en: 'Built-in', pt: 'Local',
    whyEn: 'The table compiled into agentistics — no live source listed this model.',
    whyPt: 'A tabela compilada no agentistics — nenhuma fonte ao vivo listou este modelo.',
  },
}

const fmt = (v: number): string => (v >= 1 ? `$${v.toFixed(2)}` : `$${v.toFixed(v < 0.01 ? 4 : 3)}`)

const ago = (ms: number, pt: boolean): string => {
  if (!ms) return pt ? 'nunca' : 'never'
  const mins = Math.max(0, Math.round((Date.now() - ms) / 60_000))
  if (mins < 1) return pt ? 'agora' : 'just now'
  if (mins < 60) return pt ? `há ${mins} min` : `${mins} min ago`
  return pt ? `há ${Math.round(mins / 60)}h` : `${Math.round(mins / 60)}h ago`
}

export default function PricingSettings() {
  const { data, lang } = useOutletContext<AppContext>()
  const pt = lang === 'pt'
  const isMobile = useIsMobile()
  const [resp, setResp] = useState<PricingResponse | null>(null)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    void (async () => {
      try {
        const r = await fetch('/api/pricing')
        if (!r.ok || !(r.headers.get('content-type') ?? '').includes('json')) throw new Error(`HTTP ${r.status}`)
        const json = await r.json() as PricingResponse
        if (alive) setResp(json)
      } catch (e) { if (alive) setErr(String(e)) }
    })()
    return () => { alive = false }
  }, [])

  /** Models this machine has actually run, and which harnesses ran them. The table shows ONLY
   *  these: a price list of a thousand models nobody here uses is a catalogue, not a statement
   *  about your costs. A model appears the first time it is used, with no code change — the id
   *  comes from the sessions, and the rate from whichever source lists it. */
  const usedBy = useMemo(() => {
    const map = new Map<string, Set<HarnessId>>()
    const add = (model: string, h: HarnessId) => {
      if (!model) return
      const set = map.get(model) ?? new Set<HarnessId>()
      set.add(h)
      map.set(model, set)
    }
    for (const s of data.sessions) {
      if (s.model_usage) for (const m of Object.keys(s.model_usage)) add(m, s.harness)
      else if (s.model) add(s.model, s.harness)
    }
    return map
  }, [data.sessions])

  const byId = useMemo(() => new Map((resp?.models ?? []).map(m => [m.id, m])), [resp])

  /** Resolve a used model to its row the same way the cost maths does: exact, then the longest row
   *  that prefixes it (so `gemini-3.6-flash-tiered` is priced by `gemini-3.6-flash`). */
  const rowFor = useMemo(() => {
    const ids = [...byId.keys()]
    return (model: string): PricedRow | null => {
      const exact = byId.get(model)
      if (exact) return exact
      const prefix = ids.filter(k => model.startsWith(k)).sort((a, b) => b.length - a.length)[0]
      return prefix ? byId.get(prefix)! : null
    }
  }, [byId])

  const groups = useMemo(() => {
    const out = new Map<ProviderId, Array<{ model: string; row: PricedRow | null; harnesses: HarnessId[] }>>()
    for (const [model, hs] of usedBy) {
      const p = resolveProvider(model).id
      const list = out.get(p) ?? []
      list.push({ model, row: rowFor(model), harnesses: [...hs].sort() })
      out.set(p, list)
    }
    for (const list of out.values()) list.sort((a, b) => a.model.localeCompare(b.model))
    return out
  }, [usedBy, rowFor])

  const unpriced = useMemo(
    () => [...usedBy.keys()].filter(m => !rowFor(m)).sort(),
    [usedBy, rowFor],
  )

  if (err) {
    return <div style={{ fontSize: 13, color: 'var(--text-tertiary)' }}>
      {pt ? 'Não foi possível carregar os preços.' : 'Could not load pricing.'} {err}
    </div>
  }
  if (!resp) {
    return <div style={{ fontSize: 13, color: 'var(--text-tertiary)' }}>{pt ? 'Carregando…' : 'Loading…'}</div>
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      <div>
        <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-primary)' }}>
          {pt ? 'Preços por modelo' : 'Model pricing'}
        </div>
        <div style={{ fontSize: 12, color: 'var(--text-tertiary)', lineHeight: 1.6, marginTop: 4 }}>
          {pt
            ? 'As tarifas que calculam todo custo do dashboard, em USD por 1M de tokens. Só aparecem os modelos que você já usou — um modelo novo entra na lista sozinho, na primeira vez que for usado.'
            : 'The rates behind every cost in this dashboard, in USD per 1M tokens. Only models you have actually used are listed — a new one joins the list by itself, the first time it is used.'}
        </div>
        <div style={{ fontSize: 11.5, color: 'var(--text-tertiary)', marginTop: 8 }}>
          {pt ? 'atualizado' : 'updated'} {ago(resp.fetchedAt, pt)}
          {!resp.communityOk && (
            <span style={{ color: '#f59e0b' }}>
              {' · '}{pt ? 'fonte da comunidade indisponível, usando o último resultado bom' : 'community source unavailable, using the last good result'}
            </span>
          )}
        </div>
      </div>

      {unpriced.length > 0 && (
        <div style={{ border: '1px solid #f59e0b44', background: '#f59e0b11', borderRadius: 10, padding: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 13, fontWeight: 600, color: '#f59e0b' }}>
            <AlertTriangle size={14} /> {pt ? 'Sem tarifa própria' : 'No rate of their own'}
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.6, marginTop: 6 }}>
            {pt
              ? 'Nenhuma fonte lista estes modelos, então eles usam a tarifa padrão: o custo deles é aproximação, não cálculo.'
              : 'No source lists these models, so they fall back to the default rate: their cost is an approximation, not a calculation.'}
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
            {unpriced.map(m => <code key={m} style={{ fontSize: 11.5 }}>{m}</code>)}
          </div>
        </div>
      )}

      {providerOrder().map(prov => {
        const rows = groups.get(prov.id)
        if (!rows || rows.length === 0) return null
        return (
          <div key={prov.id}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
              <span style={{ fontSize: 13.5, fontWeight: 700, color: 'var(--text-primary)' }}>{prov.label}</span>
              <span style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>
                {rows.length} {rows.length === 1 ? (pt ? 'modelo' : 'model') : (pt ? 'modelos' : 'models')}
              </span>
              {prov.pricingUrl && (
                <a href={prov.pricingUrl} target="_blank" rel="noreferrer"
                  style={{ fontSize: 11, color: 'var(--text-tertiary)', display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                  {pt ? 'tabela oficial' : 'official table'} <ExternalLink size={10} />
                </a>
              )}
            </div>

            <div style={{ overflowX: 'auto', border: '1px solid var(--border)', borderRadius: 10 }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5, minWidth: 460 }}>
                <thead>
                  <tr style={{ textAlign: 'left', color: 'var(--text-tertiary)', background: 'var(--bg-elevated)' }}>
                    <th style={{ padding: '8px 10px', fontWeight: 600 }}>{pt ? 'Modelo' : 'Model'}</th>
                    <th style={{ padding: '8px 10px', fontWeight: 600, textAlign: 'right' }}>{pt ? 'Entrada' : 'Input'}</th>
                    <th style={{ padding: '8px 10px', fontWeight: 600, textAlign: 'right' }}>{pt ? 'Cache' : 'Cache'}</th>
                    <th style={{ padding: '8px 10px', fontWeight: 600, textAlign: 'right' }}>{pt ? 'Saída' : 'Output'}</th>
                    <th style={{ padding: '8px 10px', fontWeight: 600 }}>{pt ? 'Fonte' : 'Source'}</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map(({ model, row, harnesses }) => (
                    <tr key={model} style={{ borderTop: '1px solid var(--border)' }}>
                      <td style={{ padding: '8px 10px' }}>
                        <code style={{ fontSize: 12, color: 'var(--text-primary)' }}>{model}</code>
                        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 4 }}>
                          {harnesses.map(h => (
                            <span key={h} style={{
                              fontSize: 9.5, padding: '1px 5px', borderRadius: 999, whiteSpace: 'nowrap',
                              color: HARNESS_COLORS[h], border: `1px solid ${HARNESS_COLORS[h]}66`,
                            }}>{HARNESS_LABELS[h]}</span>
                          ))}
                        </div>
                      </td>
                      <td style={{ padding: '8px 10px', textAlign: 'right', whiteSpace: 'nowrap' }}>{row ? fmt(row.input) : '—'}</td>
                      <td style={{ padding: '8px 10px', textAlign: 'right', whiteSpace: 'nowrap', color: 'var(--text-tertiary)' }}>{row ? fmt(row.cacheRead) : '—'}</td>
                      <td style={{ padding: '8px 10px', textAlign: 'right', whiteSpace: 'nowrap' }}>{row ? fmt(row.output) : '—'}</td>
                      <td style={{ padding: '8px 10px' }}>
                        {row
                          ? <span title={pt ? ORIGIN[row.origin].whyPt : ORIGIN[row.origin].whyEn}
                              style={{ display: 'inline-flex', alignItems: 'center', gap: 5, color: ORIGIN[row.origin].color, whiteSpace: 'nowrap' }}>
                              <span style={{ width: 7, height: 7, borderRadius: '50%', background: ORIGIN[row.origin].color }} />
                              {pt ? ORIGIN[row.origin].pt : ORIGIN[row.origin].en}
                            </span>
                          : <span style={{ color: '#f59e0b' }}>{pt ? 'padrão' : 'fallback'}</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )
      })}

      <div style={{ fontSize: 11.5, color: 'var(--text-tertiary)', lineHeight: 1.6, paddingBottom: isMobile ? 8 : 0 }}>
        {pt
          ? 'O custo é o equivalente em API. Assinaturas (Claude Max, Copilot, Codex) não cobram por token, então o valor é quanto isto custaria pela API — não a sua fatura.'
          : 'Cost is the API equivalent. Subscriptions (Claude Max, Copilot, Codex) do not bill per token, so the figure is what this would cost through the API, not your invoice.'}
      </div>
    </div>
  )
}
