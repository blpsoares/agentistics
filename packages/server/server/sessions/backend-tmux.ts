/**
 * backend-tmux.ts — the Unix SessionBackend. Thin on purpose: every decision it could get wrong
 * lives in the pure `tmux-cli.ts` beside it.
 */

import {
  attachArgs, capturePaneArgs, isSessionGoneError, killSessionArgs, listSessionsArgs,
  newSessionArgs, parsePrefix, parseTmuxList, serverOptionsArgs, sendKeysNamedArgs,
  sendKeysLiteralArgs, showPrefixArgs, trimCapture,
} from './tmux-cli'
import type { BackendSession, BackendSpawn, SessionBackend } from './types'

/** How long to wait for a harness to draw its prompt before typing into it. */
const SEND_KEYS_DELAY_MS = 1200

async function tmux(args: string[]): Promise<{ code: number; out: string; err: string }> {
  try {
    const p = Bun.spawn(['tmux', ...args], { stdout: 'pipe', stderr: 'pipe', stdin: 'ignore' })
    const [out, err] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text()])
    return { code: await p.exited, out, err }
  } catch {
    // tmux is not on PATH. 127 is what a shell reports for that, and `unavailable()` is what
    // callers are meant to consult — no throw, so a missing tmux never crashes a caller.
    return { code: 127, out: '', err: '' }
  }
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

/**
 * Type text and submit it, as two separate `send-keys` calls.
 *
 * `-l` (literal) for the text so a prompt containing `;` or `C-c` is typed rather than interpreted,
 * then the named `Enter` — which is why they cannot be one call.
 *
 * The submit is only sent once the text was accepted. Half a prompt followed by an unconditional
 * Enter is a blank turn sent to an assistant, which is the exact accident this feature exists to
 * avoid.
 *
 * A free function rather than a method on the object below, because `spawn` calls it: reaching it
 * through `this` would break the moment a caller spread or destructured the backend, and `index.ts`
 * spreads it.
 */
async function sendTextTo(id: string, text: string): Promise<boolean> {
  const typed = await tmux(sendKeysLiteralArgs(id, text))
  if (typed.code !== 0) return false
  return (await tmux(sendKeysNamedArgs(id, 'Enter'))).code === 0
}

let tmuxPresent: boolean | null = null

export const tmuxBackend: SessionBackend = {
  id: 'tmux',

  async unavailable() {
    if (tmuxPresent === null) {
      const { code } = await tmux(['-V'])
      tmuxPresent = code === 0
    }
    return tmuxPresent ? undefined : 'tmux is not installed — install it to manage background sessions'
  },

  async spawn(req: BackendSpawn) {
    // Set BEFORE the session exists. `remain-on-exit` afterwards is a race the fast-failing case
    // always wins, and `history-limit` afterwards does not apply to this pane at all — see
    // `serverOptionsArgs`.
    for (const args of serverOptionsArgs()) await tmux(args)
    const { code, out } = await tmux(newSessionArgs({ id: req.id, cwd: req.cwd, argv: req.argv }))
    if (code !== 0) throw new Error(out.trim() || `tmux new-session failed (code ${code})`)
    if (req.sendKeys) {
      // The harness has to have drawn its prompt before anything typed into it lands anywhere. Only
      // the OPENING line needs this wait; `sendText` below is called on a session that is already up
      // and must not pay for it.
      await sleep(SEND_KEYS_DELAY_MS)
      await sendTextTo(req.id, req.sendKeys)
    }
  },

  sendText: sendTextTo,

  async sendKey(id: string, key: string) {
    return (await tmux(sendKeysNamedArgs(id, key))).code === 0
  },

  async list(): Promise<BackendSession[]> {
    // "no server running on …" is the ordinary empty state, not an error: exit code 1 with no
    // sessions is what tmux reports before anything has been started.
    const { out } = await tmux(listSessionsArgs())
    return parseTmuxList(out)
  },

  async capture(id: string, lines: number) {
    const { code, out } = await tmux(capturePaneArgs(id, lines))
    if (code !== 0) return []
    return trimCapture(out.split('\n'))
  },

  async kill(id: string) {
    const { code, err } = await tmux(killSessionArgs(id))
    // A non-zero exit that ISN'T "already gone" leaves the session running — reporting success
    // anyway is exactly the bug this return value exists to prevent (see types.ts).
    return code === 0 || isSessionGoneError(err)
  },

  attachCommand(id: string) {
    return attachArgs(id)
  },

  async detachHint() {
    const { out } = await tmux(showPrefixArgs())
    return parsePrefix(out)
  },
}
