import React, { useState, useRef, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import {
  MessageSquare, X, Send, Loader, AlertCircle, Trash2,
  Maximize2, Minimize2, Terminal, Play, ChevronRight,
  Wrench, ChevronDown, ChevronUp, ArrowRight, Filter, History, Plus,
  ShieldAlert, Check, ExternalLink, Paperclip, FileText as FileTextIcon,
} from 'lucide-react'

// ── Attachment type (Nay only handles images + text files) ────────────────────
type NayAttachment = {
  id: string
  name: string
  mimeType: string
  data: string
  isImage: boolean
  preview?: string
}
import { ClaudeChat } from './ClaudeChat'
import { CHAT_MODELS, type ChatModelId, DEFAULT_CHAT_MODEL } from '../lib/chatModels'
import { formatToolName, fmtTime, NAV_LINK_RE } from '../lib/chatUtils'
import { t } from '../lib/i18n'
import type { Filters } from '../lib/types'

type Lang = 'pt' | 'en'

type ChatMessage = {
  role: 'user' | 'assistant'
  content: string
  terminal?: boolean
  exitCode?: number
  timestamp: number
  tools?: string[]
  images?: string[]   // data URLs – shown as thumbnails in the bubble
  files?: string[]    // file names – shown as chips in the bubble
}

type RawSessionMessage = {
  role: 'user' | 'assistant'
  content: string
  timestamp: number
  tools?: string[]
  images?: string[]
  files?: string[]
}

// Detect sessions stored with the old inline-history format ("User: ...\nAssistant: ...") and
// parse them into individual message bubbles for display.
function expandHistoryBlob(msgs: RawSessionMessage[]): ChatMessage[] {
  const out: ChatMessage[] = []
  for (const msg of msgs) {
    const isBlob =
      msg.role === 'user' &&
      (msg.content.startsWith('User: ') || msg.content.startsWith('Assistant: ')) &&
      (msg.content.includes('\nUser: ') || msg.content.includes('\nAssistant: '))
    if (!isBlob) { out.push({ ...msg, terminal: false }); continue }

    let currentRole: 'user' | 'assistant' | null = null
    let currentLines: string[] = []
    const flush = () => {
      if (!currentRole) return
      const content = currentLines.join('\n').trim()
      if (content) out.push({ role: currentRole, content, timestamp: msg.timestamp, terminal: false })
      currentLines = []
    }
    for (const line of msg.content.split('\n')) {
      if (line.startsWith('User: '))       { flush(); currentRole = 'user';      currentLines = [line.slice(6)] }
      else if (line.startsWith('Assistant: ')) { flush(); currentRole = 'assistant'; currentLines = [line.slice(11)] }
      else currentLines.push(line)
    }
    flush()
  }
  return out
}

type NaySessionSummary = {
  id: string
  title: string
  createdAt: string
  updatedAt: string
  messageCount: number
  model: string
}

// Detect assistant messages that are asking the user for confirmation/permission
const CONFIRM_PATTERNS = [
  /confirme?\b/i, /please confirm/i, /por favor confirm/i,
  /preciso de sua permiss/i, /need(s)? your (permission|approval)/i,
  /você (pode|pode) confirmar/i, /can you (confirm|approve)/i,
  /deseja (prosseguir|continuar)/i, /do you (want|wish) (to )?proceed/i,
  /quer (que eu|continuar|prosseguir)/i,
]
function looksLikeConfirmRequest(text: string): boolean {
  return CONFIRM_PATTERNS.some(re => re.test(text))
}

function ConfirmBar({ pt, onConfirm, onCancel }: { pt: boolean; onConfirm: () => void; onCancel: () => void }) {
  return (
    <div style={{
      margin: '6px 0 10px',
      padding: '10px 14px',
      borderRadius: 10,
      border: '1px solid var(--anthropic-orange)40',
      background: 'var(--anthropic-orange-dim)',
      display: 'flex', alignItems: 'center', gap: 10,
      animation: 'ttyChatFadeIn 0.15s ease-out',
    }}>
      <ShieldAlert size={14} style={{ color: 'var(--anthropic-orange)', flexShrink: 0 }} />
      <span style={{ flex: 1, fontSize: 12, color: 'var(--text-secondary)' }}>
        {pt ? 'Aguardando confirmação' : 'Awaiting confirmation'}
      </span>
      <button
        onClick={onCancel}
        style={{
          padding: '4px 12px', borderRadius: 6, fontSize: 12, fontWeight: 600,
          border: '1px solid var(--border)', background: 'transparent',
          color: 'var(--text-secondary)', cursor: 'pointer', fontFamily: 'inherit',
        }}
      >
        {pt ? 'Cancelar' : 'Cancel'}
      </button>
      <button
        onClick={onConfirm}
        style={{
          padding: '4px 12px', borderRadius: 6, fontSize: 12, fontWeight: 700,
          border: '1px solid var(--anthropic-orange)',
          background: 'color-mix(in srgb, var(--anthropic-orange) 20%, transparent)',
          color: 'var(--anthropic-orange)', cursor: 'pointer', fontFamily: 'inherit',
          display: 'flex', alignItems: 'center', gap: 5,
        }}
      >
        <Check size={11} />
        {pt ? 'Confirmar' : 'Confirm'}
      </button>
    </div>
  )
}

const BADGE_COLORS: Record<string, string> = {
  Fast:     'var(--accent-green)',
  Balanced: 'var(--anthropic-orange)',
  Powerful: 'var(--accent-purple)',
}

// ── Audio ─────────────────────────────────────────────────────────────────────

function createPlayFn(ctxRef: React.MutableRefObject<AudioContext | null>) {
  return function playNotification() {
    const ctx = ctxRef.current
    if (!ctx) return
    ctx.resume().then(() => {
      const now = ctx.currentTime
      const playTone = (freq: number, start: number, dur: number) => {
        const osc = ctx.createOscillator()
        const gain = ctx.createGain()
        osc.connect(gain)
        gain.connect(ctx.destination)
        osc.type = 'sine'
        osc.frequency.value = freq
        gain.gain.setValueAtTime(0, start)
        gain.gain.linearRampToValueAtTime(0.18, start + 0.02)
        gain.gain.exponentialRampToValueAtTime(0.001, start + dur)
        osc.start(start)
        osc.stop(start + dur)
      }
      playTone(880,  now,        0.25)
      playTone(1100, now + 0.12, 0.25)
    }).catch(() => {/* ignore */})
  }
}

// ── Markdown renderer ─────────────────────────────────────────────────────────

interface CodeBlockProps { lang: string; code: string; onRun?: (c: string) => void }

function CodeBlock({ lang: codeLang, code, onRun }: CodeBlockProps) {
  const isRunnable = ['bash', 'sh', 'shell', 'zsh'].includes(codeLang.toLowerCase())
  return (
    <div style={{ position: 'relative', margin: '6px 0' }}>
      <pre style={{
        background: 'var(--bg-base)', border: '1px solid var(--border)',
        borderRadius: 6, padding: isRunnable ? '8px 12px 30px' : '10px 12px',
        fontSize: 12, overflowX: 'auto', whiteSpace: 'pre',
        fontFamily: 'monospace', color: 'var(--text-secondary)', margin: 0,
      }}>
        {codeLang && (
          <span style={{ display: 'block', fontSize: 10, color: 'var(--text-tertiary)', marginBottom: 6 }}>
            {codeLang}
          </span>
        )}
        {code.trimEnd()}
      </pre>
      {isRunnable && onRun && (
        <button
          onClick={() => onRun(code.trim())}
          style={{
            position: 'absolute', bottom: 6, right: 8,
            display: 'flex', alignItems: 'center', gap: 4,
            padding: '3px 8px', borderRadius: 5, fontSize: 10, fontWeight: 700,
            border: '1px solid var(--accent-green)40',
            background: 'color-mix(in srgb, var(--accent-green) 12%, transparent)',
            color: 'var(--accent-green)', cursor: 'pointer', fontFamily: 'inherit',
          }}
        >
          <Play size={9} /> Run
        </button>
      )}
    </div>
  )
}

function renderContent(
  text: string,
  onRun?: (c: string) => void,
  onNavigate?: (path: string) => void,
): React.ReactNode {
  // Replace custom nav links [label](nav:path) before rendering
  const navParts = text.split(NAV_LINK_RE)
  // If there are no nav links, render directly
  if (navParts.length === 1) {
    return <MarkdownContent text={text} onRun={onRun} onNavigate={onNavigate} />
  }

  // Mix nav buttons with markdown segments
  const nodes: React.ReactNode[] = []
  for (let i = 0; i < navParts.length; i++) {
    const part = navParts[i]!
    if (i % 3 === 0) {
      if (part) nodes.push(<MarkdownContent key={i} text={part} onRun={onRun} onNavigate={onNavigate} />)
    } else if (i % 3 === 1) {
      const label = part
      const path = navParts[i + 1]!
      i++
      nodes.push(
        <button
          key={`nav-${i}`}
          onClick={() => onNavigate?.(path)}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 5,
            padding: '5px 10px', borderRadius: 7, fontSize: 12, fontWeight: 600,
            border: '1px solid var(--anthropic-orange)50',
            background: 'var(--anthropic-orange-dim)', color: 'var(--anthropic-orange)',
            cursor: 'pointer', fontFamily: 'inherit',
            margin: '6px 0', transition: 'all 0.15s',
          }}
        >
          <ArrowRight size={11} />
          {label.replace(/^→\s*/, '')}
        </button>
      )
    }
  }
  return <>{nodes}</>
}

function MarkdownContent({
  text,
  onRun,
  onNavigate,
}: {
  text: string
  onRun?: (c: string) => void
  onNavigate?: (path: string) => void
}) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        code({ className, children, ...props }) {
          const match = /language-(\w+)/.exec(className ?? '')
          const inline = !match && !String(children).includes('\n')
          if (inline) {
            return (
              <code
                style={{
                  background: 'var(--bg-elevated)', border: '1px solid var(--border)',
                  borderRadius: 3, padding: '1px 5px', fontSize: 12,
                  fontFamily: 'monospace', color: 'var(--text-primary)',
                }}
                {...props}
              >
                {children}
              </code>
            )
          }
          const lang = match?.[1] ?? ''
          const code = String(children).replace(/\n$/, '')
          return <CodeBlock lang={lang} code={code} onRun={onRun} />
        },
        a({ href, children }) {
          if (href && onNavigate && !href.startsWith('http')) {
            return (
              <button
                onClick={() => onNavigate(href)}
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 4,
                  background: 'none', border: 'none', padding: 0,
                  color: 'var(--anthropic-orange)', cursor: 'pointer',
                  fontFamily: 'inherit', fontSize: 'inherit', textDecoration: 'underline',
                }}
              >
                {children}
              </button>
            )
          }
          return (
            <a href={href} target="_blank" rel="noopener noreferrer"
              style={{ color: 'var(--anthropic-orange)' }}>
              {children}
            </a>
          )
        },
        p({ children }) {
          return <p style={{ margin: '4px 0', lineHeight: 1.58 }}>{children}</p>
        },
        h1({ children }) {
          return <h1 style={{ fontSize: 16, fontWeight: 700, margin: '10px 0 4px', color: 'var(--text-primary)' }}>{children}</h1>
        },
        h2({ children }) {
          return <h2 style={{ fontSize: 14, fontWeight: 700, margin: '8px 0 4px', color: 'var(--text-primary)' }}>{children}</h2>
        },
        h3({ children }) {
          return <h3 style={{ fontSize: 13, fontWeight: 700, margin: '6px 0 2px', color: 'var(--text-primary)' }}>{children}</h3>
        },
        ul({ children }) {
          return <ul style={{ margin: '4px 0', paddingLeft: 18, lineHeight: 1.7 }}>{children}</ul>
        },
        ol({ children }) {
          return <ol style={{ margin: '4px 0', paddingLeft: 18, lineHeight: 1.7 }}>{children}</ol>
        },
        li({ children }) {
          return <li style={{ marginBottom: 2 }}>{children}</li>
        },
        blockquote({ children }) {
          return (
            <blockquote style={{
              borderLeft: '3px solid var(--anthropic-orange)60',
              margin: '6px 0', paddingLeft: 10,
              color: 'var(--text-secondary)', fontStyle: 'italic',
            }}>
              {children}
            </blockquote>
          )
        },
        strong({ children }) {
          return <strong style={{ fontWeight: 700, color: 'var(--text-primary)' }}>{children}</strong>
        },
        em({ children }) {
          return <em style={{ fontStyle: 'italic' }}>{children}</em>
        },
        hr() {
          return <hr style={{ border: 'none', borderTop: '1px solid var(--border)', margin: '8px 0' }} />
        },
        table({ children }) {
          return (
            <div style={{ overflowX: 'auto', margin: '6px 0' }}>
              <table style={{ borderCollapse: 'collapse', fontSize: 12, width: '100%' }}>{children}</table>
            </div>
          )
        },
        th({ children }) {
          return (
            <th style={{
              border: '1px solid var(--border)', padding: '4px 8px',
              background: 'var(--bg-elevated)', fontWeight: 700, textAlign: 'left',
            }}>
              {children}
            </th>
          )
        },
        td({ children }) {
          return (
            <td style={{ border: '1px solid var(--border)', padding: '4px 8px' }}>
              {children}
            </td>
          )
        },
      }}
    >
      {text}
    </ReactMarkdown>
  )
}

// ── Tool activity bubble ──────────────────────────────────────────────────────

function ToolActivity({ tools, live, pt }: { tools: string[]; live: boolean; pt: boolean }) {
  const [expanded, setExpanded] = useState(false)
  if (tools.length === 0) return null
  const label = live
    ? formatToolName(tools[tools.length - 1]!)
    : pt ? `${tools.length} ação${tools.length > 1 ? 'ões' : ''} tomada${tools.length > 1 ? 's' : ''}` : `${tools.length} action${tools.length > 1 ? 's' : ''} taken`

  return (
    <div style={{
      marginBottom: 6,
      border: '1px solid var(--border)',
      borderRadius: 8,
      background: 'var(--bg-elevated)',
      overflow: 'hidden',
      fontSize: 11,
    }}>
      <button
        onClick={() => !live && setExpanded(v => !v)}
        style={{
          width: '100%', display: 'flex', alignItems: 'center', gap: 6,
          padding: '5px 9px', background: 'transparent', border: 'none',
          cursor: live ? 'default' : 'pointer', fontFamily: 'inherit', color: 'var(--text-tertiary)',
          textAlign: 'left',
        }}
      >
        {live
          ? <Loader size={10} style={{ animation: 'ttyChatSpin 1s linear infinite', flexShrink: 0, color: 'var(--anthropic-orange)' }} />
          : <Wrench size={10} style={{ flexShrink: 0 }} />
        }
        <span style={{ flex: 1, color: live ? 'var(--anthropic-orange)' : 'var(--text-tertiary)' }}>{label}</span>
        {!live && (expanded ? <ChevronUp size={10} /> : <ChevronDown size={10} />)}
      </button>
      {!live && expanded && (
        <div style={{ borderTop: '1px solid var(--border)', padding: '4px 9px 6px' }}>
          {tools.map((t, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '2px 0', color: 'var(--text-tertiary)' }}>
              <span style={{ fontSize: 9, opacity: 0.5 }}>✓</span>
              <span>{formatToolName(t)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Message component ─────────────────────────────────────────────────────────

function Message({
  msg, isLiveStreaming, currentTools, onRun, onNavigate, pt,
}: {
  msg: ChatMessage
  isLiveStreaming?: boolean
  currentTools?: string[]
  onRun: (cmd: string) => void
  onNavigate: (path: string) => void
  pt: boolean
}) {
  const isUser = msg.role === 'user'

  const timeEl = (
    <span style={{ fontSize: 10, color: 'var(--text-tertiary)', marginTop: 4, display: 'block', textAlign: isUser ? 'right' : 'left' }}>
      {fmtTime(msg.timestamp)}
    </span>
  )

  if (msg.terminal) {
    return (
      <div style={{ marginBottom: 14, animation: 'ttyChatFadeIn 0.15s ease-out' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 4 }}>
          <Terminal size={11} color="var(--accent-green)" />
          <span style={{ fontSize: 10, color: 'var(--accent-green)', fontWeight: 700 }}>
            {msg.exitCode === 0 ? 'done' : msg.exitCode !== undefined ? `exit ${msg.exitCode}` : 'running…'}
          </span>
          <span style={{ fontSize: 10, color: 'var(--text-tertiary)', marginLeft: 'auto' }}>{fmtTime(msg.timestamp)}</span>
        </div>
        <pre style={{
          background: 'var(--bg-base)',
          border: `1px solid ${msg.exitCode !== undefined && msg.exitCode !== 0 ? 'rgba(239,68,68,0.3)' : 'var(--border)'}`,
          borderRadius: 6, padding: '8px 12px', fontSize: 12,
          fontFamily: 'monospace', color: 'var(--text-secondary)',
          whiteSpace: 'pre-wrap', wordBreak: 'break-all',
          margin: 0, maxHeight: 280, overflowY: 'auto',
        }}>
          {msg.content || (isLiveStreaming ? '' : '(no output)')}
        </pre>
      </div>
    )
  }

  if (isUser) {
    return (
      <div style={{
        display: 'flex', flexDirection: 'column', alignItems: 'flex-end',
        marginBottom: 14, animation: 'ttyChatFadeIn 0.15s ease-out',
      }}>
        {/* Image thumbnails above the bubble */}
        {msg.images && msg.images.length > 0 && (
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end', marginBottom: 5, maxWidth: '90%' }}>
            {msg.images.map((src, i) => (
              <img key={i} src={src} alt="attachment"
                style={{ maxWidth: 130, maxHeight: 100, borderRadius: 8, objectFit: 'cover',
                  border: '1px solid var(--anthropic-orange)40' }} />
            ))}
          </div>
        )}
        {/* File chips above the bubble */}
        {msg.files && msg.files.length > 0 && (
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', justifyContent: 'flex-end', marginBottom: 5, maxWidth: '90%' }}>
            {msg.files.map((name, i) => (
              <span key={i} style={{
                fontSize: 10, padding: '2px 7px', borderRadius: 6,
                background: 'var(--anthropic-orange-dim)',
                border: '1px solid var(--anthropic-orange)30',
                color: 'var(--anthropic-orange)',
              }}>{name}</span>
            ))}
          </div>
        )}
        {msg.content && (
          <div style={{
            maxWidth: '90%', padding: '8px 14px',
            borderRadius: '14px 14px 4px 14px',
            background: 'var(--anthropic-orange-dim)',
            border: '1px solid var(--anthropic-orange)30',
            fontSize: 13, color: 'var(--text-primary)', lineHeight: 1.58, wordBreak: 'break-word',
          }}>
            {renderContent(msg.content)}
          </div>
        )}
        {timeEl}
      </div>
    )
  }

  // Assistant message — with avatar
  const toolsToShow = isLiveStreaming ? currentTools : msg.tools
  return (
    <div style={{
      display: 'flex', alignItems: 'flex-start', gap: 8,
      marginBottom: 14, animation: 'ttyChatFadeIn 0.15s ease-out',
    }}>
      {/* Avatar */}
      <div style={{
        width: 34, height: 34, borderRadius: '50%', flexShrink: 0,
        background: 'var(--bg-elevated)', border: '1px solid var(--border)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        overflow: 'hidden', marginTop: 2,
      }}>
        <img src="/minimalistLogo.png" alt="Nay" style={{ width: 26, height: 26, objectFit: 'contain' }} />
      </div>

      {/* Content column */}
      <div style={{ flex: 1, minWidth: 0 }}>
        {toolsToShow && toolsToShow.length > 0 && (
          <ToolActivity
            tools={toolsToShow}
            live={!!isLiveStreaming}
            pt={pt}
          />
        )}
        <div style={{
          padding: '10px 14px',
          borderRadius: '4px 14px 14px 14px',
          background: 'var(--bg-card)',
          border: '1px solid var(--border)',
          fontSize: 13, color: 'var(--text-primary)', lineHeight: 1.58, wordBreak: 'break-word',
        }}>
          {msg.content
            ? renderContent(msg.content, onRun, onNavigate)
            : isLiveStreaming
              ? <span style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--text-tertiary)', fontSize: 12 }}>
                  <Loader size={11} style={{ animation: 'ttyChatSpin 1s linear infinite' }} />
                  {pt ? 'Escrevendo...' : 'Writing...'}
                </span>
              : null
          }
        </div>
        {timeEl}
      </div>
    </div>
  )
}

// ── Model picker ──────────────────────────────────────────────────────────────

function ModelPicker({ lang, onPick }: { lang: Lang; onPick: (id: ChatModelId) => void }) {
  const [selected, setSelected] = useState<ChatModelId>(DEFAULT_CHAT_MODEL)
  const pt = lang === 'pt'
  return (
    <div style={{
      position: 'absolute', inset: 0, zIndex: 10,
      background: 'var(--bg-surface)', borderRadius: 'inherit',
      display: 'flex', flexDirection: 'column',
      padding: '20px 16px 16px',
      animation: 'ttyChatFadeIn 0.2s ease-out',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 18 }}>
        <img src="/minimalistLogo.png" alt="Nay" style={{ width: 32, height: 32, borderRadius: 9, objectFit: 'cover' }} />
        <div>
          <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)' }}>
            {pt ? 'Olá! Sou Nay 👋' : 'Hi! I\'m Nay 👋'}
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>
            {pt ? 'Escolha o modelo para começar' : 'Choose a model to get started'}
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
                padding: '12px 14px', borderRadius: 10, textAlign: 'left',
                border: active ? '1.5px solid var(--anthropic-orange)' : '1px solid var(--border)',
                background: active ? 'var(--anthropic-orange-dim)' : 'var(--bg-elevated)',
                cursor: 'pointer', transition: 'all 0.15s', fontFamily: 'inherit',
              }}
            >
              <div style={{
                width: 36, height: 36, borderRadius: 9, flexShrink: 0,
                background: active ? 'color-mix(in srgb, var(--anthropic-orange) 15%, transparent)' : 'var(--bg-card)',
                border: `1px solid ${active ? 'var(--anthropic-orange)40' : 'var(--border)'}`,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                overflow: 'hidden',
              }}>
                <img src="/minimalistLogo.png" alt="" style={{ width: 22, height: 22, objectFit: 'contain', opacity: active ? 1 : 0.5 }} />
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
          marginTop: 14, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
          padding: '10px 16px', borderRadius: 8, fontSize: 13, fontWeight: 700,
          border: '1px solid var(--anthropic-orange)',
          background: 'var(--anthropic-orange-dim)', color: 'var(--anthropic-orange)',
          cursor: 'pointer', fontFamily: 'inherit', transition: 'all 0.15s',
        }}
      >
        {pt ? 'Começar a conversar' : 'Start chatting'}
        <ChevronRight size={14} />
      </button>
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

import type { ChatMessage as ClaudeChatMessage } from './ClaudeChat'

interface TtyChatProps {
  lang: Lang
  chatModel: ChatModelId | null
  chatSoundEnabled: boolean
  onModelSet: (model: ChatModelId) => void
  filters: Filters
  setFilters: React.Dispatch<React.SetStateAction<Filters>>
  isMobile?: boolean
  onDetachClaude?: () => void
  claudeSharedState?: {
    projectPath: string | null; projectName: string | null; projectEncodedDir: string | null
    sessionId: string | null; messages: ClaudeChatMessage[]
  }
  onClaudeStateChange?: (s: {
    projectPath: string | null; projectName: string | null; projectEncodedDir: string | null
    sessionId: string | null; messages: ClaudeChatMessage[]
  }) => void
}

/** Parses filter query params from a nav path like /costs?projects=path1|path2 */
function parseNavFilters(path: string): { cleanPath: string; projects: string[] | null } {
  const qIdx = path.indexOf('?')
  if (qIdx === -1) return { cleanPath: path, projects: null }
  const cleanPath = path.slice(0, qIdx)
  const params = new URLSearchParams(path.slice(qIdx + 1))
  const projectsRaw = params.get('projects')
  if (!projectsRaw) return { cleanPath, projects: null }
  const projects = projectsRaw.split('|').map(p => p.trim()).filter(Boolean)
  return { cleanPath, projects: projects.length > 0 ? projects : null }
}

/** Returns true if any filter is non-default */
function hasActiveFilters(filters: Filters): boolean {
  return (
    filters.dateRange !== 'all' ||
    filters.customStart !== '' ||
    filters.customEnd !== '' ||
    filters.projects.length > 0 ||
    filters.models.length > 0
  )
}

interface PendingNavigation {
  cleanPath: string
  newProjects: string[]
}

export function TtyChat({ lang, chatModel, chatSoundEnabled, onModelSet, filters, setFilters, isMobile, onDetachClaude, claudeSharedState, onClaudeStateChange }: TtyChatProps) {
  const navigate = useNavigate()
  const [pendingNav, setPendingNav] = useState<PendingNavigation | null>(null)

  const handleNavigate = useCallback((path: string) => {
    const { cleanPath, projects } = parseNavFilters(path)
    if (projects && projects.length > 0) {
      // Filter data in the link — check if current filters would be overwritten
      if (hasActiveFilters(filters)) {
        setPendingNav({ cleanPath, newProjects: projects })
        return
      }
      // No active filters — apply silently and navigate
      setFilters(prev => ({ ...prev, projects }))
      navigate(cleanPath)
      setOpen(false)
      return
    }
    navigate(cleanPath)
    setOpen(false)
  }, [navigate, filters, setFilters])

  const [open, setOpen] = useState(false)
  const [fullscreen, setFullscreen] = useState(false)
  const [activeTab, setActiveTab] = useState<'nay' | 'claude'>('nay')
  // Incremented to force ClaudeChat to remount with fresh initial props
  const [claudeResetKey, setClaudeResetKey] = useState(0)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [streaming, setStreaming] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [hasUnread, setHasUnread] = useState(false)
  const [currentTools, setCurrentTools] = useState<string[]>([])
  const [showHistory, setShowHistory] = useState(false)
  const [historyList, setHistoryList] = useState<NaySessionSummary[]>([])
  const [historyLoading, setHistoryLoading] = useState(false)
  const [sessionId, setSessionId] = useState<string | null>(null)
  // Track which historical Nay session is being viewed (for live polling)
  const [viewedNaySessionId, setViewedNaySessionId] = useState<string | null>(null)

  const [nayAttachments, setNayAttachments] = useState<NayAttachment[]>([])
  const nayFileInputRef = useRef<HTMLInputElement>(null)

  const listRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const openRef = useRef(open)
  const soundRef = useRef(chatSoundEnabled)
  const audioCtxRef = useRef<AudioContext | null>(null)

  // playNotification uses the stored AudioContext
  const playNotification = useCallback(createPlayFn(audioCtxRef), [])

  useEffect(() => { openRef.current = open }, [open])
  useEffect(() => { soundRef.current = chatSoundEnabled }, [chatSoundEnabled])

  // Track visual viewport (keyboard-aware) for mobile panel positioning
  const [vpRect, setVpRect] = useState({ top: 0, height: typeof window !== 'undefined' ? window.innerHeight : 844 })
  useEffect(() => {
    if (!isMobile) return
    const vv = window.visualViewport
    if (!vv) return
    function update() { setVpRect({ top: Math.round(vv!.offsetTop), height: Math.round(vv!.height) }) }
    update()
    vv.addEventListener('resize', update)
    vv.addEventListener('scroll', update)
    return () => { vv.removeEventListener('resize', update); vv.removeEventListener('scroll', update) }
  }, [isMobile])

  // Scroll messages to bottom when viewport resizes (keyboard appears)
  useEffect(() => {
    if (!isMobile || !open) return
    if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight
  }, [vpRect.height, isMobile, open])

  // External open trigger: dispatched by RecentSessions "open in Claude/Nay" button
  useEffect(() => {
    const handler = (e: Event) => {
      const { tab, project, sessionId: targetSessionId } = (e as CustomEvent<{
        tab: 'nay' | 'claude'
        sessionId?: string
        project?: { path: string; name: string; encodedDir: string }
      }>).detail

      setOpen(true)

      if (tab === 'nay') {
        setActiveTab('nay')
        if (targetSessionId) {
          // Load the specific Nay session history
          setError(null)
          setHistoryLoading(true)
          fetch(`/api/nay-sessions/${targetSessionId}`)
            .then(r => r.ok ? r.json() : [])
            .then((msgs: RawSessionMessage[]) => {
              setMessages(expandHistoryBlob(msgs))
              setSessionId(targetSessionId)
            })
            .catch(() => {})
            .finally(() => setHistoryLoading(false))
        }
      } else if (tab === 'claude' && project) {
        if (targetSessionId) {
          // Fetch messages FIRST, then switch tab so ClaudeChat mounts with data ready
          fetch(`/api/claude-sessions/${targetSessionId}?encodedDir=${encodeURIComponent(project.encodedDir)}`)
            .then(r => r.ok ? r.json() : [])
            .then((msgs: Array<{ role: 'user' | 'assistant'; content: string; timestamp: number; tools?: string[] }>) => {
              onClaudeStateChange?.({
                projectPath: project.path,
                projectName: project.name,
                projectEncodedDir: project.encodedDir,
                sessionId: targetSessionId,
                messages: msgs,
              })
              setClaudeResetKey(k => k + 1)
              setActiveTab('claude')
            })
            .catch(() => {
              onClaudeStateChange?.({
                projectPath: project.path,
                projectName: project.name,
                projectEncodedDir: project.encodedDir,
                sessionId: targetSessionId,
                messages: [],
              })
              setClaudeResetKey(k => k + 1)
              setActiveTab('claude')
            })
        } else {
          onClaudeStateChange?.({
            projectPath: project.path,
            projectName: project.name,
            projectEncodedDir: project.encodedDir,
            sessionId: null,
            messages: [],
          })
          setClaudeResetKey(k => k + 1)
          setActiveTab('claude')
        }
      }
    }
    window.addEventListener('agentistics:open-chat', handler)
    return () => window.removeEventListener('agentistics:open-chat', handler)
  }, [onClaudeStateChange])

  // Update browser tab title to indicate unread Nay message
  useEffect(() => {
    const BASE_TITLE = 'Agentistics'
    if (hasUnread && !open) {
      document.title = `💬 Nay · ${BASE_TITLE}`
    } else {
      document.title = BASE_TITLE
    }
    return () => { document.title = BASE_TITLE }
  }, [hasUnread, open])

  useEffect(() => {
    if (open) { setHasUnread(false); inputRef.current?.focus({ preventScroll: true }) }
  }, [open])

  useEffect(() => {
    if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight
  }, [messages, streaming, currentTools])

  // Poll for new messages on historical Nay sessions (real-time view)
  useEffect(() => {
    if (!viewedNaySessionId || streaming) return
    const id = setInterval(async () => {
      try {
        const res = await fetch(`/api/nay-sessions/${viewedNaySessionId}`)
        if (!res.ok) return
        const fresh: Array<{ role: 'user' | 'assistant'; content: string; timestamp: number; tools?: string[] }> = await res.json()
        setMessages(prev => fresh.length > prev.length ? fresh.map(m => ({ ...m, terminal: false })) : prev)
      } catch { /* ignore */ }
    }, 3000)
    return () => clearInterval(id)
  }, [viewedNaySessionId, streaming])

  const openHistory = async () => {
    setShowHistory(true)
    setHistoryLoading(true)
    try {
      const res = await fetch('/api/nay-sessions')
      if (res.ok) setHistoryList(await res.json() as NaySessionSummary[])
    } catch { /* ignore */ }
    finally { setHistoryLoading(false) }
  }

  const restoreConversation = async (id: string) => {
    setShowHistory(false)
    setError(null)
    setHistoryLoading(true)
    try {
      const res = await fetch(`/api/nay-sessions/${id}`)
      if (res.ok) {
        const msgs = await res.json() as RawSessionMessage[]
        setMessages(expandHistoryBlob(msgs))
        setSessionId(id)   // use --resume for next messages to avoid re-sending history as blob
        setViewedNaySessionId(id)
      }
    } catch { /* ignore */ }
    finally { setHistoryLoading(false) }
  }

  const newConversation = () => {
    setMessages([])
    setSessionId(null)
    setError(null)
    setShowHistory(false)
    setViewedNaySessionId(null)
  }

  const initAudio = () => {
    if (!audioCtxRef.current) {
      try { audioCtxRef.current = new AudioContext() } catch { /* ignore */ }
    }
    // Resume during user gesture so background playback works without further gestures
    audioCtxRef.current?.resume().catch(() => { /* ignore */ })
  }

  const handleFabClick = () => {
    initAudio()
    setOpen(v => !v)
  }

  const handleNayPaste = useCallback((e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const imageItem = Array.from(e.clipboardData.items).find(i => i.type.startsWith('image/'))
    if (!imageItem) return
    e.preventDefault()
    const blob = imageItem.getAsFile()
    if (!blob) return
    const reader = new FileReader()
    reader.onload = ev => {
      const dataUrl = ev.target?.result as string
      setNayAttachments(prev => [...prev, {
        id: crypto.randomUUID(),
        name: `screenshot.${imageItem.type.split('/')[1] ?? 'png'}`,
        mimeType: imageItem.type,
        data: dataUrl.split(',')[1]!,
        isImage: true,
        preview: dataUrl,
      }])
    }
    reader.readAsDataURL(blob)
  }, [])

  const handleNayFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    for (const file of Array.from(e.target.files ?? [])) {
      const reader = new FileReader()
      if (file.type.startsWith('image/')) {
        reader.onload = ev => {
          const dataUrl = ev.target?.result as string
          setNayAttachments(prev => [...prev, {
            id: crypto.randomUUID(), name: file.name, mimeType: file.type,
            data: dataUrl.split(',')[1]!, isImage: true, preview: dataUrl,
          }])
        }
        reader.readAsDataURL(file)
      } else {
        reader.onload = ev => {
          setNayAttachments(prev => [...prev, {
            id: crypto.randomUUID(), name: file.name, mimeType: file.type || 'text/plain',
            data: ev.target?.result as string, isImage: false,
          }])
        }
        reader.readAsText(file)
      }
    }
    e.target.value = ''
  }, [])

  const execCmd = useCallback(async (command: string) => {
    const cmdMsg: ChatMessage = { role: 'user', content: `$ ${command}`, terminal: false, timestamp: Date.now() }
    setMessages(prev => {
      const outMsg: ChatMessage = { role: 'assistant', content: '', terminal: true, timestamp: Date.now() }
      return [...prev, cmdMsg, outMsg]
    })
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
            const ev = JSON.parse(line) as { text?: string; exitCode?: number; done?: boolean; error?: string }
            if (ev.error) { setError(ev.error); break }
            if (ev.text) {
              accum += ev.text
              setMessages(prev => {
                const copy = [...prev]
                const last = copy[copy.length - 1]
                if (last?.terminal) copy[copy.length - 1] = { ...last, content: accum }
                return copy
              })
            }
            if (ev.done) {
              setMessages(prev => {
                const copy = [...prev]
                const last = copy[copy.length - 1]
                if (last?.terminal) copy[copy.length - 1] = { ...last, content: accum, exitCode: ev.exitCode ?? 0 }
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
  }, [])

  const sendMessage = useCallback(async (overrideText?: string) => {
    const text = (overrideText ?? input).trim()
    const hasAttachments = nayAttachments.length > 0
    if ((!text && !hasAttachments) || streaming) return
    if (!overrideText) {
      setInput('')
      if (inputRef.current) inputRef.current.style.height = 'auto'
    }
    setError(null)
    setCurrentTools([])
    setShowHistory(false)
    setViewedNaySessionId(null) // user is now in live chat mode, stop polling historical session

    if (text.startsWith('!') && text.length > 1) {
      await execCmd(text.slice(1).trimStart())
      return
    }

    const pendingAttachments = nayAttachments
    setNayAttachments([])

    const model = chatModel ?? DEFAULT_CHAT_MODEL
    const userMsg: ChatMessage = {
      role: 'user', content: text, timestamp: Date.now(),
      images: pendingAttachments.filter(a => a.isImage).map(a => a.preview!),
      files: pendingAttachments.filter(a => !a.isImage).map(a => a.name),
    }
    const history = messages.filter(m => !m.terminal).map(m => ({ role: m.role, content: m.content }))

    setMessages(prev => [
      ...prev,
      userMsg,
      { role: 'assistant', content: '', timestamp: Date.now() },
    ])
    setStreaming(true)

    let accum = ''
    let toolsAccum: string[] = []

    try {
      const res = await fetch('/api/chat-tty', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: text, history, model, sessionId,
          attachments: pendingAttachments.length > 0
            ? pendingAttachments.map(a => ({ name: a.name, mimeType: a.mimeType, data: a.data, isImage: a.isImage }))
            : undefined,
        }),
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
            const ev = JSON.parse(line) as { text?: string; tool?: string; done?: boolean; error?: string; sessionId?: string }
            if (ev.sessionId) setSessionId(ev.sessionId)
            if (ev.error) { setError(ev.error); setStreaming(false); return }
            if (ev.tool) {
              toolsAccum = [...toolsAccum, ev.tool]
              setCurrentTools(toolsAccum)
            }
            if (ev.text) {
              accum += ev.text
              setMessages(prev => {
                const copy = [...prev]
                const last = copy[copy.length - 1]
                if (last?.role === 'assistant' && !last.terminal) {
                  copy[copy.length - 1] = { ...last, content: accum }
                }
                return copy
              })
            }
            if (ev.done) {
              setMessages(prev => {
                const copy = [...prev]
                const last = copy[copy.length - 1]
                if (last?.role === 'assistant' && !last.terminal) {
                  copy[copy.length - 1] = { ...last, content: accum, tools: toolsAccum.length > 0 ? toolsAccum : undefined }
                }
                return copy
              })
              setCurrentTools([])
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
      setCurrentTools([])
    }
  }, [input, streaming, messages, chatModel, sessionId, execCmd, playNotification, nayAttachments]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Mobile: Enter = newline, send button sends. Desktop: Enter sends, Shift+Enter = newline.
    if (!isMobile && e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage() }
  }

  const clearChat = () => { setMessages([]); setSessionId(null); setError(null); setStreaming(false); setHasUnread(false); setCurrentTools([]) }

  const pt = lang === 'pt'
  const effectiveModel = chatModel ?? DEFAULT_CHAT_MODEL
  const modelInfo = CHAT_MODELS.find(m => m.id === effectiveModel)

  const panelStyle: React.CSSProperties = isMobile
    ? { position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, width: 'auto', height: 'auto' }
    : fullscreen
      ? { position: 'fixed', inset: 16, width: 'auto', height: 'auto' }
      : { position: 'fixed', bottom: 80, right: 24, width: 400, height: 580, maxHeight: 'calc(100vh - 120px)' }

  // Detect if currently streaming an assistant message (last message is empty assistant waiting)
  const lastMsg = messages[messages.length - 1]
  const isAssistantStreaming = streaming && lastMsg?.role === 'assistant' && !lastMsg.terminal

  // Show confirm buttons if last completed assistant message looks like a permission request
  const lastCompletedAssistant = !streaming
    ? [...messages].reverse().find(m => m.role === 'assistant' && !m.terminal && m.content)
    : undefined
  const showConfirmBar = !!lastCompletedAssistant && looksLikeConfirmRequest(lastCompletedAssistant.content)

  return (
    <>
      <style>{`
        @keyframes ttyChatSpin    { from{transform:rotate(0deg)} to{transform:rotate(360deg)} }
        @keyframes ttyChatFadeIn  { from{opacity:0;transform:translateY(4px)} to{opacity:1;transform:none} }
        @keyframes ttyChatSlideIn { from{opacity:0;transform:translateX(18px)} to{opacity:1;transform:none} }
        @keyframes ttyChatBlink   { 0%,100%{opacity:1} 50%{opacity:0} }
        @keyframes ttyChatPulse   { 0%,100%{box-shadow:0 4px 18px rgba(0,0,0,0.35),0 0 0 0 rgba(245,158,11,0.5)} 50%{box-shadow:0 4px 18px rgba(0,0,0,0.35),0 0 0 8px rgba(245,158,11,0)} }
        @media (hover: hover) {
          .tty-fab:hover { border-color: var(--anthropic-orange) !important; color: var(--anthropic-orange) !important; }
          .tty-icon-btn:hover { color: var(--text-primary) !important; border-color: var(--text-secondary) !important; }
          .tty-send-btn:hover:not(:disabled) { background: var(--anthropic-orange) !important; color: #fff !important; }
        }
        .tty-send-btn:active:not(:disabled) { background: var(--anthropic-orange) !important; color: #fff !important; }
      `}</style>

      {/* FAB */}
      <button
        className="tty-fab"
        onClick={handleFabClick}
        title={pt ? 'Chat com Nay' : 'Chat with Nay'}
        style={{
          position: 'fixed', bottom: isMobile ? 68 : 24, right: 24, zIndex: 300,
          width: 46, height: 46, borderRadius: '50%',
          border: hasUnread && !open
            ? '1.5px solid var(--anthropic-orange)'
            : open ? '1.5px solid var(--anthropic-orange)' : '1.5px solid var(--border)',
          background: hasUnread && !open
            ? 'var(--anthropic-orange-dim)'
            : open ? 'var(--anthropic-orange-dim)' : 'var(--bg-card)',
          color: hasUnread && !open ? 'var(--anthropic-orange)' : open ? 'var(--anthropic-orange)' : 'var(--text-secondary)',
          cursor: 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          animation: hasUnread && !open ? 'ttyChatPulse 1.8s ease-in-out infinite' : undefined,
          transition: 'all 0.2s',
          overflow: 'hidden',
          padding: 0,
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

      {/* Panel */}
      {open && (
        <div style={{
          ...panelStyle,
          zIndex: 400,
          position: 'fixed',
          display: 'flex', flexDirection: 'column',
          background: 'var(--bg-surface)',
          border: isMobile ? 'none' : '1px solid var(--border)',
          borderRadius: isMobile ? 0 : 14,
          boxShadow: isMobile ? 'none' : '0 10px 48px rgba(0,0,0,0.45)',
          overflow: 'hidden',
          animation: isMobile ? undefined : 'ttyChatSlideIn 0.18s ease-out',
        }}>

          {chatModel === null && (
            <ModelPicker lang={lang} onPick={onModelSet} />
          )}

          {/* Header */}
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '10px 14px', borderBottom: '1px solid var(--border)',
            background: 'var(--bg-card)', flexShrink: 0,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
              <div style={{
                width: 30, height: 30, borderRadius: 8, overflow: 'hidden', flexShrink: 0,
                background: 'var(--bg-elevated)', border: '1px solid var(--border)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                <img src="/minimalistLogo.png" alt="Nay" style={{ width: 22, height: 22, objectFit: 'contain' }} />
              </div>
              <div>
                <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)', lineHeight: 1.2 }}>
                  Nay
                </div>
                <div style={{ fontSize: 10, color: 'var(--text-tertiary)', display: 'flex', alignItems: 'center', gap: 4 }}>
                  {streaming ? (
                    <span style={{ color: 'var(--anthropic-orange)', display: 'flex', alignItems: 'center', gap: 4 }}>
                      <Loader size={8} style={{ animation: 'ttyChatSpin 1s linear infinite' }} />
                      {currentTools.length > 0
                        ? formatToolName(currentTools[currentTools.length - 1]!)
                        : (pt ? 'pensando...' : 'thinking...')}
                    </span>
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
                <button className="tty-icon-btn" onClick={clearChat} title={pt ? 'Nova conversa' : 'New conversation'} style={iconBtnStyle}>
                  <Plus size={12} />
                </button>
              )}
              <button
                className="tty-icon-btn"
                onClick={openHistory}
                title={pt ? 'Histórico de conversas' : 'Conversation history'}
                style={{ ...iconBtnStyle, color: showHistory ? 'var(--anthropic-orange)' : 'var(--text-secondary)' }}
              >
                <History size={12} />
              </button>
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

          {/* Tab bar */}
          <div style={{
            display: 'flex', borderBottom: '1px solid var(--border)',
            background: 'var(--bg-card)', flexShrink: 0,
          }}>
            {(['nay', 'claude'] as const).map(tab => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                style={{
                  flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                  padding: '7px 0', border: 'none', background: 'transparent',
                  cursor: 'pointer', fontFamily: 'inherit', fontSize: 12, fontWeight: activeTab === tab ? 700 : 400,
                  color: activeTab === tab ? (tab === 'nay' ? 'var(--anthropic-orange)' : 'var(--accent-purple)') : 'var(--text-tertiary)',
                  borderBottom: activeTab === tab
                    ? `2px solid ${tab === 'nay' ? 'var(--anthropic-orange)' : 'var(--accent-purple)'}`
                    : '2px solid transparent',
                  transition: 'all 0.15s',
                }}
              >
                <img
                  src={tab === 'nay' ? '/minimalistLogo.png' : '/claudeLogo.png'}
                  alt={tab}
                  style={{ width: 14, height: 14, objectFit: 'contain' }}
                />
                {tab === 'nay' ? 'Nay' : 'Claude'}
              </button>
            ))}
          </div>

          {activeTab === 'nay' && <>

          {/* History panel */}
          {showHistory && (
            <div style={{
              position: 'absolute', inset: 0, top: 52, zIndex: 10,
              background: 'var(--bg-surface)',
              display: 'flex', flexDirection: 'column',
              borderTop: '1px solid var(--border)',
              animation: 'ttyChatFadeIn 0.15s ease-out',
            }}>
              <div style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '10px 14px', borderBottom: '1px solid var(--border)',
                background: 'var(--bg-card)', flexShrink: 0,
              }}>
                <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: 6 }}>
                  <History size={12} style={{ color: 'var(--anthropic-orange)' }} />
                  {pt ? 'Histórico' : 'History'}
                </span>
                <div style={{ display: 'flex', gap: 6 }}>
                  <button
                    onClick={newConversation}
                    style={{
                      fontSize: 11, padding: '4px 10px', borderRadius: 6,
                      border: '1px solid var(--anthropic-orange)60',
                      background: 'var(--anthropic-orange-dim)', color: 'var(--anthropic-orange)',
                      cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4,
                    }}
                  >
                    <Plus size={10} />
                    {pt ? 'Nova' : 'New'}
                  </button>
                  <button onClick={() => setShowHistory(false)} className="tty-icon-btn" style={iconBtnStyle}>
                    <X size={12} />
                  </button>
                </div>
              </div>

              <div style={{ flex: 1, overflowY: 'auto', padding: '8px' }}>
                {historyLoading ? (
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--text-tertiary)' }}>
                    <Loader size={16} style={{ animation: 'ttyChatSpin 1s linear infinite' }} />
                  </div>
                ) : historyList.length === 0 ? (
                  <div style={{
                    height: '100%', display: 'flex', flexDirection: 'column',
                    alignItems: 'center', justifyContent: 'center',
                    color: 'var(--text-tertiary)', fontSize: 12, gap: 6,
                  }}>
                    <History size={28} style={{ opacity: 0.2 }} />
                    {pt ? 'Nenhuma conversa ainda' : 'No conversations yet'}
                  </div>
                ) : historyList.map(convo => (
                  <div
                    key={convo.id}
                    onClick={() => restoreConversation(convo.id)}
                    style={{
                      padding: '9px 10px', borderRadius: 8, marginBottom: 4,
                      cursor: 'pointer',
                      background: convo.id === sessionId ? 'var(--anthropic-orange-dim)' : 'var(--bg-card)',
                      border: convo.id === sessionId ? '1px solid var(--anthropic-orange)40' : '1px solid var(--border)',
                      display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8,
                      transition: 'background 0.12s',
                    }}
                  >
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{
                        fontSize: 12, fontWeight: 600, color: 'var(--text-primary)',
                        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                        lineHeight: 1.4,
                      }}>
                        {convo.title}
                      </div>
                      <div style={{ fontSize: 10, color: 'var(--text-tertiary)', marginTop: 3, display: 'flex', gap: 6 }}>
                        <span>{new Date(convo.updatedAt).toLocaleDateString(lang === 'pt' ? 'pt-BR' : 'en-US', { day: '2-digit', month: 'short' })}</span>
                        <span>·</span>
                        <span>{convo.messageCount} {pt ? 'msgs' : 'msgs'}</span>
                        {convo.model && (
                          <>
                            <span>·</span>
                            <span>{CHAT_MODELS.find(m => m.id === convo.model)?.label ?? convo.model}</span>
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Messages */}
          <div ref={listRef} style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '14px 14px 6px' }}>
            {messages.length === 0 && !streaming && (
              <div style={{
                height: '100%', display: 'flex', flexDirection: 'column',
                alignItems: 'center', justifyContent: 'center',
                gap: 10, color: 'var(--text-tertiary)', textAlign: 'center', padding: '0 20px',
              }}>
                <img src="/minimalistLogo.png" alt="Nay" style={{ width: 36, height: 36, objectFit: 'contain', opacity: 0.3 }} />
                <div style={{ fontSize: 13, fontWeight: 600 }}>
                  {pt ? 'Olá! Sou o Nay' : 'Hi! I\'m Nay'}
                </div>
                <div style={{ fontSize: 11, lineHeight: 1.65, opacity: 0.7 }}>
                  {pt
                    ? 'Analiso custos, sessões, projetos e crio layouts personalizados.'
                    : 'I can analyze costs, sessions, projects and build custom layouts.'}
                </div>
                <div style={{
                  marginTop: 4, background: 'var(--bg-elevated)',
                  border: '1px solid var(--border)', borderRadius: 8,
                  padding: '8px 12px', fontSize: 11, color: 'var(--text-tertiary)',
                  textAlign: 'left', lineHeight: 1.8,
                }}>
                  <code style={{ color: 'var(--accent-green)' }}>!ls -la</code>{' '}
                  {pt ? '— executa comando' : '— run a command'}<br />
                  <code style={{ color: 'var(--accent-green)' }}>!pwd</code>{' '}
                  {pt ? '— atalho bash' : '— bash shortcut'}
                </div>
              </div>
            )}

            {/* Sticky user-message context while assistant is streaming */}
            {streaming && (() => {
              const lastUser = [...messages].reverse().find(m => m.role === 'user' && !m.terminal)
              if (!lastUser) return null
              const preview = lastUser.content.length > 100
                ? lastUser.content.slice(0, 100) + '…'
                : lastUser.content
              return (
                <div style={{
                  position: 'sticky', top: 0, zIndex: 4,
                  margin: '-14px -14px 10px -14px',
                  background: 'var(--bg-card)',
                  borderBottom: '1px solid var(--border)',
                  padding: '7px 14px',
                  display: 'flex', alignItems: 'center', gap: 8,
                }}>
                  <span style={{ fontSize: 10, color: 'var(--anthropic-orange)', fontWeight: 700, flexShrink: 0, letterSpacing: '0.04em' }}>
                    ↑
                  </span>
                  {lastUser.images && lastUser.images.length > 0 && (
                    <img src={lastUser.images[0]} alt=""
                      style={{ width: 22, height: 22, borderRadius: 4, objectFit: 'cover', flexShrink: 0 }} />
                  )}
                  <span style={{ fontSize: 11, color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {preview || (lastUser.images?.length ? `[image]` : '')}
                  </span>
                </div>
              )
            })()}

            {messages.map((msg, i) => {
              const isLast = i === messages.length - 1
              return (
                <Message
                  key={i}
                  msg={msg}
                  isLiveStreaming={isLast && streaming ? true : undefined}
                  currentTools={isLast && streaming ? currentTools : undefined}
                  onRun={execCmd}
                  onNavigate={handleNavigate}
                  pt={pt}
                />
              )
            })}

            {showConfirmBar && (
              <ConfirmBar
                pt={pt}
                onConfirm={() => sendMessage(pt ? 'Sim, pode prosseguir.' : 'Yes, proceed.')}
                onCancel={() => sendMessage(pt ? 'Não, cancele.' : 'No, cancel.')}
              />
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

          {/* Input area */}
          <div style={{ borderTop: '1px solid var(--border)', background: 'var(--bg-card)', flexShrink: 0 }}>
            {/* Attachment strip */}
            {nayAttachments.length > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, padding: '6px 12px 0' }}>
                {nayAttachments.map(att => (
                  <div key={att.id} style={{ position: 'relative', borderRadius: 6, border: '1px solid var(--border)', overflow: 'hidden', background: 'var(--bg-elevated)' }}>
                    {att.isImage ? (
                      <img src={att.preview} alt={att.name} style={{ width: 52, height: 52, objectFit: 'cover', display: 'block' }} />
                    ) : (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '5px 8px', maxWidth: 120 }}>
                        <FileTextIcon size={12} style={{ color: 'var(--anthropic-orange)', flexShrink: 0 }} />
                        <span style={{ fontSize: 10, color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{att.name}</span>
                      </div>
                    )}
                    <button onMouseDown={e => { e.preventDefault(); setNayAttachments(prev => prev.filter(a => a.id !== att.id)) }}
                      style={{ position: 'absolute', top: 2, right: 2, width: 14, height: 14, borderRadius: '50%', background: 'rgba(0,0,0,0.55)', border: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: '#fff', padding: 0 }}>
                      <X size={8} />
                    </button>
                  </div>
                ))}
              </div>
            )}
            <input ref={nayFileInputRef} type="file" multiple accept="image/*,text/*,.md,.json,.ts,.js,.py,.txt,.csv" onChange={handleNayFileSelect} style={{ display: 'none' }} />
          <div style={{ padding: '10px 12px', display: 'flex', alignItems: 'flex-end', gap: 6 }}>
            <button className="tty-icon-btn" onClick={() => nayFileInputRef.current?.click()} title={pt ? 'Anexar arquivo' : 'Attach file'} style={{ ...iconBtnStyle, flexShrink: 0, width: 30, height: 30 }}>
              <Paperclip size={12} />
            </button>
            <textarea
              ref={inputRef}
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              onPaste={handleNayPaste}
              placeholder={pt ? 'Pergunte algo...' : 'Ask something...'}
              rows={1}
              disabled={streaming || chatModel === null}
              style={{
                flex: 1, resize: 'none',
                background: 'var(--bg-elevated)', border: '1px solid var(--border)',
                borderRadius: 8, padding: '8px 10px', fontSize: isMobile ? 16 : 13, fontFamily: 'inherit',
                color: 'var(--text-primary)', outline: 'none', lineHeight: 1.5,
                maxHeight: isMobile ? 80 : 120, overflowY: 'auto', transition: 'border-color 0.15s',
              }}
              onFocus={e => { e.currentTarget.style.borderColor = 'var(--anthropic-orange)60' }}
              onBlur={e => { e.currentTarget.style.borderColor = 'var(--border)' }}
              onInput={e => {
                const el = e.currentTarget
                el.style.height = 'auto'
                el.style.height = `${Math.min(el.scrollHeight, isMobile ? 80 : 120)}px`
              }}
            />
            <button
              className="tty-send-btn"
              onClick={() => sendMessage()}
              disabled={(!input.trim() && nayAttachments.length === 0) || streaming || chatModel === null}
              title={pt ? 'Enviar (Enter)' : 'Send (Enter)'}
              style={{
                width: 34, height: 34, borderRadius: 8, flexShrink: 0,
                border: '1px solid var(--anthropic-orange)60',
                background: 'var(--anthropic-orange-dim)', color: 'var(--anthropic-orange)',
                cursor: (input.trim() || nayAttachments.length > 0) && !streaming ? 'pointer' : 'not-allowed',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                opacity: (input.trim() || nayAttachments.length > 0) && !streaming && chatModel !== null ? 1 : 0.4,
                transition: 'all 0.15s',
              }}
            >
              {streaming
                ? <Loader size={14} style={{ animation: 'ttyChatSpin 1s linear infinite' }} />
                : input.trim().startsWith('!') && input.trim().length > 1
                  ? <Play size={14} />
                  : <Send size={14} />}
            </button>
          </div>
          </div>

          </>}

          {activeTab === 'claude' && (
            <ClaudeChat
              key={claudeResetKey}
              embedded
              lang={lang}
              onDetach={() => { onDetachClaude?.(); setActiveTab('nay') }}
              initialProject={claudeSharedState?.projectPath ? {
                path: claudeSharedState.projectPath,
                name: claudeSharedState.projectName ?? '',
                encodedDir: claudeSharedState.projectEncodedDir ?? '',
              } : null}
              initialSessionId={claudeSharedState?.sessionId ?? null}
              initialMessages={claudeSharedState?.messages ?? []}
              onStateChange={onClaudeStateChange}
            />
          )}

        </div>
      )}

      {/* Filter change confirmation dialog */}
      {pendingNav && (
        <div
          onClick={() => setPendingNav(null)}
          style={{
            position: 'fixed', inset: 0, zIndex: 600,
            background: 'rgba(0,0,0,0.55)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            padding: 24,
            backdropFilter: 'blur(4px)',
          }}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{
              background: 'var(--bg-card)',
              border: '1px solid var(--border)',
              borderRadius: 14,
              padding: '22px 24px',
              width: '100%',
              maxWidth: 360,
              boxShadow: '0 8px 40px rgba(0,0,0,0.45)',
              display: 'flex', flexDirection: 'column', gap: 16,
              animation: 'ttyChatFadeIn 0.18s ease-out',
            }}
          >
            {/* Header */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={{
                width: 30, height: 30,
                background: 'var(--anthropic-orange-dim)',
                borderRadius: 8,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                flexShrink: 0,
              }}>
                <Filter size={14} color="var(--anthropic-orange)" />
              </div>
              <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)' }}>
                {t('chat.filter_change_title', lang)}
              </span>
            </div>

            {/* Body */}
            <p style={{ fontSize: 13, color: 'var(--text-secondary)', margin: 0, lineHeight: 1.55 }}>
              {t('chat.filter_change_body', lang)}
            </p>

            {/* Current vs New */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {/* Current filter */}
              <div style={{
                padding: '10px 12px', borderRadius: 8,
                background: 'var(--bg-elevated)', border: '1px solid var(--border)',
              }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 6 }}>
                  {t('chat.filter_change_current', lang)}
                </div>
                <div style={{ fontSize: 12, color: 'var(--text-secondary)', display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                  {filters.projects.length > 0
                    ? filters.projects.map(p => (
                        <span key={p} style={{
                          padding: '2px 8px', borderRadius: 4,
                          background: 'var(--bg-card)', border: '1px solid var(--border)',
                          fontSize: 11, color: 'var(--text-primary)',
                          maxWidth: 280, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                        }}>
                          {p.split('/').pop() ?? p}
                        </span>
                      ))
                    : <span style={{ color: 'var(--text-tertiary)', fontStyle: 'italic' }}>
                        {t('chat.filter_change_all', lang)}
                      </span>
                  }
                </div>
              </div>

              {/* Arrow */}
              <div style={{ textAlign: 'center', color: 'var(--text-tertiary)', fontSize: 16 }}>↓</div>

              {/* New filter */}
              <div style={{
                padding: '10px 12px', borderRadius: 8,
                background: 'color-mix(in srgb, var(--anthropic-orange) 8%, transparent)',
                border: '1px solid var(--anthropic-orange)40',
              }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--anthropic-orange)', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 6 }}>
                  {t('chat.filter_change_new', lang)}
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                  {pendingNav.newProjects.map(p => (
                    <span key={p} style={{
                      padding: '2px 8px', borderRadius: 4,
                      background: 'var(--anthropic-orange-dim)', border: '1px solid var(--anthropic-orange)50',
                      fontSize: 11, color: 'var(--anthropic-orange)',
                      maxWidth: 280, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    }}>
                      {p.split('/').pop() ?? p}
                    </span>
                  ))}
                </div>
              </div>
            </div>

            {/* Buttons */}
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button
                onClick={() => setPendingNav(null)}
                style={{
                  padding: '8px 16px', borderRadius: 8, fontSize: 13, fontWeight: 600,
                  border: '1px solid var(--border)', background: 'transparent',
                  color: 'var(--text-secondary)', cursor: 'pointer', fontFamily: 'inherit',
                  transition: 'all 0.15s',
                }}
                onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--text-tertiary)'; e.currentTarget.style.color = 'var(--text-primary)' }}
                onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.color = 'var(--text-secondary)' }}
              >
                {t('chat.filter_change_cancel', lang)}
              </button>
              <button
                onClick={() => {
                  setFilters(prev => ({ ...prev, projects: pendingNav.newProjects }))
                  navigate(pendingNav.cleanPath)
                  setPendingNav(null)
                  setOpen(false)
                }}
                style={{
                  padding: '8px 16px', borderRadius: 8, fontSize: 13, fontWeight: 600,
                  border: '1px solid var(--anthropic-orange)',
                  background: 'var(--anthropic-orange-dim)', color: 'var(--anthropic-orange)',
                  cursor: 'pointer', fontFamily: 'inherit', transition: 'all 0.15s',
                  display: 'flex', alignItems: 'center', gap: 6,
                }}
                onMouseEnter={e => { e.currentTarget.style.opacity = '0.8' }}
                onMouseLeave={e => { e.currentTarget.style.opacity = '1' }}
              >
                <ArrowRight size={13} />
                {t('chat.filter_change_confirm', lang)}
              </button>
            </div>
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
