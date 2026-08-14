/**
 * desktop.ts — the desktop half of the cascade: probing what this machine has, and using it.
 *
 * `notify-plan.ts` decides; this file looks and spawns. The split matters because "which channel"
 * is the part with rules worth testing and "does `notify-send` exist" is the part that can only be
 * answered by this machine.
 *
 * ## A delivery that failed says so
 *
 * Every send returns a result. A channel that was chosen and then failed (the toast command exited
 * non-zero, ccn exited 0 having done nothing) is reported as a failed delivery, not swallowed. The
 * event is in the inbox either way — the point of reporting is that `agentop events status` and the
 * command output can tell the user their desktop notifications are not actually arriving, before
 * they have spent a week trusting them.
 */

import { existsSync } from 'node:fs'
import { readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { HOME_DIR } from '../config'
import {
  ccnPayload, planDesktopChannel, type DesktopChannel, type DesktopDecision, type DesktopProbe,
} from './notify-plan'
import type { DesktopText } from './notify-text'

/** A notification that hangs holds up the poll that produced it. */
const NOTIFY_TIMEOUT_MS = 5_000

/**
 * Where `claude-code-notifications` installs its notifier.
 *
 * Two locations because it can arrive two ways: through the Claude Code plugin cache (versioned
 * directory, which is why the version segment is globbed rather than pinned) or through its own
 * `install.sh` into `~/.claude/hooks`. Detected, never embedded — see `notify-plan.ts`.
 */
async function findCcnScript(): Promise<string | undefined> {
  const direct = join(HOME_DIR, '.claude', 'hooks', 'ccn', 'notify.sh')
  if (existsSync(direct)) return direct

  const cacheRoot = join(HOME_DIR, '.claude', 'plugins', 'cache', 'blpsoares', 'claude-code-notifications')
  try {
    const versions = (await readdir(cacheRoot)).sort().reverse()
    for (const v of versions) {
      const p = join(cacheRoot, v, 'scripts', 'notify.sh')
      if (existsSync(p)) return p
    }
  } catch { /* not installed that way */ }
  return undefined
}

/** What this machine actually has. */
export async function probeDesktop(): Promise<DesktopProbe> {
  const ccnScript = await findCcnScript()
  return {
    ...(ccnScript !== undefined ? { ccnScript } : {}),
    hasJq: !!Bun.which('jq'),
    hasPowershell: !!Bun.which('powershell.exe'),
    hasNotifySend: !!Bun.which('notify-send'),
    hasTty: process.stdout.isTTY === true,
    // Absent reads as ENABLED here — unlike `chatAllowed`, because this switch turns off a
    // notification rather than opening a door. Only an explicit `0` disables it.
    disabled: process.env.AGENTISTICS_EVENTS_DESKTOP === '0',
  }
}

export interface DesktopSetup {
  probe: DesktopProbe
  decision: DesktopDecision
}

/** Probe once, decide once. A caller that notifies repeatedly holds this rather than re-reading the
 *  filesystem on every event. */
export async function desktopSetup(): Promise<DesktopSetup> {
  const probe = await probeDesktop()
  return { probe, decision: planDesktopChannel(probe) }
}

export async function desktopDecision(): Promise<DesktopDecision> {
  return (await desktopSetup()).decision
}

export type DesktopResult =
  | { ok: true; channel: DesktopChannel }
  | { ok: false; channel: DesktopChannel; message: string }

async function run(cmd: string[], stdin?: string): Promise<{ code: number; err: string }> {
  const proc = Bun.spawn(cmd, {
    stdin: stdin === undefined ? 'ignore' : new TextEncoder().encode(stdin),
    stdout: 'pipe',
    stderr: 'pipe',
  })
  const timer = setTimeout(() => { try { proc.kill() } catch { /* already gone */ } }, NOTIFY_TIMEOUT_MS)
  try {
    const code = await proc.exited
    const err = await new Response(proc.stderr).text()
    return { code, err: err.trim() }
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Show one notification through whichever channel this machine has.
 *
 * `cwd` is passed because ccn derives its title and its footer from the directory — it is what
 * makes a toast say which project, for the five harnesses that have no Claude transcript to read.
 */
export async function notifyDesktop(
  text: DesktopText,
  cwd: string,
  setup?: DesktopSetup,
): Promise<DesktopResult> {
  const chosen = setup ?? await desktopSetup()
  const d = chosen.decision
  try {
    switch (d.channel) {
      case 'ccn': {
        const r = await run(['bash', chosen.probe.ccnScript!], ccnPayload({ ...text, cwd }))
        return r.code === 0
          ? { ok: true, channel: 'ccn' }
          : { ok: false, channel: 'ccn', message: `claude-code-notifications exited ${r.code}${r.err ? `: ${r.err}` : ''}` }
      }
      case 'notify-send': {
        const r = await run(['notify-send', '--app-name=agentop', text.title, text.body])
        return r.code === 0
          ? { ok: true, channel: 'notify-send' }
          : { ok: false, channel: 'notify-send', message: `notify-send exited ${r.code}${r.err ? `: ${r.err}` : ''}` }
      }
      case 'powershell': {
        const r = await run(['powershell.exe', '-NoProfile', '-NonInteractive', '-Command', powershellToast(text)])
        return r.code === 0
          ? { ok: true, channel: 'powershell' }
          : { ok: false, channel: 'powershell', message: `powershell.exe exited ${r.code}${r.err ? `: ${r.err}` : ''}` }
      }
      case 'bell':
        // The one channel that needs no program: the terminal's own BEL.
        process.stdout.write('\x07')
        return { ok: true, channel: 'bell' }
      case 'none':
        return { ok: false, channel: 'none', message: d.reason }
    }
  } catch (e) {
    return { ok: false, channel: d.channel, message: e instanceof Error ? e.message : String(e) }
  }
}

/**
 * A plain Windows toast from WSL, with no plugin involved.
 *
 * A screen tail is arbitrary user text and it is being placed inside a PowerShell string literal,
 * so the one quoting rule that matters is applied here: a single quote is doubled, newlines are
 * collapsed, and the length is bounded. Without that a stray apostrophe in someone's prompt ends
 * the literal and the rest of their text is parsed as code.
 */
function powershellToast(text: DesktopText): string {
  const esc = (s: string): string => s.replace(/[\r\n]+/g, ' ').replace(/'/g, "''").slice(0, 200)
  return [
    '[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType=WindowsRuntime] > $null;',
    // 5 is ToastText02: a bold heading line and a body line, and no image to resolve.
    '$t = [Windows.UI.Notifications.ToastNotificationManager]::GetTemplateContent(5);',
    `$t.GetElementsByTagName('text').Item(0).AppendChild($t.CreateTextNode('${esc(text.title)}')) > $null;`,
    `$t.GetElementsByTagName('text').Item(1).AppendChild($t.CreateTextNode('${esc(text.body)}')) > $null;`,
    "[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier('agentop').Show([Windows.UI.Notifications.ToastNotification]::new($t));",
  ].join(' ')
}
