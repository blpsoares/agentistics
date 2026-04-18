import React, { useState, useMemo, useEffect, useRef, useCallback } from 'react'
import { Outlet, NavLink, useLocation } from 'react-router-dom'
import { version } from '../package.json'
import {
  MessageSquare, Zap, Clock, Flame, GitCommit,
  Wrench, RefreshCw, FileCode, TrendingUp, BarChart2,
  Sun, Moon, Globe, AlertTriangle, Download, Upload,
  Maximize2, X, Trophy, Activity, Bot, Sparkles, Settings, SlidersHorizontal,
  Calendar, Database, FileText, Shield, FolderOpen, CheckCircle,
  Target, Home, DollarSign, Layers, Code2,
} from 'lucide-react'
import { useData, useDerivedStats, LIVE_INTERVAL_OPTIONS, LIVE_INTERVAL_OPTIONS_RISKY } from './hooks/useData'
import type { LoadProgress } from './hooks/useData'
import { useIsMobile } from './hooks/useIsMobile'
import type { Filters } from './lib/types'
import type { Lang, Theme } from './lib/types'
import { formatProjectName, setHomeDir, MODEL_PRICING } from './lib/types'
import { StatCard } from './components/StatCard'
import { StreakBreakdownButton } from './components/StreakBreakdownButton'
import { ActivityHeatmap } from './components/ActivityHeatmap'
import { ActivityChart } from './components/ActivityChart'
import { HourChart } from './components/HourChart'
import { ModelBreakdown } from './components/ModelBreakdown'
import { ProjectsList } from './components/ProjectsList'
import { FiltersBar } from './components/FiltersBar'
import { RecentSessions } from './components/RecentSessions'
import { HighlightsBoard } from './components/HighlightsBoard'
import { InfoModal } from './components/InfoModal'
import { PDFExportModal } from './components/PDFExportModal'
import { HealthWarnings } from './components/HealthWarnings'
import { ToolMetricsPanel } from './components/ToolMetricsPanel'
import { AgentMetricsPanel } from './components/AgentMetricsPanel'
import { CacheHitRatePanel } from './components/CacheHitRatePanel'
import { BudgetPanel } from './components/BudgetPanel'
import { SessionDrilldownModal } from './components/SessionDrilldownModal'
import { PreferencesModal, type PrefsDraft } from './components/PreferencesModal'
import { DevConfigPanel } from './components/DevConfigPanel'
import { TtyChat } from './components/TtyChat'
import { ClaudeChat } from './components/ClaudeChat'
import { UpdateModal } from './components/UpdateModal'
import { type ChatModelId } from './lib/chatModels'
import { format, parseISO, parse } from 'date-fns'

// Phase 1: parallel (statsCache + sessions + health). Phase 2: projects. Phase 3: finalizing.
const LOAD_STAGES: { key: string; labelPt: string; labelEn: string; icon: React.ReactNode; phase: 1 | 2 | 3 }[] = [
  { key: 'statsCache', labelPt: 'Cache de estatísticas', labelEn: 'Stats cache',   icon: <Database size={13} />, phase: 1 },
  { key: 'sessions',   labelPt: 'Metadados de sessões',  labelEn: 'Session data',  icon: <FileText size={13} />, phase: 1 },
  { key: 'health',     labelPt: 'Verificações de saúde', labelEn: 'Health checks', icon: <Shield size={13} />,   phase: 1 },
  { key: 'projects',   labelPt: 'Escaneando projetos',   labelEn: 'Project scan',  icon: <FolderOpen size={13} />, phase: 2 },
  { key: 'finalizing', labelPt: 'Totalizando tokens',    labelEn: 'Counting tokens', icon: <Zap size={13} />,    phase: 3 },
]

function formatStageDetail(key: string, detail: string, lang: string): string {
  const n = Number(detail)
  if (isNaN(n) || n === 0) return ''
  if (key === 'sessions') return `${n.toLocaleString()} ${lang === 'pt' ? 'sessões' : 'sessions'}`
  if (key === 'projects') return `${n.toLocaleString()} ${lang === 'pt' ? 'projetos' : 'projects'}`
  if (key === 'finalizing') {
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M tokens`
    if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K tokens`
    return `${n.toLocaleString()} tokens`
  }
  return n.toLocaleString()
}

function LoadingScreen({ lang, loadProgress }: { lang: string; loadProgress: LoadProgress }) {
  // Group phase 1 stages to show parallel badge
  const phase1Done = ['statsCache', 'sessions', 'health'].filter(k => loadProgress[k]?.status === 'done').length

  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 28,
      background: 'var(--bg-base)',
    }}>
      <style>{`
        @keyframes loadShimmer {
          0%{background-position:200% center}
          100%{background-position:-200% center}
        }
        @keyframes loadIndeterminate {
          0%{transform:translateX(-100%)}
          100%{transform:translateX(400%)}
        }
        @keyframes loadFadeUp {
          from{opacity:0;transform:translateY(10px)}
          to{opacity:1;transform:translateY(0)}
        }
        @keyframes loadIconGlow {
          0%,100%{box-shadow:0 0 0 0 rgba(217,119,6,0),0 0 10px 2px rgba(217,119,6,0.2)}
          50%{box-shadow:0 0 0 6px rgba(217,119,6,0),0 0 20px 5px rgba(217,119,6,0.35)}
        }
      `}</style>

      {/* Icon */}
      <div style={{ animation: 'loadFadeUp 0.35s ease-out both' }}>
        <div style={{
          width: 48, height: 48,
          background: 'var(--anthropic-orange-dim)',
          borderRadius: 14,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          animation: 'loadIconGlow 2.2s ease-in-out infinite',
        }}>
          <BarChart2 size={22} color="var(--anthropic-orange)" />
        </div>
      </div>

      {/* Title + subtitle */}
      <div style={{ textAlign: 'center', animation: 'loadFadeUp 0.35s ease-out 0.08s both' }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 5, letterSpacing: '-0.01em' }}>
          agentistics
        </div>
        <div style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>
          {lang === 'pt' ? 'Carregando seus dados...' : 'Loading your data...'}
        </div>
      </div>

      {/* Stage progress bars */}
      <div style={{
        width: 340,
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
        animation: 'loadFadeUp 0.35s ease-out 0.16s both',
      }}>
        {/* Phase label */}
        {phase1Done < 3 && (
          <div style={{ fontSize: 10, color: 'var(--text-tertiary)', letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 2 }}>
            {lang === 'pt' ? '⇉ Paralelo' : '⇉ Parallel'}
          </div>
        )}

        {LOAD_STAGES.map((stage, idx) => {
          const sp = loadProgress[stage.key]
          const progress = sp?.progress ?? 0
          const status = sp?.status ?? 'pending'
          const label = lang === 'pt' ? stage.labelPt : stage.labelEn
          const pct = Math.round(progress * 100)
          const detailStr = sp?.detail ? formatStageDetail(stage.key, sp.detail, lang) : ''
          // For phase separator
          const prevStage = LOAD_STAGES[idx - 1]
          const showSeparator = prevStage && prevStage.phase !== stage.phase && phase1Done === 3

          return (
            <React.Fragment key={stage.key}>
              {showSeparator && (
                <div style={{ height: 1, background: 'var(--border)', opacity: 0.4, margin: '2px 0' }} />
              )}
              <div>
                <div style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  marginBottom: 6,
                }}>
                  <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 7,
                    color: status === 'pending' ? 'var(--text-tertiary)' : 'var(--text-secondary)',
                    transition: 'color 0.25s',
                  }}>
                    <span style={{ opacity: status === 'pending' ? 0.35 : 0.8, display: 'flex', transition: 'opacity 0.25s' }}>
                      {stage.icon}
                    </span>
                    <span style={{ fontSize: 12, fontWeight: 500 }}>
                      {label}
                      {detailStr && status === 'done' && (
                        <span style={{ color: 'var(--text-tertiary)', fontWeight: 400, marginLeft: 7, fontSize: 11 }}>
                          {detailStr}
                        </span>
                      )}
                    </span>
                  </div>
                  <span style={{
                    fontSize: 11,
                    fontWeight: 600,
                    color: status === 'done' ? 'var(--anthropic-orange)' : status === 'active' ? 'var(--text-secondary)' : 'var(--text-tertiary)',
                    transition: 'color 0.25s',
                    minWidth: 34,
                    textAlign: 'right',
                    fontVariantNumeric: 'tabular-nums',
                  }}>
                    {status === 'pending' ? '—' : status === 'done' ? '✓' : pct > 0 ? `${pct}%` : '…'}
                  </span>
                </div>
                {/* Bar track */}
                <div style={{ height: 4, background: 'var(--bg-elevated)', borderRadius: 2, overflow: 'hidden', position: 'relative' }}>
                  {status === 'active' && pct === 0 ? (
                    // Indeterminate — shows loading activity before real progress arrives
                    <div style={{
                      position: 'absolute',
                      top: 0, bottom: 0,
                      width: '35%',
                      borderRadius: 2,
                      background: 'linear-gradient(90deg, transparent, rgba(217,119,6,0.55), transparent)',
                      animation: 'loadIndeterminate 1.6s ease-in-out infinite',
                    }} />
                  ) : (
                    <div style={{
                      height: '100%',
                      width: status === 'done' ? '100%' : `${pct}%`,
                      minWidth: status === 'active' && pct > 0 && pct < 100 ? 10 : undefined,
                      borderRadius: 2,
                      ...(status === 'active' ? {
                        backgroundImage: 'linear-gradient(90deg, var(--anthropic-orange) 0%, rgba(217,119,6,0.5) 50%, var(--anthropic-orange) 100%)',
                        backgroundSize: '200% 100%',
                        animation: 'loadShimmer 1.8s linear infinite',
                      } : {
                        background: status === 'done' ? 'var(--anthropic-orange)' : 'transparent',
                      }),
                      transition: 'width 0.3s ease-out',
                    }} />
                  )}
                </div>
              </div>
            </React.Fragment>
          )
        })}
      </div>
    </div>
  )
}

function Section({ title, children, action, onExpand, flashId, style: extraStyle }: {
  title: React.ReactNode
  children: React.ReactNode
  action?: React.ReactNode
  onExpand?: () => void
  flashId?: string
  style?: React.CSSProperties
}) {
  return (
    <div
      data-flash-id={flashId}
      style={{
        background: 'var(--bg-card)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius-lg)',
        padding: '20px 22px',
        boxSizing: 'border-box',
        ...extraStyle,
      }}
    >
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: 18,
      }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: 8 }}>
          {title}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {action}
          {onExpand && (
            <button
              onClick={onExpand}
              title="Expandir"
              style={{
                width: 24, height: 24,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                borderRadius: 6,
                border: '1px solid var(--border)',
                background: 'transparent',
                color: 'var(--text-tertiary)',
                cursor: 'pointer',
                transition: 'all 0.15s',
                padding: 0,
              }}
              onMouseEnter={e => {
                ;(e.currentTarget as HTMLButtonElement).style.color = 'var(--text-primary)'
                ;(e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--text-tertiary)'
              }}
              onMouseLeave={e => {
                ;(e.currentTarget as HTMLButtonElement).style.color = 'var(--text-tertiary)'
                ;(e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--border)'
              }}
            >
              <Maximize2 size={12} />
            </button>
          )}
        </div>
      </div>
      {children}
    </div>
  )
}

function ChartModal({ title, onClose, children }: {
  title: React.ReactNode
  onClose: () => void
  children: React.ReactNode
}) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [onClose])

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 300,
        background: 'rgba(0,0,0,0.6)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 32,
        backdropFilter: 'blur(4px)',
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: 'var(--bg-card)',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius-lg)',
          padding: '24px 28px',
          width: '100%',
          maxWidth: 1100,
          maxHeight: '90vh',
          overflow: 'auto',
          boxShadow: 'var(--shadow-elevated)',
        }}
      >
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          marginBottom: 20,
        }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: 8 }}>
            {title}
          </div>
          <button
            onClick={onClose}
            style={{
              width: 28, height: 28,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              borderRadius: 7,
              border: '1px solid var(--border)',
              background: 'transparent',
              color: 'var(--text-tertiary)',
              cursor: 'pointer',
              transition: 'all 0.15s',
              padding: 0,
            }}
            onMouseEnter={e => { ;(e.currentTarget as HTMLButtonElement).style.color = 'var(--text-primary)' }}
            onMouseLeave={e => { ;(e.currentTarget as HTMLButtonElement).style.color = 'var(--text-tertiary)' }}
          >
            <X size={14} />
          </button>
        </div>
        {children}
      </div>
    </div>
  )
}

function fmt(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return String(n)
}

function fmtDuration(ms: number): string {
  const h = Math.floor(ms / 3_600_000)
  const m = Math.floor((ms % 3_600_000) / 60_000)
  if (h > 0) return `${h}h ${m}m`
  return `${m}m`
}

function LiveSettingsModal({
  lang, liveUpdates, setLiveUpdates, updateInterval, setUpdateInterval,
  riskyMode, setRiskyMode, highlightUpdates, setHighlightUpdates, onClose,
}: {
  lang: Lang
  liveUpdates: boolean
  setLiveUpdates: (v: boolean) => void
  updateInterval: number
  setUpdateInterval: (v: number) => void
  riskyMode: boolean
  setRiskyMode: (v: boolean) => void
  highlightUpdates: boolean
  setHighlightUpdates: (v: boolean) => void
  onClose: () => void
}) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [onClose])

  const ToggleSwitch = ({ on, onToggle }: { on: boolean; onToggle: () => void }) => (
    <button
      onClick={onToggle}
      style={{
        position: 'relative', width: 32, height: 18, borderRadius: 9,
        border: 'none', background: on ? 'var(--anthropic-orange)' : 'var(--text-tertiary)',
        cursor: 'pointer', padding: 0, transition: 'background 0.2s', flexShrink: 0,
      }}
    >
      <span style={{
        position: 'absolute', top: 3, left: on ? 17 : 3,
        width: 12, height: 12, borderRadius: '50%', background: '#fff',
        transition: 'left 0.2s', boxShadow: '0 1px 3px rgba(0,0,0,0.3)',
      }} />
    </button>
  )

  const allIntervals = [
    ...(riskyMode ? LIVE_INTERVAL_OPTIONS_RISKY : []),
    ...LIVE_INTERVAL_OPTIONS,
  ]

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 400,
        background: 'rgba(0,0,0,0.5)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        backdropFilter: 'blur(4px)',
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: 'var(--bg-card)',
          border: '1px solid var(--border)',
          borderRadius: 14,
          padding: '24px',
          width: 360,
          boxShadow: '0 8px 40px rgba(0,0,0,0.4)',
        }}
      >
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 22 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Settings size={14} style={{ color: 'var(--text-secondary)' }} />
            <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)' }}>
              {lang === 'pt' ? 'Configurações de live' : 'Live update settings'}
            </span>
          </div>
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

        {/* Live on/off */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
          <div>
            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 2 }}>
              {lang === 'pt' ? 'Atualização em tempo real' : 'Live updates'}
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>
              {lang === 'pt' ? 'Monitora mudanças automaticamente' : 'Automatically polls for changes'}
            </div>
          </div>
          <ToggleSwitch on={liveUpdates} onToggle={() => setLiveUpdates(!liveUpdates)} />
        </div>

        <div style={{ height: 1, background: 'var(--border)', marginBottom: 20 }} />

        {/* Update interval */}
        <div style={{ marginBottom: 20 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 10, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
            {lang === 'pt' ? 'Intervalo de atualização' : 'Update interval'}
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {allIntervals.map(opt => {
              const isRisky = opt.value < 10
              const active = updateInterval === opt.value
              return (
                <button
                  key={opt.value}
                  onClick={() => { setUpdateInterval(opt.value); if (!liveUpdates) setLiveUpdates(true) }}
                  style={{
                    padding: '5px 12px',
                    borderRadius: 6,
                    border: active
                      ? `1px solid ${isRisky ? '#ef4444' : 'var(--anthropic-orange)'}80`
                      : '1px solid var(--border)',
                    background: active
                      ? isRisky ? 'rgba(239,68,68,0.12)' : 'var(--anthropic-orange-dim)'
                      : 'var(--bg-elevated)',
                    color: active
                      ? isRisky ? '#ef4444' : 'var(--anthropic-orange)'
                      : 'var(--text-secondary)',
                    fontSize: 12, fontWeight: active ? 700 : 500,
                    cursor: 'pointer', fontFamily: 'inherit',
                    transition: 'all 0.1s',
                  }}
                >
                  {isRisky ? `⚡ ${opt.label}` : opt.label}
                </button>
              )
            })}
          </div>
        </div>

        <div style={{ height: 1, background: 'var(--border)', marginBottom: 20 }} />

        {/* Risky mode */}
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, marginBottom: 20 }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3 }}>
              <Zap size={12} style={{ color: riskyMode ? '#ef4444' : 'var(--text-tertiary)' }} fill={riskyMode ? '#ef4444' : 'none'} />
              <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>
                {lang === 'pt' ? 'Modo arriscado' : 'Risky mode'}
              </span>
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-tertiary)', lineHeight: 1.5 }}>
              {lang === 'pt'
                ? 'Desbloqueia intervalos abaixo de 10s (até 1s). Pode aumentar o uso de CPU e I/O.'
                : 'Unlocks sub-10s intervals (down to 1s). May increase CPU and I/O load.'}
            </div>
          </div>
          <ToggleSwitch
            on={riskyMode}
            onToggle={() => {
              const next = !riskyMode
              setRiskyMode(next)
              if (!next && updateInterval < 10) setUpdateInterval(10)
            }}
          />
        </div>

        <div style={{ height: 1, background: 'var(--border)', marginBottom: 20 }} />

        {/* Update highlights */}
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3 }}>
              <Sparkles size={12} style={{ color: highlightUpdates ? 'var(--anthropic-orange)' : 'var(--text-tertiary)' }} />
              <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>
                {lang === 'pt' ? 'Destaques de atualização' : 'Update highlights'}
              </span>
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-tertiary)', lineHeight: 1.5 }}>
              {lang === 'pt'
                ? 'Destaca visualmente as seções que mudaram na última atualização.'
                : 'Briefly glows sections that changed on the last data update.'}
            </div>
          </div>
          <ToggleSwitch on={highlightUpdates} onToggle={() => setHighlightUpdates(!highlightUpdates)} />
        </div>
      </div>
    </div>
  )
}

function fmtFull(n: number): string {
  return Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.')
}

function fmtCost(usd: number, currency: 'USD' | 'BRL' = 'USD', rate = 1): string {
  if (currency === 'BRL') {
    const brl = usd * rate
    if (brl < 0.05) return '<R$0,05'
    const [intPart, decPart] = brl.toFixed(2).split('.')
    return `R$${(intPart ?? '0').replace(/\B(?=(\d{3})+$)/g, '.')},${decPart}`
  }
  if (usd < 0.01) return '<USD 0.01'
  return `USD ${usd.toFixed(2)}`
}

function fmtCostFull(usd: number, currency: 'USD' | 'BRL' = 'USD', rate = 1): string {
  if (currency === 'BRL') {
    const brl = usd * rate
    if (brl < 0.00001) return '<R$0,00001'
    const [intPart, decPart] = brl.toFixed(6).split('.')
    return `R$${(intPart ?? '0').replace(/\B(?=(\d{3})+$)/g, '.')},${decPart}`
  }
  if (usd < 0.000001) return '<USD 0.000001'
  return `USD ${usd.toFixed(6)}`
}

function MobileBottomNav({ lang }: { lang: Lang }) {
  const location = useLocation()
  const pt = lang === 'pt'

  const tabs = [
    { to: '/',         labelPt: 'Home',       labelEn: 'Home',      icon: Home },
    { to: '/costs',    labelPt: 'Custos',     labelEn: 'Costs',     icon: DollarSign },
    { to: '/projects', labelPt: 'Projetos',   labelEn: 'Projects',  icon: FolderOpen },
    { to: '/tools',    labelPt: 'Ferramentas',labelEn: 'Tools',     icon: Wrench },
    { to: '/custom',   labelPt: 'Custom',     labelEn: 'Custom',    icon: Layers },
  ] as const

  return (
    <nav
      className="mobile-bottom-nav"
      style={{
        position: 'fixed',
        bottom: 0,
        left: 0,
        right: 0,
        zIndex: 200,
        background: 'var(--bg-surface)',
        borderTop: '1px solid var(--border)',
        display: 'flex',
        alignItems: 'stretch',
        height: 56,
      }}
    >
      {tabs.map(tab => {
        const active = tab.to === '/'
          ? location.pathname === '/'
          : location.pathname.startsWith(tab.to)
        const Icon = tab.icon
        return (
          <NavLink
            key={tab.to}
            to={tab.to}
            end={tab.to === '/'}
            style={{
              flex: 1,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 3,
              textDecoration: 'none',
              color: active ? 'var(--anthropic-orange)' : 'var(--text-tertiary)',
              fontSize: 10,
              fontWeight: active ? 700 : 500,
              transition: 'color 0.15s',
              padding: '6px 0',
            }}
          >
            <Icon size={18} />
            <span>{pt ? tab.labelPt : tab.labelEn}</span>
          </NavLink>
        )
      })}
    </nav>
  )
}

function NavTabs({ lang }: { lang: Lang }) {
  const location = useLocation()
  const pt = lang === 'pt'

  const tabs: { to: string; labelPt: string; labelEn: string; icon: React.ReactNode }[] = [
    { to: '/',          labelPt: 'Home',         labelEn: 'Home',         icon: <Home size={12} /> },
    { to: '/costs',     labelPt: 'Custos',       labelEn: 'Costs',        icon: <DollarSign size={12} /> },
    { to: '/projects',  labelPt: 'Projetos',     labelEn: 'Projects',     icon: <FolderOpen size={12} /> },
    { to: '/tools',     labelPt: 'Ferramentas',  labelEn: 'Tools',        icon: <Wrench size={12} /> },
    { to: '/custom',    labelPt: 'Personalizado',labelEn: 'Custom',       icon: <Layers size={12} /> },
  ]

  return (
    <nav style={{ display: 'flex', gap: 2, height: 42, alignItems: 'center', overflowX: 'auto' }}>
      {tabs.map(tab => {
        const active = tab.to === '/'
          ? location.pathname === '/'
          : location.pathname.startsWith(tab.to)
        return (
          <NavLink
            key={tab.to}
            to={tab.to}
            end={tab.to === '/'}
            style={{
              display: 'flex', alignItems: 'center', gap: 6,
              padding: '7px 12px',
              borderRadius: 8,
              textDecoration: 'none',
              fontSize: 12,
              fontWeight: active ? 700 : 500,
              fontFamily: 'inherit',
              color: active ? 'var(--anthropic-orange)' : 'var(--text-tertiary)',
              background: active ? 'var(--anthropic-orange-dim)' : 'transparent',
              border: active ? '1px solid var(--anthropic-orange)30' : '1px solid transparent',
              transition: 'all 0.15s',
              whiteSpace: 'nowrap',
            }}
            onMouseEnter={e => {
              if (!active) {
                ;(e.currentTarget as HTMLAnchorElement).style.color = 'var(--text-primary)'
                ;(e.currentTarget as HTMLAnchorElement).style.background = 'var(--bg-elevated)'
              }
            }}
            onMouseLeave={e => {
              if (!active) {
                ;(e.currentTarget as HTMLAnchorElement).style.color = 'var(--text-tertiary)'
                ;(e.currentTarget as HTMLAnchorElement).style.background = 'transparent'
              }
            }}
          >
            {tab.icon}
            {pt ? tab.labelPt : tab.labelEn}
          </NavLink>
        )
      })}
    </nav>
  )
}

export default function AppLayout() {
  const location = useLocation()
  const isCustomPage = location.pathname === '/custom'
  const isMobile = useIsMobile()
  const { data, loading, loadProgress, error, refetch, liveUpdates, setLiveUpdates, updateInterval, setUpdateInterval } = useData()
  const [riskyMode, setRiskyMode] = useState(false)
  const [showLiveSettings, setShowLiveSettings] = useState(false)
  const [lang, setLangState] = useState<Lang>('en')
  const [theme, setThemeState] = useState<Theme>('dark')
  const [currency, setCurrencyState] = useState<'USD' | 'BRL'>('USD')

  const setLang = useCallback((l: Lang) => setLangState(l), [])
  const setTheme = useCallback((t: Theme) => setThemeState(t), [])
  const setCurrency = useCallback((c: 'USD' | 'BRL') => setCurrencyState(c), [])
  const [brlRate, setBrlRate] = useState(5.70)
  const [filters, setFilters] = useState<Filters>({
    dateRange: 'all',
    customStart: '',
    customEnd: '',
    projects: [],
    models: [],
  })
  const [infoModalIndex, setInfoModalIndex] = useState<number | null>(null)
  const [showExportModal, setShowExportModal] = useState(
    () => new URLSearchParams(window.location.search).has('export')
  )
  const [expandedChart, setExpandedChart] = useState<string | null>(null)
  const [selectedSession, setSelectedSession] = useState<import('./lib/types').SessionMeta | null>(null)

  // Keep the drilldown modal in sync when live data refreshes
  useEffect(() => {
    if (!selectedSession || !data) return
    const updated = data.sessions.find(s => s.session_id === selectedSession.session_id)
    if (updated && updated !== selectedSession) setSelectedSession(updated)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data])

  const [monthlyBudgetUSD, setMonthlyBudgetUSD] = useState<number | null>(() => {
    try {
      const raw = localStorage.getItem('agentistics-monthly-budget-usd')
      if (!raw) return null
      const v = parseFloat(raw)
      return isNaN(v) ? null : v
    } catch { return null }
  })
  const updateBudget = useCallback((v: number | null) => {
    setMonthlyBudgetUSD(v)
    try {
      if (v === null) localStorage.removeItem('agentistics-monthly-budget-usd')
      else localStorage.setItem('agentistics-monthly-budget-usd', String(v))
    } catch { /* ignore quota/disabled storage */ }
  }, [])

  type CardId = 'messages' | 'sessions' | 'tool-calls' | 'input-tokens' | 'output-tokens' | 'cost' | 'streak' | 'longest-session' | 'commits' | 'files'
  const DEFAULT_CARD_ORDER: CardId[] = [
    'messages', 'sessions', 'tool-calls', 'input-tokens', 'output-tokens',
    'cost', 'streak', 'longest-session', 'commits', 'files',
  ]
  const [cardOrder, setCardOrder] = useState<CardId[]>(() => {
    try {
      const saved = localStorage.getItem('claude-stats-card-order')
      if (saved) {
        const parsed: CardId[] = JSON.parse(saved)
        const savedSet = new Set(parsed)
        const merged = parsed.filter(id => DEFAULT_CARD_ORDER.includes(id))
        for (const id of DEFAULT_CARD_ORDER) {
          if (!savedSet.has(id)) merged.push(id)
        }
        return merged
      }
    } catch {}
    return DEFAULT_CARD_ORDER
  })
  const [showPrefsModal, setShowPrefsModal] = useState(false)
  const [updateInfo, setUpdateInfo] = useState<{ current: string; latest: string } | null>(null)
  const [showDevConfig, setShowDevConfig] = useState(false)
  const [chatModel, setChatModel] = useState<ChatModelId | null>(null)
  const [chatSoundEnabled, setChatSoundEnabled] = useState(true)
  const [claudeDetached, setClaudeDetached] = useState(false)
  // Lifted Claude Chat state so project/session is preserved when toggling detach/attach
  const [claudeSharedState, setClaudeSharedState] = useState<{
    projectPath: string | null; projectName: string | null; projectEncodedDir: string | null
    sessionId: string | null; messages: import('./components/ClaudeChat').ChatMessage[]
  }>({ projectPath: null, projectName: null, projectEncodedDir: null, sessionId: null, messages: [] })

  const [cardPrecision, setCardPrecisionState] = useState<Record<string, boolean>>({})
  const precisionSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const setCardPrecision = useCallback((id: string, v: boolean) => {
    setCardPrecisionState(prev => {
      const next = { ...prev, [id]: v }
      if (precisionSaveTimer.current) clearTimeout(precisionSaveTimer.current)
      precisionSaveTimer.current = setTimeout(() => {
        fetch('/api/preferences', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ cardPrecision: next }),
        }).catch(() => {})
      }, 400)
      return next
    })
  }, [])
  const [scrolled, setScrolled] = useState(false)
  const [highlightUpdates, setHighlightUpdates] = useState(true)
  const highlightUpdatesRef = useRef(true)
  const flashTimersRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({})
  const prevDerivedFingerprintRef = useRef<Record<string, string>>({})
  const liveFlashFirstRunRef = useRef(true)

  useEffect(() => {
    fetch('/api/preferences')
      .then(r => r.ok ? r.json() : null)
      .then((prefs: { cardPrecision?: Record<string, boolean>; lang?: Lang; theme?: Theme; currency?: 'USD' | 'BRL'; cardOrder?: string[]; chatModel?: string; chatSoundEnabled?: boolean } | null) => {
        if (!prefs) return
        if (prefs.cardPrecision) setCardPrecisionState(prefs.cardPrecision)
        if (prefs.lang) setLangState(prefs.lang)
        if (prefs.theme) setThemeState(prefs.theme)
        if (prefs.currency) setCurrencyState(prefs.currency)
        if (prefs.cardOrder) setCardOrder(prefs.cardOrder as CardId[])
        if (prefs.chatModel) setChatModel(prefs.chatModel as ChatModelId)
        if (prefs.chatSoundEnabled !== undefined) setChatSoundEnabled(prefs.chatSoundEnabled)
      })
      .catch(() => {})
  }, [])

  useEffect(() => {
    fetch('/api/version')
      .then(r => r.ok ? r.json() : null)
      .then((info: { current: string; latest: string; hasUpdate: boolean } | null) => {
        if (info?.hasUpdate) setUpdateInfo({ current: info.current, latest: info.latest })
      })
      .catch(() => {})
  }, [])

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
  }, [theme])

  useEffect(() => {
    if (data?.homeDir) setHomeDir(data.homeDir)
  }, [data?.homeDir])

  useEffect(() => {
    let rafId: number | null = null
    const check = () => {
      if (rafId !== null) return
      rafId = requestAnimationFrame(() => {
        rafId = null
        setScrolled(window.scrollY > 0)
      })
    }
    check()
    window.addEventListener('scroll', check, { passive: true })
    return () => {
      window.removeEventListener('scroll', check)
      if (rafId !== null) cancelAnimationFrame(rafId)
    }
  }, [])

  useEffect(() => {
    type RatesResp = { brlRate: number; pricing: Record<string, { input: number; output: number; cacheRead: number; cacheWrite: number }> }
    fetch('/api/rates')
      .then(r => r.ok ? (r.json() as Promise<RatesResp>) : null)
      .then(rates => {
        if (!rates) return
        if (rates.brlRate && rates.brlRate > 1) setBrlRate(rates.brlRate)
        if (rates.pricing) {
          for (const [id, price] of Object.entries(rates.pricing)) {
            MODEL_PRICING[id] = price
          }
        }
      })
      .catch(() => { /* silently use defaults */ })
  }, [])

  // Maps home-page flash IDs → canvas catalog component IDs so both flash together
  const CATALOG_FLASH_MAP: Record<string, string[]> = {
    'messages':        ['kpi.messages'],
    'sessions':        ['kpi.sessions'],
    'tool-calls':      ['kpi.tool-calls'],
    'cost':            ['kpi.cost', 'costs.budget', 'costs.cache'],
    'streak':          ['kpi.streak'],
    'longest-session': ['kpi.longest-session'],
    'commits':         ['kpi.commits'],
    'files':           ['kpi.files'],
    'input-tokens':    ['kpi.input-tokens'],
    'output-tokens':   ['kpi.output-tokens'],
    'activity':        ['activity.chart', 'activity.chart-messages', 'activity.chart-sessions', 'activity.chart-tools'],
    'heatmap':         ['activity.heatmap'],
    'hours':           ['activity.hours', 'activity.hours-bar'],
    'models':          ['costs.model-breakdown'],
    'projects':        ['projects.list', 'projects.languages'],
    'tools':           ['tools.metrics'],
    'agents':          ['tools.agents'],
    'sessions-list':   ['sessions.recent'],
    'highlights':      ['sessions.highlights'],
  }

  const triggerFlash = useCallback((ids: string[]) => {
    if (!highlightUpdatesRef.current) return
    const expanded = [...ids]
    for (const id of ids) {
      const extra = CATALOG_FLASH_MAP[id]
      if (extra) expanded.push(...extra)
    }
    for (const id of expanded) {
      const els = Array.from(document.querySelectorAll(`[data-flash-id="${id}"]`))
      for (const elRaw of els) {
        const el = elRaw as HTMLElement
        if (flashTimersRef.current[id]) {
          clearTimeout(flashTimersRef.current[id])
          delete flashTimersRef.current[id]
        }
        el.classList.remove('live-flash')
        void el.offsetWidth
        el.classList.add('live-flash')
        flashTimersRef.current[id] = setTimeout(() => {
          el.classList.remove('live-flash')
          delete flashTimersRef.current[id]
        }, 1400)
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const derived = useDerivedStats(data, filters)

  const models = useMemo(() => {
    if (!data) return []
    const set = new Set<string>()
    for (const id of Object.keys(data.statsCache.modelUsage ?? {})) {
      if (id.startsWith('claude-')) set.add(id)
    }
    for (const s of data.sessions) {
      if (s.model && s.model.startsWith('claude-')) set.add(s.model)
    }
    return Array.from(set)
  }, [data])

  // When a project filter is active, compute which models are actually used in those projects
  const modelsInProject = useMemo(() => {
    if (!data || filters.projects.length === 0) return null
    const projectSet = new Set(filters.projects)
    const used = new Set<string>()
    for (const s of data.sessions) {
      if (s.model && projectSet.has(s.project_path)) used.add(s.model)
    }
    return used
  }, [data, filters.projects])

  // Live update highlight detection
  useEffect(() => {
    if (!liveUpdates || !derived) return
    const fp = prevDerivedFingerprintRef.current
    const toFlash: string[] = []

    const chk = (key: string, val: unknown, ids: string[]) => {
      const s = String(val ?? '')
      if (!liveFlashFirstRunRef.current && fp[key] !== s) toFlash.push(...ids)
      fp[key] = s
    }

    chk('totalMessages', derived.totalMessages, ['messages'])
    chk('totalSessions', derived.totalSessions, ['sessions'])
    chk('totalToolCalls', derived.totalToolCalls, ['tool-calls'])
    chk('totalCostUSD', derived.totalCostUSD?.toFixed(4), ['cost'])
    chk('streak', derived.streak, ['streak'])
    chk('longestSession', derived.longestSession?.session_id, ['longest-session'])
    chk('gitCommits', derived.gitCommits, ['commits'])
    chk('filesModified', derived.filesModified, ['files'])
    chk('inputTokens', derived.inputTokens, ['input-tokens'])
    chk('outputTokens', derived.outputTokens, ['output-tokens'])
    const lastHeat = derived.heatmapData?.[derived.heatmapData.length - 1]
    const heatSig = `${derived.heatmapData?.length}:${lastHeat?.sessions}`
    chk('heatmap', heatSig, ['activity', 'heatmap'])
    chk('hourCounts', JSON.stringify(derived.hourCounts), ['hours'])
    chk('modelUsage', JSON.stringify(Object.keys(derived.modelUsage ?? {})), ['models'])
    chk('projectStats', derived.projectStats?.length, ['projects'])
    chk('toolCounts', JSON.stringify(derived.toolCounts), ['tools'])
    chk('agentCount', derived.agentInvocations?.length, ['agents'])
    const sessSig = `${derived.filteredSessions?.length}:${derived.filteredSessions?.[0]?.session_id}`
    chk('sessions', sessSig, ['sessions-list', 'highlights'])

    liveFlashFirstRunRef.current = false
    if (toFlash.length > 0) triggerFlash([...new Set(toFlash)])
  }, [derived, liveUpdates, triggerFlash])

  // Session count per project from enriched sessions (have valid start_time).
  // Used in the Projects modal so its count matches the card when "All" is selected.
  const sessionCountByProject = useMemo(() => {
    if (!data) return {}
    const counts: Record<string, number> = {}
    for (const s of data.sessions) {
      if (!s.start_time || !s.project_path) continue
      counts[s.project_path] = (counts[s.project_path] ?? 0) + 1
    }
    return counts
  }, [data])

  // ── Info items for all 8 stat cards ──────────────────────────────────────────
  const infoItems = useMemo(() => {
    const projectFiltered = filters.projects.length > 0
    const pt = lang === 'pt'
    return [
      {
        label: pt ? 'Total de mensagens' : 'Total messages',
        source: projectFiltered
          ? '~/.claude/usage-data/session-meta/*.json → user_message_count + assistant_message_count'
          : '~/.claude/stats-cache.json → dailyActivity[].messageCount',
        formula: pt
          ? 'Σ messageCount de cada dia no período\nMédia = totalMessages ÷ totalSessions'
          : 'Σ messageCount for each day in the period\nAvg = totalMessages ÷ totalSessions',
        note: pt
          ? 'Cada "mensagem" conta uma entrada do usuário ou uma resposta do assistente. Com filtro de projeto ativo, recalculado dos session-meta individuais.'
          : 'Each "message" counts one user input or one assistant reply. With project filter active, recalculated from individual session-meta files.',
      },
      {
        label: pt ? 'Sessões' : 'Sessions',
        source: projectFiltered
          ? '~/.claude/usage-data/session-meta/*.json → filtrado por project_path'
          : '~/.claude/stats-cache.json → dailyActivity[].sessionCount',
        formula: pt
          ? 'Σ sessionCount dos dias no período\nMédia = totalMessages ÷ totalSessions'
          : 'Σ sessionCount for days in the period\nAvg = totalMessages ÷ totalSessions',
        note: pt
          ? 'Cada arquivo .jsonl em ~/.claude/projects/<proj>/ = 1 sessão. Uma sessão começa ao abrir o Claude e encerra ao fechar ou após inatividade.'
          : 'Each .jsonl file in ~/.claude/projects/<proj>/ = 1 session. A session starts when you open Claude and ends when you close it or after inactivity.',
      },
      {
        label: pt ? 'Chamadas de ferramentas' : 'Tool calls',
        source: projectFiltered
          ? '~/.claude/usage-data/session-meta/*.json → Σ tool_counts values'
          : '~/.claude/stats-cache.json → dailyActivity[].toolCallCount',
        formula: pt
          ? 'Σ values(tool_counts) por sessão\nEx: { Bash:16, Read:5, Edit:3 } = 24'
          : 'Σ values(tool_counts) per session\nEx: { Bash:16, Read:5, Edit:3 } = 24',
        note: pt
          ? 'Inclui todas as ferramentas: Bash, Read, Edit, Write, Grep, Glob, Agent, MCP tools, etc.'
          : 'Includes all tools: Bash, Read, Edit, Write, Grep, Glob, Agent, MCP tools, etc.',
      },
      {
        label: pt ? 'Sequência' : 'Streak',
        source: '~/.claude/stats-cache.json → dailyActivity[].date',
        formula: pt
          ? 'Conta dias consecutivos até hoje\ncom ≥ 1 mensagem registrada'
          : 'Count consecutive days up to today\nwith ≥ 1 message recorded',
        note: pt
          ? 'Sempre calculado sobre todos os projetos e datas — não afetado por filtros.'
          : 'Always calculated across all projects and dates — not affected by any filters.',
      },
      {
        label: pt ? 'Sessão mais longa' : 'Longest session',
        source: projectFiltered
          ? '~/.claude/usage-data/session-meta/*.json → max(duration_minutes) das sessões filtradas'
          : '~/.claude/usage-data/session-meta/*.json → max(duration_minutes) de todas as sessões',
        formula: pt
          ? 'duration = timestamp(últimaMsg) − timestamp(primeiraMsg)\nConvertido de minutos → h e min'
          : 'duration = timestamp(lastMsg) − timestamp(firstMsg)\nConverted from minutes → h and min',
        note: pt
          ? 'Com filtro de projeto ativo, considera apenas as sessões daquele projeto. Sem filtro, mostra o projeto correspondente.'
          : 'With project filter active, considers only sessions of that project. Without filter, shows the corresponding project.',
      },
      {
        label: pt ? 'Custo estimado' : 'Estimated cost',
        source: projectFiltered
          ? '~/.claude/usage-data/session-meta/*.json → input_tokens + output_tokens (taxa ponderada global)'
          : '~/.claude/stats-cache.json → modelUsage[model].{inputTokens, outputTokens, cacheRead, cacheWrite}',
        formula: pt
          ? 'Σ modelo [(input/1M × p.in) + (output/1M × p.out)\n  + (cacheRead/1M × p.cR) + (cacheWrite/1M × p.cW)]\n\nPreços por 1M tokens (Anthropic público):\n  Opus 4.6   → in $15.00 · out $75.00\n               cR  $1.50 · cW $18.75\n  Sonnet 4.6 → in  $3.00 · out $15.00\n               cR  $0.30 · cW  $3.75\n  Haiku 4.5  → in  $0.80 · out  $4.00\n               cR  $0.08 · cW  $1.00'
          : 'Σ model [(input/1M × p.in) + (output/1M × p.out)\n  + (cacheRead/1M × p.cR) + (cacheWrite/1M × p.cW)]\n\nPricing per 1M tokens (Anthropic public):\n  Opus 4.6   → in $15.00 · out $75.00\n               cR  $1.50 · cW $18.75\n  Sonnet 4.6 → in  $3.00 · out $15.00\n               cR  $0.30 · cW  $3.75\n  Haiku 4.5  → in  $0.80 · out  $4.00\n               cR  $0.08 · cW  $1.00',
        note: pt
          ? 'Cache read é ~10× mais barato que input normal. Cache write é ~1.25× mais caro. Com filtro de projeto, usa taxa ponderada global pelo mix de modelos.\nFonte oficial: anthropic.com/pricing#api'
          : 'Cache read is ~10× cheaper than regular input. Cache write is ~1.25× more expensive. With project filter, uses a global blended rate weighted by model mix.\nOfficial pricing: anthropic.com/pricing#api',
      },
      {
        label: pt ? 'Commits' : 'Commits',
        source: pt
          ? '~/.claude/projects/**/*.jsonl → comandos git commit/push nas chamadas Bash'
          : '~/.claude/projects/**/*.jsonl → git commit/push commands in Bash tool calls',
        formula: pt
          ? 'Σ git_commits das sessões no período\nΣ git_pushes das sessões no período'
          : 'Σ git_commits for sessions in the period\nΣ git_pushes for sessions in the period',
        note: pt
          ? 'Conta apenas commits e pushes executados pelo Claude via ferramenta Bash. Commits feitos manualmente no terminal não são capturados. Para histórico completo do repositório, use git log diretamente.'
          : 'Counts only commits and pushes executed by Claude via the Bash tool. Commits made manually in the terminal are not captured. For full repository history, use git log directly.',
      },
      {
        label: pt ? 'Arquivos modificados' : 'Files modified',
        source: pt
          ? '~/.claude/projects/**/*.jsonl → git log --numstat por sessão'
          : '~/.claude/projects/**/*.jsonl → git log --numstat per session',
        formula: pt
          ? 'Σ files_modified das sessões filtradas\nΣ lines_added  |  Σ lines_removed'
          : 'Σ files_modified for filtered sessions\nΣ lines_added  |  Σ lines_removed',
        note: pt
          ? 'Calculado via git log --numstat no intervalo de tempo de cada sessão. Requer que o projeto seja um repositório git e que git esteja instalado.'
          : 'Calculated via git log --numstat over each session\'s time window. Requires the project to be a git repository and git to be installed.',
      },
      {
        label: pt ? 'Tokens de entrada' : 'Input tokens',
        source: projectFiltered
          ? '~/.claude/usage-data/session-meta/*.json → input_tokens'
          : '~/.claude/stats-cache.json → modelUsage[model].inputTokens',
        formula: pt
          ? 'Sem filtro de projeto: Σ modelUsage[modelo].inputTokens\nCom filtro de projeto: Σ input_tokens das sessões filtradas'
          : 'No project filter: Σ modelUsage[model].inputTokens\nWith project filter: Σ input_tokens from filtered sessions',
        note: pt
          ? 'Tokens enviados ao modelo (prompt do usuário + contexto). Não inclui tokens de cache — esses são contados separadamente como cacheReadInputTokens e cacheCreationInputTokens.'
          : 'Tokens sent to the model (user prompt + context). Does not include cache tokens — those are counted separately as cacheReadInputTokens and cacheCreationInputTokens.',
      },
      {
        label: pt ? 'Tokens de saída' : 'Output tokens',
        source: projectFiltered
          ? '~/.claude/usage-data/session-meta/*.json → output_tokens'
          : '~/.claude/stats-cache.json → modelUsage[model].outputTokens',
        formula: pt
          ? 'Sem filtro de projeto: Σ modelUsage[modelo].outputTokens\nCom filtro de projeto: Σ output_tokens das sessões filtradas'
          : 'No project filter: Σ modelUsage[model].outputTokens\nWith project filter: Σ output_tokens from filtered sessions',
        note: pt
          ? 'Tokens gerados pelo modelo nas respostas. Tokens de saída são os mais caros — tipicamente 5× mais caros que tokens de entrada.'
          : 'Tokens generated by the model in responses. Output tokens are the most expensive — typically 5× more expensive than input tokens.',
      },
    ]
  }, [filters.projects.length, lang])

  if (loading) {
    return <LoadingScreen lang={lang} loadProgress={loadProgress} />
  }

  if (error) {
    return (
      <div style={{
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 16,
        padding: 40,
        textAlign: 'center',
      }}>
        <div style={{ fontSize: 40 }}>⚠️</div>
        <div style={{ fontSize: 16, fontWeight: 600, color: 'var(--text-primary)' }}>
          {lang === 'pt' ? 'Falha ao carregar dados' : 'Failed to load data'}
        </div>
        <div style={{ fontSize: 13, color: 'var(--text-secondary)', fontFamily: 'monospace', background: 'var(--bg-card)', padding: '10px 16px', borderRadius: 8, maxWidth: 500 }}>
          {error}
        </div>
        <div style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>
          {lang === 'pt' ? 'Certifique-se de que o servidor está rodando:' : 'Make sure the API server is running:'}{' '}
          <code style={{ background: 'var(--bg-elevated)', padding: '2px 6px', borderRadius: 4 }}>bun run server.ts</code>
        </div>
        <button onClick={refetch} style={{
          padding: '8px 20px',
          background: 'var(--anthropic-orange-dim)',
          border: '1px solid var(--anthropic-orange)60',
          borderRadius: 8,
          color: 'var(--anthropic-orange)',
          cursor: 'pointer',
          fontFamily: 'inherit',
          fontSize: 13,
          fontWeight: 600,
        }}>
          {lang === 'pt' ? 'Tentar novamente' : 'Retry'}
        </button>
      </div>
    )
  }

  if (!data || !derived) return null

  // Capture non-null derived for use in nested functions (TypeScript can't narrow closures)
  const d = derived
  const { statsCache } = data

  // Tokens: use model usage totals when available (non-project-filtered), fallback to session-level
  const totalInputTokens = Object.keys(derived.modelUsage).length > 0
    ? Object.values(derived.modelUsage).reduce((s, u) => s + u.inputTokens, 0)
    : derived.inputTokens
  const totalOutputTokens = Object.keys(derived.modelUsage).length > 0
    ? Object.values(derived.modelUsage).reduce((s, u) => s + u.outputTokens, 0)
    : derived.outputTokens

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg-base)' }}>
      {/* Header */}
      <header style={{
        background: 'var(--bg-surface)',
        position: 'sticky',
        top: 0,
        zIndex: 100,
        backdropFilter: 'blur(12px)',
        WebkitBackdropFilter: 'blur(12px)',
        boxShadow: scrolled ? '0 4px 24px rgba(0,0,0,0.25)' : 'none',
        borderBottom: '1px solid var(--border)',
        transition: 'box-shadow 0.25s ease',
      }}>
        <div style={{
          maxWidth: 1400,
          margin: '0 auto',
          padding: isMobile ? '0 16px' : '0 32px',
          height: isMobile ? 48 : 56,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <img
              src='/minimalistLogo.png'
              alt="agentistics"
              style={{ height: isMobile ? 44 : 64, width: 'auto' }}
            />
            {!isMobile && <div style={{ fontSize: 10, color: 'var(--text-tertiary)' }}>
              {lang === 'pt' ? 'Atualizado em' : 'Updated'}{' '}
              {statsCache.lastComputedDate ? format(parseISO(statsCache.lastComputedDate), 'MMM d') : lang === 'pt' ? 'hoje' : 'today'}
            </div>}
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: isMobile ? 6 : 10 }}>
            {!isMobile && statsCache.firstSessionDate && (
              <div style={{ fontSize: 11, color: 'var(--text-tertiary)', textAlign: 'right' }}>
                <div>{lang === 'pt' ? 'Desde' : 'Since'} {format(parseISO(statsCache.firstSessionDate), 'MMM d, yyyy')}</div>
                <div style={{ color: 'var(--text-secondary)' }}>
                  {derived.allTimeTotalSessions.toLocaleString()} {lang === 'pt' ? 'sessões' : 'sessions'}
                </div>
              </div>
            )}

            {/* Language toggle — hidden on mobile (accessible via preferences) */}
            {!isMobile && <button
              onClick={() => {
                const next = lang === 'pt' ? 'en' : 'pt'
                setLang(next)
                if (next === 'pt') setCurrency('BRL')
                else if (currency === 'BRL') setCurrency('USD')
              }}
              style={{
                height: 32,
                padding: '0 10px',
                display: 'flex', alignItems: 'center', gap: 5,
                borderRadius: 8,
                border: '1px solid var(--border)',
                background: 'transparent',
                color: 'var(--text-secondary)',
                cursor: 'pointer',
                fontSize: 12,
                fontFamily: 'inherit',
                fontWeight: 500,
                transition: 'all 0.15s',
              }}
              onMouseEnter={e => {
                ;(e.currentTarget as HTMLButtonElement).style.color = 'var(--text-primary)'
                ;(e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--text-tertiary)'
              }}
              onMouseLeave={e => {
                ;(e.currentTarget as HTMLButtonElement).style.color = 'var(--text-secondary)'
                ;(e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--border)'
              }}
              title={lang === 'pt' ? 'Switch to English' : 'Mudar para Português'}
            >
              <Globe size={13} />
              {lang === 'pt' ? 'EN' : 'PT'}
            </button>}

            {/* Theme toggle — hidden on mobile (accessible via preferences) */}
            {!isMobile && <button
              onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
              style={{
                width: 32, height: 32,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                borderRadius: 8,
                border: '1px solid var(--border)',
                background: 'transparent',
                color: 'var(--text-secondary)',
                cursor: 'pointer',
                transition: 'all 0.15s',
              }}
              onMouseEnter={e => {
                ;(e.currentTarget as HTMLButtonElement).style.color = 'var(--text-primary)'
                ;(e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--text-tertiary)'
              }}
              onMouseLeave={e => {
                ;(e.currentTarget as HTMLButtonElement).style.color = 'var(--text-secondary)'
                ;(e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--border)'
              }}
              title={theme === 'dark' ? (lang === 'pt' ? 'Tema claro' : 'Light theme') : (lang === 'pt' ? 'Tema escuro' : 'Dark theme')}
            >
              {theme === 'dark' ? <Sun size={14} /> : <Moon size={14} />}
            </button>}

            {/* Export report — hidden on mobile */}
            {!isMobile && <button
              onClick={() => setShowExportModal(true)}
              style={{
                height: 32,
                padding: '0 12px',
                display: 'flex', alignItems: 'center', gap: 6,
                borderRadius: 8,
                border: '1px solid var(--anthropic-orange)50',
                background: 'var(--anthropic-orange-dim)',
                color: 'var(--anthropic-orange)',
                cursor: 'pointer',
                fontSize: 12,
                fontFamily: 'inherit',
                fontWeight: 600,
                transition: 'all 0.15s',
              }}
              onMouseEnter={e => {
                ;(e.currentTarget as HTMLButtonElement).style.background = 'var(--anthropic-orange-dim)'
                ;(e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--anthropic-orange)'
                ;(e.currentTarget as HTMLButtonElement).style.opacity = '0.85'
              }}
              onMouseLeave={e => {
                ;(e.currentTarget as HTMLButtonElement).style.background = 'var(--anthropic-orange-dim)'
                ;(e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--anthropic-orange)50'
                ;(e.currentTarget as HTMLButtonElement).style.opacity = '1'
              }}
              title={lang === 'pt' ? 'Exportar relatório PDF' : 'Export PDF report'}
            >
              <Download size={13} />
              {lang === 'pt' ? 'Exportar' : 'Export'}
            </button>}

            {/* Preferences */}
            <button
              onClick={() => setShowPrefsModal(true)}
              style={{
                width: 32, height: 32,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                borderRadius: 8,
                border: '1px solid var(--border)',
                background: 'transparent',
                color: 'var(--text-secondary)',
                cursor: 'pointer',
                transition: 'all 0.15s',
              }}
              onMouseEnter={e => {
                ;(e.currentTarget as HTMLButtonElement).style.color = 'var(--text-primary)'
                ;(e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--text-tertiary)'
              }}
              onMouseLeave={e => {
                ;(e.currentTarget as HTMLButtonElement).style.color = 'var(--text-secondary)'
                ;(e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--border)'
              }}
              title={lang === 'pt' ? 'Preferências' : 'Preferences'}
            >
              <SlidersHorizontal size={14} />
            </button>

            {/* Dev config — hidden on mobile */}
            {!isMobile && <button
              onClick={() => setShowDevConfig(true)}
              style={{ width: 32, height: 32, display: 'flex', alignItems: 'center', justifyContent: 'center',
                borderRadius: 8, border: '1px solid var(--border)', background: 'transparent',
                color: 'var(--text-secondary)', cursor: 'pointer', transition: 'all 0.15s',
                fontFamily: 'monospace', fontSize: 13, fontWeight: 600 }}
              onMouseEnter={e => { e.currentTarget.style.color = 'var(--text-primary)'; e.currentTarget.style.borderColor = 'var(--text-tertiary)' }}
              onMouseLeave={e => { e.currentTarget.style.color = 'var(--text-secondary)'; e.currentTarget.style.borderColor = 'var(--border)' }}
              title="Dev config"
            >
              {'</>'}
            </button>}

            {/* Health warnings */}
            {data?.healthIssues && data.healthIssues.length > 0 && (
              <HealthWarnings issues={data.healthIssues} lang={lang} />
            )}

            {/* Live updates pill */}
            <div style={{
              display: 'flex', alignItems: 'center', gap: 6,
              padding: isMobile ? '0 8px' : '0 4px 0 10px',
              height: 32,
              borderRadius: 8,
              border: '1px solid var(--border)',
              background: 'var(--bg-secondary)',
            }}>
              {!isMobile && <Activity size={12} style={{ color: liveUpdates ? 'var(--anthropic-orange)' : 'var(--text-tertiary)', flexShrink: 0, transition: 'color 0.2s' }} />}
              {!isMobile && <span style={{ fontSize: 11, fontWeight: 500, color: liveUpdates ? 'var(--text-primary)' : 'var(--text-tertiary)', whiteSpace: 'nowrap', transition: 'color 0.2s', userSelect: 'none' }}>
                Live
              </span>}

              {/* iPhone-style toggle */}
              <button
                onClick={() => setLiveUpdates(v => !v)}
                title={liveUpdates ? 'Pause live updates' : 'Enable live updates'}
                style={{
                  position: 'relative', width: 28, height: 16, borderRadius: 8,
                  border: 'none', background: liveUpdates ? 'var(--anthropic-orange)' : 'var(--text-tertiary)',
                  cursor: 'pointer', padding: 0, transition: 'background 0.2s', flexShrink: 0,
                }}
              >
                <span style={{
                  position: 'absolute', top: 2, left: liveUpdates ? 14 : 2,
                  width: 12, height: 12, borderRadius: '50%', background: '#fff',
                  transition: 'left 0.2s', boxShadow: '0 1px 3px rgba(0,0,0,0.3)',
                }} />
              </button>

              {/* Interval badge — visible when live is on */}
              {liveUpdates && (
                <span style={{
                  fontSize: 10, fontWeight: 700,
                  color: riskyMode && updateInterval < 10 ? '#ef4444' : 'var(--anthropic-orange)',
                  userSelect: 'none',
                }}>
                  {riskyMode && updateInterval < 10 ? `⚡ ${updateInterval}s` : `${updateInterval >= 60 ? `${updateInterval / 60}m` : `${updateInterval}s`}`}
                </span>
              )}

              {/* Settings gear — desktop only */}
              {!isMobile && <button
                onClick={() => setShowLiveSettings(true)}
                title="Live update settings"
                style={{
                  width: 26, height: 26,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  background: 'transparent', border: 'none', cursor: 'pointer',
                  color: 'var(--text-tertiary)', borderRadius: 6,
                  transition: 'color 0.15s, background 0.15s',
                  flexShrink: 0,
                }}
                onMouseEnter={e => {
                  ;(e.currentTarget as HTMLButtonElement).style.color = 'var(--text-primary)'
                  ;(e.currentTarget as HTMLButtonElement).style.background = 'var(--bg-elevated)'
                }}
                onMouseLeave={e => {
                  ;(e.currentTarget as HTMLButtonElement).style.color = 'var(--text-tertiary)'
                  ;(e.currentTarget as HTMLButtonElement).style.background = 'transparent'
                }}
              >
                <Settings size={12} />
              </button>}
            </div>

            {/* Refresh */}
            <button
              onClick={refetch}
              style={{
                width: 32, height: 32,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                borderRadius: 8,
                border: '1px solid var(--border)',
                background: 'transparent',
                color: 'var(--text-tertiary)',
                cursor: 'pointer',
                transition: 'all 0.15s',
              }}
              onMouseEnter={e => {
                ;(e.currentTarget as HTMLButtonElement).style.color = 'var(--text-primary)'
                ;(e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--text-tertiary)'
              }}
              onMouseLeave={e => {
                ;(e.currentTarget as HTMLButtonElement).style.color = 'var(--text-tertiary)'
                ;(e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--border)'
              }}
              title={lang === 'pt' ? 'Atualizar' : 'Refresh'}
            >
              <RefreshCw size={14} />
            </button>
          </div>
        </div>

        {/* Filters row — second row of sticky header. Hidden on /custom (filter bar moves into the page). */}
        {data && !isCustomPage && (
          <div style={{
            borderTop: '1px solid var(--border)',
            maxWidth: 1400,
            margin: '0 auto',
            padding: isMobile ? '0 16px' : '0 32px',
            width: '100%',
            boxSizing: 'border-box',
            overflowX: isMobile ? 'auto' : undefined,
          }}>
            <FiltersBar
              filters={filters}
              onChange={setFilters}
              projects={data.projects}
              sessionCountByProject={sessionCountByProject}
              models={models}
              modelsInProject={modelsInProject}
              lang={lang}
            />
          </div>
        )}

        {/* Nav tabs — third row of sticky header (desktop only; mobile uses bottom nav) */}
        {!isMobile && (
          <div style={{
            borderTop: '1px solid var(--border)',
            maxWidth: 1400,
            margin: '0 auto',
            padding: '0 32px',
            width: '100%',
            boxSizing: 'border-box',
          }}>
            <NavTabs lang={lang} />
          </div>
        )}
      </header>

      {/* Main content — routed pages render here via <Outlet /> */}
      <main style={{
        maxWidth: 1400,
        margin: '0 auto',
        padding: isMobile ? '16px 16px 80px' : '24px 32px',
        display: 'flex',
        flexDirection: 'column',
        gap: isMobile ? 14 : 20,
      }}>
        <Outlet context={{
          data,
          derived,
          statsCache,
          filters, setFilters,
          lang, theme, currency, setCurrency, brlRate,
          monthlyBudgetUSD, updateBudget,
          totalInputTokens, totalOutputTokens,
          setExpandedChart, setSelectedSession, setInfoModalIndex,
          infoItems,
          cardOrder, setCardOrder: setCardOrder as (o: string[]) => void,
          cardPrecision, setCardPrecision,
          sessionCountByProject, models, modelsInProject,
        }} />
      </main>

      {/* Live settings modal */}
      {showLiveSettings && (
        <LiveSettingsModal
          lang={lang}
          liveUpdates={liveUpdates}
          setLiveUpdates={setLiveUpdates}
          updateInterval={updateInterval}
          setUpdateInterval={setUpdateInterval}
          riskyMode={riskyMode}
          setRiskyMode={setRiskyMode}
          highlightUpdates={highlightUpdates}
          setHighlightUpdates={v => { setHighlightUpdates(v); highlightUpdatesRef.current = v }}
          onClose={() => setShowLiveSettings(false)}
        />
      )}

      {/* Preferences modal */}
      {showPrefsModal && (
        <PreferencesModal
          initial={{ lang, theme, currency, cardOrder, cardPrecision, chatModel, chatSoundEnabled }}
          onSave={(draft: PrefsDraft) => {
            setLangState(draft.lang)
            setThemeState(draft.theme)
            setCurrencyState(draft.currency)
            setCardOrder(draft.cardOrder as CardId[])
            setCardPrecisionState(draft.cardPrecision)
            if (draft.chatModel) setChatModel(draft.chatModel)
            setChatSoundEnabled(draft.chatSoundEnabled)
            fetch('/api/preferences', {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                lang: draft.lang,
                theme: draft.theme,
                currency: draft.currency,
                cardOrder: draft.cardOrder,
                cardPrecision: draft.cardPrecision,
                chatModel: draft.chatModel,
                chatSoundEnabled: draft.chatSoundEnabled,
              }),
            }).catch(() => {})
            setShowPrefsModal(false)
          }}
          onClose={() => setShowPrefsModal(false)}
        />
      )}

      {/* Dev Config Panel */}
      {showDevConfig && <DevConfigPanel onClose={() => setShowDevConfig(false)} />}

      {/* Update available modal */}
      {updateInfo && (
        <UpdateModal
          current={updateInfo.current}
          latest={updateInfo.latest}
          lang={lang}
          onClose={() => setUpdateInfo(null)}
        />
      )}

      {/* Info Modal */}
      {infoModalIndex !== null && (
        <InfoModal
          items={infoItems}
          currentIndex={infoModalIndex}
          onClose={() => setInfoModalIndex(null)}
          onNavigate={setInfoModalIndex}
          lang={lang}
        />
      )}

      {/* Chart expand modals */}
      {expandedChart === 'activity' && (
        <ChartModal
          title={<><BarChart2 size={14} /> {lang === 'pt' ? 'Atividade ao longo do tempo' : 'Activity over time'}</>}
          onClose={() => setExpandedChart(null)}
        >
          <ActivityChart data={derived.heatmapData} height={480} theme={theme} />
        </ChartModal>
      )}
      {expandedChart === 'heatmap' && (
        <ChartModal
          title={lang === 'pt' ? 'Heatmap de atividade' : 'Activity heatmap'}
          onClose={() => setExpandedChart(null)}
        >
          <ActivityHeatmap data={derived.heatmapData} weeks={52} />
        </ChartModal>
      )}
      {expandedChart === 'hours' && (
        <ChartModal
          title={lang === 'pt' ? 'Uso por hora do dia' : 'Usage by hour'}
          onClose={() => setExpandedChart(null)}
        >
          <HourChart hourCounts={derived.hourCounts} hourMeta={derived.hourMeta} height={520} />
        </ChartModal>
      )}
      {expandedChart === 'models' && (
        <ChartModal
          title={<><TrendingUp size={14} /> {lang === 'pt' ? 'Uso por modelo' : 'Model usage & cost'}</>}
          onClose={() => setExpandedChart(null)}
        >
          <ModelBreakdown
            modelUsage={derived.modelUsage}
            currency={currency}
            brlRate={brlRate}
            fallbackInputTokens={filters.projects.length > 0 ? derived.inputTokens : undefined}
            fallbackOutputTokens={filters.projects.length > 0 ? derived.outputTokens : undefined}
            fallbackCostUSD={filters.projects.length > 0 ? derived.totalCostUSD : undefined}
          />
        </ChartModal>
      )}

      {/* Session drilldown modal */}
      {selectedSession && (
        <SessionDrilldownModal
          session={selectedSession}
          globalModelUsage={data.statsCache.modelUsage ?? {}}
          currency={currency}
          brlRate={brlRate}
          lang={lang}
          onClose={() => setSelectedSession(null)}
        />
      )}

      {/* PDF Export Modal */}
      {showExportModal && (
        <PDFExportModal
          data={data}
          filters={filters}
          lang={lang}
          currency={currency}
          brlRate={brlRate}
          onClose={() => setShowExportModal(false)}
        />
      )}

      {/* Mobile bottom navigation bar */}
      {isMobile && <MobileBottomNav lang={lang} />}

      {/* TTY Chat — floating button + panel, globally available */}
      <TtyChat
        lang={lang}
        chatModel={chatModel}
        chatSoundEnabled={chatSoundEnabled}
        filters={filters}
        setFilters={setFilters}
        isMobile={isMobile}
        onDetachClaude={() => setClaudeDetached(true)}
        claudeDetached={claudeDetached}
        onReattachClaude={() => setClaudeDetached(false)}
        onModelSet={(model) => {
          setChatModel(model)
          fetch('/api/preferences', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ chatModel: model }),
          }).catch(() => {})
        }}
        claudeSharedState={claudeSharedState}
        onClaudeStateChange={setClaudeSharedState}
      />

      {/* Claude Chat — floating draggable window (only when detached from TtyChat tab) */}
      {claudeDetached && (
        <ClaudeChat
          lang={lang}
          onAttach={() => setClaudeDetached(false)}
          initialProject={claudeSharedState.projectPath ? {
            path: claudeSharedState.projectPath,
            name: claudeSharedState.projectName ?? '',
            encodedDir: claudeSharedState.projectEncodedDir ?? '',
          } : null}
          initialSessionId={claudeSharedState.sessionId}
          initialMessages={claudeSharedState.messages}
          onStateChange={setClaudeSharedState}
        />
      )}

      {/* Footer */}
      <footer style={{
        marginTop: 64,
        borderTop: '1px solid var(--border)',
        background: 'var(--bg-surface)',
      }}>
        <div style={{ maxWidth: 1400, margin: '0 auto', padding: '56px 32px 36px' }}>

          {/* Main row */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 80, flexWrap: 'wrap', marginBottom: 48 }}>

            {/* Logo only — no text */}
            <div style={{ flexShrink: 0 }}>
              <img
                src='/logo.png'
                alt="agentistics"
                style={{ height: 180, width: 'auto', display: 'block' }}
              />
            </div>

            {/* Description + stats + version — middle */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14, flex: '1 1 200px' }}>
              <p style={{ fontSize: 14, color: 'var(--text-secondary)', lineHeight: 1.7, margin: 0 }}>
                {lang === 'pt'
                  ? 'Dashboard local de uso do Claude Code. Seus dados ficam no seu computador — sem servidores, sem rastreamento.'
                  : 'Local Claude Code usage dashboard. Your data stays on your machine — no servers, no tracking.'}
              </p>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                {/* Live stats pill */}
                <div style={{
                  display: 'inline-flex', alignItems: 'center', gap: 6,
                  padding: '4px 12px', borderRadius: 20,
                  background: 'var(--bg-card)', border: '1px solid var(--border)',
                }}>
                  <div style={{
                    width: 6, height: 6, borderRadius: '50%',
                    background: 'var(--accent-green)', boxShadow: '0 0 8px var(--accent-green)',
                  }} />
                  <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
                    {derived.totalSessions.toLocaleString()} {lang === 'pt' ? 'sessões' : 'sessions'}
                    {' · '}
                    {derived.totalMessages.toLocaleString()} {lang === 'pt' ? 'mensagens' : 'messages'}
                  </span>
                </div>
                {/* Version badge */}
                <a
                  href="https://github.com/blpsoares/agentistics/releases/latest"
                  target="_blank" rel="noreferrer"
                  style={{
                    display: 'inline-flex', alignItems: 'center', gap: 5,
                    padding: '4px 10px', borderRadius: 20,
                    background: 'var(--anthropic-orange-dim)',
                    border: '1px solid var(--anthropic-orange-dim)',
                    fontSize: 11, color: 'var(--anthropic-orange-light)',
                    textDecoration: 'none', fontWeight: 600,
                    transition: 'opacity 0.15s',
                  }}
                  onMouseEnter={e => (e.currentTarget.style.opacity = '0.75')}
                  onMouseLeave={e => (e.currentTarget.style.opacity = '1')}
                >
                  <Zap size={11} />
                  v{version}
                </a>
              </div>
            </div>

            {/* Link columns — right */}
            <div style={{ display: 'flex', gap: 56, flexShrink: 0, flexWrap: 'wrap' }}>
              {([
                {
                  title: lang === 'pt' ? 'Projeto' : 'Project',
                  links: [
                    { href: 'https://github.com/blpsoares/agentistics', label: lang === 'pt' ? 'Repositório' : 'Repository' },
                    { href: 'https://github.com/blpsoares/agentistics/releases', label: 'Releases' },
                    { href: 'https://github.com/blpsoares/agentistics/issues', label: 'Issues' },
                    { href: 'https://github.com/blpsoares/agentistics/pulls', label: 'Pull Requests' },
                    { href: 'https://github.com/blpsoares/agentistics#readme', label: 'README' },
                  ],
                },
                {
                  title: 'Stack',
                  links: [
                    { href: 'https://bun.sh', label: 'Bun' },
                    { href: 'https://react.dev', label: 'React 19' },
                    { href: 'https://www.typescriptlang.org', label: 'TypeScript' },
                    { href: 'https://vitejs.dev', label: 'Vite' },
                    { href: 'https://recharts.org', label: 'Recharts' },
                  ],
                },
                {
                  title: lang === 'pt' ? 'Comunidade' : 'Community',
                  links: [
                    { href: 'https://github.com/blpsoares/agentistics', label: lang === 'pt' ? 'Star no GitHub' : 'Star on GitHub' },
                    { href: 'https://github.com/blpsoares/agentistics/fork', label: 'Fork' },
                    { href: 'https://github.com/blpsoares/agentistics/issues/new', label: lang === 'pt' ? 'Contribuir' : 'Contribute' },
                    { href: 'https://github.com/blpsoares', label: '@blpsoares' },
                  ],
                },
              ] as { title: string; links: { href: string; label: string }[] }[]).map(({ title, links }) => (
                <div key={title} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-primary)', textTransform: 'uppercase', letterSpacing: '0.1em' }}>
                    {title}
                  </span>
                  {links.map(({ href, label }) => (
                    <a key={href} href={href} target="_blank" rel="noreferrer" style={{
                      fontSize: 13, color: 'var(--text-tertiary)', textDecoration: 'none',
                      transition: 'color 0.15s',
                    }}
                      onMouseEnter={e => (e.currentTarget.style.color = 'var(--text-primary)')}
                      onMouseLeave={e => (e.currentTarget.style.color = 'var(--text-tertiary)')}
                    >
                      {label}
                    </a>
                  ))}
                </div>
              ))}
            </div>
          </div>

          {/* Bottom bar */}
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            flexWrap: 'wrap', gap: 12, paddingTop: 24,
            borderTop: '1px solid var(--border-subtle)',
          }}>
            <span style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>
              {lang === 'pt' ? 'Feito com' : 'Made with'}{' '}
              <span style={{ color: 'var(--anthropic-orange)', fontWeight: 700 }}>♥</span>
              {' '}{lang === 'pt' ? 'por' : 'by'}{' '}
              <a href="https://github.com/blpsoares" target="_blank" rel="noreferrer" style={{
                color: 'var(--text-secondary)', textDecoration: 'none', fontWeight: 500, transition: 'color 0.15s',
              }}
                onMouseEnter={e => (e.currentTarget.style.color = 'var(--text-primary)')}
                onMouseLeave={e => (e.currentTarget.style.color = 'var(--text-secondary)')}
              >
                Bryan Soares
              </a>
            </span>
            <span style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>
              {lang === 'pt' ? 'Não afiliado à Anthropic' : 'Not affiliated with Anthropic'}
            </span>
          </div>
        </div>
      </footer>
    </div>
  )
}

function TagCloud({ data, color }: { data: Record<string, number>; color: string }) {
  const entries = Object.entries(data)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20)

  if (entries.length === 0) {
    return (
      <div style={{ color: 'var(--text-tertiary)', fontSize: 13, textAlign: 'center', padding: 16 }}>
        No data
      </div>
    )
  }

  const max = Math.max(...entries.map(([, v]) => v), 1)

  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
      {entries.map(([name, count]) => {
        const pct = count / max
        const opacity = 0.3 + pct * 0.7
        return (
          <div
            key={name}
            style={{
              padding: '4px 10px',
              borderRadius: 20,
              background: `${color}18`,
              border: `1px solid ${color}${Math.round(opacity * 40).toString(16).padStart(2, '0')}`,
              fontSize: 11 + pct * 2,
              fontWeight: pct > 0.6 ? 600 : 400,
              color: 'var(--text-secondary)',
              display: 'flex',
              alignItems: 'center',
              gap: 5,
            }}
          >
            {name}
            <span style={{ opacity: 0.5, fontSize: 10 }}>{count}</span>
          </div>
        )
      })}
    </div>
  )
}
