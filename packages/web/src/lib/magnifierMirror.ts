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
  destroy(): void
}

export interface MirrorScheduler {
  register(id: string, host: MirrorHost, isOnScreen: () => boolean): void
  unregister(id: string): void
  /** Something in `#root` changed. */
  markDirty(): void
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

/** Copy what cloneNode leaves behind, walking both trees in step. */
function reconcile(live: Element, copy: Element): void {
  if (live.scrollTop !== 0 || live.scrollLeft !== 0) {
    copy.scrollTop = live.scrollTop
    copy.scrollLeft = live.scrollLeft
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
  for (let i = 0; i < n; i++) reconcile(liveKids[i]!, copyKids[i]!)
}

export function createMirrorHost(stage: HTMLElement): MirrorHost {
  let alive = true
  return {
    syncNow() {
      if (!alive) return
      const root = sourceRoot()
      if (!root) return
      const clone = root.cloneNode(true) as HTMLElement
      neutralize(clone, root)
      stage.replaceChildren(clone)
      reconcile(root, clone)
    },
    destroy() {
      alive = false
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
