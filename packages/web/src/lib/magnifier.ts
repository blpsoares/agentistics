/**
 * magnifier.ts — every number a lens needs, and nothing that touches the DOM.
 *
 * The lens is `position: fixed`, so all coordinates here are VIEWPORT pixels. The mirror inside a
 * lens is a viewport-sized stage carrying a transform; `stageTransform` is the only place that
 * transform is decided, so the renderer cannot disagree with the geometry the keyboard edits.
 */
import type { LensStyle, MagnifierLens } from '@agentistics/core'
import { LENS_MAX_PX, LENS_MIN_PX, ZOOM_MAX, ZOOM_MIN } from '@agentistics/core'

export interface Rect { x: number; y: number; width: number; height: number }
export interface Viewport { width: number; height: number }
export interface KeyMods { shift: boolean; alt: boolean; ctrl: boolean; meta: boolean }
export type LensKeyResult = MagnifierLens | 'remove' | 'deselect' | null

export const MOVE_STEP_PX = 10
export const MOVE_FINE_PX = 1
export const RESIZE_STEP_PX = 10
export const ZOOM_STEP = 0.5

/**
 * A lens belongs to one EXACT pathname. Query and hash are dropped on purpose: applying a filter
 * is not arriving at a different page, and a lens that vanished when a date preset changed would
 * read as a bug.
 */
export function pageKey(pathname: string): string {
  const p = pathname.split('?')[0]!.split('#')[0]!
  if (p === '' || p === '/') return '/'
  return p.endsWith('/') ? p.slice(0, -1) : p
}

/**
 * The viewport region a lens magnifies: centred on the lens, shrunk by the zoom.
 *
 * What the lens actually SHOWS is its content box — `box-sizing: border-box` makes that
 * `width - 2*borderWidth` by `height - 2*borderWidth`, not the frame's own size — so that is
 * the size that gets divided by the zoom. Getting this wrong offsets the magnified image by
 * exactly `borderWidth` px (the difference between the frame's centre and its content box's
 * centre), which is always safe here (`LENS_MIN_PX` 60, `BORDER_MAX_PX` 12: the interior is
 * never zero or negative). The region stays centred on the FRAME's centre regardless.
 */
export function sourceRect(lens: LensStyle & { x: number; y: number }): Rect {
  const width = (lens.width - 2 * lens.borderWidth) / lens.zoom
  const height = (lens.height - 2 * lens.borderWidth) / lens.zoom
  return {
    x: lens.x + lens.width / 2 - width / 2,
    y: lens.y + lens.height / 2 - height / 2,
    width,
    height,
  }
}

/**
 * What the stage's `transform` must be. The stage is an ORDINARY in-flow child of the frame, so
 * with `transform-origin: 0 0` its untransformed origin sits at the frame's CONTENT-box origin —
 * viewport `(lens.x + borderWidth, lens.y + borderWidth)` — not the viewport origin. Within the
 * stage, a page coordinate P renders at stage-local coordinate P (it is a clone of the page).
 * So `scale(s) translate(tx, ty)` puts stage-local point p at viewport
 * `contentOrigin + s * (p + t)`, and putting the source region's top-left at the content-box
 * top-left means `t = -source.origin`.
 */
export function stageTransform(lens: LensStyle & { x: number; y: number }): { scale: number; tx: number; ty: number } {
  const s = sourceRect(lens)
  return { scale: lens.zoom, tx: -s.x, ty: -s.y }
}

/**
 * Keeps a lens usable: on screen, within the size floor/ceiling, within the zoom bounds. Applied
 * after EVERY edit — drag, resize, keypress, window resize — because a lens parked outside the
 * viewport is one no gesture can reach again.
 */
export function clampLens(lens: MagnifierLens, vp: Viewport): MagnifierLens {
  const maxW = Math.max(LENS_MIN_PX, Math.min(LENS_MAX_PX, vp.width))
  const maxH = Math.max(LENS_MIN_PX, Math.min(LENS_MAX_PX, vp.height))

  let width: number
  let height: number
  if (lens.shape === 'circle') {
    const d = Math.min(Math.max(lens.width, LENS_MIN_PX), Math.min(maxW, maxH))
    width = d
    height = d
  } else {
    width = Math.min(Math.max(lens.width, LENS_MIN_PX), maxW)
    height = Math.min(Math.max(lens.height, LENS_MIN_PX), maxH)
  }

  const zoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, lens.zoom))
  const x = Math.min(Math.max(lens.x, 0), Math.max(0, vp.width - width))
  const y = Math.min(Math.max(lens.y, 0), Math.max(0, vp.height - height))
  return { ...lens, width, height, zoom, x, y }
}

/**
 * The keyboard reducer. Returns `null` when the key was not ours — the caller MUST then let the
 * event through, or the dashboard stops responding to its own shortcuts. Clamping is the caller's
 * job (it owns the viewport).
 */
export function applyLensKey(lens: MagnifierLens, key: string, mods: KeyMods): LensKeyResult {
  // A ctrl/meta chord belongs to the browser or to the app, never to a lens.
  if (mods.ctrl || mods.meta) return null

  const arrows: Record<string, [number, number]> = {
    ArrowLeft: [-1, 0],
    ArrowRight: [1, 0],
    ArrowUp: [0, -1],
    ArrowDown: [0, 1],
  }
  const dir = arrows[key]
  if (dir) {
    const [dx, dy] = dir
    if (mods.shift) {
      if (lens.shape === 'circle') {
        // One dimension, so every arrow has to act on it: right/up grow, left/down shrink.
        const delta = (dx !== 0 ? dx : -dy) * RESIZE_STEP_PX
        return { ...lens, width: lens.width + delta, height: lens.height + delta }
      }
      return {
        ...lens,
        width: lens.width + dx * RESIZE_STEP_PX,
        height: lens.height + dy * RESIZE_STEP_PX,
      }
    }
    const step = mods.alt ? MOVE_FINE_PX : MOVE_STEP_PX
    return { ...lens, x: lens.x + dx * step, y: lens.y + dy * step }
  }

  if (key === '+' || key === '=') return { ...lens, zoom: lens.zoom + ZOOM_STEP }
  if (key === '-' || key === '_') return { ...lens, zoom: lens.zoom - ZOOM_STEP }
  if (key === 'p' || key === 'P') return { ...lens, pinned: !lens.pinned }
  if (key === 'Delete' || key === 'Backspace') return 'remove'
  if (key === 'Escape') return 'deselect'
  return null
}

/** A new lens, centred in the viewport, with an id no sibling holds. */
export function newLens(style: LensStyle, vp: Viewport, taken: Set<string>): MagnifierLens {
  let n = 1
  while (taken.has(`lens-${n}`)) n++
  return {
    ...style,
    id: `lens-${n}`,
    x: Math.round(vp.width / 2 - style.width / 2),
    y: Math.round(vp.height / 2 - style.height / 2),
    pinned: false,
  }
}
