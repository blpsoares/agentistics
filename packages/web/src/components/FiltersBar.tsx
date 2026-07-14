import React, { useState, useRef, useEffect, useLayoutEffect, useMemo } from 'react'
import type { Filters, DateRange, Project, Lang, HarnessId } from '@agentistics/core'
import { formatModel, formatProjectName, repoShortName } from '@agentistics/core'
import { Layers, Cpu, ChevronDown, X, CalendarDays, Check, Users, GitBranch, Search, Plus, Blocks, Radio } from 'lucide-react'
import { HARNESS_LABELS, HARNESS_COLORS } from '../lib/harness'
import { ProjectsModal } from './ProjectsModal'
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

/** Search input used inside the value pickers (members / repositories). */
const SEARCH_INPUT: React.CSSProperties = {
  width: '100%', boxSizing: 'border-box', fontSize: 12, fontFamily: 'inherit',
  color: 'var(--text-primary)', background: 'var(--bg-card)', border: '1px solid var(--border)',
  borderRadius: 6, padding: '6px 8px 6px 26px', outline: 'none',
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
  const [repoQuery, setRepoQuery] = useState('')
  const [memberQuery, setMemberQuery] = useState('')
  // ── "+ Filter" menu: pick a dimension → open its value picker. One open at a time. ──
  type Dimension = 'members' | 'harnesses' | 'presence' | 'repos' | 'models'
  const [showAddMenu, setShowAddMenu] = useState(false)
  const [openPicker, setOpenPicker] = useState<Dimension | null>(null)
  const addFilterRef = useRef<HTMLDivElement>(null)
  const popoverRef = useRef<HTMLDivElement>(null)
  const today = format(new Date(), 'yyyy-MM-dd')
  const hasCustomDates = !!(filters.customStart || filters.customEnd)

  const selectedModels = filters.models ?? []
  const hasModelFilter = selectedModels.length > 0

  const hasProjects = filters.projects.length > 0

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
  const toggleRepo = (v: string) => {
    const next = selectedRepos.includes(v) ? selectedRepos.filter(x => x !== v) : [...selectedRepos, v]
    onChange({ ...filters, repos: next })
  }

  // Number of dimensions currently active — shown as the badge on the "+ Filter" button.
  const activeFilterCount = [
    (filters.users?.length ?? 0) > 0,
    (filters.harnesses?.length ?? 0) > 0,
    filters.presence !== undefined,
    hasRepoFilter,
    hasProjects,
    hasModelFilter,
  ].filter(Boolean).length

  // Outside click closes the "+ Filter" menu and any open dimension picker together.
  useEffect(() => {
    if (!showAddMenu && !openPicker) return
    function handleClickOutside(e: MouseEvent) {
      if (addFilterRef.current && !addFilterRef.current.contains(e.target as Node)) {
        setShowAddMenu(false)
        setOpenPicker(null)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [showAddMenu, openPicker])

  // Clamp the popover so it never overflows the viewport (which would give the whole page a
  // horizontal scrollbar). First cap its width to the viewport, then shift it left if its
  // right edge still spills over — keeping the left edge at least 8px from the viewport edge.
  useLayoutEffect(() => {
    if (!openPicker || !popoverRef.current || !addFilterRef.current) return
    const MARGIN = 8
    const container = addFilterRef.current.getBoundingClientRect()
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
  }, [openPicker])

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

        {/* + Filter — single entry point for all dimension filters (members/harnesses/
            presence/repos/projects/models). Clicking it opens a menu of the AVAILABLE
            dimensions; picking one opens that dimension's value picker. The selected
            values themselves render in the animated chip rows below, not here. */}
        <div ref={addFilterRef} style={{ position: 'relative', flex: isMobile ? '1 1 0' : undefined }}>
          <button
            onClick={() => { setShowAddMenu(v => !v); setOpenPicker(null) }}
            title={lang === 'pt' ? 'Adicionar filtro' : 'Add filter'}
            style={{
              ...CTL,
              gap: 5,
              width: isMobile ? '100%' : undefined,
              justifyContent: isMobile ? 'center' : undefined,
              border: '1px dashed var(--border)',
              background: 'transparent',
              color: 'var(--text-secondary)',
            }}
          >
            <Plus size={12} style={{ flexShrink: 0 }} />
            <span>{lang === 'pt' ? 'Filtro' : 'Filter'}</span>
            {activeFilterCount > 0 && (
              <span style={{
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                minWidth: 15, height: 15, borderRadius: 8, padding: '0 4px',
                background: 'var(--anthropic-orange)', color: 'white',
                fontSize: 10, fontWeight: 700, lineHeight: 1, flexShrink: 0,
              }}>{activeFilterCount}</span>
            )}
          </button>

          {/* Dimension menu — lists only the dimensions that actually apply to this data. */}
          {showAddMenu && !openPicker && (
            <div style={{
              position: 'absolute', top: 'calc(100% + 4px)', left: 0,
              background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 8,
              boxShadow: '0 4px 16px rgba(0,0,0,0.25)', zIndex: 1000,
              minWidth: 190, boxSizing: 'border-box', padding: 6,
            }}>
              {users.length > 0 && (
                <MenuItem
                  icon={<Users size={13} />}
                  label={lang === 'pt' ? 'Membros' : 'Members'}
                  active={(filters.users?.length ?? 0) > 0}
                  onClick={() => setOpenPicker('members')}
                />
              )}
              {harnesses && harnesses.length > 1 && (
                <MenuItem
                  icon={<Blocks size={13} />}
                  label={lang === 'pt' ? 'Harnesses' : 'Harnesses'}
                  active={(filters.harnesses?.length ?? 0) > 0}
                  onClick={() => setOpenPicker('harnesses')}
                />
              )}
              {presence && Object.keys(presence).length > 0 && (
                <MenuItem
                  icon={<Radio size={13} />}
                  label={lang === 'pt' ? 'Presença' : 'Presence'}
                  active={filters.presence !== undefined}
                  onClick={() => setOpenPicker('presence')}
                />
              )}
              {showRepoFilter && (
                <MenuItem
                  icon={<GitBranch size={13} />}
                  label={lang === 'pt' ? 'Repositórios' : 'Repositories'}
                  active={hasRepoFilter}
                  onClick={() => { setRepoQuery(''); setOpenPicker('repos') }}
                />
              )}
              {projects.length > 0 && (
                <MenuItem
                  icon={<Layers size={13} />}
                  label={lang === 'pt' ? 'Projetos' : 'Projects'}
                  active={hasProjects}
                  onClick={() => { setShowAddMenu(false); setShowProjectsModal(true) }}
                />
              )}
              {models.length > 0 && (
                <MenuItem
                  icon={<Cpu size={13} />}
                  label={lang === 'pt' ? 'Modelos' : 'Models'}
                  active={hasModelFilter}
                  onClick={() => setOpenPicker('models')}
                />
              )}
            </div>
          )}

          {/* Value picker — one dimension at a time. */}
          {openPicker && (
            <div ref={popoverRef} style={{
              position: 'absolute',
              top: 'calc(100% + 4px)',
              left: 0,
              background: 'var(--bg-elevated)',
              border: '1px solid var(--border)',
              borderRadius: 8,
              boxShadow: '0 4px 16px rgba(0,0,0,0.25)',
              zIndex: 1000,
              width: isMobile ? 'min(92vw, 340px)' : 280,
              maxHeight: '70vh',
              overflowY: 'auto',
              overflowX: 'hidden',
              boxSizing: 'border-box',
              padding: 6,
            }}>
              <button
                onClick={() => setOpenPicker(null)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 4,
                  background: 'transparent', border: 'none', cursor: 'pointer',
                  color: 'var(--text-tertiary)', fontSize: 11, fontFamily: 'inherit',
                  padding: '2px 6px 6px',
                }}
              >
                <ChevronDown size={11} style={{ transform: 'rotate(90deg)' }} />
                {lang === 'pt' ? 'Voltar' : 'Back'}
              </button>
              <div style={{ height: 1, background: 'var(--border)', margin: '0 0 4px' }} />

              {/* Members (multi) */}
              {openPicker === 'members' && (
                <>
                  <div style={{ position: 'relative', display: 'flex', alignItems: 'center', marginBottom: 4 }}>
                    <Search size={13} color="var(--text-tertiary)" style={{ position: 'absolute', left: 8, pointerEvents: 'none' }} />
                    <input
                      value={memberQuery}
                      onChange={e => setMemberQuery(e.target.value)}
                      autoFocus
                      placeholder={lang === 'pt' ? 'Buscar membro…' : 'Search member…'}
                      style={SEARCH_INPUT}
                    />
                  </div>
                  <div style={{ maxHeight: 240, overflowY: 'auto' }}>
                    {users
                      .filter(u => u.toLowerCase().includes(memberQuery.trim().toLowerCase()))
                      .map(u => {
                        const selected = (filters.users ?? []).includes(u)
                        return (
                          <PickerRow
                            key={u}
                            selected={selected}
                            label={u}
                            onClick={() => {
                              const cur = filters.users ?? []
                              const next = cur.includes(u) ? cur.filter(x => x !== u) : [...cur, u]
                              onChange({ ...filters, users: next })
                            }}
                          />
                        )
                      })}
                  </div>
                  {(filters.users?.length ?? 0) > 0 && (
                    <ClearFooter onClick={() => onChange({ ...filters, users: [] })} label={lang === 'pt' ? 'Limpar membros' : 'Clear members'} />
                  )}
                </>
              )}

              {/* Harnesses (multi) */}
              {openPicker === 'harnesses' && harnesses && (
                <>
                  <div style={{ maxHeight: 240, overflowY: 'auto' }}>
                    {harnesses.map(h => {
                      const selected = (filters.harnesses ?? []).includes(h)
                      return (
                        <PickerRow
                          key={h}
                          selected={selected}
                          dotColor={HARNESS_COLORS[h]}
                          label={HARNESS_LABELS[h]}
                          onClick={() => {
                            const cur = filters.harnesses ?? []
                            const next = cur.includes(h) ? cur.filter(x => x !== h) : [...cur, h]
                            onChange({ ...filters, harnesses: next })
                          }}
                        />
                      )
                    })}
                  </div>
                  {(filters.harnesses?.length ?? 0) > 0 && (
                    <ClearFooter onClick={() => onChange({ ...filters, harnesses: [] })} label={lang === 'pt' ? 'Limpar harnesses' : 'Clear harnesses'} />
                  )}
                </>
              )}

              {/* Presence (single) */}
              {openPicker === 'presence' && presence && (
                <div>
                  {([
                    { key: undefined, label: lang === 'pt' ? 'Todos' : 'All', count: null },
                    { key: 'online' as const, label: 'Online', count: Object.values(presence).filter(p => p.online).length, dot: '#22c55e' },
                    { key: 'offline' as const, label: 'Offline', count: Object.values(presence).filter(p => !p.online).length, dot: '#ef4444' },
                  ]).map(opt => (
                    <PickerRow
                      key={opt.label}
                      selected={filters.presence === opt.key}
                      label={opt.label}
                      count={opt.count ?? undefined}
                      dotColor={opt.dot}
                      onClick={() => { onChange({ ...filters, presence: opt.key }); setOpenPicker(null) }}
                    />
                  ))}
                </div>
              )}

              {/* Repositories (multi) */}
              {openPicker === 'repos' && (
                <>
                  <div style={{ position: 'relative', display: 'flex', alignItems: 'center', marginBottom: 4 }}>
                    <Search size={13} color="var(--text-tertiary)" style={{ position: 'absolute', left: 8, pointerEvents: 'none' }} />
                    <input
                      value={repoQuery}
                      onChange={e => setRepoQuery(e.target.value)}
                      autoFocus
                      placeholder={lang === 'pt' ? 'Buscar repositório…' : 'Search repository…'}
                      style={SEARCH_INPUT}
                    />
                  </div>
                  <div style={{ maxHeight: 240, overflowY: 'auto' }}>
                    {repoFilteredOptions.length === 0 && (
                      <div style={{ fontSize: 12, color: 'var(--text-tertiary)', padding: '8px 10px', textAlign: 'center' }}>
                        {lang === 'pt' ? 'Nenhum repositório' : 'No repositories'}
                      </div>
                    )}
                    {repoFilteredOptions.map(opt => (
                      <PickerRow
                        key={opt.value || '__none__'}
                        selected={selectedRepos.includes(opt.value)}
                        icon={opt.linked
                          ? <GitBranch size={11} style={{ flexShrink: 0, opacity: 0.6 }} />
                          : <X size={11} style={{ flexShrink: 0, opacity: 0.6 }} />}
                        label={opt.label}
                        count={opt.count}
                        onClick={() => toggleRepo(opt.value)}
                      />
                    ))}
                  </div>
                  {hasRepoFilter && (
                    <ClearFooter onClick={() => onChange({ ...filters, repos: [] })} label={lang === 'pt' ? 'Limpar repositórios' : 'Clear repositories'} />
                  )}
                </>
              )}

              {/* Models (multi, grouped by harness) */}
              {openPicker === 'models' && (
                <>
                  <div style={{ maxHeight: 320, overflowY: 'auto' }}>
                    {groups.map(group => (
                      <div key={group.harness ?? '__all__'}>
                        {showGroupHeaders && group.harness && (
                          <div style={{
                            display: 'flex', alignItems: 'center', gap: 6,
                            padding: '7px 10px 3px',
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
                            <PickerRow
                              key={`${group.harness ?? ''}:${m}`}
                              selected={selected}
                              disabled={disabled}
                              label={formatModel(m)}
                              tag={disabled ? (lang === 'pt' ? 'sem uso' : 'unused') : undefined}
                              onClick={() => toggleModel(m)}
                            />
                          )
                        })}
                      </div>
                    ))}
                  </div>
                  {hasModelFilter && (
                    <ClearFooter onClick={() => onChange({ ...filters, models: [] })} label={lang === 'pt' ? 'Limpar modelos' : 'Clear models'} />
                  )}
                </>
              )}
            </div>
          )}
        </div>

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
        <AnimatedRow show={filters.presence !== undefined}>
          <ChipRow label={lang === 'pt' ? 'Presença' : 'Presence'}>
            {filters.presence !== undefined && (() => {
              const online = filters.presence === 'online'
              const color = online ? '#22c55e' : '#ef4444'
              return (
                <span style={{
                  display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11, fontWeight: 600,
                  color, background: `${color}1f`, border: `1px solid ${color}55`, borderRadius: 5,
                  padding: '2px 6px 2px 8px', whiteSpace: 'nowrap',
                }}>
                  <span style={{ width: 7, height: 7, borderRadius: '50%', background: color, flexShrink: 0 }} />
                  {online ? 'Online' : 'Offline'}
                  <button onClick={() => onChange({ ...filters, presence: undefined })}
                    title={lang === 'pt' ? 'Remover filtro de presença' : 'Remove presence filter'}
                    style={{ background: 'transparent', border: 'none', cursor: 'pointer', padding: 0, display: 'flex', alignItems: 'center', color, opacity: 0.7, flexShrink: 0 }}>
                    <X size={10} strokeWidth={2.5} />
                  </button>
                </span>
              )
            })()}
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

/** A row in the "+ Filter" dimension menu — icon + label + a subtle dot marker when active. */
function MenuItem({ icon, label, active, onClick }: { icon: React.ReactNode; label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{
        display: 'flex', alignItems: 'center', gap: 8, width: '100%',
        padding: '8px 10px', borderRadius: 6, border: 'none',
        background: 'transparent', cursor: 'pointer', color: 'var(--text-primary)',
        fontSize: 12, fontFamily: 'inherit', textAlign: 'left',
      }}
      onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = 'var(--bg-card-hover)' }}
      onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = 'transparent' }}
    >
      <span style={{ display: 'flex', alignItems: 'center', color: 'var(--text-tertiary)', flexShrink: 0 }}>{icon}</span>
      <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</span>
      {active && <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--anthropic-orange)', flexShrink: 0 }} />}
    </button>
  )
}

/** One selectable row inside a dimension value picker (checkbox-style; also used for the
 *  single-select presence picker, where "selected" just highlights the current choice). */
function PickerRow({ selected, onClick, icon, label, count, disabled, tag, dotColor }: {
  selected: boolean
  onClick: () => void
  icon?: React.ReactNode
  label: string
  count?: number
  disabled?: boolean
  tag?: string
  dotColor?: string
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        display: 'flex', alignItems: 'center', gap: 8, width: '100%',
        padding: '7px 10px', borderRadius: 6, border: 'none',
        cursor: disabled ? 'not-allowed' : 'pointer',
        background: selected ? 'var(--anthropic-orange-dim)' : 'transparent',
        color: disabled ? 'var(--text-tertiary)' : selected ? 'var(--anthropic-orange)' : 'var(--text-secondary)',
        fontSize: 12, fontFamily: 'inherit', textAlign: 'left', opacity: disabled ? 0.45 : 1,
      }}
      onMouseEnter={e => { if (!selected && !disabled) (e.currentTarget as HTMLButtonElement).style.background = 'var(--bg-card-hover)' }}
      onMouseLeave={e => { if (!selected) (e.currentTarget as HTMLButtonElement).style.background = 'transparent' }}
    >
      <span style={{ width: 14, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        {selected && <Check size={12} strokeWidth={3} />}
      </span>
      {dotColor && <span style={{ width: 7, height: 7, borderRadius: '50%', background: dotColor, flexShrink: 0 }} />}
      {icon}
      <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</span>
      {tag && <span style={{ fontSize: 10, opacity: 0.7, flexShrink: 0 }}>{tag}</span>}
      {count !== undefined && <span style={{ fontSize: 11, color: 'var(--text-tertiary)', flexShrink: 0 }}>{count}</span>}
    </button>
  )
}

/** Footer "Clear" action shown at the bottom of a multi-select picker when it has a selection. */
function ClearFooter({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <>
      <div style={{ height: 1, background: 'var(--border)', margin: '4px 0' }} />
      <button
        onClick={onClick}
        style={{
          display: 'flex', alignItems: 'center', gap: 8, width: '100%', padding: '7px 10px',
          background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)',
          fontSize: 12, fontFamily: 'inherit', textAlign: 'left',
        }}
      >
        <X size={11} />
        {label}
      </button>
    </>
  )
}
