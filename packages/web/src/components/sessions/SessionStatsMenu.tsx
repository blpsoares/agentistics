/**
 * SessionStatsMenu — what THIS conversation has spent, in a dropdown beside the session's controls.
 *
 * The dashboard has a strip of figures for the whole machine; this is the same question asked of
 * the session you have open. Asked for directly, and the first line of it is the one that decides
 * when to start a new conversation: how full the context window is.
 *
 * Every rule about what the numbers MEAN lives in `sessionStats.ts`. This file draws them, and its
 * only judgement is how to say "not available" — twice, differently:
 *
 *   `harness`    this assistant cannot produce it at all (`HARNESS_CAPABILITIES`)
 *   `unrecorded` the conversation is not in the local store yet
 *
 * They send a reader to two different places, so they are two sentences and never one dash.
 */

import { useEffect, useRef, useState } from 'react'
import { BarChart3, X } from 'lucide-react'
import { fmt, fmtCost, type HarnessId, type SessionMeta } from '@agentistics/core'
import { HARNESS_LABELS } from '../../lib/harness'
import { sessionStats, statReason } from '../../lib/sessionStats'

export interface SessionStatsMenuProps {
  harness: string
  sessionId: string
  /** The store's record for this conversation, or `undefined` when it has none yet. */
  meta: SessionMeta | undefined
  lang: 'pt' | 'en'
  currency: 'USD' | 'BRL'
  brlRate: number
}

export function SessionStatsMenu({
  harness, sessionId, meta, lang, currency, brlRate,
}: SessionStatsMenuProps) {
  const pt = lang === 'pt'
  const [open, setOpen] = useState(false)
  const boxRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!open) return
    const away = (e: MouseEvent) => {
      if (!boxRef.current?.contains(e.target as Node)) setOpen(false)
    }
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', away)
    document.addEventListener('keydown', esc)
    return () => {
      document.removeEventListener('mousedown', away)
      document.removeEventListener('keydown', esc)
    }
  }, [open])

  const h = harness as HarnessId
  const s = sessionStats(h, sessionId, meta)
  const money = (usd: number) => fmtCost(usd, currency, brlRate)
  const label = (HARNESS_LABELS as Record<string, string>)[harness] ?? harness

  /** The sentence for an absent figure — see the header. */
  const na = (metric: Parameters<typeof statReason>[1]) =>
    statReason(h, metric) === 'harness'
      ? (pt ? `${label} não reporta isso` : `${label} does not report this`)
      : (pt ? 'ainda não registrado' : 'not recorded yet')

  return (
    <div ref={boxRef} style={{ position: 'relative', flexShrink: 0 }}>
      <button
        onClick={() => setOpen(v => !v)}
        aria-expanded={open}
        aria-label={pt ? 'Métricas desta sessão' : 'This session’s metrics'}
        title={pt ? 'Métricas desta sessão' : 'This session’s metrics'}
        style={{
          display: 'flex', alignItems: 'center', gap: 6, height: 30, padding: '0 10px',
          borderRadius: 9, cursor: 'pointer', flexShrink: 0,
          border: '1px solid ' + (open ? 'var(--anthropic-orange)' : 'var(--border-subtle)'),
          background: open ? 'var(--anthropic-orange-dim)' : 'var(--bg-elevated)',
          color: open ? 'var(--anthropic-orange)' : 'var(--text-secondary)',
          fontFamily: 'inherit', fontSize: 12,
        }}
      >
        <BarChart3 size={14} />
        {/* The context percentage rides the BUTTON, because it is the one figure that changes what
            you do next — a conversation near its window is one to finish rather than extend. It is
            absent, not zero, when it cannot be known. */}
        {s.context && <span style={{ fontWeight: 650 }}>{Math.floor(s.context.fraction * 100)}%</span>}
      </button>

      {open && (
        <div style={{
          position: 'absolute', top: 36, right: 0, zIndex: 60,
          width: 300, padding: 12, borderRadius: 12,
          background: 'var(--bg-elevated)', border: '1px solid var(--border)',
          boxShadow: '0 12px 32px rgba(0,0,0,0.4)',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', marginBottom: 10 }}>
            <span style={{
              fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em',
              color: 'var(--text-tertiary)',
            }}>{pt ? 'Esta sessão' : 'This session'}</span>
            <button
              onClick={() => setOpen(false)}
              aria-label={pt ? 'Fechar' : 'Close'}
              style={{
                marginLeft: 'auto', display: 'flex', width: 22, height: 22, borderRadius: 6,
                alignItems: 'center', justifyContent: 'center', border: 'none',
                background: 'transparent', color: 'var(--text-tertiary)', cursor: 'pointer',
              }}
            ><X size={13} /></button>
          </div>

          {/* CONTEXT — a bar, and the bar SATURATES while the label keeps counting. A session can
              genuinely exceed the documented window, and a clamped label would hide exactly that. */}
          <Block title={pt ? 'Contexto' : 'Context'}>
            {s.context ? (
              <>
                <div style={{
                  height: 6, borderRadius: 3, background: 'var(--bg-base)', overflow: 'hidden',
                  marginBottom: 5,
                }}>
                  <div style={{
                    height: '100%', width: `${Math.min(100, s.context.fraction * 100)}%`,
                    background: s.context.fraction >= 0.85 ? 'var(--accent-red)' : 'var(--anthropic-orange)',
                    transition: 'width 0.3s',
                  }} />
                </div>
                <Line
                  k={`${Math.floor(s.context.fraction * 100)}%`}
                  v={`${fmt(s.context.used)} / ${fmt(s.context.window)}`}
                />
              </>
            ) : <Absent text={na('contextWindow')} />}
          </Block>

          <Block title="Tokens">
            {s.tokens && s.conversation ? (
              <>
                <Line k={pt ? 'Total (com cache)' : 'Total (with cache)'}
                  v={fmt(s.tokens.input + s.tokens.output + s.tokens.cacheRead + s.tokens.cacheWrite)} />
                <Line k={pt ? 'Sem cache (i/o)' : 'Without cache (i/o)'}
                  v={`${fmt(s.conversation.input)} / ${fmt(s.conversation.output)}`} />
                <Line k={pt ? 'Cache lido / escrito' : 'Cache read / write'}
                  v={`${fmt(s.tokens.cacheRead)} / ${fmt(s.tokens.cacheWrite)}`} />
              </>
            ) : <Absent text={na('tokens')} />}
          </Block>

          <Block title={pt ? 'Custo' : 'Cost'}>
            {s.costUSD === null
              ? <Absent text={na('cost')} />
              : <Line k={pt ? 'Estimado (API)' : 'Estimated (API)'} v={money(s.costUSD)} />}
          </Block>

          <Block title={pt ? 'Mensagens' : 'Messages'}>
            {s.messages ? (
              <Line k={pt ? 'Suas / do agente' : 'Yours / the agent’s'}
                v={`${fmt(s.messages.user)} / ${fmt(s.messages.assistant)}`} />
            ) : <Absent text={pt ? 'ainda não registrado' : 'not recorded yet'} />}
          </Block>

          <Block title="Subagents">
            {s.subagents ? (
              s.subagents.count === 0
                ? <Line k={pt ? 'Nenhum rodou' : 'None ran'} v="—" />
                : (
                  <>
                    <Line k={pt ? 'Rodaram' : 'Ran'} v={fmt(s.subagents.count)} />
                    <Line k="Tokens" v={fmt(s.subagents.tokens)} />
                    <Line k={pt ? 'Custo' : 'Cost'} v={money(s.subagents.costUSD)} />
                  </>
                )
            ) : <Absent text={na('agents')} />}
          </Block>

          <Block title={pt ? 'No repositório' : 'In the repository'} last>
            {s.git ? (
              <>
                <Line k="Commits" v={fmt(s.git.commits)} />
                <Line k={pt ? 'Linhas' : 'Lines'} v={`+${fmt(s.git.added)} / −${fmt(s.git.removed)}`} />
                <Line k={pt ? 'Arquivos' : 'Files'} v={fmt(s.git.files)} />
              </>
            ) : <Absent text={na('gitLines')} />}
          </Block>
        </div>
      )}
    </div>
  )
}

function Block({ title, children, last }: { title: string; children: React.ReactNode; last?: boolean }) {
  return (
    <div style={{
      paddingBottom: last ? 0 : 8, marginBottom: last ? 0 : 8,
      borderBottom: last ? 'none' : '1px solid var(--border-subtle)',
    }}>
      <p style={{
        margin: '0 0 5px', fontSize: 10, fontWeight: 700, textTransform: 'uppercase',
        letterSpacing: '0.05em', color: 'var(--text-tertiary)',
      }}>{title}</p>
      {children}
    </div>
  )
}

function Line({ k, v }: { k: string; v: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, fontSize: 11.5, lineHeight: 1.7 }}>
      <span style={{ color: 'var(--text-tertiary)', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{k}</span>
      <span style={{ marginLeft: 'auto', color: 'var(--text-primary)', fontWeight: 600, whiteSpace: 'nowrap' }}>{v}</span>
    </div>
  )
}

/** N/A with its REASON. Never a dash on its own — that is the confident zero in another costume. */
function Absent({ text }: { text: string }) {
  return <p style={{ margin: 0, fontSize: 11, lineHeight: 1.5, color: 'var(--text-tertiary)' }}>{text}</p>
}
