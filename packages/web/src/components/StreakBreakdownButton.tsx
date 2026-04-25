import React, { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { List } from 'lucide-react'
import { format, parseISO, isToday, isYesterday } from 'date-fns'
import { formatProjectName } from '@agentistics/core'

interface StreakDay {
  date: string
  projects: string[]
}

function dayLabel(dateStr: string, pt: boolean): string {
  const d = parseISO(dateStr)
  if (isToday(d)) return pt ? 'Hoje' : 'Today'
  if (isYesterday(d)) return pt ? 'Ontem' : 'Yesterday'
  return format(d, pt ? "EEE, d 'de' MMM" : 'EEE, MMM d')
}

export function StreakBreakdownButton({ items, pt }: {
  items: StreakDay[]
  pt: boolean
}) {
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState({ top: 0, left: 0 })
  const btnRef = useRef<HTMLButtonElement>(null)

  useLayoutEffect(() => {
    if (!open || !btnRef.current) return
    const r = btnRef.current.getBoundingClientRect()
    const popW = 300
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

  if (items.length === 0) return null

  return (
    <>
      <button
        ref={btnRef}
        onClick={e => { e.stopPropagation(); setOpen(v => !v) }}
        title={pt ? 'Ver dias da sequência' : 'View streak days'}
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
            width: 300,
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
            {pt
              ? `Sequência ativa — ${items.length} ${items.length === 1 ? 'dia' : 'dias'} consecutivos`
              : `Active streak — ${items.length} consecutive ${items.length === 1 ? 'day' : 'days'}`}
          </div>

          <div style={{ maxHeight: 320, overflowY: 'auto' }}>
            {items.map(({ date, projects }) => (
              <div key={date} style={{ borderBottom: '1px solid color-mix(in srgb, var(--border) 40%, transparent)' }}>
                <div style={{
                  padding: '7px 12px 4px',
                  fontSize: 11, fontWeight: 700,
                  color: 'var(--text-primary)',
                  letterSpacing: '0.02em',
                }}>
                  {dayLabel(date, pt)}
                </div>
                {projects.length > 0
                  ? projects.map(path => (
                    <div key={path} style={{
                      padding: '2px 12px 2px 20px',
                      fontSize: 11, color: 'var(--text-secondary)',
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    }}>
                      {formatProjectName(path)}
                    </div>
                  ))
                  : (
                    <div style={{ padding: '2px 12px 2px 20px', fontSize: 11, color: 'var(--text-tertiary)', fontStyle: 'italic' }}>
                      {pt ? 'sem sessão registrada' : 'no session recorded'}
                    </div>
                  )
                }
                <div style={{ height: 4 }} />
              </div>
            ))}
          </div>

          <div style={{
            padding: '6px 12px',
            fontSize: 10, color: 'var(--text-tertiary)',
            borderTop: '1px solid var(--border)',
            fontStyle: 'italic',
          }}>
            {pt
              ? 'Cada dia conta se qualquer projeto esteve ativo'
              : 'Each day counts if any project was active'}
          </div>
        </div>,
        document.body
      )}
    </>
  )
}
