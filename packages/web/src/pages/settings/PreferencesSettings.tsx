import React, { useRef, useState, useCallback } from 'react'
import { useOutletContext } from 'react-router-dom'
import { GripVertical, RotateCcw, Save, Volume2, VolumeX, Zap, Bot } from 'lucide-react'
import type { Lang, Theme } from '@agentistics/core'
import type { AppContext, PrefsDraft } from '../../lib/app-context'
import { CHAT_MODELS, DEFAULT_CHAT_MODEL } from '../../lib/chatModels'
import { CHAT_SOUNDS, DEFAULT_CHAT_SOUND_ID, findChatSound } from '../../lib/chatSounds'
import { SectionHeader, Divider, TabSelect, PrefRow, Toggle } from './primitives'

const CARD_LABELS: Record<string, { en: string; pt: string }> = {
  messages:         { en: 'Messages',        pt: 'Mensagens' },
  sessions:         { en: 'Sessions',        pt: 'Sessões' },
  'tool-calls':     { en: 'Tool calls',      pt: 'Tool calls' },
  'input-tokens':   { en: 'Input tokens',    pt: 'Tokens entrada' },
  'output-tokens':  { en: 'Output tokens',   pt: 'Tokens saída' },
  cost:             { en: 'Est. cost',       pt: 'Custo estimado' },
  streak:           { en: 'Streak',          pt: 'Sequência' },
  'longest-session':{ en: 'Longest session', pt: 'Sessão mais longa' },
  commits:          { en: 'Commits',         pt: 'Commits' },
  files:            { en: 'Files',           pt: 'Arquivos' },
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

function seedDraft(ctx: AppContext): PrefsDraft {
  return {
    lang: ctx.lang,
    theme: ctx.theme,
    currency: ctx.currency,
    cardOrder: [...ctx.cardOrder],
    cardPrecision: { ...ctx.cardPrecision },
    chatModel: ctx.chatModel ?? null,
    chatSoundEnabled: ctx.chatSoundEnabled ?? true,
    chatSoundId: ctx.chatSoundId ?? DEFAULT_CHAT_SOUND_ID,
  }
}

export default function PreferencesSettings() {
  const ctx = useOutletContext<AppContext>()
  const [draft, setDraft] = useState<PrefsDraft>(() => seedDraft(ctx))
  const pt = draft.lang === 'pt'

  const previewCtxRef = useRef<AudioContext | null>(null)
  const previewSound = useCallback((id: string) => {
    if (!previewCtxRef.current) {
      try { previewCtxRef.current = new AudioContext() } catch { return }
    }
    findChatSound(id).play(previewCtxRef.current)
  }, [])

  function set<K extends keyof PrefsDraft>(k: K, v: PrefsDraft[K]) {
    setDraft(d => ({ ...d, [k]: v }))
  }

  const dragRef = useRef<string | null>(null)
  const [dragOver, setDragOver] = useState<string | null>(null)

  function handleDragStart(id: string) { dragRef.current = id }
  function handleDragOver(e: React.DragEvent, id: string) {
    e.preventDefault()
    if (dragRef.current !== id) setDragOver(id)
  }
  function handleDrop(id: string) {
    const from = dragRef.current
    if (!from || from === id) { dragRef.current = null; setDragOver(null); return }
    const next = [...draft.cardOrder]
    const fi = next.indexOf(from); const ti = next.indexOf(id)
    next.splice(fi, 1); next.splice(ti, 0, from)
    set('cardOrder', next)
    dragRef.current = null; setDragOver(null)
  }
  function handleDragEnd() { dragRef.current = null; setDragOver(null) }

  const allFull = METRIC_IDS.every(id => draft.cardPrecision[id] === true)
  const numFormat = allFull ? 'full' : 'abbr'
  function setAllNumbers(full: boolean) {
    const next = { ...draft.cardPrecision }
    for (const id of METRIC_IDS) next[id] = full
    set('cardPrecision', next)
  }

  const dirty = JSON.stringify(draft) !== JSON.stringify(seedDraft(ctx))

  return (
    <>
      {/* ── Display ── */}
      <SectionHeader label={pt ? 'Exibição' : 'Display'} />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 16 }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          <div>
            <div style={{ fontSize: 11, color: 'var(--text-tertiary)', fontWeight: 600, marginBottom: 5, letterSpacing: '0.04em', textTransform: 'uppercase' }}>{pt ? 'Tema' : 'Theme'}</div>
            <TabSelect
              options={[{ value: 'dark' as Theme, label: pt ? 'Escuro' : 'Dark' }, { value: 'light' as Theme, label: pt ? 'Claro' : 'Light' }]}
              value={draft.theme}
              onChange={v => set('theme', v)}
            />
          </div>
          <div>
            <div style={{ fontSize: 11, color: 'var(--text-tertiary)', fontWeight: 600, marginBottom: 5, letterSpacing: '0.04em', textTransform: 'uppercase' }}>{pt ? 'Idioma' : 'Language'}</div>
            <TabSelect
              options={[{ value: 'en' as Lang, label: 'English' }, { value: 'pt' as Lang, label: 'Português' }]}
              value={draft.lang}
              onChange={v => set('lang', v)}
            />
          </div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          <div>
            <div style={{ fontSize: 11, color: 'var(--text-tertiary)', fontWeight: 600, marginBottom: 5, letterSpacing: '0.04em', textTransform: 'uppercase' }}>{pt ? 'Moeda' : 'Currency'}</div>
            <TabSelect
              options={[{ value: 'USD' as 'USD'|'BRL', label: 'USD $' }, { value: 'BRL' as 'USD'|'BRL', label: 'BRL R$' }]}
              value={draft.currency}
              onChange={v => set('currency', v)}
            />
          </div>
          <div>
            <div style={{ fontSize: 11, color: 'var(--text-tertiary)', fontWeight: 600, marginBottom: 5, letterSpacing: '0.04em', textTransform: 'uppercase' }}>{pt ? 'Números' : 'Numbers'}</div>
            <TabSelect
              options={[{ value: 'abbr', label: '1.2M' }, { value: 'full', label: '1,234,567' }]}
              value={numFormat}
              onChange={v => setAllNumbers(v === 'full')}
            />
          </div>
        </div>
      </div>

      <Divider />

      {/* ── Card order ── */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <SectionHeader label={pt ? 'Ordem dos cards' : 'Card order'} />
        <button
          onClick={() => set('cardOrder', [...DEFAULT_CARD_ORDER])}
          style={{
            display: 'flex', alignItems: 'center', gap: 4, marginTop: -14,
            padding: '3px 8px', borderRadius: 5, fontSize: 11, fontWeight: 600,
            border: '1px solid var(--border)', background: 'transparent',
            color: 'var(--text-tertiary)', cursor: 'pointer', fontFamily: 'inherit',
          }}
        >
          <RotateCcw size={9} />{pt ? 'Resetar' : 'Reset'}
        </button>
      </div>
      {/* 2-column drag grid */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 2, marginBottom: 4 }}>
        {draft.cardOrder.map(id => (
          <div key={id} draggable
            onDragStart={() => handleDragStart(id)}
            onDragOver={e => handleDragOver(e, id)}
            onDrop={() => handleDrop(id)}
            onDragEnd={handleDragEnd}
            style={{
              display: 'flex', alignItems: 'center', gap: 7, padding: '5px 8px', borderRadius: 6,
              background: dragOver === id ? 'var(--bg-elevated)' : 'transparent',
              border: dragOver === id ? '1px dashed var(--anthropic-orange)' : '1px solid transparent',
              cursor: 'grab', transition: 'background 0.1s, border-color 0.1s', userSelect: 'none',
            }}
          >
            <GripVertical size={11} style={{ color: 'var(--text-tertiary)', flexShrink: 0 }} />
            <span style={{ fontSize: 12, color: 'var(--text-primary)' }}>{CARD_LABELS[id]?.[draft.lang] ?? id}</span>
          </div>
        ))}
      </div>

      <Divider />

      {/* ── Chat ── */}
      <SectionHeader label="Chat" />
      <PrefRow
        label={pt ? 'Som de notificação' : 'Notification sound'}
        sub={pt ? 'Toca quando uma resposta chega com o chat minimizado' : 'Plays when a reply arrives while chat is minimized'}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {draft.chatSoundEnabled ? <Volume2 size={14} color="var(--anthropic-orange)" /> : <VolumeX size={14} color="var(--text-tertiary)" />}
          <Toggle
            on={draft.chatSoundEnabled}
            onToggle={() => {
              const next = !draft.chatSoundEnabled
              set('chatSoundEnabled', next)
              if (next) previewSound(draft.chatSoundId)
            }}
          />
        </div>
      </PrefRow>

      {/* Sound picker — only visible when sound is enabled */}
      {draft.chatSoundEnabled && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 12 }}>
          {CHAT_SOUNDS.map(s => {
            const active = draft.chatSoundId === s.id
            return (
              <button
                key={s.id}
                onClick={() => { set('chatSoundId', s.id); previewSound(s.id) }}
                style={{
                  padding: '5px 12px', borderRadius: 6, fontSize: 12, fontWeight: active ? 700 : 500,
                  border: active ? '1.5px solid var(--anthropic-orange)' : '1px solid var(--border)',
                  background: active ? 'var(--anthropic-orange-dim)' : 'var(--bg-elevated)',
                  color: active ? 'var(--anthropic-orange)' : 'var(--text-secondary)',
                  cursor: 'pointer', fontFamily: 'inherit', transition: 'all 0.15s',
                }}
              >
                {s.label[pt ? 'pt' : 'en']}
              </button>
            )
          })}
        </div>
      )}
      <div style={{ fontSize: 12, color: 'var(--text-secondary)', fontWeight: 500, marginBottom: 8 }}>
        {pt ? 'Modelo do chat' : 'Chat model'}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
        {CHAT_MODELS.map(m => {
          const active = (draft.chatModel ?? DEFAULT_CHAT_MODEL) === m.id
          const badgeColor = BADGE_COLORS[m.badge] ?? 'var(--text-tertiary)'
          return (
            <button key={m.id} onClick={() => set('chatModel', m.id)} style={{
              display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', borderRadius: 7,
              border: active ? '1.5px solid var(--anthropic-orange)' : '1px solid var(--border)',
              background: active ? 'var(--anthropic-orange-dim)' : 'var(--bg-elevated)',
              cursor: 'pointer', textAlign: 'left', transition: 'all 0.15s', fontFamily: 'inherit',
            }}>
              <Bot size={14} color={active ? 'var(--anthropic-orange)' : 'var(--text-tertiary)'} style={{ flexShrink: 0 }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ fontSize: 12, fontWeight: 700, color: active ? 'var(--anthropic-orange)' : 'var(--text-primary)' }}>{m.label}</span>
                  <span style={{
                    fontSize: 10, fontWeight: 700, color: badgeColor,
                    background: `color-mix(in srgb, ${badgeColor} 12%, transparent)`,
                    border: `1px solid color-mix(in srgb, ${badgeColor} 30%, transparent)`,
                    padding: '1px 5px', borderRadius: 4,
                  }}>{m.badge}</span>
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 1 }}>{m.desc}</div>
              </div>
              <div style={{ fontSize: 10, color: 'var(--text-tertiary)', textAlign: 'right', flexShrink: 0, lineHeight: 1.6 }}>
                <div>${m.inputPer1M}</div><div>${m.outputPer1M}</div>
              </div>
              {active && <Zap size={12} color="var(--anthropic-orange)" style={{ flexShrink: 0 }} />}
            </button>
          )
        })}
      </div>
      <div style={{ fontSize: 10, color: 'var(--text-tertiary)', marginTop: 6 }}>
        {pt ? 'USD por 1M tokens (entrada / saída)' : 'USD per 1M tokens (input / output)'}
      </div>

      {/* ── Save / Reset row ── */}
      <div style={{
        display: 'flex', justifyContent: 'flex-end', gap: 8,
        marginTop: 24, paddingTop: 16, borderTop: '1px solid var(--border)',
      }}>
        <button
          onClick={() => setDraft(seedDraft(ctx))}
          disabled={!dirty}
          style={{
            display: 'flex', alignItems: 'center', gap: 6,
            padding: '7px 16px', borderRadius: 7, fontSize: 13, fontWeight: 500,
            border: '1px solid var(--border)', background: 'transparent',
            color: 'var(--text-secondary)', cursor: dirty ? 'pointer' : 'default',
            fontFamily: 'inherit', transition: 'all 0.15s', opacity: dirty ? 1 : 0.5,
          }}
        >
          <RotateCcw size={13} />{pt ? 'Reverter' : 'Reset'}
        </button>
        <button
          onClick={() => ctx.savePreferences(draft)}
          disabled={!dirty}
          style={{
            display: 'flex', alignItems: 'center', gap: 6,
            padding: '7px 16px', borderRadius: 7, fontSize: 13, fontWeight: 600,
            border: '1px solid var(--anthropic-orange)',
            background: 'var(--anthropic-orange-dim)',
            color: 'var(--anthropic-orange)', cursor: dirty ? 'pointer' : 'default',
            fontFamily: 'inherit', transition: 'all 0.15s', opacity: dirty ? 1 : 0.5,
          }}
        >
          <Save size={13} />{pt ? 'Salvar' : 'Save'}
        </button>
      </div>
    </>
  )
}
