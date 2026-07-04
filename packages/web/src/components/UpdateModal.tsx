import React, { useEffect, useCallback, useState } from 'react'
import { X, ArrowUpCircle, Terminal, Download, Copy, Check } from 'lucide-react'
import type { Lang } from '@agentistics/core'
import { copyText } from '../lib/clipboard'

interface Props {
  current: string
  latest: string
  lang: Lang
  /** true when this instance runs in central (hub) mode → rebuild the central. */
  isCentral?: boolean
  /** true when this instance is a team member pushing to a central. */
  isMember?: boolean
  onClose: () => void
}

export function UpdateModal({ current, latest, lang, isCentral, isMember, onClose }: Props) {
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
        centralTitle: 'Central — recompilar e reiniciar',
        centralDesc: 'Nesta máquina central, atualize o código e reconstrua o serviço:',
        memberTitle: 'Atualizar e reiniciar',
        memberDesc: 'Baixe o binário mais recente e reinicie o serviço:',
        restartNote: 'Se você não usa o autostart (systemd), basta rodar novamente:',
        binaryTitle: 'Ou baixe o binário manualmente',
        binaryDesc: 'Acesse a página de releases e substitua seu binário atual.',
        releasePage: 'Página de releases',
        close: 'Fechar',
        copy: 'Copiar',
        copied: 'Copiado',
      }
    : {
        title: 'New version available',
        subtitle: 'A new version of agentistics is available.',
        current: 'Current version',
        latest: 'Latest version',
        howTo: 'How to update',
        centralTitle: 'Central — rebuild & restart',
        centralDesc: 'On this central machine, pull the update and rebuild the service:',
        memberTitle: 'Upgrade & restart',
        memberDesc: 'Download the latest binary and restart the service:',
        restartNote: 'If you are not using autostart (systemd), just re-run:',
        binaryTitle: 'Or download the binary manually',
        binaryDesc: 'Go to the releases page and replace your current binary.',
        releasePage: 'Releases page',
        close: 'Close',
        copy: 'Copy',
        copied: 'Copied',
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

          {isCentral ? (
            <div style={{
              background: 'var(--bg-card)',
              border: '1px solid var(--border)',
              borderRadius: 10, padding: '14px 16px',
            }}>
              <SectionHeader icon={<Terminal size={14} color="var(--accent-blue, #60a5fa)" />} label={t.centralTitle} />
              <p style={{ fontSize: 12, color: 'var(--text-secondary)', margin: '0 0 10px', lineHeight: 1.6 }}>
                {t.centralDesc}
              </p>
              <CommandLine command="bun run up:central" copyLabel={t.copy} copiedLabel={t.copied} />
            </div>
          ) : (
            <div style={{
              background: 'var(--bg-card)',
              border: '1px solid var(--border)',
              borderRadius: 10, padding: '14px 16px',
            }}>
              <SectionHeader icon={<Terminal size={14} color="var(--accent-blue, #60a5fa)" />} label={t.memberTitle} />
              <p style={{ fontSize: 12, color: 'var(--text-secondary)', margin: '0 0 10px', lineHeight: 1.6 }}>
                {t.memberDesc}
              </p>
              <CommandLine command="agentop upgrade" copyLabel={t.copy} copiedLabel={t.copied} />
              <div style={{ height: 8 }} />
              <CommandLine command="systemctl --user restart agentop-server" copyLabel={t.copy} copiedLabel={t.copied} />
              <p style={{ fontSize: 11, color: 'var(--text-tertiary)', margin: '10px 0 8px', lineHeight: 1.6 }}>
                {t.restartNote}
              </p>
              <CommandLine command="agentop server" copyLabel={t.copy} copiedLabel={t.copied} />
            </div>
          )}

          {/* Download binary (secondary) */}
          <div style={{
            background: 'var(--bg-card)',
            border: '1px solid var(--border)',
            borderRadius: 10, padding: '14px 16px', marginTop: 10,
          }}>
            <SectionHeader icon={<Download size={14} color="var(--anthropic-orange)" />} label={t.binaryTitle} />
            <p style={{ fontSize: 12, color: 'var(--text-secondary)', margin: '0 0 10px', lineHeight: 1.6 }}>
              {t.binaryDesc}
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
              <Download size={12} />
              {t.releasePage} — v{latest}
            </a>
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

function SectionHeader({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
      {icon}
      <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>
        {label}
      </span>
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

function CommandLine({ command, copyLabel, copiedLabel }: { command: string; copyLabel: string; copiedLabel: string }) {
  const [copied, setCopied] = useState(false)
  const onCopy = useCallback(async () => {
    const ok = await copyText(command)
    if (ok) {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    }
  }, [command])

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 8,
      background: 'var(--bg-surface)',
      border: '1px solid var(--border)',
      borderRadius: 8,
      padding: '8px 10px 8px 14px',
    }}>
      <span style={{ color: 'var(--accent-green)', userSelect: 'none', fontFamily: 'monospace', fontSize: 12 }}>$</span>
      <code style={{
        flex: 1, fontFamily: 'monospace', fontSize: 12,
        color: 'var(--text-primary)', overflowX: 'auto', whiteSpace: 'nowrap',
      }}>
        {command}
      </code>
      <button
        onClick={onCopy}
        title={copied ? copiedLabel : copyLabel}
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 5,
          padding: '4px 8px', borderRadius: 6, cursor: 'pointer',
          background: 'var(--bg-card)', border: '1px solid var(--border)',
          color: copied ? 'var(--accent-green)' : 'var(--text-secondary)',
          fontSize: 11, fontWeight: 600, flexShrink: 0,
        }}
      >
        {copied ? <Check size={12} /> : <Copy size={12} />}
        {copied ? copiedLabel : copyLabel}
      </button>
    </div>
  )
}
