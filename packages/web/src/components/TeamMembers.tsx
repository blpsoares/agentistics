import React, { useState, useEffect, useCallback } from 'react'
import { Users, Plus, Trash2, Copy, CheckCheck, RefreshCw, AlertCircle } from 'lucide-react'

// ── Types ──────────────────────────────────────────────────────────────────

export interface TeamMember {
  id: string
  user: string
  label: string
  createdAt: string
  lastSeenAt: string | null
}

// ── i18n ──────────────────────────────────────────────────────────────────

const COPY = {
  title:           { en: 'Members (central admin)',               pt: 'Membros (admin central)' },
  sub:             { en: 'Manage API tokens for team members.',   pt: 'Gerencie tokens de acesso para membros da equipe.' },
  user:            { en: 'User',                                  pt: 'Usuário' },
  label:           { en: 'Label',                                 pt: 'Rótulo' },
  lastSeen:        { en: 'Last seen',                             pt: 'Último acesso' },
  never:           { en: 'Never',                                 pt: 'Nunca' },
  revoke:          { en: 'Revoke',                                pt: 'Revogar' },
  revoking:        { en: 'Revoking…',                            pt: 'Revogando…' },
  noMembers:       { en: 'No tokens minted yet.',                 pt: 'Nenhum token criado ainda.' },
  mintTitle:       { en: 'Mint new token',                        pt: 'Criar novo token' },
  userLabel:       { en: 'User / email',                         pt: 'Usuário / e-mail' },
  userPlaceholder: { en: 'alice@example.com',                    pt: 'alice@exemplo.com' },
  labelLabel:      { en: 'Label',                                 pt: 'Rótulo' },
  labelPlaceholder:{ en: 'Alice\'s laptop',                      pt: 'Notebook da Alice' },
  mint:            { en: 'Mint token',                           pt: 'Criar token' },
  minting:         { en: 'Creating…',                            pt: 'Criando…' },
  tokenNote:       { en: 'Save this token — it will never be shown again.',  pt: 'Salve este token — ele não será exibido novamente.' },
  copyToken:       { en: 'Copy token',                           pt: 'Copiar token' },
  copied:          { en: 'Copied!',                              pt: 'Copiado!' },
  loadErr:         { en: 'Failed to load members.',              pt: 'Falha ao carregar membros.' },
  mintErr:         { en: 'Failed to create token.',              pt: 'Falha ao criar token.' },
  revokeErr:       { en: 'Failed to revoke token.',              pt: 'Falha ao revogar token.' },
  refresh:         { en: 'Refresh',                              pt: 'Atualizar' },
} satisfies Record<string, { en: string; pt: string }>

function t(key: keyof typeof COPY, lang: 'en' | 'pt'): string {
  return COPY[key][lang]
}

// ── Helpers ───────────────────────────────────────────────────────────────

function relativeTime(isoStr: string, lang: 'en' | 'pt'): string {
  const diff = Date.now() - new Date(isoStr).getTime()
  const secs = Math.floor(diff / 1000)
  const mins  = Math.floor(secs / 60)
  const hours = Math.floor(mins / 60)
  const days  = Math.floor(hours / 24)

  if (lang === 'pt') {
    if (days > 0)  return `${days}d atrás`
    if (hours > 0) return `${hours}h atrás`
    if (mins > 0)  return `${mins}min atrás`
    return 'agora'
  }
  if (days > 0)  return `${days}d ago`
  if (hours > 0) return `${hours}h ago`
  if (mins > 0)  return `${mins}m ago`
  return 'just now'
}

// ── Main component ────────────────────────────────────────────────────────

interface Props {
  lang: 'en' | 'pt'
}

export function TeamMembers({ lang }: Props) {
  const [members, setMembers] = useState<TeamMember[]>([])
  const [loading, setLoading] = useState(true)
  const [loadErr, setLoadErr] = useState<string | null>(null)

  // Mint form state
  const [mintUser, setMintUser] = useState('')
  const [mintLabel, setMintLabel] = useState('')
  const [minting, setMinting] = useState(false)
  const [mintErr, setMintErr] = useState<string | null>(null)
  const [newToken, setNewToken] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  // Per-row revoke state (id → true when revoking)
  const [revoking, setRevoking] = useState<Record<string, boolean>>({})
  const [revokeErr, setRevokeErr] = useState<string | null>(null)

  const loadMembers = useCallback(async () => {
    setLoading(true)
    setLoadErr(null)
    try {
      const res = await fetch('/api/team/members')
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = (await res.json()) as { members: TeamMember[] }
      setMembers(data.members)
    } catch (err) {
      setLoadErr(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void loadMembers() }, [loadMembers])

  async function handleMint(e: React.FormEvent) {
    e.preventDefault()
    if (!mintUser.trim() || !mintLabel.trim() || minting) return
    setMinting(true)
    setMintErr(null)
    setNewToken(null)
    try {
      const res = await fetch('/api/team/tokens', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user: mintUser.trim(), label: mintLabel.trim() }),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = (await res.json()) as { token: string }
      setNewToken(data.token)
      setMintUser('')
      setMintLabel('')
      // Reload the table to show the new entry
      void loadMembers()
    } catch (err) {
      setMintErr(err instanceof Error ? err.message : String(err))
    } finally {
      setMinting(false)
    }
  }

  async function handleRevoke(id: string) {
    if (revoking[id]) return
    setRevoking(prev => ({ ...prev, [id]: true }))
    setRevokeErr(null)
    try {
      const res = await fetch('/api/team/tokens', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      setMembers(prev => prev.filter(m => m.id !== id))
    } catch (err) {
      setRevokeErr(err instanceof Error ? err.message : String(err))
    } finally {
      setRevoking(prev => ({ ...prev, [id]: false }))
    }
  }

  async function handleCopy() {
    if (!newToken) return
    try {
      await navigator.clipboard.writeText(newToken)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch { /* clipboard unavailable */ }
  }

  const inputStyle: React.CSSProperties = {
    width: '100%',
    boxSizing: 'border-box',
    padding: '7px 10px',
    background: 'var(--bg-elevated)',
    border: '1px solid var(--border)',
    borderRadius: 7,
    fontSize: 13,
    color: 'var(--text-primary)',
    outline: 'none',
    fontFamily: 'inherit',
    transition: 'border-color 0.15s',
  }

  return (
    <div style={{ marginTop: 20 }}>
      {/* Section header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
          <Users size={14} color="var(--text-secondary)" />
          <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>
            {t('title', lang)}
          </span>
        </div>
        <button
          onClick={() => { void loadMembers() }}
          disabled={loading}
          title={t('refresh', lang)}
          style={{
            display: 'flex', alignItems: 'center', gap: 4,
            padding: '4px 8px', borderRadius: 6,
            border: '1px solid var(--border)',
            background: 'transparent',
            color: 'var(--text-tertiary)',
            fontSize: 11, fontWeight: 500,
            cursor: loading ? 'default' : 'pointer',
            fontFamily: 'inherit',
            opacity: loading ? 0.5 : 1,
          }}
        >
          <RefreshCw size={10} style={{ animation: loading ? 'spin 1s linear infinite' : 'none' }} />
          {t('refresh', lang)}
        </button>
      </div>

      <p style={{ fontSize: 11, color: 'var(--text-tertiary)', marginBottom: 16, lineHeight: 1.5 }}>
        {t('sub', lang)}
      </p>

      {/* Load error */}
      {loadErr && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 6,
          padding: '8px 10px', borderRadius: 7, marginBottom: 12,
          background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)',
          fontSize: 12, color: '#ef4444',
        }}>
          <AlertCircle size={13} />
          {t('loadErr', lang)}{loadErr ? ` — ${loadErr}` : ''}
        </div>
      )}

      {/* Members table */}
      {!loadErr && (
        <div style={{
          border: '1px solid var(--border)',
          borderRadius: 8,
          overflow: 'hidden',
          marginBottom: 20,
        }}>
          {/* Table header */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: '1fr 1fr 1fr auto',
            gap: 0,
            background: 'var(--bg-elevated)',
            borderBottom: '1px solid var(--border)',
            padding: '7px 12px',
          }}>
            {[t('user', lang), t('label', lang), t('lastSeen', lang), ''].map((h, i) => (
              <div key={i} style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-tertiary)', letterSpacing: '0.06em', textTransform: 'uppercase' }}>
                {h}
              </div>
            ))}
          </div>

          {/* Rows */}
          {loading ? (
            <div style={{ padding: '20px 12px', fontSize: 12, color: 'var(--text-tertiary)', textAlign: 'center' }}>
              …
            </div>
          ) : members.length === 0 ? (
            <div style={{ padding: '16px 12px', fontSize: 12, color: 'var(--text-tertiary)', textAlign: 'center' }}>
              {t('noMembers', lang)}
            </div>
          ) : (
            members.map((m, i) => (
              <div
                key={m.id}
                style={{
                  display: 'grid',
                  gridTemplateColumns: '1fr 1fr 1fr auto',
                  gap: 0,
                  alignItems: 'center',
                  padding: '9px 12px',
                  borderBottom: i < members.length - 1 ? '1px solid var(--border)' : 'none',
                  background: 'var(--bg-card)',
                  transition: 'background 0.1s',
                }}
                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'var(--bg-elevated)' }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'var(--bg-card)' }}
              >
                <div style={{ fontSize: 12, color: 'var(--text-primary)', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', paddingRight: 8 }}>
                  {m.user}
                </div>
                <div style={{ fontSize: 12, color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', paddingRight: 8 }}>
                  {m.label}
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-tertiary)', paddingRight: 8 }}>
                  {m.lastSeenAt ? relativeTime(m.lastSeenAt, lang) : t('never', lang)}
                </div>
                <button
                  onClick={() => { void handleRevoke(m.id) }}
                  disabled={revoking[m.id]}
                  title={t('revoke', lang)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 4,
                    padding: '4px 8px', borderRadius: 6,
                    border: '1px solid rgba(239,68,68,0.3)',
                    background: 'rgba(239,68,68,0.06)',
                    color: revoking[m.id] ? 'var(--text-tertiary)' : '#ef4444',
                    fontSize: 11, fontWeight: 600,
                    cursor: revoking[m.id] ? 'default' : 'pointer',
                    fontFamily: 'inherit',
                    transition: 'all 0.15s',
                    opacity: revoking[m.id] ? 0.5 : 1,
                    whiteSpace: 'nowrap',
                  }}
                >
                  <Trash2 size={10} />
                  {revoking[m.id] ? t('revoking', lang) : t('revoke', lang)}
                </button>
              </div>
            ))
          )}
        </div>
      )}

      {/* Revoke error */}
      {revokeErr && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 6,
          padding: '6px 10px', borderRadius: 7, marginBottom: 12,
          background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)',
          fontSize: 11, color: '#ef4444',
        }}>
          <AlertCircle size={12} />
          {t('revokeErr', lang)}{revokeErr ? ` — ${revokeErr}` : ''}
        </div>
      )}

      {/* Divider */}
      <div style={{ height: 1, background: 'var(--border)', marginBottom: 16 }} />

      {/* Mint new token */}
      <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-tertiary)', letterSpacing: '0.07em', textTransform: 'uppercase', marginBottom: 12 }}>
        {t('mintTitle', lang)}
      </div>

      <form onSubmit={e => { void handleMint(e) }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 10 }}>
          <div>
            <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 4 }}>
              {t('userLabel', lang)}
            </div>
            <input
              type="text"
              value={mintUser}
              onChange={e => setMintUser(e.target.value)}
              placeholder={t('userPlaceholder', lang)}
              disabled={minting}
              style={{ ...inputStyle, opacity: minting ? 0.6 : 1 }}
              onFocus={e => { e.currentTarget.style.borderColor = 'var(--anthropic-orange)' }}
              onBlur={e => { e.currentTarget.style.borderColor = 'var(--border)' }}
            />
          </div>
          <div>
            <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 4 }}>
              {t('labelLabel', lang)}
            </div>
            <input
              type="text"
              value={mintLabel}
              onChange={e => setMintLabel(e.target.value)}
              placeholder={t('labelPlaceholder', lang)}
              disabled={minting}
              style={{ ...inputStyle, opacity: minting ? 0.6 : 1 }}
              onFocus={e => { e.currentTarget.style.borderColor = 'var(--anthropic-orange)' }}
              onBlur={e => { e.currentTarget.style.borderColor = 'var(--border)' }}
            />
          </div>
        </div>

        <button
          type="submit"
          disabled={!mintUser.trim() || !mintLabel.trim() || minting}
          style={{
            display: 'flex', alignItems: 'center', gap: 6,
            padding: '7px 14px', borderRadius: 7,
            border: '1px solid var(--anthropic-orange)',
            background: !mintUser.trim() || !mintLabel.trim() || minting
              ? 'var(--bg-elevated)'
              : 'var(--anthropic-orange-dim)',
            color: !mintUser.trim() || !mintLabel.trim() || minting
              ? 'var(--text-tertiary)'
              : 'var(--anthropic-orange)',
            fontSize: 12, fontWeight: 600,
            cursor: !mintUser.trim() || !mintLabel.trim() || minting ? 'default' : 'pointer',
            fontFamily: 'inherit',
            transition: 'all 0.15s',
            opacity: !mintUser.trim() || !mintLabel.trim() || minting ? 0.6 : 1,
          }}
        >
          <Plus size={13} />
          {minting ? t('minting', lang) : t('mint', lang)}
        </button>
      </form>

      {/* Mint error */}
      {mintErr && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 6,
          padding: '6px 10px', borderRadius: 7, marginTop: 10,
          background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)',
          fontSize: 11, color: '#ef4444',
        }}>
          <AlertCircle size={12} />
          {t('mintErr', lang)}{mintErr ? ` — ${mintErr}` : ''}
        </div>
      )}

      {/* New token — shown once */}
      {newToken && (
        <div style={{
          marginTop: 14,
          padding: '14px',
          borderRadius: 8,
          background: 'rgba(217,119,6,0.06)',
          border: '1px solid rgba(217,119,6,0.35)',
        }}>
          {/* Warning banner */}
          <div style={{
            display: 'flex', alignItems: 'center', gap: 6,
            marginBottom: 10,
            fontSize: 11, fontWeight: 600, color: 'var(--anthropic-orange)',
          }}>
            <AlertCircle size={13} />
            {t('tokenNote', lang)}
          </div>

          {/* Token + copy button */}
          <div style={{ display: 'flex', gap: 8, alignItems: 'stretch' }}>
            <input
              type="text"
              readOnly
              value={newToken}
              onClick={e => (e.target as HTMLInputElement).select()}
              style={{
                flex: 1,
                padding: '7px 10px',
                background: 'var(--bg-elevated)',
                border: '1px solid var(--border)',
                borderRadius: 7,
                fontSize: 12,
                fontFamily: 'monospace',
                color: 'var(--text-primary)',
                outline: 'none',
                wordBreak: 'break-all',
              }}
            />
            <button
              onClick={() => { void handleCopy() }}
              style={{
                display: 'flex', alignItems: 'center', gap: 5,
                padding: '7px 12px', borderRadius: 7,
                border: copied
                  ? '1px solid rgba(34,197,94,0.4)'
                  : '1px solid var(--anthropic-orange)',
                background: copied
                  ? 'rgba(34,197,94,0.1)'
                  : 'var(--anthropic-orange-dim)',
                color: copied
                  ? 'var(--accent-green)'
                  : 'var(--anthropic-orange)',
                fontSize: 12, fontWeight: 600,
                cursor: 'pointer', fontFamily: 'inherit',
                transition: 'all 0.2s',
                flexShrink: 0,
              }}
            >
              {copied ? <CheckCheck size={13} /> : <Copy size={13} />}
              {copied ? t('copied', lang) : t('copyToken', lang)}
            </button>
          </div>
        </div>
      )}

      {/* Spinner keyframe */}
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  )
}
