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
  active: string
}

interface RawPrefs {
  layouts?: Record<string, GridItem[]>
  activeLayout?: string
  customLayout?: GridItem[] // legacy single-layout format
}

const INIT_NAME = 'Layout 1'
const INIT_STATE: LayoutState = { layouts: { [INIT_NAME]: [] }, active: INIT_NAME }

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
        if (prefs.layouts && Object.keys(prefs.layouts).length > 0) {
          const names = Object.keys(prefs.layouts)
          const active: string = (prefs.activeLayout && prefs.layouts[prefs.activeLayout])
            ? prefs.activeLayout
            : names[0]!
          setState({ layouts: prefs.layouts, active })
        } else if (prefs.customLayout && Array.isArray(prefs.customLayout)) {
          // Migrate legacy single-layout format
          setState({ layouts: { [INIT_NAME]: prefs.customLayout }, active: INIT_NAME })
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
        body: JSON.stringify({ layouts: s.layouts, activeLayout: s.active }),
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

  // All mutations go through this to ensure saves are triggered
  const update = useCallback((updater: (prev: LayoutState) => LayoutState) => {
    setState(prev => {
      const next = updater(prev)
      scheduleSave(next)
      return next
    })
  }, [scheduleSave])

  // Items for the active layout
  const items = state.layouts[state.active] ?? []

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

  // Layout management
  const layoutNames = Object.keys(state.layouts)

  const switchLayout = useCallback((name: string) => {
    update(prev => prev.layouts[name] ? { ...prev, active: name } : prev)
  }, [update])

  const createLayout = useCallback((name: string) => {
    const trimmed = name.trim()
    if (!trimmed) return
    update(prev => {
      if (prev.layouts[trimmed]) return { ...prev, active: trimmed }
      return { layouts: { ...prev.layouts, [trimmed]: [] }, active: trimmed }
    })
  }, [update])

  const renameLayout = useCallback((oldName: string, newName: string) => {
    const trimmed = newName.trim()
    if (!trimmed || oldName === trimmed) return
    update(prev => {
      if (!prev.layouts[oldName]) return prev
      if (prev.layouts[trimmed] && oldName !== trimmed) return prev
      const { [oldName]: layoutItems = [], ...rest } = prev.layouts
      const active = prev.active === oldName ? trimmed : prev.active
      return { layouts: { ...rest, [trimmed]: layoutItems }, active }
    })
  }, [update])

  const deleteLayout = useCallback((name: string) => {
    update(prev => {
      const names = Object.keys(prev.layouts)
      if (names.length <= 1) return prev
      const { [name]: _, ...rest } = prev.layouts
      const fallback = Object.keys(rest)[0] ?? INIT_NAME
      const active = prev.active === name ? fallback : prev.active
      return { layouts: rest, active }
    })
  }, [update])

  return {
    items, setItems, addItem, removeItem, reset, loaded,
    layoutNames,
    activeLayout: state.active,
    switchLayout, createLayout, renameLayout, deleteLayout,
  }
}
