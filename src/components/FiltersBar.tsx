import React, { useState } from 'react'
import type { Filters, DateRange, Project, Lang } from '../lib/types'
import { formatModel } from '../lib/types'
import { Layers, Cpu, RotateCcw, ChevronDown, X, CalendarDays } from 'lucide-react'
import { ProjectsModal } from './ProjectsModal'
import { DatePicker } from './DatePicker'
import { format } from 'date-fns'

interface Props {
  filters: Filters
  onChange: (f: Filters) => void
  projects: Project[]
  sessionCountByProject: Record<string, number>
  models: string[]
  lang: Lang
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

export function FiltersBar({ filters, onChange, projects, sessionCountByProject, models, lang }: Props) {
  const [showProjectsModal, setShowProjectsModal] = useState(false)
  const today = format(new Date(), 'yyyy-MM-dd')
  const hasCustomDates = !!(filters.customStart || filters.customEnd)

  const isDefault = filters.dateRange === 'all'
    && !filters.customStart && !filters.customEnd
    && filters.projects.length === 0 && filters.model === 'all'

  const reset = () => onChange({
    dateRange: 'all', customStart: '', customEnd: '', projects: [], model: 'all',
  })

  const hasProjects = filters.projects.length > 0
  const projectLabel = lang === 'pt'
    ? hasProjects ? `${filters.projects.length} projeto${filters.projects.length > 1 ? 's' : ''}` : 'Projetos'
    : hasProjects ? `${filters.projects.length} project${filters.projects.length > 1 ? 's' : ''}` : 'Projects'

  return (
    <>
      <div style={{
        display: 'flex',
        gap: 8,
        alignItems: 'center',
        flexWrap: 'wrap',
        padding: '8px 0',
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
        <div style={{ width: 1, height: 20, background: 'var(--border)', flexShrink: 0 }} />

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
        <div style={{ width: 1, height: 20, background: 'var(--border)', flexShrink: 0 }} />

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

        {/* Model */}
        <div
          style={{ position: 'relative', display: 'flex', alignItems: 'center' }}
          title={hasProjects
            ? (lang === 'pt'
              ? 'Filtro de modelo indisponível com filtro de projeto ativo — sessões não têm campo de modelo'
              : 'Model filter unavailable when project filter is active — sessions have no model field')
            : undefined}
        >
          <Cpu size={11} style={{ position: 'absolute', left: 8, color: hasProjects ? 'var(--text-tertiary)' : 'var(--text-tertiary)', pointerEvents: 'none', opacity: hasProjects ? 0.35 : 1 }} />
          <select
            value={filters.model}
            onChange={e => onChange({ ...filters, model: e.target.value })}
            disabled={hasProjects}
            title={lang === 'pt' ? 'Filtrar por modelo' : 'Filter by model'}
            style={{
              ...CTL,
              paddingLeft: 24,
              minWidth: 130,
              appearance: 'none',
              WebkitAppearance: 'none',
              opacity: hasProjects ? 0.4 : 1,
              cursor: hasProjects ? 'not-allowed' : 'pointer',
            } as React.CSSProperties}
          >
            <option value="all">{lang === 'pt' ? 'Modelos' : 'Models'}</option>
            {models.map(m => (
              <option key={m} value={m} style={{ background: 'var(--bg-elevated)' }}>
                {formatModel(m)}
              </option>
            ))}
          </select>
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

      {showProjectsModal && (
        <ProjectsModal
          projects={projects}
          sessionCountByProject={sessionCountByProject}
          selected={filters.projects}
          onApply={paths => {
            // Reset model filter when project filter is applied — no per-session model data
            onChange({ ...filters, projects: paths, model: 'all' })
            setShowProjectsModal(false)
          }}
          onClose={() => setShowProjectsModal(false)}
          lang={lang}
        />
      )}
    </>
  )
}
