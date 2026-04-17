import { useCallback, useEffect, useRef, useState } from 'react'

export interface GridItem {
  i: string           // instance id (unique)
  x: number
  y: number
  w: number
  h: number
  minW?: number
  minH?: number
  componentId: string // catalog id
}

interface LoadedPrefs {
  customLayout?: GridItem[]
}

export function useCustomLayout() {
  const [items, setItems] = useState<GridItem[]>([])
  const [loaded, setLoaded] = useState(false)
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const inFlight = useRef(false)
  const pending = useRef<GridItem[] | null>(null)

  // Load on mount
  useEffect(() => {
    fetch('/api/preferences')
      .then(r => r.ok ? r.json() as Promise<LoadedPrefs> : null)
      .then(prefs => {
        if (prefs?.customLayout && Array.isArray(prefs.customLayout)) {
          setItems(prefs.customLayout)
        }
      })
      .catch(() => { /* ignore; start with empty layout */ })
      .finally(() => setLoaded(true))
  }, [])

  const persist = useCallback(async (next: GridItem[]) => {
    if (inFlight.current) {
      pending.current = next
      return
    }
    inFlight.current = true
    try {
      await fetch('/api/preferences', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ customLayout: next }),
      })
    } catch { /* network errors: keep local state, retry next save */ }
    finally {
      inFlight.current = false
      if (pending.current) {
        const queued = pending.current
        pending.current = null
        persist(queued)
      }
    }
  }, [])

  const scheduleSave = useCallback((next: GridItem[]) => {
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => {
      persist(next)
      saveTimer.current = null
    }, 500)
  }, [persist])

  const updateItems = useCallback((next: GridItem[]) => {
    setItems(next)
    scheduleSave(next)
  }, [scheduleSave])

  const addItem = useCallback((item: GridItem) => {
    setItems(prev => {
      const next = [...prev, item]
      scheduleSave(next)
      return next
    })
  }, [scheduleSave])

  const removeItem = useCallback((i: string) => {
    setItems(prev => {
      const next = prev.filter(x => x.i !== i)
      scheduleSave(next)
      return next
    })
  }, [scheduleSave])

  const reset = useCallback(() => {
    setItems([])
    scheduleSave([])
  }, [scheduleSave])

  return { items, setItems: updateItems, addItem, removeItem, reset, loaded }
}
