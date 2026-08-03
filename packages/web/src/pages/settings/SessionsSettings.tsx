import React, { useState, useEffect } from 'react'
import { useOutletContext } from 'react-router-dom'
import { Check, HardDrive, FolderClock, ExternalLink, DatabaseZap } from 'lucide-react'
import type { AppContext } from '../../lib/app-context'
import type { ArchiveMode } from '../../components/ArchiveConsentModal'
import { SectionHeader } from './primitives'

const ARCHIVE_DOCS_URL = 'https://code.claude.com/docs/en/settings'

export default function SessionsSettings() {
  const ctx = useOutletContext<AppContext>()
  const pt = ctx.lang === 'pt'
  const [mode, setMode] = useState<ArchiveMode | null>(null)
  const [saving, setSaving] = useState<ArchiveMode | null>(null)
  const [savedAt, setSavedAt] = useState<number>(0)

  useEffect(() => {
    fetch('/api/preferences')
      .then(r => (r.ok ? r.json() : null))
      .then((p: { archiveMode?: ArchiveMode; archiveSessions?: boolean } | null) => {
        const m: ArchiveMode =
          p?.archiveMode ?? (p?.archiveSessions === true ? 'full' : p?.archiveSessions === false ? 'off' : 'off')
        setMode(m)
      })
      .catch(() => setMode('off'))
  }, [])

  const choose = (m: ArchiveMode) => {
    if (m === mode || saving) return
    const prev = mode
    setMode(m)
    setSaving(m)
    fetch('/api/preferences', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ archiveMode: m }),
    })
      .then(r => { if (!r.ok) throw new Error('save failed'); setSavedAt(Date.now()) })
      .catch(() => setMode(prev))
      .finally(() => setSaving(null))
  }

  const OPTIONS: { id: ArchiveMode; icon: React.ReactNode; title: string; desc: string; tag?: string }[] = [
    {
      id: 'consolidate',
      icon: <DatabaseZap size={18} />,
      title: pt ? 'Consolidar métricas' : 'Consolidate metrics',
      desc: pt
        ? 'Guarda as métricas calculadas de cada sessão (~KB). Preserva todos os números + agent metrics para sempre, sem duplicar arquivos.'
        : 'Stores each session’s computed metrics (~KB). Preserves all numbers + agent metrics forever, without duplicating files.',
      tag: pt ? 'Recomendado' : 'Recommended',
    },
    {
      id: 'full',
      icon: <HardDrive size={18} />,
      title: pt ? 'Cópia fiel completa' : 'Full faithful copy',
      desc: pt
        ? 'Espelha os transcripts crus também, para reler conversas antigas. Usa muito mais disco e cresce com o tempo.'
        : 'Also mirrors the raw transcripts so you can re-read old conversations. Uses much more disk and grows over time.',
    },
    {
      id: 'off',
      icon: <FolderClock size={18} />,
      title: pt ? 'Pasta padrão do Claude' : 'Claude’s default folder',
      desc: pt
        ? 'Não preserva nada. Sessões com mais de 30 dias continuam sumindo.'
        : 'Preserves nothing. Sessions older than 30 days keep disappearing.',
    },
  ]

  return (
    <div>
      <SectionHeader label={pt ? 'Preservação de histórico' : 'History preservation'} />
      <p style={{ fontSize: 12.5, color: 'var(--text-tertiary)', lineHeight: 1.55, margin: '0 0 14px' }}>
        {pt
          ? 'O Claude Code apaga transcripts com mais de 30 dias a cada inicialização. Escolha como o Agentistics preserva seu histórico (tudo fica local em ~/.agentistics).'
          : 'Claude Code deletes transcripts older than 30 days on every startup. Choose how Agentistics preserves your history (everything stays local in ~/.agentistics).'}
      </p>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {OPTIONS.map(opt => {
          const active = mode === opt.id
          return (
            <button
              key={opt.id}
              onClick={() => choose(opt.id)}
              disabled={saving !== null}
              style={{
                display: 'flex', alignItems: 'flex-start', gap: 11, textAlign: 'left',
                padding: '13px 15px', borderRadius: 'var(--radius-lg)',
                border: active ? '1.5px solid var(--anthropic-orange)' : '1px solid var(--border)',
                background: active ? 'var(--anthropic-orange-dim)' : 'var(--bg-card)',
                cursor: saving !== null ? 'default' : 'pointer',
                fontFamily: 'inherit',
                transition: 'border-color 0.15s, background 0.15s',
              }}
            >
              <span style={{ color: active ? 'var(--anthropic-orange)' : 'var(--text-tertiary)', flexShrink: 0, marginTop: 1 }}>
                {opt.icon}
              </span>
              <div style={{ flex: 1 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--text-primary)' }}>{opt.title}</span>
                  {opt.tag && (
                    <span style={{
                      fontSize: 9.5, fontWeight: 700, textTransform: 'uppercase',
                      color: 'var(--accent-green)', border: '1px solid var(--accent-green)',
                      padding: '1px 6px', borderRadius: 10,
                    }}>{opt.tag}</span>
                  )}
                </div>
                <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 3, lineHeight: 1.5 }}>{opt.desc}</div>
              </div>
              {active && <Check size={16} style={{ color: 'var(--anthropic-orange)', flexShrink: 0, marginTop: 2 }} />}
            </button>
          )
        })}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 14 }}>
        <a
          href={ARCHIVE_DOCS_URL}
          target="_blank"
          rel="noopener noreferrer"
          style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 12, color: 'var(--anthropic-orange)', textDecoration: 'none' }}
        >
          <ExternalLink size={13} />
          {pt ? 'Documentação oficial' : 'Official documentation'}
        </a>
        {savedAt > 0 && saving === null && (
          <span style={{ fontSize: 11.5, color: 'var(--accent-green)' }}>{pt ? 'Salvo' : 'Saved'}</span>
        )}
      </div>
    </div>
  )
}
