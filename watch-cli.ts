#!/usr/bin/env bun
/**
 * Claude Stats — Watch CLI
 *
 * Usa os mesmos dados que o frontend (via /api/data quando o servidor está rodando,
 * ou leitura direta de arquivos como fallback).
 *
 * Controles:
 *   Ctrl+O  — batalha on/off
 *   Ctrl+C  — sair
 */

import { join } from 'path'
import chokidar from 'chokidar'
import {
  createPrompt, useState, useMemo, useKeypress, usePagination,
  isUpKey, isDownKey, isEnterKey, isSpaceKey, isBackspaceKey,
  type KeypressEvent,
} from '@inquirer/core'
import { select, input, confirm } from '@inquirer/prompts'
import { calcCost, getModelPrice } from './src/lib/types'
import type { ModelUsage, SessionMeta } from './src/lib/types'

// ── Paths ──────────────────────────────────────────────────────────────────

const HOME_DIR    = process.env.HOME ?? process.env.USERPROFILE ?? ''
const CLAUDE_DIR  = join(HOME_DIR, '.claude')
const API_BASE    = 'http://localhost:3001'
const SESSION_START = Date.now()

function showGoodbye(opts?: {
  messages: number; streak: number; costUsd: number
  projects: string[]
}): void {
  const secs = Math.floor((Date.now() - SESSION_START) / 1000)
  const dur  = secs >= 60 ? `${Math.floor(secs/60)}m ${secs%60}s` : `${secs}s`
  const fmtN = (n: number) => n >= 1000 ? (n/1000).toFixed(1)+'k' : String(n)
  const lines: string[] = []
  lines.push('')
  lines.push(`  ${AM}${B}agentop${R}  ${D}·  watch mode${R}`)
  lines.push('')
  lines.push(`  ${D}sessão:   ${R}${WH}${dur}${R}`)
  if (opts) {
    const proj = opts.projects.length > 0 ? opts.projects.join(', ') : 'todos'
    lines.push(`  ${D}projeto:  ${R}${WH}${proj}${R}`)
    lines.push(`  ${D}streak:   ${R}${WH}${opts.streak}d${R}`)
    lines.push(`  ${D}msgs:     ${R}${WH}${fmtN(opts.messages)}${R}`)
    lines.push(`  ${D}custo:    ${R}${WH}$${opts.costUsd.toFixed(2)}${R}`)
  }
  lines.push('')
  lines.push(`  ${D}até logo  ${AM}✦${R}`)
  lines.push('')
  process.stdout.write(lines.join('\n') + '\n')
}

// ── ANSI ───────────────────────────────────────────────────────────────────

const E = '\x1b'
const R  = `${E}[0m`
const B  = `${E}[1m`
const D  = `${E}[2m`
// Web dark-mode palette mapped to terminal
const AM = `${E}[38;5;208m`  // orange/amber   — PRIMARY accent (#f59e0b / Anthropic brand)
const VI = `${E}[38;5;135m`  // violet/indigo  — secondary accent (#6366f1)
const EM = `${E}[92m`        // emerald green  — success/active (#10b981)
const RS = `${E}[38;5;204m`  // rose           — error (#f43f5e)
const CY = `${E}[36m`        // cyan            — tertiary accent
const GR = `${E}[32m`        // green           — kept for compat
const YL = `${E}[33m`        // yellow          — kept for compat
const RD = `${E}[31m`        // red             — kept for compat
const WH = `${E}[97m`        // bright white    — primary text
const BC = `${E}[96m`        // bright cyan     — highlights

const ALT_ON  = `${E}[?1049h`
const ALT_OFF = `${E}[?1049l`
const CLR     = `${E}[2J${E}[H`
const HIDE    = `${E}[?25l`
const SHOW    = `${E}[?25h`

const out     = (s: string) => process.stdout.write(s)
const visLen  = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, '').length
const padStr  = (s: string, w: number, align: 'l'|'r' = 'r') => {
  const p = ' '.repeat(Math.max(0, w - visLen(s)))
  return align === 'l' ? s + p : p + s
}
const sepLine = (w: number) => `${D}${'-'.repeat(w)}${R}`

// ── Tipos ──────────────────────────────────────────────────────────────────

type ViewMode = 'separado' | 'junto' | 'ambos'
type DataSrc  = 'api' | 'files'

interface ProjectInfo { name: string; path: string }

interface WatchConfig {
  selectedProjects: ProjectInfo[]
  allProjects: ProjectInfo[]
  viewMode: ViewMode
  intervalSec: number
  otlpEndpoint: string
  showAnim: boolean
}

interface CliSnapshot {
  messages: number; sessions: number
  inputTokens: number; outputTokens: number
  costUsd: number; streak: number
  gitCommits: number; linesAdded: number; linesRemoved: number
}

interface StatsCache {
  dailyActivity?: Array<{ date: string; messageCount: number; sessionCount: number }>
  modelUsage?: Record<string, ModelUsage>
}

interface AppState {
  snapshots:   Map<string, CliSnapshot>
  lastUpdated: Date
  animFrame:   number
  showAnim:    boolean
  isLoading:   boolean
  dataSource:  DataSrc
}

// ── API ────────────────────────────────────────────────────────────────────

interface ApiProject {
  path: string
  name: string
  git_stats?: {
    commits: number
    lines_added: number
    lines_removed: number
    files_modified: number
    since: string
  }
}
interface ApiResponse {
  statsCache: StatsCache
  projects:   ApiProject[]
  sessions:   SessionMeta[]
}

async function fetchApi(timeout = 3000): Promise<ApiResponse | null> {
  try {
    const ac  = new AbortController()
    const tid = setTimeout(() => ac.abort(), timeout)
    const res = await fetch(`${API_BASE}/api/data`, { signal: ac.signal })
    clearTimeout(tid)
    if (!res.ok) return null
    return await res.json() as ApiResponse
  } catch {
    return null
  }
}

/** Probe leve — verifica se o servidor está aceitando conexões.
 *  Aceita qualquer resposta HTTP (incluindo 404 de versões antigas sem /api/health). */
async function probeApi(timeout = 1000): Promise<boolean> {
  try {
    const ac  = new AbortController()
    const tid = setTimeout(() => ac.abort(), timeout)
    const res = await fetch(`${API_BASE}/api/health`, { signal: ac.signal })
    clearTimeout(tid)
    return res.status < 500 // 200 (novo) ou 404 (versao sem endpoint) = servidor on
  } catch {
    return false
  }
}


// ── Cálculo de snapshot — espelha useDerivedStats ─────────────────────────

function blendedCost(mu: Record<string, ModelUsage>) {
  let tIn = 0, tOut = 0, tCR = 0, tCW = 0
  let wIn = 0, wOut = 0, wCR = 0, wCW = 0
  for (const [id, u] of Object.entries(mu)) {
    const p = getModelPrice(id)
    tIn  += u.inputTokens;               tOut += u.outputTokens
    tCR  += u.cacheReadInputTokens;      tCW  += u.cacheCreationInputTokens
    wIn  += u.inputTokens * p.input;     wOut += u.outputTokens * p.output
    wCR  += u.cacheReadInputTokens * p.cacheRead
    wCW  += u.cacheCreationInputTokens  * p.cacheWrite
  }
  return {
    input:      tIn  > 0 ? wIn  / tIn  : 3,
    output:     tOut > 0 ? wOut / tOut : 15,
    cacheRead:  tCR  > 0 ? wCR  / tCR  : 0.3,
    cacheWrite: tCW  > 0 ? wCW  / tCW  : 3.75,
  }
}

function computeSnapshot(
  sessions:   SessionMeta[],
  statsCache: StatsCache,
  projects:   ApiProject[],
  filter?:    string[]
): CliSnapshot {
  const isF  = !!(filter?.length)
  const filt = isF ? sessions.filter(s => filter!.includes(s.project_path)) : sessions
  const daily = statsCache.dailyActivity ?? []
  const mu    = statsCache.modelUsage ?? {}

  // ── Messages/sessions — mirrors useDerivedStats exactly ──
  //   with filter    → sum filtered sessions
  //   without filter → extendedDailyActivity (statsCache + sessions on days not yet cached)
  let messages: number
  let sessCnt:  number
  if (isF) {
    messages = filt.reduce((s, x) => s + (x.user_message_count ?? 0) + (x.assistant_message_count ?? 0), 0)
    sessCnt  = filt.length
  } else {
    const dailyDates = new Set(daily.map(d => d.date))
    const supplementByDay: Record<string, { messageCount: number; sessionCount: number }> = {}
    for (const s of sessions) {
      if (!s.start_time) continue
      const day = s.start_time.slice(0, 10)
      if (dailyDates.has(day)) continue
      if (!supplementByDay[day]) supplementByDay[day] = { messageCount: 0, sessionCount: 0 }
      supplementByDay[day].messageCount += (s.user_message_count ?? 0) + (s.assistant_message_count ?? 0)
      supplementByDay[day].sessionCount += 1
    }
    const extended = [
      ...daily,
      ...Object.entries(supplementByDay).map(([date, v]) => ({ date, ...v })),
    ]
    messages = extended.reduce((s, d) => s + d.messageCount, 0)
    sessCnt  = extended.reduce((s, d) => s + d.sessionCount, 0)
  }

  // ── Tokens — always from filtered sessions ──
  const inTok  = filt.reduce((s, x) => s + (x.input_tokens  ?? 0), 0)
  const outTok = filt.reduce((s, x) => s + (x.output_tokens ?? 0), 0)

  // ── Cost — mirrors useDerivedStats ──
  let cost = 0
  if (!isF) {
    cost = Object.entries(mu).reduce((s, [id, u]) => s + calcCost(u, id), 0)
  } else {
    const b = blendedCost(mu)
    cost = (inTok / 1_000_000) * b.input + (outTok / 1_000_000) * b.output
  }

  // ── Streak — mirrors useDerivedStats exactly ──
  //   with filter    → active dates from filtered sessions only
  //   without filter → union of dailyActivity dates + ALL session dates (covers stale statsCache)
  const activeDates = isF
    ? new Set(filt.filter(s => s.start_time).map(s => s.start_time.slice(0, 10)))
    : new Set([
        ...daily.map(d => d.date),
        ...sessions.filter(s => s.start_time).map(s => s.start_time.slice(0, 10)),
      ])
  let streak = 0
  for (let i = 0; i <= 365; i++) {
    const d = new Date(); d.setDate(d.getDate() - i)
    if (activeDates.has(d.toISOString().slice(0, 10))) streak++
    else if (i > 0) break
  }

  // ── Git stats — mirrors useDerivedStats: use project git_stats when exactly 1 project ──
  //   (project-level git counts are more accurate than summing session fields)
  const singleProjectGitStats = isF && filter!.length === 1
    ? projects.find(p => p.path === filter![0])?.git_stats
    : undefined
  const gC = singleProjectGitStats
    ? singleProjectGitStats.commits
    : filt.reduce((s, x) => s + (x.git_commits   ?? 0), 0)
  const lA = singleProjectGitStats
    ? singleProjectGitStats.lines_added
    : filt.reduce((s, x) => s + (x.lines_added   ?? 0), 0)
  const lR = singleProjectGitStats
    ? singleProjectGitStats.lines_removed
    : filt.reduce((s, x) => s + (x.lines_removed ?? 0), 0)

  return { messages, sessions: sessCnt, inputTokens: inTok, outputTokens: outTok,
    costUsd: cost, streak, gitCommits: gC, linesAdded: lA, linesRemoved: lR }
}

// ── Reload de dados (apenas via API) ──────────────────────────────────────

async function reloadData(config: WatchConfig): Promise<{
  snapshots: Map<string, CliSnapshot>
  dataSource: DataSrc
}> {
  const paths     = config.selectedProjects.length > 0 ? config.selectedProjects.map(p => p.path) : undefined
  const snapshots = new Map<string, CliSnapshot>()

  const apiData = await fetchApi(30_000)
  if (!apiData) throw new Error('API indisponivel')

  const { sessions, statsCache, projects } = apiData
  snapshots.set('', computeSnapshot(sessions, statsCache, projects, paths))
  for (const p of config.selectedProjects) {
    snapshots.set(p.path, computeSnapshot(sessions, statsCache, projects, [p.path]))
  }
  return { snapshots, dataSource: 'api' }
}

// ── Loader ─────────────────────────────────────────────────────────────────
// Braille spinner + gradient wave bar scrolling.
// 7 linhas fixas, reescritas via cursor-up a cada 80ms.

async function withLoader<T>(msg: string, fn: () => Promise<T>): Promise<T> {
  if (!process.stdout.isTTY) return fn()

  const H     = 8
  const W     = Math.min((process.stdout.columns || 80) - 2, 94)
  const BAR_W = W - 2

  // Gradient wave: trough → peak → trough, repeated twice for seamless wrap
  const WAVE = '░░░▒▒▓▓███▓▓▒▒░░░░░▒▒▓▓███▓▓▒▒░░░'

  let frame = 0

  const draw = () => {
    // Scroll wave left — offset grows each frame
    const off  = (frame * 1) % WAVE.length
    const raw  = (WAVE + WAVE + WAVE).slice(off, off + BAR_W)

    // Apply color gradient: bright at peaks, dim at troughs
    const bar = raw.split('').map(c =>
      c === '█' ? `${B}${AM}█${R}`
      : c === '▓' ? `${AM}▓${R}`
      : c === '▒' ? `${D}${AM}▒${R}`
      : `${D}░${R}`
    ).join('')

    const sep = `${D}${'─'.repeat(BAR_W)}${R}`

    out(`\x1b[${H}A`)
    out(`\n`)
    out(`  ${sep}\n`)
    out(`  ${B}agentop${R}  ${D}·  session pipeline${R}\n`)
    out(`\n`)
    out(`  ${bar}\n`)
    out(`\n`)
    out(`  ${D}▸${R}  ${D}${msg}${R}\n`)
    out(`  ${sep}\n`)
  }

  out('\n'.repeat(H))
  draw()
  const timer = setInterval(() => { frame++; draw() }, 80)

  try {
    return await fn()
  } finally {
    clearInterval(timer)
    out(`\x1b[${H}A`)
    for (let i = 0; i < H; i++) out('\x1b[2K\n')
    out(`\x1b[${H}A`)
  }
}

// ── Animação: Neural Wave ─────────────────────────────────────────────────
// Visualiza um forward-pass num transformer: onda de ativação atravessando
// 3 "camadas de atenção" em paralelo, da esquerda (input) para a direita (output).
// Dinâmica — calculada a partir de `frame` sem array estático.

const FW = 44

const fp = (s: string) => s + ' '.repeat(Math.max(0, FW - visLen(s)))

const ANIM_N     = 12  // nós por linha
const ANIM_CYCLE = ANIM_N + 4  // frames por ciclo (2 hold + N + 2 hold)

// Offset de fase por linha — simula attention heads independentes
const ROW_OFFSETS = [0, -1, 1]

// Labels por posição da onda (t = posição no ciclo 0..ANIM_CYCLE-1)
const ANIM_LABELS: Record<number, string> = {
  0: 'awaiting input…',    1: 'awaiting input…',
  2: 'encoding context…',  3: 'encoding context…',
  4: 'computing attention…', 5: 'computing attention…',
  6: 'generating tokens…', 7: 'generating tokens…',
  8: 'decoding output…',   9: 'decoding output…',
  10: 'response ready  ✦', 11: 'response ready  ✦',
  12: 'response ready  ✦', 13: 'response ready  ✦',
  14: 'response ready  ✦', 15: 'response ready  ✦',
}

function renderAnim(frame: number): string[] {
  const sep   = sepLine(FW + 4)
  const t     = frame % ANIM_CYCLE                      // 0 … ANIM_CYCLE-1
  const wPos  = t - 2                                   // wave front: -2 … N+1

  const rows = ROW_OFFSETS.map(off => {
    const w = wPos + off
    const nodes = Array.from({ length: ANIM_N }, (_, i) => {
      if (i > w)       return `${D}·${R}`               // not reached
      if (i === w)     return `${B}${AM}◉${R}`          // active front (orange)
      if (i === w - 1) return `${VI}◌${R}`              // trailing edge (violet)
      return `${D}○${R}`                                // processed (dim)
    }).join(' ')
    return fp(`  ${nodes}`)
  })

  const label = ANIM_LABELS[t] ?? '…'
  return [
    sep,
    ...rows,
    fp(`  ${D}${label}${R}`),
    `  ${D}[Ctrl+O ocultar]${R}`,
    sep,
  ]
}

// ── Tabela de métricas ─────────────────────────────────────────────────────

const fmtN = (n: number) =>
  n >= 1_000_000 ? (n/1e6).toFixed(1)+'M' : n >= 1_000 ? (n/1e3).toFixed(1)+'k' : String(n)
const fmtC = (u: number) =>
  u >= 1000 ? `$${(u/1000).toFixed(1)}k` : u >= 1 ? `$${u.toFixed(2)}` : `$${u.toFixed(3)}`

const COLS = [
  {h:'Msgs',    w:8}, {h:'Sessoes', w:8},
  {h:'Tok-In',  w:9}, {h:'Tok-Out', w:9},
  {h:'Custo',  w:10}, {h:'Streak',  w:7},
  {h:'Commits', w:8}, {h:'+Linhas', w:9}, {h:'-Linhas', w:9},
]
const PW = 24

const tHdr = (proj: boolean) => {
  const c = COLS.map(c => padStr(`${D}${c.h}${R}`, c.w))
  return (proj ? padStr(`${D}Projeto${R}`, PW, 'l')+'  ' : '') + c.join('  ')
}
const tRow = (s: CliSnapshot, name?: string) => {
  const v = [
    fmtN(s.messages), fmtN(s.sessions), fmtN(s.inputTokens), fmtN(s.outputTokens),
    fmtC(s.costUsd), `${s.streak}d`, fmtN(s.gitCommits),
    `+${fmtN(s.linesAdded)}`, `-${fmtN(s.linesRemoved)}`,
  ]
  const c = v.map((x, i) => padStr(`${AM}${x}${R}`, COLS[i]!.w))
  if (name !== undefined) {
    const n = name.length > PW-1 ? name.slice(0, PW-2)+'…' : name
    return padStr(`${AM}${n}${R}`, PW, 'l')+'  '+c.join('  ')
  }
  return c.join('  ')
}

// ── Painel ─────────────────────────────────────────────────────────────────

function buildPanel(cfg: WatchConfig, st: AppState): string {
  const W = process.stdout.columns || 100
  const lines: string[] = []

  // Cabeçalho
  const ts     = st.lastUpdated.toLocaleTimeString('pt-BR')
  const src    = st.dataSource === 'api' ? `${D}api${R}` : `${YL}files${R}`
  const right  = `${D}${ts}  ${R}${src}${D}  refresh: ${cfg.intervalSec}s${R}`
  const left   = `${B}${AM}Claude Stats${R}${D} · ${R}${B}Watch Mode${R}`
  const gap    = Math.max(1, W - visLen('Claude Stats - Watch Mode') - visLen(ts) - visLen('  api  refresh: XXs'))
  lines.push(left + ' '.repeat(gap) + right)
  lines.push(sepLine(W))
  lines.push('')

  // Animação (se ativa)
  if (st.showAnim) { lines.push(...renderAnim(st.animFrame)); lines.push('') }

  // Bloco info
  const mode = cfg.viewMode === 'junto' ? 'unificado' : cfg.viewMode === 'separado' ? 'separado' : 'ambos'
  lines.push(`  ${D}Home:${R}       ${WH}${HOME_DIR}${R}`)
  lines.push(`  ${D}Claude dir:${R} ${WH}${CLAUDE_DIR}${R}`)
  if (cfg.selectedProjects.length === 0) {
    lines.push(`  ${D}Projetos:${R}   ${AM}todos (${cfg.allProjects.length})${R}`)
  } else {
    lines.push(`  ${D}Projetos:${R}   ${AM}${cfg.selectedProjects.map(p=>p.name).join(', ')}${R}`)
  }
  if (cfg.selectedProjects.length > 1) lines.push(`  ${D}Modo:${R}       ${WH}${mode}${R}`)
  lines.push(`  ${D}Interval:${R}   ${WH}${cfg.intervalSec}s${R}`)
  lines.push(`  ${D}OTLP:${R}       ${cfg.otlpEndpoint ? `${WH}${cfg.otlpEndpoint}${R}` : `${D}(disabled)${R}`}`)
  lines.push('')

  // Tabela
  const solo = cfg.selectedProjects.length <= 1
  const all  = st.snapshots.get('')
  // Enquanto não há dados: exibe zeros em cada coluna + mensagem discreta
  const zeroSnap = { messages:0, sessions:0, inputTokens:0, outputTokens:0,
    costUsd:0, streak:0, gitCommits:0, linesAdded:0, linesRemoved:0 }
  const ldg = `${tRow(zeroSnap)}  ${D}obtendo dados...${R}`

  if (solo || cfg.viewMode === 'junto') {
    lines.push(sepLine(W))
    if (!solo) lines.push(`  ${B}${AM}UNIFICADO${R}`)
    lines.push('')
    lines.push('  ' + tHdr(false))
    lines.push(`  ${WH}${all ? tRow(all) : ldg}${R}`)
    lines.push(sepLine(W))
  } else if (cfg.viewMode === 'separado') {
    lines.push(sepLine(W))
    lines.push(`  ${B}${AM}POR PROJETO${R}`)
    lines.push('')
    lines.push('  ' + tHdr(true))
    for (const p of cfg.selectedProjects) {
      const s = st.snapshots.get(p.path)
      lines.push('  ' + (s ? tRow(s, p.name) : ldg))
    }
    lines.push(sepLine(W))
  } else {
    lines.push(sepLine(W))
    lines.push(`  ${B}${AM}UNIFICADO${R}`)
    lines.push('')
    lines.push('  ' + tHdr(false))
    lines.push(`  ${WH}${all ? tRow(all) : ldg}${R}`)
    lines.push('')
    lines.push(`  ${B}${AM}POR PROJETO${R}`)
    lines.push('')
    lines.push('  ' + tHdr(true))
    for (const p of cfg.selectedProjects) {
      const s = st.snapshots.get(p.path)
      lines.push('  ' + (s ? tRow(s, p.name) : ldg))
    }
    lines.push(sepLine(W))
  }

  lines.push('')
  lines.push(`  ${D}Ctrl+C sair  |  Ctrl+O ${st.showAnim ? 'ocultar' : 'mostrar'} animação${R}`)
  return lines.join('\n') + '\n'
}

// ── Watch loop ─────────────────────────────────────────────────────────────

async function watchLoop(cfg: WatchConfig): Promise<void> {
  const st: AppState = {
    snapshots: new Map(), lastUpdated: new Date(),
    animFrame: 0, showAnim: cfg.showAnim, isLoading: true, dataSource: 'api' as DataSrc,
  }

  const cleanup = () => {
    out(SHOW + ALT_OFF + CLR)
    const snap = st.snapshots.get('')
    showGoodbye(snap ? {
      messages: snap.messages, streak: snap.streak, costUsd: snap.costUsd,
      projects: cfg.selectedProjects.map(p => p.name),
    } : undefined)
    if (spawnedServer) { spawnedServer.kill(); spawnedServer = null }
    process.exit(0)
  }
  out(ALT_ON + HIDE)

  const render = () => { out(CLR + buildPanel(cfg, st)) }

  // Render imediato — mostra painel de loading antes de qualquer fetch
  render()

  let reloading = false
  const refresh = async () => {
    if (reloading) return
    reloading = true; st.isLoading = true
    try {
      const { snapshots, dataSource } = await reloadData(cfg)
      st.snapshots = snapshots; st.dataSource = dataSource
      st.lastUpdated = new Date()
    } catch { /* mantém anterior */ }
    finally { st.isLoading = false; reloading = false }
    render()
  }

  await refresh()

  if (process.stdin.isTTY) {
    process.stdin.setRawMode(true); process.stdin.resume()
    process.stdin.on('data', (buf: Buffer) => {
      if (buf[0] === 3)  cleanup()
      if (buf[0] === 15) { st.showAnim = !st.showAnim; render() }
    })
  } else {
    process.on('SIGINT', cleanup); process.on('SIGTERM', cleanup)
  }

  // Timer de animação (200ms, sem I/O)
  setInterval(() => { st.animFrame++; render() }, 200)

  // Timer de dados
  setInterval(refresh, cfg.intervalSec * 1000)

  // Chokidar para atualizações imediatas
  let dbt: ReturnType<typeof setTimeout> | null = null
  const sessionMetaDir = join(HOME_DIR, '.claude', 'usage-data', 'session-meta')
  const statsCacheFile = join(HOME_DIR, '.claude', 'stats-cache.json')
  chokidar
    .watch([sessionMetaDir, statsCacheFile], { persistent: true, ignoreInitial: true })
    .on('all', () => { if (dbt) clearTimeout(dbt); dbt = setTimeout(refresh, 1500) })
}

// ── Custom prompt: checkbox com busca reativa ──────────────────────────────

type RlKey = KeypressEvent & { meta?: boolean; sequence?: string }
interface CbChoice { name: string; value: string; path: string }

const checkboxSearch = createPrompt<string[], {
  message: string
  choices: ReadonlyArray<CbChoice>
  pageSize?: number
}>((config, done) => {
  const [term,    setTerm]    = useState('')
  const [active,  setActive]  = useState(0)
  const [checked, setChecked] = useState<ReadonlyArray<string>>([])

  const filtered = useMemo(
    () => {
      const t = term.toLowerCase()
      return t ? config.choices.filter(c =>
        c.name.toLowerCase().includes(t) || c.path.toLowerCase().includes(t)
      ) : config.choices
    },
    [term]
  )

  useKeypress((key) => {
    const k = key as RlKey
    if (isEnterKey(k)) { done([...checked]); return }
    const len = filtered.length
    if (isUpKey(k))        { setActive(active === 0 ? Math.max(0, len-1) : active-1) }
    else if (isDownKey(k)) { setActive(active >= len-1 ? 0 : active+1) }
    else if (isSpaceKey(k)) {
      const item = filtered[active]; if (!item) return
      const s = new Set(checked)
      s.has(item.value) ? s.delete(item.value) : s.add(item.value)
      setChecked(Array.from(s))
    } else if (isBackspaceKey(k)) { setTerm(term.slice(0,-1)); setActive(0) }
    else if (!k.ctrl && !k.meta && k.sequence?.length === 1 && k.sequence.charCodeAt(0) >= 32) {
      setTerm(term + k.sequence); setActive(0)
    }
  })

  const cs = new Set(checked)

  // Search bar — styled like an input box
  const COL = process.stdout.columns || 80
  const BOX = Math.min(56, COL - 6)
  const cur = `${E}[7m ${R}`  // blinking-cursor block
  const termPad = ' '.repeat(Math.max(0, BOX - 4 - visLen(term)))
  const searchBar = [
    `  ${D}┌${'─'.repeat(BOX)}┐${R}`,
    `  ${D}│${R}  ${AM}${B}❯${R}  ${B}${term}${R}${cur}${termPad}${D}│${R}`,
    `  ${D}└${'─'.repeat(BOX)}┘${R}`,
  ].join('\n')

  const page = usePagination({
    items: filtered as CbChoice[], active, pageSize: config.pageSize ?? 14, loop: false,
    renderItem: ({ item, isActive }) => {
      const sel = cs.has(item.value)
      const bullet = sel ? `${AM}${B}●${R}` : `${D}○${R}`
      const arrow  = isActive ? `${AM}▸${R}` : ` `
      const label  = sel
        ? `${AM}${B}${item.name}${R}`
        : isActive
          ? `${B}${item.name}${R}`
          : `${D}${item.name}${R}`
      const path   = `${D}${item.path}${R}`
      return `  ${arrow} ${bullet}  ${label}  ${path}`
    },
  })

  const selCount = checked.length
  const selNames = checked.map(v => config.choices.find(c => c.value === v)?.name ?? v).join(', ')
  const selLine  = selCount > 0
    ? `\n  ${AM}${B}${selCount}${R}${AM} selecionado${selCount > 1 ? 's' : ''}${R}  ${D}${selNames}${R}`
    : `\n  ${D}nenhum selecionado = todos os projetos${R}`

  return [
    `\n  ${AM}${B}${config.message}${R}`,
    '',
    searchBar,
    '',
    page,
    selLine,
    `\n  ${D}↑↓ navegar  ·  Espaço selecionar  ·  Enter confirmar  ·  Backspace apagar${R}`,
  ].join('\n')
})

// ── Prompts de configuração ────────────────────────────────────────────────

async function askConfig(all: ProjectInfo[]): Promise<WatchConfig> {
  const intStr = await input({
    message: 'Intervalo de refresh (segundos):',
    default: '30',
    validate: v => { const n = parseInt(v,10); return Number.isFinite(n) && n >= 5 ? true : 'Min 5s' },
  })

  const otlp = await input({
    message: 'OTLP endpoint (vazio = desativado):',
    default: process.env.OTEL_EXPORTER_OTLP_ENDPOINT ?? '',
  })

  const showAnim = await confirm({
    message: 'Mostrar animação neural no painel?',
    default: true,
  })

  const paths = await checkboxSearch({
    message: 'Selecione os projetos:',
    choices: all.map(p => ({ name: p.name, value: p.path, path: p.path })),
    pageSize: Math.min(20, all.length),
  })

  const selected = paths.length === 0 ? [] : all.filter(p => paths.includes(p.path))

  let viewMode: ViewMode = 'junto'
  if (selected.length > 1) {
    viewMode = await select<ViewMode>({
      message: 'Como visualizar?',
      choices: [
        { name: `${B}Separado${R}  — uma linha por projeto`,          value: 'separado', short: 'separado' },
        { name: `${B}Unificado${R} — total dos selecionados`,          value: 'junto',    short: 'unificado' },
        { name: `${B}Ambos${R}     — total no topo + linha/projeto`,   value: 'ambos',    short: 'ambos' },
      ],
    })
  }

  return { selectedProjects: selected, allProjects: all, viewMode,
    intervalSec: parseInt(intStr, 10), otlpEndpoint: otlp, showAnim }
}

// ── Auto-start do servidor API ────────────────────────────────────────────

let spawnedServer: ReturnType<typeof Bun.spawn> | null = null

async function ensureApiRunning(): Promise<void> {
  // Já está rodando?
  if (await probeApi(2000)) return

  // Sobe server.ts em background
  const serverPath = join(import.meta.dir, 'server.ts')
  console.log(`${YL}Servidor API nao detectado — iniciando automaticamente...${R}`)

  spawnedServer = Bun.spawn(['bun', 'run', serverPath], {
    stdout: 'ignore',
    stderr: 'ignore',
    env: { ...process.env },
  })

  const ok = await withLoader('Aguardando servidor API iniciar...', async () => {
    for (let i = 0; i < 40; i++) {
      await new Promise(r => setTimeout(r, 300))
      if (await probeApi(800)) return true
    }
    return false
  })

  if (!ok) {
    if (spawnedServer) { spawnedServer.kill(); spawnedServer = null }
    console.error(`\n${RD}Nao foi possivel iniciar o servidor API (porta 3001).${R}`)
    process.exit(1)
  }
  console.log(`${AM}Servidor iniciado (pid ${spawnedServer?.pid}).${R}`)
}

function registerServerCleanup() {
  const killServer = () => {
    if (spawnedServer) { spawnedServer.kill(); spawnedServer = null }
  }
  process.on('exit',    killServer)
  process.on('SIGINT',  () => { killServer(); process.exit(0) })
  process.on('SIGTERM', () => { killServer(); process.exit(0) })
}

// ── Entry point ────────────────────────────────────────────────────────────

async function main() {
  console.log(`\n${B}${AM}Claude Stats${R}${D} · ${R}${B}Watch CLI${R}\n`)

  registerServerCleanup()
  await ensureApiRunning()

  const apiData = await withLoader('Carregando dados da API...', () => fetchApi(60_000))

  if (!apiData) {
    console.error(`\n${RD}Falha ao carregar dados da API. O servidor respondeu mas retornou erro.${R}`)
    process.exit(1)
  }

  const allProjects = apiData.projects
    .map(p => ({ name: p.name, path: p.path }))
    .sort((a, b) => a.path.localeCompare(b.path))

  if (allProjects.length === 0) {
    console.error('Nenhum projeto encontrado.')
    process.exit(1)
  }
  console.log(`${AM}${allProjects.length} projetos encontrados.${R}\n`)

  const cfg = await askConfig(allProjects)
  await watchLoop(cfg)
}

main().catch(err => {
  // ExitPromptError = Ctrl+C during an inquirer prompt (expected exit)
  if (err?.name === 'ExitPromptError' || err?.code === 'ERR_USE_AFTER_CLOSE') {
    showGoodbye()
    process.exit(0)
  }
  out(SHOW + ALT_OFF)
  console.error('Erro fatal:', err)
  process.exit(1)
})
