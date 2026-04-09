import React, { useState, useMemo, useEffect, useRef } from 'react'
import {
  MessageSquare, Zap, Clock, Flame, GitCommit,
  Wrench, RefreshCw, FileCode, TrendingUp, BarChart2,
  Sun, Moon, Globe, AlertTriangle, Download, Upload,
  Maximize2, X, GripVertical, Trophy,
} from 'lucide-react'
import { useData, useDerivedStats } from './hooks/useData'
import type { Filters } from './lib/types'
import type { Lang, Theme } from './lib/types'
import { formatProjectName, setHomeDir, MODEL_PRICING } from './lib/types'
import { StatCard } from './components/StatCard'
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
import { format, parseISO, parse } from 'date-fns'

function Section({ title, children, action, onExpand }: {
  title: React.ReactNode
  children: React.ReactNode
  action?: React.ReactNode
  onExpand?: () => void
}) {
  return (
    <div style={{
      background: 'var(--bg-card)',
      border: '1px solid var(--border)',
      borderRadius: 'var(--radius-lg)',
      padding: '20px 22px',
    }}>
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

function fmtCost(usd: number, currency: 'USD' | 'BRL' = 'USD', rate = 1): string {
  if (currency === 'BRL') {
    const brl = usd * rate
    if (brl < 0.05) return '<R$0,05'
    const [intPart, decPart] = brl.toFixed(2).split('.')
    return `R$${intPart.replace(/\B(?=(\d{3})+$)/g, '.')},${decPart}`
  }
  if (usd < 0.01) return '<U$0.01'
  return `U$${usd.toFixed(2)}`
}

export default function App() {
  const { data, loading, error, refetch } = useData()
  const [lang, setLang] = useState<Lang>('en')
  const [theme, setTheme] = useState<Theme>('dark')
  const [currency, setCurrency] = useState<'USD' | 'BRL'>('USD')
  const [brlRate, setBrlRate] = useState(5.70)
  const [filters, setFilters] = useState<Filters>({
    dateRange: 'all',
    customStart: '',
    customEnd: '',
    projects: [],
    model: 'all',
  })
  const [infoModalIndex, setInfoModalIndex] = useState<number | null>(null)
  const [showExportModal, setShowExportModal] = useState(false)
  const [expandedChart, setExpandedChart] = useState<string | null>(null)

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
  const dragCardRef = useRef<CardId | null>(null)
  const [dragOverCard, setDragOverCard] = useState<CardId | null>(null)
  const filtersSentinelRef = useRef<HTMLDivElement>(null)
  const [filtersStuck, setFiltersStuck] = useState(false)

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
  }, [theme])

  useEffect(() => {
    if (data?.homeDir) setHomeDir(data.homeDir)
  }, [data?.homeDir])

  useEffect(() => {
    // Compare against window.scrollY (not getBoundingClientRect) so layout shifts
    // from the sticky bar itself don't cause oscillation.
    const STICKY_TOP = 56   // matches the sticky `top` value
    const HYSTERESIS = 20   // extra scroll-up distance required to unstick
    let rafId: number | null = null
    let stickThreshold: number | null = null

    const computeThreshold = () => {
      const sentinel = filtersSentinelRef.current
      if (!sentinel) return null
      return sentinel.getBoundingClientRect().top + window.scrollY - STICKY_TOP
    }

    const check = () => {
      if (rafId !== null) return
      rafId = requestAnimationFrame(() => {
        rafId = null
        if (stickThreshold === null) {
          stickThreshold = computeThreshold()
          if (stickThreshold === null) return
        }
        const scrollY = window.scrollY
        setFiltersStuck(prev => {
          if (!prev && scrollY >= stickThreshold!) return true
          if (prev && scrollY < stickThreshold! - HYSTERESIS) return false
          return prev
        })
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

  const derived = useDerivedStats(data, filters)

  const models = useMemo(() => {
    if (!data) return []
    return Object.keys(data.statsCache.modelUsage ?? {})
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
        source: '~/.claude/usage-data/session-meta/*.json → git_commits, git_pushes',
        formula: pt
          ? 'Σ git_commits das sessões no período\nΣ git_pushes das sessões no período'
          : 'Σ git_commits for sessions in the period\nΣ git_pushes for sessions in the period',
        note: pt
          ? '⚠ Cobertura parcial: session-meta só existe para ~21% das sessões (Mar–Abr 2026). O valor exibido NÃO representa o total histórico de commits — apenas os capturados durante sessões com meta. O período de cobertura é mostrado no card.'
          : '⚠ Partial coverage: session-meta only exists for ~21% of sessions (Mar–Apr 2026). The value shown does NOT represent the total historical commits — only those captured during sessions with meta files. Coverage period is shown on the card.',
      },
      {
        label: pt ? 'Arquivos modificados' : 'Files modified',
        source: '~/.claude/usage-data/session-meta/*.json → files_modified, lines_added, lines_removed',
        formula: pt
          ? 'Σ files_modified das sessões filtradas\nΣ lines_added  |  Σ lines_removed'
          : 'Σ files_modified for filtered sessions\nΣ lines_added  |  Σ lines_removed',
        note: pt
          ? '⚠ Mesma limitação de cobertura que Commits: dados disponíveis apenas nas sessões com session-meta (Mar–Abr 2026). Não reflete o histórico completo de arquivos modificados.'
          : '⚠ Same coverage limitation as Commits: data only available from sessions with session-meta (Mar–Apr 2026). Does not reflect the full history of modified files.',
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
    return (
      <div style={{
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 20,
      }}>
        <div style={{
          width: 48, height: 48,
          background: 'var(--anthropic-orange-dim)',
          borderRadius: 14,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          animation: 'pulse 1.5s ease-in-out infinite',
        }}>
          <BarChart2 size={24} color="var(--anthropic-orange)" />
        </div>
        <div style={{ color: 'var(--text-secondary)', fontSize: 14 }}>
          {lang === 'pt' ? 'Carregando estatísticas...' : 'Loading your stats...'}
        </div>
        <style>{`@keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.4} }`}</style>
      </div>
    )
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

  const { statsCache } = data

  // Tokens: use model usage totals when available (non-project-filtered), fallback to session-level
  const totalInputTokens = Object.keys(derived.modelUsage).length > 0
    ? Object.values(derived.modelUsage).reduce((s, u) => s + u.inputTokens, 0)
    : derived.inputTokens
  const totalOutputTokens = Object.keys(derived.modelUsage).length > 0
    ? Object.values(derived.modelUsage).reduce((s, u) => s + u.outputTokens, 0)
    : derived.outputTokens

  // ── Drag handlers ─────────────────────────────────────────────────────────────
  function handleDragStart(id: CardId) { dragCardRef.current = id }
  function handleDragOver(e: React.DragEvent, id: CardId) {
    e.preventDefault()
    if (dragCardRef.current !== id) setDragOverCard(id)
  }
  function handleDrop(id: CardId) {
    const from = dragCardRef.current
    if (!from || from === id) { dragCardRef.current = null; setDragOverCard(null); return }
    const newOrder = [...cardOrder]
    const fi = newOrder.indexOf(from)
    const ti = newOrder.indexOf(id)
    newOrder.splice(fi, 1)
    newOrder.splice(ti, 0, from)
    setCardOrder(newOrder)
    localStorage.setItem('claude-stats-card-order', JSON.stringify(newOrder))
    dragCardRef.current = null
    setDragOverCard(null)
  }
  function handleDragEnd() { dragCardRef.current = null; setDragOverCard(null) }

  // ── Card renderer ──────────────────────────────────────────────────────────────
  function renderCard(id: CardId) {
    const isDragging = dragCardRef.current === id
    const isOver = dragOverCard === id
    const wrapperStyle: React.CSSProperties = {
      opacity: isDragging ? 0.35 : 1,
      outline: isOver ? '2px dashed var(--anthropic-orange)' : 'none',
      outlineOffset: -2,
      borderRadius: 'var(--radius-lg)',
      transition: 'opacity 0.15s',
      cursor: 'grab',
      position: 'relative',
      display: 'flex',
      flexDirection: 'column',
    }

    let card: React.ReactNode = null
    if (id === 'messages') {
      card = (
        <StatCard
          label={lang === 'pt' ? 'Mensagens' : 'Messages'}
          value={fmt(derived.totalMessages)}
          sub={lang === 'pt' ? 'no período selecionado' : 'in selected period'}
          icon={<MessageSquare size={15} />}
          accent="var(--anthropic-orange)"
          info={infoItems[0]}
          onInfoClick={() => setInfoModalIndex(0)}
        />
      )
    } else if (id === 'sessions') {
      card = (
        <StatCard
          label={lang === 'pt' ? 'Sessões' : 'Sessions'}
          value={fmt(derived.totalSessions)}
          sub={`avg ${derived.totalSessions > 0 ? Math.round(derived.totalMessages / derived.totalSessions) : 0} msgs/sessão`}
          icon={<Zap size={15} />}
          accent="var(--accent-blue)"
          info={infoItems[1]}
          onInfoClick={() => setInfoModalIndex(1)}
        />
      )
    } else if (id === 'tool-calls') {
      card = (
        <StatCard
          label={lang === 'pt' ? 'Tool calls' : 'Tool calls'}
          value={fmt(derived.totalToolCalls)}
          sub={lang === 'pt' ? 'execuções totais' : 'total executions'}
          icon={<Wrench size={15} />}
          accent="var(--accent-green)"
          info={infoItems[2]}
          onInfoClick={() => setInfoModalIndex(2)}
        />
      )
    } else if (id === 'input-tokens') {
      card = (
        <StatCard
          label={lang === 'pt' ? 'Tokens entrada' : 'Input tokens'}
          value={fmt(totalInputTokens)}
          sub={lang === 'pt' ? 'tokens enviados ao modelo' : 'tokens sent to model'}
          icon={<Download size={15} />}
          accent="var(--accent-blue)"
          info={infoItems[8]}
          onInfoClick={() => setInfoModalIndex(8)}
        />
      )
    } else if (id === 'output-tokens') {
      card = (
        <StatCard
          label={lang === 'pt' ? 'Tokens saída' : 'Output tokens'}
          value={fmt(totalOutputTokens)}
          sub={lang === 'pt' ? 'tokens gerados pelo modelo' : 'tokens generated by model'}
          icon={<Upload size={15} />}
          accent="var(--accent-purple)"
          info={infoItems[9]}
          onInfoClick={() => setInfoModalIndex(9)}
        />
      )
    } else if (id === 'cost') {
      card = (
        <StatCard
          label={lang === 'pt' ? 'Custo estimado' : 'Est. cost'}
          value={fmtCost(derived.totalCostUSD, currency, brlRate)}
          sub={lang === 'pt' ? 'preços da API Anthropic · não é assinatura' : 'Anthropic API pricing · not subscription'}
          icon={<TrendingUp size={15} />}
          accent="var(--anthropic-orange)"
          info={infoItems[5]}
          onInfoClick={() => setInfoModalIndex(5)}
          action={
            <button
              onClick={() => setCurrency(c => c === 'USD' ? 'BRL' : 'USD')}
              style={{
                fontSize: 10, fontWeight: 700,
                padding: '2px 6px', borderRadius: 4,
                border: '1px solid var(--border)',
                background: 'transparent',
                color: 'var(--text-tertiary)',
                cursor: 'pointer', fontFamily: 'inherit',
                transition: 'all 0.15s', letterSpacing: '0.03em',
              }}
              title={currency === 'USD' ? 'Switch to BRL (R$)' : 'Switch to USD (U$)'}
            >
              {currency}
            </button>
          }
        />
      )
    } else if (id === 'streak') {
      card = (
        <StatCard
          label={lang === 'pt' ? 'Sequência' : 'Streak'}
          value={`${derived.streak}d`}
          sub={lang === 'pt' ? 'dias consecutivos' : 'consecutive days'}
          icon={<Flame size={15} />}
          accent="#ef4444"
          info={infoItems[3]}
          onInfoClick={() => setInfoModalIndex(3)}
        />
      )
    } else if (id === 'longest-session') {
      card = (
        <StatCard
          label={lang === 'pt' ? 'Sessão mais longa' : 'Longest session'}
          value={derived.longestSession?.duration_minutes ? fmtDuration(derived.longestSession.duration_minutes * 60_000) : '—'}
          sub={derived.longestSession
            ? (() => {
                const msgs = (derived.longestSession!.user_message_count ?? 0) + (derived.longestSession!.assistant_message_count ?? 0)
                const msgStr = `${msgs} ${lang === 'pt' ? 'mensagens' : 'messages'}`
                if (filters.projects.length === 0 && derived.longestSession!.project_path)
                  return `${msgStr} · ${formatProjectName(derived.longestSession!.project_path)}`
                return msgStr
              })()
            : ''}
          icon={<Clock size={15} />}
          accent="var(--accent-purple)"
          info={infoItems[4]}
          onInfoClick={() => setInfoModalIndex(4)}
        />
      )
    } else if (id === 'commits') {
      card = (
        <StatCard
          label={lang === 'pt' ? 'Commits' : 'Commits'}
          value={derived.metaCoverageFrom ? derived.gitCommits : '—'}
          sub={(() => {
            if (!derived.metaCoverageFrom) return lang === 'pt' ? 'sem dados session-meta' : 'no session-meta data'
            const from = derived.metaCoverageFrom ? format(parseISO(derived.metaCoverageFrom), 'MMM d') : ''
            const to = derived.metaCoverageTo ? format(parseISO(derived.metaCoverageTo), 'MMM d') : ''
            return `${derived.gitPushes} pushes · ${from}–${to} only`
          })()}
          icon={<GitCommit size={15} />}
          accent="var(--accent-cyan)"
          info={infoItems[6]}
          onInfoClick={() => setInfoModalIndex(6)}
          action={
            <button
              onClick={() => setInfoModalIndex(6)}
              title={lang === 'pt' ? 'Cobertura parcial — clique para detalhes' : 'Partial coverage — click for details'}
              style={{ background: 'transparent', border: 'none', cursor: 'pointer', padding: 0, display: 'flex', alignItems: 'center', color: '#f59e0b' }}
            >
              <AlertTriangle size={13} />
            </button>
          }
        />
      )
    } else if (id === 'files') {
      card = (
        <StatCard
          label={lang === 'pt' ? 'Arquivos' : 'Files'}
          value={derived.metaCoverageFrom ? derived.filesModified : '—'}
          sub={(() => {
            if (!derived.metaCoverageFrom) return lang === 'pt' ? 'sem dados session-meta' : 'no session-meta data'
            const from = derived.metaCoverageFrom ? format(parseISO(derived.metaCoverageFrom), 'MMM d') : ''
            const to = derived.metaCoverageTo ? format(parseISO(derived.metaCoverageTo), 'MMM d') : ''
            return `+${fmt(derived.linesAdded)} / -${fmt(derived.linesRemoved)} · ${from}–${to} only`
          })()}
          icon={<FileCode size={15} />}
          accent="var(--accent-green)"
          info={infoItems[7]}
          onInfoClick={() => setInfoModalIndex(7)}
          action={
            <button
              onClick={() => setInfoModalIndex(7)}
              title={lang === 'pt' ? 'Cobertura parcial — clique para detalhes' : 'Partial coverage — click for details'}
              style={{ background: 'transparent', border: 'none', cursor: 'pointer', padding: 0, display: 'flex', alignItems: 'center', color: '#f59e0b' }}
            >
              <AlertTriangle size={13} />
            </button>
          }
        />
      )
    }

    return (
      <div
        key={id}
        data-drag-card={id}
        draggable
        onDragStart={() => handleDragStart(id)}
        onDragOver={e => handleDragOver(e, id)}
        onDrop={() => handleDrop(id)}
        onDragEnd={handleDragEnd}
        style={wrapperStyle}
      >
        {/* Drag handle indicator */}
        <div style={{
          position: 'absolute', top: 8, left: 8, zIndex: 1,
          color: 'var(--text-tertiary)', opacity: 0,
          transition: 'opacity 0.15s',
          pointerEvents: 'none',
        }} className="drag-handle">
          <GripVertical size={12} />
        </div>
        {card}
      </div>
    )
  }

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg-base)' }}>
      {/* Header */}
      <header style={{
        borderBottom: '1px solid var(--border)',
        background: 'var(--bg-surface)',
        position: 'sticky',
        top: 0,
        zIndex: 100,
        backdropFilter: 'blur(12px)',
      }}>
        <div style={{
          maxWidth: 1400,
          margin: '0 auto',
          padding: '0 32px',
          height: 56,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{
              width: 32, height: 32,
              background: 'linear-gradient(135deg, var(--anthropic-orange), #f59e0b)',
              borderRadius: 9,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              boxShadow: '0 2px 8px var(--anthropic-orange-dim)',
            }}>
              <span style={{ fontSize: 14, fontWeight: 800, color: '#000' }}>✦</span>
            </div>
            <div>
              <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)' }}>Claude Stats</div>
              <div style={{ fontSize: 10, color: 'var(--text-tertiary)', marginTop: -1 }}>
                {lang === 'pt' ? 'Atualizado em' : 'Updated'}{' '}
                {statsCache.lastComputedDate ? format(parseISO(statsCache.lastComputedDate), 'MMM d') : lang === 'pt' ? 'hoje' : 'today'}
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            {statsCache.firstSessionDate && (
              <div style={{ fontSize: 11, color: 'var(--text-tertiary)', textAlign: 'right' }}>
                <div>{lang === 'pt' ? 'Desde' : 'Since'} {format(parseISO(statsCache.firstSessionDate), 'MMM d, yyyy')}</div>
                <div style={{ color: 'var(--text-secondary)' }}>
                  {statsCache.totalSessions?.toLocaleString()} {lang === 'pt' ? 'sessões' : 'sessions'}
                </div>
              </div>
            )}

            {/* Language toggle */}
            <button
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
            </button>

            {/* Theme toggle */}
            <button
              onClick={() => setTheme(t => t === 'dark' ? 'light' : 'dark')}
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
            </button>

            {/* Export report */}
            <button
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
                ;(e.currentTarget as HTMLButtonElement).style.background = 'var(--anthropic-orange)'
                ;(e.currentTarget as HTMLButtonElement).style.color = '#000'
              }}
              onMouseLeave={e => {
                ;(e.currentTarget as HTMLButtonElement).style.background = 'var(--anthropic-orange-dim)'
                ;(e.currentTarget as HTMLButtonElement).style.color = 'var(--anthropic-orange)'
              }}
              title={lang === 'pt' ? 'Exportar relatório PDF' : 'Export PDF report'}
            >
              <Download size={13} />
              {lang === 'pt' ? 'Exportar' : 'Export'}
            </button>

            {/* Health warnings */}
            {data?.healthIssues && data.healthIssues.length > 0 && (
              <HealthWarnings issues={data.healthIssues} lang={lang} />
            )}

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
      </header>

      {/* Main content */}
      <main style={{ maxWidth: 1400, margin: '0 auto', padding: '28px 32px', display: 'flex', flexDirection: 'column', gap: 20 }}>

        {/* Filters — sticky sentinel + wrapper */}
        <div ref={filtersSentinelRef} style={{ height: 0, marginTop: -1, pointerEvents: 'none' }} />
        <div style={{
          position: 'sticky',
          top: 56,
          zIndex: 350,
          marginLeft: -32,
          marginRight: -32,
          paddingLeft: 32,
          paddingRight: 32,
          willChange: 'transform',
        }}>
          <FiltersBar
            filters={filters}
            onChange={setFilters}
            projects={data.projects}
            models={models}
            lang={lang}
            stuck={filtersStuck}
          />
        </div>

        {/* KPI Cards — draggable 5×2 grid */}
        <style>{`
          [data-drag-card]:hover .drag-handle { opacity: 1 !important; }
          [data-drag-card] { user-select: none; }
        `}</style>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 12 }}>
          {cardOrder.map(id => renderCard(id))}
        </div>

        {/* Highlights board */}
        <Section title={<><Trophy size={14} /> {lang === 'pt' ? 'Recordes' : 'Highlights'}</>}>
          <HighlightsBoard sessions={derived.filteredSessions} projects={data.projects} lang={lang} />
        </Section>

        {/* Activity: chart (60%) + heatmap (40%) */}
        <div style={{ display: 'grid', gridTemplateColumns: '3fr 2fr', gap: 16 }}>
          <Section
            title={<><BarChart2 size={14} /> {lang === 'pt' ? 'Atividade ao longo do tempo' : 'Activity over time'}</>}
            onExpand={() => setExpandedChart('activity')}
          >
            <ActivityChart data={derived.heatmapData} />
          </Section>

          <Section
            title={lang === 'pt' ? 'Heatmap de atividade' : 'Activity heatmap'}
            onExpand={() => setExpandedChart('heatmap')}
          >
            <ActivityHeatmap data={derived.heatmapData} />
          </Section>
        </div>

        {/* Hour distribution */}
        <Section
          title={lang === 'pt' ? 'Uso por hora do dia' : 'Usage by hour'}
          onExpand={() => setExpandedChart('hours')}
        >
          <HourChart hourCounts={derived.hourCounts} hourMeta={derived.hourMeta} />
        </Section>

        {/* Model usage full-width */}
        <Section
          title={<><TrendingUp size={14} /> {lang === 'pt' ? 'Uso por modelo' : 'Model usage & cost'}</>}
          onExpand={() => setExpandedChart('models')}
        >
          <ModelBreakdown
            modelUsage={derived.modelUsage}
            currency={currency}
            brlRate={brlRate}
            note={
              filters.projects.length > 0
                ? (lang === 'pt'
                  ? 'Breakdown por modelo indisponível com filtro de projeto ativo — sessões não registram o modelo utilizado.'
                  : 'Per-model breakdown unavailable when project filter is active — sessions do not record the model used.')
                : (filters.dateRange !== 'all' || filters.customStart || filters.customEnd
                  ? (lang === 'pt'
                    ? '* Valores aproximados: tokens rateados pelo total diário. Proporção input/output baseada no histórico global.'
                    : '* Approximate values: tokens prorated from daily totals. Input/output split based on global historical ratio.')
                  : undefined)
            }
          />
        </Section>

        {/* Projects (left, 2-col grid) + Tools/Languages stacked (right) */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          <Section
            title={<><FileCode size={14} /> {lang === 'pt' ? 'Principais projetos' : 'Top projects'}</>}
            action={
              filters.projects.length > 0 ? (
                <button
                  onClick={() => setFilters(f => ({ ...f, projects: [] }))}
                  style={{
                    fontSize: 11,
                    color: 'var(--text-tertiary)',
                    background: 'transparent',
                    border: 'none',
                    cursor: 'pointer',
                    fontFamily: 'inherit',
                  }}
                >
                  {lang === 'pt' ? 'Limpar' : 'Clear'}
                </button>
              ) : null
            }
          >
            <ProjectsList
              projectStats={derived.projectStats}
              onFilter={path => setFilters(f => ({ ...f, projects: [path] }))}
            />
          </Section>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <Section title={<><Wrench size={14} /> {lang === 'pt' ? 'Ferramentas mais usadas' : 'Most used tools'}</>}>
              <TagCloud data={derived.toolCounts} color="var(--accent-green)" />
            </Section>

            <Section title={<><FileCode size={14} /> {lang === 'pt' ? 'Linguagens' : 'Languages'}</>}>
              <TagCloud data={derived.langCounts} color="var(--accent-blue)" />
            </Section>
          </div>
        </div>

        {/* Recent sessions */}
        <Section title={<><Clock size={14} /> {lang === 'pt' ? 'Sessões recentes' : 'Recent sessions'}</>}>
          <RecentSessions sessions={derived.filteredSessions} lang={lang} />
        </Section>
      </main>

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
          <ActivityChart data={derived.heatmapData} height={480} />
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
            note={
              filters.projects.length > 0
                ? (lang === 'pt'
                  ? 'Breakdown por modelo indisponível com filtro de projeto ativo.'
                  : 'Per-model breakdown unavailable when project filter is active.')
                : undefined
            }
          />
        </ChartModal>
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
