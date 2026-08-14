/**
 * useDashboardNav — the dashboard's own keyboard, wherever it is drawn.
 *
 * Which screen is open and which harness is selected are the same two questions full-screen and
 * inside the control center's tab, answered by the same keys, so they are answered ONCE here rather
 * than in both entry points. The rules themselves are pure (`resolveDashboardScreen`); this holds
 * the state and the `useInput` subscription.
 *
 * `capture` is the contract with whatever is hosting it: while the harness picker is open the
 * dashboard owns the keyboard, and the control center's global keys must stand down — `q` would
 * otherwise quit the whole app out from under a list the user is choosing from. The standalone app
 * uses the same flag to hold its own `?`/`q` handler back.
 */

import { useMemo, useState } from 'react'
import { useInput } from 'ink'
import type { HarnessId } from '@agentistics/core'
import { HARNESS_ORDER } from '@agentistics/core'
import { DASHBOARD_SCREENS, resolveDashboardScreen, type DashboardScreenId } from './view'

export interface DashboardFilter {
  /** `null` is the "all harnesses" entry, always first. */
  options: (HarnessId | null)[]
  index: number
}

export interface DashboardNav {
  screen: DashboardScreenId
  setScreen: (id: DashboardScreenId) => void
  /** `null` means every harness — the filter is off. */
  harness: HarnessId | null
  /** The harness picker, or `null` when it is closed. */
  filter: DashboardFilter | null
  /** True while the picker owns the keyboard. */
  capture: boolean
}

export function useDashboardNav(opts: {
  isActive: boolean
  /** The harnesses that actually have data, so the picker never offers an empty one. */
  harnesses: readonly HarnessId[] | undefined
}): DashboardNav {
  const [screen, setScreen] = useState<DashboardScreenId>(DASHBOARD_SCREENS[0]!)
  const [harness, setHarness] = useState<HarnessId | null>(null)
  const [open, setOpen] = useState(false)
  const [index, setIndex] = useState(0)

  // Keyed on the joined ids rather than the array: `data.harnesses` is a fresh array on every
  // payload, and rebuilding this list each time would reset nothing but would churn every consumer.
  const key = (opts.harnesses ?? []).join(',')
  const options = useMemo<(HarnessId | null)[]>(() => {
    const present = new Set(key ? (key.split(',') as HarnessId[]) : [])
    return [null, ...HARNESS_ORDER.filter(h => present.has(h))]
  }, [key])

  useInput((input, key2) => {
    if (open) {
      if (key2.escape) { setOpen(false); return }
      if (key2.upArrow) { setIndex(i => Math.max(0, i - 1)); return }
      if (key2.downArrow) { setIndex(i => Math.min(options.length - 1, i + 1)); return }
      if (key2.return) {
        setHarness(options[index] ?? null)
        setOpen(false)
      }
      return
    }

    if (input === 'f') {
      // Opens on whatever is currently selected, so `f` twice is a no-op rather than a reset.
      setIndex(Math.max(0, options.indexOf(harness)))
      setOpen(true)
      return
    }

    const next = resolveDashboardScreen({ input, tab: key2.tab, shift: key2.shift }, screen)
    if (next) setScreen(next)
  }, { isActive: opts.isActive })

  return {
    screen,
    setScreen,
    harness,
    filter: open ? { options, index } : null,
    capture: open,
  }
}
