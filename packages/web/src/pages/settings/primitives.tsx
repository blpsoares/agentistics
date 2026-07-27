import React from 'react'
import { Pencil, Check, AlertTriangle, Info, ChevronDown } from 'lucide-react'
import { useIsMobile } from '../../hooks/useIsMobile'

// ScopeNote
// A subtle info banner explaining WHICH resources the signed-in account can see on a governance
// page (so a scoped manager/user understands the list is their access, not missing data).
export function ScopeNote({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'flex-start', gap: 8, marginBottom: 16,
      padding: '9px 12px', borderRadius: 8,
      background: 'color-mix(in srgb, var(--anthropic-orange) 8%, transparent)',
      border: '1px solid color-mix(in srgb, var(--anthropic-orange) 28%, transparent)',
      fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.5,
    }}>
      <Info size={14} style={{ color: 'var(--anthropic-orange)', flexShrink: 0, marginTop: 1 }} />
      <span>{children}</span>
    </div>
  )
}

// ConfirmModal
// Centered confirmation dialog for destructive actions (delete/revoke/remove). Renders nothing
// when `open` is false. Backdrop click + Escape = cancel. The confirm button is red (danger).
export function ConfirmModal({ open, title, message, confirmLabel, cancelLabel, onConfirm, onCancel, requireText, requireTextHint }: {
  open: boolean
  title: string
  message: string
  confirmLabel: string
  cancelLabel: string
  onConfirm: () => void
  onCancel: () => void
  /** When set, the operator must type this EXACTLY before confirm enables — the guard against
   *  deleting the wrong thing on muscle memory. Omit it for a plain yes/no confirmation. */
  requireText?: string
  /** Prompt shown above the input, e.g. `Type "Client X" to confirm`. */
  requireTextHint?: string
}) {
  const isMobile = useIsMobile()
  const [typed, setTyped] = React.useState('')
  // Reset between openings, otherwise the previous answer would pre-arm the next delete.
  React.useEffect(() => { if (open) setTyped('') }, [open])
  const armed = requireText === undefined || typed === requireText
  React.useEffect(() => {
    if (!open) return
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onCancel() }
    document.addEventListener('keydown', h)
    return () => document.removeEventListener('keydown', h)
  }, [open, onCancel])
  if (!open) return null
  return (
    <div onClick={onCancel} style={{
      position: 'fixed', inset: 0, zIndex: 2000, display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(3px)', padding: 16,
    }}>
      <div onClick={e => e.stopPropagation()} style={{
        width: '100%', maxWidth: 420, background: 'var(--bg-card)', border: '1px solid var(--border)',
        borderRadius: 12, padding: 22, boxShadow: '0 12px 48px rgba(0,0,0,0.5)',
        display: 'flex', flexDirection: 'column', gap: 14,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ display: 'inline-flex', padding: 8, borderRadius: 9, background: 'color-mix(in srgb, #ef4444 15%, transparent)', color: '#ef4444' }}>
            <AlertTriangle size={17} />
          </span>
          <span style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-primary)' }}>{title}</span>
        </div>
        <p style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.55, margin: 0 }}>{message}</p>
        {requireText !== undefined && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {requireTextHint && (
              <span style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>{requireTextHint}</span>
            )}
            <input
              value={typed}
              onChange={e => setTyped(e.target.value)}
              autoFocus
              spellCheck={false}
              autoComplete="off"
              style={{
                width: '100%', boxSizing: 'border-box', padding: isMobile ? '10px 11px' : '8px 11px',
                background: 'var(--bg-elevated)', border: `1px solid ${armed ? '#ef4444' : 'var(--border)'}`,
                borderRadius: 7, fontSize: isMobile ? 16 : 13, color: 'var(--text-primary)',
                outline: 'none', fontFamily: 'inherit',
              }}
            />
          </div>
        )}
        <div style={{
          display: 'flex', gap: 8, marginTop: 2, justifyContent: 'flex-end',
          flexDirection: isMobile ? 'column-reverse' : 'row',
        }}>
          <button type="button" onClick={onCancel} style={{
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            padding: isMobile ? '0 14px' : '8px 14px', minHeight: isMobile ? 44 : undefined,
            width: isMobile ? '100%' : undefined,
            borderRadius: 7, border: '1px solid var(--border)', background: 'transparent',
            color: 'var(--text-secondary)', fontSize: 12.5, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
          }}>{cancelLabel}</button>
          <button type="button" onClick={() => { if (armed) onConfirm() }} disabled={!armed} style={{
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            padding: isMobile ? '0 14px' : '8px 14px', minHeight: isMobile ? 44 : undefined,
            width: isMobile ? '100%' : undefined,
            borderRadius: 7, border: '1px solid #ef4444', background: '#ef4444',
            color: '#fff', fontSize: 12.5, fontWeight: 700, fontFamily: 'inherit',
            cursor: armed ? 'pointer' : 'not-allowed', opacity: armed ? 1 : 0.45,
          }}>{confirmLabel}</button>
        </div>
      </div>
    </div>
  )
}

// RecordCard
// The mobile stand-in for a governance table row. A table with 6-8 columns is unreadable at
// 390px, so on mobile each row renders as a stacked card: title + badge, a subtitle, label/value
// field rows, and a footer of full-width 44px actions. The desktop <table> is kept as-is beside
// it — this is an additional branch, never a replacement.
export function RecordCard({ title, subtitle, badge, fields, actions, onClick, leading }: {
  title: React.ReactNode
  subtitle?: React.ReactNode
  /** Role / presence pill, rendered top-right on the title line. */
  badge?: React.ReactNode
  fields: { label: string; value: React.ReactNode }[]
  /** Rendered in a bordered footer; each direct child stretches to an equal share. */
  actions?: React.ReactNode
  /** Whole-card tap — mirrors the desktop row's onClick (opens the detail drawer). */
  onClick?: () => void
  /** Optional control before the title, e.g. a bulk-select checkbox. */
  leading?: React.ReactNode
}) {
  return (
    <div
      onClick={onClick}
      style={{
        border: '1px solid var(--border)', borderRadius: 12, background: 'var(--bg-card)',
        cursor: onClick ? 'pointer' : 'default', overflow: 'hidden',
      }}
    >
      <div style={{ padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
          {leading && <span onClick={e => e.stopPropagation()} style={{ display: 'flex', flexShrink: 0 }}>{leading}</span>}
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{title}</div>
            {subtitle && (
              <div style={{ fontSize: 11.5, color: 'var(--text-tertiary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginTop: 1 }}>{subtitle}</div>
            )}
          </div>
          {badge && <span style={{ flexShrink: 0 }}>{badge}</span>}
        </div>
        {fields.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
            {fields.map(f => (
              <div key={f.label} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, fontSize: 12 }}>
                <span style={{ color: 'var(--text-tertiary)', flexShrink: 0, minWidth: 82 }}>{f.label}</span>
                <span style={{ color: 'var(--text-secondary)', minWidth: 0, flex: 1, textAlign: 'right' }}>{f.value}</span>
              </div>
            ))}
          </div>
        )}
      </div>
      {actions && (
        <div
          onClick={e => e.stopPropagation()}
          style={{
            display: 'flex', gap: 1, borderTop: '1px solid var(--border)',
            background: 'var(--border)',
          }}
        >
          {actions}
        </div>
      )}
    </div>
  )
}

// RecordCardAction
// A footer button for RecordCard: equal share of the row, 44px tall, flat against its neighbours
// (the 1px gaps in the parent's background show through as hairline dividers).
export function RecordCardAction({ onClick, children, danger, label }: {
  onClick: () => void
  children: React.ReactNode
  danger?: boolean
  label: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      style={{
        flex: 1, minHeight: 44, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 7,
        border: 'none', background: 'var(--bg-card)',
        color: danger ? '#ef4444' : 'var(--text-secondary)',
        fontSize: 12.5, fontWeight: 600, fontFamily: 'inherit', cursor: 'pointer',
      }}
    >
      {children}
    </button>
  )
}

// Shared presentational primitives for the settings pages. Extracted from the old
// PreferencesModal so the settings pages (which replace the modal tabs) keep an
// identical look without depending on the soon-to-be-removed modal.

// Section
// A titled block that is READ-ONLY by default with a right-aligned "Edit" button
// (shown only when `canEdit` and not already editing). Renders `children` (read
// view) by default; when `editing` it renders `editChildren` + Save/Cancel. The
// caller owns the `editing` boolean (per-section state). Used in the detail drawers
// so info shows read-first and each section is edited independently.
export function Section({ title, editing, onEdit, onCancel, onSave, canEdit = true, children, editChildren, labels }: {
  title: string
  editing: boolean
  onEdit: () => void
  onCancel: () => void
  onSave: () => void
  canEdit?: boolean
  children: React.ReactNode
  editChildren: React.ReactNode
  labels?: { edit: string; save: string; cancel: string }
}) {
  const l = labels ?? { edit: 'Edit', save: 'Save', cancel: 'Cancel' }
  const isMobile = useIsMobile()
  return (
    <div style={{ borderTop: '1px solid var(--border-subtle)', paddingTop: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12, gap: 8 }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-tertiary)', letterSpacing: '0.07em', textTransform: 'uppercase' }}>{title}</div>
        {canEdit && !editing && (
          <button type="button" onClick={onEdit} style={{
            display: 'inline-flex', alignItems: 'center', gap: 5, padding: isMobile ? '0 12px' : '5px 10px',
            minHeight: isMobile ? 40 : undefined, borderRadius: 7,
            border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-secondary)',
            fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
          }}><Pencil size={12} /> {l.edit}</button>
        )}
      </div>
      {editing ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {editChildren}
          {/* column-reverse puts Save above Cancel visually while keeping Cancel first in the
              DOM, so the thumb lands on the confirming action, not the discarding one. */}
          <div style={{
            display: 'flex', gap: 8, justifyContent: 'flex-end',
            flexDirection: isMobile ? 'column-reverse' : 'row',
          }}>
            <button type="button" onClick={onCancel} style={{
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6,
              padding: isMobile ? '0 12px' : '7px 12px', minHeight: isMobile ? 44 : undefined,
              width: isMobile ? '100%' : undefined, borderRadius: 7,
              border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-secondary)',
              fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
            }}>{l.cancel}</button>
            <button type="button" onClick={onSave} style={{
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6,
              padding: isMobile ? '0 14px' : '8px 14px', minHeight: isMobile ? 44 : undefined,
              width: isMobile ? '100%' : undefined, borderRadius: 7,
              border: '1px solid var(--anthropic-orange)', background: 'var(--anthropic-orange-dim)', color: 'var(--anthropic-orange)',
              fontSize: 12.5, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
            }}><Check size={14} /> {l.save}</button>
          </div>
        </div>
      ) : children}
    </div>
  )
}

export function SectionHeader({ label }: { label: string }) {
  return (
    <div style={{
      fontSize: 11, fontWeight: 700, color: 'var(--text-tertiary)',
      letterSpacing: '0.07em', textTransform: 'uppercase', marginBottom: 14,
    }}>
      {label}
    </div>
  )
}

export function Divider() {
  return <div style={{ height: 1, background: 'var(--border)', margin: '20px 0' }} />
}

export function TabSelect<T extends string>({
  options, value, onChange, accent = 'var(--anthropic-orange)',
}: {
  options: { value: T; label: string }[]
  value: T
  onChange: (v: T) => void
  accent?: string
}) {
  return (
    <div style={{ display: 'inline-flex', width: 'fit-content', border: '1px solid var(--border)', borderRadius: 6, overflow: 'hidden' }}>
      {options.map((opt, i) => {
        const active = opt.value === value
        return (
          <button
            key={opt.value}
            onClick={() => onChange(opt.value)}
            style={{
              padding: '5px 12px',
              fontSize: 12, fontWeight: active ? 700 : 500,
              background: active ? `color-mix(in srgb, ${accent} 18%, transparent)` : 'transparent',
              color: active ? accent : 'var(--text-secondary)',
              border: 'none',
              borderRight: i < options.length - 1 ? '1px solid var(--border)' : 'none',
              cursor: active ? 'default' : 'pointer',
              fontFamily: 'inherit',
              transition: 'background 0.15s, color 0.15s',
              whiteSpace: 'nowrap',
            }}
          >
            {opt.label}
          </button>
        )
      })}
    </div>
  )
}

export function PrefRow({ label, sub, children }: { label: string; sub?: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14, gap: 12 }}>
      <div>
        <div style={{ fontSize: 13, color: 'var(--text-secondary)', fontWeight: 500 }}>{label}</div>
        {sub && <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 2 }}>{sub}</div>}
      </div>
      {children}
    </div>
  )
}

export function Toggle({ on, onToggle }: { on: boolean; onToggle: () => void }) {
  return (
    <button
      onClick={onToggle}
      style={{
        position: 'relative', width: 34, height: 20, borderRadius: 10,
        border: 'none', background: on ? 'var(--anthropic-orange)' : 'var(--text-tertiary)',
        cursor: 'pointer', padding: 0, transition: 'background 0.2s', flexShrink: 0,
      }}
    >
      <span style={{
        position: 'absolute', top: 3, left: on ? 17 : 3,
        width: 14, height: 14, borderRadius: '50%', background: '#fff',
        transition: 'left 0.2s', boxShadow: '0 1px 3px rgba(0,0,0,0.3)',
      }} />
    </button>
  )
}

export function Checkbox({ checked, onChange, label }: { checked: boolean; onChange: (checked: boolean) => void; label: string }) {
  return (
    <label style={{
      display: 'flex', alignItems: 'center', gap: 8,
      fontSize: 12, color: 'var(--text-secondary)', cursor: 'pointer',
    }}>
      <div
        role="checkbox"
        aria-checked={checked}
        tabIndex={0}
        onClick={() => onChange(!checked)}
        onKeyDown={e => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); onChange(!checked) } }}
        style={{
          width: 16, height: 16, borderRadius: 4, flexShrink: 0,
          border: `1px solid ${checked ? 'var(--anthropic-orange)' : 'var(--border)'}`,
          background: checked ? 'var(--anthropic-orange)' : 'transparent',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          cursor: 'pointer', transition: 'all 0.15s',
        }}
      >
        {checked && (
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
            <path d="M2 6L5 9L10 3" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )}
      </div>
      <span>{label}</span>
    </label>
  )
}

export function Select({ value, onChange, options, placeholder, disabled, searchable, searchPlaceholder }: {
  value: string
  onChange: (v: string) => void
  /** `disabled` greys an option out and blocks selection; `hint` says why, inline. */
  options: { value: string; label: string; disabled?: boolean; hint?: string }[]
  placeholder?: string
  disabled?: boolean
  /** Show a type-to-filter box in the popover. Defaults on when there are many options. */
  searchable?: boolean
  /** Placeholder for the type-to-filter box. English by default, per the project language rule. */
  searchPlaceholder?: string
}) {
  const [open, setOpen] = React.useState(false)
  const [activeIndex, setActiveIndex] = React.useState(-1)
  const [query, setQuery] = React.useState('')
  const wrapperRef = React.useRef<HTMLDivElement>(null)
  const listRef = React.useRef<HTMLDivElement>(null)
  const searchRef = React.useRef<HTMLInputElement>(null)
  const isMobile = useIsMobile()
  // Inside the settings Drawer the popover can render past the viewport bottom, where it is
  // unreachable. Measure on open and flip above the trigger when there is not enough room below.
  const [dropUp, setDropUp] = React.useState(false)
  const POPOVER_MAX_H = 280

  const showSearch = searchable ?? options.length > 8
  const filtered = (showSearch && query.trim())
    ? options.filter(o => o.label.toLowerCase().includes(query.trim().toLowerCase()))
    : options

  const selectedLabel = options.find(o => o.value === value)?.label ?? placeholder ?? ''
  const isEmpty = !value

  React.useEffect(() => {
    if (!open) return
    const handleClickOutside = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [open])

  // Keep the keyboard-highlighted option scrolled into view.
  React.useEffect(() => {
    if (!open || activeIndex < 0) return
    const el = listRef.current?.children[activeIndex] as HTMLElement | undefined
    el?.scrollIntoView({ block: 'nearest' })
  }, [open, activeIndex])

  const openMenu = () => {
    setQuery('')
    const i = options.findIndex(o => o.value === value)
    setActiveIndex(i >= 0 ? i : 0)
    const rect = wrapperRef.current?.getBoundingClientRect()
    if (rect) {
      const below = window.innerHeight - rect.bottom
      // Only flip when the space above is actually better — flipping into even less room is worse.
      setDropUp(below < POPOVER_MAX_H && rect.top > below)
    }
    setOpen(true)
    if (showSearch) setTimeout(() => searchRef.current?.focus(), 0)
  }
  const handleToggle = () => {
    if (disabled) return
    if (open) setOpen(false)
    else openMenu()
  }

  const handleSelect = (optValue: string) => {
    onChange(optValue)
    setOpen(false)
    setQuery('')
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (disabled) return
    if (!open) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Enter' || e.key === ' ') {
        e.preventDefault(); openMenu()
      }
      return
    }
    switch (e.key) {
      case 'ArrowDown': e.preventDefault(); setActiveIndex(i => Math.min(filtered.length - 1, i + 1)); break
      case 'ArrowUp': e.preventDefault(); setActiveIndex(i => Math.max(0, i - 1)); break
      case 'Home': e.preventDefault(); setActiveIndex(0); break
      case 'End': e.preventDefault(); setActiveIndex(filtered.length - 1); break
      case 'Enter':
      case ' ': {
        // Space types into the search box; only Enter selects.
        if (e.key === ' ' && showSearch) return
        e.preventDefault()
        const opt = filtered[activeIndex]
        if (opt && !opt.disabled) handleSelect(opt.value)
        break
      }
      case 'Escape': e.preventDefault(); setOpen(false); break
      case 'Tab': setOpen(false); break
    }
  }

  return (
    <div ref={wrapperRef} style={{ position: 'relative', width: '100%' }}>
      <button
        type="button"
        onClick={handleToggle}
        onKeyDown={handleKeyDown}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        style={{
          width: '100%',
          padding: '8px 11px',
          background: 'var(--bg-elevated)',
          border: `1px solid ${open ? 'var(--anthropic-orange)' : 'var(--border)'}`,
          borderRadius: 8,
          fontSize: 13,
          color: isEmpty ? 'var(--text-tertiary)' : 'var(--text-primary)',
          fontFamily: 'inherit',
          textAlign: 'left',
          cursor: disabled ? 'not-allowed' : 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 8,
          transition: 'border-color 0.15s',
          opacity: disabled ? 0.5 : 1,
        }}
        onMouseEnter={e => {
          if (!disabled && !open) {
            (e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--anthropic-orange)'
          }
        }}
        onMouseLeave={e => {
          if (!disabled && !open) {
            (e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--border)'
          }
        }}
      >
        <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {selectedLabel}
        </span>
        <svg
          width="12"
          height="12"
          viewBox="0 0 12 12"
          fill="none"
          style={{
            flexShrink: 0,
            transform: open ? 'rotate(180deg)' : 'rotate(0deg)',
            transition: 'transform 0.15s',
          }}
        >
          <path
            d="M3 4.5L6 7.5L9 4.5"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>

      {open && (
        <div
          ref={listRef}
          role="listbox"
          style={{
            position: 'absolute',
            ...(dropUp ? { bottom: 'calc(100% + 4px)' } : { top: 'calc(100% + 4px)' }),
            left: 0,
            right: 0,
            zIndex: 50,
            background: 'var(--bg-card)',
            border: '1px solid var(--border)',
            borderRadius: 8,
            boxShadow: '0 8px 28px rgba(0,0,0,0.35)',
            maxHeight: POPOVER_MAX_H,
            overflowY: 'auto',
            padding: 4,
          }}
        >
          {showSearch && (
            <input
              ref={searchRef}
              value={query}
              onChange={e => { setQuery(e.target.value); setActiveIndex(0) }}
              onKeyDown={handleKeyDown}
              placeholder={searchPlaceholder ?? 'Search…'}
              style={{
                position: 'sticky', top: 0, zIndex: 1, width: '100%', boxSizing: 'border-box',
                margin: '0 0 4px', padding: isMobile ? '10px 9px' : '7px 9px', background: 'var(--bg-elevated)',
                border: '1px solid var(--border)', borderRadius: 6,
                // 16px minimum on mobile: below it, iOS Safari auto-zooms the viewport on focus.
                fontSize: isMobile ? 16 : 13,
                color: 'var(--text-primary)', outline: 'none', fontFamily: 'inherit',
              }}
            />
          )}
          {filtered.length === 0 && (
            <div style={{ padding: '8px 10px', fontSize: 12.5, color: 'var(--text-tertiary)' }}>—</div>
          )}
          {filtered.map((opt, idx) => {
            const isSelected = opt.value === value
            const isActive = idx === activeIndex
            return (
              <div
                key={opt.value}
                role="option"
                aria-selected={isSelected}
                aria-disabled={opt.disabled}
                title={opt.hint}
                onClick={() => { if (!opt.disabled) handleSelect(opt.value) }}
                onMouseEnter={() => setActiveIndex(idx)}
                style={{
                  padding: isMobile ? '11px 12px' : '8px 10px',
                  minHeight: isMobile ? 44 : undefined,
                  boxSizing: 'border-box',
                  borderRadius: 6,
                  fontSize: 13,
                  cursor: opt.disabled ? 'not-allowed' : 'pointer',
                  opacity: opt.disabled ? 0.45 : 1,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 8,
                  color: (isActive || isSelected) ? 'var(--anthropic-orange)' : 'var(--text-primary)',
                  background: isActive ? 'var(--anthropic-orange-dim)' : 'transparent',
                  transition: 'background 0.1s, color 0.1s',
                }}
              >
                <span style={{ flex: 1 }}>{opt.label}</span>
                {opt.hint && (
                  <span style={{ fontSize: 11, color: 'var(--text-tertiary)', whiteSpace: 'nowrap' }}>{opt.hint}</span>
                )}
                {isSelected && (
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                    <path
                      d="M3 7L6 10L11 4"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

/**
 * MultiPicker — a Select-shaped trigger that opens a search + checkbox panel.
 *
 * Replaces the pair "single-value Select + a separate bulk button": one control lets the user
 * search, tick one, or tick several, and decide which they wanted only after seeing the list.
 * Values are committed on the confirm button, so a mis-tick costs nothing until then.
 *
 * The panel flips above the trigger when there is no room below (same measurement as Select) and
 * uses 44px rows and a 16px search input on mobile, so it stays usable on a phone.
 */
export function MultiPicker({
  options, onCommit, placeholder, searchPlaceholder, confirmLabel, selectAllLabel, emptyLabel, disabled,
}: {
  options: { value: string; label: string; disabled?: boolean; hint?: string }[]
  /** Called with everything ticked when the user confirms. Never called with an empty list. */
  onCommit: (values: string[]) => void
  placeholder: string
  searchPlaceholder: string
  /** Receives the tick count, e.g. n => `Add ${n}`. */
  confirmLabel: (n: number) => string
  selectAllLabel: string
  emptyLabel: string
  disabled?: boolean
}) {
  const isMobile = useIsMobile()
  const [open, setOpen] = React.useState(false)
  const [picked, setPicked] = React.useState<string[]>([])
  const [query, setQuery] = React.useState('')
  const [dropUp, setDropUp] = React.useState(false)
  const wrapperRef = React.useRef<HTMLDivElement>(null)
  const searchRef = React.useRef<HTMLInputElement>(null)
  const PANEL_MAX_H = 340

  const filtered = React.useMemo(() => {
    const q = query.trim().toLowerCase()
    return q ? options.filter(o => `${o.label} ${o.value}`.toLowerCase().includes(q)) : options
  }, [options, query])

  const close = React.useCallback(() => { setOpen(false); setPicked([]); setQuery('') }, [])

  React.useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) close()
    }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close() }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey) }
  }, [open, close])

  const openPanel = () => {
    if (disabled) return
    const rect = wrapperRef.current?.getBoundingClientRect()
    if (rect) {
      const below = window.innerHeight - rect.bottom
      setDropUp(below < PANEL_MAX_H && rect.top > below)
    }
    setOpen(true)
    setTimeout(() => searchRef.current?.focus(), 0)
  }

  const commit = () => {
    if (picked.length === 0) return
    onCommit(picked)
    close()
  }

  // Disabled rows can never be ticked, so "select all" is about the selectable ones only —
  // otherwise the box never reads as checked and the toggle looks broken.
  const selectable = filtered.filter(o => !o.disabled)
  const allShownPicked = selectable.length > 0 && selectable.every(o => picked.includes(o.value))

  return (
    <div ref={wrapperRef} style={{ position: 'relative', width: '100%' }}>
      <button
        type="button"
        onClick={() => (open ? close() : openPanel())}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        style={{
          width: '100%', padding: '8px 11px', minHeight: 44, boxSizing: 'border-box',
          background: 'var(--bg-elevated)',
          border: `1px solid ${open ? 'var(--anthropic-orange)' : 'var(--border)'}`,
          borderRadius: 8, fontSize: 13, color: 'var(--text-tertiary)', fontFamily: 'inherit',
          textAlign: 'left', cursor: disabled ? 'not-allowed' : 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8,
          opacity: disabled ? 0.5 : 1,
        }}
      >
        <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{placeholder}</span>
        <ChevronDown size={13} style={{ flexShrink: 0, transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s' }} />
      </button>

      {open && (
        <div
          role="listbox"
          style={{
            position: 'absolute', left: 0, right: 0, zIndex: 50,
            ...(dropUp ? { bottom: 'calc(100% + 4px)' } : { top: 'calc(100% + 4px)' }),
            background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 8,
            boxShadow: '0 8px 28px rgba(0,0,0,0.35)', padding: 6,
            display: 'flex', flexDirection: 'column', gap: 6, maxHeight: PANEL_MAX_H,
          }}
        >
          <input
            ref={searchRef}
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder={searchPlaceholder}
            style={{
              width: '100%', boxSizing: 'border-box', padding: isMobile ? '10px 9px' : '7px 9px',
              background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 6,
              fontSize: isMobile ? 16 : 13, color: 'var(--text-primary)', outline: 'none', fontFamily: 'inherit',
            }}
          />
          {filtered.length > 1 && (
            <div style={{ display: 'flex', alignItems: 'center', minHeight: isMobile ? 44 : 30, paddingLeft: 2 }}>
              <Checkbox
                checked={allShownPicked}
                onChange={c => setPicked(c ? filtered.filter(o => !o.disabled).map(o => o.value) : [])}
                label={selectAllLabel}
              />
            </div>
          )}
          <div style={{ overflowY: 'auto', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
            {filtered.length === 0 && (
              <span style={{ fontSize: 12, color: 'var(--text-tertiary)', padding: '8px 4px' }}>{emptyLabel}</span>
            )}
            {filtered.map(o => (
              <div key={o.value}
                title={o.hint}
                style={{
                  display: 'flex', alignItems: 'center', gap: 6, minHeight: isMobile ? 44 : 32, paddingLeft: 2,
                  opacity: o.disabled ? 0.45 : 1, pointerEvents: o.disabled ? 'none' : undefined,
                }}>
                <Checkbox
                  checked={!o.disabled && picked.includes(o.value)}
                  onChange={c => { if (o.disabled) return; setPicked(prev => c ? [...prev, o.value] : prev.filter(v => v !== o.value)) }}
                  label={o.label}
                />
                {o.hint && <span style={{ fontSize: 11, color: 'var(--text-tertiary)', whiteSpace: 'nowrap' }}>{o.hint}</span>}
              </div>
            ))}
          </div>
          <button
            type="button"
            onClick={commit}
            disabled={picked.length === 0}
            style={{
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6,
              padding: '0 14px', minHeight: 44, borderRadius: 7,
              border: '1px solid var(--anthropic-orange)', background: 'var(--anthropic-orange-dim)',
              color: 'var(--anthropic-orange)', fontSize: 12.5, fontWeight: 600,
              cursor: picked.length === 0 ? 'not-allowed' : 'pointer', fontFamily: 'inherit',
              opacity: picked.length === 0 ? 0.5 : 1,
            }}
          >
            {confirmLabel(picked.length)}
          </button>
        </div>
      )}
    </div>
  )
}
