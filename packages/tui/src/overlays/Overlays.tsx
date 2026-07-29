import React from 'react'
import { Box, Text } from 'ink'
import type { HarnessId } from '@agentistics/core'
import { COLORS, HARNESS_COLOR, HARNESS_LABEL } from '../theme'
import type { TuiStrings } from '../i18n'

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor={COLORS.accent}
      paddingX={1}
      marginTop={1}
    >
      <Text bold color={COLORS.accent}>{title}</Text>
      {children}
    </Box>
  )
}

export function HelpOverlay({ s }: { s: TuiStrings }) {
  return (
    <Panel title={s.helpTitle}>
      <Text dimColor>{s.helpNav}</Text>
      <Text dimColor>{s.helpFilter}</Text>
      <Text dimColor>{s.helpQuit}</Text>
      <Text dimColor>{s.helpClose}</Text>
    </Panel>
  )
}

export function FilterOverlay({ s, options, selected }: {
  s: TuiStrings
  /** null is the "all harnesses" entry, always first. */
  options: (HarnessId | null)[]
  selected: number
}) {
  return (
    <Panel title={s.filterTitle}>
      {options.map((h, i) => {
        const label = h === null ? s.filterAll : HARNESS_LABEL[h]
        const active = i === selected
        return (
          <Text key={h ?? '__all__'} color={h ? HARNESS_COLOR[h] : undefined} inverse={active}>
            {active ? '❯ ' : '  '}{label}
          </Text>
        )
      })}
      <Box marginTop={1}><Text dimColor>{s.filterHint}</Text></Box>
    </Panel>
  )
}
