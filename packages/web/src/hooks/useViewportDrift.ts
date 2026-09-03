import { useEffect } from 'react'

/**
 * useViewportDrift — publish how far the LAYOUT VIEWPORT falls short of the screen, as `--vp-drift`.
 *
 * iOS standalone with `apple-mobile-web-app-status-bar-style: black-translucent` hands the web view
 * the whole screen and then keeps reporting `innerHeight` WITHOUT the status bar. Every
 * `position: fixed; bottom: 0` therefore stops short of the physical bottom by exactly the
 * status-bar height, which is why the bottom nav looked like it was floating with a band of page
 * background under it.
 *
 * Measured on an iPhone 14 Pro Max PWA: screen 932pt, the nav's own box a correct 90pt
 * (56 + a 34pt home-indicator inset), 59.0pt stranded below it — that device's
 * `safe-area-inset-top` to the pixel.
 *
 * It MEASURES the shortfall rather than assuming it equals the top inset. Two reasons, and both
 * matter: the day iOS fixes this the difference is 0 and every rule reading the variable becomes a
 * no-op instead of pushing the nav off the bottom of the screen; and a device whose quirk differs
 * gets its own number rather than one borrowed from a phone somebody happened to own.
 *
 * STANDALONE ONLY. In a browser tab `screen.height - innerHeight` is the browser's own chrome —
 * a URL bar and a toolbar, tens of points of it — and subtracting that would launch the nav off
 * the screen. The bound is the second guard: a shortfall outside `[0, MAX_DRIFT]` is not this
 * quirk, and is ignored rather than acted on.
 */

/** Beyond this, the number is not a status bar and this hook has no business trusting it. */
const MAX_DRIFT_PX = 80

export function useViewportDrift(): void {
  useEffect(() => {
    const standalone = window.matchMedia('(display-mode: standalone)').matches
      || (window.navigator as { standalone?: boolean }).standalone === true
    if (!standalone) return

    const apply = () => {
      const drift = window.screen.height - window.innerHeight
      const usable = Number.isFinite(drift) && drift > 0 && drift <= MAX_DRIFT_PX ? drift : 0
      document.documentElement.style.setProperty('--vp-drift', `${usable}px`)
    }
    apply()
    window.addEventListener('resize', apply)
    window.addEventListener('orientationchange', apply)
    return () => {
      window.removeEventListener('resize', apply)
      window.removeEventListener('orientationchange', apply)
      // Left as it was found: a value published for a layout that is unmounting is a value nothing
      // is maintaining.
      document.documentElement.style.removeProperty('--vp-drift')
    }
  }, [])
}
