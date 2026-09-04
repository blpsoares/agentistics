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
   * this rewrites the root offset `syncNow()` derives from `window.scrollX/Y`, AND every sticky
   * copy's own offset (see `reconcile`'s sticky handling and this function's implementation in
   * `createMirrorHost` for the derivation) — a sticky copy is otherwise left at last sync's
   * position and drifts by the scroll delta on every frame. What is still only ever right as of
   * the last full sync is everything else `reconcile` computes (content, form state, canvas
   * pixels, and a sticky element's SIZE if it changed) — the same eventual-consistency the mirror
   * already has there, bounded by the heartbeat interval.
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

/** A sticky copy positioned during `reconcile`, kept so `setScroll` can rewrite its offset on
 *  every scroll frame without re-measuring or re-walking the tree. `rect` is the LIVE element's
 *  `getBoundingClientRect()` from the sync that created this entry — see the derivation on
 *  `reconcile`'s `left`/`top` assignment and on `MirrorHost.setScroll` for why that single
 *  measurement stays valid across an arbitrary number of later scroll positions. */
interface StickyCopy {
  el: HTMLElement
  rect: DOMRect
}

/**
 * Copy what cloneNode leaves behind, walking both trees in step.
 *
 * `stickyEls` is the LIVE `position: sticky` elements found by ONE `querySelectorAll` pass over
 * the live root (done once per `syncNow()`, in `createMirrorHost`) — never `getComputedStyle`
 * per node, which would force a style recalc on every element of a full dashboard tree. Membership
 * is an object-identity `Set.has`, so it costs one hash lookup per node on top of the walk this
 * function already does; the query itself is a single native DOM scan, the same order of cost as
 * the `cloneNode` this function follows.
 *
 * A sticky element has no scrolling ancestor once it is inside the mirror's transformed stage, so
 * it degrades to `relative` at its static flow position — showing whatever content sits at that Y
 * in the document, not the header. `scrollX`/`scrollY` are the values `createMirrorHost` offset the
 * clone ROOT by for this same sync; see the derivation on the `left`/`top` assignment below.
 *
 * Every sticky copy positioned here is also pushed onto `stickyOut`, so `createMirrorHost` can
 * hand the list to `setScroll` — see that function for why the SAME `rect` measured here is still
 * the right one to reposition against after the scroll position has moved on.
 */
function reconcile(
  live: Element,
  copy: Element,
  stickyEls: ReadonlySet<Element>,
  scrollX: number,
  scrollY: number,
  stickyOut: StickyCopy[],
): void {
  if (live.scrollTop !== 0 || live.scrollLeft !== 0) {
    copy.scrollTop = live.scrollTop
    copy.scrollLeft = live.scrollLeft
  }

  if (stickyEls.has(live) && copy instanceof HTMLElement) {
    // The clone root is offset by `left: -scrollX; top: -scrollY` (see `createMirrorHost`), and it
    // is this element's nearest positioned ancestor (it is `position: relative`, which wins the
    // containing-block search over the stage's `transform` further up) — so an `absolute` child at
    // `left: X` renders at stage-local `X - scrollX`. We want it to land at `rect.left` (the live
    // element's CURRENT on-screen position, viewport px — stage-local now equals viewport, see
    // stageTransform's derivation), so `X - scrollX = rect.left` gives `X = rect.left + scrollX`.
    // This assumes no OTHER positioned element sits between the sticky node and the clone root;
    // true for every sticky element in this codebase today (all are direct-ish descendants with no
    // intervening `position:` wrapper), but a future one that adds such a wrapper would need its
    // own offset folded in here.
    const rect = live.getBoundingClientRect()
    copy.style.position = 'absolute'
    copy.style.left = `${rect.left + scrollX}px`
    copy.style.top = `${rect.top + scrollY}px`
    copy.style.width = `${rect.width}px`
    copy.style.height = `${rect.height}px`
    stickyOut.push({ el: copy, rect })
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
    reconcile(liveKids[i]!, copyKids[i]!, stickyEls, scrollX, scrollY, stickyOut)
  }
}

export function createMirrorHost(stage: HTMLElement): MirrorHost {
  let alive = true
  // The currently-inserted clone, kept so `setScroll` can reposition it without re-cloning.
  let clone: HTMLElement | null = null
  // The sticky copies `reconcile` positioned on the last `syncNow()`, kept alongside their
  // measured live rects so `setScroll` can rewrite their offsets too — see the derivation there.
  let stickyCopies: StickyCopy[] = []
  return {
    syncNow() {
      if (!alive) return
      const root = sourceRoot()
      if (!root) return
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
      const stickyEls = new Set<Element>(Array.from(root.querySelectorAll('[style*="sticky"]')))
      const nextStickyCopies: StickyCopy[] = []
      reconcile(root, next, stickyEls, scrollX, scrollY, nextStickyCopies)
      clone = next
      stickyCopies = nextStickyCopies
    },
    setScroll(x, y) {
      if (!alive || !clone) return
      clone.style.left = `${-x}px`
      clone.style.top = `${-y}px`
      // Same equation `reconcile` derived, re-solved for the CURRENT scroll instead of the one at
      // last sync: the clone root's rendered stage-local position is `-x` (the assignment just
      // above), so an absolute child at `left: X` renders at `X - x`. It must land at `rect.left`
      // — the live element's on-screen position, which `reconcile`'s own comment already argues
      // equals stage-local coordinates — giving `X = rect.left + x`. `rect` is the ONE measurement
      // taken at the last `syncNow()`; it stays the right target between syncs because a sticky
      // element's on-screen position does not itself move while it is scrolled (that is what
      // "sticky" means) — only the clone root's offset does, which is exactly what this call is
      // correcting for. Without this, `left`/`top` stayed fixed at last sync's `rect.left +
      // scrollX`, so a sticky copy drifted by the exact scroll delta on every frame until the next
      // full re-clone.
      for (const { el, rect } of stickyCopies) {
        el.style.left = `${rect.left + x}px`
        el.style.top = `${rect.top + y}px`
      }
    },
    destroy() {
      alive = false
      clone = null
      stickyCopies = []
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
