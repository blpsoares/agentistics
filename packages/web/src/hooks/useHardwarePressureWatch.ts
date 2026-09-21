/**
 * useHardwarePressureWatch — the rail's own Hardware icon turning red, plus the notification that
 * goes with it (addendum item 6, right-icon-rail spec).
 *
 * REUSES THE EXISTING HARDWARE SOURCE: `useHardwareSnapshot` is the very hook `HardwareModal.tsx`
 * already polls `/api/hardware-resources` through (every 5s) — this is a second CALL of that same
 * function, not a second reader of the machine, so the figures the rail's icon reacts to are
 * provably the same ones the modal draws. The PURE decision of what counts as pressure lives in
 * `lib/hardwarePressure.ts`, tested on its own; this hook is only the wiring — sample, decide,
 * remember the last reading, and notify exactly on the crossing into critical.
 *
 * THE NOTIFICATION CHANNEL IS THE EXISTING ONE TOO (`pushNotification`, `lib/notifications.ts`) —
 * client-originated, server-deduped, rendered by the same bell every other client-side notice goes
 * through. No new delivery mechanism.
 */

import { useEffect, useRef, useState } from 'react'
import { useHardwareSnapshot } from '../components/HardwareModal'
import {
  anyCritical, pressureRecommendation, pressureTransition, resourcesPressure,
} from '../lib/hardwarePressure'
import { pushNotification } from '../lib/notifications'

export function useHardwarePressureWatch(lang: 'pt' | 'en'): { critical: boolean } {
  const { hardware } = useHardwareSnapshot(lang)
  // `null` = no reading exists yet. `pressureTransition`'s own rule refuses to fire off that gap —
  // see that function's own header for why treating it as `false` would be wrong.
  const prevRef = useRef<boolean | null>(null)
  const [critical, setCritical] = useState(false)

  useEffect(() => {
    if (!hardware) return
    const pressures = resourcesPressure({ host: hardware.host })
    const next = anyCritical(pressures)
    if (pressureTransition(prevRef.current, next)) {
      const detail = pressureRecommendation(pressures, lang)
      pushNotification({
        type: 'warning',
        code: 'hardware.pressure',
        // `detail` is already the fully-localized recommendation sentence (`pressureRecommendation`
        // took `lang` itself) — carried as `meta` so the notification's own EN/PT copy interpolates
        // it at render time like every other placeholder in `NOTIFICATION_TEXT`, never baked into a
        // raw title/message that would freeze in whichever language was active at the moment.
        ...(detail ? { meta: { detail } } : {}),
      })
    }
    prevRef.current = next
    setCritical(next)
  }, [hardware, lang])

  return { critical }
}
