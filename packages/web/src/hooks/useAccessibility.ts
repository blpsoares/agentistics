/**
 * useAccessibility — the magnifier state, loaded from and saved to /api/accessibility.
 *
 * The lenses of the CURRENT page are exposed already clamped to the viewport, so no renderer has
 * to remember to clamp and none of them can disagree about where a lens may sit. Saves are
 * debounced: a drag is one pointermove after another and must not be one request after another.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'
import type { AccessibilityPrefs, LensStyle, MagnifierLens } from '@agentistics/core'
import { DEFAULT_ACCESSIBILITY_PREFS, sanitizeAccessibilityPrefs } from '@agentistics/core'
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
  announcement: string
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
  announce(text: string): void
}

function viewport() {
  return { width: window.innerWidth, height: window.innerHeight }
}

export function useAccessibility(): A11yState {
  const location = useLocation()
  const page = pageKey(location.pathname)

  const [prefs, setPrefs] = useState<AccessibilityPrefs>(DEFAULT_ACCESSIBILITY_PREFS)
  const [loaded, setLoaded] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [followOn, setFollowOn] = useState(false)
  const [announcement, setAnnouncement] = useState('')
  const [vp, setVp] = useState(viewport)

  // Nothing is written before the restore has happened: an early save would persist the defaults
  // over settings that were still in flight.
  const loadedRef = useRef(false)
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    let cancelled = false
    fetch('/api/accessibility')
      .then(r => (r.ok ? r.json() : null))
      .then(body => { if (!cancelled) setPrefs(sanitizeAccessibilityPrefs(body)) })
      .catch(() => { /* a failed load leaves the defaults; it must never blank the dashboard */ })
      .finally(() => {
        if (cancelled) return
        loadedRef.current = true
        setLoaded(true)
      })
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    const onResize = () => setVp(viewport())
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  const commit = useCallback((next: AccessibilityPrefs) => {
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

  const setPageLenses = useCallback((next: MagnifierLens[]) => {
    const byPage = { ...prefs.lensesByPage }
    if (next.length === 0) delete byPage[page]
    else byPage[page] = next
    commit({ ...prefs, lensesByPage: byPage })
  }, [prefs, page, commit])

  const freeId = useCallback(() => {
    const taken = new Set(rawLenses.map(l => l.id))
    let n = 1
    while (taken.has(`lens-${n}`)) n++
    return `lens-${n}`
  }, [rawLenses])

  return {
    prefs,
    loaded,
    page,
    lenses,
    selectedId,
    followOn,
    announcement,
    setEnabled: on => commit({ ...prefs, enabled: on }),
    setFollowStyle: style => commit({ ...prefs, followLens: style }),
    setNewLensDefaults: style => commit({ ...prefs, newLensDefaults: style }),
    addLens: () => {
      const made = newLens(prefs.newLensDefaults, viewport(), new Set(rawLenses.map(l => l.id)))
      setPageLenses([...rawLenses, made])
      setSelectedId(made.id)
    },
    updateLens: (id, patch) => {
      setPageLenses(rawLenses.map(l => (l.id === id ? clampLens({ ...l, ...patch }, viewport()) : l)))
    },
    duplicateLens: id => {
      const src = rawLenses.find(l => l.id === id)
      if (!src) return
      const copy = { ...src, id: freeId(), x: src.x + 24, y: src.y + 24, pinned: false }
      setPageLenses([...rawLenses, clampLens(copy, viewport())])
      setSelectedId(copy.id)
    },
    removeLens: id => {
      setPageLenses(rawLenses.filter(l => l.id !== id))
      setSelectedId(prev => (prev === id ? null : prev))
    },
    removePage: p => {
      const byPage = { ...prefs.lensesByPage }
      delete byPage[p]
      commit({ ...prefs, lensesByPage: byPage })
      if (p === page) setSelectedId(null)
    },
    setAllPinned: pinned => setPageLenses(rawLenses.map(l => ({ ...l, pinned }))),
    select: setSelectedId,
    toggleFollow: () => setFollowOn(v => !v),
    announce: setAnnouncement,
  }
}
