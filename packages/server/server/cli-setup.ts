/**
 * cli-setup.ts — interactive first-run wizard for `agentop setup` (and a bare
 * `agentop` on an unconfigured machine).
 *
 * Walks the user through choosing solo / central / member, wires up the central
 * (via central.sh init) or member (via memberConnect), and optionally enables
 * autostart. Prompts are plain readline over process.stdin. Ctrl-C is
 * non-destructive: it aborts without mutating preferences.
 */

import { createInterface, type Interface } from 'readline'
import { DEFAULT_TEAM } from '@agentistics/core'
import { writePreferences } from './preferences'
import { enableAutostart } from './autostart'
import { runCentral } from './cli-central'
import { memberConnect } from './cli-member'

/** Ask a single question; resolves to the trimmed answer (empty string on EOF). */
function ask(rl: Interface, question: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(question, (answer) => resolve(answer.trim()))
  })
}

/** True when the answer is an affirmative (y/yes), case-insensitive. */
function isYes(answer: string): boolean {
  return /^y(es)?$/i.test(answer.trim())
}

/**
 * Run the interactive setup wizard. Requires an interactive stdin (a TTY);
 * prints a hint and returns otherwise. Returns a process-style exit code.
 */
export async function runSetup(): Promise<number> {
  if (!process.stdin.isTTY) {
    process.stderr.write(
      'setup needs an interactive terminal. Configure non-interactively with ' +
      '`agentop member connect --endpoint <url> --token <token>` instead.\n',
    )
    return 1
  }

  const rl = createInterface({ input: process.stdin, output: process.stdout })
  // Ctrl-C: close the readline and exit without touching preferences.
  rl.on('SIGINT', () => {
    process.stdout.write('\nSetup cancelled — no changes made.\n')
    rl.close()
    process.exit(130)
  })

  try {
    process.stdout.write('\nagentop setup — how should this machine track usage?\n\n')
    process.stdout.write('  1) solo     — local only, nothing ever leaves this machine\n')
    process.stdout.write('  2) central  — host the team central (Docker) on this machine\n')
    process.stdout.write('  3) member   — everything solo does, plus push computed metrics\n')
    process.stdout.write('               (never chat) to a team central\n\n')

    const choice = await ask(rl, 'Choose [1]: ')
    const mode = choice || '1'

    if (mode === '1' || mode === 'solo') {
      await writePreferences({ team: { ...DEFAULT_TEAM } })
      process.stdout.write('\nsolo mode set — you\'re all done.\n')
      return 0
    }

    if (mode === '2' || mode === 'central') {
      process.stdout.write('\nLaunching the central setup (central.sh init)…\n\n')
      // Close our readline first so central.sh owns stdin during its own prompts.
      rl.close()
      const code = await runCentral('init', [])
      if (code !== 0) {
        process.stderr.write('\ncentral init did not complete — fix the above and re-run `agentop central up`.\n')
        return code
      }
      // Re-open a readline for the follow-up autostart question.
      const rl2 = createInterface({ input: process.stdin, output: process.stdout })
      try {
        const boot = await ask(rl2, '\nstart the central on boot? [y/N]: ')
        if (isYes(boot)) {
          const res = await enableAutostart('central')
          process.stdout.write('\n' + res.message + '\n')
        }
      } finally {
        rl2.close()
      }
      process.stdout.write('\ncentral configured. Start it now with `agentop central up`.\n')
      return 0
    }

    if (mode === '3' || mode === 'member') {
      const endpoint = await ask(rl, '\nCentral endpoint URL (e.g. http://host:48080): ')
      const token = await ask(rl, 'Member token (from the central\'s Team Manager): ')
      const org = await ask(rl, 'Org [default]: ')

      const code = await memberConnect({ endpoint, token, org: org || undefined })
      if (code !== 0) return code

      const boot = await ask(rl, '\nstart on boot? [y/N]: ')
      if (isYes(boot)) {
        const res = await enableAutostart('server')
        process.stdout.write('\n' + res.message + '\n')
      }
      process.stdout.write('\nmember configured.\n')
      return 0
    }

    process.stderr.write(`\nUnrecognized choice: ${mode}. Run \`agentop setup\` again.\n`)
    return 1
  } finally {
    // rl may already be closed (central path) — closing twice is safe.
    rl.close()
  }
}
