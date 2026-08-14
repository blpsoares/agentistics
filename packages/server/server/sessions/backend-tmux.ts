/**
 * backend-tmux.ts — the Unix SessionBackend. Thin on purpose: every decision it could get wrong
 * lives in the pure `tmux-cli.ts` beside it.
 */

import {
  attachArgs, capturePaneArgs, isSessionGoneError, killSessionArgs, listSessionsArgs,
  newSessionArgs, parsePrefix, parseTmuxList, serverOptionsArgs, sendKeysEnterArgs,
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
      await sleep(SEND_KEYS_DELAY_MS)
      await tmux(sendKeysLiteralArgs(req.id, req.sendKeys))
      await tmux(sendKeysEnterArgs(req.id))
    }
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
