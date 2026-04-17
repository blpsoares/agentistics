import React from 'react'
import { Zap, Lightbulb, TrendingDown, TrendingUp, Info } from 'lucide-react'
import { formatModel, getModelColor } from '../lib/types'
import type { Lang } from '../lib/types'

interface Props {
  hitRate: number
  cacheTotals: {
    inputTokens: number
    cacheReadInputTokens: number
    cacheCreationInputTokens: number
  }
  grossSavedUSD: number
  writeOverheadUSD: number
  netSavedUSD: number
  perModel: Record<string, { hitRate: number; cacheReadTokens: number; inputTokens: number }>
  currency: 'USD' | 'BRL'
  brlRate: number
  lang: Lang
}

function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`
  return String(n)
}

function fmtCost(usd: number, currency: 'USD' | 'BRL', rate: number): string {
  if (currency === 'BRL') {
    const brl = usd * rate
    if (Math.abs(brl) < 0.005) return 'R$0,00'
    return `R$${brl.toFixed(2).replace('.', ',')}`
  }
  if (Math.abs(usd) < 0.01) return 'USD 0.00'
  return `USD ${usd.toFixed(2)}`
}

type Tier = 'low' | 'medium' | 'high'

function getTier(rate: number): Tier {
  if (rate < 0.3) return 'low'
  if (rate < 0.6) return 'medium'
  return 'high'
}

function tierColor(tier: Tier): string {
  if (tier === 'low') return '#ef4444'
  if (tier === 'medium') return '#f59e0b'
  return 'var(--accent-green, #22c55e)'
}

function tierLabel(tier: Tier, pt: boolean): string {
  if (tier === 'low') return pt ? 'Baixo' : 'Low'
  if (tier === 'medium') return pt ? 'Razoável' : 'Fair'
  return pt ? 'Excelente' : 'Excellent'
}

const TIPS = {
  low: {
    pt: [
      'Cache hit baixo significa que o Claude está relendo boa parte do contexto em cada turno e você está pagando preço cheio por isso.',
      'Evite reiniciar sessões muito cedo — cache só é válido por alguns minutos; continuar a mesma conversa amortiza o custo do write.',
      'Mantenha o CLAUDE.md estável. Toda mudança invalida o cache do prefixo do prompt.',
      'Agrupe perguntas curtas na mesma sessão em vez de abrir várias novas.',
    ],
    en: [
      'Low cache hit means Claude is re-reading most of the context each turn and you\'re paying full price for it.',
      'Avoid restarting sessions too early — cache only lives a few minutes; continuing the same chat amortises the write cost.',
      'Keep CLAUDE.md stable. Every change invalidates the cached prompt prefix.',
      'Group short questions in the same session instead of opening new ones.',
    ],
  },
  medium: {
    pt: [
      'Cache está ajudando, mas dá pra extrair mais. Sessões mais longas no mesmo projeto tendem a elevar a taxa.',
      'Arquivos lidos repetidamente (como CLAUDE.md ou arquivos grandes de contexto) se beneficiam muito do cache — vale mantê-los estáveis.',
      'Skills e subagents compartilham o prefixo cacheado da conversa principal, então usá-los em uma sessão já aquecida é barato.',
    ],
    en: [
      'Cache is helping but you can squeeze out more. Longer sessions in the same project tend to push the rate up.',
      'Files re-read often (like CLAUDE.md or big context files) benefit a lot from cache — keep them stable.',
      'Skills and subagents share the cached prefix of the main conversation, so using them in an already-warm session is cheap.',
    ],
  },
  high: {
    pt: [
      'Ótimo aproveitamento. Seu contexto (CLAUDE.md, arquivos de referência) está sendo reutilizado de forma eficiente.',
      'Cache read custa ~10× menos que input normal — cada ponto percentual acima de 60% é dinheiro que você não está gastando.',
      'Continue usando sessões longas e CLAUDE.md estável. Só vale invalidar o cache quando há mudança real de contexto.',
    ],
    en: [
      'Great utilisation. Your context (CLAUDE.md, reference files) is being reused efficiently.',
      'Cache read costs ~10× less than regular input — every percentage point above 60% is money you\'re not spending.',
      'Keep using long sessions and a stable CLAUDE.md. Only bust the cache when context really changes.',
    ],
  },
} as const

export function CacheHitRatePanel({
  hitRate,
  cacheTotals,
  grossSavedUSD,
  writeOverheadUSD,
  netSavedUSD,
  perModel,
  currency,
  brlRate,
  lang,
}: Props) {
  const pt = lang === 'pt'
  const totalRelevant = cacheTotals.inputTokens + cacheTotals.cacheReadInputTokens + cacheTotals.cacheCreationInputTokens

  if (totalRelevant === 0) {
    return (
      <div style={{
        padding: '32px 0',
        textAlign: 'center',
        color: 'var(--text-tertiary)',
        fontSize: 13,
      }}>
        <Zap size={16} style={{ opacity: 0.4, marginRight: 6, verticalAlign: 'middle' }} />
        {pt ? 'Sem dados de cache no período selecionado' : 'No cache data in the selected period'}
      </div>
    )
  }

  const tier = getTier(hitRate)
  const color = tierColor(tier)
  const tips = TIPS[tier][pt ? 'pt' : 'en']
  const pct = Math.round(hitRate * 100)

  const perModelEntries = Object.entries(perModel)
    .filter(([, v]) => v.inputTokens + v.cacheReadTokens > 0)
    .sort((a, b) => (b[1].cacheReadTokens + b[1].inputTokens) - (a[1].cacheReadTokens + a[1].inputTokens))

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      {/* Hero gauge */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: '240px 1fr',
        gap: 18,
        alignItems: 'stretch',
      }}>
        <div style={{
          background: 'var(--bg-elevated)',
          border: `1px solid ${color}33`,
          borderRadius: 12,
          padding: '16px 18px',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          gap: 8,
          position: 'relative',
          overflow: 'hidden',
        }}>
          <div style={{ fontSize: 10, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 600 }}>
            {pt ? 'Cache hit rate' : 'Cache hit rate'}
          </div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
            <span style={{ fontSize: 38, fontWeight: 700, color, lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>
              {pct}
            </span>
            <span style={{ fontSize: 18, fontWeight: 600, color, opacity: 0.7 }}>%</span>
            <span style={{
              marginLeft: 'auto',
              fontSize: 10,
              fontWeight: 700,
              padding: '3px 8px',
              borderRadius: 999,
              background: `${color}22`,
              color,
              textTransform: 'uppercase',
              letterSpacing: '0.04em',
            }}>
              {tierLabel(tier, pt)}
            </span>
          </div>
          <div style={{ height: 6, background: 'var(--bg-card)', borderRadius: 3, overflow: 'hidden', marginTop: 2 }}>
            <div style={{
              width: `${pct}%`,
              height: '100%',
              background: `linear-gradient(90deg, ${color}, ${color}cc)`,
              transition: 'width 0.6s ease',
            }} />
          </div>
          <div style={{ fontSize: 10, color: 'var(--text-tertiary)', marginTop: 2 }}>
            {pt
              ? `${fmtTokens(cacheTotals.cacheReadInputTokens)} de ${fmtTokens(cacheTotals.inputTokens + cacheTotals.cacheReadInputTokens)} tokens de input vieram do cache`
              : `${fmtTokens(cacheTotals.cacheReadInputTokens)} of ${fmtTokens(cacheTotals.inputTokens + cacheTotals.cacheReadInputTokens)} input tokens came from cache`}
          </div>
        </div>

        {/* Money impact */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(3, 1fr)',
          gap: 10,
        }}>
          <Stat
            label={pt ? 'Economia bruta' : 'Gross savings'}
            value={fmtCost(grossSavedUSD, currency, brlRate)}
            sub={pt ? 'vs. pagar como input normal' : 'vs. paying as regular input'}
            accent="var(--accent-green, #22c55e)"
            icon={<TrendingDown size={12} />}
          />
          <Stat
            label={pt ? 'Custo do write' : 'Write overhead'}
            value={fmtCost(writeOverheadUSD, currency, brlRate)}
            sub={pt ? 'prêmio pago para criar cache' : 'premium paid to create cache'}
            accent="#f59e0b"
            icon={<TrendingUp size={12} />}
          />
          <Stat
            label={pt ? 'Economia líquida' : 'Net savings'}
            value={fmtCost(netSavedUSD, currency, brlRate)}
            sub={pt ? 'no período selecionado' : 'in selected period'}
            accent={netSavedUSD >= 0 ? 'var(--anthropic-orange)' : '#ef4444'}
            icon={<Zap size={12} />}
          />
        </div>
      </div>

      {/* Per-model breakdown */}
      {perModelEntries.length > 1 && (
        <div>
          <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 8 }}>
            {pt ? 'Por modelo' : 'Per model'}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {perModelEntries.map(([modelId, v]) => {
              const mPct = Math.round(v.hitRate * 100)
              const mColor = getModelColor(modelId)
              return (
                <div key={modelId} style={{
                  display: 'grid',
                  gridTemplateColumns: '140px 1fr 60px',
                  gap: 10,
                  alignItems: 'center',
                  fontSize: 11,
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <div style={{ width: 8, height: 8, borderRadius: '50%', background: mColor, flexShrink: 0 }} />
                    <span style={{ color: 'var(--text-primary)', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {formatModel(modelId)}
                    </span>
                  </div>
                  <div style={{ position: 'relative', height: 5, background: 'var(--bg-elevated)', borderRadius: 3, overflow: 'hidden' }}>
                    <div style={{
                      position: 'absolute', left: 0, top: 0, bottom: 0,
                      width: `${mPct}%`,
                      background: mColor,
                      opacity: 0.7,
                      borderRadius: 3,
                    }} />
                  </div>
                  <span style={{ color: 'var(--text-primary)', fontWeight: 600, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                    {mPct}%
                  </span>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Tips */}
      <div style={{
        background: 'var(--bg-elevated)',
        border: '1px solid var(--border-subtle)',
        borderRadius: 10,
        padding: '12px 14px',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
          <Lightbulb size={13} style={{ color }} />
          <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary)' }}>
            {pt ? 'Como melhorar' : 'How to improve'}
          </span>
        </div>
        <ul style={{ margin: 0, paddingLeft: 20, display: 'flex', flexDirection: 'column', gap: 6 }}>
          {tips.map((tip, i) => (
            <li key={i} style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.5 }}>
              {tip}
            </li>
          ))}
        </ul>
      </div>

      {/* How it's calculated */}
      <div style={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: 6,
        fontSize: 10,
        color: 'var(--text-tertiary)',
        lineHeight: 1.5,
      }}>
        <Info size={11} style={{ flexShrink: 0, marginTop: 1, opacity: 0.6 }} />
        <span>
          {pt
            ? 'hit rate = cacheRead ÷ (input + cacheRead). Cache read cobrado a ~10% do preço de input. Cache write cobrado a ~125% do preço de input — criação vale a pena quando o prefixo é reusado ≥ 2 vezes.'
            : 'hit rate = cacheRead ÷ (input + cacheRead). Cache read is billed at ~10% of input price. Cache write is billed at ~125% of input price — creation pays off when the prefix is reused ≥ 2 times.'}
        </span>
      </div>
    </div>
  )
}

function Stat({ label, value, sub, accent, icon }: {
  label: string
  value: string
  sub: string
  accent: string
  icon: React.ReactNode
}) {
  return (
    <div style={{
      background: 'var(--bg-elevated)',
      border: '1px solid var(--border-subtle)',
      borderRadius: 10,
      padding: '12px 14px',
      display: 'flex',
      flexDirection: 'column',
      gap: 3,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 10, color: 'var(--text-tertiary)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
        <span style={{ color: accent, display: 'flex' }}>{icon}</span>
        {label}
      </div>
      <div style={{ fontSize: 18, fontWeight: 700, color: accent, lineHeight: 1.1 }}>
        {value}
      </div>
      <div style={{ fontSize: 10, color: 'var(--text-tertiary)' }}>{sub}</div>
    </div>
  )
}
