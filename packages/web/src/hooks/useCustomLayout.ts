import { useCallback, useEffect, useRef, useState } from 'react'

export interface GridItem {
  i: string           // instance id (unique per drop)
  x: number
  y: number
  w: number
  h: number
  minW?: number
  minH?: number
  componentId: string // catalog id
}

interface LayoutState {
  layouts: Record<string, GridItem[]>
  pinnedProjects: Record<string, string[]>  // layout name → pinned project paths
  active: string
}

interface RawPrefs {
  layouts?: Record<string, GridItem[]>
  activeLayout?: string
  pinnedProjects?: Record<string, string[]>
  customLayout?: GridItem[] // legacy single-layout format
}

const INIT_NAME = 'Layout 1'
const INIT_STATE: LayoutState = { layouts: { [INIT_NAME]: [] }, pinnedProjects: {}, active: INIT_NAME }

export function useCustomLayout() {
  const [state, setState] = useState<LayoutState>(INIT_STATE)
  const [loaded, setLoaded] = useState(false)
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const inFlight = useRef(false)
  const pendingRef = useRef<LayoutState | null>(null)

  useEffect(() => {
    fetch('/api/preferences')
      .then(r => r.ok ? r.json() as Promise<RawPrefs> : null)
      .then(prefs => {
        if (!prefs) return
        const pinnedProjects = prefs.pinnedProjects ?? {}
        if (prefs.layouts) {
          const names = Object.keys(prefs.layouts)
          if (names.length > 0) {
            const active: string = (prefs.activeLayout && prefs.layouts[prefs.activeLayout])
              ? prefs.activeLayout
              : names[0]!
            setState({ layouts: prefs.layouts, pinnedProjects, active })
          } else {
            // `layouts` present but empty = the user deleted them all. Respect the empty
            // state instead of resurrecting the default "Layout 1" on the next load.
            setState({ layouts: {}, pinnedProjects, active: '' })
          }
        } else if (prefs.customLayout && Array.isArray(prefs.customLayout)) {
          // Migrate legacy single-layout format
          setState({ layouts: { [INIT_NAME]: prefs.customLayout }, pinnedProjects, active: INIT_NAME })
        }
      })
      .catch(() => {})
      .finally(() => setLoaded(true))
  }, [])

  const persist = useCallback(async (s: LayoutState) => {
    if (inFlight.current) { pendingRef.current = s; return }
    inFlight.current = true
    try {
      await fetch('/api/preferences', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ layouts: s.layouts, activeLayout: s.active, pinnedProjects: s.pinnedProjects }),
      })
    } catch {}
    finally {
      inFlight.current = false
      if (pendingRef.current) {
        const q = pendingRef.current; pendingRef.current = null; persist(q)
      }
    }
  }, [])

  const scheduleSave = useCallback((s: LayoutState) => {
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => { persist(s); saveTimer.current = null }, 500)
  }, [persist])

  // Keep the latest state reachable so we can flush a pending save on unmount.
  const stateRef = useRef<LayoutState>(state)
  stateRef.current = state
  useEffect(() => () => {
    if (saveTimer.current) { clearTimeout(saveTimer.current); saveTimer.current = null; persist(stateRef.current) }
  }, [persist])

  // All mutations go through this to ensure saves are triggered. Discrete structural
  // changes (create/rename/delete/duplicate/switch) pass immediate=true so they persist
  // right away — a debounced save can be lost/raced when the page unmounts on a tab switch,
  // which made deleted layouts reappear.
  const update = useCallback((updater: (prev: LayoutState) => LayoutState, immediate = false) => {
    setState(prev => {
      const next = updater(prev)
      if (immediate) {
        if (saveTimer.current) { clearTimeout(saveTimer.current); saveTimer.current = null }
        persist(next)
      } else {
        scheduleSave(next)
      }
      return next
    })
  }, [scheduleSave, persist])

  // Items for the active layout
  const items = state.layouts[state.active] ?? []

  // Pinned projects for the active layout
  const pinnedProjects = state.pinnedProjects[state.active] ?? []

  const setItems = useCallback((next: GridItem[]) => {
    update(prev => ({ ...prev, layouts: { ...prev.layouts, [prev.active]: next } }))
  }, [update])

  const addItem = useCallback((item: GridItem) => {
    update(prev => {
      const cur = prev.layouts[prev.active] ?? []
      return { ...prev, layouts: { ...prev.layouts, [prev.active]: [...cur, item] } }
    })
  }, [update])

  const removeItem = useCallback((i: string) => {
    update(prev => {
      const cur = prev.layouts[prev.active] ?? []
      return { ...prev, layouts: { ...prev.layouts, [prev.active]: cur.filter(x => x.i !== i) } }
    })
  }, [update])

  const reset = useCallback(() => {
    update(prev => ({ ...prev, layouts: { ...prev.layouts, [prev.active]: [] } }))
  }, [update])

  const setPinnedProjects = useCallback((projects: string[]) => {
    update(prev => ({
      ...prev,
      pinnedProjects: { ...prev.pinnedProjects, [prev.active]: projects },
    }))
  }, [update])

  // Layout management
  const layoutNames = Object.keys(state.layouts)

  const switchLayout = useCallback((name: string) => {
    update(prev => prev.layouts[name] ? { ...prev, active: name } : prev, true)
  }, [update])

  const createLayout = useCallback((name: string) => {
    const trimmed = name.trim()
    if (!trimmed) return
    update(prev => {
      if (prev.layouts[trimmed]) return { ...prev, active: trimmed }
      return { ...prev, layouts: { ...prev.layouts, [trimmed]: [] }, active: trimmed }
    }, true)
  }, [update])

  const renameLayout = useCallback((oldName: string, newName: string) => {
    const trimmed = newName.trim()
    if (!trimmed || oldName === trimmed) return
    update(prev => {
      if (!prev.layouts[oldName]) return prev
      if (prev.layouts[trimmed] && oldName !== trimmed) return prev
      const { [oldName]: layoutItems = [], ...restLayouts } = prev.layouts
      const { [oldName]: oldPinned = [], ...restPinned } = prev.pinnedProjects
      const active = prev.active === oldName ? trimmed : prev.active
      return {
        layouts: { ...restLayouts, [trimmed]: layoutItems },
        pinnedProjects: oldPinned.length > 0 ? { ...restPinned, [trimmed]: oldPinned } : restPinned,
        active,
      }
    }, true)
  }, [update])

  const deleteLayout = useCallback((name: string) => {
    update(prev => {
      const { [name]: _, ...restLayouts } = prev.layouts
      const { [name]: __, ...restPinned } = prev.pinnedProjects
      const remaining = Object.keys(restLayouts)
      const active = prev.active === name ? (remaining[0] ?? '') : prev.active
      return { layouts: restLayouts, pinnedProjects: restPinned, active }
    }, true)
  }, [update])

  const deleteLayouts = useCallback((names: string[]) => {
    update(prev => {
      const toDelete = new Set(names)
      const remaining = Object.keys(prev.layouts).filter(n => !toDelete.has(n))
      const newLayouts: Record<string, GridItem[]> = {}
      const newPinned: Record<string, string[]> = {}
      for (const n of remaining) {
        newLayouts[n] = prev.layouts[n]!
        if (prev.pinnedProjects[n]) newPinned[n] = prev.pinnedProjects[n]!
      }
      const active = toDelete.has(prev.active) ? (remaining[0] ?? '') : prev.active
      return { layouts: newLayouts, pinnedProjects: newPinned, active }
    }, true)
  }, [update])

  const duplicateLayout = useCallback((sourceName: string, newName: string, newPinned: string[]) => {
    update(prev => {
      const trimmed = newName.trim()
      if (!trimmed) return prev
      const base = prev.layouts[sourceName] ?? []
      const nextId = Date.now()
      const cloned = base.map((it, idx) => ({ ...it, i: `${it.componentId}__${nextId + idx}` }))
      const newLayouts = { ...prev.layouts, [trimmed]: cloned }
      const newPinnedMap = newPinned.length > 0
        ? { ...prev.pinnedProjects, [trimmed]: newPinned }
        : { ...prev.pinnedProjects }
      return { layouts: newLayouts, pinnedProjects: newPinnedMap, active: trimmed }
    }, true)
  }, [update])

  return {
    items, setItems, addItem, removeItem, reset, loaded,
    layoutNames,
    activeLayout: state.active,
    pinnedProjects,
    pinnedProjectsMap: state.pinnedProjects,
    setPinnedProjects,
    switchLayout, createLayout, renameLayout, deleteLayout, deleteLayouts, duplicateLayout,
  }
}
