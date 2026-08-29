/**
 * SessionTerminalPanel — the live terminal, as a PANEL inside the sessions tab.
 *
 * It never takes over the page: it is a bordered box above the sessions list, with its own selector
 * of the live sessions, so the list stays visible and switchable underneath. Picking a session
 * streams its terminal; picking another switches cleanly (a fresh `key` per id → a brand-new
 * emulator, so no byte of one session's screen can survive onto the next).
 *
 * Two honesty sources are shown, kept deliberately separate:
 *  - the AGENT's activity (working / needs you) comes from the fleet row's own state, which — per
 *    PR #243 — already needs two concordant samples before it says `waiting`. This panel never
 *    recomputes that from the terminal frames.
 *  - what the SCREEN is (live / finished / gone, how many lines, truncated) comes from the channel's
 *    own frame fields. A finished or gone session is labelled as such, not frozen in silence.
 *
 * Phase 1 is read-only: there is deliberately NO input box, not even a disabled one — the write
 * channel does not exist yet, and a text field that does nothing is the same lie as a frozen screen.
 */

import { Suspense, lazy, useEffect, useState } from 'react'
import { Terminal as TerminalIcon, X } from 'lucide-react'
import type { Lang } from '@agentistics/core'
import type { FleetRow } from '../lib/fleet'
import { watchableFleetRows, terminalStatus, type TerminalTone } from '../lib/terminalStream'
import { useTerminalStream } from '../hooks/useTerminalStream'
import { useIsMobile } from '../hooks/useIsMobile'

const SessionTerminal = lazy(() => import('./SessionTerminal'))

interface Props {
  /** The live fleet — the same rows the sessions list decorates. */
  rows: readonly FleetRow[]
  lang: Lang
  theme: 'dark' | 'light'
}

const TONE_COLOR: Record<TerminalTone, string> = {
  idle: 'var(--text-tertiary)',
  connecting: 'var(--text-tertiary)',
  live: '#22c55e',
  finished: 'var(--anthropic-orange, #e8690b)',
  ended: 'var(--accent-red, #e0342a)',
}

function stateDotColor(state: FleetRow['state']): string {
  if (state === 'working') return '#22c55e'
  if (state === 'waiting' || state === 'waiting-approval') return 'var(--anthropic-orange, #e8690b)'
  if (state === 'exited') return 'var(--text-tertiary)'
  return 'var(--text-tertiary)'
}

export function SessionTerminalPanel({ rows, lang, theme }: Props) {
  const pt = lang === 'pt'
  const isMobile = useIsMobile()
  const watchable = watchableFleetRows(rows)
  const [watchedId, setWatchedId] = useState<string | null>(null)

  // If the watched session leaves the fleet AND we have not opened its stream yet, forget it. Once a
  // stream is open we keep showing it (it will report `gone` honestly) even after it leaves the list.
  const stillListed = watchable.some(r => r.id === watchedId)

  const state = useTerminalStream(watchedId)
  const status = terminalStatus(state, pt ? 'pt' : 'en')

  // Nothing to offer and nothing being watched → render nothing; the page already explains why the
  // fleet may be empty. (Keep showing if a stream is live, even after its row leaves the list.)
  const hasStream = watchedId !== null && state.phase !== 'idle'
  if (watchable.length === 0 && !hasStream) return null

  const watchedRow = rows.find(r => r.id === watchedId)

  return (
    <div
      style={{
        border: '1px solid var(--border-subtle)',
        borderRadius: 12,
        background: 'var(--bg-elevated)',
        padding: isMobile ? 12 : 16,
        marginBottom: 12,
      }}
    >
      {/* Header: title + the SCREEN honesty pill + close */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 10 }}>
        <span style={{ color: 'var(--anthropic-orange)', display: 'inline-flex' }}>
          <TerminalIcon size={16} />
        </span>
        <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)' }}>
          {pt ? 'Terminal ao vivo' : 'Live terminal'}
        </span>
        {hasStream && (
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              fontSize: 11,
              fontWeight: 600,
              color: TONE_COLOR[status.tone],
              border: `1px solid ${TONE_COLOR[status.tone]}`,
              borderRadius: 999,
              padding: '2px 8px',
            }}
          >
            <span
              style={{
                width: 7,
                height: 7,
                borderRadius: '50%',
                background: TONE_COLOR[status.tone],
                // Pulse only while genuinely live; a still dot on a finished/gone screen would imply life.
                animation: status.tone === 'live' ? 'ag-term-pulse 1.6s ease-in-out infinite' : undefined,
              }}
            />
            {status.label}
          </span>
        )}
        {hasStream && (
          <button
            onClick={() => setWatchedId(null)}
            title={pt ? 'Parar de assistir' : 'Stop watching'}
            aria-label={pt ? 'Parar de assistir' : 'Stop watching'}
            style={{
              marginLeft: 'auto',
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
              background: 'transparent',
              border: '1px solid var(--border-subtle)',
              borderRadius: 8,
              color: 'var(--text-secondary)',
              cursor: 'pointer',
              padding: isMobile ? '8px 10px' : '4px 8px',
              minHeight: isMobile ? 44 : undefined,
              fontFamily: 'inherit',
              fontSize: 12,
            }}
          >
            <X size={13} />
            {!isMobile && <span>{pt ? 'Fechar' : 'Close'}</span>}
          </button>
        )}
      </div>

      {/* Selector — pick which live session to watch. The list below stays untouched. */}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: hasStream ? 10 : 0 }}>
        {watchable.map(r => {
          const active = r.id === watchedId
          return (
            <button
              key={r.id}
              onClick={() => setWatchedId(active ? null : r.id)}
              title={`${r.title} — ${r.stateLabel}`}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 7,
                maxWidth: 260,
                padding: isMobile ? '8px 12px' : '6px 10px',
                minHeight: isMobile ? 44 : undefined,
                borderRadius: 8,
                border: `1px solid ${active ? 'var(--anthropic-orange)' : 'var(--border-subtle)'}`,
                background: active ? 'rgba(232,105,11,0.10)' : 'transparent',
                color: active ? 'var(--text-primary)' : 'var(--text-secondary)',
                cursor: 'pointer',
                fontFamily: 'inherit',
                fontSize: 12,
                fontWeight: active ? 600 : 500,
              }}
            >
              <span
                style={{ width: 8, height: 8, borderRadius: '50%', background: stateDotColor(r.state), flexShrink: 0 }}
              />
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.title}</span>
            </button>
          )
        })}
      </div>

      {hasStream && (
        <>
          {/* The AGENT's activity — read from the fleet's own (two-sample-verified) state, never
              recomputed from the frames. Absent once the row has left the fleet. */}
          {watchedRow && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 12, color: 'var(--text-secondary)', marginBottom: 8 }}>
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: stateDotColor(watchedRow.state), flexShrink: 0 }} />
              <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{watchedRow.title}</span>
              <span style={{ color: 'var(--text-tertiary)' }}>·</span>
              <span>{watchedRow.stateLabel}</span>
              {watchedRow.project && (
                <>
                  <span style={{ color: 'var(--text-tertiary)' }}>·</span>
                  <span style={{ color: 'var(--text-tertiary)' }}>{watchedRow.project}</span>
                </>
              )}
            </div>
          )}

          <div
            style={{
              height: isMobile ? 300 : 380,
              borderRadius: 8,
              overflow: 'hidden',
              border: '1px solid var(--border-subtle)',
              background: theme === 'light' ? '#ffffff' : '#0e1116',
            }}
          >
            <Suspense
              fallback={
                <div style={{ padding: 16, fontSize: 12, color: 'var(--text-tertiary)', fontFamily: 'monospace' }}>
                  {pt ? 'Carregando o emulador…' : 'Loading the emulator…'}
                </div>
              }
            >
              {/* key={watchedId}: a new session gets a brand-new emulator, so no content leaks across. */}
              <SessionTerminal key={watchedId ?? 'none'} frame={state.frame} theme={theme} showCursor={status.showCursor} />
            </Suspense>
          </div>

          {/* The SCREEN honesty line — what you are actually looking at, in words. */}
          <div style={{ fontSize: 11, color: 'var(--text-tertiary)', lineHeight: 1.5, marginTop: 8 }}>
            {status.detail}
          </div>
        </>
      )}

      <style>{`@keyframes ag-term-pulse { 0%,100% { opacity: 1 } 50% { opacity: 0.35 } }`}</style>
    </div>
  )
}
