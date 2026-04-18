import React, { useState, useRef, useEffect, useCallback } from 'react'
import {
  MessageSquare, X, Send, Bot, Loader, AlertCircle, Trash2,
  Maximize2, Minimize2, Terminal, Play, ChevronRight,
} from 'lucide-react'
import { CHAT_MODELS, type ChatModelId, DEFAULT_CHAT_MODEL } from '../lib/chatModels'

type Lang = 'pt' | 'en'
type ChatMessage = { role: 'user' | 'assistant'; content: string; terminal?: boolean; exitCode?: number }

const BADGE_COLORS: Record<string, string> = {
  Fast:     'var(--accent-green)',
  Balanced: 'var(--anthropic-orange)',
  Powerful: 'var(--accent-purple)',
}

function playNotification() {
  try {
    const ctx = new AudioContext()
    const playTone = (freq: number, start: number, duration: number) => {
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.connect(gain)
      gain.connect(ctx.destination)
      osc.frequency.value = freq
      osc.type = 'sine'
      gain.gain.setValueAtTime(0, start)
      gain.gain.linearRampToValueAtTime(0.12, start + 0.015)
      gain.gain.exponentialRampToValueAtTime(0.001, start + duration)
      osc.start(start)
      osc.stop(start + duration)
    }
    playTone(880,  ctx.currentTime,       0.22)
    playTone(1100, ctx.currentTime + 0.1, 0.22)
  } catch { /* ignore AudioContext errors */ }
}

// ── Markdown-ish content renderer ───────────────────────────────────────────

interface CodeBlockProps {
  lang: string
  code: string
  onRun?: (code: string) => void
}

function CodeBlock({ lang: codeLang, code, onRun }: CodeBlockProps) {
  const isRunnable = ['bash', 'sh', 'shell', 'zsh'].includes(codeLang.toLowerCase())
  return (
    <div style={{ position: 'relative', margin: '6px 0' }}>
      <pre style={{
        background: 'var(--bg-base)',
        border: '1px solid var(--border)',
        borderRadius: 6,
        padding: isRunnable ? '8px 12px 8px 12px' : '10px 12px',
        fontSize: 12,
        overflowX: 'auto',
        whiteSpace: 'pre',
        fontFamily: 'monospace',
        color: 'var(--text-secondary)',
        margin: 0,
        paddingBottom: isRunnable ? 30 : undefined,
      }}>
        {codeLang && (
          <span style={{
            display: 'block',
            fontSize: 10,
            color: 'var(--text-tertiary)',
            marginBottom: 6,
            fontFamily: 'inherit',
          }}>
            {codeLang}
          </span>
        )}
        {code.trimEnd()}
      </pre>
      {isRunnable && onRun && (
        <button
          onClick={() => onRun(code.trim())}
          style={{
            position: 'absolute',
            bottom: 6,
            right: 8,
            display: 'flex', alignItems: 'center', gap: 4,
            padding: '3px 8px',
            borderRadius: 5,
            border: '1px solid var(--accent-green)40',
            background: 'color-mix(in srgb, var(--accent-green) 12%, transparent)',
            color: 'var(--accent-green)',
            fontSize: 10, fontWeight: 700,
            cursor: 'pointer',
            fontFamily: 'inherit',
            transition: 'all 0.15s',
          }}
          title="Run in terminal"
        >
          <Play size={9} />
          Run
        </button>
      )}
    </div>
  )
}

function renderContent(text: string, onRun?: (code: string) => void): React.ReactNode[] {
  const codeBlockRe = /```([^\n]*)\n([\s\S]*?)```/g
  const inlineCodeRe = /`([^`]+)`/g
  const boldRe = /\*\*([^*]+)\*\*/g

  const parts: React.ReactNode[] = []
  let lastIndex = 0
  let match: RegExpExecArray | null

  codeBlockRe.lastIndex = 0
  while ((match = codeBlockRe.exec(text)) !== null) {
    const before = text.slice(lastIndex, match.index)
    if (before) parts.push(...renderInline(before, parts.length, boldRe, inlineCodeRe))
    parts.push(
      <CodeBlock key={`cb-${match.index}`} lang={match[1]?.trim() ?? ''} code={match[2] ?? ''} onRun={onRun} />
    )
    lastIndex = match.index + match[0].length
  }

  const remaining = text.slice(lastIndex)
  if (remaining) parts.push(...renderInline(remaining, parts.length, boldRe, inlineCodeRe))
  return parts
}

function renderInline(
  text: string,
  baseKey: number,
  boldRe: RegExp,
  inlineCodeRe: RegExp,
): React.ReactNode[] {
  const segments: React.ReactNode[] = []
  // Split on inline code first
  const codeChunks = text.split(/(`[^`]+`)/g)
  let segIdx = 0
  for (const chunk of codeChunks) {
    if (chunk.startsWith('`') && chunk.endsWith('`') && chunk.length > 2) {
      segments.push(
        <code key={`ic-${baseKey}-${segIdx}`} style={{
          background: 'var(--bg-elevated)', border: '1px solid var(--border)',
          borderRadius: 3, padding: '1px 5px', fontSize: 12,
          fontFamily: 'monospace', color: 'var(--text-primary)',
        }}>
          {chunk.slice(1, -1)}
        </code>
      )
    } else {
      // Handle bold and plain text + newlines
      const boldChunks = chunk.split(/(\*\*[^*]+\*\*)/g)
      for (const bChunk of boldChunks) {
        if (bChunk.startsWith('**') && bChunk.endsWith('**') && bChunk.length > 4) {
          segments.push(<strong key={`b-${baseKey}-${segIdx}`} style={{ fontWeight: 700 }}>{bChunk.slice(2, -2)}</strong>)
        } else {
          segments.push(<span key={`t-${baseKey}-${segIdx}`} style={{ whiteSpace: 'pre-wrap' }}>{bChunk}</span>)
        }
        segIdx++
      }
    }
    segIdx++
  }
  // reset regex lastIndex
  boldRe.lastIndex = 0
  inlineCodeRe.lastIndex = 0
  return segments
}

// ── Message component ────────────────────────────────────────────────────────

function Message({
  msg, isStreaming, onRun,
}: {
  msg: ChatMessage
  isStreaming?: boolean
  onRun: (cmd: string) => void
}) {
  const isUser = msg.role === 'user'

  if (msg.terminal) {
    return (
      <div style={{ marginBottom: 14, animation: 'ttyChatFadeIn 0.15s ease-out' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 4 }}>
          <Terminal size={11} color="var(--accent-green)" />
          <span style={{ fontSize: 10, color: 'var(--accent-green)', fontWeight: 700 }}>
            {msg.exitCode === 0 ? 'done' : msg.exitCode !== undefined ? `exit ${msg.exitCode}` : 'running…'}
          </span>
        </div>
        <pre style={{
          background: 'var(--bg-base)',
          border: `1px solid ${msg.exitCode !== undefined && msg.exitCode !== 0 ? 'rgba(239,68,68,0.3)' : 'var(--border)'}`,
          borderRadius: 6,
          padding: '8px 12px',
          fontSize: 12,
          fontFamily: 'monospace',
          color: 'var(--text-secondary)',
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-all',
          margin: 0,
          maxHeight: 280,
          overflowY: 'auto',
        }}>
          {msg.content || (isStreaming ? '' : '(no output)')}
          {isStreaming && <span style={{ animation: 'ttyChatBlink 0.9s step-end infinite' }}>▋</span>}
        </pre>
      </div>
    )
  }

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: isUser ? 'flex-end' : 'flex-start',
      marginBottom: 14,
      animation: 'ttyChatFadeIn 0.15s ease-out',
    }}>
      <div style={{
        maxWidth: '90%',
        padding: isUser ? '8px 14px' : '10px 14px',
        borderRadius: isUser ? '14px 14px 4px 14px' : '4px 14px 14px 14px',
        background: isUser ? 'var(--anthropic-orange-dim)' : 'var(--bg-card)',
        border: `1px solid ${isUser ? 'var(--anthropic-orange)30' : 'var(--border)'}`,
        fontSize: 13,
        color: 'var(--text-primary)',
        lineHeight: 1.58,
        wordBreak: 'break-word',
      }}>
        {renderContent(msg.content, isUser ? undefined : onRun)}
        {isStreaming && (
          <span style={{
            display: 'inline-block', width: 6, height: 14,
            background: 'var(--anthropic-orange)', borderRadius: 1, marginLeft: 2,
            verticalAlign: 'text-bottom',
            animation: 'ttyChatBlink 0.9s step-end infinite',
          }} />
        )}
      </div>
    </div>
  )
}

// ── Model picker (first open) ────────────────────────────────────────────────

function ModelPicker({ lang, onPick }: { lang: Lang; onPick: (id: ChatModelId) => void }) {
  const [selected, setSelected] = useState<ChatModelId>(DEFAULT_CHAT_MODEL)
  const pt = lang === 'pt'
  return (
    <div style={{
      position: 'absolute', inset: 0, zIndex: 10,
      background: 'var(--bg-surface)',
      borderRadius: 'inherit',
      display: 'flex', flexDirection: 'column',
      padding: '20px 16px 16px',
      animation: 'ttyChatFadeIn 0.2s ease-out',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 18 }}>
        <div style={{
          width: 32, height: 32, borderRadius: 9,
          background: 'var(--anthropic-orange-dim)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          flexShrink: 0,
        }}>
          <Bot size={16} color="var(--anthropic-orange)" />
        </div>
        <div>
          <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)' }}>
            {pt ? 'Escolha o modelo' : 'Choose a model'}
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>
            {pt ? 'Você pode trocar depois nas preferências' : 'You can change this later in preferences'}
          </div>
        </div>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 8 }}>
        {CHAT_MODELS.map(m => {
          const active = selected === m.id
          const badgeColor = BADGE_COLORS[m.badge] ?? 'var(--text-tertiary)'
          return (
            <button
              key={m.id}
              onClick={() => setSelected(m.id)}
              style={{
                display: 'flex', alignItems: 'center', gap: 12,
                padding: '12px 14px', borderRadius: 10,
                border: active ? '1.5px solid var(--anthropic-orange)' : '1px solid var(--border)',
                background: active ? 'var(--anthropic-orange-dim)' : 'var(--bg-elevated)',
                cursor: 'pointer', textAlign: 'left',
                transition: 'all 0.15s', fontFamily: 'inherit',
              }}
            >
              <div style={{
                width: 36, height: 36, borderRadius: 9, flexShrink: 0,
                background: active ? 'color-mix(in srgb, var(--anthropic-orange) 15%, transparent)' : 'var(--bg-card)',
                border: `1px solid ${active ? 'var(--anthropic-orange)40' : 'var(--border)'}`,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                <Bot size={17} color={active ? 'var(--anthropic-orange)' : 'var(--text-tertiary)'} />
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 3 }}>
                  <span style={{ fontSize: 13, fontWeight: 700, color: active ? 'var(--anthropic-orange)' : 'var(--text-primary)' }}>
                    {m.label}
                  </span>
                  <span style={{
                    fontSize: 10, fontWeight: 700, color: badgeColor,
                    background: `color-mix(in srgb, ${badgeColor} 12%, transparent)`,
                    border: `1px solid color-mix(in srgb, ${badgeColor} 30%, transparent)`,
                    padding: '1px 6px', borderRadius: 4,
                  }}>
                    {m.badge}
                  </span>
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>{m.desc}</div>
              </div>
              <div style={{ fontSize: 10, color: 'var(--text-tertiary)', textAlign: 'right', flexShrink: 0, lineHeight: 1.7 }}>
                <div>${m.inputPer1M}/1M in</div>
                <div>${m.outputPer1M}/1M out</div>
              </div>
            </button>
          )
        })}
      </div>

      <button
        onClick={() => onPick(selected)}
        style={{
          marginTop: 14,
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
          padding: '10px 16px', borderRadius: 8, fontSize: 13, fontWeight: 700,
          border: '1px solid var(--anthropic-orange)',
          background: 'var(--anthropic-orange-dim)',
          color: 'var(--anthropic-orange)',
          cursor: 'pointer', fontFamily: 'inherit',
          transition: 'all 0.15s',
        }}
      >
        {pt ? 'Começar a conversar' : 'Start chatting'}
        <ChevronRight size={14} />
      </button>
    </div>
  )
}

// ── Main component ───────────────────────────────────────────────────────────

interface TtyChatProps {
  lang: Lang
  chatModel: ChatModelId | null
  chatSoundEnabled: boolean
  onModelSet: (model: ChatModelId) => void
}

export function TtyChat({ lang, chatModel, chatSoundEnabled, onModelSet }: TtyChatProps) {
  const [open, setOpen] = useState(false)
  const [fullscreen, setFullscreen] = useState(false)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [streaming, setStreaming] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [hasUnread, setHasUnread] = useState(false)

  const listRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const openRef = useRef(open)
  const soundRef = useRef(chatSoundEnabled)

  useEffect(() => { openRef.current = open }, [open])
  useEffect(() => { soundRef.current = chatSoundEnabled }, [chatSoundEnabled])

  useEffect(() => {
    if (open) { setHasUnread(false); inputRef.current?.focus() }
  }, [open])

  useEffect(() => {
    if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight
  }, [messages, streaming])

  const execCmd = useCallback(async (command: string) => {
    const cmdMsg: ChatMessage = { role: 'user', content: `$ ${command}`, terminal: false }
    setMessages(prev => [...prev, cmdMsg])

    const outIdx = messages.length + 1
    setMessages(prev => [...prev, { role: 'assistant', content: '', terminal: true }])
    setStreaming(true)

    let accum = ''

    try {
      const res = await fetch('/api/exec', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ command }),
      })
      if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`)

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
            const ev = JSON.parse(line) as { text?: string; stderr?: boolean; exitCode?: number; done?: boolean; error?: string }
            if (ev.error) { setError(ev.error); break }
            if (ev.text) {
              accum += ev.text
              setMessages(prev => {
                const copy = [...prev]
                copy[outIdx] = { role: 'assistant', content: accum, terminal: true }
                return copy
              })
            }
            if (ev.done) {
              setMessages(prev => {
                const copy = [...prev]
                copy[outIdx] = { role: 'assistant', content: accum, terminal: true, exitCode: ev.exitCode ?? 0 }
                return copy
              })
            }
          } catch { /* ignore */ }
        }
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setStreaming(false)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages.length])

  const sendMessage = useCallback(async () => {
    const text = input.trim()
    if (!text || streaming) return
    setInput('')
    setError(null)

    // /run or /bash command shortcut
    const runMatch = text.match(/^\/(?:run|bash|sh)\s+(.+)/s)
    if (runMatch) {
      await execCmd(runMatch[1]!.trim())
      return
    }

    const model = chatModel ?? DEFAULT_CHAT_MODEL
    const userMsg: ChatMessage = { role: 'user', content: text }
    const history = messages.filter(m => !m.terminal)
    setMessages(prev => [...prev, userMsg])
    setStreaming(true)

    const assistantIdx = messages.length + 1
    let accum = ''

    try {
      const res = await fetch('/api/chat-tty', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text, history, model }),
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
            if (ev.error) { setError(ev.error); setStreaming(false); return }
            if (ev.text) {
              accum += ev.text
              setMessages(prev => {
                const copy = [...prev]
                copy[assistantIdx] = { role: 'assistant', content: accum }
                return copy
              })
            }
            if (ev.done) {
              setStreaming(false)
              if (!openRef.current) {
                setHasUnread(true)
                if (soundRef.current) playNotification()
              }
              return
            }
          } catch { /* ignore */ }
        }
      }
    } catch (err: unknown) {
      if ((err as Error).name !== 'AbortError') setError(err instanceof Error ? err.message : String(err))
    } finally {
      setStreaming(false)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [input, streaming, messages, chatModel, execCmd])

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage() }
  }

  const clearChat = () => { setMessages([]); setError(null); setStreaming(false); setHasUnread(false) }

  const pt = lang === 'pt'
  const effectiveModel = chatModel ?? DEFAULT_CHAT_MODEL
  const modelInfo = CHAT_MODELS.find(m => m.id === effectiveModel)

  // Panel geometry
  const panelStyle: React.CSSProperties = fullscreen
    ? { position: 'fixed', inset: 16, width: 'auto', height: 'auto', bottom: 16 }
    : { position: 'fixed', bottom: 80, right: 24, width: 400, height: 580, maxHeight: 'calc(100vh - 120px)' }

  return (
    <>
      <style>{`
        @keyframes ttyChatBlink   { 0%,100%{opacity:1} 50%{opacity:0} }
        @keyframes ttyChatSpin    { from{transform:rotate(0deg)} to{transform:rotate(360deg)} }
        @keyframes ttyChatFadeIn  { from{opacity:0;transform:translateY(4px)} to{opacity:1;transform:none} }
        @keyframes ttyChatSlideIn { from{opacity:0;transform:translateX(18px)} to{opacity:1;transform:none} }
        .tty-fab:hover { border-color: var(--anthropic-orange) !important; color: var(--anthropic-orange) !important; }
        .tty-icon-btn:hover { color: var(--text-primary) !important; border-color: var(--text-secondary) !important; }
        .tty-run-btn:hover { background: color-mix(in srgb, var(--accent-green) 22%, transparent) !important; }
        .tty-send-btn:hover:not(:disabled) { background: var(--anthropic-orange) !important; color: #fff !important; }
      `}</style>

      {/* ── Floating action button ── */}
      <button
        className="tty-fab"
        onClick={() => setOpen(v => !v)}
        title={pt ? 'Chat com IA' : 'AI Chat'}
        style={{
          position: 'fixed', bottom: 24, right: 24, zIndex: 500,
          width: 46, height: 46, borderRadius: '50%',
          border: open ? '1.5px solid var(--anthropic-orange)' : '1.5px solid var(--border)',
          background: open ? 'var(--anthropic-orange-dim)' : 'var(--bg-card)',
          color: open ? 'var(--anthropic-orange)' : 'var(--text-secondary)',
          cursor: 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          boxShadow: '0 4px 18px rgba(0,0,0,0.35)',
          transition: 'all 0.2s',
        }}
      >
        {open ? <X size={17} /> : <MessageSquare size={17} />}
        {!open && hasUnread && (
          <span style={{
            position: 'absolute', top: 8, right: 8,
            width: 9, height: 9, borderRadius: '50%',
            background: 'var(--anthropic-orange)',
            border: '1.5px solid var(--bg-base)',
            animation: 'ttyChatBlink 1.8s ease-in-out infinite',
          }} />
        )}
      </button>

      {/* ── Chat panel ── */}
      {open && (
        <div style={{
          ...panelStyle,
          zIndex: 500,
          display: 'flex', flexDirection: 'column',
          background: 'var(--bg-surface)',
          border: '1px solid var(--border)',
          borderRadius: fullscreen ? 14 : 14,
          boxShadow: '0 10px 48px rgba(0,0,0,0.45)',
          overflow: 'hidden',
          animation: 'ttyChatSlideIn 0.18s ease-out',
        }}>

          {/* Model picker overlay (first open) */}
          {chatModel === null && (
            <ModelPicker lang={lang} onPick={(id) => { onModelSet(id) }} />
          )}

          {/* ── Header ── */}
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '10px 14px',
            borderBottom: '1px solid var(--border)',
            background: 'var(--bg-card)',
            flexShrink: 0,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
              <div style={{
                width: 28, height: 28, borderRadius: 8,
                background: 'var(--anthropic-orange-dim)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                <Bot size={14} color="var(--anthropic-orange)" />
              </div>
              <div>
                <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)', lineHeight: 1.2 }}>
                  {pt ? 'Assistente' : 'Assistant'}
                </div>
                <div style={{ fontSize: 10, color: 'var(--text-tertiary)', display: 'flex', alignItems: 'center', gap: 4 }}>
                  {streaming ? (
                    <span style={{ color: 'var(--anthropic-orange)' }}>● {pt ? 'pensando...' : 'thinking...'}</span>
                  ) : (
                    <>
                      <span>{modelInfo?.label ?? effectiveModel}</span>
                      {modelInfo && (
                        <span style={{
                          fontSize: 9, fontWeight: 700,
                          color: BADGE_COLORS[modelInfo.badge] ?? 'var(--text-tertiary)',
                          background: `color-mix(in srgb, ${BADGE_COLORS[modelInfo.badge] ?? 'var(--text-tertiary)'} 12%, transparent)`,
                          border: `1px solid color-mix(in srgb, ${BADGE_COLORS[modelInfo.badge] ?? 'var(--text-tertiary)'} 25%, transparent)`,
                          padding: '0px 4px', borderRadius: 3,
                        }}>
                          {modelInfo.badge}
                        </span>
                      )}
                    </>
                  )}
                </div>
              </div>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              {messages.length > 0 && (
                <button className="tty-icon-btn" onClick={clearChat} title={pt ? 'Limpar conversa' : 'Clear chat'} style={iconBtnStyle}>
                  <Trash2 size={12} />
                </button>
              )}
              <button
                className="tty-icon-btn"
                onClick={() => setFullscreen(v => !v)}
                title={fullscreen ? (pt ? 'Restaurar' : 'Restore') : (pt ? 'Tela cheia' : 'Fullscreen')}
                style={iconBtnStyle}
              >
                {fullscreen ? <Minimize2 size={12} /> : <Maximize2 size={12} />}
              </button>
              <button className="tty-icon-btn" onClick={() => setOpen(false)} title={pt ? 'Fechar' : 'Close'} style={iconBtnStyle}>
                <X size={12} />
              </button>
            </div>
          </div>

          {/* ── Messages ── */}
          <div ref={listRef} style={{ flex: 1, overflowY: 'auto', padding: '14px 14px 6px' }}>
            {messages.length === 0 && (
              <div style={{
                height: '100%', display: 'flex', flexDirection: 'column',
                alignItems: 'center', justifyContent: 'center',
                gap: 10, color: 'var(--text-tertiary)', textAlign: 'center', padding: '0 20px',
              }}>
                <Bot size={28} style={{ opacity: 0.25 }} />
                <div style={{ fontSize: 13, fontWeight: 600 }}>
                  {pt ? 'Pergunte sobre suas métricas' : 'Ask about your metrics'}
                </div>
                <div style={{ fontSize: 11, lineHeight: 1.65, opacity: 0.7 }}>
                  {pt
                    ? 'Analiso custos, sessões, projetos e posso criar layouts personalizados.'
                    : 'I can analyze costs, sessions, projects and build custom layouts.'}
                </div>
                <div style={{
                  marginTop: 6,
                  background: 'var(--bg-elevated)',
                  border: '1px solid var(--border)',
                  borderRadius: 8,
                  padding: '8px 12px',
                  fontSize: 11,
                  color: 'var(--text-tertiary)',
                  textAlign: 'left',
                  lineHeight: 1.8,
                }}>
                  <code style={{ color: 'var(--accent-green)' }}>/run ls -la</code>{' '}
                  {pt ? '— executa comando' : '— run a command'}<br />
                  <code style={{ color: 'var(--accent-green)' }}>/bash pwd</code>{' '}
                  {pt ? '— atalho bash' : '— bash shortcut'}
                </div>
              </div>
            )}

            {messages.map((msg, i) => {
              const isLast = i === messages.length - 1
              const isStreamingThis = isLast && streaming
              return (
                <Message key={i} msg={msg} isStreaming={isStreamingThis} onRun={execCmd} />
              )
            })}

            {/* Thinking indicator — between user msg and first assistant chunk */}
            {streaming && messages.length > 0 && messages[messages.length - 1]?.role === 'user' && !messages[messages.length - 1]?.terminal && (
              <div style={{
                display: 'flex', alignItems: 'center', gap: 6,
                padding: '6px 10px', borderRadius: 8,
                background: 'var(--bg-elevated)', border: '1px solid var(--border)',
                fontSize: 11, color: 'var(--text-tertiary)',
                marginBottom: 14, width: 'fit-content',
                animation: 'ttyChatFadeIn 0.2s ease-out',
              }}>
                <Loader size={11} style={{ animation: 'ttyChatSpin 1s linear infinite' }} />
                {pt ? 'Consultando dados...' : 'Fetching data...'}
              </div>
            )}

            {error && (
              <div style={{
                display: 'flex', alignItems: 'flex-start', gap: 8,
                padding: '10px 12px', borderRadius: 8, marginBottom: 8,
                background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.25)',
                fontSize: 12, color: '#ef4444',
              }}>
                <AlertCircle size={13} style={{ flexShrink: 0, marginTop: 1 }} />
                <span style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{error}</span>
              </div>
            )}
          </div>

          {/* ── Input area ── */}
          <div style={{
            borderTop: '1px solid var(--border)',
            padding: '10px 12px',
            display: 'flex', alignItems: 'flex-end', gap: 8,
            background: 'var(--bg-card)', flexShrink: 0,
          }}>
            <textarea
              ref={inputRef}
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={pt ? 'Pergunte algo ou /run <cmd>...' : 'Ask something or /run <cmd>...'}
              rows={1}
              disabled={streaming || chatModel === null}
              style={{
                flex: 1, resize: 'none',
                background: 'var(--bg-elevated)', border: '1px solid var(--border)',
                borderRadius: 8, padding: '8px 10px', fontSize: 13, fontFamily: 'inherit',
                color: 'var(--text-primary)', outline: 'none', lineHeight: 1.5,
                maxHeight: 120, overflowY: 'auto', transition: 'border-color 0.15s',
              }}
              onFocus={e => { e.currentTarget.style.borderColor = 'var(--anthropic-orange)60' }}
              onBlur={e => { e.currentTarget.style.borderColor = 'var(--border)' }}
              onInput={e => {
                const el = e.currentTarget
                el.style.height = 'auto'
                el.style.height = `${Math.min(el.scrollHeight, 120)}px`
              }}
            />
            <button
              className="tty-send-btn"
              onClick={sendMessage}
              disabled={!input.trim() || streaming || chatModel === null}
              title={pt ? 'Enviar (Enter)' : 'Send (Enter)'}
              style={{
                width: 34, height: 34, borderRadius: 8, flexShrink: 0,
                border: '1px solid var(--anthropic-orange)60',
                background: 'var(--anthropic-orange-dim)', color: 'var(--anthropic-orange)',
                cursor: input.trim() && !streaming ? 'pointer' : 'not-allowed',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                opacity: input.trim() && !streaming && chatModel !== null ? 1 : 0.4,
                transition: 'all 0.15s',
              }}
            >
              {streaming
                ? <Loader size={14} style={{ animation: 'ttyChatSpin 1s linear infinite' }} />
                : input.trim().match(/^\/(?:run|bash|sh)\s/)
                  ? <Play size={14} />
                  : <Send size={14} />}
            </button>
          </div>
        </div>
      )}
    </>
  )
}

const iconBtnStyle: React.CSSProperties = {
  width: 28, height: 28,
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  background: 'transparent', border: '1px solid var(--border)', borderRadius: 7,
  color: 'var(--text-tertiary)', cursor: 'pointer', transition: 'all 0.15s', padding: 0,
}
