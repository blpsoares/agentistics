#!/usr/bin/env bun
/**
 * Claude Stats — Watch CLI
 *
 * TUI interativa que monitora métricas Claude em tempo real.
 * Usa alternate screen buffer (como vim/less) — sai limpo ao encerrar.
 *
 * Controles durante o watch:
 *   Ctrl+O  — ocultar/mostrar batalha
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
import { select, input, confirm } from '@inquirer/prompts'
import { calcCost, getModelPrice } from './src/lib/types'
import type { ModelUsage } from './src/lib/types'

// ── Constantes ─────────────────────────────────────────────────────────────

const HOME_DIR         = process.env.HOME ?? process.env.USERPROFILE ?? ''
const CLAUDE_DIR       = join(HOME_DIR, '.claude')
const PROJECTS_DIR     = join(CLAUDE_DIR, 'projects')
const SESSION_META_DIR = join(CLAUDE_DIR, 'usage-data', 'session-meta')
const STATS_CACHE_FILE = join(CLAUDE_DIR, 'stats-cache.json')
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// ── ANSI ───────────────────────────────────────────────────────────────────

const E     = '\x1b'
const R     = `${E}[0m`      // reset
const B     = `${E}[1m`      // bold
const D     = `${E}[2m`      // dim
const CY    = `${E}[36m`     // cyan
const GR    = `${E}[32m`     // green
const YL    = `${E}[33m`     // yellow
const RD    = `${E}[31m`     // red
const WH    = `${E}[37m`     // white
const BCY   = `${E}[96m`     // bright cyan

// Terminal control
const ALT_ON    = `${E}[?1049h`   // entra no alternate screen buffer
const ALT_OFF   = `${E}[?1049l`   // sai do alternate screen buffer
const CLEAR_SCR = `${E}[2J${E}[H` // limpa e vai pro topo
const HIDE_CUR  = `${E}[?25l`
const SHOW_CUR  = `${E}[?25h`

const write = (s: string) => process.stdout.write(s)
const visLen = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, '').length
const pad = (s: string, w: number, align: 'l' | 'r' = 'r') => {
  const p = ' '.repeat(Math.max(0, w - visLen(s)))
  return align === 'l' ? s + p : p + s
}
const hr = (w: number, ch = '─') => `${D}${ch.repeat(w)}${R}`

// ── Tipos ──────────────────────────────────────────────────────────────────

type ViewMode = 'separado' | 'junto' | 'ambos'
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
  gitCommits: number; gitPushes: number
  linesAdded: number; linesRemoved: number
}
interface StatsCache {
  dailyActivity?: Array<{ date: string; messageCount: number; sessionCount: number }>
  modelUsage?: Record<string, ModelUsage>
}
interface SessionMetaMin {
  session_id: string; project_path: string; start_time: string
  user_message_count: number; assistant_message_count: number
  git_commits: number; git_pushes: number
  input_tokens: number; output_tokens: number
  lines_added: number; lines_removed: number
}
interface AppState {
  snapshots: Map<string, CliSnapshot>
  lastUpdated: Date
  animFrame: number
  showBattle: boolean
  isLoading: boolean
}

// ── I/O helpers ────────────────────────────────────────────────────────────

async function safeReadJson<T>(f: string): Promise<T | null> {
  try { return JSON.parse(await readFile(f, 'utf-8')) as T } catch { return null }
}
async function safeReadDir(d: string): Promise<string[]> {
  try { return await readdir(d) } catch { return [] }
}

// ── Descoberta de projetos — mesma lógica do server.ts ─────────────────────
// 1. Carrega session-meta → Map<sessionId, project_path>
// 2. Para cada dir em ~/.claude/projects/, lista entries e vota no project_path
//    canônico via majority-vote (igual ao scanProjects/scanProjectDir do server.ts)
// 3. Sem votos → usa fallback decodificado do nome do dir

function decodeProjectDir(name: string): string {
  // Claude codifica paths substituindo '/' por '-'; leading '-' = leading '/'
  return name.startsWith('-') ? name.replace(/-/g, '/') : '/' + name.replace(/-/g, '/')
}

async function discoverProjects(): Promise<ProjectInfo[]> {
  // Passo 1: mapa sessionId → project_path
  const metaFiles = (await safeReadDir(SESSION_META_DIR)).filter(f => f.endsWith('.json'))
  const metaMap   = new Map<string, string>()

  const BATCH = 40
  for (let i = 0; i < metaFiles.length; i += BATCH) {
    const res = await Promise.all(
      metaFiles.slice(i, i + BATCH).map(f =>
        safeReadJson<{ session_id?: string; project_path?: string }>(join(SESSION_META_DIR, f))
      )
    )
    for (const s of res) if (s?.session_id && s.project_path) metaMap.set(s.session_id, s.project_path)
  }

  // Passo 2: varre dirs de projeto
  const projectDirs = await safeReadDir(PROJECTS_DIR)
  const seen        = new Map<string, ProjectInfo>()

  await Promise.all(projectDirs.map(async dir => {
    if (dir.startsWith('.')) return
    const fallback = decodeProjectDir(dir)
    const entries  = await safeReadDir(join(PROJECTS_DIR, dir))

    const votes: Record<string, number> = {}

    for (const entry of entries) {
      // Formato A: <uuid>.jsonl
      const sessionId = entry.endsWith('.jsonl') ? entry.slice(0, -6)
        : UUID_RE.test(entry) ? entry       // Formato B: <uuid>/ subdir
        : null
      if (!sessionId) continue

      const path = metaMap.get(sessionId)
      if (path) votes[path] = (votes[path] ?? 0) + 1
    }

    // Canonical path = mais votado; fallback se sem votos
    const canonical = Object.keys(votes).length > 0
      ? Object.entries(votes).sort((a, b) => b[1] - a[1])[0][0]
      : fallback

    if (!seen.has(canonical)) {
      seen.set(canonical, {
        path: canonical,
        name: canonical.split('/').filter(Boolean).pop() ?? dir,
      })
    }
  }))

  return Array.from(seen.values()).sort((a, b) => a.path.localeCompare(b.path))
}

// ── Cálculo de snapshot — espelha useDerivedStats ─────────────────────────

function blendedCostPerToken(mu: Record<string, ModelUsage>) {
  let tIn = 0, tOut = 0, tCR = 0, tCW = 0
  let wIn = 0, wOut = 0, wCR = 0, wCW = 0
  for (const [id, u] of Object.entries(mu)) {
    const p = getModelPrice(id)
    tIn += u.inputTokens;  tOut += u.outputTokens
    tCR += u.cacheReadInputTokens; tCW += u.cacheCreationInputTokens
    wIn += u.inputTokens * p.input;         wOut += u.outputTokens * p.output
    wCR += u.cacheReadInputTokens * p.cacheRead; wCW += u.cacheCreationInputTokens * p.cacheWrite
  }
  return {
    input:  tIn  > 0 ? wIn  / tIn  : 3,
    output: tOut > 0 ? wOut / tOut : 15,
  }
}

async function loadSessions(): Promise<SessionMetaMin[]> {
  const files = (await safeReadDir(SESSION_META_DIR)).filter(f => f.endsWith('.json'))
  const out: SessionMetaMin[] = []
  const BATCH = 40
  for (let i = 0; i < files.length; i += BATCH) {
    const res = await Promise.all(
      files.slice(i, i + BATCH).map(f => safeReadJson<SessionMetaMin>(join(SESSION_META_DIR, f)))
    )
    for (const s of res) if (s?.session_id) out.push(s)
  }
  return out
}

function computeSnapshot(
  sessions: SessionMetaMin[],
  cache: StatsCache,
  filter?: string[]
): CliSnapshot {
  const filtered = filter?.length ? sessions.filter(s => filter.includes(s.project_path)) : sessions
  const isF      = !!(filter?.length)

  const messages = isF
    ? filtered.reduce((s, x) => s + (x.user_message_count ?? 0) + (x.assistant_message_count ?? 0), 0)
    : (cache.dailyActivity ?? []).reduce((s, d) => s + d.messageCount, 0)

  const sessions_ = isF
    ? filtered.length
    : (cache.dailyActivity ?? []).reduce((s, d) => s + d.sessionCount, 0)

  const inTok  = filtered.reduce((s, x) => s + (x.input_tokens  ?? 0), 0)
  const outTok = filtered.reduce((s, x) => s + (x.output_tokens ?? 0), 0)
  const gC     = filtered.reduce((s, x) => s + (x.git_commits   ?? 0), 0)
  const gP     = filtered.reduce((s, x) => s + (x.git_pushes    ?? 0), 0)
  const lA     = filtered.reduce((s, x) => s + (x.lines_added   ?? 0), 0)
  const lR     = filtered.reduce((s, x) => s + (x.lines_removed ?? 0), 0)

  const mu = cache.modelUsage ?? {}
  let cost = 0
  if (!isF) {
    cost = Object.entries(mu).reduce((s, [id, u]) => s + calcCost(u, id), 0)
  } else {
    const b = blendedCostPerToken(mu)
    cost = (inTok / 1_000_000) * b.input + (outTok / 1_000_000) * b.output
  }

  const acts = new Set((cache.dailyActivity ?? []).map(d => d.date))
  let streak = 0
  for (let i = 0; i <= 365; i++) {
    const d = new Date(); d.setDate(d.getDate() - i)
    if (acts.has(d.toISOString().slice(0, 10))) streak++
    else if (i > 0) break
  }

  return { messages, sessions: sessions_, inputTokens: inTok, outputTokens: outTok,
    costUsd: cost, streak, gitCommits: gC, gitPushes: gP, linesAdded: lA, linesRemoved: lR }
}

async function reloadSnapshots(config: WatchConfig): Promise<Map<string, CliSnapshot>> {
  const [sessions, cache] = await Promise.all([
    loadSessions(),
    safeReadJson<StatsCache>(STATS_CACHE_FILE).then(v => v ?? {}),
  ])
  const map = new Map<string, CliSnapshot>()
  const paths = config.selectedProjects.length > 0
    ? config.selectedProjects.map(p => p.path)
    : undefined

  map.set('', computeSnapshot(sessions, cache, paths))
  for (const p of config.selectedProjects) {
    map.set(p.path, computeSnapshot(sessions, cache, [p.path]))
  }
  return map
}

// ── Animação de batalha: Claude vs Cursor ──────────────────────────────────
// Cada frame = 4 linhas de conteúdo com largura visível fixa (FW caracteres).
// Padded com espaços para garantir que não varia de tamanho entre frames.

const FW = 46 // largura visível do frame

function fp(line: string): string {
  // Preenche linha até FW caracteres visíveis
  return line + ' '.repeat(Math.max(0, FW - visLen(line)))
}

// Cada frame: [linha1, linha2, linha3, linha4, statusLabel]
// Linha 1-3: figuras; linha 4: nomes fixos
const FRAMES: [string, string, string, string][] = [
  // 0 — idle
  [ fp(`  ${YL}o${R}                         ${RD}o${R}`),
    fp(`  ${YL}/|\\${R}      ${D}~ VS ~${R}       ${RD}/|\\${R}`),
    fp(`  ${YL}/ \\${R}                       ${RD}/ \\${R}`),
    fp(`  ${YL}CLAUDE${R}               ${RD}CURSOR${R}`) ],

  // 1 — Claude carrega
  [ fp(`  ${YL}\\o/${R}                        ${RD}o${R}`),
    fp(`   ${YL}|${R}       ${D}~ VS ~${R}       ${RD}/|\\${R}`),
    fp(`  ${YL}/ \\${R}                       ${RD}/ \\${R}`),
    fp(`  ${YL}CLAUDE${R} ${D}carrega...${R}    ${RD}CURSOR${R}`) ],

  // 2 — Claude ataca →
  [ fp(`  ${YL}o${R}${B}─────────────────────→${R}  ${RD}o${R}`),
    fp(` ${YL}─|─${R}                        ${RD}|${R}`),
    fp(`  ${YL}/ \\${R}                      ${RD}/\\${R}`),
    fp(`  ${YL}CLAUDE${R} ${GR}ATAQUE!${R}         ${RD}CURSOR${R}`) ],

  // 3 — Impacto!
  [ fp(`  ${YL}o${R}               ${GR}✦${R}  ${B}${RD}*${R}`),
    fp(`  ${YL}/|\\${R}                    ${RD}\\${R}`),
    fp(`  ${YL}/ \\${R}                    ${RD}/\\${R}`),
    fp(`  ${YL}CLAUDE${R} ${GR}CRÍTICO!${R}        ${RD}CURSOR${R}`) ],

  // 4 — Cursor se recupera
  [ fp(`  ${YL}o${R}                         ${RD}o${R}`),
    fp(`  ${YL}/|\\${R}      ${D}~ VS ~${R}      ${RD}\\|/${R}`),
    fp(`  ${YL}/ \\${R}                      ${RD}/\\${R}`),
    fp(`  ${YL}CLAUDE${R}               ${RD}CURSOR${R}`) ],

  // 5 — Cursor carrega
  [ fp(`  ${YL}o${R}                        ${RD}\\o/${R}`),
    fp(`  ${YL}/|\\${R}      ${D}~ VS ~${R}         ${RD}|${R}`),
    fp(`  ${YL}/ \\${R}                       ${RD}/ \\${R}`),
    fp(`  ${YL}CLAUDE${R}      ${RD}CURSOR ${D}carrega...${R}`) ],

  // 6 — Cursor ataca ←
  [ fp(`  ${YL}o${R}${B}←─────────────────────${R}${RD}─|─${R}`),
    fp(`   ${YL}|${R}                           ${RD}|${R}`),
    fp(`  ${YL}/\\${R}                          ${RD}/ \\${R}`),
    fp(`  ${YL}CLAUDE${R}       ${RD}CURSOR CONTRA-ATACA!${R}`) ],

  // 7 — Claude apanha
  [ fp(`  ${B}${YL}*${R}  ${GR}✦${R}                     ${RD}o${R}`),
    fp(`   ${YL}\\${R}                          ${RD}/|\\${R}`),
    fp(`   ${YL}/                          ${RD}/ \\${R}`),
    fp(`  ${YL}CLAUDE${R} ${D}levou!${R}          ${RD}CURSOR${R}`) ],
]

function renderBattle(frame: number): string[] {
  const f = FRAMES[frame % FRAMES.length]
  return [
    `  ${D}${'─'.repeat(FW + 6)}${R}`,
    `  ${D}│${R}  ${f[0]}  ${D}│${R}`,
    `  ${D}│${R}  ${f[1]}  ${D}│${R}`,
    `  ${D}│${R}  ${f[2]}  ${D}│${R}`,
    `  ${D}│${R}  ${f[3]}  ${D}│${R}`,
    `  ${D}│${R}  ${D}Ctrl+O para ocultar${' '.repeat(FW - 19)}${R}  ${D}│${R}`,
    `  ${D}${'─'.repeat(FW + 6)}${R}`,
  ]
}

// ── Formatação de métricas ─────────────────────────────────────────────────

const fmtN = (n: number) =>
  n >= 1_000_000 ? (n / 1_000_000).toFixed(1) + 'M'
  : n >= 1_000   ? (n / 1_000).toFixed(1) + 'k'
  : n.toString()

const fmtC = (u: number) =>
  u >= 1000 ? `$${(u / 1000).toFixed(1)}k`
  : u >= 1  ? `$${u.toFixed(2)}`
  : `$${u.toFixed(3)}`

const COLS = [
  { h: 'Msgs',     w: 8  }, { h: 'Sessões',  w: 8  },
  { h: 'Tok↑',    w: 9  }, { h: 'Tok↓',    w: 9  },
  { h: 'Custo',   w: 10 }, { h: 'Streak',  w: 7  },
  { h: 'Commits', w: 8  }, { h: '+Linhas', w: 9  }, { h: '-Linhas', w: 9  },
]
const PW = 24

const tblHdr = (proj: boolean) => {
  const cells = COLS.map(c => pad(`${D}${c.h}${R}`, c.w))
  return (proj ? pad(`${D}Projeto${R}`, PW, 'l') + '  ' : '') + cells.join('  ')
}
const tblRow = (s: CliSnapshot, name?: string) => {
  const vals = [
    fmtN(s.messages), fmtN(s.sessions), fmtN(s.inputTokens), fmtN(s.outputTokens),
    fmtC(s.costUsd), `${s.streak}d`, fmtN(s.gitCommits),
    `+${fmtN(s.linesAdded)}`, `-${fmtN(s.linesRemoved)}`,
  ]
  const cells = vals.map((v, i) => pad(v, COLS[i].w))
  if (name !== undefined) {
    const n = name.length > PW - 1 ? name.slice(0, PW - 2) + '…' : name
    return pad(`${CY}${n}${R}`, PW, 'l') + '  ' + cells.join('  ')
  }
  return cells.join('  ')
}

// ── Construção do painel ───────────────────────────────────────────────────

function buildPanel(cfg: WatchConfig, st: AppState): string {
  const W = process.stdout.columns || 100
  const lines: string[] = []

  // Cabeçalho
  const now   = st.lastUpdated.toLocaleTimeString('pt-BR')
  const right = `${D}${now}  ⟳ ${cfg.intervalSec}s${st.isLoading ? ' …' : ''}${R}`
  const left  = `${B}${BCY}Claude Stats — Watch Mode${R}`
  const gap   = Math.max(1, W - visLen(left.replace(/\x1b\[[0-9;]*m/g,'')) - visLen(right.replace(/\x1b\[[0-9;]*m/g,'')))
  lines.push(left + ' '.repeat(gap) + right)
  lines.push(hr(W))
  lines.push('')

  // Batalha
  if (st.showBattle) {
    lines.push(...renderBattle(st.animFrame))
    lines.push('')
  }

  // Bloco de info
  const mode = cfg.viewMode === 'junto' ? 'unificado'
    : cfg.viewMode === 'separado' ? 'separado' : 'ambos'

  lines.push(`  ${D}Home:${R}       ${WH}${HOME_DIR}${R}`)
  lines.push(`  ${D}Claude dir:${R} ${WH}${CLAUDE_DIR}${R}`)

  if (cfg.selectedProjects.length === 0) {
    lines.push(`  ${D}Projetos:${R}   ${YL}todos (${cfg.allProjects.length})${R}`)
  } else {
    lines.push(`  ${D}Projetos:${R}   ${CY}${cfg.selectedProjects.map(p => p.name).join(', ')}${R}`)
  }
  if (cfg.selectedProjects.length > 1) lines.push(`  ${D}Modo:${R}       ${GR}${mode}${R}`)
  lines.push(`  ${D}Interval:${R}   ${WH}${cfg.intervalSec}s${R}`)
  lines.push(`  ${D}OTLP:${R}       ${cfg.otlpEndpoint ? `${GR}${cfg.otlpEndpoint}${R}` : `${D}(disabled)${R}`}`)
  lines.push('')

  // Tabela
  const solo = cfg.selectedProjects.length <= 1
  const all  = st.snapshots.get('')
  const loading = `  ${D}(carregando...)${R}`

  if (solo || cfg.viewMode === 'junto') {
    lines.push(hr(W))
    if (!solo) lines.push(`  ${B}${CY}UNIFICADO${R}`)
    lines.push('')
    lines.push('  ' + tblHdr(false))
    lines.push(`  ${GR}${B}${all ? tblRow(all) : loading}${R}`)
    lines.push(hr(W))

  } else if (cfg.viewMode === 'separado') {
    lines.push(hr(W))
    lines.push(`  ${B}${CY}POR PROJETO${R}`)
    lines.push('')
    lines.push('  ' + tblHdr(true))
    for (const p of cfg.selectedProjects) {
      const s = st.snapshots.get(p.path)
      lines.push('  ' + (s ? tblRow(s, p.name) : `  ${D}${p.name} (carregando...)${R}`))
    }
    lines.push(hr(W))

  } else {
    lines.push(hr(W))
    lines.push(`  ${B}${CY}UNIFICADO${R}`)
    lines.push('')
    lines.push('  ' + tblHdr(false))
    lines.push(`  ${GR}${B}${all ? tblRow(all) : loading}${R}`)
    lines.push('')
    lines.push(`  ${B}${CY}POR PROJETO${R}`)
    lines.push('')
    lines.push('  ' + tblHdr(true))
    for (const p of cfg.selectedProjects) {
      const s = st.snapshots.get(p.path)
      lines.push('  ' + (s ? tblRow(s, p.name) : `  ${D}${p.name} (carregando...)${R}`))
    }
    lines.push(hr(W))
  }

  lines.push('')
  lines.push(`  ${D}Ctrl+C sair  │  Ctrl+O ${st.showBattle ? 'ocultar' : 'mostrar'} batalha${R}`)
  return lines.join('\n') + '\n'
}

// ── Watch loop ─────────────────────────────────────────────────────────────

async function watchLoop(cfg: WatchConfig): Promise<void> {
  const st: AppState = {
    snapshots: new Map(),
    lastUpdated: new Date(),
    animFrame: 0,
    showBattle: cfg.showBattle,
    isLoading: true,
  }

  // Cleanup centralizado
  const cleanup = () => {
    write(SHOW_CUR + ALT_OFF)
    process.exit(0)
  }

  // Alternate screen: entra limpo, sai limpo
  write(ALT_ON + HIDE_CUR)

  const render = () => {
    write(CLEAR_SCR + buildPanel(cfg, st))
  }

  // Reload pesado de disco
  let reloading = false
  const reloadData = async () => {
    if (reloading) return
    reloading = true
    st.isLoading = true
    try {
      st.snapshots   = await reloadSnapshots(cfg)
      st.lastUpdated = new Date()
    } catch { /* mantém anterior */ }
    finally { st.isLoading = false; reloading = false }
    render()
  }

  // Carga inicial
  await reloadData()

  // Teclado: Ctrl+C e Ctrl+O
  if (process.stdin.isTTY) {
    process.stdin.setRawMode(true)
    process.stdin.resume()
    process.stdin.on('data', (buf: Buffer) => {
      if (buf[0] === 3)  { cleanup() }           // Ctrl+C
      if (buf[0] === 15) {                        // Ctrl+O
        st.showBattle = !st.showBattle
        render()
      }
    })
  } else {
    process.on('SIGINT',  cleanup)
    process.on('SIGTERM', cleanup)
  }

  // Timer de animação — só re-renderiza com cache, sem I/O
  setInterval(() => { st.animFrame++; render() }, 200)

  // Timer de dados
  setInterval(reloadData, cfg.intervalSec * 1000)

  // Chokidar
  let dbt: ReturnType<typeof setTimeout> | null = null
  chokidar
    .watch([SESSION_META_DIR, STATS_CACHE_FILE], { persistent: true, ignoreInitial: true })
    .on('all', () => { if (dbt) clearTimeout(dbt); dbt = setTimeout(reloadData, 1500) })
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
    if (isUpKey(k)) {
      setActive(active === 0 ? Math.max(0, len - 1) : active - 1)
    } else if (isDownKey(k)) {
      setActive(active >= len - 1 ? 0 : active + 1)
    } else if (isSpaceKey(k)) {
      const item = filtered[active]
      if (!item) return
      const s = new Set(checked)
      s.has(item.value) ? s.delete(item.value) : s.add(item.value)
      setChecked(Array.from(s))
    } else if (isBackspaceKey(k)) {
      setTerm(term.slice(0, -1)); setActive(0)
    } else if (!k.ctrl && !k.meta && k.sequence?.length === 1 && k.sequence.charCodeAt(0) >= 32) {
      setTerm(term + k.sequence); setActive(0)
    }
  })

  const cs = new Set(checked)

  const page = usePagination({
    items:    filtered as CbChoice[],
    active,
    pageSize: config.pageSize ?? 16,
    loop:     false,
    renderItem: ({ item, isActive }) => {
      const cur  = isActive ? `${CY}❯${R}` : ' '
      const box  = cs.has(item.value) ? `${GR}◉${R}` : `${D}◯${R}`
      const name = cs.has(item.value) ? `${GR}${item.name}${R}` : item.name
      return ` ${cur} ${box}  ${name}  ${D}${item.path}${R}`
    },
  })

  const cursor   = `\x1b[7m \x1b[0m`
  const search   = `${D}[Buscar]${R} ${B}${term}${R}${cursor}`
  const selNames = checked.map(v => config.choices.find(c => c.value === v)?.name ?? v).join(', ')
  const selLine  = checked.length > 0
    ? `\n  ${D}Selecionados: ${R}${GR}${selNames}${R}`
    : `\n  ${D}(nenhum = todos os projetos)${R}`

  return `${B}${config.message}${R}\n  ${search}\n\n${page}${selLine}\n  ${D}↑↓ navegar  ⎵ selecionar  ⏎ confirmar  Backspace apaga busca${R}`
})

// ── Configuração via prompts ───────────────────────────────────────────────

async function askConfig(all: ProjectInfo[]): Promise<WatchConfig> {
  // Intervalo
  const intStr = await input({
    message: 'Intervalo de atualização (segundos):',
    default: '30',
    validate: v => { const n = parseInt(v, 10); return Number.isFinite(n) && n >= 5 ? true : 'Mínimo 5s' },
  })

  // OTLP
  const otlp = await input({
    message: 'OTLP endpoint (vazio = desativado):',
    default: process.env.OTEL_EXPORTER_OTLP_ENDPOINT ?? '',
  })

  // Animação
  const showBattle = await confirm({
    message: 'Mostrar batalha Claude vs Cursor no painel?',
    default: true,
  })

  // Projetos
  const paths = await checkboxSearch({
    message: 'Selecione os projetos para monitorar:',
    choices: all.map(p => ({ name: p.name, value: p.path, path: p.path })),
    pageSize: Math.min(20, all.length),
  })

  const selected = paths.length === 0 ? [] : all.filter(p => paths.includes(p.path))

  // Modo
  let viewMode: ViewMode = 'junto'
  if (selected.length > 1) {
    viewMode = await select<ViewMode>({
      message: 'Como deseja visualizar os dados?',
      choices: [
        { name: `${B}Separado${R}  — uma linha por projeto`,             value: 'separado', short: 'separado'  },
        { name: `${B}Unificado${R} — total dos projetos selecionados`,   value: 'junto',    short: 'unificado' },
        { name: `${B}Ambos${R}     — total no topo + uma linha/projeto`, value: 'ambos',    short: 'ambos'     },
      ],
    })
  }

  return {
    selectedProjects: selected,
    allProjects: all,
    viewMode,
    intervalSec: parseInt(intStr, 10),
    otlpEndpoint: otlp,
    showBattle,
  }
}

// ── Entry point ────────────────────────────────────────────────────────────

async function main() {
  console.log(`\n${B}${BCY}Claude Stats — Watch CLI${R}\n`)
  console.log(`${D}Descobrindo projetos...${R}`)

  const all = await discoverProjects()
  if (all.length === 0) {
    console.error(`\nNenhum projeto encontrado em:\n  ${SESSION_META_DIR}\n  ${PROJECTS_DIR}`)
    process.exit(1)
  }
  console.log(`${GR}${all.length} projetos encontrados.${R}\n`)

  const cfg = await askConfig(all)
  await watchLoop(cfg)
}

main().catch(err => {
  write(SHOW_CUR + ALT_OFF)
  console.error('Erro fatal:', err)
  process.exit(1)
})
