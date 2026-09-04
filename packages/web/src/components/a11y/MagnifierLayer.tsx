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
import { LensMenu } from './LensMenu'
import { MagnifierButton } from './MagnifierButton'

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

export function MagnifierLayer({ ctx, hasHeaderSlot }: { ctx: AppContext; hasHeaderSlot: boolean }) {
  const { a11y, lang } = ctx
  const active = a11y.prefs.enabled
  const container = useLayerContainer(active)
  const isMobile = useIsMobile()
  const text = useMemo(() => a11yText(lang), [lang])
  const [scheduler, setScheduler] = useState<MirrorScheduler | null>(null)
  const [menu, setMenu] = useState<{ id: string; x: number; y: number } | null>(null)

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
      {/*
        No header slot exists to host the button (mobile inside the Sessions workspace — see
        App.tsx's `headerHostsMagnifier`). Without this, a pinned lens (pointerEvents: 'none' on
        the whole frame) is unreachable and the user is stuck, not merely inconvenienced. Anchored
        mid-right, vertically centered — clear of the workspace's own top bar (back button / tabs /
        session actions, or the filters row), its bottom nav / chat composer, and any bottom
        sheet. It floats over scrollable content rather than a control, which is the one place
        nothing else on either screen ever puts a fixed element. Not anchored near the top, so
        `--safe-top` does not apply here.
        `pointerEvents: 'auto'` is required: the portal container above is 'none'.
      */}
      {!hasHeaderSlot && (
        <div style={{
          position: 'fixed', right: 12, top: '50%', transform: 'translateY(-50%)',
          pointerEvents: 'auto', zIndex: 2147483000,
        }}>
          <MagnifierButton ctx={ctx} />
        </div>
      )}
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
          onContextMenu={e => {
            e.preventDefault()
            a11y.select(lens.id)
            setMenu({ id: lens.id, x: e.clientX, y: e.clientY })
          }}
        />
      ))}
      {menu && (() => {
        const lens = a11y.lenses.find(l => l.id === menu.id)
        if (!lens) return null
        return (
          <LensMenu
            lens={lens} x={menu.x} y={menu.y} text={text} isMobile={isMobile}
            onChange={patch => a11y.updateLens(lens.id, patch)}
            onRemove={() => a11y.removeLens(lens.id)}
            onDuplicate={() => a11y.duplicateLens(lens.id)}
            onClose={() => setMenu(null)}
          />
        )
      })()}
    </>,
    container,
  )
}
