import React, { useRef, useState, useEffect, useCallback } from 'react'
import {
  X, GripVertical, RotateCcw, Save, Volume2, VolumeX, Zap, Bot,
  Globe, Monitor, Download, SlidersHorizontal, Activity, Code2,
} from 'lucide-react'
import type { Lang, Theme } from '@agentistics/core'
import { CHAT_MODELS, type ChatModelId, DEFAULT_CHAT_MODEL } from '../lib/chatModels'
import { LIVE_INTERVAL_OPTIONS, LIVE_INTERVAL_OPTIONS_RISKY } from '../hooks/useData'

type PwaPrompt = Event & { prompt(): Promise<void>; userChoice: Promise<{ outcome: string }> }

export interface PrefsDraft {
  lang: Lang
  theme: Theme
  currency: 'USD' | 'BRL'
  cardOrder: string[]
  cardPrecision: Record<string, boolean>
  chatModel: ChatModelId | null
  chatSoundEnabled: boolean
}

interface ConfigField { key: string; default: string; description: string }
interface ConfigResponse { config: Record<string, string>; backup: Record<string, string> | null; active: Record<string, string> }

const CONFIG_FIELDS: ConfigField[] = [
  { key: 'PORT',      default: '47291', description: 'API server port' },
  { key: 'VITE_PORT', default: '47292', description: 'Vite dev server port' },
]

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

export type SettingsTab = 'preferences' | 'live' | 'environment'

interface Props {
  initial: PrefsDraft
  onSave: (draft: PrefsDraft) => void
  onClose: () => void
  pwaPrompt?: PwaPrompt | null
  onPwaInstalled?: () => void
  // Live settings (applied immediately)
  liveUpdates: boolean
  setLiveUpdates: (v: boolean) => void
  updateInterval: number
  setUpdateInterval: (v: number) => void
  riskyMode: boolean
  setRiskyMode: (v: boolean) => void
  highlightUpdates: boolean
  setHighlightUpdates: (v: boolean) => void
  defaultTab?: SettingsTab
}

// ── Shared primitives ──────────────────────────────────────────────────────

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

// ── Tab: Preferences ──────────────────────────────────────────────────────

function PreferencesTab({
  draft, set, pt,
  pwaPrompt, onPwaInstalled, onClose,
}: {
  draft: PrefsDraft
  set: <K extends keyof PrefsDraft>(k: K, v: PrefsDraft[K]) => void
  pt: boolean
  pwaPrompt?: PwaPrompt | null
  onPwaInstalled?: () => void
  onClose: () => void
}) {
  const dragRef = useRef<string | null>(null)
  const [dragOver, setDragOver] = useState<string | null>(null)
  const btnBase: React.CSSProperties = {
    display: 'flex', alignItems: 'center', gap: 5,
    padding: '4px 10px', borderRadius: 6, fontSize: 11, fontWeight: 600,
    border: '1px solid var(--border)', background: 'transparent',
    color: 'var(--text-tertiary)', cursor: 'pointer', fontFamily: 'inherit',
    transition: 'all 0.15s',
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

  return (
    <>
      {/* ── Display ── */}
      <SectionHeader label={pt ? 'Exibição' : 'Display'} />

      <PrefRow label={pt ? 'Tema' : 'Theme'}>
        <TabSelect
          options={[{ value: 'dark' as Theme, label: pt ? 'Escuro' : 'Dark' }, { value: 'light' as Theme, label: pt ? 'Claro' : 'Light' }]}
          value={draft.theme} onChange={v => set('theme', v)}
        />
      </PrefRow>
      <PrefRow label={pt ? 'Idioma' : 'Language'}>
        <TabSelect
          options={[{ value: 'en' as Lang, label: 'English' }, { value: 'pt' as Lang, label: 'Português' }]}
          value={draft.lang} onChange={v => set('lang', v)}
        />
      </PrefRow>
      <PrefRow label={pt ? 'Moeda' : 'Currency'}>
        <TabSelect
          options={[{ value: 'USD' as 'USD' | 'BRL', label: 'USD $' }, { value: 'BRL' as 'USD' | 'BRL', label: 'BRL R$' }]}
          value={draft.currency} onChange={v => set('currency', v)}
        />
      </PrefRow>
      <PrefRow label={pt ? 'Números' : 'Numbers'}>
        <TabSelect
          options={[{ value: 'abbr', label: '1.2M' }, { value: 'full', label: '1.234.567' }]}
          value={numFormat} onChange={v => setAllNumbers(v === 'full')}
        />
      </PrefRow>

      <Divider />

      {/* ── Card order ── */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
        <SectionHeader label={pt ? 'Ordem dos cards (home)' : 'Card order (home)'} />
        <button onClick={() => set('cardOrder', [...DEFAULT_CARD_ORDER])} style={{ ...btnBase, marginTop: -14 }}>
          <RotateCcw size={10} />{pt ? 'Resetar' : 'Reset'}
        </button>
      </div>
      <div style={{ marginBottom: 4 }}>
        {draft.cardOrder.map(id => (
          <div key={id} draggable
            onDragStart={() => handleDragStart(id)}
            onDragOver={e => handleDragOver(e, id)}
            onDrop={() => handleDrop(id)}
            onDragEnd={handleDragEnd}
            style={{
              display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', borderRadius: 8,
              background: dragOver === id ? 'var(--bg-elevated)' : 'transparent',
              border: dragOver === id ? '1px dashed var(--anthropic-orange)' : '1px solid transparent',
              cursor: 'grab', marginBottom: 2, transition: 'background 0.1s, border-color 0.1s', userSelect: 'none',
            }}
          >
            <GripVertical size={13} style={{ color: 'var(--text-tertiary)', flexShrink: 0 }} />
            <span style={{ fontSize: 13, color: 'var(--text-primary)' }}>{CARD_LABELS[id]?.[draft.lang] ?? id}</span>
          </div>
        ))}
      </div>

      <Divider />

      {/* ── Chat ── */}
      <SectionHeader label="Chat" />
      <PrefRow
        label={pt ? 'Som de notificação' : 'Notification sound'}
        sub={pt ? 'Toca quando uma resposta chega com o chat minimizado' : 'Plays when a reply arrives while the chat is minimized'}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {draft.chatSoundEnabled ? <Volume2 size={14} color="var(--anthropic-orange)" /> : <VolumeX size={14} color="var(--text-tertiary)" />}
          <Toggle on={draft.chatSoundEnabled} onToggle={() => set('chatSoundEnabled', !draft.chatSoundEnabled)} />
        </div>
      </PrefRow>
      <div style={{ marginBottom: 4 }}>
        <div style={{ fontSize: 13, color: 'var(--text-secondary)', fontWeight: 500, marginBottom: 10 }}>
          {pt ? 'Modelo do chat' : 'Chat model'}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {CHAT_MODELS.map(m => {
            const active = (draft.chatModel ?? DEFAULT_CHAT_MODEL) === m.id
            const badgeColor = BADGE_COLORS[m.badge] ?? 'var(--text-tertiary)'
            return (
              <button key={m.id} onClick={() => set('chatModel', m.id)} style={{
                display: 'flex', alignItems: 'center', gap: 12, padding: '10px 12px', borderRadius: 8,
                border: active ? '1.5px solid var(--anthropic-orange)' : '1px solid var(--border)',
                background: active ? 'var(--anthropic-orange-dim)' : 'var(--bg-elevated)',
                cursor: 'pointer', textAlign: 'left', transition: 'all 0.15s', fontFamily: 'inherit',
              }}>
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
                    <span style={{ fontSize: 13, fontWeight: 700, color: active ? 'var(--anthropic-orange)' : 'var(--text-primary)' }}>{m.label}</span>
                    <span style={{
                      fontSize: 10, fontWeight: 700, color: badgeColor,
                      background: `color-mix(in srgb, ${badgeColor} 12%, transparent)`,
                      border: `1px solid color-mix(in srgb, ${badgeColor} 30%, transparent)`,
                      padding: '1px 6px', borderRadius: 4,
                    }}>{m.badge}</span>
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>{m.desc}</div>
                </div>
                <div style={{ fontSize: 10, color: 'var(--text-tertiary)', textAlign: 'right', flexShrink: 0 }}>
                  <div>${m.inputPer1M}</div><div>${m.outputPer1M}</div>
                </div>
                {active && <Zap size={13} color="var(--anthropic-orange)" style={{ flexShrink: 0 }} />}
              </button>
            )
          })}
        </div>
        <div style={{ fontSize: 10, color: 'var(--text-tertiary)', marginTop: 7 }}>
          {pt ? 'USD por 1M tokens (entrada / saída)' : 'USD per 1M tokens (input / output)'}
        </div>
      </div>

      <Divider />

      {/* ── Install ── */}
      <SectionHeader label={pt ? 'Instalação' : 'Installation'} />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
          <div>
            <div style={{ fontSize: 13, color: 'var(--text-secondary)', fontWeight: 500, display: 'flex', alignItems: 'center', gap: 7 }}>
              <Globe size={13} color="var(--anthropic-orange)" />
              {pt ? 'App Web (PWA)' : 'Web App (PWA)'}
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 2 }}>
              {pwaPrompt
                ? (pt ? 'Instale pelo navegador, sem download' : 'Install via browser, no download needed')
                : (pt ? 'Já instalado ou não disponível neste navegador' : 'Already installed or not available in this browser')}
            </div>
          </div>
          <button
            onClick={async () => {
              if (!pwaPrompt || !onPwaInstalled) return
              try {
                await pwaPrompt.prompt()
                const { outcome } = await pwaPrompt.userChoice
                if (outcome === 'accepted') { onPwaInstalled(); onClose() }
              } catch {}
            }}
            disabled={!pwaPrompt}
            style={{
              padding: '5px 12px', borderRadius: 6, fontSize: 12, fontWeight: 600,
              border: pwaPrompt ? '1px solid var(--anthropic-orange)' : '1px solid var(--border)',
              background: pwaPrompt ? 'var(--anthropic-orange-dim)' : 'transparent',
              color: pwaPrompt ? 'var(--anthropic-orange)' : 'var(--text-tertiary)',
              cursor: pwaPrompt ? 'pointer' : 'default',
              fontFamily: 'inherit', whiteSpace: 'nowrap', flexShrink: 0,
              opacity: pwaPrompt ? 1 : 0.5,
            }}
          >
            {pt ? 'Instalar' : 'Install'}
          </button>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
          <div>
            <div style={{ fontSize: 13, color: 'var(--text-secondary)', fontWeight: 500, display: 'flex', alignItems: 'center', gap: 7 }}>
              <Monitor size={13} color="var(--text-secondary)" />
              {pt ? 'App Desktop (Windows)' : 'Desktop App (Windows)'}
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 2 }}>
              {pt ? 'Instalador com atualizações automáticas' : 'Installer with auto-updates'}
            </div>
          </div>
          <button
            onClick={() => window.open('https://github.com/blpsoares/agentistics/releases/latest', '_blank', 'noopener')}
            style={{
              display: 'flex', alignItems: 'center', gap: 5,
              padding: '5px 12px', borderRadius: 6, fontSize: 12, fontWeight: 600,
              border: '1px solid var(--border)', background: 'transparent',
              color: 'var(--text-secondary)', cursor: 'pointer',
              fontFamily: 'inherit', whiteSpace: 'nowrap', flexShrink: 0, transition: 'all 0.15s',
            }}
            onMouseEnter={e => { e.currentTarget.style.color = 'var(--text-primary)'; e.currentTarget.style.borderColor = 'var(--text-tertiary)' }}
            onMouseLeave={e => { e.currentTarget.style.color = 'var(--text-secondary)'; e.currentTarget.style.borderColor = 'var(--border)' }}
          >
            <Download size={11} />{pt ? 'Baixar' : 'Download'}
          </button>
        </div>
      </div>
    </>
  )
}

// ── Tab: Live Updates ─────────────────────────────────────────────────────

function LiveTab({
  pt, liveUpdates, setLiveUpdates, updateInterval, setUpdateInterval,
  riskyMode, setRiskyMode, highlightUpdates, setHighlightUpdates,
}: {
  pt: boolean
  liveUpdates: boolean
  setLiveUpdates: (v: boolean) => void
  updateInterval: number
  setUpdateInterval: (v: number) => void
  riskyMode: boolean
  setRiskyMode: (v: boolean) => void
  highlightUpdates: boolean
  setHighlightUpdates: (v: boolean) => void
}) {
  const allIntervals = [...(riskyMode ? LIVE_INTERVAL_OPTIONS_RISKY : []), ...LIVE_INTERVAL_OPTIONS]

  return (
    <>
      {/* Live on/off */}
      <PrefRow
        label={pt ? 'Atualização em tempo real' : 'Live updates'}
        sub={pt ? 'Monitora mudanças automaticamente' : 'Automatically polls for changes'}
      >
        <Toggle on={liveUpdates} onToggle={() => setLiveUpdates(!liveUpdates)} />
      </PrefRow>

      <Divider />

      {/* Interval */}
      <SectionHeader label={pt ? 'Intervalo de atualização' : 'Update interval'} />
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 4 }}>
        {allIntervals.map(opt => {
          const isRisky = opt.value < 10
          const active = updateInterval === opt.value
          return (
            <button
              key={opt.value}
              onClick={() => { setUpdateInterval(opt.value); if (!liveUpdates) setLiveUpdates(true) }}
              style={{
                padding: '5px 12px', borderRadius: 6,
                border: active ? `1px solid ${isRisky ? '#ef4444' : 'var(--anthropic-orange)'}80` : '1px solid var(--border)',
                background: active ? (isRisky ? 'rgba(239,68,68,0.12)' : 'var(--anthropic-orange-dim)') : 'var(--bg-elevated)',
                color: active ? (isRisky ? '#ef4444' : 'var(--anthropic-orange)') : 'var(--text-secondary)',
                fontSize: 12, fontWeight: active ? 700 : 500, cursor: 'pointer', fontFamily: 'inherit', transition: 'all 0.1s',
              }}
            >
              {isRisky ? `⚡ ${opt.label}` : opt.label}
            </button>
          )
        })}
      </div>

      <Divider />

      {/* Risky mode */}
      <PrefRow
        label={pt ? 'Modo arriscado' : 'Risky mode'}
        sub={pt
          ? 'Desbloqueia intervalos abaixo de 10s (até 1s). Pode aumentar o uso de CPU e I/O.'
          : 'Unlocks sub-10s intervals (down to 1s). May increase CPU and I/O load.'}
      >
        <Toggle
          on={riskyMode}
          onToggle={() => {
            const next = !riskyMode
            setRiskyMode(next)
            if (!next && updateInterval < 10) setUpdateInterval(10)
          }}
        />
      </PrefRow>

      <Divider />

      {/* Update highlights */}
      <PrefRow
        label={pt ? 'Destaques de atualização' : 'Update highlights'}
        sub={pt ? 'Destaca visualmente as seções que mudaram na última atualização.' : 'Briefly glows sections that changed on the last data update.'}
      >
        <Toggle on={highlightUpdates} onToggle={() => setHighlightUpdates(!highlightUpdates)} />
      </PrefRow>
    </>
  )
}

// ── Tab: Environment ──────────────────────────────────────────────────────

function EnvironmentTab({ pt }: { pt: boolean }) {
  const [configData, setConfigData] = useState<ConfigResponse | null>(null)
  const [draft, setDraft] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)
  const [savedMsg, setSavedMsg] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const loadConfig = useCallback(async () => {
    try {
      const res = await fetch('/api/config')
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = (await res.json()) as ConfigResponse
      setConfigData(data); setDraft({ ...data.config })
    } catch (err) { setError(err instanceof Error ? err.message : String(err)) }
  }, [])

  useEffect(() => { void loadConfig() }, [loadConfig])

  const handleSave = async () => {
    setSaving(true); setError(null)
    try {
      const res = await fetch('/api/config', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ values: draft }),
      })
      if (!res.ok) { const b = (await res.json()) as { error?: string }; throw new Error(b.error ?? `HTTP ${res.status}`) }
      const updated = (await res.json()) as { ok: boolean; config: Record<string, string> }
      setConfigData(prev => prev ? { ...prev, config: updated.config, backup: prev.config } : null)
      setDraft({ ...updated.config }); setSavedMsg(true); setTimeout(() => setSavedMsg(false), 3000)
    } catch (err) { setError(err instanceof Error ? err.message : String(err)) }
    finally { setSaving(false) }
  }

  const handleRestore = async () => {
    setError(null)
    try {
      const res = await fetch('/api/config/restore', { method: 'POST' })
      if (!res.ok) { const b = (await res.json()) as { error?: string }; throw new Error(b.error ?? `HTTP ${res.status}`) }
      const result = (await res.json()) as { ok: boolean; config: Record<string, string> }
      if (result.ok) await loadConfig()
    } catch (err) { setError(err instanceof Error ? err.message : String(err)) }
  }

  const hasBackup = configData?.backup !== null && configData?.backup !== undefined
  const backupSummary = hasBackup && configData?.backup
    ? CONFIG_FIELDS.map(f => `${f.key}=${configData.backup?.[f.key] ?? f.default}`).join(', ')
    : ''

  return (
    <>
      <div style={{ fontSize: 12, color: 'var(--text-tertiary)', marginBottom: 20, lineHeight: 1.6 }}>
        {pt
          ? 'Alterações entram em vigor após reiniciar o servidor.'
          : 'Changes take effect after restarting the server.'}
      </div>

      {error && (
        <div style={{
          padding: '8px 12px', background: 'rgba(239,68,68,0.1)',
          border: '1px solid rgba(239,68,68,0.3)', borderRadius: 8,
          fontSize: 12, color: '#ef4444', marginBottom: 16,
        }}>
          {error}
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 16, marginBottom: 20 }}>
        {CONFIG_FIELDS.map(field => {
          const fileValue = configData?.config[field.key] ?? field.default
          const activeValue = configData?.active[field.key] ?? field.default
          const restartNeeded = fileValue !== activeValue
          const currentDraft = draft[field.key] ?? field.default
          return (
            <div key={field.key}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary)', fontFamily: 'monospace' }}>{field.key}</span>
                {restartNeeded && (
                  <span title={`Running: ${activeValue} — file has: ${fileValue}`}
                    style={{ width: 7, height: 7, borderRadius: '50%', background: '#f97316', flexShrink: 0, display: 'inline-block' }} />
                )}
              </div>
              <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginBottom: 6 }}>
                {field.description}
                {restartNeeded && <span style={{ color: '#f97316', marginLeft: 6 }}>(running: {activeValue})</span>}
              </div>
              <input
                type="text" value={currentDraft}
                onChange={e => setDraft(prev => ({ ...prev, [field.key]: e.target.value }))}
                style={{
                  width: '100%', boxSizing: 'border-box', padding: '7px 10px',
                  background: 'var(--bg-elevated)', border: '1px solid var(--border)',
                  borderRadius: 7, fontSize: 13, fontFamily: 'monospace',
                  color: 'var(--text-primary)', outline: 'none',
                }}
                onFocus={e => { e.currentTarget.style.borderColor = 'var(--anthropic-orange)' }}
                onBlur={e => { e.currentTarget.style.borderColor = 'var(--border)' }}
              />
            </div>
          )
        })}
      </div>

      {savedMsg && (
        <div style={{ fontSize: 12, color: 'var(--anthropic-orange)', marginBottom: 16, textAlign: 'center', fontWeight: 500 }}>
          {pt ? 'Salvo — reinicie para aplicar' : 'Saved — restart to apply'}
        </div>
      )}

      <div style={{ height: 1, background: 'var(--border)', marginBottom: 16 }} />

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <button onClick={handleRestore} disabled={!hasBackup} title={hasBackup ? `Restore: ${backupSummary}` : 'No backup available'}
          style={{
            padding: '6px 12px', borderRadius: 7, border: '1px solid var(--border)',
            background: 'transparent', color: hasBackup ? 'var(--text-secondary)' : 'var(--text-tertiary)',
            fontSize: 12, cursor: hasBackup ? 'pointer' : 'default', opacity: hasBackup ? 1 : 0.45,
            fontFamily: 'inherit', transition: 'all 0.15s',
          }}
          onMouseEnter={e => { if (hasBackup) e.currentTarget.style.color = 'var(--text-primary)' }}
          onMouseLeave={e => { if (hasBackup) e.currentTarget.style.color = 'var(--text-secondary)' }}
        >
          {pt ? 'Restaurar backup' : 'Restore backup'}
        </button>
        <button onClick={handleSave} disabled={saving}
          style={{
            display: 'flex', alignItems: 'center', gap: 6,
            padding: '6px 16px', borderRadius: 7, border: '1px solid var(--anthropic-orange)60',
            background: 'var(--anthropic-orange-dim)', color: 'var(--anthropic-orange)',
            fontSize: 12, fontWeight: 600, cursor: saving ? 'default' : 'pointer',
            opacity: saving ? 0.6 : 1, fontFamily: 'inherit', transition: 'all 0.15s',
          }}
          onMouseEnter={e => { if (!saving) e.currentTarget.style.opacity = '0.8' }}
          onMouseLeave={e => { if (!saving) e.currentTarget.style.opacity = '1' }}
        >
          <Save size={12} />{saving ? (pt ? 'Salvando…' : 'Saving…') : (pt ? 'Salvar' : 'Save')}
        </button>
      </div>

      {hasBackup && configData?.backup && (
        <div style={{ marginTop: 10, fontSize: 11, color: 'var(--text-tertiary)' }}>Backup: {backupSummary}</div>
      )}
    </>
  )
}

// ── Main modal ────────────────────────────────────────────────────────────

const TABS: { id: SettingsTab; icon: React.ReactNode; labelEn: string; labelPt: string }[] = [
  { id: 'preferences', icon: <SlidersHorizontal size={13} />, labelEn: 'Preferences', labelPt: 'Preferências' },
  { id: 'live',        icon: <Activity size={13} />,          labelEn: 'Live',         labelPt: 'Live' },
  { id: 'environment', icon: <Code2 size={13} />,             labelEn: 'Environment',  labelPt: 'Ambiente' },
]

export function PreferencesModal({
  initial, onSave, onClose,
  pwaPrompt, onPwaInstalled,
  liveUpdates, setLiveUpdates, updateInterval, setUpdateInterval,
  riskyMode, setRiskyMode, highlightUpdates, setHighlightUpdates,
  defaultTab = 'preferences',
}: Props) {
  const [activeTab, setActiveTab] = useState<SettingsTab>(defaultTab)
  const [draft, setDraft] = useState<PrefsDraft>({
    ...initial,
    cardOrder: [...initial.cardOrder],
    cardPrecision: { ...initial.cardPrecision },
    chatModel: initial.chatModel ?? null,
    chatSoundEnabled: initial.chatSoundEnabled ?? true,
  })
  const pt = draft.lang === 'pt'

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [onClose])

  function set<K extends keyof PrefsDraft>(key: K, value: PrefsDraft[K]) {
    setDraft(d => ({ ...d, [key]: value }))
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
        <div style={{ padding: '20px 24px 0' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
            <span style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-primary)' }}>
              {pt ? 'Configurações' : 'Settings'}
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

          {/* Tab bar */}
          <div style={{ display: 'flex', gap: 2, borderBottom: '1px solid var(--border)', marginBottom: 0 }}>
            {TABS.map(tab => {
              const active = activeTab === tab.id
              const label = pt ? tab.labelPt : tab.labelEn
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 6,
                    padding: '8px 14px',
                    fontSize: 12, fontWeight: active ? 700 : 500,
                    color: active ? 'var(--anthropic-orange)' : 'var(--text-tertiary)',
                    background: 'transparent',
                    border: 'none',
                    borderBottom: active ? '2px solid var(--anthropic-orange)' : '2px solid transparent',
                    marginBottom: -1,
                    cursor: 'pointer',
                    fontFamily: 'inherit',
                    transition: 'color 0.15s',
                    whiteSpace: 'nowrap',
                  }}
                >
                  <span style={{ opacity: active ? 1 : 0.6 }}>{tab.icon}</span>
                  {label}
                </button>
              )
            })}
          </div>
        </div>

        {/* Scrollable body */}
        <div style={{ overflowY: 'auto', padding: '20px 24px', flex: 1 }}>
          {activeTab === 'preferences' && (
            <PreferencesTab
              draft={draft} set={set} pt={pt}
              pwaPrompt={pwaPrompt} onPwaInstalled={onPwaInstalled} onClose={onClose}
            />
          )}
          {activeTab === 'live' && (
            <LiveTab
              pt={pt}
              liveUpdates={liveUpdates} setLiveUpdates={setLiveUpdates}
              updateInterval={updateInterval} setUpdateInterval={setUpdateInterval}
              riskyMode={riskyMode} setRiskyMode={setRiskyMode}
              highlightUpdates={highlightUpdates} setHighlightUpdates={setHighlightUpdates}
            />
          )}
          {activeTab === 'environment' && <EnvironmentTab pt={pt} />}
        </div>

        {/* Footer — only for Preferences tab */}
        {activeTab === 'preferences' && (
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
                color: 'var(--text-secondary)', cursor: 'pointer', fontFamily: 'inherit', transition: 'all 0.15s',
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
                color: 'var(--anthropic-orange)', cursor: 'pointer', fontFamily: 'inherit', transition: 'all 0.15s',
              }}
            >
              <Save size={13} />{pt ? 'Salvar' : 'Save'}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
