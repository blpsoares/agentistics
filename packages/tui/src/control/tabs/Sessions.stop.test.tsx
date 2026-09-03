import React from 'react'
import { describe, test, expect } from 'bun:test'
import { render } from 'ink-testing-library'
import { ControlCenter } from '../ControlCenter'
import type { ControlHost, ControlSession, ControlSessions, ControlStatus, SessionViewPrefs } from '../types'

/**
 * Pinning a row and picking one to KILL, driven through the real keyboard.
 *
 * The pure half of this lives in `sessions.test.ts` (`stopTargets`, `bulkStopToggle`). What it
 * cannot state is the wiring, and the wiring is where the reported defect actually was: `space`
 * pinned a row — a keeping gesture, written to `preferences.json`, that lifts the row into its own
 * band because you were about to come back to it — and `x` then offered to stop "the N marked
 * sessions". The gesture for keeping armed a mass deletion, and it did so through a component, not
 * through a function anybody could test.
 *
 * So these press the actual keys against the actual screen and read the actual frame.
 */

const ESC = '\x1b'
const CTRL_X = '\x18'

/** Strip whole CSI sequences, not only SGR — a half-stripped frame reads as text until it doesn't. */
function plain(frame: string | undefined): string {
  return (frame ?? '').replace(/\x1b\[[0-9;:?]*[ -/]*[@-~]/g, '')
}

const COLS = 120
const ROWS = 34

function session(o: Partial<ControlSession> & { id: string; title: string }): ControlSession {
  return {
    harness: 'claude',
    state: 'waiting',
    stateLabel: 'waiting',
    actionable: true,
    cwd: '/home/dev/repo',
    project: 'repo',
    ...o,
  } as ControlSession
}

const SESSIONS: ControlSession[] = [
  session({ id: 'aaa11', title: 'alpha' }),
  session({ id: 'bbb22', title: 'bravo' }),
  session({ id: 'ccc33', title: 'charlie' }),
  session({ id: 'ddd44', title: 'delta' }),
]

const STATUS: ControlStatus = {
  mode: 'solo',
  modeLabel: 'solo',
  services: [],
  version: '1.0.0',
  // Flat and unfiltered, so the four rows are drawn in a known order with no headings between them.
  sessionView: {
    grouping: 'none',
    showClosed: true,
    showExited: true,
    showUnfiled: true,
    showDone: true,
    onlyActive: false,
    layout: 'list',
  },
}

interface Rig {
  /** Ids the host was actually asked to stop, in the order it was asked. */
  killed: string[]
  /** Every `sessionView` the screen has written to disk, newest last. */
  written: Partial<SessionViewPrefs>[]
  host: ControlHost
}

function rig(): Rig {
  const killed: string[] = []
  const written: Partial<SessionViewPrefs>[] = []
  const done = async () => ({ ok: true, message: '' })
  const fleet = (): ControlSessions => ({
    sessions: SESSIONS.filter(s => !killed.includes(s.id)),
    attention: 0,
    rang: [],
  })
  const host = {
    refresh: async () => STATUS,
    lastStatus: () => STATUS,
    start: done,
    connect: done,
    disconnect: done,
    restart: done,
    stop: done,
    setMode: done,
    initCentral: done,
    upgrade: done,
    pendingArchiveMode: async () => null,
    setArchiveMode: done,
    enableBoot: done,
    setLang: async () => {},
    setSessionView: async (view: Partial<SessionViewPrefs>) => { written.push(view) },
    setMouse: async () => {},
    setSessionPollMs: async () => {},
    onOutput: () => () => {},
    readLog: async () => [],
    sessions: async () => fleet(),
    killSession: async (id: string) => { killed.push(id); return { ok: true, message: '' } },
  } as unknown as ControlHost
  return { killed, written, host }
}

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

/**
 * Just the QUESTION pane, as one line of text.
 *
 * The list is still on screen behind every confirmation — deliberately, so the row being acted on
 * stays visible — so asserting "the question does not mention the pinned rows" against the whole
 * frame would be asserting that the list is empty. This is the region the person reads before
 * answering, and it is the only region the claim is about.
 */
function question(frame: string): string {
  const lines = frame.split('\n')
  const at = lines.findIndex(l => l.includes('─ question ─'))
  if (at < 0) return ''
  // Down to the blank row that separates the sentence from the yes/no menu — the menu's own `1.`
  // and `2.` are chrome, and a claim about what the question says must not be read against them.
  const out: string[] = []
  for (let i = at + 1; i < lines.length; i++) {
    const text = (lines[i] ?? '').replace(/[│╰╯─]/g, '').trim()
    if (text === '') break
    out.push(text)
  }
  return out.join(' ')
}

/**
 * Mount the cockpit on the sessions list, type `keys`, and hand back the frame it settled on.
 *
 * One key per tick with a beat between, exactly as `scripts/preview.tsx` does it: a burst written
 * in one chunk is parsed as a single garbled escape sequence, and a question opens on a state
 * change the next key has to be able to see.
 */
async function drive(host: ControlHost, keys: readonly string[]): Promise<{ frame: string; unmount: () => void }> {
  const size = { columns: process.stdout.columns, rows: process.stdout.rows }
  Object.defineProperty(process.stdout, 'columns', { value: COLS, configurable: true })
  Object.defineProperty(process.stdout, 'rows', { value: ROWS, configurable: true })
  const element = <ControlCenter host={host} lang="en" initial={{ tab: 'sessions' }} onExit={() => {}} />
  const app = render(element)
  // ink-testing-library hardcodes a 100-column stdout behind a prototype getter; shadowing it on
  // the instance and re-rendering is what makes the frame land at the requested width.
  Object.defineProperty(app.stdout, 'columns', { get: () => COLS, configurable: true })
  app.rerender(element)
  await sleep(150)
  for (const key of keys) {
    app.stdin.write(key)
    await sleep(60)
  }
  await sleep(80)
  const frame = plain(app.lastFrame())
  Object.defineProperty(process.stdout, 'columns', { value: size.columns, configurable: true })
  Object.defineProperty(process.stdout, 'rows', { value: size.rows, configurable: true })
  return { frame, unmount: () => app.unmount() }
}

describe('pinning and stopping are two gestures', () => {
  test('`x` outside the mode names the ROW UNDER THE CURSOR, whatever is pinned', async () => {
    // THE REPORTED DEFECT. Two rows pinned with `space`, the cursor moved onto a third, `x`.
    const r = rig()
    const { frame, unmount } = await drive(r.host, [' ', '\x1b[B', ' ', '\x1b[B', 'x'])
    try {
      // Both rows really are pinned, and really are in the band — the pin was not silently lost.
      expect(frame).toContain('pinned  2')
      // And the question names ONE session, the third row: neither pinned row is in it.
      const asked = question(frame)
      expect(asked).toContain('Stop "charlie"? The assistant running in it is ended.')
      expect(asked).not.toContain('alpha')
      expect(asked).not.toContain('bravo')
      // No count of anything. The old question was "encerrar as 2 sessões marcadas?".
      expect(asked).not.toMatch(/\d/)
    } finally { unmount() }
  })

  test('the mode is ANNOUNCED, and `space` inside it selects instead of pinning', async () => {
    const r = rig()
    const { frame, unmount } = await drive(r.host, [CTRL_X, ' ', '\x1b[B', ' '])
    try {
      // Readable from the screen alone: the pane title and the banner both say it, and the banner
      // names every key that works while it is on.
      expect(frame).toContain('sessions · STOP MODE')
      expect(frame).toContain('STOP MODE · 2 selected to stop')
      expect(frame).toContain('space selects')
      expect(frame).toContain('ctrl+x leaves')
      // `space` did NOT pin: the pinned band does not exist, because nothing is pinned.
      expect(frame).not.toContain('pinned')
    } finally { unmount() }
  })

  test('`x` inside the mode stops exactly the picked rows, states the count, and LEAVES the mode', async () => {
    const r = rig()
    // Pin the first row, then pick the second, third and fourth for stopping. The pinned row is
    // deliberately not picked: it must survive.
    const { frame, unmount } = await drive(r.host, [
      ' ', '\x1b[B', CTRL_X, ' ', '\x1b[B', ' ', '\x1b[B', ' ',
      // `x`, then up to `Yes`, then enter.
      'x', '\x1b[A', '\r',
    ])
    try {
      expect(r.killed.sort()).toEqual(['bbb22', 'ccc33', 'ddd44'])
      // The mode closed BY ITSELF — no second keystroke was typed after the confirmation.
      expect(frame).not.toContain('STOP MODE')
      // And the pinned row is still there, still pinned, still in its band.
      expect(frame).toContain('pinned')
      expect(frame).toContain('alpha')
    } finally { unmount() }
  })

  test('the confirmation inside the mode states how many rows are about to die', async () => {
    const r = rig()
    const { frame, unmount } = await drive(r.host, [CTRL_X, ' ', '\x1b[B', ' ', '\x1b[B', ' ', 'x'])
    try {
      expect(frame).toContain('Stop the 3 selected sessions?')
      expect(r.killed).toEqual([])
    } finally { unmount() }
  })

  test('leaving the mode with `ctrl+x` stops nothing and leaves the pinned set alone', async () => {
    const r = rig()
    const { frame, unmount } = await drive(r.host, [' ', '\x1b[B', CTRL_X, ' ', '\x1b[B', ' ', CTRL_X])
    try {
      expect(r.killed).toEqual([])
      expect(frame).not.toContain('STOP MODE')
      // The pin the person made before entering is untouched.
      expect(frame).toContain('pinned')
      // Re-entering finds nothing waiting: the banner counts zero.
      unmount()
    } finally { /* unmounted above */ }
  })

  test('the stop selection is never written to disk, and pinning still is', async () => {
    const r = rig()
    const { unmount } = await drive(r.host, [' ', '\x1b[B', CTRL_X, ' ', '\x1b[B', ' '])
    try {
      // Pinning reached the disk seam...
      const last = r.written.at(-1)
      expect(last).toBeDefined()
      expect(last!.marked).toEqual(['aaa11'])
      // ...and nothing the mode picked did, under any key. `bbb22`/`ccc33` were picked to be
      // stopped and appear nowhere in anything that was persisted.
      const all = JSON.stringify(r.written)
      expect(all).not.toContain('bbb22')
      expect(all).not.toContain('ccc33')
    } finally { unmount() }
  })

  test('`esc` keeps its own job — it does not double as the way out of the mode', async () => {
    // Declared behaviour, held here so it cannot drift into a second exit by accident: `esc` on
    // this screen drops the search, then the project, then the task. `ctrl+x` is the one key that
    // leaves the mode.
    const r = rig()
    const { frame, unmount } = await drive(r.host, [CTRL_X, ' ', ESC])
    try {
      expect(frame).toContain('STOP MODE')
      expect(frame).toContain('1 selected to stop')
    } finally { unmount() }
  })
})
