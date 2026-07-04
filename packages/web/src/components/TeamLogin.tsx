import React, { useState, useEffect, useRef } from 'react'
import { BarChart2, Lock, AlertCircle } from 'lucide-react'

// ── i18n ──────────────────────────────────────────────────────────────────

const COPY = {
  title:       { en: 'agentistics',                              pt: 'agentistics' },
  subtitle:    { en: 'Central team dashboard',                   pt: 'Dashboard central da equipe' },
  heading:     { en: 'Sign in',                                  pt: 'Entrar' },
  sub:         { en: 'Enter the team password to continue.',     pt: 'Digite a senha da equipe para continuar.' },
  label:       { en: 'Password',                                 pt: 'Senha' },
  placeholder: { en: 'Team password',                           pt: 'Senha da equipe' },
  submit:      { en: 'Sign in',                                  pt: 'Entrar' },
  submitting:  { en: 'Signing in…',                             pt: 'Entrando…' },
  wrongPw:     { en: 'Incorrect password.',                      pt: 'Senha incorreta.' },
  networkErr:  { en: 'Network error. Try again.',               pt: 'Erro de rede. Tente novamente.' },
} satisfies Record<string, { en: string; pt: string }>

function t(key: keyof typeof COPY, lang: 'en' | 'pt'): string {
  return COPY[key][lang]
}

// ── Component ─────────────────────────────────────────────────────────────

interface Props {
  onAuthed: () => void
}

export function TeamLogin({ onAuthed }: Props) {
  // Auto-detect browser language; fall back to English.
  const [lang] = useState<'en' | 'pt'>(() =>
    navigator.language.startsWith('pt') ? 'pt' : 'en'
  )
  const [password, setPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<'wrong' | 'network' | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  // Focus the input on mount
  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!password || submitting) return
    setSubmitting(true)
    setError(null)
    try {
      const res = await fetch('/api/team/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      })
      const data = (await res.json()) as { ok: boolean }
      if (data.ok) {
        onAuthed()
      } else {
        setError('wrong')
        setPassword('')
        inputRef.current?.focus()
      }
    } catch {
      setError('network')
    } finally {
      setSubmitting(false)
    }
  }

  const errorMsg =
    error === 'wrong'   ? t('wrongPw', lang) :
    error === 'network' ? t('networkErr', lang) :
    null

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'var(--bg-base)',
        padding: '32px 16px',
      }}
    >
      {/* Brand */}
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, marginBottom: 36 }}>
        <div
          style={{
            width: 48, height: 48,
            background: 'var(--anthropic-orange-dim)',
            borderRadius: 14,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            boxShadow: '0 0 20px rgba(217,119,6,0.25)',
          }}
        >
          <BarChart2 size={22} color="var(--anthropic-orange)" />
        </div>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-primary)', letterSpacing: '-0.01em' }}>
            {t('title', lang)}
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-tertiary)', marginTop: 2 }}>
            {t('subtitle', lang)}
          </div>
        </div>
      </div>

      {/* Card */}
      <div
        style={{
          width: '100%',
          maxWidth: 360,
          background: 'var(--bg-card)',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius-lg)',
          padding: '28px 28px 24px',
          boxShadow: '0 8px 40px rgba(0,0,0,0.35)',
        }}
      >
        {/* Header inside card */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 6 }}>
          <Lock size={15} color="var(--text-secondary)" />
          <span style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-primary)' }}>
            {t('heading', lang)}
          </span>
        </div>
        <p style={{ fontSize: 12, color: 'var(--text-tertiary)', marginBottom: 22, lineHeight: 1.5 }}>
          {t('sub', lang)}
        </p>

        <form onSubmit={e => { void handleSubmit(e) }}>
          {/* Password field */}
          <label style={{ display: 'block', marginBottom: 14 }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 5, letterSpacing: '0.04em', textTransform: 'uppercase' }}>
              {t('label', lang)}
            </div>
            <input
              ref={inputRef}
              type="password"
              value={password}
              onChange={e => { setPassword(e.target.value); setError(null) }}
              placeholder={t('placeholder', lang)}
              autoComplete="current-password"
              disabled={submitting}
              style={{
                width: '100%',
                boxSizing: 'border-box',
                padding: '9px 12px',
                background: 'var(--bg-elevated)',
                border: error === 'wrong'
                  ? '1px solid rgba(239,68,68,0.6)'
                  : '1px solid var(--border)',
                borderRadius: 7,
                fontSize: 14,
                color: 'var(--text-primary)',
                outline: 'none',
                transition: 'border-color 0.15s',
                fontFamily: 'inherit',
                opacity: submitting ? 0.6 : 1,
              }}
              onFocus={e => {
                if (!error) e.currentTarget.style.borderColor = 'var(--anthropic-orange)'
              }}
              onBlur={e => {
                if (!error) e.currentTarget.style.borderColor = 'var(--border)'
              }}
            />
          </label>

          {/* Error message */}
          {errorMsg && (
            <div
              style={{
                display: 'flex', alignItems: 'center', gap: 6,
                marginBottom: 12,
                padding: '6px 10px',
                borderRadius: 7,
                background: 'rgba(239,68,68,0.08)',
                border: '1px solid rgba(239,68,68,0.2)',
                fontSize: 12,
                color: '#ef4444',
              }}
            >
              <AlertCircle size={13} />
              {errorMsg}
            </div>
          )}

          {/* Submit */}
          <button
            type="submit"
            disabled={!password || submitting}
            style={{
              width: '100%',
              padding: '9px 16px',
              borderRadius: 8,
              border: '1px solid var(--anthropic-orange)',
              background: !password || submitting
                ? 'var(--bg-elevated)'
                : 'var(--anthropic-orange-dim)',
              color: !password || submitting
                ? 'var(--text-tertiary)'
                : 'var(--anthropic-orange)',
              fontSize: 13,
              fontWeight: 600,
              cursor: !password || submitting ? 'default' : 'pointer',
              fontFamily: 'inherit',
              transition: 'all 0.15s',
              opacity: !password || submitting ? 0.7 : 1,
            }}
          >
            {submitting ? t('submitting', lang) : t('submit', lang)}
          </button>
        </form>
      </div>
    </div>
  )
}
