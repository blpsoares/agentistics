import React, { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

interface Props {
  full: boolean
  accent: string
  onToggle: () => void
  lang?: string
}

export function PrecisionToggle({ full, accent, onToggle, lang }: Props) {
  const [phase, setPhase] = useState<'idle' | 'loading' | 'tooltip'>('idle')
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [initPos, setInitPos] = useState({ x: 0, y: 0 })
  const spinnerRef = useRef<SVGSVGElement>(null)
  const anchorRef = useRef<HTMLDivElement>(null)
  const [anchorPos, setAnchorPos] = useState({ x: 0, y: 0 })

  useEffect(() => {
    if (!document.querySelector('[data-pt-spin-css]')) {
      const s = document.createElement('style')
      s.setAttribute('data-pt-spin-css', '')
      s.textContent = `@keyframes ptFill { from { stroke-dashoffset: 31.42; } to { stroke-dashoffset: 0; } }`
      document.head.appendChild(s)
    }
  }, [])

  function onEnter(e: React.MouseEvent) {
    setInitPos({ x: e.clientX, y: e.clientY })
    if (anchorRef.current) {
      const r = anchorRef.current.getBoundingClientRect()
      setAnchorPos({ x: r.left + r.width / 2, y: r.top })
    }
    setPhase('loading')
    timerRef.current = setTimeout(() => setPhase('tooltip'), 1000)
  }

  function onMove(e: React.MouseEvent) {
    // Move SVG directly via ref — no state update so animation doesn't restart
    if (spinnerRef.current) {
      spinnerRef.current.style.left = `${e.clientX + 12}px`
      spinnerRef.current.style.top = `${e.clientY - 7}px`
    }
  }

  function onLeave() {
    if (timerRef.current) clearTimeout(timerRef.current)
    setPhase('idle')
  }

  const tooltipText = lang === 'pt' ? 'Abreviado · número completo' : 'Abbreviated · full number'
  const activeBg = `color-mix(in srgb, ${accent} 22%, transparent)`

  return (
    <>
      {phase === 'loading' && createPortal(
        <svg
          ref={spinnerRef}
          width="14" height="14"
          viewBox="0 0 14 14"
          style={{
            position: 'fixed',
            left: initPos.x + 12,
            top: initPos.y - 7,
            pointerEvents: 'none',
            zIndex: 99999,
          }}
        >
          <circle cx="7" cy="7" r="5" fill="none" strokeWidth="1.5" style={{ stroke: 'rgba(128,128,128,0.18)' }} />
          <circle
            cx="7" cy="7" r="5"
            fill="none"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeDasharray={`${2 * Math.PI * 5}`}
            strokeDashoffset={`${2 * Math.PI * 5}`}
            transform="rotate(-90 7 7)"
            style={{ stroke: accent, animation: 'ptFill 1s ease-in-out forwards' }}
          />
        </svg>,
        document.body
      )}

      {phase === 'tooltip' && createPortal(
        <div style={{
          position: 'fixed',
          left: anchorPos.x,
          top: anchorPos.y - 6,
          transform: 'translate(-50%, -100%)',
          background: 'var(--bg-card)',
          color: 'var(--text-secondary)',
          fontSize: 11,
          lineHeight: 1.4,
          padding: '5px 9px',
          borderRadius: 6,
          border: '1px solid var(--border)',
          whiteSpace: 'nowrap',
          zIndex: 99999,
          pointerEvents: 'none',
          boxShadow: '0 4px 14px rgba(0,0,0,0.18)',
        }}>
          {tooltipText}
        </div>,
        document.body
      )}

      <div
        ref={anchorRef}
        style={{ display: 'inline-flex', alignItems: 'center' }}
        onMouseEnter={onEnter}
        onMouseMove={onMove}
        onMouseLeave={onLeave}
      >
        <div style={{
          display: 'flex',
          border: '1px solid var(--border)',
          borderRadius: 5,
          overflow: 'hidden',
        }}>
          <button
            onClick={e => { e.stopPropagation(); if (full) onToggle() }}
            style={{
              fontSize: 9, fontWeight: 700,
              padding: '2px 6px',
              background: !full ? activeBg : 'transparent',
              color: !full ? accent : 'var(--text-tertiary)',
              border: 'none',
              borderRight: '1px solid var(--border)',
              cursor: full ? 'pointer' : 'default',
              fontFamily: 'monospace',
              letterSpacing: '0.01em',
              lineHeight: 1.5,
              transition: 'background 0.15s, color 0.15s',
            }}
          >
            1.2M
          </button>
          <button
            onClick={e => { e.stopPropagation(); if (!full) onToggle() }}
            style={{
              fontSize: 9, fontWeight: 700,
              padding: '2px 6px',
              background: full ? activeBg : 'transparent',
              color: full ? accent : 'var(--text-tertiary)',
              border: 'none',
              cursor: !full ? 'pointer' : 'default',
              fontFamily: 'monospace',
              letterSpacing: '0.01em',
              lineHeight: 1.5,
              transition: 'background 0.15s, color 0.15s',
            }}
          >
            1.234
          </button>
        </div>
      </div>
    </>
  )
}
