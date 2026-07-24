import React from 'react'
import { Pencil, Check, AlertTriangle } from 'lucide-react'

// ── ConfirmModal ──────────────────────────────────────────────────────────────
// Centered confirmation dialog for destructive actions (delete/revoke/remove). Renders nothing
// when `open` is false. Backdrop click + Escape = cancel. The confirm button is red (danger).
export function ConfirmModal({ open, title, message, confirmLabel, cancelLabel, onConfirm, onCancel }: {
  open: boolean
  title: string
  message: string
  confirmLabel: string
  cancelLabel: string
  onConfirm: () => void
  onCancel: () => void
}) {
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
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 2 }}>
          <button type="button" onClick={onCancel} style={{
            padding: '8px 14px', borderRadius: 7, border: '1px solid var(--border)', background: 'transparent',
            color: 'var(--text-secondary)', fontSize: 12.5, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
          }}>{cancelLabel}</button>
          <button type="button" onClick={onConfirm} style={{
            padding: '8px 14px', borderRadius: 7, border: '1px solid #ef4444', background: '#ef4444',
            color: '#fff', fontSize: 12.5, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit',
          }}>{confirmLabel}</button>
        </div>
      </div>
    </div>
  )
}

// Shared presentational primitives for the settings pages. Extracted from the old
// PreferencesModal so the settings pages (which replace the modal tabs) keep an
// identical look without depending on the soon-to-be-removed modal.

// ── Section ─────────────────────────────────────────────────────────────────
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
  return (
    <div style={{ borderTop: '1px solid var(--border-subtle)', paddingTop: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12, gap: 8 }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-tertiary)', letterSpacing: '0.07em', textTransform: 'uppercase' }}>{title}</div>
        {canEdit && !editing && (
          <button type="button" onClick={onEdit} style={{
            display: 'inline-flex', alignItems: 'center', gap: 5, padding: '5px 10px', borderRadius: 7,
            border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-secondary)',
            fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
          }}><Pencil size={12} /> {l.edit}</button>
        )}
      </div>
      {editing ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {editChildren}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <button type="button" onClick={onCancel} style={{
              display: 'inline-flex', alignItems: 'center', gap: 6, padding: '7px 12px', borderRadius: 7,
              border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-secondary)',
              fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
            }}>{l.cancel}</button>
            <button type="button" onClick={onSave} style={{
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6, padding: '8px 14px', borderRadius: 7,
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

export function Select({ value, onChange, options, placeholder, disabled, searchable }: {
  value: string
  onChange: (v: string) => void
  options: { value: string; label: string }[]
  placeholder?: string
  disabled?: boolean
  /** Show a type-to-filter box in the popover. Defaults on when there are many options. */
  searchable?: boolean
}) {
  const [open, setOpen] = React.useState(false)
  const [activeIndex, setActiveIndex] = React.useState(-1)
  const [query, setQuery] = React.useState('')
  const wrapperRef = React.useRef<HTMLDivElement>(null)
  const listRef = React.useRef<HTMLDivElement>(null)
  const searchRef = React.useRef<HTMLInputElement>(null)

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
        if (opt) handleSelect(opt.value)
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
            top: 'calc(100% + 4px)',
            left: 0,
            right: 0,
            zIndex: 50,
            background: 'var(--bg-card)',
            border: '1px solid var(--border)',
            borderRadius: 8,
            boxShadow: '0 8px 28px rgba(0,0,0,0.35)',
            maxHeight: 280,
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
              placeholder="Buscar…"
              style={{
                position: 'sticky', top: 0, zIndex: 1, width: '100%', boxSizing: 'border-box',
                margin: '0 0 4px', padding: '7px 9px', background: 'var(--bg-elevated)',
                border: '1px solid var(--border)', borderRadius: 6, fontSize: 13,
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
                onClick={() => handleSelect(opt.value)}
                onMouseEnter={() => setActiveIndex(idx)}
                style={{
                  padding: '8px 10px',
                  borderRadius: 6,
                  fontSize: 13,
                  cursor: 'pointer',
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
