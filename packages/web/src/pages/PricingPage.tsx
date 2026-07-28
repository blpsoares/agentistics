import { useEffect, useMemo, useState } from 'react'
import { useOutletContext } from 'react-router-dom'
import { DollarSign, ExternalLink, AlertTriangle } from 'lucide-react'
import type { AppContext } from '../lib/app-context'
import { Section } from '../components/Section'
import { useIsMobile } from '../hooks/useIsMobile'

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
  communityFetchedAt: number
  communityOk: boolean
  sources: Record<'official' | 'community', { label: string; url: string }>
}

/** Where a row's number came from, which is the whole point of the page: a price shown without its
 *  provenance invites the reader to trust a stale table as if it were the vendor's own. */
const ORIGIN_STYLE: Record<Origin, { color: string; en: string; pt: string }> = {
  official:  { color: '#22c55e', en: 'Official',  pt: 'Oficial' },
  community: { color: '#3b82f6', en: 'Community', pt: 'Comunidade' },
  builtin:   { color: '#a1a1aa', en: 'Built-in',  pt: 'Local' },
}

const fmtPrice = (v: number): string =>
  v >= 1 ? `$${v.toFixed(2)}` : `$${v.toFixed(v < 0.01 ? 4 : 3)}`

const ago = (ms: number, pt: boolean): string => {
  if (!ms) return pt ? 'nunca' : 'never'
  const mins = Math.max(0, Math.round((Date.now() - ms) / 60_000))
  if (mins < 1) return pt ? 'agora' : 'just now'
  if (mins < 60) return pt ? `há ${mins} min` : `${mins} min ago`
  const h = Math.round(mins / 60)
  return pt ? `há ${h}h` : `${h}h ago`
}

export default function PricingPage() {
  const { data, lang } = useOutletContext<AppContext>()
  const pt = lang === 'pt'
  const isMobile = useIsMobile()
  const [resp, setResp] = useState<PricingResponse | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [showAll, setShowAll] = useState(false)

  useEffect(() => {
    let alive = true
    void (async () => {
      try {
        const r = await fetch('/api/pricing')
        if (!r.ok || !(r.headers.get('content-type') ?? '').includes('json')) {
          throw new Error(`HTTP ${r.status}`)
        }
        const json = await r.json() as PricingResponse
        if (alive) setResp(json)
      } catch (e) { if (alive) setErr(String(e)) }
    })()
    return () => { alive = false }
  }, [])

  /** Every model that actually appears in this machine's sessions. These are the rows that decide
   *  the numbers on every other page, so they are listed first and by default. */
  const mine = useMemo(() => {
    const set = new Set<string>()
    for (const s of data.sessions) {
      if (s.model_usage) for (const m of Object.keys(s.model_usage)) set.add(m)
      else if (s.model) set.add(s.model)
    }
    return set
  }, [data.sessions])

  const byId = useMemo(() => new Map((resp?.models ?? []).map(m => [m.id, m])), [resp])

  /** A model of yours that no row can price — it lands on the shared default, the failure that
   *  understated 39 sessions here by 40% with nothing on screen to show for it.
   *
   *  Mirrors getModelPrice's resolution deliberately: a suffixed id like `claude-opus-4-6-thinking`
   *  or `gemini-3.6-flash-tiered` IS priced, by the longest row that prefixes it, and flagging
   *  those as unpriced would cry wolf on the very rows that work. */
  const unpriced = useMemo(() => {
    const ids = [...byId.keys()]
    const resolves = (m: string): boolean =>
      byId.has(m) || ids.some(k => m.startsWith(k)) || ids.some(k => k.startsWith(m))
    return [...mine].filter(m => !resolves(m)).sort()
  }, [mine, byId])

  const rows = useMemo(() => {
    const all = resp?.models ?? []
    return showAll ? all : all.filter(m => mine.has(m.id))
  }, [resp, showAll, mine])

  if (err) {
    return (
      <Section title={pt ? 'Preços' : 'Pricing'}>
        <div style={{ fontSize: 13, color: 'var(--text-tertiary)' }}>
          {pt ? 'Não foi possível carregar a tabela de preços.' : 'Could not load the pricing table.'} {err}
        </div>
      </Section>
    )
  }

  return (
    <>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 4 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 18, fontWeight: 700, color: 'var(--text-primary)' }}>
          <span style={{ color: 'var(--anthropic-orange)' }}><DollarSign size={16} /></span>
          {pt ? 'Preços por modelo' : 'Model pricing'}
        </div>
        <div style={{ fontSize: 12, color: 'var(--text-tertiary)', lineHeight: 1.5 }}>
          {pt
            ? 'As tarifas usadas para calcular todo custo do dashboard, com a origem de cada linha. USD por 1M de tokens.'
            : 'The rates behind every cost in this dashboard, with the origin of each row. USD per 1M tokens.'}
        </div>
      </div>

      {unpriced.length > 0 && (
        <Section title={<><AlertTriangle size={14} /> {pt ? 'Sem preço próprio' : 'No price of their own'}</>}>
          <div style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.6 }}>
            {pt
              ? 'Estes modelos aparecem nas suas sessões mas nenhuma fonte os lista. Eles usam a tarifa padrão, então o custo deles é uma aproximação — não um cálculo.'
              : 'These models appear in your sessions but no source lists them. They fall back to the default rate, so their cost is an approximation, not a calculation.'}
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 10 }}>
            {unpriced.map(m => (
              <code key={m} style={{
                fontSize: 12, padding: '4px 8px', borderRadius: 6,
                background: 'var(--bg-elevated)', color: '#f59e0b', border: '1px solid #f59e0b44',
              }}>{m}</code>
            ))}
          </div>
        </Section>
      )}

      <Section
        title={pt ? 'Tarifas' : 'Rates'}
        action={
          <button
            onClick={() => setShowAll(v => !v)}
            style={{
              border: '1px solid var(--border)', background: 'var(--bg-elevated)', borderRadius: 7,
              padding: isMobile ? '10px 12px' : '6px 10px', minHeight: isMobile ? 44 : undefined,
              fontSize: 12, color: 'var(--text-secondary)', cursor: 'pointer', fontFamily: 'inherit',
            }}>
            {showAll
              ? (pt ? 'Só os meus modelos' : 'Only my models')
              : (pt ? `Ver todos (${resp?.models.length ?? 0})` : `Show all (${resp?.models.length ?? 0})`)}
          </button>
        }
      >
        {!resp
          ? <div style={{ fontSize: 13, color: 'var(--text-tertiary)' }}>{pt ? 'Carregando…' : 'Loading…'}</div>
          : (
            <>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginBottom: 12, fontSize: 11.5, color: 'var(--text-tertiary)' }}>
                {(['official', 'community', 'builtin'] as const).map(o => (
                  <span key={o} style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                    <span style={{ width: 8, height: 8, borderRadius: '50%', background: ORIGIN_STYLE[o].color }} />
                    {pt ? ORIGIN_STYLE[o].pt : ORIGIN_STYLE[o].en}
                    {o !== 'builtin' && resp.sources[o] && (
                      <a href={resp.sources[o]!.url} target="_blank" rel="noreferrer"
                        style={{ color: 'var(--text-tertiary)', display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                        {resp.sources[o]!.label} <ExternalLink size={10} />
                      </a>
                    )}
                  </span>
                ))}
                <span>· {pt ? 'atualizado' : 'updated'} {ago(resp.fetchedAt, pt)}</span>
                {!resp.communityOk && (
                  <span style={{ color: '#f59e0b' }}>
                    · {pt ? 'fonte da comunidade indisponível — usando o último resultado bom' : 'community source unavailable — using the last good result'}
                  </span>
                )}
              </div>

              {/* Wide table scrolls inside its own container, never the page body. */}
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5, minWidth: 520 }}>
                  <thead>
                    <tr style={{ textAlign: 'left', color: 'var(--text-tertiary)' }}>
                      <th style={{ padding: '6px 8px' }}>{pt ? 'Modelo' : 'Model'}</th>
                      <th style={{ padding: '6px 8px', textAlign: 'right' }}>{pt ? 'Entrada' : 'Input'}</th>
                      <th style={{ padding: '6px 8px', textAlign: 'right' }}>{pt ? 'Cache' : 'Cache read'}</th>
                      <th style={{ padding: '6px 8px', textAlign: 'right' }}>{pt ? 'Saída' : 'Output'}</th>
                      <th style={{ padding: '6px 8px' }}>{pt ? 'Origem' : 'Origin'}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map(m => (
                      <tr key={m.id} style={{ borderTop: '1px solid var(--border)' }}>
                        <td style={{ padding: '6px 8px', color: 'var(--text-primary)' }}>
                          <code style={{ fontSize: 12 }}>{m.id}</code>
                          {mine.has(m.id) && showAll && (
                            <span style={{ marginLeft: 6, fontSize: 10, color: 'var(--anthropic-orange)' }}>
                              {pt ? '· seu' : '· yours'}
                            </span>
                          )}
                        </td>
                        <td style={{ padding: '6px 8px', textAlign: 'right' }}>{fmtPrice(m.input)}</td>
                        <td style={{ padding: '6px 8px', textAlign: 'right', color: 'var(--text-tertiary)' }}>{fmtPrice(m.cacheRead)}</td>
                        <td style={{ padding: '6px 8px', textAlign: 'right' }}>{fmtPrice(m.output)}</td>
                        <td style={{ padding: '6px 8px' }}>
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, color: ORIGIN_STYLE[m.origin].color }}>
                            <span style={{ width: 7, height: 7, borderRadius: '50%', background: ORIGIN_STYLE[m.origin].color }} />
                            {pt ? ORIGIN_STYLE[m.origin].pt : ORIGIN_STYLE[m.origin].en}
                          </span>
                        </td>
                      </tr>
                    ))}
                    {rows.length === 0 && (
                      <tr><td colSpan={5} style={{ padding: '10px 8px', color: 'var(--text-tertiary)' }}>
                        {pt ? 'Nenhum modelo.' : 'No models.'}
                      </td></tr>
                    )}
                  </tbody>
                </table>
              </div>

              <div style={{ marginTop: 14, fontSize: 11.5, color: 'var(--text-tertiary)', lineHeight: 1.6 }}>
                {pt
                  ? 'O custo mostrado é o equivalente em API. Assinaturas (Claude Max, Copilot, Codex) não cobram por token, então o valor é "quanto isto custaria pela API", não a sua fatura.'
                  : 'Cost is the API equivalent. Subscriptions (Claude Max, Copilot, Codex) do not bill per token, so the figure is what this would cost through the API, not your invoice.'}
              </div>
            </>
          )}
      </Section>
    </>
  )
}

