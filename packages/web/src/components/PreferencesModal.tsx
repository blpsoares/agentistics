import React, { useRef, useState, useEffect, useCallback } from 'react'
import {
  X, GripVertical, RotateCcw, Save, Volume2, VolumeX, Zap, Bot,
  Globe, Monitor, Download, SlidersHorizontal, Activity,
  Archive, Check, HardDrive, FolderClock, ExternalLink, DatabaseZap,
  Cpu, Copy, CheckCheck, AlertCircle, CircleDot, Users, Database, GitBranch, Shield,
} from 'lucide-react'
import type { Lang, Theme, HarnessId, MemberPresence } from '@agentistics/core'
import { HARNESS_LABELS, HARNESS_COLORS } from '../lib/harness'
import { HarnessInfoPanel } from './HarnessInfoPanel'
import type { ArchiveMode } from './ArchiveConsentModal'
import { CHAT_MODELS, type ChatModelId, DEFAULT_CHAT_MODEL } from '../lib/chatModels'
import { LIVE_INTERVAL_OPTIONS, LIVE_INTERVAL_OPTIONS_RISKY } from '../hooks/useData'
import { CHAT_SOUNDS, DEFAULT_CHAT_SOUND_ID, findChatSound } from '../lib/chatSounds'
import { useChatHarnesses, type HarnessChatStatus } from '../hooks/useChatHarnesses'
import { useIsMobile } from '../hooks/useIsMobile'
import { TeamSettings, type TeamConfig } from './TeamSettings'
import { TeamRepos } from './TeamRepos'
import { DeployCentral } from './DeployCentral'
import { IamTab } from './IamTab'

import type { PrefsDraft } from '../lib/app-context'
export type { PrefsDraft }

type PwaPrompt = Event & { prompt(): Promise<void>; userChoice: Promise<{ outcome: string }> }

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

export type SettingsTab = 'preferences' | 'sessions' | 'live' | 'install' | 'harnesses' | 'datasources' | 'team' | 'repositories' | 'iam'

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
  /** Harnesses present in the data — drives the "Data & sources" tab content. */
  harnesses?: HarnessId[]
  /** Shared dashboard presence (/api/data), threaded to the team members panel so it stays in
   *  sync with the FiltersBar presence pill. */
  presence?: Record<string, MemberPresence>
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
    <div style={{ display: 'inline-flex', width: 'fit-content', border: '1px solid var(--border)', borderRadius: 6, overflow: 'hidden' }}>
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

function PreferencesTab({ draft, set, pt, previewSound }: {
  draft: PrefsDraft
  set: <K extends keyof PrefsDraft>(k: K, v: PrefsDraft[K]) => void
  pt: boolean
  previewSound: (id: string) => void
}) {
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
    </>
  )
}

// ── Tab: Install ──────────────────────────────────────────────────────────

function InstallTab({ pt, pwaPrompt, onPwaInstalled, onClose, central }: {
  pt: boolean
  pwaPrompt?: PwaPrompt | null
  onPwaInstalled?: () => void
  onClose: () => void
  central: boolean | null
}) {
  // iOS Safari has no beforeinstallprompt — install is always Share → "Add to Home Screen".
  const isIOS = /ipad|iphone|ipod/i.test(navigator.userAgent)
    || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  const isStandalone = window.matchMedia('(display-mode: standalone)').matches
    || (navigator as unknown as { standalone?: boolean }).standalone === true
  const isDevPort = window.location.port === '47292'
  const [uninstallHint, setUninstallHint] = useState(false)

  const pwaStatus = pwaPrompt
    ? 'available'
    : isStandalone ? 'installed' : isIOS ? 'ios' : isDevPort ? 'dev' : 'waiting'

  const pwaHint: Record<string, string> = {
    available: pt ? 'Instale pelo navegador, sem download necessário.' : 'Install via browser — no download needed.',
    installed:  pt ? 'Você já está usando o App Web instalado.' : 'You are already using the installed Web App.',
    dev:        pt ? 'Não disponível no servidor de dev. Abra via porta 47291.' : 'Not available in dev mode. Open via port 47291.',
    waiting:    pt ? 'Recarregue a página para habilitar a instalação.' : 'Reload the page to enable installation.',
    ios:        pt ? 'No iPhone/iPad: toque em Compartilhar e em “Adicionar à Tela de Início”.' : 'On iPhone/iPad: tap Share, then “Add to Home Screen”.',
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {/* Web App card */}
      <div style={{
        padding: '16px 18px', borderRadius: 10,
        border: pwaPrompt ? '1.5px solid var(--anthropic-orange)' : '1px solid var(--border)',
        background: pwaPrompt ? 'var(--anthropic-orange-dim)' : 'var(--bg-elevated)',
      }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16 }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, flex: 1, minWidth: 0 }}>
            <div style={{
              width: 36, height: 36, borderRadius: 9, flexShrink: 0, marginTop: 1,
              background: pwaPrompt ? 'color-mix(in srgb, var(--anthropic-orange) 15%, transparent)' : 'var(--bg-card)',
              border: `1px solid ${pwaPrompt ? 'color-mix(in srgb, var(--anthropic-orange) 30%, transparent)' : 'var(--border)'}`,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <Globe size={16} color={pwaPrompt ? 'var(--anthropic-orange)' : 'var(--text-tertiary)'} />
            </div>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)' }}>
                  {pt ? 'App Web (PWA)' : 'Web App (PWA)'}
                </span>
                <span style={{
                  fontSize: 10, fontWeight: 700,
                  color: 'var(--anthropic-orange)',
                  background: 'color-mix(in srgb, var(--anthropic-orange) 12%, transparent)',
                  border: '1px solid color-mix(in srgb, var(--anthropic-orange) 25%, transparent)',
                  padding: '1px 6px', borderRadius: 4,
                }}>
                  {pt ? 'Recomendado' : 'Recommended'}
                </span>
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-tertiary)', lineHeight: 1.5 }}>
                {pwaHint[pwaStatus]}
              </div>
            </div>
          </div>
          {pwaStatus === 'ios' ? null : pwaStatus === 'installed' ? (
            <button
              onClick={() => setUninstallHint(h => !h)}
              style={{
                padding: '6px 14px', borderRadius: 7, fontSize: 12, fontWeight: 600, flexShrink: 0,
                border: '1px solid rgba(239,68,68,0.4)',
                background: uninstallHint ? 'rgba(239,68,68,0.12)' : 'transparent',
                color: '#ef4444', cursor: 'pointer', fontFamily: 'inherit', transition: 'all 0.15s',
              }}
            >
              {pt ? 'Desinstalar' : 'Uninstall'}
            </button>
          ) : (
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
                padding: '6px 14px', borderRadius: 7, fontSize: 12, fontWeight: 600, flexShrink: 0,
                border: pwaPrompt ? '1px solid var(--anthropic-orange)' : '1px solid var(--border)',
                background: pwaPrompt ? 'color-mix(in srgb, var(--anthropic-orange) 20%, transparent)' : 'transparent',
                color: pwaPrompt ? 'var(--anthropic-orange)' : 'var(--text-tertiary)',
                cursor: pwaPrompt ? 'pointer' : 'default',
                fontFamily: 'inherit', opacity: pwaPrompt ? 1 : 0.5,
              }}
            >
              {pt ? 'Instalar' : 'Install'}
            </button>
          )}
        </div>
        {uninstallHint && (
          <div style={{
            marginTop: 12, padding: '8px 12px', borderRadius: 7,
            background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)',
            fontSize: 12, color: '#ef4444', lineHeight: 1.5,
          }}>
            {pt
              ? 'Para desinstalar: clique no menu ⋮ no canto superior direito da janela do app → "Desinstalar Agentistics".'
              : 'To uninstall: click the ⋮ menu in the top-right corner of the app window → "Uninstall Agentistics".'}
          </div>
        )}
        {pwaStatus === 'ios' && (
          <div style={{
            marginTop: 12, padding: '10px 12px', borderRadius: 8,
            background: 'var(--bg-secondary)', border: '1px solid var(--border)',
            fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.7,
          }}>
            <div style={{ fontWeight: 700, color: 'var(--text-primary)', marginBottom: 4 }}>
              {pt ? 'Instalar no iPhone / iPad' : 'Install on iPhone / iPad'}
            </div>
            {pt ? (
              <>1. Toque no botão <strong>Compartilhar</strong> (o quadrado com a seta) na barra do Safari.<br />
              2. Role e toque em <strong>“Adicionar à Tela de Início”</strong>.<br />
              3. Toque em <strong>Adicionar</strong>. O app abre em tela cheia, como um app nativo.</>
            ) : (
              <>1. Tap the <strong>Share</strong> button (square with an arrow) in the Safari bar.<br />
              2. Scroll and tap <strong>“Add to Home Screen”</strong>.<br />
              3. Tap <strong>Add</strong>. The app opens full-screen, like a native app.</>
            )}
            <div style={{ marginTop: 6, fontSize: 11, color: 'var(--text-tertiary)' }}>
              {pt
                ? 'O iOS não permite instalação com um clique — esse é o fluxo oficial da Apple.'
                : 'iOS does not allow one-click install — this is Apple’s official flow.'}
            </div>
          </div>
        )}
      </div>

      {/* Desktop App card */}
      <div style={{
        padding: '16px 18px', borderRadius: 10,
        border: '1px solid var(--border)', background: 'var(--bg-elevated)',
      }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16 }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, flex: 1, minWidth: 0 }}>
            <div style={{
              width: 36, height: 36, borderRadius: 9, flexShrink: 0, marginTop: 1,
              background: 'var(--bg-card)', border: '1px solid var(--border)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <Monitor size={16} color="var(--text-secondary)" />
            </div>
            <div>
              <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 4 }}>
                {pt ? 'App Desktop (Windows)' : 'Desktop App (Windows)'}
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-tertiary)', lineHeight: 1.5 }}>
                {pt ? 'Instalador NSIS com atualizações automáticas via Tauri.' : 'NSIS installer with auto-updates via Tauri.'}
              </div>
            </div>
          </div>
          <button
            onClick={() => window.open('https://github.com/blpsoares/agentistics/releases/latest', '_blank', 'noopener')}
            style={{
              display: 'flex', alignItems: 'center', gap: 5,
              padding: '6px 14px', borderRadius: 7, fontSize: 12, fontWeight: 600, flexShrink: 0,
              border: '1px solid var(--border)', background: 'transparent',
              color: 'var(--text-secondary)', cursor: 'pointer',
              fontFamily: 'inherit', transition: 'all 0.15s',
            }}
            onMouseEnter={e => { e.currentTarget.style.color = 'var(--text-primary)'; e.currentTarget.style.borderColor = 'var(--text-tertiary)' }}
            onMouseLeave={e => { e.currentTarget.style.color = 'var(--text-secondary)'; e.currentTarget.style.borderColor = 'var(--border)' }}
          >
            <Download size={12} />{pt ? 'Baixar' : 'Download'}
          </button>
        </div>
      </div>

      {/* Info footer */}
      <div style={{
        padding: '12px 14px', borderRadius: 8,
        background: 'var(--bg-secondary)', border: '1px solid var(--border)',
        fontSize: 11, color: 'var(--text-tertiary)', lineHeight: 1.6,
      }}>
        💡 {pt
          ? 'O App Web é mais rápido de instalar e funciona em qualquer plataforma. O App Desktop oferece integração nativa no Windows com ícone na barra de tarefas.'
          : 'The Web App is faster to install and works on any platform. The Desktop App offers native Windows integration with a taskbar icon.'}
      </div>

      {central === false && (
        <>
          {/* Deploy a team central — only shown on non-central instances */}
          <div style={{ height: 1, background: 'var(--border)', margin: '4px 0 4px' }} />
          <div style={{
            fontSize: 11, fontWeight: 700, color: 'var(--text-tertiary)',
            letterSpacing: '0.07em', textTransform: 'uppercase', marginBottom: 10,
          }}>
            {pt ? 'Para equipes' : 'For teams'}
          </div>
          <DeployCentral pt={pt} />
        </>
      )}
    </div>
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

// ── Tab: Sessions (archive mode) ───────────────────────────────────────────

const ARCHIVE_DOCS_URL = 'https://code.claude.com/docs/en/settings'

function SessionsTab({ pt }: { pt: boolean }) {
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

// ── Tab: Harnesses (AI backend status) ───────────────────────────────────

function CopyableCode({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  const copy = () => {
    void navigator.clipboard.writeText(text).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1800)
    })
  }
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 6,
      background: 'var(--bg-card)', border: '1px solid var(--border)',
      borderRadius: 6, padding: '5px 10px', marginTop: 5,
    }}>
      <code style={{ flex: 1, fontSize: 11.5, color: 'var(--text-primary)', fontFamily: 'monospace', wordBreak: 'break-all' }}>
        {text}
      </code>
      <button
        onClick={copy}
        title="Copy"
        style={{
          background: 'transparent', border: 'none', cursor: 'pointer',
          color: copied ? 'var(--accent-green)' : 'var(--text-tertiary)',
          display: 'flex', alignItems: 'center', padding: 2, flexShrink: 0,
          transition: 'color 0.15s',
        }}
      >
        {copied ? <CheckCheck size={13} /> : <Copy size={13} />}
      </button>
    </div>
  )
}

function HarnessStatusBadge({ h }: { h: HarnessChatStatus }) {
  if (h.ready) {
    return (
      <span style={{
        display: 'inline-flex', alignItems: 'center', gap: 4,
        fontSize: 11, fontWeight: 700,
        color: 'var(--accent-green)',
        background: 'color-mix(in srgb, var(--accent-green) 12%, transparent)',
        border: '1px solid color-mix(in srgb, var(--accent-green) 28%, transparent)',
        padding: '2px 8px', borderRadius: 20,
      }}>
        <CircleDot size={10} />
        Ready
      </span>
    )
  }
  if (!h.installed) {
    return (
      <span style={{
        display: 'inline-flex', alignItems: 'center', gap: 4,
        fontSize: 11, fontWeight: 700,
        color: 'var(--text-tertiary)',
        background: 'var(--bg-elevated)',
        border: '1px solid var(--border)',
        padding: '2px 8px', borderRadius: 20,
      }}>
        <AlertCircle size={10} />
        Not installed
      </span>
    )
  }
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 4,
      fontSize: 11, fontWeight: 700,
      color: '#f97316',
      background: 'rgba(249,115,22,0.10)',
      border: '1px solid rgba(249,115,22,0.28)',
      padding: '2px 8px', borderRadius: 20,
    }}>
      <AlertCircle size={10} />
      Not authenticated
    </span>
  )
}

function HarnessCard({ h }: { h: HarnessChatStatus }) {
  const { setup } = h
  const hasGuidance = !h.ready && (setup.installCmd || setup.loginCmd || setup.docUrl || setup.note)

  return (
    <div style={{
      padding: '14px 16px', borderRadius: 10,
      border: h.ready
        ? '1px solid color-mix(in srgb, var(--accent-green) 25%, var(--border))'
        : '1px solid var(--border)',
      background: h.ready ? 'color-mix(in srgb, var(--accent-green) 5%, var(--bg-elevated))' : 'var(--bg-elevated)',
      display: 'flex', flexDirection: 'column', gap: 0,
    }}>
      {/* Row: icon + name + badge */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: hasGuidance ? 10 : 0 }}>
        <div style={{
          width: 32, height: 32, borderRadius: 8, flexShrink: 0,
          background: 'var(--bg-card)', border: '1px solid var(--border)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <Cpu size={14} color={h.ready ? 'var(--accent-green)' : 'var(--text-tertiary)'} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)' }}>{h.label}</span>
            <HarnessStatusBadge h={h} />
          </div>
          {h.ready && h.models.length > 0 && (
            <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 2 }}>
              {h.models.length} model{h.models.length !== 1 ? 's' : ''} available
              {h.defaultModel ? ` · default: ${h.defaultModel}` : ''}
            </div>
          )}
        </div>
      </div>

      {/* Setup guidance for non-ready harnesses */}
      {hasGuidance && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, paddingLeft: 42 }}>
          {!h.installed && setup.installCmd && (
            <div>
              <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-tertiary)', marginBottom: 1 }}>Install</div>
              <CopyableCode text={setup.installCmd} />
            </div>
          )}
          {h.installed && !h.authReady && setup.loginCmd && (
            <div>
              <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-tertiary)', marginBottom: 1 }}>Authenticate</div>
              <CopyableCode text={setup.loginCmd} />
            </div>
          )}
          {/* Show login cmd even when not installed, as reference */}
          {!h.installed && setup.loginCmd && (
            <div>
              <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-tertiary)', marginBottom: 1 }}>Then login</div>
              <CopyableCode text={setup.loginCmd} />
            </div>
          )}
          {setup.note && (
            <div style={{
              fontSize: 11, color: 'var(--text-tertiary)', lineHeight: 1.5,
              padding: '5px 8px', borderRadius: 6,
              background: 'var(--bg-secondary)', border: '1px solid var(--border)',
              marginTop: 2,
            }}>
              {setup.note}
            </div>
          )}
          {setup.docUrl && (
            <a
              href={setup.docUrl}
              target="_blank"
              rel="noopener noreferrer"
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 4,
                fontSize: 11.5, color: 'var(--anthropic-orange)', textDecoration: 'none',
                marginTop: 2,
              }}
            >
              <ExternalLink size={11} />
              Learn more / check eligibility
            </a>
          )}
        </div>
      )}
    </div>
  )
}

// ── Tab: Data & sources ───────────────────────────────────────────────────
// Explains, per harness present in the data, where its metrics come from, what is
// captured, and what is missing (and why). Replaces the old per-harness /h/:harness
// "Data & sources" tab now that harness selection lives entirely in the filter.

function DataSourcesTab({ pt, harnesses }: { pt: boolean; harnesses: HarnessId[] }) {
  const order: HarnessId[] = ['claude', 'codex', 'gemini', 'copilot']
  const present = order.filter(h => harnesses.includes(h))
  const [selected, setSelected] = useState<HarnessId>(present[0] ?? 'claude')

  if (present.length === 0) {
    return (
      <div style={{ fontSize: 13, color: 'var(--text-tertiary)', textAlign: 'center', padding: '24px 0' }}>
        {pt ? 'Nenhum harness com dados ainda.' : 'No harness data yet.'}
      </div>
    )
  }

  const active = present.includes(selected) ? selected : present[0]!

  return (
    <div>
      <SectionHeader label={pt ? 'Dados & fontes' : 'Data & sources'} />
      <p style={{ fontSize: 12.5, color: 'var(--text-tertiary)', lineHeight: 1.55, margin: '0 0 14px' }}>
        {pt
          ? 'De onde vêm as métricas de cada harness, o que é capturado e o que falta (e por quê).'
          : 'Where each harness’s metrics come from, what is captured, and what is missing (and why).'}
      </p>

      {/* Per-harness selector — only shown when more than one harness has data */}
      {present.length > 1 && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 16 }}>
          {present.map(h => {
            const isActive = h === active
            const color = HARNESS_COLORS[h]
            return (
              <button
                key={h}
                onClick={() => setSelected(h)}
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 6,
                  padding: '6px 12px', borderRadius: 8, cursor: 'pointer', fontFamily: 'inherit',
                  fontSize: 12, fontWeight: 600,
                  border: `1px solid ${isActive ? color : 'var(--border)'}`,
                  background: isActive ? `${color}1f` : 'var(--bg-elevated)',
                  color: isActive ? color : 'var(--text-secondary)',
                }}
              >
                <span style={{
                  display: 'inline-block', width: 8, height: 8, borderRadius: '50%',
                  background: color, flexShrink: 0,
                }} />
                {HARNESS_LABELS[h]}
              </button>
            )
          })}
        </div>
      )}

      <HarnessInfoPanel harness={active} lang={pt ? 'pt' : 'en'} />
    </div>
  )
}

function HarnessesTab({ pt }: { pt: boolean }) {
  const { harnesses, loading } = useChatHarnesses()
  const readyCount = harnesses.filter(h => h.ready).length

  return (
    <div>
      <SectionHeader label={pt ? 'Backends de IA (Nay chat)' : 'AI backends (Nay chat)'} />
      <p style={{ fontSize: 12.5, color: 'var(--text-tertiary)', lineHeight: 1.55, margin: '0 0 14px' }}>
        {pt
          ? 'Cada backend pode ser usado para conversar via Nay. Mostramos o status de instalação e autenticação de cada um.'
          : 'Each backend can be used for chat in Nay. Showing installation and authentication status for all known harnesses.'}
      </p>

      {loading ? (
        <div style={{ fontSize: 13, color: 'var(--text-tertiary)', textAlign: 'center', padding: '24px 0' }}>
          {pt ? 'Verificando…' : 'Checking…'}
        </div>
      ) : harnesses.length === 0 ? (
        <div style={{ fontSize: 13, color: 'var(--text-tertiary)', textAlign: 'center', padding: '24px 0' }}>
          {pt ? 'Nenhum backend encontrado.' : 'No backends found.'}
        </div>
      ) : (
        <>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {harnesses.map(h => <HarnessCard key={h.id} h={h} />)}
          </div>
          <div style={{
            marginTop: 14, padding: '10px 14px', borderRadius: 8,
            background: 'var(--bg-secondary)', border: '1px solid var(--border)',
            fontSize: 11, color: 'var(--text-tertiary)', lineHeight: 1.6,
          }}>
            {pt
              ? `${readyCount} de ${harnesses.length} backends prontos. Instalação e autenticação devem ser feitas no terminal — o Agentistics não executa comandos automaticamente.`
              : `${readyCount} of ${harnesses.length} backend${harnesses.length !== 1 ? 's' : ''} ready. Install and authenticate in your terminal — Agentistics does not run commands on your behalf.`}
          </div>
        </>
      )}
    </div>
  )
}

// ── Tab: Team ─────────────────────────────────────────────────────────────

const DEFAULT_TEAM_CONFIG: TeamConfig = {
  mode: 'solo',
  endpoint: '',
  org: 'default',
  user: '',
  token: '',
}

function TeamTab({ pt, central, presence }: { pt: boolean; central: boolean | null; presence?: Record<string, MemberPresence> }) {
  const lang: 'pt' | 'en' = pt ? 'pt' : 'en'
  const [team, setTeam] = useState<TeamConfig>(DEFAULT_TEAM_CONFIG)
  const [loadErr, setLoadErr] = useState<string | null>(null)

  // Load team preferences on mount
  useEffect(() => {
    fetch('/api/preferences')
      .then(r => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((prefs: { team?: Partial<TeamConfig> }) => {
        if (prefs.team) {
          setTeam({ ...DEFAULT_TEAM_CONFIG, ...prefs.team })
        }
      })
      .catch(err => { setLoadErr(err instanceof Error ? err.message : String(err)) })
  }, [])

  if (loadErr) {
    return (
      <div style={{
        padding: '10px 14px', borderRadius: 8,
        background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)',
        fontSize: 12, color: '#ef4444',
      }}>
        {loadErr}
      </div>
    )
  }

  return (
    <div>
      {/* TeamSettings handles saving explicitly via its Save button (member mode)
          or its own interval control (central mode). onChange just syncs local state. */}
      <TeamSettings team={team} onChange={setTeam} lang={lang} central={central} presence={presence} />
    </div>
  )
}

// ── Main modal ────────────────────────────────────────────────────────────

// Order: general first, then Team (a primary feature — not buried at the end), then the
// data/insight tabs, then the technical ones last.
const TABS: { id: SettingsTab; icon: React.ReactNode; labelEn: string; labelPt: string }[] = [
  { id: 'preferences', icon: <SlidersHorizontal size={13} />, labelEn: 'Preferences', labelPt: 'Preferências' },
  { id: 'team',        icon: <Users size={13} />,             labelEn: 'Team',         labelPt: 'Time' },
  { id: 'iam',         icon: <Shield size={13} />,            labelEn: 'IAM',          labelPt: 'IAM' },
  { id: 'repositories', icon: <GitBranch size={13} />,        labelEn: 'GitHub Repositories', labelPt: 'Repositórios GitHub' },
  { id: 'live',        icon: <Activity size={13} />,          labelEn: 'Live',         labelPt: 'Live' },
  { id: 'datasources', icon: <Database size={13} />,          labelEn: 'Data & sources', labelPt: 'Dados & fontes' },
  { id: 'harnesses',   icon: <Cpu size={13} />,               labelEn: 'Harnesses',    labelPt: 'Backends' },
  { id: 'sessions',    icon: <Archive size={13} />,           labelEn: 'Sessions',     labelPt: 'Sessões' },
  { id: 'install',     icon: <Download size={13} />,          labelEn: 'Install',      labelPt: 'Instalar' },
]

export function PreferencesModal({
  initial, onSave, onClose,
  pwaPrompt, onPwaInstalled,
  liveUpdates, setLiveUpdates, updateInterval, setUpdateInterval,
  riskyMode, setRiskyMode, highlightUpdates, setHighlightUpdates,
  defaultTab = 'preferences', harnesses = [],
  presence,
}: Props) {
  const isMobile = useIsMobile()
  const [activeTab, setActiveTab] = useState<SettingsTab>(defaultTab)
  const [draft, setDraft] = useState<PrefsDraft>({
    ...initial,
    cardOrder: [...initial.cardOrder],
    cardPrecision: { ...initial.cardPrecision },
    chatModel: initial.chatModel ?? null,
    chatSoundEnabled: initial.chatSoundEnabled ?? true,
    chatSoundId: initial.chatSoundId ?? DEFAULT_CHAT_SOUND_ID,
  })
  const pt = draft.lang === 'pt'
  const [central, setCentral] = useState<boolean | null>(null)
  const previewCtxRef = useRef<AudioContext | null>(null)

  const previewSound = useCallback((id: string) => {
    if (!previewCtxRef.current) {
      try { previewCtxRef.current = new AudioContext() } catch { return }
    }
    findChatSound(id).play(previewCtxRef.current)
  }, [])

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [onClose])

  // Fetch central flag once on mount — used by Install tab to gate DeployCentral
  useEffect(() => {
    fetch('/api/team/session')
      .then(r => (r.ok ? r.json() : null))
      .then((sess: { central?: boolean } | null) => {
        setCentral(sess?.central === true ? true : false)
      })
      .catch(() => { setCentral(false) })
  }, [])

  // A central has nothing "live" to toggle — member pushes already refresh its dashboards in
  // real time via SSE-on-ingest — so the Live tab is hidden there. If it was the active tab when
  // the central flag resolves, fall back to Preferences so the body doesn't render blank.
  // Live is hidden on a central (it refreshes via SSE-on-ingest); the GitHub Repositories
  // registry is a central-only admin panel, so it's hidden everywhere else. IAM is also central-only.
  const visibleTabs = central ? TABS.filter(t => t.id !== 'live') : TABS.filter(t => t.id !== 'repositories' && t.id !== 'iam')
  useEffect(() => {
    if (central && activeTab === 'live') setActiveTab('preferences')
    if (!central && (activeTab === 'repositories' || activeTab === 'iam')) setActiveTab('preferences')
  }, [central, activeTab])

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
          border: isMobile ? 'none' : '1px solid var(--border)',
          borderRadius: isMobile ? 0 : 'var(--radius-lg)',
          width: isMobile ? '100%' : 'min(840px, 94vw)',
          maxWidth: '100%',
          height: isMobile ? '100%' : 'min(680px, 90vh)',
          display: 'flex',
          flexDirection: 'column',
          boxShadow: isMobile ? 'none' : '0 20px 60px rgba(0,0,0,0.35)',
        }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{ padding: isMobile ? '16px 16px 0' : '20px 24px 0' }}>
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

          {/* Tab bar — wraps to a second row when the tabs don't fit (the modal is
              wide enough for all tabs on desktop), so they are never hidden behind a
              horizontal scroll that users may not notice. */}
          <div className="prefs-tabbar" style={{
            display: 'flex', flexWrap: 'wrap', gap: 2, borderBottom: '1px solid var(--border)', marginBottom: 0,
          }}>
            {visibleTabs.map(tab => {
              const active = activeTab === tab.id
              const label = pt ? tab.labelPt : tab.labelEn
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 6,
                    padding: isMobile ? '8px 12px' : '8px 14px',
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
                    flexShrink: 0,
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
        <div style={{ overflowY: 'auto', overflowX: 'hidden', padding: isMobile ? '18px 16px' : '20px 24px', flex: 1 }}>
          {activeTab === 'preferences' && (
            <PreferencesTab draft={draft} set={set} pt={pt} previewSound={previewSound} />
          )}
          {activeTab === 'sessions' && <SessionsTab pt={pt} />}
          {activeTab === 'live' && (
            <LiveTab
              pt={pt}
              liveUpdates={liveUpdates} setLiveUpdates={setLiveUpdates}
              updateInterval={updateInterval} setUpdateInterval={setUpdateInterval}
              riskyMode={riskyMode} setRiskyMode={setRiskyMode}
              highlightUpdates={highlightUpdates} setHighlightUpdates={setHighlightUpdates}
            />
          )}
          {activeTab === 'install' && (
            <InstallTab
              pt={pt}
              pwaPrompt={pwaPrompt} onPwaInstalled={onPwaInstalled} onClose={onClose}
              central={central}
            />
          )}
          {activeTab === 'harnesses' && <HarnessesTab pt={pt} />}
          {activeTab === 'datasources' && <DataSourcesTab pt={pt} harnesses={harnesses} />}
          {activeTab === 'team' && <TeamTab pt={pt} central={central} presence={presence} />}
          {activeTab === 'repositories' && <TeamRepos lang={pt ? 'pt' : 'en'} />}
          {activeTab === 'iam' && <IamTab pt={pt} />}
        </div>

        {/* Footer — only for Preferences tab */}
        {activeTab === 'preferences' && (
          <div style={{
            display: 'flex', justifyContent: 'flex-end', gap: 8,
            padding: isMobile ? '14px 16px' : '16px 24px',
            borderTop: '1px solid var(--border)',
            background: 'var(--bg-surface)',
            borderRadius: isMobile ? 0 : '0 0 var(--radius-lg) var(--radius-lg)',
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
