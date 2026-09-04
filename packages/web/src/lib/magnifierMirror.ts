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
   * this rewrites only the root offset `syncNow()` derives from `window.scrollX/Y`. A repositioned
   * sticky copy needs NO correction here: it is placed with `position: fixed` (see `reconcile`'s
   * comment on `fixedStickies`), which resolves against the STAGE's own transform regardless of
   * the clone root's `-scroll` offset, so it never drifts in the first place. What is still only
   * ever right as of the last full sync is everything else `reconcile` computes (content, form
   * state, canvas pixels, and a repositioned sticky's rect if it moved or resized) — the same
   * eventual-consistency the mirror already has there, bounded by the heartbeat interval.
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
 * This is the whole of Finding 1's fix. The mirror used to reposition EVERY `position: sticky`
 * element it found, on the premise that a sticky inside the transformed stage has no scrolling
 * ancestor and would sink to its static flow position. That premise holds only for a sticky whose
 * scroller is the WINDOW (the page header, an aside pinned down a page that scrolls past it) — a
 * sticky inside a real `overflow: auto` box (a modal body, a popover list, a bounded pick-list)
 * has a scrolling ancestor INSIDE THE CLONE TOO, because `cloneNode` copies that box right along
 * with everything else, and `reconcile`'s existing `scrollTop`/`scrollLeft` copy already
 * reproduces its scroll position faithfully. Repositioning that kind gave the copy a containing
 * block rooted at the CLONE, not at the panel it lives in, so it rendered doubly displaced, and
 * `setScroll` then slid it further on every scroll frame on top of that.
 *
 * So each sticky is classified HERE, on the LIVE tree, before anything is cloned: walk its
 * ancestors and ask whether any of them is a real scrolling box (`scrolls()`, above — `auto` or
 * `scroll` only; `hidden` clips but never scrolls, so it does not count). One with a scrolling
 * ancestor is left completely alone by `reconcile` — it already renders correctly today. One
 * without is the window-scrolled case and gets a `fixed` rect from `syncNow` — see that function's
 * `fixedStickies` map and `reconcile`'s own comment on why `fixed`, not `absolute`.
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
 * `fixedStickies` maps each LIVE window-scrolled sticky element (per `hasScrollingAncestor`,
 * above) to the `DOMRect` `syncNow` measured for it in ONE read pass BEFORE this walk starts — see
 * that function's own comment for why the read is hoisted out of this function entirely. This
 * function therefore only ever WRITES for a sticky match; it never calls `getBoundingClientRect`
 * itself, which is the whole of Finding 2's fix (one forced layout per sync, not one per sticky).
 *
 * The repositioned copy gets `position: fixed`, never `absolute`. `absolute` resolves against the
 * nearest POSITIONED ancestor, which for a sticky sitting behind an intervening positioned wrapper
 * (a modal's own `position: relative` panel, say) would be that wrapper rather than the clone
 * root — doubly displaced, exactly the bug Finding 1 is fixing. `fixed` instead resolves against
 * the nearest ancestor with a `transform` (or `filter`/`will-change`), which is the STAGE itself —
 * regardless of any ordinary positioned element in between — and stage-local coordinates already
 * equal viewport coordinates once the clone root's `-scroll` offset is applied (see
 * `stageTransform`'s derivation and `createMirrorHost`'s `left`/`top` assignment). So `left:
 * rect.left; top: rect.top`, taken straight from the live measurement with NO scroll term, lands
 * the copy exactly where the live element sits on screen right now — and needs no per-scroll
 * correction either, which is why `setScroll` no longer carries a sticky loop at all.
 *
 * Caveat, stated rather than hidden: an intervening ancestor with its OWN `transform` / `filter` /
 * `will-change` would capture a `fixed` descendant before it reaches the stage. That is far rarer
 * than an intervening positioned ancestor, and none exists in this codebase today — the window-
 * scrolled stickies here (the page header, the settings/custom-page asides, a panel's own pinned
 * edge) sit in ordinary flex/flow ancestors with no such property.
 */
function reconcile(
  live: Element,
  copy: Element,
  fixedStickies: ReadonlyMap<Element, DOMRect>,
): void {
  if (live.scrollTop !== 0 || live.scrollLeft !== 0) {
    copy.scrollTop = live.scrollTop
    copy.scrollLeft = live.scrollLeft
  }

  const stickyRect = fixedStickies.get(live)
  if (stickyRect && copy instanceof HTMLElement) {
    copy.style.position = 'fixed'
    copy.style.left = `${stickyRect.left}px`
    copy.style.top = `${stickyRect.top}px`
    copy.style.width = `${stickyRect.width}px`
    copy.style.height = `${stickyRect.height}px`
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
    reconcile(liveKids[i]!, copyKids[i]!, fixedStickies)
  }
}

export function createMirrorHost(stage: HTMLElement): MirrorHost {
  let alive = true
  // The currently-inserted clone, kept so `setScroll` can reposition it without re-cloning.
  let clone: HTMLElement | null = null
  return {
    syncNow() {
      if (!alive) return
      const root = sourceRoot()
      if (!root) return

      // Finding 2's fix: ONE read pass over the live sticky set, done BEFORE anything is cloned or
      // written — `hasScrollingAncestor` only reads computed style (no layout dependency) and
      // `getBoundingClientRect` here is the only place this sync forces a layout for a sticky,
      // once, for the whole set, rather than once per sticky inside `reconcile`'s read-after-write
      // walk over a document that by then also carries a second full copy of the dashboard.
      const stickyEls = Array.from(root.querySelectorAll('[style*="sticky"]'))
      const fixedStickies = new Map<Element, DOMRect>()
      for (const el of stickyEls) {
        if (!hasScrollingAncestor(el, root)) {
          fixedStickies.set(el, el.getBoundingClientRect())
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
      reconcile(root, next, fixedStickies)
      clone = next
    },
    setScroll(x, y) {
      if (!alive || !clone) return
      clone.style.left = `${-x}px`
      clone.style.top = `${-y}px`
      // No sticky loop here any more — see `reconcile`'s comment on `fixedStickies`. A repositioned
      // sticky copy is `position: fixed` against the STAGE's own transform, which this scroll-only
      // offset never touches, so it stays put without any per-scroll correction.
    },
    destroy() {
      alive = false
      clone = null
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
