/**
 * terminalZoom.ts — the shared, persisted zoom for the live terminals.
 *
 * The zoom is a DISPLAY multiplier, never a column count: every terminal is always rendered at
 * exactly its pane's `cols × rows` and the zoom only scales the pixels, so enlarging the font can
 * never reflow the capture and scatter it — the fidelity the whole feature turns on is independent
 * of size. Above the fit-to-box scale the grid simply scrolls inside its box; the bytes are the
 * same at every zoom.
 *
 * It is one setting for the whole page (a person picks a readable size once, not per session), it
 * SURVIVES reloads (localStorage), and it is shared live across every open terminal through a tiny
 * external store — so `useSyncExternalStore` re-renders them all when it changes.
 */

const KEY = 'agentistics-terminal-zoom'

export const ZOOM_MIN = 0.7
export const ZOOM_MAX = 3
export const ZOOM_STEP = 0.15
export const ZOOM_DEFAULT = 1

/** Clamp to the allowed range and round to a clean 2-decimal step so repeated +/- stays exact. */
export function clampZoom(z: number): number {
  if (!Number.isFinite(z)) return ZOOM_DEFAULT
  const rounded = Math.round(z * 100) / 100
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, rounded))
}

function readInitial(): number {
  try {
    const raw = localStorage.getItem(KEY)
    if (raw == null) return ZOOM_DEFAULT
    return clampZoom(parseFloat(raw))
  } catch {
    // Private mode / disabled storage — a missing preference is not an error.
    return ZOOM_DEFAULT
  }
}

let current = readInitial()
const subscribers = new Set<() => void>()

export function getTerminalZoom(): number {
  return current
}

export function setTerminalZoom(z: number): void {
  const next = clampZoom(z)
  if (next === current) return
  current = next
  try {
    localStorage.setItem(KEY, String(next))
  } catch {
    /* storage may be unavailable; the in-memory value still drives this session */
  }
  for (const fn of subscribers) fn()
}

export function subscribeTerminalZoom(fn: () => void): () => void {
  subscribers.add(fn)
  return () => subscribers.delete(fn)
}
