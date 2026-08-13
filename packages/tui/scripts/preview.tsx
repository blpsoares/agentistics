#!/usr/bin/env bun
/**
 * preview.tsx — render the control center to plain stdout, at a size you choose.
 *
 * The control center only ever runs inside an alternate screen on a real tty, which makes it
 * exactly the kind of surface nobody can look at while building it: a screenshot needs a pty, and a
 * pty is not something a review, a diff or an agent has. This renders one frame through
 * `ink-testing-library` — no alternate screen, no raw mode, no host process — and prints it between
 * width rulers, so a row that overflows the terminal it was designed for is visible at a glance
 * instead of a bug report three days later.
 *
 *   bun run packages/tui/scripts/preview.tsx [--cols 100] [--rows 34]
 *                                            [--lang en|pt] [--screen services] [--mode solo|central|member]
 *
 * The host is a FAKE. It answers instantly, performs nothing, and is deliberately stocked with the
 * awkward cases rather than the happy one: a native server with a pid and an uptime, a service that
 * is down, a runtime whose state could not be detected at all, both runtimes of one service up at
 * once (the CONFLICT), a box with no repo checkout (so no rebuild is offered), and a member endpoint
 * long enough to have wrecked the header once already. `--mode` picks which arrangement you get.
 *
 * `--task` is the other half: it makes the fake host STREAM a realistic build into the output channel
 * — raw bytes, carriage returns and colour included, through the real decoder — so the pane a task
 * owns can be looked at both while it runs and once it has finished.
 *
 * The service rows themselves are built by the host's OWN `buildService` — the pure half of
 * `cli-start.ts` — rather than assembled here by hand. A preview that composed its own rows could
 * draw a screen the real model cannot produce, which is the one thing a preview must not do.
 *
 * This is a dev tool: it is not a test, it must not be collected as one, and nothing ships imports
 * it. Its only claim is "this is what the frame looks like".
 */

import React from 'react'
import { render } from 'ink-testing-library'
import { ControlCenter } from '../src/control/ControlCenter'
import {
  TAB_ORDER,
  type ControlHost,
  type ControlSession,
  type ControlSessions,
  type ProjectOption,
  type ControlService,
  type ControlStatus,
  type ServiceRuntimeState,
  type TabId,
} from '../src/control/types'
import type { CliLang } from '../src/control/lang'
// The real string table, not a copy of it. Every label on this screen arrives from the host already
// localized, so a preview that invented its own words would be previewing a different screen —
// and `--lang pt` would prove nothing. `cli-i18n.ts` is a dependency-free table of strings; reading
// it from a dev script does not give the TUI a runtime dependency on the server.
import { cliStrings, type CliStrings } from '../../server/server/cli-i18n'
import { buildService } from '../../server/server/cli-start'
// The REAL sanitiser, fed the raw bytes a build produces: a preview that emitted clean lines would
// be previewing a pane nobody's docker ever fills.
import { createLineDecoder } from '../src/control/stream'

// ---------------------------------------------------------------------------
// arguments
// ---------------------------------------------------------------------------

/**
 * Which fake machine to draw.
 *
 * The first three are team modes; the last two are the states that are hard to reach on purpose and
 * therefore the ones most likely to ship wrong — a box running the server natively AND in a
 * container, and a box with no docker at all.
 */
type Case = 'solo' | 'central' | 'member' | 'conflict' | 'nodocker' | 'norepo'

const CASES: readonly Case[] = ['solo', 'central', 'member', 'conflict', 'nodocker', 'norepo'] as const

/**
 * What a previewed task is doing when the frame is captured.
 *
 * `running` never resolves, which is exactly what a two-minute build looks like from here: the
 * spinner is still turning and the pane is following the newest line. `done` resolves, so the pane
 * keeps its output and the status line carries the outcome.
 */
type TaskState = 'off' | 'running' | 'done'

interface Options {
  cols: number
  rows: number
  lang: CliLang
  screen: TabId
  mode: Case
  /** Keys pressed before the frame is captured — how a question gets on screen. */
  keys: string[]
  /** Stream a build into the output channel: `running` (unfinished) or `done`. */
  task: TaskState
  /**
   * Pretend the history consent has never been answered.
   *
   * On its own it changes nothing on screen: the gate is asked in FRONT of a start, never at load,
   * so it takes a start to reach it (`--keys enter,right,enter` on a stopped service).
   */
  pending: boolean
}

const USAGE = `
  preview — render one control-center frame to stdout

    --cols   N              terminal width  (default 100)
    --rows   N              terminal height (default 34)
    --lang   en|pt          language        (default en)
    --screen ${TAB_ORDER.join('|')}
    --mode   ${CASES.join('|')}
                            which fake machine to show (default solo)
                            conflict = native AND docker up; nodocker = no docker installed;
                            norepo = no checkout here, so no rebuild is offered
    --keys   k,k,…          press these first, e.g. enter,down,enter
                            names: enter esc tab shift-tab up down left right
                            pgup pgdn space; anything else is typed literally
    --task   running|done   the next start/restart streams a build into the output pane
                            and either never finishes (running) or does (done);
                            reach it with --keys enter,enter
    --pending               history consent still unanswered, so a start opens the
                            gate: --pending --keys enter,right,enter
`

function parseArgs(argv: string[]): Options {
  const opts: Options = {
    cols: 100, rows: 34, lang: 'en', screen: 'services', mode: 'solo', keys: [], task: 'off', pending: false,
  }
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i]
    const value = argv[i + 1] ?? ''
    switch (flag) {
      case '--cols': opts.cols = Math.max(20, Number(value) || opts.cols); i++; break
      case '--rows': opts.rows = Math.max(10, Number(value) || opts.rows); i++; break
      case '--lang': opts.lang = value === 'pt' ? 'pt' : 'en'; i++; break
      case '--keys': opts.keys = value.split(',').filter(Boolean); i++; break
      case '--pending': opts.pending = true; break
      case '--task':
        opts.task = value === 'done' ? 'done' : 'running'
        i++
        break
      case '--mode':
        opts.mode = CASES.find(c => c === value) ?? 'solo'
        i++
        break
      case '--screen': {
        const tab = TAB_ORDER.find(t => t === value)
        if (!tab) {
          process.stderr.write(`unknown screen: ${value}\n${USAGE}`)
          process.exit(2)
        }
        opts.screen = tab
        i++
        break
      }
      case '-h':
      case '--help':
        process.stdout.write(USAGE)
        process.exit(0)
        break
      default:
        process.stderr.write(`unknown flag: ${flag}\n${USAGE}`)
        process.exit(2)
    }
  }
  return opts
}

// ---------------------------------------------------------------------------
// the fake host
// ---------------------------------------------------------------------------

/** Written as a code point rather than typed, so this file stays plain text. */
const ESC = String.fromCharCode(27)

const MINUTES = 60_000

/** A long, real-shaped tailnet endpoint — the one whose sentence used to blow the header apart. */
const LONG_ENDPOINT = 'http://198.51.100.199:48080'

const LOCAL_URLS = { webUrl: 'http://localhost:47292', apiUrl: 'http://localhost:47291' }

/**
 * The two LOGICAL services, assembled by the host's own pure `buildService`.
 *
 * Each case says only which RUNTIMES are up; everything the screen reacts to — the start options a
 * stopped service offers, the conflict sentence, the empty option list of a running one — falls out
 * of the model rather than being written down here.
 */
function services(mode: Case, s: CliStrings): ControlService[] {
  const nativeUp = mode !== 'central'
  const machineUp = mode === 'conflict'
  const noDocker = mode === 'nodocker'

  const native: ServiceRuntimeState = {
    id: 'local',
    kind: 'native',
    state: nativeUp ? 'up' : 'down',
    available: true,
    ...(nativeUp ? { ...LOCAL_URLS, pid: 48213, startedAt: Date.now() - 134 * MINUTES } : {}),
  }
  const machine: ServiceRuntimeState = {
    id: 'machine',
    kind: 'docker',
    // Detection itself failed here — the state a service panel gets wrong most expensively. A
    // runtime that CANNOT run (no docker) is `available: false`, which is what keeps it from
    // colouring its service `unknown` on every box that has never installed docker.
    state: noDocker ? 'unknown' : machineUp ? 'up' : 'down',
    available: !noDocker,
    reason: noDocker ? s.dockerMissing : undefined,
    ...(machineUp ? { ...LOCAL_URLS, pid: 61044, startedAt: Date.now() - 12 * MINUTES } : {}),
  }
  const central: ServiceRuntimeState = {
    id: 'central',
    kind: 'docker',
    state: noDocker ? 'unknown' : mode === 'central' ? 'up' : 'down',
    available: !noDocker,
    reason: noDocker ? s.dockerMissing : undefined,
    ...(mode === 'central'
      ? { webUrl: 'http://localhost:48080', pid: 71120, startedAt: Date.now() - 3 * 24 * 60 * MINUTES }
      : {}),
  }

  // What a REBUILD needs, which is a fact about the box rather than about the service: a repo
  // checkout for the native binary, a compose file for the container. `norepo` is the box that has
  // neither, and the restart row there is the plain bounce alone.
  const canRebuild = mode !== 'norepo'

  return [
    // `boot` is what only an OS probe can answer, so the preview states BOTH shapes at once: the
    // native server is registered with systemd, and the central's boot state could not be
    // determined — which must render as no boot row at all rather than as "no".
    buildService('agentistics', s.svcAgentistics, [native, machine], s, {
      boot: 'on',
      rebuild: { local: canRebuild, machine: canRebuild },
    }),
    buildService('central', s.svcCentral, [central], s, { rebuild: { central: true } }),
  ]
}

function fakeStatus(opts: Options): ControlStatus {
  const s = cliStrings(opts.lang)
  return {
    // The two extra cases are arrangements of SERVICES, not team modes; they show a solo machine.
    mode: opts.mode === 'central' || opts.mode === 'member' ? opts.mode : 'solo',
    modeLabel: opts.mode === 'member' ? s.configMemberBare : opts.mode === 'central' ? s.configCentral : s.configSolo,
    endpoint: opts.mode === 'member' ? LONG_ENDPOINT : undefined,
    services: services(opts.mode, s),
    version: '1.7.3',
    latestVersion: '1.7.4',
    archiveMode: 'consolidate',
  }
}

/**
 * Plausible tail lines, so the Logs screen is exercised at its real line lengths.
 *
 * Keyed by every `LogSource` the selector can produce: the two LOGICAL services normally, and the
 * two runtimes of `agentistics` in the conflict case, where they genuinely are different logs.
 */
const NATIVE_LOG = [
  '20:58:11 listening on 47291 (api + mcp)',
  '20:58:11 dashboard on 47292',
  '20:58:12 otel watcher started',
  '20:59:03 sse client connected',
  '21:03:44 rebuilt stats cache in 412ms',
]

const LOG: Record<string, string[]> = {
  agentistics: NATIVE_LOG,
  local: NATIVE_LOG,
  machine: [
    '20:31:08 [container] listening on 47291 (api + mcp)',
    '20:31:09 [container] dashboard on 47292 — ADDRESS ALREADY IN USE, retrying',
  ],
  central: [
    '20:12:02 mongo connected',
    '20:12:02 central listening on 47291',
    '20:44:19 member push accepted · 214 sessions',
  ],
}

/**
 * The raw bytes of a `docker compose up --build`, in the shapes that break a naive reader.
 *
 * A hidden cursor, a step table redrawn in place with carriage returns, colour around a step name, a
 * chunk that ends mid-line, a blank separator the build actually printed, and an error on the way
 * out. Fed through the real decoder, so what the pane shows here is what it will show there.
 */
const BUILD_CHUNKS: string[] = [
  `${ESC}[?25l#1 [internal] load build definition from Dockerfile\n`,
  '#1 transferring dockerfile: 1.4s\r#1 transferring dockerfile: 2.7s\r#1 DONE 2.7s\n\n',
  `#2 [internal] load metadata for docker.io/oven/bun:1${ESC}[0m\n#2 DONE 0.9s\n`,
  '#3 [builder 2/8] COPY package.json bun.lock ./\n#3 CACHED\n',
  '#4 [builder 3/8] RUN bun install --frozen-lockfile\n',
  '#4 1.882 bun install v1.3.14\n#4 12.40 + 412 packages installed [11.9s]\n#4 DONE 12.9s\n',
  '#5 [builder 6/8] RUN bun run build:binary\n#5 24.11   dist/index.html   0.53 kB\n#5 41.06 ',
  `  compiled ./release/agentop\n#5 DONE 41.3s\n\n#6 exporting to image\n#6 DONE 3.1s\n${ESC}[?25h`,
]

function fakeHost(opts: Options): ControlHost {
  const done = async () => ({ ok: true, message: 'preview — nothing was performed' })

  // The output channel, in the shape `cli-stream.ts` implements for real.
  const watchers = new Set<(line: string) => void>()
  const publish = (line: string) => { for (const w of [...watchers]) w(line) }

  /**
   * A streamed action: publish the build, then either finish or never.
   *
   * Deliberately NOT resolved for `running` — that is what a build in flight is, and it is the only
   * way to capture the frame where the pane is following a task that has not finished.
   */
  const streamed = async () => {
    const decoder = createLineDecoder()
    for (const chunk of BUILD_CHUNKS) for (const line of decoder.push(chunk)) publish(line)
    for (const line of decoder.flush()) publish(line)
    if (opts.task === 'running') return new Promise<never>(() => {})
    return { ok: true, message: 'preview — nothing was performed' }
  }

  const act = opts.task === 'off' ? done : streamed

  return {
    refresh: async () => fakeStatus(opts),
    start: act,
    connect: done,
    disconnect: done,
    restart: act,
    stop: done,
    setMode: done,
    initCentral: done,
    // `null` is "already answered", so the preview only opens on the consent gate when asked to.
    pendingArchiveMode: async () => (opts.pending ? 'consolidate' : null),
    upgrade: done,
    setArchiveMode: done,
    enableBoot: done,
    setLang: async () => {},
    // The preview has no terminal to report a mouse, so `ControlCenter` is rendered without a
    // channel and never asks for tracking — this only satisfies the contract.
    setMouse: async () => {},
    // Present so the preview shows the cockpit's full action row. `openUrl` is optional on the
    // host, and a host without it makes the action, the `o` key and its footer hint all disappear.
    openUrl: done,
    onOutput: handler => {
      watchers.add(handler)
      return () => { watchers.delete(handler) }
    },
    readLog: async (source, maxLines) => (LOG[source] ?? []).slice(-maxLines),
    sessions: async () => FAKE_FLEET,
    startableHarnesses: async () => [
      { id: 'claude', label: 'claude', modelSuggestions: ['opus', 'sonnet', 'haiku'], supportsModel: true, efforts: ['low', 'medium', 'high', 'xhigh', 'max'] },
      { id: 'codex', label: 'codex', modelSuggestions: ['gpt-5.4', 'gpt-5.4-mini'], supportsModel: true, efforts: [] },
      { id: 'kimi', label: 'kimi', modelSuggestions: ['kimi-k3'], supportsModel: true, efforts: [] },
    ],
    searchProjects: async (query: string) => FAKE_PROJECTS
      .filter(p => p.label.toLowerCase().includes(query.trim().toLowerCase())),
    spawnSession: async () => ({ ok: true, message: 'preview — nothing was performed' }),
  }
}

/**
 * A fleet worth looking at: one blocked on a question, one waiting, one working, one finished, and
 * one running outside agentop.
 *
 * Deliberately covers every state the row can wear, because the point of the preview is to catch a
 * row that does not fit — and the state word is the one cell the screen may never give up, so the
 * widest of them (`needs approval`) has to be on screen at every width being checked.
 */
const FAKE_PROJECTS: ProjectOption[] = [
  { path: '/home/dev/agentistics', label: 'agentistics', repo: 'blpsoares/agentistics', detail: '~/agentistics', source: 'cwd' },
  { path: '/home/dev/prontuario', label: 'prontuario', repo: 'org/prontuario', detail: '~/prontuario', source: 'history' },
  { path: '/home/dev/agentistics-wt', label: 'session-monitor', repo: 'blpsoares/agentistics', detail: '~/agentistics/…/worktrees/session-monitor', source: 'history' },
  { path: '/home/dev/embark', label: 'embark', detail: '~/orgs/opvibes/embark', source: 'repo' },
  { path: '/home/dev/embark2', label: 'embark', detail: '~/archive/2024/embark', source: 'folder' },
  { path: '/home/dev/scratch', label: 'scratch', detail: '~/scratch', source: 'folder' },
]

const FAKE_FLEET: ControlSessions = {
  attention: 2,
  rang: [],
  detachHint: 'Ctrl-b then d',
  finishedTasks: ['billing'],
  sessions: withSearchText([
    {
      id: 'a1b2c3', title: 'migrate the auth store', harness: 'claude',
      cwd: '/home/dev/agentistics', project: 'agentistics', model: 'opus', task: 'billing',
      repo: 'blpsoares/agentistics',
      state: 'waiting-approval', stateLabel: 'needs approval', actionable: true,
      // Usage on SOME rows and not others, deliberately: the column is sized to the widest row that
      // has any, and a fixture where every row carries one would never exercise the padding.
      tokens: '51.7k', cost: '$1.24',
      startedAt: Date.now() - 22 * 60_000, attached: false,
    },
    {
      id: 'd4e5f6', title: 'flaky test hunt', harness: 'codex',
      cwd: '/home/dev/prontuario', project: 'prontuario', task: 'flaky triage', repo: 'org/prontuario',
      note: 'reproduces only on CI', state: 'waiting', stateLabel: 'waiting',
      actionable: true, approvalBlind: 'agentop has no verified screen markers for codex, so a blocking question here shows as "waiting" like any other pause.',
      startedAt: Date.now() - 3 * 60_000, attached: false,
    },
    {
      id: '778899', title: 'rewrite the importer', harness: 'kimi',
      cwd: '/home/dev/embark', project: 'embark', model: 'kimi-k3',
      state: 'working', stateLabel: 'working', actionable: true,
      tokens: '308.2k', cost: '$0.91',
      startedAt: Date.now() - 90_000, attached: true,
    },
    {
      id: 'aabbcc', title: 'release notes', harness: 'claude',
      cwd: '/home/dev/agentistics/.claude/worktrees/notes', project: 'notes',
      repo: 'blpsoares/agentistics', worktree: true,
      state: 'exited', stateLabel: 'exited', actionable: true,
      startedAt: Date.now() - 4 * 60 * 60_000, attached: false,
    },
    {
      id: 'external:claude:/home/dev/aipe:0', title: 'claude in aipe', harness: 'claude',
      cwd: '/home/dev/aipe', project: 'aipe',
      state: 'unknown', stateLabel: 'external', actionable: false,
      startedAt: Date.now() - 40 * 60_000, attached: false,
    },
    {
      id: 'closed:1', title: 'wire up the billing basis', harness: 'claude',
      cwd: '/home/dev/agentistics', project: 'agentistics', task: 'billing',
      state: 'closed', stateLabel: 'closed', actionable: false,
      resume: { sessionId: 'c1', title: 'wire up the billing basis' },
      startedAt: Date.now() - 26 * 60 * 60_000, attached: false,
    },
    {
      id: 'closed:2', title: 'billing: reconcile the ledger', harness: 'codex',
      cwd: '/home/dev/agentistics', project: 'agentistics', task: 'billing',
      state: 'closed', stateLabel: 'closed', actionable: false,
      resume: { sessionId: 'c2', title: 'billing: reconcile the ledger' },
      startedAt: Date.now() - 30 * 60 * 60_000, attached: false,
    },
  ]),
}

/** The preview's fixtures say what they ARE; the searchable blob is derived, exactly as the host
 *  derives it, so the two can never disagree about what a row can be found by. */
function withSearchText(rows: Array<Omit<ControlSession, 'searchText'>>): ControlSession[] {
  return rows.map(r => ({
    ...r,
    searchText: [r.title, r.harness, r.cwd, r.note, r.task].filter(Boolean).join(' ').toLowerCase(),
  }))
}

// ---------------------------------------------------------------------------
// framing
// ---------------------------------------------------------------------------

/**
 * Color codes occupy no cells. They stay in the printed frame — a preview in a terminal should
 * look like the thing — but are discounted when measuring, or every colored row would be
 * reported as overflowing. Spelled `\u001B` rather than typed, so the source stays plain text.
 */
const ANSI = /\u001B\[[0-9;]*m/g

function visibleWidth(line: string): number {
  return line.replace(ANSI, '').length
}

/**
 * A two-row ruler: tens above, units below.
 *
 * Column numbers, not a bare rule of dashes — when a row is three cells too long the question is
 * always "by how much", and counting dashes by eye is exactly the work this is meant to remove.
 */
function ruler(cols: number): string[] {
  let tens = ''
  let units = ''
  for (let i = 1; i <= cols; i++) {
    tens += i % 10 === 0 ? String(Math.floor(i / 10) % 10) : ' '
    units += String(i % 10)
  }
  return [tens, units]
}

/**
 * The escape sequences a real terminal sends, so `--keys` drives the app through the same parser a
 * keyboard does.
 *
 * Without this the questions — "how should it run?", the archive consent, every confirmation — are
 * unpreviewable: they exist only after a keypress, which is exactly the state a screenshot cannot
 * reach and therefore the state that shipped wrong twice.
 */
const KEYS: Record<string, string> = {
  enter: '\r',
  esc: ESC,
  tab: '\t',
  'shift-tab': `${ESC}[Z`,
  up: `${ESC}[A`,
  down: `${ESC}[B`,
  right: `${ESC}[C`,
  left: `${ESC}[D`,
  pgup: `${ESC}[5~`,
  pgdn: `${ESC}[6~`,
  space: ' ',
}

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2))

  // `useTerminalSize` reads the REAL `process.stdout`, while Ink lays out against the fake stdout
  // the testing library hands it — so a preview at anything other than the default size has to set
  // both, or the layout math and the frame it lands in would disagree about how wide the world is.
  Object.defineProperty(process.stdout, 'columns', { value: opts.cols, configurable: true })
  Object.defineProperty(process.stdout, 'rows', { value: opts.rows, configurable: true })

  const element = (
    <ControlCenter
      host={fakeHost(opts)}
      lang={opts.lang}
      initial={{ tab: opts.screen }}
      onExit={() => {}}
    />
  )

  const app = render(element)
  // ink-testing-library hardcodes a 100-column stdout behind a prototype getter. Shadowing it on
  // the instance and re-rendering is the whole of the fix: Ink re-reads `columns` on every render
  // pass, so the second frame is laid out at the requested width.
  Object.defineProperty(app.stdout, 'columns', { get: () => opts.cols, configurable: true })
  app.rerender(element)

  // The first frame is drawn before `refresh()` resolves, so it is the spinner. Waiting a beat is
  // what makes the preview show the screen rather than its loading state.
  await sleep(200)

  // One key per tick, with the app given time to settle between them: a question opens on a state
  // change, and a burst written in one chunk would be parsed as a single garbled sequence.
  for (const key of opts.keys) {
    app.stdin.write(KEYS[key] ?? key)
    await sleep(60)
  }

  const frame = app.lastFrame() ?? ''
  const lines = frame.replace(/\n+$/, '').split('\n')
  const [tens, units] = ruler(opts.cols)
  const over = lines.filter(l => visibleWidth(l) > opts.cols)

  const out = [
    `  ${opts.mode} · ${opts.screen} · ${opts.lang} · ${opts.cols}x${opts.rows}`,
    tens,
    units,
    ...lines,
    units,
    over.length
      ? `  ✗ ${over.length} row(s) exceed ${opts.cols} columns — widest is ${Math.max(...over.map(visibleWidth))}`
      : `  ✓ every row fits ${opts.cols} columns (${lines.length} of ${opts.rows} rows used)`,
    '',
  ].join('\n')

  app.unmount()
  process.stdout.write(`${out}\n`)
  // Ink's spinner keeps an interval alive past the unmount; the frame is printed, so the only thing
  // left to do is leave rather than idle on a timer nobody is watching.
  process.exit(over.length ? 1 : 0)
}

void main()
