/**
 * Lens.tsx — one magnifier.
 *
 * Three nested elements: the frame (fixed, orange border, clipped), a viewport-sized stage
 * carrying the transform, and the mirror clone inside it. It is rendered by MagnifierLayer's
 * portal, which lives OUTSIDE #root — see magnifierMirror.ts for why that is load-bearing.
 *
 * Pinned is glass: controls gone, `pointerEvents: none` on the whole frame, clicks pass through.
 */
import React, { useEffect, useRef } from 'react'
import { Pin, PinOff, Move, X, Plus, Minus } from 'lucide-react'
import type { MagnifierLens } from '@agentistics/core'
import { stageTransform } from '../../lib/magnifier'
import { createMirrorHost, type MirrorScheduler } from '../../lib/magnifierMirror'
import type { A11yText } from './i18n'

const ORANGE = 'var(--anthropic-orange)'

interface Props {
  lens: MagnifierLens
  selected: boolean
  /** True while a pinned lens is temporarily revealed by keyboard selection. */
  revealed: boolean
  text: A11yText
  isMobile: boolean
  scheduler: MirrorScheduler
  onChange(patch: Partial<MagnifierLens>): void
  onSelect(): void
  onRemove(): void
  onContextMenu(e: React.MouseEvent): void
}

export function Lens({
  lens, selected, revealed, text, isMobile, scheduler, onChange, onSelect, onRemove, onContextMenu,
}: Props) {
  const stageRef = useRef<HTMLDivElement | null>(null)
  const drag = useRef<{ mode: 'move' | 'resize'; px: number; py: number; from: MagnifierLens } | null>(null)
  // The scheduler asks "is this on screen?" every frame; reading the live lens through a ref
  // avoids re-registering the mirror on every pointermove.
  const lensRef = useRef(lens)
  lensRef.current = lens

  useEffect(() => {
    const stage = stageRef.current
    if (!stage) return
    const host = createMirrorHost(stage)
    const onScreen = () => {
      const l = lensRef.current
      return l.x < window.innerWidth && l.y < window.innerHeight && l.x + l.width > 0 && l.y + l.height > 0
    }
    scheduler.register(lens.id, host, onScreen)
    host.syncNow()
    return () => {
      scheduler.unregister(lens.id)
      host.destroy()
    }
  }, [lens.id, scheduler])

  const t = stageTransform(lens)
  const interactive = !lens.pinned || revealed
  const control = isMobile ? 44 : 26

  const startDrag = (mode: 'move' | 'resize') => (e: React.PointerEvent) => {
    if (!interactive) return
    e.preventDefault()
    e.stopPropagation()
    ;(e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId)
    drag.current = { mode, px: e.clientX, py: e.clientY, from: lens }
    onSelect()
  }

  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current
    if (!d) return
    const dx = e.clientX - d.px
    const dy = e.clientY - d.py
    if (d.mode === 'move') onChange({ x: d.from.x + dx, y: d.from.y + dy })
    else if (d.from.shape === 'circle') onChange({ width: d.from.width + dx, height: d.from.width + dx })
    else onChange({ width: d.from.width + dx, height: d.from.height + dy })
  }

  const endDrag = () => { drag.current = null }

  const btn: React.CSSProperties = {
    width: control, height: control, display: 'flex', alignItems: 'center',
    justifyContent: 'center', borderRadius: 6, border: 'none', background: 'transparent',
    color: '#fff', cursor: 'pointer', padding: 0,
  }

  return (
    <div
      role="group"
      aria-label={`${text.headerTitle} ${lens.id}`}
      onContextMenu={interactive ? onContextMenu : undefined}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      style={{
        position: 'fixed',
        left: lens.x,
        top: lens.y,
        width: lens.width,
        height: lens.height,
        // The colour is the product's, in every state. Only the thickness is the user's.
        border: `${lens.borderWidth}px solid ${ORANGE}`,
        borderRadius: lens.shape === 'circle' ? '50%' : lens.cornerRadius,
        overflow: 'hidden',
        background: 'var(--bg-base)',
        boxShadow: selected ? `0 0 0 3px ${ORANGE}55` : '0 6px 24px rgba(0,0,0,0.35)',
        // Pinned is glass. This is the whole point of pinning.
        pointerEvents: interactive ? 'auto' : 'none',
        zIndex: 2147483000,
        boxSizing: 'border-box',
      }}
    >
      <div
        ref={stageRef}
        aria-hidden="true"
        style={{
          width: '100vw',
          height: '100vh',
          transformOrigin: '0 0',
          transform: `scale(${t.scale}) translate(${t.tx}px, ${t.ty}px)`,
          pointerEvents: 'none',
        }}
      />

      {interactive && (
        <>
          <div
            onPointerDown={startDrag('move')}
            style={{
              position: 'absolute', top: 0, left: 0, right: 0, height: control,
              display: 'flex', alignItems: 'center', gap: 2, padding: '0 4px',
              background: 'rgba(0,0,0,0.55)', cursor: 'move', touchAction: 'none',
            }}
          >
            <Move size={14} color="#fff" />
            <span style={{ flex: 1 }} />
            <button style={btn} aria-label={`${text.zoom} −`}
              onPointerDown={e => e.stopPropagation()}
              onClick={() => onChange({ zoom: lens.zoom - 0.5 })}><Minus size={14} /></button>
            <span style={{ color: '#fff', fontSize: 11, fontWeight: 700, minWidth: 30, textAlign: 'center' }}>
              {lens.zoom}×
            </span>
            <button style={btn} aria-label={`${text.zoom} +`}
              onPointerDown={e => e.stopPropagation()}
              onClick={() => onChange({ zoom: lens.zoom + 0.5 })}><Plus size={14} /></button>
            <button style={btn} aria-label={lens.pinned ? text.unpin : text.pin}
              onPointerDown={e => e.stopPropagation()}
              onClick={() => onChange({ pinned: !lens.pinned })}>
              {lens.pinned ? <PinOff size={14} /> : <Pin size={14} />}
            </button>
            <button style={btn} aria-label={text.remove}
              onPointerDown={e => e.stopPropagation()}
              onClick={onRemove}><X size={14} /></button>
          </div>

          <div
            onPointerDown={startDrag('resize')}
            aria-hidden="true"
            style={{
              position: 'absolute', right: 0, bottom: 0, width: control, height: control,
              background: `linear-gradient(135deg, transparent 50%, ${ORANGE} 50%)`,
              cursor: 'nwse-resize', touchAction: 'none',
            }}
          />
        </>
      )}
    </div>
  )
}
