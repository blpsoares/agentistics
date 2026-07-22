// packages/web/src/components/OwnerSetup.tsx
import React, { useState } from 'react'
import { AlertCircle, ShieldCheck } from 'lucide-react'
import { Field } from './Login'

/** First-boot owner creation. Requires the one-time setup token printed to the central's logs.
 *  Posts /api/iam/bootstrap; on success the server sets the session cookie and the app opens. */
export function OwnerSetup({ onDone }: { onDone: () => void }) {
  const [token, setToken] = useState('')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (submitting) return
    if (password !== confirm) { setError('Passwords do not match.'); return }
    setSubmitting(true); setError(null)
    try {
      const res = await fetch('/api/iam/bootstrap', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: token.trim(), name: name.trim(), email: email.trim(), password, confirm }),
      })
      const data = (await res.json()) as { ok: boolean; error?: string }
      if (res.ok && data.ok) onDone()
      else setError(data.error || 'Setup failed.')
    } catch { setError('Network error — try again.') } finally { setSubmitting(false) }
  }

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg-base)', padding: 16 }}>
      <form onSubmit={submit} style={{ width: '100%', maxWidth: 400, background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', padding: 28, boxShadow: '0 12px 40px rgba(0,0,0,0.35)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
          <span style={{ display: 'inline-flex', padding: 9, borderRadius: 10, background: 'var(--anthropic-orange-dim)', color: 'var(--anthropic-orange)' }}><ShieldCheck size={18} /></span>
          <span style={{ fontSize: 17, fontWeight: 700, color: 'var(--text-primary)' }}>Create owner account</span>
        </div>
        <p style={{ fontSize: 12, color: 'var(--text-tertiary)', lineHeight: 1.5, margin: '0 0 18px' }}>
          First-time setup. Paste the one-time setup token from the central's logs, then create the owner account.
        </p>
        <Field label="Setup token" type="text" value={token} onChange={setToken} disabled={submitting} />
        <Field label="Name" type="text" value={name} onChange={setName} disabled={submitting} />
        <Field label="Email" type="email" value={email} onChange={setEmail} disabled={submitting} />
        <Field label="Password" type="password" value={password} onChange={setPassword} disabled={submitting} />
        <Field label="Confirm password" type="password" value={confirm} onChange={setConfirm} disabled={submitting} />
        {error && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#ef4444', marginBottom: 12 }}>
            <AlertCircle size={13} /> {error}
          </div>
        )}
        <button type="submit" disabled={submitting || !token.trim() || !name.trim() || !email.trim() || password.length < 8 || password !== confirm}
          style={{ width: '100%', padding: '9px 14px', borderRadius: 8, border: '1px solid var(--anthropic-orange)', background: 'var(--anthropic-orange-dim)', color: 'var(--anthropic-orange)', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', opacity: (submitting || !token.trim() || !name.trim() || !email.trim() || password.length < 8 || password !== confirm) ? 0.6 : 1 }}>
          {submitting ? 'Creating…' : 'Create owner & sign in'}
        </button>
      </form>
    </div>
  )
}
