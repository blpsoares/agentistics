import React, { useState, useRef, useEffect, useCallback } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import {
  X, Send, Loader, AlertCircle, Minus,
  Wrench, ChevronDown, ChevronUp, Brain, FolderOpen, Check, History,
  MessageSquarePlus, Clock, ExternalLink, Paperclip, Image as ImageIcon,
  FileText, Server, Plug,
} from 'lucide-react'
import { CHAT_MODELS, type ChatModelId, DEFAULT_CHAT_MODEL } from '../lib/chatModels'
import { formatToolName, fmtTime } from '../lib/chatUtils'

// ── Attachment type ───────────────────────────────────────────────────────────

type Attachment = {
  id: string
  name: string
  mimeType: string
  data: string     // base64 for images, plain text for files
  isImage: boolean
  preview?: string // data URL for display
}

type Lang = 'pt' | 'en'

type ThinkingBudget = false | 8000 | 16000 | 32000

const THINKING_CYCLE: ThinkingBudget[] = [false, 8000, 16000, 32000]

function nextThinkingBudget(current: ThinkingBudget): ThinkingBudget {
  const idx = THINKING_CYCLE.indexOf(current)
  return THINKING_CYCLE[(idx + 1) % THINKING_CYCLE.length]!
}

function thinkingLabel(budget: ThinkingBudget): string {
  if (!budget) return ''
  if (budget === 8000) return '8K'
  if (budget === 16000) return '16K'
  return '32K'
}

export type ChatMessage = {
  role: 'user' | 'assistant'
  content: string
  timestamp: number
  tools?: string[]
  images?: string[]  // data URLs of attached images (user messages)
  files?: string[]   // attached file names (user messages)
}

const BADGE_COLORS: Record<string, string> = {
  Fast:     'var(--accent-green)',
  Balanced: 'var(--anthropic-orange)',
  Powerful: 'var(--accent-purple)',
}

// ── Persist position/size to localStorage ─────────────────────────────────────

const POS_KEY  = 'agentistics-claude-chat-pos'
const SIZE_KEY = 'agentistics-claude-chat-size'

function loadPos(): { x: number; y: number } {
  try {
    const raw = localStorage.getItem(POS_KEY)
    if (raw) return JSON.parse(raw) as { x: number; y: number }
  } catch { /* ignore */ }
  return {
    x: Math.max(0, window.innerWidth / 2 - 240),
    y: 80,
  }
}

function loadSize(): { w: number; h: number } {
  try {
    const raw = localStorage.getItem(SIZE_KEY)
    if (raw) return JSON.parse(raw) as { w: number; h: number }
  } catch { /* ignore */ }
  return { w: 480, h: 580 }
}

function savePos(pos: { x: number; y: number }) {
  try { localStorage.setItem(POS_KEY, JSON.stringify(pos)) } catch { /* ignore */ }
}

function saveSize(size: { w: number; h: number }) {
  try { localStorage.setItem(SIZE_KEY, JSON.stringify(size)) } catch { /* ignore */ }
}

// ── Markdown renderer (self-contained, based on TtyChat patterns) ─────────────

interface CodeBlockProps { lang: string; code: string }

function ClaudeCodeBlock({ lang: codeLang, code }: CodeBlockProps) {
  return (
    <div style={{ position: 'relative', margin: '6px 0' }}>
      <pre style={{
        background: 'var(--bg-base)', border: '1px solid var(--border)',
        borderRadius: 6, padding: '10px 12px',
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
    </div>
  )
}

function ClaudeMarkdown({ text }: { text: string }) {
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
          return <ClaudeCodeBlock lang={lang} code={code} />
        },
        a({ href, children }) {
          return (
            <a href={href} target="_blank" rel="noopener noreferrer"
              style={{ color: 'var(--accent-purple)' }}>
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
              borderLeft: '3px solid var(--accent-purple)60',
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

// ── Tool activity ─────────────────────────────────────────────────────────────

function ClaudeToolActivity({ tools, live }: { tools: string[]; live: boolean }) {
  const [expanded, setExpanded] = useState(false)
  if (tools.length === 0) return null
  const label = live
    ? formatToolName(tools[tools.length - 1]!)
    : `${tools.length} action${tools.length > 1 ? 's' : ''} taken`

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
          ? <Loader size={10} style={{ animation: 'claudeChatSpin 1s linear infinite', flexShrink: 0, color: 'var(--accent-purple)' }} />
          : <Wrench size={10} style={{ flexShrink: 0 }} />
        }
        <span style={{ flex: 1, color: live ? 'var(--accent-purple)' : 'var(--text-tertiary)' }}>{label}</span>
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

function ClaudeChatMessage({
  msg, isLiveStreaming, currentTools, thinking,
}: {
  msg: ChatMessage
  isLiveStreaming?: boolean
  currentTools?: string[]
  thinking?: ThinkingBudget
}) {
  const isUser = msg.role === 'user'

  const timeEl = (
    <span style={{ fontSize: 10, color: 'var(--text-tertiary)', marginTop: 4, display: 'block', textAlign: isUser ? 'right' : 'left' }}>
      {fmtTime(msg.timestamp)}
    </span>
  )

  if (isUser) {
    return (
      <div style={{
        display: 'flex', flexDirection: 'column', alignItems: 'flex-end',
        marginBottom: 14, animation: 'claudeChatFadeIn 0.15s ease-out',
      }}>
        {/* Image thumbnails */}
        {msg.images && msg.images.length > 0 && (
          <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', justifyContent: 'flex-end', marginBottom: 5, maxWidth: '90%' }}>
            {msg.images.map((src, i) => (
              <img key={i} src={src} alt="attachment"
                style={{ maxWidth: 180, maxHeight: 130, borderRadius: 8, objectFit: 'cover',
                  border: '1px solid color-mix(in srgb, var(--accent-purple) 30%, transparent)' }} />
            ))}
          </div>
        )}
        {/* File name chips */}
        {msg.files && msg.files.length > 0 && (
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', justifyContent: 'flex-end', marginBottom: 5 }}>
            {msg.files.map((name, i) => (
              <span key={i} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11,
                padding: '2px 8px', borderRadius: 5, background: 'var(--bg-elevated)',
                border: '1px solid var(--border)', color: 'var(--text-secondary)' }}>
                <FileText size={10} /> {name}
              </span>
            ))}
          </div>
        )}
        <div style={{
          maxWidth: '90%', padding: '8px 14px',
          borderRadius: '14px 14px 4px 14px',
          background: 'color-mix(in srgb, var(--accent-purple) 12%, transparent)',
          border: '1px solid color-mix(in srgb, var(--accent-purple) 25%, transparent)',
          fontSize: 13, color: 'var(--text-primary)', lineHeight: 1.58, wordBreak: 'break-word',
        }}>
          <ClaudeMarkdown text={msg.content} />
        </div>
        {timeEl}
      </div>
    )
  }

  // Assistant message
  const toolsToShow = isLiveStreaming ? currentTools : msg.tools
  const isThinking = isLiveStreaming && thinking && thinking > 0 && !msg.content

  return (
    <div style={{
      display: 'flex', alignItems: 'flex-start', gap: 8,
      marginBottom: 14, animation: 'claudeChatFadeIn 0.15s ease-out',
    }}>
      {/* Avatar */}
      <div style={{
        width: 34, height: 34, borderRadius: '50%', flexShrink: 0,
        background: 'var(--bg-elevated)', border: '1px solid var(--border)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        overflow: 'hidden', marginTop: 2,
      }}>
        <img src="/claudeLogo.png" alt="Claude" style={{ width: 26, height: 26, objectFit: 'contain' }} />
      </div>

      {/* Content column */}
      <div style={{ flex: 1, minWidth: 0 }}>
        {toolsToShow && toolsToShow.length > 0 && (
          <ClaudeToolActivity tools={toolsToShow} live={!!isLiveStreaming} />
        )}
        {isThinking && (
          <div style={{
            display: 'inline-flex', alignItems: 'center', gap: 5,
            padding: '3px 8px', borderRadius: 5, marginBottom: 6,
            background: 'color-mix(in srgb, var(--accent-purple) 10%, transparent)',
            border: '1px solid color-mix(in srgb, var(--accent-purple) 25%, transparent)',
            fontSize: 11, color: 'var(--accent-purple)',
            animation: 'claudeChatPulse 1.8s ease-in-out infinite',
          }}>
            <Brain size={10} />
            thinking…
          </div>
        )}
        <div style={{
          padding: '10px 14px',
          borderRadius: '4px 14px 14px 14px',
          background: 'var(--bg-card)',
          border: '1px solid var(--border)',
          fontSize: 13, color: 'var(--text-primary)', lineHeight: 1.58, wordBreak: 'break-word',
        }}>
          {msg.content
            ? <ClaudeMarkdown text={msg.content} />
            : isLiveStreaming
              ? <span style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--text-tertiary)', fontSize: 12 }}>
                  <Loader size={11} style={{ animation: 'claudeChatSpin 1s linear infinite' }} />
                  Writing...
                </span>
              : null
          }
        </div>
        {timeEl}
      </div>
    </div>
  )
}

// ── MCP types ─────────────────────────────────────────────────────────────────

type McpServerInfo = {
  name: string
  command: string
  args: string[]
  env?: Record<string, string>
  scope: 'user' | 'project'
}

type McpPluginInfo = {
  id: string
  name: string
  registry: string
  enabled: boolean
}

type McpListResult = {
  servers: McpServerInfo[]
  plugins: McpPluginInfo[]
}

// ── Project picker ────────────────────────────────────────────────────────────

type ProjectEntry = { name: string; path: string; encodedDir: string; sessionCount: number }

function ProjectPicker({
  lang, onSelect, canClose, onClose,
}: {
  lang: Lang
  onSelect: (p: ProjectEntry) => void
  canClose?: boolean
  onClose?: () => void
}) {
  const [projects, setProjects] = useState<ProjectEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState('')
  const pt = lang === 'pt'

  useEffect(() => {
    fetch('/api/projects-list')
      .then(r => r.ok ? r.json() as Promise<ProjectEntry[]> : Promise.reject())
      .then(list => setProjects(list))
      .catch(() => setProjects([]))
      .finally(() => setLoading(false))
  }, [])

  const filtered = query.trim()
    ? projects.filter(p => p.name.toLowerCase().includes(query.toLowerCase()) || p.path.toLowerCase().includes(query.toLowerCase()))
    : projects

  return (
    <div style={{
      position: 'absolute', inset: 0, zIndex: 10,
      background: 'var(--bg-surface)', borderRadius: 'inherit',
      display: 'flex', flexDirection: 'column',
      padding: '16px 14px 14px',
      animation: 'claudeChatFadeIn 0.15s ease-out',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
        <FolderOpen size={16} style={{ color: 'var(--accent-purple)', flexShrink: 0 }} />
        <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)', flex: 1 }}>
          {pt ? 'Escolha um projeto' : 'Choose a project'}
        </span>
        {canClose && onClose && (
          <button onClick={onClose} style={{ ...iconBtnStyle, flexShrink: 0 }}>
            <X size={12} />
          </button>
        )}
      </div>

      <input
        autoFocus
        value={query}
        onChange={e => setQuery(e.target.value)}
        placeholder={pt ? 'Buscar projeto...' : 'Search project...'}
        style={{
          background: 'var(--bg-elevated)', border: '1px solid var(--border)',
          borderRadius: 7, padding: '7px 10px', fontSize: 12,
          color: 'var(--text-primary)', outline: 'none', fontFamily: 'inherit',
          marginBottom: 10, flexShrink: 0,
        }}
        onFocus={e => { e.currentTarget.style.borderColor = 'var(--accent-purple)60' }}
        onBlur={e => { e.currentTarget.style.borderColor = 'var(--border)' }}
      />

      <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 4 }}>
        {loading ? (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24, color: 'var(--text-tertiary)' }}>
            <Loader size={16} style={{ animation: 'claudeChatSpin 1s linear infinite' }} />
          </div>
        ) : filtered.length === 0 ? (
          <div style={{ padding: '16px 0', textAlign: 'center', color: 'var(--text-tertiary)', fontSize: 12 }}>
            {pt ? 'Nenhum projeto encontrado' : 'No projects found'}
          </div>
        ) : filtered.map(p => (
          <button
            key={p.path}
            onClick={() => onSelect(p)}
            style={{
              display: 'flex', alignItems: 'center', gap: 10,
              padding: '8px 10px', borderRadius: 8, textAlign: 'left',
              border: '1px solid var(--border)', background: 'transparent',
              cursor: 'pointer', fontFamily: 'inherit', transition: 'background 0.1s',
            }}
            onMouseEnter={e => { e.currentTarget.style.background = 'var(--bg-elevated)' }}
            onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}
          >
            <div style={{ width: 28, height: 28, borderRadius: 7, background: 'color-mix(in srgb, var(--accent-purple) 12%, transparent)', border: '1px solid color-mix(in srgb, var(--accent-purple) 25%, transparent)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              <FolderOpen size={13} style={{ color: 'var(--accent-purple)' }} />
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {p.name}
              </div>
              <div style={{ fontSize: 10, color: 'var(--text-tertiary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {p.path}
              </div>
            </div>
            <span style={{ fontSize: 10, color: 'var(--text-tertiary)', flexShrink: 0 }}>
              {p.sessionCount} {pt ? 'sess.' : 'sess.'}
            </span>
          </button>
        ))}
      </div>
    </div>
  )
}

// ── Session switcher ─────────────────────────────────────────────────────────

type ClaudeSessionSummary = {
  id: string
  title: string
  createdAt: string
  updatedAt: string
  messageCount: number
  model: string
}

type ClaudeSessionMessage = {
  role: 'user' | 'assistant'
  content: string
  timestamp: number
  tools?: string[]
}

function fmtRelDate(iso: string): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (isNaN(d.getTime())) return ''
  const now = Date.now()
  const diff = now - d.getTime()
  const min = Math.floor(diff / 60000)
  if (min < 60) return min <= 0 ? 'just now' : `${min}m ago`
  const hr = Math.floor(diff / 3600000)
  if (hr < 24) return `${hr}h ago`
  const day = Math.floor(diff / 86400000)
  if (day < 7) return `${day}d ago`
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

function modelShort(model: string): string {
  if (model.includes('opus')) return 'Opus'
  if (model.includes('sonnet')) return 'Sonnet'
  if (model.includes('haiku')) return 'Haiku'
  return model.split('-')[1] ?? model
}

interface SessionSwitcherProps {
  lang: Lang
  projectName: string
  encodedDir: string
  onClose: () => void
  onNewSession: () => void
  onLoadSession: (id: string, messages: ClaudeSessionMessage[]) => void
  onChangeProject: () => void
  activeSessionId: string | null
}

function SessionSwitcher({
  lang, projectName, encodedDir, onClose, onNewSession, onLoadSession, onChangeProject, activeSessionId,
}: SessionSwitcherProps) {
  const [sessions, setSessions] = useState<ClaudeSessionSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [loadingId, setLoadingId] = useState<string | null>(null)
  const pt = lang === 'pt'

  useEffect(() => {
    setLoading(true)
    fetch(`/api/claude-sessions?encodedDir=${encodeURIComponent(encodedDir)}`)
      .then(r => r.ok ? r.json() as Promise<ClaudeSessionSummary[]> : Promise.reject())
      .then(list => setSessions(list))
      .catch(() => setSessions([]))
      .finally(() => setLoading(false))
  }, [encodedDir])

  async function handleLoad(id: string) {
    setLoadingId(id)
    try {
      const res = await fetch(`/api/claude-sessions/${id}?encodedDir=${encodeURIComponent(encodedDir)}`)
      const msgs: ClaudeSessionMessage[] = res.ok ? await res.json() as ClaudeSessionMessage[] : []
      onLoadSession(id, msgs)
    } finally {
      setLoadingId(null)
    }
  }

  return (
    <div style={{
      position: 'absolute', inset: 0, zIndex: 10,
      background: 'var(--bg-surface)', borderRadius: 'inherit',
      display: 'flex', flexDirection: 'column',
      padding: '14px 14px 14px',
      animation: 'claudeChatFadeIn 0.15s ease-out',
    }}>
      {/* Header row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
        <Clock size={14} style={{ color: 'var(--accent-purple)', flexShrink: 0 }} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-primary)' }}>
            {pt ? 'Sessões do projeto' : 'Project sessions'}
          </div>
          <button
            onClick={onChangeProject}
            style={{
              background: 'none', border: 'none', padding: 0, cursor: 'pointer',
              fontFamily: 'inherit', display: 'flex', alignItems: 'center', gap: 4,
              color: 'var(--accent-purple)', fontSize: 10,
            }}
          >
            <FolderOpen size={9} />
            {projectName}
          </button>
        </div>
        <button onClick={onClose} style={{ ...iconBtnStyle, flexShrink: 0 }}>
          <X size={12} />
        </button>
      </div>

      {/* New session button */}
      <button
        onClick={onNewSession}
        style={{
          display: 'flex', alignItems: 'center', gap: 8,
          padding: '8px 12px', borderRadius: 8, marginBottom: 10,
          border: '1px solid color-mix(in srgb, var(--accent-purple) 40%, transparent)',
          background: 'color-mix(in srgb, var(--accent-purple) 10%, transparent)',
          cursor: 'pointer', fontFamily: 'inherit', flexShrink: 0,
          color: 'var(--accent-purple)', fontSize: 12, fontWeight: 600,
        }}
      >
        <MessageSquarePlus size={13} />
        {pt ? 'Nova sessão' : 'New session'}
      </button>

      {/* Session list */}
      <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 4 }}>
        {loading ? (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24, color: 'var(--text-tertiary)' }}>
            <Loader size={16} style={{ animation: 'claudeChatSpin 1s linear infinite' }} />
          </div>
        ) : sessions.length === 0 ? (
          <div style={{ padding: '20px 0', textAlign: 'center', color: 'var(--text-tertiary)', fontSize: 12 }}>
            {pt ? 'Nenhuma sessão encontrada' : 'No sessions found'}
          </div>
        ) : sessions.map(s => {
          const isActive = s.id === activeSessionId
          const isLoading = loadingId === s.id
          return (
            <button
              key={s.id}
              onClick={() => void handleLoad(s.id)}
              disabled={isLoading}
              style={{
                display: 'flex', flexDirection: 'column', gap: 3,
                padding: '9px 11px', borderRadius: 8, textAlign: 'left',
                border: `1px solid ${isActive ? 'color-mix(in srgb, var(--accent-purple) 40%, transparent)' : 'var(--border)'}`,
                background: isActive ? 'color-mix(in srgb, var(--accent-purple) 8%, transparent)' : 'transparent',
                cursor: isLoading ? 'wait' : 'pointer', fontFamily: 'inherit',
                transition: 'background 0.1s',
                opacity: isLoading ? 0.6 : 1,
              }}
              onMouseEnter={e => { if (!isActive) e.currentTarget.style.background = 'var(--bg-elevated)' }}
              onMouseLeave={e => { if (!isActive) e.currentTarget.style.background = 'transparent' }}
            >
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 6 }}>
                {isLoading
                  ? <Loader size={10} style={{ animation: 'claudeChatSpin 1s linear infinite', color: 'var(--accent-purple)', flexShrink: 0, marginTop: 1 }} />
                  : isActive
                    ? <Check size={10} style={{ color: 'var(--accent-purple)', flexShrink: 0, marginTop: 1 }} />
                    : <History size={10} style={{ color: 'var(--text-tertiary)', flexShrink: 0, marginTop: 1 }} />
                }
                <span style={{
                  fontSize: 12, color: isActive ? 'var(--text-primary)' : 'var(--text-secondary)',
                  fontWeight: isActive ? 600 : 400,
                  lineHeight: 1.4, overflow: 'hidden',
                  display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical',
                }}>
                  {s.title}
                </span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, paddingLeft: 16, marginTop: 1 }}>
                <span style={{ fontSize: 10, color: 'var(--text-tertiary)' }}>{fmtRelDate(s.updatedAt)}</span>
                <span style={{ fontSize: 10, color: 'var(--text-tertiary)' }}>·</span>
                <span style={{ fontSize: 10, color: 'var(--text-tertiary)' }}>{s.messageCount} msgs</span>
                {s.model && <>
                  <span style={{ fontSize: 10, color: 'var(--text-tertiary)' }}>·</span>
                  <span style={{ fontSize: 10, color: 'var(--text-tertiary)' }}>{modelShort(s.model)}</span>
                </>}
              </div>
            </button>
          )
        })}
      </div>
    </div>
  )
}

// ── MCP Panel ─────────────────────────────────────────────────────────────────

function McpPanel({ result, loading, onClose, onRemoved, pt }: {
  result: McpListResult
  loading: boolean
  onClose: () => void
  onRemoved: (name: string) => void
  pt: boolean
}) {
  const [removing, setRemoving] = React.useState<string | null>(null)
  const [removeError, setRemoveError] = React.useState<string | null>(null)

  async function handleRemove(name: string) {
    setRemoving(name)
    setRemoveError(null)
    try {
      const res = await fetch('/api/mcp-action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'remove', name }),
      })
      const data = await res.json() as { ok: boolean; error?: string }
      if (data.ok) {
        onRemoved(name)
      } else {
        setRemoveError(data.error ?? 'Failed to remove')
      }
    } catch {
      setRemoveError('Network error')
    } finally {
      setRemoving(null)
    }
  }

  const { servers, plugins } = result
  const isEmpty = !loading && servers.length === 0 && plugins.length === 0

  return (
    <div style={{
      position: 'absolute', inset: 0, zIndex: 10,
      background: 'var(--bg-surface)', borderRadius: 'inherit',
      display: 'flex', flexDirection: 'column',
      padding: '14px 14px 14px',
      animation: 'claudeChatFadeIn 0.15s ease-out',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
        <Server size={14} style={{ color: 'var(--accent-purple)', flexShrink: 0 }} />
        <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-primary)', flex: 1 }}>
          MCP Servers {!loading && <span style={{ fontWeight: 400, color: 'var(--text-tertiary)' }}>({servers.length})</span>}
        </span>
        <button onClick={onClose} style={{ ...iconBtnStyle, flexShrink: 0 }}>
          <X size={12} />
        </button>
      </div>

      {removeError && (
        <div style={{ padding: '5px 9px', marginBottom: 8, borderRadius: 6, fontSize: 11,
          background: 'color-mix(in srgb, var(--accent-red, #ef4444) 10%, transparent)',
          border: '1px solid color-mix(in srgb, var(--accent-red, #ef4444) 30%, transparent)',
          color: 'var(--accent-red, #ef4444)' }}>
          {removeError}
        </div>
      )}

      {loading ? (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24, color: 'var(--text-tertiary)' }}>
          <Loader size={16} style={{ animation: 'claudeChatSpin 1s linear infinite' }} />
        </div>
      ) : isEmpty ? (
        <div style={{ padding: '20px 0', textAlign: 'center', color: 'var(--text-tertiary)', fontSize: 12 }}>
          {pt ? 'Nenhum servidor MCP encontrado' : 'No MCP servers found'}
        </div>
      ) : (
        <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 8 }}>
          {/* MCP Servers */}
          {servers.length > 0 && (
            <>
              {servers.map(s => (
                <div key={s.name} style={{
                  border: '1px solid var(--border)', borderRadius: 8,
                  background: 'var(--bg-card)', overflow: 'hidden',
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px' }}>
                    <div style={{
                      width: 8, height: 8, borderRadius: '50%', flexShrink: 0,
                      background: 'var(--accent-green)',
                      boxShadow: '0 0 0 2px color-mix(in srgb, var(--accent-green) 25%, transparent)',
                    }} />
                    <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-primary)', flex: 1 }}>{s.name}</span>
                    <span style={{
                      fontSize: 9, padding: '1px 6px', borderRadius: 3, fontWeight: 700,
                      background: s.scope === 'user'
                        ? 'color-mix(in srgb, var(--accent-purple) 12%, transparent)'
                        : 'color-mix(in srgb, var(--accent-green) 12%, transparent)',
                      color: s.scope === 'user' ? 'var(--accent-purple)' : 'var(--accent-green)',
                      border: `1px solid ${s.scope === 'user'
                        ? 'color-mix(in srgb, var(--accent-purple) 30%, transparent)'
                        : 'color-mix(in srgb, var(--accent-green) 30%, transparent)'}`,
                    }}>
                      {s.scope}
                    </span>
                    {s.scope === 'user' && (
                      <button
                        onClick={() => { if (!removing) void handleRemove(s.name) }}
                        disabled={removing === s.name}
                        title={pt ? 'Desconectar' : 'Disconnect'}
                        style={{
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          width: 20, height: 20, borderRadius: 4, border: '1px solid var(--border)',
                          background: 'transparent', cursor: removing ? 'wait' : 'pointer',
                          color: 'var(--text-tertiary)', padding: 0,
                          opacity: removing && removing !== s.name ? 0.4 : 1,
                        }}
                        onMouseEnter={e => { e.currentTarget.style.color = '#ef4444'; e.currentTarget.style.borderColor = '#ef444480' }}
                        onMouseLeave={e => { e.currentTarget.style.color = 'var(--text-tertiary)'; e.currentTarget.style.borderColor = 'var(--border)' }}
                      >
                        {removing === s.name
                          ? <Loader size={9} style={{ animation: 'claudeChatSpin 1s linear infinite' }} />
                          : <X size={9} />
                        }
                      </button>
                    )}
                  </div>
                  {s.command && (
                    <div style={{ padding: '4px 10px 8px', borderTop: '1px solid var(--border)' }}>
                      <code style={{ fontSize: 10, color: 'var(--text-tertiary)', fontFamily: 'monospace' }}>
                        {s.command} {s.args.join(' ')}
                      </code>
                    </div>
                  )}
                </div>
              ))}
            </>
          )}

          {/* Plugins section */}
          {plugins.length > 0 && (
            <>
              <div style={{
                display: 'flex', alignItems: 'center', gap: 6,
                marginTop: servers.length > 0 ? 4 : 0,
                marginBottom: 2,
              }}>
                <Plug size={10} style={{ color: 'var(--text-tertiary)' }} />
                <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  Plugins
                </span>
              </div>
              {plugins.map(p => (
                <div key={p.id} style={{
                  border: '1px solid var(--border)', borderRadius: 8,
                  background: 'var(--bg-card)',
                  display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px',
                }}>
                  <div style={{
                    width: 8, height: 8, borderRadius: '50%', flexShrink: 0,
                    background: p.enabled ? 'var(--accent-green)' : 'var(--text-tertiary)',
                    boxShadow: p.enabled ? '0 0 0 2px color-mix(in srgb, var(--accent-green) 25%, transparent)' : 'none',
                  }} />
                  <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-primary)', flex: 1 }}>{p.name}</span>
                  {p.registry && (
                    <span style={{
                      fontSize: 9, padding: '1px 6px', borderRadius: 3, fontWeight: 600,
                      background: 'color-mix(in srgb, var(--anthropic-orange) 10%, transparent)',
                      color: 'var(--anthropic-orange)',
                      border: '1px solid color-mix(in srgb, var(--anthropic-orange) 25%, transparent)',
                    }}>
                      {p.registry}
                    </span>
                  )}
                </div>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  )
}

// ── Attachment preview strip ───────────────────────────────────────────────────

function AttachmentStrip({ attachments, onRemove }: {
  attachments: Attachment[]
  onRemove: (id: string) => void
}) {
  if (attachments.length === 0) return null
  return (
    <div style={{
      display: 'flex', flexWrap: 'wrap', gap: 5,
      padding: '6px 10px 0',
      borderTop: '1px solid var(--border)',
    }}>
      {attachments.map(att => (
        <div key={att.id} style={{
          position: 'relative', display: 'inline-flex', alignItems: 'center',
          borderRadius: 6, border: '1px solid var(--border)', overflow: 'hidden',
          background: 'var(--bg-elevated)',
        }}>
          {att.isImage ? (
            <img src={att.preview} alt={att.name}
              style={{ width: 52, height: 52, objectFit: 'cover', display: 'block' }} />
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '5px 8px', maxWidth: 120 }}>
              <FileText size={12} style={{ color: 'var(--accent-purple)', flexShrink: 0 }} />
              <span style={{ fontSize: 10, color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {att.name}
              </span>
            </div>
          )}
          <button
            onMouseDown={e => { e.preventDefault(); onRemove(att.id) }}
            style={{
              position: 'absolute', top: 2, right: 2,
              width: 14, height: 14, borderRadius: '50%',
              background: 'rgba(0,0,0,0.55)', border: 'none',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              cursor: 'pointer', color: '#fff', padding: 0,
            }}
          >
            <X size={8} />
          </button>
        </div>
      ))}
    </div>
  )
}

// ── Slash command autocomplete ────────────────────────────────────────────────

function SlashSuggestions({ input, onSelect, accent }: {
  input: string
  onSelect: (cmd: string) => void
  accent: string
}) {
  if (!input.startsWith('/')) return null
  const prefix = input.split(' ')[0]!.toLowerCase()
  const matches = CLAUDE_SLASH_COMMANDS.filter(c => c.cmd.startsWith(prefix))
  if (matches.length === 0) return null
  return (
    <div style={{
      position: 'absolute', bottom: 'calc(100% + 4px)', left: 0, right: 0, zIndex: 20,
      background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 10,
      boxShadow: '0 -8px 24px rgba(0,0,0,0.25)', overflow: 'hidden',
      animation: 'claudeChatFadeIn 0.12s ease-out',
    }}>
      {matches.map(c => (
        <button
          key={c.cmd}
          onMouseDown={e => { e.preventDefault(); onSelect(c.hint ? `${c.cmd} ` : c.cmd) }}
          style={{
            width: '100%', display: 'flex', alignItems: 'center', gap: 10,
            padding: '8px 12px', background: 'transparent', border: 'none',
            borderBottom: '1px solid var(--border)', cursor: 'pointer', fontFamily: 'inherit',
            textAlign: 'left', transition: 'background 0.1s',
          }}
          onMouseEnter={e => { e.currentTarget.style.background = 'var(--bg-elevated)' }}
          onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}
        >
          <span style={{ fontSize: 12, fontWeight: 700, color: accent, minWidth: 90 }}>{c.cmd}</span>
          {c.hint && <span style={{ fontSize: 11, color: 'var(--text-tertiary)', fontFamily: 'monospace' }}>{c.hint}</span>}
          <span style={{ fontSize: 11, color: 'var(--text-secondary)', marginLeft: 'auto' }}>{c.desc}</span>
        </button>
      ))}
    </div>
  )
}

// ── Slash commands ────────────────────────────────────────────────────────────

const CLAUDE_SLASH_COMMANDS = [
  { cmd: '/clear',   hint: '',                  desc: 'Clear messages and start fresh' },
  { cmd: '/new',     hint: '',                  desc: 'Start a new session' },
  { cmd: '/resume',  hint: '',                  desc: 'Open session switcher' },
  { cmd: '/model',   hint: 'haiku|sonnet|opus', desc: 'Switch model' },
  { cmd: '/think',   hint: 'off|8k|16k|32k',   desc: 'Set thinking budget' },
  { cmd: '/compact', hint: '',                  desc: 'Compact conversation context' },
  { cmd: '/mcp',     hint: '',                  desc: 'List connected MCP servers' },
  { cmd: '/project', hint: '',                  desc: 'Switch project' },
  { cmd: '/help',    hint: '',                  desc: 'Show available commands' },
]

// ── Icon button style ─────────────────────────────────────────────────────────

const iconBtnStyle: React.CSSProperties = {
  width: 28, height: 28,
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  background: 'transparent', border: '1px solid var(--border)', borderRadius: 7,
  color: 'var(--text-tertiary)', cursor: 'pointer', transition: 'all 0.15s', padding: 0,
  fontFamily: 'inherit',
}

// ── Main component ────────────────────────────────────────────────────────────

interface ClaudeChatProps {
  lang: Lang
  onOpen?: () => void
  embedded?: boolean
  onDetach?: () => void
  onAttach?: () => void
  // Lift state up so decouple/attach preserves session/project
  initialProject?: { path: string; name: string; encodedDir: string } | null
  initialSessionId?: string | null
  initialMessages?: ChatMessage[]
  onStateChange?: (state: { projectPath: string | null; projectName: string | null; projectEncodedDir: string | null; sessionId: string | null; messages: ChatMessage[] }) => void
}

export function ClaudeChat({ lang, onOpen, embedded, onDetach, onAttach, initialProject, initialSessionId, initialMessages, onStateChange }: ClaudeChatProps) {
  // Window state — when rendered as floating (onAttach present), start open immediately
  const [open, setOpen] = useState(() => !embedded && !!onAttach)
  const [minimized, setMinimized] = useState(false)
  const [pos, setPos] = useState<{ x: number; y: number }>(() => loadPos())
  const [size, setSize] = useState<{ w: number; h: number }>(() => loadSize())
  // Minimized FAB position — starts at bottom-right, draggable independently
  const FAB_W = 46
  const FAB_H = 58 // button + label
  const [fabPos, setFabPos] = useState<{ x: number; y: number }>(() => ({
    x: window.innerWidth - FAB_W - 24,
    y: window.innerHeight - FAB_H - 78,
  }))

  // Chat state
  const [model, setModel] = useState<ChatModelId>(DEFAULT_CHAT_MODEL)
  const [thinking, setThinking] = useState<ThinkingBudget>(false)
  const [messages, setMessages] = useState<ChatMessage[]>(() => initialMessages ?? [])
  const [input, setInput] = useState('')
  const [streaming, setStreaming] = useState(false)
  const [sessionId, setSessionId] = useState<string | null>(() => initialSessionId ?? null)
  const [currentTools, setCurrentTools] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)
  const [showModelPicker, setShowModelPicker] = useState(false)
  const [projectPath, setProjectPath] = useState<string | null>(() => initialProject?.path ?? null)
  const [projectName, setProjectName] = useState<string | null>(() => initialProject?.name ?? null)
  const [projectEncodedDir, setProjectEncodedDir] = useState<string | null>(() => initialProject?.encodedDir ?? null)
  const [showProjectPicker, setShowProjectPicker] = useState(false)
  const [showSessionPicker, setShowSessionPicker] = useState(false)
  // Attachments
  const [attachments, setAttachments] = useState<Attachment[]>([])
  const fileInputRef = useRef<HTMLInputElement>(null)
  // MCP panel
  const [showMcpPanel, setShowMcpPanel] = useState(false)
  const [mcpResult, setMcpResult] = useState<McpListResult>({ servers: [], plugins: [] })
  const [mcpLoading, setMcpLoading] = useState(false)

  // Refs for drag/resize
  const windowRef = useRef<HTMLDivElement>(null)
  const fabRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef({ active: false, startX: 0, startY: 0, origX: 0, origY: 0 })
  const resizeRef = useRef({ active: false, startX: 0, startY: 0, origW: 0, origH: 0 })
  const fabDragRef = useRef({ active: false, moved: false, startX: 0, startY: 0, origX: 0, origY: 0 })
  const posRef = useRef(pos)
  const sizeRef = useRef(size)
  const fabPosRef = useRef(fabPos)
  const listRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const openRef = useRef(open)

  useEffect(() => { posRef.current = pos }, [pos])
  useEffect(() => { sizeRef.current = size }, [size])
  useEffect(() => { openRef.current = open }, [open])
  useEffect(() => { fabPosRef.current = fabPos }, [fabPos])

  // Propagate state changes upward so parent can preserve when toggling float mode
  useEffect(() => {
    onStateChange?.({ projectPath, projectName, projectEncodedDir, sessionId, messages })
  }, [projectPath, projectName, projectEncodedDir, sessionId, messages]) // eslint-disable-line react-hooks/exhaustive-deps

  // Poll for new messages written externally (e.g. from VS Code Claude extension)
  // so the viewer stays up-to-date in real time without the user having to refresh.
  useEffect(() => {
    if (!sessionId || !projectEncodedDir || streaming) return
    const id = setInterval(async () => {
      try {
        const res = await fetch(`/api/claude-sessions/${sessionId}?encodedDir=${encodeURIComponent(projectEncodedDir)}`)
        if (!res.ok) return
        const fresh: ChatMessage[] = await res.json()
        setMessages(prev => fresh.length > prev.length ? fresh : prev)
      } catch { /* ignore */ }
    }, 3000)
    return () => clearInterval(id)
  }, [sessionId, projectEncodedDir, streaming])

  // ── Attachment handlers ───────────────────────────────────────────────────

  const handlePaste = useCallback((e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const items = Array.from(e.clipboardData.items)
    const imageItem = items.find(i => i.type.startsWith('image/'))
    if (!imageItem) return
    e.preventDefault()
    const blob = imageItem.getAsFile()
    if (!blob) return
    const reader = new FileReader()
    reader.onload = ev => {
      const dataUrl = ev.target?.result as string
      setAttachments(prev => [...prev, {
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

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? [])
    for (const file of files) {
      const reader = new FileReader()
      if (file.type.startsWith('image/')) {
        reader.onload = ev => {
          const dataUrl = ev.target?.result as string
          setAttachments(prev => [...prev, {
            id: crypto.randomUUID(),
            name: file.name,
            mimeType: file.type,
            data: dataUrl.split(',')[1]!,
            isImage: true,
            preview: dataUrl,
          }])
        }
        reader.readAsDataURL(file)
      } else {
        reader.onload = ev => {
          setAttachments(prev => [...prev, {
            id: crypto.randomUUID(),
            name: file.name,
            mimeType: file.type || 'text/plain',
            data: ev.target?.result as string,
            isImage: false,
          }])
        }
        reader.readAsText(file)
      }
    }
    e.target.value = ''
  }, [])

  // Auto-scroll on messages
  useEffect(() => {
    if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight
  }, [messages, streaming, currentTools])

  // Focus input when opened
  useEffect(() => {
    if (open && !minimized) {
      setTimeout(() => inputRef.current?.focus(), 50)
    }
  }, [open, minimized])

  // ── Drag handlers ─────────────────────────────────────────────────────────

  const onHeaderMouseDown = useCallback((e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('button')) return
    e.preventDefault()
    dragRef.current = {
      active: true,
      startX: e.clientX,
      startY: e.clientY,
      origX: posRef.current.x,
      origY: posRef.current.y,
    }

    const onMouseMove = (ev: MouseEvent) => {
      if (!dragRef.current.active) return
      const dx = ev.clientX - dragRef.current.startX
      const dy = ev.clientY - dragRef.current.startY
      const newX = Math.max(0, Math.min(window.innerWidth - sizeRef.current.w, dragRef.current.origX + dx))
      const newY = Math.max(0, Math.min(window.innerHeight - 60, dragRef.current.origY + dy))
      posRef.current = { x: newX, y: newY }
      if (windowRef.current) {
        windowRef.current.style.left = `${newX}px`
        windowRef.current.style.top = `${newY}px`
      }
    }

    const onMouseUp = () => {
      dragRef.current.active = false
      setPos({ ...posRef.current })
      savePos(posRef.current)
      document.removeEventListener('mousemove', onMouseMove)
      document.removeEventListener('mouseup', onMouseUp)
    }

    document.addEventListener('mousemove', onMouseMove)
    document.addEventListener('mouseup', onMouseUp)
  }, [])

  // ── Resize handlers ───────────────────────────────────────────────────────

  const onResizeMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    resizeRef.current = {
      active: true,
      startX: e.clientX,
      startY: e.clientY,
      origW: sizeRef.current.w,
      origH: sizeRef.current.h,
    }

    const onMouseMove = (ev: MouseEvent) => {
      if (!resizeRef.current.active) return
      const dx = ev.clientX - resizeRef.current.startX
      const dy = ev.clientY - resizeRef.current.startY
      const newW = Math.max(380, resizeRef.current.origW + dx)
      const newH = Math.max(400, resizeRef.current.origH + dy)
      sizeRef.current = { w: newW, h: newH }
      if (windowRef.current) {
        windowRef.current.style.width = `${newW}px`
        windowRef.current.style.height = `${newH}px`
      }
    }

    const onMouseUp = () => {
      resizeRef.current.active = false
      setSize({ ...sizeRef.current })
      saveSize(sizeRef.current)
      document.removeEventListener('mousemove', onMouseMove)
      document.removeEventListener('mouseup', onMouseUp)
    }

    document.addEventListener('mousemove', onMouseMove)
    document.addEventListener('mouseup', onMouseUp)
  }, [])

  // ── Send message ──────────────────────────────────────────────────────────

  // ── FAB drag handler ──────────────────────────────────────────────────────

  const onFabMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    fabDragRef.current = {
      active: true, moved: false,
      startX: e.clientX, startY: e.clientY,
      origX: fabPosRef.current.x, origY: fabPosRef.current.y,
    }

    const onMouseMove = (ev: MouseEvent) => {
      if (!fabDragRef.current.active) return
      const dx = ev.clientX - fabDragRef.current.startX
      const dy = ev.clientY - fabDragRef.current.startY
      if (Math.abs(dx) > 3 || Math.abs(dy) > 3) fabDragRef.current.moved = true
      const newX = Math.max(0, Math.min(window.innerWidth - FAB_W, fabDragRef.current.origX + dx))
      const newY = Math.max(0, Math.min(window.innerHeight - FAB_H, fabDragRef.current.origY + dy))
      fabPosRef.current = { x: newX, y: newY }
      if (fabRef.current) {
        fabRef.current.style.left = `${newX}px`
        fabRef.current.style.top  = `${newY}px`
      }
    }

    const onMouseUp = () => {
      fabDragRef.current.active = false
      setFabPos({ ...fabPosRef.current })
      document.removeEventListener('mousemove', onMouseMove)
      document.removeEventListener('mouseup', onMouseUp)
    }

    document.addEventListener('mousemove', onMouseMove)
    document.addEventListener('mouseup', onMouseUp)
  }, [])

  // ── Unminimize / open — clamp window into viewport ───────────────────────

  const openWindow = useCallback(() => {
    // Clamp pos so the window is fully on screen
    const maxX = Math.max(0, window.innerWidth  - sizeRef.current.w)
    const maxY = Math.max(0, window.innerHeight - sizeRef.current.h)
    const newPos = {
      x: Math.max(0, Math.min(maxX, posRef.current.x)),
      y: Math.max(0, Math.min(maxY, posRef.current.y)),
    }
    posRef.current = newPos
    setPos(newPos)
    savePos(newPos)
    setOpen(true)
    setMinimized(false)
  }, [])

  const sendMessage = useCallback(async (overrideText?: string) => {
    const text = (overrideText ?? input).trim()
    const hasAttachments = attachments.length > 0
    if ((!text && !hasAttachments) || streaming) return
    if (!overrideText) setInput('')
    setError(null)
    setCurrentTools([])
    setShowModelPicker(false)

    // Slash commands (client-side only — no API call)
    if (text === '/clear' || text === '/new') {
      setMessages([]); setSessionId(null); setError(null); setAttachments([]); return
    }
    if (text === '/resume') {
      setShowSessionPicker(true); return
    }
    if (text === '/project') {
      setShowProjectPicker(true); return
    }
    if (text === '/mcp') {
      setShowMcpPanel(true)
      setMcpLoading(true)
      try {
        const res = await fetch(`/api/mcp-list${projectPath ? `?projectPath=${encodeURIComponent(projectPath)}` : ''}`)
        if (res.ok) setMcpResult(await res.json() as McpListResult)
      } catch { /* ignore */ }
      finally { setMcpLoading(false) }
      return
    }
    if (text === '/help') {
      const helpText = CLAUDE_SLASH_COMMANDS
        .map(c => `**${c.cmd}**${c.hint ? ` \`${c.hint}\`` : ''} — ${c.desc}`)
        .join('\n')
      setMessages(prev => [...prev,
        { role: 'user', content: '/help', timestamp: Date.now() },
        { role: 'assistant', content: `### Available commands\n\n${helpText}`, timestamp: Date.now() },
      ])
      return
    }
    const modelMatch = text.match(/^\/model(?:\s+(.+))?$/i)
    if (modelMatch) {
      const arg = modelMatch[1]?.trim().toLowerCase()
      if (arg) {
        const found = CHAT_MODELS.find(m => m.id.includes(arg) || m.label.toLowerCase().includes(arg))
        if (found) { setModel(found.id); return }
      }
      setShowModelPicker(true); return
    }
    const thinkMatch = text.match(/^\/think(?:\s+(.+))?$/i)
    if (thinkMatch) {
      const arg = thinkMatch[1]?.trim().toLowerCase()
      if (arg === 'off') { setThinking(false); return }
      if (arg === '8k') { setThinking(8000); return }
      if (arg === '16k') { setThinking(16000); return }
      if (arg === '32k') { setThinking(32000); return }
      setThinking(prev => nextThinkingBudget(prev)); return
    }
    // Unknown bare slash commands — don't send
    if (text.startsWith('/') && !text.includes(' ') && !hasAttachments) return

    const pendingAttachments = attachments
    setAttachments([])

    const userMsg: ChatMessage = {
      role: 'user',
      content: text,
      timestamp: Date.now(),
      images: pendingAttachments.filter(a => a.isImage).map(a => a.preview!),
      files: pendingAttachments.filter(a => !a.isImage).map(a => a.name),
    }
    const history = messages.map(m => ({ role: m.role, content: m.content }))

    setMessages(prev => [
      ...prev,
      userMsg,
      { role: 'assistant', content: '', timestamp: Date.now() },
    ])
    setStreaming(true)

    let accum = ''
    let toolsAccum: string[] = []

    try {
      const res = await fetch('/api/claude-chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: text,
          history,
          model,
          sessionId,
          thinkingBudget: thinking || undefined,
          projectPath: projectPath ?? undefined,
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
                if (last?.role === 'assistant') {
                  copy[copy.length - 1] = { ...last, content: accum }
                }
                return copy
              })
            }
            if (ev.done) {
              setMessages(prev => {
                const copy = [...prev]
                const last = copy[copy.length - 1]
                if (last?.role === 'assistant') {
                  copy[copy.length - 1] = { ...last, content: accum, tools: toolsAccum.length > 0 ? toolsAccum : undefined }
                }
                return copy
              })
              setCurrentTools([])
              setStreaming(false)
              // Notify parent if minimized
              if (minimized && onOpen) onOpen()
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
  }, [input, streaming, messages, model, sessionId, thinking, minimized, onOpen, attachments, projectPath]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void sendMessage() }
  }

  const modelInfo = CHAT_MODELS.find(m => m.id === model)

  // ── Embedded mode (inside TtyChat tab) ───────────────────────────────────────
  if (embedded) {
    return (
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', position: 'relative' }}>
        <style>{`
          @keyframes claudeChatSpin    { from{transform:rotate(0deg)} to{transform:rotate(360deg)} }
          @keyframes claudeChatFadeIn  { from{opacity:0;transform:translateY(4px)} to{opacity:1;transform:none} }
          @keyframes claudeChatPulse   { 0%,100%{opacity:1} 50%{opacity:0.5} }
          .claude-icon-btn:hover { color: var(--text-primary) !important; border-color: var(--text-secondary) !important; }
          .claude-send-btn:hover:not(:disabled) { background: var(--accent-purple) !important; color: #fff !important; border-color: var(--accent-purple) !important; }
          .claude-model-opt:hover { background: var(--bg-elevated) !important; }
        `}</style>

        {/* Project picker — full screen inside the embedded container */}
        {(!projectPath || showProjectPicker) && (
          <ProjectPicker
            lang={lang}
            canClose={!!projectPath}
            onClose={() => setShowProjectPicker(false)}
            onSelect={p => {
              setProjectPath(p.path)
              setProjectName(p.name)
              setProjectEncodedDir(p.encodedDir)
              setShowProjectPicker(false)
              setMessages([])
              setSessionId(null)
              setShowSessionPicker(true)
            }}
          />
        )}

        {/* Session switcher */}
        {projectPath && !showProjectPicker && projectName && projectEncodedDir && showSessionPicker && (
          <SessionSwitcher
            lang={lang}
            projectName={projectName}
            encodedDir={projectEncodedDir}
            activeSessionId={sessionId}
            onClose={() => setShowSessionPicker(false)}
            onNewSession={() => { setMessages([]); setSessionId(null); setShowSessionPicker(false) }}
            onLoadSession={(id, msgs) => { setMessages(msgs.map(m => ({ ...m }))); setSessionId(id); setShowSessionPicker(false) }}
            onChangeProject={() => { setShowSessionPicker(false); setShowProjectPicker(true) }}
          />
        )}

        {/* MCP panel */}
        {showMcpPanel && (
          <McpPanel result={mcpResult} loading={mcpLoading} pt={lang === 'pt'} onClose={() => setShowMcpPanel(false)} onRemoved={name => setMcpResult(prev => ({ ...prev, servers: prev.servers.filter(s => s.name !== name) }))} />
        )}

        {/* Chat UI */}
        {projectPath && !showProjectPicker && !showSessionPicker && !showMcpPanel && <>
          {/* Embedded toolbar: project + model + thinking + history + decouple */}
          <div style={{
            display: 'flex', alignItems: 'center', gap: 4,
            padding: '5px 10px', borderBottom: '1px solid var(--border)',
            background: 'var(--bg-card)', flexShrink: 0,
          }}>
            <button
              className="claude-icon-btn"
              onClick={() => setShowProjectPicker(true)}
              title={projectName ?? 'Project'}
              style={{ ...iconBtnStyle, gap: 4, width: 'auto', padding: '0 6px', fontSize: 10, maxWidth: 120,
                color: 'var(--accent-purple)', borderColor: 'color-mix(in srgb, var(--accent-purple) 40%, transparent)',
                background: 'color-mix(in srgb, var(--accent-purple) 8%, transparent)' }}
            >
              <FolderOpen size={10} />
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{projectName}</span>
            </button>

            <button
              className="claude-icon-btn"
              onClick={() => setShowSessionPicker(v => !v)}
              title={lang === 'pt' ? 'Sessões' : 'Sessions'}
              style={{ ...iconBtnStyle, color: showSessionPicker ? 'var(--accent-purple)' : 'var(--text-tertiary)' }}
            >
              <History size={11} />
            </button>

            <div style={{ flex: 1 }} />

            {/* Thinking toggle */}
            <button
              className="claude-icon-btn"
              onClick={() => setThinking(prev => nextThinkingBudget(prev))}
              title={thinking ? `Extended thinking: ${thinkingLabel(thinking)} tokens` : 'Enable extended thinking'}
              style={{
                ...iconBtnStyle,
                color: thinking ? 'var(--accent-purple)' : 'var(--text-tertiary)',
                borderColor: thinking ? 'color-mix(in srgb, var(--accent-purple) 40%, transparent)' : 'var(--border)',
                background: thinking ? 'color-mix(in srgb, var(--accent-purple) 10%, transparent)' : 'transparent',
                width: thinking ? 'auto' : 28, padding: thinking ? '0 6px' : 0, gap: 4, minWidth: 28,
              }}
            >
              <Brain size={11} />
              {thinking && <span style={{ fontSize: 9, fontWeight: 700 }}>{thinkingLabel(thinking)}</span>}
            </button>

            {/* Model picker */}
            <div style={{ position: 'relative' }}>
              <button
                className="claude-icon-btn"
                onClick={() => setShowModelPicker(v => !v)}
                title="Change model"
                style={{ ...iconBtnStyle, width: 'auto', padding: '0 6px', gap: 4, fontSize: 10 }}
              >
                <span>{modelInfo?.label ?? model}</span>
                <ChevronDown size={9} />
              </button>
              {showModelPicker && (
                <div style={{
                  position: 'absolute', bottom: 'calc(100% + 4px)', right: 0, zIndex: 10, minWidth: 180,
                  background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 10,
                  boxShadow: '0 8px 24px rgba(0,0,0,0.3)', overflow: 'hidden',
                  animation: 'claudeChatFadeIn 0.12s ease-out',
                }}>
                  {CHAT_MODELS.map(m => {
                    const active = model === m.id
                    const badgeColor = BADGE_COLORS[m.badge] ?? 'var(--text-tertiary)'
                    return (
                      <button key={m.id} className="claude-model-opt"
                        onClick={() => { setModel(m.id); setShowModelPicker(false) }}
                        style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px',
                          background: active ? 'var(--bg-elevated)' : 'transparent', border: 'none',
                          cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left',
                          borderBottom: '1px solid var(--border)', transition: 'background 0.1s' }}>
                        <span style={{ flex: 1, fontSize: 12, fontWeight: active ? 700 : 400, color: active ? 'var(--text-primary)' : 'var(--text-secondary)' }}>{m.label}</span>
                        <span style={{ fontSize: 9, fontWeight: 700, color: badgeColor,
                          background: `color-mix(in srgb, ${badgeColor} 12%, transparent)`,
                          border: `1px solid color-mix(in srgb, ${badgeColor} 30%, transparent)`,
                          padding: '1px 5px', borderRadius: 3 }}>{m.badge}</span>
                      </button>
                    )
                  })}
                </div>
              )}
            </div>

            {/* Decouple button */}
            <button
              className="claude-icon-btn"
              onClick={onDetach}
              title={lang === 'pt' ? 'Destacar janela' : 'Detach window'}
              style={iconBtnStyle}
            >
              <ExternalLink size={11} />
            </button>
          </div>

          {/* Messages */}
          <div ref={listRef} onClick={() => setShowModelPicker(false)}
            style={{ flex: 1, overflowY: 'auto', padding: '14px 14px 6px' }}>
            {messages.length === 0 && !streaming && (
              <div style={{ height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                gap: 10, color: 'var(--text-tertiary)', textAlign: 'center', padding: '0 20px' }}>
                <img src="/claudeLogo.png" alt="Claude" style={{ width: 36, height: 36, objectFit: 'contain', opacity: 0.4 }} />
                <div style={{ fontSize: 13, fontWeight: 600 }}>Claude</div>
                <div style={{ fontSize: 11, opacity: 0.7, display: 'flex', alignItems: 'center', gap: 5 }}>
                  <FolderOpen size={11} style={{ color: 'var(--accent-purple)' }} />
                  <span style={{ color: 'var(--accent-purple)' }}>{projectName}</span>
                </div>
              </div>
            )}
            {messages.map((msg, i) => {
              const isLast = i === messages.length - 1
              return (
                <ClaudeChatMessage key={i} msg={msg}
                  isLiveStreaming={isLast && streaming ? true : undefined}
                  currentTools={isLast && streaming ? currentTools : undefined}
                  thinking={thinking} />
              )
            })}
            {error && (
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, padding: '10px 12px', borderRadius: 8, marginBottom: 8,
                background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.25)', fontSize: 12, color: '#ef4444' }}>
                <AlertCircle size={13} style={{ flexShrink: 0, marginTop: 1 }} />
                <span style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{error}</span>
              </div>
            )}
          </div>

          {/* Input */}
          <div style={{ position: 'relative', flexShrink: 0, borderTop: '1px solid var(--border)', background: 'var(--bg-card)' }}>
            <SlashSuggestions input={input} onSelect={cmd => { setInput(cmd); inputRef.current?.focus() }} accent="var(--accent-purple)" />
            <AttachmentStrip attachments={attachments} onRemove={id => setAttachments(prev => prev.filter(a => a.id !== id))} />
            <input ref={fileInputRef} type="file" multiple accept="image/*,text/*,.pdf,.md,.json,.ts,.js,.py,.txt,.csv" onChange={handleFileSelect} style={{ display: 'none' }} />
            <div style={{ padding: '8px 10px', display: 'flex', alignItems: 'flex-end', gap: 6 }}>
              <button className="claude-icon-btn" onClick={() => fileInputRef.current?.click()} title="Attach file or image" style={{ ...iconBtnStyle, flexShrink: 0, width: 30, height: 30 }}>
                <Paperclip size={12} />
              </button>
              <textarea
                ref={inputRef}
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                onPaste={handlePaste}
                placeholder={lang === 'pt' ? 'Pergunte algo... (cole imagens com Ctrl+V)' : 'Ask anything... (paste images with Ctrl+V)'}
                rows={1}
                disabled={streaming}
                style={{ flex: 1, resize: 'none', background: 'var(--bg-elevated)', border: '1px solid var(--border)',
                  borderRadius: 8, padding: '8px 10px', fontSize: 16, fontFamily: 'inherit',
                  color: 'var(--text-primary)', outline: 'none', lineHeight: 1.5,
                  maxHeight: 120, overflowY: 'auto', transition: 'border-color 0.15s' }}
                onFocus={e => { e.currentTarget.style.borderColor = 'color-mix(in srgb, var(--accent-purple) 60%, transparent)' }}
                onBlur={e => { e.currentTarget.style.borderColor = 'var(--border)' }}
                onInput={e => { const el = e.currentTarget; el.style.height = 'auto'; el.style.height = `${Math.min(el.scrollHeight, 120)}px` }}
              />
              <button className="claude-send-btn"
                onClick={() => { void sendMessage() }}
                disabled={(!input.trim() && attachments.length === 0) || streaming}
                style={{ width: 34, height: 34, borderRadius: 8, flexShrink: 0,
                  border: '1px solid color-mix(in srgb, var(--accent-purple) 50%, transparent)',
                  background: 'color-mix(in srgb, var(--accent-purple) 12%, transparent)',
                  color: 'var(--accent-purple)', cursor: (input.trim() || attachments.length > 0) && !streaming ? 'pointer' : 'not-allowed',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  opacity: (input.trim() || attachments.length > 0) && !streaming ? 1 : 0.4, transition: 'all 0.15s' }}>
                {streaming ? <Loader size={14} style={{ animation: 'claudeChatSpin 1s linear infinite' }} /> : <Send size={14} />}
              </button>
            </div>
          </div>
        </>}
      </div>
    )
  }

  return (
    <>
      <style>{`
        @keyframes claudeChatSpin    { from{transform:rotate(0deg)} to{transform:rotate(360deg)} }
        @keyframes claudeChatFadeIn  { from{opacity:0;transform:translateY(4px)} to{opacity:1;transform:none} }
        @keyframes claudeChatSlideIn { from{opacity:0;transform:scale(0.96)} to{opacity:1;transform:none} }
        @keyframes claudeChatPulse   { 0%,100%{opacity:1} 50%{opacity:0.5} }
        .claude-fab:hover { border-color: var(--accent-purple) !important; }
        .claude-icon-btn:hover { color: var(--text-primary) !important; border-color: var(--text-secondary) !important; }
        .claude-send-btn:hover:not(:disabled) { background: var(--accent-purple) !important; color: #fff !important; border-color: var(--accent-purple) !important; }
        .claude-model-opt:hover { background: var(--bg-elevated) !important; }
        .claude-header { cursor: grab; user-select: none; }
        .claude-header:active { cursor: grabbing; }
      `}</style>

      {/* FAB — shown when dormant (not opened) or minimized, always draggable */}
      {(!open || minimized) && (
        <div
          ref={fabRef}
          onMouseDown={onFabMouseDown}
          onClick={() => {
            if (fabDragRef.current.moved) { fabDragRef.current.moved = false; return }
            openWindow()
          }}
          title="Chat with Claude"
          style={{
            position: 'fixed',
            left: fabPos.x,
            top: fabPos.y,
            zIndex: 549,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 2,
            cursor: 'grab',
            userSelect: 'none',
          }}
        >
          <div
            className="claude-fab"
            style={{
              width: FAB_W, height: FAB_W, borderRadius: '50%',
              border: '1.5px solid var(--border)',
              background: 'var(--bg-card)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              transition: 'border-color 0.2s',
              overflow: 'hidden',
              pointerEvents: 'none',
            }}
          >
            <img src="/claudeLogo.png" alt="Claude" style={{ width: 26, height: 26, objectFit: 'contain' }} />
          </div>
          <span style={{ fontSize: 9, color: 'var(--text-tertiary)', lineHeight: 1, pointerEvents: 'none' }}>Claude</span>
        </div>
      )}

      {/* Floating window — project picker forces full-screen project selection, chat UI only shown after project is selected */}
      {open && !minimized && (
        <div
          ref={windowRef}
          style={{
            position: 'fixed',
            left: pos.x,
            top: pos.y,
            width: size.w,
            height: size.h,
            zIndex: 550,
            display: 'flex',
            flexDirection: 'column',
            background: 'var(--bg-surface)',
            border: '1px solid var(--border)',
            borderRadius: 14,
            boxShadow: '0 10px 48px rgba(0,0,0,0.45)',
            overflow: 'hidden',
            animation: 'claudeChatSlideIn 0.18s ease-out',
          }}
        >
          {/* ── Project picker — shown instead of chat until a project is selected ── */}
          {(!projectPath || showProjectPicker) && (
            <ProjectPicker
              lang={lang}
              canClose={!!projectPath}
              onClose={() => setShowProjectPicker(false)}
              onSelect={p => {
                setProjectPath(p.path)
                setProjectName(p.name)
                setProjectEncodedDir(p.encodedDir)
                setShowProjectPicker(false)
                setMessages([])
                setSessionId(null)
                setShowSessionPicker(true)
              }}
            />
          )}

          {/* ── MCP panel ── */}
          {showMcpPanel && (
            <McpPanel result={mcpResult} loading={mcpLoading} pt={lang === 'pt'} onClose={() => setShowMcpPanel(false)} onRemoved={name => setMcpResult(prev => ({ ...prev, servers: prev.servers.filter(s => s.name !== name) }))} />
          )}

          {/* ── Session switcher — shown on top of chat after project selected ── */}
          {projectPath && !showProjectPicker && projectName && projectEncodedDir && showSessionPicker && (
            <SessionSwitcher
              lang={lang}
              projectName={projectName}
              encodedDir={projectEncodedDir}
              activeSessionId={sessionId}
              onClose={() => setShowSessionPicker(false)}
              onNewSession={() => {
                setMessages([])
                setSessionId(null)
                setShowSessionPicker(false)
              }}
              onLoadSession={(id, msgs) => {
                setMessages(msgs.map(m => ({ ...m, timestamp: m.timestamp })))
                setSessionId(id)
                setShowSessionPicker(false)
              }}
              onChangeProject={() => {
                setShowSessionPicker(false)
                setShowProjectPicker(true)
              }}
            />
          )}

          {/* ── Chat UI — only rendered after a project is selected ── */}
          {projectPath && !showProjectPicker && !showMcpPanel && <>

          {/* Header — drag handle */}
          <div
            className="claude-header"
            onMouseDown={onHeaderMouseDown}
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              padding: '10px 14px', borderBottom: '1px solid var(--border)',
              background: 'var(--bg-card)', flexShrink: 0,
            }}
          >
            {/* Left: logo + name + model badge */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
              <div style={{
                width: 30, height: 30, borderRadius: 8, overflow: 'hidden', flexShrink: 0,
                background: 'var(--bg-elevated)', border: '1px solid var(--border)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                <img src="/claudeLogo.png" alt="Claude" style={{ width: 22, height: 22, objectFit: 'contain' }} />
              </div>
              <div>
                <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)', lineHeight: 1.2 }}>
                  Claude
                </div>
                <div style={{ fontSize: 10, color: 'var(--text-tertiary)', display: 'flex', alignItems: 'center', gap: 4 }}>
                  {streaming ? (
                    <span style={{ color: 'var(--accent-purple)', display: 'flex', alignItems: 'center', gap: 4 }}>
                      <Loader size={8} style={{ animation: 'claudeChatSpin 1s linear infinite' }} />
                      {currentTools.length > 0
                        ? formatToolName(currentTools[currentTools.length - 1]!)
                        : 'thinking...'}
                    </span>
                  ) : projectName ? (
                    <span style={{ display: 'flex', alignItems: 'center', gap: 3, color: 'var(--accent-purple)' }}>
                      <FolderOpen size={9} />
                      {projectName}
                    </span>
                  ) : (
                    <>
                      <span>{modelInfo?.label ?? model}</span>
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

            {/* Right: project + thinking + model picker + minimize + close */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              {/* Session history button */}
              {projectPath && (
                <button
                  className="claude-icon-btn"
                  onClick={() => setShowSessionPicker(v => !v)}
                  title={lang === 'pt' ? 'Sessões do projeto' : 'Project sessions'}
                  style={{
                    ...iconBtnStyle,
                    color: showSessionPicker ? 'var(--accent-purple)' : 'var(--text-tertiary)',
                    borderColor: showSessionPicker ? 'color-mix(in srgb, var(--accent-purple) 40%, transparent)' : 'var(--border)',
                    background: showSessionPicker ? 'color-mix(in srgb, var(--accent-purple) 10%, transparent)' : 'transparent',
                  }}
                >
                  <History size={12} />
                </button>
              )}

              {/* Project picker button */}
              <button
                className="claude-icon-btn"
                onClick={() => setShowProjectPicker(true)}
                title={projectName ? `Project: ${projectName}` : 'Select project'}
                style={{
                  ...iconBtnStyle,
                  color: projectPath ? 'var(--accent-purple)' : 'var(--text-tertiary)',
                  borderColor: projectPath ? 'color-mix(in srgb, var(--accent-purple) 40%, transparent)' : 'var(--border)',
                  background: projectPath ? 'color-mix(in srgb, var(--accent-purple) 10%, transparent)' : 'transparent',
                }}
              >
                <FolderOpen size={12} />
              </button>

              {/* Thinking toggle */}
              <button
                className="claude-icon-btn"
                onClick={() => setThinking(prev => nextThinkingBudget(prev))}
                title={thinking ? `Extended thinking: ${thinkingLabel(thinking)} tokens` : 'Enable extended thinking'}
                style={{
                  ...iconBtnStyle,
                  color: thinking ? 'var(--accent-purple)' : 'var(--text-tertiary)',
                  borderColor: thinking ? 'color-mix(in srgb, var(--accent-purple) 40%, transparent)' : 'var(--border)',
                  background: thinking ? 'color-mix(in srgb, var(--accent-purple) 10%, transparent)' : 'transparent',
                  position: 'relative',
                  width: thinking ? 'auto' : 28,
                  padding: thinking ? '0 6px' : 0,
                  gap: 4,
                  minWidth: 28,
                }}
              >
                <Brain size={12} />
                {thinking && (
                  <span style={{ fontSize: 9, fontWeight: 700 }}>{thinkingLabel(thinking)}</span>
                )}
              </button>

              {/* Model picker button */}
              <div style={{ position: 'relative' }}>
                <button
                  className="claude-icon-btn"
                  onClick={() => setShowModelPicker(v => !v)}
                  title="Change model"
                  style={{
                    ...iconBtnStyle,
                    width: 'auto',
                    padding: '0 6px',
                    gap: 4,
                    fontSize: 10,
                    color: showModelPicker ? 'var(--text-primary)' : 'var(--text-secondary)',
                  }}
                >
                  <span>{modelInfo?.label ?? model}</span>
                  <ChevronDown size={9} />
                </button>

                {/* Model dropdown */}
                {showModelPicker && (
                  <div style={{
                    position: 'absolute', top: 'calc(100% + 4px)', right: 0,
                    zIndex: 10, minWidth: 180,
                    background: 'var(--bg-card)',
                    border: '1px solid var(--border)',
                    borderRadius: 10,
                    boxShadow: '0 8px 24px rgba(0,0,0,0.3)',
                    overflow: 'hidden',
                    animation: 'claudeChatFadeIn 0.12s ease-out',
                  }}>
                    {CHAT_MODELS.map(m => {
                      const active = model === m.id
                      const badgeColor = BADGE_COLORS[m.badge] ?? 'var(--text-tertiary)'
                      return (
                        <button
                          key={m.id}
                          className="claude-model-opt"
                          onClick={() => { setModel(m.id); setShowModelPicker(false) }}
                          style={{
                            width: '100%', display: 'flex', alignItems: 'center', gap: 8,
                            padding: '8px 12px', background: active ? 'var(--bg-elevated)' : 'transparent',
                            border: 'none', cursor: 'pointer', fontFamily: 'inherit',
                            textAlign: 'left', borderBottom: '1px solid var(--border)',
                            transition: 'background 0.1s',
                          }}
                        >
                          <span style={{ flex: 1, fontSize: 12, fontWeight: active ? 700 : 400, color: active ? 'var(--text-primary)' : 'var(--text-secondary)' }}>
                            {m.label}
                          </span>
                          <span style={{
                            fontSize: 9, fontWeight: 700, color: badgeColor,
                            background: `color-mix(in srgb, ${badgeColor} 12%, transparent)`,
                            border: `1px solid color-mix(in srgb, ${badgeColor} 30%, transparent)`,
                            padding: '1px 5px', borderRadius: 3,
                          }}>
                            {m.badge}
                          </span>
                        </button>
                      )
                    })}
                  </div>
                )}
              </div>

              {/* Attach / re-embed button */}
              {onAttach && (
                <button
                  className="claude-icon-btn"
                  onClick={onAttach}
                  title={lang === 'pt' ? 'Encaixar no chat' : 'Attach to chat'}
                  style={iconBtnStyle}
                >
                  <ExternalLink size={12} style={{ transform: 'scaleX(-1)' }} />
                </button>
              )}

              {/* Minimize */}
              <button
                className="claude-icon-btn"
                onClick={() => setMinimized(true)}
                title="Minimize"
                style={iconBtnStyle}
              >
                <Minus size={12} />
              </button>

              {/* Close */}
              <button
                className="claude-icon-btn"
                onClick={() => setOpen(false)}
                title="Close"
                style={iconBtnStyle}
              >
                <X size={12} />
              </button>
            </div>
          </div>

          {/* Messages area */}
          <div
            ref={listRef}
            onClick={() => setShowModelPicker(false)}
            style={{ flex: 1, overflowY: 'auto', padding: '14px 14px 6px' }}
          >
            {messages.length === 0 && !streaming && (
              <div style={{
                height: '100%', display: 'flex', flexDirection: 'column',
                alignItems: 'center', justifyContent: 'center',
                gap: 10, color: 'var(--text-tertiary)', textAlign: 'center', padding: '0 20px',
              }}>
                <img src="/claudeLogo.png" alt="Claude" style={{ width: 36, height: 36, objectFit: 'contain', opacity: 0.3 }} />
                <div style={{ fontSize: 13, fontWeight: 600 }}>Chat with Claude</div>
                <div style={{ fontSize: 11, lineHeight: 1.65, opacity: 0.7, display: 'flex', alignItems: 'center', gap: 5 }}>
                  <FolderOpen size={11} style={{ color: 'var(--accent-purple)', flexShrink: 0 }} />
                  <span style={{ color: 'var(--accent-purple)' }}>{projectName}</span>
                </div>
                <div style={{
                  background: 'var(--bg-elevated)',
                  border: '1px solid var(--border)', borderRadius: 8,
                  padding: '8px 12px', fontSize: 11, color: 'var(--text-tertiary)',
                  textAlign: 'left', lineHeight: 1.8,
                }}>
                  <code style={{ color: 'var(--accent-purple)' }}>/clear</code>{' '}— clear messages<br />
                  <code style={{ color: 'var(--accent-purple)' }}>/new</code>{' '}— start new session
                </div>
              </div>
            )}

            {messages.map((msg, i) => {
              const isLast = i === messages.length - 1
              return (
                <ClaudeChatMessage
                  key={i}
                  msg={msg}
                  isLiveStreaming={isLast && streaming ? true : undefined}
                  currentTools={isLast && streaming ? currentTools : undefined}
                  thinking={thinking}
                />
              )
            })}

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
          <div style={{ position: 'relative', flexShrink: 0, borderTop: '1px solid var(--border)', background: 'var(--bg-card)' }}>
            <SlashSuggestions input={input} onSelect={cmd => { setInput(cmd); inputRef.current?.focus() }} accent="var(--accent-purple)" />
            <AttachmentStrip attachments={attachments} onRemove={id => setAttachments(prev => prev.filter(a => a.id !== id))} />
            <input ref={fileInputRef} type="file" multiple accept="image/*,text/*,.pdf,.md,.json,.ts,.js,.py,.txt,.csv" onChange={handleFileSelect} style={{ display: 'none' }} />
            <div style={{ padding: '10px 12px', display: 'flex', alignItems: 'flex-end', gap: 6 }}>
              <button className="claude-icon-btn" onClick={() => fileInputRef.current?.click()} title="Attach file or image" style={{ ...iconBtnStyle, flexShrink: 0, width: 30, height: 30 }}>
                <Paperclip size={12} />
              </button>
              <textarea
                ref={inputRef}
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                onPaste={handlePaste}
                placeholder="Ask anything... (paste images with Ctrl+V)"
                rows={1}
                disabled={streaming}
                style={{
                  flex: 1, resize: 'none',
                  background: 'var(--bg-elevated)', border: '1px solid var(--border)',
                  borderRadius: 8, padding: '8px 10px', fontSize: 16, fontFamily: 'inherit',
                  color: 'var(--text-primary)', outline: 'none', lineHeight: 1.5,
                  maxHeight: 120, overflowY: 'auto', transition: 'border-color 0.15s',
                }}
                onFocus={e => { e.currentTarget.style.borderColor = 'color-mix(in srgb, var(--accent-purple) 60%, transparent)' }}
                onBlur={e => { e.currentTarget.style.borderColor = 'var(--border)' }}
                onInput={e => {
                  const el = e.currentTarget
                  el.style.height = 'auto'
                  el.style.height = `${Math.min(el.scrollHeight, 120)}px`
                }}
              />
              <button
                className="claude-send-btn"
                onClick={() => { void sendMessage() }}
                disabled={(!input.trim() && attachments.length === 0) || streaming}
                title="Send (Enter)"
                style={{
                  width: 34, height: 34, borderRadius: 8, flexShrink: 0,
                  border: '1px solid color-mix(in srgb, var(--accent-purple) 50%, transparent)',
                  background: 'color-mix(in srgb, var(--accent-purple) 12%, transparent)',
                  color: 'var(--accent-purple)',
                  cursor: (input.trim() || attachments.length > 0) && !streaming ? 'pointer' : 'not-allowed',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  opacity: (input.trim() || attachments.length > 0) && !streaming ? 1 : 0.4,
                  transition: 'all 0.15s',
                }}
              >
                {streaming
                  ? <Loader size={14} style={{ animation: 'claudeChatSpin 1s linear infinite' }} />
                  : <Send size={14} />
                }
              </button>
            </div>
          </div>

          {/* ── end chat UI ── */}
          </>}

          {/* Resize handle — always present regardless of which panel is shown */}
          <div
            onMouseDown={onResizeMouseDown}
            style={{
              position: 'absolute', bottom: 0, right: 0,
              width: 12, height: 12, cursor: 'se-resize',
              zIndex: 20,
            }}
          />
        </div>
      )}
    </>
  )
}
