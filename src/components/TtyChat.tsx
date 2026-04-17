import React, { useState, useRef, useEffect, useCallback } from 'react'
import { MessageSquare, X, Send, Bot, Loader, AlertCircle, Trash2 } from 'lucide-react'

type Lang = 'pt' | 'en'
type ChatMessage = { role: 'user' | 'assistant'; content: string }

function renderContent(text: string) {
  const parts = text.split(/(```[\s\S]*?```|`[^`]+`)/g)
  return parts.map((part, i) => {
    if (part.startsWith('```')) {
      const body = part.replace(/^```[^\n]*\n?/, '').replace(/```$/, '')
      return (
        <pre key={i} style={{
          background: 'var(--bg-base)',
          border: '1px solid var(--border)',
          borderRadius: 6,
          padding: '10px 12px',
          margin: '6px 0',
          fontSize: 12,
          overflowX: 'auto',
          whiteSpace: 'pre',
          fontFamily: 'monospace',
          color: 'var(--text-secondary)',
        }}>
          {body.trimEnd()}
        </pre>
      )
    }
    if (part.startsWith('`') && part.endsWith('`')) {
      return (
        <code key={i} style={{
          background: 'var(--bg-elevated)',
          border: '1px solid var(--border)',
          borderRadius: 3,
          padding: '1px 5px',
          fontSize: 12,
          fontFamily: 'monospace',
          color: 'var(--text-primary)',
        }}>
          {part.slice(1, -1)}
        </code>
      )
    }
    return <span key={i} style={{ whiteSpace: 'pre-wrap' }}>{part}</span>
  })
}

function Message({ msg, isStreaming }: { msg: ChatMessage; isStreaming?: boolean }) {
  const isUser = msg.role === 'user'
  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: isUser ? 'flex-end' : 'flex-start',
      gap: 4,
      marginBottom: 14,
    }}>
      <div style={{
        maxWidth: '88%',
        padding: isUser ? '8px 14px' : '10px 14px',
        borderRadius: isUser ? '14px 14px 4px 14px' : '4px 14px 14px 14px',
        background: isUser ? 'var(--anthropic-orange-dim)' : 'var(--bg-card)',
        border: `1px solid ${isUser ? 'var(--anthropic-orange)30' : 'var(--border)'}`,
        fontSize: 13,
        color: 'var(--text-primary)',
        lineHeight: 1.55,
        wordBreak: 'break-word',
      }}>
        {renderContent(msg.content)}
        {isStreaming && (
          <span style={{
            display: 'inline-block',
            width: 6,
            height: 14,
            background: 'var(--anthropic-orange)',
            borderRadius: 1,
            marginLeft: 2,
            verticalAlign: 'text-bottom',
            animation: 'ttyChatBlink 0.9s step-end infinite',
          }} />
        )}
      </div>
    </div>
  )
}

function ToolIndicator({ lang }: { lang: Lang }) {
  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      gap: 6,
      padding: '6px 10px',
      borderRadius: 8,
      background: 'var(--bg-elevated)',
      border: '1px solid var(--border)',
      fontSize: 11,
      color: 'var(--text-tertiary)',
      marginBottom: 14,
      width: 'fit-content',
      animation: 'ttyChatFadeIn 0.2s ease-out',
    }}>
      <Loader size={11} style={{ animation: 'ttyChatSpin 1s linear infinite' }} />
      {lang === 'pt' ? 'Consultando dados...' : 'Fetching data...'}
    </div>
  )
}

export function TtyChat({ lang }: { lang: Lang }) {
  const [open, setOpen] = useState(false)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [streaming, setStreaming] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [hasActivity, setHasActivity] = useState(false)

  const listRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => {
    if (open && inputRef.current) inputRef.current.focus()
  }, [open])

  useEffect(() => {
    if (listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight
    }
  }, [messages, streaming])

  const sendMessage = useCallback(async () => {
    const text = input.trim()
    if (!text || streaming) return

    setInput('')
    setError(null)
    const userMsg: ChatMessage = { role: 'user', content: text }
    const history = messages
    setMessages(prev => [...prev, userMsg])
    setStreaming(true)
    setHasActivity(true)

    const ctrl = new AbortController()
    abortRef.current = ctrl

    let accum = ''
    const assistantIndex = history.length + 1

    try {
      const res = await fetch('/api/chat-tty', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text, history }),
        signal: ctrl.signal,
      })

      if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`)

      setMessages(prev => [...prev, { role: 'assistant', content: '' }])

      const reader = res.body.getReader()
      const dec = new TextDecoder()
      let buf = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buf += dec.decode(value, { stream: true })
        const parts = buf.split('\n\n')
        buf = parts.pop() ?? ''

        for (const part of parts) {
          const line = part.replace(/^data: /, '').trim()
          if (!line) continue
          try {
            const ev = JSON.parse(line) as { text?: string; done?: boolean; error?: string }
            if (ev.error) {
              setError(ev.error)
              setStreaming(false)
              return
            }
            if (ev.text) {
              accum += ev.text
              setMessages(prev => {
                const copy = [...prev]
                copy[assistantIndex] = { role: 'assistant', content: accum }
                return copy
              })
            }
            if (ev.done) {
              setStreaming(false)
              return
            }
          } catch { /* ignore */ }
        }
      }
    } catch (err: unknown) {
      if ((err as Error).name !== 'AbortError') {
        setError(err instanceof Error ? err.message : String(err))
      }
    } finally {
      setStreaming(false)
    }
  }, [input, streaming, messages])

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      sendMessage()
    }
  }

  const clearChat = () => {
    if (abortRef.current) abortRef.current.abort()
    setMessages([])
    setError(null)
    setStreaming(false)
    setHasActivity(false)
  }

  const pt = lang === 'pt'

  return (
    <>
      <style>{`
        @keyframes ttyChatBlink { 0%,100% { opacity:1 } 50% { opacity:0 } }
        @keyframes ttyChatSpin  { from { transform: rotate(0deg) } to { transform: rotate(360deg) } }
        @keyframes ttyChatFadeIn { from { opacity:0; transform:translateY(4px) } to { opacity:1; transform:none } }
        @keyframes ttyChatSlideIn { from { opacity:0; transform:translateX(24px) } to { opacity:1; transform:none } }
        .tty-chat-send-btn:hover { background: var(--anthropic-orange) !important; color: #fff !important; }
        .tty-chat-clear-btn:hover { color: var(--text-primary) !important; }
      `}</style>

      {/* Floating button */}
      <button
        onClick={() => setOpen(v => !v)}
        title={pt ? 'Chat com IA' : 'AI Chat'}
        style={{
          position: 'fixed',
          bottom: 24,
          right: 24,
          zIndex: 500,
          width: 46,
          height: 46,
          borderRadius: '50%',
          border: open
            ? '1.5px solid var(--anthropic-orange)'
            : '1.5px solid var(--border)',
          background: open ? 'var(--anthropic-orange-dim)' : 'var(--bg-card)',
          color: open ? 'var(--anthropic-orange)' : 'var(--text-secondary)',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          boxShadow: '0 4px 16px rgba(0,0,0,0.35)',
          transition: 'all 0.2s',
        }}
      >
        {open ? <X size={17} /> : <MessageSquare size={17} />}

        {/* Unread dot */}
        {!open && hasActivity && messages.length > 0 && (
          <span style={{
            position: 'absolute',
            top: 8,
            right: 8,
            width: 8,
            height: 8,
            borderRadius: '50%',
            background: 'var(--anthropic-orange)',
            border: '1.5px solid var(--bg-base)',
          }} />
        )}
      </button>

      {/* Panel */}
      {open && (
        <div
          style={{
            position: 'fixed',
            bottom: 80,
            right: 24,
            zIndex: 500,
            width: 380,
            height: 560,
            maxHeight: 'calc(100vh - 120px)',
            display: 'flex',
            flexDirection: 'column',
            background: 'var(--bg-surface)',
            border: '1px solid var(--border)',
            borderRadius: 14,
            boxShadow: '0 8px 40px rgba(0,0,0,0.45)',
            overflow: 'hidden',
            animation: 'ttyChatSlideIn 0.18s ease-out',
          }}
        >
          {/* Header */}
          <div style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '12px 16px',
            borderBottom: '1px solid var(--border)',
            background: 'var(--bg-card)',
            flexShrink: 0,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={{
                width: 28, height: 28,
                borderRadius: 8,
                background: 'var(--anthropic-orange-dim)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                <Bot size={14} color="var(--anthropic-orange)" />
              </div>
              <div>
                <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)', lineHeight: 1.2 }}>
                  {pt ? 'Assistente' : 'Assistant'}
                </div>
                <div style={{ fontSize: 10, color: 'var(--text-tertiary)' }}>
                  {streaming ? (
                    <span style={{ color: 'var(--anthropic-orange)' }}>
                      {pt ? '● pensando...' : '● thinking...'}
                    </span>
                  ) : (
                    pt ? 'claude + agentistics MCP' : 'claude + agentistics MCP'
                  )}
                </div>
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              {messages.length > 0 && (
                <button
                  className="tty-chat-clear-btn"
                  onClick={clearChat}
                  title={pt ? 'Limpar conversa' : 'Clear chat'}
                  style={{
                    width: 28, height: 28,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    background: 'transparent',
                    border: '1px solid var(--border)',
                    borderRadius: 7,
                    color: 'var(--text-tertiary)',
                    cursor: 'pointer',
                    transition: 'color 0.15s',
                  }}
                >
                  <Trash2 size={12} />
                </button>
              )}
              <button
                onClick={() => setOpen(false)}
                style={{
                  width: 28, height: 28,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  background: 'transparent',
                  border: '1px solid var(--border)',
                  borderRadius: 7,
                  color: 'var(--text-tertiary)',
                  cursor: 'pointer',
                }}
              >
                <X size={12} />
              </button>
            </div>
          </div>

          {/* Messages */}
          <div
            ref={listRef}
            style={{
              flex: 1,
              overflowY: 'auto',
              padding: '16px',
              display: 'flex',
              flexDirection: 'column',
            }}
          >
            {messages.length === 0 && (
              <div style={{
                flex: 1,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 10,
                color: 'var(--text-tertiary)',
                textAlign: 'center',
                padding: '0 20px',
              }}>
                <Bot size={28} style={{ opacity: 0.3 }} />
                <div style={{ fontSize: 13, fontWeight: 500 }}>
                  {pt ? 'Pergunte sobre suas métricas' : 'Ask about your metrics'}
                </div>
                <div style={{ fontSize: 11, lineHeight: 1.6, opacity: 0.75 }}>
                  {pt
                    ? 'Posso analisar custos, sessões, projetos e criar layouts personalizados.'
                    : 'I can analyze costs, sessions, projects and build custom layouts.'}
                </div>
                <div style={{ fontSize: 10, color: 'var(--text-tertiary)', opacity: 0.6, marginTop: 4 }}>
                  {pt ? 'Ex: "qual meu custo total?" · "crie um layout de custos"'
                    : 'e.g. "what\'s my total cost?" · "build a cost layout"'}
                </div>
              </div>
            )}

            {messages.map((msg, i) => {
              const isLast = i === messages.length - 1
              const isStreamingThis = isLast && msg.role === 'assistant' && streaming
              return (
                <Message
                  key={i}
                  msg={msg}
                  isStreaming={isStreamingThis}
                />
              )
            })}

            {/* Tool-use thinking indicator — shown between user message and first assistant chunk */}
            {streaming && messages[messages.length - 1]?.role === 'user' && (
              <ToolIndicator lang={lang} />
            )}

            {error && (
              <div style={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: 8,
                padding: '10px 12px',
                borderRadius: 8,
                background: 'rgba(239,68,68,0.08)',
                border: '1px solid rgba(239,68,68,0.25)',
                fontSize: 12,
                color: '#ef4444',
                marginBottom: 8,
              }}>
                <AlertCircle size={13} style={{ flexShrink: 0, marginTop: 1 }} />
                <span style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{error}</span>
              </div>
            )}
          </div>

          {/* Input */}
          <div style={{
            borderTop: '1px solid var(--border)',
            padding: '10px 12px',
            display: 'flex',
            alignItems: 'flex-end',
            gap: 8,
            background: 'var(--bg-card)',
            flexShrink: 0,
          }}>
            <textarea
              ref={inputRef}
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={pt ? 'Pergunte algo...' : 'Ask something...'}
              rows={1}
              style={{
                flex: 1,
                resize: 'none',
                background: 'var(--bg-elevated)',
                border: '1px solid var(--border)',
                borderRadius: 8,
                padding: '8px 10px',
                fontSize: 13,
                fontFamily: 'inherit',
                color: 'var(--text-primary)',
                outline: 'none',
                lineHeight: 1.5,
                maxHeight: 120,
                overflowY: 'auto',
                transition: 'border-color 0.15s',
              }}
              onFocus={e => { e.currentTarget.style.borderColor = 'var(--anthropic-orange)60' }}
              onBlur={e => { e.currentTarget.style.borderColor = 'var(--border)' }}
              onInput={e => {
                const el = e.currentTarget
                el.style.height = 'auto'
                el.style.height = `${Math.min(el.scrollHeight, 120)}px`
              }}
              disabled={streaming}
            />
            <button
              className="tty-chat-send-btn"
              onClick={sendMessage}
              disabled={!input.trim() || streaming}
              title={pt ? 'Enviar (Enter)' : 'Send (Enter)'}
              style={{
                width: 34,
                height: 34,
                borderRadius: 8,
                border: '1px solid var(--anthropic-orange)60',
                background: 'var(--anthropic-orange-dim)',
                color: 'var(--anthropic-orange)',
                cursor: input.trim() && !streaming ? 'pointer' : 'not-allowed',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
                opacity: input.trim() && !streaming ? 1 : 0.4,
                transition: 'all 0.15s',
              }}
            >
              {streaming ? <Loader size={14} style={{ animation: 'ttyChatSpin 1s linear infinite' }} /> : <Send size={14} />}
            </button>
          </div>
        </div>
      )}
    </>
  )
}
