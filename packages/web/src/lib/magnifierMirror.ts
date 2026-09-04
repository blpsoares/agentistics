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
  stop(): void
  currentIntervalMs(): number
}

function sourceRoot(): HTMLElement | null {
  return document.getElementById('root')
}

/** Strip what must not be duplicated in a live document, and make the copy inert. */
function neutralize(clone: HTMLElement): void {
  clone.setAttribute('aria-hidden', 'true')
  clone.setAttribute('inert', '')
  clone.style.pointerEvents = 'none'
  // Duplicate ids break getElementById for anything that runs after us; duplicate names break
  // form and radio grouping. A screen reader must hear the page once, not once per lens.
  for (const el of Array.from(clone.querySelectorAll('[id], [name]'))) {
    el.removeAttribute('id')
    el.removeAttribute('name')
  }
  clone.removeAttribute('id')
}

/** Copy what cloneNode leaves behind, walking both trees in step. */
function reconcile(live: Element, copy: Element): void {
  if (live.scrollTop !== 0 || live.scrollLeft !== 0) {
    copy.scrollTop = live.scrollTop
    copy.scrollLeft = live.scrollLeft
  }

  if (live instanceof HTMLInputElement && copy instanceof HTMLInputElement) {
    copy.value = live.value
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
      neutralize(clone)
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
      e.host.syncNow()
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
