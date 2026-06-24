import { Check } from 'lucide-react'
import type { HarnessId } from '@agentistics/core'
import { HARNESS_INFO, HARNESS_LABELS, HARNESS_COLORS } from '../lib/harness'
import { useChatHarnesses } from '../hooks/useChatHarnesses'

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
  const { harnesses: chatHarnesses, loading: chatLoading } = useChatHarnesses()
  const chatStatus = chatHarnesses.find(h => h.id === harness)

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

      {/* Nay backend status */}
      {!chatLoading && chatStatus && (
        <section style={{
          background: 'var(--bg-elevated)', border: '1px solid var(--border)',
          borderRadius: 7, padding: '10px 12px',
        }}>
          <div style={{
            fontSize: 10, fontWeight: 700, color: 'var(--text-tertiary)',
            letterSpacing: '0.07em', textTransform: 'uppercase', marginBottom: 8,
          }}>
            Nay backend
          </div>

          {chatStatus.ready ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <Check size={12} style={{ color: 'var(--accent-green)', flexShrink: 0 }} />
              <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                Ready as a Nay backend
              </span>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {/* Status badges */}
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                <span style={{
                  fontSize: 10, fontWeight: 600,
                  color: chatStatus.installed ? 'var(--accent-green)' : 'var(--text-tertiary)',
                  background: chatStatus.installed ? 'color-mix(in srgb, var(--accent-green) 12%, transparent)' : 'var(--bg-surface)',
                  border: `1px solid ${chatStatus.installed ? 'color-mix(in srgb, var(--accent-green) 30%, transparent)' : 'var(--border)'}`,
                  borderRadius: 4, padding: '2px 7px',
                }}>
                  {chatStatus.installed ? 'installed' : 'not installed'}
                </span>
                <span style={{
                  fontSize: 10, fontWeight: 600,
                  color: chatStatus.authReady ? 'var(--accent-green)' : 'var(--text-tertiary)',
                  background: chatStatus.authReady ? 'color-mix(in srgb, var(--accent-green) 12%, transparent)' : 'var(--bg-surface)',
                  border: `1px solid ${chatStatus.authReady ? 'color-mix(in srgb, var(--accent-green) 30%, transparent)' : 'var(--border)'}`,
                  borderRadius: 4, padding: '2px 7px',
                }}>
                  {chatStatus.authReady ? 'authenticated' : 'not authenticated'}
                </span>
              </div>

              {/* Setup guidance */}
              {chatStatus.setup.installCmd && !chatStatus.installed && (
                <div>
                  <div style={{ fontSize: 10, color: 'var(--text-tertiary)', marginBottom: 3 }}>Install</div>
                  <div style={{
                    fontFamily: 'monospace', fontSize: 11, color: 'var(--text-secondary)',
                    background: 'var(--bg-surface)', border: '1px solid var(--border)',
                    borderRadius: 5, padding: '4px 8px',
                  }}>
                    {chatStatus.setup.installCmd}
                  </div>
                </div>
              )}

              {chatStatus.setup.loginCmd && chatStatus.installed && !chatStatus.authReady && (
                <div>
                  <div style={{ fontSize: 10, color: 'var(--text-tertiary)', marginBottom: 3 }}>Login</div>
                  <div style={{
                    fontFamily: 'monospace', fontSize: 11, color: 'var(--text-secondary)',
                    background: 'var(--bg-surface)', border: '1px solid var(--border)',
                    borderRadius: 5, padding: '4px 8px',
                  }}>
                    {chatStatus.setup.loginCmd}
                  </div>
                </div>
              )}

              {chatStatus.setup.note && (
                <p style={{
                  fontSize: 11, color: 'var(--text-tertiary)', fontStyle: 'italic',
                  lineHeight: 1.5, margin: 0,
                }}>
                  {chatStatus.setup.note}
                </p>
              )}

              {chatStatus.setup.docUrl && (
                <a
                  href={chatStatus.setup.docUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{
                    fontSize: 11, color: 'var(--accent-blue)',
                    textDecoration: 'none',
                    display: 'inline-block',
                  }}
                >
                  Setup guide &rarr;
                </a>
              )}
            </div>
          )}
        </section>
      )}
    </div>
  )
}
