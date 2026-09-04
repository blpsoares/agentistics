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
import { applyLensKey, clampLens } from '../../lib/magnifier'
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

  // One global keydown while the feature is on. Every guard here exists so the feature cannot take
  // the dashboard's own keyboard: a chord that is not ours falls through untouched.
  useEffect(() => {
    if (!active) return

    const editable = (target: EventTarget | null): boolean => {
      const node = target as HTMLElement | null
      if (!node || typeof node.tagName !== 'string') return false
      const tag = node.tagName.toLowerCase()
      if (tag === 'input' || tag === 'textarea' || tag === 'select') return true
      if (node.isContentEditable) return true
      // The session terminal takes every key it can get.
      return typeof node.closest === 'function' && node.closest('.xterm') !== null
    }

    const onKey = (e: KeyboardEvent) => {
      // Ctrl+Shift+Z is the browser's redo. Inside a field it stays the browser's.
      if (e.ctrlKey && e.shiftKey && (e.key === 'Z' || e.key === 'z')) {
        if (editable(e.target)) return
        e.preventDefault()
        a11y.toggleFollow()
        return
      }

      // Ctrl+Shift+M — enter keyboard control with no mouse. Without it, "full keyboard control"
      // would still need an opening click.
      if (e.ctrlKey && e.shiftKey && (e.key === 'M' || e.key === 'm')) {
        if (editable(e.target) || a11y.lenses.length === 0) return
        const first = a11y.lenses[0]
        if (!first) return
        e.preventDefault()
        a11y.select(first.id)
        a11y.announce(text.announce(first.id, first.zoom, first.width, first.height, first.pinned))
        return
      }

      if (!a11y.selectedId || editable(e.target)) return

      // Tab is intercepted ONLY while a lens is selected; Esc gives it back. A permanently
      // hijacked Tab would make the dashboard unusable by keyboard, which is the opposite of what
      // this feature is for. Pinned lenses ARE included: keyboard is how they are reached.
      if (e.key === 'Tab') {
        const idx = a11y.lenses.findIndex(l => l.id === a11y.selectedId)
        if (idx < 0) return
        const n = a11y.lenses.length
        const next = a11y.lenses[(idx + (e.shiftKey ? -1 : 1) + n) % n]
        if (!next) return
        e.preventDefault()
        a11y.select(next.id)
        a11y.announce(text.announce(next.id, next.zoom, next.width, next.height, next.pinned))
        return
      }

      const lens = a11y.lenses.find(l => l.id === a11y.selectedId)
      if (!lens) return
      const result = applyLensKey(lens, e.key, {
        shift: e.shiftKey, alt: e.altKey, ctrl: e.ctrlKey, meta: e.metaKey,
      })
      if (result === null) return
      e.preventDefault()

      if (result === 'remove') {
        a11y.removeLens(lens.id)
        a11y.announce(text.removed)
        return
      }
      if (result === 'deselect') {
        a11y.select(null)
        return
      }
      const next = clampLens(result, { width: window.innerWidth, height: window.innerHeight })
      a11y.updateLens(lens.id, next)
      a11y.announce(text.announce(next.id, next.zoom, next.width, next.height, next.pinned))
    }

    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [active, a11y, text])

  if (!active || !container || !scheduler) return null

  return createPortal(
    <>
      {/*
        Driven by the keydown effect above: every keyboard edit, pin, removal and selection change
        announces here, so a screen-reader user gets the same feedback a sighted one reads off the
        lens frame.
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
        The z-index MUST outrank a lens frame's `2147483000` (Lens.tsx): `newLens()` centres a new
        lens on the viewport and DEFAULT_LENS_STYLE is 360x240, so on any phone under ~472px wide
        that span overlaps this button's — and always overlaps it vertically, since both sit on
        the vertical centre. Lenses render AFTER this button in the JSX, so without a higher
        z-index the lens paints on top and swallows the tap, burying the one way back to a pinned
        lens (which itself takes no pointer events) behind the very thing that created it, on
        every later visit to the page. `2147483200` is the same tier the menus already use, so the
        ordering reads as one deliberate scale: page < lenses < the controls that manage them.
      */}
      {!hasHeaderSlot && (
        <div style={{
          position: 'fixed', right: 12, top: '50%', transform: 'translateY(-50%)',
          pointerEvents: 'auto', zIndex: 2147483200,
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
