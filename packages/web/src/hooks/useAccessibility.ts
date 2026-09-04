/**
 * useAccessibility — the magnifier state, loaded from and saved to /api/accessibility.
 *
 * The lenses of the CURRENT page are exposed already clamped to the viewport, so no renderer has
 * to remember to clamp and none of them can disagree about where a lens may sit. Saves are
 * debounced: a drag is one pointermove after another and must not be one request after another.
 *
 * `identity` is a caller-supplied token for "whose settings these are" — `undefined`/a constant
 * while there is nobody (yet) to load for, a distinct value once someone is. It exists because
 * this hook is mounted above the login gate: on a central, `/api/accessibility` 401s/403s until
 * a session is fully authorized, and the load must re-run the moment one becomes available rather
 * than being stuck with whatever it saw on first mount.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'
import type { AccessibilityPrefs, LensStyle, MagnifierLens } from '@agentistics/core'
import { DEFAULT_ACCESSIBILITY_PREFS, mintLensId, sanitizeAccessibilityPrefs } from '@agentistics/core'
import { clampLens, newLens, pageKey } from '../lib/magnifier'

const SAVE_DEBOUNCE_MS = 400

export interface A11yState {
  prefs: AccessibilityPrefs
  loaded: boolean
  page: string
  /** The current page's lenses, already clamped to the viewport. */
  lenses: MagnifierLens[]
  selectedId: string | null
  followOn: boolean
  /**
   * True while every PLACED lens on this page is hidden — a "let me see the page underneath for
   * a second" toggle. It touches no lens's x/y/zoom/pinned and writes nothing to `lensesByPage`
   * (see `toggleLensesHidden` below and `MagnifierLayer`, which simply skips rendering the placed
   * lenses while this is true). It is NOT persisted, exactly like `followOn`: a reload always
   * starts with lenses showing. Persisting it would mean a user who hid their lenses, closed the
   * tab and came back later finds an apparently empty page — with real work sitting there,
   * invisible, and no visible control hinting that anything is there to bring back. A transient
   * "off" is safe to forget; a transient "on" (`followOn`) is safe to forget for the same reason
   * in reverse — both default to the state that shows the least on a fresh load.
   */
  lensesHidden: boolean
  announcement: string
  /**
   * The mirror's current re-sync interval, in ms — published by `MagnifierLayer` (which owns the
   * scheduler) so the settings tab's performance card can show it. `null` while the feature is off
   * or the scheduler has not reported yet; never a stale number from a previous mount.
   */
  mirrorIntervalMs: number | null
  setEnabled(on: boolean): void
  setFollowStyle(style: LensStyle): void
  setNewLensDefaults(style: LensStyle): void
  addLens(): void
  updateLens(id: string, patch: Partial<MagnifierLens>): void
  duplicateLens(id: string): void
  removeLens(id: string): void
  removePage(page: string): void
  setAllPinned(pinned: boolean): void
  select(id: string | null): void
  toggleFollow(): void
  toggleLensesHidden(): void
  announce(text: string): void
  setMirrorIntervalMs(ms: number | null): void
}

function viewport() {
  return { width: window.innerWidth, height: window.innerHeight }
}

export function useAccessibility(identity: string | undefined): A11yState {
  const location = useLocation()
  const page = pageKey(location.pathname)

  const [prefs, setPrefs] = useState<AccessibilityPrefs>(DEFAULT_ACCESSIBILITY_PREFS)
  const [loaded, setLoaded] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [followOn, setFollowOn] = useState(false)
  const [lensesHidden, setLensesHidden] = useState(false)
  const [announcement, setAnnouncement] = useState('')
  const [mirrorIntervalMs, setMirrorIntervalMs] = useState<number | null>(null)
  const [vp, setVp] = useState(viewport)

  // Nothing is written before the restore has happened: an early save would persist the defaults
  // over settings that were still in flight.
  const loadedRef = useRef(false)
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // The source of truth every MUTATOR reads from. Two mutators can run in the same JS turn (a
  // dragged lens's position update landing alongside a follow-style change, coalesced pointer
  // events) — before React re-renders, so both would otherwise close over the same stale `prefs`
  // and the second `setPrefs()` would clobber the first under React's batching. Reading and
  // writing this ref inside `commit()` keeps it exactly in lockstep with committed state, so a
  // mutator started a moment later always sees the previous mutator's result. The RENDER path
  // (the values this hook returns) must keep coming from React state, never from this ref, or the
  // UI stops re-rendering.
  const prefsRef = useRef<AccessibilityPrefs>(DEFAULT_ACCESSIBILITY_PREFS)

  // Re-runs whenever the signed-in identity changes (`App.tsx` passes `undefined` until a
  // central session is fully authorized — signed in AND past MFA enrolment — and a stable
  // constant on a non-central machine, where the route is never gated). On a central,
  // `/api/accessibility` answers 401 before sign-in and 403 before MFA enrolment; without this
  // dependency the hook would fetch exactly once, before either is possible, and a central user
  // would need a full page reload after logging in to ever see their saved lenses.
  useEffect(() => {
    let cancelled = false
    // Nothing under a NEW identity may be treated as loaded until its own fetch has actually
    // succeeded — reset eagerly, not on settle, or an edit committed while the new identity's
    // fetch is still in flight would save over it using the previous identity's data.
    loadedRef.current = false
    fetch('/api/accessibility')
      .then(r => {
        if (!r.ok) throw new Error(`accessibility load failed: ${r.status}`)
        return r.json()
      })
      .then(body => {
        if (cancelled) return
        const sanitized = sanitizeAccessibilityPrefs(body)
        prefsRef.current = sanitized
        setPrefs(sanitized)
        // Arm saving ONLY on a genuinely successful load. A 401/403/network failure must leave
        // this false, so the next edit cannot PUT the still-default state over settings that
        // were never actually read — `.finally()` could not tell success from failure apart,
        // which was the whole of the bug: a failed load looked exactly like an empty one.
        loadedRef.current = true
        setLoaded(true)
      })
      .catch(() => { /* a failed load leaves the defaults on screen and saving DISARMED */ })
    return () => { cancelled = true }
  }, [identity])

  useEffect(() => {
    const onResize = () => setVp(viewport())
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  // A selection is about one page's lenses, and lens ids are minted per page (`lens-1`, `lens-2`,
  // …) — the same id exists on many pages, so carrying a selection across a navigation lets it
  // land on an unrelated lens on the new page (a pinned one, revealing itself with no action by
  // the user there). Clear it on every page change.
  useEffect(() => { setSelectedId(null) }, [page])

  const commit = useCallback((next: AccessibilityPrefs) => {
    prefsRef.current = next
    setPrefs(next)
    if (!loadedRef.current) return
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => {
      fetch('/api/accessibility', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(next),
      }).catch(() => { /* the next edit retries; a lost save is not worth a toast */ })
    }, SAVE_DEBOUNCE_MS)
  }, [])

  const rawLenses = useMemo(() => prefs.lensesByPage[page] ?? [], [prefs.lensesByPage, page])
  const lenses = useMemo(() => rawLenses.map(l => clampLens(l, vp)), [rawLenses, vp])

  // `setPageLenses` and every mutator below read `prefsRef.current` rather than the render-closure
  // `prefs`/`rawLenses`, so two mutations in one JS turn compose instead of the second one
  // clobbering the first.
  const setPageLenses = useCallback((p: string, next: MagnifierLens[]) => {
    const current = prefsRef.current
    const byPage = { ...current.lensesByPage }
    if (next.length === 0) delete byPage[p]
    else byPage[p] = next
    commit({ ...current, lensesByPage: byPage })
  }, [commit])

  const freeId = useCallback((existing: readonly MagnifierLens[]) => {
    const taken = new Set(existing.map(l => l.id))
    return mintLensId(taken)
  }, [])

  return {
    prefs,
    loaded,
    page,
    lenses,
    selectedId,
    followOn,
    lensesHidden,
    announcement,
    mirrorIntervalMs,
    setEnabled: on => commit({ ...prefsRef.current, enabled: on }),
    setFollowStyle: style => commit({ ...prefsRef.current, followLens: style }),
    setNewLensDefaults: style => commit({ ...prefsRef.current, newLensDefaults: style }),
    addLens: () => {
      const current = prefsRef.current.lensesByPage[page] ?? []
      const made = newLens(prefsRef.current.newLensDefaults, viewport(), new Set(current.map(l => l.id)))
      setPageLenses(page, [...current, made])
      setSelectedId(made.id)
    },
    updateLens: (id, patch) => {
      const current = prefsRef.current.lensesByPage[page] ?? []
      setPageLenses(page, current.map(l => (l.id === id ? clampLens({ ...l, ...patch }, viewport()) : l)))
    },
    duplicateLens: id => {
      const current = prefsRef.current.lensesByPage[page] ?? []
      const src = current.find(l => l.id === id)
      if (!src) return
      const copy = { ...src, id: freeId(current), x: src.x + 24, y: src.y + 24, pinned: false }
      setPageLenses(page, [...current, clampLens(copy, viewport())])
      setSelectedId(copy.id)
    },
    removeLens: id => {
      const current = prefsRef.current.lensesByPage[page] ?? []
      setPageLenses(page, current.filter(l => l.id !== id))
      setSelectedId(prev => (prev === id ? null : prev))
    },
    removePage: p => {
      const byPage = { ...prefsRef.current.lensesByPage }
      delete byPage[p]
      commit({ ...prefsRef.current, lensesByPage: byPage })
      if (p === page) setSelectedId(null)
    },
    setAllPinned: pinned => {
      const current = prefsRef.current.lensesByPage[page] ?? []
      setPageLenses(page, current.map(l => ({ ...l, pinned })))
    },
    select: setSelectedId,
    toggleFollow: () => setFollowOn(v => !v),
    // Deliberately NOT routed through `commit()` — see the `lensesHidden` doc comment above. This
    // is UI state exactly like `followOn`, never a preference.
    toggleLensesHidden: () => setLensesHidden(v => !v),
    announce: setAnnouncement,
    setMirrorIntervalMs,
  }
}
