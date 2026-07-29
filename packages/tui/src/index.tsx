#!/usr/bin/env bun
/**
 * @agentistics/tui — the live terminal dashboard behind `agentop tui`.
 *
 * The caller (packages/server/bin/cli.ts) resolves the language, keeping the dependency
 * direction server -> tui: this package never reaches back into the server for preferences.
 */

import React from 'react'
import { render } from 'ink'
import { App } from './App'
import { ensureApi, registerApiCleanup, stopSpawnedApi } from './data/ensureApi'
import { strings, type TuiLang } from './i18n'
import { COLORS } from './theme'

export interface TuiOptions {
  lang?: TuiLang
  port?: number
}

export async function runTui(opts: TuiOptions = {}): Promise<number> {
  const lang: TuiLang = opts.lang === 'pt' ? 'pt' : 'en'
  const s = strings(lang)
  const port = opts.port ?? Number(process.env.PORT ?? 47291)
  const apiBase = `http://localhost:${port}`

  // Ink needs raw mode for keyboard handling; without a TTY it throws from inside a React
  // effect, which surfaces as an unreadable reconciler stack. Fail with a sentence instead.
  if (!process.stdin.isTTY) {
    process.stderr.write(`${s.needsTty}\n`)
    return 1
  }

  process.stdout.write(`${s.apiStarting}…\n`)
  const { ok } = await ensureApi(apiBase)
  if (!ok) {
    process.stderr.write(`${s.apiFailed} (:${port})\n`)
    return 1
  }
  registerApiCleanup()

  const { waitUntilExit } = render(<App apiBase={apiBase} lang={lang} />, {
    // The dashboard owns the whole screen and restores the scrollback on exit.
    exitOnCtrlC: true,
  })

  await waitUntilExit()
  stopSpawnedApi()
  return 0
}

// Direct execution: `bun run packages/tui/src/index.tsx`
if (import.meta.main) {
  const i = process.argv.indexOf('--lang')
  const flag = process.argv[i + 1]
  const lang: TuiLang = flag === 'pt' ? 'pt' : 'en'
  const code = await runTui({ lang })
  process.exit(code)
}

export { App } from './App'
export * from './selectors'
export { strings } from './i18n'
export type { TuiLang } from './i18n'
