/**
 * Live smoke test: renders every screen against the REAL /api/data payload.
 *
 * Fixtures cannot stress the column math the way a full dataset does (long project paths,
 * billions of tokens, many models). Skips itself when no server is running, so it never fails
 * a clean checkout or CI.
 */
import React from 'react'
import { test, expect } from 'bun:test'
import { render } from 'ink-testing-library'
import type { AppData } from '@agentistics/core'
import { Overview } from './Overview'
import { Projects } from './Projects'
import { Sessions } from './Sessions'
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

test.skipIf(!data)('every screen renders real data without overflowing its terminal width', () => {
  const d = data!

  for (const width of WIDTHS) {
    const screens = [
      <Overview data={d} s={s} width={width} streak={3} />,
      <Projects data={d} s={s} width={width} height={10} />,
      <Sessions data={d} s={s} width={width} height={10} />,
      <Costs data={d} s={s} width={width} height={10} />,
      <Harnesses data={d} s={s} width={width} />,
    ]

    for (const el of screens) {
      const { lastFrame } = render(el)
      const frame = lastFrame() ?? ''
      expect(frame.length).toBeGreaterThan(0)
      for (const line of frame.split('\n')) {
        // Strip ANSI before measuring — a wrapped row would corrupt every row below it.
        expect(line.replace(/\x1b\[[0-9;]*m/g, '').length).toBeLessThanOrEqual(width)
      }
    }
  }
})
