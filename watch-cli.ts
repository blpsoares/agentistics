#!/usr/bin/env bun
/**
 * Claude Stats — Watch CLI
 *
 * TUI interativa que monitora métricas Claude em tempo real, atualizando o painel
 * no lugar (como `watch` do Linux) sem duplicar a saída.
 *
 * Usage:
 *   bun run watch:cli
 *
 * Controles durante o watch:
 *   Ctrl+O  — ocultar/mostrar animação de batalha
 *   Ctrl+C  — sair
 */

import { readdir, readFile } from 'fs/promises'
import { join } from 'path'
import chokidar from 'chokidar'
import {
  createPrompt,
  useState,
  useMemo,
  useKeypress,
  usePagination,
  isUpKey,
  isDownKey,
  isEnterKey,
  isSpaceKey,
  isBackspaceKey,
  type KeypressEvent,
} from '@inquirer/core'
import { select, input } from '@inquirer/prompts'
import { calcCost, getModelPrice } from './src/lib/types'
import type { ModelUsage } from './src/lib/types'

// ── Configuração ───────────────────────────────────────────────────────────

const HOME_DIR   = process.env.HOME ?? process.env.USERPROFILE ?? ''
const CLAUDE_DIR = join(HOME_DIR, '.claude')
const PROJECTS_DIR       = join(CLAUDE_DIR, 'projects')
const SESSION_META_DIR   = join(CLAUDE_DIR, 'usage-data', 'session-meta')
const STATS_CACHE_FILE   = join(CLAUDE_DIR, 'stats-cache.json')

// ── ANSI ───────────────────────────────────────────────────────────────────

const ESC   = '\x1b'
const RESET = `${ESC}[0m`
const BOLD  = `${ESC}[1m`
const DIM   = `${ESC}[2m`
const CYAN  = `${ESC}[36m`
const GREEN = `${ESC}[32m`
const YELLOW = `${ESC}[33m`
const RED   = `${ESC}[31m`
const WHITE = `${ESC}[37m`
const BRIGHT_CYAN = `${ESC}[96m`

function clearScreen()  { process.stdout.write(`${ESC}[2J${ESC}[H`) }
function hideCursor()   { process.stdout.write(`${ESC}[?25l`) }
function showCursor()   { process.stdout.write(`${ESC}[?25h`) }
function visLen(s: string) { return s.replace(/\x1b\[[0-9;]*m/g, '').length }
function col(s: string, w: number, align: 'l' | 'r' = 'r') {
  const p = ' '.repeat(Math.max(0, w - visLen(s)))
  return align === 'l' ? s + p : p + s
}
function hr(w: number, ch = '─') { return `${DIM}${ch.repeat(w)}${RESET}` }

// ── Tipos ──────────────────────────────────────────────────────────────────

type ViewMode = 'separado' | 'junto' | 'ambos'

interface ProjectInfo { name: string; path: string }

interface CliSnapshot {
  messages: number; sessions: number
  inputTokens: number; outputTokens: number
  costUsd: number; streak: number
  gitCommits: number; gitPushes: number
  linesAdded: number; linesRemoved: number
}

interface StatsCache {
  dailyActivity?: Array<{ date: string; messageCount: number; sessionCount: number }>
  modelUsage?: Record<string, ModelUsage>
}

interface SessionMeta {
  session_id: string; project_path: string; start_time: string
  user_message_count: number; assistant_message_count: number
  git_commits: number; git_pushes: number
  input_tokens: number; output_tokens: number
  lines_added: number; lines_removed: number
}

interface WatchConfig {
  selectedProjects: ProjectInfo[]
  allProjects: ProjectInfo[]
  viewMode: ViewMode
  intervalSec: number
  otlpEndpoint: string
}

interface AppState {
  snapshots: Map<string, CliSnapshot>   // chave '' = all, ou project_path
  lastUpdated: Date
  animFrame: number
  showAnimation: boolean
  isLoadingData: boolean
}

// ── I/O helpers ────────────────────────────────────────────────────────────

async function safeReadJson<T>(f: string): Promise<T | null> {
  try { return JSON.parse(await readFile(f, 'utf-8')) as T } catch { return null }
}
async function safeReadDir(d: string): Promise<string[]> {
  try { return await readdir(d) } catch { return [] }
}

// ── Descoberta de projetos (mesma lógica do server.ts) ─────────────────────

function decodeProjectDir(dirName: string): string {
  if (dirName.startsWith('-')) return dirName.replace(/-/g, '/')
  return '/' + dirName.replace(/-/g, '/')
}

async function discoverProjects(): Promise<ProjectInfo[]> {
  // 1. Caminhos canônicos dos session-meta
  const metaFiles = (await safeReadDir(SESSION_META_DIR)).filter(f => f.endsWith('.json'))
  const metaPaths = new Set<string>()
  const BATCH = 30
  for (let i = 0; i < metaFiles.length; i += BATCH) {
    const res = await Promise.all(
      metaFiles.slice(i, i + BATCH).map(f =>
        safeReadJson<{ project_path?: string }>(join(SESSION_META_DIR, f))
      )
    )
    for (const s of res) if (s?.project_path) metaPaths.add(s.project_path)
  }

  // 2. Dirs em ~/.claude/projects/ como fallback (projetos sem session-meta)
  for (const dir of await safeReadDir(PROJECTS_DIR)) {
    if (!dir.startsWith('.')) {
      const decoded = decodeProjectDir(dir)
      if (!metaPaths.has(decoded)) metaPaths.add(decoded)
    }
  }

  return Array.from(metaPaths).sort().map(path => ({
    path,
    name: path.split('/').filter(Boolean).pop() ?? path,
  }))
}

// ── Cálculo de snapshot (espelha useDerivedStats) ──────────────────────────

function blendedCostPerToken(modelUsage: Record<string, ModelUsage>) {
  let tIn = 0, tOut = 0, tCR = 0, tCW = 0
  let wIn = 0, wOut = 0, wCR = 0, wCW = 0
  for (const [id, u] of Object.entries(modelUsage)) {
    const p = getModelPrice(id)
    tIn += u.inputTokens; tOut += u.outputTokens
    tCR += u.cacheReadInputTokens; tCW += u.cacheCreationInputTokens
    wIn += u.inputTokens * p.input; wOut += u.outputTokens * p.output
    wCR += u.cacheReadInputTokens * p.cacheRead; wCW += u.cacheCreationInputTokens * p.cacheWrite
  }
  return {
    input:      tIn  > 0 ? wIn  / tIn  : 3,
    output:     tOut > 0 ? wOut / tOut : 15,
    cacheRead:  tCR  > 0 ? wCR  / tCR  : 0.3,
    cacheWrite: tCW  > 0 ? wCW  / tCW  : 3.75,
  }
}

async function loadSessions(): Promise<SessionMeta[]> {
  const files = (await safeReadDir(SESSION_META_DIR)).filter(f => f.endsWith('.json'))
  const result: SessionMeta[] = []
  const BATCH = 30
  for (let i = 0; i < files.length; i += BATCH) {
    const res = await Promise.all(
      files.slice(i, i + BATCH).map(f => safeReadJson<SessionMeta>(join(SESSION_META_DIR, f)))
    )
    for (const s of res) if (s?.session_id) result.push(s)
  }
  return result
}

function computeSnapshot(
  allSessions: SessionMeta[],
  statsCache: StatsCache,
  projectFilter?: string[]
): CliSnapshot {
  const isFiltered = projectFilter !== undefined && projectFilter.length > 0
  const filtered   = isFiltered
    ? allSessions.filter(s => projectFilter!.includes(s.project_path))
    : allSessions

  const messages = isFiltered
    ? filtered.reduce((s, x) => s + (x.user_message_count ?? 0) + (x.assistant_message_count ?? 0), 0)
    : (statsCache.dailyActivity ?? []).reduce((s, d) => s + d.messageCount, 0)

  const sessions = isFiltered
    ? filtered.length
    : (statsCache.dailyActivity ?? []).reduce((s, d) => s + d.sessionCount, 0)

  const inputTokens  = filtered.reduce((s, x) => s + (x.input_tokens  ?? 0), 0)
  const outputTokens = filtered.reduce((s, x) => s + (x.output_tokens ?? 0), 0)
  const gitCommits   = filtered.reduce((s, x) => s + (x.git_commits   ?? 0), 0)
  const gitPushes    = filtered.reduce((s, x) => s + (x.git_pushes    ?? 0), 0)
  const linesAdded   = filtered.reduce((s, x) => s + (x.lines_added   ?? 0), 0)
  const linesRemoved = filtered.reduce((s, x) => s + (x.lines_removed ?? 0), 0)

  const modelUsage = statsCache.modelUsage ?? {}
  let costUsd = 0
  if (!isFiltered) {
    costUsd = Object.entries(modelUsage).reduce((s, [id, u]) => s + calcCost(u, id), 0)
  } else {
    const b = blendedCostPerToken(modelUsage)
    costUsd = (inputTokens / 1_000_000) * b.input + (outputTokens / 1_000_000) * b.output
  }

  const activeDates = new Set((statsCache.dailyActivity ?? []).map(d => d.date))
  let streak = 0
  for (let i = 0; i <= 365; i++) {
    const d = new Date(); d.setDate(d.getDate() - i)
    const ds = d.toISOString().slice(0, 10)
    if (activeDates.has(ds)) streak++
    else if (i > 0) break
  }

  return { messages, sessions, inputTokens, outputTokens, costUsd, streak, gitCommits, gitPushes, linesAdded, linesRemoved }
}

async function reloadAllSnapshots(config: WatchConfig): Promise<{
  snapshots: Map<string, CliSnapshot>
  lastUpdated: Date
}> {
  const [allSessions, statsCache] = await Promise.all([
    loadSessions(),
    safeReadJson<StatsCache>(STATS_CACHE_FILE).then(v => v ?? {}),
  ])

  const snapshots = new Map<string, CliSnapshot>()

  if (config.selectedProjects.length === 0) {
    // Todos os projetos
    snapshots.set('', computeSnapshot(allSessions, statsCache))
  } else {
    // Snapshot unificado dos selecionados
    snapshots.set('', computeSnapshot(allSessions, statsCache,
      config.selectedProjects.map(p => p.path)))
    // Snapshot individual por projeto
    for (const proj of config.selectedProjects) {
      snapshots.set(proj.path, computeSnapshot(allSessions, statsCache, [proj.path]))
    }
  }

  return { snapshots, lastUpdated: new Date() }
}

// ── Animação de batalha: Claude vs Cursor ──────────────────────────────────

const BATTLE_FRAMES: string[][] = [
  // 0 — idle (ambos de pé)
  [
    `   ${YELLOW}o${RESET}                     ${RED}o${RESET}   `,
    `  ${YELLOW}/|\\${RESET}   ${DIM}~ vs ~${RESET}     ${RED}/|\\${RESET}  `,
    `  ${YELLOW}/ \\${RESET}                   ${RED}/ \\${RESET}  `,
  ],
  // 1 — Claude carrega golpe
  [
    `  ${YELLOW}\\o/${RESET}                    ${RED}o${RESET}   `,
    `   ${YELLOW}|${RESET}    ${DIM}~ vs ~${RESET}      ${RED}/|\\${RESET}  `,
    `  ${YELLOW}/ \\${RESET}                   ${RED}/ \\${RESET}  `,
  ],
  // 2 — Claude lança golpe →
  [
    `   ${YELLOW}o${RESET}${BOLD}─────────────→${RESET}  ${RED}o${RESET}   `,
    `  ${YELLOW}─|─${RESET}                   ${RED}|${RESET}   `,
    `  ${YELLOW}/ \\${RESET}                  ${RED}/\\${RESET}   `,
  ],
  // 3 — Impacto! Cursor apanha
  [
    `   ${YELLOW}o${RESET}            ${GREEN}✦${RESET}  ${RED}*${RESET}    `,
    `  ${YELLOW}/|\\${RESET}               ${RED}\\${RESET}    `,
    `  ${YELLOW}/ \\${RESET}               ${RED}/${RESET}    `,
  ],
  // 4 — Cursor se recupera
  [
    `   ${YELLOW}o${RESET}                    ${RED}o${RESET}   `,
    `  ${YELLOW}/|\\${RESET}   ${DIM}~ vs ~${RESET}    ${RED}\\|/${RESET}   `,
    `  ${YELLOW}/ \\${RESET}                  ${RED}/\\${RESET}   `,
  ],
  // 5 — Cursor carrega contra-ataque
  [
    `   ${YELLOW}o${RESET}                   ${RED}\\o/${RESET}  `,
    `  ${YELLOW}/|\\${RESET}   ${DIM}~ vs ~${RESET}    ${RED}|${RESET}    `,
    `  ${YELLOW}/ \\${RESET}                  ${RED}/ \\${RESET}  `,
  ],
  // 6 — Cursor lança golpe ←
  [
    `   ${YELLOW}o${RESET}  ${RED}←─────────────${RESET}${RED}─|─${RESET}  `,
    `   ${YELLOW}|${RESET}                    ${RED}|${RESET}    `,
    `  ${YELLOW}/\\${RESET}                   ${RED}/ \\${RESET}  `,
  ],
  // 7 — Claude apanha
  [
    `  ${GREEN}✦${RESET} ${YELLOW}*${RESET}                   ${RED}o${RESET}    `,
    `    ${YELLOW}\\${RESET}                   ${RED}/|\\${RESET}  `,
    `    ${YELLOW}/                   ${RED}/ \\${RESET}  `,
  ],
]

const BATTLE_LABELS = [
  `${YELLOW}CLAUDE${RESET}              ${RED}CURSOR${RESET}`,
  `${YELLOW}CLAUDE${RESET}  ${DIM}se prepara...${RESET}  ${RED}CURSOR${RESET}`,
  `${YELLOW}CLAUDE${RESET}  ${GREEN}ATAQUE!${RESET}        ${RED}CURSOR${RESET}`,
  `${YELLOW}CLAUDE${RESET}  ${GREEN}CRÍTICO!${RESET}       ${RED}CURSOR${RESET}`,
  `${YELLOW}CLAUDE${RESET}              ${RED}CURSOR${RESET}`,
  `${YELLOW}CLAUDE${RESET}          ${DIM}se prepara...${RESET} ${RED}CURSOR${RESET}`,
  `${YELLOW}CLAUDE${RESET}       ${RED}CONTRA-ATAQUE!${RESET} ${RED}CURSOR${RESET}`,
  `${YELLOW}CLAUDE${RESET}  ${RED}LEVOU!${RESET}           ${RED}CURSOR${RESET}`,
]

function renderBattle(frame: number): string[] {
  const f = frame % BATTLE_FRAMES.length
  const lines = [
    `  ${DIM}┌───────────────────────────────────────────┐${RESET}`,
    `  ${DIM}│${RESET}${BATTLE_LABELS[f].padEnd(43)}${DIM}│${RESET}`,
    ...BATTLE_FRAMES[f].map(l => `  ${DIM}│${RESET}  ${l}${DIM}│${RESET}`),
    `  ${DIM}│${RESET}  ${DIM}[Ctrl+O para ocultar]${RESET}               ${DIM}│${RESET}`,
    `  ${DIM}└───────────────────────────────────────────┘${RESET}`,
  ]
  return lines
}

// ── Formatação de métricas ─────────────────────────────────────────────────

function fmtNum(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M'
  if (n >= 1_000)     return (n / 1_000).toFixed(1) + 'k'
  return n.toString()
}
function fmtCost(usd: number): string {
  if (usd >= 1000) return `$${(usd / 1000).toFixed(1)}k`
  if (usd >= 1)    return `$${usd.toFixed(2)}`
  return `$${usd.toFixed(3)}`
}

const METRIC_COLS = [
  { label: 'Msgs',     w: 8  },
  { label: 'Sessões',  w: 8  },
  { label: 'Tok↑',    w: 9  },
  { label: 'Tok↓',    w: 9  },
  { label: 'Custo',   w: 10 },
  { label: 'Streak',  w: 7  },
  { label: 'Commits', w: 8  },
  { label: '+Linhas', w: 9  },
  { label: '-Linhas', w: 9  },
]
const PROJECT_COL_W = 24

function tableHeader(withProject: boolean): string {
  const cells = METRIC_COLS.map(c => col(`${DIM}${c.label}${RESET}`, c.w))
  if (withProject) return col(`${DIM}Projeto${RESET}`, PROJECT_COL_W, 'l') + '  ' + cells.join('  ')
  return cells.join('  ')
}
function tableRow(snap: CliSnapshot, projectName?: string): string {
  const vals = [
    fmtNum(snap.messages), fmtNum(snap.sessions),
    fmtNum(snap.inputTokens), fmtNum(snap.outputTokens),
    fmtCost(snap.costUsd), `${snap.streak}d`,
    fmtNum(snap.gitCommits),
    `+${fmtNum(snap.linesAdded)}`, `-${fmtNum(snap.linesRemoved)}`,
  ]
  const cells = vals.map((v, i) => col(v, METRIC_COLS[i].w))
  if (projectName !== undefined) {
    const name = projectName.length > PROJECT_COL_W - 1
      ? projectName.slice(0, PROJECT_COL_W - 2) + '…'
      : projectName
    return col(`${CYAN}${name}${RESET}`, PROJECT_COL_W, 'l') + '  ' + cells.join('  ')
  }
  return cells.join('  ')
}

// ── Renderização do painel ─────────────────────────────────────────────────

function buildPanel(config: WatchConfig, state: AppState): string {
  const w = process.stdout.columns || 100
  const lines: string[] = []

  // Título
  const now    = state.lastUpdated.toLocaleTimeString('pt-BR')
  const loader = state.isLoadingData ? `${DIM} ⟳${RESET}` : ''
  const left   = `${BOLD}${BRIGHT_CYAN}Claude Stats — Watch Mode${RESET}`
  const right  = `${DIM}${now}  ⟳ ${config.intervalSec}s${loader}${RESET}`
  const gap    = Math.max(1, w - visLen(left.replace(/\x1b\[[0-9;]*m/g, '')) - visLen(right.replace(/\x1b\[[0-9;]*m/g, '')))
  lines.push(left + ' '.repeat(gap) + right)
  lines.push(hr(w))
  lines.push('')

  // Animação (se visível)
  if (state.showAnimation) {
    lines.push(...renderBattle(state.animFrame))
    lines.push('')
  }

  // Bloco de info
  const modeDesc = config.viewMode === 'junto' ? 'unificado'
    : config.viewMode === 'separado' ? 'separado' : 'ambos'

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
  lines.push(`  ${DIM}OTLP:${RESET}       ${config.otlpEndpoint ? `${GREEN}${config.otlpEndpoint}${RESET}` : `${DIM}(disabled)${RESET}`}`)
  lines.push('')

  // Tabela de métricas
  const singleView = config.selectedProjects.length <= 1
  const allSnap    = state.snapshots.get('')

  if (singleView || config.viewMode === 'junto') {
    lines.push(hr(w))
    if (!singleView) lines.push(`  ${BOLD}${CYAN}UNIFICADO${RESET}`)
    lines.push('')
    lines.push('  ' + tableHeader(false))
    lines.push(`  ${GREEN}${BOLD}${allSnap ? tableRow(allSnap) : '  (carregando...)'}${RESET}`)
    lines.push(hr(w))
  } else if (config.viewMode === 'separado') {
    lines.push(hr(w))
    lines.push(`  ${BOLD}${CYAN}POR PROJETO${RESET}`)
    lines.push('')
    lines.push('  ' + tableHeader(true))
    for (const proj of config.selectedProjects) {
      const snap = state.snapshots.get(proj.path)
      lines.push('  ' + (snap ? tableRow(snap, proj.name) : `  ${DIM}${proj.name}  (carregando...)${RESET}`))
    }
    lines.push(hr(w))
  } else {
    // ambos
    lines.push(hr(w))
    lines.push(`  ${BOLD}${CYAN}UNIFICADO${RESET}`)
    lines.push('')
    lines.push('  ' + tableHeader(false))
    lines.push(`  ${GREEN}${BOLD}${allSnap ? tableRow(allSnap) : '  (carregando...)'}${RESET}`)
    lines.push('')
    lines.push(`  ${BOLD}${CYAN}POR PROJETO${RESET}`)
    lines.push('')
    lines.push('  ' + tableHeader(true))
    for (const proj of config.selectedProjects) {
      const snap = state.snapshots.get(proj.path)
      lines.push('  ' + (snap ? tableRow(snap, proj.name) : `  ${DIM}${proj.name}  (carregando...)${RESET}`))
    }
    lines.push(hr(w))
  }

  lines.push('')
  lines.push(`  ${DIM}Ctrl+C sair  |  Ctrl+O ${state.showAnimation ? 'ocultar' : 'mostrar'} batalha${RESET}`)

  return lines.join('\n') + '\n'
}

// ── Watch loop ─────────────────────────────────────────────────────────────

async function watchLoop(config: WatchConfig): Promise<void> {
  hideCursor()

  const state: AppState = {
    snapshots: new Map(),
    lastUpdated: new Date(),
    animFrame: 0,
    showAnimation: true,
    isLoadingData: true,
  }

  // Limpa + redesenha no lugar (sem append)
  const render = () => {
    clearScreen()
    process.stdout.write(buildPanel(config, state))
  }

  // Reload pesado de dados do disco
  let reloading = false
  const reloadData = async () => {
    if (reloading) return
    reloading = true
    state.isLoadingData = true
    try {
      const { snapshots, lastUpdated } = await reloadAllSnapshots(config)
      state.snapshots   = snapshots
      state.lastUpdated = lastUpdated
    } catch { /* mantém snapshot anterior */ }
    finally {
      state.isLoadingData = false
      reloading = false
    }
    render()
  }

  // Carregamento inicial
  await reloadData()

  // Teclado: Ctrl+O toggle animação, Ctrl+C sair
  if (process.stdin.isTTY) {
    process.stdin.setRawMode(true)
    process.stdin.resume()
    process.stdin.on('data', (buf: Buffer) => {
      const ch = buf[0]
      if (ch === 3) {                      // Ctrl+C
        showCursor()
        clearScreen()
        process.exit(0)
      } else if (ch === 15) {              // Ctrl+O
        state.showAnimation = !state.showAnimation
        render()
      }
    })
  } else {
    process.on('SIGINT',  () => { showCursor(); clearScreen(); process.exit(0) })
    process.on('SIGTERM', () => { showCursor(); clearScreen(); process.exit(0) })
  }

  // Timer de animação (200ms) — só redesenha, não relê disco
  const ANIM_INTERVAL = 200
  setInterval(() => {
    state.animFrame++
    render()
  }, ANIM_INTERVAL)

  // Timer de dados (configurable)
  setInterval(reloadData, config.intervalSec * 1000)

  // Chokidar: reload imediato em mudanças de arquivo (debounce 1.5s)
  let debounceTimer: ReturnType<typeof setTimeout> | null = null
  chokidar
    .watch([SESSION_META_DIR, STATS_CACHE_FILE], { persistent: true, ignoreInitial: true })
    .on('all', () => {
      if (debounceTimer) clearTimeout(debounceTimer)
      debounceTimer = setTimeout(reloadData, 1500)
    })
}

// ── Custom prompt: checkbox com busca reativa ──────────────────────────────

interface CheckboxChoice { name: string; value: string; path: string }

/** KeypressEvent estendido com os campos extras do readline de Node.js */
type RlKeypress = KeypressEvent & { meta?: boolean; sequence?: string }

const checkboxWithSearch = createPrompt<string[], {
  message: string
  choices: ReadonlyArray<CheckboxChoice>
  pageSize?: number
}>((config, done) => {
  const [searchTerm, setSearchTerm] = useState('')
  const [active, setActive]         = useState(0)
  const [checked, setChecked]       = useState<ReadonlyArray<string>>([])

  const filtered = useMemo(
    () => {
      const t = searchTerm.toLowerCase()
      if (!t) return config.choices
      return config.choices.filter(c =>
        c.name.toLowerCase().includes(t) || c.path.toLowerCase().includes(t)
      )
    },
    [searchTerm]
  )

  useKeypress((key) => {
    const k = key as RlKeypress
    if (isEnterKey(k)) { done([...checked]); return }

    const len = filtered.length
    if (isUpKey(k)) {
      setActive(active === 0 ? Math.max(0, len - 1) : active - 1)
    } else if (isDownKey(k)) {
      setActive(active >= len - 1 ? 0 : active + 1)
    } else if (isSpaceKey(k)) {
      const item = filtered[active]
      if (!item) return
      const s = new Set(checked)
      if (s.has(item.value)) s.delete(item.value)
      else s.add(item.value)
      setChecked(Array.from(s))
    } else if (isBackspaceKey(k)) {
      setSearchTerm(searchTerm.slice(0, -1))
      setActive(0)
    } else if (!k.ctrl && !k.meta && k.sequence?.length === 1 && k.sequence.charCodeAt(0) >= 32) {
      setSearchTerm(searchTerm + k.sequence)
      setActive(0)
    }
  })

  const checkedSet = new Set(checked)

  const pageView = usePagination({
    items:    filtered as CheckboxChoice[],
    active,
    pageSize: config.pageSize ?? 16,
    loop:     false,
    renderItem: ({ item, isActive }) => {
      const cursor  = isActive ? `${CYAN}❯${RESET}` : ' '
      const box     = checkedSet.has(item.value) ? `${GREEN}◉${RESET}` : `${DIM}◯${RESET}`
      const nameStr = checkedSet.has(item.value) ? `${GREEN}${item.name}${RESET}` : item.name
      return ` ${cursor} ${box}  ${nameStr}  ${DIM}${item.path}${RESET}`
    },
  })

  const cursorBlock   = `${ESC}[7m ${RESET}`
  const searchDisplay = `${DIM}[Buscar]${RESET} ${BOLD}${searchTerm}${RESET}${cursorBlock}`

  const checkedNames = checked
    .map(v => config.choices.find(c => c.value === v)?.name ?? v)
    .join(', ')

  const selectedLine = checked.length > 0
    ? `\n  ${DIM}Selecionados: ${RESET}${GREEN}${checkedNames}${RESET}`
    : `\n  ${DIM}(nenhum = todos os projetos)${RESET}`

  return (
    `${BOLD}${config.message}${RESET}\n  ${searchDisplay}\n\n` +
    pageView +
    selectedLine +
    `\n  ${DIM}↑↓ navegar  ⎵ selecionar  ⏎ confirmar  Backspace apaga busca${RESET}`
  )
})

// ── Configuração inicial via prompts ───────────────────────────────────────

async function askConfig(allProjects: ProjectInfo[]): Promise<WatchConfig> {
  // 1. Intervalo
  const intervalStr = await input({
    message: `Intervalo de atualização (segundos):`,
    default: '30',
    validate: (v) => {
      const n = parseInt(v, 10)
      if (!Number.isFinite(n) || n < 5) return 'Mínimo 5 segundos'
      return true
    },
  })
  const intervalSec = parseInt(intervalStr, 10)

  // 2. OTLP endpoint
  const otlpEndpoint = await input({
    message: 'OTLP endpoint (vazio para desativar):',
    default: process.env.OTEL_EXPORTER_OTLP_ENDPOINT ?? '',
  })

  // 3. Seleção de projetos com busca
  const selectedPaths = await checkboxWithSearch({
    message: 'Selecione os projetos para monitorar:',
    choices: allProjects.map(p => ({ name: p.name, value: p.path, path: p.path })),
    pageSize: Math.min(20, allProjects.length),
  })

  const selectedProjects = selectedPaths.length === 0
    ? []
    : allProjects.filter(p => selectedPaths.includes(p.path))

  // 4. Modo de visualização (só se múltiplos selecionados)
  let viewMode: ViewMode = 'junto'
  if (selectedProjects.length > 1) {
    viewMode = await select<ViewMode>({
      message: 'Como deseja visualizar os dados?',
      choices: [
        { name: `${BOLD}Separado${RESET}  — uma linha por projeto`,             value: 'separado', short: 'separado'  },
        { name: `${BOLD}Unificado${RESET} — total dos projetos selecionados`,   value: 'junto',    short: 'unificado' },
        { name: `${BOLD}Ambos${RESET}     — total no topo + uma linha/projeto`, value: 'ambos',    short: 'ambos'     },
      ],
    })
  }

  return { selectedProjects, allProjects, viewMode, intervalSec, otlpEndpoint }
}

// ── Entry point ────────────────────────────────────────────────────────────

async function main() {
  console.log(`\n${BOLD}${BRIGHT_CYAN}Claude Stats — Watch CLI${RESET}\n`)
  console.log(`${DIM}Descobrindo projetos...${RESET}`)

  const allProjects = await discoverProjects()
  if (allProjects.length === 0) {
    console.error(`\nNenhum projeto encontrado em:\n  ${SESSION_META_DIR}\n  ${PROJECTS_DIR}`)
    process.exit(1)
  }
  console.log(`${GREEN}${allProjects.length} projetos encontrados.${RESET}\n`)

  const config = await askConfig(allProjects)
  await watchLoop(config)
}

main().catch(err => {
  showCursor()
  console.error('Erro fatal:', err)
  process.exit(1)
})
