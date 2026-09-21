import { useEffect, useState } from 'react'

/**
 * useViewportWidth.ts — the viewport's own width, tracked reactively.
 *
 * `App.tsx` already carries this exact `useState` + `resize` listener pair inline for its own
 * `filtrosPanelBounds` call; this is the SAME shape, pulled out so a second consumer — `SessionPanel
 * .tsx`'s full-screen overlays, which need the live width to compute `fullscreenInsetRight` — does
 * not have to hand-roll a THIRD copy of "listen for `resize`, guard SSR". `useIsMobile()` answers a
 * boolean at its own 768px breakpoint only; this answers the actual figure at every size above it.
 */
export function useViewportWidth(): number {
  const [width, setWidth] = useState(() => (typeof window === 'undefined' ? 1440 : window.innerWidth))
  useEffect(() => {
    const onResize = () => setWidth(window.innerWidth)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])
  return width
}
