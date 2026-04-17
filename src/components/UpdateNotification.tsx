import React from 'react'
import { createPortal } from 'react-dom'
import { X, ArrowUpCircle, Terminal } from 'lucide-react'

interface Props {
  currentVersion: string
  latestVersion: string
  lang: 'en' | 'pt'
  onClose: () => void
}

export function UpdateNotification({ currentVersion, latestVersion, lang, onClose }: Props) {
  const updateCmd = 'cd $(dirname $(which agentop)) && git -C .. pull && bun install'

  return createPortal(
    <div
      style={{
        position: 'fixed',
        bottom: 24,
        right: 24,
        width: 340,
        zIndex: 9990,
        background: 'var(--bg-surface)',
        border: '1px solid var(--anthropic-orange)',
        borderRadius: 14,
        boxShadow: '0 20px 60px rgba(0,0,0,0.4), 0 0 0 1px rgba(217,119,6,0.15)',
        padding: '16px 16px 14px',
        animation: 'updateSlideIn 0.3s cubic-bezier(0.16, 1, 0.3, 1)',
      }}
    >
      <style>{`
        @keyframes updateSlideIn {
          from { opacity: 0; transform: translateY(16px); }
          to   { opacity: 1; transform: translateY(0); }
        }
      `}</style>

      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <ArrowUpCircle size={18} style={{ color: 'var(--anthropic-orange)', flexShrink: 0 }} />
          <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)' }}>
            {lang === 'pt' ? 'Atualização disponível' : 'Update available'}
          </span>
        </div>
        <button
          onClick={onClose}
          style={{
            width: 24, height: 24,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: 'transparent', border: 'none', borderRadius: 6,
            cursor: 'pointer', color: 'var(--text-tertiary)',
            transition: 'color 0.15s',
          }}
          onMouseEnter={e => (e.currentTarget.style.color = 'var(--text-primary)')}
          onMouseLeave={e => (e.currentTarget.style.color = 'var(--text-tertiary)')}
        >
          <X size={13} />
        </button>
      </div>

      <div style={{ display: 'flex', gap: 12, marginBottom: 12 }}>
        <div style={{ flex: 1, textAlign: 'center', padding: '6px 0', background: 'var(--bg-secondary)', borderRadius: 8 }}>
          <div style={{ fontSize: 10, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 2 }}>
            {lang === 'pt' ? 'Atual' : 'Current'}
          </div>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)' }}>v{currentVersion}</div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', color: 'var(--anthropic-orange)', fontSize: 16 }}>→</div>
        <div style={{ flex: 1, textAlign: 'center', padding: '6px 0', background: 'var(--anthropic-orange-dim)', borderRadius: 8 }}>
          <div style={{ fontSize: 10, color: 'var(--anthropic-orange)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 2, opacity: 0.8 }}>
            {lang === 'pt' ? 'Disponível' : 'Available'}
          </div>
          <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--anthropic-orange)' }}>v{latestVersion}</div>
        </div>
      </div>

      <div style={{
        background: 'var(--bg-base)',
        borderRadius: 8,
        padding: '8px 10px',
        marginBottom: 12,
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        border: '1px solid var(--border)',
      }}>
        <Terminal size={12} style={{ color: 'var(--text-tertiary)', flexShrink: 0 }} />
        <code style={{ fontSize: 11, color: 'var(--text-secondary)', fontFamily: 'monospace', flex: 1, wordBreak: 'break-all' }}>
          git -C ~/agentistics pull && bun install
        </code>
        <button
          onClick={() => {
            navigator.clipboard?.writeText('git -C ~/agentistics pull && bun install').catch(() => {})
          }}
          title={lang === 'pt' ? 'Copiar comando' : 'Copy command'}
          style={{
            flexShrink: 0, background: 'transparent', border: 'none',
            cursor: 'pointer', color: 'var(--text-tertiary)', padding: '0 2px',
            fontSize: 10, fontFamily: 'inherit',
            transition: 'color 0.15s',
          }}
          onMouseEnter={e => (e.currentTarget.style.color = 'var(--anthropic-orange)')}
          onMouseLeave={e => (e.currentTarget.style.color = 'var(--text-tertiary)')}
        >
          copy
        </button>
      </div>

      <button
        onClick={onClose}
        style={{
          width: '100%', height: 32,
          background: 'transparent',
          border: '1px solid var(--border)',
          borderRadius: 8,
          cursor: 'pointer',
          fontSize: 12,
          color: 'var(--text-tertiary)',
          fontFamily: 'inherit',
          transition: 'all 0.15s',
        }}
        onMouseEnter={e => {
          e.currentTarget.style.borderColor = 'var(--text-tertiary)'
          e.currentTarget.style.color = 'var(--text-primary)'
        }}
        onMouseLeave={e => {
          e.currentTarget.style.borderColor = 'var(--border)'
          e.currentTarget.style.color = 'var(--text-tertiary)'
        }}
      >
        {lang === 'pt' ? 'Dispensar' : 'Dismiss'}
      </button>
    </div>,
    document.body
  )
}
