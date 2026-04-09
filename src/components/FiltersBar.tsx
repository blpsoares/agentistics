import React, { useState } from 'react'
import type { Filters, DateRange, Project, Lang } from '../lib/types'
import { formatModel } from '../lib/types'
import { Calendar, Layers, Cpu, RotateCcw, ChevronDown, X } from 'lucide-react'
import { ProjectsModal } from './ProjectsModal'
import { DatePicker } from './DatePicker'
import { format } from 'date-fns'

interface Props {
  filters: Filters
  onChange: (f: Filters) => void
  projects: Project[]
  models: string[]
  lang: Lang
  stuck?: boolean
}

const DATE_RANGES: { key: DateRange; labelPt: string; labelEn: string }[] = [
  { key: '7d', labelPt: '7 dias', labelEn: '7 days' },
  { key: '30d', labelPt: '30 dias', labelEn: '30 days' },
  { key: '90d', labelPt: '90 dias', labelEn: '90 days' },
  { key: 'all', labelPt: 'Tudo', labelEn: 'All time' },
]

function Select({ label, icon, value, onChange, options, stuck = false }: {
  label: string
  icon: React.ReactNode
  value: string
  onChange: (v: string) => void
  options: { value: string; label: string }[]
  stuck?: boolean
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: stuck ? 0 : 6, transition: 'gap 0.3s ease' }}>
      <div style={{ display: 'grid', gridTemplateRows: stuck ? '0fr' : '1fr', transition: 'grid-template-rows 0.3s ease' }}>
        <label style={{
          overflow: 'hidden', minHeight: 0,
          fontSize: 11, fontWeight: 500, color: 'var(--text-tertiary)',
          display: 'flex', alignItems: 'center', gap: 4,
          opacity: stuck ? 0 : 1,
          transition: 'opacity 0.2s ease',
        }}>
          {icon} {label}
        </label>
      </div>
      <select
        value={value}
        onChange={e => onChange(e.target.value)}
        style={{
          background: 'var(--bg-elevated)',
          border: '1px solid var(--border)',
          borderRadius: 8,
          color: 'var(--text-primary)',
          fontSize: 13,
          fontFamily: 'inherit',
          padding: stuck ? '5px 10px' : '7px 10px',
          cursor: 'pointer',
          outline: 'none',
          minWidth: 140,
          transition: 'padding 0.2s ease',
        }}
      >
        {options.map(o => (
          <option key={o.value} value={o.value} style={{ background: 'var(--bg-elevated)' }}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  )
}

// DateInput removido — substituído pelo DateRangePicker inline abaixo

export function FiltersBar({ filters, onChange, projects, models, lang, stuck = false }: Props) {
  const [showProjectsModal, setShowProjectsModal] = useState(false)
  const today = format(new Date(), 'yyyy-MM-dd')
  const hasCustomDates = !!(filters.customStart || filters.customEnd)

  const isDefault = filters.dateRange === 'all' && !filters.customStart && !filters.customEnd
    && filters.projects.length === 0 && filters.model === 'all'

  const reset = () => onChange({
    dateRange: 'all',
    customStart: '',
    customEnd: '',
    projects: [],
    model: 'all',
  })

  const hasProjects = filters.projects.length > 0
  const projectLabel = lang === 'pt'
    ? hasProjects ? `${filters.projects.length} projeto${filters.projects.length > 1 ? 's' : ''}` : 'Todos os projetos'
    : hasProjects ? `${filters.projects.length} project${filters.projects.length > 1 ? 's' : ''}` : 'All projects'

  return (
    <>
      <div style={{
        background: stuck ? 'var(--bg-sticky)' : 'var(--bg-card)',
        backdropFilter: stuck ? 'blur(24px) saturate(180%)' : 'none',
        WebkitBackdropFilter: stuck ? 'blur(24px) saturate(180%)' : 'none',
        borderLeft: `1px solid ${stuck ? 'var(--bg-sticky-border)' : 'var(--border)'}`,
        borderRight: `1px solid ${stuck ? 'var(--bg-sticky-border)' : 'var(--border)'}`,
        borderBottom: `1px solid ${stuck ? 'var(--bg-sticky-border)' : 'var(--border)'}`,
        borderTop: `1px solid ${stuck ? 'transparent' : 'var(--border)'}`,
        borderRadius: stuck ? '0 0 var(--radius-lg) var(--radius-lg)' : 'var(--radius-lg)',
        padding: stuck ? '10px 20px' : '16px 20px',
        display: 'flex',
        gap: stuck ? 12 : 16,
        alignItems: 'center',
        flexWrap: 'wrap',
        boxShadow: stuck
          ? '0 12px 40px rgba(0,0,0,0.4), 0 4px 12px rgba(0,0,0,0.2), inset 0 1px 0 rgba(217,119,6,0.15)'
          : 'none',
        transition: [
          'background 0.35s ease',
          'border-radius 0.35s cubic-bezier(0.4,0,0.2,1)',
          'border-color 0.35s ease',
          'padding 0.3s cubic-bezier(0.4,0,0.2,1)',
          'gap 0.3s ease',
          'box-shadow 0.35s ease',
        ].join(', '),
        position: 'relative',
      }}>
        {/* Fusion line — animates in when stuck, connects to header bottom */}
        <div style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          height: 1,
          opacity: stuck ? 1 : 0,
          transition: 'opacity 0.35s ease 0.05s',
          pointerEvents: 'none',
          overflow: 'hidden',
        }}>
          {/* Static glow base */}
          <div style={{
            position: 'absolute', inset: 0,
            background: 'linear-gradient(90deg, transparent 0%, var(--anthropic-orange) 40%, rgba(217,119,6,0.35) 70%, transparent 100%)',
          }} />
          {/* Animated scan shimmer */}
          {stuck && (
            <div style={{
              position: 'absolute', inset: 0,
              background: 'linear-gradient(90deg, transparent 20%, rgba(255,255,255,0.6) 50%, transparent 80%)',
              backgroundSize: '200% 100%',
              animation: 'filters-shimmer-scan 1.6s ease-out 1',
            }} />
          )}
        </div>
        {/* Date range presets */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: stuck ? 0 : 6, transition: 'gap 0.3s ease' }}>
          <div style={{ display: 'grid', gridTemplateRows: stuck ? '0fr' : '1fr', transition: 'grid-template-rows 0.3s ease' }}>
            <label style={{
              overflow: 'hidden', minHeight: 0,
              fontSize: 11, fontWeight: 500, color: 'var(--text-tertiary)',
              display: 'flex', alignItems: 'center', gap: 4,
              opacity: stuck ? 0 : 1,
              transition: 'opacity 0.2s ease',
            }}>
              <Calendar size={11} /> {lang === 'pt' ? 'Período' : 'Period'}
            </label>
          </div>
          <div style={{ display: 'flex', gap: 4 }}>
            {DATE_RANGES.map(r => (
              <button
                key={r.key}
                onClick={() => onChange({ ...filters, dateRange: r.key, customStart: '', customEnd: '' })}
                style={{
                  padding: stuck ? '5px 9px' : '6px 11px',
                  borderRadius: 7,
                  border: filters.dateRange === r.key && !filters.customStart
                    ? '1px solid rgba(217,119,6,0.5)' : '1px solid var(--border)',
                  background: filters.dateRange === r.key && !filters.customStart
                    ? 'var(--anthropic-orange-dim)' : 'var(--bg-elevated)',
                  color: filters.dateRange === r.key && !filters.customStart
                    ? 'var(--anthropic-orange)' : 'var(--text-secondary)',
                  fontSize: 12,
                  fontWeight: 500,
                  cursor: 'pointer',
                  transition: 'all 0.2s ease',
                  fontFamily: 'inherit',
                }}
              >
                {lang === 'pt' ? r.labelPt : r.labelEn}
              </button>
            ))}
          </div>
        </div>

        {/* Custom date range */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: stuck ? 0 : 6, transition: 'gap 0.3s ease' }}>
          <div style={{ display: 'grid', gridTemplateRows: stuck ? '0fr' : '1fr', transition: 'grid-template-rows 0.3s ease' }}>
            <label style={{
              overflow: 'hidden', minHeight: 0,
              fontSize: 11, fontWeight: 500, color: 'var(--text-tertiary)',
              display: 'flex', alignItems: 'center', gap: 4,
              opacity: stuck ? 0 : 1,
              transition: 'opacity 0.2s ease',
            }}>
              <Calendar size={10} /> {lang === 'pt' ? 'Intervalo' : 'Range'}
            </label>
          </div>
          <div style={{
            display: 'flex', alignItems: 'center',
            background: hasCustomDates ? 'var(--anthropic-orange-dim)' : 'var(--bg-elevated)',
            border: hasCustomDates ? '1px solid rgba(217,119,6,0.55)' : '1px solid var(--border)',
            borderRadius: 8,
            transition: 'all 0.2s ease',
            paddingLeft: 10,
          }}>
            <DatePicker
              value={filters.customStart}
              onChange={v => onChange({ ...filters, dateRange: 'all', customStart: v })}
              label={lang === 'pt' ? 'DE' : 'FROM'}
              placeholder="DD/MM/YYYY"
              max={today}
              rangeStart={filters.customStart}
              rangeEnd={filters.customEnd}
              stuck={stuck}
              lang={lang}
            />
            <div style={{ color: 'var(--text-tertiary)', fontSize: 13, padding: '0 6px', flexShrink: 0, opacity: 0.5 }}>→</div>
            <DatePicker
              value={filters.customEnd}
              onChange={v => onChange({ ...filters, dateRange: 'all', customEnd: v })}
              label={lang === 'pt' ? 'ATÉ' : 'TO'}
              placeholder="DD/MM/YYYY"
              max={today}
              min={filters.customStart || undefined}
              rangeStart={filters.customStart}
              rangeEnd={filters.customEnd}
              stuck={stuck}
              lang={lang}
              align="right"
            />
            {hasCustomDates && (
              <button
                onClick={() => onChange({ ...filters, customStart: '', customEnd: '' })}
                title={lang === 'pt' ? 'Limpar datas' : 'Clear dates'}
                style={{
                  background: 'transparent', border: 'none', cursor: 'pointer',
                  color: 'var(--anthropic-orange)', padding: '0 10px 0 4px',
                  display: 'flex', alignItems: 'center', opacity: 0.7, flexShrink: 0,
                }}
              >
                <X size={12} />
              </button>
            )}
          </div>
        </div>

        <div style={{ width: 1, height: stuck ? 28 : 40, background: 'var(--border)', alignSelf: 'center', transition: 'height 0.25s ease' }} />

        {/* Projects multi-select button */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: stuck ? 0 : 6, transition: 'gap 0.3s ease' }}>
          <div style={{ display: 'grid', gridTemplateRows: stuck ? '0fr' : '1fr', transition: 'grid-template-rows 0.3s ease' }}>
            <label style={{
              overflow: 'hidden', minHeight: 0,
              fontSize: 11, fontWeight: 500, color: 'var(--text-tertiary)',
              display: 'flex', alignItems: 'center', gap: 4,
              opacity: stuck ? 0 : 1,
              transition: 'opacity 0.2s ease',
            }}>
              <Layers size={11} /> {lang === 'pt' ? 'Projetos' : 'Projects'}
            </label>
          </div>
          <button
            onClick={() => setShowProjectsModal(true)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              padding: stuck ? '5px 10px' : '7px 12px',
              borderRadius: 8,
              border: hasProjects ? '1px solid rgba(217,119,6,0.5)' : '1px solid var(--border)',
              background: hasProjects ? 'var(--anthropic-orange-dim)' : 'var(--bg-elevated)',
              color: hasProjects ? 'var(--anthropic-orange)' : 'var(--text-primary)',
              fontSize: 13,
              fontFamily: 'inherit',
              cursor: 'pointer',
              minWidth: 140,
              justifyContent: 'space-between',
              transition: 'all 0.2s ease',
            }}
          >
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {projectLabel}
            </span>
            <ChevronDown size={13} style={{ flexShrink: 0, opacity: 0.6 }} />
          </button>
        </div>

        <Select
          label={lang === 'pt' ? 'Modelo' : 'Model'}
          icon={<Cpu size={11} />}
          value={filters.model}
          onChange={v => onChange({ ...filters, model: v })}
          stuck={stuck}
          options={[
            { value: 'all', label: lang === 'pt' ? 'Todos os modelos' : 'All models' },
            ...models.map(m => ({ value: m, label: formatModel(m) })),
          ]}
        />

        {!isDefault && (
          <button
            onClick={reset}
            style={{
              padding: stuck ? '5px 10px' : '7px 12px',
              borderRadius: 8,
              border: '1px solid var(--border)',
              background: 'transparent',
              color: 'var(--text-secondary)',
              fontSize: 12,
              cursor: 'pointer',
              fontFamily: 'inherit',
              display: 'flex',
              alignItems: 'center',
              gap: 5,
              alignSelf: 'center',
              transition: 'all 0.2s ease',
            }}
          >
            <RotateCcw size={11} /> {lang === 'pt' ? 'Resetar' : 'Reset'}
          </button>
        )}
      </div>

      {showProjectsModal && (
        <ProjectsModal
          projects={projects}
          selected={filters.projects}
          onApply={paths => {
            onChange({ ...filters, projects: paths })
            setShowProjectsModal(false)
          }}
          onClose={() => setShowProjectsModal(false)}
          lang={lang}
        />
      )}
    </>
  )
}
