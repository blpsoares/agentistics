import React, { useCallback, useEffect, useState } from 'react'
import { ShieldCheck, ShieldOff, Copy, Check, AlertCircle } from 'lucide-react'
import type { Lang } from '@agentistics/core'

/**
 * Two-factor enrolment for the signed-in account.
 *
 * The secret is rendered as text with a copy button rather than a QR code: every authenticator
 * app accepts manual entry, and drawing a QR would mean pulling in a rendering dependency that
 * the compiled binary would then have to carry.
 *
 * Recovery codes are shown exactly once — the server stores only their sha256 hashes and cannot
 * show them again.
 */
export function MfaSetup({ lang, onClose }: { lang: Lang; onClose: () => void }) {
  const pt = lang === 'pt'
  const [enabled, setEnabled] = useState<boolean | null>(null)
  const [secret, setSecret] = useState<string | null>(null)
  const [uri, setUri] = useState<string | null>(null)
  const [code, setCode] = useState('')
  const [recovery, setRecovery] = useState<string[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  const refresh = useCallback(() => {
    fetch('/api/iam/mfa')
      .then(r => (r.ok ? r.json() : { enabled: false }))
      .then((d: { enabled: boolean }) => setEnabled(!!d.enabled))
      .catch(() => setEnabled(false))
  }, [])
  useEffect(refresh, [refresh])

  async function start() {
    setBusy(true); setError(null)
    try {
      const r = await fetch('/api/iam/mfa/start', { method: 'POST' })
      const d = (await r.json()) as { secret?: string; otpauthUri?: string }
      if (d.secret) { setSecret(d.secret); setUri(d.otpauthUri ?? null) }
      else setError(pt ? 'Não foi possível iniciar.' : 'Could not start enrolment.')
    } catch { setError(pt ? 'Erro de rede.' : 'Network error.') } finally { setBusy(false) }
  }

  async function enable(e: React.FormEvent) {
    e.preventDefault()
    if (!secret || !code.trim() || busy) return
    setBusy(true); setError(null)
    try {
      const r = await fetch('/api/iam/mfa/enable', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ secret, code: code.trim() }),
      })
      const d = (await r.json()) as { ok?: boolean; recoveryCodes?: string[]; error?: string }
      if (r.ok && d.ok && d.recoveryCodes) {
        setRecovery(d.recoveryCodes)
        setSecret(null); setCode(''); setEnabled(true)
      } else {
        setError(pt ? 'Código inválido — verifique o relógio do aparelho.' : 'Invalid code — check the device clock.')
      }
    } catch { setError(pt ? 'Erro de rede.' : 'Network error.') } finally { setBusy(false) }
  }

  async function disable() {
    if (!code.trim() || busy) return
    setBusy(true); setError(null)
    try {
      const r = await fetch('/api/iam/mfa', {
        method: 'DELETE', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: code.trim() }),
      })
      if (r.ok) { setEnabled(false); setCode('') }
      else setError(pt ? 'Código inválido.' : 'Invalid code.')
    } catch { setError(pt ? 'Erro de rede.' : 'Network error.') } finally { setBusy(false) }
  }

  return (
    <div onClick={onClose} style={overlay}>
      <div onClick={e => e.stopPropagation()} style={card}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
          <span style={{ display: 'inline-flex', padding: 8, borderRadius: 9, background: 'var(--anthropic-orange-dim)', color: 'var(--anthropic-orange)' }}>
            {enabled ? <ShieldCheck size={16} /> : <ShieldOff size={16} />}
          </span>
          <span style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-primary)' }}>
            {pt ? 'Verificação em duas etapas' : 'Two-factor authentication'}
          </span>
        </div>

        {recovery && (
          <div style={{ marginTop: 12 }}>
            <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 8 }}>
              {pt
                ? 'Guarde estes códigos de recuperação agora. Cada um serve uma única vez e eles não serão mostrados de novo.'
                : 'Save these recovery codes now. Each works once and they will not be shown again.'}
            </div>
            <pre style={codeBlock}>{recovery.join('\n')}</pre>
            <button onClick={onClose} style={primaryBtn}>{pt ? 'Guardei' : 'I saved them'}</button>
          </div>
        )}

        {!recovery && enabled === true && (
          <div style={{ marginTop: 10 }}>
            <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 10 }}>
              {pt ? 'Ativa nesta conta. Para desativar, confirme com um código atual.' : 'Active on this account. To turn it off, confirm with a current code.'}
            </div>
            <input value={code} onChange={e => setCode(e.target.value)} placeholder="123456" style={input} />
            {error && <Err text={error} />}
            <button onClick={disable} disabled={!code.trim() || busy} style={dangerBtn}>
              {pt ? 'Desativar' : 'Disable'}
            </button>
          </div>
        )}

        {!recovery && enabled === false && !secret && (
          <div style={{ marginTop: 10 }}>
            <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 12 }}>
              {pt
                ? 'Uma senha sozinha é um único ponto de falha numa instância exposta na internet. Ative um segundo fator.'
                : 'A password alone is a single point of failure on an internet-exposed instance. Add a second factor.'}
            </div>
            {error && <Err text={error} />}
            <button onClick={start} disabled={busy} style={primaryBtn}>{pt ? 'Começar' : 'Start'}</button>
          </div>
        )}

        {!recovery && secret && (
          <form onSubmit={enable} style={{ marginTop: 10 }}>
            <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 8 }}>
              {pt ? 'Adicione esta chave no seu app autenticador e confirme o código gerado.' : 'Add this key to your authenticator app, then confirm the code it shows.'}
            </div>
            <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
              <code style={{ ...codeBlock, flex: 1, margin: 0 }}>{secret.match(/.{1,4}/g)?.join(' ')}</code>
              <button type="button" onClick={() => { void navigator.clipboard?.writeText(uri ?? secret); setCopied(true); setTimeout(() => setCopied(false), 1500) }}
                title={pt ? 'Copiar URI otpauth://' : 'Copy the otpauth:// URI'} style={iconBtn}>
                {copied ? <Check size={14} /> : <Copy size={14} />}
              </button>
            </div>
            <input value={code} onChange={e => setCode(e.target.value)} placeholder="123456" style={input} autoFocus />
            {error && <Err text={error} />}
            <button type="submit" disabled={!code.trim() || busy} style={primaryBtn}>{pt ? 'Ativar' : 'Enable'}</button>
          </form>
        )}
      </div>
    </div>
  )
}

function Err({ text }: { text: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#ef4444', margin: '8px 0' }}>
      <AlertCircle size={13} /> {text}
    </div>
  )
}

const overlay: React.CSSProperties = {
  position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex',
  alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 16,
}
const card: React.CSSProperties = {
  width: '100%', maxWidth: 380, background: 'var(--bg-card)', border: '1px solid var(--border)',
  borderRadius: 'var(--radius-lg)', padding: 22,
}
const input: React.CSSProperties = {
  width: '100%', boxSizing: 'border-box', padding: '8px 11px', background: 'var(--bg-elevated)',
  border: '1px solid var(--border)', borderRadius: 8, fontSize: 16, color: 'var(--text-primary)',
  outline: 'none', fontFamily: 'inherit', marginBottom: 10, letterSpacing: '0.15em',
}
const codeBlock: React.CSSProperties = {
  background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 8,
  padding: '10px 12px', fontSize: 13, color: 'var(--text-primary)', overflowX: 'auto',
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', marginBottom: 12,
}
const primaryBtn: React.CSSProperties = {
  width: '100%', padding: '9px 14px', borderRadius: 8, border: '1px solid var(--anthropic-orange)',
  background: 'var(--anthropic-orange-dim)', color: 'var(--anthropic-orange)', fontSize: 13,
  fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
}
const dangerBtn: React.CSSProperties = { ...primaryBtn, borderColor: '#ef4444', background: 'transparent', color: '#ef4444' }
const iconBtn: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center', padding: '0 12px',
  minWidth: 44, minHeight: 44, borderRadius: 8, border: '1px solid var(--border)',
  background: 'var(--bg-elevated)', color: 'var(--text-secondary)', cursor: 'pointer',
}
