import React, { useState, useRef, useEffect, useLayoutEffect, useMemo } from 'react'
import type { Filters, DateRange, Project, Lang, HarnessId } from '@agentistics/core'
import { formatModel, formatProjectName, repoShortName } from '@agentistics/core'
import { Layers, Cpu, ChevronDown, X, CalendarDays, Check, Users, GitBranch, Search } from 'lucide-react'
import { HARNESS_LABELS, HARNESS_COLORS } from '../lib/harness'
import { ProjectsModal } from './ProjectsModal'
import { UsersFilter } from './UsersFilter'
import { HarnessFilter } from './HarnessFilter'
import { PresenceFilter } from './PresenceFilter'
import type { MemberPresence } from '@agentistics/core'
import { DatePicker } from './DatePicker'
import { format } from 'date-fns'
import { useIsMobile } from '../hooks/useIsMobile'

interface Props {
  filters: Filters
  onChange: (f: Filters) => void
  projects: Project[]
  sessionCountByProject: Record<string, number>
  models: string[]
  /** Models grouped by the harness that used them. Shown as sections in the
   *  unified view; a single group when a harness filter is active. */
  modelGroups?: { harness: HarnessId; models: string[] }[]
  modelsInProject?: Set<string> | null
  users: string[]
  /** Available harnesses in the data — drives visibility (show when length > 1). */
  harnesses?: HarnessId[]
  /** Team/central: live presence per member — drives the online/offline filter pill. */
  presence?: Record<string, MemberPresence>
  lang: Lang
  compact?: boolean
}

const DATE_RANGES: { key: DateRange; labelPt: string; labelEn: string }[] = [
  { key: '7d',  labelPt: '7d',       labelEn: '7d'      },
  { key: '30d', labelPt: '30d',      labelEn: '30d'     },
  { key: '90d', labelPt: '90d',      labelEn: '90d'     },
  { key: 'all', labelPt: 'Tudo',     labelEn: 'All'     },
]

const CTL: React.CSSProperties = {
  background: 'var(--bg-elevated)',
  border: '1px solid var(--border)',
  borderRadius: 7,
  color: 'var(--text-primary)',
  fontSize: 12,
  fontFamily: 'inherit',
  padding: '5px 10px',
  cursor: 'pointer',
  outline: 'none',
  height: 30,
  display: 'flex',
  alignItems: 'center',
}

export function FiltersBar({ filters, onChange, projects, sessionCountByProject, models, modelGroups, modelsInProject, users, harnesses, presence, lang, compact }: Props) {
  // Fall back to a single unlabeled group when modelGroups isn't provided.
  const groups: { harness: HarnessId | null; models: string[] }[] =
    modelGroups && modelGroups.length > 0
      ? modelGroups
      : [{ harness: null, models }]
  const showGroupHeaders = groups.length > 1
  const isMobile = useIsMobile()
  const [showProjectsModal, setShowProjectsModal] = useState(false)
  const [showModelDropdown, setShowModelDropdown] = useState(false)
  const [showRepoDropdown, setShowRepoDropdown] = useState(false)
  const [repoQuery, setRepoQuery] = useState('')
  const repoDropdownRef = useRef<HTMLDivElement>(null)
  const modelDropdownRef = useRef<HTMLDivElement>(null)
  const popoverRef = useRef<HTMLDivElement>(null)
  const today = format(new Date(), 'yyyy-MM-dd')
  const hasCustomDates = !!(filters.customStart || filters.customEnd)

  const selectedModels = filters.models ?? []
  const hasModelFilter = selectedModels.length > 0

  const hasProjects = filters.projects.length > 0
  const projectLabel = lang === 'pt'
    ? hasProjects ? `${filters.projects.length} projeto${filters.projects.length > 1 ? 's' : ''}` : 'Projetos'
    : hasProjects ? `${filters.projects.length} project${filters.projects.length > 1 ? 's' : ''}` : 'Projects'

  const modelLabel = hasModelFilter
    ? selectedModels.length === 1
      ? formatModel(selectedModels[0]!)
      : `${selectedModels.length} ${lang === 'pt' ? 'modelos' : 'models'}`
    : lang === 'pt' ? 'Modelos' : 'Models'

  const toggleModel = (m: string) => {
    const next = selectedModels.includes(m)
      ? selectedModels.filter(x => x !== m)
      : [...selectedModels, m]
    onChange({ ...filters, models: next })
  }

  // ── Repository filter (group-by-remote) — options derived from projects[].gitRemote ──
  // Unlinked projects collapse into a single '' bucket (matches the Repositories page).
  const selectedRepos = filters.repos ?? []
  const hasRepoFilter = selectedRepos.length > 0
  const repoOptions = useMemo(() => {
    const counts: Record<string, number> = {}
    for (const p of projects) {
      const key = p.gitRemote || ''
      counts[key] = (counts[key] ?? 0) + (sessionCountByProject[p.path] ?? 0)
    }
    return Object.entries(counts)
      .map(([value, count]) => ({
        value, count, linked: value !== '',
        label: value !== '' ? repoShortName(value) : (lang === 'pt' ? 'Sem repositório' : 'No repository'),
      }))
      .sort((a, b) => (a.linked === b.linked ? b.count - a.count : a.linked ? -1 : 1))
  }, [projects, sessionCountByProject, lang])
  // Only expose the filter once there's an actual repo dimension (≥1 linked remote).
  const showRepoFilter = repoOptions.some(o => o.linked)
  const repoFilteredOptions = useMemo(() => {
    const q = repoQuery.trim().toLowerCase()
    if (!q) return repoOptions
    return repoOptions.filter(o => `${o.label} ${o.value}`.toLowerCase().includes(q))
  }, [repoOptions, repoQuery])
  const repoLabel = hasRepoFilter
    ? selectedRepos.length === 1
      ? (repoOptions.find(o => o.value === selectedRepos[0])?.label ?? (selectedRepos[0] === '' ? (lang === 'pt' ? 'Sem repositório' : 'No repository') : repoShortName(selectedRepos[0]!)))
      : `${selectedRepos.length} ${lang === 'pt' ? 'repositórios' : 'repos'}`
    : lang === 'pt' ? 'Repositórios' : 'Repos'
  const toggleRepo = (v: string) => {
    const next = selectedRepos.includes(v) ? selectedRepos.filter(x => x !== v) : [...selectedRepos, v]
    onChange({ ...filters, repos: next })
  }

  useEffect(() => {
    if (!showModelDropdown) return
    function handleClickOutside(e: MouseEvent) {
      if (modelDropdownRef.current && !modelDropdownRef.current.contains(e.target as Node)) {
        setShowModelDropdown(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [showModelDropdown])

  useEffect(() => {
    if (!showRepoDropdown) return
    function handleClickOutside(e: MouseEvent) {
      if (repoDropdownRef.current && !repoDropdownRef.current.contains(e.target as Node)) {
        setShowRepoDropdown(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [showRepoDropdown])

  // Clamp the popover so it never overflows the viewport (which would give the whole page a
  // horizontal scrollbar). First cap its width to the viewport, then shift it left if its
  // right edge still spills over — keeping the left edge at least 8px from the viewport edge.
  useLayoutEffect(() => {
    if (!showModelDropdown || !popoverRef.current || !modelDropdownRef.current) return
    const MARGIN = 8
    const container = modelDropdownRef.current.getBoundingClientRect()
    const popover = popoverRef.current
    // Reset any previous adjustment before measuring.
    popover.style.left = '0'
    popover.style.right = 'auto'
    // Never let the popover be wider than the viewport (minus margins).
    popover.style.maxWidth = `${window.innerWidth - MARGIN * 2}px`
    const popoverWidth = popover.offsetWidth
    const rightEdge = container.left + popoverWidth
    const overflow = rightEdge - window.innerWidth + MARGIN
    if (overflow > 0) {
      // Cap the shift so the popover's left edge never crosses the viewport's left margin.
      const maxShift = Math.max(0, container.left - MARGIN)
      popover.style.left = `-${Math.min(overflow, maxShift)}px`
    }
  }, [showModelDropdown])

  return (
    <>
      <div style={{
        display: 'flex',
        gap: 8,
        alignItems: 'center',
        flexWrap: 'wrap',
        padding: compact ? '10px 12px' : '8px 0',
      }}>

        {/* Date range presets — stretch to fill the row on mobile */}
        <div style={{ display: 'flex', gap: 3, width: isMobile ? '100%' : undefined }}>
          {DATE_RANGES.map(r => {
            const active = filters.dateRange === r.key && !filters.customStart
            return (
              <button
                key={r.key}
                onClick={() => onChange({ ...filters, dateRange: r.key, customStart: '', customEnd: '' })}
                style={{
                  ...CTL,
                  flex: isMobile ? 1 : undefined,
                  justifyContent: 'center',
                  border: active ? '1px solid rgba(217,119,6,0.5)' : '1px solid var(--border)',
                  background: active ? 'var(--anthropic-orange-dim)' : 'var(--bg-elevated)',
                  color: active ? 'var(--anthropic-orange)' : 'var(--text-secondary)',
                  fontWeight: active ? 600 : 400,
                }}
              >
                {lang === 'pt' ? r.labelPt : r.labelEn}
              </button>
            )
          })}
        </div>

        {/* Divider */}
        {!compact && <div style={{ width: 1, height: 20, background: 'var(--border)', flexShrink: 0 }} />}

        {/* Custom date range */}
        <div style={{
          display: 'flex', alignItems: 'center',
          flex: isMobile ? '1 1 100%' : undefined,
          background: hasCustomDates ? 'var(--anthropic-orange-dim)' : 'var(--bg-elevated)',
          border: hasCustomDates ? '1px solid rgba(217,119,6,0.55)' : '1px solid var(--border)',
          borderRadius: 7,
          height: 30,
          paddingLeft: 8,
          gap: 1,
        }}>
          <CalendarDays
            size={12}
            style={{
              color: hasCustomDates ? 'var(--anthropic-orange)' : 'var(--text-tertiary)',
              flexShrink: 0,
              marginRight: 1,
              opacity: hasCustomDates ? 0.85 : 0.5,
            }}
          />
          <DatePicker
            value={filters.customStart}
            onChange={v => onChange({ ...filters, dateRange: 'all', customStart: v })}
            label={lang === 'pt' ? 'De' : 'From'}
            placeholder="DD/MM/YY"
            max={today}
            rangeStart={filters.customStart}
            rangeEnd={filters.customEnd}
            stuck={true}
            lang={lang}
          />
          <div style={{
            width: 14, height: 1,
            background: hasCustomDates ? 'rgba(217,119,6,0.4)' : 'var(--border)',
            flexShrink: 0,
            marginTop: 1,
          }} />
          <DatePicker
            value={filters.customEnd}
            onChange={v => onChange({ ...filters, dateRange: 'all', customEnd: v })}
            label={lang === 'pt' ? 'Até' : 'To'}
            placeholder="DD/MM/YY"
            max={today}
            min={filters.customStart || undefined}
            rangeStart={filters.customStart}
            rangeEnd={filters.customEnd}
            stuck={true}
            lang={lang}
            align="right"
          />
          {hasCustomDates && (
            <button
              onClick={() => onChange({ ...filters, customStart: '', customEnd: '' })}
              title={lang === 'pt' ? 'Limpar datas' : 'Clear dates'}
              style={{
                background: 'transparent', border: 'none', cursor: 'pointer',
                color: 'var(--anthropic-orange)', padding: '0 8px 0 2px',
                display: 'flex', alignItems: 'center', flexShrink: 0,
                opacity: 0.7,
              }}
            >
              <X size={11} />
            </button>
          )}
        </div>

        {/* Dimension filters (members/harnesses/presence/repos/projects/models). On desktop this
            wrapper is a deliberate SECOND row (flexBasis:100% forces its own line, so the bar never
            wraps mid-group); on mobile `display:contents` dissolves the wrapper so the controls flow
            inline exactly as before. */}
        <div style={isMobile
          ? { display: 'contents' }
          : { display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', flexBasis: '100%' }}>

        {users.length > 0 && (
          <UsersFilter
            users={users}
            selected={filters.users ?? []}
            onChange={u => onChange({ ...filters, users: u })}
            lang={lang}
            presence={presence}
            presenceFilter={filters.presence}
          />
        )}

        {harnesses && harnesses.length > 1 && (
          <HarnessFilter
            harnesses={harnesses}
            selected={filters.harnesses ?? []}
            onChange={h => onChange({ ...filters, harnesses: h })}
            lang={lang}
          />
        )}

        {presence && Object.keys(presence).length > 0 && (
          <PresenceFilter
            value={filters.presence}
            onChange={p => onChange({ ...filters, presence: p })}
            onlineCount={Object.values(presence).filter(p => p.online).length}
            offlineCount={Object.values(presence).filter(p => !p.online).length}
            lang={lang}
          />
        )}

        {/* Repositories (group-by-remote) — only when a repo dimension exists */}
        {showRepoFilter && (
          <div ref={repoDropdownRef} style={{ position: 'relative', flex: isMobile ? '1 1 0' : undefined }}>
            <button
              onClick={() => { setShowRepoDropdown(v => !v); setRepoQuery('') }}
              title={lang === 'pt' ? 'Filtrar por repositório' : 'Filter by repository'}
              style={{
                ...CTL,
                gap: 5,
                width: isMobile ? '100%' : undefined,
                border: hasRepoFilter ? '1px solid rgba(217,119,6,0.5)' : '1px solid var(--border)',
                background: hasRepoFilter ? 'var(--anthropic-orange-dim)' : 'var(--bg-elevated)',
                color: hasRepoFilter ? 'var(--anthropic-orange)' : 'var(--text-secondary)',
                minWidth: isMobile ? 0 : 120,
                justifyContent: 'space-between',
              }}
            >
              <GitBranch size={11} style={{ flexShrink: 0 }} />
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1, textAlign: 'left' }}>
                {repoLabel}
              </span>
              <ChevronDown size={11} style={{ flexShrink: 0, opacity: 0.5, transform: showRepoDropdown ? 'rotate(180deg)' : undefined, transition: 'transform 0.15s' }} />
            </button>
            {showRepoDropdown && (
              <div style={{
                position: 'absolute', top: 'calc(100% + 4px)', left: 0,
                background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 8,
                boxShadow: '0 4px 16px rgba(0,0,0,0.25)', zIndex: 1000,
                width: isMobile ? 'min(92vw, 320px)' : 280, maxHeight: '60vh',
                display: 'flex', flexDirection: 'column', boxSizing: 'border-box', padding: 6,
              }}>
                {/* Search box — filters the repo list, mirroring the Projects filter */}
                <div style={{ position: 'relative', display: 'flex', alignItems: 'center', marginBottom: 4, flexShrink: 0 }}>
                  <Search size={13} color="var(--text-tertiary)" style={{ position: 'absolute', left: 8, pointerEvents: 'none' }} />
                  <input
                    value={repoQuery}
                    onChange={e => setRepoQuery(e.target.value)}
                    autoFocus
                    placeholder={lang === 'pt' ? 'Buscar repositório…' : 'Search repository…'}
                    style={{
                      width: '100%', boxSizing: 'border-box', fontSize: 12, fontFamily: 'inherit',
                      color: 'var(--text-primary)', background: 'var(--bg-card)', border: '1px solid var(--border)',
                      borderRadius: 6, padding: '6px 8px 6px 26px', outline: 'none',
                    }}
                  />
                </div>
                <div style={{ overflowY: 'auto', minHeight: 0 }}>
                {repoFilteredOptions.length === 0 && (
                  <div style={{ fontSize: 12, color: 'var(--text-tertiary)', padding: '8px 10px', textAlign: 'center' }}>
                    {lang === 'pt' ? 'Nenhum repositório' : 'No repositories'}
                  </div>
                )}
                {repoFilteredOptions.map(opt => {
                  const selected = selectedRepos.includes(opt.value)
                  return (
                    <button
                      key={opt.value || '__none__'}
                      onClick={() => toggleRepo(opt.value)}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 8, width: '100%',
                        padding: '7px 10px', borderRadius: 6, border: 'none', cursor: 'pointer',
                        background: selected ? 'var(--anthropic-orange-dim)' : 'transparent',
                        color: selected ? 'var(--anthropic-orange)' : 'var(--text-secondary)',
                        fontSize: 12, fontFamily: 'inherit', textAlign: 'left',
                      }}
                      onMouseEnter={e => { if (!selected) (e.currentTarget as HTMLButtonElement).style.background = 'var(--bg-card-hover)' }}
                      onMouseLeave={e => { if (!selected) (e.currentTarget as HTMLButtonElement).style.background = 'transparent' }}
                    >
                      <span style={{ width: 14, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        {selected && <Check size={12} strokeWidth={3} />}
                      </span>
                      {opt.linked
                        ? <GitBranch size={11} style={{ flexShrink: 0, opacity: 0.6 }} />
                        : <X size={11} style={{ flexShrink: 0, opacity: 0.6 }} />}
                      <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: opt.linked ? undefined : 'var(--text-tertiary)' }}>{opt.label}</span>
                      <span style={{ fontSize: 11, color: 'var(--text-tertiary)', flexShrink: 0 }}>{opt.count}</span>
                    </button>
                  )
                })}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Projects */}
        <button
          onClick={() => setShowProjectsModal(true)}
          title={lang === 'pt' ? 'Filtrar por projeto' : 'Filter by project'}
          style={{
            ...CTL,
            gap: 5,
            flex: isMobile ? '1 1 0' : undefined,
            border: hasProjects ? '1px solid rgba(217,119,6,0.5)' : '1px solid var(--border)',
            background: hasProjects ? 'var(--anthropic-orange-dim)' : 'var(--bg-elevated)',
            color: hasProjects ? 'var(--anthropic-orange)' : 'var(--text-secondary)',
            minWidth: isMobile ? 0 : 110,
            justifyContent: 'space-between',
          }}
        >
          <Layers size={11} style={{ flexShrink: 0 }} />
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1, textAlign: 'left' }}>
            {projectLabel}
          </span>
          <ChevronDown size={11} style={{ flexShrink: 0, opacity: 0.5 }} />
        </button>

        {/* Model multi-select */}
        <div ref={modelDropdownRef} style={{ position: 'relative', flex: isMobile ? '1 1 0' : undefined }}>
          <button
            onClick={() => setShowModelDropdown(v => !v)}
            title={lang === 'pt' ? 'Filtrar por modelo' : 'Filter by model'}
            style={{
              ...CTL,
              gap: 5,
              width: isMobile ? '100%' : undefined,
              border: hasModelFilter ? '1px solid rgba(217,119,6,0.5)' : '1px solid var(--border)',
              background: hasModelFilter ? 'var(--anthropic-orange-dim)' : 'var(--bg-elevated)',
              color: hasModelFilter ? 'var(--anthropic-orange)' : 'var(--text-secondary)',
              minWidth: isMobile ? 0 : 130,
              justifyContent: 'space-between',
            }}
          >
            <Cpu size={11} style={{ flexShrink: 0 }} />
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1, textAlign: 'left' }}>
              {modelLabel}
            </span>
            <ChevronDown size={11} style={{ flexShrink: 0, opacity: 0.5, transform: showModelDropdown ? 'rotate(180deg)' : undefined, transition: 'transform 0.15s' }} />
          </button>

          {showModelDropdown && (
            <div ref={popoverRef} style={{
              position: 'absolute',
              top: 'calc(100% + 4px)',
              left: 0,
              background: 'var(--bg-elevated)',
              border: '1px solid var(--border)',
              borderRadius: 8,
              boxShadow: '0 4px 16px rgba(0,0,0,0.25)',
              zIndex: 1000,
              // On mobile, cap to 92vw so it never exceeds the viewport;
              // on desktop, 80vw keeps the existing generous maximum.
              width: isMobile ? 'min(92vw, 360px)' : undefined,
              maxWidth: isMobile ? undefined : 'min(80vw, 720px)',
              maxHeight: '70vh',
              overflowY: 'auto',
              overflowX: 'auto',
              boxSizing: 'border-box',
              padding: 6,
            }}>
              {/* Harness groups laid out as side-by-side columns (a grid), so the
                  list doesn't become one giant vertical column.
                  On mobile collapse to 1 column; desktop allows up to 4. */}
              <div style={{
                display: 'grid',
                gridTemplateColumns: isMobile
                  ? `repeat(${Math.min(groups.length, 2)}, minmax(130px, 1fr))`
                  : `repeat(${Math.min(groups.length, 4)}, minmax(150px, 1fr))`,
                gap: 2,
                alignItems: 'start',
              }}>
              {groups.map((group, gi) => (
                <div key={group.harness ?? '__all__'} style={{
                  borderLeft: gi > 0 ? '1px solid var(--border)' : 'none',
                  paddingLeft: gi > 0 ? 6 : 0,
                }}>
                  {showGroupHeaders && group.harness && (
                    <div style={{
                      display: 'flex', alignItems: 'center', gap: 6,
                      padding: '7px 12px 3px',
                      fontSize: 10, fontWeight: 700,
                      textTransform: 'uppercase', letterSpacing: '0.06em',
                      color: HARNESS_COLORS[group.harness],
                    }}>
                      <span style={{
                        width: 7, height: 7, borderRadius: '50%',
                        background: HARNESS_COLORS[group.harness], flexShrink: 0,
                      }} />
                      {HARNESS_LABELS[group.harness]}
                    </div>
                  )}
                  {group.models.map(m => {
                    const disabled = modelsInProject ? !modelsInProject.has(m) : false
                    const selected = selectedModels.includes(m)
                    return (
                      <button
                        key={`${group.harness ?? ''}:${m}`}
                        disabled={disabled}
                        onClick={() => toggleModel(m)}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 8,
                          width: '100%',
                          padding: '7px 12px',
                          background: selected ? 'var(--anthropic-orange-dim)' : 'transparent',
                          border: 'none',
                          cursor: disabled ? 'not-allowed' : 'pointer',
                          color: disabled ? 'var(--text-tertiary)' : selected ? 'var(--anthropic-orange)' : 'var(--text-primary)',
                          fontSize: 12,
                          fontFamily: 'inherit',
                          textAlign: 'left',
                          opacity: disabled ? 0.45 : 1,
                          transition: 'background 0.1s',
                        }}
                      >
                        <div style={{
                          width: 14,
                          height: 14,
                          borderRadius: 3,
                          border: selected
                            ? '1.5px solid var(--anthropic-orange)'
                            : disabled
                              ? '1.5px solid var(--border)'
                              : '1.5px solid var(--text-tertiary)',
                          background: selected ? 'var(--anthropic-orange)' : 'transparent',
                          flexShrink: 0,
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                        }}>
                          {selected && <Check size={9} color="white" strokeWidth={3} />}
                        </div>
                        <span style={{ flex: 1 }}>{formatModel(m)}</span>
                        {disabled && (
                          <span style={{ fontSize: 10, opacity: 0.7 }}>
                            {lang === 'pt' ? 'sem uso' : 'unused'}
                          </span>
                        )}
                      </button>
                    )
                  })}
                </div>
              ))}
              </div>
              {hasModelFilter && (
                <>
                  <div style={{ height: 1, background: 'var(--border)', margin: '4px 0' }} />
                  <button
                    onClick={() => { onChange({ ...filters, models: [] }); setShowModelDropdown(false) }}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 8,
                      width: '100%', padding: '7px 12px',
                      background: 'transparent', border: 'none',
                      cursor: 'pointer', color: 'var(--text-secondary)',
                      fontSize: 12, fontFamily: 'inherit', textAlign: 'left',
                    }}
                  >
                    <X size={11} />
                    {lang === 'pt' ? 'Limpar modelos' : 'Clear models'}
                  </button>
                </>
              )}
            </div>
          )}
        </div>
        </div>{/* end dimension-filters row */}

        {/* Reset button removed — clear individual chips via their × instead. */}
      </div>

      {/* Active-filter chips — each category (members/projects/harnesses/models) is its own
          row that slides in/out INDEPENDENTLY, so adding a second filter type animates the new
          line too (not just the first). Rows are always mounted; their grid-rows toggle. */}
      <div style={{ display: 'flex', flexDirection: 'column', padding: compact ? '0 12px' : 0 }}>
        <AnimatedRow show={(filters.users?.length ?? 0) > 0}>
          <ChipRow label={lang === 'pt' ? 'Membros' : 'Members'}>
            {(filters.users ?? []).map(u => (
              <FilterChip key={`u:${u}`} title={u} onRemove={() => onChange({ ...filters, users: filters.users!.filter(x => x !== u) })} removeTitle={lang === 'pt' ? 'Remover membro' : 'Remove member'}>
                <Users size={10} style={{ flexShrink: 0 }} />
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{u}</span>
              </FilterChip>
            ))}
          </ChipRow>
        </AnimatedRow>
        <AnimatedRow show={hasProjects}>
          <ChipRow label={lang === 'pt' ? 'Projetos' : 'Projects'}>
            {filters.projects.map(path => (
              <FilterChip key={`p:${path}`} title={path} onRemove={() => onChange({ ...filters, projects: filters.projects.filter(p => p !== path), models: [] })} removeTitle={lang === 'pt' ? 'Remover projeto' : 'Remove project'}>
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{formatProjectName(path)}</span>
              </FilterChip>
            ))}
          </ChipRow>
        </AnimatedRow>
        <AnimatedRow show={hasRepoFilter}>
          <ChipRow label={lang === 'pt' ? 'Repositórios' : 'Repos'}>
            {selectedRepos.map(v => (
              <FilterChip key={`r:${v}`} title={v || undefined} onRemove={() => onChange({ ...filters, repos: selectedRepos.filter(x => x !== v) })} removeTitle={lang === 'pt' ? 'Remover repositório' : 'Remove repository'}>
                <GitBranch size={10} style={{ flexShrink: 0 }} />
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{v === '' ? (lang === 'pt' ? 'Sem repositório' : 'No repository') : repoShortName(v)}</span>
              </FilterChip>
            ))}
          </ChipRow>
        </AnimatedRow>
        <AnimatedRow show={(filters.harnesses?.length ?? 0) > 0}>
          <ChipRow label={lang === 'pt' ? 'Harnesses' : 'Harnesses'}>
            {(filters.harnesses ?? []).map(h => {
              const color = HARNESS_COLORS[h]
              return (
                <span key={`h:${h}`} style={{
                  display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11, fontWeight: 600,
                  color, background: `${color}1f`, border: `1px solid ${color}55`, borderRadius: 5,
                  padding: '2px 6px 2px 8px', whiteSpace: 'nowrap',
                }}>
                  <span style={{ display: 'inline-block', width: 7, height: 7, borderRadius: '50%', background: color, flexShrink: 0 }} />
                  {HARNESS_LABELS[h]}
                  <button onClick={() => onChange({ ...filters, harnesses: filters.harnesses!.filter(x => x !== h) })}
                    title={lang === 'pt' ? 'Remover harness' : 'Remove harness'}
                    style={{ background: 'transparent', border: 'none', cursor: 'pointer', padding: 0, display: 'flex', alignItems: 'center', color, opacity: 0.7, flexShrink: 0 }}>
                    <X size={10} strokeWidth={2.5} />
                  </button>
                </span>
              )
            })}
          </ChipRow>
        </AnimatedRow>
        <AnimatedRow show={hasModelFilter}>
          <ChipRow label={lang === 'pt' ? 'Modelos' : 'Models'}>
            {selectedModels.map(m => (
              <FilterChip key={`m:${m}`} title={m} onRemove={() => onChange({ ...filters, models: selectedModels.filter(x => x !== m) })} removeTitle={lang === 'pt' ? 'Remover modelo' : 'Remove model'}>
                <Cpu size={10} style={{ flexShrink: 0 }} />
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{formatModel(m)}</span>
              </FilterChip>
            ))}
          </ChipRow>
        </AnimatedRow>
      </div>

      {showProjectsModal && (
        <ProjectsModal
          projects={projects}
          sessionCountByProject={sessionCountByProject}
          selected={filters.projects}
          onApply={paths => {
            onChange({ ...filters, projects: paths, models: [] })
            setShowProjectsModal(false)
          }}
          onClose={() => setShowProjectsModal(false)}
          lang={lang}
        />
      )}
    </>
  )
}

/** A row that slides open/closed on its own (grid-rows 0fr↔1fr) so each filter category
 *  animates in/out independently. Always mounted; only its height animates. */
function AnimatedRow({ show, children }: { show: boolean; children: React.ReactNode }) {
  return (
    <div style={{ display: 'grid', gridTemplateRows: show ? '1fr' : '0fr', transition: 'grid-template-rows 0.25s cubic-bezier(0.22, 1, 0.36, 1)' }}>
      <div style={{ overflow: 'hidden', minHeight: 0 }}>
        <div style={{ padding: '3px 0' }}>{children}</div>
      </div>
    </div>
  )
}

/** One labeled row of active-filter chips (e.g. "Projetos: [a] [b]"). */
function ChipRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
      <span style={{ fontSize: 10, color: 'var(--text-tertiary)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.4, paddingTop: 4, minWidth: 62, flexShrink: 0 }}>{label}</span>
      <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', flex: 1, minWidth: 0 }}>{children}</div>
    </div>
  )
}

/** A removable orange filter chip (members, projects, models). */
function FilterChip({ title, onRemove, removeTitle, children }: { title?: string; onRemove: () => void; removeTitle: string; children: React.ReactNode }) {
  return (
    <span title={title} style={{
      display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11, fontWeight: 600,
      color: 'var(--anthropic-orange)', background: 'var(--anthropic-orange-dim)',
      border: '1px solid rgba(217,119,6,0.3)', borderRadius: 5,
      padding: '2px 6px 2px 8px', maxWidth: 260, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
    }}>
      {children}
      <button onClick={onRemove} title={removeTitle}
        style={{ background: 'transparent', border: 'none', cursor: 'pointer', padding: 0, display: 'flex', alignItems: 'center', color: 'var(--anthropic-orange)', opacity: 0.7, flexShrink: 0 }}>
        <X size={10} strokeWidth={2.5} />
      </button>
    </span>
  )
}
