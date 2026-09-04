/**
 * AccessibilitySettings.tsx — the magnifiers' own screen.
 *
 * The master switch is first because it is the only control that makes the others matter, and off
 * means the feature costs nothing at all. The cursor-following lens is configured ONLY here: it
 * has no on-screen controls, by request.
 */
import React, { useMemo } from 'react'
import { useNavigate, useOutletContext } from 'react-router-dom'
import type { LensStyle } from '@agentistics/core'
import { BORDER_MAX_PX, BORDER_MIN_PX, CORNER_MAX_PX, LENS_MIN_PX, ZOOM_MAX, ZOOM_MIN } from '@agentistics/core'
import type { AppContext } from '../../lib/app-context'
import { useIsMobile } from '../../hooks/useIsMobile'
import { a11yText, type A11yText } from '../../components/a11y/i18n'

function StyleEditor({
  style, onChange, text, isMobile,
}: { style: LensStyle; onChange(next: LensStyle): void; text: A11yText; isMobile: boolean }) {
  const row: React.CSSProperties = {
    display: 'flex', alignItems: 'center', gap: 12,
    padding: isMobile ? '10px 0' : '7px 0', fontSize: 13, color: 'var(--text-secondary)',
  }
  const label: React.CSSProperties = { minWidth: isMobile ? 110 : 150, flexShrink: 0 }
  const value: React.CSSProperties = {
    minWidth: 58, textAlign: 'right', color: 'var(--text-primary)',
    fontWeight: 600, fontVariantNumeric: 'tabular-nums',
  }
  const chip = (on: boolean): React.CSSProperties => ({
    padding: isMobile ? '11px 14px' : '6px 12px', minHeight: isMobile ? 44 : undefined,
    borderRadius: 8, fontSize: 13, cursor: 'pointer', fontFamily: 'inherit',
    border: '1px solid ' + (on ? 'var(--anthropic-orange)' : 'var(--border)'),
    background: on ? 'var(--anthropic-orange-dim)' : 'transparent',
    color: 'var(--text-primary)',
  })

  return (
    <div>
      <div style={row}>
        <span style={label}>{text.shape}</span>
        <span style={{ display: 'flex', gap: 8 }}>
          {(['rect', 'circle'] as const).map(s => (
            <button key={s} style={chip(style.shape === s)}
              onClick={() => onChange({ ...style, shape: s, height: s === 'circle' ? style.width : style.height })}>
              {s === 'rect' ? text.rect : text.circle}
            </button>
          ))}
        </span>
      </div>

      <div style={row}>
        <span style={label}>{style.shape === 'circle' ? text.diameter : text.width}</span>
        <input type="range" min={LENS_MIN_PX} max={1200} step={10} value={style.width} style={{ flex: 1 }}
          onChange={e => {
            const w = Number(e.target.value)
            onChange({ ...style, width: w, height: style.shape === 'circle' ? w : style.height })
          }} />
        <span style={value}>{style.width}px</span>
      </div>

      {style.shape === 'rect' && (
        <div style={row}>
          <span style={label}>{text.height}</span>
          <input type="range" min={LENS_MIN_PX} max={1200} step={10} value={style.height} style={{ flex: 1 }}
            onChange={e => onChange({ ...style, height: Number(e.target.value) })} />
          <span style={value}>{style.height}px</span>
        </div>
      )}

      <div style={row}>
        <span style={label}>{text.zoom}</span>
        <input type="range" min={ZOOM_MIN} max={ZOOM_MAX} step={0.5} value={style.zoom} style={{ flex: 1 }}
          onChange={e => onChange({ ...style, zoom: Number(e.target.value) })} />
        <span style={value}>{style.zoom}×</span>
      </div>

      <div style={row}>
        <span style={label}>{text.borderWidth}</span>
        <input type="range" min={BORDER_MIN_PX} max={BORDER_MAX_PX} step={1} value={style.borderWidth} style={{ flex: 1 }}
          onChange={e => onChange({ ...style, borderWidth: Number(e.target.value) })} />
        <span style={value}>{style.borderWidth}px</span>
      </div>

      {style.shape === 'rect' && (
        <div style={row}>
          <span style={label}>{text.cornerRadius}</span>
          <input type="range" min={0} max={CORNER_MAX_PX} step={2} value={style.cornerRadius} style={{ flex: 1 }}
            onChange={e => onChange({ ...style, cornerRadius: Number(e.target.value) })} />
          <span style={value}>{style.cornerRadius}px</span>
        </div>
      )}

      {/* The preview uses the same border rule the real lens uses, so what is configured is what
          will appear. It shows the FRAME, not a live mirror: a mirror here would magnify the
          settings page and say nothing about the setting. */}
      <div style={{
        marginTop: 10, display: 'flex', justifyContent: 'center',
        padding: 12, background: 'var(--bg-base)', borderRadius: 10,
      }}>
        <div style={{
          width: Math.min(style.width, 220),
          height: style.shape === 'circle' ? Math.min(style.width, 220) : Math.min(style.height, 160),
          border: `${style.borderWidth}px solid var(--anthropic-orange)`,
          borderRadius: style.shape === 'circle' ? '50%' : Math.min(style.cornerRadius, 40),
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: 'var(--text-tertiary)', fontSize: 12, boxSizing: 'border-box',
        }}>{style.zoom}×</div>
      </div>
    </div>
  )
}

export default function AccessibilitySettings() {
  const ctx = useOutletContext<AppContext>()
  const { a11y, lang } = ctx
  const isMobile = useIsMobile()
  const navigate = useNavigate()
  const text = useMemo(() => a11yText(lang), [lang])

  const card: React.CSSProperties = {
    background: 'var(--bg-surface)', border: '1px solid var(--border)',
    borderRadius: 12, padding: isMobile ? 14 : 18, marginBottom: 16,
  }
  const h: React.CSSProperties = { fontSize: 14, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 10 }
  const note: React.CSSProperties = { fontSize: 12, color: 'var(--text-tertiary)', lineHeight: 1.5 }
  const smallBtn: React.CSSProperties = {
    padding: isMobile ? '10px 12px' : '5px 10px', minHeight: isMobile ? 44 : undefined,
    borderRadius: 7, border: '1px solid var(--border)', background: 'transparent',
    fontFamily: 'inherit', fontSize: 12, cursor: 'pointer',
  }

  const pages = Object.entries(a11y.prefs.lensesByPage)

  return (
    <div style={{ maxWidth: 760 }}>
      <div style={card}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
          <div>
            <div style={h}>{text.enable}</div>
            <div style={note}>{text.enableHelp}</div>
          </div>
          <button
            role="switch"
            aria-checked={a11y.prefs.enabled}
            aria-label={text.enable}
            onClick={() => a11y.setEnabled(!a11y.prefs.enabled)}
            style={{
              width: 52, minWidth: 52, height: isMobile ? 44 : 30, borderRadius: 999,
              cursor: 'pointer', border: '1px solid var(--border)', position: 'relative', flexShrink: 0,
              background: a11y.prefs.enabled ? 'var(--anthropic-orange)' : 'var(--bg-elevated)',
            }}
          >
            <span style={{
              position: 'absolute', top: '50%', transform: 'translateY(-50%)',
              left: a11y.prefs.enabled ? 26 : 4, width: 20, height: 20, borderRadius: '50%',
              background: '#fff', transition: 'left 0.15s',
            }} />
          </button>
        </div>
        <div style={{ ...note, marginTop: 12 }}>{text.borderIsOrange}</div>
      </div>

      <div style={card}>
        <div style={h}>{text.followLens} — Ctrl+Shift+Z</div>
        <StyleEditor style={a11y.prefs.followLens} onChange={a11y.setFollowStyle} text={text} isMobile={isMobile} />
      </div>

      <div style={card}>
        <div style={h}>{text.newLensDefaults}</div>
        <StyleEditor style={a11y.prefs.newLensDefaults} onChange={a11y.setNewLensDefaults} text={text} isMobile={isMobile} />
      </div>

      <div style={card}>
        <div style={h}>{text.savedLenses}</div>
        {pages.length === 0 && <div style={note}>{text.noLensesHere}</div>}
        {pages.length > 0 && (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ color: 'var(--text-tertiary)', textAlign: 'left' }}>
                  <th style={{ padding: '6px 8px', fontWeight: 600 }}>{text.page}</th>
                  <th style={{ padding: '6px 8px', fontWeight: 600 }}>{text.count}</th>
                  <th style={{ padding: '6px 8px', fontWeight: 600 }}>{text.zoom}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {pages.map(([page, lenses]) => (
                  <tr key={page} style={{ borderTop: '1px solid var(--border)' }}>
                    <td style={{ padding: 8, color: 'var(--text-primary)', fontFamily: 'ui-monospace, monospace' }}>{page}</td>
                    <td style={{ padding: 8 }}>{lenses.length}</td>
                    <td style={{ padding: 8 }}>{lenses.map(l => `${l.zoom}×`).join(' · ')}</td>
                    <td style={{ padding: 8, textAlign: 'right', whiteSpace: 'nowrap' }}>
                      <button style={{ ...smallBtn, color: 'var(--text-secondary)' }} onClick={() => navigate(page)}>
                        {text.goToPage}
                      </button>
                      <button style={{ ...smallBtn, marginLeft: 6, color: 'var(--accent-red)' }}
                        onClick={() => a11y.removePage(page)}>
                        {text.remove}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div style={card}>
        <div style={h}>{text.keyboardTitle}</div>
        <ul style={{ ...note, margin: 0, paddingLeft: 18 }}>
          {text.keyboardHelp.map(line => <li key={line} style={{ marginBottom: 3 }}>{line}</li>)}
        </ul>
      </div>

      <div style={card}>
        <div style={h}>{text.performance}</div>
        <div style={note}>{text.canvasCaveat}</div>
        <div style={{ ...note, marginTop: 8 }}>{text.schedulerNote}</div>
      </div>
    </div>
  )
}
