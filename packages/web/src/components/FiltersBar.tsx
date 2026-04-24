import React, { useState, useRef, useEffect } from 'react'
import type { Filters, DateRange, Project, Lang } from '@agentistics/core'
import { formatModel, formatProjectName } from '@agentistics/core'
import { Layers, Cpu, RotateCcw, ChevronDown, X, CalendarDays, Check } from 'lucide-react'
import { ProjectsModal } from './ProjectsModal'
import { DatePicker } from './DatePicker'
import { format } from 'date-fns'

interface Props {
  filters: Filters
  onChange: (f: Filters) => void
  projects: Project[]
  sessionCountByProject: Record<string, number>
  models: string[]
  modelsInProject?: Set<string> | null
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

export function FiltersBar({ filters, onChange, projects, sessionCountByProject, models, modelsInProject, lang, compact }: Props) {
  const [showProjectsModal, setShowProjectsModal] = useState(false)
  const [showModelDropdown, setShowModelDropdown] = useState(false)
  const modelDropdownRef = useRef<HTMLDivElement>(null)
  const today = format(new Date(), 'yyyy-MM-dd')
  const hasCustomDates = !!(filters.customStart || filters.customEnd)

  const selectedModels = filters.models ?? []
  const hasModelFilter = selectedModels.length > 0

  const isDefault = filters.dateRange === 'all'
    && !filters.customStart && !filters.customEnd
    && filters.projects.length === 0 && !hasModelFilter

  const reset = () => onChange({
    dateRange: 'all', customStart: '', customEnd: '', projects: [], models: [],
  })

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

  return (
    <>
      <div style={{
        display: 'flex',
        gap: 8,
        alignItems: 'center',
        flexWrap: 'wrap',
        padding: compact ? '10px 12px' : '8px 0',
      }}>

        {/* Date range presets */}
        <div style={{ display: 'flex', gap: 3 }}>
          {DATE_RANGES.map(r => {
            const active = filters.dateRange === r.key && !filters.customStart
            return (
              <button
                key={r.key}
                onClick={() => onChange({ ...filters, dateRange: r.key, customStart: '', customEnd: '' })}
                style={{
                  ...CTL,
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

        {/* Divider */}
        {!compact && <div style={{ width: 1, height: 20, background: 'var(--border)', flexShrink: 0 }} />}

        {/* Projects */}
        <button
          onClick={() => setShowProjectsModal(true)}
          title={lang === 'pt' ? 'Filtrar por projeto' : 'Filter by project'}
          style={{
            ...CTL,
            gap: 5,
            border: hasProjects ? '1px solid rgba(217,119,6,0.5)' : '1px solid var(--border)',
            background: hasProjects ? 'var(--anthropic-orange-dim)' : 'var(--bg-elevated)',
            color: hasProjects ? 'var(--anthropic-orange)' : 'var(--text-secondary)',
            minWidth: 110,
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
        <div ref={modelDropdownRef} style={{ position: 'relative' }}>
          <button
            onClick={() => setShowModelDropdown(v => !v)}
            title={lang === 'pt' ? 'Filtrar por modelo' : 'Filter by model'}
            style={{
              ...CTL,
              gap: 5,
              border: hasModelFilter ? '1px solid rgba(217,119,6,0.5)' : '1px solid var(--border)',
              background: hasModelFilter ? 'var(--anthropic-orange-dim)' : 'var(--bg-elevated)',
              color: hasModelFilter ? 'var(--anthropic-orange)' : 'var(--text-secondary)',
              minWidth: 130,
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
            <div style={{
              position: 'absolute',
              top: 'calc(100% + 4px)',
              left: 0,
              background: 'var(--bg-elevated)',
              border: '1px solid var(--border)',
              borderRadius: 8,
              boxShadow: '0 4px 16px rgba(0,0,0,0.25)',
              zIndex: 1000,
              minWidth: 190,
              padding: '4px 0',
            }}>
              {models.map(m => {
                const disabled = modelsInProject ? !modelsInProject.has(m) : false
                const selected = selectedModels.includes(m)
                return (
                  <button
                    key={m}
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

        {/* Reset */}
        {!isDefault && (
          <button
            onClick={reset}
            title={lang === 'pt' ? 'Resetar filtros' : 'Reset filters'}
            style={{
              ...CTL,
              gap: 5,
              color: 'var(--text-secondary)',
            }}
          >
            <RotateCcw size={11} />
            {lang === 'pt' ? 'Resetar' : 'Reset'}
          </button>
        )}
      </div>

      {/* Selected project chips */}
      {hasProjects && (
        <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', padding: compact ? '0 12px 8px' : '0 0 4px' }}>
          {filters.projects.map(path => (
            <span
              key={path}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 5,
                fontSize: 11,
                fontWeight: 500,
                color: 'var(--anthropic-orange)',
                background: 'var(--anthropic-orange-dim)',
                border: '1px solid rgba(217,119,6,0.3)',
                borderRadius: 5,
                padding: '2px 6px 2px 8px',
                maxWidth: 260,
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
            >
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }} title={path}>
                {formatProjectName(path)}
              </span>
              <button
                onClick={() => onChange({ ...filters, projects: filters.projects.filter(p => p !== path), models: [] })}
                title={lang === 'pt' ? 'Remover projeto' : 'Remove project'}
                style={{
                  background: 'transparent',
                  border: 'none',
                  cursor: 'pointer',
                  padding: 0,
                  display: 'flex',
                  alignItems: 'center',
                  color: 'var(--anthropic-orange)',
                  opacity: 0.7,
                  flexShrink: 0,
                }}
              >
                <X size={10} strokeWidth={2.5} />
              </button>
            </span>
          ))}
        </div>
      )}

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
