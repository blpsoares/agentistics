import React, { useState, useMemo } from 'react'
import type { SessionMeta } from '@agentistics/core'
import { sessionTime } from '../lib/sessionTime'
import { fmt, formatProjectName, sessionLabel, sessionTokenTotal } from '@agentistics/core'
import { HARNESS_LABELS, HARNESS_COLORS } from '../lib/harness'
import { format, parseISO } from 'date-fns'
import {
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Search,
  Clock,
  Wrench,
  FileCode,
  GitCommit,
  ExternalLink,
} from 'lucide-react'

// Types

interface Props {
  sessions: SessionMeta[]
  lang: 'pt' | 'en'
  onSelect?: (session: SessionMeta) => void
  /** session_ids to pin to the top of the list (e.g. live/open sessions), regardless of sort. */
  pinnedIds?: Set<string>
}

type SortKey = 'date' | 'tokens' | 'messages' | 'tools' | 'files'


// Translations

const T = {
  pt: {
    sort_date: 'Data',
    sort_tokens: 'Tokens',
    sort_messages: 'Mensagens',
    sort_tools: 'Tools',
    sort_files: 'Arquivos',
    filters: 'Filtros',
    search_placeholder: 'Buscar sessão...',
    min_tokens: 'Tokens mín.',
    min_messages: 'Msgs mín.',
    showing: 'Exibindo',
    of: 'de',
    per_page: 'por página',
    no_results: 'Nenhuma sessão encontrada',
    page: 'Página',
  },
  en: {
    sort_date: 'Date',
    sort_tokens: 'Tokens',
    sort_messages: 'Messages',
    sort_tools: 'Tools',
    sort_files: 'Files',
    filters: 'Filters',
    search_placeholder: 'Search session...',
    min_tokens: 'Min tokens',
    min_messages: 'Min messages',
    showing: 'Showing',
    of: 'of',
    per_page: 'per page',
    no_results: 'No sessions found',
    page: 'Page',
  },
}

// Helpers


/** Every billed counter — the column header says "tokens", so it must be all of them. */
function totalTokens(s: SessionMeta): number {
  return sessionTokenTotal(s)
}

function totalMessages(s: SessionMeta): number {
  return s.user_message_count + s.assistant_message_count
}

function totalTools(s: SessionMeta): number {
  return Object.values(s.tool_counts ?? {}).reduce((a, b) => a + b, 0)
}

function truncate(str: string, max: number): string {
  if (!str) return ''
  return str.length <= max ? str : str.slice(0, max) + '…'
}

// Sub-components

function Chip({
  icon,
  label,
  color = 'var(--text-tertiary)',
  title,
}: {
  icon: React.ReactNode
  label: string
  color?: string
  title?: string
}) {
  return (
    <div
      title={title}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 3,
        fontSize: 10,
        color,
        fontWeight: 500,
        cursor: title ? 'help' : undefined,
      }}
    >
      {icon}
      {label}
    </div>
  )
}

function HarnessBadge({ harness }: { harness?: string }) {
  // Only show badge for non-Claude harnesses — Claude is the default and needs no label
  if (!harness || harness === 'claude') return null
  const color = (HARNESS_COLORS as Record<string, string>)[harness] ?? '#888'
  const label = (HARNESS_LABELS as Record<string, string>)[harness] ?? harness
  return (
    <span
      title={label}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        padding: '1px 5px',
        borderRadius: 999,
        fontSize: 9,
        fontWeight: 600,
        letterSpacing: 0.3,
        lineHeight: 1.6,
        background: `${color}22`,
        color,
        border: `1px solid ${color}55`,
        flexShrink: 0,
        textTransform: 'uppercase',
      }}
    >
      {label}
    </span>
  )
}

function SourceDot({ source }: { source?: 'meta' | 'jsonl' | 'subdir' }) {
  if (!source) return null
  const colors: Record<string, string> = {
    meta: 'var(--anthropic-orange, #e8690b)',
    jsonl: 'var(--accent-blue, #3b82f6)',
    subdir: 'var(--accent-purple, #a855f7)',
  }
  const color = colors[source] ?? 'var(--text-tertiary)'
  return (
    <span
      title={source}
      style={{
        display: 'inline-block',
        width: 7,
        height: 7,
        borderRadius: '50%',
        background: color,
        flexShrink: 0,
        marginTop: 1,
      }}
    />
  )
}

function PillButton({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: '4px 10px',
        borderRadius: 999,
        border: active
          ? '1px solid var(--anthropic-orange, #e8690b)'
          : '1px solid var(--border-subtle)',
        background: active ? 'rgba(232,105,11,0.12)' : 'transparent',
        color: active ? 'var(--anthropic-orange, #e8690b)' : 'var(--text-secondary)',
        fontSize: 11,
        fontWeight: active ? 600 : 400,
        cursor: 'pointer',
        transition: 'all 0.15s',
        lineHeight: 1.4,
      }}
    >
      {children}
    </button>
  )
}

function IconButton({
  onClick,
  disabled,
  title,
  children,
}: {
  onClick: () => void
  disabled?: boolean
  title?: string
  children: React.ReactNode
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: 28,
        height: 28,
        borderRadius: 6,
        border: '1px solid var(--border-subtle)',
        background: 'transparent',
        color: disabled ? 'var(--text-tertiary)' : 'var(--text-secondary)',
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.4 : 1,
        transition: 'all 0.15s',
        padding: 0,
      }}
    >
      {children}
    </button>
  )
}

// Open in Claude / Nay helpers

function isNayChatSession(projectPath: string): boolean {
  return projectPath.includes('.agentistics/nay-chat')
}

function encodeProjectDir(projectPath: string): string {
  // Claude encodes the project folder by replacing every non-alphanumeric char
  // (slash, dot, underscore, etc.) with a dash — e.g. ".../bridge-cse_01H" →
  // "...-bridge-cse-01H". Matching this exactly is required to locate the JSONL.
  return projectPath.replace(/[^a-zA-Z0-9-]/g, '-')
}

function openSession(s: SessionMeta, e: React.MouseEvent) {
  e.stopPropagation()
  if (isNayChatSession(s.project_path)) {
    window.dispatchEvent(new CustomEvent('agentistics:open-nay-chat', {
      detail: { sessionId: s.session_id },
    }))
  } else {
    const harness = s.harness ?? 'claude'
    const encodedDir = encodeProjectDir(s.project_path)
    window.dispatchEvent(new CustomEvent('agentistics:open-transcript', {
      detail: {
        harness,
        sessionId: s.session_id,
        project: { path: s.project_path, name: s.project_path.split('/').pop() ?? s.project_path, encodedDir },
      },
    }))
  }
}

// Main Component

const PAGE_SIZE_OPTIONS = [10, 20, 50]

export function RecentSessions({ sessions, lang, onSelect, pinnedIds }: Props) {
  const t = T[lang]

  // Sort state
  const [sortKey, setSortKey] = useState<SortKey>('date')

  // Filter state
  const [search, setSearch] = useState('')

  // Pagination state
  const [page, setPage] = useState(0)
  const [pageSize, setPageSize] = useState(10)

  // Batch selection state
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [openWarningModal, setOpenWarningModal] = useState<string[] | null>(null)
  const [promptModal, setPromptModal] = useState<boolean>(false)
  const [batchPromptText, setBatchPromptText] = useState('')

  // Derived: sorted + filtered
  const processed = useMemo<SessionMeta[]>(() => {
    let list = [...sessions]

    // Filter: text search
    if (search.trim()) {
      const q = search.trim().toLowerCase()
      list = list.filter(
        s =>
          (s.title ?? '').toLowerCase().includes(q) ||
          (s.first_prompt ?? '').toLowerCase().includes(q) ||
          (s.project_path ?? '').toLowerCase().includes(q)
      )
    }

    // Sort — pinned (e.g. live/open) sessions always float to the top, regardless of sortKey.
    list.sort((a, b) => {
      if (pinnedIds) {
        const pa = pinnedIds.has(a.session_id) ? 1 : 0
        const pb = pinnedIds.has(b.session_id) ? 1 : 0
        if (pa !== pb) return pb - pa
      }
      switch (sortKey) {
        case 'date':
          return new Date(b.start_time).getTime() - new Date(a.start_time).getTime()
        case 'tokens':
          return totalTokens(b) - totalTokens(a)
        case 'messages':
          return totalMessages(b) - totalMessages(a)
        case 'tools':
          return totalTools(b) - totalTools(a)
        case 'files':
          return (b.files_modified ?? 0) - (a.files_modified ?? 0)
        default:
          return 0
      }
    })

    return list
  }, [sessions, search, sortKey, pinnedIds])

  // Reset to page 0 when filters/sort/pageSize change
  const totalItems = processed.length
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize))
  const safePage = Math.min(page, totalPages - 1)
  const startIdx = safePage * pageSize
  const endIdx = Math.min(startIdx + pageSize, totalItems)
  const pageItems = processed.slice(startIdx, endIdx)

  function changeSort(key: SortKey) {
    setSortKey(key)
    setPage(0)
  }

  function changePageSize(size: number) {
    setPageSize(size)
    setPage(0)
  }

  function handleSearchChange(v: string) {
    setSearch(v)
    setPage(0)
  }

  const sortOptions: { key: SortKey; label: string }[] = [
    { key: 'date', label: t.sort_date },
    { key: 'tokens', label: t.sort_tokens },
    { key: 'messages', label: t.sort_messages },
    { key: 'tools', label: t.sort_tools },
    { key: 'files', label: t.sort_files },
  ]

  const inputStyle: React.CSSProperties = {
    padding: '4px 8px',
    borderRadius: 6,
    border: '1px solid var(--border-subtle)',
    background: 'var(--bg-elevated)',
    color: 'var(--text-primary)',
    fontSize: 11,
    outline: 'none',
    minWidth: 0,
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {/* Sort controls */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
        {sortOptions.map(opt => (
          <PillButton key={opt.key} active={sortKey === opt.key} onClick={() => changeSort(opt.key)}>
            {opt.label}
          </PillButton>
        ))}

        <button
          onClick={() => {
            if (selectedIds.size === pageItems.length && pageItems.length > 0) {
              setSelectedIds(new Set())
            } else {
              setSelectedIds(new Set(pageItems.map(s => s.session_id)))
            }
          }}
          style={{
            padding: '4px 10px',
            borderRadius: 6,
            border: '1px solid var(--border-subtle)',
            background: 'var(--bg-elevated)',
            color: 'var(--text-secondary)',
            fontSize: 11,
            cursor: 'pointer',
            marginLeft: 4,
          }}
        >
          {selectedIds.size === pageItems.length && pageItems.length > 0
            ? (lang === 'pt' ? 'Desmarcar todas' : 'Deselect all')
            : (lang === 'pt' ? 'Selecionar todas' : 'Select all')}
        </button>

        {/* Spacer */}
        <div style={{ flex: 1 }} />

        {/* Search — always visible */}
        <div style={{ position: 'relative', width: 180 }}>
          <Search
            size={11}
            style={{
              position: 'absolute',
              left: 8,
              top: '50%',
              transform: 'translateY(-50%)',
              color: 'var(--text-tertiary)',
              pointerEvents: 'none',
            }}
          />
          <input
            type="text"
            value={search}
            onChange={e => handleSearchChange(e.target.value)}
            placeholder={t.search_placeholder}
            style={{ ...inputStyle, paddingLeft: 24, width: '100%', boxSizing: 'border-box' }}
          />
        </div>
      </div>

      {/* Session list */}
      {pageItems.length === 0 ? (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '40px 24px',
            gap: 8,
            color: 'var(--text-tertiary)',
          }}
        >
          <Search size={28} style={{ opacity: 0.35 }} />
          <span style={{ fontSize: 13, fontWeight: 500 }}>{t.no_results}</span>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {pageItems.map(s => {
            const tokens = totalTokens(s)
            const tools = totalTools(s)
            const msgs = totalMessages(s)

            const clickable = Boolean(onSelect)
            return (
              <div
                key={s.session_id}
                onClick={clickable ? () => onSelect!(s) : undefined}
                onKeyDown={clickable ? (e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect!(s) } }) : undefined}
                tabIndex={clickable ? 0 : undefined}
                role={clickable ? 'button' : undefined}
                style={{
                  background: 'var(--bg-elevated)',
                  border: '1px solid var(--border-subtle)',
                  borderRadius: 10,
                  padding: '12px 14px',
                  cursor: clickable ? 'pointer' : 'default',
                  transition: 'border-color 0.15s, background 0.15s',
                }}
                onMouseEnter={clickable ? (e => {
                  (e.currentTarget as HTMLDivElement).style.borderColor = 'var(--anthropic-orange)'
                }) : undefined}
                onMouseLeave={clickable ? (e => {
                  (e.currentTarget as HTMLDivElement).style.borderColor = 'var(--border-subtle)'
                }) : undefined}
              >
                {/* Header */}
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'flex-start',
                    justifyContent: 'space-between',
                    gap: 12,
                    marginBottom: 7,
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, flex: 1, minWidth: 0 }}>
                    <input
                      type="checkbox"
                      checked={selectedIds.has(s.session_id)}
                      onChange={(e) => {
                        e.stopPropagation()
                        const next = new Set(selectedIds)
                        if (next.has(s.session_id)) next.delete(s.session_id)
                        else next.add(s.session_id)
                        setSelectedIds(next)
                      }}
                      onClick={(e) => e.stopPropagation()}
                      style={{ cursor: 'pointer', width: 16, height: 16, marginTop: 2, accentColor: 'var(--anthropic-orange)' }}
                    />
                    <div style={{ flex: 1, minWidth: 0 }}>
                    {/* Project name + source dot */}
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 5,
                        fontSize: 11,
                        color: 'var(--text-tertiary)',
                        marginBottom: 3,
                      }}
                    >
                      <SourceDot source={s._source} />
                      <HarnessBadge harness={s.harness} />
                      <span
                        style={{
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {formatProjectName(s.project_path)}
                      </span>
                    </div>

                    {/* First prompt */}
                    <div
                      style={{
                        fontSize: 12,
                        color: 'var(--text-secondary)',
                        lineHeight: 1.45,
                        wordBreak: 'break-word',
                      }}
                    >
                      {(() => { const label = sessionLabel(s); return label ? truncate(label, 120) : '(no prompt)' })()}
                    </div>
                  </div>
                </div>

                  {/* Timestamp + open button */}
                  <div
                    style={{
                      flexShrink: 0,
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'flex-end',
                      gap: 4,
                    }}
                  >
                    <span style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>
                      {s.start_time ? format(parseISO(s.start_time), 'MMM d, HH:mm') : ''}
                    </span>
                    <button
                      onClick={(e) => openSession(s, e)}
                      title={isNayChatSession(s.project_path) ? 'Open in Nay Chat' : 'View transcript'}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 3,
                        padding: '2px 6px',
                        borderRadius: 4,
                        border: '1px solid var(--border-subtle)',
                        background: 'transparent',
                        color: 'var(--text-tertiary)',
                        fontSize: 10,
                        cursor: 'pointer',
                        transition: 'all 0.15s',
                        lineHeight: 1.4,
                        fontFamily: 'inherit',
                      }}
                      onMouseEnter={e => {
                        const btn = e.currentTarget
                        const hoverColor = isNayChatSession(s.project_path)
                          ? 'var(--anthropic-orange)'
                          : HARNESS_COLORS[s.harness ?? 'claude']
                        btn.style.borderColor = hoverColor
                        btn.style.color = hoverColor
                      }}
                      onMouseLeave={e => {
                        const btn = e.currentTarget
                        btn.style.borderColor = 'var(--border-subtle)'
                        btn.style.color = 'var(--text-tertiary)'
                      }}
                    >
                      <ExternalLink size={9} />
                      {isNayChatSession(s.project_path) ? 'Nay' : HARNESS_LABELS[s.harness ?? 'claude']}
                    </button>
                  </div>
                </div>

                {/* Stats row */}
                <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                  {/* Active time leads, wall clock qualifies it — a session reopened over weeks
                      used to read as "57492m" of work here. */}
                  <Chip icon={<Clock size={10} />} label={sessionTime(s, lang).combined}
                    title={sessionTime(s, lang).tooltip} />
                  <Chip
                    icon={null}
                    label={`${msgs} msgs`}
                    color="var(--accent-blue, #3b82f6)"
                  />
                  {tokens > 0 && (
                    <Chip
                      icon={null}
                      label={`${fmt(tokens)} tkn`}
                      color="var(--anthropic-orange, #e8690b)"
                    />
                  )}
                  {tools > 0 && (
                    <Chip
                      icon={<Wrench size={10} />}
                      label={`${tools} tools`}
                      color="var(--accent-green, #22c55e)"
                    />
                  )}
                  {s.git_commits > 0 && (
                    <Chip
                      icon={<GitCommit size={10} />}
                      label={`${s.git_commits} commits`}
                      color="var(--accent-purple, #a855f7)"
                    />
                  )}
                  {s.files_modified > 0 && (
                    <Chip
                      icon={<FileCode size={10} />}
                      label={`${s.files_modified} files`}
                    />
                  )}
                  {s.uses_mcp && (
                    <Chip icon={null} label="MCP" color="var(--accent-cyan, #06b6d4)" />
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Pagination */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: 8,
          marginTop: 2,
        }}
      >
        {/* Showing X–Y of Z */}
        <span style={{ fontSize: 11, color: 'var(--text-tertiary)', flexShrink: 0 }}>
          {totalItems === 0
            ? `0 ${t.of} 0`
            : `${t.showing} ${startIdx + 1}–${endIdx} ${t.of} ${totalItems}`}
        </span>

        {/* Page navigation */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <IconButton
            onClick={() => setPage(0)}
            disabled={safePage === 0}
            title={`${t.page} 1`}
          >
            <ChevronsLeft size={13} />
          </IconButton>
          <IconButton
            onClick={() => setPage(p => Math.max(0, p - 1))}
            disabled={safePage === 0}
          >
            <ChevronLeft size={13} />
          </IconButton>

          <span
            style={{
              fontSize: 11,
              color: 'var(--text-secondary)',
              padding: '0 6px',
              whiteSpace: 'nowrap',
            }}
          >
            {safePage + 1} / {totalPages}
          </span>

          <IconButton
            onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))}
            disabled={safePage >= totalPages - 1}
          >
            <ChevronRight size={13} />
          </IconButton>
          <IconButton
            onClick={() => setPage(totalPages - 1)}
            disabled={safePage >= totalPages - 1}
            title={`${t.page} ${totalPages}`}
          >
            <ChevronsRight size={13} />
          </IconButton>
        </div>

        {/* Items per page */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
          <span style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>{t.per_page}</span>
          <div style={{ display: 'flex', gap: 4 }}>
            {PAGE_SIZE_OPTIONS.map(size => (
              <PillButton
                key={size}
                active={pageSize === size}
                onClick={() => changePageSize(size)}
              >
                {size}
              </PillButton>
            ))}
          </div>
        </div>
      </div>

      {/* Sticky Floating Mass Action Bar */}
      {selectedIds.size > 0 && (
        <div
          style={{
            position: 'sticky',
            bottom: 16,
            zIndex: 100,
            background: 'var(--bg-elevated)',
            border: '1px solid var(--anthropic-orange, #e8690b)',
            boxShadow: '0 4px 20px rgba(0,0,0,0.25)',
            borderRadius: 12,
            padding: '12px 18px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 12,
            flexWrap: 'wrap',
          }}
        >
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>
            {lang === 'pt' ? `${selectedIds.size} sessão(ões) selecionada(s)` : `${selectedIds.size} session(s) selected`}
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            {/* Mandar Prompt */}
            <button
              onClick={() => setPromptModal(true)}
              style={{
                padding: '6px 12px',
                borderRadius: 6,
                background: 'var(--anthropic-orange)',
                color: '#fff',
                border: 'none',
                fontSize: 12,
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              {lang === 'pt' ? '💬 Enviar Prompt' : '💬 Send Prompt'}
            </button>

            {/* Desligar */}
            <button
              onClick={() => {
                for (const id of selectedIds) {
                  fetch(`/api/session/kill`, { method: 'POST', body: JSON.stringify({ id }) }).catch(() => {})
                }
                setSelectedIds(new Set())
              }}
              style={{
                padding: '6px 12px',
                borderRadius: 6,
                background: 'rgba(239, 68, 68, 0.15)',
                color: '#ef4444',
                border: '1px solid rgba(239, 68, 68, 0.3)',
                fontSize: 12,
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              {lang === 'pt' ? '🛑 Desligar' : '🛑 Kill'}
            </button>

            {/* Reabrir */}
            <button
              onClick={() => {
                const selectedSessions = sessions.filter(s => selectedIds.has(s.session_id))
                const open = selectedSessions.filter(s => pinnedIds?.has(s.session_id))
                if (open.length > 0) {
                  setOpenWarningModal(open.map(s => sessionLabel(s) || s.session_id))
                } else {
                  for (const s of selectedSessions) {
                    fetch(`/api/session/start`, { method: 'POST', body: JSON.stringify({ resumeId: s.session_id, harness: s.harness, cwd: s.project_path }) }).catch(() => {})
                  }
                  setSelectedIds(new Set())
                }
              }}
              style={{
                padding: '6px 12px',
                borderRadius: 6,
                background: 'rgba(34, 197, 94, 0.15)',
                color: '#22c55e',
                border: '1px solid rgba(34, 197, 94, 0.3)',
                fontSize: 12,
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              {lang === 'pt' ? '🔄 Reabrir' : '🔄 Reopen'}
            </button>

            {/* Clear selection */}
            <button
              onClick={() => setSelectedIds(new Set())}
              style={{
                padding: '6px 12px',
                borderRadius: 6,
                background: 'transparent',
                color: 'var(--text-tertiary)',
                border: '1px solid var(--border-subtle)',
                fontSize: 12,
                cursor: 'pointer',
              }}
            >
              {lang === 'pt' ? 'Limpar seleção' : 'Clear selection'}
            </button>
          </div>
        </div>
      )}

      {/* Warning Modal */}
      {openWarningModal && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(0,0,0,0.6)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20
        }}>
          <div style={{
            background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 12,
            padding: 24, maxWidth: 480, width: '100%', display: 'flex', flexDirection: 'column', gap: 16
          }}>
            <div style={{ fontSize: 16, fontWeight: 700, color: '#ef4444' }}>
              {lang === 'pt' ? 'Aviso: Não é possível reabrir' : 'Warning: Cannot reopen'}
            </div>
            <div style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.5 }}>
              {lang === 'pt'
                ? 'As seguintes sessões já estão abertas e não podem ser religadas:'
                : 'The following sessions are already open and cannot be restarted:'}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, background: 'var(--bg-elevated)', padding: 12, borderRadius: 8 }}>
              {openWarningModal.map(name => (
                <div key={name} style={{ fontSize: 13, fontWeight: 600, color: 'var(--anthropic-orange)' }}>
                  • {name}
                </div>
              ))}
            </div>
            <button
              onClick={() => setOpenWarningModal(null)}
              style={{
                alignSelf: 'flex-end', padding: '8px 18px', borderRadius: 8,
                background: 'var(--anthropic-orange)', color: '#fff', border: 'none',
                fontWeight: 600, fontSize: 13, cursor: 'pointer'
              }}
            >
              {lang === 'pt' ? 'Entendido' : 'OK'}
            </button>
          </div>
        </div>
      )}

      {/* Prompt Modal */}
      {promptModal && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(0,0,0,0.6)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20
        }}>
          <div style={{
            background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 12,
            padding: 24, maxWidth: 500, width: '100%', display: 'flex', flexDirection: 'column', gap: 16
          }}>
            <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-primary)' }}>
              {lang === 'pt' ? `Enviar prompt para ${selectedIds.size} sessões` : `Send prompt to ${selectedIds.size} sessions`}
            </div>
            <textarea
              value={batchPromptText}
              onChange={e => setBatchPromptText(e.target.value)}
              placeholder={lang === 'pt' ? 'Digite a instrução para as sessões selecionadas...' : 'Type prompt for selected sessions...'}
              rows={4}
              style={{
                width: '100%', boxSizing: 'border-box', padding: 10, borderRadius: 8,
                border: '1px solid var(--border)', background: 'var(--bg-elevated)',
                color: 'var(--text-primary)', fontFamily: 'inherit', fontSize: 13, outline: 'none'
              }}
            />
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
              <button
                onClick={() => { setPromptModal(false); setBatchPromptText('') }}
                style={{ padding: '8px 14px', borderRadius: 8, border: '1px solid var(--border-subtle)', background: 'transparent', color: 'var(--text-secondary)', cursor: 'pointer', fontSize: 13 }}
              >
                {lang === 'pt' ? 'Cancelar' : 'Cancel'}
              </button>
              <button
                onClick={() => {
                  for (const id of selectedIds) {
                    fetch(`/api/session/prompt`, { method: 'POST', body: JSON.stringify({ id, prompt: batchPromptText }) }).catch(() => {})
                  }
                  setPromptModal(false)
                  setBatchPromptText('')
                  setSelectedIds(new Set())
                }}
                style={{ padding: '8px 16px', borderRadius: 8, background: 'var(--anthropic-orange)', color: '#fff', border: 'none', fontWeight: 600, cursor: 'pointer', fontSize: 13 }}
              >
                {lang === 'pt' ? 'Enviar' : 'Send'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
