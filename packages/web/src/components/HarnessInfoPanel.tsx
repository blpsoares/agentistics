import { Check } from 'lucide-react'
import type { HarnessId, HarnessCapabilities } from '@agentistics/core'
import { HARNESS_INFO, HARNESS_LABELS, HARNESS_COLORS, capable } from '../lib/harness'
import { useChatHarnesses } from '../hooks/useChatHarnesses'

/** Polished mono font stack — used only for paths and shell commands. */
const MONO = `ui-monospace, 'SF Mono', 'JetBrains Mono', Menlo, Consolas, monospace`

const CAPABILITY_ROWS: { label: string; key: keyof HarnessCapabilities }[] = [
  { label: 'Tokens',           key: 'tokens'   },
  { label: 'Cost',             key: 'cost'      },
  { label: 'Model',            key: 'model'     },
  { label: 'Tool usage',       key: 'tools'     },
  { label: 'Sub-agent metrics',key: 'agents'    },
  { label: 'Git line counts',  key: 'gitLines'  },
]

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      fontSize: 10, fontWeight: 700, color: 'var(--text-tertiary)',
      letterSpacing: '0.07em', textTransform: 'uppercase', marginBottom: 8,
    }}>
      {children}
    </div>
  )
}

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
    <div style={{
      background: 'var(--bg-surface)',
      border: '1px solid var(--border)',
      borderRadius: 'var(--radius-lg)',
      padding: '20px 22px',
      display: 'flex',
      flexDirection: 'column',
      gap: 20,
    }}>

      {/* ── Header ─────────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{
            display: 'inline-block', width: 10, height: 10, borderRadius: '50%',
            background: color, flexShrink: 0,
          }} />
          <span style={{ fontSize: 15, fontWeight: 700, color }}>{label}</span>
          <span style={{ fontSize: 15, fontWeight: 500, color: 'var(--text-secondary)' }}>data</span>
        </div>
        {info.blurb && (
          <p style={{ margin: 0, fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.55, paddingLeft: 18 }}>
            {info.blurb}
          </p>
        )}
      </div>

      {/* ── Two-column body ─────────────────────────────────────────────── */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
        gap: 20,
        alignItems: 'start',
      }}>

        {/* Left column: data sources + on-disk format + retention */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

          {/* Source */}
          <section>
            <SectionLabel>Where the data comes from</SectionLabel>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {info.source.map((s, i) => (
                <div key={i} style={{
                  fontFamily: MONO, fontSize: 11, color: 'var(--text-secondary)',
                  background: 'var(--bg-elevated)', border: '1px solid var(--border)',
                  borderRadius: 5, padding: '5px 9px', wordBreak: 'break-all',
                }}>
                  {s}
                </div>
              ))}
            </div>
          </section>

          {/* On-disk format */}
          {info.format && (
            <section>
              <SectionLabel>On-disk format</SectionLabel>
              <p style={{ margin: 0, fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.55 }}>
                {info.format}
              </p>
            </section>
          )}

          {/* Retention */}
          {info.retention && (
            <section>
              <SectionLabel>Retention</SectionLabel>
              <p style={{ margin: 0, fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.55 }}>
                {info.retention}
              </p>
            </section>
          )}
        </div>

        {/* Right column: capability matrix + captured + missing + note */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

          {/* Capability matrix */}
          <section>
            <SectionLabel>Capabilities</SectionLabel>
            <div style={{
              display: 'grid', gridTemplateColumns: '1fr auto',
              rowGap: 5, columnGap: 12,
              alignItems: 'center',
            }}>
              {CAPABILITY_ROWS.map(({ label: capLabel, key }) => {
                const yes = capable(harness, key)
                return [
                  <span key={`${key}-label`} style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                    {capLabel}
                  </span>,
                  yes
                    ? <span key={`${key}-val`} style={{ display: 'flex', alignItems: 'center', gap: 4, justifyContent: 'flex-end' }}>
                        <Check size={11} style={{ color: 'var(--accent-green)' }} />
                        <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--accent-green)' }}>Available</span>
                      </span>
                    : <span key={`${key}-val`} style={{
                        fontSize: 11, fontWeight: 600, color: 'var(--text-tertiary)',
                        textAlign: 'right',
                      }}>N/A</span>,
                ]
              })}
            </div>
          </section>

          {/* Captured */}
          <section>
            <SectionLabel>Captured</SectionLabel>
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
            <SectionLabel>Not available</SectionLabel>
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
              <SectionLabel>Note</SectionLabel>
              <p style={{
                fontSize: 11, color: 'var(--text-tertiary)', fontStyle: 'italic',
                lineHeight: 1.5, margin: 0,
              }}>
                {info.note}
              </p>
            </section>
          )}
        </div>
      </div>

      {/* ── Nay backend status (full-width) ────────────────────────────── */}
      {!chatLoading && chatStatus && (
        <section style={{
          background: 'var(--bg-elevated)', border: '1px solid var(--border)',
          borderRadius: 7, padding: '10px 12px',
        }}>
          <SectionLabel>Nay backend</SectionLabel>

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
                    fontFamily: MONO, fontSize: 11, color: 'var(--text-secondary)',
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
                    fontFamily: MONO, fontSize: 11, color: 'var(--text-secondary)',
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
