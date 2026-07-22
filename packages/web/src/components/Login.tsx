import React, { useState, useRef, useEffect } from 'react'
import { AlertCircle, LogIn } from 'lucide-react'

/** Central account login (email + password). Posts /api/iam/login; the server sets the session cookie. */
export function Login({ onAuthed }: { onAuthed: () => void }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<'wrong' | 'network' | null>(null)
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => { ref.current?.focus() }, [])

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!email.trim() || !password || submitting) return
    setSubmitting(true); setError(null)
    try {
      const res = await fetch('/api/iam/login', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), password }),
      })
      const data = (await res.json()) as { ok: boolean }
      if (res.ok && data.ok) onAuthed()
      else setError('wrong')
    } catch { setError('network') } finally { setSubmitting(false) }
  }

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg-base)', padding: 16 }}>
      <form onSubmit={submit} style={{ width: '100%', maxWidth: 360, background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', padding: 28, boxShadow: '0 12px 40px rgba(0,0,0,0.35)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20 }}>
          <span style={{ display: 'inline-flex', padding: 9, borderRadius: 10, background: 'var(--anthropic-orange-dim)', color: 'var(--anthropic-orange)' }}><LogIn size={18} /></span>
          <span style={{ fontSize: 17, fontWeight: 700, color: 'var(--text-primary)' }}>agentistics</span>
        </div>
        <Field label="Email" type="email" value={email} onChange={setEmail} inputRef={ref} disabled={submitting} />
        <Field label="Password" type="password" value={password} onChange={setPassword} disabled={submitting} />
        {error && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#ef4444', marginBottom: 12 }}>
            <AlertCircle size={13} /> {error === 'wrong' ? 'Invalid email or password.' : 'Network error — try again.'}
          </div>
        )}
        <button type="submit" disabled={!email.trim() || !password || submitting}
          style={{ width: '100%', padding: '9px 14px', borderRadius: 8, border: '1px solid var(--anthropic-orange)', background: (!email.trim() || !password || submitting) ? 'var(--bg-elevated)' : 'var(--anthropic-orange-dim)', color: (!email.trim() || !password || submitting) ? 'var(--text-tertiary)' : 'var(--anthropic-orange)', fontSize: 13, fontWeight: 600, cursor: (!email.trim() || !password || submitting) ? 'default' : 'pointer', fontFamily: 'inherit' }}>
          {submitting ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </div>
  )
}

/** Shared labelled input used by Login + OwnerSetup. */
export function Field({ label, type, value, onChange, inputRef, disabled }: {
  label: string; type: string; value: string; onChange: (v: string) => void
  inputRef?: React.RefObject<HTMLInputElement | null>; disabled?: boolean
}) {
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-tertiary)', marginBottom: 5 }}>{label}</div>
      <input ref={inputRef} type={type} value={value} onChange={e => onChange(e.target.value)} disabled={disabled}
        style={{ width: '100%', boxSizing: 'border-box', padding: '8px 11px', background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 13, color: 'var(--text-primary)', outline: 'none', fontFamily: 'inherit' }}
        onFocus={e => { e.currentTarget.style.borderColor = 'var(--anthropic-orange)' }}
        onBlur={e => { e.currentTarget.style.borderColor = 'var(--border)' }} />
    </div>
  )
}
