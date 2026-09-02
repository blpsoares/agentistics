/**
 * SessionChat — one live session, read as a conversation.
 *
 * TWO SOURCES, each used for what it is good at, because neither can do the whole job:
 *
 * - The TRANSCRIPT (`/api/fleet/chat`) is the truth — role-tagged, complete, exactly what the
 *   assistant wrote. It arrives per TURN, because Claude writes a message to its JSONL once the
 *   message is finished. It can never stream token by token.
 * - The FRAME (`/api/fleet/stream`, captured twice a second) is live — it is the terminal, and the
 *   text appears on it as it is produced. But it is a rendered TUI, wrapped to the pane width with
 *   a status strip and an input box in it.
 *
 * So completed turns are bubbles from the transcript, and the turn IN FLIGHT is drawn from the
 * frame and replaced by the transcript's version the moment it lands. The live bubble is marked as
 * provisional on screen and never becomes history: a misread frame is corrected within seconds,
 * while a misread turn kept as history would be wrong forever.
 *
 * WHERE IT CANNOT EXIST IT SAYS SO. The link from a live session to its transcript is exact only
 * for Claude Code, which names our tmux session in its own record. Everywhere else the server
 * refuses in words rather than showing some other conversation from the same directory under this
 * session's name — a confident wrong answer the reader has no way to detect.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Loader, Send } from 'lucide-react'
import type { ControlSession } from '@agentistics/tui/control/session-fleet'
import type { FleetActionId } from '../../lib/fleet'
import { useTerminalStream } from '../../hooks/useTerminalStream'
import { liveTurnText } from '../../lib/liveTurn'

export interface ChatTurn {
  role: 'user' | 'assistant'
  text: string
  pending?: boolean
}

interface ChatPayload {
  turns: ChatTurn[]
  unavailable?: string
  live: boolean
}

export interface SessionChatProps {
  session: ControlSession
  lang: 'pt' | 'en'
  act: (req: { id: string; action: FleetActionId; text?: string; choice?: number })
    => Promise<{ ok: boolean; message: string }>
}

/** Matches the fleet poll. The transcript only changes when a turn lands, so faster buys nothing. */
const CHAT_POLL_MS = 3000

export function SessionChat({ session, lang, act }: SessionChatProps) {
  const pt = lang === 'pt'
  const [payload, setPayload] = useState<ChatPayload | null>(null)
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let alive = true
    const poll = async () => {
      try {
        const res = await fetch(`/api/fleet/chat?id=${encodeURIComponent(session.id)}&lang=${lang}`)
        if (!res.ok || !alive) return
        setPayload(await res.json() as ChatPayload)
      } catch { /* transient — keep the last conversation rather than blanking it */ }
    }
    void poll()
    const t = setInterval(poll, CHAT_POLL_MS)
    return () => { alive = false; clearInterval(t) }
  }, [session.id, lang])

  const working = session.state === 'working'
  const { state: term } = useTerminalStream(working ? session.id : null)

  const turns = payload?.turns ?? []
  const lastAssistant = [...turns].reverse().find(t => t.role === 'assistant' && !t.pending)

  const live = useMemo(() => {
    if (!term.frame) return null
    return liveTurnText({
      // The frame carries the emulator's escape sequences; the chat wants the words.
      lines: stripAnsi(term.frame.content).split('\n'),
      ...(lastAssistant ? { lastCommitted: lastAssistant.text } : {}),
      working,
    })
  }, [term.frame, lastAssistant, working])

  // Follow the tail, but only when the reader is already AT it: yanking the view back down while
  // somebody is reading earlier in the conversation is the worst thing a live view can do.
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 120
    if (atBottom) el.scrollTop = el.scrollHeight
  }, [turns.length, live])

  const blocked = (session.approvalLines?.length ?? 0) > 0
  const canPrompt = session.actionable && !blocked && payload?.live !== false

  async function send() {
    const text = draft.trim()
    if (text === '' || sending) return
    setSending(true)
    const out = await act({ id: session.id, action: 'prompt', text })
    setSending(false)
    if (out.ok) setDraft('')
    setNotice(out.message)
  }

  if (payload?.unavailable) {
    return (
      <Centered>
        <p style={{ margin: 0, fontSize: 13, lineHeight: 1.6, color: 'var(--text-tertiary)' }}>
          {payload.unavailable}
        </p>
        <p style={{ margin: '10px 0 0', fontSize: 12, lineHeight: 1.6, color: 'var(--text-tertiary)', opacity: 0.8 }}>
          {pt
            ? 'A visão de terminal continua disponível para esta sessão.'
            : 'The terminal view is still available for this session.'}
        </p>
      </Centered>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      <div ref={scrollRef} style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '20px 20px 8px' }}>
        <div style={{ maxWidth: 780, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 16 }}>
          {payload === null ? (
            <Muted text={pt ? 'Lendo a conversa…' : 'Reading the conversation…'} />
          ) : turns.length === 0 && live === null ? (
            <Muted text={pt ? 'Esta conversa ainda não tem mensagens.' : 'This conversation has no messages yet.'} />
          ) : null}

          {turns.map((t, i) => <Bubble key={i} turn={t} pt={pt} />)}

          {live !== null && (
            <Bubble turn={{ role: 'assistant', text: live }} pt={pt} provisional />
          )}
        </div>
      </div>

      <div style={{ borderTop: '1px solid var(--border)', padding: '12px 20px 14px' }}>
        <div style={{ maxWidth: 780, margin: '0 auto' }}>
          {blocked && (
            // The server refuses a prompt on a session sitting in a dialog: the text would go into
            // the dialog's own filter and the submit would take whichever option is highlighted.
            // The composer must not offer what the server will refuse.
            <p style={{ margin: '0 0 8px', fontSize: 11.5, color: 'var(--anthropic-orange)', lineHeight: 1.5 }}>
              {pt
                ? 'Esta sessão está esperando resposta a uma pergunta dela. Responda pela visão de terminal — o que você digitar aqui iria para o filtro do diálogo.'
                : 'This session is waiting on an answer to a question of its own. Answer it in the terminal view — anything typed here would go into the dialog’s own filter.'}
            </p>
          )}
          <div style={{
            display: 'flex', alignItems: 'flex-end', gap: 8,
            background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)',
            borderRadius: 12, padding: 8,
            opacity: canPrompt ? 1 : 0.55,
          }}>
            <textarea
              value={draft}
              onChange={e => setDraft(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send() }
              }}
              disabled={!canPrompt || sending}
              rows={1}
              placeholder={canPrompt
                ? (pt ? 'Escreva para esta sessão…' : 'Write to this session…')
                : (pt ? 'Indisponível para esta sessão' : 'Not available for this session')}
              style={{
                flex: 1, resize: 'none', border: 'none', outline: 'none', background: 'transparent',
                color: 'var(--text-primary)', fontFamily: 'inherit', fontSize: 13.5,
                lineHeight: 1.5, maxHeight: 140, padding: '6px 6px',
              }}
            />
            <button
              onClick={() => void send()}
              disabled={!canPrompt || sending || draft.trim() === ''}
              aria-label={pt ? 'Enviar' : 'Send'}
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                width: 34, height: 34, borderRadius: 9, border: 'none', flexShrink: 0,
                background: draft.trim() === '' || !canPrompt ? 'transparent' : 'var(--anthropic-orange)',
                color: draft.trim() === '' || !canPrompt ? 'var(--text-tertiary)' : '#fff',
                cursor: draft.trim() === '' || !canPrompt ? 'default' : 'pointer',
              }}
            >
              {sending ? <Loader size={15} /> : <Send size={15} />}
            </button>
          </div>
          {notice && (
            <p style={{ margin: '8px 0 0', fontSize: 11.5, color: 'var(--text-tertiary)', lineHeight: 1.5 }}>
              {notice}
            </p>
          )}
        </div>
      </div>
    </div>
  )
}

/** The emulator's escape sequences, which the chat has no use for. */
function stripAnsi(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/\[[0-9;?]*[A-Za-z]/g, '')
}

function Bubble({ turn, pt, provisional }: { turn: ChatTurn; pt: boolean; provisional?: boolean }) {
  const mine = turn.role === 'user'
  return (
    <div style={{ display: 'flex', justifyContent: mine ? 'flex-end' : 'flex-start' }}>
      <div style={{
        maxWidth: mine ? '80%' : '100%', minWidth: 0,
        background: mine ? 'var(--bg-elevated)' : 'transparent',
        border: mine ? '1px solid var(--border-subtle)' : 'none',
        borderRadius: 14, padding: mine ? '10px 14px' : '2px 0',
        fontSize: 13.5, lineHeight: 1.65,
        color: turn.pending ? 'var(--text-tertiary)' : 'var(--text-primary)',
        fontStyle: turn.pending ? 'italic' : 'normal',
      }}>
        {provisional && (
          // Said in words, not only implied: this text was read off a terminal screen, and the
          // transcript's own version replaces it the moment the turn lands.
          <div style={{
            fontSize: 10.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em',
            color: 'var(--anthropic-orange)', marginBottom: 5, display: 'flex', alignItems: 'center', gap: 6,
          }}>
            <span style={{
              width: 6, height: 6, borderRadius: 3, background: 'var(--anthropic-orange)', display: 'inline-block',
            }} />
            {pt ? 'escrevendo — lido da tela' : 'writing — read from the screen'}
          </div>
        )}
        <div className="ag-md" style={{ minWidth: 0, overflowWrap: 'anywhere' }}>
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{turn.text}</ReactMarkdown>
        </div>
      </div>
    </div>
  )
}

function Muted({ text }: { text: string }) {
  return <p style={{ margin: 0, fontSize: 12.5, color: 'var(--text-tertiary)' }}>{text}</p>
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      height: '100%', minHeight: 260, padding: 32, textAlign: 'center', maxWidth: 460, margin: '0 auto',
    }}>
      {children}
    </div>
  )
}
