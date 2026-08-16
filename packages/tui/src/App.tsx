/**
 * App — the standalone dashboard, behind `agentop tui`.
 *
 * It owns almost nothing now. The five screens, the strip that switches them, the harness filter and
 * every key that drives them are `DashboardView` / `useDashboardNav`, shared verbatim with the
 * control center's `dashboard` tab — one implementation, two entry points. What is left here is what
 * is true only of running full-screen: the wordmark, the help panel, `q`, and the data source, which
 * on this path is a server this command starts for itself when none is listening.
 */

import React from 'react'
import { Box, Text, useApp, useInput } from 'ink'
import { useAppData } from './data/useAppData'
import { useTerminalSize } from './useTerminalSize'
import { strings, type TuiLang } from './i18n'
import { COLORS } from './theme'
import { HelpOverlay } from './overlays/Overlays'
import { Wordmark } from './components/Wordmark'
import { DashboardView } from './dashboard/DashboardView'
import { useDashboardNav } from './dashboard/useDashboardNav'

const MIN_WIDTH = 60
/** The header, the blank under it, and the blank plus the footer below the body. */
const CHROME_ROWS = 4
/** Horizontal padding applied by the shell Box, per side. */
const PADDING_X = 1

/** Kept exported under its old name: it moved to the shared view, not out of the product. */
export { applyHarnessFilter } from './dashboard/DashboardView'

export function App({ apiBase, lang }: { apiBase: string; lang: TuiLang }) {
  const { exit } = useApp()
  const s = strings(lang)
  const { columns, rows } = useTerminalSize()
  const { data, connection, refresh } = useAppData(apiBase)

  const [help, setHelp] = React.useState(false)
  // The nav needs both to clamp a page: what is being listed, and how many rows a page holds here.
  const bodyHeight = Math.max(3, rows - CHROME_ROWS)
  const nav = useDashboardNav({
    isActive: !help,
    harnesses: data?.harnesses,
    data,
    height: bodyHeight,
  })

  useInput((input, key) => {
    if (help) {
      if (key.escape || input === '?' || input === 'q') setHelp(false)
      return
    }
    if (input === 'q' || (key.ctrl && input === 'c')) { exit(); return }
    if (input === '?') { setHelp(true); return }
    if (input === 'r') refresh()
    // Everything else belongs to `useDashboardNav`, which is subscribed alongside this handler.
    // The two answer disjoint keys on purpose: a key both of them took would do two things at once,
    // and only one of them could be named by the footer.
  }, { isActive: !nav.capture })

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

  // The shell adds one column of padding on each side; screens must size against what is left,
  // or a full-width bar/table overflows by exactly those two columns and wraps.
  const bodyWidth = Math.max(20, columns - PADDING_X * 2)

  return (
    <Box flexDirection="column" paddingX={PADDING_X}>
      <Box flexDirection="row">
        <Text>
          <Text bold color={COLORS.accent}>agentistics</Text>
          <Text dimColor>  ·  {s.tagline}</Text>
        </Text>
      </Box>

      <Box flexDirection="column" marginTop={1}>
        <DashboardView
          data={data}
          apiBase={apiBase}
          s={s}
          width={bodyWidth}
          height={bodyHeight}
          nav={nav}
          connection={connection}
        />
      </Box>

      {help && <HelpOverlay s={s} />}

      <Box marginTop={1}>
        <Text dimColor>
          1-6/tab {s.nav}  ·  f {s.filter}  ·  ? {s.help}  ·  q {s.quit}
        </Text>
      </Box>
    </Box>
  )
}
