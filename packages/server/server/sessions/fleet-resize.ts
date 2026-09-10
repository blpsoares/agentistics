/**
 * fleet-resize.ts — the ASSISTANT pane's resize, wired to its own tmux runner.
 *
 * A thin twin of the shell's, and separate for the reason every pair in this directory is: the two
 * resolve against different sockets, and the FLOOR that protects the dialog readers applies to this
 * one alone. The decision is `pane-resize.ts`; the socket discipline is `createPaneResizer`'s.
 */

import { createPaneResizer } from './pane-resize-web'

async function tmux(args: string[]): Promise<{ code: number; out: string; err: string }> {
  try {
    const p = Bun.spawn(['tmux', ...args], { stdout: 'pipe', stderr: 'pipe', stdin: 'ignore' })
    const [out, err] = await Promise.all([
      new Response(p.stdout).text(),
      new Response(p.stderr).text(),
    ])
    return { code: await p.exited, out, err }
  } catch {
    return { code: 127, out: '', err: '' }
  }
}

const resize = createPaneResizer(tmux)

export function resizeFleetPane(id: string, want: { cols: number; rows: number }) {
  return resize('fleet', id, want)
}
