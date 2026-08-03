import React, { useMemo, useState } from 'react'
import { Box, Text, useApp, useInput } from 'ink'
import type { AppData, HarnessId } from '@agentistics/core'
import { calcStreak, HARNESS_ORDER } from '@agentistics/core'
import { useAppData, type ConnectionState } from './data/useAppData'
import { useTerminalSize } from './useTerminalSize'
import { strings, type TuiLang } from './i18n'
import { COLORS } from './theme'
import { Overview } from './screens/Overview'
import { Projects } from './screens/Projects'
import { Sessions } from './screens/Sessions'
import { Costs } from './screens/Costs'
import { Harnesses } from './screens/Harnesses'
import { HelpOverlay, FilterOverlay } from './overlays/Overlays'
import { Wordmark } from './components/Wordmark'
import { sessionHarness } from './selectors'

const MIN_WIDTH = 60
/** Rows consumed by the header, tab bar and footer — the screens get whatever is left. */
const CHROME_ROWS = 8
/** Horizontal padding applied by the shell Box, per side. */
const PADDING_X = 1

type ScreenId = 'overview' | 'projects' | 'sessions' | 'costs' | 'harnesses'
const SCREENS: ScreenId[] = ['overview', 'projects', 'sessions', 'costs', 'harnesses']

/**
 * Restricts an AppData to one harness, so every screen can stay filter-unaware.
 *
 * Claude's totals live in the statsCache and every other harness's live in the session list, so
 * filtering has to act on BOTH: selecting a non-Claude harness must blank the cache, or the
 * Claude numbers would survive the filter and be attributed to the selection.
 */
export function applyHarnessFilter(data: AppData, harness: HarnessId | null): AppData {
  if (!harness) return data
  return {
    ...data,
    harnesses: (data.harnesses ?? []).filter(h => h === harness),
    sessions: (data.sessions ?? []).filter(s => sessionHarness(s) === harness),
  }
}

function ConnectionDot({ state, s }: { state: ConnectionState; s: ReturnType<typeof strings> }) {
  const map: Record<ConnectionState, { color: string; label: string }> = {
    live: { color: COLORS.success, label: s.live },
    polling: { color: COLORS.accent, label: s.live },
    connecting: { color: COLORS.muted, label: s.connecting },
    offline: { color: COLORS.danger, label: s.offline },
  }
  const { color, label } = map[state]
  return <Text color={color}>● <Text dimColor>{label}</Text></Text>
}

export function App({ apiBase, lang }: { apiBase: string; lang: TuiLang }) {
  const { exit } = useApp()
  const s = strings(lang)
  const { columns, rows } = useTerminalSize()
  const { data, connection, refresh } = useAppData(apiBase)

  const [screen, setScreen] = useState<ScreenId>('overview')
  const [overlay, setOverlay] = useState<'none' | 'help' | 'filter'>('none')
  const [harness, setHarness] = useState<HarnessId | null>(null)
  const [filterIndex, setFilterIndex] = useState(0)

  const filterOptions = useMemo<(HarnessId | null)[]>(() => {
    const present = new Set(data?.harnesses ?? [])
    return [null, ...HARNESS_ORDER.filter(h => present.has(h))]
  }, [data?.harnesses])

  useInput((input, key) => {
    if (overlay === 'filter') {
      if (key.escape) { setOverlay('none'); return }
      if (key.upArrow) { setFilterIndex(i => Math.max(0, i - 1)); return }
      if (key.downArrow) { setFilterIndex(i => Math.min(filterOptions.length - 1, i + 1)); return }
      if (key.return) {
        setHarness(filterOptions[filterIndex] ?? null)
        setOverlay('none')
      }
      return
    }
    if (overlay === 'help') {
      if (key.escape || input === '?' || input === 'q') setOverlay('none')
      return
    }

    if (input === 'q' || (key.ctrl && input === 'c')) { exit(); return }
    if (input === '?') { setOverlay('help'); return }
    if (input === 'f') { setOverlay('filter'); return }
    if (input === 'r') { refresh(); return }

    const num = Number(input)
    if (Number.isInteger(num) && num >= 1 && num <= SCREENS.length) {
      setScreen(SCREENS[num - 1]!)
      return
    }
    if (key.tab) {
      const i = SCREENS.indexOf(screen)
      setScreen(SCREENS[(i + (key.shift ? SCREENS.length - 1 : 1)) % SCREENS.length]!)
    }
  })

  if (columns < MIN_WIDTH) {
    return <Box padding={1}><Text color={COLORS.danger}>{s.tooNarrow}</Text></Box>
  }

  if (!data) {
    // The wordmark carries the wait, so the first frame is the brand rather than a bare word.
    return (
      <Box flexDirection="column" padding={1}>
        <Wordmark tagline={s.tagline} width={columns - 2} />
        <Box marginTop={1}><Text color={COLORS.accent}>{s.loading}…</Text></Box>
      </Box>
    )
  }

  const view = applyHarnessFilter(data, harness)
  const bodyHeight = Math.max(3, rows - CHROME_ROWS)
  // The shell adds one column of padding on each side; screens must size against what is left,
  // or a full-width bar/table overflows by exactly those two columns and wraps.
  const bodyWidth = Math.max(20, columns - PADDING_X * 2)

  const activeDates = new Set((data.statsCache?.dailyActivity ?? []).map(d => d.date))
  const streak = calcStreak(activeDates)

  return (
    <Box flexDirection="column" paddingX={PADDING_X}>
      {/* header */}
      <Box flexDirection="row" justifyContent="space-between">
        <Text>
          <Text bold color={COLORS.accent}>agentistics</Text>
          <Text dimColor>  ·  {s.tagline}</Text>
        </Text>
        <ConnectionDot state={connection} s={s} />
      </Box>

      {/* tab bar */}
      <Box flexDirection="row" marginTop={1}>
        {SCREENS.map((id, i) => (
          <Box key={id} marginRight={2}>
            <Text
              bold={screen === id}
              color={screen === id ? COLORS.accent : undefined}
              dimColor={screen !== id}
            >
              {i + 1} {s[id]}
            </Text>
          </Box>
        ))}
        {harness && (
          <Text color={COLORS.secondary}>  ⌗ {harness}</Text>
        )}
      </Box>

      <Box flexDirection="column" marginTop={1}>
        {screen === 'overview' && <Overview data={view} s={s} width={bodyWidth} streak={streak} />}
        {screen === 'projects' && <Projects data={view} s={s} width={bodyWidth} height={bodyHeight} />}
        {screen === 'sessions' && <Sessions data={view} s={s} width={bodyWidth} height={bodyHeight} />}
        {screen === 'costs' && <Costs data={view} s={s} width={bodyWidth} height={bodyHeight} />}
        {screen === 'harnesses' && <Harnesses data={view} s={s} width={bodyWidth} />}
      </Box>

      {overlay === 'help' && <HelpOverlay s={s} />}
      {overlay === 'filter' && (
        <FilterOverlay s={s} options={filterOptions} selected={filterIndex} />
      )}

      {/* footer */}
      <Box marginTop={1}>
        <Text dimColor>
          1-5/tab {s.nav}  ·  f {s.filter}  ·  ? {s.help}  ·  q {s.quit}
        </Text>
      </Box>
    </Box>
  )
}
