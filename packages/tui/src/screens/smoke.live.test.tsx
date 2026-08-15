/**
 * Live smoke test: renders every screen against the REAL /api/data payload.
 *
 * Fixtures cannot stress the column math the way a full dataset does (long project paths,
 * billions of tokens, many models). Skips itself when no server is running, so it never fails
 * a clean checkout or CI.
 *
 * It checks HEIGHT as well as width now. The dashboard is drawn inside a pane in the control
 * center, so its screens no longer get the terminal — they get what the chrome and the frame leave,
 * and Ink COMPOSITES an overflowing child rather than clipping it: one row too many lands on top of
 * the row below and the frame reads as corrupted. A screen that fits at height 24 and not at 8 is
 * exactly the regression this catches.
 *
 * The 20s timeout is not slack, it is the shape of the test: it renders every screen against a LIVE
 * server's full payload, so its cost grows with the machine's own history and with whatever else the
 * suite is doing in parallel. It passes in 2s alone and timed out at 5.6s against bun's 5s default
 * during a full run — a red that says nothing about the code, which is the most expensive kind.
 */
import React from 'react'
import { test, expect } from 'bun:test'
import { render } from 'ink-testing-library'
import type { AppData } from '@agentistics/core'
import { Overview } from './Overview'
import { Projects } from './Projects'
import { History } from './History'
import { Costs } from './Costs'
import { Harnesses } from './Harnesses'
import { strings } from '../i18n'

const s = strings('en')
const PORT = process.env.PORT ?? '47291'

async function load(): Promise<AppData | null> {
  try {
    const res = await fetch(`http://localhost:${PORT}/api/data`, { signal: AbortSignal.timeout(3000) })
    return res.ok ? ((await res.json()) as AppData) : null
  } catch {
    return null
  }
}

const data = await load()

// 60 is the app's minimum supported width; 200 is an ultrawide split.
const WIDTHS = [60, 100, 200]
// 4 is what a pane inside a short terminal leaves; 30 is a comfortable full screen.
const HEIGHTS = [4, 8, 14, 30]

test.skipIf(!data)('every screen renders real data inside the rows and columns it was given', () => {
  const d = data!

  for (const width of WIDTHS) {
    for (const height of HEIGHTS) {
      const screens = [
        <Overview data={d} s={s} width={width} height={height} streak={3} />,
        <Projects data={d} s={s} width={width} height={height} />,
        <History data={d} s={s} width={width} height={height} />,
        <Costs data={d} s={s} width={width} height={height} />,
        <Harnesses data={d} s={s} width={width} height={height} />,
      ]

      for (const el of screens) {
        const app = render(el)
        // ink-testing-library hardcodes a 100-column stdout behind a prototype getter, so anything
        // wider than that was being measured AFTER Ink had wrapped it — every row of a 200-column
        // table arrived as three lines and the width assertion passed on the wreckage. Shadowing the
        // getter and re-rendering is the same fix `scripts/preview.tsx` makes, for the same reason.
        Object.defineProperty(app.stdout, 'columns', { get: () => width, configurable: true })
        app.rerender(el)
        const { lastFrame } = app
        const frame = lastFrame() ?? ''
        expect(frame.length).toBeGreaterThan(0)
        const lines = frame.replace(/\n+$/, '').split('\n')
        // A screen may draw fewer rows than it was offered; drawing more is the overflow Ink
        // composites, so the budget is a ceiling and never a target.
        expect(lines.length).toBeLessThanOrEqual(height)
        for (const line of lines) {
          // Strip ANSI before measuring — a wrapped row would corrupt every row below it.
          expect(line.replace(/\x1b\[[0-9;]*m/g, '').length).toBeLessThanOrEqual(width)
        }
      }
    }
  }
}, 20_000)
