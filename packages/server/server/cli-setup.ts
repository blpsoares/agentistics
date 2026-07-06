/**
 * cli-setup.ts — interactive mode wizard for `agentop setup` (and a bare `agentop` on an
 * unconfigured machine, and the "Reconfigure mode" action in `agentop start`).
 *
 * Arrow-key mode picker (see cli-ui.ts), then wires up the central (via central.sh init) or member
 * (via memberConnect), and optionally enables autostart. Ctrl-C is non-destructive: every prompt
 * exits cleanly and preferences are only written after all input is gathered.
 */

import { DEFAULT_TEAM } from '@agentistics/core'
import { readPreferences, writePreferences, resolveArchiveMode, type ArchiveMode } from './preferences'
import { enableAutostart } from './autostart'
import { runCentral } from './cli-central'
import { memberConnect } from './cli-member'
import { select, input, confirm } from './cli-ui'

const ESC = '\x1b'
const R = `${ESC}[0m`
const D = `${ESC}[2m`

/**
 * Ask, ONCE, how the app should preserve session history past Claude's 30-day cleanup, and
 * persist the choice as `archiveMode`. This mirrors the web consent gate for people who only
 * ever use the CLI — without it, a CLI-only start leaves `archiveMode` unset, which the server
 * treats as 'off', silently preserving nothing. No-op when already chosen or on a non-TTY stdin
 * (a daemon/systemd start), and irrelevant on a central (aggregator, no local sessions).
 */
export async function ensureArchiveModeChosen(): Promise<void> {
  if (!process.stdin.isTTY) return
  const prefs = await readPreferences()
  if (resolveArchiveMode(prefs) !== undefined) return // already chosen — never re-ask
  process.stdout.write(
    `\n  ${D}Claude deletes session transcripts older than 30 days. How should agentistics` +
    ` preserve your history?${R}\n`,
  )
  const mode = await select<ArchiveMode>({
    message: 'Preserve session history?',
    choices: [
      { name: 'consolidate', value: 'consolidate', hint: 'recommended — store computed per-session metrics (~KB each)' },
      { name: 'full', value: 'full', hint: 'archivist — also mirror raw transcripts so you can re-read chats (heavy)' },
      { name: 'off', value: 'off', hint: "do nothing — use Claude's default 30-day cleanup" },
    ],
  })
  await writePreferences({ archiveMode: mode })
  process.stdout.write(`\n  ${D}archive mode set to ${mode}.${R}\n`)
}

/**
 * Run the interactive setup wizard. Requires an interactive stdin (a TTY); prints a hint and
 * returns otherwise. Returns a process-style exit code.
 */
export async function runSetup(): Promise<number> {
  if (!process.stdin.isTTY) {
    process.stderr.write(
      'setup needs an interactive terminal. Configure non-interactively with ' +
      '`agentop member connect --endpoint <url> --token <token>` instead.\n',
    )
    return 1
  }

  const mode = await select<'solo' | 'central' | 'member'>({
    message: 'How should this machine track usage?',
    choices: [
      { name: 'solo', value: 'solo', hint: 'local only, nothing leaves this machine' },
      { name: 'central', value: 'central', hint: 'host the team central (Docker) on this machine' },
      { name: 'member', value: 'member', hint: 'everything solo does, plus push metrics (never chat) to a central' },
    ],
  })

  if (mode === 'solo') {
    await writePreferences({ team: { ...DEFAULT_TEAM } })
    await ensureArchiveModeChosen()
    process.stdout.write(`\n  ${D}solo mode set — you're all done.${R}\n`)
    return 0
  }

  if (mode === 'central') {
    process.stdout.write('\n  Launching the central setup (central.sh init)…\n\n')
    const code = await runCentral('init', [])
    if (code !== 0) {
      process.stderr.write('\n  central init did not complete — fix the above and re-run `agentop central up`.\n')
      return code
    }
    if (await confirm('Start the central on boot?', false)) {
      const res = await enableAutostart('central')
      process.stdout.write('\n  ' + res.message.replace(/\n/g, '\n  ') + '\n')
    }
    process.stdout.write('\n  central configured. Start it now from the launcher or `agentop central up`.\n')
    return 0
  }

  // member
  const endpoint = await input('Central endpoint URL (e.g. http://host:48080)')
  const token = await input("Member token (from the central's Team Manager)")
  const org = await input('Org', { default: 'default' })

  const code = await memberConnect({ endpoint, token, org: org || undefined })
  if (code !== 0) return code

  await ensureArchiveModeChosen()

  if (await confirm('Start on boot?', false)) {
    const res = await enableAutostart('server')
    process.stdout.write('\n  ' + res.message.replace(/\n/g, '\n  ') + '\n')
  }
  process.stdout.write(`\n  ${D}member configured.${R}\n`)
  return 0
}
