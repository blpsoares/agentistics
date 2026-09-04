/**
 * magnifier.ts — every number a lens needs, and nothing that touches the DOM.
 *
 * The lens is `position: fixed`, so all coordinates here are VIEWPORT pixels. The mirror inside a
 * lens is a viewport-sized stage carrying a transform; `stageTransform` is the only place that
 * transform is decided, so the renderer cannot disagree with the geometry the keyboard edits.
 */
import type { LensStyle, MagnifierLens } from '@agentistics/core'
import { LENS_MAX_PX, LENS_MIN_PX, mintLensId, ZOOM_MAX, ZOOM_MIN } from '@agentistics/core'

export interface Rect { x: number; y: number; width: number; height: number }
export interface Viewport { width: number; height: number }
export interface KeyMods { shift: boolean; alt: boolean; ctrl: boolean; meta: boolean }
export type LensKeyResult = MagnifierLens | 'remove' | 'deselect' | null

export const MOVE_STEP_PX = 10
export const MOVE_FINE_PX = 1
export const RESIZE_STEP_PX = 10
/** The KEYBOARD zoom step (`+`/`-`, and the on-lens zoom-in/out buttons) — unchanged by the
 *  ZOOM_MIN range now reaching 0.55: `clampLens` floors at `ZOOM_MIN`, so a run of `-` presses
 *  still lands exactly on 0.55 at the bottom. */
export const ZOOM_STEP = 0.5
/**
 * A zoom SLIDER's step, deliberately finer than `ZOOM_STEP`. `ZOOM_MIN`..`ZOOM_MAX` (0.55..20) is
 * a wide range, and a slider stepping by the keyboard's 0.5 would offer exactly ONE stop below
 * 1× (0.55, then straight to 1.05) — usable at the keyboard, where each press is a deliberate
 * step, but a single jump is not a slider a user can drag to a felt-out value. This constant is UI
 * only (like `SIZE_SLIDER_MAX_PX`, which is why it lives here and not beside `ZOOM_MIN` in
 * `@agentistics/core`) and never touches `clampLens` or `applyLensKey`.
 */
export const ZOOM_SLIDER_STEP = 0.05
/**
 * The width/height sliders' UI ceiling — deliberately far below `LENS_MAX_PX` (2000). It is a
 * usability choice (a lens that large eats the whole screen and the live preview with it), not a
 * data constraint, which is why it lives here beside the other UI constants rather than in
 * `@agentistics/core` next to the stored bound it deliberately undercuts.
 */
export const SIZE_SLIDER_MAX_PX = 1200

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
 * A zoom value for display, everywhere one is shown — the lens's own label, its menu, the
 * settings preview and readout, and the announcement sentence. `ZOOM_SLIDER_STEP` (0.05) and
 * repeated `+`/`-` arithmetic on `ZOOM_STEP` (0.5) can both leave a binary-float remainder (e.g.
 * `0.6499999999999999`), which is invisible at the old integer-only range (1.5..20) and would
 * otherwise surface the moment the floor moved to 0.55. Rounding to two decimals is enough
 * precision to tell 0.55 from 1.05 apart and never enough to hide an intentional step.
 */
export function fmtZoom(zoom: number): string {
  return (Math.round(zoom * 100) / 100).toString()
}

/**
 * The viewport region a lens magnifies: centred on the lens, shrunk by the zoom, then clamped to
 * the viewport.
 *
 * What the lens actually SHOWS is its content box — `box-sizing: border-box` makes that
 * `width - 2*borderWidth` by `height - 2*borderWidth`, not the frame's own size — so that is
 * the size that gets divided by the zoom. Getting this wrong offsets the magnified image by
 * exactly `borderWidth` px (because the translation in stageTransform only lands the region
 * at the content box when the region size is derived from the interior, not the frame).
 *
 * The region is centred on the FRAME's centre only away from the page's edges. Centring alone
 * makes the outer band of the page unreachable: a lens pinned against the left edge is centred
 * at half its own width, so nothing further left is ever inside ANY source region — reported as
 * "it cuts a lot off" at a screen corner. So a region that would run past a viewport edge is
 * SHIFTED back inside instead (never resized — resizing would change the magnification the user
 * picked), and an axis where the region is itself wider than the viewport (reachable now that
 * zoom can go below 1, down to 0.55x) is centred on that axis rather than shifted to one side.
 *
 * Trade-off, stated plainly: near an edge the lens no longer shows exactly what is beneath it —
 * it shows the nearest region that exists. That is what makes the page's corners magnifiable at
 * all, and it is how OS-level magnifiers behave. Away from every edge nothing here changes.
 */
export function sourceRect(lens: LensStyle & { x: number; y: number }, vp: Viewport): Rect {
  const width = (lens.width - 2 * lens.borderWidth) / lens.zoom
  const height = (lens.height - 2 * lens.borderWidth) / lens.zoom

  const centredX = lens.x + lens.width / 2 - width / 2
  const centredY = lens.y + lens.height / 2 - height / 2

  const x = width > vp.width ? (vp.width - width) / 2 : Math.min(Math.max(centredX, 0), vp.width - width)
  const y = height > vp.height ? (vp.height - height) / 2 : Math.min(Math.max(centredY, 0), vp.height - height)

  return { x, y, width, height }
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
export function stageTransform(lens: LensStyle & { x: number; y: number }, vp: Viewport): { scale: number; tx: number; ty: number } {
  const s = sourceRect(lens, vp)
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

export type LensControl = 'drag' | 'config' | 'pin' | 'remove' | 'zoomOut' | 'zoomIn' | 'zoomLabel'

/**
 * Which controls fit in a lens this wide, most important first — the same problem the TUI's
 * `fitColumns` solves for a table row, applied to the lens header strip.
 *
 * `drag` is never dropped: without it the lens cannot be moved, and a clipped strip is one no
 * gesture can repair. `config` sits second, right after `drag`, on purpose: it opens the lens's
 * own menu, which reaches EVERY other setting here (zoom, size, shape, border, pin, duplicate,
 * remove) — so a lens narrow enough to show only two controls still gives the user full command
 * of it, where dropping `config` first would leave that lens movable but unconfigurable except by
 * a right-click nobody is told exists. `zoomOut`/`zoomIn` are added as a PAIR or not at all — a
 * lone zoom button would let you go one way and not the other, which is a worse control than
 * neither.
 */
export function lensControls(innerWidthPx: number, controlPx: number, labelPx: number): LensControl[] {
  const controls: LensControl[] = ['drag']
  // The drag handle costs about one control's worth of width in the header strip.
  let used = controlPx

  if (innerWidthPx - used < controlPx) return controls
  controls.push('config')
  used += controlPx

  if (innerWidthPx - used < controlPx) return controls
  controls.push('pin')
  used += controlPx

  if (innerWidthPx - used < controlPx) return controls
  controls.push('remove')
  used += controlPx

  if (innerWidthPx - used < controlPx * 2) return controls
  controls.push('zoomOut', 'zoomIn')
  used += controlPx * 2

  if (innerWidthPx - used < labelPx) return controls
  controls.push('zoomLabel')

  return controls
}

/** A new lens, centred in the viewport, with an id no sibling holds. */
export function newLens(style: LensStyle, vp: Viewport, taken: Set<string>): MagnifierLens {
  return {
    ...style,
    id: mintLensId(taken),
    x: Math.round(vp.width / 2 - style.width / 2),
    y: Math.round(vp.height / 2 - style.height / 2),
    pinned: false,
  }
}
