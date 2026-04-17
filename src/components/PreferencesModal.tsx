import React, { useRef, useState } from 'react'
import { X, GripVertical, RotateCcw, Save } from 'lucide-react'
import type { Lang, Theme } from '../lib/types'

export interface PrefsDraft {
  lang: Lang
  theme: Theme
  currency: 'USD' | 'BRL'
  cardOrder: string[]
  cardPrecision: Record<string, boolean>
}

interface Props {
  initial: PrefsDraft
  onSave: (draft: PrefsDraft) => void
  onClose: () => void
}

const CARD_LABELS: Record<string, { en: string; pt: string }> = {
  messages: { en: 'Messages', pt: 'Mensagens' },
  sessions: { en: 'Sessions', pt: 'Sessões' },
  'tool-calls': { en: 'Tool calls', pt: 'Tool calls' },
  'input-tokens': { en: 'Input tokens', pt: 'Tokens entrada' },
  'output-tokens': { en: 'Output tokens', pt: 'Tokens saída' },
  cost: { en: 'Est. cost', pt: 'Custo estimado' },
  streak: { en: 'Streak', pt: 'Sequência' },
  'longest-session': { en: 'Longest session', pt: 'Sessão mais longa' },
  commits: { en: 'Commits', pt: 'Commits' },
  files: { en: 'Files', pt: 'Arquivos' },
}

const DEFAULT_CARD_ORDER = [
  'messages', 'sessions', 'tool-calls', 'input-tokens', 'output-tokens',
  'cost', 'streak', 'longest-session', 'commits', 'files',
]

const METRIC_IDS = ['kpi.messages', 'kpi.sessions', 'kpi.tool-calls', 'kpi.input-tokens', 'kpi.output-tokens']

function TabSelect<T extends string>({
  options, value, onChange, accent = 'var(--anthropic-orange)',
}: {
  options: { value: T; label: string }[]
  value: T
  onChange: (v: T) => void
  accent?: string
}) {
  return (
    <div style={{ display: 'flex', border: '1px solid var(--border)', borderRadius: 6, overflow: 'hidden' }}>
      {options.map((opt, i) => {
        const active = opt.value === value
        return (
          <button
            key={opt.value}
            onClick={() => onChange(opt.value)}
            style={{
              padding: '5px 12px',
              fontSize: 12, fontWeight: active ? 700 : 500,
              background: active ? `color-mix(in srgb, ${accent} 18%, transparent)` : 'transparent',
              color: active ? accent : 'var(--text-secondary)',
              border: 'none',
              borderRight: i < options.length - 1 ? '1px solid var(--border)' : 'none',
              cursor: active ? 'default' : 'pointer',
              fontFamily: 'inherit',
              transition: 'background 0.15s, color 0.15s',
              whiteSpace: 'nowrap',
            }}
          >
            {opt.label}
          </button>
        )
      })}
    </div>
  )
}

function PrefRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
      <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>{label}</span>
      {children}
    </div>
  )
}

export function PreferencesModal({ initial, onSave, onClose }: Props) {
  const [draft, setDraft] = useState<PrefsDraft>({ ...initial, cardOrder: [...initial.cardOrder], cardPrecision: { ...initial.cardPrecision } })
  const pt = draft.lang === 'pt'

  const dragRef = useRef<string | null>(null)
  const [dragOver, setDragOver] = useState<string | null>(null)

  function set<K extends keyof PrefsDraft>(key: K, value: PrefsDraft[K]) {
    setDraft(d => ({ ...d, [key]: value }))
  }

  function handleDragStart(id: string) { dragRef.current = id }
  function handleDragOver(e: React.DragEvent, id: string) {
    e.preventDefault()
    if (dragRef.current !== id) setDragOver(id)
  }
  function handleDrop(id: string) {
    const from = dragRef.current
    if (!from || from === id) { dragRef.current = null; setDragOver(null); return }
    const next = [...draft.cardOrder]
    const fi = next.indexOf(from)
    const ti = next.indexOf(id)
    next.splice(fi, 1)
    next.splice(ti, 0, from)
    set('cardOrder', next)
    dragRef.current = null
    setDragOver(null)
  }
  function handleDragEnd() { dragRef.current = null; setDragOver(null) }

  const allFull = METRIC_IDS.every(id => draft.cardPrecision[id] === true)
  const numFormat = allFull ? 'full' : 'abbr'

  function setAllNumbers(full: boolean) {
    const next = { ...draft.cardPrecision }
    for (const id of METRIC_IDS) next[id] = full
    set('cardPrecision', next)
  }

  const btnBase: React.CSSProperties = {
    display: 'flex', alignItems: 'center', gap: 5,
    padding: '4px 10px', borderRadius: 6, fontSize: 11, fontWeight: 600,
    border: '1px solid var(--border)', background: 'transparent',
    color: 'var(--text-tertiary)', cursor: 'pointer', fontFamily: 'inherit',
    transition: 'all 0.15s',
  }

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 2000,
        background: 'rgba(0,0,0,0.5)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        backdropFilter: 'blur(4px)',
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: 'var(--bg-surface)',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius-lg)',
          width: 460,
          maxHeight: '88vh',
          display: 'flex',
          flexDirection: 'column',
          boxShadow: '0 20px 60px rgba(0,0,0,0.35)',
        }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '20px 24px 0' }}>
          <span style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-primary)' }}>
            {pt ? 'Preferências' : 'Preferences'}
          </span>
          <button
            onClick={onClose}
            style={{
              width: 28, height: 28, display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: 'transparent', border: '1px solid var(--border)', borderRadius: 7,
              color: 'var(--text-tertiary)', cursor: 'pointer',
            }}
          >
            <X size={13} />
          </button>
        </div>

        {/* Scrollable body */}
        <div style={{ overflowY: 'auto', padding: '20px 24px', flex: 1 }}>
          {/* Display section */}
          <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-tertiary)', letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 14 }}>
            {pt ? 'Exibição' : 'Display'}
          </div>

          <PrefRow label={pt ? 'Tema' : 'Theme'}>
            <TabSelect
              options={[
                { value: 'dark' as Theme, label: pt ? 'Escuro' : 'Dark' },
                { value: 'light' as Theme, label: pt ? 'Claro' : 'Light' },
              ]}
              value={draft.theme}
              onChange={v => set('theme', v)}
            />
          </PrefRow>

          <PrefRow label={pt ? 'Idioma' : 'Language'}>
            <TabSelect
              options={[
                { value: 'en' as Lang, label: 'English' },
                { value: 'pt' as Lang, label: 'Português' },
              ]}
              value={draft.lang}
              onChange={v => set('lang', v)}
            />
          </PrefRow>

          <PrefRow label={pt ? 'Moeda' : 'Currency'}>
            <TabSelect
              options={[
                { value: 'USD' as 'USD' | 'BRL', label: 'USD $' },
                { value: 'BRL' as 'USD' | 'BRL', label: 'BRL R$' },
              ]}
              value={draft.currency}
              onChange={v => set('currency', v)}
            />
          </PrefRow>

          <PrefRow label={pt ? 'Números' : 'Numbers'}>
            <TabSelect
              options={[
                { value: 'abbr', label: '1.2M' },
                { value: 'full', label: '1.234.567' },
              ]}
              value={numFormat}
              onChange={v => setAllNumbers(v === 'full')}
            />
          </PrefRow>

          <div style={{ height: 1, background: 'var(--border)', margin: '16px 0' }} />

          {/* Card order section */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-tertiary)', letterSpacing: '0.06em', textTransform: 'uppercase' }}>
              {pt ? 'Ordem dos cards (home)' : 'Card order (home)'}
            </div>
            <button
              onClick={() => set('cardOrder', [...DEFAULT_CARD_ORDER])}
              style={btnBase}
            >
              <RotateCcw size={10} />
              {pt ? 'Resetar' : 'Reset'}
            </button>
          </div>

          <div>
            {draft.cardOrder.map(id => (
              <div
                key={id}
                draggable
                onDragStart={() => handleDragStart(id)}
                onDragOver={e => handleDragOver(e, id)}
                onDrop={() => handleDrop(id)}
                onDragEnd={handleDragEnd}
                style={{
                  display: 'flex', alignItems: 'center', gap: 10,
                  padding: '8px 10px',
                  borderRadius: 8,
                  background: dragOver === id ? 'var(--bg-elevated)' : 'transparent',
                  border: dragOver === id
                    ? '1px dashed var(--anthropic-orange)'
                    : '1px solid transparent',
                  cursor: 'grab',
                  marginBottom: 2,
                  transition: 'background 0.1s, border-color 0.1s',
                  userSelect: 'none',
                }}
              >
                <GripVertical size={13} style={{ color: 'var(--text-tertiary)', flexShrink: 0 }} />
                <span style={{ fontSize: 13, color: 'var(--text-primary)' }}>
                  {CARD_LABELS[id]?.[draft.lang] ?? id}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Footer with Save/Cancel */}
        <div style={{
          display: 'flex', justifyContent: 'flex-end', gap: 8,
          padding: '16px 24px',
          borderTop: '1px solid var(--border)',
          background: 'var(--bg-surface)',
          borderRadius: '0 0 var(--radius-lg) var(--radius-lg)',
        }}>
          <button
            onClick={onClose}
            style={{
              padding: '7px 16px', borderRadius: 7, fontSize: 13, fontWeight: 500,
              border: '1px solid var(--border)', background: 'transparent',
              color: 'var(--text-secondary)', cursor: 'pointer', fontFamily: 'inherit',
              transition: 'all 0.15s',
            }}
          >
            {pt ? 'Cancelar' : 'Cancel'}
          </button>
          <button
            onClick={() => onSave(draft)}
            style={{
              display: 'flex', alignItems: 'center', gap: 6,
              padding: '7px 16px', borderRadius: 7, fontSize: 13, fontWeight: 600,
              border: '1px solid var(--anthropic-orange)',
              background: 'var(--anthropic-orange-dim)',
              color: 'var(--anthropic-orange)', cursor: 'pointer', fontFamily: 'inherit',
              transition: 'all 0.15s',
            }}
          >
            <Save size={13} />
            {pt ? 'Salvar' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  )
}
