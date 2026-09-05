/**
 * magnifierMirror.ts — the ONLY module in this feature that touches the DOM.
 *
 * Each lens owns a clone of `#root` inside a viewport-sized stage carrying the transform
 * `magnifier.ts` computes, so what the lens shows is the region of the page beneath it.
 *
 * The lens layer is a SIBLING of `#root`, so a clone of `#root` can never contain a lens. That is
 * what makes the mirror-in-a-mirror recursion structurally impossible rather than something to be
 * guarded against — do not move the layer inside `#root`.
 *
 * `cloneNode` does not carry scroll positions, form control state or canvas pixels; `reconcile`
 * copies all three by walking the live and cloned trees in step. A canvas that cannot be copied
 * (WebGL without preserveDrawingBuffer, or a tainted one) is CLEARED rather than left showing its
 * previous frame — an empty region the settings tab warned about is recoverable, a stale one that
 * looks live is not.
 */
import {
  MIRROR_DEFAULTS,
  nextMinInterval,
  pickLensesToSync,
  type MirrorLensState,
  type MirrorScheduleConfig,
} from './mirrorSchedule'

export interface MirrorHost {
  /** Re-clone and reconcile now. */
  syncNow(): void
  /**
   * Move the existing clone to match the window's current scroll position, without re-cloning.
   * The DOM has not changed, so a full `syncNow()` would be wasted work for a pure scroll event —
   * this rewrites the root offset `syncNow()` derives from `window.scrollX/Y`, AND extends every
   * window-scrolled sticky copy's own correction by the same scroll delta — see this function's
   * body for the derivation of why the sticky term needs it (the `position: fixed` predecessor of
   * this fix did not, which is exactly what changed). What is still only ever right as of the last
   * full sync is everything else `reconcile` computes (content, form state, canvas pixels, and a
   * sticky's correction if the element itself moved or resized) — the same eventual-consistency
   * the mirror already has there, bounded by the heartbeat interval.
   */
  setScroll(x: number, y: number): void
  destroy(): void
}

export interface MirrorScheduler {
  register(id: string, host: MirrorHost, isOnScreen: () => boolean): void
  unregister(id: string): void
  /** Something in `#root` changed. */
  markDirty(): void
  /** Move every registered host's clone to the window's current scroll position. Cheap — a style
   *  rewrite per host, never a re-clone. */
  applyScroll(x: number, y: number): void
  /**
   * Stop the `MutationObserver` and the `requestAnimationFrame` loop for good.
   *
   * Unregistering every lens does NOT stop them — `entries.size === 0` only short-circuits the
   * sync work; the observer callback still fires on every mutation of a live dashboard, forever.
   * That callback is a cheap empty-map no-op per mutation, so nothing breaks if the last lens
   * going away and this call drift apart for a while — but the caller SHOULD call `stop()` when
   * the layer tears down or the feature is switched off, rather than leaving the observer running
   * for a page that no longer has anywhere to draw a lens.
   */
  stop(): void
  currentIntervalMs(): number
}

function sourceRoot(): HTMLElement | null {
  return document.getElementById('root')
}

/** Strip what must not be duplicated in a live document, and make the copy inert. */
function neutralize(clone: HTMLElement, live: HTMLElement): void {
  clone.setAttribute('aria-hidden', 'true')
  clone.setAttribute('inert', '')
  clone.style.pointerEvents = 'none'
  // Duplicate ids break getElementById for anything that runs after us; duplicate names break
  // form and radio grouping. A screen reader must hear the page once, not once per lens.
  //
  // NOTE: stripping `id`/`name` leaves `for` / `aria-labelledby` / `headers` / SVG `<use
  // href="#…">` references inside the clone dangling, or pointing past it at whatever element
  // still holds that id on the LIVE page. That is harmless only because the whole clone is
  // `aria-hidden` + `inert`: nothing here is ever focused, read by a screen reader, or clicked.
  // If this mirror is ever made non-inert, this is the first thing that breaks.
  for (const el of Array.from(clone.querySelectorAll('[id], [name]'))) {
    el.removeAttribute('id')
    el.removeAttribute('name')
  }
  clone.removeAttribute('id')
  clone.removeAttribute('name')

  // `index.css` carries an id-scoped rule (`@media (max-width: 767px) { #root { max-width:
  // 100vw; overflow-x: clip; } }`) that stops applying once the clone's id is stripped above.
  // Below 767px that would let the clone overflow horizontally while the live page (which the
  // mirror exists to reproduce truthfully) is clipped. Read these off the LIVE root's computed
  // style — not the clone's, which is still detached from the cascade at this point and would
  // report defaults rather than the applied values — and pin them as inline styles so the effect
  // survives losing the id. Only these two properties: snapshotting the whole computed style
  // would freeze hundreds of values and break inheritance inside the clone.
  const liveStyle = getComputedStyle(live)
  clone.style.maxWidth = liveStyle.maxWidth
  clone.style.overflowX = liveStyle.overflowX
}

/**
 * True when a computed style's `overflow`/`overflow-x`/`overflow-y` is `auto` or `scroll` — i.e.
 * this box is a REAL scrolling container. `hidden` deliberately does NOT count: it clips content
 * but a user can never scroll it, so it never becomes the box a `position: sticky` descendant
 * sticks within — see `hasScrollingAncestor`'s own comment for what that distinction is FOR.
 */
function scrolls(style: CSSStyleDeclaration): boolean {
  return style.overflow === 'auto' || style.overflow === 'scroll'
    || style.overflowX === 'auto' || style.overflowX === 'scroll'
    || style.overflowY === 'auto' || style.overflowY === 'scroll'
}

/**
 * Does `el` have a scrolling ancestor, up to and including `root`?
 *
 * The mirror must not touch a `position: sticky` element that scrolls within a real `overflow:
 * auto`/`scroll` box (a modal body, a popover list, a bounded pick-list): `cloneNode` copies that
 * box right along with everything else, and `reconcile`'s existing `scrollTop`/`scrollLeft` copy
 * already reproduces its scroll position faithfully, so the sticky already renders correctly
 * there. It is only a sticky whose scroller is the WINDOW (the page header, an aside pinned down a
 * page that scrolls past it) that needs correcting: inside the stage it has no scrolling ancestor
 * at all, so — since `position: sticky` with nothing to stick within just sits at its ordinary,
 * un-stuck flow position — it renders wherever that static position happens to fall, which can be
 * far from where the LIVE element currently sits stuck on screen.
 *
 * So each sticky is classified HERE, on the LIVE tree, before anything is cloned: walk its
 * ancestors and ask whether any of them is a real scrolling box (`scrolls()`, above — `auto` or
 * `scroll` only; `hidden` clips but never scrolls, so it does not count). One with a scrolling
 * ancestor is left completely alone by `reconcile` — it already renders correctly today. One
 * without is the window-scrolled case and gets a correction from `syncNow` — see that function's
 * `windowStickies` map and `reconcile`'s own comment on how the correction is applied.
 */
function hasScrollingAncestor(el: Element, root: HTMLElement): boolean {
  let node: HTMLElement | null = el.parentElement
  while (node) {
    if (scrolls(getComputedStyle(node))) return true
    if (node === root) return false
    node = node.parentElement
  }
  return false
}

/**
 * Copy what cloneNode leaves behind, walking both trees in step.
 *
 * `windowStickies` maps each LIVE window-scrolled sticky element (per `hasScrollingAncestor`,
 * above) to the `DOMRect` `syncNow` measured for it in ONE read pass BEFORE this walk starts. This
 * function does not touch a sticky copy's geometry at all — it only records the LINK between the
 * live element and its copy, into `stickyCopies` (an output parameter this function fills as it
 * walks). `syncNow` uses that map afterwards, once the whole tree is linked, to correct every
 * sticky copy in its own two batched passes — seeing why the correction itself can only happen
 * there, and cannot be folded into this per-node walk, is `syncNow`'s own comment.
 *
 * `position: sticky` is left EXACTLY as cloned — `position`, `top` and `left` are never written
 * here. That is the whole of this round's fix: `position: sticky` is IN FLOW (it reserves space
 * for itself exactly like `position: static` does; only ever paint-adjusted once it engages), so
 * a copy that keeps `sticky` keeps that reserved space, and everything laid out around it in the
 * clone matches everything laid out around the LIVE element on the real page — which is what a
 * clone is FOR. The previous fix reassigned `position: fixed` on the copy, and `fixed` boxes
 * reserve NO space in flow: the moment the copy became fixed, the space it used to occupy
 * collapsed and every following sibling in the CLONE slid up to fill the gap, while the live page
 * (where the sticky element keeps reserving its flow space even while visually "stuck") did not —
 * so the settings sticky aside and the settings content ended up drawn on top of each other. A
 * correction that only ever PAINTS the copy somewhere else — a `transform`, which is why `syncNow`
 * uses one — cannot reproduce that bug: transform is applied after layout has already finished, so
 * it can move what a box PAINTS but never what space it RESERVES, which is the property this
 * function relies on to leave every sticky copy fully in flow.
 */
function reconcile(
  live: Element,
  copy: Element,
  windowStickies: ReadonlyMap<Element, DOMRect>,
  stickyCopies: Map<Element, HTMLElement>,
): void {
  if (live.scrollTop !== 0 || live.scrollLeft !== 0) {
    copy.scrollTop = live.scrollTop
    copy.scrollLeft = live.scrollLeft
  }

  if (windowStickies.has(live) && copy instanceof HTMLElement) {
    stickyCopies.set(live, copy)
  }

  if (live instanceof HTMLInputElement && copy instanceof HTMLInputElement) {
    // `type="file"` is the exception: assigning a non-empty string to `HTMLInputElement.value`
    // on a file input throws `InvalidStateError` per the HTML spec (the value is a fake path the
    // UA controls, not settable data) — stock behaviour, not a browser quirk. A file input's
    // value renders nothing a lens needs to show anyway, so there is nothing lost by skipping it.
    // Do not "simplify" this guard away.
    if (live.type !== 'file') {
      copy.value = live.value
    }
    copy.checked = live.checked
  } else if (live instanceof HTMLTextAreaElement && copy instanceof HTMLTextAreaElement) {
    copy.value = live.value
  } else if (live instanceof HTMLSelectElement && copy instanceof HTMLSelectElement) {
    copy.selectedIndex = live.selectedIndex
  } else if (live instanceof HTMLCanvasElement && copy instanceof HTMLCanvasElement) {
    const ctx = copy.getContext('2d')
    if (ctx) {
      ctx.clearRect(0, 0, copy.width, copy.height)
      try {
        // Best effort. A WebGL canvas without preserveDrawingBuffer yields nothing and a tainted
        // one throws; either way the region stays EMPTY, never stale.
        ctx.drawImage(live, 0, 0)
      } catch { /* the settings tab states this limitation in words */ }
    }
  }

  const liveKids = live.children
  const copyKids = copy.children
  const n = Math.min(liveKids.length, copyKids.length)
  // `n` is bounded by both lengths, so index i < n is in range on both sides.
  for (let i = 0; i < n; i++) {
    reconcile(liveKids[i]!, copyKids[i]!, windowStickies, stickyCopies)
  }
}

export function createMirrorHost(stage: HTMLElement): MirrorHost {
  let alive = true
  // The currently-inserted clone, kept so `setScroll` can reposition it without re-cloning.
  let clone: HTMLElement | null = null
  // Every window-scrolled sticky copy's correction as of the LAST full sync — a stage-local
  // (dx, dy) transform, plus the scroll position it was computed against. `setScroll` extends
  // each one by how far the scroll has moved since, so a stuck copy stays anchored between syncs
  // without a re-clone. See `setScroll`'s own comment for the derivation.
  let stickyBases: Map<HTMLElement, { dx: number; dy: number }> = new Map()
  let baseScrollX = 0
  let baseScrollY = 0
  return {
    syncNow() {
      if (!alive) return
      const root = sourceRoot()
      if (!root) return

      // ONE read pass over the live sticky set, done BEFORE anything is cloned or written —
      // `hasScrollingAncestor` only reads computed style (no layout dependency) and
      // `getBoundingClientRect` here is the only place this sync forces a layout for a sticky on
      // the LIVE tree, once, for the whole set.
      const stickyEls = Array.from(root.querySelectorAll('[style*="sticky"]'))
      const windowStickies = new Map<Element, DOMRect>()
      for (const el of stickyEls) {
        if (!hasScrollingAncestor(el, root)) {
          windowStickies.set(el, el.getBoundingClientRect())
        }
      }

      const next = root.cloneNode(true) as HTMLElement
      neutralize(next, root)

      // This app scrolls the WINDOW (`#root` is an ordinary in-flow block starting at the document
      // top; see index.css's "the window stays the scroller" note), but the clone sits inside a
      // viewport-sized stage at stage-local (0,0) and `stageTransform` treats stage-local
      // coordinates as VIEWPORT coordinates. Content at document coordinate D sits at stage-local D
      // (an unmoved clone), while a viewport coordinate is V = D - scroll — so without this offset
      // every lens reads off by exactly the scroll position. Shifting the clone by -scroll makes a
      // normally-flowing descendant at document D render at stage-local (D - scrollX) = V, which is
      // what `stageTransform` assumes.
      //
      // `position: relative` is deliberate and load-bearing here, not `absolute`/`fixed`/a
      // transform: unlike those, `relative` does NOT make this element a containing block for
      // `position: fixed` descendants, so a cloned `position: fixed` element (the sidebar, the
      // mobile bottom nav) keeps resolving against the STAGE's own transform (which already is
      // such a containing block) and lands at the correct viewport position instead of being
      // pinned to this clone's shifted box. Do not "simplify" this to `absolute` later — that
      // silently breaks every fixed element the mirror carries.
      const scrollX = window.scrollX
      const scrollY = window.scrollY
      next.style.position = 'relative'
      next.style.left = `${-scrollX}px`
      next.style.top = `${-scrollY}px`

      stage.replaceChildren(next)
      const stickyCopies = new Map<Element, HTMLElement>()
      reconcile(root, next, windowStickies, stickyCopies)

      // Two batched passes over the sticky copies `reconcile` just linked — read every rect
      // first, then write every transform, so this sync forces a BOUNDED number of layouts (one
      // extra per sticky, all up front) rather than a read interleaved with a write per sticky.
      //
      // `copy.getBoundingClientRect()` is the copy's CURRENT painted position: since it is
      // `position: sticky` with no scrolling ancestor inside the stage (see `hasScrollingAncestor`),
      // it is not actually stuck to anything and simply paints at its ordinary, un-stuck FLOW
      // position — but that read already runs it through the stage's own `scale(...)
      // translate(...)` (Lens.tsx sets that transform on `stage` itself, continuously, independent
      // of when this sync runs), so it is NOT yet directly comparable to `liveRect`, which is a
      // real, unzoomed page measurement. Dividing back out the stage's own scale (measured from the
      // stage's OWN rect against its own untransformed `offsetWidth` — `stage` is a plain 100vw box,
      // so this ratio is exactly the zoom the lens currently applies, whatever it is) recovers the
      // copy's position in the stage's LOCAL, pre-zoom coordinate frame — the same frame `liveRect`
      // already lives in, because of the clone root's `-scroll` offset (see this file's earlier
      // comments on that equivalence). Only once both sides are in that SAME frame does subtracting
      // them give a meaningful delta. This also makes the correction resilient to the lens being
      // zoomed or resized AFTER this sync and BEFORE the next one — a `transform: translate()` on
      // the copy is itself a LOCAL, pre-ancestor-scale offset, so it keeps composing correctly with
      // whatever the stage's transform is at paint time, without needing to be recomputed.
      const stageRect = stage.getBoundingClientRect()
      const scale = stage.offsetWidth > 0 ? stageRect.width / stage.offsetWidth : 1
      const corrections: { copy: HTMLElement; dx: number; dy: number }[] = []
      for (const [live, copyEl] of stickyCopies) {
        const liveRect = windowStickies.get(live)
        if (!liveRect) continue
        const copyRect = copyEl.getBoundingClientRect()
        const copyLocalX = (copyRect.left - stageRect.left) / scale
        const copyLocalY = (copyRect.top - stageRect.top) / scale
        corrections.push({ copy: copyEl, dx: liveRect.left - copyLocalX, dy: liveRect.top - copyLocalY })
      }
      const newBases = new Map<HTMLElement, { dx: number; dy: number }>()
      for (const { copy, dx, dy } of corrections) {
        copy.style.transform = `translate(${dx}px, ${dy}px)`
        newBases.set(copy, { dx, dy })
      }
      // Caveat, stated rather than hidden: a `transform` on a sticky copy makes THAT copy a
      // containing block for any `position: fixed` descendant of its own — same family of caveat
      // as the previous fix's, just moved from the stage to the sticky itself. None of the
      // window-scrolled stickies in this codebase today (the page header, the settings/custom-page
      // asides, a panel's own pinned edge) contain a `position: fixed` descendant.
      stickyBases = newBases
      baseScrollX = scrollX
      baseScrollY = scrollY

      clone = next
    },
    setScroll(x, y) {
      if (!alive || !clone) return
      clone.style.left = `${-x}px`
      clone.style.top = `${-y}px`

      // Derivation: a window-scrolled sticky copy is an ORDINARY in-flow descendant of the clone
      // root (unlike the old `position: fixed` fix, `position: sticky` never escapes flow for
      // containing-block purposes) — so when the root's `left`/`top` above move by
      // `-(x - baseScrollX), -(y - baseScrollY)`, the copy's own underlying flow position shifts by
      // that exact same amount, same as any other normally-flowing descendant. Left uncorrected,
      // the copy would scroll away with the content instead of staying put, unlike the LIVE element
      // it mirrors (which is genuinely stuck to the viewport while scrolling). So each sticky's
      // transform is extended by `(x - baseScrollX, y - baseScrollY)` — the scroll delta since the
      // sync that computed its base correction — which cancels the root's shift term-for-term and
      // keeps the copy's FINAL painted position exactly where the last full sync put it, matching
      // how "stuck" content actually behaves between syncs.
      const dxScroll = x - baseScrollX
      const dyScroll = y - baseScrollY
      for (const [copy, base] of stickyBases) {
        copy.style.transform = `translate(${base.dx + dxScroll}px, ${base.dy + dyScroll}px)`
      }
    },
    destroy() {
      alive = false
      clone = null
      stickyBases = new Map()
      stage.replaceChildren()
    },
  }
}

interface Entry {
  host: MirrorHost
  isOnScreen: () => boolean
  dirty: boolean
  lastSyncMs: number
}

// Logged at most once per page — a `console.warn` on every animation frame is its own denial of
// service, and one warning is enough to point at the offending lens.
let warnedSyncFailure = false

export function startMirrorScheduler(): MirrorScheduler {
  const entries = new Map<string, Entry>()
  let cfg: MirrorScheduleConfig = { ...MIRROR_DEFAULTS }
  let frame = 0
  let stopped = false

  const observer = new MutationObserver(() => {
    for (const e of entries.values()) e.dirty = true
  })
  const root = sourceRoot()
  if (root) {
    observer.observe(root, { subtree: true, childList: true, attributes: true, characterData: true })
  }

  const tick = () => {
    if (stopped) return
    frame = requestAnimationFrame(tick)
    if (entries.size === 0) return

    const now = performance.now()
    const states: MirrorLensState[] = []
    for (const [id, e] of entries) {
      states.push({ id, dirty: e.dirty, onScreen: e.isOnScreen(), lastSyncMs: e.lastSyncMs })
    }
    const due = pickLensesToSync(states, now, cfg)
    if (due.length === 0) return

    const started = performance.now()
    for (const id of due) {
      const e = entries.get(id)
      if (!e) continue
      // Defence in depth: `syncNow()` should never throw (the file-input guard above is what
      // used to make it do so), but this loop has no other protection, and `pickLensesToSync`'s
      // ascending sort by `lastSyncMs` puts a lens that never advances FIRST in every subsequent
      // batch — one persistently-throwing lens would freeze every lens batched alongside it,
      // forever. So `lastSyncMs`/`dirty` are always advanced, even on failure.
      try {
        e.host.syncNow()
      } catch (err) {
        if (!warnedSyncFailure) {
          warnedSyncFailure = true
          console.warn('[magnifierMirror] a lens failed to sync; it will keep retrying:', err)
        }
      }
      e.dirty = false
      e.lastSyncMs = now
    }
    cfg = { ...cfg, minIntervalMs: nextMinInterval(performance.now() - started, cfg.minIntervalMs) }
  }
  frame = requestAnimationFrame(tick)

  return {
    register(id, host, isOnScreen) {
      entries.set(id, { host, isOnScreen, dirty: true, lastSyncMs: 0 })
    },
    unregister(id) {
      entries.delete(id)
    },
    markDirty() {
      for (const e of entries.values()) e.dirty = true
    },
    applyScroll(x, y) {
      for (const e of entries.values()) e.host.setScroll(x, y)
    },
    stop() {
      stopped = true
      cancelAnimationFrame(frame)
      observer.disconnect()
      entries.clear()
    },
    currentIntervalMs() {
      return cfg.minIntervalMs
    },
  }
}
