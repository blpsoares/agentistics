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

const HOME_DIR   = process.env.HOME ?? process.env.USERPROFILE ?? ''
const CLAUDE_DIR = join(HOME_DIR, '.claude')
const API_BASE   = 'http://localhost:3001'

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

// ── API ────────────────────────────────────────────────────────────────────

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

// ── Reload de dados (apenas via API) ──────────────────────────────────────

async function reloadData(config: WatchConfig): Promise<{
  snapshots: Map<string, CliSnapshot>
  dataSource: DataSrc
}> {
  const paths     = config.selectedProjects.length > 0 ? config.selectedProjects.map(p => p.path) : undefined
  const snapshots = new Map<string, CliSnapshot>()

  const apiData = await fetchApi(30_000)
  if (!apiData) throw new Error('API indisponivel')

  const { sessions, statsCache } = apiData
  snapshots.set('', computeSnapshot(sessions, statsCache, paths))
  for (const p of config.selectedProjects) {
    snapshots.set(p.path, computeSnapshot(sessions, statsCache, [p.path]))
  }
  return { snapshots, dataSource: 'api' }
}

// ── Loader: Claude caçando tokens ─────────────────────────────────────────

async function withLoader<T>(msg: string, fn: () => Promise<T>): Promise<T> {
  const H   = 5
  const W   = Math.min(process.stdout.columns || 80, 100)
  const fld = W - 4
  // Tokens fogem para a esquerda (offset cresce = conteudo desliza para esquerda)
  const PAT = '  $   $$  $    $$$   $  $$    $   $  $$$  '
  // Frames de corrida: [cabeca, torso, pernas]
  const RF: [string, string, string][] = [
    ['\\o/', ' |  ', '/ \\ '],
    [' o/', '/|\\ ', '/ \\ '],
    [' o ', ' |/ ', '\\ / '],
    ['\\o ', ' |  ', '\\ / '],
  ]
  const cp = Math.floor(fld * 0.35)

  let frame = 0

  const draw = () => {
    const off   = (frame * 2) % PAT.length
    const river = (PAT + PAT + PAT).slice(off, off + fld)
    // apaga zona do Claude para nao sobrepor tokens
    const rArr = river.split('')
    for (let i = Math.max(0, cp - 1); i < Math.min(rArr.length, cp + 5); i++) rArr[i] = ' '
    const rLine = rArr.join('')
    const rf = RF[frame % RF.length]!

    out(`\x1b[${H}A`)
    out(`  ${YL}${rLine}${R}\n`)
    out(`  ${' '.repeat(cp)}${YL}${rf[0]}${R}${GR}~~>${R}\n`)
    out(`  ${' '.repeat(cp)}${D}${rf[1]}${R}\n`)
    out(`  ${' '.repeat(cp)}${YL}${rf[2]}${R}\n`)
    out(`  ${D}${msg}${R}\n`)
  }

  out('\n'.repeat(H))
  draw()
  const timer = setInterval(() => { frame++; draw() }, 120)

  try {
    return await fn()
  } finally {
    clearInterval(timer)
    out(`\x1b[${H}A`)
    for (let i = 0; i < H; i++) out('\x1b[2K\n')
    out(`\x1b[${H}A`)
  }
}

// ── Animação: Claude resolve um incidente de produção ────────────────────
// Cada frame = 4 linhas com largura visível exatamente igual a FW.

const FW = 44

const fp = (s: string) => s + ' '.repeat(Math.max(0, FW - visLen(s)))

// Cada elemento: [linha1, linha2, linha3, label]
const FRAMES: Array<[string, string, string, string]> = [
  [ // 0 — tudo ok
    fp(`  ${GR}.-----------.${R}  status: ${GR}[OK]${R}`),
    fp(`  ${GR}| PROD SYS  |${R}  uptime: 99.9%`),
    fp(`  ${GR}'-----------'${R}  errors:  ${GR}0${R}`),
    fp(`  ${D}all systems normal${R}`),
  ],
  [ // 1 — alerta dispara
    fp(`  ${RD}.-----------.${R}  ${B}${RD}[!]${R} Error spike!`),
    fp(`  ${RD}|  ALERT!!  |${R}  ${B}${RD}[!]${R} P0 incident`),
    fp(`  ${RD}'-----------'${R}  errors: 500/min`),
    fp(`  ${YL}waking up claude...${R}`),
  ],
  [ // 2 — claude lendo logs
    fp(`   ${YL}o${R}   ${D}$ tail -f /var/log/app.log${R}`),
    fp(`  ${YL}/|\\${R}  ${RD}> ERROR line 42: null ref${R}`),
    fp(`  ${YL}/ \\${R}  ${RD}> ERROR line 42: null ref${R}`),
    fp(`  ${D}investigating...${R}`),
  ],
  [ // 3 — achou o bug
    fp(`   ${YL}o${R}   ${B}${GR}AHA!${R} found it - ${RD}line 42${R}`),
    fp(`  ${YL}/|\\${R}  ${RD}> if (obj.get() == null)${R}`),
    fp(`  ${YL}/ \\${R}  ${GR}> fix: obj?.get() ?? ''${R}`),
    fp(`  ${GR}got the bug!${R}`),
  ],
  [ // 4 — digitando a correcao
    fp(`   ${YL}o${R}   ${D}$ vim src/handler.ts:42${R}`),
    fp(`  ${YL}\\|/${R}  ${RD}[-]${R} ${D}if (obj.get() == null)${R}`),
    fp(`   ${YL}|${R}   ${GR}[+]${R} ${GR}if (obj?.get() == null)${R}`),
    fp(`  ${D}patching...${R}`),
  ],
  [ // 5 — commit
    fp(`   ${YL}o${R}   ${D}$ git commit -m "fix: ..."${R}`),
    fp(`  ${YL}/|\\${R}  ${GR}[main a1b2c3] fix: null ref${R}`),
    fp(`  ${YL}/ \\${R}  ${D}1 file changed, +1 -1${R}`),
    fp(`  ${GR}committed!${R}`),
  ],
  [ // 6 — deploy
    fp(`   ${YL}o${R}   ${D}$ git push && ./deploy.sh${R}`),
    fp(`  ${YL}/|\\${R}  ${YL}Deploying... ${GR}[========]${R}`),
    fp(`  ${YL}/ \\${R}  ${GR}Build: OK    Tests: PASS${R}`),
    fp(`  ${YL}deploying fix...${R}`),
  ],
  [ // 7 — resolvido, heroi
    fp(`  ${GR}.-----------.${R}  status: ${GR}[OK]${R}`),
    fp(`  ${GR}| INCIDENT  |${R}  errors: ${GR}0${R}`),
    fp(`  ${GR}| RESOLVED  |${R}  fixed in ${B}4m32s${R}`),
    fp(`  ${BC}${B}hero mode: activated${R}`),
  ],
]

function renderBattle(frame: number): string[] {
  const f = FRAMES[frame % FRAMES.length]!
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
  const c = v.map((x, i) => padStr(x, COLS[i]!.w))
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
  lines.push(`  ${D}Ctrl+C sair  |  Ctrl+O ${st.showBattle ? 'ocultar' : 'mostrar'} animacao${R}`)
  return lines.join('\n') + '\n'
}

// ── Watch loop ─────────────────────────────────────────────────────────────

async function watchLoop(cfg: WatchConfig): Promise<void> {
  const st: AppState = {
    snapshots: new Map(), lastUpdated: new Date(),
    animFrame: 0, showBattle: cfg.showBattle, isLoading: true, dataSource: 'api' as DataSrc,
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
    message: 'Mostrar animacao "Claude resolve incidente" no painel?',
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
  console.log(`${GR}Servidor iniciado (pid ${spawnedServer?.pid}).${R}`)
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
  console.log(`${GR}${allProjects.length} projetos encontrados.${R}\n`)

  const cfg = await askConfig(allProjects)
  await watchLoop(cfg)
}

main().catch(err => {
  out(SHOW + ALT_OFF)
  console.error('Erro fatal:', err)
  process.exit(1)
})
