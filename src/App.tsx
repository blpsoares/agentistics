import React, { useState, useMemo, useEffect, useRef } from 'react'
import {
  MessageSquare, Zap, Clock, Flame, GitCommit,
  Wrench, RefreshCw, FileCode, TrendingUp, BarChart2,
  Sun, Moon, Globe, AlertTriangle, Download, Upload,
  Maximize2, X, GripVertical, Trophy, Activity,
} from 'lucide-react'
import { useData, useDerivedStats, LIVE_INTERVAL_OPTIONS } from './hooks/useData'
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
import { ToolMetricsPanel } from './components/ToolMetricsPanel'
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
  const { data, loading, error, refetch, liveUpdates, setLiveUpdates, updateInterval, setUpdateInterval } = useData()
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
  const [scrolled, setScrolled] = useState(false)

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
    const bars = [
      { anim: 'eq1', delay: '0s',    opacity: 0.45 },
      { anim: 'eq2', delay: '0.12s', opacity: 0.65 },
      { anim: 'eq3', delay: '0.22s', opacity: 0.85 },
      { anim: 'eq4', delay: '0.08s', opacity: 1    },
      { anim: 'eq5', delay: '0.18s', opacity: 0.85 },
      { anim: 'eq6', delay: '0.28s', opacity: 0.65 },
      { anim: 'eq7', delay: '0.38s', opacity: 0.45 },
      { anim: 'eq8', delay: '0.05s', opacity: 0.30 },
      { anim: 'eq9', delay: '0.32s', opacity: 0.25 },
    ]
    const ptTexts = ['Lendo conversas...', 'Contando tokens...', 'Construindo métricas...']
    const enTexts = ['Reading conversations...', 'Counting tokens...', 'Building metrics...']
    const texts = lang === 'pt' ? ptTexts : enTexts
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
          @keyframes eq1 { 0%,100%{height:22%} 25%{height:88%} 60%{height:35%} }
          @keyframes eq2 { 0%,100%{height:55%} 20%{height:30%} 65%{height:95%} }
          @keyframes eq3 { 0%,100%{height:75%} 30%{height:55%} 70%{height:45%} }
          @keyframes eq4 { 0%,100%{height:40%} 15%{height:100%} 55%{height:60%} }
          @keyframes eq5 { 0%,100%{height:65%} 35%{height:40%} 75%{height:85%} }
          @keyframes eq6 { 0%,100%{height:45%} 20%{height:78%} 60%{height:28%} }
          @keyframes eq7 { 0%,100%{height:85%} 40%{height:22%} 70%{height:65%} }
          @keyframes eq8 { 0%,100%{height:30%} 25%{height:70%} 55%{height:15%} }
          @keyframes eq9 { 0%,100%{height:18%} 35%{height:55%} 65%{height:80%} }
          @keyframes iconGlow {
            0%,100%{box-shadow:0 0 0 0 rgba(217,119,6,0),0 0 12px 2px rgba(217,119,6,0.25)}
            50%{box-shadow:0 0 0 8px rgba(217,119,6,0),0 0 24px 6px rgba(217,119,6,0.45)}
          }
          @keyframes ring1 { 0%,100%{transform:scale(1);opacity:0.5} 50%{transform:scale(1.18);opacity:0.1} }
          @keyframes ring2 { 0%,100%{transform:scale(1);opacity:0.25} 50%{transform:scale(1.32);opacity:0.05} }
          @keyframes scanBar {
            0%{left:-100%} 100%{left:200%}
          }
          @keyframes txt1 { 0%,26%{opacity:1;transform:translateY(0)} 33%,100%{opacity:0;transform:translateY(-7px)} }
          @keyframes txt2 { 0%,32%{opacity:0;transform:translateY(7px)} 39%,59%{opacity:1;transform:translateY(0)} 66%,100%{opacity:0;transform:translateY(-7px)} }
          @keyframes txt3 { 0%,65%{opacity:0;transform:translateY(7px)} 72%,93%{opacity:1;transform:translateY(0)} 100%{opacity:0;transform:translateY(-7px)} }
        `}</style>

        {/* Icon with glow rings */}
        <div style={{ position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{
            position: 'absolute',
            width: 72, height: 72,
            borderRadius: '50%',
            border: '1px solid rgba(217,119,6,0.3)',
            animation: 'ring1 2.4s ease-in-out infinite',
          }}/>
          <div style={{
            position: 'absolute',
            width: 96, height: 96,
            borderRadius: '50%',
            border: '1px solid rgba(217,119,6,0.15)',
            animation: 'ring2 2.4s ease-in-out infinite 0.4s',
          }}/>
          <div style={{
            width: 48, height: 48,
            background: 'var(--anthropic-orange-dim)',
            borderRadius: 14,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            animation: 'iconGlow 2.4s ease-in-out infinite',
          }}>
            <BarChart2 size={22} color="var(--anthropic-orange)" />
          </div>
        </div>

        {/* Equalizer bars */}
        <div style={{ position: 'relative', overflow: 'hidden', padding: '0 2px' }}>
          <div style={{
            display: 'flex',
            alignItems: 'flex-end',
            gap: 5,
            height: 48,
          }}>
            {bars.map((bar, i) => (
              <div key={i} style={{
                width: 5,
                height: '60%',
                background: `rgba(217,119,6,${bar.opacity})`,
                borderRadius: 3,
                animation: `${bar.anim} 1.4s ease-in-out infinite`,
                animationDelay: bar.delay,
              }}/>
            ))}
          </div>
          {/* scan shimmer */}
          <div style={{
            position: 'absolute',
            top: 0, bottom: 0,
            width: '35%',
            background: 'linear-gradient(90deg,transparent,rgba(217,119,6,0.12),transparent)',
            animation: 'scanBar 2s ease-in-out infinite',
            pointerEvents: 'none',
          }}/>
        </div>

        {/* Cycling text */}
        <div style={{ position: 'relative', height: 18, width: 220, textAlign: 'center' }}>
          {texts.map((txt, i) => (
            <div key={i} style={{
              position: 'absolute', inset: 0,
              color: 'var(--text-secondary)',
              fontSize: 13,
              letterSpacing: '0.02em',
              animation: `txt${i + 1} 6s ease-in-out infinite`,
              opacity: 0,
            }}>
              {txt}
            </div>
          ))}
        </div>
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
          value={derived.gitCommits}
          sub={derived.gitPushes > 0
            ? `${derived.gitPushes} ${lang === 'pt' ? 'pushes via Claude' : 'pushes via Claude'}`
            : lang === 'pt' ? 'via chamadas Bash do Claude' : 'via Claude Bash calls'}
          icon={<GitCommit size={15} />}
          accent="var(--accent-cyan)"
          info={infoItems[6]}
          onInfoClick={() => setInfoModalIndex(6)}
        />
      )
    } else if (id === 'files') {
      card = (
        <StatCard
          label={lang === 'pt' ? 'Arquivos' : 'Files'}
          value={derived.filesModified}
          sub={derived.linesAdded + derived.linesRemoved > 0
            ? `+${fmt(derived.linesAdded)} / -${fmt(derived.linesRemoved)} linhas`
            : lang === 'pt' ? 'via chamadas Bash do Claude' : 'via Claude Bash calls'}
          icon={<FileCode size={15} />}
          accent="var(--accent-green)"
          info={infoItems[7]}
          onInfoClick={() => setInfoModalIndex(7)}
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
          padding: '0 32px',
          height: 56,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <img
              src='/logoDarkMode.png'
              alt="Claude Stats"
              style={{ height: 32, width: 'auto' }}
            />
            <div style={{ fontSize: 10, color: 'var(--text-tertiary)' }}>
              {lang === 'pt' ? 'Atualizado em' : 'Updated'}{' '}
              {statsCache.lastComputedDate ? format(parseISO(statsCache.lastComputedDate), 'MMM d') : lang === 'pt' ? 'hoje' : 'today'}
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
            </button>

            {/* Health warnings */}
            {data?.healthIssues && data.healthIssues.length > 0 && (
              <HealthWarnings issues={data.healthIssues} lang={lang} />
            )}

            {/* Live updates toggle */}
            <div style={{
              display: 'flex', alignItems: 'center', gap: 6,
              padding: '0 10px',
              height: 32,
              borderRadius: 8,
              border: '1px solid var(--border)',
              background: 'var(--bg-secondary)',
            }}>
              {/* Activity icon */}
              <Activity size={12} style={{ color: liveUpdates ? 'var(--anthropic-orange)' : 'var(--text-tertiary)', flexShrink: 0, transition: 'color 0.2s' }} />

              {/* Label */}
              <span style={{ fontSize: 11, fontWeight: 500, color: liveUpdates ? 'var(--text-primary)' : 'var(--text-tertiary)', whiteSpace: 'nowrap', transition: 'color 0.2s', userSelect: 'none' }}>
                {lang === 'pt' ? 'Live' : 'Live'}
              </span>

              {/* iPhone-style toggle */}
              <button
                onClick={() => setLiveUpdates(v => !v)}
                title={liveUpdates
                  ? (lang === 'pt' ? 'Pausar atualizações em tempo real' : 'Pause live updates')
                  : (lang === 'pt' ? 'Ativar atualizações em tempo real' : 'Enable live updates')}
                style={{
                  position: 'relative',
                  width: 28, height: 16,
                  borderRadius: 8,
                  border: 'none',
                  background: liveUpdates ? 'var(--anthropic-orange)' : 'var(--text-tertiary)',
                  cursor: 'pointer',
                  padding: 0,
                  transition: 'background 0.2s',
                  flexShrink: 0,
                }}
              >
                <span style={{
                  position: 'absolute',
                  top: 2, left: liveUpdates ? 14 : 2,
                  width: 12, height: 12,
                  borderRadius: '50%',
                  background: '#fff',
                  transition: 'left 0.2s',
                  boxShadow: '0 1px 3px rgba(0,0,0,0.3)',
                }} />
              </button>

              {/* Interval selector — only shown when live is on */}
              {liveUpdates && (
                <select
                  value={updateInterval}
                  onChange={e => setUpdateInterval(Number(e.target.value))}
                  title={lang === 'pt' ? 'Intervalo de atualização' : 'Update interval'}
                  style={{
                    fontSize: 10,
                    fontWeight: 600,
                    color: 'var(--anthropic-orange)',
                    background: 'transparent',
                    border: 'none',
                    cursor: 'pointer',
                    outline: 'none',
                    fontFamily: 'inherit',
                    appearance: 'none',
                    WebkitAppearance: 'none',
                    padding: '0 2px',
                  }}
                >
                  {LIVE_INTERVAL_OPTIONS.map(opt => (
                    <option key={opt.value} value={opt.value} style={{ background: 'var(--bg-card)', color: 'var(--text-primary)' }}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              )}
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

        {/* Filters row — second row of sticky header */}
        {data && (
          <div style={{
            borderTop: '1px solid var(--border)',
            maxWidth: 1400,
            margin: '0 auto',
            padding: '0 32px',
            width: '100%',
            boxSizing: 'border-box',
          }}>
            <FiltersBar
              filters={filters}
              onChange={setFilters}
              projects={data.projects}
              models={models}
              lang={lang}
            />
          </div>
        )}
      </header>

      {/* Main content */}
      <main style={{ maxWidth: 1400, margin: '0 auto', padding: '24px 32px', display: 'flex', flexDirection: 'column', gap: 20 }}>

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
            <ActivityChart data={derived.heatmapData} theme={theme} />
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
            <Section title={<><Wrench size={14} /> {lang === 'pt' ? 'Métricas de ferramentas' : 'Tool metrics'}</>}>
              <ToolMetricsPanel
                toolCounts={derived.toolCounts}
                toolOutputTokens={derived.toolOutputTokens}
                agentFileReads={derived.agentFileReads}
                lang={lang}
              />
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

      {/* Footer */}
      <footer style={{
        marginTop: 64,
        borderTop: '1px solid var(--border)',
        background: 'linear-gradient(to bottom, transparent, var(--bg-surface))',
      }}>
        <div style={{
          maxWidth: 1400,
          margin: '0 auto',
          padding: '40px 24px 32px',
        }}>
          {/* Top row */}
          <div style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'flex-start',
            flexWrap: 'wrap',
            gap: 32,
            marginBottom: 32,
          }}>
            {/* Brand block */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12, maxWidth: 320 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{
                  width: 32,
                  height: 32,
                  borderRadius: 10,
                  background: 'var(--anthropic-orange-dim)',
                  border: '1px solid rgba(217,119,6,0.35)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  boxShadow: '0 0 12px rgba(217,119,6,0.1)',
                }}>
                  <Zap size={15} style={{ color: 'var(--anthropic-orange-light)' }} />
                </div>
                <span style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-primary)', letterSpacing: '-0.3px' }}>
                  Claude Stats
                </span>
              </div>
              <p style={{ fontSize: 12, color: 'var(--text-tertiary)', lineHeight: 1.6, margin: 0 }}>
                {lang === 'pt'
                  ? 'Dashboard local de uso do Claude Code. Seus dados ficam no seu computador — sem servidores, sem rastreamento.'
                  : 'Local Claude Code usage dashboard. Your data stays on your machine — no servers, no tracking.'}
              </p>
              {/* Live stats pill */}
              <div style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                padding: '5px 12px',
                borderRadius: 20,
                background: 'var(--bg-card)',
                border: '1px solid var(--border)',
                width: 'fit-content',
              }}>
                <div style={{
                  width: 6,
                  height: 6,
                  borderRadius: '50%',
                  background: 'var(--accent-green)',
                  boxShadow: '0 0 8px var(--accent-green)',
                }} />
                <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
                  {derived.totalSessions.toLocaleString()} {lang === 'pt' ? 'sessões' : 'sessions'}
                  {' · '}
                  {derived.totalMessages.toLocaleString()} {lang === 'pt' ? 'mensagens' : 'messages'}
                </span>
              </div>
            </div>

            {/* Links columns */}
            <div style={{ display: 'flex', gap: 48, flexWrap: 'wrap' }}>
              {/* Project */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                  {lang === 'pt' ? 'Projeto' : 'Project'}
                </span>
                {[
                  { href: 'https://github.com/blpsoares/claude-stats', label: lang === 'pt' ? 'Repositório' : 'Repository', icon: <GitCommit size={13} /> },
                  { href: 'https://github.com/blpsoares/claude-stats/issues', label: 'Issues', icon: <AlertTriangle size={13} /> },
                  { href: 'https://github.com/blpsoares/claude-stats/releases', label: 'Releases', icon: <Zap size={13} /> },
                ].map(({ href, label, icon }) => (
                  <a key={href} href={href} target="_blank" rel="noreferrer" style={{
                    display: 'flex', alignItems: 'center', gap: 7,
                    fontSize: 13, color: 'var(--text-secondary)', textDecoration: 'none',
                    transition: 'color 0.15s',
                  }}
                    onMouseEnter={e => (e.currentTarget.style.color = 'var(--text-primary)')}
                    onMouseLeave={e => (e.currentTarget.style.color = 'var(--text-secondary)')}
                  >
                    <span style={{ opacity: 0.5 }}>{icon}</span>
                    {label}
                  </a>
                ))}
              </div>

              {/* Author */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                  {lang === 'pt' ? 'Autor' : 'Author'}
                </span>
                {[
                  { href: 'https://github.com/blpsoares', label: 'blpsoares', icon: <GitCommit size={13} /> },
                  { href: 'https://linkedin.com/in/blpsoares', label: 'LinkedIn', icon: <Globe size={13} /> },
                ].map(({ href, label, icon }) => (
                  <a key={href} href={href} target="_blank" rel="noreferrer" style={{
                    display: 'flex', alignItems: 'center', gap: 7,
                    fontSize: 13, color: 'var(--text-secondary)', textDecoration: 'none',
                    transition: 'color 0.15s',
                  }}
                    onMouseEnter={e => (e.currentTarget.style.color = 'var(--text-primary)')}
                    onMouseLeave={e => (e.currentTarget.style.color = 'var(--text-secondary)')}
                  >
                    <span style={{ opacity: 0.5 }}>{icon}</span>
                    {label}
                  </a>
                ))}
              </div>
            </div>
          </div>

          {/* Bottom bar */}
          <div style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: 12,
            paddingTop: 20,
            borderTop: '1px solid var(--border-subtle)',
          }}>
            <span style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>
              {lang === 'pt' ? 'Feito com' : 'Made with'}{' '}
              <span style={{ color: 'var(--anthropic-orange)', fontWeight: 700 }}>♥</span>
              {' '}{lang === 'pt' ? 'por' : 'by'}{' '}
              <a href="https://github.com/blpsoares" target="_blank" rel="noreferrer" style={{
                color: 'var(--text-secondary)', textDecoration: 'none', fontWeight: 500,
                transition: 'color 0.15s',
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
