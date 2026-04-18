import React, { useRef, useState } from 'react'
import { X, GripVertical, RotateCcw, Save, Volume2, VolumeX, Zap, Bot } from 'lucide-react'
import type { Lang, Theme } from '../lib/types'
import { CHAT_MODELS, type ChatModelId, DEFAULT_CHAT_MODEL } from '../lib/chatModels'

export interface PrefsDraft {
  lang: Lang
  theme: Theme
  currency: 'USD' | 'BRL'
  cardOrder: string[]
  cardPrecision: Record<string, boolean>
  chatModel: ChatModelId | null
  chatSoundEnabled: boolean
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

const BADGE_COLORS: Record<string, string> = {
  Fast:     'var(--accent-green)',
  Balanced: 'var(--anthropic-orange)',
  Powerful: 'var(--accent-purple)',
}

function SectionHeader({ label }: { label: string }) {
  return (
    <div style={{
      fontSize: 11, fontWeight: 700, color: 'var(--text-tertiary)',
      letterSpacing: '0.07em', textTransform: 'uppercase', marginBottom: 14,
    }}>
      {label}
    </div>
  )
}

function Divider() {
  return <div style={{ height: 1, background: 'var(--border)', margin: '20px 0' }} />
}

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

function PrefRow({ label, sub, children }: { label: string; sub?: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14, gap: 12 }}>
      <div>
        <div style={{ fontSize: 13, color: 'var(--text-secondary)', fontWeight: 500 }}>{label}</div>
        {sub && <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 2 }}>{sub}</div>}
      </div>
      {children}
    </div>
  )
}

function Toggle({ on, onToggle }: { on: boolean; onToggle: () => void }) {
  return (
    <button
      onClick={onToggle}
      style={{
        position: 'relative', width: 34, height: 20, borderRadius: 10,
        border: 'none', background: on ? 'var(--anthropic-orange)' : 'var(--text-tertiary)',
        cursor: 'pointer', padding: 0, transition: 'background 0.2s', flexShrink: 0,
      }}
    >
      <span style={{
        position: 'absolute', top: 3, left: on ? 17 : 3,
        width: 14, height: 14, borderRadius: '50%', background: '#fff',
        transition: 'left 0.2s', boxShadow: '0 1px 3px rgba(0,0,0,0.3)',
      }} />
    </button>
  )
}

export function PreferencesModal({ initial, onSave, onClose }: Props) {
  const [draft, setDraft] = useState<PrefsDraft>({
    ...initial,
    cardOrder: [...initial.cardOrder],
    cardPrecision: { ...initial.cardPrecision },
    chatModel: initial.chatModel ?? null,
    chatSoundEnabled: initial.chatSoundEnabled ?? true,
  })
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
          width: 480,
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

          {/* ── Display ───────────────────────────────────────── */}
          <SectionHeader label={pt ? 'Exibição' : 'Display'} />

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

          <Divider />

          {/* ── Card order ────────────────────────────────────── */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
            <SectionHeader label={pt ? 'Ordem dos cards (home)' : 'Card order (home)'} />
            <button onClick={() => set('cardOrder', [...DEFAULT_CARD_ORDER])} style={{ ...btnBase, marginTop: -14 }}>
              <RotateCcw size={10} />
              {pt ? 'Resetar' : 'Reset'}
            </button>
          </div>

          <div style={{ marginBottom: 4 }}>
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
                  border: dragOver === id ? '1px dashed var(--anthropic-orange)' : '1px solid transparent',
                  cursor: 'grab', marginBottom: 2,
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

          <Divider />

          {/* ── Chat ──────────────────────────────────────────── */}
          <SectionHeader label={pt ? 'Chat' : 'Chat'} />

          {/* Sound toggle */}
          <PrefRow
            label={pt ? 'Som de notificação' : 'Notification sound'}
            sub={pt
              ? 'Toca quando uma resposta chega com o chat minimizado'
              : 'Plays when a reply arrives while the chat is minimized'}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              {draft.chatSoundEnabled
                ? <Volume2 size={14} color="var(--anthropic-orange)" />
                : <VolumeX size={14} color="var(--text-tertiary)" />}
              <Toggle
                on={draft.chatSoundEnabled}
                onToggle={() => set('chatSoundEnabled', !draft.chatSoundEnabled)}
              />
            </div>
          </PrefRow>

          {/* Model selector */}
          <div style={{ marginBottom: 4 }}>
            <div style={{ fontSize: 13, color: 'var(--text-secondary)', fontWeight: 500, marginBottom: 10 }}>
              {pt ? 'Modelo do chat' : 'Chat model'}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {CHAT_MODELS.map(m => {
                const active = (draft.chatModel ?? DEFAULT_CHAT_MODEL) === m.id
                const badgeColor = BADGE_COLORS[m.badge] ?? 'var(--text-tertiary)'
                return (
                  <button
                    key={m.id}
                    onClick={() => set('chatModel', m.id)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 12,
                      padding: '10px 12px',
                      borderRadius: 8,
                      border: active ? `1.5px solid var(--anthropic-orange)` : '1px solid var(--border)',
                      background: active ? 'var(--anthropic-orange-dim)' : 'var(--bg-elevated)',
                      cursor: 'pointer',
                      textAlign: 'left',
                      transition: 'all 0.15s',
                      fontFamily: 'inherit',
                    }}
                  >
                    <div style={{
                      width: 32, height: 32, borderRadius: 8, flexShrink: 0,
                      background: active ? 'var(--anthropic-orange-dim)' : 'var(--bg-card)',
                      border: `1px solid ${active ? 'var(--anthropic-orange)40' : 'var(--border)'}`,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                    }}>
                      <Bot size={15} color={active ? 'var(--anthropic-orange)' : 'var(--text-tertiary)'} />
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 2 }}>
                        <span style={{ fontSize: 13, fontWeight: 700, color: active ? 'var(--anthropic-orange)' : 'var(--text-primary)' }}>
                          {m.label}
                        </span>
                        <span style={{
                          fontSize: 10, fontWeight: 700,
                          color: badgeColor,
                          background: `color-mix(in srgb, ${badgeColor} 12%, transparent)`,
                          border: `1px solid color-mix(in srgb, ${badgeColor} 30%, transparent)`,
                          padding: '1px 6px', borderRadius: 4,
                        }}>
                          {m.badge}
                        </span>
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>{m.desc}</div>
                    </div>
                    <div style={{ fontSize: 10, color: 'var(--text-tertiary)', textAlign: 'right', flexShrink: 0 }}>
                      <div>${m.inputPer1M}</div>
                      <div>${m.outputPer1M}</div>
                    </div>
                    {active && (
                      <Zap size={13} color="var(--anthropic-orange)" style={{ flexShrink: 0 }} />
                    )}
                  </button>
                )
              })}
            </div>
            <div style={{ fontSize: 10, color: 'var(--text-tertiary)', marginTop: 7 }}>
              {pt ? 'USD por 1M tokens (entrada / saída)' : 'USD per 1M tokens (input / output)'}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div style={{
          display: 'flex', justifyContent: 'flex-end', gap: 8,
          padding: '16px 24px',
          borderTop: '1px solid var(--border)',
          background: 'var(--bg-surface)',
          borderRadius: '0 0 var(--radius-lg) var(--radius-lg)',
          flexShrink: 0,
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
