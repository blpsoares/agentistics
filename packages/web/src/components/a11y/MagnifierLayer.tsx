/**
 * MagnifierLayer.tsx — the portal that holds every lens.
 *
 * Its container is appended to document.body as a SIBLING of #root. That is load-bearing: the
 * mirror clones #root, so a layer inside it would clone itself, forever. Do not move it.
 */
import React, { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import type { AppContext } from '../../lib/app-context'
import { useIsMobile } from '../../hooks/useIsMobile'
import { startMirrorScheduler, type MirrorScheduler } from '../../lib/magnifierMirror'
import { a11yText } from './i18n'
import { Lens } from './Lens'

const CONTAINER_ID = 'ag-magnifiers'

function useLayerContainer(active: boolean): HTMLElement | null {
  const [el, setEl] = useState<HTMLElement | null>(null)
  useEffect(() => {
    if (!active) { setEl(null); return }
    const node = document.createElement('div')
    node.id = CONTAINER_ID
    // No pointer events on the layer itself — only the lenses inside it take any.
    node.style.pointerEvents = 'none'
    document.body.appendChild(node)
    setEl(node)
    return () => { node.remove(); setEl(null) }
  }, [active])
  return el
}

export function MagnifierLayer({ ctx }: { ctx: AppContext }) {
  const { a11y, lang } = ctx
  const active = a11y.prefs.enabled
  const container = useLayerContainer(active)
  const isMobile = useIsMobile()
  const text = useMemo(() => a11yText(lang), [lang])
  const [scheduler, setScheduler] = useState<MirrorScheduler | null>(null)

  useEffect(() => {
    if (!active) return
    const s = startMirrorScheduler()
    setScheduler(s)
    return () => { s.stop(); setScheduler(null) }
  }, [active])

  if (!active || !container || !scheduler) return null

  return createPortal(
    <>
      {/*
        Nothing calls `a11y.announce(...)` yet — this live region is wired and ready, but the
        keyboard task (Task 10) is what will actually drive it. Read this as a prepared wire,
        not a dropped one.
      */}
      <div
        role="status"
        aria-live="polite"
        style={{ position: 'fixed', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' }}
      >
        {a11y.announcement}
      </div>
      {a11y.lenses.map((lens, i) => (
        <Lens
          key={lens.id}
          lens={lens}
          index={i + 1}
          selected={a11y.selectedId === lens.id}
          revealed={a11y.selectedId === lens.id}
          text={text}
          isMobile={isMobile}
          scheduler={scheduler}
          onChange={patch => a11y.updateLens(lens.id, patch)}
          onSelect={() => a11y.select(lens.id)}
          onRemove={() => a11y.removeLens(lens.id)}
          onContextMenu={e => { e.preventDefault(); a11y.select(lens.id) }}
        />
      ))}
    </>,
    container,
  )
}
