import React, { useState, useMemo } from 'react'
import type { SessionMeta } from '../lib/types'
import { formatProjectName } from '../lib/types'
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

// ─── Types ────────────────────────────────────────────────────────────────────

interface Props {
  sessions: SessionMeta[]
  lang: 'pt' | 'en'
  onSelect?: (session: SessionMeta) => void
}

type SortKey = 'date' | 'tokens' | 'messages' | 'tools' | 'files'


// ─── Translations ─────────────────────────────────────────────────────────────

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

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmt(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`
  return String(n)
}

function totalTokens(s: SessionMeta): number {
  return s.input_tokens + s.output_tokens
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

// ─── Sub-components ───────────────────────────────────────────────────────────

function Chip({
  icon,
  label,
  color = 'var(--text-tertiary)',
}: {
  icon: React.ReactNode
  label: string
  color?: string
}) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 3,
        fontSize: 10,
        color,
        fontWeight: 500,
      }}
    >
      {icon}
      {label}
    </div>
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

// ─── Open in Claude / Nay helpers ─────────────────────────────────────────────

function isNayChatSession(projectPath: string): boolean {
  return projectPath.includes('.agentistics/nay-chat')
}

function encodeProjectDir(projectPath: string): string {
  return projectPath.replace(/\//g, '-')
}

function openSession(s: SessionMeta, e: React.MouseEvent) {
  e.stopPropagation()
  if (isNayChatSession(s.project_path)) {
    window.dispatchEvent(new CustomEvent('agentistics:open-chat', {
      detail: { tab: 'nay', sessionId: s.session_id },
    }))
  } else {
    const encodedDir = encodeProjectDir(s.project_path)
    window.dispatchEvent(new CustomEvent('agentistics:open-chat', {
      detail: {
        tab: 'claude',
        sessionId: s.session_id,
        project: { path: s.project_path, name: s.project_path.split('/').pop() ?? s.project_path, encodedDir },
      },
    }))
  }
}

// ─── Main Component ───────────────────────────────────────────────────────────

const PAGE_SIZE_OPTIONS = [10, 20, 50]

export function RecentSessions({ sessions, lang, onSelect }: Props) {
  const t = T[lang]

  // Sort state
  const [sortKey, setSortKey] = useState<SortKey>('date')

  // Filter state
  const [search, setSearch] = useState('')

  // Pagination state
  const [page, setPage] = useState(0)
  const [pageSize, setPageSize] = useState(10)

  // Derived: sorted + filtered
  const processed = useMemo<SessionMeta[]>(() => {
    let list = [...sessions]

    // Filter: text search
    if (search.trim()) {
      const q = search.trim().toLowerCase()
      list = list.filter(
        s =>
          (s.first_prompt ?? '').toLowerCase().includes(q) ||
          (s.project_path ?? '').toLowerCase().includes(q)
      )
    }

    // Sort
    list.sort((a, b) => {
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
  }, [sessions, search, sortKey])

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
                      {s.first_prompt ? truncate(s.first_prompt, 120) : '(no prompt)'}
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
                      title={isNayChatSession(s.project_path) ? 'Open in Nay Chat' : 'Open in Claude'}
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
                        btn.style.borderColor = isNayChatSession(s.project_path) ? 'var(--anthropic-orange)' : 'var(--accent-purple, #a855f7)'
                        btn.style.color = isNayChatSession(s.project_path) ? 'var(--anthropic-orange)' : 'var(--accent-purple, #a855f7)'
                      }}
                      onMouseLeave={e => {
                        const btn = e.currentTarget
                        btn.style.borderColor = 'var(--border-subtle)'
                        btn.style.color = 'var(--text-tertiary)'
                      }}
                    >
                      <ExternalLink size={9} />
                      {isNayChatSession(s.project_path) ? 'Nay' : 'Claude'}
                    </button>
                  </div>
                </div>

                {/* Stats row */}
                <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                  <Chip icon={<Clock size={10} />} label={`${s.duration_minutes}m`} />
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
    </div>
  )
}
