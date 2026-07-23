import React, { useState, useMemo, useEffect, useRef, useCallback } from 'react'
import { Outlet, NavLink, useLocation, useNavigate } from 'react-router-dom'
import { createPortal } from 'react-dom'
import { version } from '../../../package.json'
import {
  MessageSquare, Zap, Clock, Flame, GitCommit,
  Wrench, RefreshCw, FileCode, TrendingUp, BarChart2,
  Sun, Moon, Globe, AlertTriangle, Download, FileDown,
  Maximize2, X, Trophy, Activity, Bot, Sparkles, Settings, SlidersHorizontal,
  Calendar, Database, FileText, Shield, FolderOpen, CheckCircle,
  Target, Home, DollarSign, Layers, Code2, GitCompare, MoreHorizontal,
  ChevronDown, ChevronUp, ChevronLeft, ChevronRight, Workflow as WorkflowIcon,
  GitBranch, Users, LogOut, Server,
} from 'lucide-react'
import { useData, useDerivedStats, LIVE_INTERVAL_OPTIONS, LIVE_INTERVAL_OPTIONS_RISKY } from './hooks/useData'
import type { LoadProgress } from './hooks/useData'
import { useIsMobile } from './hooks/useIsMobile'
import type { Filters, HarnessId, HealthIssue } from '@agentistics/core'
import type { Lang, Theme } from '@agentistics/core'
import { formatProjectName, setHomeDir, MODEL_PRICING, distinctUsers, distinctHarnesses, filterByUsers } from '@agentistics/core'
import { StatCard } from './components/StatCard'
import { StreakBreakdownButton } from './components/StreakBreakdownButton'
import { ActivityHeatmap } from './components/ActivityHeatmap'
import { ActivityChart } from './components/ActivityChart'
import { HourChart } from './components/HourChart'
import { ModelBreakdown } from './components/ModelBreakdown'
import { ProjectsList } from './components/ProjectsList'
import { FiltersBar } from './components/FiltersBar'
import { NotificationToasts } from './components/NotificationToasts'
import { NotificationBell } from './components/NotificationBell'
import { useNotificationStream } from './hooks/useNotificationStream'
import { pushNotification } from './lib/notifications'
import { RecentSessions } from './components/RecentSessions'
import { HighlightsBoard } from './components/HighlightsBoard'
import { InfoModal } from './components/InfoModal'
import { PDFDirectExporter } from './components/PDFExportModal'
import { HealthWarnings } from './components/HealthWarnings'
import { ToolMetricsPanel } from './components/ToolMetricsPanel'
import { AgentMetricsPanel } from './components/AgentMetricsPanel'
import { CacheHitRatePanel } from './components/CacheHitRatePanel'
import { BudgetPanel } from './components/BudgetPanel'
import { SessionDrilldownModal } from './components/SessionDrilldownModal'
import { TranscriptModal } from './components/TranscriptModal'
import type { PrefsDraft } from './lib/app-context'
import { TtyChat } from './components/TtyChat'
import { UpdateModal } from './components/UpdateModal'
import { InstallModal } from './components/InstallModal'
import { ArchiveConsentModal, type ArchiveMode } from './components/ArchiveConsentModal'
import { resolveArchiveChoice } from './lib/archive'
import { TeamLogin } from './components/TeamLogin'
import { Login } from './components/Login'
import { MemberConnectionStatus } from './components/MemberConnectionStatus'
import { OwnerSetup } from './components/OwnerSetup'
import { ChangePassword } from './components/ChangePassword'
import { type ChatModelId } from './lib/chatModels'
import { HARNESS_LABELS } from './lib/harness'
import { format, parseISO, parse } from 'date-fns'

// ── Team session state ────────────────────────────────────────────────────
interface TeamSessionState {
  required: boolean
  authed: boolean
  /** true when the server is running in central (hub) mode */
  central?: boolean
  /** true when a central has NO local harness data (pure aggregator) — hide local-only UI
   *  (archive consent gate, Nay chat) that only makes sense with a local harness installed. */
  aggregatorOnly?: boolean
}

export interface IamAccount { id: string; name: string; email: string; role: 'owner' | 'member'; memberships: { teamId: string; role: 'manager' | 'user' }[]; mustChangePassword: boolean }
interface IamState { needsBootstrap: boolean; authed: boolean; account?: IamAccount }

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

function MobileBottomNav({
  lang, harnesses, onRefresh, liveUpdates, onToggleLive, updateInterval, healthIssues, isCentral, hasWorkflows,
}: {
  lang: Lang
  harnesses?: HarnessId[]
  onRefresh: () => void
  liveUpdates: boolean
  onToggleLive: () => void
  updateInterval: number
  healthIssues?: HealthIssue[]
  /** A central updates in real time via SSE — no Live toggle. */
  isCentral?: boolean
  hasWorkflows?: boolean
}) {
  const location = useLocation()
  const navigate = useNavigate()
  const pt = lang === 'pt'
  const [moreOpen, setMoreOpen] = useState(false)
  const orange = 'var(--anthropic-orange)'

  // Primary destinations live in the bar; the rest go behind a "More" sheet so
  // the bar never crams more than 5 slots on a narrow phone.
  const primary = [
    { to: '/',         labelPt: 'Home',       labelEn: 'Home',      icon: Home },
    { to: '/costs',    labelPt: 'Custos',     labelEn: 'Costs',     icon: DollarSign },
    { to: '/projects', labelPt: 'Projetos',   labelEn: 'Projects',  icon: FolderOpen },
    { to: '/tools',    labelPt: 'Tools',      labelEn: 'Tools',     icon: Wrench },
  ] as const

  // Square tiles in the "More" sheet: nav destinations + the actions that used
  // to crowd the top header (settings, live toggle, refresh, warnings).
  type Tile = {
    key: string
    label: string
    icon: typeof Home
    onClick: () => void
    active?: boolean
    accent?: boolean
    badge?: string
  }
  const navTiles: Tile[] = [
    { key: 'sessions', label: pt ? 'Sessões' : 'Sessions', icon: Clock, onClick: () => { setMoreOpen(false); navigate('/sessions') }, active: location.pathname.startsWith('/sessions') },
    { key: 'repositories', label: pt ? 'Repositórios' : 'Repositories', icon: GitBranch, onClick: () => { setMoreOpen(false); navigate('/repositories') }, active: location.pathname.startsWith('/repositories') || location.pathname.startsWith('/repo') },
    { key: 'custom', label: pt ? 'Personalizado' : 'Custom', icon: Layers, onClick: () => { setMoreOpen(false); navigate('/custom') }, active: location.pathname.startsWith('/custom') },
    { key: 'export', label: pt ? 'Exportar' : 'Export', icon: FileDown, onClick: () => { setMoreOpen(false); navigate('/export') }, active: location.pathname.startsWith('/export') },
    ...(harnesses && harnesses.length > 1
      ? [{ key: 'compare', label: pt ? 'Comparar' : 'Compare', icon: GitCompare, onClick: () => { setMoreOpen(false); navigate('/compare') }, active: location.pathname.startsWith('/compare') } as Tile]
      : []),
  ]
  const activeIssueCount = healthIssues?.length ?? 0
  const actionTiles: Tile[] = [
    // Live toggle — hidden on a central (real-time via SSE, nothing to toggle).
    ...(isCentral ? [] : [{
      key: 'live', label: pt ? 'Ao vivo' : 'Live', icon: Activity,
      onClick: () => onToggleLive(), accent: liveUpdates,
      badge: liveUpdates ? (updateInterval >= 60 ? `${updateInterval / 60}m` : `${updateInterval}s`) : undefined,
    } as Tile]),
    { key: 'refresh', label: pt ? 'Atualizar' : 'Refresh', icon: RefreshCw, onClick: () => { onRefresh(); setMoreOpen(false) } },
    { key: 'settings', label: pt ? 'Ajustes' : 'Settings', icon: SlidersHorizontal, onClick: () => { setMoreOpen(false); navigate('/settings') }, active: location.pathname.startsWith('/settings') },
    // Health warnings moved next to the notification bell in the mobile top bar (its own popover).
  ]
  const allTiles = [...navTiles, ...actionTiles]

  const navAction = navTiles.some(t => t.active)

  const itemStyle = (active: boolean): React.CSSProperties => ({
    flex: 1,
    minWidth: 0,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3,
    textDecoration: 'none',
    color: active ? orange : 'var(--text-tertiary)',
    fontSize: 10,
    fontWeight: active ? 700 : 500,
    transition: 'color 0.15s',
    padding: '6px 2px',
    overflow: 'hidden',
    background: 'transparent',
    border: 'none',
    cursor: 'pointer',
    fontFamily: 'inherit',
  })

  const labelStyle: React.CSSProperties = {
    width: '100%', textAlign: 'center', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
  }

  return (
    <>
      {/* "More" bottom sheet — square tiles for bigger, friendlier tap targets */}
      <div
        onClick={() => setMoreOpen(false)}
        style={{
          position: 'fixed', inset: 0, zIndex: 310, background: 'rgba(0,0,0,0.45)',
          opacity: moreOpen ? 1 : 0,
          pointerEvents: moreOpen ? 'auto' : 'none',
          transition: 'opacity 0.25s ease',
        }}
      />
      <div style={{
        position: 'fixed', left: 0, right: 0, bottom: 56, zIndex: 320,
        background: 'var(--bg-surface)', borderTop: '1px solid var(--border)',
        borderRadius: '16px 16px 0 0', boxShadow: '0 -8px 30px rgba(0,0,0,0.35)',
        padding: '8px 12px 16px',
        transform: moreOpen ? 'translateY(0)' : 'translateY(110%)',
        transition: 'transform 0.28s cubic-bezier(0.22, 1, 0.36, 1)',
      }}>
        <div style={{
          width: 36, height: 4, borderRadius: 2, background: 'var(--border)',
          margin: '4px auto 12px',
        }} />
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(3, 1fr)',
          gap: 8,
        }}>
          {allTiles.map(tile => {
            const Icon = tile.icon
            const lit = tile.active || tile.accent
            return (
              <button
                key={tile.key}
                onClick={tile.onClick}
                style={{
                  position: 'relative',
                  display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                  gap: 6, padding: '11px 4px',
                  borderRadius: 12,
                  border: `1px solid ${lit ? orange : 'var(--border)'}`,
                  background: lit ? 'var(--anthropic-orange-dim)' : 'var(--bg-elevated)',
                  color: lit ? orange : 'var(--text-primary)',
                  cursor: 'pointer', fontFamily: 'inherit',
                  fontSize: 11, fontWeight: 600,
                  transition: 'all 0.15s',
                }}
              >
                <Icon size={19} strokeWidth={1.8} />
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '100%' }}>{tile.label}</span>
                {tile.badge && (
                  <span style={{
                    position: 'absolute', top: 4, right: 5,
                    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                    minWidth: 15, height: 15, padding: '0 4px', borderRadius: 8,
                    background: orange, color: '#fff', fontSize: 9, fontWeight: 700,
                  }}>
                    {tile.badge}
                  </span>
                )}
              </button>
            )
          })}
        </div>
      </div>

      <nav
        className="mobile-bottom-nav"
        style={{
          position: 'fixed',
          bottom: 0,
          left: 0,
          right: 0,
          zIndex: 330,
          background: 'var(--bg-surface)',
          borderTop: '1px solid var(--border)',
          display: 'flex',
          alignItems: 'stretch',
          height: 56,
        }}
      >
        {primary.map(tab => {
          const active = tab.to === '/'
            ? location.pathname === '/'
            : location.pathname.startsWith(tab.to)
          const Icon = tab.icon
          return (
            <NavLink
              key={tab.to}
              to={tab.to}
              end={tab.to === '/'}
              onClick={() => setMoreOpen(false)}
              style={itemStyle(active)}
            >
              <Icon size={18} />
              <span style={labelStyle}>{pt ? tab.labelPt : tab.labelEn}</span>
            </NavLink>
          )
        })}
        <button onClick={() => setMoreOpen(v => !v)} style={itemStyle(navAction || moreOpen)}>
          <div style={{ position: 'relative' }}>
            <MoreHorizontal size={18} />
          </div>
          <span style={labelStyle}>{pt ? 'Mais' : 'More'}</span>
        </button>
      </nav>
    </>
  )
}

const SIDEBAR_W = 248
const SIDEBAR_W_COLLAPSED = 64

/** Themed hover tooltip for the collapsed sidebar (icons only). Renders via a portal so it
 *  escapes the sidebar's overflow clipping. Active only when `show` is true (i.e. collapsed);
 *  when expanded the label is already visible, so it just renders its child untouched. */
function CollapsedTip({ label, show, children }: { label: string; show: boolean; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null)
  if (!show) return <>{children}</>
  return (
    <div
      ref={ref}
      style={{ position: 'relative' }}
      onMouseEnter={() => { const r = ref.current?.getBoundingClientRect(); if (r) setPos({ top: r.top + r.height / 2, left: r.right + 10 }) }}
      onMouseLeave={() => setPos(null)}
    >
      {children}
      {pos && createPortal(
        <div role="tooltip" style={{
          position: 'fixed', top: pos.top, left: pos.left, transform: 'translateY(-50%)',
          background: 'var(--bg-card)', color: 'var(--text-primary)',
          border: '1px solid var(--border)', borderRadius: 7, padding: '5px 10px',
          fontSize: 12, fontWeight: 600, whiteSpace: 'nowrap',
          boxShadow: '0 6px 20px rgba(0,0,0,0.35)', zIndex: 500, pointerEvents: 'none',
        }}>{label}</div>,
        document.body,
      )}
    </div>
  )
}

function SideNav({ lang, harnesses, isCentral, hasWorkflows, collapsed, onToggle, theme, onToggleTheme, onToggleLang, onExport, principal }: {
  lang: Lang; harnesses?: HarnessId[]; isCentral?: boolean; hasWorkflows?: boolean
  collapsed: boolean; onToggle: () => void
  theme: Theme; onToggleTheme: () => void; onToggleLang: () => void; onExport: () => void
  principal?: IamAccount
}) {
  const location = useLocation()
  const pt = lang === 'pt'
  // Repositories highlights across the whole section (list, detail, actions) — Actions lives as a
  // tab inside each repo, so there's no sidebar submenu.
  const inReposSection = location.pathname.startsWith('/repositories') || location.pathname.startsWith('/repo')
  const items: { to: string; labelPt: string; labelEn: string; icon: React.ReactNode }[] = [
    { to: '/',          labelPt: 'Home',         labelEn: 'Home',         icon: <Home size={17} /> },
    { to: '/sessions', labelPt: 'Sessões', labelEn: 'Sessions', icon: <Clock size={17} /> },
    { to: '/costs',     labelPt: 'Custos',       labelEn: 'Costs',        icon: <DollarSign size={17} /> },
    { to: '/projects',  labelPt: 'Projetos',     labelEn: 'Projects',     icon: <FolderOpen size={17} /> },
    { to: '/repositories', labelPt: 'Repositórios', labelEn: 'Repositories', icon: <GitBranch size={17} /> },
    { to: '/tools',     labelPt: 'Ferramentas',  labelEn: 'Tools',        icon: <Wrench size={17} /> },
    { to: '/custom',    labelPt: 'Personalizado',labelEn: 'Custom',       icon: <Layers size={17} /> },
    ...(harnesses && harnesses.length > 1 ? [{ to: '/compare', labelPt: 'Comparar', labelEn: 'Compare', icon: <GitCompare size={17} /> }] : []),
  ]
  const footBtn: React.CSSProperties = {
    width: 34, height: 34, display: 'flex', alignItems: 'center', justifyContent: 'center',
    borderRadius: 8, border: '1px solid var(--border)', background: 'transparent',
    color: 'var(--text-secondary)', cursor: 'pointer', transition: 'all 0.15s',
  }
  return (
    <aside style={{
      position: 'fixed', top: 0, left: 0, bottom: 0, width: collapsed ? SIDEBAR_W_COLLAPSED : SIDEBAR_W, zIndex: 200,
      background: 'var(--bg-surface)', borderRight: '1px solid var(--border)',
      display: 'flex', flexDirection: 'column', padding: '14px 12px', boxSizing: 'border-box',
      transition: 'width 0.22s cubic-bezier(0.22, 1, 0.36, 1)', overflow: 'hidden',
    }}>
      {/* Logo + collapse toggle */}
      <div style={{ padding: '0 4px 12px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, minHeight: 44 }}>
          {!collapsed && <img src='/minimalistLogo.png' alt="agentistics" style={{ height: 40, width: 'auto', flexShrink: 0 }} />}
          <button onClick={onToggle} title={collapsed ? (pt ? 'Expandir' : 'Expand') : (pt ? 'Recolher' : 'Collapse')}
            style={{ ...footBtn, marginLeft: 'auto', width: 30, height: 30 }}>
            {collapsed ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
          </button>
        </div>
        {/* Member machine: live connection status + latency to the central (mirrors the
            central's presence line). Renders null unless this instance is a connected member. */}
        {!collapsed && !isCentral && <div style={{ marginTop: 6 }}><MemberConnectionStatus lang={lang} compact /></div>}
      </div>

      <nav className="ag-noscroll" style={{ display: 'flex', flexDirection: 'column', gap: 3, overflowY: 'auto', overflowX: 'hidden', flex: 1 }}>
        {items.map(item => {
          const active = item.to === '/'
            ? location.pathname === '/'
            : item.to === '/repositories'
              ? inReposSection
              : location.pathname.startsWith(item.to)
          const label = pt ? item.labelPt : item.labelEn
          return (
            <CollapsedTip key={item.to} label={label} show={collapsed}>
              <NavLink
                to={item.to}
                end={item.to === '/'}
                aria-label={collapsed ? label : undefined}
                style={{
                  display: 'flex', alignItems: 'center', gap: 11, minWidth: 0,
                  padding: collapsed ? '10px 0' : '10px 12px', justifyContent: collapsed ? 'center' : 'flex-start',
                  borderRadius: 9, textDecoration: 'none',
                  fontSize: 13.5, fontWeight: active ? 700 : 500, fontFamily: 'inherit', whiteSpace: 'nowrap',
                  color: active ? 'var(--anthropic-orange)' : 'var(--text-secondary)',
                  background: active ? 'var(--anthropic-orange-dim)' : 'transparent',
                  transition: 'background 0.15s, color 0.15s',
                }}
                onMouseEnter={e => { if (!active) { const t = e.currentTarget as HTMLAnchorElement; t.style.color = 'var(--text-primary)'; t.style.background = 'var(--bg-elevated)' } }}
                onMouseLeave={e => { if (!active) { const t = e.currentTarget as HTMLAnchorElement; t.style.color = 'var(--text-secondary)'; t.style.background = 'transparent' } }}
              >
                <span style={{ flexShrink: 0, display: 'flex' }}>{item.icon}</span>
                {!collapsed && label}
              </NavLink>
            </CollapsedTip>
          )
        })}
      </nav>

      {/* Footer — Row A account · thin divider · Row B config actions */}
      <div style={{ paddingTop: 10, marginTop: 6, borderTop: '1px solid var(--border)' }}>
        {/* Row A — account (avatar + name + role, logout right-aligned) */}
        {principal && (collapsed ? (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, paddingBottom: 10 }}>
            <div title={principal.name} style={{ width: 30, height: 30, borderRadius: '50%', background: 'var(--bg-elevated)', border: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase', flexShrink: 0 }}>{principal.name.slice(0, 2)}</div>
            <CollapsedTip label={pt ? 'Sair' : 'Log out'} show>
              <button title={pt ? 'Sair' : 'Log out'} aria-label={pt ? 'Sair' : 'Log out'} onClick={() => { void fetch('/api/iam/logout', { method: 'POST' }).then(() => window.location.reload()) }} style={footBtn}
                onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.color = 'var(--text-primary)' }}
                onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.color = 'var(--text-secondary)' }}>
                <LogOut size={15} />
              </button>
            </CollapsedTip>
          </div>
        ) : (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '2px 2px 10px', minWidth: 0 }}>
            <div style={{ width: 30, height: 30, borderRadius: '50%', background: 'var(--bg-elevated)', border: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11.5, fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase', flexShrink: 0 }}>{principal.name.slice(0, 2)}</div>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{principal.name}</div>
              <div style={{ fontSize: 10, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{principal.role === 'owner' ? 'Owner' : (principal.memberships.some(m => m.role === 'manager') ? 'Manager' : 'User')}</div>
            </div>
            <button title={pt ? 'Sair' : 'Log out'} aria-label={pt ? 'Sair' : 'Log out'} onClick={() => { void fetch('/api/iam/logout', { method: 'POST' }).then(() => window.location.reload()) }}
              style={{ display: 'inline-flex', padding: 7, borderRadius: 8, border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-tertiary)', cursor: 'pointer', flexShrink: 0, transition: 'color 0.15s' }}
              onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.color = 'var(--text-primary)' }}
              onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.color = 'var(--text-tertiary)' }}>
              <LogOut size={15} />
            </button>
          </div>
        ))}

        {/* Thin divider between account and actions */}
        {principal && <div style={{ height: 1, background: 'var(--border)', marginBottom: 10 }} />}

        {/* Row B — config actions (theme · language · export · settings), evenly spaced */}
        <div style={{ display: 'flex', flexDirection: collapsed ? 'column' : 'row', alignItems: 'center', gap: 6 }}>
          <CollapsedTip label={pt ? 'Tema' : 'Theme'} show={collapsed}>
            <button onClick={onToggleTheme} aria-label={pt ? 'Tema' : 'Theme'} title={collapsed ? undefined : (theme === 'dark' ? (pt ? 'Tema claro' : 'Light theme') : (pt ? 'Tema escuro' : 'Dark theme'))} style={{ ...footBtn, width: collapsed ? 34 : 'auto', flex: collapsed ? undefined : 1 }}
              onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.color = 'var(--text-primary)' }}
              onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.color = 'var(--text-secondary)' }}>
              {theme === 'dark' ? <Sun size={15} /> : <Moon size={15} />}
            </button>
          </CollapsedTip>
          <CollapsedTip label={pt ? 'Idioma' : 'Language'} show={collapsed}>
            <button onClick={onToggleLang} aria-label={pt ? 'Idioma' : 'Language'} title={collapsed ? undefined : (pt ? 'Switch to English' : 'Mudar para Português')} style={{ ...footBtn, width: collapsed ? 34 : 'auto', flex: collapsed ? undefined : 1, gap: 5, fontSize: 12, fontWeight: 600, fontFamily: 'inherit' }}
              onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.color = 'var(--text-primary)' }}
              onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.color = 'var(--text-secondary)' }}>
              <Globe size={14} />{!collapsed && (pt ? 'EN' : 'PT')}
            </button>
          </CollapsedTip>
          <CollapsedTip label={pt ? 'Exportar' : 'Export'} show={collapsed}>
            <button onClick={onExport} aria-label={pt ? 'Exportar relatório PDF' : 'Export PDF report'} title={collapsed ? undefined : (pt ? 'Exportar relatório PDF' : 'Export PDF report')}
              style={{ ...footBtn, width: collapsed ? 34 : 'auto', flex: collapsed ? undefined : 1, borderColor: 'var(--anthropic-orange)50', color: 'var(--anthropic-orange)', background: 'var(--anthropic-orange-dim)' }}>
              <Download size={15} />
            </button>
          </CollapsedTip>
          <CollapsedTip label={pt ? 'Configurações' : 'Settings'} show={collapsed}>
            <NavLink to="/settings" aria-label={pt ? 'Configurações' : 'Settings'} title={collapsed ? undefined : (pt ? 'Configurações' : 'Settings')} style={{ ...footBtn, width: collapsed ? 34 : 'auto', flex: collapsed ? undefined : 1, textDecoration: 'none' }}
              onMouseEnter={e => { (e.currentTarget as HTMLAnchorElement).style.color = 'var(--text-primary)' }}
              onMouseLeave={e => { (e.currentTarget as HTMLAnchorElement).style.color = 'var(--text-secondary)' }}>
              <SlidersHorizontal size={15} />
            </NavLink>
          </CollapsedTip>
        </div>
      </div>
    </aside>
  )
}

export default function AppLayout() {
  const location = useLocation()
  const navigate = useNavigate()
  // Reset scroll to the top on every route change — otherwise navigating away while scrolled to the
  // bottom of a page lands the next page still scrolled down.
  useEffect(() => { window.scrollTo(0, 0) }, [location.pathname])
  const isCustomPage = location.pathname === '/custom'
  const isMobile = useIsMobile()
  const { data, loading, loadProgress, error, refetch, liveUpdates, setLiveUpdates, updateInterval, setUpdateInterval } = useData()
  const [riskyMode, setRiskyMode] = useState(false)
  const [lang, setLangState] = useState<Lang>('en')

  // ── Team session gate ────────────────────────────────────────────────────
  // undefined = not yet fetched, TeamSessionState after fetch
  const [teamSession, setTeamSession] = useState<TeamSessionState | undefined>(undefined)
  // true when this instance is a team member pushing to a central (mode === 'member').
  // Used only to tailor the upgrade command shown in the UpdateModal.
  const [isMember, setIsMember] = useState(false)

  // ── IAM gate (central only) ────────────────────────────────────────────────────
  const [iam, setIam] = useState<IamState | undefined>(undefined)
  const reloadIam = useCallback(() => {
    Promise.all([
      fetch('/api/iam/status').then(r => r.ok ? r.json() : { needsBootstrap: false }),
      fetch('/api/iam/me').then(r => r.ok ? r.json() : { authed: false }),
    ]).then(([st, me]) => setIam({ needsBootstrap: !!st.needsBootstrap, authed: !!me.authed, account: me.account }))
      .catch(() => setIam({ needsBootstrap: false, authed: false }))
  }, [])
  useEffect(() => { if (teamSession?.central) reloadIam() }, [teamSession?.central, reloadIam])

  useEffect(() => {
    fetch('/api/team/session')
      .then(r => r.ok ? (r.json() as Promise<TeamSessionState>) : null)
      .then(s => setTeamSession(s ?? { required: false, authed: true }))
      .catch(() => setTeamSession({ required: false, authed: true }))
  }, [])

  useEffect(() => {
    fetch('/api/team/status')
      .then(r => r.ok ? (r.json() as Promise<{ mode?: string }>) : null)
      .then(s => setIsMember(s?.mode === 'member'))
      .catch(() => {})
  }, [])

  // Flip to login screen when any API call returns 401 (team password set but cookie expired)
  useEffect(() => {
    if (error && error.includes('401') && teamSession?.required) {
      setTeamSession({ required: true, authed: false })
    }
    if (teamSession?.central && String(error).includes('401')) reloadIam()
  }, [error, teamSession?.required, teamSession?.central, reloadIam])
  const [theme, setThemeState] = useState<Theme>('dark')
  const [currency, setCurrencyState] = useState<'USD' | 'BRL'>('USD')

  // Surface server-pushed notifications (member connection/auth errors) as toasts + bell.
  useNotificationStream(lang)

  // A central updates in real time via SSE (presence + ingest), so it hides the Live toggle
  // and keeps live updates always on (the SSE 'change' subscription is gated on liveUpdates).
  const isCentral = teamSession?.central === true
  useEffect(() => { if (isCentral) setLiveUpdates(true) }, [isCentral, setLiveUpdates])

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
  const [pdfDirectExportRange, setPdfDirectExportRange] = useState<string | null>(null)
  const [expandedChart, setExpandedChart] = useState<string | null>(null)
  const [selectedSession, setSelectedSession] = useState<import('@agentistics/core').SessionMeta | null>(null)

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
  // Merges a saved card order with the default, inserting new cards at their default position.
  function mergeCardOrder(saved: string[]): CardId[] {
    const savedSet = new Set(saved)
    const merged = saved.filter(id => DEFAULT_CARD_ORDER.includes(id as CardId)) as CardId[]
    for (let i = 0; i < DEFAULT_CARD_ORDER.length; i++) {
      const id = DEFAULT_CARD_ORDER[i]!
      if (savedSet.has(id)) continue
      let insertPos = merged.length
      for (let j = i - 1; j >= 0; j--) {
        const pred = DEFAULT_CARD_ORDER[j]!
        const predIdx = merged.indexOf(pred)
        if (predIdx >= 0) { insertPos = predIdx + 1; break }
      }
      merged.splice(insertPos, 0, id)
    }
    return merged
  }
  const [cardOrder, setCardOrder] = useState<CardId[]>(() => {
    try {
      const saved = localStorage.getItem('claude-stats-card-order')
      if (saved) return mergeCardOrder(JSON.parse(saved))
    } catch {}
    return DEFAULT_CARD_ORDER
  })
  // Mobile-only: lets the user minimize the sticky filter bar while scrolling so
  // it doesn't eat the viewport on small screens. Expanded by default.
  const [filtersCollapsed, setFiltersCollapsed] = useState(false)
  const [sidebarCollapsed, setSidebarCollapsed] = useState<boolean>(() => {
    try { return localStorage.getItem('agentistics-sidebar-collapsed') === '1' } catch { return false }
  })
  const toggleSidebar = useCallback(() => setSidebarCollapsed(v => {
    const next = !v
    try { localStorage.setItem('agentistics-sidebar-collapsed', next ? '1' : '0') } catch { /* ignore */ }
    return next
  }), [])
  // The collapse animation needs `overflow: hidden` to clip the sliding panel,
  // but that also clips the Models dropdown popover. Keep it clipped only while
  // animating/collapsed; once an expand transition finishes, switch to visible
  // so the popover can overflow the header.
  const [filtersClip, setFiltersClip] = useState(false)
  const collapseFilters = () => { setFiltersClip(true); setFiltersCollapsed(true) }
  const expandFilters = () => { setFiltersClip(true); setFiltersCollapsed(false) }
  const [updateInfo, setUpdateInfo] = useState<{ current: string; latest: string } | null>(null)
  // First-run archive consent gate: undefined = prefs not loaded, null = loaded but
  // not yet chosen (blocks the app), ArchiveMode = chosen.
  const [archiveChoice, setArchiveChoice] = useState<ArchiveMode | null | undefined>(undefined)
  const chooseArchive = useCallback((mode: ArchiveMode) => {
    setArchiveChoice(mode)
    fetch('/api/preferences', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ archiveMode: mode }),
    })
      .then(() => refetch())
      .catch(() => {})
  }, [refetch])

  type PwaPrompt = Event & { prompt(): Promise<void>; userChoice: Promise<{ outcome: string }> }
  const [pwaPrompt, setPwaPrompt] = useState<PwaPrompt | null>(null)
  // Treat the Tauri desktop app as "already installed" — it must never show the
  // PWA install prompt (it IS the app). Tauri v2 exposes these globals.
  const isTauri = typeof window !== 'undefined' &&
    ('__TAURI_INTERNALS__' in window || '__TAURI__' in window)
  const [pwaInstalled, setPwaInstalled] = useState(() =>
    isTauri || (typeof window !== 'undefined' && window.matchMedia('(display-mode: standalone)').matches)
  )
  useEffect(() => {
    const handler = (e: Event) => { e.preventDefault(); setPwaPrompt(e as PwaPrompt) }
    window.addEventListener('beforeinstallprompt', handler)
    // If the user installs, the appinstalled event fires
    const onInstalled = () => { setPwaInstalled(true); setPwaPrompt(null) }
    window.addEventListener('appinstalled', onInstalled)
    return () => {
      window.removeEventListener('beforeinstallprompt', handler)
      window.removeEventListener('appinstalled', onInstalled)
    }
  }, [])

  const INSTALL_DISMISSED_KEY = 'agentistics-install-dismissed'
  const [showInstallModal, setShowInstallModal] = useState(false)
  // Dismissal is persisted SERVER-SIDE (survives incognito, where localStorage is wiped).
  // undefined = prefs not loaded yet → don't show until we know; true = don't show.
  const [installDismissedPref, setInstallDismissedPref] = useState<boolean | undefined>(undefined)
  const installModalShownRef = React.useRef(false)
  // Show install modal once after first data load, unless dismissed or already installed
  useEffect(() => {
    if (installModalShownRef.current) return
    // A central is a server, not an end-user machine — never prompt to install the app there
    // (and its prefs are ephemeral/read-only in Docker, so a dismiss wouldn't persist anyway).
    if (isCentral) return
    if (!data || loading) return
    if (pwaInstalled) return
    if (installDismissedPref === undefined) return // wait for prefs to load
    if (installDismissedPref) return
    try { if (localStorage.getItem(INSTALL_DISMISSED_KEY) === 'true') return } catch {}
    installModalShownRef.current = true
    setShowInstallModal(true)
  }, [data, loading, pwaInstalled, installDismissedPref, isCentral])
  const [chatModel, setChatModel] = useState<ChatModelId | null>(null)
  const [chatSoundEnabled, setChatSoundEnabled] = useState(true)
  const [chatSoundId, setChatSoundId] = useState('ping')

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

  // Persist a full preferences draft — applies to global state + PUTs /api/preferences.
  // Threaded to the Preferences settings page (and reused by the legacy Settings modal onSave).
  const savePreferences = useCallback((draft: PrefsDraft) => {
    setLangState(draft.lang)
    setThemeState(draft.theme)
    setCurrencyState(draft.currency)
    setCardOrder(draft.cardOrder as CardId[])
    setCardPrecisionState(draft.cardPrecision)
    if (draft.chatModel) setChatModel(draft.chatModel)
    setChatSoundEnabled(draft.chatSoundEnabled)
    setChatSoundId(draft.chatSoundId)
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
        chatSoundId: draft.chatSoundId,
      }),
    }).catch(() => {})
  }, [setCardOrder])
  const [scrolled, setScrolled] = useState(false)
  const [highlightUpdates, setHighlightUpdates] = useState(true)
  const highlightUpdatesRef = useRef(true)
  const flashTimersRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({})
  const prevDerivedFingerprintRef = useRef<Record<string, string>>({})
  const liveFlashFirstRunRef = useRef(true)

  useEffect(() => {
    // Load preferences resiliently. CRITICAL: a failed load (network hiccup, 5xx, server
    // still booting) must NEVER be collapsed into the "not chosen yet" sentinel — doing so
    // re-shows the first-run archive gate AND the install prompt on every transient failure,
    // even though the user already chose. `archiveChoice === null` means "genuinely unset";
    // only a real 200 response with no archiveMode may set it. On failure we retry with
    // backoff and leave state at `undefined` (neutral loading bg) so nothing false-gates.
    let cancelled = false
    const apply = (prefs: { cardPrecision?: Record<string, boolean>; lang?: Lang; theme?: Theme; currency?: 'USD' | 'BRL'; cardOrder?: string[]; chatModel?: string; chatSoundEnabled?: boolean; archiveMode?: ArchiveMode; archiveSessions?: boolean; installDismissed?: boolean }) => {
      if (prefs.cardPrecision) setCardPrecisionState(prefs.cardPrecision)
      if (prefs.lang) setLangState(prefs.lang)
      if (prefs.theme) setThemeState(prefs.theme)
      if (prefs.currency) setCurrencyState(prefs.currency)
      if (prefs.cardOrder) setCardOrder(mergeCardOrder(prefs.cardOrder))
      if (prefs.chatModel) setChatModel(prefs.chatModel as ChatModelId)
      if (prefs.chatSoundEnabled !== undefined) setChatSoundEnabled(prefs.chatSoundEnabled)
      setInstallDismissedPref(prefs.installDismissed === true)
      if ((prefs as Record<string, unknown>).chatSoundId) setChatSoundId((prefs as Record<string, unknown>).chatSoundId as string)
      // Resolve the archive mode (migrates the legacy archiveSessions boolean). Only reached on
      // a successful load — a failed fetch is retried in `load`, never funneled through here.
      setArchiveChoice(resolveArchiveChoice(prefs))
    }
    const load = async (attempt = 0) => {
      try {
        const r = await fetch('/api/preferences')
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        const prefs = await r.json()
        if (!cancelled) apply(prefs)
      } catch {
        if (cancelled) return
        // Keep archiveChoice/installDismissedPref at their loading values and retry with
        // capped backoff, so a transient failure never wipes the user's saved choice.
        const delay = Math.min(1000 * 2 ** attempt, 15000)
        setTimeout(() => { if (!cancelled) void load(attempt + 1) }, delay)
      }
    }
    void load()
    return () => { cancelled = true }
  }, [])

  // Tracks which latest version we've already surfaced as a toast/bell notification,
  // so re-renders (or an SSE re-check for the same version) don't re-push it.
  const notifiedVersionRef = useRef<string | null>(null)
  useEffect(() => {
    fetch('/api/version')
      .then(r => r.ok ? r.json() : null)
      .then((info: { current: string; latest: string; hasUpdate: boolean } | null) => {
        if (info?.hasUpdate) {
          setUpdateInfo({ current: info.current, latest: info.latest })
          // Also surface it in the toast + bell (once per detected version).
          if (notifiedVersionRef.current !== info.latest) {
            notifiedVersionRef.current = info.latest
            pushNotification({ type: 'info', code: 'app.update_available', meta: { version: info.latest } })
          }
        }
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
      set.add(id)
    }
    for (const s of data.sessions) {
      if (s.model) set.add(s.model)
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

  // Models grouped by the harness that actually used them (NOT by prefix — Copilot
  // also uses gpt-* models). When a harness filter is active, only that harness's
  // models are offered; in the unified view all harnesses are shown as sections.
  const modelGroups = useMemo<{ harness: HarnessId; models: string[] }[]>(() => {
    if (!data) return []
    const order: HarnessId[] = ['claude', 'codex', 'gemini', 'copilot']
    const byH: Partial<Record<HarnessId, Set<string>>> = {}
    const add = (h: HarnessId, m?: string) => { if (!m) return; (byH[h] ??= new Set<string>()).add(m) }
    for (const id of Object.keys(data.statsCache.modelUsage ?? {})) add('claude', id)
    for (const s of data.sessions) add((s.harness ?? 'claude') as HarnessId, s.model)
    // When the harness filter is active, only the selected harnesses' models are offered;
    // in the unified view all harnesses are shown as sections.
    const sel = filters.harnesses ?? []
    const harnesses = sel.length > 0 ? order.filter(h => sel.includes(h)) : order
    return harnesses
      .filter(h => byH[h] && byH[h]!.size > 0)
      .map(h => ({ harness: h, models: Array.from(byH[h]!).sort() }))
  }, [data, filters.harnesses])

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

  const users = useMemo(() => (data ? distinctUsers(data.sessions) : []), [data])

  // Central-only: fetch teams and machines for filter dimensions
  const [teamsList, setTeamsList] = useState<{ id: string; name: string }[]>([])
  const [machinesList, setMachinesList] = useState<{ id: string; name: string; user: string; teamId?: string }[]>([])
  useEffect(() => {
    if (!teamSession?.central) {
      setTeamsList([])
      setMachinesList([])
      return
    }
    Promise.all([
      fetch('/api/iam/teams').then(r => r.ok ? r.json() : { teams: [] }),
      fetch('/api/iam/machines').then(r => r.ok ? r.json() : { machines: [] }),
    ]).then(([teamsResp, machinesResp]) => {
      setTeamsList((teamsResp.teams ?? []).map((t: { _id: string; name: string }) => ({ id: t._id, name: t.name })))
      setMachinesList((machinesResp.machines ?? []).map((m: { id: string; machineName: string; user: string; teamId?: string }) => ({ id: m.id, name: m.machineName, user: m.user, teamId: m.teamId })))
    }).catch(() => {
      setTeamsList([])
      setMachinesList([])
    })
  }, [teamSession?.central])

  // Header summary counts (desktop only)
  const memberCount = users.length
  const onlineCount = data?.presence ? Object.values(data.presence).filter(p => p.online).length : 0
  const offlineCount = data?.presence ? Object.values(data.presence).filter(p => !p.online).length : 0
  const machineCount = machinesList.length
  const projectCount = data?.projects?.length ?? 0
  const repoCount = useMemo(() => new Set((data?.sessions ?? []).map(s => s.git_remote).filter(Boolean)).size, [data])

  // Members list = users WITH machines only
  const machineUsers = useMemo(() => new Set(machinesList.map(m => m.user)), [machinesList])
  const usersWithMachines = useMemo(() => users.filter(u => machineUsers.has(u)), [users, machineUsers])

  // Harnesses available in the harness filter, scoped to the SELECTED users (empty = all
  // users). So picking one member narrows the harness options to the harnesses that member
  // actually used; "All members" shows the union. Falls back to all harnesses in the data
  // when the scoped slice is empty (e.g. a selected member has no sessions yet).
  const availableHarnesses = useMemo<HarnessId[]>(() => {
    if (!data) return []
    const scoped = filterByUsers(data.sessions, filters.users ?? [])
    const present = distinctHarnesses(scoped)
    return present.length > 0 ? present : data.harnesses
  }, [data, filters.users])

  // Projects offered in the filter, scoped to the SELECTED users (empty = all users).
  // On a central, filtering by member X should only list X's projects — not everyone's.
  const availableProjects = useMemo(() => {
    if (!data) return []
    const sel = filters.users ?? []
    if (sel.length === 0) return data.projects
    const selSet = new Set(sel)
    // A project is in scope iff at least one of its owning members is selected.
    // Projects carry an explicit `users` tag (built server-side), so this is
    // deterministic — no path re-matching and no fallback that leaks other members' projects.
    return data.projects.filter(p => (p.users ?? []).some(u => selSet.has(u)))
  }, [data, filters.users])

  // Prune any selected project no longer available after a user-selection change.
  useEffect(() => {
    const sel = filters.projects ?? []
    if (sel.length === 0) return
    const allowed = new Set(availableProjects.map(p => p.path))
    const pruned = sel.filter(p => allowed.has(p))
    if (pruned.length !== sel.length) setFilters(f => ({ ...f, projects: pruned }))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [availableProjects])

  // Prune any selected harness that is no longer available after a user-selection change
  // (e.g. selecting a member who never used a previously-selected harness).
  useEffect(() => {
    const sel = filters.harnesses ?? []
    if (sel.length === 0) return
    const allowed = new Set(availableHarnesses)
    const pruned = sel.filter(h => allowed.has(h))
    if (pruned.length !== sel.length) setFilters(f => ({ ...f, harnesses: pruned }))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [availableHarnesses])

  // When exactly one harness is selected, the header mirrors the old per-harness view
  // (derived first/last dates + harness label). With 0 or >1 selected it uses the
  // statsCache (Claude-canonical) dates, matching the unified dashboard.
  const singleHarness: HarnessId | undefined =
    (filters.harnesses?.length === 1) ? filters.harnesses[0] : undefined

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
        source: projectFiltered
          ? pt
            ? 'git log (projeto) → todos os commits desde a primeira sessão'
            : 'git log (project) → all commits since the first session'
          : pt
            ? '~/.claude/projects/**/*.jsonl → comandos git commit/push nas chamadas Bash'
            : '~/.claude/projects/**/*.jsonl → git commit/push commands in Bash tool calls',
        formula: projectFiltered
          ? pt
            ? 'Σ commits do projeto (git log --numstat) para cada projeto filtrado\nΣ git_pushes das sessões (via Bash)'
            : 'Σ project commits (git log --numstat) for each filtered project\nΣ git_pushes from sessions (via Bash)'
          : pt
            ? 'Σ git_commits das sessões no período\nΣ git_pushes das sessões no período'
            : 'Σ git_commits for sessions in the period\nΣ git_pushes for sessions in the period',
        note: projectFiltered
          ? pt
            ? 'Com filtro de projeto ativo, usa git log --numstat diretamente no repositório — inclui todos os commits, mesmo os feitos fora do Claude. Sem filtro de projeto, conta apenas commits executados pelo Claude via ferramenta Bash.'
            : 'With project filter active, reads git log --numstat directly from the repository — includes all commits, even those made outside Claude. Without project filter, only counts commits run by Claude via the Bash tool.'
          : pt
            ? 'Conta apenas commits e pushes executados pelo Claude via ferramenta Bash. Commits feitos manualmente no terminal não são capturados. Ative o filtro de projeto para ver o histórico completo do repositório.'
            : 'Counts only commits and pushes executed by Claude via the Bash tool. Commits made manually in the terminal are not captured. Activate the project filter to see the full repository history.',
      },
      {
        label: pt ? 'Arquivos modificados' : 'Files modified',
        source: projectFiltered
          ? pt
            ? 'git log --numstat (projeto) → todos os arquivos alterados desde a primeira sessão'
            : 'git log --numstat (project) → all files changed since the first session'
          : pt
            ? '~/.claude/projects/**/*.jsonl → git log --numstat por sessão'
            : '~/.claude/projects/**/*.jsonl → git log --numstat per session',
        formula: pt
          ? 'Σ files_modified das sessões filtradas\nΣ lines_added  |  Σ lines_removed'
          : 'Σ files_modified for filtered sessions\nΣ lines_added  |  Σ lines_removed',
        note: projectFiltered
          ? pt
            ? 'Com filtro de projeto ativo, usa git log --numstat diretamente no repositório. Arquivos binários são excluídos (git numstat mostra "-" para binários). Requer que o projeto seja um repositório git.'
            : 'With project filter active, reads git log --numstat directly from the repository. Binary files are excluded (git numstat shows "-" for binaries). Requires the project to be a git repository.'
          : pt
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

  // Team auth gate takes precedence over the data loading/error states below:
  // on a gated central /api/data returns 401 until the operator logs in, so we
  // must resolve the session and show the login screen FIRST — otherwise the
  // expected 401 surfaces as a "failed to load" error and the login never shows.
  if (teamSession === undefined) {
    return <div style={{ minHeight: '100vh', background: 'var(--bg-base)' }} />
  }
  // Central: account-based IAM gate (bootstrap → login → app).
  if (teamSession.central) {
    if (iam === undefined) return <div style={{ minHeight: '100vh', background: 'var(--bg-base)' }} />
    if (iam.needsBootstrap) return <OwnerSetup onDone={() => { reloadIam(); refetch() }} />
    if (!iam.authed) return <Login onAuthed={() => { reloadIam(); refetch() }} />
    if (iam.account?.mustChangePassword) return <ChangePassword onDone={() => { reloadIam(); refetch() }} />
  } else if (teamSession.required && !teamSession.authed) {
    // Non-central (member/solo) keeps the legacy password gate.
    return <TeamLogin onAuthed={() => { setTeamSession(s => ({ ...(s ?? { required: true }), required: true, authed: true })); refetch() }} />
  }

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

  // Count active filters (date / projects / models / harness) for the collapsed-bar badge.
  const harnessFilterActive = /^\/h\//.test(location.pathname)
  const activeFilterCount =
    (filters.dateRange !== 'all' || filters.customStart || filters.customEnd ? 1 : 0) +
    (filters.projects.length > 0 ? 1 : 0) +
    (filters.models.length > 0 ? 1 : 0) +
    (harnessFilterActive ? 1 : 0)

  // Block the app until the user makes the first-run archive choice. While prefs OR the
  // team-session flag are still loading render a neutral background to avoid a flash.
  if (archiveChoice === undefined || teamSession === undefined) {
    return <div style={{ minHeight: '100vh', background: 'var(--bg-base)' }} />
  }
  // A central never shows the archive consent gate: it aggregates members' computed metrics
  // (stored in Mongo) and any self-contributed host data defaults server-side — there's nothing
  // for the operator to consent to here, so the blocking prompt would only annoy.
  if (archiveChoice === null && !teamSession.aggregatorOnly && !isCentral) {
    return (
      <ArchiveConsentModal
        lang={lang}
        onChoose={chooseArchive}
        onLangChange={(l) => {
          setLang(l)
          fetch('/api/preferences', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ lang: l }),
          }).catch(() => {})
        }}
      />
    )
  }

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg-base)', display: 'flex', flexDirection: 'column', paddingLeft: isMobile ? 0 : (sidebarCollapsed ? SIDEBAR_W_COLLAPSED : SIDEBAR_W), transition: 'padding-left 0.22s cubic-bezier(0.22, 1, 0.36, 1)' }}>
      {/* Left sidebar nav — desktop only (mobile uses the bottom nav) */}
      {!isMobile && <SideNav
        lang={lang}
        harnesses={data.harnesses}
        isCentral={isCentral}
        hasWorkflows={(data.workflows?.length ?? 0) > 0}
        collapsed={sidebarCollapsed}
        onToggle={toggleSidebar}
        theme={theme}
        onToggleTheme={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
        onToggleLang={() => { const next = lang === 'pt' ? 'en' : 'pt'; setLang(next); if (next === 'pt') setCurrency('BRL'); else if (currency === 'BRL') setCurrency('USD') }}
        onExport={() => navigate('/export')}
        principal={iam?.account}
      />}
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
        {/* Mobile top bar — logo + bell. On desktop the header is a single row (the filters
            bar below), with the sidebar carrying identity/config and the filters row carrying
            live/alerts, so there are no longer two stacked header rows. */}
        {isMobile && (
          <div style={{
            maxWidth: 1400, margin: '0 auto', padding: '0 16px', height: 48,
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          }}>
            <img src='/minimalistLogo.png' alt="agentistics" style={{ height: 44, width: 'auto' }} />
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              {data?.healthIssues && data.healthIssues.length > 0 && (
                <HealthWarnings issues={data.healthIssues} lang={lang} />
              )}
              <NotificationBell lang={lang} buttonStyle={{
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                width: 32, height: 32, borderRadius: 8,
                border: '1px solid var(--border)', background: 'transparent',
                color: 'var(--text-tertiary)', cursor: 'pointer', position: 'relative',
              }} />
            </div>
          </div>
        )}


        {/* Filters — full bar, fixed in the sticky header so it's reachable at any
            scroll position. Hidden on /custom. On mobile the bar is collapsible
            (a slim summary row) so it doesn't eat the viewport while scrolling;
            the harness chips sit on their own row above the date/projects/models
            controls. Desktop always shows the full bar. */}
        {data && !isCustomPage && isMobile && (
          <div style={{ borderTop: '1px solid var(--border)', width: '100%', boxSizing: 'border-box' }}>
            {/* Collapsed slim row — visible only when minimized; tap to expand. */}
            {filtersCollapsed && (
              <button
                onClick={expandFilters}
                style={{
                  display: 'flex', alignItems: 'center', gap: 8, width: '100%',
                  padding: '9px 14px', background: 'transparent', border: 'none',
                  color: 'var(--text-secondary)', fontFamily: 'inherit', fontSize: 13,
                  fontWeight: 600, cursor: 'pointer',
                }}
              >
                <SlidersHorizontal size={15} style={{ color: 'var(--anthropic-orange)' }} />
                <span>{lang === 'pt' ? 'Filtros' : 'Filters'}</span>
                {activeFilterCount > 0 && (
                  <span style={{
                    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                    minWidth: 18, height: 18, padding: '0 5px', borderRadius: 9,
                    background: 'var(--anthropic-orange)', color: '#fff',
                    fontSize: 11, fontWeight: 700,
                  }}>
                    {activeFilterCount}
                  </span>
                )}
                <ChevronDown size={18} style={{ marginLeft: 'auto', opacity: 0.6 }} />
              </button>
            )}
            {/* Animated panel — collapses via a grid-rows transition so minimize
                and expand both glide instead of snapping. */}
            <div
              style={{
                display: 'grid',
                gridTemplateRows: filtersCollapsed ? '0fr' : '1fr',
                transition: 'grid-template-rows 0.3s cubic-bezier(0.22, 1, 0.36, 1)',
              }}
              onTransitionEnd={() => { if (!filtersCollapsed) setFiltersClip(false) }}
            >
              <div style={{ overflow: (filtersCollapsed || filtersClip) ? 'hidden' : 'visible', minHeight: 0 }}>
                <FiltersBar
                  filters={filters}
                  onChange={setFilters}
                  projects={availableProjects}
                  sessionCountByProject={sessionCountByProject}
                  models={models}
                  modelGroups={modelGroups}
                  modelsInProject={modelsInProject}
                  users={usersWithMachines}
                  harnesses={availableHarnesses}
                  presence={data?.presence}
                  lang={lang}
                  compact
                  teams={teamsList}
                  machines={machinesList}
                />
                {/* Collapse handle */}
                <button
                  onClick={collapseFilters}
                  style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5,
                    width: '100%', padding: '5px 0 7px', background: 'transparent', border: 'none',
                    color: 'var(--text-tertiary)', fontFamily: 'inherit', fontSize: 12,
                    fontWeight: 600, cursor: 'pointer',
                  }}
                >
                  <ChevronUp size={15} />
                  {lang === 'pt' ? 'Minimizar filtros' : 'Minimize filters'}
                </button>
              </div>
            </div>
          </div>
        )}
        {data && !isCustomPage && !isMobile && (
          <div style={{
            maxWidth: 1400, margin: '0 auto', padding: '5px 32px', width: '100%', boxSizing: 'border-box',
            display: 'flex', alignItems: 'flex-start', gap: 14,
          }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <FiltersBar
                filters={filters}
                onChange={setFilters}
                projects={availableProjects}
                sessionCountByProject={sessionCountByProject}
                models={models}
                modelGroups={modelGroups}
                modelsInProject={modelsInProject}
                users={usersWithMachines}
                harnesses={availableHarnesses}
                presence={data?.presence}
                lang={lang}
                summary={(() => {
                  // Updated date: use harness-specific last date when filtering a single non-Claude
                  // harness, otherwise fall back to statsCache (Claude-canonical).
                  const updated = singleHarness && singleHarness !== 'claude'
                    ? (derived.lastSessionDate ? format(derived.lastSessionDate, 'MMM d') : (lang === 'pt' ? 'hoje' : 'today'))
                    : (statsCache.lastComputedDate ? format(parseISO(statsCache.lastComputedDate), 'MMM d') : (lang === 'pt' ? 'hoje' : 'today'))
                  // Since/sessions line (only when firstDate is available)
                  const firstDate = singleHarness ? derived.firstSessionDate : statsCache.firstSessionDate
                  const since = firstDate
                    ? `${lang === 'pt' ? 'Desde' : 'Since'} ${format(singleHarness ? derived.firstSessionDate! : parseISO(statsCache.firstSessionDate!), 'MMM d, yyyy')} · ${derived.allTimeTotalSessions.toLocaleString()} ${lang === 'pt' ? (derived.allTimeTotalSessions === 1 ? 'sessão' : 'sessões') : (derived.allTimeTotalSessions === 1 ? 'session' : 'sessions')}${singleHarness ? ` · ${HARNESS_LABELS[singleHarness]}` : ''}`
                    : undefined
                  return {
                    sessions: derived.totalSessions.toLocaleString(),
                    cost: fmtCost(derived.totalCostUSD, currency, brlRate),
                    tokens: fmt(derived.inputTokens + derived.outputTokens),
                    fleet: {
                      updated,
                      since,
                      members: isCentral ? memberCount : undefined,
                      online: isCentral ? onlineCount : undefined,
                      offline: isCentral ? offlineCount : undefined,
                      machines: isCentral ? machineCount : undefined,
                      projects: projectCount,
                      repos: repoCount,
                      isCentral,
                    },
                  }
                })()}
                teams={teamsList}
                machines={machinesList}
              />
            </div>

            {/* Right cluster: alerts (warnings + notifications), live toggle, refresh —
                consolidated here so the header is a single row. Pinned to the top (flex-start
                on the parent) so it stays in front of the filter controls and doesn't drift
                down when the active-filter chip bar expands below. */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0, paddingTop: 3 }}>
              {data?.healthIssues && data.healthIssues.length > 0 && (
                <HealthWarnings issues={data.healthIssues} lang={lang} />
              )}
              <NotificationBell lang={lang} buttonStyle={{
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                width: 32, height: 32, borderRadius: 8,
                border: '1px solid var(--border)', background: 'transparent',
                color: 'var(--text-tertiary)', cursor: 'pointer', position: 'relative',
              }} />
              {!isCentral && (
                <div style={{
                  display: 'flex', alignItems: 'center', gap: 6, padding: '0 8px 0 10px', height: 32,
                  borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg-secondary)',
                }}>
                  <Activity size={12} style={{ color: liveUpdates ? 'var(--anthropic-orange)' : 'var(--text-tertiary)', flexShrink: 0, transition: 'color 0.2s' }} />
                  <span style={{ fontSize: 11, fontWeight: 500, color: liveUpdates ? 'var(--text-primary)' : 'var(--text-tertiary)', whiteSpace: 'nowrap', userSelect: 'none' }}>Live</span>
                  <button
                    onClick={() => setLiveUpdates(v => !v)}
                    title={liveUpdates ? 'Pause live updates' : 'Enable live updates'}
                    style={{ position: 'relative', width: 28, height: 16, borderRadius: 8, border: 'none', background: liveUpdates ? 'var(--anthropic-orange)' : 'var(--text-tertiary)', cursor: 'pointer', padding: 0, transition: 'background 0.2s', flexShrink: 0 }}
                  >
                    <span style={{ position: 'absolute', top: 2, left: liveUpdates ? 14 : 2, width: 12, height: 12, borderRadius: '50%', background: '#fff', transition: 'left 0.2s', boxShadow: '0 1px 3px rgba(0,0,0,0.3)' }} />
                  </button>
                  {liveUpdates && (
                    <span style={{ fontSize: 10, fontWeight: 700, color: riskyMode && updateInterval < 10 ? '#ef4444' : 'var(--anthropic-orange)', userSelect: 'none' }}>
                      {riskyMode && updateInterval < 10 ? `⚡ ${updateInterval}s` : `${updateInterval >= 60 ? `${updateInterval / 60}m` : `${updateInterval}s`}`}
                    </span>
                  )}
                </div>
              )}
              <button
                onClick={refetch}
                title={lang === 'pt' ? 'Atualizar' : 'Refresh'}
                style={{ width: 32, height: 32, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 8, border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-tertiary)', cursor: 'pointer', transition: 'all 0.15s' }}
                onMouseEnter={e => { const t = e.currentTarget as HTMLButtonElement; t.style.color = 'var(--text-primary)'; t.style.borderColor = 'var(--text-tertiary)' }}
                onMouseLeave={e => { const t = e.currentTarget as HTMLButtonElement; t.style.color = 'var(--text-tertiary)'; t.style.borderColor = 'var(--border)' }}
              >
                <RefreshCw size={14} />
              </button>
            </div>
          </div>
        )}

        {/* Nav moved to the left sidebar (SideNav) on desktop; mobile uses the bottom nav. */}
      </header>

      {/* Main content — routed pages render here via <Outlet /> */}
      <main style={{
        maxWidth: 1400,
        margin: '0 auto',
        width: '100%',
        boxSizing: 'border-box',
        flex: 1,
        // Fill at least the viewport so the footer always sits below the fold (a scroll away),
        // even on short pages — it never floats up into a half-empty screen.
        minHeight: '100vh',
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
          chatModel, chatSoundEnabled, chatSoundId,
          savePreferences,
          pwaPrompt,
          onPwaInstalled: () => { setPwaInstalled(true); setPwaPrompt(null) },
          liveUpdates, setLiveUpdates, updateInterval, setUpdateInterval,
          riskyMode, setRiskyMode, highlightUpdates, setHighlightUpdates,
          monthlyBudgetUSD, updateBudget,
          totalInputTokens, totalOutputTokens,
          setExpandedChart, setSelectedSession, setInfoModalIndex,
          infoItems,
          cardOrder, setCardOrder: setCardOrder as (o: string[]) => void,
          cardPrecision, setCardPrecision,
          sessionCountByProject, models, modelGroups, modelsInProject, users: usersWithMachines,
          harnesses: data.harnesses,
          isCentral,
          me: iam?.account,
          teams: teamsList,
          machines: machinesList,
        }} />
      </main>

      {/* Install Modal — shown once after first data load */}
      {showInstallModal && (
        <InstallModal
          lang={lang}
          pwaPrompt={pwaPrompt}
          onClose={(dontShowAgain) => {
            setShowInstallModal(false)
            if (dontShowAgain) {
              setInstallDismissedPref(true)
              try { localStorage.setItem(INSTALL_DISMISSED_KEY, 'true') } catch {}
              // Persist server-side so it survives incognito windows / a cleared localStorage.
              fetch('/api/preferences', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ installDismissed: true }),
              }).catch(() => {})
            }
          }}
          onPwaInstalled={() => { setPwaInstalled(true); setPwaPrompt(null) }}
        />
      )}

      {/* Update available modal */}
      {updateInfo && (
        <UpdateModal
          current={updateInfo.current}
          latest={updateInfo.latest}
          lang={lang}
          isCentral={isCentral}
          isMember={isMember}
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
          central={teamSession?.central === true}
          workflows={data.workflows}
          onClose={() => setSelectedSession(null)}
        />
      )}

      <TranscriptModal lang={lang} />

      {/* PDF Direct Export — triggered from chat, no modal */}
      {pdfDirectExportRange !== null && (
        <PDFDirectExporter
          data={data}
          range={pdfDirectExportRange}
          currentFilters={filters}
          lang={lang}
          currency={currency}
          brlRate={brlRate}
          onDone={() => setPdfDirectExportRange(null)}
        />
      )}

      {/* Mobile bottom navigation bar */}
      {isMobile && (
        <MobileBottomNav
          lang={lang}
          harnesses={data.harnesses}
            onRefresh={refetch}
          liveUpdates={liveUpdates}
          onToggleLive={() => setLiveUpdates(v => !v)}
          updateInterval={updateInterval}
          healthIssues={data.healthIssues}
          isCentral={isCentral}
          hasWorkflows={(data.workflows?.length ?? 0) > 0}
        />
      )}

      {/* TTY Chat (Nay) — floating button + panel. Hidden on a pure central (aggregator with
          no local harness): the chat needs a locally-installed harness to be meaningful. */}
      {!teamSession?.aggregatorOnly && (
        <TtyChat
          lang={lang}
          chatModel={chatModel}
          chatSoundEnabled={chatSoundEnabled}
          chatSoundId={chatSoundId}
          filters={filters}
          setFilters={setFilters}
          onPdfExport={(range) => setPdfDirectExportRange(range)}
          isMobile={isMobile}
          onModelSet={(model) => {
            setChatModel(model)
            fetch('/api/preferences', {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ chatModel: model }),
            }).catch(() => {})
          }}
        />
      )}

      {/* Footer */}
      <footer style={{
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

      {/* Global notification toasts (auto-dismiss with an exit animation; history in the bell) */}
      <NotificationToasts lang={lang} />
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
