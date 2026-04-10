#!/usr/bin/env bun
/**
 * Claude Stats — Watch CLI
 *
 * TUI interativa para monitorar métricas Claude em tempo real.
 * Selecione projetos e visualize dados agregados no terminal.
 *
 * Usage:
 *   bun run watch:cli
 *
 * Variáveis de ambiente:
 *   CLAUDE_STATS_WATCH_INTERVAL  — Intervalo de polling em segundos (padrão: 30, mín: 5)
 */

import { readdir, readFile } from 'fs/promises'
import { join } from 'path'
import chokidar from 'chokidar'
import { checkbox, select } from '@inquirer/prompts'
import { calcCost } from './src/lib/types'
import type { ModelUsage } from './src/lib/types'

// ── Configuração ───────────────────────────────────────────────────────────

const HOME_DIR = process.env.HOME ?? process.env.USERPROFILE ?? ''
const CLAUDE_DIR = join(HOME_DIR, '.claude')
const SESSION_META_DIR = join(CLAUDE_DIR, 'usage-data', 'session-meta')
const STATS_CACHE_FILE = join(CLAUDE_DIR, 'stats-cache.json')

const MIN_INTERVAL_SEC = 5
const rawInterval = parseInt(process.env.CLAUDE_STATS_WATCH_INTERVAL ?? '30', 10)
const WATCH_INTERVAL_SEC = !Number.isFinite(rawInterval) || rawInterval < MIN_INTERVAL_SEC ? 30 : rawInterval

// ── ANSI helpers ───────────────────────────────────────────────────────────

const ESC = '\x1b'
const RESET = `${ESC}[0m`
const BOLD = `${ESC}[1m`
const DIM = `${ESC}[2m`
const CYAN = `${ESC}[36m`
const GREEN = `${ESC}[32m`
const YELLOW = `${ESC}[33m`
const WHITE = `${ESC}[37m`
const BRIGHT_CYAN = `${ESC}[96m`

function clearScreen() {
  process.stdout.write(`${ESC}[2J${ESC}[H`)
}
function hideCursor() {
  process.stdout.write(`${ESC}[?25l`)
}
function showCursor() {
  process.stdout.write(`${ESC}[?25h`)
}

// ── Tipos ──────────────────────────────────────────────────────────────────

type ViewMode = 'separado' | 'junto' | 'ambos'

interface ProjectInfo {
  name: string
  path: string
}

interface CliSnapshot {
  messages: number
  sessions: number
  inputTokens: number
  outputTokens: number
  costUsd: number
  streak: number
  gitCommits: number
  gitPushes: number
  linesAdded: number
  linesRemoved: number
}

interface StatsCache {
  dailyActivity?: Array<{ date: string; messageCount: number; sessionCount: number }>
  modelUsage?: Record<string, ModelUsage>
}

interface SessionMetaLight {
  session_id: string
  project_path: string
  input_tokens: number
  output_tokens: number
  user_message_count: number
  assistant_message_count: number
  git_commits: number
  git_pushes: number
  lines_added: number
  lines_removed: number
  start_time: string
}

interface WatchConfig {
  selectedProjects: ProjectInfo[]  // empty = todos
  allProjects: ProjectInfo[]
  viewMode: ViewMode
  intervalSec: number
}

// ── I/O helpers ────────────────────────────────────────────────────────────

async function safeReadJson<T>(filePath: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(filePath, 'utf-8')) as T
  } catch {
    return null
  }
}

async function safeReadDir(dirPath: string): Promise<string[]> {
  try {
    return await readdir(dirPath)
  } catch {
    return []
  }
}

// ── Descoberta de projetos ─────────────────────────────────────────────────
// Lê os project_path únicos dos arquivos session-meta (caminhos canônicos reais).

async function discoverProjects(): Promise<ProjectInfo[]> {
  const metaFiles = (await safeReadDir(SESSION_META_DIR)).filter(f => f.endsWith('.json'))

  const projectPaths = new Set<string>()

  // Lê em lotes para não abrir muitos file descriptors de uma vez
  const BATCH = 30
  for (let i = 0; i < metaFiles.length; i += BATCH) {
    const batch = metaFiles.slice(i, i + BATCH)
    const results = await Promise.all(
      batch.map(f => safeReadJson<{ project_path?: string }>(join(SESSION_META_DIR, f)))
    )
    for (const s of results) {
      if (s?.project_path) projectPaths.add(s.project_path)
    }
  }

  return Array.from(projectPaths)
    .sort()
    .map(path => ({
      path,
      name: path.split('/').filter(Boolean).pop() ?? path,
    }))
}

// ── Cálculo de snapshot ────────────────────────────────────────────────────

async function buildCliSnapshot(projectPaths?: string[]): Promise<CliSnapshot> {
  const isFiltered = projectPaths !== undefined && projectPaths.length > 0
  const metaFiles = (await safeReadDir(SESSION_META_DIR)).filter(f => f.endsWith('.json'))
  const sessions: SessionMetaLight[] = []

  const BATCH = 30
  for (let i = 0; i < metaFiles.length; i += BATCH) {
    const batch = metaFiles.slice(i, i + BATCH)
    const results = await Promise.all(
      batch.map(f => safeReadJson<SessionMetaLight>(join(SESSION_META_DIR, f)))
    )
    for (const s of results) {
      if (s) sessions.push(s)
    }
  }

  const filtered = isFiltered
    ? sessions.filter(s => projectPaths!.includes(s.project_path))
    : sessions

  let inputTokens = 0
  let outputTokens = 0
  let gitCommits = 0
  let gitPushes = 0
  let linesAdded = 0
  let linesRemoved = 0
  let messages = 0
  const activeDates = new Set<string>()
  const sessionIds = new Set<string>()

  for (const s of filtered) {
    inputTokens += s.input_tokens ?? 0
    outputTokens += s.output_tokens ?? 0
    gitCommits += s.git_commits ?? 0
    gitPushes += s.git_pushes ?? 0
    linesAdded += s.lines_added ?? 0
    linesRemoved += s.lines_removed ?? 0
    messages += (s.user_message_count ?? 0) + (s.assistant_message_count ?? 0)
    if (s.session_id) sessionIds.add(s.session_id)
    if (s.start_time) activeDates.add(s.start_time.slice(0, 10))
  }

  // Custo: usa stats-cache para global (preciso); aproximação proporcional para filtros
  let costUsd = 0
  const cache = await safeReadJson<StatsCache>(STATS_CACHE_FILE)

  if (!isFiltered) {
    if (cache?.modelUsage) {
      for (const [modelId, u] of Object.entries(cache.modelUsage)) {
        costUsd += calcCost(u, modelId)
      }
    }
  } else {
    // Taxa combinada global → aplica ao volume de tokens do subconjunto
    let globalInput = 0
    let globalOutput = 0
    let globalCost = 0
    if (cache?.modelUsage) {
      for (const [modelId, u] of Object.entries(cache.modelUsage)) {
        globalInput += u.inputTokens + (u.cacheReadInputTokens ?? 0) + (u.cacheCreationInputTokens ?? 0)
        globalOutput += u.outputTokens
        globalCost += calcCost(u, modelId)
      }
    }
    const totalTokens = globalInput + globalOutput
    if (totalTokens > 0) {
      costUsd = ((inputTokens + outputTokens) / totalTokens) * globalCost
    }
  }

  // Streak: conta dias consecutivos para trás a partir de hoje
  let streak = 0
  for (let i = 0; i <= 365; i++) {
    const d = new Date()
    d.setDate(d.getDate() - i)
    const dateStr = d.toISOString().slice(0, 10)
    if (activeDates.has(dateStr)) {
      streak++
    } else if (i > 0) {
      break
    }
  }

  return {
    messages,
    sessions: sessionIds.size,
    inputTokens,
    outputTokens,
    costUsd,
    streak,
    gitCommits,
    gitPushes,
    linesAdded,
    linesRemoved,
  }
}

// ── Formatação ─────────────────────────────────────────────────────────────

function fmtNum(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M'
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'k'
  return n.toString()
}

function fmtCost(usd: number): string {
  if (usd >= 1000) return `$${(usd / 1000).toFixed(1)}k`
  if (usd >= 1) return `$${usd.toFixed(2)}`
  return `$${usd.toFixed(3)}`
}

/** Alinha string considerando que ela pode ter escape codes ANSI. */
function col(s: string, width: number, align: 'l' | 'r' = 'r'): string {
  const visLen = s.replace(/\x1b\[[0-9;]*m/g, '').length
  const pad = ' '.repeat(Math.max(0, width - visLen))
  return align === 'l' ? s + pad : pad + s
}

function hr(width: number, char = '─'): string {
  return `${DIM}${char.repeat(width)}${RESET}`
}

// Colunas da tabela de métricas (label, largura, alinhamento)
const METRIC_COLS: Array<{ label: string; width: number }> = [
  { label: 'Msgs',    width: 8  },
  { label: 'Sessões', width: 8  },
  { label: 'Tok↑',   width: 9  },
  { label: 'Tok↓',   width: 9  },
  { label: 'Custo',  width: 10 },
  { label: 'Streak', width: 7  },
  { label: 'Commits',width: 8  },
  { label: '+Linhas',width: 9  },
  { label: '-Linhas',width: 9  },
]

const PROJECT_COL_WIDTH = 24

function renderTableHeader(includeProjectCol: boolean): string {
  const cells = METRIC_COLS.map(c => col(`${DIM}${c.label}${RESET}`, c.width))
  if (includeProjectCol) {
    return col(`${DIM}Projeto${RESET}`, PROJECT_COL_WIDTH, 'l') + '  ' + cells.join('  ')
  }
  return cells.join('  ')
}

function renderSnapshotRow(snap: CliSnapshot, projectName?: string): string {
  const values = [
    fmtNum(snap.messages),
    fmtNum(snap.sessions),
    fmtNum(snap.inputTokens),
    fmtNum(snap.outputTokens),
    fmtCost(snap.costUsd),
    `${snap.streak}d`,
    fmtNum(snap.gitCommits),
    `+${fmtNum(snap.linesAdded)}`,
    `-${fmtNum(snap.linesRemoved)}`,
  ]
  const cells = values.map((v, i) => col(v, METRIC_COLS[i].width))

  if (projectName !== undefined) {
    const name = projectName.length > PROJECT_COL_WIDTH - 1
      ? projectName.slice(0, PROJECT_COL_WIDTH - 2) + '…'
      : projectName
    return col(`${CYAN}${name}${RESET}`, PROJECT_COL_WIDTH, 'l') + '  ' + cells.join('  ')
  }
  return cells.join('  ')
}

// ── Renderização do painel ─────────────────────────────────────────────────

function buildHeaderLines(config: WatchConfig, updatedAt: Date): string[] {
  const width = process.stdout.columns || 100
  const now = updatedAt.toLocaleTimeString('pt-BR')
  const refresh = `⟳ ${config.intervalSec}s`
  const rightSide = `${DIM}${now}  ${refresh}${RESET}`
  const leftSide = `${BOLD}${BRIGHT_CYAN}Claude Stats — Watch Mode${RESET}`

  const visLeft = 'Claude Stats — Watch Mode'
  const visRight = `${now}  ${refresh}`
  const gap = Math.max(1, width - visLeft.length - visRight.length)

  const lines: string[] = []
  lines.push(leftSide + ' '.repeat(gap) + rightSide)
  lines.push(hr(width))
  lines.push('')

  // Info block
  const modeDesc =
    config.viewMode === 'junto'    ? 'unificado'
    : config.viewMode === 'separado' ? 'separado'
    : 'ambos'

  lines.push(`  ${DIM}Home:${RESET}       ${WHITE}${HOME_DIR}${RESET}`)
  lines.push(`  ${DIM}Claude dir:${RESET} ${WHITE}${CLAUDE_DIR}${RESET}`)

  if (config.selectedProjects.length === 0) {
    lines.push(`  ${DIM}Projetos:${RESET}   ${YELLOW}todos (${config.allProjects.length})${RESET}`)
  } else {
    const names = config.selectedProjects.map(p => p.name).join(', ')
    lines.push(`  ${DIM}Projetos:${RESET}   ${CYAN}${names}${RESET}`)
  }

  if (config.selectedProjects.length > 1) {
    lines.push(`  ${DIM}Modo:${RESET}       ${GREEN}${modeDesc}${RESET}`)
  }

  lines.push(`  ${DIM}Interval:${RESET}   ${WHITE}${config.intervalSec}s${RESET}`)
  lines.push(`  ${DIM}OTLP:${RESET}       ${DIM}(disabled)${RESET}`)
  lines.push('')

  return lines
}

async function renderPanel(config: WatchConfig): Promise<void> {
  const updatedAt = new Date()
  const width = process.stdout.columns || 100
  const lines: string[] = []

  lines.push(...buildHeaderLines(config, updatedAt))

  const selectedPaths =
    config.selectedProjects.length > 0
      ? config.selectedProjects.map(p => p.path)
      : undefined

  // Modo 'todos' ou único projeto selecionado → sem perguntar view mode
  const singleView = config.selectedProjects.length <= 1

  if (singleView || config.viewMode === 'junto') {
    // ── Linha unificada ───────────────────────────────────────────────────
    const snap = await buildCliSnapshot(selectedPaths)
    lines.push(hr(width))
    lines.push(`  ${BOLD}${CYAN}UNIFICADO${RESET}`)
    lines.push('')
    lines.push('  ' + renderTableHeader(false))
    lines.push(`  ${GREEN}${BOLD}${renderSnapshotRow(snap)}${RESET}`)
    lines.push(hr(width))
  } else if (config.viewMode === 'separado') {
    // ── Uma linha por projeto ─────────────────────────────────────────────
    lines.push(hr(width))
    lines.push(`  ${BOLD}${CYAN}POR PROJETO${RESET}`)
    lines.push('')
    lines.push('  ' + renderTableHeader(true))

    for (const proj of config.selectedProjects) {
      const snap = await buildCliSnapshot([proj.path])
      lines.push('  ' + renderSnapshotRow(snap, proj.name))
    }
    lines.push(hr(width))
  } else {
    // ── Ambos: total no topo + um por projeto ──────────────────────────────
    const allSnap = await buildCliSnapshot(selectedPaths)
    lines.push(hr(width))
    lines.push(`  ${BOLD}${CYAN}UNIFICADO${RESET}`)
    lines.push('')
    lines.push('  ' + renderTableHeader(false))
    lines.push(`  ${GREEN}${BOLD}${renderSnapshotRow(allSnap)}${RESET}`)
    lines.push('')
    lines.push(`  ${BOLD}${CYAN}POR PROJETO${RESET}`)
    lines.push('')
    lines.push('  ' + renderTableHeader(true))

    for (const proj of config.selectedProjects) {
      const snap = await buildCliSnapshot([proj.path])
      lines.push('  ' + renderSnapshotRow(snap, proj.name))
    }
    lines.push(hr(width))
  }

  lines.push('')
  lines.push(`  ${DIM}Pressione Ctrl+C para sair${RESET}`)

  clearScreen()
  process.stdout.write(lines.join('\n') + '\n')
}

// ── Seleção interativa ─────────────────────────────────────────────────────

async function promptProjects(projects: ProjectInfo[]): Promise<ProjectInfo[]> {
  const ALL_VALUE = '__all__'

  const choices = [
    {
      name: `${BOLD}(todos os projetos)${RESET}`,
      value: ALL_VALUE,
      short: 'todos',
    },
    ...projects.map(p => ({
      name: `${p.name}  ${DIM}${p.path}${RESET}`,
      value: p.path,
      short: p.name,
    })),
  ]

  const selected = await checkbox({
    message: 'Selecione os projetos para monitorar (⎵ seleciona, ↑↓ navega, Enter confirma):',
    choices,
    pageSize: Math.min(20, projects.length + 3),
    loop: false,
  })

  if (selected.length === 0 || selected.includes(ALL_VALUE)) {
    return []
  }

  return projects.filter(p => selected.includes(p.path))
}

async function promptViewMode(): Promise<ViewMode> {
  return select<ViewMode>({
    message: 'Como deseja visualizar os dados?',
    choices: [
      {
        name: `${BOLD}Separado${RESET}  — uma linha por projeto`,
        value: 'separado',
        short: 'separado',
      },
      {
        name: `${BOLD}Unificado${RESET} — total dos projetos selecionados`,
        value: 'junto',
        short: 'unificado',
      },
      {
        name: `${BOLD}Ambos${RESET}     — total no topo + uma linha por projeto`,
        value: 'ambos',
        short: 'ambos',
      },
    ],
  })
}

// ── Loop principal ─────────────────────────────────────────────────────────

async function watchLoop(config: WatchConfig): Promise<void> {
  hideCursor()

  process.on('SIGINT', () => {
    showCursor()
    clearScreen()
    process.exit(0)
  })
  process.on('SIGTERM', () => {
    showCursor()
    clearScreen()
    process.exit(0)
  })

  let isRendering = false
  let pendingRender = false

  const render = async () => {
    if (isRendering) {
      pendingRender = true
      return
    }
    isRendering = true
    try {
      await renderPanel(config)
    } catch (err) {
      // Não falha silenciosamente em erros de renderização
      clearScreen()
      console.error(`${RESET}Erro ao renderizar painel:`, err)
    } finally {
      isRendering = false
      if (pendingRender) {
        pendingRender = false
        render()
      }
    }
  }

  // Renderização inicial
  await render()

  // Debounce para eventos de filesystem
  let debounceTimer: ReturnType<typeof setTimeout> | null = null
  const debouncedRender = () => {
    if (debounceTimer) clearTimeout(debounceTimer)
    debounceTimer = setTimeout(render, 1500)
  }

  chokidar
    .watch([SESSION_META_DIR, STATS_CACHE_FILE], {
      persistent: true,
      ignoreInitial: true,
    })
    .on('all', debouncedRender)

  // Poll periódico como fallback
  setInterval(render, WATCH_INTERVAL_SEC * 1000)
}

// ── Entry point ────────────────────────────────────────────────────────────

async function main() {
  console.log(`${CYAN}${BOLD}Claude Stats — Watch CLI${RESET}\n`)
  console.log(`${DIM}Descobrindo projetos em ${SESSION_META_DIR}...${RESET}`)

  const projects = await discoverProjects()

  if (projects.length === 0) {
    console.error(`\nNenhum projeto encontrado. Verifique se o diretório existe:\n  ${SESSION_META_DIR}`)
    process.exit(1)
  }

  console.log(`${GREEN}${projects.length} projetos encontrados.${RESET}\n`)

  // Seleção interativa
  const selectedProjects = await promptProjects(projects)

  let viewMode: ViewMode = 'junto'
  if (selectedProjects.length > 1) {
    viewMode = await promptViewMode()
  }

  const config: WatchConfig = {
    selectedProjects,
    allProjects: projects,
    viewMode,
    intervalSec: WATCH_INTERVAL_SEC,
  }

  await watchLoop(config)
}

main().catch(err => {
  showCursor()
  console.error('Erro fatal:', err)
  process.exit(1)
})
