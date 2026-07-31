import React from 'react'
import { Check, Circle } from 'lucide-react'
import { passwordChecks, passwordRuleText, type Lang } from '@agentistics/core'

/**
 * The password rule, stated where it is typed.
 *
 * It used to be discoverable only by being refused — and the refusals named one rule at a time,
 * so satisfying one revealed the next. Someone tried fifteen passwords against a message that
 * said "password is too common". A rule the user cannot read is a rule the user cannot follow.
 *
 * Ticks light up as each requirement is met, using the SAME function the server validates with
 * (`@agentistics/core`), so the form cannot promise something the server will refuse.
 */
export function PasswordHint({ value, lang = 'en' }: { value: string; lang?: Lang }) {
  const pt = lang === 'pt'
  const c = passwordChecks(value)
  const items: [boolean, string][] = [
    [!c.too_short, pt ? '8 caracteres' : '8 characters'],
    [!c.no_uppercase, pt ? '1 letra maiúscula' : '1 uppercase letter'],
    [!c.no_symbol, pt ? '1 caractere especial' : '1 symbol'],
  ]
  // Before anything is typed, the rule reads as one sentence; once typing starts it becomes a
  // checklist, which is the form that answers "what is still missing".
  if (!value) {
    return (
      <div style={{ fontSize: 11, color: 'var(--text-tertiary)', margin: '-6px 0 12px', lineHeight: 1.5 }}>
        {passwordRuleText(pt ? 'pt' : 'en')}
      </div>
    )
  }
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, margin: '-6px 0 12px' }}>
      {items.map(([done, label]) => (
        <span key={label} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, color: done ? '#22c55e' : 'var(--text-tertiary)' }}>
          {done ? <Check size={11} /> : <Circle size={9} />} {label}
        </span>
      ))}
    </div>
  )
}
