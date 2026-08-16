import React from 'react'
import type { CostBasis } from '@agentistics/core'

/**
 * The API ⇄ Plan switch.
 *
 * The gate lives here, not at each call site: when the plan basis cannot be computed the control
 * is DISABLED and pressing it opens the setup prompt. A control that is enabled and then silently
 * renders N/A teaches people the feature is broken; a disabled one that says what it needs teaches
 * them how to turn it on. It never simply does nothing — a dead click is the worst of the three.
 */
export function CostBasisToggle({ basis, ready, onChange, onSetup, lang, title }: {
  basis: CostBasis
  /** The plan basis is computable for the current scope. */
  ready: boolean
  onChange: (b: CostBasis) => void
  /** Opens the billing setup prompt. Called instead of `onChange` while `ready` is false. */
  onSetup: () => void
  lang: 'pt' | 'en'
  title?: string
}) {
  const pt = lang === 'pt'
  const active = basis === 'plan'
  const label = active ? (pt ? 'PLANO' : 'PLAN') : 'API'
  const hint = ready
    ? (active
        ? (pt ? 'Ver em preços de API' : 'Show API pricing')
        : (pt ? 'Ver no custo do seu plano' : 'Show your plan cost'))
    : (pt ? 'Cadastre seu plano para ver o custo real' : 'Register your plan to see the real cost')

  return (
    <button
      onClick={() => (ready ? onChange(active ? 'api' : 'plan') : onSetup())}
      title={title ?? hint}
      aria-label={hint}
      style={{
        fontSize: 10, fontWeight: 700, padding: '2px 6px', borderRadius: 4,
        border: `1px solid ${active ? 'var(--anthropic-orange)' : 'var(--border)'}`,
        background: active ? 'var(--anthropic-orange-dim)' : 'transparent',
        color: ready
          ? (active ? 'var(--anthropic-orange)' : 'var(--text-tertiary)')
          : 'var(--text-quaternary, var(--text-tertiary))',
        opacity: ready ? 1 : 0.55,
        cursor: 'pointer', fontFamily: 'inherit', transition: 'all 0.15s', letterSpacing: '0.03em',
        whiteSpace: 'nowrap',
      }}
    >
      {label}
    </button>
  )
}
