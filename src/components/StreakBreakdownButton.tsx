import React, { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Flame, List } from 'lucide-react'
import { formatProjectName } from '../lib/types'

interface ProjectStreak {
  path: string
  streak: number
}

export function StreakBreakdownButton({ items, pt }: {
  items: ProjectStreak[]
  pt: boolean
}) {
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState({ top: 0, left: 0 })
  const btnRef = useRef<HTMLButtonElement>(null)

  useLayoutEffect(() => {
    if (!open || !btnRef.current) return
    const r = btnRef.current.getBoundingClientRect()
    const popW = 280
    const left = Math.min(r.left, window.innerWidth - popW - 8)
    setPos({ top: r.bottom + 6, left: Math.max(8, left) })
  }, [open])

  useEffect(() => {
    if (!open) return
    function onDown(e: MouseEvent) {
      const pop = document.getElementById('streak-breakdown-pop')
      if (
        btnRef.current && !btnRef.current.contains(e.target as Node) &&
        pop && !pop.contains(e.target as Node)
      ) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  return (
    <>
      <button
        ref={btnRef}
        onClick={e => { e.stopPropagation(); setOpen(v => !v) }}
        title={pt ? 'Ver projetos' : 'View projects'}
        style={{
          width: 18, height: 18, borderRadius: '50%',
          background: open ? 'rgba(239,68,68,0.15)' : 'transparent',
          border: 'none', cursor: 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: open ? '#ef4444' : 'var(--text-tertiary)',
          padding: 0, transition: 'color 0.15s, background 0.15s',
        }}
      >
        <List size={11} />
      </button>

      {open && createPortal(
        <div
          id="streak-breakdown-pop"
          style={{
            position: 'fixed', top: pos.top, left: pos.left, zIndex: 9999,
            width: 280,
            background: 'var(--bg-card)',
            border: '1px solid var(--border)',
            borderRadius: 10,
            boxShadow: '0 8px 24px rgba(0,0,0,0.35)',
            overflow: 'hidden',
          }}
        >
          <div style={{
            padding: '8px 12px 6px',
            fontSize: 10, fontWeight: 600,
            color: 'var(--text-tertiary)',
            textTransform: 'uppercase', letterSpacing: '0.06em',
            borderBottom: '1px solid var(--border)',
          }}>
            {pt ? 'Projetos com sequência ativa' : 'Projects with active streak'}
          </div>
          <div style={{ maxHeight: 280, overflowY: 'auto' }}>
            {items.map(({ path, streak }) => (
              <div key={path} style={{
                display: 'flex', alignItems: 'center',
                justifyContent: 'space-between',
                padding: '7px 12px', gap: 8,
                borderBottom: '1px solid color-mix(in srgb, var(--border) 50%, transparent)',
              }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{
                    fontSize: 12, fontWeight: 600,
                    color: 'var(--text-primary)',
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  }}>
                    {formatProjectName(path)}
                  </div>
                  <div style={{
                    fontSize: 10, color: 'var(--text-tertiary)',
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    marginTop: 1,
                  }}>
                    {path}
                  </div>
                </div>
                <div style={{
                  display: 'flex', alignItems: 'center', gap: 3,
                  fontSize: 13, fontWeight: 700, color: '#ef4444',
                  flexShrink: 0,
                }}>
                  <Flame size={11} />
                  {streak}d
                </div>
              </div>
            ))}
          </div>
        </div>,
        document.body
      )}
    </>
  )
}
