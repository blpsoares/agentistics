/**
 * Launcher — the Ink presentation for `agentop start`.
 *
 * This module owns NO launcher logic. `cli-start.ts` still decides what the choices are, what
 * each one does, and what the current service state is; it hands the already-localized strings
 * here and gets back the chosen value. Keeping the split that way means the launcher's behaviour
 * is unchanged by the rewrite — only its appearance is.
 *
 * The win over the previous prompt chain: the status panel and the menu are on screen together
 * and stay live, instead of status being printed once and scrolling away above the question.
 */

import React, { useState } from 'react'
import { Box, Text, render, useApp, useInput } from 'ink'
import { COLORS } from '../theme'

export interface LauncherChoice {
  name: string
  value: string
  hint?: string
}

export interface LauncherService {
  label: string
  on: boolean
}

export interface LauncherStatus {
  configLabel: string
  configValue: string
  runningLabel: string
  services: LauncherService[]
  /** Shown in place of the service list when nothing is running. */
  nothingRunning: string
}

export interface LauncherProps {
  tagline: string
  title: string
  choices: LauncherChoice[]
  status: LauncherStatus
  onSelect: (value: string) => void
}

export function Launcher({ tagline, title, choices, status, onSelect }: LauncherProps) {
  const [index, setIndex] = useState(0)

  useInput((input, key) => {
    if (key.upArrow || input === 'k') { setIndex(i => (i - 1 + choices.length) % choices.length); return }
    if (key.downArrow || input === 'j') { setIndex(i => (i + 1) % choices.length); return }
    if (key.return) { onSelect(choices[index]!.value); return }

    // Number shortcuts, so a known menu can be driven without arrowing to it.
    const n = Number(input)
    if (Number.isInteger(n) && n >= 1 && n <= choices.length) {
      onSelect(choices[n - 1]!.value)
    }
  })

  const anyRunning = status.services.some(svc => svc.on)

  return (
    <Box flexDirection="column" paddingX={1} paddingY={1}>
      <Text>
        <Text bold color={COLORS.accent}>agentop</Text>
        <Text dimColor>  ·  {tagline}</Text>
      </Text>

      <Box
        flexDirection="column"
        borderStyle="round"
        borderColor={COLORS.border}
        paddingX={1}
        marginTop={1}
      >
        <Box flexDirection="row">
          <Box width={12}><Text dimColor>{status.configLabel}</Text></Box>
          <Text color={COLORS.secondary}>{status.configValue}</Text>
        </Box>
        <Box flexDirection="row">
          <Box width={12}><Text dimColor>{status.runningLabel}</Text></Box>
          <Box flexDirection="column">
            {anyRunning ? (
              status.services.filter(svc => svc.on).map(svc => (
                <Text key={svc.label} color={COLORS.success}>● <Text color={COLORS.text}>{svc.label}</Text></Text>
              ))
            ) : (
              <Text dimColor>{status.nothingRunning}</Text>
            )}
          </Box>
        </Box>
      </Box>

      <Box marginTop={1}><Text bold>{title}</Text></Box>
      <Box flexDirection="column" marginTop={1}>
        {choices.map((c, i) => {
          const active = i === index
          return (
            <Box key={c.value} flexDirection="row">
              <Text color={active ? COLORS.accent : undefined} bold={active}>
                {active ? '❯ ' : '  '}{i + 1}. {c.name}
              </Text>
              {c.hint ? <Text dimColor>  {c.hint}</Text> : null}
            </Box>
          )
        })}
      </Box>

      <Box marginTop={1}>
        <Text dimColor>↑↓ · enter</Text>
      </Box>
    </Box>
  )
}

/**
 * Renders the launcher and resolves with the chosen value.
 *
 * Callers must check for a TTY first — `cli-start.ts` falls back to the dependency-free
 * `cli-ui.ts` primitives when there isn't one.
 */
export function launcherMenu(opts: Omit<LauncherProps, 'onSelect'>): Promise<string> {
  return new Promise(resolve => {
    let chosen: string | null = null
    const app = render(
      <Launcher
        {...opts}
        onSelect={value => {
          chosen = value
          app.unmount()
        }}
      />,
    )
    void app.waitUntilExit().then(() => {
      // ctrl+c unmounts without a selection; treat that as quitting the launcher.
      resolve(chosen ?? 'quit')
    })
  })
}
