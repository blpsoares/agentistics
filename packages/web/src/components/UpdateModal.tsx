import React, { useEffect, useCallback } from 'react'
import { X, Zap, ArrowUpCircle, Terminal, Download } from 'lucide-react'
import type { Lang } from '@agentistics/core'

interface Props {
  current: string
  latest: string
  lang: Lang
  onClose: () => void
}

export function UpdateModal({ current, latest, lang, onClose }: Props) {
  const handleKey = useCallback(
    (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() },
    [onClose],
  )

  useEffect(() => {
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [handleKey])

  const t = lang === 'pt'
    ? {
        title: 'Nova versão disponível',
        subtitle: 'Há uma atualização do agentistics disponível.',
        current: 'Versão atual',
        latest: 'Versão mais recente',
        howTo: 'Como atualizar',
        opt1Title: 'Opção 1 — Baixar o binário',
        opt1Desc: 'Acesse a página de releases, baixe o arquivo',
        opt1Post: 'e substitua seu binário atual.',
        opt2Title: 'Opção 2 — Compilar do código-fonte',
        opt2Desc: 'Execute os comandos abaixo no diretório do projeto:',
        close: 'Fechar',
        releasePage: 'Página de releases',
      }
    : {
        title: 'New version available',
        subtitle: 'A new version of agentistics is available.',
        current: 'Current version',
        latest: 'Latest version',
        howTo: 'How to update',
        opt1Title: 'Option 1 — Download the binary',
        opt1Desc: 'Go to the releases page, download',
        opt1Post: 'and replace your current binary.',
        opt2Title: 'Option 2 — Build from source',
        opt2Desc: 'Run the following commands in the project directory:',
        close: 'Close',
        releasePage: 'Releases page',
      }

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 9999,
        background: 'rgba(0,0,0,0.65)', backdropFilter: 'blur(4px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 24,
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: 'var(--bg-surface)',
          border: '1px solid var(--border)',
          borderRadius: 16,
          boxShadow: '0 24px 64px rgba(0,0,0,0.4)',
          maxWidth: 520,
          width: '100%',
          overflow: 'hidden',
        }}
      >
        {/* Header */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '20px 24px 16px',
          borderBottom: '1px solid var(--border)',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{
              width: 36, height: 36, borderRadius: 10,
              background: 'var(--anthropic-orange-dim)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <ArrowUpCircle size={18} color="var(--anthropic-orange)" />
            </div>
            <div>
              <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-primary)' }}>
                {t.title}
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 2 }}>
                {t.subtitle}
              </div>
            </div>
          </div>
          <button
            onClick={onClose}
            style={{
              background: 'none', border: 'none', cursor: 'pointer',
              color: 'var(--text-secondary)', padding: 4, borderRadius: 6,
              display: 'flex', alignItems: 'center',
            }}
          >
            <X size={18} />
          </button>
        </div>

        {/* Version pills */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 12,
          padding: '20px 24px', flexWrap: 'wrap',
        }}>
          <VersionPill label={t.current} version={current} accent="var(--text-tertiary)" dim />
          <div style={{ color: 'var(--text-tertiary)', fontSize: 18 }}>→</div>
          <VersionPill label={t.latest} version={latest} accent="var(--accent-green)" />
        </div>

        {/* How to update */}
        <div style={{ padding: '0 24px 24px' }}>
          <div style={{
            fontSize: 11, fontWeight: 700, color: 'var(--text-tertiary)',
            letterSpacing: '0.07em', textTransform: 'uppercase', marginBottom: 14,
          }}>
            {t.howTo}
          </div>

          {/* Option 1 */}
          <div style={{
            background: 'var(--bg-card)',
            border: '1px solid var(--border)',
            borderRadius: 10, padding: '14px 16px', marginBottom: 10,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <Download size={14} color="var(--anthropic-orange)" />
              <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>
                {t.opt1Title}
              </span>
            </div>
            <p style={{ fontSize: 12, color: 'var(--text-secondary)', margin: '0 0 10px', lineHeight: 1.6 }}>
              {t.opt1Desc}{' '}
              <code style={{
                background: 'var(--bg-surface)', border: '1px solid var(--border)',
                borderRadius: 4, padding: '1px 5px', fontSize: 11,
                color: 'var(--anthropic-orange-light)',
              }}>
                agentop
              </code>
              {' '}{t.opt1Post}
            </p>
            <a
              href="https://github.com/blpsoares/agentistics/releases/latest"
              target="_blank"
              rel="noreferrer"
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 6,
                padding: '6px 12px', borderRadius: 8,
                background: 'var(--anthropic-orange-dim)',
                border: '1px solid var(--anthropic-orange-dim)',
                color: 'var(--anthropic-orange-light)',
                fontSize: 12, fontWeight: 600, textDecoration: 'none',
                transition: 'opacity 0.15s',
              }}
              onMouseEnter={e => (e.currentTarget.style.opacity = '0.75')}
              onMouseLeave={e => (e.currentTarget.style.opacity = '1')}
            >
              <Zap size={12} />
              {t.releasePage} — v{latest}
            </a>
          </div>

          {/* Option 2 */}
          <div style={{
            background: 'var(--bg-card)',
            border: '1px solid var(--border)',
            borderRadius: 10, padding: '14px 16px',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <Terminal size={14} color="var(--accent-blue, #60a5fa)" />
              <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>
                {t.opt2Title}
              </span>
            </div>
            <p style={{ fontSize: 12, color: 'var(--text-secondary)', margin: '0 0 10px', lineHeight: 1.6 }}>
              {t.opt2Desc}
            </p>
            <CodeBlock lines={['git pull origin main', 'bun run build:binary']} />
          </div>
        </div>

        {/* Footer */}
        <div style={{
          borderTop: '1px solid var(--border)',
          padding: '14px 24px',
          display: 'flex', justifyContent: 'flex-end',
        }}>
          <button
            onClick={onClose}
            style={{
              padding: '8px 20px', borderRadius: 8,
              background: 'var(--bg-card)',
              border: '1px solid var(--border)',
              color: 'var(--text-secondary)',
              fontSize: 13, fontWeight: 500, cursor: 'pointer',
              transition: 'background 0.15s',
            }}
            onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-hover, var(--border))')}
            onMouseLeave={e => (e.currentTarget.style.background = 'var(--bg-card)')}
          >
            {t.close}
          </button>
        </div>
      </div>
    </div>
  )
}

function VersionPill({ label, version, accent, dim }: { label: string; version: string; accent: string; dim?: boolean }) {
  return (
    <div style={{
      display: 'flex', flexDirection: 'column', gap: 4,
      padding: '10px 14px', borderRadius: 10,
      background: dim ? 'var(--bg-card)' : 'color-mix(in srgb, var(--accent-green) 10%, transparent)',
      border: `1px solid ${dim ? 'var(--border)' : 'color-mix(in srgb, var(--accent-green) 30%, transparent)'}`,
    }}>
      <span style={{ fontSize: 10, color: 'var(--text-tertiary)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
        {label}
      </span>
      <span style={{ fontSize: 18, fontWeight: 800, color: accent, letterSpacing: '-0.02em' }}>
        v{version}
      </span>
    </div>
  )
}

function CodeBlock({ lines }: { lines: string[] }) {
  return (
    <div style={{
      background: 'var(--bg-surface)',
      border: '1px solid var(--border)',
      borderRadius: 8,
      padding: '10px 14px',
      fontFamily: 'monospace',
      fontSize: 12,
      lineHeight: 1.8,
      color: 'var(--text-primary)',
    }}>
      {lines.map((line, i) => (
        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ color: 'var(--accent-green)', userSelect: 'none' }}>$</span>
          <span>{line}</span>
        </div>
      ))}
    </div>
  )
}
