/**
 * accessibility.ts — the magnifier lenses' shared vocabulary.
 *
 * PURE and TOTAL. `sanitizeAccessibilityPrefs` is called on BOTH sides of the wire: the server
 * before it stores, the browser before it renders. A hand-edited `preferences.json` or a stale
 * client must never be able to blank the dashboard or draw a lens with a NaN transform, so every
 * number is clamped rather than rejected and every unknown shape falls back.
 *
 * Border COLOUR is deliberately absent: a lens is always the site orange, in every state and both
 * themes. Thickness and shape are the user's; the colour is the product's.
 */

export type LensShape = 'circle' | 'rect'

/** The look of a lens, shared by placed lenses and by the cursor-following one. */
export interface LensStyle {
  shape: LensShape
  /** px. For a circle this is the DIAMETER and `height` is kept equal to it. */
  width: number
  height: number
  /** How many times magnified. */
  zoom: number
  borderWidth: number
  /** px, rectangles only; ignored while `shape === 'circle'`. */
  cornerRadius: number
}

/** A lens the user placed on one page. Coordinates are viewport px — a lens is position:fixed. */
export interface MagnifierLens extends LensStyle {
  id: string
  x: number
  y: number
  /** Pinned = glass: controls hidden and pointer events pass straight through. */
  pinned: boolean
}

export interface AccessibilityPrefs {
  /** The master switch. Off means no lens layer and no observer at all — the cost is zero. */
  enabled: boolean
  followLens: LensStyle
  newLensDefaults: LensStyle
  /** Keyed by EXACT pathname (query and hash ignored) — see `pageKey` in the web package. */
  lensesByPage: Record<string, MagnifierLens[]>
}

export const ZOOM_MIN = 1.5
export const ZOOM_MAX = 20
export const LENS_MIN_PX = 60
export const LENS_MAX_PX = 2000
export const BORDER_MIN_PX = 1
export const BORDER_MAX_PX = 12
export const CORNER_MAX_PX = 200

export const DEFAULT_LENS_STYLE: LensStyle = {
  shape: 'rect',
  width: 360,
  height: 240,
  zoom: 2.5,
  borderWidth: 3,
  cornerRadius: 12,
}

export const DEFAULT_ACCESSIBILITY_PREFS: AccessibilityPrefs = {
  enabled: false,
  followLens: { ...DEFAULT_LENS_STYLE, shape: 'circle', width: 260, height: 260 },
  newLensDefaults: { ...DEFAULT_LENS_STYLE },
  lensesByPage: {},
}

function num(v: unknown, fallback: number, min: number, max: number): number {
  const n = typeof v === 'number' ? v : Number(v)
  if (!Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, n))
}

function sanitizeStyle(input: unknown, fallback: LensStyle): LensStyle {
  const o = input && typeof input === 'object' ? (input as Record<string, unknown>) : {}
  const shape: LensShape = o.shape === 'circle' ? 'circle' : o.shape === 'rect' ? 'rect' : fallback.shape
  const width = num(o.width, fallback.width, LENS_MIN_PX, LENS_MAX_PX)
  return {
    shape,
    width,
    // A circle has one dimension. Keeping height equal to width means no later reader has to
    // remember which of the two is "the real one".
    height: shape === 'circle' ? width : num(o.height, fallback.height, LENS_MIN_PX, LENS_MAX_PX),
    zoom: num(o.zoom, fallback.zoom, ZOOM_MIN, ZOOM_MAX),
    borderWidth: num(o.borderWidth, fallback.borderWidth, BORDER_MIN_PX, BORDER_MAX_PX),
    cornerRadius: num(o.cornerRadius, fallback.cornerRadius, 0, CORNER_MAX_PX),
  }
}

/** Deterministic, so sanitising twice yields the same ids — which is what makes it idempotent. */
function mintLensId(taken: Set<string>): string {
  let n = 1
  while (taken.has(`lens-${n}`)) n++
  return `lens-${n}`
}

export function sanitizeAccessibilityPrefs(input: unknown): AccessibilityPrefs {
  const o = input && typeof input === 'object' ? (input as Record<string, unknown>) : {}
  const newLensDefaults = sanitizeStyle(o.newLensDefaults, DEFAULT_ACCESSIBILITY_PREFS.newLensDefaults)
  const followLens = sanitizeStyle(o.followLens, DEFAULT_ACCESSIBILITY_PREFS.followLens)

  const rawPages =
    o.lensesByPage && typeof o.lensesByPage === 'object'
      ? (o.lensesByPage as Record<string, unknown>)
      : {}

  const lensesByPage: Record<string, MagnifierLens[]> = {}
  for (const [page, raw] of Object.entries(rawPages)) {
    // A page key is a pathname. Anything else is not addressable and would strand its lenses.
    if (!page.startsWith('/')) continue
    if (!Array.isArray(raw)) continue
    const taken = new Set<string>()
    const lenses: MagnifierLens[] = []
    for (const item of raw) {
      const io = item && typeof item === 'object' ? (item as Record<string, unknown>) : {}
      const style = sanitizeStyle(io, newLensDefaults)
      let id = typeof io.id === 'string' && io.id.trim() !== '' ? io.id.trim() : ''
      if (id === '' || taken.has(id)) id = mintLensId(taken)
      taken.add(id)
      lenses.push({
        ...style,
        id,
        // Position is NOT clamped here: the viewport is a browser fact and this module runs on the
        // server too. `clampLens` in the web package does that, on every render.
        x: num(io.x, 0, -LENS_MAX_PX, 100000),
        y: num(io.y, 0, -LENS_MAX_PX, 100000),
        pinned: io.pinned === true,
      })
    }
    // An empty page is not a page. Keeping the key would grow the document forever as pages are
    // visited and cleared.
    if (lenses.length > 0) lensesByPage[page] = lenses
  }

  return { enabled: o.enabled === true, followLens, newLensDefaults, lensesByPage }
}
