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
 * once (the CONFLICT), and a member endpoint long enough to have wrecked the header once already.
 * `--mode` picks which of those arrangements you get.
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
type Case = 'solo' | 'central' | 'member' | 'conflict' | 'nodocker'

const CASES: readonly Case[] = ['solo', 'central', 'member', 'conflict', 'nodocker'] as const

interface Options {
  cols: number
  rows: number
  lang: CliLang
  screen: TabId
  mode: Case
  /** Keys pressed before the frame is captured — how a question gets on screen. */
  keys: string[]
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
                            conflict = native AND docker up; nodocker = no docker installed
    --keys   k,k,…          press these first, e.g. enter,down,enter
                            names: enter esc tab shift-tab up down left right
                            pgup pgdn space; anything else is typed literally
    --pending               history consent still unanswered, so a start opens the
                            gate: --pending --keys enter,right,enter
`

function parseArgs(argv: string[]): Options {
  const opts: Options = { cols: 100, rows: 34, lang: 'en', screen: 'services', mode: 'solo', keys: [], pending: false }
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i]
    const value = argv[i + 1] ?? ''
    switch (flag) {
      case '--cols': opts.cols = Math.max(20, Number(value) || opts.cols); i++; break
      case '--rows': opts.rows = Math.max(10, Number(value) || opts.rows); i++; break
      case '--lang': opts.lang = value === 'pt' ? 'pt' : 'en'; i++; break
      case '--keys': opts.keys = value.split(',').filter(Boolean); i++; break
      case '--pending': opts.pending = true; break
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

const MINUTES = 60_000

/** A long, real-shaped tailnet endpoint — the one whose sentence used to blow the header apart. */
const LONG_ENDPOINT = 'http://100.109.247.39:48080'

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

  return [
    // `boot` is what only an OS probe can answer, so the preview states BOTH shapes at once: the
    // native server is registered with systemd, and the central's boot state could not be
    // determined — which must render as no boot row at all rather than as "no".
    buildService('agentistics', s.svcAgentistics, [native, machine], s, { boot: 'on' }),
    buildService('central', s.svcCentral, [central], s),
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

function fakeHost(opts: Options): ControlHost {
  const done = async () => ({ ok: true, message: 'preview — nothing was performed' })
  return {
    refresh: async () => fakeStatus(opts),
    start: done,
    connect: done,
    disconnect: done,
    restart: done,
    stop: done,
    setMode: done,
    initCentral: done,
    // `null` is "already answered", so the preview only opens on the consent gate when asked to.
    pendingArchiveMode: async () => (opts.pending ? 'consolidate' : null),
    setArchiveMode: done,
    enableBoot: done,
    setLang: async () => {},
    // The preview has no terminal to report a mouse, so `ControlCenter` is rendered without a
    // channel and never asks for tracking — this only satisfies the contract.
    setMouse: async () => {},
    // Present so the preview shows the cockpit's full action row. `openUrl` is optional on the
    // host, and a host without it makes the action, the `o` key and its footer hint all disappear.
    openUrl: done,
    readLog: async (source, maxLines) => (LOG[source] ?? []).slice(-maxLines),
  }
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
/** Written as a code point rather than typed, so this file stays plain text. */
const ESC = String.fromCharCode(27)

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
