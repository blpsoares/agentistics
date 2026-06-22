import { Check } from 'lucide-react'
import type { HarnessId } from '@agentistics/core'
import { HARNESS_INFO, HARNESS_LABELS, HARNESS_COLORS } from '../lib/harness'

interface Props {
  harness: HarnessId
}

/** Inline panel (no overlay) explaining a harness's data: where it comes from,
 *  what is captured, what is not, and any caveats. Rendered inside the harness
 *  page's "Data & sources" tab. */
export function HarnessInfoPanel({ harness }: Props) {
  const info = HARNESS_INFO[harness]
  const label = HARNESS_LABELS[harness]
  const color = HARNESS_COLORS[harness]

  return (
    <div
      style={{
        background: 'var(--bg-surface)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius-lg)',
        maxWidth: 620,
        padding: '20px 22px',
        display: 'flex',
        flexDirection: 'column',
        gap: 18,
      }}
    >
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{
          display: 'inline-block', width: 10, height: 10, borderRadius: '50%',
          background: color, flexShrink: 0,
        }} />
        <span style={{ fontSize: 15, fontWeight: 700, color }}>{label}</span>
        <span style={{ fontSize: 15, fontWeight: 500, color: 'var(--text-secondary)' }}>data</span>
      </div>

      {/* Source */}
      <section>
        <div style={{
          fontSize: 10, fontWeight: 700, color: 'var(--text-tertiary)',
          letterSpacing: '0.07em', textTransform: 'uppercase', marginBottom: 8,
        }}>
          Where the data comes from
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {info.source.map((s, i) => (
            <div key={i} style={{
              fontFamily: 'monospace', fontSize: 11, color: 'var(--text-secondary)',
              background: 'var(--bg-elevated)', border: '1px solid var(--border)',
              borderRadius: 5, padding: '5px 9px', wordBreak: 'break-all',
            }}>
              {s}
            </div>
          ))}
        </div>
      </section>

      {/* Captured */}
      <section>
        <div style={{
          fontSize: 10, fontWeight: 700, color: 'var(--text-tertiary)',
          letterSpacing: '0.07em', textTransform: 'uppercase', marginBottom: 8,
        }}>
          Captured
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
          {info.contains.map((item, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 7 }}>
              <Check size={12} style={{ color: 'var(--accent-green)', marginTop: 1, flexShrink: 0 }} />
              <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{item}</span>
            </div>
          ))}
        </div>
      </section>

      {/* Not available */}
      <section>
        <div style={{
          fontSize: 10, fontWeight: 700, color: 'var(--text-tertiary)',
          letterSpacing: '0.07em', textTransform: 'uppercase', marginBottom: 8,
        }}>
          Not available
        </div>
        {info.missing.length === 0 ? (
          <div style={{ fontSize: 12, color: 'var(--text-secondary)', fontStyle: 'italic' }}>
            Most complete source — everything above is tracked.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {info.missing.map((m, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 7 }}>
                <span style={{
                  display: 'inline-block', width: 4, height: 4, borderRadius: '50%',
                  background: 'var(--text-tertiary)', marginTop: 5, flexShrink: 0,
                }} />
                <span style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>
                  <strong style={{ color: 'var(--text-secondary)', fontWeight: 600 }}>{m.item}</strong>
                  {' — '}
                  {m.why}
                </span>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Note */}
      {info.note && (
        <section style={{
          background: 'var(--bg-elevated)', border: '1px solid var(--border)',
          borderRadius: 7, padding: '10px 12px',
        }}>
          <div style={{
            fontSize: 10, fontWeight: 700, color: 'var(--text-tertiary)',
            letterSpacing: '0.07em', textTransform: 'uppercase', marginBottom: 5,
          }}>
            Note
          </div>
          <p style={{
            fontSize: 11, color: 'var(--text-tertiary)', fontStyle: 'italic',
            lineHeight: 1.5, margin: 0,
          }}>
            {info.note}
          </p>
        </section>
      )}
    </div>
  )
}
