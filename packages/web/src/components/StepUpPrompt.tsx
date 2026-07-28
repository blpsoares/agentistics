import React, { useCallback, useEffect, useRef, useState } from 'react'
import { ShieldAlert, AlertCircle } from 'lucide-react'
import type { Lang } from '@agentistics/core'
import { setStepUpPrompter } from '../lib/stepup'

/**
 * Re-authentication dialog for destructive operations. Mounted once by App; `stepUpFetch`
 * opens it on demand through the prompter registered here, so no call site has to know it
 * exists — they just use stepUpFetch instead of fetch.
 *
 * Accepts either the account password or a TOTP code: an account with a second factor should be
 * able to prove presence with the thing already in their hand.
 */
export function StepUpPrompt({ lang }: { lang: Lang }) {
  const pt = lang === 'pt'
  const [open, setOpen] = useState(false)
  const [value, setValue] = useState('')
  const [useCode, setUseCode] = useState(false)
  const [error, setError] = useState(false)
  const resolver = useRef<((v: { password?: string; code?: string } | null) => void) | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const finish = useCallback((v: { password?: string; code?: string } | null) => {
    resolver.current?.(v)
    resolver.current = null
    setOpen(false)
    setValue('')
    setError(false)
  }, [])

  useEffect(() => {
    setStepUpPrompter(() => new Promise(resolve => {
      resolver.current = resolve
      setOpen(true)
      setTimeout(() => inputRef.current?.focus(), 50)
    }))
    return () => setStepUpPrompter(null)
  }, [])

  // A cancelled dialog must resolve, or the awaiting request would hang forever.
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') finish(null) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, finish])

  if (!open) return null

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!value.trim()) return
    finish(useCode ? { code: value.trim() } : { password: value })
  }

  return (
    <div onClick={() => finish(null)} style={overlay}>
      <form onClick={e => e.stopPropagation()} onSubmit={submit} style={card}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
          <span style={{ display: 'inline-flex', padding: 8, borderRadius: 9, background: 'var(--anthropic-orange-dim)', color: 'var(--anthropic-orange)' }}>
            <ShieldAlert size={16} />
          </span>
          <span style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-primary)' }}>
            {pt ? 'Confirme que é você' : 'Confirm it is you'}
          </span>
        </div>
        <div style={{ fontSize: 12, color: 'var(--text-secondary)', margin: '8px 0 14px' }}>
          {pt
            ? 'Esta ação apaga dados ou emite uma credencial. Confirme com sua senha para continuar.'
            : 'This action deletes data or mints a credential. Confirm with your password to continue.'}
        </div>
        <input
          ref={inputRef}
          type={useCode ? 'text' : 'password'}
          value={value}
          onChange={e => { setValue(e.target.value); setError(false) }}
          placeholder={useCode ? '123456' : '••••••••'}
          style={input}
        />
        {error && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#ef4444', marginBottom: 10 }}>
            <AlertCircle size={13} /> {pt ? 'Não confere.' : 'Does not match.'}
          </div>
        )}
        <button type="submit" disabled={!value.trim()} style={{ ...primaryBtn, opacity: value.trim() ? 1 : 0.5 }}>
          {pt ? 'Confirmar' : 'Confirm'}
        </button>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, marginTop: 10 }}>
          <button type="button" onClick={() => { setUseCode(v => !v); setValue('') }} style={linkBtn}>
            {useCode
              ? (pt ? 'Usar a senha' : 'Use password')
              : (pt ? 'Usar código do autenticador' : 'Use authenticator code')}
          </button>
          <button type="button" onClick={() => finish(null)} style={linkBtn}>
            {pt ? 'Cancelar' : 'Cancel'}
          </button>
        </div>
      </form>
    </div>
  )
}

const overlay: React.CSSProperties = {
  position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', display: 'flex',
  alignItems: 'center', justifyContent: 'center', zIndex: 1100, padding: 16,
}
const card: React.CSSProperties = {
  width: '100%', maxWidth: 360, background: 'var(--bg-card)', border: '1px solid var(--border)',
  borderRadius: 'var(--radius-lg)', padding: 22,
}
const input: React.CSSProperties = {
  width: '100%', boxSizing: 'border-box', padding: '9px 11px', background: 'var(--bg-elevated)',
  border: '1px solid var(--border)', borderRadius: 8, fontSize: 16, color: 'var(--text-primary)',
  outline: 'none', fontFamily: 'inherit', marginBottom: 12,
}
const primaryBtn: React.CSSProperties = {
  width: '100%', padding: '9px 14px', borderRadius: 8, border: '1px solid var(--anthropic-orange)',
  background: 'var(--anthropic-orange-dim)', color: 'var(--anthropic-orange)', fontSize: 13,
  fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
}
const linkBtn: React.CSSProperties = {
  border: 'none', background: 'transparent', color: 'var(--text-tertiary)', fontSize: 12,
  cursor: 'pointer', fontFamily: 'inherit', padding: 4,
}
