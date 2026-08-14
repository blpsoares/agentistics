/**
 * notify-plan.ts — PURE. Which desktop channel this machine can actually use, and why.
 *
 * ## Absence is absence
 *
 * A notification that fails silently is worse than none: the person stops watching the screen
 * because something is watching it for them, and nothing is. So the cascade is DECLARED — every
 * step is probed, the chosen one is named by `agentop events status`, and "there is no desktop
 * channel here" is a sentence this module returns rather than a `false` somebody renders as
 * nothing.
 *
 * ## The order, and why ccn is first
 *
 * 1. **ccn** — `claude-code-notifications`, the user's own Claude Code plugin. On WSL it already
 *    solves the hard half: a real Windows toast, a configurable sound, and a click that focuses the
 *    session's window. It is DETECTED, never embedded: it ships through the Claude Code plugin
 *    system with its own release cycle while agentop is one compiled binary, so a bundled copy
 *    would be a second version to drift. What we send it is the payload shape it already accepts —
 *    a Claude Code `Notification` hook envelope with a `message` and a `cwd` — so agentop adds the
 *    five harnesses ccn cannot see and the task grouping neither tool has alone, without either
 *    knowing about the other's internals.
 * 2. **notify-send** — the Linux desktop standard. Present on a normal desktop session, absent on
 *    WSL, which is exactly why it is not first.
 * 3. **powershell.exe** — WSL without ccn: a plain Windows toast, no sound and no click target, but
 *    it reaches the user's actual screen.
 * 4. **bell** — the terminal's own `\a`. Only when there is a terminal to ring.
 * 5. **none** — the inbox holds the event and `status` says the desktop is unreachable.
 *
 * Probing is the caller's job (it is filesystem and PATH work); deciding is this module's.
 */

export type DesktopChannel = 'ccn' | 'notify-send' | 'powershell' | 'bell' | 'none'

/** What the impure side found. Every field is a fact about this machine, never a preference. */
export interface DesktopProbe {
  /** Absolute path to the ccn plugin's `notify.sh`, when one is installed. */
  ccnScript?: string
  /** ccn shells out to both; without them it exits 0 having done nothing, which would look like a
   *  delivered notification. So its own requirements are part of the probe. */
  hasJq?: boolean
  hasPowershell?: boolean
  hasNotifySend?: boolean
  /** A tty to ring. */
  hasTty?: boolean
  /** The user turned the desktop step off for this machine. */
  disabled?: boolean
}

export interface DesktopDecision {
  channel: DesktopChannel
  /** Already a sentence, for `status` to print. Names what was chosen AND what was not available. */
  reason: string
}

/**
 * The chosen channel and the sentence explaining it.
 *
 * The reason names the runners-up on purpose: "no desktop channel" is only actionable if it says
 * what was looked for.
 */
export function planDesktopChannel(p: DesktopProbe): DesktopDecision {
  if (p.disabled) {
    return { channel: 'none', reason: 'desktop notifications are switched off for this machine (AGENTISTICS_EVENTS_DESKTOP=0).' }
  }
  if (p.ccnScript && p.hasJq && p.hasPowershell) {
    return { channel: 'ccn', reason: `claude-code-notifications (${p.ccnScript}) — Windows toast with sound, from WSL.` }
  }
  if (p.hasNotifySend) {
    const ccnNote = p.ccnScript
      ? ' (claude-code-notifications is installed but cannot run here: it needs both jq and powershell.exe)'
      : ''
    return { channel: 'notify-send', reason: `notify-send${ccnNote}.` }
  }
  if (p.hasPowershell) {
    const ccnNote = p.ccnScript && !p.hasJq
      ? ' claude-code-notifications is installed but jq is missing, so it is skipped.'
      : ''
    return { channel: 'powershell', reason: `powershell.exe — a plain Windows toast from WSL, no sound and no click target.${ccnNote}` }
  }
  if (p.hasTty) {
    return { channel: 'bell', reason: 'the terminal bell — no notify-send, no powershell.exe, no claude-code-notifications on this machine.' }
  }
  return {
    channel: 'none',
    reason: 'no desktop channel on this machine — none of claude-code-notifications, notify-send or powershell.exe is usable, and there is no terminal to ring. Events are still written to the inbox.',
  }
}

/**
 * The ccn payload for one notification.
 *
 * Shaped as a Claude Code `Notification` hook envelope because that is ccn's published input: it
 * reads `hook_event_name`, `message` and `cwd` from stdin, and derives its title from the directory
 * when there is no transcript to read — which is precisely the case for every harness that is not
 * Claude. Deliberately no `transcript_path`: agentop has no Claude transcript for a codex session,
 * and pointing ccn at one that is not this session's would put another conversation's text in the
 * toast.
 */
export function ccnPayload(o: { title: string; body: string; cwd: string }): string {
  return JSON.stringify({
    hook_event_name: 'Notification',
    message: `${o.title} — ${o.body}`,
    cwd: o.cwd,
  })
}
