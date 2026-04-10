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

import { readFile, readdir } from 'fs/promises'
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

const HOME_DIR         = process.env.HOME ?? process.env.USERPROFILE ?? ''
const CLAUDE_DIR       = join(HOME_DIR, '.claude')
const PROJECTS_DIR     = join(CLAUDE_DIR, 'projects')
const SESSION_META_DIR = join(CLAUDE_DIR, 'usage-data', 'session-meta')
const STATS_CACHE_FILE = join(CLAUDE_DIR, 'stats-cache.json')
const API_BASE         = 'http://localhost:3001'
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// ── ANSI ───────────────────────────────────────────────────────────────────

const E = '\x1b'
const R  = `${E}[0m`
const B  = `${E}[1m`
const D  = `${E}[2m`
const CY = `${E}[36m`
const GR = `${E}[32m`
const YL = `${E}[33m`
const RD = `${E}[31m`
const WH = `${E}[37m`
const BC = `${E}[96m`

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
  showBattle: boolean
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
  showBattle:  boolean
  isLoading:   boolean
  dataSource:  DataSrc
}

// ── I/O helpers ────────────────────────────────────────────────────────────

async function safeJson<T>(p: string): Promise<T | null> {
  try { return JSON.parse(await readFile(p, 'utf-8')) as T } catch { return null }
}
async function safeDir(d: string): Promise<string[]> {
  try { return await readdir(d) } catch { return [] }
}

// ── Fonte 1: API (dados idênticos ao frontend) ─────────────────────────────

interface ApiProject { path: string; name: string }
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

/** Probe leve — apenas verifica se o servidor está aceitando conexões. */
async function probeApi(timeout = 1000): Promise<boolean> {
  try {
    const ac  = new AbortController()
    const tid = setTimeout(() => ac.abort(), timeout)
    const res = await fetch(`${API_BASE}/api/health`, { signal: ac.signal })
    clearTimeout(tid)
    return res.ok
  } catch {
    return false
  }
}

// ── Fonte 2: Leitura direta de arquivos (fallback) ─────────────────────────

/** Lê primeiras linhas de um JSONL até encontrar campo `cwd`. */
async function readJsonlCwd(filePath: string): Promise<string | null> {
  try {
    const text  = await readFile(filePath, 'utf-8')
    const lines = text.split('\n').filter(Boolean).slice(0, 30)
    for (const line of lines) {
      try {
        const obj = JSON.parse(line)
        if (typeof obj?.cwd === 'string' && obj.cwd) return obj.cwd
      } catch { /* skip */ }
    }
  } catch { /* skip */ }
  return null
}

function decodeDir(name: string): string {
  return name.startsWith('-') ? name.replace(/-/g, '/') : '/' + name.replace(/-/g, '/')
}

/**
 * Descobre projetos da mesma forma que server.ts/scanProjects:
 * - Carrega metaMap (sessionId → project_path)
 * - Para cada project dir, vota no project_path usando sessões com meta
 * - Se sem votos, lê CWD do primeiro arquivo JSONL disponível
 * - Fallback final: path decodificado do nome do dir
 */
async function discoverProjectsFromFiles(): Promise<{ projects: ProjectInfo[]; metaMap: Map<string, string> }> {
  // 1. session-meta → metaMap
  const metaFiles = (await safeDir(SESSION_META_DIR)).filter(f => f.endsWith('.json'))
  const metaMap   = new Map<string, string>()
  const BATCH     = 40

  for (let i = 0; i < metaFiles.length; i += BATCH) {
    const res = await Promise.all(
      metaFiles.slice(i, i + BATCH).map(f =>
        safeJson<{ session_id?: string; project_path?: string }>(join(SESSION_META_DIR, f))
      )
    )
    for (const s of res) if (s?.session_id && s.project_path) metaMap.set(s.session_id, s.project_path)
  }

  // 2. Varrer project dirs
  const dirs  = await safeDir(PROJECTS_DIR)
  const seen  = new Map<string, ProjectInfo>()

  await Promise.all(dirs.map(async dir => {
    if (dir.startsWith('.')) return
    const fallback = decodeDir(dir)
    const entries  = await safeDir(join(PROJECTS_DIR, dir))

    const votes: Record<string, number> = {}
    let firstJsonl: string | null = null

    for (const entry of entries) {
      const sid = entry.endsWith('.jsonl') ? entry.slice(0, -6)
        : UUID_RE.test(entry) ? entry : null
      if (!sid) continue

      const p = metaMap.get(sid)
      if (p) {
        votes[p] = (votes[p] ?? 0) + 1
      } else if (!firstJsonl && entry.endsWith('.jsonl')) {
        firstJsonl = join(PROJECTS_DIR, dir, entry)
      }
    }

    // Canonical path: majority-vote → JSONL cwd → fallback decoded
    let canonical: string
    if (Object.keys(votes).length > 0) {
      canonical = Object.entries(votes).sort((a, b) => b[1] - a[1])[0][0]
    } else if (firstJsonl) {
      canonical = (await readJsonlCwd(firstJsonl)) ?? fallback
    } else {
      canonical = fallback
    }

    if (!seen.has(canonical)) {
      seen.set(canonical, {
        path: canonical,
        name: canonical.split('/').filter(Boolean).pop() ?? dir,
      })
    }
  }))

  return {
    projects: Array.from(seen.values()).sort((a, b) => a.path.localeCompare(b.path)),
    metaMap,
  }
}

async function loadSessionsFromFiles(metaMap: Map<string, string>): Promise<SessionMeta[]> {
  const files = (await safeDir(SESSION_META_DIR)).filter(f => f.endsWith('.json'))
  const out: SessionMeta[] = []
  const BATCH = 40

  for (let i = 0; i < files.length; i += BATCH) {
    const res = await Promise.all(
      files.slice(i, i + BATCH).map(f => safeJson<SessionMeta>(join(SESSION_META_DIR, f)))
    )
    for (const s of res) if (s?.session_id) out.push(s)
  }
  return out
}

// ── Cálculo de snapshot — espelha useDerivedStats ─────────────────────────

function blendedCost(mu: Record<string, ModelUsage>) {
  let tIn = 0, tOut = 0, wIn = 0, wOut = 0
  for (const [id, u] of Object.entries(mu)) {
    const p = getModelPrice(id)
    tIn  += u.inputTokens;   tOut += u.outputTokens
    wIn  += u.inputTokens * p.input; wOut += u.outputTokens * p.output
  }
  return { input: tIn > 0 ? wIn / tIn : 3, output: tOut > 0 ? wOut / tOut : 15 }
}

function computeSnapshot(
  sessions:    SessionMeta[],
  statsCache:  StatsCache,
  filter?:     string[]
): CliSnapshot {
  const isF     = !!(filter?.length)
  const filt    = isF ? sessions.filter(s => filter!.includes(s.project_path)) : sessions
  const daily   = statsCache.dailyActivity ?? []
  const mu      = statsCache.modelUsage ?? {}

  // Mensagens/sessões — idêntico ao useDerivedStats:
  //   sem filtro → statsCache.dailyActivity (mais preciso, inclui sessões sem meta)
  //   com filtro → soma das sessões filtradas
  const messages = isF
    ? filt.reduce((s, x) => s + (x.user_message_count ?? 0) + (x.assistant_message_count ?? 0), 0)
    : daily.reduce((s, d) => s + d.messageCount, 0)

  const sessCnt = isF
    ? filt.length
    : daily.reduce((s, d) => s + d.sessionCount, 0)

  // Tokens sempre das sessões filtradas (como no frontend)
  const inTok  = filt.reduce((s, x) => s + (x.input_tokens  ?? 0), 0)
  const outTok = filt.reduce((s, x) => s + (x.output_tokens ?? 0), 0)
  const gC     = filt.reduce((s, x) => s + (x.git_commits   ?? 0), 0)
  const lA     = filt.reduce((s, x) => s + (x.lines_added   ?? 0), 0)
  const lR     = filt.reduce((s, x) => s + (x.lines_removed ?? 0), 0)

  // Custo — idêntico ao useDerivedStats
  let cost = 0
  if (!isF) {
    cost = Object.entries(mu).reduce((s, [id, u]) => s + calcCost(u, id), 0)
  } else {
    const b = blendedCost(mu)
    cost = (inTok / 1_000_000) * b.input + (outTok / 1_000_000) * b.output
  }

  // Streak — sempre global (dailyActivity), igual ao frontend
  const acts = new Set(daily.map(d => d.date))
  let streak = 0
  for (let i = 0; i <= 365; i++) {
    const d = new Date(); d.setDate(d.getDate() - i)
    if (acts.has(d.toISOString().slice(0, 10))) streak++
    else if (i > 0) break
  }

  return { messages, sessions: sessCnt, inputTokens: inTok, outputTokens: outTok,
    costUsd: cost, streak, gitCommits: gC, linesAdded: lA, linesRemoved: lR }
}

// ── Reload de dados ────────────────────────────────────────────────────────

async function reloadData(config: WatchConfig): Promise<{
  snapshots: Map<string, CliSnapshot>
  dataSource: DataSrc
  allProjects?: ProjectInfo[]
}> {
  const paths   = config.selectedProjects.length > 0 ? config.selectedProjects.map(p => p.path) : undefined
  const snapshots = new Map<string, CliSnapshot>()

  // Tenta API primeiro (dados idênticos ao frontend)
  const apiData = await fetchApi()

  if (apiData) {
    const { sessions, statsCache } = apiData
    snapshots.set('', computeSnapshot(sessions, statsCache, paths))
    for (const p of config.selectedProjects) {
      snapshots.set(p.path, computeSnapshot(sessions, statsCache, [p.path]))
    }
    return { snapshots, dataSource: 'api' }
  }

  // Fallback: leitura direta
  const { metaMap } = await discoverProjectsFromFiles()
  const [sessions, statsCache] = await Promise.all([
    loadSessionsFromFiles(metaMap),
    safeJson<StatsCache>(STATS_CACHE_FILE).then(v => v ?? {}),
  ])

  snapshots.set('', computeSnapshot(sessions, statsCache, paths))
  for (const p of config.selectedProjects) {
    snapshots.set(p.path, computeSnapshot(sessions, statsCache, [p.path]))
  }
  return { snapshots, dataSource: 'files' }
}

// ── Animação de batalha ────────────────────────────────────────────────────
// Apenas ASCII básico (a-z, /, \, -, |, >, <, *, =, o) + ANSI cores.
// Cada frame = 4 linhas com largura visível exatamente igual a FW.

const FW = 44

const fp = (s: string) => s + ' '.repeat(Math.max(0, FW - visLen(s)))

// Cada elemento: [linha1, linha2, linha3, label]
const FRAMES: Array<[string, string, string, string]> = [
  [ // 0 — idle
    fp(`  ${YL}o${R}                        ${RD}o${R}`),
    fp(`  ${YL}|${R}         - vs -         ${RD}|${R}`),
    fp(` ${YL}/ \\${R}                      ${RD}/ \\${R}`),
    fp(`  ${YL}CLAUDE${R}               ${RD}CURSOR${R}`),
  ],
  [ // 1 — Claude carrega
    fp(` ${YL}\\o/${R}                       ${RD}o${R}`),
    fp(`  ${YL}|${R}         - vs -         ${RD}|${R}`),
    fp(` ${YL}/ \\${R}                      ${RD}/ \\${R}`),
    fp(`  ${YL}CLAUDE${R} ${D}carrega...${R}  ${RD}CURSOR${R}`),
  ],
  [ // 2 — Claude ataca →
    fp(`  ${YL}o${R} ${B}=======${R}${GR}>${R}           ${RD}o${R}`),
    fp(`  ${YL}|${R}                         ${RD}|${R}`),
    fp(` ${YL}/ \\${R}                      ${RD}/ \\${R}`),
    fp(`  ${YL}CLAUDE${R} ${GR}ATAQUE!${R}      ${RD}CURSOR${R}`),
  ],
  [ // 3 — impacto no Cursor
    fp(`  ${YL}o${R}         ${GR}*${R}      ${B}${RD}(o)${R}`),
    fp(`  ${YL}|${R}                      ${RD}\\${R}`),
    fp(` ${YL}/ \\${R}                     ${RD}/\\${R}`),
    fp(`  ${YL}CLAUDE${R} ${GR}CRITICO!${R}    ${RD}CURSOR${R}`),
  ],
  [ // 4 — Cursor se recupera
    fp(`  ${YL}o${R}                        ${RD}o${R}`),
    fp(`  ${YL}|${R}         - vs -        ${RD}\\|/${R}`),
    fp(` ${YL}/ \\${R}                      ${RD}/\\${R}`),
    fp(`  ${YL}CLAUDE${R}               ${RD}CURSOR${R}`),
  ],
  [ // 5 — Cursor carrega
    fp(`  ${YL}o${R}                       ${RD}\\o/${R}`),
    fp(`  ${YL}|${R}         - vs -         ${RD}|${R}`),
    fp(` ${YL}/ \\${R}                      ${RD}/ \\${R}`),
    fp(`  ${YL}CLAUDE${R}   ${RD}CURSOR ${D}carrega...${R}`),
  ],
  [ // 6 — Cursor ataca ←
    fp(`  ${YL}o${R}           ${GR}<${R}${B}=======${R}  ${RD}o${R}`),
    fp(`  ${YL}|${R}                         ${RD}|${R}`),
    fp(` ${YL}/ \\${R}                      ${RD}/ \\${R}`),
    fp(`  ${YL}CLAUDE${R}    ${RD}CURSOR ATAQUE!${R}`),
  ],
  [ // 7 — Claude leva
    fp(`${GR}*${R} ${B}${YL}(o)${R}                       ${RD}o${R}`),
    fp(`   ${YL}/\\${R}                        ${RD}|${R}`),
    fp(`  ${YL}/  \\${R}                     ${RD}/ \\${R}`),
    fp(`  ${YL}CLAUDE${R} ${D}levou!${R}       ${RD}CURSOR${R}`),
  ],
]

function renderBattle(frame: number): string[] {
  const f = FRAMES[frame % FRAMES.length]
  const sep = sepLine(FW + 4)
  return [
    sep,
    `  ${f[0]}`,
    `  ${f[1]}`,
    `  ${f[2]}`,
    `  ${f[3]}`,
    `  ${D}[Ctrl+O para ocultar]${R}`,
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
  const c = v.map((x, i) => padStr(x, COLS[i].w))
  if (name !== undefined) {
    const n = name.length > PW-1 ? name.slice(0, PW-2)+'…' : name
    return padStr(`${CY}${n}${R}`, PW, 'l')+'  '+c.join('  ')
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
  const left   = `${B}${BC}Claude Stats - Watch Mode${R}`
  const gap    = Math.max(1, W - visLen('Claude Stats - Watch Mode') - visLen(ts) - visLen('  api  refresh: XXs'))
  lines.push(left + ' '.repeat(gap) + right)
  lines.push(sepLine(W))
  lines.push('')

  // Batalha (se ativa)
  if (st.showBattle) { lines.push(...renderBattle(st.animFrame)); lines.push('') }

  // Bloco info
  const mode = cfg.viewMode === 'junto' ? 'unificado' : cfg.viewMode === 'separado' ? 'separado' : 'ambos'
  lines.push(`  ${D}Home:${R}       ${WH}${HOME_DIR}${R}`)
  lines.push(`  ${D}Claude dir:${R} ${WH}${CLAUDE_DIR}${R}`)
  if (cfg.selectedProjects.length === 0) {
    lines.push(`  ${D}Projetos:${R}   ${YL}todos (${cfg.allProjects.length})${R}`)
  } else {
    lines.push(`  ${D}Projetos:${R}   ${CY}${cfg.selectedProjects.map(p=>p.name).join(', ')}${R}`)
  }
  if (cfg.selectedProjects.length > 1) lines.push(`  ${D}Modo:${R}       ${GR}${mode}${R}`)
  lines.push(`  ${D}Interval:${R}   ${WH}${cfg.intervalSec}s${R}`)
  lines.push(`  ${D}OTLP:${R}       ${cfg.otlpEndpoint ? `${GR}${cfg.otlpEndpoint}${R}` : `${D}(disabled)${R}`}`)
  lines.push('')

  // Tabela
  const solo = cfg.selectedProjects.length <= 1
  const all  = st.snapshots.get('')
  const ldg  = `  ${D}(carregando...)${R}`

  if (solo || cfg.viewMode === 'junto') {
    lines.push(sepLine(W))
    if (!solo) lines.push(`  ${B}${CY}UNIFICADO${R}`)
    lines.push('')
    lines.push('  ' + tHdr(false))
    lines.push(`  ${GR}${B}${all ? tRow(all) : ldg}${R}`)
    lines.push(sepLine(W))
  } else if (cfg.viewMode === 'separado') {
    lines.push(sepLine(W))
    lines.push(`  ${B}${CY}POR PROJETO${R}`)
    lines.push('')
    lines.push('  ' + tHdr(true))
    for (const p of cfg.selectedProjects) {
      const s = st.snapshots.get(p.path)
      lines.push('  ' + (s ? tRow(s, p.name) : ldg))
    }
    lines.push(sepLine(W))
  } else {
    lines.push(sepLine(W))
    lines.push(`  ${B}${CY}UNIFICADO${R}`)
    lines.push('')
    lines.push('  ' + tHdr(false))
    lines.push(`  ${GR}${B}${all ? tRow(all) : ldg}${R}`)
    lines.push('')
    lines.push(`  ${B}${CY}POR PROJETO${R}`)
    lines.push('')
    lines.push('  ' + tHdr(true))
    for (const p of cfg.selectedProjects) {
      const s = st.snapshots.get(p.path)
      lines.push('  ' + (s ? tRow(s, p.name) : ldg))
    }
    lines.push(sepLine(W))
  }

  lines.push('')
  lines.push(`  ${D}Ctrl+C sair  |  Ctrl+O ${st.showBattle ? 'ocultar' : 'mostrar'} batalha${R}`)
  return lines.join('\n') + '\n'
}

// ── Watch loop ─────────────────────────────────────────────────────────────

async function watchLoop(cfg: WatchConfig): Promise<void> {
  const st: AppState = {
    snapshots: new Map(), lastUpdated: new Date(),
    animFrame: 0, showBattle: cfg.showBattle, isLoading: true, dataSource: 'files',
  }

  const cleanup = () => { out(SHOW + ALT_OFF); if (spawnedServer) { spawnedServer.kill(); spawnedServer = null } process.exit(0) }
  out(ALT_ON + HIDE)

  const render = () => { out(CLR + buildPanel(cfg, st)) }

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
      if (buf[0] === 15) { st.showBattle = !st.showBattle; render() }
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
  chokidar
    .watch([SESSION_META_DIR, STATS_CACHE_FILE], { persistent: true, ignoreInitial: true })
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
  const page = usePagination({
    items: filtered as CbChoice[], active, pageSize: config.pageSize ?? 16, loop: false,
    renderItem: ({ item, isActive }) =>
      ` ${isActive ? `${CY}>` : ' '}${R} ${cs.has(item.value) ? `${GR}[x]` : `${D}[ ]`}${R}  ${cs.has(item.value) ? GR : ''}${item.name}${R}  ${D}${item.path}${R}`,
  })

  const cur      = `${E}[7m ${R}`
  const selNames = checked.map(v => config.choices.find(c => c.value===v)?.name ?? v).join(', ')
  const selLine  = checked.length > 0 ? `\n  ${D}Sel: ${R}${GR}${selNames}${R}` : `\n  ${D}(nenhum = todos)${R}`

  return `${B}${config.message}${R}\n  ${D}[Buscar]${R} ${B}${term}${R}${cur}\n\n${page}${selLine}\n  ${D}↑↓ navegar  Espaco selecionar  Enter confirmar  Backspace apagar busca${R}`
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

  const showBattle = await confirm({
    message: 'Mostrar batalha Claude vs Cursor no painel?',
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
    intervalSec: parseInt(intStr, 10), otlpEndpoint: otlp, showBattle }
}

// ── Auto-start do servidor API ────────────────────────────────────────────

let spawnedServer: ReturnType<typeof Bun.spawn> | null = null

async function ensureApiRunning(): Promise<boolean> {
  // Já está rodando?
  if (await probeApi(2000)) return false // já estava rodando, não precisamos subir

  // Sobe server.ts em background
  const serverPath = join(import.meta.dir, 'server.ts')
  console.log(`${YL}Servidor API nao detectado — iniciando automaticamente...${R}`)

  spawnedServer = Bun.spawn(['bun', 'run', serverPath], {
    stdout: 'ignore',
    stderr: 'ignore',
    env: { ...process.env },
  })

  // Aguarda até 10s (polling a cada 300ms) usando probe leve
  for (let i = 0; i < 33; i++) {
    await new Promise(r => setTimeout(r, 300))
    const ok = await probeApi(1000)
    if (ok) {
      console.log(`${GR}Servidor iniciado (pid ${spawnedServer.pid}).${R}`)
      return true
    }
  }

  console.log(`${RD}Nao foi possivel iniciar o servidor. Usando leitura direta de arquivos.${R}`)
  spawnedServer?.kill()
  spawnedServer = null
  return false
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
  console.log(`\n${B}${BC}Claude Stats - Watch CLI${R}\n`)

  registerServerCleanup()

  await ensureApiRunning()

  // Agora tenta a API (pode estar recém-subida ou já existente)
  const apiData = await fetchApi(2000)
  let allProjects: ProjectInfo[]

  if (apiData) {
    console.log(`${GR}Usando dados da API em ${API_BASE}${R}\n`)
    allProjects = apiData.projects.map(p => ({ name: p.name, path: p.path }))
      .sort((a, b) => a.path.localeCompare(b.path))
  } else {
    console.log(`${YL}Usando leitura direta de arquivos (fallback).${R}\n`)
    const { projects } = await discoverProjectsFromFiles()
    allProjects = projects
  }

  if (allProjects.length === 0) {
    console.error('Nenhum projeto encontrado.')
    process.exit(1)
  }
  console.log(`${GR}${allProjects.length} projetos encontrados.${R}\n`)

  const cfg = await askConfig(allProjects)
  await watchLoop(cfg)
}

main().catch(err => {
  out(SHOW + ALT_OFF)
  console.error('Erro fatal:', err)
  process.exit(1)
})
