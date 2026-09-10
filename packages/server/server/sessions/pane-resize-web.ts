/**
 * pane-resize-web.ts — applying a viewer's geometry to a pane, on either socket.
 *
 * The DECISION is the pure `pane-resize.ts` — including the asymmetry that is the whole point: a
 * shell follows its box, an assistant's pane may grow and never shrink below the floor every dialog
 * reader in this product depends on. What is here is the tmux work around it.
 *
 * The runner is INJECTED, as it is in `shell-terminal.ts`, so the socket discipline and the
 * read-plan-write shape are provable without a tmux server.
 */

import { paneInfoArgs, parsePaneInfo, resizeWindowArgs, SHELL_SOCKET } from './tmux-cli'
import { resizePlan, type PaneGeometry } from './pane-resize'
import type { TmuxRun } from './shell-terminal'

export type ResizeScope = 'fleet' | 'shell'

export type ResizeOutcome =
  /** Applied. `cols`/`rows` are what the pane ACTUALLY became, which a clamp can change. */
  | { ok: true; changed: true; cols: number; rows: number }
  /** Nothing to do: the numbers were unusable, or the plan landed on what is already there. */
  | { ok: true; changed: false }
  /** The pane could not be read, or tmux refused. Reported rather than swallowed. */
  | { ok: false; reason: 'unreadable' | 'failed' }

export function createPaneResizer(run: TmuxRun) {
  return async function resize(
    scope: ResizeScope,
    id: string,
    want: PaneGeometry,
  ): Promise<ResizeOutcome> {
    const socket = scope === 'shell' ? SHELL_SOCKET : undefined
    // READ FIRST. The plan needs the current geometry to answer "nothing changed", which is what
    // stops a dragged divider spawning one tmux process per animation frame.
    const meta = await run(paneInfoArgs(id, socket))
    const info = meta.code === 0 ? parsePaneInfo(meta.out) : null
    if (!info) return { ok: false, reason: 'unreadable' }

    const plan = resizePlan({ scope, want, current: { cols: info.cols, rows: info.rows } })
    if (!plan) return { ok: true, changed: false }

    const r = await run(resizeWindowArgs(id, plan, socket))
    if (r.code !== 0) return { ok: false, reason: 'failed' }
    return { ok: true, changed: true, cols: plan.cols, rows: plan.rows }
  }
}
